/* ==========================================================================
   study/decks.js
   What a deck is called, what it routes to, and which deck an item belongs
   to. Plain data and one pure function — no DOM, no storage, no fetch.

   All of it lived in two other modules. `deckKeyForItemId` was in quiz.js,
   which meant the data layer had to import the quiz to work out which items
   the quiz could ask about; the labels were in practice.js, read off the
   quiz's own adapters, which meant the Dashboard imported the Review view
   in order to print the word "Kanji". Both are facts about the catalogue's
   shape rather than about a screen, and both are now here, where the
   modules that need them can reach them without reaching through a view.
   ========================================================================== */

/* Lesson ids are l1-01, l2-14, … — tested first because "l" is a looser
   match than the prefixes below it. Vocabulary ids carry any level prefix
   (n5-0001 … n1-…), so the pattern matches the whole ladder rather than
   the one prefix the earliest word list happened to use.

   The prefix in an id is history, not a level: an id is the key every
   progress and review record in localStorage is stored under, so it never
   changes once written, even when the entry's actual level says otherwise.
   Read the entry's own level, never its id.

   Returning null is a real answer — it is how the review pool drops
   anything the quiz has no adapter for, rather than discovering it one
   question in. */
function deckKeyForItemId(id) {
  if (typeof id !== 'string') return null;
  if (/^l\d+-/.test(id)) return 'lessons';
  if (/^n[1-5]-/.test(id)) return 'vocabulary';
  if (id.startsWith('gr-')) return 'grammar';
  if (id.startsWith('kj-')) return 'kanji';
  return null;
}

/* The four content decks, in the order their material is met. Exported as
   a list because both the deck picker and the validator in
   tools/validate-data.mjs need to walk the same four and agree on them. */
const CONTENT_DECKS = ['lessons', 'vocabulary', 'grammar', 'kanji'];

/* "Due today" leads: it's the deck that answers the question the reader
   arrived with, and the one they should be in on most days. "Due today" and
   "Tricky ones" are live pools rather than decks of their own — the first is
   the whole catalogue with the schedule doing the filtering, the second is
   whatever the reader keeps losing. */
const DECK_KEYS = ['due', ...CONTENT_DECKS, 'mistakes'];

/* One name per deck, in one file. Two copies of this table meant one deck
   under two names — "Tricky ones" on the Review screen, "Review mistakes"
   on the Dashboard — for the same round. */
const DECK_LABELS = {
  due: 'Due today',
  lessons: 'Lessons',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  kanji: 'Kanji',
  mistakes: 'Tricky ones',
};

/* Where a finished round points next, per deck. Not a recommendation engine
   and deliberately not a guess: each deck already knows which reference view
   its own items came from, so "continue" means the shelf you were just
   drawing from. The two live pools have no shelf of their own — "Due today"
   spans the whole catalogue, so it offers the beginner on-ramp, and "Tricky
   ones" is by definition about what the reader is holding badly, so it
   offers the screen that is about exactly that. */
const DECK_NEXT = {
  lessons: '#lessons',
  vocabulary: '#vocabulary',
  grammar: '#grammar',
  kanji: '#kanji',
  due: '#lessons',
  mistakes: '#memory',
};

export { deckKeyForItemId, CONTENT_DECKS, DECK_KEYS, DECK_LABELS, DECK_NEXT };
