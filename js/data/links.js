/* ==========================================================================
   data/links.js
   The index that turns entries into doors.

   Bigu's second principle is that every entry should lead somewhere: a word
   reaches the kanji inside it, a kanji reaches the words that use it, a word
   reaches the lesson it was met in. For a long time that was a stated
   intention with nothing behind it — the catalogue is five flat files and
   none of them holds a single reference to another. Every relation the
   principle describes is *already in the data*, but only as a shape: 駅 is
   inside ～駅 because the string contains the character, not because anything
   says so.

   This file reads those shapes once and writes them down. No new field, no
   schema change, nothing an editor has to remember to fill in — which is the
   only reason the linking can be trusted to keep up with a catalogue that is
   hand-written and grows a lesson at a time. A word transcribed tonight is
   linked to its kanji the moment it is saved, because being linked is not a
   property of the entry, it is a property of what it is spelled with.

   WHAT COUNTS AS A LINK IS DELIBERATELY NARROW: a character that appears in
   a headword, and that the kanji catalogue holds an entry for. Nothing here
   guesses, and nothing here segments — the same argument ichibun.js makes
   about morphological analysis applies with more force to an index, because
   a wrong link is worse than a missing one. A missing link is a door that
   was never drawn; a wrong one is a door that opens onto the wrong room, and
   the reader has no way to tell which they are looking at.

   Pure and DOM-free, so it can be checked exactly — see test/links.test.mjs.
   The fetching lives in catalogue.js, which is the only place that knows
   where the content is.
   ========================================================================== */

/* Every character a headword is spelled with, deduped, in the order the
   reader meets them. Callers pass a string; there is no tokenizing here and
   no attempt to skip kana or punctuation, because the filter that matters is
   the next one — a character is only ever a link if the kanji catalogue has
   an entry for it, and the catalogue holds no kana. Spreading rather than
   split('') so a surrogate pair stays one character rather than becoming two
   halves that match nothing. */
function charactersOf(text) {
  return [...new Set([...String(text ?? '')])];
}

/* The strings an entry is spelled with, per collection. Vocabulary carries
   its headword under `kanji` and lesson words under `word`; a vocabulary
   entry written in kana alone has no `kanji` at all, which is a normal state
   and simply contributes no characters. */
function headwordOf(entry) {
  return entry.kanji ?? entry.word ?? '';
}

/* -- The index -------------------------------------------------------------
   Built in one pass over the catalogue and then read many times. The cost of
   building it is the cost of walking every headword once — around 1,700
   entries of a few characters each — and it is paid once per session, on the
   first view that asks a linking question.

   The alternative, which is what the views would each have done on their
   own, is to scan the whole word list every time one card needs to know
   which kanji are in it. That is the shape of thing that is fine at 132
   characters and is quietly O(n²) by the time the catalogue is worth
   linking.
   -------------------------------------------------------------------------- */
function buildLinkIndex({ kanji = [], vocabulary = [], lessons = [] } = {}) {
  /* character -> its kanji entry. The catalogue is keyed by id, but every
     question asked of this index arrives as a character: a word knows which
     characters it contains and nothing about their ids. */
  const byCharacter = new Map();
  for (const entry of kanji) {
    // First one wins. Two entries for one character would be a duplicate in
    // the data rather than a choice to make here, and tools/validate-data.mjs
    // is where that is caught.
    if (entry?.character && !byCharacter.has(entry.character)) byCharacter.set(entry.character, entry);
  }

  /* character -> the words spelled with it, kept in the two collections they
     came from rather than merged. They are not the same kind of thing: a
     vocabulary entry is an entry, and a lesson word is a place in a book, so
     the door to one is labelled differently from the door to the other. */
  const uses = new Map();

  function noteUse(character, kind, value) {
    if (!byCharacter.has(character)) return;
    let entry = uses.get(character);
    if (!entry) {
      entry = { words: [], lessonWords: [] };
      uses.set(character, entry);
    }
    entry[kind].push(value);
  }

  for (const word of vocabulary) {
    for (const character of charactersOf(headwordOf(word))) noteUse(character, 'words', word);
  }

  /* word id -> the lesson it was written down in. The id carries the lesson
     number in its prefix (`l7-12`), and reading it out of the string would
     work today — but the prefix in an id is history, not a fact about the
     entry (see the note in study/decks.js), and this map is the same answer
     read from the place that actually knows it. */
  const lessonOfWord = new Map();

  for (const lesson of lessons) {
    for (const word of lesson.words ?? []) {
      lessonOfWord.set(word.id, lesson);
      for (const character of charactersOf(headwordOf(word))) {
        noteUse(character, 'lessonWords', { word, lesson });
      }
    }
  }

  const empty = { words: [], lessonWords: [] };

  return {
    /* How many characters the index can answer for. Zero is the honest state
       of an index built from a catalogue that failed to load, and it is what
       lets every door row in the app be written as "draw the doors there
       are" rather than as a check for whether linking is available at all. */
    size: byCharacter.size,

    kanjiFor(character) {
      return byCharacter.get(character) ?? null;
    },

    /* The kanji entries inside a piece of text, in the order they appear.
       Handed a headword it answers "what is this word spelled with"; handed
       an example sentence or a whole passage it answers "what is in here
       that I can look up" — the same question at three scales, which is why
       it takes text rather than an entry. */
    kanjiIn(text) {
      return charactersOf(text)
        .map((character) => byCharacter.get(character))
        .filter(Boolean);
    },

    /* Which words use a character. Both lists are in catalogue order, which
       for vocabulary is roughly easiest-first and for lessons is the order
       of the book — so a row of doors capped at the first few is capped at
       the ones a reader is most likely to have met. */
    usesOf(character) {
      return uses.get(character) ?? empty;
    },

    lessonOf(wordId) {
      return lessonOfWord.get(wordId) ?? null;
    },
  };
}

export { buildLinkIndex };
