// Build-time Supabase config for menu.html (the QR-menu app): env var aliases, secret-key refusal, placeholder injection.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolveConfig, safeResolveConfig, injectConfig, jwtRole, readDotEnv } from '../scripts/juniper-config.mjs';

const anonJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'anon', iss: 'supabase' })).toString('base64url')}.sig`;
const serviceJwt = `eyJhbGciOiJIUzI1NiJ9.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.sig`;

assert.equal(resolveConfig({}), null, 'no env → link mode');
assert.deepEqual(resolveConfig({ SUPABASE_URL: 'https://abc.supabase.co/', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }), { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'sb_publishable_x' }, 'repo names work, trailing slash trimmed');
assert.deepEqual(resolveConfig({ NEXT_PUBLIC_SUPABASE_URL: 'https://abc.supabase.co', NEXT_PUBLIC_SUPABASE_ANON_KEY: anonJwt }), { supabaseUrl: 'https://abc.supabase.co', supabaseKey: anonJwt }, 'Vercel integration names work');
assert.deepEqual(resolveConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: anonJwt, SUPABASE_SERVICE_ROLE_KEY: serviceJwt }), { supabaseUrl: 'https://abc.supabase.co', supabaseKey: anonJwt }, 'the service-role variable is ignored when a public key exists');
assert.equal(jwtRole(serviceJwt), 'service_role');
assert.throws(() => resolveConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: serviceJwt }), /secret\/service-role/, 'a service-role JWT in the public slot is refused');
assert.throws(() => resolveConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: 'sb_secret_abc' }), /secret\/service-role/, 'new-style secret keys are refused');
assert.throws(() => resolveConfig({ SUPABASE_URL: 'https://abc.supabase.co' }), /no public key/, 'URL without key is reported');
assert.throws(() => resolveConfig({ SUPABASE_URL: 'abc.supabase.co', SUPABASE_ANON_KEY: anonJwt }), /must look like/, 'URL must be https');
assert.throws(() => resolveConfig({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_ANON_KEY: anonJwt }), /localhost/, 'localhost is rejected');

const warnings = [];
const quiet = { log() {}, warn: message => warnings.push(message) };
assert.equal(safeResolveConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: serviceJwt }, quiet), null, 'a bad config degrades to link mode instead of failing the build');
assert.match(warnings[0], /Hosted QR menus disabled/);
assert.match(warnings[0], /SUPABASE_URL, SUPABASE_ANON_KEY/, 'the warning names the variables seen');
assert.doesNotMatch(warnings[0], /eyJ/, 'the warning never prints values');
assert.deepEqual(safeResolveConfig({ SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_ANON_KEY: anonJwt }, quiet), { supabaseUrl: 'https://abc.supabase.co', supabaseKey: anonJwt });

const html = await readFile(new URL('../menu.html', import.meta.url), 'utf8');
const built = injectConfig(html, { supabaseUrl: 'https://abc.supabase.co', supabaseKey: 'k</script>' });
assert.match(built, /\/\*JUNIPER_CONFIG_START\*\/\{"supabaseUrl":"https:\/\/abc\.supabase\.co","supabaseKey":"k\\u003c\/script>"\}\/\*JUNIPER_CONFIG_END\*\//, 'config is inlined with < escaped');
assert.equal(injectConfig(html, null), html, 'no config leaves the source untouched');
assert.throws(() => injectConfig('<html></html>', null), /placeholder/);

const envText = 'SUPABASE_URL="https://abc.supabase.co"\n# comment\nexport SUPABASE_PUBLISHABLE_KEY=sb_publishable_x # inline\nBAD LINE\n';
const { writeFile, mkdtemp, rm } = await import('node:fs/promises');
const { tmpdir } = await import('node:os');
const dir = await mkdtemp(`${tmpdir()}/juniper-env-`);
await writeFile(`${dir}/.env`, envText);
assert.deepEqual(await readDotEnv(`${dir}/.env`), { SUPABASE_URL: 'https://abc.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' }, '.env parsing');
assert.deepEqual(await readDotEnv(`${dir}/missing.env`), {}, 'a missing .env is fine');
await rm(dir, { recursive: true, force: true });

console.log('Build-time Supabase config checks passed (aliases, secret refusal, safe fallback, injection, .env).');
