-- Seller accounts for the QR menu (menu.html), step 1 of the marketplace build.
--
-- A seller signs up with Supabase Auth (email + password; name, username and phone in user metadata),
-- then register_qr_seller() creates their public.qr_sellers row. The username is their permanent code:
-- the QR points at menu.html#s=<username> and the seller can edit from any phone after signing in —
-- no edit key needed. Anonymous publishing with an edit key (20261003 migration) keeps working.
-- Bank details live on the menu and are shown to customers at checkout.
--
-- Requires Supabase Auth (auth.users / auth.uid()). Apply after 20261003000000_qr_menus.sql.

CREATE TABLE IF NOT EXISTS public.qr_sellers (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL UNIQUE
    CHECK (username ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(username) BETWEEN 3 AND 24),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  phone TEXT NOT NULL DEFAULT '' CHECK (phone = '' OR phone ~ '^[0-9]{7,15}$'),
  phone_verified_at TIMESTAMPTZ,          -- set by the SMS verification step once Termii/Twilio is connected
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.qr_sellers ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qr_sellers FROM PUBLIC, anon, authenticated;

ALTER TABLE public.qr_menus ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.qr_menus ADD COLUMN IF NOT EXISTS bank_name TEXT NOT NULL DEFAULT '' CHECK (char_length(bank_name) <= 40);
ALTER TABLE public.qr_menus ADD COLUMN IF NOT EXISTS account_name TEXT NOT NULL DEFAULT '' CHECK (char_length(account_name) <= 60);
ALTER TABLE public.qr_menus ADD COLUMN IF NOT EXISTS account_number TEXT NOT NULL DEFAULT '' CHECK (account_number = '' OR account_number ~ '^[0-9]{10}$');
CREATE INDEX IF NOT EXISTS qr_menus_owner_idx ON public.qr_menus (owner_id);

-- Shared shape for a menu row as the page consumes it (also used by get_qr_menu and my_qr_seller).
CREATE OR REPLACE FUNCTION public.qr_menu_json(m public.qr_menus)
RETURNS JSONB
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'slug', m.slug, 'name', m.name, 'whatsapp', m.whatsapp, 'tagline', m.tagline,
    'pickup', m.pickup, 'delivery', m.delivery, 'categories', m.categories,
    'bank', jsonb_build_object('bankName', m.bank_name, 'accountName', m.account_name, 'accountNumber', m.account_number),
    'verified', m.owner_id IS NOT NULL,
    'version', m.version, 'updated_at', m.updated_at
  );
$$;

CREATE OR REPLACE FUNCTION public.get_qr_menu(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT public.qr_menu_json(m) FROM public.qr_menus m WHERE m.slug = lower(btrim(coalesce(p_slug, '')));
$$;

-- Create (or refresh name/phone of) the signed-in user's seller account. The username is permanent.
CREATE OR REPLACE FUNCTION public.register_qr_seller(p_username TEXT, p_name TEXT, p_phone TEXT DEFAULT '')
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_username TEXT := lower(btrim(coalesce(p_username, '')));
  v_name TEXT := left(btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 40);
  v_phone TEXT := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_existing public.qr_sellers%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in first.' USING ERRCODE = '42501';
  END IF;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Add your name.' USING ERRCODE = '22023';
  END IF;
  IF v_phone <> '' AND v_phone !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'That phone number does not look complete.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_existing FROM public.qr_sellers WHERE id = v_uid;
  IF FOUND THEN
    UPDATE public.qr_sellers SET name = v_name, phone = v_phone, updated_at = now() WHERE id = v_uid;
    RETURN public.my_qr_seller();
  END IF;

  IF v_username !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(v_username) < 3 OR char_length(v_username) > 24 THEN
    RAISE EXCEPTION 'Usernames are 3 to 24 characters: lowercase letters, numbers, and dashes.' USING ERRCODE = '22023';
  END IF;
  IF v_username IN ('admin', 'juniper', 'menu', 'api', 'www', 'support', 'help', 'test', 'login', 'signup', 'rider', 'riders') THEN
    RAISE EXCEPTION 'That username is reserved.' USING ERRCODE = '22023';
  END IF;
  IF EXISTS (SELECT 1 FROM public.qr_sellers WHERE username = v_username)
     OR EXISTS (SELECT 1 FROM public.qr_menus WHERE slug = v_username AND (owner_id IS NULL OR owner_id <> v_uid)) THEN
    RAISE EXCEPTION 'That username is taken. Try another one.' USING ERRCODE = '23505';
  END IF;

  INSERT INTO public.qr_sellers (id, username, name, phone) VALUES (v_uid, v_username, v_name, v_phone);
  RETURN public.my_qr_seller();
END;
$$;

-- The signed-in seller's account plus every menu they own (null when they have not registered yet).
CREATE OR REPLACE FUNCTION public.my_qr_seller()
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'id', s.id, 'username', s.username, 'name', s.name, 'phone', s.phone,
    'phoneVerified', s.phone_verified_at IS NOT NULL, 'createdAt', s.created_at,
    'menus', coalesce((SELECT jsonb_agg(public.qr_menu_json(m) ORDER BY m.updated_at DESC) FROM public.qr_menus m WHERE m.owner_id = s.id), '[]'::jsonb)
  )
  FROM public.qr_sellers s WHERE s.id = auth.uid();
$$;

-- Publish or update a menu. Allowed when the caller owns the row (signed in) or presents its edit key.
-- A signed-in seller publishing a new slug becomes its owner; a key holder who signs in claims ownership.
-- Nobody can publish under another seller's username.
CREATE OR REPLACE FUNCTION public.save_qr_menu(p_slug TEXT, p_edit_key TEXT, p_menu JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid UUID := auth.uid();
  v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
  v_hash TEXT;
  v_name TEXT;
  v_whatsapp TEXT;
  v_tagline TEXT;
  v_pickup BOOLEAN;
  v_delivery BOOLEAN;
  v_bank_name TEXT;
  v_account_name TEXT;
  v_account_number TEXT;
  v_categories JSONB := '[]'::jsonb;
  v_category JSONB;
  v_item JSONB;
  v_items JSONB;
  v_item_name TEXT;
  v_price NUMERIC;
  v_item_count INTEGER := 0;
  v_existing_hash TEXT;
  v_owner UUID;
  v_by_key BOOLEAN;
  v_by_owner BOOLEAN;
  v_recent INTEGER;
  v_version INTEGER;
  v_updated TIMESTAMPTZ;
BEGIN
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(v_slug) < 3 OR char_length(v_slug) > 48 THEN
    RAISE EXCEPTION 'That link name can only use lowercase letters, numbers, and dashes (3 to 48 characters).'
      USING ERRCODE = '22023';
  END IF;
  IF v_uid IS NULL AND (p_edit_key IS NULL OR char_length(p_edit_key) < 16 OR char_length(p_edit_key) > 128) THEN
    RAISE EXCEPTION 'The edit key is missing or too short.' USING ERRCODE = '22023';
  END IF;
  IF p_menu IS NULL OR jsonb_typeof(p_menu) <> 'object' THEN
    RAISE EXCEPTION 'The menu is missing.' USING ERRCODE = '22023';
  END IF;
  v_hash := CASE WHEN p_edit_key IS NULL OR char_length(p_edit_key) < 16 THEN NULL ELSE encode(sha256(convert_to(p_edit_key, 'UTF8')), 'hex') END;

  v_name := left(btrim(regexp_replace(coalesce(p_menu->>'name', ''), '\s+', ' ', 'g')), 40);
  v_whatsapp := regexp_replace(coalesce(p_menu->>'whatsapp', ''), '\D', '', 'g');
  v_tagline := left(btrim(regexp_replace(coalesce(p_menu->>'tagline', ''), '\s+', ' ', 'g')), 60);
  v_pickup := coalesce(p_menu->'pickup', 'true'::jsonb) <> 'false'::jsonb;
  v_delivery := coalesce(p_menu->'delivery', 'true'::jsonb) <> 'false'::jsonb;
  v_bank_name := left(btrim(regexp_replace(coalesce(p_menu->'bank'->>'bankName', ''), '\s+', ' ', 'g')), 40);
  v_account_name := left(btrim(regexp_replace(coalesce(p_menu->'bank'->>'accountName', ''), '\s+', ' ', 'g')), 60);
  v_account_number := regexp_replace(coalesce(p_menu->'bank'->>'accountNumber', ''), '\D', '', 'g');
  IF v_name = '' THEN
    RAISE EXCEPTION 'Add your business name before publishing.' USING ERRCODE = '22023';
  END IF;
  IF v_whatsapp !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'Add a valid WhatsApp number before publishing.' USING ERRCODE = '22023';
  END IF;
  IF v_account_number <> '' AND v_account_number !~ '^[0-9]{10}$' THEN
    RAISE EXCEPTION 'Account numbers have 10 digits.' USING ERRCODE = '22023';
  END IF;
  IF (v_bank_name <> '' OR v_account_name <> '' OR v_account_number <> '')
     AND (v_bank_name = '' OR v_account_name = '' OR v_account_number = '') THEN
    RAISE EXCEPTION 'Fill in the bank name, account name and account number together, or leave all three empty.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_menu->'categories') <> 'array' THEN
    RAISE EXCEPTION 'The menu has no categories.' USING ERRCODE = '22023';
  END IF;

  FOR v_category IN SELECT value FROM jsonb_array_elements(p_menu->'categories') LOOP
    EXIT WHEN jsonb_array_length(v_categories) >= 12 OR v_item_count >= 80;
    CONTINUE WHEN jsonb_typeof(v_category) <> 'object' OR jsonb_typeof(v_category->'items') <> 'array';
    v_items := '[]'::jsonb;
    FOR v_item IN SELECT value FROM jsonb_array_elements(v_category->'items') LOOP
      EXIT WHEN v_item_count >= 80;
      CONTINUE WHEN jsonb_typeof(v_item) <> 'object';
      v_item_name := left(btrim(regexp_replace(coalesce(v_item->>'name', ''), '\s+', ' ', 'g')), 40);
      CONTINUE WHEN v_item_name = '';
      v_price := CASE
        WHEN jsonb_typeof(v_item->'price') = 'number' THEN (v_item->>'price')::numeric
        WHEN jsonb_typeof(v_item->'price') = 'string' AND (v_item->>'price') ~ '^\s*[0-9]+(\.[0-9]+)?\s*$' THEN (btrim(v_item->>'price'))::numeric
        ELSE 0
      END;
      v_items := v_items || jsonb_build_object(
        'name', v_item_name,
        'price', least(9999999, greatest(0, round(v_price)))::integer,
        'note', left(btrim(regexp_replace(coalesce(v_item->>'note', ''), '\s+', ' ', 'g')), 60)
      );
      v_item_count := v_item_count + 1;
    END LOOP;
    CONTINUE WHEN jsonb_array_length(v_items) = 0;
    v_categories := v_categories || jsonb_build_object(
      'name', left(btrim(regexp_replace(coalesce(v_category->>'name', ''), '\s+', ' ', 'g')), 24),
      'items', v_items
    );
  END LOOP;
  IF v_item_count = 0 THEN
    RAISE EXCEPTION 'Add at least one menu item before publishing.' USING ERRCODE = '22023';
  END IF;

  SELECT edit_key_hash, owner_id INTO v_existing_hash, v_owner FROM public.qr_menus WHERE slug = v_slug FOR UPDATE;
  IF FOUND THEN
    v_by_key := v_hash IS NOT NULL AND v_existing_hash = v_hash;
    v_by_owner := v_uid IS NOT NULL AND v_owner = v_uid;
    IF NOT (v_by_key OR v_by_owner) THEN
      RAISE EXCEPTION 'This link name is already taken, or your edit key does not match it.'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.qr_menus
      SET name = v_name, whatsapp = v_whatsapp, tagline = v_tagline, pickup = v_pickup, delivery = v_delivery,
          bank_name = v_bank_name, account_name = v_account_name, account_number = v_account_number,
          categories = v_categories, owner_id = coalesce(v_owner, v_uid), version = version + 1, updated_at = now()
      WHERE slug = v_slug
      RETURNING version, updated_at INTO v_version, v_updated;
  ELSE
    IF EXISTS (SELECT 1 FROM public.qr_sellers WHERE username = v_slug AND id IS DISTINCT FROM v_uid) THEN
      RAISE EXCEPTION 'This link name belongs to another seller.' USING ERRCODE = '42501';
    END IF;
    SELECT count(*) INTO v_recent FROM public.qr_menus WHERE created_at > now() - INTERVAL '1 hour';
    IF v_recent >= 200 THEN
      RAISE EXCEPTION 'Too many new menus were published in the last hour. Please try again later.'
        USING ERRCODE = '53400';
    END IF;
    INSERT INTO public.qr_menus (slug, name, whatsapp, tagline, pickup, delivery, bank_name, account_name, account_number, categories, edit_key_hash, owner_id)
      VALUES (v_slug, v_name, v_whatsapp, v_tagline, v_pickup, v_delivery, v_bank_name, v_account_name, v_account_number, v_categories,
              coalesce(v_hash, encode(sha256(gen_random_uuid()::text::bytea), 'hex')), v_uid)
      RETURNING version, updated_at INTO v_version, v_updated;
  END IF;

  RETURN jsonb_build_object('slug', v_slug, 'version', v_version, 'updated_at', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.qr_menu_json(public.qr_menus) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.register_qr_seller(TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.my_qr_seller() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_qr_menu(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.register_qr_seller(TEXT, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_qr_seller() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_qr_menu(TEXT, TEXT, JSONB) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_qr_menu(TEXT) TO anon, authenticated, service_role;

COMMENT ON TABLE public.qr_sellers IS 'Seller accounts for menu.html. username = permanent QR code (menu.html#s=<username>). No direct API access: register_qr_seller() / my_qr_seller().';
