import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../preview.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(match, 'preview.html must contain the demo script');
new vm.Script(match[1], { filename: 'preview.html inline demo script' });
assert.match(html, /function renderRiderSearch\(\)/, 'rider directory should be wired');
assert.match(html, /state\.route\.path === '\/riders'/, 'rider directory route should be reachable');
assert.match(html, /data-action="select-rider-for-delivery"/, 'checkout rider selection should be available');
assert.doesNotMatch(html, /href="#\/rider\/\$\{encodeURIComponent\(selectedRider\.id\)\}"/, 'checkout rider profile link must use the rider-profile route');
assert.match(html, /\.modal-card \{[^}]*max-height: calc\(100dvh - 40px\)[^}]*overflow-y: auto/, 'account/seller-application dialogs must fit the screen and scroll (submit button reachable on phones)');

const menuHtml = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(html, /Design preview with demo data/, 'the demo must say it is a demo and link to the real app');
const redirect = await readFile(new URL('../menu.html', import.meta.url), 'utf8');
assert.match(redirect, /location\.replace\('\.\/' \+ location\.search \+ location\.hash\)/, 'menu.html must redirect old QR links to the root and keep the #s=/#m= part');
const menuMatch = menuHtml.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(menuMatch, 'index.html must contain the Juniper app script');
new vm.Script(menuMatch[1], { filename: 'index.html inline script' });
assert.match(menuHtml, /const PLAN = \{/, 'index.html must keep the editable PLAN block');
assert.match(menuHtml, /function decodePayload\(/, 'index.html must decode menus from the link');
assert.match(menuHtml, /function encodeQr\(/, 'index.html must ship its own QR encoder');
assert.doesNotMatch(menuHtml, /<script[^>]+src=/i, 'index.html must stay self-contained (no external scripts)');
assert.match(menuHtml, /\/\*JUNIPER_CONFIG_START\*\/null\/\*JUNIPER_CONFIG_END\*\//, 'index.html source must ship without Supabase config (the build inlines it)');
assert.doesNotMatch(menuHtml, /[a-z0-9]{20}\.supabase\.co|eyJhbGciOi|sb_(publishable|secret)_[A-Za-z0-9]/i, 'index.html source must not contain Supabase project URLs or keys');

const qrMenusMigration = await readFile(new URL('../supabase/migrations/20261003000000_qr_menus.sql', import.meta.url), 'utf8');
assert.match(qrMenusMigration, /CREATE TABLE IF NOT EXISTS public\.qr_menus/i, 'hosted QR menus table must exist');
assert.match(qrMenusMigration, /ALTER TABLE public\.qr_menus ENABLE ROW LEVEL SECURITY/i, 'qr_menus must have RLS enabled');
assert.match(qrMenusMigration, /REVOKE ALL ON TABLE public\.qr_menus FROM PUBLIC, anon, authenticated/i, 'API roles must not touch qr_menus directly');
assert.doesNotMatch(qrMenusMigration, /CREATE POLICY/i, 'qr_menus must be reachable only through the RPC functions, not policies');
assert.match(qrMenusMigration, /FUNCTION public\.get_qr_menu\(p_slug TEXT\)[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/i, 'get_qr_menu must be a definer function with a fixed search_path');
assert.match(qrMenusMigration, /FUNCTION public\.save_qr_menu\(p_slug TEXT, p_edit_key TEXT, p_menu JSONB\)[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/i, 'save_qr_menu must be a definer function with a fixed search_path');
assert.match(qrMenusMigration, /sha256\(convert_to\(p_edit_key, 'UTF8'\)\)/, 'edit keys must be stored hashed');

const sellersMigration = await readFile(new URL('../supabase/migrations/20261004000000_qr_seller_accounts.sql', import.meta.url), 'utf8');
assert.match(sellersMigration, /CREATE TABLE IF NOT EXISTS public\.qr_sellers/i, 'seller accounts table must exist');
assert.match(sellersMigration, /REFERENCES auth\.users\s*\(id\)\s+ON DELETE CASCADE/i, 'seller rows must hang off Supabase Auth users');
assert.match(sellersMigration, /ALTER TABLE public\.qr_sellers ENABLE ROW LEVEL SECURITY/i, 'qr_sellers must have RLS enabled');
assert.match(sellersMigration, /REVOKE ALL ON TABLE public\.qr_sellers FROM PUBLIC, anon, authenticated/i, 'API roles must not touch qr_sellers directly');
assert.match(sellersMigration, /ADD COLUMN IF NOT EXISTS owner_id UUID/i, 'published menus must be ownable by an account');
for (const fn of ['register_qr_seller', 'my_qr_seller', 'get_qr_menu', 'save_qr_menu']) {
  assert.match(sellersMigration, new RegExp(`FUNCTION public\\.${fn}\\([^)]*\\)[\\s\\S]*?SECURITY DEFINER\\s+SET search_path = ''`, 'i'), `${fn} must be a definer function with a fixed search_path`);
}
for (const fn of ['register_qr_seller\\(TEXT, TEXT, TEXT\\)', 'my_qr_seller\\(\\)']) {
  assert.match(sellersMigration, new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn} FROM PUBLIC`, 'i'), `${fn} must drop the default PUBLIC execute grant`);
  assert.match(sellersMigration, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${fn} TO authenticated, service_role;`, 'i'), `${fn} must be callable by signed-in users only (no anon)`);
}
assert.match(sellersMigration, /auth\.uid\(\)/, 'account functions must key off the signed-in user');
assert.doesNotMatch(sellersMigration, /edit_key_hash'?\s*,\s*(v_row|r)\.edit_key_hash/i, 'edit key hashes must never be returned to clients');
assert.match(menuHtml, /location\.pathname\.replace\(\/\(index\|menu\)\\\.html\$\/, ''\)/, 'links and QR codes must use the site root');
assert.match(menuHtml, /id="account-form"/, 'index.html must ship the seller account form');
assert.match(menuHtml, /rpc\/register_qr_seller/, 'index.html must register sellers through the RPC');
assert.doesNotMatch(menuHtml, /service_role|sb_secret_[A-Za-z0-9]/, 'index.html must never reference secret keys');

const vercel = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(vercel.buildCommand, 'npm run build', 'Vercel must run the build so Supabase config is inlined');
assert.equal(vercel.outputDirectory, 'dist', 'Vercel must serve the built dist/ folder');

const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
assert.match(config, /project_id = "juniper-food-ordering"/, 'Supabase project config must use the Juniper project id');
assert.match(config, /\[functions\.api\]/, 'Supabase API function must be configured');
const migration = await readFile(new URL('../supabase/migrations/20261002000000_initial_schema.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS profiles/i, 'Supabase schema must contain app profiles');
assert.match(migration, /CREATE TABLE IF NOT EXISTS rider_profiles/i, 'Supabase schema must contain rider profiles');
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i, 'Supabase business tables must have RLS enabled');
assert.match(migration, /INTERVAL '2 hours'/i, 'Supabase schema must enforce the menu edit interval');
console.log('Juniper app (index.html), demo preview, menu.html redirect, dialog scrolling, hosted-menu + seller-account migrations, Vercel config, and Supabase scaffold checks passed.');
