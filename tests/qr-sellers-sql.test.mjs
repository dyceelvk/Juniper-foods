// Seller accounts migration against a real Postgres (PGlite): runs both QR migrations in order with a stub of
// Supabase's auth schema, then exercises registration, ownership, bank details, and the anonymous fallback.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const base = await readFile(new URL('../supabase/migrations/20261003000000_qr_menus.sql', import.meta.url), 'utf8');
const accounts = await readFile(new URL('../supabase/migrations/20261004000000_qr_seller_accounts.sql', import.meta.url), 'utf8');
const db = new PGlite();
await db.exec(`
  CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (id UUID PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS UUID LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  INSERT INTO auth.users VALUES ('11111111-1111-1111-1111-111111111111'), ('22222222-2222-2222-2222-222222222222');
`);
await db.exec(base);
await db.exec(accounts);
await db.exec(accounts); // re-runnable

const ADA = '11111111-1111-1111-1111-111111111111', BOLA = '22222222-2222-2222-2222-222222222222';
const as = async (role, uid = '') => { await db.exec('RESET ROLE'); await db.query('SELECT set_config($1, $2, false)', ['request.jwt.claim.sub', uid]); await db.exec(`SET ROLE ${role}`); };
const q = async (sql, params = []) => (await db.query(sql, params)).rows;
const fails = async (sql, params, code, why) => {
  try { await db.query(sql, params); } catch (error) { assert.equal(error.code || error.message, code, `${why}: ${error.message}`); return error; }
  assert.fail(`${why}: expected an error`);
};
const menu = { name: 'Mama Nkechi Kitchen', whatsapp: '2348012345678', categories: [{ name: 'Rice', items: [{ name: 'Jollof rice', price: 2500 }] }] };
const withBank = { ...menu, bank: { bankName: 'GTBank', accountName: 'Nkechi Okoro', accountNumber: '0123 456 789' } };

// ---- Anonymous visitors: no account functions, publishing by edit key still works ----
await as('anon');
await fails('SELECT public.my_qr_seller()', [], '42501', 'anon cannot call my_qr_seller');
await fails("SELECT public.register_qr_seller('ada', 'Ada', '')", [], '42501', 'anon cannot register');
await fails('SELECT * FROM public.qr_sellers', [], '42501', 'anon cannot read accounts');
const anonKey = 'anon-device-key-k7mq2v9xz4rt8bnc';
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['chop-life-7k3', anonKey, JSON.stringify(withBank)]))[0].r.version, 1, 'anonymous publish with key');
const anonMenu = (await q('SELECT public.get_qr_menu($1) AS m', ['chop-life-7k3']))[0].m;
assert.deepEqual(anonMenu.bank, { bankName: 'GTBank', accountName: 'Nkechi Okoro', accountNumber: '0123456789' }, 'bank details are normalised and public');
assert.equal(anonMenu.verified, false, 'menus without an account are not marked verified');
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['chop-life-7k3', anonKey, JSON.stringify({ ...menu, bank: { bankName: 'GTBank', accountName: '', accountNumber: '0123456789' } })], '22023', 'partial bank details are rejected');
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['chop-life-7k3', anonKey, JSON.stringify({ ...menu, bank: { bankName: 'GTBank', accountName: 'X', accountNumber: '12345' } })], '22023', 'account numbers must have 10 digits');
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['new-one-abc', null, JSON.stringify(menu)], '22023', 'anon needs an edit key');

// ---- Ada signs up ----
await as('authenticated', ADA);
assert.equal((await q('SELECT public.my_qr_seller() AS me'))[0].me, null, 'no account yet');
await fails("SELECT public.register_qr_seller('Ad', 'Ada Obi', '')", [], '22023', 'short username');
await fails("SELECT public.register_qr_seller('ada obi', 'Ada Obi', '')", [], '22023', 'spaces in username');
await fails("SELECT public.register_qr_seller('admin', 'Ada Obi', '')", [], '22023', 'reserved username');
await fails("SELECT public.register_qr_seller('ada-obi', '', '')", [], '22023', 'name required');
await fails("SELECT public.register_qr_seller('ada-obi', 'Ada', '12')", [], '22023', 'phone must be complete');
await fails("SELECT public.register_qr_seller('chop-life-7k3', 'Ada', '')", [], '23505', 'cannot take a slug someone else published');
const ada = (await q("SELECT public.register_qr_seller('Ada-Obi ', 'Ada  Obi', '0801 234 5678') AS me"))[0].me;
assert.equal(ada.username, 'ada-obi');
assert.equal(ada.name, 'Ada Obi');
assert.equal(ada.phone, '08012345678', 'digits are kept as sent (the page normalises to 234…)');
assert.equal(ada.phoneVerified, false);
assert.deepEqual(ada.menus, []);
const again = (await q("SELECT public.register_qr_seller('something-else', 'Ada O.', '2348012345678') AS me"))[0].me;
assert.equal(again.username, 'ada-obi', 'username is permanent; later calls only refresh name/phone');
assert.equal(again.name, 'Ada O.');
assert.equal(again.phone, '2348012345678');

// ---- Ada publishes under her username, no edit key needed ----
const published = (await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['ada-obi', null, JSON.stringify(withBank)]))[0].r;
assert.equal(published.slug, 'ada-obi');
const me = (await q('SELECT public.my_qr_seller() AS me'))[0].me;
assert.equal(me.menus.length, 1);
assert.equal(me.menus[0].slug, 'ada-obi');
assert.equal(me.menus[0].verified, true, 'account-owned menus are verified');
assert.equal(me.menus[0].bank.accountNumber, '0123456789');
assert.equal(me.menus[0].edit_key_hash, undefined, 'hash never leaves the database');
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['ada-obi', null, JSON.stringify({ ...withBank, name: 'Ada Obi Foods' })]))[0].r.version, 2, 'owner updates without a key');
await as('anon');
assert.equal((await q('SELECT public.get_qr_menu($1) AS m', ['ada-obi']))[0].m.name, 'Ada Obi Foods', 'customers read the published menu by username');
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['ada-obi', 'guessing-a-key-that-is-long-enough', JSON.stringify(menu)], '42501', 'strangers cannot overwrite an owned menu');

// ---- Bola cannot touch Ada's things, and cannot squat her username ----
await as('authenticated', BOLA);
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['ada-obi', null, JSON.stringify(menu)], '42501', 'another account cannot edit her menu');
await fails("SELECT public.register_qr_seller('ada-obi', 'Bola', '')", [], '23505', 'usernames are unique');
const bola = (await q("SELECT public.register_qr_seller('bola', 'Bola Ade', '') AS me"))[0].me;
assert.equal(bola.username, 'bola');
await as('anon');
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['bola', anonKey, JSON.stringify(menu)], '42501', 'nobody can publish under a registered username but its owner');

// ---- A key holder who signs in claims the menu; the key keeps working too ----
await as('authenticated', BOLA);
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['chop-life-7k3', anonKey, JSON.stringify(menu)]))[0].r.version, 2, 'signed-in key holder can update');
const bolaMe = (await q('SELECT public.my_qr_seller() AS me'))[0].me;
assert.deepEqual(bolaMe.menus.map(m => m.slug), ['chop-life-7k3'], 'the anonymous menu is now owned by Bola');
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['chop-life-7k3', null, JSON.stringify(menu)]))[0].r.version, 3, 'and editable by ownership alone');
await as('anon');
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['chop-life-7k3', anonKey, JSON.stringify(menu)]))[0].r.version, 4, 'the original device key still works');
await as('authenticated', ADA);
await fails('SELECT public.save_qr_menu($1, $2, $3)', ['chop-life-7k3', null, JSON.stringify(menu)], '42501', 'ownership is not transferable by another account');
assert.equal((await q('SELECT public.save_qr_menu($1, $2, $3) AS r', ['ada-second-spot', null, JSON.stringify(menu)]))[0].r.version, 1, 'an account can own several menus');
assert.deepEqual((await q('SELECT public.my_qr_seller() AS me'))[0].me.menus.map(m => m.slug).sort(), ['ada-obi', 'ada-second-spot']);

await db.close();
console.log('Seller account migration checks passed (registration, permanent usernames, ownership, bank details, anonymous fallback).');
