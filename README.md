# Juniper — QR food ordering

Plain HTML, CSS and JavaScript, one deployment. What is where:

- **`index.html` — the Juniper app** (the site root, `/`). Seller accounts (Supabase Auth), one permanent QR code per seller, hosted menus, bank details at checkout, customers order on WhatsApp. This is the real product; everything below under "The Juniper app" describes it.
- **`preview.html` — design preview with demo data.** The original multi-seller marketplace mock-up (buyers, sellers, riders, admin queue). Nothing in it is real: accounts, food and orders stay in the browser. It is kept as the design reference for the rider and marketplace steps and says so in a banner; it is not linked from the app.
- **`menu.html` — a redirect.** The app used to live at `menu.html`; older QR codes and links still open, with their `#s=`/`#m=` part kept.

## The Juniper app (`index.html`) — accounts, permanent QR codes, orders on WhatsApp

`index.html` is a self-contained page for **one food seller at a time** (each seller gets their own account and code): type the menu once, print one QR code, and customers order by scanning it — the order arrives as a prefilled WhatsApp message on the seller's phone. No customer accounts, no riders, no admin queue, no server, no database.

How it works without a backend (link mode): **the whole menu travels inside the QR link itself** (`/#m=…`), so the code opens correctly on any phone the moment the site is hosted. A 12-item menu is a 69×69 code that prints fine at 5 cm; 30 items fits an A5 table tent at 8 cm. The page tells the seller the recommended print size. Changing prices means printing a fresh code — the page says so.

Seller flow (`/`):

1. Business name, WhatsApp number (Nigerian `0801…` numbers are converted to `234…` automatically), optional tagline, pickup/delivery toggles.
2. Menu editor with categories, items, prices, and optional notes. "Start from a sample menu" loads a Nigerian starter menu to edit.
3. Live QR code with print-size guidance, optional per-table codes, **Download QR (PNG)** (ready-to-print card), SVG, copy/share link, and "Preview as a customer".
4. Plan card: free trial countdown, monthly price, what the plan covers, bank-transfer details, and a "Subscribe on WhatsApp" button.

Customer flow (`/#m=…` or `/#s=<username>`): menu grouped by category → add items → "Order on WhatsApp" → choose table/pickup/delivery, name, note → WhatsApp opens with the itemised order and total addressed to the seller. A "Make a QR menu for your own business" footer brings in the next seller.

Step 5 on the seller page, **Remind your customers (free)**, is a library of short, friendly messages (morning / lunch / evening / weekend / rainy day / "miss you") that the page picks by time of day, personalises with the business name, attaches the menu link to, and shares straight into WhatsApp. Sellers post them to their WhatsApp Status or a broadcast list — the people there already saved the seller's number, so consent is built in and it costs nothing. The picker rotates daily and "Another one" walks through the whole library so regulars don't see the same line twice. Add a shortened link under "Link details → Short link" to keep messages tidy. Edit the `MESSAGE_LIBRARY` array in `index.html` to change the copy.

**SMS/OTP via Termii — later, not now.** The same library can drive scheduled SMS (time-of-day, weekend, win-back, order updates, birthdays) once three things exist: (1) a backend that holds the Termii API key as a secret — a Supabase Edge Function on a cron, never the browser; (2) customers' numbers with an explicit opt-in (a checkbox at order time or at buyer sign-up in the full app, a `STOP` keyword, and a record of consent, as the NDPA requires); (3) a budget — every SMS costs money per message, so cap frequency (one or two a week per customer) and route promotional texts through Termii's DND channel or they silently fail on DND-activated lines. OTP at sign-up also belongs server-side; Supabase Auth phone sign-in can call Termii through a custom SMS hook. Until then, WhatsApp Status is the honest, free channel.

**Before you show it to a seller, edit the `PLAN` block at the top of the script in `index.html`:** your price (`priceNgn`, default ₦10,000/month), trial length (`trialDays`, default 14), your WhatsApp number (`ownerWhatsApp`), and the bank account sellers pay into (`payTo`). Nothing in this file enforces payment — it is a pricing test and a service agreement, not a paywall; be straightforward about that.

Publish it so the QR has a public address. **Vercel** (recommended): import the repository; `vercel.json` makes Vercel run `npm run build` and serve `dist/`, so the app is at `https://<project>.vercel.app/`. **GitHub Pages** also works: `.github/workflows/pages.yml` deploys the static build on every push to `main` (one-time setup: repository **Settings → Pages → Build and deployment → Source: GitHub Actions**; the app is then at `https://<user>.github.io/<repo>/`). Pick one host and give sellers that address only. If you build codes on a computer that serves a `localhost` address, the page warns you and lets you set the public address under "Link details".

### Permanent links: publish the menu to Supabase (optional, recommended)

In link mode the menu lives inside the QR, so a price change means a reprint. With Supabase connected, step 3 gains a **Publish menu** button: the menu is stored in a `qr_menus` table and the QR points at a short permanent link such as `https://<site>/#s=mama-nkechi-kitchen-7k3`. The seller edits freely and taps **Publish changes**; every printed code shows the new menu. Permanent links also make the QR simpler (about 29×29 instead of 69×69) and keep the step 5 reminder messages tidy. Link mode keeps working as the fallback, and the customer page keeps the last fetched copy for the tab, so a flaky connection still shows a menu.

Publishing works with or without an account. Without one, publishing creates a random 26-character **edit key** that stays in the seller's browser (`localStorage`, next to the draft); the database stores only its SHA-256 hash. The table has RLS enabled with no policies and no grants to the API roles — the only doors are two functions: `get_qr_menu(slug)` (public read by slug, like a flyer) and `save_qr_menu(slug, edit_key, menu)` (creates the slug on first use, afterwards requires the same key; normalises the menu with the same limits as the page: 12 categories, 80 items, 40/24/60-character names, prices up to ₦9,999,999; 200 new menus per hour as a flood guard). If a seller loses the device, "Publish under a new link" gives them a fresh slug (old printed codes keep showing the old menu); you can rotate a key yourself in the SQL editor with `UPDATE qr_menus SET edit_key_hash = encode(sha256(convert_to('<new key>', 'UTF8')), 'hex') WHERE slug = '…'`.

Setup, two steps:

1. **Database:** apply the two QR-menu migrations **in order** — `supabase/migrations/20261003000000_qr_menus.sql`, then `supabase/migrations/20261004000000_qr_seller_accounts.sql` — either paste each into the Supabase dashboard → SQL editor → Run (both are standalone and safe to re-run), or `npm run supabase:link` then `npm run supabase:db:push`.
2. **Config:** `npm run build` inlines the public Supabase URL and anon/publishable key into `dist/index.html` from `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` (the names Vercel's Supabase integration sets — `SUPABASE_ANON_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` — are accepted too). On Vercel the integration adds them to the project and the next deployment picks them up; locally, copy `.env.example` to `.env`. The build refuses to inline a secret/service-role key. Without config the build simply stays in link mode and says so — and the page itself shows "Sign-up is not switched on for this address yet" in place of the account card, so a missing key is never a silent failure.

### Seller accounts: one permanent QR code per seller, bank details at checkout

With Supabase connected, the seller page opens with **Create account / Sign in** (Supabase Auth, email + password — a Gmail address is fine). Sign-up asks for name, **username**, phone number, email and password. The username is the seller's permanent code: the QR link becomes `https://<site>/#s=<username>` and is shown on the profile the moment the account exists (it goes live when the menu is published). Because the code is tied to the account, not to a device, the seller can sign in on any phone and edit or republish — no edit key to lose. A menu that was published anonymously before the account existed is moved to the username on the next publish, and the old link keeps receiving updates so codes already printed stay correct. Usernames are 3–24 lowercase letters, digits and dashes, unique, permanent, and a few words (`admin`, `menu`, `api`, …) are reserved.

Step 1 of the editor gains **Bank account for payments** (bank, 10-digit account number, account name — all three or none). Customers who scan the code see the menu, build an order, and at checkout choose **Bank transfer now** (the account number with a Copy button, the amount, and an order reference such as `JNP-7K3M` to put in the transfer note) or **Cash on pickup/delivery**. The WhatsApp order carries the same reference, so the seller matches the bank alert to the chat. Honest limit: this is a plain bank transfer, not an automatic payment check. Confirming payments automatically (and "scan to pay" with a bank app) needs a payment provider account — Paystack or Flutterwave — whose keys live in a Supabase Edge Function and whose webhook marks orders paid; that is the next step, built on top of this one. Phone numbers are stored but shown as "not verified yet": SMS codes switch on when a Termii (or Twilio) key is added to a server-side hook, never to the page.

What the migration does (`20261004000000_qr_seller_accounts.sql`): a `qr_sellers` table (one row per `auth.users` id, username unique, RLS on, no API grants), `owner_id` + bank columns on `qr_menus`, and four definer functions: `register_qr_seller(username, name, phone)` and `my_qr_seller()` for signed-in users only; `get_qr_menu(slug)` now returns the bank details and a `verified` flag; `save_qr_menu(slug, edit_key, menu)` accepts the owner from any device, keeps the anonymous edit-key path as the fallback, lets a key holder who signs in claim ownership, and refuses to publish under another account's username. Nothing in the page ever receives an edit-key hash or a secret key.

Supabase dashboard settings for sign-in links (one-time): **Authentication → URL configuration** → Site URL = your deployed app (e.g. `https://<project>.vercel.app/`) and add the same address under Redirect URLs — confirmation and password-reset emails land there and the page picks the session out of the link. Under **Authentication → Providers → Email**, either turn **Confirm email** off (sellers are signed in immediately) or keep it on and add your own SMTP under **Project settings → Auth**, because the built-in mailer only sends a handful of emails per hour. Google sign-in is the same mechanism (`/auth/v1/authorize?provider=google`) and can be added once a Google OAuth client exists.

Tests: `tests/qr-menu.test.mjs` covers the payload round trip (including the bank record), the built-in QR encoder across all 40 versions (decoded back with `jsqr`; the output is also bit-identical to the python-qrcode reference), the WhatsApp order link with transfer/cash payment lines, both views, the publish/update/fetch flow, and the account flows (sign-up with validation, permanent code on the profile, publish under the username, bank-transfer checkout with a reference, sign-out, sign-in on a second device that loads the published menu, moving an anonymous menu to the username, a taken username, and the confirm-email link) against a fake Data API + Auth API. `tests/qr-menus-sql.test.mjs` and `tests/qr-sellers-sql.test.mjs` run the real migrations in an in-process Postgres (PGlite) as the `anon` and `authenticated` roles: no direct table access, publish, wrong-key rejection, validation errors, limits, the flood guard, registration rules, ownership, bank normalisation, and the anonymous fallback.

Known limits, honestly: in link mode the menu is stored only in the seller's browser and in the link (keep the downloaded QR); anyone with a link can read the menu, the WhatsApp number and the bank details (like a flyer); long menus make dense codes unless published; there is no order history yet — WhatsApp is the record; payments are plain transfers until a payment provider is connected; riders are not part of the single-seller page yet.

## Design preview (`preview.html`) — the marketplace mock-up

The sections below describe `preview.html`, the original multi-seller marketplace mock-up that runs on demo data in the browser. It is the design reference for what comes next in the app (orders, riders, approvals); none of it talks to a server.

### Customer experience

- Scan or tap a table QR to open a seller's menu.
- Create a buyer account and order immediately; buyer registration does not wait for admin approval.
- Order food and non-alcoholic drinks, including Nigerian favourites such as zobo, Chapman, and kunu aya, plus international-style refreshments. Sellers can add their own food or drink categories and listings.
- Choose a quantity/portion count per item with no app-set cart quantity cap. A checkout is limited to one seller so payment goes to the correct account; use a separate checkout for another kitchen.
- Use the location button to request device location permission, then see sellers inside their stated delivery radius and the nearest approved rider. The browser can deny or withhold location; the site cannot force permission. Buyer coordinates are kept in page memory for that visit and are not saved with the order. Sellers/riders need map pins to appear in nearby results.
- Tag sellers with a distinctive award-style mark for in-app updates when they add food or drinks. Public rider profiles can also be tagged and rated.
- On checkout, choose pickup or delivery. Delivery uses the closest available approved rider within their service radius, adds their stated base fee to the seller's total, and shows the assigned job in the rider page and local seller/rider updates. This preview does not split or transfer the delivery fee to the rider.
- Browse seller profiles, menu-item details, ratings, comments, and seller contact buttons.

### Payments and contact

- Sellers can configure bank or wallet provider, account name, and account number, plus OPay or other checkout links. Buyers see the details on the separate payment screen. A manual transfer goes directly from the buyer to the seller's entered account.
- Buyers can select a receipt file and share it using the device share sheet. If file-sharing is unavailable, the app opens the seller's WhatsApp with a prefilled order message so the buyer can attach the receipt manually.
- The browser cannot silently forward an attachment to a WhatsApp account. Automatic WhatsApp receipt delivery requires a secure backend and WhatsApp Business API integration. Receipt files are not uploaded or saved in this preview; the seller must confirm payment.
- Seller phone and WhatsApp details are collected in the business application and appear on the public profile after activation.

### Seller verification and delivery riders

- A buyer can apply for seller mode from `#/business` and remains a buyer while the application is pending.
- The seller application asks for the full legal name, passport picture, seller profile picture, public business name, business address, city/neighborhood, phone or WhatsApp, optional map pin, delivery radius, and a short business description.
- Seller approval stays disabled until a secure verification service and protected admin review are connected. In this preview, image fields only validate the selected image in page memory: files are not uploaded or saved, and the local application queue only stores the form's text details in this browser. Do not use genuine passport or profile images here; use non-sensitive samples for testing. Buyer access and ordering remain available while a seller application is pending.
- Buyers and sellers can apply for rider/dispatch access from `#/rider-apply`. Applications request contact details, transport, service area, map pin, service radius, and base fee. An admin review activates the rider profile.
- `#/riders` is the public rider directory. Search available approved riders by name, neighborhood/service area, or transport; use browser location permission to sort by distance and see who is inside their service radius. It is linked from the site navigation and the delivery checkout. `#/rider-profile/{id}` is a public rider profile with tags, ratings, and contact details.
- `#/rider` is the rider portal/dashboard for applications, availability, incoming jobs, and delivery status. From checkout, buyers can open the directory and choose a rider who is available within the current location range.
- `#/admin` — review seller and rider applications. Rider approvals, orders, delivery updates, tags, and reviews are browser-local workflow previews, not protected or shared services.
- Verified sellers can edit their public profile/contact/location, add food or drink listings, configure payment options, make payment requests, and review payment notices. Sellers can define custom categories, use automatic category artwork (no food photo/video upload), and edit each menu item no more than once every two hours.

## Run or build locally

The static browser app is self-contained and can be served without installed packages. For checks, tests, and the Supabase scaffold, install the locked dependencies first. Use Node.js 20 or newer:

```sh
npm ci
npm run check
npm test
npm run build
npm start
```

Then open `http://localhost:4173` (the app) or `http://localhost:4173/preview.html` (design preview with demo data). The `dist/` build contains the app, the redirect and the preview; the included Node server serves them and falls back to the source files if you skip the build. For a quick alternative, run `python3 -m http.server 8000` and open `http://localhost:8000`.

The app's accounts, rider search, orders, and other flows are still browser-local previews. Starting or building the static app does not create the secure shared backend needed for live rider dispatch, payment processing, seller verification, or cross-device notifications.

### Android APK (Capacitor)

The project now includes a Capacitor 7 Android wrapper (`android/`) using app ID `com.juniperfood.app`. The checked-in `Juniper-Food-debug.apk` is a signed, installable debug APK (min Android 6.0 / API 23; target API 35). For a local rebuild, install Node.js, JDK 21, and Android SDK platform/build tools 35, then set `JAVA_HOME`, `ANDROID_HOME`, and `ANDROID_SDK_ROOT`:

```sh
npm ci
npm run android:apk
```

The script rebuilds the static app, syncs Capacitor, runs Gradle, and copies the APK into the project root. The debug APK uses the Android debug signing key and is for sideload testing; it is not a Play Store release and cannot be used for a production update signature. A production release needs a private release keystore and signing configuration that is never committed to source.

The APK keeps the current browser-local storage workflows. It does not connect the app flows to Supabase, and no Supabase project is linked or deployed. AppDeploy has not been authorized in this session; its documented target is hosted web apps/PWAs, not native APK generation. It could host a web/PWA build after its connector and OAuth are set up, but that is separate from the APK build.

### Supabase backend scaffold

Supabase is the selected backend. The repository includes `supabase/config.toml`, a Postgres migration with RLS, a private seller-verification bucket, and an Edge Function starter. This is not deployed or connected to the browser app: no Supabase project is linked, and sign-in, orders, applications, admin review, and other flows remain browser-local. See [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) for setup and remaining integration work. The publishable/anon key can be used by a client only with reviewed RLS; never put a service-role key or database password in the app.

Supabase provides the backend services, but the static website still needs a separate web host (Vercel via `vercel.json`, or GitHub Pages). The one live use of Supabase today is the single-seller QR menu's permanent links (see above); `npm start` / `npm run dev` enable them when `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEY` are set in the environment or in `.env`.

### Publish this source to GitHub

From the project folder on a machine signed in to GitHub with the GitHub CLI (`gh`):

```sh
git init -b main
git add .
git commit -m "Initial Juniper food ordering app"
gh auth login
gh repo create juniper-food-ordering --private --source=. --remote=origin --push
```

Use `--public` instead of `--private` if you want a public repository. The included GitHub Actions workflow runs the app checks, tests, and static build on pushes and pull requests. Never commit account tokens, `.env` secrets, or real identity documents.

## Production requirements and limitations

All accounts, applications, profiles, payment settings, reviews, rider assignments, orders, tags, and local notifications use this browser's storage. They are not shared between devices and do not provide secure access control. The admin screen is not protected. The preview only records seller form text locally; selected images are never uploaded or persisted, so the local admin queue has not received or verified identity documents. Do not submit genuine identity images here. Production needs an HTTPS backend, server-side authentication and roles, protected admin endpoints, shared persistence, verified business/rider locations, and a secure seller verification workflow. Handle passport/profile images through private encrypted storage with access controls, upload validation, audit logging, and documented retention/deletion; do not put them in browser localStorage. Only a protected server-side verification result should enable seller tools.

### Seller verification configuration for production

1. Deploy an HTTPS backend and database. Persist the application text (legal name, business name/address, locality, contact, map pin, and description) against the signed-in account. Keep the verification state server-side, with statuses such as `draft`, `pending`, `verified`, `rejected`, and `needs_review`.
2. Add authenticated upload endpoints for the passport image and separate profile image. Use short-lived, applicant-scoped upload URLs or a server upload proxy to a private encrypted object bucket. Validate actual file type and size, scan uploads, block public access, and define access logs plus retention/deletion rules. Never place image bytes or public document URLs in localStorage or a customer-visible profile response.
3. Select a verification provider that supports the passport/document check for the countries you serve and the data-minimization level you need. Configure its server-side API key in secret storage, document-image handling, callback URL, and signed webhook secret. Get explicit applicant consent and show the provider's privacy/retention notice before transmitting documents.
4. Protect the admin application queue with server-side admin roles and MFA. Receive and verify provider callbacks on the server, match the result to the correct application, and record an auditable status/reviewer/timestamp. Enable seller tools only from a server-verified result plus the required admin decision; never trust a browser-set flag. Keep the current client-side approval gate off until all of this is implemented and tested.
5. Replace the preview's file-input handler with the backend upload flow, return only an application ID/status to the browser, and test denial, provider timeout, duplicate callbacks, access revocation, and deletion. Provider credentials and admin secrets must never ship in `index.html`.

Location matching uses user-consented browser coordinates and seller/rider-provided map pins with a distance calculation; a production map/geocoding service is needed for address lookup and dispatch reliability. In-app notifications do not reach other devices; real push/SMS/WhatsApp notices need a backend and customer permission.

The payment screen can display seller-entered bank/wallet details and OPay links, but no payment provider is connected here. The app cannot confirm bank transfers or move money. For live payments, integrate a licensed provider, keep credentials server-side, create payment intents securely, and mark orders paid only after verified callbacks or bank reconciliation.
