import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const match = html.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(match, 'index.html must contain the app script');
new vm.Script(match[1], { filename: 'index.html inline app script' });
assert.match(html, /function renderRiderSearch\(\)/, 'rider directory should be wired');
assert.match(html, /state\.route\.path === '\/riders'/, 'rider directory route should be reachable');
assert.match(html, /data-action="select-rider-for-delivery"/, 'checkout rider selection should be available');
assert.doesNotMatch(html, /href="#\/rider\/\$\{encodeURIComponent\(selectedRider\.id\)\}"/, 'checkout rider profile link must use the rider-profile route');

const menuHtml = await readFile(new URL('../menu.html', import.meta.url), 'utf8');
const menuMatch = menuHtml.match(/<script>([\s\S]*?)<\/script>/i);
assert.ok(menuMatch, 'menu.html must contain the QR menu script');
new vm.Script(menuMatch[1], { filename: 'menu.html inline script' });
assert.match(menuHtml, /const PLAN = \{/, 'menu.html must keep the editable PLAN block');
assert.match(menuHtml, /function decodePayload\(/, 'menu.html must decode menus from the link');
assert.match(menuHtml, /function encodeQr\(/, 'menu.html must ship its own QR encoder');
assert.doesNotMatch(menuHtml, /<script[^>]+src=/i, 'menu.html must stay self-contained (no external scripts)');
assert.match(menuHtml, /\/\*JUNIPER_CONFIG_START\*\/null\/\*JUNIPER_CONFIG_END\*\//, 'menu.html source must ship without Supabase config (the build inlines it)');
assert.doesNotMatch(menuHtml, /[a-z0-9]{20}\.supabase\.co|eyJhbGciOi|sb_(publishable|secret)_[A-Za-z0-9]/i, 'menu.html source must not contain Supabase project URLs or keys');

const qrMenusMigration = await readFile(new URL('../supabase/migrations/20261003000000_qr_menus.sql', import.meta.url), 'utf8');
assert.match(qrMenusMigration, /CREATE TABLE IF NOT EXISTS public\.qr_menus/i, 'hosted QR menus table must exist');
assert.match(qrMenusMigration, /ALTER TABLE public\.qr_menus ENABLE ROW LEVEL SECURITY/i, 'qr_menus must have RLS enabled');
assert.match(qrMenusMigration, /REVOKE ALL ON TABLE public\.qr_menus FROM PUBLIC, anon, authenticated/i, 'API roles must not touch qr_menus directly');
assert.doesNotMatch(qrMenusMigration, /CREATE POLICY/i, 'qr_menus must be reachable only through the RPC functions, not policies');
assert.match(qrMenusMigration, /FUNCTION public\.get_qr_menu\(p_slug TEXT\)[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/i, 'get_qr_menu must be a definer function with a fixed search_path');
assert.match(qrMenusMigration, /FUNCTION public\.save_qr_menu\(p_slug TEXT, p_edit_key TEXT, p_menu JSONB\)[\s\S]*?SECURITY DEFINER\s+SET search_path = ''/i, 'save_qr_menu must be a definer function with a fixed search_path');
assert.match(qrMenusMigration, /sha256\(convert_to\(p_edit_key, 'UTF8'\)\)/, 'edit keys must be stored hashed');

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
console.log('Juniper app syntax, QR menu, hosted-menu migration, Vercel config, and Supabase scaffold checks passed.');
