/* ==========================================================================
   test/browser/smoke.test.mjs
   Opens the real app in a real browser and visits every view.

   Everything else in this suite tests logic with no document. That leaves
   the largest class of failure in an app like this one entirely uncovered:
   the app ships unbuilt, so a wrong import path, a missing named export or
   a renamed element id is not a compile error anywhere — it is a blank view
   and a red console, discovered by whoever opens that view next. This test
   is the one that would have caught it: thirteen views, and the console
   must be empty.

   It is deliberately shallow. It does not assert what a view contains, only
   that visiting it produces no error and leaves something on screen. Asking
   more would make it a brittle mirror of the DOM; asking this much makes a
   whole-app rename safe.

   The three tests at the foot of this file are the one exception, and they
   earn it: cross-linking spans the router, two views and a derived index, so
   the only place its failure is visible is a browser that has actually
   followed a door from one screen to another.

   The one thing here that is not zero-dependency, which is why it lives in
   its own directory rather than beside the unit tests: `node --test
   "test/*.test.mjs"` runs the whole logic suite with nothing installed, and
   this is a second command. It skips rather than fails when the browser is
   absent, and it says so — a check that quietly passes when it did not run
   is worse than one that is not there.

     npm install --no-save playwright-core   # CI does this
     node --test "test/browser/*.test.mjs"
   ========================================================================== */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/* The thirteen routes in index.html. Kept as a literal rather than scraped
   out of the file: the point is to notice when a view stops working, and a
   list derived from the same document would happily shrink along with it. */
const VIEWS = [
  'home', 'dashboard', 'vocabulary', 'grammar', 'kanji', 'kakitori', 'practice',
  'memory', 'journal', 'lessons', 'reading', 'ichibun', 'settings',
];

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

const found = await findChromium();

describe('the app in a browser', { skip: found.reason }, () => {
  let http;
  let browser;
  let page;
  const problems = [];

  before(async () => {
    http = await serve();
    browser = await found.chromium.launch({
      executablePath: found.executablePath,
      args: ['--no-sandbox'],
    });
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

    /* Google Fonts is the one thing this page loads from off-origin, and a
       sandboxed CI runner has no route to it. A missing webfont is a
       rendering difference, not an application error, so it is the single
       exclusion — everything else counts. */
    const offOrigin = (url) => url.includes('fonts.googleapis.com') || url.includes('fonts.gstatic.com');

    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        problems.push(`console.error: ${message.text()}`);
      }
    });
    page.on('requestfailed', (request) => {
      if (!offOrigin(request.url())) {
        problems.push(`request failed: ${request.url()} ${request.failure()?.errorText}`);
      }
    });

    await page.goto(`http://127.0.0.1:${http.port}/#home`, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('home')?.hidden);
  });

  after(async () => {
    await browser?.close();
    http?.server.close();
  });

  test('boots without an error', () => {
    assert.deepEqual(problems, []);
  });

  for (const view of VIEWS) {
    test(`#${view} opens, renders, and logs nothing`, async () => {
      const before = problems.length;

      await page.evaluate((id) => { window.location.hash = `#${id}`; }, view);
      await page.waitForFunction((id) => !document.getElementById(id)?.hidden, view);
      // Long enough for a view's own fetch and first render to settle.
      await page.waitForFunction(
        (id) => document.getElementById(id)?.getAttribute('aria-busy') !== 'true'
          && !document.getElementById(id)?.querySelector('[aria-busy="true"]'),
        view,
        { timeout: 5000 },
      );

      const state = await page.evaluate((id) => {
        const section = document.getElementById(id);
        return {
          exists: Boolean(section),
          visible: section ? !section.hidden : false,
          erroring: Boolean(section?.querySelector('.error-state:not(.storage-notice)')),
          errorText: section?.querySelector('.error-state')?.textContent?.trim().slice(0, 120) ?? '',
          text: (section?.textContent ?? '').replace(/\s+/g, ' ').trim(),
          title: document.title,
        };
      }, view);

      assert.equal(state.exists, true, `#${view} has no section in index.html`);
      assert.equal(state.visible, true, `#${view} did not become visible`);
      assert.equal(state.erroring, false, `#${view} rendered its error state: ${state.errorText}`);
      assert.ok(state.text.length > 0, `#${view} rendered nothing at all`);
      assert.match(state.title, /Bigu/, 'the document title should follow the route');

      assert.deepEqual(problems.slice(before), [], `#${view} logged an error`);
    });
  }

  test('an unknown route falls back to Home rather than an empty page', async () => {
    await page.evaluate(() => { window.location.hash = '#no-such-view'; });
    await page.waitForFunction(() => window.location.hash === '#home');
    assert.equal(await page.evaluate(() => document.getElementById('home').hidden), false);
  });

  /* Cross-linking end to end, which is the one part of it nothing else can
     see. The unit tests prove the index finds the right words and that an
     address parses; only a browser can show that following a door actually
     puts the entry it named on screen — through a router, a view that was
     never opened, a fetch, and a list that pages. */
  test('a deep link opens one entry rather than its list', async () => {
    const before = problems.length;

    await page.evaluate(() => { window.location.hash = '#kanji/kj-n5-001'; });
    await page.waitForFunction(() => document.querySelector('.kanji-detail')?.hidden === false, null, { timeout: 5000 });

    assert.equal(await page.textContent('.kanji-detail__character'), '日');
    assert.equal(
      await page.evaluate(() => document.querySelector('.kanji-browse').hidden),
      true,
      'the grid should be behind the panel, not beside it',
    );
    assert.deepEqual(problems.slice(before), []);
  });

  test('a door leads to the entry it names, on another view, and marks it on arrival', async () => {
    const before = problems.length;

    const door = await page.waitForSelector('.kanji-detail .door', { timeout: 5000 });
    const href = await door.getAttribute('href');
    assert.match(href, /^#(vocabulary|lessons|kanji)\/[\w-]+$/, 'a door points at one entry on one view');

    await door.click();
    await page.waitForFunction((hash) => window.location.hash === hash, href, { timeout: 5000 });

    /* The arrival mark is what says *which* row was linked to, on a screen
       showing hundreds of near-identical ones. js/ui/doors.js takes it off
       again after three seconds, so this is a race the test would rather not
       run: five seconds is the wait for it to appear, not for it to stay. */
    const arrival = await page.waitForSelector('.is-arrival', { timeout: 5000 });
    assert.ok(await arrival.isVisible(), 'the linked entry should be on screen, not filtered out or unpaged');

    assert.deepEqual(problems.slice(before), []);
  });

  test('a deep link to an entry that is not in the catalogue lands on the list, not an error', async () => {
    const before = problems.length;

    await page.evaluate(() => { window.location.hash = '#kanji/kj-no-such-entry'; });
    await page.waitForFunction(() => !document.getElementById('kanji')?.hidden);

    assert.equal(
      await page.evaluate(() => document.querySelector('.kanji-browse').hidden),
      false,
      'a retired id or an old bookmark is a normal arrival at the grid',
    );
    assert.equal(await page.evaluate(() => Boolean(document.querySelector('.error-state'))), false);
    assert.deepEqual(problems.slice(before), []);
  });
});
