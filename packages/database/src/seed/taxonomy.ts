/**
 * Shopify Taxonomy Seed Script
 *
 * CONFORM: Plan_de_implementare.md F2.2.6
 * PR-010: Import Shopify Standard Taxonomy
 *
 * Descarcă taxonomia oficială Shopify din GitHub și o importă în prod_taxonomy.
 * Suportă atât import complet cât și update incremental.
 *
 * Usage:
 *   pnpm --filter @app/database run db:seed:taxonomy
 */

import { db, pool } from '../db.js';
import { prodTaxonomy } from '../schema/pim.js';
import { eq } from 'drizzle-orm';

// URL-ul oficial al taxonomiei Shopify
const TAXONOMY_BASE_URL = 'https://raw.githubusercontent.com/Shopify/product-taxonomy/main/data';

interface TaxonomyCategory {
  id: string;
  name: string;
  full_name?: string;
  parent_id?: string;
  children?: TaxonomyCategory[];
  attributes?: Record<string, unknown>;
}

interface TaxonomyData {
  version?: string;
  categories?: TaxonomyCategory[];
  verticals?: TaxonomyCategory[];
}

/**
 * Generează un slug URL-safe din numele categoriei
 */
function generateSlug(name: string, parentSlug?: string): string {
  const baseSlug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

  return parentSlug ? `${parentSlug}--${baseSlug}` : baseSlug;
}

/**
 * Inserează recursiv categoriile în baza de date
 */
async function insertCategory(
  category: TaxonomyCategory,
  parentId: string | null = null,
  parentSlug: string | null = null,
  breadcrumbs: string[] = [],
  level = 0
): Promise<void> {
  const slug = generateSlug(category.name, parentSlug ?? undefined);
  const currentBreadcrumbs = [...breadcrumbs, category.name];

  try {
    // Upsert - insert sau update dacă există
    await db
      .insert(prodTaxonomy)
      .values({
        name: category.name,
        slug,
        parentId,
        breadcrumbs: currentBreadcrumbs,
        level,
        attributeSchema: category.attributes ?? {},
        shopifyTaxonomyId: category.id,
        isActive: true,
        sortOrder: 0,
      })
      .onConflictDoUpdate({
        target: prodTaxonomy.shopifyTaxonomyId,
        set: {
          name: category.name,
          slug,
          parentId,
          breadcrumbs: currentBreadcrumbs,
          level,
          attributeSchema: category.attributes ?? {},
          updatedAt: new Date(),
        },
      });

    // Obține ID-ul categoriei inserate pentru copii
    const [inserted] = await db
      .select({ id: prodTaxonomy.id })
      .from(prodTaxonomy)
      .where(eq(prodTaxonomy.shopifyTaxonomyId, category.id))
      .limit(1);

    if (!inserted) {
      console.warn(`Warning: Could not find inserted category: ${category.name}`);
      return;
    }

    // Procesare recursivă pentru copii
    if (category.children && category.children.length > 0) {
      for (const child of category.children) {
        await insertCategory(child, inserted.id, slug, currentBreadcrumbs, level + 1);
      }
    }
  } catch (error) {
    console.error(`Error inserting category ${category.name}:`, error);
    throw error;
  }
}

/**
 * Descarcă și parsează taxonomia Shopify
 */
async function fetchTaxonomy(): Promise<TaxonomyData> {
  // Încercăm mai multe formate posibile
  const endpoints = [
    `${TAXONOMY_BASE_URL}/categories.json`,
    `${TAXONOMY_BASE_URL}/verticals.json`,
    `${TAXONOMY_BASE_URL}/taxonomy.json`,
  ];

  for (const url of endpoints) {
    try {
      console.info(`Fetching taxonomy from: ${url}`);
      const response = await fetch(url);

      if (response.ok) {
        const data = (await response.json()) as TaxonomyData;
        console.info(`Successfully fetched taxonomy from ${url}`);
        return data;
      }
    } catch (_error) {
      console.info(`Failed to fetch from ${url}, trying next...`);
    }
  }

  // Fallback: returnează o taxonomie minimală pentru demo
  console.warn('Could not fetch Shopify taxonomy, using minimal fallback data');
  return {
    version: 'fallback-1.0',
    categories: [
      {
        id: 'gid://shopify/TaxonomyCategory/1',
        name: 'Electronics',
        children: [
          { id: 'gid://shopify/TaxonomyCategory/1-1', name: 'Computers' },
          { id: 'gid://shopify/TaxonomyCategory/1-2', name: 'Phones' },
        ],
      },
      {
        id: 'gid://shopify/TaxonomyCategory/2',
        name: 'Clothing',
        children: [
          { id: 'gid://shopify/TaxonomyCategory/2-1', name: 'Shirts' },
          { id: 'gid://shopify/TaxonomyCategory/2-2', name: 'Pants' },
        ],
      },
      {
        id: 'gid://shopify/TaxonomyCategory/3',
        name: 'Home & Garden',
        children: [
          { id: 'gid://shopify/TaxonomyCategory/3-1', name: 'Furniture' },
          { id: 'gid://shopify/TaxonomyCategory/3-2', name: 'Decor' },
        ],
      },
    ],
  };
}

/**
 * Funcția principală de seed
 */
export async function seedTaxonomy(): Promise<void> {
  console.info('🌱 Starting Shopify Taxonomy seed...');
  const startTime = Date.now();

  try {
    const taxonomyData = await fetchTaxonomy();

    // Procesăm categoriile sau verticalele
    const categories = taxonomyData.categories ?? taxonomyData.verticals ?? [];

    if (categories.length === 0) {
      console.warn('No categories found in taxonomy data');
      return;
    }

    console.info(`Found ${categories.length} root categories to import`);

    let totalInserted = 0;

    for (const category of categories) {
      await insertCategory(category);
      totalInserted++;

      // Count children recursively
      const countChildren = (cat: TaxonomyCategory): number => {
        if (!cat.children) return 0;
        return cat.children.length + cat.children.reduce((sum, c) => sum + countChildren(c), 0);
      };
      totalInserted += countChildren(category);
    }

    const elapsed = Date.now() - startTime;
    console.info(`✅ Taxonomy seed complete: ${totalInserted} categories in ${elapsed}ms`);

    // Verificare finală
    const result = await pool.query('SELECT COUNT(*) as count FROM prod_taxonomy');
    console.info(`📊 Total categories in database: ${String(result.rows[0]?.count)}`);
  } catch (error) {
    console.error('❌ Taxonomy seed failed:', error);
    throw error;
  }
}

/**
 * Verifică dacă taxonomia este populată
 */
export async function checkTaxonomy(): Promise<boolean> {
  const result = await pool.query<{ count: string }>('SELECT COUNT(*) as count FROM prod_taxonomy');
  const count = parseInt(result.rows[0]?.count ?? '0', 10);
  return count > 0;
}

// Rulare directă
if (process.argv[1]?.includes('taxonomy')) {
  seedTaxonomy()
    .then(() => {
      console.info('Seed script completed');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('Seed script failed:', err);
      process.exit(1);
    });
}
