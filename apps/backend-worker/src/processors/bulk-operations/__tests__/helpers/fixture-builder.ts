import { createWriteStream } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

export type FixtureBuildResult = Readonly<{
  filePath: string;
  products: number;
  variants: number;
  lines: number;
}>;

export async function writeBulkFixture(params: {
  products: number;
  includeInvalidLines?: boolean;
  includeSpecialChars?: boolean;
  dirPrefix?: string;
}): Promise<FixtureBuildResult> {
  const products = Math.max(1, Math.trunc(params.products));
  const includeInvalid = params.includeInvalidLines ?? true;
  const includeSpecial = params.includeSpecialChars ?? true;

  const dir = await mkdtemp(path.join(os.tmpdir(), params.dirPrefix ?? 'neanelu-bulk-fixture-'));
  const filePath = path.join(dir, `fixture-${products}.jsonl`);
  const stream = createWriteStream(filePath, { encoding: 'utf8' });

  let lines = 0;

  const writeLine = async (line: string): Promise<void> => {
    lines += 1;
    if (!stream.write(`${line}\n`)) {
      await new Promise<void>((resolve) => stream.once('drain', resolve));
    }
  };

  for (let i = 1; i <= products; i += 1) {
    const productId = `gid://shopify/Product/${i}`;
    const variantId = `gid://shopify/ProductVariant/${i}`;
    const title = includeSpecial && i === 1 ? 'Prod "Special" ✓' : `Product ${i}`;

    await writeLine(
      JSON.stringify({
        __typename: 'Product',
        id: productId,
        title,
        handle: `product-${i}`,
        vendor: 'FixtureCo',
        productType: 'Fixture',
        status: 'ACTIVE',
        tags: ['fixture', i % 2 === 0 ? 'even' : 'odd'],
        createdAt: '2025-01-01T00:00:00Z',
        updatedAt: '2025-01-02T00:00:00Z',
        nested: { key: `value-${i}` },
      })
    );

    await writeLine(
      JSON.stringify({
        __typename: 'ProductVariant',
        id: variantId,
        __parentId: productId,
        title: `Variant ${i}`,
        sku: `SKU-${i}`,
        price: '1.00',
        compareAtPrice: '2.00',
        inventoryQuantity: i,
      })
    );

    if (includeInvalid && i === 1) {
      await writeLine('not-json-line');
    }
  }

  await new Promise<void>((resolve, reject) => {
    stream.end(() => resolve());
    stream.on('error', reject);
  });

  return {
    filePath,
    products,
    variants: products,
    lines,
  } as const;
}
