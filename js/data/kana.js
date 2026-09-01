/* ==========================================================================
   data/kana.js
   五十音順 — the order a Japanese word list is kept in, and the ten rows a
   reader looks a word up by.

   The catalogue is written by hand, one word at a time, in the order the
   learner met them. That is the right order for a *lesson* and no order at
   all for a list of eight hundred: opened cold, vocabulary.json's sequence
   is indistinguishable from shuffled, so a reader who wanted one word had
   nothing to do but search for it or scroll past everything. A word list you
   can find your way around is one kept in the order the language itself is
   filed in, which is this one.

   Nothing here is authored data. The order and the rows are both read off
   the kana of each headword, the same way js/data/links.js reads what a
   word is spelled with off its own characters — a word transcribed tonight
   is filed tonight, and no entry carries an index field anybody has to
   remember to fill in.
   ========================================================================== */

/* -- The sort key -----------------------------------------------------------------
   Unicode's hiragana block is already in gojūon order, and carries the two
   distinctions a naive codepoint sort would otherwise get wrong for free:
   small kana sit immediately before their full-size counterpart (ぁ then あ)
   and a dakuten form immediately after its base (か が き ぎ). So the key is
   the headword's kana with everything that is not hiragana taken out of the
   way, and the comparison is then the ordinary one.

   Three things are normalised:

     ～ 〜 and spaces   A suffix entry is filed under the kana it actually
                        begins with. ～えき belongs in あ行, not in a run of
                        every suffix in the catalogue.
     katakana           Folded to hiragana. コーヒー and こども are the same
                        alphabet for the purpose of ordering, and a reader
                        looking under か does not think about which script
                        the entry happened to be written in.
     ー                 Dropped. The長音 mark carries no vowel of its own and
                        lives in the katakana block, so left in it sorts
                        every borrowed word to the end of its row.
   -------------------------------------------------------------------------------------- */

const KATAKANA_START = 0x30a1;
const KATAKANA_END = 0x30f6;
const TO_HIRAGANA = 0x60;

function toSortKey(kana = '') {
  let key = '';
  for (const char of String(kana)) {
    if (char === '～' || char === '〜' || char === 'ー' || char === '・' || char === ' ' || char === '　') continue;
    const code = char.codePointAt(0);
    key += code >= KATAKANA_START && code <= KATAKANA_END
      ? String.fromCodePoint(code - TO_HIRAGANA)
      : char;
  }
  return key;
}

/* Ordering. `localeCompare` is deliberately not used: it answers to whatever
   locale the browser is in, and this order is a property of the language
   being studied rather than of the reader's machine. */
function compareKana(a, b) {
  const left = toSortKey(a);
  const right = toSortKey(b);
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/* -- The rows -----------------------------------------------------------------------
   The ten columns of a kana chart, in chart order. `chars` is every hiragana
   that files under each — the row's own kana, its small forms and its voiced
   forms — because that is what "under か" means to somebody looking a word
   up: が and ぎ are in か行, not in a row of their own.

   ん and を ride with わ, which is where a chart puts them.
   -------------------------------------------------------------------------------------- */

const KANA_ROWS = [
  { key: 'a', label: 'あ', chars: 'ぁあぃいぅうぇえぉお' },
  { key: 'ka', label: 'か', chars: 'かがきぎくぐけげこごゕゖ' },
  { key: 'sa', label: 'さ', chars: 'さざしじすずせぜそぞ' },
  { key: 'ta', label: 'た', chars: 'ただちぢっつづてでとど' },
  { key: 'na', label: 'な', chars: 'なにぬねの' },
  { key: 'ha', label: 'は', chars: 'はばぱひびぴふぶぷへべぺほぼぽ' },
  { key: 'ma', label: 'ま', chars: 'まみむめも' },
  { key: 'ya', label: 'や', chars: 'ゃやゅゆょよ' },
  { key: 'ra', label: 'ら', chars: 'らりるれろ' },
  { key: 'wa', label: 'わ', chars: 'ゎわゐゑをん' },
];

/* One lookup table, built once, rather than ten `includes` per word. */
const ROW_BY_CHAR = new Map();
for (const row of KANA_ROWS) {
  for (const char of row.chars) ROW_BY_CHAR.set(char, row.key);
}

/* Which row a headword files under, or null for one this chart cannot place
   — a headword written in no kana at all. A null is a real answer and the
   caller's to handle: the list files those together rather than guessing a
   row for them. */
function rowOf(kana) {
  const key = toSortKey(kana);
  return key ? (ROW_BY_CHAR.get(key[0]) ?? null) : null;
}

export { KANA_ROWS, compareKana, rowOf, toSortKey };
