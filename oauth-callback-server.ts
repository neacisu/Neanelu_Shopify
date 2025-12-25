import http from 'http';
import url from 'url';
import 'dotenv/config';

const PORT = 65001;
const CLIENT_ID = process.env['SHOPIFY_CLIENT_ID'];
const SHOP_DOMAIN = process.env['SHOPIFY_SHOP_DOMAIN'];
const REDIRECT_URI = process.env['SHOPIFY_REDIRECT_URI'];

if (!CLIENT_ID || !SHOP_DOMAIN || !REDIRECT_URI) {
  console.error(
    'Missing required environment variables (SHOPIFY_CLIENT_ID, SHOPIFY_SHOP_DOMAIN, SHOPIFY_REDIRECT_URI)'
  );
  process.exit(1);
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url ?? '', true);

  if (parsedUrl.pathname === '/auth/callback') {
    const code = parsedUrl.query['code'];

    if (code && typeof code === 'string') {
      console.info('=== SHOPIFY OAUTH CODE RECEIVED ===');
      console.info('Code:', code);
      console.info('Now run this command to get access token:');
      console.info(
        `curl -X POST https://${SHOP_DOMAIN}/admin/oauth/access_token -d 'client_id=${CLIENT_ID}&client_secret=${process.env['SHOPIFY_CLIENT_SECRET']}&code=${code}'`
      );

      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OAuth code received! Check server console for next steps.');
    } else {
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('No code received');
    }
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
  }
});

server.listen(PORT, 'localhost', () => {
  console.info(`OAuth callback server running on http://localhost:${PORT}`);
  console.info('Access this URL in your browser:');

  // Note: The scope is hardcoded from the original script as it contains a long list of specific permissions
  const scope =
    'read_all_orders%2Cread_analytics%2Cread_app_proxy%2Cwrite_app_proxy%2Cread_apps%2Cread_assigned_fulfillment_orders%2Cwrite_assigned_fulfillment_orders%2Cread_audit_events%2Cread_customer_events%2Cread_cart_transforms%2Cwrite_cart_transforms%2Cread_all_cart_transforms%2Cread_validations%2Cwrite_validations%2Cread_cash_tracking%2Cread_channels%2Cwrite_channels%2Cread_checkout_branding_settings%2Cwrite_checkout_branding_settings%2Cwrite_checkouts%2Cread_checkouts%2Cread_companies%2Cwrite_companies%2Cread_custom_fulfillment_services%2Cwrite_custom_fulfillment_services%2Cread_custom_pixels%2Cwrite_custom_pixels%2Cread_customers%2Cwrite_customers%2Cread_customer_data_erasure%2Cwrite_customer_data_erasure%2Cread_customer_payment_methods%2Cread_customer_merge%2Cwrite_customer_merge%2Cread_delivery_customizations%2Cwrite_delivery_customizations%2Cread_price_rules%2Cwrite_price_rules%2Cread_discounts%2Cwrite_discounts%2Cread_discounts_allocator_functions%2Cwrite_discounts_allocator_functions%2Cread_discovery%2Cwrite_discovery%2Cwrite_draft_orders%2Cread_draft_orders%2Cread_files%2Cwrite_files%2Cread_fulfillment_constraint_rules%2Cwrite_fulfillment_constraint_rules%2Cread_fulfillments%2Cwrite_fulfillments%2Cread_gift_card_transactions%2Cwrite_gift_card_transactions%2Cread_gift_cards%2Cwrite_gift_cards%2Cwrite_inventory%2Cread_inventory%2Cwrite_inventory_shipments%2Cread_inventory_shipments%2Cwrite_inventory_shipments_received_items%2Cread_inventory_shipments_received_items%2Cwrite_inventory_transfers%2Cread_inventory_transfers%2Cread_legal_policies%2Cwrite_legal_policies%2Cread_delivery_option_generators%2Cwrite_delivery_option_generators%2Cread_locales%2Cwrite_locales%2Cwrite_locations%2Cread_locations%2Cread_marketing_integrated_campaigns%2Cwrite_marketing_integrated_campaigns%2Cwrite_marketing_events%2Cread_marketing_events%2Cread_markets%2Cwrite_markets%2Cread_markets_home%2Cwrite_markets_home%2Cread_merchant_managed_fulfillment_orders%2Cwrite_merchant_managed_fulfillment_orders%2Cread_metaobject_definitions%2Cwrite_metaobject_definitions%2Cread_metaobjects%2Cwrite_metaobjects%2Cread_online_store_navigation%2Cwrite_online_store_navigation%2Cread_online_store_pages%2Cwrite_online_store_pages%2Cwrite_order_edits%2Cread_order_edits%2Cread_orders%2Cwrite_orders%2Cwrite_packing_slip_templates%2Cread_packing_slip_templates%2Cwrite_payment_mandate%2Cread_payment_mandate%2Cread_payment_terms%2Cwrite_payment_terms%2Cread_payment_customizations%2Cwrite_payment_customizations%2Cread_pixels%2Cwrite_pixels%2Cread_privacy_settings%2Cwrite_privacy_settings%2Cread_product_feeds%2Cwrite_product_feeds%2Cread_product_listings%2Cwrite_product_listings%2Cread_products%2Cwrite_products%2Cread_publications%2Cwrite_publications%2Cread_purchase_options%2Cwrite_purchase_options%2Cwrite_reports%2Cread_reports%2Cread_resource_feedbacks%2Cwrite_resource_feedbacks%2Cread_returns%2Cwrite_returns%2Cread_script_tags%2Cwrite_script_tags%2Cread_shopify_payments_provider_accounts_sensitive%2Cread_shipping%2Cwrite_shipping%2Cread_shopify_payments_accounts%2Cread_shopify_payments_payouts%2Cread_shopify_payments_bank_accounts%2Cread_shopify_payments_disputes%2Cwrite_shopify_payments_disputes%2Cread_content%2Cwrite_content%2Cread_store_credit_account_transactions%2Cwrite_store_credit_account_transactions%2Cread_store_credit_accounts%2Cwrite_own_subscription_contracts%2Cread_own_subscription_contracts%2Cwrite_theme_code%2Cread_themes%2Cwrite_themes%2Cread_third_party_fulfillment_orders%2Cwrite_third_party_fulfillment_orders%2Cread_translations%2Cwrite_translations%2Ccustomer_read_companies%2Ccustomer_write_companies%2Ccustomer_write_customers%2Ccustomer_read_customers%2Ccustomer_read_draft_orders%2Ccustomer_read_markets%2Ccustomer_read_metaobjects%2Ccustomer_read_orders%2Ccustomer_write_orders%2Ccustomer_read_quick_sale%2Ccustomer_write_quick_sale%2Ccustomer_read_store_credit_account_transactions%2Ccustomer_read_store_credit_accounts%2Ccustomer_write_own_subscription_contracts%2Ccustomer_read_own_subscription_contracts%2Cunauthenticated_write_bulk_operations%2Cunauthenticated_read_bulk_operations%2Cunauthenticated_read_bundles%2Cunauthenticated_write_checkouts%2Cunauthenticated_read_checkouts%2Cunauthenticated_write_customers%2Cunauthenticated_read_customers%2Cunauthenticated_read_customer_tags%2Cunauthenticated_read_metaobjects%2Cunauthenticated_read_product_pickup_locations%2Cunauthenticated_read_product_inventory%2Cunauthenticated_read_product_listings%2Cunauthenticated_read_product_tags%2Cunauthenticated_read_selling_plans%2Cunauthenticated_read_shop_pay_installments_pricing%2Cunauthenticated_read_content';

  console.info(
    `https://${SHOP_DOMAIN}/admin/oauth/authorize?client_id=${CLIENT_ID}&scope=${scope}&redirect_uri=${REDIRECT_URI}`
  );
});
