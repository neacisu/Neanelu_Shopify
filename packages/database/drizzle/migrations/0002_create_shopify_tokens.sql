CREATE TABLE "shopify_tokens" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "shop_id" uuid NOT NULL REFERENCES "public"."shops"("id") ON DELETE cascade,
  "access_token_ciphertext" bytea NOT NULL,
  "access_token_iv" bytea NOT NULL,
  "access_token_tag" bytea NOT NULL,
  "key_version" integer NOT NULL DEFAULT 1,
  "scopes" text[] NOT NULL DEFAULT '{}'::text[],
  "created_at" timestamptz DEFAULT now(),
  "rotated_at" timestamptz
);
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shopify_tokens_shop" ON "shopify_tokens" USING btree ("shop_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "idx_shopify_tokens_shop_key" ON "shopify_tokens" USING btree ("shop_id","key_version");
