import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const migration = await readFile(new URL('../supabase/migrations/20261002000000_initial_schema.sql', import.meta.url), 'utf8');
const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
const functionSource = await readFile(new URL('../supabase/functions/api/index.ts', import.meta.url), 'utf8');
const envExample = await readFile(new URL('../.env.example', import.meta.url), 'utf8');

assert.match(migration, /REFERENCES auth\.users\(id\)/i, 'profiles must be tied to Supabase Auth');
assert.match(migration, /role TEXT NOT NULL DEFAULT 'buyer'/i, 'new app users must start as buyers');
assert.match(migration, /handle_new_auth_user/i, 'Supabase Auth signups must create buyer profiles');
assert.match(migration, /ENABLE ROW LEVEL SECURITY/i, 'business tables must use RLS');
assert.match(migration, /seller_applications_insert_owner/i, 'seller applications must be owner-scoped');
assert.match(migration, /rider_applications_insert_owner/i, 'rider applications must be owner-scoped');
assert.match(migration, /INTERVAL '2 hours'/i, 'menu edits must be rate-limited to two hours');
const bucketSeed = migration.match(/INSERT INTO storage\.buckets[\s\S]*?ON CONFLICT \(id\)/i)?.[0] || '';
assert.match(bucketSeed, /'seller-verification'/i, 'verification bucket must be declared');
assert.match(bucketSeed, /FALSE/i, 'seller verification storage must be private');
assert.match(migration, /payment_status TEXT NOT NULL DEFAULT 'unconfirmed'/i, 'bank transfers must not be treated as confirmed');
assert.doesNotMatch(migration, /national[_ ]?identity|\bNIN\b/i, 'schema must not add a national identity number field');

const menuTable = migration.match(/CREATE TABLE IF NOT EXISTS menu_items \([\s\S]*?\n\);/i)?.[0] || '';
assert.ok(menuTable, 'menu_items table must exist');
assert.doesNotMatch(menuTable, /\b(photo|image|video|media_url)\b/i, 'food media uploads must not be added to listings');

assert.match(config, /project_id = "juniper-food-ordering"/);
assert.match(config, /\[functions\.api\]/);
assert.match(config, /verify_jwt = false/);
assert.match(functionSource, /auth\.getUser\(\)/, 'private profile route must verify the Supabase Auth user');
assert.match(functionSource, /approval_status/, 'public rider search must be approval-gated');
assert.match(functionSource, /JUNIPER_ALLOWED_ORIGINS/, 'CORS must use an origin allowlist');
assert.doesNotMatch(envExample, /SERVICE_ROLE|DATABASE_PASSWORD|SUPABASE_ACCESS_TOKEN/i, 'example env must not contain privileged credentials');

console.log('Supabase schema, RLS, approval gates, private storage, and API scaffold checks passed.');
