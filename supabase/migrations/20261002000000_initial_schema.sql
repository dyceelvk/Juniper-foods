-- Juniper business data for Supabase Postgres.
-- Supabase Auth owns auth.users; public.profiles stores only app-specific fields.
-- Identity-document bytes belong in the private seller-verification Storage bucket;
-- this schema stores only private object keys and metadata.

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'buyer'
    CHECK (role IN ('buyer', 'seller', 'rider', 'admin')),
  display_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  whatsapp TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- New Supabase Auth accounts start as buyers. This trigger never grants seller,
-- rider, or admin privileges; those are server/admin review decisions.
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, role, display_name, email)
  VALUES (
    NEW.id,
    'buyer',
    COALESCE(NEW.raw_user_meta_data ->> 'name', ''),
    COALESCE(NEW.email, '')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

CREATE TABLE IF NOT EXISTS seller_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  legal_name TEXT NOT NULL,
  public_name TEXT NOT NULL,
  business_address TEXT NOT NULL,
  city_or_neighborhood TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL,
  whatsapp TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'needs_review')),
  reviewer_user_id UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES seller_applications(id) ON DELETE CASCADE,
  owner_user_id UUID NOT NULL REFERENCES profiles(id),
  document_type TEXT NOT NULL CHECK (document_type IN ('passport_photo', 'profile_photo', 'business_document')),
  object_key TEXT NOT NULL UNIQUE,
  content_type TEXT NOT NULL,
  byte_size BIGINT NOT NULL CHECK (byte_size > 0 AND byte_size <= 8388608),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  public_name TEXT NOT NULL,
  profile_slug TEXT NOT NULL UNIQUE,
  phone TEXT NOT NULL,
  whatsapp TEXT NOT NULL DEFAULT '',
  business_address TEXT NOT NULL,
  city_or_neighborhood TEXT NOT NULL DEFAULT '',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  delivery_radius_km DOUBLE PRECISION NOT NULL DEFAULT 5 CHECK (delivery_radius_km > 0),
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'suspended')),
  is_open BOOLEAN NOT NULL DEFAULT TRUE,
  payment_qr_url TEXT NOT NULL DEFAULT '',
  bank_or_wallet_details TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seller_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, name)
);

CREATE TABLE IF NOT EXISTS menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  price_ngn BIGINT NOT NULL CHECK (price_ngn >= 0),
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  last_edited_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_menu_item_edit_interval()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.last_edited_at IS NOT NULL AND OLD.last_edited_at > now() - INTERVAL '2 hours' THEN
    RAISE EXCEPTION USING
      ERRCODE = 'check_violation',
      MESSAGE = 'Food listings can only be edited once every two hours.';
  END IF;
  NEW.last_edited_at := now();
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS menu_items_two_hour_edit_limit ON menu_items;
CREATE TRIGGER menu_items_two_hour_edit_limit
BEFORE UPDATE OF title, description, category, price_ngn, is_available ON menu_items
FOR EACH ROW EXECUTE FUNCTION enforce_menu_item_edit_interval();

CREATE TABLE IF NOT EXISTS rider_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  legal_name TEXT NOT NULL,
  public_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT NOT NULL DEFAULT '',
  vehicle_type TEXT NOT NULL,
  service_area TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  service_radius_km DOUBLE PRECISION NOT NULL DEFAULT 5 CHECK (service_radius_km > 0),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_user_id UUID REFERENCES profiles(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rider_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES profiles(id),
  display_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT NOT NULL DEFAULT '',
  vehicle_type TEXT NOT NULL,
  service_area TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  service_radius_km DOUBLE PRECISION NOT NULL DEFAULT 5 CHECK (service_radius_km > 0),
  base_fee_ngn BIGINT NOT NULL DEFAULT 0 CHECK (base_fee_ngn >= 0),
  profile_slug TEXT NOT NULL UNIQUE,
  approval_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (approval_status IN ('pending', 'approved', 'suspended')),
  is_available BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_user_id UUID NOT NULL REFERENCES profiles(id),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id),
  rider_id UUID REFERENCES rider_profiles(id),
  order_type TEXT NOT NULL DEFAULT 'pickup' CHECK (order_type IN ('pickup', 'delivery')),
  status TEXT NOT NULL DEFAULT 'placed'
    CHECK (status IN ('placed', 'accepted', 'preparing', 'ready', 'in_transit', 'delivered', 'cancelled')),
  buyer_name TEXT NOT NULL,
  buyer_phone TEXT NOT NULL,
  delivery_address TEXT NOT NULL DEFAULT '',
  delivery_latitude DOUBLE PRECISION,
  delivery_longitude DOUBLE PRECISION,
  subtotal_ngn BIGINT NOT NULL CHECK (subtotal_ngn >= 0),
  delivery_fee_ngn BIGINT NOT NULL DEFAULT 0 CHECK (delivery_fee_ngn >= 0),
  total_ngn BIGINT NOT NULL CHECK (total_ngn >= 0),
  payment_method TEXT NOT NULL DEFAULT 'cash',
  payment_status TEXT NOT NULL DEFAULT 'unconfirmed'
    CHECK (payment_status IN ('unconfirmed', 'seller_confirmed', 'refunded')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  item_title_snapshot TEXT NOT NULL,
  quantity BIGINT NOT NULL CHECK (quantity > 0),
  unit_price_ngn BIGINT NOT NULL CHECK (unit_price_ngn >= 0)
);

CREATE TABLE IF NOT EXISTS seller_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES profiles(id),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, reviewer_user_id)
);

CREATE TABLE IF NOT EXISTS rider_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  reviewer_user_id UUID NOT NULL REFERENCES profiles(id),
  rider_id UUID NOT NULL REFERENCES rider_profiles(id),
  rating SMALLINT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (order_id, reviewer_user_id)
);

CREATE TABLE IF NOT EXISTS seller_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  buyer_user_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (seller_id, buyer_user_id)
);

CREATE TABLE IF NOT EXISTS rider_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  rider_id UUID NOT NULL REFERENCES rider_profiles(id) ON DELETE CASCADE,
  buyer_user_id UUID NOT NULL REFERENCES profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (rider_id, buyer_user_id)
);

CREATE TABLE IF NOT EXISTS seller_updates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seller_id UUID NOT NULL REFERENCES seller_profiles(id) ON DELETE CASCADE,
  menu_item_id UUID REFERENCES menu_items(id) ON DELETE SET NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID NOT NULL REFERENCES profiles(id),
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_seller_profiles_approved_location
  ON seller_profiles (approval_status, is_open, latitude, longitude);
CREATE INDEX IF NOT EXISTS idx_menu_items_seller_available
  ON menu_items (seller_id, is_available);
CREATE INDEX IF NOT EXISTS idx_rider_profiles_search
  ON rider_profiles (approval_status, is_available, display_name);
CREATE INDEX IF NOT EXISTS idx_orders_buyer_created
  ON orders (buyer_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_seller_created
  ON orders (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_orders_rider_created
  ON orders (rider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_seller_updates_seller_created
  ON seller_updates (seller_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created
  ON notifications (user_id, created_at DESC);


-- A minimal public health RPC confirms PostgREST-to-Postgres connectivity without
-- reading business data or bypassing RLS for any table.
CREATE OR REPLACE FUNCTION public.juniper_health()
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT TRUE;
$$;
REVOKE ALL ON FUNCTION public.juniper_health() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.juniper_health() TO anon, authenticated;

-- Private Storage bucket for passport/profile verification documents.
-- No storage.objects policies are granted here: access must be implemented through
-- authenticated, owner-scoped server routes and protected admin review.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'seller-verification',
  'seller-verification',
  FALSE,
  8388608,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = FALSE,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Enable RLS everywhere. Tables without an explicit client policy are intentionally
-- server-only until their Edge Function routes have been implemented and reviewed.
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rider_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.seller_updates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

-- A user can read only their own private app profile. There is deliberately no
-- client-side role-update policy.
CREATE POLICY profiles_select_self
  ON public.profiles FOR SELECT TO authenticated
  USING (id = (SELECT auth.uid()));

CREATE POLICY seller_applications_select_owner
  ON public.seller_applications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY seller_applications_insert_owner
  ON public.seller_applications FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND reviewer_user_id IS NULL
    AND reviewed_at IS NULL
  );

-- Public reads expose only approved seller/rider profiles and available listings.
CREATE POLICY seller_profiles_read_approved_or_owner
  ON public.seller_profiles FOR SELECT TO anon, authenticated
  USING (approval_status = 'approved' OR owner_user_id = (SELECT auth.uid()));
CREATE POLICY seller_categories_read_approved
  ON public.seller_categories FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.id = seller_id AND s.approval_status = 'approved'
  ));
CREATE POLICY menu_items_read_approved
  ON public.menu_items FOR SELECT TO anon, authenticated
  USING (
    is_available = TRUE
    AND EXISTS (
      SELECT 1 FROM public.seller_profiles s
      WHERE s.id = seller_id AND s.approval_status = 'approved'
    )
  );

CREATE POLICY rider_applications_select_owner
  ON public.rider_applications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
CREATE POLICY rider_applications_insert_owner
  ON public.rider_applications FOR INSERT TO authenticated
  WITH CHECK (
    user_id = (SELECT auth.uid())
    AND status = 'pending'
    AND reviewer_user_id IS NULL
    AND reviewed_at IS NULL
  );
CREATE POLICY rider_profiles_read_approved_or_owner
  ON public.rider_profiles FOR SELECT TO anon, authenticated
  USING (approval_status = 'approved' OR user_id = (SELECT auth.uid()));

-- Orders are read-only to clients in this first migration. Checkout and status
-- changes must use server routes that recalculate totals and verify each role.
CREATE POLICY orders_read_participants
  ON public.orders FOR SELECT TO authenticated
  USING (
    buyer_user_id = (SELECT auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.seller_profiles s
      WHERE s.id = seller_id AND s.owner_user_id = (SELECT auth.uid())
    )
    OR EXISTS (
      SELECT 1 FROM public.rider_profiles r
      WHERE r.id = rider_id AND r.user_id = (SELECT auth.uid())
    )
  );
CREATE POLICY order_items_read_order_participants
  ON public.order_items FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.orders o WHERE o.id = order_id
  ));

CREATE POLICY seller_reviews_read_public
  ON public.seller_reviews FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.id = seller_id AND s.approval_status = 'approved'
  ));
CREATE POLICY seller_reviews_insert_completed_order
  ON public.seller_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.buyer_user_id = (SELECT auth.uid())
        AND o.seller_id = seller_reviews.seller_id
        AND o.status = 'delivered'
    )
  );
CREATE POLICY rider_reviews_read_public
  ON public.rider_reviews FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.rider_profiles r
    WHERE r.id = rider_id AND r.approval_status = 'approved'
  ));
CREATE POLICY rider_reviews_insert_completed_order
  ON public.rider_reviews FOR INSERT TO authenticated
  WITH CHECK (
    reviewer_user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.orders o
      WHERE o.id = order_id
        AND o.buyer_user_id = (SELECT auth.uid())
        AND o.rider_id = rider_reviews.rider_id
        AND o.status = 'delivered'
    )
  );

-- Tags are owner-scoped; aggregate counts should be exposed through a reviewed
-- RPC rather than exposing every tagger's user ID.
CREATE POLICY seller_tags_select_own
  ON public.seller_tags FOR SELECT TO authenticated
  USING (buyer_user_id = (SELECT auth.uid()));
CREATE POLICY seller_tags_insert_own
  ON public.seller_tags FOR INSERT TO authenticated
  WITH CHECK (buyer_user_id = (SELECT auth.uid()));
CREATE POLICY seller_tags_delete_own
  ON public.seller_tags FOR DELETE TO authenticated
  USING (buyer_user_id = (SELECT auth.uid()));
CREATE POLICY rider_tags_select_own
  ON public.rider_tags FOR SELECT TO authenticated
  USING (buyer_user_id = (SELECT auth.uid()));
CREATE POLICY rider_tags_insert_own
  ON public.rider_tags FOR INSERT TO authenticated
  WITH CHECK (buyer_user_id = (SELECT auth.uid()));
CREATE POLICY rider_tags_delete_own
  ON public.rider_tags FOR DELETE TO authenticated
  USING (buyer_user_id = (SELECT auth.uid()));

CREATE POLICY seller_updates_read_approved
  ON public.seller_updates FOR SELECT TO anon, authenticated
  USING (EXISTS (
    SELECT 1 FROM public.seller_profiles s
    WHERE s.id = seller_id AND s.approval_status = 'approved'
  ));
CREATE POLICY notifications_select_owner
  ON public.notifications FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));
-- seller_documents and admin_audit_log intentionally have no client policies.
