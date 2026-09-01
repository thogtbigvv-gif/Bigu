/* ==========================================================================
   test/kana.test.mjs
   data/kana.js — 五十音順, and the ten rows a word files under.

   The order this produces is the whole structure of the vocabulary screen:
   get it wrong and the list is still eight hundred entries in an order
   nobody can predict, which is the state it was in. None of it is authored,
   so the only thing standing between the catalogue and a wrong order is the
   normalisation below — suffix marks, katakana, and the long vowel mark.
   ========================================================================== */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const { KANA_ROWS, compareKana, rowOf, toSortKey } = await import('../js/data/kana.js');

const sorted = (list) => [...list].sort(compareKana);

describe('the sort key', () => {
  test('drops the marks that are not part of the reading', () => {
    assert.equal(toSortKey('～えき'), 'えき');
    assert.equal(toSortKey('〜えん'), 'えん');
    assert.equal(toSortKey('あ　い う'), 'あいう');
  });

  /* A reader looking under か does not think about which script the entry
     happened to be written in. */
  test('folds katakana to hiragana', () => {
    assert.equal(toSortKey('コーヒー'), 'こひ');
    assert.equal(toSortKey('テレビ'), 'てれび');
  });

  /* The 長音 mark carries no vowel of its own and lives in the katakana
     block, so left in it sorts every borrowed word to the end of its row. */
  test('drops the long vowel mark rather than sorting on it', () => {
    assert.ok(compareKana('コート', 'こども') < 0, 'こーと comes before こども');
  });

  test('a headword with nothing to read gives an empty key', () => {
    assert.equal(toSortKey(''), '');
    assert.equal(toSortKey('～'), '');
  });
});

describe('the order', () => {
  test('is gojūon, not codepoint order over the raw strings', () => {
    assert.deepEqual(
      sorted(['わたし', 'あい', 'ねこ', 'かさ', 'ほん']),
      ['あい', 'かさ', 'ねこ', 'ほん', 'わたし'],
    );
  });

  /* Unicode's hiragana block already carries both of these, which is the
     reason the comparison can be the ordinary one. */
  test('puts a voiced kana immediately after its base', () => {
    assert.deepEqual(sorted(['がっこう', 'かさ', 'きた']), ['かさ', 'がっこう', 'きた']);
  });

  test('puts a small kana immediately before its full-size form', () => {
    assert.deepEqual(sorted(['あい', 'ぁ']), ['ぁ', 'あい']);
  });

  test('files a suffix entry under the kana it actually begins with', () => {
    assert.deepEqual(sorted(['～えん', 'あい', 'おと']), ['あい', '～えん', 'おと']);
  });

  test('is stable on equal keys and reflexive', () => {
    assert.equal(compareKana('あい', 'あい'), 0);
    assert.equal(compareKana('アイ', 'あい'), 0, 'the two scripts are one reading');
  });
});

describe('the rows', () => {
  test('are the ten of a kana chart, in chart order', () => {
    assert.deepEqual(KANA_ROWS.map((row) => row.label), ['あ', 'か', 'さ', 'た', 'な', 'は', 'ま', 'や', 'ら', 'わ']);
  });

  test('file a word under the row its first kana belongs to', () => {
    assert.equal(rowOf('あさ'), 'a');
    assert.equal(rowOf('～えき'), 'a');
    assert.equal(rowOf('コーヒー'), 'ka');
    assert.equal(rowOf('つくえ'), 'ta');
  });

  /* が is in か行 and ぱ is in は行 — that is what "under か" means to
     somebody looking a word up, and a voiced row of its own would be a row
     no chart has. */
  test('put voiced and semi-voiced kana in their base row', () => {
    assert.equal(rowOf('がっこう'), 'ka');
    assert.equal(rowOf('だいがく'), 'ta');
    assert.equal(rowOf('ぱん'), 'ha');
  });

  test('ride ん and を with わ, where a chart puts them', () => {
    assert.equal(rowOf('を'), 'wa');
    assert.equal(rowOf('ん'), 'wa');
  });

  /* A real answer and the caller's to handle: the list files those together
     rather than guessing a row for them. */
  test('answer null for a headword this chart cannot place', () => {
    assert.equal(rowOf(''), null);
    assert.equal(rowOf('～'), null);
    assert.equal(rowOf('Bigu'), null);
  });

  test('every row is disjoint — no kana files under two of them', () => {
    const seen = new Set();
    for (const row of KANA_ROWS) {
      for (const char of row.chars) {
        assert.equal(seen.has(char), false, `${char} appears in more than one row`);
        seen.add(char);
      }
    }
  });
});
