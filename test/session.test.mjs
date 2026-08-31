/* ==========================================================================
   test/session.test.mjs
   study/session.js — the one path every finished round takes, and the
   republish that keeps the bridge's event log honest.

   recordSession() is covered where it shows: the practice store gains a
   record and `bigu:bridge` gains an event under that same id. publishHistory()
   is covered harder, for the same reason bridge.js is — it exists for
   moments the app itself would never look wrong in. A restored backup, a
   cleared key or an envelope from an older contract leaves the practice
   store holding rounds the bridge never watched arrive, and the only
   symptom is on a surface this repository cannot see.

   publishStatusSnapshot() is not tested here: it waits on the four content
   files over fetch(), which is the browser suite's job.
   ========================================================================== */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const { recordSession, publishHistory } = await import('../js/study/session.js');
const { practice } = await import('../js/core/storage.js');
const { publishEvent, clearBridge } = await import('../js/core/bridge.js');

const KEY = 'bigu:bridge';
const read = () => JSON.parse(localStorage.getItem(KEY) ?? 'null');

beforeEach(() => installMemoryStorage());

describe('logging a round', () => {
  test('writes the practice record and publishes it under the same id', () => {
    const record = recordSession({ total: 10, correct: 7, mode: 'all' });

    assert.ok(record.id);
    assert.deepEqual(practice.getAll().map((entry) => entry.id), [record.id]);

    const [event] = read().events;
    assert.equal(event.id, record.id, 'the reader can dedupe a round against the store');
    assert.equal(event.type, 'review.session');
    assert.equal(event.value, 7);
    assert.equal(event.detail, '10 items · 7 correct');
  });

  test('a lesson quiz is published as one, not as a review', () => {
    recordSession({ total: 4, correct: 4, mode: 'lessons', eventType: 'lesson.quiz' });
    assert.equal(read().events[0].type, 'lesson.quiz');
  });

  /* A round ended before anything was graded logs nothing. Reporting 0/0 is
     reporting nothing. */
  test('an ungraded round writes neither a record nor an event', () => {
    assert.equal(recordSession({ total: 0, correct: 0, mode: 'all' }), null);
    assert.deepEqual(practice.getAll(), []);
    assert.equal(localStorage.getItem(KEY), null);
  });
});

describe('republishing the rounds the store already holds', () => {
  /* The shape a restore leaves behind: the file's rounds are in the store,
     and the key was taken away with the rest of this browser's data. */
  function seedStore(rounds) {
    for (const round of rounds) practice.add(round);
    const stored = JSON.parse(localStorage.getItem('bigu:practice'));
    // practice.add() stamps createdAt with the clock; these rounds are meant
    // to have happened on their own days.
    for (const [index, round] of rounds.entries()) {
      if (round.createdAt) stored[index].createdAt = round.createdAt;
    }
    localStorage.setItem('bigu:practice', JSON.stringify(stored));
    return stored;
  }

  test('rebuilds an empty log from the store, oldest first', () => {
    const [first, second] = seedStore([
      { total: 5, correct: 5, mode: 'all', createdAt: new Date(2025, 0, 2, 9, 0).getTime() },
      { total: 8, correct: 6, mode: 'lessons', createdAt: new Date(2025, 0, 5, 9, 0).getTime() },
    ]);
    clearBridge();

    assert.equal(publishHistory(), true);
    const { events } = read();
    assert.deepEqual(events.map((event) => event.id), [first.id, second.id]);
    assert.deepEqual(events.map((event) => event.type), ['review.session', 'lesson.quiz']);
    assert.deepEqual(events.map((event) => event.date), ['2025-01-02', '2025-01-05']);
    assert.equal(events[1].detail, '8 items · 6 correct');
  });

  test('rounds are dated when they happened, not when they were republished', () => {
    const [round] = seedStore([
      { total: 3, correct: 3, mode: 'all', createdAt: new Date(2024, 10, 20, 23, 30).getTime() },
    ]);
    publishHistory();
    const [event] = read().events;
    assert.equal(event.at, round.createdAt);
    assert.equal(event.date, '2024-11-20', 'the local day the reader spent');
  });

  test('a store written in any order comes out oldest first', () => {
    const [late, early] = seedStore([
      { total: 2, correct: 2, mode: 'all', createdAt: new Date(2025, 2, 9).getTime() },
      { total: 2, correct: 1, mode: 'all', createdAt: new Date(2025, 1, 1).getTime() },
    ]);
    publishHistory();
    assert.deepEqual(read().events.map((event) => event.id), [early.id, late.id]);
  });

  /* Boot offers the whole history on every visit, so the ordinary case is
     that it has nothing to add. It must not touch the envelope then, or
     `updatedAt` stops meaning "when something last changed". */
  test('an already-published history is a no-op', () => {
    seedStore([{ total: 5, correct: 5, mode: 'all' }]);
    publishHistory();
    const before = read().updatedAt;

    assert.equal(publishHistory(), true);
    assert.equal(read().updatedAt, before);
    assert.equal(read().events.length, 1);
  });

  test('a round already in the log is not published twice under another type', () => {
    const [round] = seedStore([{ total: 5, correct: 5, mode: 'lessons' }]);
    publishEvent({ id: round.id, type: 'lesson.quiz', value: 5 });
    publishHistory();
    assert.equal(read().events.length, 1);
  });

  test('an empty store publishes nothing at all', () => {
    assert.equal(publishHistory(), true);
    assert.equal(localStorage.getItem(KEY), null, 'a first visit leaves no key behind');
  });

  test('damaged records are skipped rather than published as holes', () => {
    localStorage.setItem('bigu:practice', JSON.stringify([
      null,
      { total: 4, correct: 2 },
      { id: 'good', createdAt: Date.now(), total: 4, correct: 2, mode: 'all' },
      { id: 'empty', createdAt: Date.now(), total: 0, correct: 0, mode: 'all' },
    ]));
    publishHistory();
    assert.deepEqual(read().events.map((event) => event.id), ['good']);
  });
});
