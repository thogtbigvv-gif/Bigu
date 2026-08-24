/* ==========================================================================
   test/backup.test.mjs
   core/backup.js — the file a reader carries their study out in.

   Restore is the only operation in Bigu that cannot be undone. There is no
   account and no server copy, so the backup file is the whole of a reader's
   safety net, and a validator that accepts a damaged one destroys exactly
   the thing it was there to protect. That is not a hypothetical: it is the
   bug these tests were written against.
   ========================================================================== */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const { settings, progress, journal, practice, favorites, sentences, STORES } =
  await import('../js/core/storage.js');
const { buildBackupPayload, describeBackupProblem, restoreBackup, backupFilename, todayKey } =
  await import('../js/core/backup.js');

beforeEach(() => installMemoryStorage());

function seed() {
  settings.set('theme', 'dark');
  progress.set('n5-001', { learned: true, level: 3, lastSeen: 1, dueAt: 2, firstSeen: 1, reviews: 4, lapses: 1 });
  journal.add({ text: '今日は漢字を勉強した' });
  practice.add({ total: 10, correct: 8, mode: 'due' });
  favorites.set('kj-n5-001', true);
  sentences.add({ text: '猫が好きです' });
}

describe('the exported file', () => {
  test('is stamped as Bigu and carries every store', () => {
    seed();
    const payload = buildBackupPayload();
    assert.equal(payload.app, 'Bigu');
    assert.ok(Date.parse(payload.exportedAt) > 0);
    assert.deepEqual(
      Object.keys(payload.data).sort(),
      STORES.map((entry) => entry.name).sort(),
    );
  });

  test('is named for the local day it was taken, not tomorrow in UTC', () => {
    const lateTonight = new Date();
    lateTonight.setHours(23, 45, 0, 0);
    assert.equal(backupFilename(lateTonight), `bigu-backup-${todayKey(lateTonight)}.json`);
    assert.match(backupFilename(), /^bigu-backup-\d{4}-\d{2}-\d{2}\.json$/);
  });

  test('survives a full round trip unchanged', () => {
    seed();
    const payload = JSON.parse(JSON.stringify(buildBackupPayload()));

    installMemoryStorage();
    assert.deepEqual(progress.getAll(), {}, 'a clean install to restore into');

    assert.equal(describeBackupProblem(payload), null);
    restoreBackup(payload);

    assert.deepEqual(progress.getAll(), payload.data.progress);
    assert.equal(settings.get('theme'), 'dark');
    assert.equal(journal.getAll().length, 1);
    assert.equal(favorites.get('kj-n5-001'), true);
    assert.equal(sentences.getAll()[0].text, '猫が好きです');
  });
});

describe('rejecting a file', () => {
  const good = () => ({ app: 'Bigu', exportedAt: '2026-01-01T00:00:00.000Z', data: {
    settings: {}, progress: {}, journal: [], practice: [], favorites: {}, sentences: [],
  } });

  test('a valid file is accepted', () => {
    assert.equal(describeBackupProblem(good()), null);
  });

  test('something that is not an object at all', () => {
    for (const junk of [null, undefined, 'text', 42, []]) {
      assert.ok(describeBackupProblem(junk), `should reject ${JSON.stringify(junk)}`);
    }
  });

  test('a JSON file from some other app', () => {
    assert.ok(describeBackupProblem({ app: 'Anki', data: {} }));
  });

  test('a file with no data section', () => {
    assert.ok(describeBackupProblem({ app: 'Bigu' }));
    assert.ok(describeBackupProblem({ app: 'Bigu', data: [] }));
  });

  test('a truncated file missing a store the format shipped with', () => {
    for (const name of ['settings', 'progress', 'journal', 'practice']) {
      const payload = good();
      delete payload.data[name];
      const problem = describeBackupProblem(payload);
      assert.ok(problem, `missing ${name} should be refused`);
      assert.match(problem, new RegExp(name), 'and the message should name it');
    }
  });

  /* This is the bug. Every one of these parses as JSON, and every one of
     them used to pass validation and then be handed to a store whose
     replaceAll turns anything ill-shaped into an empty one — so the reader
     read "Restored from backup" while their study history became {}. */
  test('a store of the wrong kind — the one that used to be silently wiped', () => {
    for (const wrong of [null, [], 'none', 0, false]) {
      const payload = good();
      payload.data.progress = wrong;
      const problem = describeBackupProblem(payload);
      assert.ok(problem, `progress: ${JSON.stringify(wrong)} should be refused`);
      assert.match(problem, /progress/);
    }
  });

  test('a list store holding a map is refused too', () => {
    const payload = good();
    payload.data.journal = { '0': { text: 'x' } };
    assert.match(describeBackupProblem(payload), /journal/);
  });

  test('nothing is written while a file is being judged', () => {
    seed();
    const before = JSON.stringify(progress.getAll());
    const payload = good();
    payload.data.progress = null;
    describeBackupProblem(payload);
    assert.equal(JSON.stringify(progress.getAll()), before);
  });
});

describe('older backups', () => {
  /* favorites and sentences arrived after the format did. A file downloaded
     before they existed is still a perfectly good backup, and demanding the
     newer keys would reject every file already on a reader's disk. */
  test('a file predating favorites and sentences still restores', () => {
    const payload = { app: 'Bigu', data: { settings: { theme: 'light' }, progress: {}, journal: [], practice: [] } };
    assert.equal(describeBackupProblem(payload), null);

    favorites.set('kj-n5-001', true);
    sentences.add({ text: 'あ' });
    restoreBackup(payload);

    assert.equal(settings.get('theme'), 'light');
    assert.deepEqual(favorites.getAll(), {}, 'an absent store restores as empty, which is what the file says');
    assert.deepEqual(sentences.getAll(), []);
  });
});

describe('restore', () => {
  test('replaces rather than merges — a restored file is the whole truth', () => {
    settings.set('theme', 'dark');
    settings.set('quizMode', 'flip');
    restoreBackup({ data: { settings: { theme: 'light' }, progress: {}, journal: [], practice: [] } });
    assert.deepEqual(settings.getAll(), { theme: 'light' });
  });

  test('touches every store the registry knows about', () => {
    seed();
    restoreBackup({ data: { settings: {}, progress: {}, journal: [], practice: [], favorites: {}, sentences: [] } });
    for (const { name, store, kind } of STORES) {
      const value = store.getAll();
      assert.equal(kind === 'list' ? value.length : Object.keys(value).length, 0, `${name} should have been replaced`);
    }
  });

  /* review.js normalizes every record it reads, precisely so a partial one
     degrades rather than throwing. A backup holding half-written records is
     therefore restorable, and refusing it would cost the reader everything
     else in the file. */
  test('accepts a progress map whose records are incomplete', () => {
    const payload = { app: 'Bigu', data: {
      settings: {}, progress: { 'n5-001': { learned: true }, 'n5-002': 'nonsense' }, journal: [], practice: [],
    } };
    assert.equal(describeBackupProblem(payload), null);
    assert.doesNotThrow(() => restoreBackup(payload));
  });
});
