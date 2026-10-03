// Public runtime config for index.html (the Juniper app), taken from the environment at build time.
// Only the Supabase URL and the public (anon / publishable) key are ever inlined. The key is public by
// design: the database exposes nothing to it beyond get_qr_menu() / save_qr_menu() (RLS, no table grants).
import { readFile } from 'node:fs/promises';

const URL_KEYS = ['SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_URL', 'VITE_SUPABASE_URL'];
const KEY_KEYS = ['SUPABASE_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY'];
const PLACEHOLDER = /\/\*JUNIPER_CONFIG_START\*\/[\s\S]*?\/\*JUNIPER_CONFIG_END\*\//;

// Minimal .env reader (KEY=value, optional quotes, # comments). Real env vars always win.
export async function readDotEnv(path) {
  let text = '';
  try { text = await readFile(path, 'utf8'); } catch { return {}; }
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || line.trim().startsWith('#')) continue;
    let value = match[2];
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1); else value = value.replace(/\s+#.*$/, '');
    out[match[1]] = value;
  }
  return out;
}

export function jwtRole(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return '';
  try { return String(JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')).role || ''); } catch { return ''; }
}

export function resolveConfig(env = process.env) {
  const supabaseUrl = String(URL_KEYS.map(key => env[key]).find(Boolean) || '').trim().replace(/\/+$/, '');
  const supabaseKey = String(KEY_KEYS.map(key => env[key]).find(Boolean) || '').trim();
  if (!supabaseUrl && !supabaseKey) return null;
  if (!/^https:\/\/[^/\s?#]+$/.test(supabaseUrl)) throw new Error(`SUPABASE_URL must look like https://<project-ref>.supabase.co (got "${supabaseUrl}")`);
  if (!supabaseKey) throw new Error('SUPABASE_URL is set but no public key was found. Set SUPABASE_PUBLISHABLE_KEY (or SUPABASE_ANON_KEY).');
  if (/^sb_secret_/i.test(supabaseKey) || jwtRole(supabaseKey) === 'service_role') throw new Error('the configured Supabase key is a secret/service-role key and will not be inlined. index.html must only ever receive the public anon/publishable key.');
  if (/^https?:\/\/(localhost|127\.)/i.test(supabaseUrl)) throw new Error('SUPABASE_URL points at localhost, which customers cannot reach.');
  return { supabaseUrl, supabaseKey };
}

// Never let a configuration mistake break a deployment: warn loudly and ship link mode instead.
// (Secrets are still never inlined — resolveConfig refuses them before we get here.)
export function safeResolveConfig(env = process.env, log = console) {
  const present = [...URL_KEYS, ...KEY_KEYS].filter(key => env[key]);
  try {
    const config = resolveConfig(env);
    if (!config) log.log('Hosted QR menus: off (no SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY in the environment) — index.html ships in link mode (no accounts).');
    return config;
  } catch (error) {
    log.warn(`\n!! Hosted QR menus disabled: ${error.message}\n!! Variables seen: ${present.join(', ') || 'none'}. index.html ships in link mode (no accounts).\n`);
    return null;
  }
}

export function injectConfig(html, config) {
  if (!PLACEHOLDER.test(html)) throw new Error('index.html is missing the JUNIPER_CONFIG placeholder');
  const literal = config ? JSON.stringify(config).replace(/</g, '\\u003c') : 'null';
  return html.replace(PLACEHOLDER, `/*JUNIPER_CONFIG_START*/${literal}/*JUNIPER_CONFIG_END*/`);
}
