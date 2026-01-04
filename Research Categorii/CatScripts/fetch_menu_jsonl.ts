import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile, gqlPost, writeJsonFile, parseCli, sleep } from './common.js';

// ---- Queries ----

const GET_MENUS_QUERY = `
query GetMenus($first: Int!) {
  menus(first: $first) {
    nodes {
      id
      title
      handle
    }
  }
}
`;

// Fragments for recursive fetching
// Note: Shopify has a hard depth limit of 3 for menus. 
// We construct a query that fetches all 3 levels explicitly.
const MENU_DETAILS_QUERY = `
query GetMenuDetails($id: ID!) {
  menu(id: $id) {
    id
    title
    handle
    items { # Level 1
      id
      title
      url
      type
      resourceId
      tags
      items { # Level 2
        id
        title
        url
        type
        resourceId
        tags
        items { # Level 3
          id
          title
          url
          type
          resourceId
          tags
        }
      }
    }
  }
}
`;

// ---- Types ----

type MenuItem = {
  id: string;
  title: string;
  url: string | null;
  type: string;
  resourceId: string | null;
  tags: string[];
  items: MenuItem[];
};

type Menu = {
  id: string;
  title: string;
  handle: string;
  items: MenuItem[];
};

// ---- Helpers ----

function flattenMenu(menu: Menu): any[] {
  const rows: any[] = [];

  function traverse(item: MenuItem, parentId: string | null, level: number, pathStr: string) {
    const currentPath = pathStr ? `${pathStr} > ${item.title}` : item.title;
    
    // Create the flat record
    rows.push({
      id: item.id,
      title: item.title,
      type: item.type,
      url: item.url,
      resourceId: item.resourceId,
      parentId: parentId,
      level: level,
      path: currentPath,
      tags: item.tags?.join(',') || ''
    });

    // Recurse children
    if (item.items && item.items.length > 0) {
      for (const child of item.items) {
        traverse(child, item.id, level + 1, currentPath);
      }
    }
  }

  // Root items
  if (menu.items) {
    for (const item of menu.items) {
      traverse(item, null, 1, '');
    }
  }

  return rows;
}

// ---- Main ----

async function main() {
  const cli = parseCli(process.argv.slice(2));
  
  if (cli.flags.has('help')) {
    console.log(`
      Usage: tsx fetch_menu_jsonl.ts [options]

      Options:
        --env <path>       Path to .env file (default: ../../.env)
        --handle <handle>  Menu handle to fetch (default: main-menu)
        --all              Fetch ALL available menus into separate files
        --out-dir <path>   Output directory for --all mode (default: ../CatOutputs/AllMenus)
        --out-tree <path>  Output path for single menu mode (Tree JSON)
        --out-flat <path>  Output path for single menu mode (Flat JSONL)
        --list-menus       List all available menus and exit
    `);
    process.exit(0);
  }

  // Paths
  const envPath = cli.values['env'] || path.resolve('../../.env');
  const outDir = cli.values['out-dir'] || path.resolve('../CatOutputs/AllMenus');

  // Load Env
  if (!fs.existsSync(envPath)) {
    console.error(`Error: Env file not found at ${envPath}`);
    process.exit(1);
  }
  const env = loadEnvFile(envPath);
  const shop = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_API_TOKEN;
  
  if (!shop || !token) {
    console.error("Error: Missing SHOPIFY_SHOP_DOMAIN or SHOPIFY_ADMIN_API_TOKEN in env.");
    process.exit(1);
  }

  const endpoint = `https://${shop}/admin/api/2025-10/graphql.json`;

  console.log(`Connecting to ${shop}...`);

  // 1. List Menus
  const menusResp = await gqlPost<any>(endpoint, token, GET_MENUS_QUERY, { first: 50 }, 30000);
  if (menusResp.errors) {
    console.error("GraphQL Error listing menus:", JSON.stringify(menusResp.errors, null, 2));
    process.exit(1);
  }

  const menus = menusResp.data.menus.nodes;
  
  if (cli.flags.has('list-menus')) {
    console.log("Available Menus:");
    menus.forEach((m: any) => console.log(` - ${m.title} (handle: ${m.handle}, id: ${m.id})`));
    process.exit(0);
  }

  // Determine mode: All vs Single
  if (cli.flags.has('all')) {
    console.log(`Fetching ALL ${menus.length} menus into ${outDir}...`);
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    for (const menuHead of menus) {
      console.log(`Processing: ${menuHead.title} (${menuHead.handle})...`);
      
      const treeResp = await gqlPost<any>(endpoint, token, MENU_DETAILS_QUERY, { id: menuHead.id }, 60000);
      if (treeResp.errors) {
        console.error(`Error fetching menu ${menuHead.handle}:`, JSON.stringify(treeResp.errors));
        continue;
      }
      
      const menuData: Menu = treeResp.data.menu;
      const safeHandle = menuHead.handle.replace(/[^a-z0-9-_]/gi, '_');

      // Save Tree
      writeJsonFile(path.join(outDir, `${safeHandle}_tree.json`), menuData);
      
      // Save Flat
      const flatRows = flattenMenu(menuData);
      const flatPath = path.join(outDir, `${safeHandle}_flat.jsonl`);
      
      const stream = fs.createWriteStream(flatPath, { encoding: 'utf-8' });
      for (const row of flatRows) {
        stream.write(JSON.stringify(row) + '\n');
      }
      stream.end();
      
      console.log(`  -> Saved ${flatRows.length} items to ${safeHandle}_flat.jsonl`);
      
      // Throttle slightly to be nice
      await sleep(100);
    }
    
    console.log("Done fetching all menus.");

  } else {
    // Single Menu Mode
    const targetHandle = cli.values['handle'] || 'main-menu';
    const outTreePath = cli.values['out-tree'] || path.resolve('../CatOutputs/menu_tree.json');
    const outFlatPath = cli.values['out-flat'] || path.resolve('../CatOutputs/menu_flat.jsonl');

    const targetMenu = menus.find((m: any) => m.handle === targetHandle);

    if (!targetMenu) {
      console.error(`Error: Menu with handle '${targetHandle}' not found.`);
      console.log("Available handles:", menus.map((m:any) => m.handle).join(', '));
      process.exit(1);
    }

    console.log(`Fetching full structure for menu: ${targetMenu.title} (${targetMenu.id})...`);

    const treeResp = await gqlPost<any>(endpoint, token, MENU_DETAILS_QUERY, { id: targetMenu.id }, 60000);
    
    if (treeResp.errors) {
      console.error("Error fetching menu details:", JSON.stringify(treeResp.errors, null, 2));
      process.exit(1);
    }

    const menuData: Menu = treeResp.data.menu;
    
    // Save Tree
    writeJsonFile(outTreePath, menuData);
    console.log(`Saved Menu Tree to: ${outTreePath}`);

    // Save Flat
    const flatRows = flattenMenu(menuData);
    
    const flatDir = path.dirname(outFlatPath);
    if (!fs.existsSync(flatDir) && flatDir !== '') fs.mkdirSync(flatDir, { recursive: true });

    const stream = fs.createWriteStream(outFlatPath, { encoding: 'utf-8' });
    for (const row of flatRows) {
      stream.write(JSON.stringify(row) + '\n');
    }
    stream.end();

    console.log(`Saved Flat JSONL to: ${outFlatPath} (${flatRows.length} items)`);
  }
}

main().catch(console.error);
