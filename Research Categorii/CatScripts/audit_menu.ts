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

// Advanced Audit Query
// Fetches structure + Resource Status + Metafields
const MENU_AUDIT_QUERY = `
query GetMenuAudit($id: ID!) {
  menu(id: $id) {
    id
    title
    handle
    items { 
      ...MenuItemAudit
      items { 
        ...MenuItemAudit
        items { 
          ...MenuItemAudit
        }
      }
    }
  }
}

fragment MenuItemAudit on MenuItem {
  id
  title
  url
  type
  tags
  
  # Audit: Resource Health
  resource {
    ... on Collection {
      id
      title
      productsCount
      publishedOnCurrentPublication
    }
    ... on Product {
      id
      title
      status
      totalInventory
    }
    ... on Page {
      id
      title
      bodySummary
      publishedOnCurrentPublication
    }
  }

  # Audit: Custom Data
  metafields(first: 5) {
    nodes {
      namespace
      key
      value
      type
    }
  }
}
`;

// ---- Types ----

type Metafield = {
  namespace: string;
  key: string;
  value: string;
  type: string;
};

type ResourceStatus = {
  __typename?: string;
  id?: string;
  title?: string;
  // Collection
  productsCount?: number;
  // Product
  status?: string; // ACTIVE, DRAFT, ARCHIVED
  totalInventory?: number;
  // Common
  publishedOnCurrentPublication?: boolean;
};

type MenuItemAudit = {
  id: string;
  title: string;
  url: string | null;
  type: string;
  tags: string[];
  resource: ResourceStatus | null;
  metafields: { nodes: Metafield[] };
  items: MenuItemAudit[];
};

type MenuAudit = {
  id: string;
  title: string;
  handle: string;
  items: MenuItemAudit[];
};

type FlatAuditRow = {
  id: string;
  title: string;
  type: string;
  url: string | null;
  parentId: string | null;
  level: number;
  path: string;
  
  // Audit Columns
  link_health: 'OK' | 'BROKEN' | 'EMPTY' | 'DRAFT' | 'HARDCODED_HTTP';
  details: string; // e.g., "Collection has 0 products", "Product is DRAFT"
  resource_id: string | null;
  target_title: string | null;
  metafields_count: number;
};

// ---- Helpers ----

function flattenAndAuditMenu(menu: MenuAudit): FlatAuditRow[] {
  const rows: FlatAuditRow[] = [];

  function traverse(item: MenuItemAudit, parentId: string | null, level: number, pathStr: string) {
    const currentPath = pathStr ? `${pathStr} > ${item.title}` : item.title;
    
    let health: FlatAuditRow['link_health'] = 'OK';
    let details = 'Valid';

    // 1. Check Link Type
    if (item.type === 'HTTP') {
      // Is it internal hardcoded?
      if (item.url?.includes('neanelu.ro') || item.url?.includes('myshopify.com')) {
        health = 'HARDCODED_HTTP';
        details = 'Manual link to internal page (risky)';
      } else if (item.url === '#' || !item.url) {
        // Often used for parent headers
        health = 'OK'; 
        details = 'Header/No Link';
      }
    } 
    // 2. Check Resource Status (Dynamic Links)
    else if (item.resource) {
      const r = item.resource;
      const type = r.__typename;
      
      if (type === 'Collection') {
        if (r.productsCount === 0) {
          health = 'EMPTY';
          details = 'Collection is empty (0 products)';
        } else if (r.publishedOnCurrentPublication === false) {
           health = 'BROKEN';
           details = 'Collection is hidden/unpublished';
        }
      } else if (type === 'Product') {
        if (r.status !== 'ACTIVE') {
          health = 'DRAFT';
          details = `Product status is ${r.status}`;
        }
      } else if (type === 'Page') {
        if (r.publishedOnCurrentPublication === false) {
          health = 'BROKEN';
          details = 'Page is hidden/unpublished';
        }
      }
    } else if (item.type !== 'HTTP' && !item.resource) {
       // It's a resource link (e.g. COLLECTION) but resource is null -> means deleted
       health = 'BROKEN';
       details = `Target ${item.type} was deleted or not found`;
    }

    // Create Row
    rows.push({
      id: item.id,
      title: item.title,
      type: item.type,
      url: item.url,
      parentId: parentId,
      level: level,
      path: currentPath,
      link_health: health,
      details: details,
      resource_id: item.resource?.id || null,
      target_title: item.resource?.title || null,
      metafields_count: item.metafields?.nodes?.length || 0
    });

    // Recurse
    if (item.items && item.items.length > 0) {
      for (const child of item.items) {
        traverse(child, item.id, level + 1, currentPath);
      }
    }
  }

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
      Usage: tsx audit_menu.ts [options] --all

      Options:
        --env <path>       Path to .env file
        --all              Audit ALL menus
        --out-dir <path>   Output directory (default: ../CatOutputs/MenuAudits)
    `);
    process.exit(0);
  }

  const envPath = cli.values['env'] || path.resolve('../../Research Produse/.env.txt');
  const outDir = cli.values['out-dir'] || path.resolve('../CatOutputs/MenuAudits');
  
  // Load Env
  if (!fs.existsSync(envPath)) process.exit(1);
  const env = loadEnvFile(envPath);
  const shop = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_API_TOKEN;
  if (!shop || !token) process.exit(1);

  const endpoint = `https://${shop}/admin/api/2025-10/graphql.json`;

  console.log(`Starting Advanced Menu Audit on ${shop}...`);
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. List Menus
  const menusResp = await gqlPost<any>(endpoint, token, GET_MENUS_QUERY, { first: 50 }, 30000);
  if (menusResp.errors) {
    console.error(menusResp.errors);
    process.exit(1);
  }
  const menus = menusResp.data.menus.nodes;

  console.log(`Found ${menus.length} menus. Scanning...`);

  const summary = {
    total_items: 0,
    broken_links: 0,
    empty_collections: 0, 
    draft_products: 0,
    hardcoded_links: 0
  };

  for (const menuHead of menus) {
    // console.log(`Auditing: ${menuHead.title}...`);
    
    // 2. Fetch Deep Audit Data
    const resp = await gqlPost<any>(endpoint, token, MENU_AUDIT_QUERY, { id: menuHead.id }, 60000);
    if (resp.errors) {
      console.error(`Failed to audit ${menuHead.handle}:`, JSON.stringify(resp.errors, null, 2));
      continue;
    }

    const menuData: MenuAudit = resp.data.menu;
    const auditRows = flattenAndAuditMenu(menuData);
    
    // Update Stats
    summary.total_items += auditRows.length;
    summary.broken_links += auditRows.filter(r => r.link_health === 'BROKEN').length;
    summary.empty_collections += auditRows.filter(r => r.link_health === 'EMPTY').length;
    summary.draft_products += auditRows.filter(r => r.link_health === 'DRAFT').length;
    summary.hardcoded_links += auditRows.filter(r => r.link_health === 'HARDCODED_HTTP').length;

    // Save CSV/JSONL
    const safeHandle = menuHead.handle.replace(/[^a-z0-9-_]/gi, '_');
    const outPath = path.join(outDir, `${safeHandle}_audit.jsonl`);
    
    const stream = fs.createWriteStream(outPath, { encoding: 'utf-8' });
    for (const row of auditRows) {
      stream.write(JSON.stringify(row) + '\n');
    }
    stream.end();

    await sleep(100);
  }

  console.log("\n=== AUDIT SUMMARY ===");
  console.log(`Total Menu Items Scanned: ${summary.total_items}`);
  console.log(`🔴 Broken Links (Deleted/Unpublished): ${summary.broken_links}`);
  console.log(`🟠 Empty Collections (0 Products): ${summary.empty_collections}`);
  console.log(`🟡 Draft/Hidden Products: ${summary.draft_products}`);
  console.log(`🔵 Hardcoded Internal Links (Risky): ${summary.hardcoded_links}`);
  console.log(`\nDetailed reports saved to: ${outDir}`);
}

main().catch(console.error);
