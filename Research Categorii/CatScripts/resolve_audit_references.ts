import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile, gqlPost, writeJsonFile, parseCli, sleep } from './common.js';

// ---- Queries ----

const NODES_AUDIT_QUERY = `
query GetAuditNodes($ids: [ID!]!) {
  nodes(ids: $ids) {
    ... on Collection {
      __typename
      id
      title
      productsCount { count }
    }
    ... on Product {
      __typename
      id
      title
      status
      totalInventory
    }
    ... on Page {
      __typename
      id
      title
      bodySummary
    }
    ... on Shop { 
      # Fallback for Homepage link
      __typename
      id 
    }
  }
}
`;

// ---- Types ----

type FlatAuditRow = {
  id: string; // Menu Item ID
  title: string;
  type: string;
  url: string | null;
  parentId: string | null;
  level: number;
  path: string;
  resource_id: string | null;
  resourceId?: string; // from raw input JSON
  target_title: string | null;
  
  // Audit columns to append
  link_health: 'OK' | 'BROKEN' | 'EMPTY' | 'DRAFT' | 'HARDCODED_HTTP' | 'PENDING';
  details: string;
};

type ResourceNode = {
  __typename: string;
  id: string;
  title?: string;
  productsCount?: { count: number };
  status?: string;
  totalInventory?: number;
  // Removed publishedOnCurrentPublication
};

// ---- Main ----

async function main() {
  const cli = parseCli(process.argv.slice(2));
  
  if (cli.flags.has('help')) {
    console.log(`
      Usage: tsx resolve_audit_references.ts [options]

      Options:
        --env <path>       Path to .env file
        --in-dir <path>    Directory with *flat.jsonl files (default: ../CatOutputs/AllMenus)
        --out-dir <path>   Output directory (default: ../CatOutputs/ResolvedAudits)
    `);
    process.exit(0);
  }

  const envPath = cli.values['env'] || path.resolve('../../.env');
  const inDir = cli.values['in-dir'] || path.resolve('../CatOutputs/AllMenus');
  const outDir = cli.values['out-dir'] || path.resolve('../CatOutputs/ResolvedAudits');
  
  // Load Env
  if (!fs.existsSync(envPath)) {
    console.error(`Env not found: ${envPath}`);
    process.exit(1);
  }
  const env = loadEnvFile(envPath);
  const shop = env.SHOPIFY_SHOP_DOMAIN;
  const token = env.SHOPIFY_ADMIN_API_TOKEN;
  const endpoint = `https://${shop}/admin/api/2025-10/graphql.json`;

  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  // 1. Scan Input Files
  const files = fs.readdirSync(inDir).filter(f => f.endsWith('_flat.jsonl'));
  console.log(`Found ${files.length} menu files to resolve references for.`);

  for (const file of files) {
    console.log(`\nResolving: ${file}...`);
    const filePath = path.join(inDir, file);
    
    // Read JSONL
    const content = fs.readFileSync(filePath, 'utf-8');
    const rows: FlatAuditRow[] = content
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const r = JSON.parse(line);
        // Initialize audit fields
        return { ...r, link_health: 'PENDING', details: 'Scanning...' };
      });

    // Extract Unique Resource IDs
    const resourceMap = new Map<string, ResourceNode | null>();
    rows.forEach(r => {
      const rid = r.resourceId || r.resource_id;
      if (rid) resourceMap.set(rid, null);
    });

    const allIds = Array.from(resourceMap.keys());
    console.log(`  -> ${allIds.length} unique resources to resolve.`);

    // Batch Fetch
    const BATCH_SIZE = 100;
    for (let i = 0; i < allIds.length; i += BATCH_SIZE) {
      const batchIds = allIds.slice(i, i + BATCH_SIZE);
      const resp = await gqlPost<any>(endpoint, token, NODES_AUDIT_QUERY, { ids: batchIds }, 60000);
      
      if (resp.errors) {
        console.error(`Error fetching batch ${i}:`, JSON.stringify(resp.errors));
        continue;
      }
      
      const fetchedNodes: ResourceNode[] = resp.data.nodes || [];
      
      // Store in map
      for (const node of fetchedNodes) {
        if (node && node.id) {
          resourceMap.set(node.id, node);
        }
      }
      
      await sleep(100);
    }

    // Apply Audit Logic
    for (const row of rows) {
      const idToCheck = row.resourceId || row.resource_id;

      // 1. Resource Logic
      if (idToCheck) { 
        const node = resourceMap.get(idToCheck);
        
        if (!node) {
          if (idToCheck) {
             row.link_health = 'BROKEN';
             row.details = 'Resource deleted or not found via API';
          }
        } else {
          row.target_title = node.title || row.target_title;
          
          if (node.__typename === 'Collection') {
             const count = node.productsCount?.count ?? 0;
             if (count === 0) {
               row.link_health = 'EMPTY';
               row.details = 'Collection is empty (0 products)';
             } else {
               row.link_health = 'OK';
               row.details = `Valid (${count} products)`;
             }
          } else if (node.__typename === 'Product') {
             if (node.status !== 'ACTIVE') {
               row.link_health = 'DRAFT';
               row.details = `Product status is ${node.status}`;
             } else {
               row.link_health = 'OK';
               row.details = 'Active Product';
             }
          } else {
             row.link_health = 'OK';
             row.details = `Valid ${node.__typename}`;
          }
        }
      } 
      // 2. HTTP Logic 
      else if (row.type === 'HTTP') {
         if (row.url?.includes('neanelu.ro') || row.url?.includes('myshopify.com')) {
            row.link_health = 'HARDCODED_HTTP';
            row.details = 'Manual link to internal page (risky)';
         } else if (!row.url || row.url === '#') {
            row.link_health = 'OK';
            row.details = 'Header / No Link';
         } else {
            row.link_health = 'OK';
            row.details = 'External / Manual Link';
         }
      } 
      else {
        row.link_health = 'OK';
        row.details = `Type ${row.type}`;
      }
    }

    // Save Resolved Audit as Proper JSON
    const outName = file.replace('_flat.jsonl', '_resolved.json');
    const outPath = path.join(outDir, outName);
    
    // Using writeJsonFile helper from common.ts which uses JSON.stringify(..., null, 2)
    writeJsonFile(outPath, rows);
    
    // Calc stats
    let broken = 0;
    for (const r of rows) {
      if (r.link_health === 'BROKEN' || r.link_health === 'EMPTY') broken++;
    }
    
    console.log(`  -> Saved ${outPath}`);
    if (broken > 0) console.log(`     ⚠️  Found ${broken} issues in this menu.`);
  }
}

main().catch(console.error);
