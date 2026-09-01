/* ==========================================================================
   test/puzzle.test.mjs
   study/puzzle.js — what a Build question is made of.

   The mode's whole claim is that it asks the reader to *produce* a word
   rather than recognise one, and that claim rests entirely on the pieces
   being the right pieces: a puzzle built from the wrong split is a question
   with no right answer, and one built from a single character is not a
   question at all. Neither failure is visible from inside the quiz — the
   tray renders whatever it is handed.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { installMemoryStorage } from './helpers/localStorage.mjs';

installMemoryStorage();
const { buildPuzzle, MAX_PIECES, MIN_PIECES } = await import('../js/study/puzzle.js');

const SPACED = {
  jp: 'めぐろ駅から あるいて 3ぷんぐらいです。',
  reading: 'めぐろえきからあるいてさんぷんぐらいです。',
  mn: 'Мэгүро өртөөнөөс явганаар 3 минут орчим.',
};

const word = (over = {}) => ({
  japanese: '電話', reading: 'でんわ', meaning: 'утас', sentence: null, ...over,
});

/* The pieces are shuffled, so nothing here may assert their order — only
   that they are the answer's own pieces and all of them. */
function isPermutation(pieces, answer) {
  return [...pieces].sort().join(' ') === [...answer].sort().join(' ');
}

describe('the sentence shape', () => {
  test('cuts the example at the spaces it is already written with', () => {
    const puzzle = buildPuzzle({ ...word(), sentence: SPACED }, { prefer: 'sentence' });
    assert.equal(puzzle.shape, 'sentence');
    assert.deepEqual(puzzle.answer, ['めぐろ駅から', 'あるいて', '3ぷんぐらいです。']);
    assert.ok(isPermutation(puzzle.pieces, puzzle.answer));
    assert.equal(puzzle.answerText, 'めぐろ駅から あるいて 3ぷんぐらいです。');
  });

  /* The translation is the prompt: the sentence is what is being produced,
     so the reader has to be given the meaning to produce it from. */
  test('is the translation, and is not offered without one', () => {
    assert.equal(buildPuzzle({ ...word(), sentence: SPACED }, { prefer: 'sentence' }).prompt, SPACED.mn);
    const noTranslation = buildPuzzle(
      { japanese: '', reading: '', meaning: '', sentence: { ...SPACED, mn: '' } },
      { prefer: 'sentence' },
    );
    assert.equal(noTranslation, null);
  });

  test('a sentence written without spaces is not a sentence puzzle', () => {
    const puzzle = buildPuzzle(
      { ...word(), sentence: { jp: '明日は大事な会議がある。', reading: '', mn: 'Маргааш чухал уулзалт бий.' } },
      { prefer: 'sentence' },
    );
    assert.equal(puzzle.shape, 'word', 'it falls back to the word rather than making one piece');
  });

  /* Past eight the pieces wrap into a block that has to be read before it
     can be solved, which is a different exercise from this one. */
  test('a sentence longer than the piece cap falls back to the word', () => {
    const jp = Array.from({ length: MAX_PIECES + 1 }, (_, i) => `ぶん${i}`).join(' ');
    const puzzle = buildPuzzle(
      { ...word(), sentence: { jp, reading: '', mn: 'урт' } },
      { prefer: 'sentence' },
    );
    assert.equal(puzzle.shape, 'word');
  });
});

describe('the word shape', () => {
  test('cuts the headword into characters', () => {
    const puzzle = buildPuzzle(word());
    assert.equal(puzzle.shape, 'word');
    assert.deepEqual(puzzle.answer, ['電', '話']);
    assert.ok(isPermutation(puzzle.pieces, puzzle.answer));
    assert.equal(puzzle.answerText, '電話');
  });

  test('the gloss is the prompt and the reading is the hint', () => {
    const puzzle = buildPuzzle(word());
    assert.equal(puzzle.prompt, 'утас');
    assert.equal(puzzle.hint, 'でんわ');
  });

  /* For a word written in kana the reading *is* the answer, and printing it
     above the tray turns the puzzle into a copying exercise. */
  test('a reading that repeats the headword is not offered as a hint', () => {
    const puzzle = buildPuzzle({ japanese: 'あさ', reading: 'あさ', meaning: 'өглөө', sentence: null });
    assert.deepEqual(puzzle.answer, ['あ', 'さ']);
    assert.equal(puzzle.hint, '');
  });

  /* A suffix is filed and taught as its own kana with a mark saying where it
     attaches, and a tile holding a tilde is a tile with no answer. */
  test('affix marks are not pieces', () => {
    const puzzle = buildPuzzle({ japanese: '～かい', reading: '～かい', meaning: '...давхар', sentence: null });
    assert.deepEqual(puzzle.answer, ['か', 'い']);
  });

  /* A character is learned in the words that use it: one tile is no puzzle,
     its example word is four and a real one. */
  test('a one-character headword is asked through its example word', () => {
    const puzzle = buildPuzzle({
      japanese: '日',
      reading: '',
      meaning: 'өдөр, нар',
      sentence: { jp: '日よう日', reading: 'にちようび', mn: 'ням гараг' },
    });
    assert.equal(puzzle.shape, 'word');
    assert.deepEqual(puzzle.answer, ['日', 'よ', 'う', '日']);
    assert.equal(puzzle.hint, 'にちようび');
  });
});

describe('when there is no puzzle', () => {
  test('one character and no example is null, not a one-piece question', () => {
    assert.equal(buildPuzzle({ japanese: '日', reading: '', meaning: 'өдөр', sentence: null }), null);
  });

  test('a one-character headword whose example is a spaced sentence is not built as a word', () => {
    const puzzle = buildPuzzle({
      japanese: '駅',
      reading: 'えき',
      meaning: 'өртөө',
      sentence: SPACED,
    });
    // The word shape is refused, so the sentence shape answers instead.
    assert.equal(puzzle.shape, 'sentence');
  });

  test('nothing at all is null rather than a throw', () => {
    assert.equal(buildPuzzle(), null);
    assert.equal(buildPuzzle({}), null);
  });

  test('a word with no meaning cannot be asked — there is no prompt', () => {
    assert.equal(buildPuzzle({ japanese: '電話', reading: 'でんわ', meaning: '', sentence: null }), null);
  });
});

describe('the shuffle', () => {
  /* A puzzle that arrives already solved is not a question, and with two or
     three pieces an honest shuffle produces one often enough to matter. */
  test('does not hand back the answer in its own order', () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const puzzle = buildPuzzle({ ...word(), sentence: SPACED }, { prefer: 'sentence' });
      assert.notDeepEqual(puzzle.pieces, puzzle.answer);
    }
  });

  test('pieces that are all identical are handed back as they are, not looped on', () => {
    const puzzle = buildPuzzle({ japanese: 'ああ', reading: '', meaning: 'аан', sentence: null });
    assert.equal(puzzle.answer.length, MIN_PIECES);
    assert.ok(isPermutation(puzzle.pieces, puzzle.answer));
  });
});
