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
import { serve, findChromium } from './harness.mjs';

/* The thirteen routes in index.html. Kept as a literal rather than scraped
   out of the file: the point is to notice when a view stops working, and a
   list derived from the same document would happily shrink along with it. */
const VIEWS = [
  'home', 'dashboard', 'vocabulary', 'grammar', 'kanji', 'kakitori', 'practice',
  'memory', 'journal', 'lessons', 'reading', 'ichibun', 'settings',
];

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

  /* Home is where people land, so it is where the app has to explain itself.
     This is a whole-app assertion rather than a DOM mirror: the card is built
     in js/ui/firstRun.js, drawn by two views, and shown on the condition that
     every store is empty — which is exactly what a fresh browser profile is,
     and what no unit test can stand in for. Before it was drawn here it was
     drawn only on #dashboard, a route with no nav row and nothing linking to
     it, so a first-time reader was never once shown it. */
  test('a first-time reader is told what the app is, on the screen they land on', async () => {
    const before = problems.length;

    await page.evaluate(() => { window.location.hash = '#home'; });
    await page.waitForFunction(() => !document.getElementById('home')?.hidden);
    const card = await page.waitForSelector('#home .first-run', { timeout: 5000 });

    const text = (await card.textContent()).replace(/\s+/g, ' ');
    for (const verb of ['出会う', '思い出す', '薄れる']) {
      assert.ok(text.includes(verb), `the explanation should carry ${verb}`);
    }

    /* Bare on this screen. home.css says in as many words that nothing here
       gets a box drawn round it; the Dashboard adds the card surface itself. */
    assert.equal(
      await page.evaluate(() => document.querySelector('#home .first-run').classList.contains('card')),
      false,
      'Home draws the explanation without card chrome',
    );

    /* Two real doors, and the only ones on the card: they are why the
       first-visit "Lessons" button under the practice action came out. */
    assert.deepEqual(
      await page.evaluate(() => [...document.querySelectorAll('#home .first-run__actions a')].map((a) => a.getAttribute('href'))),
      ['#lessons', '#vocabulary'],
    );

    assert.deepEqual(problems.slice(before), []);
  });

  /* The two reference screens, and the one assertion that is about being able
     to *find* something rather than about rendering. Both were flat runs in
     the order their files were written — eight hundred words twenty-four at a
     time, and a hundred and thirty-two kanji as full-height rows — and both
     are now a structure a reader can cross in one press. That structure is
     derived at render time from the data (js/data/kana.js), so it is exactly
     the kind of thing that can quietly stop happening. */
  test('the vocabulary list is filed in kana rows, all of it in the document', async () => {
    const before = problems.length;

    await page.evaluate(() => { window.location.hash = '#vocabulary'; });
    await page.waitForFunction(() => !document.getElementById('vocabulary')?.hidden);
    await page.waitForSelector('#vocabulary .vocab-section:not([hidden])', { timeout: 5000 });

    const state = await page.evaluate(() => ({
      sections: [...document.querySelectorAll('#vocabulary .vocab-section:not([hidden])')].map((s) => s.id),
      rows: document.querySelectorAll('#vocabulary .vocab-row').length,
      marks: document.querySelectorAll('#vocabulary .vocab-index__mark').length,
      firstThree: [...document.querySelectorAll('#vocabulary .vocab-row__word')]
        .slice(0, 3).map((el) => el.textContent),
    }));

    assert.equal(state.sections[0], 'vocab-row-a', 'the list opens at あ');
    assert.deepEqual(state.sections.at(-1), 'vocab-row-wa', 'and ends at わ');
    assert.equal(state.marks, 10, 'ten marks on the index rail, one per row');
    // Every word, not a page of them: the "Show more" boundary is what made
    // the end of the list unreachable.
    assert.ok(state.rows > 800, `expected the whole catalogue in the document, saw ${state.rows}`);

    assert.deepEqual(problems.slice(before), []);
  });

  test('a vocabulary row opens in place rather than being a card', async () => {
    const before = problems.length;

    const face = await page.waitForSelector('#vocabulary .vocab-row__face', { timeout: 5000 });
    assert.equal(await face.getAttribute('aria-expanded'), 'false');

    await face.click();
    await page.waitForFunction(
      () => document.querySelector('#vocabulary .vocab-row__face')?.getAttribute('aria-expanded') === 'true',
      null,
      { timeout: 5000 },
    );
    // The detail is built on the press, not with the row.
    assert.ok(
      await page.evaluate(() => Boolean(document.querySelector('#vocabulary .vocab-row__detail'))),
      'the example and controls arrive when the row is opened',
    );

    assert.deepEqual(problems.slice(before), []);
  });

  test('the kanji browse is a chart of characters, banded by level', async () => {
    const before = problems.length;

    await page.evaluate(() => { window.location.hash = '#kanji'; });
    await page.waitForFunction(() => !document.getElementById('kanji')?.hidden);
    await page.waitForSelector('#kanji .kanji-tile', { timeout: 5000 });

    const state = await page.evaluate(() => ({
      tiles: document.querySelectorAll('#kanji .kanji-tile').length,
      bands: [...document.querySelectorAll('#kanji .kanji-band__label')].map((el) => el.textContent),
    }));

    assert.ok(state.tiles > 100, `expected the whole chart, saw ${state.tiles} tiles`);
    assert.ok(state.bands.length > 0, 'the chart is banded by level');

    // A tile is the route into the entry, the same as every other way in.
    await page.click('#kanji .kanji-tile__face');
    await page.waitForFunction(() => /^#kanji\/.+/.test(window.location.hash), null, { timeout: 5000 });
    await page.waitForSelector('#kanji .kanji-detail:not([hidden])', { timeout: 5000 });

    // …and backing out of it leaves the chart, not a panel with no way home.
    await page.evaluate(() => { window.location.hash = '#kanji'; });
    await page.waitForFunction(() => document.querySelector('.kanji-detail')?.hidden === true, null, { timeout: 5000 });
    await page.waitForSelector('#kanji .kanji-tile', { timeout: 5000 });

    assert.deepEqual(problems.slice(before), []);
  });

  /* The bridge is the other thing whose failure is invisible from inside
     this app: nothing in Bigu reads `bigu:bridge` back, so a boot that
     stopped publishing it, or published a shape the contract does not
     describe, would look exactly like a working app from every screen. The
     unit suite tests the envelope; only a real boot tests that the envelope
     is written at all — it waits on four fetches and a router that has to
     have handed off first. See docs/BRIDGE.md. */
  test('boot publishes the bridge, in the shape the contract describes', async () => {
    const payload = await page.waitForFunction(() => {
      const raw = localStorage.getItem('bigu:bridge');
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed.status ? parsed : null;
    }, null, { timeout: 5000 }).then((handle) => handle.jsonValue());

    assert.equal(payload.v, 2, 'a reader checks the version before anything else');
    assert.equal(payload.app, 'Bigu');
    assert.ok(payload.updatedAt > 0);
    assert.ok(Array.isArray(payload.events), 'an empty log is still a log');

    assert.equal(typeof payload.status.dueCount, 'number');
    assert.equal(typeof payload.status.learnedCount, 'number');
    /* A reader prints what is there and nothing for what is not; a null
       would be printed as a value. A fresh browser has no streak and no last
       studied date, and says so by carrying neither key. */
    assert.equal(
      Object.values(payload.status).some((value) => value === null),
      false,
      'an absent figure is an absent key, never null',
    );
    assert.equal('streak' in payload.status, false, 'no rounds studied here yet');
  });

  /* After the bridge test, deliberately: this one finishes a round, and a
     round is exactly what the bridge's status snapshot reports. Run before
     it, it left a streak on a key the test above asserts is quiet. */
  /* Build mode, end to end. The pieces come from study/puzzle.js, which its
     own suite covers; what only a browser can answer is whether the tray,
     the line and the check add up to a question that can be asked and got
     right — and whether the round then moves on the way the other two modes
     do. Driven from the keyboard rather than by clicking, because the
     bindings are the half most likely to rot: a build round that fell back
     to a Choose question used to leave the number keys pointing at nothing,
     which is also why the loop below walks past those cards rather than
     assuming the first one has a puzzle in it. */
  test('a build round assembles an answer and grades it', async () => {
    const before = problems.length;

    await page.evaluate(() => { window.location.hash = '#practice'; });
    await page.waitForFunction(() => !document.getElementById('practice')?.hidden);

    // Through the mode picker, the way a reader picks it: the view read the
    // stored mode once, when it was built.
    const picked = await page.evaluate(() => {
      const button = [...document.querySelectorAll('#practice .quiz-modes button')]
        .find((el) => el.textContent.trim() === 'Build');
      if (button) button.click();
      return Boolean(button);
    });
    assert.equal(picked, true, 'Build is offered as a study mode');

    await page.waitForSelector('#practice .practice__start:not([hidden])', { timeout: 5000 });
    await page.click('#practice .practice__start');
    await page.waitForSelector('.quiz:not([hidden])', { timeout: 5000 });

    /* Walk to the first card that actually has a puzzle. An item with a
       one-character headword and no spaced example has none, and the mode
       asks it a Choose question instead of skipping it. */
    let onBuildCard = false;
    for (let card = 0; card < 8 && !onBuildCard; card += 1) {
      await page.waitForTimeout(250);
      onBuildCard = await page.evaluate(() => {
        const build = document.querySelector('.quiz__build');
        return Boolean(build) && !build.hidden;
      });
      if (onBuildCard) break;

      // A fallback card: answer it and move on.
      await page.keyboard.press('1');
      await page.waitForSelector('.quiz__feedback:not([hidden])', { timeout: 5000 });
      await page.keyboard.press('Enter');
    }

    assert.equal(onBuildCard, true, 'a round in Build mode reaches a card with a puzzle in it');

    const shape = await page.evaluate(() => document.querySelector('.quiz__build').dataset.shape);
    assert.ok(['word', 'sentence'].includes(shape), `unexpected puzzle shape ${shape}`);

    // The check is offered only once every piece is placed: a partial answer
    // is unfinished, not wrong.
    assert.equal(await page.evaluate(() => document.querySelector('.quiz__build-check').disabled), true);

    /* Digits place the nth piece still in the tray, so pressing 1 as many
       times as there are pieces empties it in the order it was shuffled
       into — which is almost never the right order, and does not need to be:
       what is being tested is that the answer can be completed and checked. */
    const pieces = await page.evaluate(() => document.querySelectorAll('.quiz__piece--tray').length);
    assert.ok(pieces >= 2, 'a puzzle is at least two pieces');
    for (let i = 0; i < pieces; i += 1) await page.keyboard.press('1');

    assert.equal(await page.evaluate(() => document.querySelectorAll('.quiz__piece--placed').length), pieces);
    assert.equal(await page.evaluate(() => document.querySelector('.quiz__build-check').disabled), false);

    // Backspace takes the last one back, and the check goes away with it.
    await page.keyboard.press('Backspace');
    assert.equal(await page.evaluate(() => document.querySelectorAll('.quiz__piece--placed').length), pieces - 1);
    assert.equal(await page.evaluate(() => document.querySelector('.quiz__build-check').disabled), true);

    await page.keyboard.press('1');
    await page.keyboard.press('Enter');

    await page.waitForSelector('.quiz__feedback:not([hidden])', { timeout: 5000 });

    /* Every piece carries its own verdict, so a sentence with two chunks
       swapped says where it went wrong rather than only that it did. */
    const marks = await page.evaluate(() => [...document.querySelectorAll('.quiz__piece--placed')]
      .map((el) => el.classList.contains('is-right') || el.classList.contains('is-wrong')));
    assert.equal(marks.length, pieces);
    assert.deepEqual(marks, marks.map(() => true), 'each placed piece is marked');

    // Out of the round, so the views that follow start where they expect to.
    await page.evaluate(() => {
      const exit = document.querySelector('.quiz__exit');
      if (exit) exit.click();
    });
    await page.waitForTimeout(300);

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
