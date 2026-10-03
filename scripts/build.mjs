import { mkdir, copyFile, rm, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { readDotEnv, safeResolveConfig, injectConfig } from './juniper-config.mjs';

const root = process.cwd();
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

// index.html is the full ordering workspace; menu.html is the self-contained single-seller QR menu.
await copyFile(resolve(root, 'index.html'), resolve(output, 'index.html'));

// menu.html gets the public Supabase config inlined (from the environment or a local .env) so sellers can
// publish permanent menus. Without config it still works in link mode; a bad config only warns. Secret keys are never inlined.
const env = { ...(await readDotEnv(resolve(root, '.env'))), ...process.env };
const config = safeResolveConfig(env);
const menuHtml = injectConfig(await readFile(resolve(root, 'menu.html'), 'utf8'), config);
await writeFile(resolve(output, 'menu.html'), menuHtml);

console.log(`Built Juniper as a self-contained static app in dist/ (index.html + menu.html${config ? `, hosted menus via ${config.supabaseUrl}` : ', link mode only'}).`);
