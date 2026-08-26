/* ==========================================================================
   test/links.test.mjs
   data/links.js — the index that turns entries into doors.

   Cross-linking is derived rather than authored: not one reference between
   entries is written into data/, and every door in the app is drawn from
   what this file reads out of a headword. That makes it the one piece of the
   feature where being wrong is silent. A missing link draws no door and
   nobody knows the door was meant to be there; a wrong one draws a door into
   the wrong entry, which the reader will believe, because the app has no
   other opinion to offer them.

   So the questions here are about what counts as a link and what does not —
   and about the shapes the real catalogue contains: words written in kana
   alone, entries whose headword carries a character the kanji file has never
   heard of, and a lesson word and a vocabulary word spelled the same way.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import { buildLinkIndex } from '../js/data/links.js';

const KANJI = [
  { id: 'kj-n5-001', character: '日', meaning: 'өдөр, нар' },
  { id: 'kj-n5-002', character: '本', meaning: 'ном' },
  { id: 'kj-n5-003', character: '人', meaning: 'хүн' },
];

const VOCABULARY = [
  { id: 'n5-001', kanji: '日本', kana: 'にほん', meaning: 'Япон' },
  { id: 'n5-002', kanji: '本', kana: 'ほん', meaning: 'ном' },
  { id: 'n5-003', kana: 'あした', meaning: 'маргааш' },
  { id: 'n5-004', kanji: '茶', kana: 'ちゃ', meaning: 'цай' },
];

const LESSONS = [
  {
    lesson: 1,
    title: 'はじめまして',
    words: [
      { id: 'l1-01', word: '日本', reading: 'にほん', english: 'Япон' },
      { id: 'l1-02', word: 'アメリカ', reading: 'アメリカ', english: 'Америк' },
    ],
  },
  {
    lesson: 7,
    title: 'これから',
    words: [{ id: 'l7-04', word: '人', reading: 'ひと', english: 'хүн' }],
  },
];

function index() {
  return buildLinkIndex({ kanji: KANJI, vocabulary: VOCABULARY, lessons: LESSONS });
}

describe('finding the kanji inside a piece of text', () => {
  test('a headword resolves to the entries for its characters, in reading order', () => {
    assert.deepEqual(index().kanjiIn('日本').map((entry) => entry.id), ['kj-n5-001', 'kj-n5-002']);
  });

  test('a character with no entry is dropped rather than guessed at', () => {
    // 茶 is a real kanji and is not in this catalogue. A door to an entry
    // that does not exist is worse than no door.
    assert.deepEqual(index().kanjiIn('茶').map((entry) => entry.id), []);
    assert.deepEqual(index().kanjiIn('お茶を本で').map((entry) => entry.id), ['kj-n5-002']);
  });

  test('kana and punctuation contribute nothing, without being listed anywhere', () => {
    assert.deepEqual(index().kanjiIn('あしたは、いいひです。').map((entry) => entry.id), []);
  });

  test('a repeated character is one door, at its first appearance', () => {
    assert.deepEqual(index().kanjiIn('日本日').map((entry) => entry.id), ['kj-n5-001', 'kj-n5-002']);
  });

  test('a whole passage is the same question at a larger scale', () => {
    const passage = '日本人は本を読む。あしたも読む。';
    assert.deepEqual(index().kanjiIn(passage).map((entry) => entry.character), ['日', '本', '人']);
  });

  test('nothing, and no text at all, are both answers rather than throws', () => {
    for (const value of ['', null, undefined]) {
      assert.deepEqual(index().kanjiIn(value), []);
    }
  });
});

describe('finding the words that use a character', () => {
  test('vocabulary and lesson words are kept apart, because they are different doors', () => {
    const uses = index().usesOf('日');
    assert.deepEqual(uses.words.map((word) => word.id), ['n5-001']);
    assert.deepEqual(uses.lessonWords.map(({ word }) => word.id), ['l1-01']);
  });

  test('a lesson word arrives with the lesson it was written down in', () => {
    const [use] = index().usesOf('人').lessonWords;
    assert.equal(use.word.id, 'l7-04');
    assert.equal(use.lesson.lesson, 7);
  });

  test('a word is filed under every character in it, not just the first', () => {
    assert.deepEqual(index().usesOf('本').words.map((word) => word.id), ['n5-001', 'n5-002']);
  });

  test('a word written in kana alone is in no character’s list', () => {
    for (const character of ['日', '本', '人']) {
      const uses = index().usesOf(character);
      assert.equal(uses.words.some((word) => word.id === 'n5-003'), false, character);
      assert.equal(uses.lessonWords.some(({ word }) => word.id === 'l1-02'), false, character);
    }
  });

  /* The empty answer has to be the same shape as a full one, or every caller
     drawing a door row needs a null check the day a character has no words. */
  test('a character nothing uses answers with two empty lists', () => {
    assert.deepEqual(index().usesOf('茶'), { words: [], lessonWords: [] });
    assert.deepEqual(index().usesOf('—'), { words: [], lessonWords: [] });
  });
});

describe('the lesson a word belongs to', () => {
  test('is read off the lesson that holds it, not off the id', () => {
    assert.equal(index().lessonOf('l7-04').lesson, 7);
    assert.equal(index().lessonOf('l1-02').lesson, 1);
  });

  test('a vocabulary id belongs to no lesson, and says so', () => {
    assert.equal(index().lessonOf('n5-001'), null);
    assert.equal(index().lessonOf('nope'), null);
  });
});

/* An index built from a catalogue that failed to load is the state every
   door row in the app is written against: it answers every question with
   nothing, so each row draws nothing and no view has to ask whether linking
   is available before drawing a card. */
describe('an index that knows nothing', () => {
  test('is what an empty build produces, and answers rather than throws', () => {
    const nothing = buildLinkIndex();

    assert.equal(nothing.size, 0);
    assert.deepEqual(nothing.kanjiIn('日本'), []);
    assert.deepEqual(nothing.usesOf('日'), { words: [], lessonWords: [] });
    assert.equal(nothing.kanjiFor('日'), null);
    assert.equal(nothing.lessonOf('l1-01'), null);
  });

  test('size counts the characters the index can answer for', () => {
    assert.equal(index().size, 3);
    // catalogue.js drops its cache on a zero size, so this is the flag that
    // decides whether a failed load is ever retried.
    assert.equal(buildLinkIndex({ vocabulary: VOCABULARY, lessons: LESSONS }).size, 0);
  });
});

describe('a duplicate character in the kanji file', () => {
  test('does not split a character’s words across two entries', () => {
    const duplicated = buildLinkIndex({
      kanji: [...KANJI, { id: 'kj-n1-999', character: '日', meaning: 'a second 日' }],
      vocabulary: VOCABULARY,
      lessons: LESSONS,
    });

    // First one wins, and the words stay in one list. Which entry is right is
    // a question for tools/validate-data.mjs, not for a door row.
    assert.equal(duplicated.kanjiFor('日').id, 'kj-n5-001');
    assert.equal(duplicated.usesOf('日').words.length, 1);
  });
});
