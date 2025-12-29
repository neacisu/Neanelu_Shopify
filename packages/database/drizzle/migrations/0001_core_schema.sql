CREATE TABLE "shops" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shopify_domain" text NOT NULL,
	"shopify_shop_id" bigint,
	"plan_tier" varchar(20) DEFAULT 'basic' NOT NULL,
	"api_version" varchar(20) DEFAULT '2025-10',
	"access_token_ciphertext" text NOT NULL,
	"access_token_iv" text NOT NULL,
	"access_token_tag" text NOT NULL,
	"webhook_secret" text,
	"key_version" integer DEFAULT 1 NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"timezone" varchar(50) DEFAULT 'Europe/Bucharest',
	"currency_code" varchar(3) DEFAULT 'RON',
	"settings" jsonb DEFAULT '{}'::jsonb,
	"installed_at" timestamp with time zone DEFAULT now(),
	"uninstalled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "shops_shopify_domain_unique" UNIQUE("shopify_domain"),
	CONSTRAINT "shops_shopify_shop_id_unique" UNIQUE("shopify_shop_id")
);
--> statement-breakpoint
CREATE TABLE "app_sessions" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"shop_id" uuid NOT NULL,
	"payload" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"email" text NOT NULL,
	"first_name" varchar(100),
	"last_name" varchar(100),
	"role" jsonb DEFAULT '{"admin":false}'::jsonb,
	"locale" varchar(10) DEFAULT 'en',
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shopify_products" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"shopify_gid" varchar(100) NOT NULL,
	"legacy_resource_id" bigint NOT NULL,
	"title" text NOT NULL,
	"handle" varchar(255) NOT NULL,
	"description" text,
	"description_html" text,
	"vendor" varchar(255),
	"product_type" varchar(255),
	"status" varchar(20) NOT NULL,
	"tags" text[] DEFAULT '{}'::text[],
	"is_gift_card" boolean DEFAULT false,
	"has_only_default_variant" boolean DEFAULT true,
	"has_out_of_stock_variants" boolean DEFAULT false,
	"requires_selling_plan" boolean DEFAULT false,
	"options" jsonb DEFAULT '[]'::jsonb,
	"seo" jsonb,
	"price_range" jsonb,
	"compare_at_price_range" jsonb,
	"featured_image_url" text,
	"template_suffix" varchar(100),
	"category_id" varchar(100),
	"metafields" jsonb DEFAULT '{}'::jsonb,
	"published_at" timestamp with time zone,
	"created_at_shopify" timestamp with time zone,
	"updated_at_shopify" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "shopify_variants" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"shopify_gid" varchar(100) NOT NULL,
	"legacy_resource_id" bigint NOT NULL,
	"title" varchar(255) NOT NULL,
	"sku" varchar(255),
	"barcode" varchar(100),
	"price" numeric(12, 2) NOT NULL,
	"compare_at_price" numeric(12, 2) NOT NULL,
	"currency_code" varchar(3) DEFAULT 'RON',
	"cost" numeric(12, 2),
	"weight" numeric(10, 4),
	"weight_unit" varchar(20) DEFAULT 'KILOGRAMS',
	"inventory_quantity" integer DEFAULT 0,
	"inventory_policy" varchar(20) DEFAULT 'DENY',
	"inventory_item_id" varchar(100),
	"taxable" boolean DEFAULT true,
	"tax_code" varchar(50),
	"available_for_sale" boolean DEFAULT true,
	"requires_shipping" boolean DEFAULT true,
	"requires_components" boolean DEFAULT false,
	"position" integer DEFAULT 1,
	"selected_options" jsonb DEFAULT '[]'::jsonb,
	"image_url" text,
	"metafields" jsonb DEFAULT '{}'::jsonb,
	"created_at_shopify" timestamp with time zone,
	"updated_at_shopify" timestamp with time zone,
	"synced_at" timestamp with time zone DEFAULT now(),
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "bulk_runs" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"shop_id" uuid NOT NULL,
	"operation_type" varchar(50) NOT NULL,
	"query_type" varchar(50),
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"shopify_operation_id" varchar(100),
	"api_version" varchar(20),
	"polling_url" text,
	"result_url" text,
	"idempotency_key" varchar(100),
	"cursor_state" jsonb,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"records_processed" integer DEFAULT 0,
	"bytes_processed" bigint DEFAULT 0,
	"error_message" text,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now(),
	CONSTRAINT "bulk_runs_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "bulk_steps" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"bulk_run_id" uuid NOT NULL,
	"shop_id" uuid NOT NULL,
	"step_name" varchar(100) NOT NULL,
	"step_order" integer DEFAULT 0,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"records_processed" integer DEFAULT 0,
	"records_failed" integer DEFAULT 0,
	"error_message" text,
	"error_details" jsonb,
	"created_at" timestamp with time zone DEFAULT now(),
	"updated_at" timestamp with time zone DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "app_sessions" ADD CONSTRAINT "app_sessions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_users" ADD CONSTRAINT "staff_users_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_products" ADD CONSTRAINT "shopify_products_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_variants" ADD CONSTRAINT "shopify_variants_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shopify_variants" ADD CONSTRAINT "shopify_variants_product_id_shopify_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."shopify_products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_runs" ADD CONSTRAINT "bulk_runs_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_steps" ADD CONSTRAINT "bulk_steps_bulk_run_id_bulk_runs_id_fk" FOREIGN KEY ("bulk_run_id") REFERENCES "public"."bulk_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_steps" ADD CONSTRAINT "bulk_steps_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_shops_plan" ON "shops" USING btree ("plan_tier");--> statement-breakpoint
CREATE INDEX "idx_shops_shopify_id" ON "shops" USING btree ("shopify_shop_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_shop" ON "app_sessions" USING btree ("shop_id");--> statement-breakpoint
CREATE INDEX "idx_sessions_expires" ON "app_sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_staff_shop_email" ON "staff_users" USING btree ("shop_id","email");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_products_shop_gid" ON "shopify_products" USING btree ("shop_id","shopify_gid");--> statement-breakpoint
CREATE INDEX "idx_products_shop_handle" ON "shopify_products" USING btree ("shop_id","handle");--> statement-breakpoint
CREATE INDEX "idx_products_shop_status" ON "shopify_products" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "idx_products_shop_vendor" ON "shopify_products" USING btree ("shop_id","vendor");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_variants_shop_gid" ON "shopify_variants" USING btree ("shop_id","shopify_gid");--> statement-breakpoint
CREATE INDEX "idx_variants_product" ON "shopify_variants" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "idx_variants_shop_sku" ON "shopify_variants" USING btree ("shop_id","sku");--> statement-breakpoint
CREATE INDEX "idx_variants_shop_barcode" ON "shopify_variants" USING btree ("shop_id","barcode");--> statement-breakpoint
CREATE INDEX "idx_variants_inventory" ON "shopify_variants" USING btree ("shop_id","inventory_quantity");--> statement-breakpoint
CREATE INDEX "idx_bulk_runs_shop_status" ON "bulk_runs" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "idx_bulk_runs_shopify_op" ON "bulk_runs" USING btree ("shopify_operation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_bulk_runs_idempotency" ON "bulk_runs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "idx_bulk_steps_run" ON "bulk_steps" USING btree ("bulk_run_id");--> statement-breakpoint
CREATE INDEX "idx_bulk_steps_shop_status" ON "bulk_steps" USING btree ("shop_id","status");