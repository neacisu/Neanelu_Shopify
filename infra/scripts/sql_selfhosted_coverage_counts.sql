DO $$
DECLARE
  v_shop_id uuid;
  v_total int := 0;
  v_with_selfhosted int := 0;
BEGIN
  FOR v_shop_id IN SELECT id FROM shops LOOP
    v_total := v_total + 1;
    PERFORM set_config('app.current_shop_id', v_shop_id::text, false);
    IF EXISTS (
      SELECT 1
      FROM shop_ai_credentials
      WHERE shop_id = v_shop_id
        AND selfhosted_enabled = true
    ) THEN
      v_with_selfhosted := v_with_selfhosted + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'shops_total=% shops_with_selfhosted=%', v_total, v_with_selfhosted;
END $$;
