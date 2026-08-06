/* ==========================================================================
   review.js
   The memory layer: what the reader has met, how strongly they still hold
   it, and when it should come back.

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

   On top of the ladder sits a *continuous* value, strengthOf() — how much of
   a memory is estimated to be left right now, decaying between reviews. The
   ladder alone can only say "due" or "not due", which is a switch; a learner
   needs to see the slope, because the slope is the thing they're actually
   working against. #memory (js/memory.js) is built on it.

   Everything is stored in storage.js's existing `progress` map, one record
   per item id. The persisted shape gained three fields (firstSeen, reviews,
   lapses) and kept every old one, so older records and older backups still
   read correctly — see normalizeRecord().
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
   are read as level 1 (remembered) or level 0 (not), with dueAt 0 — which
   puts them in the due pile the first time the reader comes back, so one
   round of grading re-anchors each of them onto the ladder. That is
   self-healing and needs no migration pass; the alternative, inventing a due
   date for study that never happened, would be a worse lie than "check these
   again".

   `remembered` in memory is `learned` on disk. The stored key is deliberately
   left alone: every backup file ever downloaded from Settings uses it, and
   renaming a persisted field to match a change of vocabulary in the UI would
   silently drop those readers' progress on restore.
   -------------------------------------------------------------------------------------------- */

const EMPTY_RECORD = {
  seen: false,
  remembered: false,
  level: 0,
  lastSeen: 0,
  dueAt: 0,
  firstSeen: 0,
  reviews: 0,
  lapses: 0,
};

function normalizeRecord(stored) {
  if (!stored || typeof stored !== 'object') return EMPTY_RECORD;

  const remembered = Boolean(stored.learned);
  const level = Number.isInteger(stored.level) ? clampLevel(stored.level) : (remembered ? 1 : 0);
  const lastSeen = Number(stored.lastSeen) || 0;

  return {
    seen: true,
    remembered,
    level,
    lastSeen,
    dueAt: Number(stored.dueAt) || 0,
    // Records written before #memory existed have no first-met date. Falling
    // back to lastSeen keeps "newly met" honest in one direction — an old
    // word can never masquerade as new, it just stops being counted as new
    // once it's reviewed again.
    firstSeen: Number(stored.firstSeen) || lastSeen,
    reviews: Number(stored.reviews) || 0,
    lapses: Number(stored.lapses) || 0,
  };
}

function getRecord(itemId) {
  return normalizeRecord(progress.get(itemId));
}

/* Every record in one read. getRecord() re-reads and re-parses the whole
   progress store per call, which is fine for a card or two and quadratic-ish
   for a screen that walks several thousand items (#memory, the dashboard's
   deck counts). Callers that need the whole picture take this instead. */
function snapshotRecords() {
  const all = progress.getAll();
  const records = new Map();
  for (const [itemId, stored] of Object.entries(all)) {
    records.set(itemId, normalizeRecord(stored));
  }
  return records;
}

function writeRecord(itemId, record) {
  progress.set(itemId, {
    learned: record.remembered,
    level: record.level,
    lastSeen: record.lastSeen,
    dueAt: record.dueAt,
    firstSeen: record.firstSeen,
    reviews: record.reviews,
    lapses: record.lapses,
  });
}

/* -- Memory strength -------------------------------------------------------------------
   An estimate of how much of a memory is left right now: 1 the moment it's
   recalled, halving every half-life after that. The half-life for each level
   is that level's own interval, which makes the model and the schedule the
   same statement — an item comes back exactly when it's estimated to be at
   half strength, and "due" stops being an arbitrary flag.

   Level 0 (missed, or seen but never recalled) gets a half-day half-life:
   something the reader just failed to produce is mostly gone by tomorrow,
   and the page should say so rather than call it fresh.

   This is the forgetting curve, drawn honestly. It exists because a binary
   learned/not-learned hides the one fact a learner most needs to act on —
   that memories decay silently, and that a short visit today is worth far
   more than a long one next month.
   -------------------------------------------------------------------------------------- */

const HALF_LIFE_DAYS = [0.5, 1, 3, 7, 14, 30];

function strengthOf(record, now = Date.now()) {
  if (!record.seen || !record.lastSeen) return 0;
  const elapsedDays = Math.max(now - record.lastSeen, 0) / DAY;
  const halfLife = HALF_LIFE_DAYS[clampLevel(record.level)];
  return Math.pow(0.5, elapsedDays / halfLife);
}

/* Below this an item is treated as nearly gone rather than merely due: it's
   the line #memory splits its "Waiting" and "Fading" shelves on, and the
   bottom band boundary below. Named once here so the two can't drift apart
   and start disagreeing on screen about what "faint" means. It sits under
   the 0.5 every item hits on its own due date, so arriving on time never
   lands a reader in the anxious shelf. */
const FAINT_STRENGTH = 0.35;

/* Four bands, named for how ink looks on paper rather than how full a bar
   is. `key` is what CSS keys off; `label` is what the reader reads and what
   a screen reader announces.

   The labels deliberately avoid the shelf names on #memory except where the
   two genuinely coincide — an item can sit on the "Waiting" shelf at any
   tone above faint, and labelling one of those tones "fading" put the word
   "fading" on items that were explicitly not on the Fading shelf. */
const STRENGTH_BANDS = [
  { key: 'deep', label: 'deep', min: 0.75 },
  { key: 'steady', label: 'steady', min: 0.5 },
  { key: 'pale', label: 'pale', min: FAINT_STRENGTH },
  { key: 'faint', label: 'faint', min: 0 },
];

function bandFor(strength) {
  return STRENGTH_BANDS.find((band) => strength >= band.min) ?? STRENGTH_BANDS[STRENGTH_BANDS.length - 1];
}

/* "5 days late" / "back in 3 days" / "due today" — where an item sits
   relative to its own schedule, in the reader's terms.

   A record written before scheduling existed has no dueAt at all, which as a
   timestamp is 1970 and as a sentence is "20672 days late" — a number that
   is both meaningless and quietly accusing. Those records are due
   immediately by design (see the note on normalizeRecord), and that is
   exactly what this says instead. */
function describeTiming(record, now = Date.now()) {
  if (!record.dueAt) return 'ready now';

  const days = Math.round((record.dueAt - now) / DAY);
  if (days > 1) return `back in ${days} days`;
  if (days === 1) return 'back tomorrow';
  if (days === 0) return 'due today';
  if (days === -1) return '1 day late';
  return `${Math.abs(days)} days late`;
}

/* -- Queries ------------------------------------------------------------------------------- */

function isRemembered(itemId) {
  return getRecord(itemId).remembered;
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
function countDue(items, now = Date.now(), records = snapshotRecords()) {
  let due = 0;
  let fresh = 0;
  let remembered = 0;

  for (const item of items) {
    const record = records.get(item.id) ?? EMPTY_RECORD;
    if (!record.seen) fresh += 1;
    else if (record.dueAt <= now) due += 1;
    if (record.remembered) remembered += 1;
  }

  return { due, new: fresh, remembered, total: items.length };
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
    // Level 0 is the only "not held at all" state — one correct recall is
    // enough to count as in memory, which keeps the meaning the toggle chips
    // already had before scheduling existed.
    remembered: level >= 1,
    level,
    lastSeen: now,
    dueAt: dueAtFor(level, now),
    firstSeen: record.firstSeen || now,
    reviews: record.reviews + 1,
    // Counted, never decremented: this is the item's history of slipping
    // away, and it's what #memory's "Hard to hold" shelf is built from. A
    // word that has been lost five times stays a word worth shorter gaps
    // even after a good week.
    lapses: record.lapses + (knewIt ? 0 : 1),
  };

  writeRecord(itemId, next);
  return next;
}

/* The manual chip on a card is a statement, not a recall test, so it doesn't
   climb the ladder: adding something to memory parks it one day out, and
   taking it back out makes it due now. Neither counts as a review, so
   neither touches `reviews` or `lapses` — those describe recall attempts,
   and this isn't one. */
function setRemembered(itemId, remembered, now = Date.now()) {
  const record = getRecord(itemId);
  const level = remembered ? Math.max(record.level, 1) : 0;

  const next = {
    ...record,
    seen: true,
    remembered,
    level,
    lastSeen: now,
    dueAt: dueAtFor(level, now),
    firstSeen: record.firstSeen || now,
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
  STRENGTH_BANDS,
  FAINT_STRENGTH,
  getRecord,
  normalizeRecord,
  snapshotRecords,
  strengthOf,
  bandFor,
  describeTiming,
  isRemembered,
  isNew,
  isDue,
  dueItems,
  newItems,
  countDue,
  grade,
  setRemembered,
  buildSession,
  describeNextReview,
  shuffled,
};
