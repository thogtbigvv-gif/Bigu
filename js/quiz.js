/* ==========================================================================
   quiz.js
   The one quiz in the app. Both the Review deck and the per-lesson quiz run
   through this module — they used to be two separate implementations that
   looked similar and behaved slightly differently, which is most of why the
   quiz felt inconsistent depending on where you started it.

   Two study modes, chosen before a round:

     Choose  — a question with four answers, checked for you. This is the
               default, and it's the mode that makes the app teachable
               rather than only self-reportable: it asks something specific,
               tells you immediately whether you were right, and shows the
               answer when you weren't. A beginner has no way to fairly
               self-grade a word they've never seen; a multiple choice
               question doesn't ask them to.

     Flip    — the classic flashcard: recall it in your head, reveal, then
               say whether you knew it. Faster once the material is
               familiar, and still the honest mode for grammar patterns
               whose meanings are long enough that four of them on screen
               at once is a wall of text.

   Choose no longer asks the same thing every time. A word is not one fact,
   it is a small web of them — a shape, a reading, a meaning, and a place in
   a sentence — and a quiz that only ever walks one edge of that web trains
   exactly one direction of recall. The question types below (see QUESTION
   TYPES) walk the others, and which one an item gets depends on how well the
   schedule says it is already held: first meetings are recognition, and the
   harder directions arrive once there is something to test.

   Every type is generated from data the app already ships, and every one is
   checked before it is offered — an item with no usable example never gets a
   sentence question, and a type that cannot find enough plausible wrong
   answers falls back to plain recognition rather than asking something
   ambiguous.

   Both modes grade into review.js, so either one moves an item along the
   same schedule. Nothing here reads or writes storage directly.
   ========================================================================== */

import { grade as gradeItem, describeNextReview, getRecord, shuffled } from './review.js';

/* Four is Quizlet's number and it's the right one: three distractors is
   enough that guessing is clearly worse than knowing (25%), and few enough
   that the whole set is readable at a glance on a phone. */
const CHOICE_COUNT = 4;

/* A question type is only offered if it can find this many wrong answers.
   Two plausible distractors plus the answer is a real question; one is a
   coin toss dressed up as one, and the reader learns nothing from winning
   it. Below the line we fall back to plain recognition. */
const MIN_DISTRACTORS = 2;

/* How long a correct answer sits on screen before the next question. Long
   enough to register the green, short enough that a good run feels fast.
   A wrong answer never auto-advances — see showFeedback. */
const CORRECT_PAUSE_MS = 650;

const MODES = [
  { id: 'choose', label: 'Choose', hint: 'Дөрвөн хариулт, шалгаж өгнө' },
  { id: 'flip', label: 'Flip', hint: 'Картыг эргүүлж хариултыг нь харна' },
];

/* CJK ideographs. Used to decide whether a word has anything to *read* —
   a reading question about アメリカ (reading: アメリカ) is not a question. */
const HAS_KANJI = /[一-鿿]/;

/* -- Item adapters ---------------------------------------------------------------------
   One per content kind. Each knows how to draw its item's Japanese side,
   what plain recognition should ask about it, what its parts are called,
   and which of them are worth showing once the answer is in.

   The four kinds carry genuinely different fields, and the question types
   below are built out of *these* accessors rather than out of raw item
   properties — which is what keeps a new question type from having to know
   that a lesson word calls its gloss `english` and a vocabulary word calls
   it `meaning`.

     japanese  the item's Japanese identity, as a plain string
     reading   how that identity is read, or '' when there is nothing extra
     meaning   the gloss the reader is learning
     sentence  {jp, reading, mn} worth showing, or null
     facts     [label, value, lang?] rows for the answer panel

   These replace the near-identical deck adapters that lived in practice.js
   and the separate hand-rolled card in lessons.js.
   -------------------------------------------------------------------------------------- */

function jpSpan(text) {
  const span = document.createElement('span');
  span.lang = 'ja';
  span.textContent = text;
  return span;
}

function furigana(base, reading) {
  if (!reading || base === reading) return jpSpan(base);
  const ruby = document.createElement('ruby');
  ruby.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = reading;
  ruby.append(base, rt);
  return ruby;
}

function line(className, text, lang) {
  const p = document.createElement('p');
  p.className = className;
  if (lang) p.lang = lang;
  p.textContent = text;
  return p;
}

/* The example block shown with the answer. Built from whichever of
   jp/reading/mn an item actually has, so one function serves all four
   content kinds instead of four near-copies. */
function exampleBlock(sentence) {
  const { jp, reading, mn } = sentence ?? {};
  if (!jp && !reading && !mn) return null;

  const wrap = document.createElement('div');
  wrap.className = 'quiz__example';

  if (jp) wrap.append(line('quiz__example-jp', jp, 'ja'));
  if (reading) wrap.append(line('reading', reading, 'ja'));
  if (mn) wrap.append(line('meta', mn));

  return wrap;
}

/* The item's own parts, labelled — a reading, a part of speech, a structure,
   a pair of kanji readings. Rows with nothing in them are dropped rather
   than rendered as an empty definition, which is where "—" placeholders and
   `undefined` come from. */
function factsList(facts) {
  const rows = facts.filter(([, value]) => Boolean(value));
  if (rows.length === 0) return null;

  const list = document.createElement('dl');
  list.className = 'quiz__facts';

  for (const [label, value, lang] of rows) {
    const row = document.createElement('div');
    row.className = 'quiz__fact';

    const term = document.createElement('dt');
    term.textContent = label;

    const detail = document.createElement('dd');
    detail.textContent = value;
    if (lang) detail.lang = lang;

    row.append(term, detail);
    list.append(row);
  }

  return list;
}

const ADAPTERS = {
  lessons: {
    label: 'Lessons',
    question: 'Энэ үг ямар утгатай вэ?',
    noun: 'үг',
    front: (item) => furigana(item.word, item.reading),
    hint: () => '',
    meaning: (item) => item.english,
    japanese: (item) => item.word,
    reading: (item) => (item.reading === item.word ? '' : item.reading),
    sentence: () => null,
    facts: (item) => [['Уншлага', item.reading === item.word ? '' : item.reading, 'ja']],
  },

  vocabulary: {
    label: 'Vocabulary',
    question: 'Энэ үг ямар утгатай вэ?',
    noun: 'үг',
    front: (item) => (item.kanji ? furigana(item.kanji, item.kana) : jpSpan(item.kana)),
    hint: (item) => item.partOfSpeech,
    meaning: (item) => item.meaning,
    japanese: (item) => item.kanji || item.kana,
    reading: (item) => item.kana,
    sentence: (item) => item.example,
    facts: (item) => [
      ['Уншлага', item.kanji ? item.kana : '', 'ja'],
      ['Үгийн аймаг', item.partOfSpeech],
    ],
  },

  grammar: {
    label: 'Grammar',
    question: 'Энэ хэлбэр ямар утгатай вэ?',
    noun: 'хэлбэр',
    front: (item) => {
      const wrap = document.createElement('span');
      wrap.lang = 'ja';
      wrap.append('〜', item.patternKana ? furigana(item.pattern, item.patternKana) : item.pattern);
      return wrap;
    },
    hint: (item) => item.structure,
    meaning: (item) => item.meaning,
    japanese: (item) => item.pattern,
    reading: (item) => item.patternKana ?? '',
    sentence: (item) => item.example,
    facts: (item) => [['Бүтэц', item.structure]],
  },

  kanji: {
    label: 'Kanji',
    question: 'Энэ ханз ямар утгатай вэ?',
    noun: 'ханз',
    front: (item) => jpSpan(item.character),
    hint: (item) => [item.onyomi, item.kunyomi].filter(Boolean).join(' ・ '),
    meaning: (item) => item.meaning,
    japanese: (item) => item.character,
    // A kanji's "reading" is two readings, and neither of them is a single
    // answer — they get their own question types below instead.
    reading: () => '',
    sentence: (item) => ({ jp: item.example.word, reading: item.example.reading, mn: item.example.mn }),
    facts: (item) => [
      ['On', item.onyomi, 'ja'],
      ['Kun', item.kunyomi, 'ja'],
    ],
  },
};

/* Lesson ids are l1-01, l2-14, … — tested first because "l" is a looser
   match than the prefixes below it. Vocabulary ids carry any level prefix
   (n5-0001 … n1-…), so the pattern matches the whole ladder rather than
   the one prefix the earliest word list happened to use.

   The prefix in an id is history, not a level: an id is the key every
   progress and review record in localStorage is stored under, so it never
   changes once written, even when the entry's actual level says otherwise.
   Read the entry's own level, never its id. */
function deckKeyForItemId(id) {
  if (/^l\d+-/.test(id)) return 'lessons';
  if (/^n[1-5]-/.test(id)) return 'vocabulary';
  if (id.startsWith('gr-')) return 'grammar';
  if (id.startsWith('kj-')) return 'kanji';
  return null;
}

function adapterFor(item) {
  const key = deckKeyForItemId(item.id);
  return key ? ADAPTERS[key] : null;
}

/* The answer panel: what this item *is*, in the parts the reader is learning.
   Same block on the back of a flipped card and under a checked answer, so
   the information a round teaches doesn't depend on which mode you picked. */
function detailBlock(item) {
  const adapter = adapterFor(item);
  const wrap = document.createElement('div');
  wrap.className = 'quiz__detail-block';

  const facts = factsList(adapter.facts(item));
  if (facts) wrap.append(facts);

  const example = exampleBlock(adapter.sentence(item));
  if (example) wrap.append(example);

  return wrap.childElementCount > 0 ? wrap : null;
}

/* -- Question types --------------------------------------------------------------------
   The same item, asked about from different directions. Each type says what
   the correct answer *is* for a given item, which is all the distractor
   search needs: the wrong answers to "how is this read?" are other readings,
   the wrong answers to "which word is this?" are other words.

     meaning     Japanese → meaning          (recognition, the backbone)
     recall      meaning → Japanese          (production)
     reading     kanji word → its reading
     onyomi      kanji → on reading
     kunyomi     kanji → kun reading
     wordReading example word → its reading
     cloze       sentence with a gap → the word that fills it
     context     sentence → what the marked part means

   A type is only ever offered for an item that can support it — see
   supportedTypes — and only if the pool holds enough plausible wrong
   answers. Everything falls back to `meaning`.
   -------------------------------------------------------------------------------------- */

/* Answers that are Japanese rather than a gloss. Two things follow from
   being on this list: the options render in the Japanese face, and a
   candidate that shares the item's meaning is never offered as a wrong
   answer — "which of these means X" with two words that both mean X is a
   question with two right answers. */
const JAPANESE_ANSWER_TYPES = new Set(['recall', 'reading', 'onyomi', 'kunyomi', 'wordReading', 'cloze']);

function clozeSurface(text) {
  return (text ?? '').replace(/[～〜]/g, '').trim();
}

/* The surfaces an item might appear under in its own example: the written
   form first, then the reading. Vocabulary entries with no kanji carry only
   the second. */
function clozeSurfaces(item, adapter) {
  const surfaces = [];
  for (const candidate of [adapter.japanese(item), adapter.reading(item)]) {
    const surface = clozeSurface(candidate);
    // Single characters are excluded on purpose: 日 or 一 turns up inside
    // half the sentences in the file, and blanking one of them asks a
    // question about a coincidence rather than about the word.
    if (surface.length >= 2 && !surfaces.includes(surface)) surfaces.push(surface);
  }
  return surfaces;
}

/* Where the item sits inside its own example sentence, or null if it isn't
   there in a form we can point at. Both sentence question types are built
   from this, and both are simply not offered when it returns null — which
   is the whole guard against a gap that isn't the word, or a highlight on
   the wrong half of a sentence.

   Exactly one occurrence, deliberately. A word that appears twice would
   leave the second copy standing next to the gap it was cut out of. */
function locateInSentence(item, adapter) {
  const sentence = adapter.sentence(item);
  if (!sentence?.jp) return null;

  for (const surface of clozeSurfaces(item, adapter)) {
    const at = sentence.jp.indexOf(surface);
    if (at === -1) continue;
    if (sentence.jp.indexOf(surface, at + surface.length) !== -1) continue;
    return {
      surface,
      before: sentence.jp.slice(0, at),
      after: sentence.jp.slice(at + surface.length),
    };
  }

  return null;
}

/* What the right answer to `type` is for `item`, as text. Returns '' when
   the item cannot answer that question, which is how the distractor search
   skips candidates whose data is thinner than the item being asked about. */
function answerTextFor(type, item, kind) {
  const adapter = ADAPTERS[kind];

  switch (type) {
    case 'recall':
      return adapter.japanese(item) ?? '';
    case 'reading':
      return adapter.reading(item) ?? '';
    case 'onyomi':
      return item.onyomi ?? '';
    case 'kunyomi':
      return item.kunyomi ?? '';
    case 'wordReading':
      return item.example?.reading ?? '';
    case 'cloze': {
      const [surface] = clozeSurfaces(item, adapter);
      return surface ?? '';
    }
    default:
      return adapter.meaning(item) ?? '';
  }
}

/* Which questions this particular item can actually answer. Everything here
   is a data check, not a guess: no type reaches the reader unless the fields
   it needs are present and usable. */
function supportedTypes(item, kind) {
  const adapter = ADAPTERS[kind];
  const types = ['meaning'];

  const japanese = adapter.japanese(item);
  if (japanese) types.push('recall');

  const reading = adapter.reading(item);
  if (reading && japanese && reading !== japanese && HAS_KANJI.test(japanese)) types.push('reading');

  if (kind === 'kanji') {
    if (item.onyomi) types.push('onyomi');
    if (item.kunyomi) types.push('kunyomi');
    if (item.example?.word && item.example?.reading) types.push('wordReading');
  }

  if (locateInSentence(item, adapter)) types.push('cloze', 'context');

  return types;
}

/* Which of them to ask, this time.

   Level 0 is an item the schedule says is either brand new or was just
   missed, and the only fair question about a word you have not met is what
   it means. Recognition first, production once there is something to
   produce — the same order the review ladder itself is built on. `context`
   is allowed early because it is still recognition, only with the sentence
   around it; it is weighted below plain meaning so a first round reads as a
   first round rather than as a wall of Japanese.

   Above level 0 every supported type is equally likely, which is the point:
   an item met four times should have been met four different ways. */
function chooseType(item, kind) {
  const available = supportedTypes(item, kind);
  const { level } = getRecord(item.id);

  if (level <= 0) {
    const gentle = available.includes('context') ? ['meaning', 'meaning', 'context'] : ['meaning'];
    return gentle[Math.floor(Math.random() * gentle.length)];
  }

  return available[Math.floor(Math.random() * available.length)];
}

/* Two items that a reader could plausibly confuse: same level, and same
   word class where the data records one. Distractors are drawn from these
   first and only topped up from the rest of the deck when there aren't
   enough — which is the difference between "language / banana / winter" and
   four answers that all look like answers.

   Not so close that the question stops having one right answer: an item
   that shares the *meaning* being asked about is rejected outright in
   pickChoices, whatever its level or class. */
function levelOf(item, kind) {
  if (kind === 'kanji') return item.level ?? '';
  if (kind === 'lessons') return item.id.slice(0, item.id.indexOf('-'));
  return item.tags?.[0] ?? '';
}

function isPlausibleNeighbour(item, candidate, kind) {
  if (levelOf(item, kind) !== levelOf(candidate, kind)) return false;
  if (kind === 'vocabulary') return item.partOfSpeech === candidate.partOfSpeech;
  return true;
}

function normalize(text) {
  return (text ?? '').trim().toLowerCase();
}

/* The wrong answers. One pass over a shuffled pool, sorting candidates into
   plausible neighbours and everything else, then neighbours first.

   Three rules, and each of them exists because breaking it produces a
   broken question: same content kind (a grammar explanation among four
   kanji meanings is the odd one out, and the odd one out gives the answer
   away), no repeated answer text (two identical options, or two right
   ones), and — for questions whose answer is Japanese — no candidate that
   means the same thing as the item being asked about. */
function pickChoices(item, pool, type, kind, answer) {
  const adapter = ADAPTERS[kind];
  const needed = CHOICE_COUNT - 1;
  const guardMeaning = JAPANESE_ANSWER_TYPES.has(type);
  const itemMeaning = normalize(adapter.meaning(item));

  const seen = new Set([normalize(answer)]);
  const neighbours = [];
  const others = [];

  for (const candidate of shuffled(pool)) {
    if (neighbours.length >= needed) break;
    if (candidate.id === item.id) continue;
    if (deckKeyForItemId(candidate.id) !== kind) continue;

    const text = answerTextFor(type, candidate, kind);
    if (!text) continue;

    const key = normalize(text);
    if (seen.has(key)) continue;
    if (guardMeaning && normalize(adapter.meaning(candidate)) === itemMeaning) continue;

    seen.add(key);
    if (isPlausibleNeighbour(item, candidate, kind)) neighbours.push(text);
    else if (others.length < needed) others.push(text);
  }

  return [...neighbours, ...others].slice(0, needed);
}

/* -- Question building ------------------------------------------------------------------
   A question is what the card front shows, what it asks, and the options
   underneath it. The card *back* is deliberately not part of it: whatever
   was asked, the reveal is the item itself — its Japanese, its reading, its
   meaning, its example — because that is what the reader is here to learn,
   and it means a wrong answer to an unusual question still ends with the
   whole word in front of them.
   -------------------------------------------------------------------------------------- */

const PROMPTS = {
  meaning: (adapter) => adapter.question,
  context: () => 'Тодруулсан хэсэг ямар утгатай вэ?',
  recall: (adapter, kind) =>
    (kind === 'grammar' ? 'Энэ утгыг аль хэлбэр илэрхийлэх вэ?' : 'Үүнийг япон хэлээр юу гэх вэ?'),
  reading: () => 'Энэ үгийг хэрхэн уншдаг вэ?',
  onyomi: () => 'Энэ ханзны онёоми (音) аль нь вэ?',
  kunyomi: () => 'Энэ ханзны кунёоми (訓) аль нь вэ?',
  wordReading: () => 'Энэ үгийг хэрхэн уншдаг вэ?',
  cloze: (adapter) => `Ямар ${adapter.noun} дутуу вэ?`,
};

/* The gap, and the sentence around it. The blank is a real element rather
   than a run of underscores in a string, so it can be sized and coloured
   like the answer it is waiting for. */
function clozeNode(place) {
  const wrap = document.createElement('span');
  wrap.lang = 'ja';

  const gap = document.createElement('span');
  gap.className = 'quiz__blank';
  gap.setAttribute('aria-label', 'хоосон зай');

  wrap.append(place.before, gap, place.after);
  return wrap;
}

function contextNode(place) {
  const wrap = document.createElement('span');
  wrap.lang = 'ja';

  const target = document.createElement('mark');
  target.className = 'quiz__target';
  target.textContent = place.surface;

  wrap.append(place.before, target, place.after);
  return wrap;
}

/* Sentences read as prose, single words read as specimens, and a Mongolian
   gloss asked as a question is neither — three sizes rather than one, or the
   same rule that puts a 39px glyph on the card puts a 39px sentence on it
   too. */
function frontShapeFor(type) {
  if (type === 'cloze' || type === 'context') return 'sentence';
  if (type === 'recall') return 'phrase';
  return 'word';
}

function buildFront(type, item, adapter, place) {
  switch (type) {
    /* A <span>, not a <p>: the card front is a <button> in Flip mode and a
       button may only contain phrasing content. */
    case 'recall': {
      const text = document.createElement('span');
      text.className = 'quiz__front-text';
      text.textContent = adapter.meaning(item);
      return text;
    }
    case 'cloze':
      return clozeNode(place);
    case 'context':
      return contextNode(place);
    // The reading is the answer here, so the front cannot carry furigana —
    // adapter.front() prints it above the word.
    case 'reading':
      return jpSpan(adapter.japanese(item));
    case 'onyomi':
    case 'kunyomi':
      return jpSpan(item.character);
    case 'wordReading':
      return jpSpan(item.example.word);
    default:
      return adapter.front(item);
  }
}

/* The quiet line under the question. It is help, so it must never be the
   answer: a kanji's readings are printed under it for a meaning question and
   withheld for a reading one, and a grammar structure — which spells the
   pattern out in full — is withheld the moment the pattern is what's being
   asked for. */
function buildHint(type, item, adapter) {
  switch (type) {
    case 'meaning':
      return adapter.hint(item);
    case 'reading':
    case 'recall':
      return adapter === ADAPTERS.vocabulary ? item.partOfSpeech : '';
    default:
      return '';
  }
}

function composeQuestion(item, pool, type, kind, { minDistractors }) {
  const adapter = ADAPTERS[kind];
  const place = type === 'cloze' || type === 'context' ? locateInSentence(item, adapter) : null;
  if ((type === 'cloze' || type === 'context') && !place) return null;

  const answer = type === 'cloze' ? place.surface : answerTextFor(type, item, kind);
  if (!answer) return null;

  const distractors = pickChoices(item, pool, type, kind, answer);
  if (distractors.length < minDistractors) return null;

  const japanese = JAPANESE_ANSWER_TYPES.has(type);

  return {
    type,
    prompt: PROMPTS[type](adapter, kind),
    front: buildFront(type, item, adapter, place),
    shape: frontShapeFor(type),
    hint: buildHint(type, item, adapter),
    answerText: answer,
    answerIsJapanese: japanese,
    choices: shuffled([answer, ...distractors]).map((text) => ({
      text,
      correct: text === answer,
      lang: japanese ? 'ja' : null,
    })),
  };
}

/* Pick a type, then make sure it survived contact with the data. A lesson
   quiz draws its wrong answers from eighteen words, so a reading question
   about the one word in the lesson written in kanji has nowhere to find
   three other readings — that question is dropped and the reader gets plain
   recognition instead, which is always answerable because every item in
   every deck has a meaning.

   The last fallback accepts a single distractor: a two-option question is a
   poor question, but a deck that small has nothing better to offer and an
   empty options row would be a broken screen. */
function buildQuestion(item, pool) {
  const kind = deckKeyForItemId(item.id);
  const type = chooseType(item, kind);

  return composeQuestion(item, pool, type, kind, { minDistractors: MIN_DISTRACTORS })
    ?? composeQuestion(item, pool, 'meaning', kind, { minDistractors: MIN_DISTRACTORS })
    ?? composeQuestion(item, pool, 'meaning', kind, { minDistractors: 1 });
}

/* How far a card has to travel before letting go grades it. 72px is about a
   thumb's width: far enough that a stray drag while scrolling the page can't
   answer a question, short enough to flick without lifting the wrist. */
const SWIPE_GRADE_DISTANCE = 72;

/* How long the graded card takes to leave. Deliberately shorter than its
   arrival: a card being discarded is the reader's own decision already made,
   and every millisecond here is paid forty times a round. */
const EXIT_MS = 180;

function arrowGlyph(direction) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'quiz__grade-arrow');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', direction === 'left' ? 'M15 5 8 12l7 7' : 'M9 5l7 7-7 7');
  svg.append(path);
  return svg;
}

function gradeLabel(text) {
  const span = document.createElement('span');
  span.className = 'quiz__grade-label';
  span.textContent = text;
  return span;
}

/* -- Markup -------------------------------------------------------------------------------
   One panel covering both modes; the parts a mode doesn't use are hidden
   rather than rebuilt, so switching modes between rounds never rebuilds
   the DOM. Structure top to bottom: progress bar, counters + exit, the
   card, the mode's own controls, feedback.
   -------------------------------------------------------------------------------------------- */

function buildPanel() {
  const panel = document.createElement('div');
  panel.className = 'quiz';
  panel.hidden = true;

  /* Progress. aria-hidden because the counter beside it says the same thing
     in words — announcing it again on every question is noise. */
  const bar = document.createElement('div');
  bar.className = 'quiz__progress';
  bar.setAttribute('aria-hidden', 'true');

  const barFill = document.createElement('span');
  barFill.className = 'quiz__progress-bar';
  bar.append(barFill);

  const head = document.createElement('div');
  head.className = 'quiz__head';

  const title = document.createElement('p');
  title.className = 'quiz__title';

  /* "03 / 10" — the position, at a glance, in tabular figures so the numbers
     don't shuffle sideways as they climb. The spoken version is a sentence
     rather than a fraction, and it carries the score as well; both live in
     one live region so a screen reader hears the whole state once per
     question instead of two fragments. */
  const count = document.createElement('p');
  count.className = 'quiz__count';
  count.setAttribute('aria-live', 'polite');

  const countIndex = document.createElement('span');
  countIndex.className = 'quiz__count-index';

  const countTotal = document.createElement('span');
  countTotal.className = 'quiz__count-total';

  const countSpoken = document.createElement('span');
  countSpoken.className = 'sr-only';

  count.append(countIndex, countTotal, countSpoken);

  const exitButton = document.createElement('button');
  exitButton.type = 'button';
  exitButton.className = 'button button--secondary quiz__exit';
  exitButton.textContent = 'End';

  head.append(title, count, exitButton);

  /* Card. Two faces of one object rather than a question with an answer
     printed underneath it: the front asks and the back answers, in both modes.

     What differs is who turns it. In Flip the reader does, before grading
     themselves — the front is a <button>, so the card is its own control,
     tappable and focusable without a second button underneath doing the same
     job. In Choose the app turns it the moment an option is picked, which is
     why the front is disabled there.

     The front's children are <span>s, not <p>s — a <button> may only contain
     phrasing content, and they are flex items here so they lay out as blocks
     anyway. */
  const scene = document.createElement('div');
  scene.className = 'quiz__scene';

  const cardInner = document.createElement('div');
  cardInner.className = 'quiz__card-inner';

  const card = document.createElement('button');
  card.type = 'button';
  card.className = 'card quiz__card quiz__card--front';

  const prompt = document.createElement('span');
  prompt.className = 'quiz__prompt';

  const front = document.createElement('span');
  front.className = 'quiz__front';

  const hint = document.createElement('span');
  hint.className = 'quiz__hint';

  // Shown in Flip mode only. The card looks like every other card in the app,
  // so nothing about it says "turn me over" until this line does.
  const flipHint = document.createElement('span');
  flipHint.className = 'quiz__flip-hint';
  flipHint.textContent = 'Дарж эргүүлнэ үү';

  card.append(prompt, front, hint, flipHint);

  const cardBack = document.createElement('div');
  cardBack.className = 'card quiz__card quiz__card--back';
  // Focused when the card turns, so a screen reader hears the answer rather
  // than only the grade buttons that appear with it.
  cardBack.tabIndex = -1;

  /* The reveal is always the item, never merely the answer to what was
     asked. Whatever the question walked — a reading, a gap in a sentence, a
     meaning — the back carries the Japanese, its reading, and its gloss
     together, because the point of the round is the word and not the
     question. In Choose it is also the only place the Japanese survives the
     turn at all. */
  const answerJp = document.createElement('p');
  answerJp.className = 'quiz__answer-jp';

  const answer = document.createElement('p');
  answer.className = 'quiz__answer';

  const answerDetail = document.createElement('div');
  answerDetail.className = 'quiz__answer-detail';

  cardBack.append(answerJp, answer, answerDetail);
  cardInner.append(card, cardBack);
  scene.append(cardInner);

  /* Choose mode */
  const options = document.createElement('div');
  options.className = 'quiz__options';
  options.setAttribute('role', 'group');
  options.setAttribute('aria-label', 'Answers');

  /* Flip mode. No "Show answer" button any more — the card is the control,
     and two things on one screen doing the same thing reads as a bug. */
  const grade = document.createElement('div');
  grade.className = 'quiz__grade';
  grade.hidden = true;

  /* The two verdicts have directions — left for "still learning", right for
     "I knew it" — and the card travels that way whether it was flicked or
     the button was pressed. The arrows are how the buttons teach the gesture:
     a swipe nobody knows about is a feature nobody has. They stay on the outer
     edge of each button and the row never stacks, so the button's own position
     on screen agrees with the direction it means. */
  const missButton = document.createElement('button');
  missButton.type = 'button';
  missButton.className = 'button button--secondary quiz__grade-button quiz__grade-button--left';
  missButton.append(arrowGlyph('left'), gradeLabel('Still learning'));

  const knewButton = document.createElement('button');
  knewButton.type = 'button';
  knewButton.className = 'button button--primary quiz__grade-button quiz__grade-button--right';
  knewButton.append(gradeLabel('I knew it'), arrowGlyph('right'));

  grade.append(missButton, knewButton);

  /* Feedback, shared by both modes. Three parts, in the order the reader
     needs them: was I right, what was right, and what this word actually is. */
  const feedback = document.createElement('div');
  feedback.className = 'quiz__feedback';
  feedback.hidden = true;

  const verdict = document.createElement('p');
  verdict.className = 'quiz__verdict';

  const verdictMark = document.createElement('span');
  verdictMark.className = 'quiz__verdict-mark';
  verdictMark.setAttribute('aria-hidden', 'true');

  const verdictText = document.createElement('span');
  verdictText.className = 'quiz__verdict-text';

  const verdictTiming = document.createElement('span');
  verdictTiming.className = 'quiz__verdict-timing';

  verdict.append(verdictMark, verdictText, verdictTiming);

  /* Named in words, not only highlighted in green. An option marked by
     colour alone is unreadable to a reader who cannot see the colour and
     invisible to one who has already scrolled past the options. */
  const answerLine = document.createElement('p');
  answerLine.className = 'quiz__answer-line';
  answerLine.hidden = true;

  const answerLineLabel = document.createElement('span');
  answerLineLabel.className = 'quiz__answer-line-label';
  answerLineLabel.textContent = 'Зөв хариулт';

  const answerLineValue = document.createElement('span');
  answerLineValue.className = 'quiz__answer-line-value';

  answerLine.append(answerLineLabel, answerLineValue);

  /* Choose keeps its detail here rather than on the card — see the note in
     renderCard on why the answer face has to stay short in that mode. */
  const detail = document.createElement('div');
  detail.className = 'quiz__detail';

  const continueButton = document.createElement('button');
  continueButton.type = 'button';
  continueButton.className = 'button button--primary quiz__continue';
  continueButton.textContent = 'Continue';

  feedback.append(verdict, answerLine, detail, continueButton);

  /* The whole feedback area, announced as one thing once it has something to
     say. role=status on the verdict alone announced a fragment ("Зөв ·
     маргааш эргэж ирнэ") and left the correct answer — the part a reader who
     got it wrong actually needs — unspoken. */
  const feedbackSlot = document.createElement('div');
  feedbackSlot.className = 'quiz__feedback-slot';
  feedbackSlot.setAttribute('role', 'status');
  feedbackSlot.append(feedback);

  const shortcuts = document.createElement('p');
  shortcuts.className = 'quiz__shortcuts meta';

  /* Summary */
  const summary = document.createElement('div');
  summary.className = 'quiz__summary';
  summary.hidden = true;
  /* Focusable by script only, so finish() can move focus here when the round
     ends. Without it the summary is not a focus target at all and the focus
     call is silently a no-op, which leaves a keyboard or screen-reader user
     standing on a button that has just been hidden. -1 rather than 0: it is
     a landing place, not a tab stop. */
  summary.tabIndex = -1;

  const summaryScore = document.createElement('p');
  summaryScore.className = 'quiz__summary-score';

  /* Three figures, and none of them is a trophy: how much of the round was
     right, how many that was, and how many are coming back. The last one is
     the only actionable number on the screen, which is why it is on it. */
  const summaryStats = document.createElement('dl');
  summaryStats.className = 'quiz__summary-stats';

  function statCell(label) {
    const cell = document.createElement('div');
    cell.className = 'quiz__stat';
    const value = document.createElement('dd');
    value.className = 'quiz__stat-value';
    const term = document.createElement('dt');
    term.className = 'quiz__stat-label';
    term.textContent = label;
    cell.append(value, term);
    summaryStats.append(cell);
    return value;
  }

  const statPercent = statCell('зөв хариулсан');
  const statCorrect = statCell('зөв');
  const statMissed = statCell('давтах');

  const summaryText = document.createElement('p');
  summaryText.className = 'quiz__summary-text';

  const missedHeading = document.createElement('p');
  missedHeading.className = 'quiz__missed-heading';
  missedHeading.textContent = 'Worth another look';

  const missedList = document.createElement('ul');
  missedList.className = 'quiz__missed-list';

  const summaryActions = document.createElement('div');
  summaryActions.className = 'quiz__summary-actions';

  const retryMissedButton = document.createElement('button');
  retryMissedButton.type = 'button';
  retryMissedButton.className = 'button button--primary';

  const againButton = document.createElement('button');
  againButton.type = 'button';
  againButton.className = 'button button--secondary';
  againButton.textContent = 'New round';

  const doneButton = document.createElement('button');
  doneButton.type = 'button';
  doneButton.className = 'button button--secondary';
  doneButton.textContent = 'Done';

  summaryActions.append(retryMissedButton, againButton, doneButton);
  summary.append(summaryScore, summaryStats, summaryText, missedHeading, missedList, summaryActions);

  const round = document.createElement('div');
  round.className = 'quiz__round';
  round.append(bar, head, scene, options, grade, feedbackSlot, shortcuts);

  panel.append(round, summary);

  return {
    panel, round, bar, barFill, title, count, countIndex, countTotal, countSpoken, exitButton,
    scene, cardInner, card, prompt, front, hint, flipHint,
    cardBack, answerJp, answer, answerDetail,
    options, grade, missButton, knewButton,
    feedbackSlot, feedback, verdict, verdictMark, verdictText, verdictTiming,
    answerLine, answerLineValue, detail, continueButton, shortcuts,
    summary, summaryScore, statPercent, statCorrect, statMissed, summaryText,
    missedHeading, missedList, retryMissedButton, againButton, doneButton,
  };
}

/* -- Session ------------------------------------------------------------------------------- */

/**
 * Builds a quiz panel and returns a handle to it.
 *
 * - `onGrade`     fires after every answer, so the view behind the quiz can
 *                 refresh whatever it shows about progress.
 * - `onFinish`    fires once a round ends, with what happened, so the caller
 *                 can log the session however it logs sessions.
 * - `onNewRound`  supplies the next round's items. The caller owns what a
 *                 round contains — Review draws from the schedule, a lesson
 *                 quiz just reshuffles its own words — so the quiz asks
 *                 rather than guessing.
 * - `onExit`      fires when the reader leaves the quiz entirely.
 * - `isActive`    guards the keyboard shortcuts, so they never fire while
 *                 another view is on screen.
 */
function createQuiz({
  onGrade = () => {},
  onFinish = () => {},
  onNewRound = null,
  onExit = () => {},
  isActive = () => true,
} = {}) {
  const el = buildPanel();

  const state = {
    mode: 'choose',
    queue: [],
    pool: [],
    index: 0,
    correct: 0,
    missed: [],
    answered: false,
    flipped: false,
    // The question on screen, built once per card in renderCard. Held so
    // that grading and feedback describe what was actually asked rather
    // than re-deriving it — a second call to buildQuestion would pick a
    // different type and name a different right answer.
    question: null,
    // 'left' | 'right' | null — which way the last answer sent the card. Set
    // at grading time and read again at advance time, so the flick, the lean
    // it settles into, and the exit are all one continuous movement.
    direction: null,
    title: '',
  };

  /* A round ends exactly once. "End" pressed inside the 650ms a correct
     answer waits before advancing used to finish twice: the button truncates
     the queue and calls finish(), then the pending timer fires advance() ->
     step(), the index is now past the shortened queue, and finish() runs
     again. Two onFinish calls means two session records in the practice
     store for one round. Reset in run(), not here, so a second round through
     the same panel can finish on its own account. */
  let finished = false;

  /* -- Rendering ------------------------------------------------------------------------ */

  /* The bar counts *answered* questions, not the card on screen. Filling it
     the moment a card appears reports work that hasn't happened yet, and at
     the last question the bar sat one whole card short of the end while the
     reader looked at a finished round. */
  function setProgress() {
    const total = state.queue.length;
    const done = Math.min(state.index + (state.answered ? 1 : 0), total);
    const position = Math.min(state.index + 1, total);

    el.barFill.style.setProperty('--progress', total === 0 ? '0' : (done / total).toFixed(3));
    el.countIndex.textContent = String(position).padStart(2, '0');
    el.countTotal.textContent = String(total).padStart(2, '0');
    el.countSpoken.textContent = `${position} / ${total} асуулт · ${state.correct} зөв`;
  }

  function currentItem() {
    return state.queue[state.index];
  }

  function renderOptions(question) {
    el.options.replaceChildren();

    question.choices.forEach((choice, i) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'quiz__option';
      button.dataset.correct = String(choice.correct);

      const key = document.createElement('span');
      key.className = 'quiz__option-key';
      key.textContent = String(i + 1);
      key.setAttribute('aria-hidden', 'true');

      const text = document.createElement('span');
      text.className = choice.lang === 'ja' ? 'quiz__option-text quiz__option-text--jp' : 'quiz__option-text';
      if (choice.lang) text.lang = choice.lang;
      text.textContent = choice.text;

      button.append(key, text);
      button.addEventListener('click', () => answer(choice.correct, button));
      el.options.append(button);
    });
  }

  /* Face the card front again with no animation at all.

     The alternative — letting it turn back on its own — plays the reveal in
     reverse with the *next* question's answer already printed on the back, so
     the reader watches a meaning they haven't been asked about yet rotate
     away. Killing the transition for one frame is the honest version: the
     previous card is gone, and the new one arrives face up on its own
     entrance animation.

     Same class-off / reflow / class-on shape as the entrance restart below. */
  function faceFront() {
    state.flipped = false;
    el.scene.classList.add('is-instant');
    el.scene.classList.remove('is-flipped');
    void el.cardInner.offsetWidth;
    el.scene.classList.remove('is-instant');
    syncFaces();
  }

  /* Only the face turned towards the reader is in the accessibility tree.
     Both are always in the DOM — the card is sized to the taller of the two
     so it doesn't resize mid-turn — and without this a screen reader would
     read the answer straight out of the back of an unturned card.

     The front is *disabled* once it has been turned away, not merely
     aria-hidden. Two reasons, and they are the same reason twice: a focusable
     element inside an aria-hidden subtree is a contradiction the spec
     forbids, and a button a reader can Tab to but cannot see is the bug this
     app already fixed once in the nav drawer. It also can't be turned twice. */
  function syncFaces() {
    el.card.disabled = state.mode !== 'flip' || state.flipped;
    el.card.setAttribute('aria-hidden', String(state.flipped));
    el.cardBack.setAttribute('aria-hidden', String(!state.flipped));
  }

  function flip() {
    if (state.mode !== 'flip' || state.flipped || state.answered) return;
    turnToAnswer();
    el.grade.hidden = false;
    // The answer, not the buttons: this is what the reader just asked for, and
    // it is what a screen reader should say before offering a verdict on it.
    el.cardBack.focus();
  }

  /* The turn itself, with no opinion about who asked for it — the reader in
     Flip, the act of answering in Choose. */
  function turnToAnswer() {
    if (state.flipped) return;
    state.flipped = true;
    el.scene.classList.add('is-flipped');
    syncFaces();
  }

  /* -- Dragging ---------------------------------------------------------------------------
     Left is "still learning", right is "I knew it", and the card goes where it
     is thrown. This is the one screen in the app a reader touches dozens of
     times in a sitting, and reaching for one of two buttons every time is the
     kind of small tax that decides whether a review habit survives the month.

     Only in Flip, and only after the card has been turned: a swipe is a
     *grade*, and grading a card whose answer you haven't seen is not a
     shortcut, it is a mis-tap with consequences for the schedule.

     The direction test is what stops it stealing scrolls — a thumb travelling
     down a page drifts sideways by tens of pixels, so the horizontal component
     has to be the larger one before this claims the gesture. Once it has, it
     calls preventDefault(), which is why the move listener cannot be passive:
     without it the page scrolls under a card the reader is trying to throw.
     ---------------------------------------------------------------------------------------- */
  function setDrag(dx) {
    el.scene.style.setProperty('--drag', `${dx}px`);
    // A hair over 2 degrees at the grading threshold: enough that the card
    // reads as pivoting about a point below the screen rather than sliding
    // flat, which is what makes it feel like an object and not a panel.
    el.scene.style.setProperty('--drag-tilt', `${(dx / SWIPE_GRADE_DISTANCE) * 2.2}deg`);
    el.scene.style.setProperty('--drag-progress', String(Math.min(Math.abs(dx) / SWIPE_GRADE_DISTANCE, 1)));
    if (dx !== 0) el.scene.dataset.toward = dx > 0 ? 'right' : 'left';
  }

  /* The two halves of a throw, separated because they end at different times.
     `--drag` and `--drag-tilt` are the card following the finger and stop
     mattering the moment the throw is graded — the lean takes the transform
     from there. `data-toward` and `--drag-progress` are the *mark*: the edge
     of the card in the colour of the verdict it went to, which stays until
     the card leaves. A card graded from the buttons gets the mark without
     ever having had the drag. */
  function clearDrag() {
    el.scene.style.removeProperty('--drag');
    el.scene.style.removeProperty('--drag-tilt');
    el.scene.classList.remove('is-dragging');
  }

  function clearMark() {
    el.scene.style.removeProperty('--drag-progress');
    delete el.scene.dataset.toward;
  }

  function initDrag() {
    let startX = null;
    let startY = null;
    let claimed = false;

    const canDrag = () => state.mode === 'flip' && state.flipped && !state.answered;

    el.scene.addEventListener('touchstart', (event) => {
      if (!canDrag() || event.touches.length !== 1) {
        startX = null;
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
      claimed = false;
    }, { passive: true });

    el.scene.addEventListener('touchmove', (event) => {
      if (startX === null || !canDrag()) return;

      const dx = event.touches[0].clientX - startX;
      const dy = event.touches[0].clientY - startY;

      if (!claimed) {
        // Undecided until the gesture has committed to an axis. 10px of slop
        // keeps a tap that wobbles from registering as a throw, and the
        // comparison against dy is what stops a scroll being graded.
        if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
        claimed = true;
        el.scene.classList.add('is-dragging');
      }

      event.preventDefault();
      setDrag(dx);
    }, { passive: false });

    const release = (event) => {
      if (startX === null) return;
      const dx = claimed ? (event.changedTouches?.[0]?.clientX ?? startX) - startX : 0;
      startX = null;

      // The class comes off first so the card animates home rather than
      // teleporting, and the custom properties go with it.
      el.scene.classList.remove('is-dragging');

      if (claimed && Math.abs(dx) >= SWIPE_GRADE_DISTANCE) {
        // Left the custom properties in place on purpose: the card is where
        // the reader left it, and the lean below takes over from there rather
        // than snapping back through centre first.
        answer(dx > 0, null);
        return;
      }
      clearDrag();
    };

    el.scene.addEventListener('touchend', release, { passive: true });
    el.scene.addEventListener('touchcancel', () => {
      startX = null;
      el.scene.classList.remove('is-dragging');
      clearDrag();
    }, { passive: true });
  }

  initDrag();

  function renderCard() {
    const item = currentItem();
    const adapter = adapterFor(item);
    const flipMode = state.mode === 'flip';
    state.answered = false;

    /* Flip asks one question and always the same one — recall this, then
       say whether you did. The question types are Choose's, because they
       depend on being *checked*: nobody can honestly self-grade "which of
       these four is the reading". */
    state.question = flipMode ? null : buildQuestion(item, state.pool);

    el.prompt.textContent = flipMode ? 'Үүнийг мэдэх үү?' : state.question.prompt;
    el.front.replaceChildren(flipMode ? adapter.front(item) : state.question.front);
    el.front.dataset.shape = flipMode ? 'word' : state.question.shape;

    const hintText = flipMode ? adapter.hint(item) : state.question.hint;
    el.hint.textContent = hintText;
    el.hint.hidden = !hintText;

    /* The back, in both modes: the Japanese over its own meaning. The one
       moment worth putting the two sides of a word in the same eyeline is
       the moment the reader has just committed to a guess, and in Choose it
       is the only thing that survives the turn.

       The detail block is Flip's alone, and the reason is height, measured on
       a 390x844 phone. Both faces share one grid cell, so whatever the back
       carries sets the card's height *for the whole round* — and an example
       block takes the card from 176px to 294px. In Flip that is free: nothing
       is below the card but two buttons. In Choose it pushes four options and
       the Continue button under the fold, so a reader would have to scroll to
       finish answering a question they can currently answer without moving.
       Choose keeps its detail in the feedback area below, where it costs
       nothing until there is something to say. */
    el.answerJp.replaceChildren(adapter.front(item));
    el.answer.textContent = adapter.meaning(item);
    const back = flipMode ? detailBlock(item) : null;
    el.answerDetail.replaceChildren(...(back ? [back] : []));
    el.flipHint.hidden = !flipMode;

    el.feedback.hidden = true;
    el.answerLine.hidden = true;
    el.detail.replaceChildren();
    el.scene.classList.remove('is-correct', 'is-leaning-left', 'is-leaning-right');
    state.direction = null;
    clearDrag();
    clearMark();
    faceFront();

    if (flipMode) {
      // Cleared, not merely hidden: options built for a previous Choose round
      // are stale answers to a question that is no longer on screen, and the
      // keyboard shortcuts index straight into this list.
      el.options.replaceChildren();
      el.options.hidden = true;
      el.grade.hidden = true;
      el.shortcuts.textContent = 'Space дарж эргүүлнэ · 1 сурч байна · 2 мэдсэн · Esc гарна';
    } else {
      renderOptions(state.question);
      el.options.hidden = false;
      el.grade.hidden = true;
      el.shortcuts.textContent = `1–${state.question.choices.length} дарж хариулна · Enter үргэлжлүүлнэ · Esc гарна`;
    }

    setProgress();

    // Restart the entrance animation: the class has to come off for a frame
    // before it can take effect again.
    el.scene.classList.remove('is-entering');
    requestAnimationFrame(() => el.scene.classList.add('is-entering'));
  }

  /* -- Answering ------------------------------------------------------------------------
     One path for both modes: a choose-mode click reports whether the chosen
     option was the right one, a flip-mode grade reports what the reader
     said about themselves. Everything after that — the schedule write, the
     feedback, the pacing — is the same.
     -------------------------------------------------------------------------------------- */

  function showFeedback(knewIt, record) {
    /* Where the card has come to rest, and where it will leave from. A flicked
       card is already off-centre and the lean simply takes over its position;
       a card graded from the buttons travels there now, so the button press
       and the flick end in exactly the same place. */
    state.direction = knewIt ? 'right' : 'left';
    clearDrag();
    el.scene.dataset.toward = state.direction;
    el.scene.style.setProperty('--drag-progress', '1');
    el.scene.classList.add(`is-leaning-${state.direction}`);
    if (knewIt) el.scene.classList.add('is-correct');

    /* Unhidden before it is written. A live region that is populated while
       hidden and then revealed announces nothing in several screen readers —
       the change they are watching for is to the text, and by the time the
       element exists on screen the text is already old. */
    el.feedback.hidden = false;

    el.verdictMark.textContent = knewIt ? '✓' : '✕';
    el.verdictText.textContent = knewIt ? 'Зөв' : 'Дахин үзье';
    // The schedule is the one thing the card cannot say, and it is worth
    // saying: "back in three days" is the only visible evidence that
    // answering honestly does anything at all.
    el.verdictTiming.textContent = describeNextReview(record);
    el.verdict.classList.toggle('is-correct', knewIt);
    el.verdict.classList.toggle('is-incorrect', !knewIt);

    /* What it should have been, in words. Only when it was missed: naming the
       right answer to someone who has just given it is noise, and Choose has
       already marked the option green. */
    const question = state.question;
    const showAnswer = !knewIt && state.mode === 'choose' && question;
    el.answerLine.hidden = !showAnswer;
    if (showAnswer) {
      el.answerLineValue.textContent = question.answerText;
      if (question.answerIsJapanese) el.answerLineValue.lang = 'ja';
      else el.answerLineValue.removeAttribute('lang');
    }

    // Flip already carries it on the back of the card.
    const detail = state.mode === 'flip' ? null : detailBlock(currentItem());
    el.detail.replaceChildren(...(detail ? [detail] : []));

    /* A right answer moves on by itself — being made to confirm something
       you already got right is the friction that makes a quiz feel slow.
       A wrong one waits: that's the moment there's something to read, and
       taking it away after 650ms would be taking away the only part of the
       round that teaches. */
    if (knewIt) {
      el.continueButton.hidden = true;
      window.setTimeout(() => {
        if (state.answered && !el.panel.hidden) advance();
      }, CORRECT_PAUSE_MS);
    } else {
      el.continueButton.hidden = false;
      /* preventScroll, and it is load-bearing. Focusing a button below the
         fold scrolls it into view, and on a phone that means the card — which
         has just turned to show the answer — is pushed off the top of the
         screen at the exact moment it became worth reading. Focus still moves,
         so a keyboard reader is on the right control and Enter advances; the
         page simply stays where the reader was looking. */
      el.continueButton.focus({ preventScroll: true });
    }
  }

  function answer(knewIt, chosenButton) {
    if (state.answered) return;
    state.answered = true;

    const item = currentItem();
    const record = gradeItem(item.id, knewIt);

    if (knewIt) {
      state.correct += 1;
    } else {
      state.missed.push(item);
    }

    if (state.mode === 'choose') {
      for (const button of el.options.children) {
        button.disabled = true;
        const isAnswer = button.dataset.correct === 'true';
        // The right answer is always marked, not just the one that was
        // picked — a wrong guess should end with the reader having seen
        // which one it should have been.
        if (isAnswer) button.classList.add('is-answer');
        if (button === chosenButton && !isAnswer) button.classList.add('is-wrong');
      }
      /* And the card turns, the same turn Flip makes — this is the moment
         Choose has an answer to show, and showing it on the card's own back
         is what stops the page from growing a block underneath the options
         at the exact moment the reader is reading them. The highlighted
         option says which one; the card says what the word is. */
      turnToAnswer();
    } else {
      // The card stays turned: the answer is what the reader is grading
      // themselves against, and it should still be there while they read the
      // verdict underneath it.
      el.grade.hidden = true;
    }

    setProgress();
    onGrade();
    showFeedback(knewIt, record);
  }

  /* The graded card leaves the way it was thrown, and the next one arrives
     face up on its own entrance. A deck: you discard to one side or the other,
     and you draw from the top.

     Driven by `animationend` rather than a timer, because reset.css collapses
     every animation in the app to 0.01ms under prefers-reduced-motion — a
     fixed setTimeout would hold a reader who asked for less motion at a blank
     card for the full 180ms. The timer that is here is a safety net for the
     case where the animation never runs at all (an off-screen panel, a tab in
     the background) and would otherwise strand the round.

     Guarded against firing twice, and the listener is taken off again rather
     than left waiting on `once`: an animation that never runs leaves a live
     listener behind on every card of the round, and the next card's entrance
     is an animationend on the same element. */
  function advance() {
    const direction = state.direction;
    if (!direction) {
      step();
      return;
    }

    /* Off first. It is the same property as the exit animation and is
       declared later in quiz.css, so leaving it on meant the card never
       actually left — `advance` fell through to its safety timeout every
       time and the discard was invisible. A class that has outlived its own
       animation is a lie either way. */
    el.scene.classList.remove('is-entering');

    let stepped = false;
    const onEnd = (event) => {
      // Animation events bubble, and the correct-answer ring runs on a face
      // inside this element.
      if (event.target !== el.scene) return;
      go();
    };
    const go = () => {
      if (stepped) return;
      stepped = true;
      el.scene.removeEventListener('animationend', onEnd);
      step();
    };

    el.scene.addEventListener('animationend', onEnd);
    window.setTimeout(go, EXIT_MS + 120);

    el.scene.classList.add(`is-leaving-${direction}`);
  }

  function step() {
    el.scene.classList.remove('is-leaving-left', 'is-leaving-right');
    state.index += 1;
    if (state.index >= state.queue.length) {
      finish();
    } else {
      renderCard();
    }
  }

  /* -- Summary --------------------------------------------------------------------------- */

  function finish() {
    if (finished) return;
    finished = true;

    const total = state.queue.length;
    onFinish({ total, correct: state.correct, missed: state.missed.slice(), mode: state.mode });

    el.barFill.style.setProperty('--progress', '1');
    el.summaryScore.textContent = `${state.correct} / ${total}`;
    el.summaryScore.classList.toggle('is-perfect', total > 0 && state.missed.length === 0);

    const pct = total === 0 ? 0 : Math.round((state.correct / total) * 100);
    el.statPercent.textContent = `${pct}%`;
    el.statCorrect.textContent = String(state.correct);
    el.statMissed.textContent = String(state.missed.length);

    el.summaryText.textContent = state.missed.length === 0
      ? 'Бүгд зөв. Энэ давталтаас үлдсэн юм алга.'
      : 'Доорх зүйлс бусдаасаа эрт эргэж ирнэ.';

    el.missedList.replaceChildren();
    for (const item of state.missed) {
      const adapter = adapterFor(item);
      const row = document.createElement('li');
      row.className = 'quiz__missed-item';

      const front = document.createElement('span');
      front.className = 'quiz__missed-front';
      front.append(adapter.front(item));

      const meaning = document.createElement('span');
      meaning.className = 'quiz__missed-meaning meta';
      meaning.textContent = adapter.meaning(item);

      row.append(front, meaning);
      el.missedList.append(row);
    }

    const hasMissed = state.missed.length > 0;
    el.missedHeading.hidden = !hasMissed;
    el.missedList.hidden = !hasMissed;
    el.retryMissedButton.hidden = !hasMissed;
    el.retryMissedButton.textContent = `Practise the ${state.missed.length} you missed`;

    el.round.hidden = true;
    el.summary.hidden = false;
    el.summary.focus?.();
  }

  /* -- Lifecycle ------------------------------------------------------------------------- */

  function run(items, { mode = state.mode, pool = items, title = state.title } = {}) {
    state.mode = mode;
    state.queue = items;
    state.pool = pool.length >= CHOICE_COUNT ? pool : items;
    state.index = 0;
    state.correct = 0;
    state.missed = [];
    state.question = null;
    state.title = title;
    finished = false;

    el.title.textContent = title;
    el.title.hidden = !title;
    el.panel.hidden = false;
    el.summary.hidden = true;
    el.round.hidden = false;

    renderCard();
  }

  function close() {
    el.panel.hidden = true;
    onExit();
  }

  /* Ending a round early still counts what was graded: the schedule already
     has those answers, and reporting a 3/10 for a round stopped after three
     questions would punish stopping. Leaving before answering anything is
     just leaving — a "0 / 0" summary reports nothing and asks for a click
     to dismiss it. */
  function endRound() {
    const graded = state.index + (state.answered ? 1 : 0);
    if (graded === 0) {
      close();
      return;
    }
    state.queue = state.queue.slice(0, graded);
    finish();
  }

  el.card.addEventListener('click', flip);

  el.missButton.addEventListener('click', () => answer(false, null));
  el.knewButton.addEventListener('click', () => answer(true, null));
  el.continueButton.addEventListener('click', advance);
  el.exitButton.addEventListener('click', endRound);

  el.againButton.addEventListener('click', () => {
    const next = onNewRound ? onNewRound() : shuffled(state.pool).slice(0, state.queue.length || 10);
    if (!next || next.length === 0) {
      close();
      return;
    }
    run(next, { pool: state.pool, title: state.title });
  });

  el.retryMissedButton.addEventListener('click', () => run(shuffled(state.missed), {
    pool: state.pool,
    title: state.title,
  }));

  el.doneButton.addEventListener('click', close);

  /* Keyboard: 1–4 answer in Choose, Space turns the card and 1/2 grade it in
     Flip, Enter continues past a wrong answer, Escape ends the round. Guarded
     by isActive() so the keys never fire while another view is on screen.

     Modified keypresses are left alone. Ctrl+1 and Cmd+1 switch browser tabs,
     and answering the question on the way out is a graded card the reader
     never saw.

     Space is handled here rather than left to the card button's own native
     activation, because it has to work wherever focus happens to be — the
     grade buttons, the End button, nothing at all. When the card *does* have
     focus, preventDefault() stops the native click, so it only turns once. */
  function handleKeydown(event) {
    if (event.repeat) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (el.panel.hidden || !el.summary.hidden) return;
    if (!isActive()) return;
    if (event.target.matches('input, textarea')) return;

    if (event.key === 'Escape') {
      // The mobile nav drawer owns Escape while it is open, and it is over
      // the top of this panel.
      if (document.querySelector('.site-nav.is-open')) return;
      event.preventDefault();
      endRound();
      return;
    }

    if (state.answered) {
      if (event.key === 'Enter' && !el.continueButton.hidden) {
        event.preventDefault();
        advance();
      }
      return;
    }

    if (state.mode === 'choose') {
      const index = Number(event.key) - 1;
      if (index >= 0 && index < el.options.children.length) {
        event.preventDefault();
        el.options.children[index].click();
      }
      return;
    }

    if (!state.flipped) {
      if (event.code === 'Space' || event.key === 'Enter') {
        event.preventDefault();
        flip();
      }
      return;
    }

    if (event.key === '1') {
      event.preventDefault();
      el.missButton.click();
    } else if (event.key === '2') {
      event.preventDefault();
      el.knewButton.click();
    }
  }

  document.addEventListener('keydown', handleKeydown);

  return {
    element: el.panel,
    run,
    close,
    get missedCount() { return state.missed.length; },
  };
}

/* -- Mode picker -------------------------------------------------------------------------
   The row of study modes shown before a round starts. Lives here rather
   than in each caller so Review and Lessons offer the same two modes with
   the same labels and the same explanation underneath.
   -------------------------------------------------------------------------------------------- */

/* Both the Review view and the Lessons view build one of these, and both
   live in the document at once (views are hidden, not removed). The label's
   id has to be unique per instance or the second group's aria-labelledby
   points at the first one's label — and duplicate ids are invalid markup
   regardless of who notices. */
let modePickerCount = 0;

function createModePicker(initialMode, onChange) {
  const labelId = `quiz-mode-label-${(modePickerCount += 1)}`;

  const wrap = document.createElement('div');
  wrap.className = 'quiz-modes';

  const label = document.createElement('p');
  label.className = 'quiz-modes__label';
  label.id = labelId;
  label.textContent = 'Хэрхэн сурмаар байна?';

  const group = document.createElement('div');
  group.className = 'quiz-modes__group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', labelId);

  const hint = document.createElement('p');
  hint.className = 'quiz-modes__hint meta';

  let current = MODES.some((m) => m.id === initialMode) ? initialMode : 'choose';

  const buttons = MODES.map((mode) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip quiz-modes__button';
    button.dataset.mode = mode.id;
    button.textContent = mode.label;
    button.addEventListener('click', () => {
      current = mode.id;
      sync();
      onChange(mode.id);
    });
    group.append(button);
    return button;
  });

  function sync() {
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === current));
    }
    hint.textContent = MODES.find((mode) => mode.id === current).hint;
  }

  sync();
  wrap.append(label, group, hint);

  return { wrap, get mode() { return current; } };
}

export {
  createQuiz,
  createModePicker,
  ADAPTERS,
  MODES,
  deckKeyForItemId,
  adapterFor,
  buildQuestion,
  supportedTypes,
};
