/* ==========================================================================
   test/decks.test.mjs
   study/decks.js — the id-to-deck routing, and the deck vocabulary.

   deckKeyForItemId is small and load-bearing in a way that is easy to
   forget: it decides which items the review pool will admit, which adapter
   the quiz reaches for, and therefore whether an entry in data/ is
   studiable at all. An id it fails to claim does not error — the item
   simply, silently, never appears in a round again.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { deckKeyForItemId, CONTENT_DECKS, DECK_KEYS, DECK_LABELS, DECK_NEXT } from '../js/study/decks.js';

describe('routing an id to its deck', () => {
  test('the four real id shapes in data/', () => {
    assert.equal(deckKeyForItemId('l1-01'), 'lessons');
    assert.equal(deckKeyForItemId('l25-14'), 'lessons');
    assert.equal(deckKeyForItemId('n5-001'), 'vocabulary');
    assert.equal(deckKeyForItemId('gr-001'), 'grammar');
    assert.equal(deckKeyForItemId('kj-n5-001'), 'kanji');
  });

  test('vocabulary matches the whole JLPT ladder, not just the prefix the first word list used', () => {
    for (const level of [1, 2, 3, 4, 5]) {
      assert.equal(deckKeyForItemId(`n${level}-001`), 'vocabulary', `n${level}`);
    }
  });

  /* "l" is a looser match than the others, which is why lessons is tested
     first in the implementation. A vocabulary id must not be captured by it. */
  test('the lesson pattern requires digits and a dash, so it cannot swallow other ids', () => {
    assert.equal(deckKeyForItemId('lesson-1'), null);
    assert.equal(deckKeyForItemId('l-01'), null);
    assert.equal(deckKeyForItemId('kj-n5-001'), 'kanji');
  });

  test('an unclaimed id returns null rather than guessing a deck', () => {
    for (const id of ['read-001', 'x-1', '', 'n6-001', 'n0-1']) {
      assert.equal(deckKeyForItemId(id), null, id);
    }
  });

  test('a non-string id does not throw', () => {
    for (const id of [null, undefined, 42, {}, []]) {
      assert.equal(deckKeyForItemId(id), null);
    }
  });

  test('reading passages are deliberately not routable — a passage is not a card', () => {
    assert.equal(deckKeyForItemId('read-001'), null);
  });
});

describe('the deck vocabulary', () => {
  test('every key the picker offers has a label', () => {
    for (const key of DECK_KEYS) {
      assert.equal(typeof DECK_LABELS[key], 'string', key);
      assert.ok(DECK_LABELS[key].length > 0, key);
    }
  });

  test('every key the picker offers leads somewhere after a round', () => {
    for (const key of DECK_KEYS) {
      assert.match(DECK_NEXT[key] ?? '', /^#[a-z]+$/, key);
    }
  });

  test('each deck is named once — no two keys share a label', () => {
    const labels = DECK_KEYS.map((key) => DECK_LABELS[key]);
    assert.equal(new Set(labels).size, labels.length);
  });

  test('the four content decks are exactly the four deckKeyForItemId can return', () => {
    const routed = new Set(['l1-01', 'n5-001', 'gr-001', 'kj-n5-001'].map(deckKeyForItemId));
    assert.deepEqual([...routed].sort(), CONTENT_DECKS.slice().sort());
  });

  test('the picker offers the four content decks plus the two live pools', () => {
    assert.deepEqual(DECK_KEYS, ['due', ...CONTENT_DECKS, 'mistakes']);
    assert.equal(DECK_KEYS[0], 'due', 'the deck a reader should be in on most days leads');
  });
});
