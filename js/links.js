/* ==========================================================================
   links.js
   What else in the app is reachable from here.

   Every entry in Bigu used to be a dead end. A vocabulary word containing 日
   could not reach the kanji 日; a kanji could not reach the words that use it;
   a passage could not reach the entries for anything in it. The data has held
   those connections all along — they were simply never derived.

   This module derives them and nothing else. It takes the loaded datasets,
   builds its indexes once, and answers questions with **arrays of ids**. It
   never touches the DOM, never fetches, never imports a view. That is what
   lets it be tested by importing it and calling it, and it is why the four
   views that render links can each ask the same question and get the same
   answer.

   NOTHING HERE GUESSES. Every connection is an exact character or substring
   match on data that is already present. There is no fuzzy matching, no
   stemming, no morphological analysis — the app has no tokenizer, and a link
   that is wrong is worse than a link that is missing, because a wrong link
   teaches the reader something false about the language. Where a match cannot
   be made exactly, this module returns an empty array and the view renders
   nothing at all.
   ========================================================================== */

/* CJK Unified Ideographs. The same range ichibun.js uses to decide what is
   worth looking up — kana are not linked, because a kana character is not an
   entry in any dataset here. */
const CJK = /[一-鿿]/u;

/* The written form of a vocabulary entry, as it would appear inside a
   sentence. Two pieces of dictionary notation have to come off first:

     ～駅      the tilde marks a suffix — the word appears as 駅
     (お)名前  the parenthesis marks an optional honorific prefix — 名前

   Both are editorial marks about how a word attaches to others, not
   characters that appear in running text, so a passage containing 名前 would
   never match the raw string. Stripping them is not a guess: it is reading the
   notation the file is written in. */
function plainForm(text) {
  return (text ?? '').replace(/[～~]/gu, '').replace(/[（(][^）)]*[）)]/gu, '');
}

/* -- Building ------------------------------------------------------------------
   Once, from the four datasets, and never again. The alternative — asking
   "which words contain this character?" by walking 816 entries at render time
   — is 816 string scans per kanji card, and the kanji grid holds 132 of them.

   The two heavy indexes are both a single pass over vocabulary:

     wordIdsByCharacter   character -> vocabulary ids that contain it
     kanjiIdsByWordId     vocabulary id -> kanji ids inside it

   built together, because they are the same walk seen from either end.
   -------------------------------------------------------------------------- */

function buildLinkIndex({ vocabulary = [], kanji = [], grammar = [], passages = [] } = {}) {
  const kanjiByCharacter = new Map();
  const kanjiById = new Map();
  for (const entry of kanji) {
    kanjiByCharacter.set(entry.character, entry);
    kanjiById.set(entry.id, entry);
  }

  const wordById = new Map(vocabulary.map((word) => [word.id, word]));
  const passageById = new Map(passages.map((passage) => [passage.id, passage]));
  const grammarById = new Map(grammar.map((point) => [point.id, point]));

  const wordIdsByCharacter = new Map();
  const kanjiIdsByWordId = new Map();

  for (const word of vocabulary) {
    const written = plainForm(word.kanji);
    const seen = new Set();
    const kanjiIds = [];

    for (const character of written) {
      if (seen.has(character)) continue;
      seen.add(character);
      const match = kanjiByCharacter.get(character);
      if (!match) continue;

      kanjiIds.push(match.id);
      let bucket = wordIdsByCharacter.get(character);
      if (!bucket) {
        bucket = [];
        wordIdsByCharacter.set(character, bucket);
      }
      bucket.push(word.id);
    }

    if (kanjiIds.length > 0) kanjiIdsByWordId.set(word.id, kanjiIds);
  }

  /* Vocabulary that can be found inside running text, longest first.

     Longest first is what stops 日 shadowing 日よう日: scanning a sentence
     takes the longest entry that matches at each position, which is the only
     ordering that gives the reader the word rather than one character of it.

     Single-character entries are excluded outright. A one-kanji vocabulary
     entry inside a passage is indistinguishable from the kanji itself, and the
     kanji links already cover that ground — including it would double every
     such character in the list under two names. */
  const searchable = vocabulary
    .map((word) => ({ id: word.id, text: plainForm(word.kanji) }))
    .filter((word) => word.text.length > 1)
    .sort((a, b) => b.text.length - a.text.length);

  /* Grammar patterns found in passages, precomputed because it is 14 patterns
     against 2 passages and the answer never changes. A plain substring match
     on the pattern as written — see the note on passagesForGrammar for what
     that does and does not find. */
  const passageIdsByGrammarId = new Map();
  for (const point of grammar) {
    const pattern = point.pattern ?? '';
    if (!pattern) continue;
    const hits = passages
      .filter((passage) => passage.sentences.some((sentence) => sentence.jp.includes(pattern)))
      .map((passage) => passage.id);
    if (hits.length > 0) passageIdsByGrammarId.set(point.id, hits);
  }

  return {
    kanjiByCharacter,
    kanjiById,
    wordById,
    grammarById,
    passageById,
    wordIdsByCharacter,
    kanjiIdsByWordId,
    passageIdsByGrammarId,
    searchable,
  };
}

/* -- Queries -------------------------------------------------------------------
   All five return arrays of ids, possibly empty, never null. A view's only job
   is to render what comes back and render nothing when nothing does.
   -------------------------------------------------------------------------- */

/* The words that use this character. */
function wordsUsingKanji(index, kanjiId) {
  const entry = index.kanjiById.get(kanjiId);
  if (!entry) return [];
  return index.wordIdsByCharacter.get(entry.character) ?? [];
}

/* The kanji inside this word, in the order they appear in it. */
function kanjiInWord(index, wordId) {
  return index.kanjiIdsByWordId.get(wordId) ?? [];
}

/* The characters data/kanji.json already lists as related, as ids.

   This field has held real characters since the file was written and was
   rendering as chips that went nowhere in particular; the only thing missing
   was somewhere for them to point. Characters with no entry of their own are
   dropped rather than returned — a related character the app cannot open is
   not somewhere you can go. */
function relatedKanji(index, kanjiId) {
  const entry = index.kanjiById.get(kanjiId);
  if (!entry) return [];
  return (entry.related ?? [])
    .map((character) => index.kanjiByCharacter.get(character))
    .filter(Boolean)
    .map((match) => match.id);
}

/* Everything in a piece of Japanese that has an entry of its own.

   Words are matched by scanning left to right and taking the longest entry
   that starts at each position, then skipping past it — so 日本 in a sentence
   yields 日本 once, not 日本 plus 日 plus 本 as separate words. Kanji are
   collected separately over the whole string, in order of first appearance,
   because a character is worth linking whether or not it happened to fall
   inside a word the vocabulary file knows.

   Used for a whole passage and for a single sentence alike; the caller
   decides which text to hand in. */
function entriesInText(index, text) {
  const source = text ?? '';

  const words = [];
  const takenWords = new Set();
  for (let at = 0; at < source.length; at += 1) {
    const hit = index.searchable.find((word) => source.startsWith(word.text, at));
    if (!hit) continue;
    if (!takenWords.has(hit.id)) {
      takenWords.add(hit.id);
      words.push(hit.id);
    }
    at += hit.text.length - 1;
  }

  const kanji = [];
  const takenKanji = new Set();
  for (const character of source) {
    if (!CJK.test(character)) continue;
    if (takenKanji.has(character)) continue;
    takenKanji.add(character);
    const match = index.kanjiByCharacter.get(character);
    if (match) kanji.push(match.id);
  }

  return { words, kanji };
}

/* The passages that contain this pattern, by plain substring match.

   Deliberately literal, and it finds very little: a pattern is stored in its
   dictionary form (わけにはいかない) while a passage contains it conjugated
   and embedded, so only patterns that happen to appear verbatim are found.
   Measured across the whole file, exactly one of fourteen patterns matches one
   of two passages. That is the honest yield of an exact match against two
   passages, and the alternative — relaxing the match until more patterns hit —
   would mean claiming a passage demonstrates a grammar point when it may not.
   Views render nothing when this returns nothing. */
function passagesForGrammar(index, grammarId) {
  return index.passageIdsByGrammarId.get(grammarId) ?? [];
}

/* -- Routes --------------------------------------------------------------------
   The one place that knows what a deep link looks like, so a view never
   assembles a hash by hand and the router never has to guess how one was
   built. Matches the shape router.js parses: #<view>/<id>.
   -------------------------------------------------------------------------- */

const ROUTES = {
  vocabulary: 'vocabulary',
  kanji: 'kanji',
  grammar: 'grammar',
  reading: 'reading',
  lessons: 'lessons',
};

function routeTo(view, itemId) {
  const viewId = ROUTES[view];
  if (!viewId) return null;
  return itemId ? `#${viewId}/${encodeURIComponent(itemId)}` : `#${viewId}`;
}

export {
  buildLinkIndex,
  entriesInText,
  kanjiInWord,
  passagesForGrammar,
  plainForm,
  relatedKanji,
  routeTo,
  wordsUsingKanji,
};
