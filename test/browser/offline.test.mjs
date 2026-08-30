/* ==========================================================================
   test/browser/offline.test.mjs
   Bigu installed: does it register a service worker, and does it still open
   when the network is gone?

   This is the one claim in the app that cannot be checked by reading the
   code, by any amount of it. sw.js can parse, precache a correct list of
   files, and still leave a reader with a blank screen on the underground —
   because the scope was wrong, because the navigation fell through to the
   network, because addAll rejected on one path and quietly cached nothing.
   Every one of those failures looks identical to a working app until the
   moment the signal drops, which is the moment nobody is testing.

   tools/check-structure.mjs already checks that the precache list and the
   repository agree. This checks the half that only a browser knows: that
   the worker installs at all, and that a reload with the network switched
   off still produces the app, its stylesheets, and a view whose content
   comes from a file it had to have cached in advance.

   Skips without a browser, like its neighbour.
   ========================================================================== */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { serve, findChromium } from './harness.mjs';

const found = await findChromium();

describe('the installed app', { skip: found.reason }, () => {
  let http;
  let browser;
  let context;
  let page;

  before(async () => {
    http = await serve();
    browser = await found.chromium.launch({
      executablePath: found.executablePath,
      args: ['--no-sandbox'],
    });
    /* Its own context, so the worker and its caches are this test's alone —
       registrations are per-origin and would otherwise outlive the run. */
    context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    page = await context.newPage();

    await page.goto(`http://127.0.0.1:${http.port}/`, { waitUntil: 'load' });

    /* `ready` resolves once a worker is *active*, and a worker only becomes
       active after its install step has finished — which for sw.js means
       after cache.addAll has resolved. So this is also the wait for the
       precache to be complete, which is what the offline test below needs.
       Followed by the controller, which arrives with clients.claim(). */
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForFunction(() => Boolean(navigator.serviceWorker.controller), null, { timeout: 10000 });
  });

  after(async () => {
    await context?.setOffline(false);
    await browser?.close();
    http?.server.close();
  });

  test('registers a service worker that controls the page', async () => {
    const state = await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      return {
        scope: registration?.scope ?? null,
        active: registration?.active?.state ?? null,
        controlled: Boolean(navigator.serviceWorker.controller),
      };
    });

    assert.equal(state.active, 'activated');
    assert.equal(state.controlled, true, 'the first visit should be claimed, not left uncontrolled');
    assert.match(state.scope, /^http:\/\/127\.0\.0\.1:\d+\/$/, 'the worker must control the whole site, not a subdirectory');
  });

  test('caches the whole app rather than a fallback page', async () => {
    const cached = await page.evaluate(async () => {
      const names = await caches.keys();
      const app = names.find((name) => name.startsWith('bigu-app-'));
      if (!app) return null;
      const keys = await (await caches.open(app)).keys();
      return keys.map((request) => new URL(request.url).pathname);
    });

    assert.ok(cached, 'no bigu-app cache was created');
    assert.ok(cached.includes('/'), 'the document itself is not cached');
    assert.ok(cached.includes('/js/app.js'), 'the entry point is not cached');
    assert.ok(cached.includes('/css/variables.css'), 'the stylesheets are not cached');
    assert.ok(cached.includes('/data/vocabulary.json'), 'the content files are not cached');
  });

  /* The test this file exists for. Everything above could pass on an app
     that still went to the network for its document. */
  test('opens with the network off, and its content with it', async () => {
    const problems = [];
    page.on('pageerror', (error) => problems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error' && !message.text().includes('Failed to load resource')) {
        problems.push(`console.error: ${message.text()}`);
      }
    });

    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !document.getElementById('home')?.hidden);

    /* Vocabulary rather than Home: it is a view that fetches, so an empty
       cache would show its error state here rather than a blank screen —
       and its list is 1,000+ words that only data/vocabulary.json can
       supply. Nothing about this is answerable from the document alone. */
    await page.evaluate(() => { window.location.hash = '#vocabulary'; });
    await page.waitForFunction(() => !document.getElementById('vocabulary')?.hidden);
    await page.waitForFunction(
      () => document.getElementById('vocabulary')?.getAttribute('aria-busy') !== 'true',
      null,
      { timeout: 10000 },
    );

    const state = await page.evaluate(() => {
      const section = document.getElementById('vocabulary');
      return {
        erroring: Boolean(section?.querySelector('.error-state:not(.storage-notice)')),
        // The stylesheets are cached too, or this is an unstyled document.
        styled: getComputedStyle(document.body).backgroundColor,
        text: (section?.textContent ?? '').replace(/\s+/g, ' ').trim(),
      };
    });

    assert.equal(state.erroring, false, 'the word list fell back to its error state with the network off');
    assert.ok(state.text.length > 0, 'the word list rendered nothing offline');
    assert.notEqual(state.styled, 'rgba(0, 0, 0, 0)', 'the page was served unstyled offline');
    assert.deepEqual(problems, [], 'the app logged an error offline');
  });
});
