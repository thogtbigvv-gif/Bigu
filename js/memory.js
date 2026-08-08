/* ==========================================================================
   memory.js
   Renders the #memory view — the app's answer to "what is actually in my
   head right now, and what is slipping out of it?"

   What this replaces, and why
   ---------------------------
   Progress used to be told as a completion story: a "Mark as learned" chip
   on every card, a "Hide learned" filter, and four learned/total bars on the
   Dashboard. Three problems with that, in rising order of seriousness.

   1. It was a checklist. A ticked box is a finished thing, and the one claim
      a language app must never make is that a word is finished. Every ticked
      word was quietly decaying and the interface said nothing.
   2. It was flat. 214/802 is a true sentence about a database and an empty
      one about a person. It gives a learner nothing to feel and nothing to
      do.
   3. It pointed backwards. Everything on the screen described work already
      done, so the reader had to decide, unaided and daily, what to do next —
      which is exactly the decision a study system exists to make for them.

   This view inverts all three. Nothing here is a total; everything is a
   *state right now*, and every state is an invitation. The organising idea
   is ink on paper: meeting a word writes it, ink fades on its own, and
   recalling it darkens it again. That metaphor is load-bearing rather than
   decorative — it is the forgetting curve (review.js's strengthOf) drawn as
   something a person can look at, and it makes decay feel like weather
   rather than like failure. You cannot fail at ink fading. You can only come
   back to it.

   The shelves are the second half of the idea. A single sorted list of due
   items is a queue, and a queue is a chore; the same items split into
   *kinds* of memory — faint, waiting, newly met, hard to hold, kept, deep —
   let a reader recognise their own learning in the page. Each shelf is
   small, capped, and skippable, so the page stays a place to visit rather
   than a debt to clear.

   Grading happens in place. A slip turns over, the reader answers, the ink
   moves, and the slip settles away. There is no session to enter or finish,
   because the habit this view is trying to build is "look at this for a
   minute", not "complete a task".
   ========================================================================== */

import {
  bandFor,
  describeTiming,
  FAINT_STRENGTH,
  grade as gradeItem,
  snapshotRecords,
  strengthOf,
} from './review.js';
import { createFavoriteButton, favoriteIds } from './favorites.js';
import { createIcon, getViewContainer, loadIntoView, OFFLINE_HINT } from './content.js';
import { practice } from './storage.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';
import { loadLessons } from './lessons.js';

const VIEW_ID = 'memory';

/* Eight slips per shelf. Enough that a shelf reads as a handful of real
   things, few enough that no shelf can become the wall of rows this view
   exists to get rid of — the rest are named in a quiet "+ n more" line
   rather than rendered. */
const SHELF_LIMIT = 6;

const DAY = 86400000;

/* A word counts as newly met for a week. Long enough to still be there on
   the reader's next few visits, short enough that "newly met" never becomes
   a synonym for "everything". */
const NEWLY_MET_DAYS = 7;

/* -- Item shapes ---------------------------------------------------------------------
   Four datasets, four field vocabularies, one slip. Each adapter answers the
   same four questions so the rest of the file never has to know which deck
   an item came from.
   -------------------------------------------------------------------------------------- */

function describeItem(item) {
  if (item.character) {
    return {
      kind: 'Kanji',
      jp: item.character,
      reading: [item.onyomi, item.kunyomi].filter(Boolean).join(' ・ '),
      meaning: item.meaning,
      example: item.example
        ? { jp: item.example.word, reading: item.example.reading, mn: item.example.mn }
        : null,
    };
  }

  if (item.pattern) {
    return {
      kind: 'Grammar',
      jp: `〜${item.pattern}`,
      reading: item.patternKana ?? '',
      meaning: item.meaning,
      example: item.example ?? null,
    };
  }

  if (item.kana) {
    return {
      kind: 'Vocabulary',
      jp: item.kanji || item.kana,
      reading: item.kanji ? item.kana : '',
      meaning: item.meaning,
      example: item.example ?? null,
    };
  }

  return {
    kind: 'Lesson',
    jp: item.word,
    reading: item.word === item.reading ? '' : item.reading,
    meaning: item.english,
    example: null,
  };
}

/* -- Shelves ---------------------------------------------------------------------------
   Each shelf is a state of memory, not a category of content — a reader's
   day is not split by which JSON file a word lives in, so neither is this
   page.

   Order is deliberate and is the argument the page makes: what's ready
   first, what's slipping second, then the two shelves that are about
   *feeling* rather than duty (what you just met, what you chose to keep),
   with the long-term holdings last. A reader who only ever reads the top of
   this page still does the right thing.

   `jp` is not decoration either: pairing the English label with the
   Japanese one puts a reader in contact with the language on a screen that
   would otherwise be entirely about English UI copy.
   -------------------------------------------------------------------------------------- */

const SHELVES = [
  {
    key: 'waiting',
    label: 'Waiting for you',
    jp: '待っている',
    note: 'Эргэж ирэхэд бэлэн. Бэх нь уншигдсаар байна — одоо нэг харвал ийм хэвээр үлдэнэ.',
    empty: 'Одоогоор хүлээж буй юм алга.',
    icon: [['circle', { cx: '8', cy: '8', r: '5.5' }], ['path', { d: 'M8 5v3.2l2 1.4' }]],
  },
  {
    key: 'fading',
    label: 'Fading',
    jp: '薄れゆく',
    note: 'Эдгээр нь бүдгэрчээ. Энд нэг минут зарцуулах нь шинэ үг цээжлэх нэг цагтай дүйнэ.',
    empty: 'Бүдгэрсэн юм алга. Ховор тохиолдол, анзаарах нь зүйтэй.',
    // Three strokes losing their length, left to right: the shelf's own
    // subject drawn in the page's own visual language.
    icon: [['path', { d: 'M3 2.5v11' }], ['path', { d: 'M8 5.5v8' }], ['path', { d: 'M13 9v4.5' }]],
  },
  {
    key: 'newlyMet',
    label: 'Newly met',
    jp: 'はじめまして',
    note: 'Сүүлийн долоо хоногийнх. Одоо ч танихгүй хэвээр — удахгүй чамайг дахин хэрэгтэй болно.',
    empty: 'Энэ долоо хоногт шинэ юмтай танилцаагүй байна.',
    icon: [['path', { d: 'M8 13.5V6' }], ['path', { d: 'M8 6C6 6 4.5 4.5 4.5 2.5 6.5 2.5 8 4 8 6z' }], ['path', { d: 'M8 7.5c0-1.8 1.4-3 3.2-3 0 1.8-1.4 3-3.2 3z' }]],
  },
  {
    key: 'hardToHold',
    label: 'Hard to hold',
    jp: '手ごわい',
    note: 'Байнга мултарч байгаа нь. Буруу юм алга — зүгээр л богино завсартай давтах хэрэгтэй.',
    empty: 'Одоогоор чамтай зүтгэлдэж байгаа юм алга.',
    icon: [['path', { d: 'M2.5 6.5c1.8-2 3.6-2 5.5 0s3.7 2 5.5 0' }], ['path', { d: 'M2.5 10.5c1.8-2 3.6-2 5.5 0s3.7 2 5.5 0' }]],
  },
  {
    key: 'kept',
    label: 'Kept',
    jp: '大切',
    note: 'Чиний өөрөө сонгосон нь. Давтах цаг нь болсон учраас биш — чамд таалагдсан учраас.',
    empty: 'Хадгалсан юм хараахан алга. Аль ч картын хавчуургыг дарвал энд орно.',
    icon: [['path', { d: 'M4 2.5h8v11l-4-3-4 3z' }]],
  },
  {
    key: 'deepInk',
    label: 'Deep ink',
    jp: '深い',
    note: 'Долоо хоногоор тогтсон нь. Одоо ховорхон эргэж ирнэ — зөвхөн бараан хэвээр үлдэхийн тулд.',
    empty: 'Хараахан ийм гүнд хүрсэн юм алга. Санаатайгаар долоо хоногууд шаарддаг.',
    icon: [['path', { d: 'M8 2.5c2.6 3 4 5 4 6.6a4 4 0 0 1-8 0c0-1.6 1.4-3.6 4-6.6z' }]],
  },
];

/* One item, one shelf — except Kept, which the reader curated by hand and
   which therefore outranks nothing and duplicates freely. A word can be both
   faint and kept, and hiding it from the shelf the reader built themselves
   because the schedule also wants it would be the app overruling a
   deliberate choice.

   The automatic shelves are exclusive in this priority order, so the same
   word never appears twice in the derived half of the page and the most
   urgent reading of it always wins. */
function assignShelves(entries, now) {
  const buckets = { waiting: [], fading: [], newlyMet: [], hardToHold: [], kept: [], deepInk: [] };

  for (const entry of entries) {
    const { record, strength } = entry;

    if (entry.kept) buckets.kept.push(entry);

    if (!record.seen) continue;

    const due = record.dueAt <= now;

    // The same line review.js draws its bottom band on, so a slip on the
    // Fading shelf always reads "faint" and no slip anywhere else ever does.
    if (due && strength < FAINT_STRENGTH) buckets.fading.push(entry);
    else if (due) buckets.waiting.push(entry);
    else if (record.lapses >= 2) buckets.hardToHold.push(entry);
    else if (record.firstSeen && now - record.firstSeen <= NEWLY_MET_DAYS * DAY) buckets.newlyMet.push(entry);
    else if (record.level >= 4) buckets.deepInk.push(entry);
  }

  // Faintest first where the point is rescue, freshest first where the point
  // is momentum, and strongest first on Deep ink so the shelf opens on the
  // reader's best work.
  buckets.fading.sort((a, b) => a.strength - b.strength);
  buckets.waiting.sort((a, b) => a.record.dueAt - b.record.dueAt);
  buckets.newlyMet.sort((a, b) => b.record.firstSeen - a.record.firstSeen);
  buckets.hardToHold.sort((a, b) => b.record.lapses - a.record.lapses);
  buckets.deepInk.sort((a, b) => b.strength - a.strength);
  buckets.kept.sort((a, b) => a.strength - b.strength);

  return buckets;
}

/* -- The week ---------------------------------------------------------------------------
   Seven marks, one per day, sized by how much came back to the reader that
   day. Not a chart: there is no axis, no gridline and no number on it,
   because the question it answers is "have I been here?" and that question
   is answered by a shape.

   It counts recall specifically — items graded, sessions finished — where
   the Dashboard's streak deliberately counts three different kinds of study.
   Two different numbers on purpose: the Dashboard asks whether the habit is
   alive, this asks whether memory is being maintained, and conflating them
   would let a month of journal entries hide a month of no review at all.
   -------------------------------------------------------------------------------------- */

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function collectReviewDays(records) {
  const days = new Map();

  function add(key, count) {
    days.set(key, (days.get(key) ?? 0) + count);
  }

  for (const record of records.values()) {
    if (record.lastSeen) add(toDateKey(new Date(record.lastSeen)), 1);
  }
  for (const session of practice.getAll()) {
    if (session.createdAt) add(toDateKey(new Date(session.createdAt)), 0);
  }

  return days;
}

function computeReviewStreak(days) {
  const cursor = new Date();
  if (!days.has(toDateKey(cursor))) cursor.setDate(cursor.getDate() - 1);

  let streak = 0;
  while (days.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat('en', { weekday: 'short' });
const WEEKDAY_INITIAL = new Intl.DateTimeFormat('en', { weekday: 'narrow' });

function buildWeek(days) {
  const week = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const count = days.get(toDateKey(date)) ?? 0;
    week.push({
      date,
      count,
      isToday: offset === 0,
      initial: WEEKDAY_INITIAL.format(date),
      name: WEEKDAY_FORMATTER.format(date),
    });
  }
  return week;
}

/* -- Small builders --------------------------------------------------------------------- */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function japanese(tag, className, text) {
  const node = element(tag, className, text);
  node.lang = 'ja';
  return node;
}

/* -- The slip ----------------------------------------------------------------------------
   A 短冊 (tanzaku): a narrow strip of paper with one thing written on it.
   Deliberately not a card — no border, no shadow, no header row — because a
   card is a container for information and a slip is a single utterance. Six
   shelves of cards would be the dashboard this view is replacing.

   The one piece of chrome is the ink stroke down the left edge: its height
   and opacity are the item's memory strength, so a shelf can be read at a
   glance as a set of brush marks of different weights before a single word
   is read. That is the whole visual argument of the feature, and it costs
   two CSS custom properties.

   Closed, a slip shows the Japanese and its state. Open, it asks for recall
   *before* it shows the meaning — the turn-over step is not ceremony, it's
   the difference between recognition and retrieval, and retrieval is the
   thing that actually strengthens a memory. Showing the answer immediately
   would make the whole page feel productive and teach nothing.
   -------------------------------------------------------------------------------------- */

let openSlip = null;
let slipCounter = 0;

function createSlip(entry, onGraded, onKeptChange) {
  const { item, record, strength } = entry;
  const shape = describeItem(item);
  const band = bandFor(strength);

  const slip = document.createElement('li');
  slip.className = 'memory-slip';
  // A word can reach the Kept shelf without ever having been studied, and
  // such an item has no schedule to describe — "faint, 20672 days late" is
  // what the epoch looks like when it's read as a due date. It gets its own
  // band instead: an outlined stroke and an invitation.
  slip.dataset.band = record.seen ? band.key : 'unmet';
  slip.style.setProperty('--strength', record.seen ? strength.toFixed(3) : '0');

  const detailId = `memory-slip-detail-${(slipCounter += 1)}`;

  /* -- Face -- */
  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'memory-slip__face';
  face.setAttribute('aria-expanded', 'false');
  face.setAttribute('aria-controls', detailId);

  const ink = element('span', 'memory-slip__ink');
  ink.setAttribute('aria-hidden', 'true');

  const body = element('span', 'memory-slip__body');
  const word = japanese('span', 'memory-slip__word', shape.jp);
  // Grammar patterns run long — 〜わけにはいかない at headword size wraps to
  // three lines and makes one slip twice the height of its neighbours. A
  // step down the type scale keeps the shelf's rhythm; the word is still the
  // largest thing on its own slip, which is all the size was buying.
  if (shape.jp.length > 8) word.classList.add('memory-slip__word--long');
  body.append(word);
  if (shape.reading) body.append(japanese('span', 'memory-slip__reading', shape.reading));

  const state = element('span', 'memory-slip__state');
  state.textContent = record.seen ? `${band.label} · ${describeTiming(record)}` : 'хараахан судлаагүй';

  face.append(ink, body, state);

  /* -- Detail -- */
  const detail = element('div', 'memory-slip__detail');
  detail.id = detailId;
  detail.hidden = true;

  const turn = document.createElement('button');
  turn.type = 'button';
  turn.className = 'button button--secondary memory-slip__turn';
  turn.textContent = 'Turn it over';

  const answer = element('div', 'memory-slip__answer');
  answer.hidden = true;
  answer.append(element('p', 'memory-slip__meaning', shape.meaning));

  if (shape.example) {
    const example = element('div', 'memory-slip__example');
    example.append(japanese('p', null, shape.example.jp));
    if (shape.example.reading) example.append(japanese('p', 'reading', shape.example.reading));
    if (shape.example.mn) example.append(element('p', 'meta', shape.example.mn));
    answer.append(example);
  }

  const actions = element('div', 'memory-slip__actions');
  actions.hidden = true;

  const missed = document.createElement('button');
  missed.type = 'button';
  missed.className = 'button button--secondary';
  missed.textContent = 'Not yet';

  const knew = document.createElement('button');
  knew.type = 'button';
  knew.className = 'button button--primary';
  knew.textContent = 'I remember';

  actions.append(missed, knew);

  const note = element('p', 'memory-slip__note');
  note.setAttribute('aria-live', 'polite');

  const foot = element('div', 'memory-slip__foot');
  foot.append(element('span', 'memory-slip__kind', shape.kind), createFavoriteButton(item.id, onKeptChange));

  detail.append(turn, answer, actions, note, foot);
  slip.append(face, detail);

  /* -- Behaviour -- */

  function close() {
    slip.classList.remove('is-open');
    face.setAttribute('aria-expanded', 'false');
    detail.hidden = true;
    if (openSlip === slip) openSlip = null;
  }

  // One slip open at a time. Several open slips turn the shelf back into a
  // list of expanded rows, and the calm of this page is mostly the calm of
  // one thing happening at once.
  function open() {
    if (openSlip && openSlip !== slip) openSlip.dispatchEvent(new CustomEvent('memory:close'));
    slip.classList.add('is-open');
    face.setAttribute('aria-expanded', 'true');
    detail.hidden = false;
    openSlip = slip;
  }

  slip.addEventListener('memory:close', close);

  face.addEventListener('click', () => {
    if (slip.classList.contains('is-open')) close();
    else open();
  });

  turn.addEventListener('click', () => {
    answer.hidden = false;
    actions.hidden = false;
    turn.hidden = true;
    knew.focus();
  });

  function settle(knewIt) {
    const next = gradeItem(item.id, knewIt);
    const nextStrength = strengthOf(next);

    // The ink moves first and the slip leaves second, in that order and
    // visibly: the reader should see what their answer did to the memory
    // before the memory goes away. A slip that vanished on click would make
    // grading feel like dismissing a notification.
    slip.style.setProperty('--strength', nextStrength.toFixed(3));
    slip.dataset.band = bandFor(nextStrength).key;
    slip.classList.add('is-graded');

    note.textContent = knewIt
      ? `Улам бараан боллоо. ${describeTiming(next)}.`
      : 'Тэмдэглэлээ — энэ өнөөдөр эргэж ирнэ.';

    actions.hidden = true;

    window.setTimeout(() => {
      slip.classList.add('is-settling');
      window.setTimeout(() => {
        close();
        onGraded(slip, knewIt);
      }, 360);
    }, 900);
  }

  missed.addEventListener('click', () => settle(false));
  knew.addEventListener('click', () => settle(true));

  return slip;
}

/* -- Shelf ------------------------------------------------------------------------------- */

function createShelf(definition, entries, handlers) {
  const section = element('section', 'memory-shelf');
  section.dataset.shelf = definition.key;

  const head = element('div', 'memory-shelf__head');

  const title = element('h2', 'memory-shelf__title');
  title.append(
    createIcon('memory-shelf__icon', definition.icon),
    element('span', null, definition.label),
    japanese('span', 'memory-shelf__jp', definition.jp),
  );

  // How full the shelf is, beside its name. The cap is what keeps this page
  // from becoming the wall of rows it replaced, but a capped shelf that
  // doesn't say so is a shelf that quietly under-reports — a reader with 36
  // words waiting saw six and no number.
  if (entries.length > 0) {
    title.append(element('span', 'memory-shelf__count', String(entries.length)));
  }

  head.append(title, element('p', 'memory-shelf__note', definition.note));

  const list = element('ul', 'memory-shelf__slips');

  /* One page of slips at a time. The rest used to be named in a dead line —
     "+ 30 more on this shelf" — which told the reader something existed and
     gave them no way to reach it; the only route to those 30 words was to
     grade the six on screen and reload the page. They come in a page at a
     time now, which keeps the shelf a handful of real things by default and
     still lets a reader who wants the whole shelf have it. */
  let shown = 0;

  function appendPage() {
    const next = entries.slice(shown, shown + SHELF_LIMIT);
    next.forEach((entry, index) => {
      const slip = createSlip(entry, handlers.onGraded, handlers.onKeptChange);
      // Staggered entrance, 40ms apart — the shelf writes itself onto the
      // page left to right the way a hand would, rather than all at once.
      slip.style.setProperty('--index', String(index));
      list.append(slip);
    });
    shown += next.length;
    syncMore();
  }

  const emptyNote = element('p', 'memory-shelf__empty', definition.empty);
  emptyNote.hidden = entries.length > 0;

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'memory-shelf__more';

  function syncMore() {
    const remaining = entries.length - shown;
    more.hidden = remaining <= 0;
    more.textContent = `Show ${Math.min(remaining, SHELF_LIMIT)} more · ${remaining} left on this shelf`;
  }

  more.addEventListener('click', appendPage);

  section.append(head, list, emptyNote, more);
  appendPage();

  return { section, list, emptyNote };
}

/* -- Hero -------------------------------------------------------------------------------
   One sentence, at heading scale, in the display face. This is the only
   prose line in the app treated that way, and it earns it: it is the answer
   to the question the reader opened the page with, and everything below it
   is detail. A number in a stat tile cannot do that job — "12" needs a label
   to mean anything, where "12 words are waiting for you" is already a
   thought.

   Second person throughout, present tense, no exclamation marks, no
   congratulation. The page is a room the reader walks into, not a coach.
   -------------------------------------------------------------------------------------- */

function heroLines({ waiting, fading, seenCount }) {
  const due = waiting + fading;

  if (due === 0) {
    return {
      line: 'Өнөөдөр бүдгэрч буй юм алга.',
      sub: seenCount > 0
        ? 'Бэх нь бүхэлдээ бараан байна. Амрах нь ч бас цээжлэхийн нэг хэсэг.'
        : 'Хэдэн үгтэй танилцвал эндээс харагдаж эхэлнэ.',
    };
  }

  const line = `${due} үг чамайг хүлээж байна.`;

  if (fading === 0) return { line, sub: 'Тэдний нэг нь ч хараахан бүдгэрээгүй. Хэдхэн минут л ийм хэвээр байлгана.' };
  if (fading === due) return { line, sub: 'Бүгд нь бүдгэрчээ. Эндээс эхэлбэл үлдсэн нь амархан.' };
  return { line, sub: `${fading} нь бүдгэрчээ — эхлээд тэднийг.` };
}

function createHero(summary) {
  const hero = element('header', 'memory-hero');
  const { line, sub } = heroLines(summary);

  hero.append(
    element('p', 'memory-hero__kicker', 'Today'),
    element('p', 'memory-hero__line', line),
    element('p', 'memory-hero__sub', sub),
  );

  /* The wash: one brush stroke across the page whose length is the average
     strength of everything the reader holds, drying out at its right end.
     Deliberately unlabelled by a percentage — the number would invite
     optimisation of the number, and this is a mood, not a score. The exact
     value is still available to a screen reader, where a shape isn't. */
  if (summary.seenCount > 0) {
    const wash = element('div', 'memory-hero__wash');
    wash.setAttribute('role', 'img');
    wash.setAttribute(
      'aria-label',
      `Таны танилцсан ${summary.seenCount} зүйлийн санамжийн дундаж хүч: ${Math.round(summary.averageStrength * 100)} хувь.`,
    );
    const stroke = element('span', 'memory-hero__stroke');
    stroke.setAttribute('aria-hidden', 'true');
    stroke.style.setProperty('--strength', summary.averageStrength.toFixed(3));
    wash.append(stroke);

    const band = bandFor(summary.averageStrength);
    hero.append(
      wash,
      element(
        'p',
        'memory-hero__wash-note',
        `Одоогоор ${summary.seenCount} үг бичигдсэн — бэх нь ${band.label} байна.`,
      ),
    );
  }

  const cta = document.createElement('a');
  cta.href = '#practice';
  cta.className = `button ${summary.waiting + summary.fading > 0 ? 'button--primary' : 'button--secondary'} memory-hero__cta`;
  cta.textContent = summary.waiting + summary.fading > 0 ? 'Review them together' : 'Review early';
  hero.append(cta);

  return hero;
}

/* -- Week strip -------------------------------------------------------------------------- */

function createWeek(week, streak) {
  const section = element('section', 'memory-week');

  const title = element('h2', 'memory-week__title');
  title.append(element('span', null, 'This week'), japanese('span', 'memory-week__jp', '今週'));

  const list = element('ul', 'memory-week__days');
  // Ten items in a day is a full visit; past that the mark is simply "full",
  // because the difference between 40 and 80 is not something a reader needs
  // to compare across days.
  const busiest = Math.max(10, ...week.map((day) => day.count));

  for (const day of week) {
    const cell = element('li', 'memory-week__day');
    if (day.isToday) cell.classList.add('is-today');

    const dot = element('span', 'memory-week__dot');
    dot.setAttribute('aria-hidden', 'true');
    if (day.count === 0) dot.classList.add('memory-week__dot--empty');
    // A day with anything on it never renders lighter than a quarter: the
    // distinction that matters most here is came-back versus didn't, and a
    // three-item day fading to nothing beside a fifty-item one erases it.
    dot.style.setProperty('--weight', (day.count === 0 ? 0 : Math.max(0.25, day.count / busiest)).toFixed(3));

    const initial = element('span', 'memory-week__initial', day.initial);
    initial.setAttribute('aria-hidden', 'true');

    const reader = element('span', 'sr-only', `${day.name}: ${day.count === 0 ? 'юу ч давтаагүй' : `${day.count} зүйл давтсан`}`);

    cell.append(dot, initial, reader);
    list.append(cell);
  }

  const note = element('p', 'memory-week__note');
  if (streak === 0) {
    note.textContent = 'Одоогоор цуваа алга. Өнөөдөр нэг үг л шинээр эхлүүлнэ.';
  } else {
    note.append(
      element('span', 'memory-week__streak', String(streak)),
      document.createTextNode(' өдөр дараалан.'),
    );
  }

  section.append(title, list, note);
  return section;
}

/* -- Empty state ---------------------------------------------------------------------------
   Not "no data". A first-time reader is shown what the page is *for*, in the
   metaphor it runs on, with one door out of it — and the 墨 (sumi, ink)
   character does the work an illustration would, in the app's own subject
   matter.
   ------------------------------------------------------------------------------------------ */

function createEmptyState() {
  const empty = element('div', 'memory-empty');

  const mark = japanese('p', 'memory-empty__mark', '墨');
  mark.setAttribute('aria-hidden', 'true');

  empty.append(
    mark,
    element('p', 'memory-empty__line', 'Хараахан юу ч бичигдээгүй байна.'),
    element(
      'p',
      'memory-empty__body',
      'Танилцсан үг бүр чинь энд бэхээр бичигдэнэ. Бэх нь өөрөө бүдгэрдэг — эргэж ирэх бүрд дахин барааждаг. Бүх учир нь тэр.',
    ),
  );

  const cta = document.createElement('a');
  cta.href = '#lessons';
  cta.className = 'button button--primary';
  cta.textContent = 'Meet your first words';
  empty.append(cta);

  return empty;
}

/* -- Rendering ------------------------------------------------------------------------- */

/* Stands in for "this item has no progress record at all" — used for a word
   the reader kept but never studied, which still deserves a slip on the Kept
   shelf. Frozen because every such item shares this one object. */
const UNMET_RECORD = Object.freeze({
  seen: false,
  remembered: false,
  level: 0,
  lastSeen: 0,
  dueAt: 0,
  firstSeen: 0,
  reviews: 0,
  lapses: 0,
});

function collectEntries(datasets, now) {
  const [vocabData, grammarData, kanjiData, lessonData] = datasets;
  const items = [
    ...lessonData.flatMap((lesson) => lesson.words),
    ...vocabData.words,
    ...grammarData.points,
    ...kanjiData.kanji,
  ];

  const records = snapshotRecords();
  const kept = favoriteIds();
  const entries = [];

  let strengthTotal = 0;
  let seenCount = 0;

  for (const item of items) {
    const isKept = kept.has(item.id);
    const record = records.get(item.id) ?? UNMET_RECORD;
    // Everything the reader has touched, plus anything they kept without
    // studying it. The rest of the catalogue — hundreds of words never met —
    // is not this page's subject and never appears on it.
    if (!record.seen && !isKept) continue;

    const strength = strengthOf(record, now);

    if (record.seen) {
      strengthTotal += strength;
      seenCount += 1;
    }

    entries.push({ item, record, strength, kept: isKept });
  }

  return { entries, records, seenCount, averageStrength: seenCount === 0 ? 0 : strengthTotal / seenCount };
}

function renderMemory(container, datasets) {
  const now = Date.now();
  const { entries, records, seenCount, averageStrength } = collectEntries(datasets, now);

  if (entries.length === 0) {
    container.replaceChildren(createEmptyState());
    return;
  }

  const buckets = assignShelves(entries, now);

  const hero = createHero({
    waiting: buckets.waiting.length,
    fading: buckets.fading.length,
    seenCount,
    averageStrength,
  });

  const days = collectReviewDays(records);
  const week = createWeek(buildWeek(days), computeReviewStreak(days));

  /* The hero and the week share one row above 900px — see .memory-top in
     css/memory.css for why. Below that the wrapper is inert and the two
     simply stack, exactly as they did. */
  const top = element('div', 'memory-top');
  top.append(hero, week);

  const shelvesWrap = element('div', 'memory-shelves');

  /* Only shelves with something on them. An empty shelf is a promise the
     page can't keep and a row of them is a filing cabinet — the two failures
     this view was built to undo. The exception is a shelf that empties
     *during* the visit, which keeps its place and says so, because a thing
     disappearing entirely as you finish it is disorienting. */
  const handlers = {
    onGraded: (slip) => {
      const list = slip.parentElement;
      const shelf = slip.closest('.memory-shelf');
      slip.remove();
      if (!list || list.children.length > 0 || !shelf) return;

      const emptyNote = shelf.querySelector('.memory-shelf__empty');
      if (!emptyNote) return;
      emptyNote.textContent = 'Өнөөдрийнх нь дууслаа. Хэрэгтэй болохоороо эргэж ирнэ.';
      emptyNote.hidden = false;
    },
    // Keeping or un-keeping only matters to the Kept shelf, and moving a
    // slip in or out from under the reader's finger would be worse than
    // letting the shelf catch up on the next visit.
    onKeptChange: () => {},
  };

  for (const definition of SHELVES) {
    const shelfEntries = buckets[definition.key];
    if (shelfEntries.length === 0) continue;
    shelvesWrap.append(createShelf(definition, shelfEntries, handlers).section);
  }

  container.replaceChildren(top, shelvesWrap);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initMemory() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getViewContainer(view, 'memory-content');

  function render() {
    openSlip = null;
    return loadIntoView(content, {
      skeleton: 'memory',
      load: () => Promise.all([loadVocabulary(), loadGrammar(), loadKanji(), loadLessons()]),
      render: renderMemory,
      errorTitle: 'Memory ачаалагдсангүй.',
      errorDetail: `Энэ хуудас таны хадгалсан ахиц юуг заасныг мэдэхийн тулд data/ доторх дөрвөн агуулгын файлыг уншдаг бөгөөд тэдгээрийн ядаж нэг нь ирсэнгүй. ${OFFLINE_HINT}`,
    });
  }

  await render();

  // Strength decays with the clock and changes with every grade made
  // anywhere else in the app, so this page is rebuilt on the way back in
  // rather than showing whatever was true when it first rendered. Anything
  // else would make the one screen about decay the one screen that's stale.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) === VIEW_ID) render();
  });
}

export { initMemory };
