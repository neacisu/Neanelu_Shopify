import { describe, it, before, after } from 'node:test';
import assert from 'node:assert';
import { pool, setTenantContext } from '../db.ts';

const shopA = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const shopB = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

void describe('RLS tenant isolation', () => {
  before(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'test_rls') THEN
          CREATE ROLE test_rls;
        END IF;
      END $$;`);

      await client.query(
        `INSERT INTO shops (id, shopify_domain, access_token_ciphertext, access_token_iv, access_token_tag, scopes)
         VALUES ($1, 'a.myshopify.com', '\\x00', '\\x00', '\\x00', '{}'),
                ($2, 'b.myshopify.com', '\\x00', '\\x00', '\\x00', '{}')
         ON CONFLICT (shopify_domain) DO NOTHING`,
        [shopA, shopB]
      );

      await client.query('GRANT SELECT ON shopify_products TO test_rls');

      await setTenantContext(client, shopA);
      await client.query(
        `INSERT INTO shopify_products (id, shop_id, shopify_gid, legacy_resource_id, title, handle, status)
         VALUES (uuidv7(), $1, 'gid://shopify/Product/1', 1, 'Prod A1', 'prod-a1', 'ACTIVE')
         ON CONFLICT DO NOTHING`,
        [shopA]
      );

      await setTenantContext(client, shopB);
      await client.query(
        `INSERT INTO shopify_products (id, shop_id, shopify_gid, legacy_resource_id, title, handle, status)
         VALUES (uuidv7(), $1, 'gid://shopify/Product/2', 2, 'Prod B1', 'prod-b1', 'ACTIVE')
         ON CONFLICT DO NOTHING`,
        [shopB]
      );

      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  after(async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('DELETE FROM shopify_products WHERE shop_id IN ($1, $2)', [shopA, shopB]);
      await client.query('DELETE FROM shops WHERE id IN ($1, $2)', [shopA, shopB]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await pool.end();
  });

  void it('returns zero rows without tenant context', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      const res = await client.query('SELECT * FROM shopify_products');
      await client.query('COMMIT');
      assert.strictEqual(res.rows.length, 0);
    } finally {
      client.release();
    }
  });

  void it('isolates data between tenants', async () => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE test_rls');
      await setTenantContext(client, shopA);
      const resA = await client.query('SELECT * FROM shopify_products');

      await setTenantContext(client, shopB);
      const resB = await client.query('SELECT * FROM shopify_products');
      await client.query('COMMIT');

      assert.ok(resA.rows.length >= 1);
      assert.ok(resB.rows.length >= 1);
      assert.ok(resA.rows.every((r) => r.shop_id === shopA));
      assert.ok(resB.rows.every((r) => r.shop_id === shopB));
    } finally {
      client.release();
    }
  });
});
