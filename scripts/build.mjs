import { mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
// index.html is the full ordering workspace; menu.html is the self-contained single-seller QR menu.
for (const file of ['index.html', 'menu.html']) await copyFile(resolve(root, file), resolve(output, file));
console.log('Built Juniper as a self-contained static app in dist/ (index.html + menu.html).');
