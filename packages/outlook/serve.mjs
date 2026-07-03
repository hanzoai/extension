// Self-contained HTTPS static server for local Office sideload testing on any
// machine (Windows included). It serves the files next to it — the built
// dist/ — at https://localhost:3000, which is the base a `localhost` build of
// the add-in points its manifest at. No framework, only Node stdlib.
//
//   1. npx office-addin-dev-certs install     # trust a localhost HTTPS cert (once)
//   2. node serve.mjs                          # serve dist/ at https://localhost:3000
//   3. sideload manifest.xml (see SIDELOAD-WINDOWS.md)
//
// The cert/key are read from the office-addin-dev-certs default location
// (~/.office-addin-dev-certs). If they are absent the script prints the exact
// install command instead of failing cryptically.

import { createServer } from 'node:https';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.env.PORT || 3000);
const CERT_DIR = join(homedir(), '.office-addin-dev-certs');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.json': 'application/json',
  '.xml': 'text/xml',
  '.png': 'image/png',
  '.css': 'text/css',
};

async function loadCerts() {
  const cert = join(CERT_DIR, 'localhost.crt');
  const key = join(CERT_DIR, 'localhost.key');
  if (!existsSync(cert) || !existsSync(key)) {
    console.error(
      'No localhost HTTPS certificate found.\n' +
        'Install a trusted one first (Office refuses an untrusted task-pane origin):\n\n' +
        '  npx office-addin-dev-certs install\n',
    );
    process.exit(1);
  }
  return { cert: await readFile(cert), key: await readFile(key) };
}

const { cert, key } = await loadCerts();

createServer({ cert, key }, async (req, res) => {
  // Resolve the request path safely under ROOT (no traversal).
  let rel = decodeURIComponent((req.url || '/').split('?')[0]);
  if (rel === '/') rel = '/taskpane.html';
  const path = normalize(join(ROOT, rel));
  if (!path.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }
  try {
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] || 'application/octet-stream',
      // Office loads the pane in an iframe; allow it and permit the API host.
      'Access-Control-Allow-Origin': '*',
    });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found: ' + rel);
  }
}).listen(PORT, () => {
  console.log(`Hanzo Office add-in served at https://localhost:${PORT}`);
  console.log('Sideload manifest.xml — see SIDELOAD-WINDOWS.md.');
});
