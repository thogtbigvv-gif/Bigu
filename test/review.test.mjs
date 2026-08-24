/* ==========================================================================
   test/review.test.mjs
   study/review.js — the memory model. The spaced-repetition ladder, the
   continuous strength estimate drawn on #memory, and the session builder.

   This is the module with the most behaviour and the least visibility. Its
   output is a date weeks out and a number between 0 and 1; a mistake in it
   does not throw, it just quietly schedules things wrong, and nobody finds
   out for a month. Everything here is deterministic — every function takes
   `now` — so all of it can be checked exactly rather than approximately.
   ========================================================================== */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const { progress } = await import('../js/core/storage.js');
const {
  getRecord, snapshotRecords, strengthOf, bandFor, describeTiming,
  isRemembered, rememberedCount, countDue, grade, setRemembered,
  buildSession, describeNextReview, shuffled, FAINT_STRENGTH,
} = await import('../js/study/review.js');

const DAY = 86400000;
const T0 = Date.UTC(2026, 0, 15, 12, 0, 0);

beforeEach(() => installMemoryStorage());

const item = (id) => ({ id });

describe('reading a record', () => {
  test('an item never seen reads as empty rather than missing', () => {
    const record = getRecord('n5-001');
    assert.deepEqual(record, {
      seen: false, remembered: false, level: 0,
      lastSeen: 0, dueAt: 0, firstSeen: 0, reviews: 0, lapses: 0,
    });
  });

  test('a pre-scheduling record — { learned: true } and nothing else — reads as level 1, due now', () => {
    progress.set('n5-001', { learned: true });
    const record = getRecord('n5-001');
    assert.equal(record.seen, true);
    assert.equal(record.remembered, true);
    assert.equal(record.level, 1);
    // dueAt 0 puts it in the due pile on the reader's next visit, which
    // re-anchors it onto the ladder without a migration pass.
    assert.equal(record.dueAt, 0);
  });

  test('{ learned: false } reads as level 0', () => {
    progress.set('n5-002', { learned: false });
    assert.equal(getRecord('n5-002').level, 0);
  });

  test('a record with no firstSeen falls back to lastSeen, so an old word can never look new', () => {
    progress.set('n5-003', { learned: true, level: 3, lastSeen: T0, dueAt: T0 + 7 * DAY });
    assert.equal(getRecord('n5-003').firstSeen, T0);
  });

  test('a level outside the ladder is clamped rather than trusted', () => {
    progress.set('n5-004', { learned: true, level: 99 });
    assert.equal(getRecord('n5-004').level, 5);
    progress.set('n5-005', { learned: true, level: -4 });
    assert.equal(getRecord('n5-005').level, 0);
  });

  test('garbage in a record degrades field by field instead of throwing', () => {
    progress.set('n5-006', { learned: true, level: 'three', lastSeen: 'yesterday', reviews: null });
    const record = getRecord('n5-006');
    assert.equal(record.level, 1, 'a non-integer level falls back to remembered ? 1 : 0');
    assert.equal(record.lastSeen, 0);
    assert.equal(record.reviews, 0);
  });

  test('a non-object stored value reads as the empty record', () => {
    progress.set('n5-007', 'nonsense');
    assert.equal(getRecord('n5-007').seen, false);
  });
});

describe('grading', () => {
  test('a pass climbs one level and widens the interval 1 → 3 → 7 → 14 → 30', () => {
    const expected = [1, 3, 7, 14, 30, 30];
    let now = T0;
    for (const days of expected) {
      const record = grade('n5-001', true, now);
      assert.equal(record.dueAt - now, days * DAY, `after a pass at level ${record.level}`);
      now += days * DAY;
    }
  });

  test('level tops out at 5 rather than climbing forever', () => {
    let record;
    for (let i = 0; i < 10; i += 1) record = grade('n5-001', true, T0);
    assert.equal(record.level, 5);
  });

  test('a miss drops two levels, not to zero', () => {
    for (let i = 0; i < 4; i += 1) grade('n5-001', true, T0);
    assert.equal(getRecord('n5-001').level, 4);
    const missed = grade('n5-001', false, T0);
    assert.equal(missed.level, 2);
    assert.equal(missed.dueAt - T0, 3 * DAY);
  });

  test('a miss at level 1 floors at 0 and is due immediately', () => {
    grade('n5-001', true, T0);
    const missed = grade('n5-001', false, T0);
    assert.equal(missed.level, 0);
    assert.equal(missed.dueAt, T0);
    assert.equal(missed.remembered, false);
  });

  test('reviews count every attempt; lapses count only the misses', () => {
    grade('n5-001', true, T0);
    grade('n5-001', false, T0);
    grade('n5-001', true, T0);
    const record = getRecord('n5-001');
    assert.equal(record.reviews, 3);
    assert.equal(record.lapses, 1);
  });

  test('lapses are never decremented — a good week does not erase the history', () => {
    grade('n5-001', false, T0);
    for (let i = 0; i < 5; i += 1) grade('n5-001', true, T0);
    assert.equal(getRecord('n5-001').lapses, 1);
  });

  test('firstSeen is set once and never moved', () => {
    grade('n5-001', true, T0);
    grade('n5-001', true, T0 + 30 * DAY);
    assert.equal(getRecord('n5-001').firstSeen, T0);
  });

  test('the stored shape keeps the legacy `learned` key, so old backups still read', () => {
    grade('n5-001', true, T0);
    assert.equal(progress.get('n5-001').learned, true);
    assert.equal('remembered' in progress.get('n5-001'), false);
  });
});

describe('the manual keep/unkeep chip', () => {
  test('keeping parks an item one day out without counting as a review', () => {
    const record = setRemembered('n5-001', true, T0);
    assert.equal(record.remembered, true);
    assert.equal(record.level, 1);
    assert.equal(record.dueAt - T0, DAY);
    assert.equal(record.reviews, 0);
    assert.equal(record.lapses, 0);
  });

  test('keeping never lowers a level already earned', () => {
    for (let i = 0; i < 4; i += 1) grade('n5-001', true, T0);
    const record = setRemembered('n5-001', true, T0);
    assert.equal(record.level, 4);
  });

  test('unkeeping drops to 0 and due now, but is not a lapse', () => {
    grade('n5-001', true, T0);
    const record = setRemembered('n5-001', false, T0);
    assert.equal(record.level, 0);
    assert.equal(record.dueAt, T0);
    assert.equal(record.lapses, 0, 'un-marking is a statement, not a failed recall');
  });
});

describe('memory strength', () => {
  test('an unseen item holds nothing', () => {
    assert.equal(strengthOf(getRecord('n5-001'), T0), 0);
  });

  test('strength is 1 the moment it is recalled', () => {
    const record = grade('n5-001', true, T0);
    assert.equal(strengthOf(record, T0), 1);
  });

  /* The model and the schedule are the same statement: an item's half-life
     is its own interval, so it comes back exactly when it is estimated to be
     at half strength. If this ever drifts, "due" becomes an arbitrary flag. */
  test('every level sits at exactly 0.5 on its own due date', () => {
    for (let level = 1; level <= 5; level += 1) {
      installMemoryStorage();
      for (let i = 0; i < level; i += 1) grade('n5-001', true, T0);
      const record = getRecord('n5-001');
      assert.equal(record.level, level);
      assert.ok(
        Math.abs(strengthOf(record, record.dueAt) - 0.5) < 1e-9,
        `level ${level} should be at half strength on its due date`,
      );
    }
  });

  test('a missed item is mostly gone by tomorrow', () => {
    const record = grade('n5-001', false, T0);
    assert.ok(Math.abs(strengthOf(record, T0 + 0.5 * DAY) - 0.5) < 1e-9);
    assert.ok(strengthOf(record, T0 + DAY) < 0.3);
  });

  test('strength only ever falls', () => {
    for (let i = 0; i < 3; i += 1) grade('n5-001', true, T0);
    const record = getRecord('n5-001');
    let previous = Infinity;
    for (let day = 0; day <= 60; day += 1) {
      const value = strengthOf(record, T0 + day * DAY);
      assert.ok(value <= previous, `day ${day}`);
      previous = value;
    }
  });

  test('a clock that reads backwards does not produce strength above 1', () => {
    const record = grade('n5-001', true, T0);
    assert.equal(strengthOf(record, T0 - 10 * DAY), 1);
  });
});

describe('strength bands', () => {
  test('every value from 0 to 1 lands in exactly one band', () => {
    for (let i = 0; i <= 100; i += 1) {
      const band = bandFor(i / 100);
      assert.ok(band && band.key && band.label, `no band for ${i / 100}`);
    }
  });

  test('the boundaries are where the labels say they are', () => {
    assert.equal(bandFor(1).key, 'deep');
    assert.equal(bandFor(0.75).key, 'deep');
    assert.equal(bandFor(0.74).key, 'steady');
    assert.equal(bandFor(0.5).key, 'steady');
    assert.equal(bandFor(0.49).key, 'pale');
    assert.equal(bandFor(FAINT_STRENGTH).key, 'pale');
    assert.equal(bandFor(FAINT_STRENGTH - 0.01).key, 'faint');
    assert.equal(bandFor(0).key, 'faint');
  });

  /* Arriving on the day something is due must never land the reader in the
     anxious shelf. That is the whole reason FAINT_STRENGTH sits under 0.5. */
  test('the faint line sits below the 0.5 an on-time item hits', () => {
    assert.ok(FAINT_STRENGTH < 0.5);
  });
});

describe('counting what is waiting', () => {
  const items = [item('a'), item('b'), item('c'), item('d')];

  test('an item with no record is new, never due', () => {
    const counts = countDue(items, T0);
    assert.deepEqual(counts, { due: 0, new: 4, remembered: 0, total: 4 });
  });

  test('due counts only what the schedule has actually released', () => {
    grade('a', true, T0);                    // due T0 + 1 day
    grade('b', true, T0 - 5 * DAY);          // due four days ago
    const counts = countDue(items, T0);
    assert.equal(counts.due, 1, 'b is ready, a is not');
    assert.equal(counts.new, 2);
    assert.equal(counts.remembered, 2);
  });

  test('rememberedCount and isRemembered agree', () => {
    grade('a', true, T0);
    grade('b', false, T0);
    assert.equal(rememberedCount(items), 1);
    assert.equal(isRemembered('a'), true);
    assert.equal(isRemembered('b'), false);
    assert.equal(isRemembered('never-touched'), false);
  });
});

describe('building a session', () => {
  const items = Array.from({ length: 10 }, (_, i) => item(`i${i}`));

  test('due items come first, oldest due date first', () => {
    grade('i3', true, T0 - 10 * DAY);   // due 9 days ago
    grade('i7', true, T0 - 6 * DAY);    // due 5 days ago
    grade('i1', true, T0 - 30 * DAY);   // due 29 days ago
    const session = buildSession(items, 3, T0);
    assert.deepEqual(session.map((entry) => entry.id), ['i1', 'i3', 'i7']);
  });

  test('new items top up a short due pile', () => {
    grade('i3', true, T0 - 10 * DAY);
    const session = buildSession(items, 4, T0);
    assert.equal(session.length, 4);
    assert.equal(session[0].id, 'i3');
    assert.equal(new Set(session.map((entry) => entry.id)).size, 4, 'no repeats');
  });

  test('nothing due and nothing new offers what comes back soonest, not an empty round', () => {
    for (const entry of items) grade(entry.id, true, T0);
    const session = buildSession(items, 3, T0);
    assert.equal(session.length, 3, 'an empty screen where a round was expected costs the habit');
  });

  test('a session never exceeds the size asked for', () => {
    for (const entry of items) grade(entry.id, true, T0 - 40 * DAY);
    assert.equal(buildSession(items, 5, T0).length, 5);
  });

  test('an empty catalogue produces an empty session rather than throwing', () => {
    assert.deepEqual(buildSession([], 10, T0), []);
  });
});

describe('shuffled', () => {
  test('returns a new array and never mutates its input', () => {
    const input = [1, 2, 3, 4, 5];
    const output = shuffled(input);
    assert.notEqual(output, input);
    assert.deepEqual(input, [1, 2, 3, 4, 5]);
    assert.deepEqual(output.slice().sort(), input.slice().sort());
  });

  test('every position is reachable — the Fisher–Yates loop is not off by one', () => {
    const seen = new Set();
    for (let i = 0; i < 400; i += 1) seen.add(shuffled([1, 2, 3]).join(''));
    assert.equal(seen.size, 6, 'all six permutations of three items should appear');
  });
});

describe('saying when', () => {
  test('nothing is ever late — a passed date reads as availability', () => {
    const record = { ...getRecord('x'), seen: true, dueAt: T0 - 5 * DAY };
    const text = describeTiming(record, T0);
    assert.match(text, /бэлэн/, 'reads as ready, never as overdue');
    assert.doesNotMatch(text, /хоцор/, 'never as behind');
  });

  test('a pre-scheduling record with no dueAt does not claim to be 20,000 days old', () => {
    assert.equal(describeTiming({ ...getRecord('x'), dueAt: 0 }, T0), 'одоо бэлэн');
  });

  test('today, tomorrow and yesterday each get their own sentence', () => {
    const at = (offset) => describeTiming({ ...getRecord('x'), seen: true, dueAt: T0 + offset }, T0);
    assert.notEqual(at(0), at(DAY));
    assert.notEqual(at(0), at(-DAY));
    assert.notEqual(at(DAY), at(3 * DAY));
  });

  /* review.js keeps this clause short deliberately: it is printed after a
     separator, and a verdict that wraps to two lines pushes the Continue
     button that much further down a 390px screen. The budget is characters
     rather than words, because that is what actually wraps. */
  test('the next-review clause stays short enough for one line on a phone', () => {
    for (const level of [0, 1, 2, 3, 4, 5]) {
      installMemoryStorage();
      for (let i = 0; i < level; i += 1) grade('n5-001', true, T0);
      const text = describeNextReview(getRecord('n5-001'), T0);
      assert.ok(text.length <= 32, `"${text}" is ${text.length} characters`);
      assert.doesNotMatch(text, /[.。]$/, 'it is a clause, not a sentence — the caller supplies the stop');
    }
  });
});

describe('snapshotRecords', () => {
  test('reads every record in one pass and normalizes each', () => {
    grade('a', true, T0);
    progress.set('b', { learned: true });        // legacy shape
    progress.set('c', 'garbage');                // corrupt
    const records = snapshotRecords();
    assert.equal(records.size, 3);
    assert.equal(records.get('a').level, 1);
    assert.equal(records.get('b').level, 1);
    assert.equal(records.get('c').seen, false);
  });

  test('agrees with getRecord, item for item', () => {
    grade('a', true, T0);
    grade('b', false, T0);
    const records = snapshotRecords();
    for (const id of ['a', 'b']) {
      assert.deepEqual(records.get(id), getRecord(id));
    }
  });
});
