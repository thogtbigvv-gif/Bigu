/* ==========================================================================
   test/shape.test.mjs
   data/shape.js — the line between "the file arrived" and "the file is
   usable".

   These guards run in the browser on every reader's first load, so what
   matters is that they accept the real files unchanged and reject the
   mistakes a hand-written catalogue actually produces — with a sentence
   naming the file and the field, rather than a TypeError from six frames
   inside a render.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { requireEntries, requireLessons, isPlainObject } from '../js/data/shape.js';

const load = async (name) => JSON.parse(await readFile(new URL(`../data/${name}.json`, import.meta.url), 'utf8'));

describe('the real files pass unchanged', () => {
  test('vocabulary, grammar, kanji and reading', async () => {
    const cases = [['vocabulary', 'words'], ['grammar', 'points'], ['kanji', 'kanji'], ['reading', 'passages']];
    for (const [label, key] of cases) {
      const entries = requireEntries(await load(label), { label, key });
      assert.ok(entries.length > 0, `${label} should not be empty`);
    }
  });

  test('lessons', async () => {
    const lessons = requireLessons(await load('lessons'));
    assert.ok(lessons.length > 0);
  });
});

describe('rejecting a malformed collection', () => {
  test('the wrapping object is missing entirely', () => {
    for (const junk of [null, [], 'text', 42]) {
      assert.throws(() => requireEntries(junk, { label: 'vocabulary', key: 'words' }), /vocabulary/);
    }
  });

  test('the collection key is absent or is not an array', () => {
    assert.throws(() => requireEntries({ updatedAt: '2026-01-01' }, { label: 'vocabulary', key: 'words' }), /"words"/);
    assert.throws(() => requireEntries({ words: {} }, { label: 'vocabulary', key: 'words' }), /"words"/);
  });

  test('an entry that is not an object is named by its index', () => {
    assert.throws(
      () => requireEntries({ words: [{ id: 'a' }, 'oops'] }, { label: 'vocabulary', key: 'words' }),
      /entry 1 is not an object/,
    );
  });

  /* An id is the key every progress record in localStorage is written
     under. An entry without one is an item the reader can study and never
     keep — a silent failure rather than a visible one. */
  test('an entry with no usable id is named by its index', () => {
    for (const bad of [{}, { id: '' }, { id: 42 }, { id: null }]) {
      assert.throws(
        () => requireEntries({ words: [{ id: 'a' }, bad] }, { label: 'vocabulary', key: 'words' }),
        /entry 1 has no usable id/,
      );
    }
  });

  test('the message always names the file, so the reader\'s console says where to look', () => {
    try {
      requireEntries({}, { label: 'grammar', key: 'points' });
      assert.fail('should have thrown');
    } catch (error) {
      assert.match(error.message, /^data\/grammar\.json/);
    }
  });
});

describe('lessons, which are shaped differently', () => {
  const lesson = (over = {}) => ({ lesson: 1, title: 'x', words: [{ id: 'l1-01' }], ...over });

  test('a lesson is identified by its number, not by an id', () => {
    assert.doesNotThrow(() => requireLessons([lesson()]));
    assert.throws(() => requireLessons([lesson({ lesson: undefined })]), /no lesson number/);
    assert.throws(() => requireLessons([lesson({ lesson: '1' })]), /no lesson number/);
  });

  /* The flattened pool every study surface draws from is built out of these
     lists, so one lesson missing its words takes the whole review pool
     down — from a file the reader never opened. */
  test('a lesson with no words array is refused, and named by its number', () => {
    assert.throws(() => requireLessons([lesson(), lesson({ lesson: 7, words: undefined })]), /lesson 7/);
    assert.throws(() => requireLessons([lesson({ lesson: 7, words: {} })]), /lesson 7/);
  });

  test('an empty word list is fine — a lesson not yet written down is a normal state', () => {
    assert.doesNotThrow(() => requireLessons([lesson({ words: [] })]));
  });

  test('a word with no id is named by its lesson and position', () => {
    assert.throws(
      () => requireLessons([lesson({ lesson: 3, words: [{ id: 'l3-01' }, { word: '猫' }] })]),
      /word 1 of lesson 3/,
    );
  });
});

describe('isPlainObject', () => {
  test('separates maps from everything else', () => {
    assert.equal(isPlainObject({}), true);
    assert.equal(isPlainObject({ a: 1 }), true);
    for (const value of [null, undefined, [], 'text', 42, true]) {
      assert.equal(isPlainObject(value), false, String(value));
    }
  });
});
