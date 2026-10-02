# Supabase backend setup

Juniper's selected backend is **Supabase Auth + Postgres + Row Level Security + Edge Functions + private Storage**. The repository now contains an initial schema and a small API function scaffold, but no Supabase project is linked or deployed. The Android APK still runs the existing browser-local flows; this scaffold alone does not make orders/accounts sync between devices.

## What is prepared

- `supabase/config.toml` — local Supabase CLI settings, the API function configuration, and a private `seller-verification` storage bucket.
- `supabase/migrations/20261002000000_initial_schema.sql` — business tables tied to Supabase Auth IDs, a signup trigger that starts every account as a buyer, RLS policies, private verification storage, and the server-side two-hour menu-edit limit.
- `supabase/functions/api/index.ts` — read-only `/health`, approved/available `/riders`, and JWT-verified `/me` routes, with exact-origin CORS checks.
- `@supabase/supabase-js` — client library dependency, ready for the later frontend integration.

The migration has no national identity number field and no food-photo/video upload field. New menu edits are limited by a database trigger. Order rows default to `payment_status = 'unconfirmed'`; no transfer is assumed received. Rider approval and availability are required for public rider results.

## 1. Create a Supabase project

Create a project in the Supabase Dashboard and keep the database password private. Do not send passwords, service-role keys, CLI access tokens, or auth codes in chat. Choose the database region carefully for your users before creating the project.

## 2. Link this repository from your own terminal

Use Node.js 20 or newer in the project directory:

```sh
npm ci
npm run supabase:login
npm run supabase:link -- --project-ref YOUR_PROJECT_REF
```

Replace `YOUR_PROJECT_REF` with the reference shown in the Supabase Dashboard. The CLI may ask for your database password locally. Keep the linked-project metadata and all secrets out of public source control.

## 3. Apply the schema and deploy the API

After confirming the CLI is linked to the intended project:

```sh
npm run supabase:db:push
npx supabase@latest secrets set JUNIPER_ALLOWED_ORIGINS="https://YOUR_APP_DOMAIN,https://localhost"
npm run supabase:functions:deploy
```

Replace `https://YOUR_APP_DOMAIN` with the exact HTTPS origin where the web app will be hosted. `https://localhost` is the Android WebView origin for this APK's current Capacitor configuration. Do not use a wildcard CORS origin for authenticated app endpoints.

The function uses Supabase-provided project URL and anon/publishable credentials. The browser and APK may use a **publishable/anon** key only when RLS is enabled. Never place a `service_role` key or database password in `index.html`, the APK, or any other client-side file.

## 4. Configure Supabase Auth

In the Supabase Dashboard, set the production Site URL and exact redirect allowlist for the hosted website. Email confirmation, password policy, rate limits, and any OAuth providers should be configured before real users sign up. The current Android app does not yet implement Supabase Auth deep-link callbacks.

New Supabase Auth users receive a `public.profiles` row with role `buyer`. Seller/rider review must not block buyer sign-up or ordering. Grant the initial administrator role only through a protected admin process or the Dashboard SQL Editor—not from the app. Never trust a client-submitted role or approval status.

## 5. Verify the deployed API

Use the Supabase Edge Function URL shown in the Dashboard:

- `GET /functions/v1/api/health` — calls the minimal health RPC to confirm PostgREST can reach Postgres.
- `GET /functions/v1/api/riders?q=...&lat=...&lng=...` — returns approved, available riders and optionally sorts by distance. Device location is used only after the user grants permission.
- `GET /functions/v1/api/me` — requires a valid Supabase Auth bearer token and returns the signed-in user's own profile.

## Important work still required

- Connect sign-up/sign-in and session handling in the current UI to Supabase Auth.
- Replace browser-local `localStorage` state with authenticated database calls for seller/rider applications, seller/menu administration, orders, reviews, tags, notifications, and admin review. The current function is read-only; protected write/checkout routes are not implemented.
- Keep checkout to one seller per order, compute prices on the server, keep payment status unconfirmed until a trusted provider/reconciliation confirms it, and enforce seller/rider approval server-side.
- Passport/profile images must use owner-scoped uploads to the private bucket and protected admin review/download endpoints. Those routes are not implemented; the current browser file picker is not an upload or verification service.
- Add the production website origin and Android `https://localhost` to the Function's CORS allowlist. Rebuild the APK after the app has been wired to the API.

Existing browser-local data is not automatically migrated to Supabase. See `README.md` for app constraints and build notes.
