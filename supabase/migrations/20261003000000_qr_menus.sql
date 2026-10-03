-- Hosted single-seller QR menus (menu.html "permanent link" mode).
--
-- A seller publishes their menu once; the printed QR points at menu.html#s=<slug> and never changes,
-- so price edits no longer mean reprinting. There are no seller accounts: the seller's browser holds a
-- random edit key and only its SHA-256 hash is stored here. Reads are public by slug (a menu is a
-- flyer), writes only happen through save_qr_menu(), which checks the key.
--
-- Standalone on purpose: it does not depend on the marketplace schema, so it can be pasted into the
-- Supabase SQL editor on its own or applied with `supabase db push`.

CREATE TABLE IF NOT EXISTS public.qr_menus (
  slug TEXT PRIMARY KEY
    CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND char_length(slug) BETWEEN 3 AND 48),
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 40),
  whatsapp TEXT NOT NULL CHECK (whatsapp ~ '^[0-9]{7,15}$'),
  tagline TEXT NOT NULL DEFAULT '' CHECK (char_length(tagline) <= 60),
  pickup BOOLEAN NOT NULL DEFAULT TRUE,
  delivery BOOLEAN NOT NULL DEFAULT TRUE,
  -- [{ "name": "Rice", "items": [{ "name": "Jollof rice", "price": 2500, "note": "" }] }]
  categories JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(categories) = 'array' AND pg_column_size(categories) <= 24000),
  edit_key_hash TEXT NOT NULL CHECK (edit_key_hash ~ '^[0-9a-f]{64}$'),
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qr_menus_created_at_idx ON public.qr_menus (created_at);

-- RLS on with no policies plus revoked privileges: the API roles cannot read or write the table
-- directly, which keeps edit_key_hash private. Everything goes through the two functions below.
ALTER TABLE public.qr_menus ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.qr_menus FROM PUBLIC, anon, authenticated;

-- Public read: GET /rest/v1/rpc/get_qr_menu?p_slug=mama-nkechi-7k3 → the menu, or null.
CREATE OR REPLACE FUNCTION public.get_qr_menu(p_slug TEXT)
RETURNS JSONB
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jsonb_build_object(
    'slug', slug, 'name', name, 'whatsapp', whatsapp, 'tagline', tagline,
    'pickup', pickup, 'delivery', delivery, 'categories', categories,
    'version', version, 'updated_at', updated_at
  )
  FROM public.qr_menus
  WHERE slug = lower(btrim(coalesce(p_slug, '')));
$$;

-- Publish or update: POST /rest/v1/rpc/save_qr_menu {"p_slug": ..., "p_edit_key": ..., "p_menu": {...}}.
-- First call with a free slug creates the menu and binds it to the edit key; later calls must present
-- the same key. The menu is normalised here with the same limits as menu.html, so a hand-crafted
-- request cannot store anything the page would not have produced.
CREATE OR REPLACE FUNCTION public.save_qr_menu(p_slug TEXT, p_edit_key TEXT, p_menu JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_slug TEXT := lower(btrim(coalesce(p_slug, '')));
  v_hash TEXT;
  v_name TEXT;
  v_whatsapp TEXT;
  v_tagline TEXT;
  v_pickup BOOLEAN;
  v_delivery BOOLEAN;
  v_categories JSONB := '[]'::jsonb;
  v_category JSONB;
  v_item JSONB;
  v_items JSONB;
  v_item_name TEXT;
  v_price NUMERIC;
  v_item_count INTEGER := 0;
  v_existing_hash TEXT;
  v_recent INTEGER;
  v_version INTEGER;
  v_updated TIMESTAMPTZ;
BEGIN
  IF v_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$' OR char_length(v_slug) < 3 OR char_length(v_slug) > 48 THEN
    RAISE EXCEPTION 'That link name can only use lowercase letters, numbers, and dashes (3 to 48 characters).'
      USING ERRCODE = '22023';
  END IF;
  IF p_edit_key IS NULL OR char_length(p_edit_key) < 16 OR char_length(p_edit_key) > 128 THEN
    RAISE EXCEPTION 'The edit key is missing or too short.' USING ERRCODE = '22023';
  END IF;
  IF p_menu IS NULL OR jsonb_typeof(p_menu) <> 'object' THEN
    RAISE EXCEPTION 'The menu is missing.' USING ERRCODE = '22023';
  END IF;
  v_hash := encode(sha256(convert_to(p_edit_key, 'UTF8')), 'hex');

  -- Business details, trimmed to the same limits menu.html uses.
  v_name := left(btrim(regexp_replace(coalesce(p_menu->>'name', ''), '\s+', ' ', 'g')), 40);
  v_whatsapp := regexp_replace(coalesce(p_menu->>'whatsapp', ''), '\D', '', 'g');
  v_tagline := left(btrim(regexp_replace(coalesce(p_menu->>'tagline', ''), '\s+', ' ', 'g')), 60);
  v_pickup := coalesce(p_menu->'pickup', 'true'::jsonb) <> 'false'::jsonb;
  v_delivery := coalesce(p_menu->'delivery', 'true'::jsonb) <> 'false'::jsonb;
  IF v_name = '' THEN
    RAISE EXCEPTION 'Add your business name before publishing.' USING ERRCODE = '22023';
  END IF;
  IF v_whatsapp !~ '^[0-9]{7,15}$' THEN
    RAISE EXCEPTION 'Add a valid WhatsApp number before publishing.' USING ERRCODE = '22023';
  END IF;
  IF jsonb_typeof(p_menu->'categories') <> 'array' THEN
    RAISE EXCEPTION 'The menu has no categories.' USING ERRCODE = '22023';
  END IF;

  -- Categories and items: drop empties, clamp lengths and prices, cap at 12 categories / 80 items.
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

  SELECT edit_key_hash INTO v_existing_hash FROM public.qr_menus WHERE slug = v_slug FOR UPDATE;
  IF FOUND THEN
    IF v_existing_hash <> v_hash THEN
      -- Either the slug belongs to someone else or this device does not hold the key. menu.html retries
      -- with a fresh slug when publishing for the first time, and explains the situation otherwise.
      RAISE EXCEPTION 'This link name is already taken, or your edit key does not match it.'
        USING ERRCODE = '42501';
    END IF;
    UPDATE public.qr_menus
      SET name = v_name, whatsapp = v_whatsapp, tagline = v_tagline, pickup = v_pickup, delivery = v_delivery,
          categories = v_categories, version = version + 1, updated_at = now()
      WHERE slug = v_slug
      RETURNING version, updated_at INTO v_version, v_updated;
  ELSE
    -- Cheap flood guard: real sellers arrive a few per day. Count only the recent window.
    SELECT count(*) INTO v_recent FROM public.qr_menus WHERE created_at > now() - INTERVAL '1 hour';
    IF v_recent >= 200 THEN
      RAISE EXCEPTION 'Too many new menus were published in the last hour. Please try again later.'
        USING ERRCODE = '53400';
    END IF;
    INSERT INTO public.qr_menus (slug, name, whatsapp, tagline, pickup, delivery, categories, edit_key_hash)
      VALUES (v_slug, v_name, v_whatsapp, v_tagline, v_pickup, v_delivery, v_categories, v_hash)
      RETURNING version, updated_at INTO v_version, v_updated;
  END IF;

  RETURN jsonb_build_object('slug', v_slug, 'version', v_version, 'updated_at', v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.get_qr_menu(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_qr_menu(TEXT, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_qr_menu(TEXT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.save_qr_menu(TEXT, TEXT, JSONB) TO anon, authenticated, service_role;

COMMENT ON TABLE public.qr_menus IS 'Published single-seller QR menus (menu.html#s=<slug>). No direct API access: read via get_qr_menu(), write via save_qr_menu() with the seller''s edit key.';
