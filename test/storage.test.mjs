/* ==========================================================================
   test/storage.test.mjs
   core/storage.js — the layer everything else in the app persists through.

   Its whole job is that nothing above it ever has to think about
   localStorage failing, and until now nothing checked that it does that
   job. Two failure modes matter and both are silent: a browser that throws
   instead of storing, and a key holding valid JSON of the wrong shape.
   ========================================================================== */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage, installFailingStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const storage = await import('../js/core/storage.js');
const { settings, progress, journal, practice, favorites, sentences, STORES, isStoreShaped,
        isAvailable, clearAll, migrateLegacyKeys } = storage;

beforeEach(() => installMemoryStorage());

describe('map stores', () => {
  test('round-trip a value', () => {
    settings.set('theme', 'dark');
    assert.equal(settings.get('theme'), 'dark');
  });

  test('a missing key returns the caller\'s fallback, not undefined', () => {
    assert.equal(settings.get('never-written', 'system'), 'system');
  });

  test('a stored falsy value is returned rather than replaced by the fallback', () => {
    // `key in all` rather than a truthiness check: 0 and '' are values a
    // setting can legitimately hold.
    settings.set('goal', 0);
    assert.equal(settings.get('goal', 10), 0);
  });

  test('remove deletes only its own key', () => {
    settings.set('a', 1);
    settings.set('b', 2);
    settings.remove('a');
    assert.deepEqual(settings.getAll(), { b: 2 });
  });

  test('replaceAll refuses a non-map and falls back to empty', () => {
    settings.set('theme', 'dark');
    settings.replaceAll(['not', 'a', 'map']);
    assert.deepEqual(settings.getAll(), {});
  });
});

describe('list stores', () => {
  test('add stamps an id and a createdAt', () => {
    const record = journal.add({ text: 'はじめました' });
    assert.equal(typeof record.id, 'string');
    assert.ok(record.id.length > 0);
    assert.equal(typeof record.createdAt, 'number');
    assert.equal(record.text, 'はじめました');
  });

  test('every id is distinct', () => {
    const ids = new Set(Array.from({ length: 200 }, () => journal.add({ text: 'x' }).id));
    assert.equal(ids.size, 200);
  });

  test('update merges and stamps updatedAt; a missing id returns null', () => {
    const record = practice.add({ total: 10, correct: 7, mode: 'due' });
    const updated = practice.update(record.id, { correct: 8 });
    assert.equal(updated.correct, 8);
    assert.equal(updated.total, 10);
    assert.equal(typeof updated.updatedAt, 'number');
    assert.equal(practice.update('no-such-id', { correct: 1 }), null);
  });

  test('remove drops one entry and leaves the rest in order', () => {
    const a = sentences.add({ text: 'あ' });
    const b = sentences.add({ text: 'い' });
    sentences.remove(a.id);
    assert.deepEqual(sentences.getAll().map((entry) => entry.text), ['い']);
    assert.equal(sentences.getAll()[0].id, b.id);
  });

  test('replaceAll refuses a non-array and falls back to empty', () => {
    journal.add({ text: 'x' });
    journal.replaceAll({ not: 'a list' });
    assert.deepEqual(journal.getAll(), []);
  });
});

describe('corrupted keys', () => {
  /* The bug this guards is not hypothetical: a progress key holding `null`
     parses as valid JSON and then throws on the very next line, because
     `'x' in null` is a TypeError. Every view reads progress, so one such key
     took the whole app to a blank screen. */
  test('a map store reading null, a number or an array falls back to {}', () => {
    for (const junk of ['null', '5', '[]', '"a string"']) {
      installMemoryStorage();
      localStorage.setItem('bigu:progress', junk);
      assert.deepEqual(progress.getAll(), {}, `for ${junk}`);
      assert.doesNotThrow(() => progress.get('n5-001', null));
    }
  });

  test('a list store reading an object or null falls back to []', () => {
    for (const junk of ['{}', 'null', '3']) {
      installMemoryStorage();
      localStorage.setItem('bigu:journal', junk);
      assert.deepEqual(journal.getAll(), [], `for ${junk}`);
    }
  });

  test('unparseable text falls back rather than throwing', () => {
    localStorage.setItem('bigu:settings', '{ not json');
    assert.deepEqual(settings.getAll(), {});
  });
});

describe('the namespace migration', () => {
  /* Storage was namespaced `nagi:` — a name this project has not gone by in
     a long time — while bridge.js, written later, correctly used `bigu:`.
     The rename is only safe because it copies rather than moves. */
  test('carries a legacy key across when the new one does not exist', () => {
    localStorage.setItem('nagi:progress', JSON.stringify({ 'n5-001': { learned: true } }));
    migrateLegacyKeys();
    assert.deepEqual(progress.getAll(), { 'n5-001': { learned: true } });
  });

  test('moves every store, not only the ones anyone remembered', () => {
    localStorage.setItem('nagi:settings', JSON.stringify({ theme: 'dark' }));
    localStorage.setItem('nagi:progress', JSON.stringify({ a: { learned: true } }));
    localStorage.setItem('nagi:journal', JSON.stringify([{ id: 'j', text: 'x' }]));
    localStorage.setItem('nagi:practice', JSON.stringify([{ id: 'p', total: 1, correct: 1 }]));
    localStorage.setItem('nagi:favorites', JSON.stringify({ 'kj-n5-001': true }));
    localStorage.setItem('nagi:sentences', JSON.stringify([{ id: 's', text: 'あ' }]));

    migrateLegacyKeys();

    assert.equal(settings.get('theme'), 'dark');
    assert.deepEqual(Object.keys(progress.getAll()), ['a']);
    assert.equal(journal.getAll().length, 1);
    assert.equal(practice.getAll().length, 1);
    assert.equal(favorites.get('kj-n5-001'), true);
    assert.equal(sentences.getAll().length, 1);
  });

  /* Once the app has written under the new name that is the live copy, and
     the legacy key is only history. Overwriting would resurrect whatever
     the reader last did on a pre-rename build. */
  test('never overwrites a key the app has already written', () => {
    settings.set('theme', 'light');
    localStorage.setItem('nagi:settings', JSON.stringify({ theme: 'dark' }));
    migrateLegacyKeys();
    assert.equal(settings.get('theme'), 'light');
  });

  /* A copy, not a move. A reader who opens an older build finds their data
     where that build looks for it, and a migration that turns out to be
     wrong can still be corrected from the original. */
  test('leaves the legacy key in place rather than destroying it', () => {
    const original = JSON.stringify({ theme: 'dark' });
    localStorage.setItem('nagi:settings', original);
    migrateLegacyKeys();
    assert.equal(localStorage.getItem('nagi:settings'), original);
  });

  test('a fresh install has nothing to carry across and writes nothing', () => {
    migrateLegacyKeys();
    assert.equal(localStorage.length, 0);
  });

  test('an unparseable legacy value is carried across and then falls back on read', () => {
    // Copying it verbatim is right: the corruption guard belongs in the
    // reader, not in a migration that would otherwise have to judge content.
    localStorage.setItem('nagi:progress', 'not json');
    migrateLegacyKeys();
    assert.equal(localStorage.getItem('bigu:progress'), 'not json');
    assert.deepEqual(progress.getAll(), {});
  });

  test('does not throw in a browser that refuses to store', () => {
    installFailingStorage();
    assert.doesNotThrow(() => migrateLegacyKeys());
  });
});

describe('a browser that refuses to store', () => {
  beforeEach(() => installFailingStorage());

  test('isAvailable says so', () => {
    assert.equal(isAvailable(), false);
  });

  test('reads fall back and writes report failure — nothing throws', () => {
    assert.doesNotThrow(() => {
      assert.deepEqual(settings.getAll(), {});
      assert.equal(settings.get('theme', 'system'), 'system');
      assert.equal(settings.set('theme', 'dark'), false);
      assert.deepEqual(journal.getAll(), []);
    });
  });

  test('adding to a list store still returns a usable record', () => {
    // The write fails, but the caller is handed the record it asked for
    // rather than an exception mid-session.
    const record = journal.add({ text: 'x' });
    assert.equal(typeof record.id, 'string');
  });
});

describe('the store registry', () => {
  test('names every store the app has, once', () => {
    const names = STORES.map((entry) => entry.name);
    assert.deepEqual(names.slice().sort(), [...new Set(names)].sort(), 'no duplicates');
    assert.deepEqual(
      names.slice().sort(),
      ['favorites', 'journal', 'practice', 'progress', 'sentences', 'settings'],
    );
  });

  test('each entry describes a store that actually behaves like its kind', () => {
    for (const { name, store, kind } of STORES) {
      const empty = store.getAll();
      assert.equal(isStoreShaped(kind, empty), true, `${name} should read back as a ${kind}`);
    }
  });

  test('the four the format shipped with are the required ones', () => {
    const required = STORES.filter((entry) => entry.required).map((entry) => entry.name);
    assert.deepEqual(required.sort(), ['journal', 'practice', 'progress', 'settings']);
  });
});

describe('clearAll', () => {
  test('empties every store, not just the ones a caller remembered', () => {
    settings.set('theme', 'dark');
    progress.set('n5-001', { learned: true });
    journal.add({ text: 'x' });
    practice.add({ total: 1, correct: 1, mode: 'due' });
    favorites.set('n5-001', true);
    sentences.add({ text: 'あ' });

    assert.equal(clearAll(), true);

    for (const { name, store, kind } of STORES) {
      const value = store.getAll();
      assert.equal(kind === 'list' ? value.length : Object.keys(value).length, 0, `${name} should be empty`);
    }
  });
});
