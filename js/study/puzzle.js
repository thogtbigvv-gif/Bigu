/* ==========================================================================
   study/puzzle.js
   What a build question is made of: the pieces, the order they go back in,
   and whether an item can be asked this way at all.

   The quiz's other two modes ask the reader to *recognise* something — pick
   the right meaning out of four, or turn a card over and say whether they
   knew it. Both are answerable without ever having to produce a word. This
   is the mode that makes them produce one: the answer arrives in pieces, in
   the wrong order, and putting it back is the question.

   Two shapes, and which one an item gets is a data check rather than a
   choice:

     sentence   The item's own example, cut at the spaces already in it.
                Every example in data/vocabulary.json is written with its
                bunsetsu separated — めぐろ駅から あるいて 3ぷんぐらいです。
                — because that is how the app sets a sentence for a learner
                to read. So the segmentation this needs is not a tokenizer
                the app does not have; it is punctuation the file already
                carries, and 741 of the 816 words have it.

     word       The Japanese itself, cut into characters. Every item that
                has a headword of two characters or more can be asked this,
                which is what stops the mode from being unavailable to three
                decks out of four: lesson words, grammar patterns and the
                kanji list's example words carry no spaced sentence at all.

   No decoys, in either shape. An anagram made of exactly the right pieces
   has exactly one answer and can be checked without an opinion; adding a
   spare character means asking a reader to reject a piece that might well
   spell another real word, and marking them wrong for a question this file
   cannot actually pose.

   Nothing here touches the DOM or the schedule. It answers "what would this
   item's puzzle be", and returns null when the honest answer is "it has
   none" — the quiz then asks that item something else rather than skipping
   it or inventing a puzzle out of one character.
   ========================================================================== */

import { shuffled } from './review.js';

/* Two is a puzzle. Eight is where a phone runs out of line: past it the
   pieces wrap into a block that has to be read before it can be solved,
   which is a different exercise from the one this is. An item whose
   sentence is longer simply gets the word shape instead. */
const MIN_PIECES = 2;
const MAX_PIECES = 8;

/* The spaces an authored example is written with, and nothing else. A
   half-width run, a full-width one, or a mix of both. */
const SPACES = /[ 　]+/;

/* Suffix and prefix marks are not part of the word being built — ～かい is
   filed and taught as かい with a mark saying where it attaches, and a tile
   holding a tilde is a tile with no answer. */
const AFFIX_MARKS = /[～〜]/g;

function stripAffixMarks(text) {
  return String(text ?? '').replace(AFFIX_MARKS, '').trim();
}

function splitSentence(text) {
  return String(text ?? '').trim().split(SPACES).filter(Boolean);
}

/* Characters, not code units: a surrogate pair or a combining mark split in
   half is a tile that renders as a box. */
function splitCharacters(text) {
  return [...stripAffixMarks(text)];
}

/* Shuffled, and never back into the order it came in. A puzzle that arrives
   already solved is not a question, and with two or three pieces an honest
   shuffle produces one often enough to matter — a third of the time at two
   pieces. Bounded rather than looped forever: pieces that are all the same
   string can never differ from their own order, and the loop has to end. */
const SHUFFLE_ATTEMPTS = 12;

function isSameOrder(a, b) {
  return a.length === b.length && a.every((piece, index) => piece === b[index]);
}

function scramble(pieces) {
  let next = shuffled(pieces);
  for (let attempt = 0; attempt < SHUFFLE_ATTEMPTS && isSameOrder(next, pieces); attempt += 1) {
    next = shuffled(pieces);
  }
  return next;
}

function usable(pieces) {
  return pieces.length >= MIN_PIECES && pieces.length <= MAX_PIECES;
}

/* -- Building ------------------------------------------------------------------------
   `item` here is not a catalogue entry — it is the four strings the quiz's
   own adapter reads off one, so this module knows nothing about which deck
   an item came from or what its fields are called.

     japanese   the headword, pattern or character
     reading    its kana, where that says something the headword does not
     meaning    the gloss, which is what the reader is given to work from
     sentence   { jp, reading, mn } or null

   `prefer` names the shape to try first. The quiz asks for `sentence` once
   an item is past its first meetings and `word` before that, which is the
   same ladder the question types climb: recognise it, then produce it, then
   produce it inside a sentence.
   ------------------------------------------------------------------------------------ */

function buildPuzzle({ japanese, reading, meaning, sentence } = {}, { prefer = 'word' } = {}) {
  const shapes = prefer === 'sentence' ? ['sentence', 'word'] : ['word', 'sentence'];

  for (const shape of shapes) {
    const puzzle = shape === 'sentence'
      ? sentencePuzzle(sentence)
      : wordPuzzle({ japanese, reading, meaning, sentence });
    if (puzzle) return puzzle;
  }

  return null;
}

/* The prompt is the translation, because the sentence is what is being
   produced. A sentence with no translation is not askable this way: the
   reader would be assembling Japanese from nothing but the Japanese. */
function sentencePuzzle(sentence) {
  if (!sentence?.jp || !sentence?.mn) return null;

  const answer = splitSentence(sentence.jp);
  if (!usable(answer)) return null;

  return {
    shape: 'sentence',
    prompt: sentence.mn,
    hint: '',
    answer,
    pieces: scramble(answer),
    // Joined the way it is written: an authored space is a reading aid, and
    // the answer line should show the sentence as the file has it.
    answerText: answer.join(' '),
  };
}

/* The gloss is the prompt, and the reading is the hint — but only when it
   adds something. For a word written in kana the reading *is* the answer,
   and printing it above the tray turns the puzzle into a copying exercise.

   A kanji entry has no multi-character headword of its own, so it is asked
   about the word its own example carries: 日 is one tile and no puzzle,
   日ようび is four and a real one. */
function wordPuzzle({ japanese, reading, meaning, sentence }) {
  const target = pickWordTarget({ japanese, sentence });
  if (!target || !meaning) return null;

  const answer = splitCharacters(target.text);
  if (!usable(answer)) return null;

  const wordReading = stripAffixMarks(target.reading ?? reading);
  const showsSomething = wordReading && wordReading !== stripAffixMarks(target.text);

  return {
    shape: 'word',
    prompt: meaning,
    hint: showsSomething ? wordReading : '',
    answer,
    pieces: scramble(answer),
    answerText: answer.join(''),
  };
}

function pickWordTarget({ japanese, sentence }) {
  const headword = stripAffixMarks(japanese);
  if ([...headword].length >= MIN_PIECES) return { text: headword, reading: null };

  /* One character and nothing to assemble — a kanji entry, or a word like
     ～円. Its example word is the next honest thing to build, and for the
     kanji deck it is the better question anyway: a character is learned in
     the words that use it. Only when that example is a word rather than a
     sentence; a spaced sentence belongs to the other shape. */
  const example = sentence?.jp ?? '';
  if (!example || SPACES.test(example.trim())) return null;

  const word = stripAffixMarks(example);
  return [...word].length >= MIN_PIECES ? { text: word, reading: sentence?.reading ?? null } : null;
}

export { buildPuzzle, MAX_PIECES, MIN_PIECES };
