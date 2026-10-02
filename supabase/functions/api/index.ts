import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.100.0";

const allowedOrigins = new Set(
  (Deno.env.get("JUNIPER_ALLOWED_ORIGINS") || "http://localhost:4173,https://localhost")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);

function response(request: Request, body: unknown, status = 200): Response {
  const headers = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const origin = request.headers.get("origin");
  if (origin && allowedOrigins.has(origin)) {
    headers.set("access-control-allow-origin", origin);
    headers.set("vary", "Origin");
    headers.set("access-control-allow-methods", "GET, OPTIONS");
    headers.set("access-control-allow-headers", "Authorization, Content-Type, apikey, x-client-info");
    headers.set("access-control-max-age", "600");
  }
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers });
}

function getCredentials() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("Supabase URL and publishable/anon key are not configured.");
  return { url, key };
}

function getClient(authorization?: string): SupabaseClient {
  const { url, key } = getCredentials();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    ...(authorization ? { global: { headers: { Authorization: authorization } } } : {}),
  });
}

function validCoordinate(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function distanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const dLat = radians(lat2 - lat1);
  const dLng = radians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function health(request: Request): Promise<Response> {
  const { data, error } = await getClient().rpc("juniper_health");
  if (error || data !== true) return response(request, { error: "Supabase database check failed." }, 503);
  return response(request, { ok: true, service: "juniper-supabase-api", database: "supabase-postgres" });
}

async function listRiders(request: Request, url: URL): Promise<Response> {
  const query = (url.searchParams.get("q") || "").trim().slice(0, 80).toLocaleLowerCase();
  const rawLat = url.searchParams.get("lat");
  const rawLng = url.searchParams.get("lng");
  const hasLocation = rawLat !== null || rawLng !== null;
  const latitude = rawLat === null ? NaN : Number(rawLat);
  const longitude = rawLng === null ? NaN : Number(rawLng);

  if (hasLocation && (!validCoordinate(latitude, -90, 90) || !validCoordinate(longitude, -180, 180))) {
    return response(request, { error: "Provide a valid latitude and longitude together." }, 400);
  }

  const { data, error } = await getClient()
    .from("rider_profiles")
    .select("id, display_name, phone, whatsapp, vehicle_type, service_area, latitude, longitude, service_radius_km, base_fee_ngn, profile_slug")
    .eq("approval_status", "approved")
    .eq("is_available", true)
    .limit(100);

  if (error) return response(request, { error: "Could not load available riders." }, 503);

  let riders = (data || []).map((rider) => {
    const riderLat = rider.latitude == null ? NaN : Number(rider.latitude);
    const riderLng = rider.longitude == null ? NaN : Number(rider.longitude);
    const radius = Number(rider.service_radius_km);
    const hasCoordinates = validCoordinate(riderLat, -90, 90) && validCoordinate(riderLng, -180, 180);
    const distance = hasLocation && hasCoordinates
      ? distanceKm(latitude, longitude, riderLat, riderLng)
      : null;
    return {
      id: rider.id,
      name: rider.display_name,
      phone: rider.phone,
      whatsapp: rider.whatsapp,
      vehicleType: rider.vehicle_type,
      serviceArea: rider.service_area,
      latitude: hasCoordinates ? riderLat : null,
      longitude: hasCoordinates ? riderLng : null,
      serviceRadiusKm: Number.isFinite(radius) ? radius : null,
      baseFee: Number(rider.base_fee_ngn) || 0,
      profileSlug: rider.profile_slug,
      distanceKm: distance === null ? null : Number(distance.toFixed(1)),
      inServiceRange: distance === null || !Number.isFinite(radius) ? null : distance <= radius,
    };
  });

  if (query) {
    riders = riders.filter((rider) =>
      [rider.name, rider.serviceArea, rider.vehicleType]
        .some((value) => String(value || "").toLocaleLowerCase().includes(query))
    );
  }
  if (hasLocation) {
    riders.sort((a, b) => {
      if (a.distanceKm === null) return 1;
      if (b.distanceKm === null) return -1;
      return a.distanceKm - b.distanceKm;
    });
  }
  return response(request, { riders, locationProvided: hasLocation });
}

async function currentProfile(request: Request): Promise<Response> {
  const authorization = request.headers.get("authorization");
  if (!authorization?.match(/^Bearer\s+.+$/i)) {
    return response(request, { error: "Sign in to access this resource." }, 401);
  }
  const client = getClient(authorization);
  const { data: authData, error: authError } = await client.auth.getUser();
  if (authError || !authData.user) {
    return response(request, { error: "A valid Supabase Auth bearer token is required." }, 401);
  }

  const { data: profile, error } = await client
    .from("profiles")
    .select("id, role, display_name, email, phone, whatsapp, created_at")
    .eq("id", authData.user.id)
    .maybeSingle();
  if (error) return response(request, { error: "Could not load the signed-in profile." }, 503);
  if (!profile) return response(request, { error: "Profile is not ready yet." }, 404);
  return response(request, { profile });
}

Deno.serve(async (request: Request): Promise<Response> => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin)) {
    return response(request, { error: "Origin not allowed." }, 403);
  }
  if (request.method === "OPTIONS") return response(request, {}, 204);
  if (request.method !== "GET") return response(request, { error: "Method not allowed." }, 405);

  const url = new URL(request.url);
  try {
    if (url.pathname.endsWith("/health")) return await health(request);
    if (url.pathname.endsWith("/riders")) return await listRiders(request, url);
    if (url.pathname.endsWith("/me")) return await currentProfile(request);
    return response(request, { error: "API route not found." }, 404);
  } catch (error) {
    console.error("Juniper Supabase Function failed", error instanceof Error ? error.message : "unknown error");
    return response(request, { error: "The request could not be completed." }, 500);
  }
});
