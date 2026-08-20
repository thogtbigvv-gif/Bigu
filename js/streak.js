/* ==========================================================================
   streak.js
   Which calendar days count as studied, and how long the current unbroken
   run of them is.

   This was inline in dashboard.js, which was the only surface that showed
   it. It has a second reader now — bridge.js publishes the streak alongside
   the rest of the study status — and a streak that meant one thing on the
   Dashboard and another on the summer-project surface would be worse than
   publishing no streak at all. So there is one definition, here, and both
   callers ask it rather than each counting days their own way.

   Nothing about the rule changed in the move.
   ========================================================================== */

import { journal, practice } from './storage.js';
import { snapshotRecords } from './review.js';

/* Local calendar fields, never toISOString(): a session finished at 23:30
   belongs to the day the reader just spent, not to tomorrow in UTC. */
function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return toDateKey(new Date());
}

/* -- Study days -------------------------------------------------------------------------
   A day counts as studied if any of three things happened on it: a journal
   entry was written, a review session was finished, or an item was put into
   memory. All three are already timestamped in storage, so this needs no
   new data — only for the streak to look at all of it.

   This used to read the journal alone, which meant the app's hero number
   rewarded the one activity most readers do least: someone who reviewed a
   hundred cards a day for a month saw a streak of zero. The set of kinds
   per day is kept, not just the fact of one, so the Dashboard's card can
   say which.

   The two dates on a record answer two different questions and were being
   read as if they answered one. `lastSeen` moves on every single grade, so
   reading it as "met a new word" put шинэ үг on a day the reader spent
   entirely on revision — and, because it only ever holds the *latest*
   touch, the day a word was actually first met vanished from the streak as
   soon as that word came round again. `firstSeen` never moves, so it is the
   one that means "new", and it recovers those days.
   ------------------------------------------------------------------------------------------ */

function collectStudyDays({ entries, sessions, records }) {
  const days = new Map();

  function mark(key, kind) {
    if (!key) return;
    if (!days.has(key)) days.set(key, new Set());
    days.get(key).add(kind);
  }

  for (const entry of entries) mark(entry.date, 'тэмдэглэл');
  for (const session of sessions) mark(toDateKey(new Date(session.createdAt)), 'давталт');
  for (const record of records) {
    if (!record) continue;
    if (record.lastSeen) mark(toDateKey(new Date(record.lastSeen)), 'давталт');
    if (record.firstSeen) mark(toDateKey(new Date(record.firstSeen)), 'шинэ үг');
  }

  return days;
}

/* Most recent unbroken run of study days. If today has nothing yet the count
   starts from yesterday instead — the streak isn't broken until a full day
   passes with nothing at all. */
function computeStreak(days) {
  const cursor = new Date();

  if (!days.has(toDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (days.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

/* The whole answer for a caller that has none of the three stores in hand
   and only wants the number. The Dashboard does not use this — it needs the
   day map anyway, to name today's activity — so it composes the two steps
   above itself off one read. */
function currentStreak() {
  return computeStreak(collectStudyDays({
    entries: journal.getAll(),
    sessions: practice.getAll(),
    records: [...snapshotRecords().values()],
  }));
}

export { toDateKey, todayKey, collectStudyDays, computeStreak, currentStreak };
