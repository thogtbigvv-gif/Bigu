/* ==========================================================================
   data/catalogue.js
   The only place in the app that knows where the content lives.

   Before this file, each of the five loaders was declared inside the view
   that happened to render it first — loadVocabulary in vocabulary.js,
   loadKanji in kanji.js, and so on — and every other surface that needed
   the data imported the *view module* to get at it. Six of them did:
   practice, dashboard, memory, home, ichibun and kakitori. So the Dashboard
   depended on the Vocabulary view; the writing canvas depended on the Kanji
   view; and Memory depended on four of them at once. None of those
   dependencies were real — not one of those modules wanted a view, they
   wanted a JSON file — and each one was a path by which a change to a
   list's rendering could break a screen that renders no list.

   The loaders live here now and the views import them like everyone else.
   The dependency runs one way: views depend on the catalogue, the catalogue
   depends on nothing.

   Two things every loader does, and neither view module did:

     one fetch per file    The promise is memoized, not the value. Caching
                           the value only closes the window *after* the
                           first fetch resolves, and several surfaces start
                           within a frame of each other — two of them would
                           each find an empty cache and each fetch the same
                           file. A failure drops the cache so a retry
                           really does re-fetch.

     a shape check         data/shape.js, run once at load. A hand-written
                           file with a missing collection now fails with a
                           sentence naming the file, in the view's own
                           retryable error state, instead of throwing from
                           inside a render six frames later.
   ========================================================================== */

import { requireEntries, requireLessons } from './shape.js';
import { buildLinkIndex } from './links.js';
import { deckKeyForItemId } from '../study/decks.js';

/* -- The loader -------------------------------------------------------------
   `label` is both the filename and the word that appears in every error this
   file can produce — "Failed to load vocabulary (404)", "data/vocabulary.json
   is not shaped like vocabulary content". One string, so a renamed file
   cannot end up described by its old name in half the messages.
   ---------------------------------------------------------------------------- */

function createLoader(label, check) {
  const url = `data/${label}.json`;
  let pending = null;

  return function load() {
    if (!pending) {
      pending = (async () => {
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`Failed to load ${label} (${response.status})`);
        }
        const data = await response.json();
        check(data);
        return data;
      })();

      // Cleared on failure only: a rejected promise handed to every later
      // caller would turn one bad response into a permanently broken view,
      // and the error states here all offer a retry button.
      pending.catch(() => { pending = null; });
    }

    return pending;
  };
}

const loadVocabulary = createLoader('vocabulary', (data) => requireEntries(data, { label: 'vocabulary', key: 'words' }));
const loadGrammar = createLoader('grammar', (data) => requireEntries(data, { label: 'grammar', key: 'points' }));
const loadKanji = createLoader('kanji', (data) => requireEntries(data, { label: 'kanji', key: 'kanji' }));
const loadReading = createLoader('reading', (data) => requireEntries(data, { label: 'reading', key: 'passages' }));
const loadLessons = createLoader('lessons', requireLessons);

/* -- The review pool ---------------------------------------------------------
   The four studiable decks and the flattened everything-pool built out of
   them. Three surfaces need exactly this answer and none of them should be
   re-deriving it: the Review view's deck picker, the bridge's status
   snapshot counting what is due across the whole catalogue, and Home asking
   whether anything is waiting.

   It lived in practice.js, which meant app.js and home.js imported the
   Review *view* at boot to find out what was due. Same memoization rule as
   the loaders above, for the same reason.

   Reading is not in the pool, and that is not an oversight: a passage is
   something you read, not something the schedule can ask you a question
   about. Nothing in review.js has a record for one.
   ---------------------------------------------------------------------------- */

let pendingPool = null;

function loadReviewPool() {
  if (!pendingPool) {
    pendingPool = (async () => {
      const [vocabData, grammarData, kanjiData, lessonData] = await Promise.all([
        loadVocabulary(),
        loadGrammar(),
        loadKanji(),
        loadLessons(),
      ]);

      const lessonWords = lessonData.flatMap((lesson) => lesson.words);

      return {
        // The lessons as authored, not only their flattened words: Home
        // names the lesson a word came from, and a word row carries its
        // lesson only in the shape of its own id.
        lessons: lessonData,
        lessonWords,
        vocabulary: vocabData.words,
        grammar: grammarData.points,
        kanji: kanjiData.kanji,
        // Only what the quiz can actually ask about: an id whose prefix no
        // adapter claims would reach buildQuestion with no adapter behind it.
        everything: [...lessonWords, ...vocabData.words, ...grammarData.points, ...kanjiData.kanji]
          .filter((item) => deckKeyForItemId(item.id) !== null),
      };
    })();

    pendingPool.catch(() => { pendingPool = null; });
  }

  return pendingPool;
}

/* -- The link index ----------------------------------------------------------
   Cross-linking's one loader. It wants three of the five files at once —
   kanji to know what a character is, vocabulary and lessons to know what
   uses it — and every surface that draws a door needs the same answer, so
   the index is built once and memoized like everything else here.

   IT NEVER REJECTS, WHICH IS THE ONE PLACE THIS FILE DIFFERS FROM THE
   LOADERS ABOVE. A view's own content failing to load is that view's error
   state: the reader asked for the word list, and an empty screen with a
   retry is the honest answer. A *door* failing to load is not — the reader
   asked for a kanji, the kanji is on screen, and the only thing missing is
   the row of words underneath it. Rejecting here would mean any one of three
   files taking six views down with it, so instead the failure resolves to an
   index that knows nothing, every door row asks it what it holds, and each
   of them draws nothing. Absence is a normal state; a retry button under a
   kanji entry because the lesson file is malformed is not.

   The cache is dropped when the index comes back empty so a later caller
   really does re-try, same rule as the loaders above — an index built from a
   catalogue that did load is never empty, since kanji.json is the file that
   fills it.
   ---------------------------------------------------------------------------- */

let pendingLinks = null;

function loadLinkIndex() {
  if (!pendingLinks) {
    pendingLinks = (async () => {
      try {
        const [kanjiData, vocabData, lessonData] = await Promise.all([
          loadKanji(),
          loadVocabulary(),
          loadLessons(),
        ]);

        return buildLinkIndex({
          kanji: kanjiData.kanji,
          vocabulary: vocabData.words,
          lessons: lessonData,
        });
      } catch (error) {
        console.error('[Bigu]', error);
        return buildLinkIndex();
      }
    })();

    pendingLinks.then((index) => {
      if (index.size === 0) pendingLinks = null;
    });
  }

  return pendingLinks;
}

export {
  loadVocabulary,
  loadGrammar,
  loadKanji,
  loadLessons,
  loadReading,
  loadReviewPool,
  loadLinkIndex,
};
