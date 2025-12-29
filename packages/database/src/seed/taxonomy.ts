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

// URL-ul oficial al taxonomiei Shopify - distribuțiile în format JSON
// Locația corectă: dist/<locale>/categories.json
const TAXONOMY_URL =
  'https://raw.githubusercontent.com/Shopify/product-taxonomy/main/dist/en/categories.json';

/**
 * Structura datelor din Shopify Taxonomy
 */
interface ShopifyTaxonomyChild {
  id: string;
  name: string;
}

interface ShopifyAttribute {
  id: string;
  name: string;
  handle: string;
  description: string;
  extended: boolean;
}

interface ShopifyCategory {
  id: string;
  level: number;
  name: string;
  full_name: string;
  parent_id: string | null;
  attributes: ShopifyAttribute[];
  children: ShopifyTaxonomyChild[];
  ancestors: ShopifyTaxonomyChild[];
}

interface ShopifyVertical {
  name: string;
  prefix: string;
  categories: ShopifyCategory[];
}

interface ShopifyTaxonomyData {
  version: string;
  verticals: ShopifyVertical[];
}

/**
 * Generează un slug URL-safe din full_name categoriei
 */
function generateSlug(fullName: string): string {
  return fullName
    .toLowerCase()
    .replace(/ > /g, '--')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Parsează breadcrumbs din full_name (ex: "Animals & Pet Supplies > Pet Supplies > Cat Supplies")
 */
function parseBreadcrumbs(fullName: string): string[] {
  return fullName.split(' > ').map((s) => s.trim());
}

/**
 * Inserează toate categoriile în baza de date
 * Folosim o abordare în 2 faze:
 * 1. Inserăm toate categoriile fără parent_id
 * 2. Actualizăm parent_id după ce toate sunt inserate
 */
async function insertCategories(categories: ShopifyCategory[]): Promise<number> {
  let insertedCount = 0;
  const categoryMap = new Map<string, string>(); // shopify_id -> db_id

  console.info(`📦 Procesare ${categories.length} categorii...`);

  // Faza 1: Inserează toate categoriile (fără parent_id inițial)
  for (const category of categories) {
    const slug = generateSlug(category.full_name);
    const breadcrumbs = parseBreadcrumbs(category.full_name);

    try {
      await db
        .insert(prodTaxonomy)
        .values({
          name: category.name,
          slug,
          parentId: null, // Va fi actualizat în faza 2
          breadcrumbs,
          level: category.level,
          attributeSchema: {
            attributes: category.attributes.map((attr) => ({
              id: attr.id,
              name: attr.name,
              handle: attr.handle,
              description: attr.description,
            })),
          },
          shopifyTaxonomyId: category.id,
          isActive: true,
          sortOrder: 0,
        })
        .onConflictDoUpdate({
          target: prodTaxonomy.shopifyTaxonomyId,
          set: {
            name: category.name,
            slug,
            breadcrumbs,
            level: category.level,
            attributeSchema: {
              attributes: category.attributes.map((attr) => ({
                id: attr.id,
                name: attr.name,
                handle: attr.handle,
                description: attr.description,
              })),
            },
            updatedAt: new Date(),
          },
        });

      // Obține ID-ul din DB
      const [inserted] = await db
        .select({ id: prodTaxonomy.id })
        .from(prodTaxonomy)
        .where(eq(prodTaxonomy.shopifyTaxonomyId, category.id))
        .limit(1);

      if (inserted) {
        categoryMap.set(category.id, inserted.id);
        insertedCount++;
      }

      // Progress log la fiecare 500 categorii
      if (insertedCount % 500 === 0) {
        console.info(`   ... ${insertedCount} categorii procesate`);
      }
    } catch (error) {
      console.error(`Eroare la inserarea categoriei ${category.name}:`, error);
      // Continuă cu următoarea categorie
    }
  }

  // Faza 2: Actualizează parent_id pentru toate categoriile
  console.info('🔗 Actualizare relații părinte-copil...');
  let linksUpdated = 0;

  for (const category of categories) {
    if (category.parent_id) {
      const dbId = categoryMap.get(category.id);
      const parentDbId = categoryMap.get(category.parent_id);

      if (dbId && parentDbId) {
        try {
          await db
            .update(prodTaxonomy)
            .set({ parentId: parentDbId, updatedAt: new Date() })
            .where(eq(prodTaxonomy.id, dbId));
          linksUpdated++;
        } catch (error) {
          console.error(`Eroare la linkuire ${category.id} -> ${category.parent_id}:`, error);
        }
      }
    }
  }

  console.info(`   ✅ ${linksUpdated} relații parent-child actualizate`);
  return insertedCount;
}

/**
 * Descarcă și parsează taxonomia Shopify
 */
async function fetchTaxonomy(): Promise<ShopifyTaxonomyData | null> {
  console.info(`📥 Descărcare taxonomie Shopify din: ${TAXONOMY_URL}`);

  try {
    const response = await fetch(TAXONOMY_URL, {
      headers: {
        'User-Agent': 'Neanelu-Shopify-App/1.0',
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`❌ HTTP error: ${response.status} ${response.statusText}`);
      return null;
    }

    const data = (await response.json()) as ShopifyTaxonomyData;
    console.info(`✅ Descărcat: versiune ${data.version}, ${data.verticals.length} verticale`);
    return data;
  } catch (error) {
    console.error('❌ Eroare la descărcare:', error);
    return null;
  }
}

/**
 * Funcția principală de seed
 */
export async function seedTaxonomy(): Promise<void> {
  console.info('🌱 Pornire import Shopify Taxonomy...');
  const startTime = Date.now();

  try {
    const taxonomyData = await fetchTaxonomy();

    if (!taxonomyData) {
      console.error('❌ Nu s-a putut descărca taxonomia. Import anulat.');
      return;
    }

    // Colectăm toate categoriile din toate verticalele
    const allCategories: ShopifyCategory[] = [];

    for (const vertical of taxonomyData.verticals) {
      console.info(`📁 Vertical: ${vertical.name} (${vertical.categories.length} categorii)`);
      allCategories.push(...vertical.categories);
    }

    console.info(`\n📊 Total: ${allCategories.length} categorii de importat\n`);

    const insertedCount = await insertCategories(allCategories);

    const elapsed = Date.now() - startTime;
    console.info(
      `\n✅ Import complet: ${insertedCount} categorii în ${(elapsed / 1000).toFixed(1)}s`
    );

    // Verificare finală
    const result = await pool.query('SELECT COUNT(*) as count FROM prod_taxonomy');
    console.info(`📊 Total categorii în baza de date: ${String(result.rows[0]?.count)}`);
  } catch (error) {
    console.error('❌ Import eșuat:', error);
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
      console.info('Script seed terminat');
      process.exit(0);
    })
    .catch((err: unknown) => {
      console.error('Script seed eșuat:', err);
      process.exit(1);
    });
}
