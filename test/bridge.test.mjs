/* ==========================================================================
   test/bridge.test.mjs
   core/bridge.js — the one-way publish to `bigu:bridge`.

   The reason this is tested harder than its size suggests: the envelope is
   a *contract* with a surface outside this repository. Nothing in Bigu
   reads it back, so no screen in this app would ever look wrong if the
   shape broke — the only symptom would be on the other side, in code this
   repository cannot see. The version field, the event cap, the dedupe and
   the merge behaviour are the whole of that contract.
   ========================================================================== */

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage, installFailingStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const { publishEvent, publishEvents, publishStatus, clearBridge } = await import('../js/core/bridge.js');

const KEY = 'bigu:bridge';
const read = () => JSON.parse(localStorage.getItem(KEY));

beforeEach(() => installMemoryStorage());

describe('the envelope', () => {
  test('carries its version and app name on every write', () => {
    publishStatus({ dueCount: 3 });
    const state = read();
    assert.equal(state.v, 2);
    assert.equal(state.app, 'Bigu');
    assert.equal(typeof state.updatedAt, 'number');
    assert.ok(state.updatedAt > 0);
  });

  /* `bigu:bridge` sits beside the app's own `bigu:<store>` keys but is not
     one of them: nothing in storage.js knows about it, and nothing in Bigu
     reads it back. Its shape is a contract with an outside surface. */
  /* An envelope from a different version of the contract is dropped whole
     rather than merged into: relabelling one version's entries with
     another's `v` is the one lie the field exists to prevent. The rounds
     themselves are not lost — study/session.js republishes them from the
     practice store at the next boot. */
  test('an envelope from another version is dropped, not relabelled', () => {
    localStorage.setItem(KEY, JSON.stringify({
      v: 1, app: 'Bigu', status: { xp: 4000 }, events: [{ id: 'old', type: 'v1.thing' }],
    }));
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    const state = read();
    assert.equal(state.v, 2);
    assert.deepEqual(state.events.map((event) => event.id), ['a'], 'the v1 events did not come across');
    assert.equal(state.status, null, 'nor did the v1 status');
  });

  test('is not one of the app\'s stores', async () => {
    const { STORES } = await import('../js/core/storage.js');
    publishStatus({ dueCount: 1 });
    assert.ok(localStorage.getItem(KEY));
    assert.equal(STORES.some((entry) => entry.name === 'bridge'), false);
  });
});

describe('events', () => {
  test('append oldest first, each with a local calendar date', () => {
    publishEvent({ id: 'a', type: 'review.session', value: 7, detail: '10 items' });
    publishEvent({ id: 'b', type: 'review.session', value: 4, detail: '5 items' });

    const { events } = read();
    assert.deepEqual(events.map((event) => event.id), ['a', 'b']);
    assert.match(events[0].date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(events[0].value, 7);
    assert.equal(events[0].detail, '10 items');
  });

  /* The id is the one the practice store already generated for that round,
     so a reader on the other side can dedupe on it — which is also why
     re-publishing one is a no-op rather than a second entry. */
  test('a repeated id is a no-op, not a duplicate', () => {
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    assert.equal(publishEvent({ id: 'a', type: 'review.session', value: 99 }), true);
    const { events } = read();
    assert.equal(events.length, 1);
    assert.equal(events[0].value, 1, 'the first write stands');
  });

  test('an event with no id or no type is refused', () => {
    assert.equal(publishEvent({ type: 'review.session' }), false);
    assert.equal(publishEvent({ id: 'a' }), false);
    assert.equal(publishEvent(), false);
    assert.equal(localStorage.getItem(KEY), null, 'nothing was written');
  });

  test('the log is capped at the newest 50 so the key cannot grow without bound', () => {
    for (let i = 0; i < 60; i += 1) publishEvent({ id: `e${i}`, type: 'review.session', value: i });
    const { events } = read();
    assert.equal(events.length, 50);
    assert.equal(events[0].id, 'e10', 'the oldest ten were dropped');
    assert.equal(events.at(-1).id, 'e59');
  });
});

describe('status', () => {
  test('is replaced outright, not merged with how things stood an hour ago', () => {
    publishStatus({ dueCount: 10, streak: 4 });
    publishStatus({ dueCount: 2 });
    assert.deepEqual(read().status, { dueCount: 2 });
  });

  /* A caller with no streak to report publishes a status with no `streak`
     key, which is a reader's cue to show nothing there rather than a zero. */
  test('undefined fields are dropped rather than written as null', () => {
    publishStatus({ dueCount: 5, streak: undefined, lastStudied: undefined });
    assert.deepEqual(read().status, { dueCount: 5 });
    assert.equal('streak' in read().status, false);
  });

  test('an explicit zero is kept — it is a value, unlike an absent one', () => {
    publishStatus({ dueCount: 0 });
    assert.equal(read().status.dueCount, 0);
  });
});

describe('the two publishers do not overwrite each other', () => {
  test('publishing an event leaves the status exactly as it was found', () => {
    publishStatus({ dueCount: 9, streak: 3 });
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    assert.deepEqual(read().status, { dueCount: 9, streak: 3 });
    assert.equal(read().events.length, 1);
  });

  test('publishing a status leaves the events exactly as they were found', () => {
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    publishStatus({ dueCount: 9 });
    assert.equal(read().events.length, 1);
    assert.equal(read().events[0].id, 'a');
  });
});

describe('a damaged key', () => {
  test('unparseable text is replaced rather than throwing', () => {
    localStorage.setItem(KEY, 'not json at all');
    assert.equal(publishStatus({ dueCount: 1 }), true);
    assert.deepEqual(read().status, { dueCount: 1 });
  });

  test('a partly-corrupted payload is repaired field by field', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, app: 'Bigu', status: { dueCount: 4 }, events: 'broken' }));
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    const state = read();
    assert.deepEqual(state.status, { dueCount: 4 }, 'the good half survives');
    assert.equal(state.events.length, 1, 'the bad half is rebuilt');
  });

  test('non-object entries in the event list are dropped', () => {
    localStorage.setItem(KEY, JSON.stringify({ v: 2, app: 'Bigu', events: [null, 'x', { id: 'keep' }] }));
    publishEvent({ id: 'new', type: 'review.session' });
    assert.deepEqual(read().events.map((event) => event.id), ['keep', 'new']);
  });
});

describe('a batch of events', () => {
  /* One read and one write for the whole batch. This is the republish at
     boot, which offers the entire practice history every time. */
  test('appends in the order given and dedupes against what is already there', () => {
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    publishEvents([
      { id: 'a', type: 'review.session', value: 99 },
      { id: 'b', type: 'lesson.quiz', value: 2 },
      { id: 'c', type: 'review.session', value: 3 },
    ]);
    const { events } = read();
    assert.deepEqual(events.map((event) => event.id), ['a', 'b', 'c']);
    assert.equal(events[0].value, 1, 'the first write of an id stands');
  });

  test('a repeat within the batch itself is added once', () => {
    publishEvents([
      { id: 'a', type: 'review.session', value: 1 },
      { id: 'a', type: 'review.session', value: 2 },
    ]);
    assert.equal(read().events.length, 1);
  });

  /* A round republished out of the practice store carries the moment it
     happened, not the moment it was republished — otherwise a reader is
     handed a timeline that says every round in the log happened today, and
     has no way to correct it. */
  test('an event carries the time it is given, dated in local terms', () => {
    const at = new Date(2025, 0, 31, 23, 30).getTime();
    publishEvents([{ id: 'a', type: 'review.session', value: 1, at }]);
    const [event] = read().events;
    assert.equal(event.at, at);
    assert.equal(event.date, '2025-01-31');
  });

  /* `updatedAt` has to keep meaning "when something last changed" rather
     than "when Bigu was last opened", or a reader cannot tell a stale key
     from a quiet one. Boot offers the whole history on every visit and adds
     nothing on all but the first. */
  test('a batch that adds nothing writes nothing', () => {
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    const before = read().updatedAt;
    assert.equal(publishEvents([{ id: 'a', type: 'review.session', value: 1 }]), true);
    assert.equal(read().updatedAt, before, 'the envelope was left alone');
    assert.equal(publishEvents([]), true);
    assert.equal(read().updatedAt, before);
  });

  test('entries with no id or no type are skipped, the rest go in', () => {
    publishEvents([{ type: 'review.session' }, null, { id: 'b', type: 'review.session' }]);
    assert.deepEqual(read().events.map((event) => event.id), ['b']);
  });

  test('the cap applies to the batch too', () => {
    publishEvents(Array.from({ length: 60 }, (_, i) => ({ id: `e${i}`, type: 'review.session', value: i })));
    const { events } = read();
    assert.equal(events.length, 50);
    assert.equal(events[0].id, 'e10');
  });
});

describe('clearing', () => {
  /* `bigu:bridge` is not one of storage.js's stores, so clearAll() cannot
     reach it. Start over emptied every store and left a streak, a due count
     and fifty finished rounds standing on the other surface — this
     browser's study history, still on display, after the reader asked for
     it to be gone. */
  test('takes the key away rather than writing an empty envelope', () => {
    publishStatus({ dueCount: 9, streak: 12 });
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    assert.equal(clearBridge(), true);
    assert.equal(localStorage.getItem(KEY), null, 'no key at all, as before the first visit');
  });

  test('publishing after a clear starts from an empty envelope', () => {
    publishStatus({ dueCount: 9, streak: 12 });
    publishEvent({ id: 'a', type: 'review.session', value: 1 });
    clearBridge();
    publishStatus({ dueCount: 0 });
    const state = read();
    assert.deepEqual(state.status, { dueCount: 0 });
    assert.deepEqual(state.events, [], 'the old history did not come back');
  });
});

describe('a browser that refuses to store', () => {
  beforeEach(() => installFailingStorage());

  /* A study session must finish normally even when the bridge cannot write
     a byte. Neither publisher may throw into the round that called it. */
  test('both publishers report false and neither throws', () => {
    assert.doesNotThrow(() => {
      assert.equal(publishEvent({ id: 'a', type: 'review.session', value: 1 }), false);
      assert.equal(publishEvents([{ id: 'b', type: 'review.session', value: 1 }]), false);
      assert.equal(publishStatus({ dueCount: 1 }), false);
      assert.equal(clearBridge(), false);
    });
  });
});
