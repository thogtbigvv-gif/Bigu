/* ==========================================================================
   review.js
   The scheduling layer: what the reader has seen, how well they knew it, and
   when it should come back.

   Before this, progress was a single boolean per item — `learned: true/false`
   — and "review" meant "shuffle everything not marked learned". That gets
   *less* useful as a deck grows, which is exactly backwards: the whole point
   of spaced repetition is that a bigger deck costs no more time per day
   because the schedule decides what surfaces. This module is that decision.

   The ladder is SM-2 shaped but deliberately simpler: five levels with fixed
   intervals, up one on a pass, down two on a miss. No per-item ease factor —
   grading here is a self-reported binary ("I knew it" / "Still learning"),
   which doesn't carry enough signal to fit a per-item difficulty curve, and
   pretending otherwise would just add numbers nobody could act on.

   Everything is stored in storage.js's existing `progress` map, one record
   per item id, so no new store and no data migration are needed.
   ========================================================================== */

import { progress } from './storage.js';

const DAY = 86400000;

/* Level 0 is "seen but not known" — due immediately, no waiting. Levels 1-5
   are the ladder. A miss drops two levels rather than resetting to 0: losing
   a month-long interval entirely because of one bad recall is punishing
   enough that readers stop grading honestly. */
const INTERVALS_DAYS = [0, 1, 3, 7, 14, 30];
const MAX_LEVEL = INTERVALS_DAYS.length - 1;

function clampLevel(level) {
  return Math.min(Math.max(level, 0), MAX_LEVEL);
}

function dueAtFor(level, from = Date.now()) {
  return from + INTERVALS_DAYS[clampLevel(level)] * DAY;
}

/* -- Records -----------------------------------------------------------------------------
   Reads a stored record into a complete shape whatever version wrote it.

   Records written before scheduling existed hold only `{ learned }`. Those
   are read as level 1 (learned) or level 0 (not), with dueAt 0 — which puts
   them in the due pile the first time the reader comes back, so one round of
   grading re-anchors each of them onto the ladder. That is self-healing and
   needs no migration pass; the alternative, inventing a due date for study
   that never happened, would be a worse lie than "check these again".
   -------------------------------------------------------------------------------------------- */

function getRecord(itemId) {
  const stored = progress.get(itemId);

  if (!stored || typeof stored !== 'object') {
    return { seen: false, learned: false, level: 0, lastSeen: 0, dueAt: 0 };
  }

  const learned = Boolean(stored.learned);
  const level = Number.isInteger(stored.level) ? clampLevel(stored.level) : (learned ? 1 : 0);

  return {
    seen: true,
    learned,
    level,
    lastSeen: Number(stored.lastSeen) || 0,
    dueAt: Number(stored.dueAt) || 0,
  };
}

function writeRecord(itemId, record) {
  progress.set(itemId, {
    learned: record.learned,
    level: record.level,
    lastSeen: record.lastSeen,
    dueAt: record.dueAt,
  });
}

/* -- Queries ------------------------------------------------------------------------------- */

function isLearned(itemId) {
  return getRecord(itemId).learned;
}

/* An item with no record at all is *new*, not due. The difference matters:
   on an 800-word deck, counting untouched words as "due today" would put a
   number on the dashboard that no amount of studying could ever bring down,
   which is the opposite of what a due count is for. */
function isNew(itemId) {
  return !getRecord(itemId).seen;
}

function isDue(itemId, now = Date.now()) {
  const record = getRecord(itemId);
  return record.seen && record.dueAt <= now;
}

function dueItems(items, now = Date.now()) {
  return items
    .filter((item) => isDue(item.id, now))
    .sort((a, b) => getRecord(a.id).dueAt - getRecord(b.id).dueAt);
}

function newItems(items) {
  return items.filter((item) => isNew(item.id));
}

/* What the Dashboard's Today card counts. Kept here rather than in
   dashboard.js so "due" means one thing everywhere in the app. */
function countDue(items, now = Date.now()) {
  let due = 0;
  let fresh = 0;
  let learned = 0;

  for (const item of items) {
    const record = getRecord(item.id);
    if (!record.seen) fresh += 1;
    else if (record.dueAt <= now) due += 1;
    if (record.learned) learned += 1;
  }

  return { due, new: fresh, learned, total: items.length };
}

/* -- Grading -------------------------------------------------------------------------------
   The one write path used by every grading surface in the app: the Review
   deck, the per-lesson quiz, and the "Mark as learned" chip on every card.
   Returns the new record so a caller can show the resulting interval.
   -------------------------------------------------------------------------------------------- */

function grade(itemId, knewIt, now = Date.now()) {
  const record = getRecord(itemId);
  const level = clampLevel(knewIt ? record.level + 1 : record.level - 2);

  const next = {
    seen: true,
    // Level 0 is the only "not learned" state — one correct recall is enough
    // to count as learned, which keeps the meaning the toggle chips already
    // had before scheduling existed.
    learned: level >= 1,
    level,
    lastSeen: now,
    dueAt: dueAtFor(level, now),
  };

  writeRecord(itemId, next);
  return next;
}

/* The manual chip on a card is a statement, not a recall test, so it doesn't
   climb the ladder: marking something learned parks it one day out, and
   un-marking it makes it due now. */
function setLearned(itemId, learned, now = Date.now()) {
  const record = getRecord(itemId);
  const level = learned ? Math.max(record.level, 1) : 0;

  const next = {
    seen: true,
    learned,
    level,
    lastSeen: now,
    dueAt: dueAtFor(level, now),
  };

  writeRecord(itemId, next);
  return next;
}

/* -- Session building -----------------------------------------------------------------------
   Due items first, oldest due date first, then new items to top up. This is
   the whole behavioural difference from the old shuffle: what you see is
   what the schedule says is ready, not a random handful of whatever isn't
   ticked off yet.
   -------------------------------------------------------------------------------------------- */

function shuffled(items) {
  const copy = items.slice();
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildSession(items, size, now = Date.now()) {
  const due = dueItems(items, now).slice(0, size);
  if (due.length >= size) return due;

  const fresh = shuffled(newItems(items)).slice(0, size - due.length);
  const session = [...due, ...fresh];
  if (session.length > 0) return session;

  // Nothing due and nothing new: everything is scheduled ahead. Rather than
  // showing an empty round, offer the items closest to coming back — early
  // review costs the reader nothing but a minute, and an empty screen where
  // they expected a study session costs them the habit.
  return items
    .slice()
    .sort((a, b) => getRecord(a.id).dueAt - getRecord(b.id).dueAt)
    .slice(0, size);
}

/* Human-readable interval for the grade feedback — "back in 3 days". */
function describeNextReview(record, now = Date.now()) {
  const days = Math.round((record.dueAt - now) / DAY);
  if (days <= 0) return 'again this round';
  if (days === 1) return 'back tomorrow';
  return `back in ${days} days`;
}

export {
  INTERVALS_DAYS,
  MAX_LEVEL,
  getRecord,
  isLearned,
  isNew,
  isDue,
  dueItems,
  newItems,
  countDue,
  grade,
  setLearned,
  buildSession,
  describeNextReview,
  shuffled,
};
