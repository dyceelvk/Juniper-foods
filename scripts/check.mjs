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

const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
assert.match(config, /project_id = "juniper-food-ordering"/, 'Supabase project config must use the Juniper project id');
assert.match(config, /\[functions\.api\]/, 'Supabase API function must be configured');
const migration = await readFile(new URL('../supabase/migrations/20261002000000_initial_schema.sql', import.meta.url), 'utf8');
assert.match(migration, /CREATE TABLE IF NOT EXISTS profiles/i, 'Supabase schema must contain app profiles');
assert.match(migration, /CREATE TABLE IF NOT EXISTS rider_profiles/i, 'Supabase schema must contain rider profiles');
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i, 'Supabase business tables must have RLS enabled');
assert.match(migration, /INTERVAL '2 hours'/i, 'Supabase schema must enforce the menu edit interval');
console.log('Juniper app syntax, QR menu, and Supabase scaffold checks passed.');
