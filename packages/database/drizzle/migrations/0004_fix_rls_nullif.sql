-- Patch RLS policies to treat empty current_setting as NULL to avoid UUID cast errors
ALTER POLICY tenant_isolation_staff_users ON "staff_users"
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
ALTER POLICY tenant_isolation_app_sessions ON "app_sessions"
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
ALTER POLICY tenant_isolation_products ON "shopify_products"
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
ALTER POLICY tenant_isolation_variants ON "shopify_variants"
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
ALTER POLICY tenant_isolation_bulk_runs ON "bulk_runs"
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
ALTER POLICY tenant_isolation_bulk_steps ON "bulk_steps"
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
ALTER POLICY tenant_isolation_shopify_tokens ON "shopify_tokens"
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
