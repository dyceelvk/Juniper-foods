import { createServer } from 'node:http';
import { access, readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(fileURLToPath(new URL('.', import.meta.url)));
const distRoot = resolve(projectRoot, 'dist');
let siteRoot = projectRoot;
if (!process.argv.includes('--source')) {
  try {
    await access(resolve(distRoot, 'index.html'));
    siteRoot = distRoot;
  } catch {}
}

const port = Number(process.env.PORT || 4173);
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url || '/', 'http://localhost').pathname);
  } catch {
    response.writeHead(400).end('Bad request');
    return;
  }
  if (pathname === '/healthz') {
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end('ok');
    return;
  }

  const relativePath = pathname.replace(/^\/+/, '') || 'index.html';
  let target = resolve(siteRoot, relativePath);
  if (target !== siteRoot && !target.startsWith(`${siteRoot}${sep}`)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(target).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': extname(target).toLowerCase() === '.html' ? 'no-store' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    if (!extname(pathname)) {
      try {
        const body = await readFile(resolve(siteRoot, 'index.html'));
        response.writeHead(200, { 'Content-Type': mimeTypes['.html'], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        response.end(request.method === 'HEAD' ? undefined : body);
        return;
      } catch {}
    }
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Juniper is running at http://0.0.0.0:${port} (static browser app; no API/backend connected).`);
});
