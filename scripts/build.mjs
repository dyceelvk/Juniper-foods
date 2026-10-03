import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDotEnv, safeResolveConfig, injectConfig } from './juniper-config.mjs';

const root = process.cwd();
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// index.html is the Juniper app (seller accounts, permanent QR codes, customer ordering). It gets the public
// Supabase config inlined (from the environment or a local .env). Without config it still works in link mode;
// a bad config only warns. Secret keys are never inlined.
const env = { ...(await readDotEnv(resolve(root, '.env'))), ...process.env };
const config = safeResolveConfig(env);
const appHtml = injectConfig(await readFile(resolve(root, 'index.html'), 'utf8'), config);
await writeFile(resolve(output, 'index.html'), appHtml);

// menu.html is a tiny redirect that keeps older QR codes/links working; preview.html is the design preview with demo data.
await copyFile(resolve(root, 'menu.html'), resolve(output, 'menu.html'));
await copyFile(resolve(root, 'preview.html'), resolve(output, 'preview.html'));

console.log(`Built Juniper as a self-contained static app in dist/ (index.html app + menu.html redirect + preview.html demo${config ? `, accounts and hosted menus via ${config.supabaseUrl}` : ', link mode only'}).`);
