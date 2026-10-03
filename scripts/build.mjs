import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDotEnv, safeResolveConfig, injectConfig } from './juniper-config.mjs';

const root = process.cwd();
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// index.html is the Juniper app (buyers, sellers, riders, admin — the site root). It is self-contained and
// ships exactly as it is in the repository.
await copyFile(resolve(root, 'index.html'), resolve(output, 'index.html'));

// menu.html is the single-seller QR-menu app (seller accounts, permanent QR codes, customer ordering).
// It gets the public Supabase config inlined (from the environment or a local .env). Without config it still
// works in link mode; a bad config only warns. Secret keys are never inlined.
const env = { ...(await readDotEnv(resolve(root, '.env'))), ...process.env };
const config = safeResolveConfig(env);
const menuHtml = injectConfig(await readFile(resolve(root, 'menu.html'), 'utf8'), config);
await writeFile(resolve(output, 'menu.html'), menuHtml);

// preview.html is a redirect kept so old "design preview" links still open the app.
await copyFile(resolve(root, 'preview.html'), resolve(output, 'preview.html'));

console.log(`Built Juniper in dist/ (index.html app + menu.html QR menus${config ? ` via ${config.supabaseUrl}` : ' in link mode — no SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY'} + preview.html redirect).`);
