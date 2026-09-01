/* ==========================================================================
   test/streak.test.mjs
   study/streak.js — which calendar days count as studied, and how long the
   current unbroken run is.

   Two things here are easy to get wrong and impossible to notice: the
   local-vs-UTC date boundary, and whether an empty today breaks the run.
   The first is a bug that only appears for readers in certain timezones
   studying late at night; the second is the difference between a streak
   that encourages and one that punishes.
   ========================================================================== */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const { journal, practice } = await import('../js/core/storage.js');
const { toDateKey, todayKey, countReviewedToday, collectStudyDays, computeStreak, currentStreak } =
  await import('../js/study/streak.js');

beforeEach(() => installMemoryStorage());

/* Local midnight n days back, as a timestamp — the same clock the module
   reads, so a test never straddles a boundary the code does not. */
function daysAgo(n, hour = 12) {
  const date = new Date();
  date.setDate(date.getDate() - n);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

const keyDaysAgo = (n) => toDateKey(new Date(daysAgo(n)));

describe('date keys', () => {
  test('are built from local calendar fields, not from UTC', () => {
    /* A session finished at 23:30 belongs to the day the reader just spent.
       toISOString() would push it to tomorrow for anyone east of Greenwich
       and is the single most common way an app gets this wrong. */
    const lateTonight = new Date();
    lateTonight.setHours(23, 30, 0, 0);
    assert.equal(toDateKey(lateTonight), todayKey());

    const earlyToday = new Date();
    earlyToday.setHours(0, 15, 0, 0);
    assert.equal(toDateKey(earlyToday), todayKey());
  });

  test('are zero-padded ISO calendar dates', () => {
    assert.equal(toDateKey(new Date(2026, 0, 5)), '2026-01-05');
    assert.equal(toDateKey(new Date(2026, 11, 31)), '2026-12-31');
  });
});

describe('what makes a day count', () => {
  test('a journal entry, a finished round, or a word first met — any one of the three', () => {
    const days = collectStudyDays({
      entries: [{ date: '2026-01-01' }],
      sessions: [{ createdAt: new Date(2026, 0, 2, 9).getTime() }],
      records: [{ firstSeen: new Date(2026, 0, 3, 9).getTime(), lastSeen: 0 }],
    });
    assert.deepEqual([...days.keys()].sort(), ['2026-01-01', '2026-01-02', '2026-01-03']);
  });

  /* The regression this guards: the streak read the journal alone, so a
     reader who reviewed a hundred cards a day for a month saw zero. */
  test('review alone is enough — the hero number does not require journalling', () => {
    const days = collectStudyDays({
      entries: [],
      sessions: [{ createdAt: daysAgo(0) }, { createdAt: daysAgo(1) }],
      records: [],
    });
    assert.equal(computeStreak(days), 2);
  });

  test('a day keeps the set of kinds, not just the fact of one', () => {
    const days = collectStudyDays({
      entries: [{ date: '2026-01-01' }],
      sessions: [{ createdAt: new Date(2026, 0, 1, 9).getTime() }],
      records: [],
    });
    assert.equal(days.get('2026-01-01').size, 2);
  });

  /* lastSeen moves on every grade; firstSeen never moves. Reading lastSeen
     as "met a new word" put шинэ үг on a day spent entirely on revision,
     and lost the day a word was actually first met as soon as it came round
     again. */
  test('a reviewed-again word marks revision today and its first meeting back then', () => {
    const days = collectStudyDays({
      entries: [],
      sessions: [],
      records: [{ firstSeen: daysAgo(10), lastSeen: daysAgo(0) }],
    });
    assert.deepEqual([...days.get(keyDaysAgo(0))], ['давталт']);
    assert.deepEqual([...days.get(keyDaysAgo(10))], ['шинэ үг']);
  });

  test('a null record in the list is skipped rather than thrown on', () => {
    assert.doesNotThrow(() => collectStudyDays({ entries: [], sessions: [], records: [null, undefined] }));
  });

  test('an entry with no date is ignored', () => {
    const days = collectStudyDays({ entries: [{ date: undefined }, {}], sessions: [], records: [] });
    assert.equal(days.size, 0);
  });
});

describe('the run', () => {
  const from = (...offsets) => new Map(offsets.map((n) => [keyDaysAgo(n), new Set(['давталт'])]));

  test('counts back from today', () => {
    assert.equal(computeStreak(from(0, 1, 2, 3)), 4);
  });

  /* The streak is not broken until a whole day has passed with nothing in
     it. Counting an empty today as a break would show a reader a broken run
     every morning before they had a chance to study, which is the exact
     pressure this app says it does not apply. */
  test('an empty today does not break yesterday\'s run', () => {
    assert.equal(computeStreak(from(1, 2, 3)), 3);
  });

  test('a full missed day does break it', () => {
    assert.equal(computeStreak(from(2, 3, 4)), 0);
  });

  test('a gap ends the run at the gap, however much sits behind it', () => {
    assert.equal(computeStreak(from(0, 1, 3, 4, 5, 6, 7)), 2);
  });

  test('no study days at all is a run of zero, not a crash', () => {
    assert.equal(computeStreak(new Map()), 0);
  });

  test('a single day today is a run of one', () => {
    assert.equal(computeStreak(from(0)), 1);
  });
});

describe('currentStreak', () => {
  test('reads the three stores itself and agrees with the two steps', () => {
    journal.add({ date: todayKey(), text: 'x' });
    practice.add({ total: 5, correct: 5, mode: 'due' });
    assert.equal(currentStreak(), 1);
  });

  test('is zero on an empty install rather than undefined', () => {
    assert.equal(currentStreak(), 0);
  });
});

/* -- Today's count ------------------------------------------------------------------------
   What the daily-goal line on Review reports. It is read off the progress
   records' own lastSeen rather than from a counter, which is what keeps it
   correct across a restored backup — and what makes the local-midnight
   boundary its own thing to get wrong.
   ------------------------------------------------------------------------------------------ */

describe("today's count", () => {
  function records(entries) {
    return new Map(entries.map(([id, lastSeen]) => [id, { lastSeen }]));
  }

  test('counts the records touched today and no others', () => {
    assert.equal(
      countReviewedToday(records([
        ['a', daysAgo(0)],
        ['b', daysAgo(0, 9)],
        ['c', daysAgo(1)],
        ['d', daysAgo(30)],
      ])),
      2,
    );
  });

  test('a record never seen is not a record reviewed today', () => {
    assert.equal(countReviewedToday(records([['a', 0], ['b', undefined]])), 0);
  });

  test('the boundary is local midnight, not UTC', () => {
    const lateLastNight = new Date();
    lateLastNight.setDate(lateLastNight.getDate() - 1);
    lateLastNight.setHours(23, 30, 0, 0);

    const earlyToday = new Date();
    earlyToday.setHours(0, 30, 0, 0);

    assert.equal(
      countReviewedToday(records([['a', lateLastNight.getTime()], ['b', earlyToday.getTime()]])),
      1,
      'the round finished at 23:30 belongs to the day the reader spent',
    );
  });

  test('no records at all is zero, not a throw', () => {
    assert.equal(countReviewedToday(new Map()), 0);
  });
});
