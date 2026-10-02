# Backend choice

Juniper's active backend target is **Supabase**: Supabase Auth, Postgres with Row Level Security, Edge Functions, and private Storage. The earlier Neon scaffold has been superseded. The workspace now has a Supabase configuration, an initial schema migration, a private seller-verification bucket declaration, and API starter routes.

No Supabase project is linked or deployed yet. The app's sign-in, orders, seller/rider applications, reviews, tags, and admin review still use browser-local state. Complete `SUPABASE_SETUP.md` after creating a project, then integrate the UI with Auth and protected data routes.

## Security decisions

- Use Supabase Auth IDs as foreign keys in `public.profiles`; new users start as buyers.
- Enable RLS on business tables. Keep approval, admin changes, order totals/status, and payment confirmation server-controlled.
- Keep the seller-verification Storage bucket private. The local file picker is not an upload or verification service; upload/review routes still need to be implemented.
- Never ship the Supabase `service_role` key or database password in browser code or the APK. A public publishable/anon key is safe only with correctly reviewed RLS.
- Do not add a national identity number field. Do not add food photo/video uploads. Payment links/QR instructions do not prove that a transfer cleared.
