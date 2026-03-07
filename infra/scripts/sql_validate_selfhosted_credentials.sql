DO $$
DECLARE
  v_shop_id uuid;
  v_missing int := 0;
BEGIN
  FOR v_shop_id IN SELECT id FROM shops LOOP
    PERFORM set_config('app.current_shop_id', v_shop_id::text, false);
    IF NOT EXISTS (
      SELECT 1
      FROM shop_ai_credentials
      WHERE shop_id = v_shop_id
        AND selfhosted_enabled = true
    ) THEN
      v_missing := v_missing + 1;
      RAISE WARNING 'missing selfhosted credentials for shop %', v_shop_id;
    END IF;
  END LOOP;

  IF v_missing > 0 THEN
    RAISE EXCEPTION 'validation failed: % shops missing selfhosted credentials', v_missing;
  END IF;
END $$;
