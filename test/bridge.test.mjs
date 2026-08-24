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
const { publishEvent, publishStatus } = await import('../js/core/bridge.js');

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

  test('lives outside the app\'s own namespace, so nothing in Bigu reads it by accident', () => {
    publishStatus({ dueCount: 1 });
    assert.ok(localStorage.getItem(KEY));
    assert.equal(localStorage.getItem('nagi:bridge'), null);
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

describe('a browser that refuses to store', () => {
  beforeEach(() => installFailingStorage());

  /* A study session must finish normally even when the bridge cannot write
     a byte. Neither publisher may throw into the round that called it. */
  test('both publishers report false and neither throws', () => {
    assert.doesNotThrow(() => {
      assert.equal(publishEvent({ id: 'a', type: 'review.session', value: 1 }), false);
      assert.equal(publishStatus({ dueCount: 1 }), false);
    });
  });
});
