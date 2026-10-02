import { mkdir, copyFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = process.cwd();
const output = resolve(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await copyFile(resolve(root, 'index.html'), resolve(output, 'index.html'));
console.log('Built Juniper as a self-contained static app in dist/.');
