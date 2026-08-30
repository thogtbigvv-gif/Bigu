/* ==========================================================================
   test/browser/harness.mjs
   The two things every browser test needs before it can test anything: a
   server to serve the app from, and a Chromium to open it in.

   Both used to live inside smoke.test.mjs, which was right for exactly as
   long as there was one browser test. There are two now — the views, and
   the installed app — and the second one needs a real origin more than the
   first does: a service worker is refused on file:// and scoped to the URL
   it was served from, so "serve the repository over HTTP" is not a
   convenience here, it is the thing under test.

   Still zero-dependency apart from playwright-core, which is a test tool
   and is never installed into the app.
   ========================================================================== */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

/* The README's own instruction, as a function: this app fetches its JSON,
   so it has to be served over HTTP rather than opened off the filesystem. */
function serve() {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const file = path.join(ROOT, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname));

    // Refuse anything resolving outside the repository, even in a test server.
    if (!file.startsWith(ROOT) || !existsSync(file)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream' });
    response.end(await readFile(file));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

async function findChromium() {
  let chromium;
  try {
    ({ chromium } = await import('playwright-core'));
  } catch {
    return { reason: 'playwright-core is not installed (npm install --no-save playwright-core)' };
  }

  /* PLAYWRIGHT_BROWSERS_PATH is how a preinstalled browser is found; falling
     back to whatever playwright-core resolves on its own covers a normal
     `playwright install`. */
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const { readdir } = await import('node:fs/promises');
    for (const entry of (await readdir(root)).sort().reverse()) {
      for (const candidate of ['chrome-linux/chrome', 'chrome-linux/headless_shell']) {
        const executable = path.join(root, entry, candidate);
        if (entry.startsWith('chromium') && existsSync(executable)) return { chromium, executablePath: executable };
      }
    }
  }

  try {
    chromium.executablePath();
    return { chromium };
  } catch {
    return { reason: 'no Chromium available to playwright-core' };
  }
}

export { ROOT, serve, findChromium };
