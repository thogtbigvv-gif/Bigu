/* ==========================================================================
   test/router.test.mjs
   core/router.js — the route grammar, and only that.

   Everything else in the router needs a document: it hides sections, marks
   nav rows, moves focus. Reading an address does not, and it is the half
   worth checking exactly, because it is now the app's addressing scheme
   rather than a string comparison. Every deep link in the app is a hash this
   function has to take apart the same way twice — once when the router
   decides which view to show, once when the view asks which entry was meant —
   and a disagreement between those two readings is a door that opens onto
   the right screen and the wrong entry.

   The browser-side behaviour is covered where it can be: test/browser/
   smoke.test.mjs walks a real deep link in real Chromium.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { parseRoute } from '../js/core/router.js';

describe('reading an address', () => {
  test('a bare view is a view and no entry', () => {
    assert.deepEqual(parseRoute('#vocabulary'), { viewId: 'vocabulary', target: null });
    assert.deepEqual(parseRoute('vocabulary'), { viewId: 'vocabulary', target: null });
  });

  test('the second segment is the entry', () => {
    assert.deepEqual(parseRoute('#vocabulary/n5-001'), { viewId: 'vocabulary', target: 'n5-001' });
    assert.deepEqual(parseRoute('#kanji/kj-n5-001'), { viewId: 'kanji', target: 'kj-n5-001' });
    assert.deepEqual(parseRoute('#lessons/l7-12'), { viewId: 'lessons', target: 'l7-12' });
  });

  /* The split is on the *first* slash, so an id containing one arrives whole
     rather than truncated at its first half — which would be a door quietly
     opening onto whichever entry happened to share the prefix. */
  test('only the first slash divides; the rest of the address is the entry', () => {
    assert.deepEqual(parseRoute('#kanji/a/b'), { viewId: 'kanji', target: 'a/b' });
  });

  test('a trailing slash is a view, not an empty entry', () => {
    assert.deepEqual(parseRoute('#kanji/'), { viewId: 'kanji', target: null });
  });

  test('an empty or missing hash is neither a view nor an entry', () => {
    for (const value of ['', '#', null, undefined]) {
      assert.deepEqual(parseRoute(value), { viewId: '', target: null });
    }
  });

  /* An unknown view is not this function's problem — render() resolves it
     against the sections in the document and falls back to Home. What matters
     here is that it comes back readable rather than throwing. */
  test('an unknown view parses like any other', () => {
    assert.deepEqual(parseRoute('#no-such-view'), { viewId: 'no-such-view', target: null });
    assert.deepEqual(parseRoute('#no-such-view/n5-001'), { viewId: 'no-such-view', target: 'n5-001' });
  });

  test('the leading # is optional, so a stored or compared hash reads the same either way', () => {
    assert.deepEqual(parseRoute('#kanji/kj-n5-001'), parseRoute('kanji/kj-n5-001'));
  });
});
