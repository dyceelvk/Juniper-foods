// Runs the hosted QR menu migration against a real Postgres (PGlite, in-process) and exercises it the
// way the Supabase Data API would: as the `anon` role, through the two RPC functions only.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const migration = await readFile(new URL('../supabase/migrations/20261003000000_qr_menus.sql', import.meta.url), 'utf8');
const db = new PGlite();
// Supabase ships these roles; a plain Postgres does not.
await db.exec('CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;');
await db.exec(migration);
await db.exec(migration); // idempotent: the file can be re-applied without errors
await db.exec('SET ROLE anon');

const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const rpcFails = async (sql, params, code, why) => {
  try { await db.query(sql, params); } catch (error) { assert.equal(error.code || error.message, code, `${why}: ${error.message}`); return error; }
  assert.fail(`${why}: expected an error`);
};

// ---- No direct table access for API roles ----
await rpcFails('SELECT * FROM public.qr_menus', [], '42501', 'anon must not read the table (hash column) directly');
await rpcFails("INSERT INTO public.qr_menus (slug, name, whatsapp, edit_key_hash) VALUES ('x-1', 'X', '2348000000000', repeat('a', 64))", [], '42501', 'anon must not insert directly');

// ---- Publish ----
const key = 'k7mq2v9xz4rt8bnc3hdp6wfy5sgj';
const menu = {
  name: '  Mama   Nkechi Kitchen  ', whatsapp: '2348012345678', tagline: 'Wuse 2, Abuja', pickup: true, delivery: false,
  categories: [
    { name: 'Rice', items: [{ name: 'Jollof rice', price: 2500, note: 'party style' }, { name: '', price: 1 }, { name: 'Fried rice', price: '3000', note: '' }] },
    { name: 'Empty', items: [] },
    'not a category',
    { name: 'Drinks', items: [{ name: 'Zobo', price: 'free', note: 'x'.repeat(100) }, { name: 'Gold water', price: 99999999999 }] }
  ]
};
assert.equal((await q('SELECT public.get_qr_menu($1) AS m', ['mama-nkechi-7k3']))[0].m, null, 'unknown slug returns null');
const published = (await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['Mama-Nkechi-7k3 ', key, JSON.stringify(menu)]))[0].r;
assert.equal(published.slug, 'mama-nkechi-7k3');
assert.equal(published.version, 1);

const stored = (await q('SELECT public.get_qr_menu($1) AS m', ['mama-nkechi-7k3']))[0].m;
assert.equal(stored.name, 'Mama Nkechi Kitchen', 'whitespace is collapsed');
assert.equal(stored.whatsapp, '2348012345678');
assert.equal(stored.pickup, true);
assert.equal(stored.delivery, false);
assert.equal(stored.edit_key_hash, undefined, 'the hash must never be returned');
assert.deepEqual(stored.categories.map(category => category.name), ['Rice', 'Drinks'], 'empty and malformed categories are dropped');
assert.deepEqual(stored.categories[0].items, [{ name: 'Jollof rice', price: 2500, note: 'party style' }, { name: 'Fried rice', price: 3000, note: '' }], 'nameless items drop, string prices parse');
assert.equal(stored.categories[1].items[0].price, 0, 'non-numeric prices become 0 (ask for price)');
assert.equal(stored.categories[1].items[0].note.length, 60, 'notes are clamped to 60 characters');
assert.equal(stored.categories[1].items[1].price, 9999999, 'prices are clamped');

// ---- Update needs the same key; wrong key = taken/mismatch ----
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['mama-nkechi-7k3', 'another-key-that-is-long', JSON.stringify(menu)], '42501', 'a different key must be rejected');
const updated = (await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['mama-nkechi-7k3', key, JSON.stringify({ ...menu, name: 'Mama Nkechi Kitchen & Grill', pickup: 'maybe', delivery: undefined })]))[0].r;
assert.equal(updated.version, 2, 'updates bump the version');
const after = (await q('SELECT public.get_qr_menu($1) AS m', ['mama-nkechi-7k3']))[0].m;
assert.equal(after.name, 'Mama Nkechi Kitchen & Grill');
assert.equal(after.pickup, true, 'anything but false counts as true');
assert.equal(after.delivery, true, 'a missing flag defaults to true');
assert.equal(after.version, 2);

// ---- Validation messages are friendly 400s ----
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['Bad Slug!', key, JSON.stringify(menu)], '22023', 'invalid slug');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ab', key, JSON.stringify(menu)], '22023', 'too-short slug');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ok-slug-1', 'short', JSON.stringify(menu)], '22023', 'short edit key');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ok-slug-1', key, JSON.stringify({ ...menu, name: '   ' })], '22023', 'missing name');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ok-slug-1', key, JSON.stringify({ ...menu, whatsapp: '12' })], '22023', 'bad WhatsApp number');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ok-slug-1', key, JSON.stringify({ ...menu, categories: 'nope' })], '22023', 'categories must be an array');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ok-slug-1', key, JSON.stringify({ ...menu, categories: [{ name: 'X', items: [{ name: '' }] }] })], '22023', 'at least one item');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['ok-slug-1', key, '"just a string"'], '22023', 'menu must be an object');

// ---- Limits: 12 categories / 80 items, 24/40-character names ----
const huge = { name: 'x'.repeat(100), whatsapp: '2348000000000', categories: Array.from({ length: 20 }, (_, ci) => ({ name: `Category number ${ci} with a long name`, items: Array.from({ length: 10 }, (_, ii) => ({ name: `Item ${ci}-${ii} ${'y'.repeat(60)}`, price: 100 })) })) };
await q('SELECT public.save_qr_menu($1, $2, $3)', ['big-buka-2x9', key, JSON.stringify(huge)]);
const big = (await q('SELECT public.get_qr_menu($1) AS m', ['big-buka-2x9']))[0].m;
assert.equal(big.name.length, 40);
assert.ok(big.categories.length <= 12, 'category cap');
assert.equal(big.categories.reduce((sum, category) => sum + category.items.length, 0), 80, 'item cap');
assert.ok(big.categories.every(category => category.name.length <= 24 && category.items.every(item => item.name.length <= 40)), 'name caps');

// ---- Flood guard: 200 new menus per hour, updates unaffected ----
await db.exec('RESET ROLE');
await db.exec(`INSERT INTO public.qr_menus (slug, name, whatsapp, edit_key_hash) SELECT 'flood-' || g, 'Flood', '2348000000000', repeat('0', 64) FROM generate_series(1, 200) g`);
await db.exec('SET ROLE anon');
await rpcFails('SELECT public.save_qr_menu($1, $2, $3)', ['one-more-abc', key, JSON.stringify(menu)], '53400', 'new menus are throttled');
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['mama-nkechi-7k3', key, JSON.stringify(menu)]))[0].r.version, 3, 'existing menus can still be updated during a flood');
await db.exec('RESET ROLE');
await db.exec(`UPDATE public.qr_menus SET created_at = now() - INTERVAL '2 hours' WHERE slug LIKE 'flood-%'`);
await db.exec('SET ROLE anon');
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['one-more-abc', key, JSON.stringify(menu)]))[0].r.version, 1, 'the window slides');

await db.close();
console.log('Hosted QR menu migration checks passed (table locked down, RPC publish/update/validation, limits, flood guard).');
