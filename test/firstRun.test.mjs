/* ==========================================================================
   test/firstRun.test.mjs
   ui/firstRun.js — is this a first visit, and what the app says when it is.

   Only the predicate is tested here. The card is DOM construction with no
   branch in it, which the browser suite already covers by rendering Home on
   a clean profile; what has a wrong answer available to it is "has this
   reader ever done anything", and it used to have two answers — Home and
   the Dashboard each carried their own copy of it.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { isFirstVisit } = await import('../js/ui/firstRun.js');

const empty = { records: new Map(), entries: [], sessions: [] };

describe('a first visit', () => {
  test('is nothing in any store', () => {
    assert.equal(isFirstVisit(empty), true);
  });

  /* Three stores, and any one of them is enough to have used the app.
     Journal is the one a check written against the study stores alone would
     miss — a reader who has only ever written is still not a stranger. */
  test('ends at the first record, entry or finished round', () => {
    assert.equal(isFirstVisit({ ...empty, records: new Map([['n5-001', {}]]) }), false);
    assert.equal(isFirstVisit({ ...empty, entries: [{ id: 'j1' }] }), false);
    assert.equal(isFirstVisit({ ...empty, sessions: [{ id: 's1' }] }), false);
  });

  /* Defined as "nothing in any store" rather than by a flag, so it is also
     true again after a reader erases everything — which is, from the app's
     side, exactly a first visit. */
  test('is true again after the stores are emptied', () => {
    const used = { records: new Map([['n5-001', {}]]), entries: [{ id: 'j1' }], sessions: [{ id: 's1' }] };
    assert.equal(isFirstVisit(used), false);
    assert.equal(isFirstVisit(empty), true);
  });
});
