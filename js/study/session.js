/* ==========================================================================
   study/session.js
   What happens when a round of study ends, wherever it was run from.

   Three surfaces run rounds — the Review view, a per-lesson quiz, and the
   round Home offers on arrival — and every one of them has to log the round
   identically. A surface that quietly skipped a step would be a session the
   reader did and the Review history, or the Dashboard, or the separate
   surface reading `bigu:bridge`, never heard about.

   Both functions lived in practice.js, the Review *view*, which is why
   app.js imported that view at boot just to publish a status snapshot, and
   why lessons.js and home.js imported it to log a round. None of them
   wanted the Review screen. They wanted this.
   ========================================================================== */

import { practice } from '../core/storage.js';
import { publishEvent, publishEvents, publishStatus } from '../core/bridge.js';
import { loadReviewPool } from '../data/catalogue.js';
import { countDue } from './review.js';
import { currentStreak, toDateKey } from './streak.js';

/* -- Logging a finished round -------------------------------------------------------
   The three writes every finished round in this app makes, in the order
   they have to happen: the practice store generates the id, the bridge
   republishes that same id as an event so anything reading `bigu:bridge` on
   this origin can dedupe on it, and the bridge's status snapshot is redrawn
   because a graded round is exactly what changes it.

   `eventType` is the one thing a caller varies: the same round means
   something slightly different published from Review than from a lesson, so
   the reader on the other side is told which. Everything else about the
   event is the same shape either way, because the round is the same round.

   A round ended before anything was graded logs nothing and says so by
   returning null. Reporting 0/0 is reporting nothing.
   ---------------------------------------------------------------------------------- */
function recordSession({ total, correct, mode, eventType = 'review.session' }) {
  if (!(total > 0)) return null;

  const record = practice.add({ total, correct, mode });

  // Neither can throw — bridge.js swallows its own storage errors — and
  // nothing here depends on either having worked.
  publishEvent({
    id: record.id,
    type: eventType,
    value: correct,
    detail: `${total} items · ${correct} correct`,
  });
  publishStatusSnapshot();

  return record;
}

/* -- Republishing the rounds the store already holds ---------------------------------
   The event log is a copy, and the practice store is the original. They
   agree as long as every round is published as it finishes, which is what
   recordSession() does — and they stop agreeing the moment the store gains
   history the bridge never watched arrive:

     a restored backup    the file's rounds land in the store whole, and
                          the key is cleared with the rest of this
                          browser's data before the reload
     a cleared key        site data wiped, a reader clearing one key by
                          hand, a browser evicting it
     a version change     an envelope from an older contract is dropped
                          rather than relabelled (see core/bridge.js)

   In all three the store still knows exactly what happened, so the bridge
   is rebuilt from it rather than left with a hole in it. Offered at boot,
   every boot: publishing an id the log already carries is a no-op, so on an
   ordinary visit this adds nothing and writes nothing.

   Oldest first, because that is the order the log is kept in, and only the
   newest EVENT_LIMIT survive the cap anyway. `type` is reconstructed the
   one way it honestly can be — from the deck the round was run against,
   which is the same thing the live publishers tag it with — so a lesson
   quiz republished out of the store still arrives on the other side as a
   lesson quiz rather than as a review.
   ---------------------------------------------------------------------------------- */
function publishHistory() {
  try {
    const rounds = practice.getAll()
      .filter((record) => record && record.id && record.total > 0)
      .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));

    return publishEvents(rounds.map((record) => ({
      id: record.id,
      type: record.mode === 'lessons' ? 'lesson.quiz' : 'review.session',
      at: record.createdAt,
      value: record.correct,
      detail: `${record.total} items · ${record.correct} correct`,
    })));
  } catch {
    return false;
  }
}

/* -- The bridge's status snapshot ----------------------------------------------------
   How things stand right now, for the separate surface served from the same
   origin: how much is waiting, when the reader last studied, how much they
   are holding, and the streak the Dashboard would show them. Published at
   boot and again after every graded round, since those are the two moments
   any of it can have changed.

   Display-ready values only, and nothing invented for the occasion. Each
   number here is one the app already counts for its own screens, so the
   reader on the other side prints them and no more. There is no score, no
   level and no XP: Bigu does not compute one, and the bridge is not the
   place to start.

   A streak of zero is published as no streak at all rather than as 0. There
   is a difference between "your run is broken" and "you have no run", and
   only the first is worth a reader's screen space.

   Fire and forget, deliberately. It waits on the four content files, so
   awaiting it would hold whatever called it — at boot, the first paint of
   Home — behind four fetches that nothing on screen needs. It cannot throw
   into its caller: publishStatus() swallows its own storage errors, and a
   failed fetch is logged and dropped here, because a browser that cannot
   reach data/ still has an app to render.
   ---------------------------------------------------------------------------------- */
function publishStatusSnapshot() {
  loadReviewPool()
    .then((pool) => {
      const counts = countDue(pool.everything);
      const streak = currentStreak();
      // Max rather than the last element: a restored backup writes the array
      // back whole, and nothing guarantees the order it was saved in.
      const lastStudiedAt = practice.getAll()
        .reduce((latest, record) => Math.max(latest, record?.createdAt ?? 0), 0);

      publishStatus({
        dueCount: counts.due,
        learnedCount: counts.remembered,
        lastStudied: lastStudiedAt ? toDateKey(new Date(lastStudiedAt)) : undefined,
        streak: streak > 0 ? streak : undefined,
      });
    })
    .catch((error) => console.error('[Bigu]', error));
}

export { recordSession, publishHistory, publishStatusSnapshot };
