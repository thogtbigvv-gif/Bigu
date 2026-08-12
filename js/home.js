/* ==========================================================================
   home.js
   The #home view — the first room of the app, and the one the reader opens
   Bigu into.

   Home is the learning layer and only the learning layer. Progression — XP,
   levels, ranks, skill percentages, missions — belongs to the separate
   summer-project surface, which reads this app's activity out of the
   `bigu:bridge` key written by js/bridge.js. Nothing here counts, awards or
   displays any of it. Home's one question is "what can I learn right now?",
   and everything on the screen is an answer to it.

   What that means in practice, top to bottom:

     今日の日本語   one real line of Japanese from data/, with an item behind
                    it. Tap it and it opens onto its reading, its meaning,
                    and the word or pattern it came from — the vocabulary or
                    the grammar hint, taken straight from the same adapters
                    the quiz uses so the reader meets it described the same
                    way in both places.

     これを練習する  the primary action, and a real one. It runs a short round
                    in the app's own quiz — the same js/quiz.js panel Review
                    and Lessons run, the same grading into review.js's
                    schedule — seeded with today's item and topped up by
                    buildSession(). When it ends it is logged through
                    practice.js's recordSession(), which is the one path that
                    writes the practice store and republishes the id on the
                    bridge. A round finished here is a round, indistinguishable
                    downstream from one finished on the Review screen.

     続きから / 復習 two quiet lines into the existing flows, rendered only
                    when there is something true to say.

     学ぶ           the study shelf: six text links into the views that
                    already exist. Not a second navigation and not a grid of
                    cards — the sidebar is still the map, this is the desk.

   Nothing here is stored. The lesson to continue comes from the progress
   records review.js already keeps; whether anything is waiting is countDue()
   over the pool the Review deck draws from; whether the reader has finished
   something today is read off the practice store's own timestamps. No new
   key, no new schema, no second progress model.
   ========================================================================== */

import { journal, practice as practiceStore } from './storage.js';
import { buildSession, countDue, snapshotRecords } from './review.js';
import { ADAPTERS, createQuiz, deckKeyForItemId, furigana } from './quiz.js';
import { loadReviewPool, recordSession } from './practice.js';
import { getViewContainer } from './content.js';

const VIEW_ID = 'home';

/* Three cards. Not sessionSize() — that preference is about how long a
   *review session* should be, and this is explicitly not one: the whole
   promise of the button is that it costs a moment, and a reader who set
   their rounds to twenty would find "practise this" was the longest thing
   on the screen. Short enough to do while standing up is the feature. */
const QUICK_ROUND = 3;

/* Choose, always. Flip asks the reader to grade themselves, which needs
   material they already half-know; the one thing Home can't assume about
   somebody who just opened the app is which half of the catalogue that is.
   Four options and instant checking is answerable from a standing start,
   which is the same reason Lessons defaults to it. Deliberately not written
   to the shared `quizMode` setting — a round taken here should not silently
   change how the Review screen behaves next time. */
const QUICK_MODE = 'choose';

/* The deck a Home round is logged under, and it is an existing one on
   purpose. A quick round is buildSession() over the whole pool, due items
   first — which is precisely what the Review view's "Due today" deck is, so
   this is a true description rather than a convenient one. Minting a 'home'
   value instead would put an unknown string into the `mode` field of the
   `bigu:bridge` session contract that summer-project already consumes, and
   into DECK_LABELS' fallback path on the Dashboard and the Review history.
   The bridge contract is not ours to widen from here. */
const QUICK_DECK = 'due';

/* -- The hour ------------------------------------------------------------------------
   Four bands, named the way a room is named rather than the way a clock is
   read. Ordered by their start hour and scanned in order, so the last band
   whose `from` has passed is the current one — which leaves the small hours
   (00:00–04:59) with the initial value, 夜, without needing a wrapping case.
   ------------------------------------------------------------------------------------ */

const HOURS = [
  { from: 5, jp: '朝', reading: 'あさ' },
  { from: 11, jp: '昼', reading: 'ひる' },
  { from: 17, jp: '夕', reading: 'ゆう' },
  { from: 20, jp: '夜', reading: 'よる' },
];

function hourMark(now = new Date()) {
  const hour = now.getHours();
  let mark = HOURS[HOURS.length - 1];
  for (const band of HOURS) {
    if (hour >= band.from) mark = band;
  }
  return mark;
}

/* -- The study shelf ------------------------------------------------------------------
   Six doors into views that already exist, in the order the sidebar groups
   them. It is not a copy of the navigation: the sidebar is the map of the
   app and is always there, where this is the row of tools on the desk the
   reader is already sitting at. Same labels as the nav rows deliberately —
   one name per destination, or the app has two vocabularies for the same
   six things.
   ------------------------------------------------------------------------------------ */

const SHELF = [
  { href: '#lessons', label: 'Lessons' },
  { href: '#vocabulary', label: 'Vocabulary' },
  { href: '#grammar', label: 'Grammar' },
  { href: '#kanji', label: 'Kanji' },
  { href: '#reading', label: 'Reading' },
  { href: '#practice', label: 'Review' },
];

/* -- Today's line ---------------------------------------------------------------------
   Every candidate is a row that already exists in data/ *and* carries an id
   the schedule knows, which is what makes the primary action honest: "これを
   練習する" has to be able to actually practise this, and an item with no
   record to grade cannot be practised. That rules out reading passages,
   whose sentences are prose rather than catalogue entries — they stay one
   tap away on the shelf instead.

   Two shapes, because the furigana convention only applies to one of them. A
   lesson *word* carries its reading over itself as ruby (the same rule
   quiz.js and lessons.js use — no ruby when the word and its reading are the
   same string). A vocabulary or grammar entry leads with its own example
   *sentence*, and keeps its kana reading behind the tap: ruby over a whole
   sentence would be the file's full-sentence kana stacked on one line, which
   is not furigana.
   ------------------------------------------------------------------------------------ */

function collectLines({ lessonWords, vocabulary, grammar }) {
  const lines = [];

  for (const item of lessonWords) {
    if (item.word && item.english) lines.push({ item, kind: 'word' });
  }

  for (const source of [vocabulary, grammar]) {
    for (const item of source) {
      if (item.example?.jp && item.example.mn) lines.push({ item, kind: 'sentence' });
    }
  }

  return lines;
}

/* One line per day, the same one all day. A fresh random line on every
   navigation would make Home flicker between sentences as the reader moves
   around the app, and a line you can come back to is a line you might
   actually learn. The seed is the calendar date and nothing else — no stored
   cursor, no history, nothing to migrate. */
function lineForToday(lines, now = new Date()) {
  if (lines.length === 0) return null;
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return lines[seed % lines.length];
}

/* -- Dates and state already on the device -------------------------------------------- */

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* Whether anything was finished today — a yes or a no, never a count and
   never a run of days. It is the difference between "you have done your
   Japanese today" and a streak, and the difference matters: one is a
   remark, the other is a thing to protect. The count, the streak and the XP
   that come off the same records are summer-project's to draw. */
function studiedToday(sessions, now = new Date()) {
  const today = dateKey(now);
  return sessions.some((entry) => entry?.createdAt && dateKey(new Date(entry.createdAt)) === today);
}

/* Lesson word ids are l1-01, l2-14, … — the lesson number is in the id, and
   every graded or marked word already carries a `lastSeen`. The most
   recently touched lesson word is therefore the lesson to offer, recovered
   from records that exist rather than from a bookmark this module would have
   to write and keep correct. Null when the reader has never touched one, in
   which case the line is simply not rendered. */
const LESSON_ID = /^l(\d+)-/;

function lastLesson(records) {
  let best = null;

  for (const [itemId, record] of records) {
    const match = LESSON_ID.exec(itemId);
    if (!match || !record.lastSeen) continue;
    if (!best || record.lastSeen > best.lastSeen) {
      best = { lesson: Number(match[1]), lastSeen: record.lastSeen };
    }
  }

  return best ? best.lesson : null;
}

/* Nothing in any store, which is also true after a reader clears their data
   or opens the app in a second browser — both of which are, from the app's
   side, exactly a first visit. A flag would be wrong in all three cases. */
function isFirstVisit(records, sessions) {
  return records.size === 0 && journal.getAll().length === 0 && sessions.length === 0;
}

/* -- Small pieces ---------------------------------------------------------------------- */

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function createHourMark() {
  const mark = element('p', 'home__hour');
  mark.lang = 'ja';
  const { jp, reading } = hourMark();
  mark.append(furigana(jp, reading));
  return mark;
}

/* -- 今日の日本語 ------------------------------------------------------------------------
   The Japanese, its meaning behind it, and the entry it came from.

   The whole line is the control — on a phone that is the difference between
   a comfortable tap and aiming at a glyph — and the disclosure is the same
   aria-expanded/hidden pair reading.js uses for its sentences, so opening a
   gloss behaves identically in both places. The hint underneath erases
   itself once the reader has opened one, the same way reading.js's does:
   instruction text that outstays the instruction is the commonest kind of
   clutter there is.
   ------------------------------------------------------------------------------------ */

/* Where the line came from, revealed with its meaning.

   For a sentence that is the entry the sentence demonstrates, described by
   the adapter that owns it rather than by a second reading of the raw fields
   here: a vocabulary line names the word and its part of speech, a grammar
   line names the pattern and its structure — which is exactly the "useful
   vocabulary" and the "grammar hint" the sentence was chosen for.

   For a lesson word the line *is* the entry, so repeating it would be the
   same word twice. What that reader is missing instead is where the word
   sits in the course, so the block names its lesson. Both answer the same
   question — "what is this part of?" — which is why they are one block and
   not two.

   `lessons` is the authored lesson list off the pool; the number is read out
   of the word's own id (l7-03 → 7), which is the only place a flattened word
   still carries it. */
function createSource(line, lessons) {
  const { item, kind } = line;
  const wrap = element('div', 'home__source');

  if (kind === 'word') {
    const match = LESSON_ID.exec(item.id);
    const lesson = match && lessons.find((entry) => entry.lesson === Number(match[1]));
    if (!lesson) return null;

    wrap.append(element('p', 'home__source-meaning', `Lesson ${lesson.lesson}`));
    const title = element('p', 'home__source-jp', lesson.title);
    title.lang = 'ja';
    wrap.append(title);
    return wrap;
  }

  const adapter = ADAPTERS[deckKeyForItemId(item.id)];
  if (!adapter) return null;

  const head = element('p', 'home__source-jp');
  head.append(adapter.front(item));
  wrap.append(head, element('p', 'home__source-meaning', adapter.meaning(item)));

  const hint = adapter.hint(item);
  if (hint) wrap.append(element('p', 'home__source-hint meta', hint));

  return wrap;
}

function createToday(line, lessons) {
  const wrap = element('div', 'home__today');

  const glossId = 'home-today-gloss';
  const { item, kind } = line;
  const adapter = ADAPTERS[deckKeyForItemId(item.id)];

  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'home__face';
  face.setAttribute('aria-expanded', 'false');
  face.setAttribute('aria-controls', glossId);

  const jp = element('span', 'home__jp');
  jp.lang = 'ja';
  if (kind === 'word') jp.append(furigana(item.word, item.reading));
  else jp.textContent = item.example.jp;
  face.append(jp);

  const hint = element('p', 'home__hint', 'タップして意味を見る');
  hint.lang = 'ja';

  const gloss = element('div', 'home__gloss');
  gloss.id = glossId;
  gloss.hidden = true;

  if (kind === 'sentence' && item.example.reading) {
    const reading = element('p', 'reading home__reading', item.example.reading);
    reading.lang = 'ja';
    gloss.append(reading);
  }

  gloss.append(element('p', 'home__meaning', kind === 'word' ? adapter.meaning(item) : item.example.mn));

  const source = createSource(line, lessons);
  if (source) gloss.append(source);

  face.addEventListener('click', () => {
    // A drag that ended inside the button was a selection, not a press —
    // this is Japanese somebody might want to copy into a dictionary. Same
    // guard reading.js carries on its sentences, for the same reason.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && face.contains(selection.anchorNode)) return;

    const open = face.getAttribute('aria-expanded') === 'true';
    face.setAttribute('aria-expanded', String(!open));
    gloss.hidden = open;
    hint.hidden = !open;
  });

  wrap.append(face, hint, gloss);
  return wrap;
}

/* One row, Japanese first with a quiet gloss after it — `続きから · Lesson 18`.
   A link, not a card and not a button block: this is a door left ajar. */
function createWay(href, jp, note) {
  const way = document.createElement('a');
  way.className = 'home__way';
  way.href = href;

  const lead = element('span', 'home__way-jp', jp);
  lead.lang = 'ja';
  way.append(lead);

  if (note) {
    const separator = element('span', 'home__way-separator', '·');
    separator.setAttribute('aria-hidden', 'true');
    way.append(separator, element('span', 'home__way-note', note));
  }

  return way;
}

function createShelf() {
  const wrap = element('nav', 'home__shelf');
  wrap.setAttribute('aria-labelledby', 'home-shelf-heading');

  const heading = element('h2', 'home__section-heading', '学ぶ');
  heading.id = 'home-shelf-heading';
  heading.lang = 'ja';

  const list = element('ul', 'home__shelf-list');
  for (const { href, label } of SHELF) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'home__shelf-link';
    link.href = href;
    link.textContent = label;
    item.append(link);
    list.append(item);
  }

  wrap.append(heading, list);
  return wrap;
}

/* -- Rendering --------------------------------------------------------------------------
   The room is rebuilt on every render; the quiz panel beside it is built
   once and never thrown away, because it is a live component with listeners
   and a round possibly in progress. Hence two stable children of the view
   container rather than one — see initHome.

   The hour, the ways back in and today's remark all come from localStorage
   and are on screen on the first frame. Today's Japanese and the primary
   action wait on the content files, so they are inserted when those arrive
   rather than held behind a skeleton: there is no layout for a skeleton to
   reserve on a screen this quiet, and a placeholder block would be the
   loudest thing on it.

   Nothing is invented if a fetch fails. The line is absent, the action is
   absent, and the shelf — which needs no data at all — is still there, so a
   reader who cannot reach data/ still lands somewhere with doors in it.
   ---------------------------------------------------------------------------------------- */

function initHome() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getViewContainer(view, 'home-content');

  const room = element('div', 'home');
  const practiceSlot = element('div', 'home__practice-slot');
  content.replaceChildren(room, practiceSlot);

  /* Built on the first press, not at boot: a reader who never taps the
     button never pays for the panel, and by the time they do the pool it
     needs is already resolved. `pool` is captured by the closure below and
     re-read on every round, so a later render can't leave it stale. */
  let quiz = null;
  let pool = null;

  function startQuickRound(item) {
    if (!pool) return;

    if (!quiz) {
      quiz = createQuiz({
        // Keyboard shortcuts must not fire while another view is on screen.
        isActive: () => location.hash.slice(1) === VIEW_ID,
        /* The one path that logs a round in this app: the practice store
           mints the id, bridge.js republishes it. Home does not touch the
           bridge itself and does not award anything — it finishes a real
           session and lets the existing pipeline carry it. */
        onFinish: ({ total, correct }) => {
          recordSession({ total, correct, mode: QUICK_DECK });
        },
        // "Дахин давтах" draws a fresh short round rather than reshuffling
        // the same three — the schedule has moved on since they were picked.
        onNewRound: () => buildSession(pool.everything, QUICK_ROUND),
        // Onward from a quick round is the full Review screen: this was a
        // taste of it, and that is where the rest of it lives.
        onNextStep: () => ({ go: () => { location.hash = '#practice'; } }),
        onExit: () => {
          room.hidden = false;
          render();
        },
      });
      practiceSlot.append(quiz.element);
    }

    /* Today's item first, then whatever the schedule says is most ready.
       Deduplicated, because buildSession is perfectly entitled to pick the
       same word — and asking the same card twice in a three-card round is
       the sort of thing that makes a practice surface feel fake. */
    const rest = buildSession(pool.everything, QUICK_ROUND).filter((other) => other.id !== item.id);
    const queue = [item, ...rest].slice(0, QUICK_ROUND);

    room.hidden = true;
    quiz.run(queue, { mode: QUICK_MODE, pool: pool.everything, title: '今日の練習' });
  }

  /* One render at a time. A hashchange arriving while the previous render is
     still waiting on the pool would otherwise let the slower of the two
     finish last and write a stale room. */
  let renderToken = 0;

  async function render() {
    const token = (renderToken += 1);

    const records = snapshotRecords();
    const sessions = practiceStore.getAll();
    const firstVisit = isFirstVisit(records, sessions);

    room.replaceChildren();
    room.hidden = false;

    /* -- The desk ------------------------------------------------------------- */
    const desk = element('section', 'home__desk');
    desk.setAttribute('aria-labelledby', 'home-desk-heading');

    desk.append(createHourMark());

    if (firstVisit) {
      const welcome = element('p', 'home__welcome', '日本語を、ここから。');
      welcome.lang = 'ja';
      desk.append(welcome);
    } else if (studiedToday(sessions)) {
      /* A remark, not a reward. It says the reader has already done their
         Japanese today and then gets out of the way — no count, no streak,
         no badge and nothing that gets worse tomorrow if they stop. */
      const done = element('p', 'home__done', '今日はできました。');
      done.lang = 'ja';
      desk.append(done);
    }

    const heading = element('h2', 'home__section-heading', '今日の日本語');
    heading.id = 'home-desk-heading';
    heading.lang = 'ja';
    desk.append(heading);

    /* -- The aside ------------------------------------------------------------ */
    const aside = element('aside', 'home__aside');

    const ways = element('div', 'home__ways');
    const lesson = lastLesson(records);
    if (lesson !== null) ways.append(createWay('#lessons', '続きから', `Lesson ${lesson}`));
    if (ways.childElementCount > 0) aside.append(ways);

    aside.append(createShelf());
    room.append(desk, aside);

    /* -- What needs the catalogue --------------------------------------------- */
    try {
      pool = await loadReviewPool();
    } catch (error) {
      console.error('[Bigu]', error);
      return;
    }
    if (token !== renderToken) return;

    const lines = collectLines(pool);
    // A brand-new reader gets the first word of the first lesson rather than
    // a random N2 grammar pattern: on day one the honest answer to "here is
    // today's Japanese" is the one the app would have taught first anyway.
    const line = firstVisit ? (lines[0] ?? null) : lineForToday(lines);
    if (!line) return;

    desk.append(createToday(line, pool.lessons));

    const actions = element('div', 'home__actions');

    const start = document.createElement('button');
    start.type = 'button';
    start.className = 'button button--primary home__start';
    start.lang = 'ja';
    start.textContent = 'これを練習する';
    start.addEventListener('click', () => startQuickRound(line.item));
    actions.append(start);

    // First visit only: the reader has no idea yet that there are fifteen
    // lessons behind the shelf, so the on-ramp gets named once.
    if (firstVisit) {
      const lessons = document.createElement('a');
      lessons.className = 'button button--secondary';
      lessons.href = '#lessons';
      lessons.textContent = 'Lessons';
      actions.append(lessons);
    }

    desk.append(actions, element('p', 'home__actions-note meta', 'Богино дасгал — эндээс шууд.'));

    // Last, and only when true: the schedule is the reason to open the app
    // on a day the reader has nothing new in mind. No count, no minutes.
    if (countDue(pool.everything).due > 0) {
      ways.append(createWay('#practice', '復習', 'давтах зүйл хүлээж байна'));
      if (!ways.isConnected) aside.prepend(ways);
    }
  }

  // Re-read on the way back in, same as the other views that summarize state
  // they don't own: the lesson to continue, what is due and whether anything
  // has been finished today all change while the reader is elsewhere. Never
  // mid-round — the room is hidden then, and replacing it under a live quiz
  // would be the only visible effect.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== VIEW_ID) return;
    if (quiz && !quiz.element.hidden) return;
    render().catch((error) => console.error('[Bigu]', error));
  });

  return render();
}

export { initHome };
