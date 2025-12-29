-- Enable and enforce RLS on multi-tenant tables
ALTER TABLE "staff_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "staff_users" FORCE ROW LEVEL SECURITY;
ALTER TABLE "app_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "app_sessions" FORCE ROW LEVEL SECURITY;
ALTER TABLE "shopify_products" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shopify_products" FORCE ROW LEVEL SECURITY;
ALTER TABLE "shopify_variants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shopify_variants" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bulk_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bulk_runs" FORCE ROW LEVEL SECURITY;
ALTER TABLE "bulk_steps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bulk_steps" FORCE ROW LEVEL SECURITY;
ALTER TABLE "shopify_tokens" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "shopify_tokens" FORCE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Policies: tenant isolation via app.current_shop_id
CREATE POLICY tenant_isolation_staff_users ON "staff_users"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_isolation_app_sessions ON "app_sessions"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_isolation_products ON "shopify_products"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_isolation_variants ON "shopify_variants"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_isolation_bulk_runs ON "bulk_runs"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_isolation_bulk_steps ON "bulk_steps"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
--> statement-breakpoint
CREATE POLICY tenant_isolation_shopify_tokens ON "shopify_tokens"
  USING (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  )
  WITH CHECK (
    shop_id = COALESCE(
      NULLIF(current_setting('app.current_shop_id', true), '')::uuid,
      '00000000-0000-0000-0000-000000000000'::uuid
    )
  );
