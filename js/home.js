/* ==========================================================================
   home.js
   Renders the #home view — the app's entry point, and deliberately the
   emptiest screen in it.

   Home is not a dashboard and must not become one. Progress, streaks, XP
   and "weak areas" belong to the separate summer-project surface that reads
   Bigu's `bigu:bridge` key; nothing here counts anything. There are no
   figures on this screen at all — no due count, no minutes, no percentage,
   no bar — because the moment one appears the room becomes a status report
   and opening the app becomes a performance review.

   What is here, at most:

     - the hour, as one kanji. 朝 / 昼 / 夕 / 夜, read off the clock, with
       its own furigana and nothing else. The room knows what time it is;
       it has no opinion about how you are doing.

     - one real line of Japanese, from data/. A lesson word, a vocabulary
       example, a grammar example, or a sentence out of a reading passage —
       never generated, never decorative. Its meaning is behind a tap, so
       the first thing on screen is Japanese you have to actually read.

     - at most two one-line ways back in, both derived from state that
       already exists on this device. Neither renders when there is nothing
       true to say, and neither carries a number.

   Everything is read, nothing is written. This module introduces no store,
   no key and no schema — the lesson to continue is recovered from the
   progress records review.js already keeps, and whether anything is waiting
   is countDue() over the same pool the Review deck draws from.
   ========================================================================== */

import { journal, practice } from './storage.js';
import { countDue, snapshotRecords } from './review.js';
import { furigana } from './quiz.js';
import { loadReviewPool } from './practice.js';
import { loadReading } from './reading.js';
import { getViewContainer } from './content.js';

const VIEW_ID = 'home';

/* -- The hour ------------------------------------------------------------------------
   Four bands, named the way a Japanese room is named rather than the way a
   clock is read. Ordered by their start hour and scanned in order, so the
   last band whose `from` has passed is the current one — which leaves the
   small hours (00:00–04:59) with the initial value, 夜, without needing a
   wrapping case.
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

/* -- The line ------------------------------------------------------------------------
   Every candidate is a row that already exists in data/. Two shapes, because
   the furigana convention only applies to one of them: a *word* carries its
   reading over itself as ruby (the same rule quiz.js and lessons.js use — no
   ruby when the word and its reading are the same string), while a
   *sentence* is printed as Japanese and keeps its kana reading behind the
   tap alongside the meaning. Ruby over a whole sentence would be the file's
   full-sentence kana stacked on one line, which is not furigana.

   Kanji entries are deliberately not a source. Their "example" is a single
   compound with no sentence around it, and the four sources below already
   cover the four kinds of Japanese this app holds.
   ------------------------------------------------------------------------------------ */

function collectLines({ lessonWords, vocabulary, grammar }, passages) {
  const lines = [];

  for (const word of lessonWords) {
    if (word.word && word.english) {
      lines.push({ kind: 'word', jp: word.word, reading: word.reading, mn: word.english });
    }
  }

  for (const source of [vocabulary, grammar]) {
    for (const entry of source) {
      const example = entry.example;
      if (example?.jp && example.mn) {
        lines.push({ kind: 'sentence', jp: example.jp, reading: example.reading, mn: example.mn });
      }
    }
  }

  for (const passage of passages) {
    for (const sentence of passage.sentences ?? []) {
      if (sentence.jp && sentence.mn) {
        lines.push({ kind: 'sentence', jp: sentence.jp, reading: sentence.reading, mn: sentence.mn });
      }
    }
  }

  return lines;
}

/* One line per day, the same one all day. A fresh random line on every
   navigation would make Home flicker between sentences as the reader moves
   around the app, and a line you can come back to is a line you might
   actually learn. The seed is the calendar date and nothing else — no
   stored cursor, no history, nothing to migrate. */
function lineForToday(lines, now = new Date()) {
  if (lines.length === 0) return null;
  const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
  return lines[seed % lines.length];
}

/* -- Where the reader left off ------------------------------------------------------
   Lesson word ids are l1-01, l2-14, … — the lesson number is in the id, and
   every graded or marked word already carries a `lastSeen`. The most
   recently touched lesson word is therefore the lesson to offer, recovered
   from records that exist rather than from a bookmark this module would
   have to write and keep correct.

   Null when the reader has never touched a lesson word, in which case the
   line is simply not rendered.
   ------------------------------------------------------------------------------------ */

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

/* -- First visit ---------------------------------------------------------------------
   Nothing in any store, which is also true after a reader clears their data
   or opens the app in a second browser — both of which are, from the app's
   side, exactly a first visit. Same definition the Dashboard uses; a flag
   would be wrong in all three cases.
   ------------------------------------------------------------------------------------ */

function isFirstVisit(records) {
  return records.size === 0 && journal.getAll().length === 0 && practice.getAll().length === 0;
}

/* -- Pieces --------------------------------------------------------------------------- */

function createHourMark() {
  const mark = document.createElement('p');
  mark.className = 'home__hour';
  mark.lang = 'ja';
  const { jp, reading } = hourMark();
  mark.append(furigana(jp, reading));
  return mark;
}

/* The Japanese, and its meaning behind it. The whole line is the control —
   on a phone that is the difference between a comfortable tap and aiming at
   a glyph — and the disclosure is the same aria-expanded/hidden pair
   reading.js uses for its sentences, so opening a gloss behaves identically
   in both places.

   A drag that ended inside the button was a selection, not a press: this is
   Japanese somebody might want to copy into a dictionary, and the same
   guard reading.js carries applies for the same reason. */
function createLine(line) {
  const wrap = document.createElement('div');
  wrap.className = 'home__line';

  const glossId = 'home-line-gloss';

  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'home__face';
  face.setAttribute('aria-expanded', 'false');
  face.setAttribute('aria-controls', glossId);

  const jp = document.createElement('span');
  jp.className = 'home__jp';
  jp.lang = 'ja';
  if (line.kind === 'word') jp.append(furigana(line.jp, line.reading));
  else jp.textContent = line.jp;

  face.append(jp);

  const gloss = document.createElement('div');
  gloss.className = 'home__gloss';
  gloss.id = glossId;
  gloss.hidden = true;

  // A word already shows its reading as furigana over itself; repeating it
  // underneath would be the same kana twice on a screen built around one line.
  if (line.kind === 'sentence' && line.reading) {
    const reading = document.createElement('p');
    reading.className = 'reading home__reading';
    reading.lang = 'ja';
    reading.textContent = line.reading;
    gloss.append(reading);
  }

  const meaning = document.createElement('p');
  meaning.className = 'home__meaning';
  meaning.textContent = line.mn;
  gloss.append(meaning);

  face.addEventListener('click', () => {
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && face.contains(selection.anchorNode)) return;

    const open = face.getAttribute('aria-expanded') === 'true';
    face.setAttribute('aria-expanded', String(!open));
    gloss.hidden = open;
  });

  wrap.append(face, gloss);
  return wrap;
}

/* One row, Japanese first with a quiet gloss after it — `続きから · Lesson 18`.
   A link, not a card and not a button block: this is a door left ajar, not a
   call to action. */
function createWay(href, jp, note) {
  const way = document.createElement('a');
  way.className = 'home__way';
  way.href = href;

  const lead = document.createElement('span');
  lead.className = 'home__way-jp';
  lead.lang = 'ja';
  lead.textContent = jp;
  way.append(lead);

  if (note) {
    const separator = document.createElement('span');
    separator.className = 'home__way-separator';
    separator.setAttribute('aria-hidden', 'true');
    separator.textContent = '·';

    const gloss = document.createElement('span');
    gloss.className = 'home__way-note';
    gloss.textContent = note;

    way.append(separator, gloss);
  }

  return way;
}

/* The whole of what a brand-new reader is shown. Two lines and one door —
   no questionnaire, no level picker, no tour. The app has fifteen lessons
   and a Review deck behind that door; asking three questions before opening
   it would be the app deciding something it has no information about. */
function createWelcome() {
  const wrap = document.createElement('div');
  wrap.className = 'home__welcome';

  const lead = document.createElement('p');
  lead.className = 'home__welcome-line';
  lead.lang = 'ja';
  lead.textContent = 'ようこそ、Biguへ。';

  const sub = document.createElement('p');
  sub.className = 'home__welcome-line home__welcome-line--sub';
  sub.lang = 'ja';
  sub.textContent = '静かに日本語を学ぶ場所。';

  const start = document.createElement('a');
  start.className = 'button button--primary home__start';
  start.href = '#lessons';
  start.lang = 'ja';
  start.textContent = '始める';

  wrap.append(lead, sub, start);
  return wrap;
}

/* -- Rendering ------------------------------------------------------------------------
   The hour and the ways back in come from localStorage and are on screen on
   the first frame. The Japanese line waits on the content files, so it is
   inserted above the ways when they arrive rather than held behind a
   skeleton — there is no layout for a skeleton to reserve here, and a
   placeholder block on the emptiest screen in the app would be the loudest
   thing on it.

   Nothing is invented if a fetch fails: the line is simply absent, and so is
   the review row, because whether anything is due is a fact this module
   cannot know without the catalogue.
   ------------------------------------------------------------------------------------ */

async function render(content) {
  const records = snapshotRecords();

  const room = document.createElement('div');
  room.className = 'home stagger';
  room.append(createHourMark());
  content.replaceChildren(room);

  if (isFirstVisit(records)) {
    room.append(createWelcome());
    return;
  }

  const ways = document.createElement('nav');
  ways.className = 'home__ways';
  ways.setAttribute('aria-label', 'Үргэлжлүүлэх');
  ways.hidden = true;

  const lesson = lastLesson(records);
  if (lesson !== null) {
    ways.append(createWay('#lessons', '続きから', `Lesson ${lesson}`));
    ways.hidden = false;
  }

  room.append(ways);

  let pool = null;
  let passages = [];

  try {
    pool = await loadReviewPool();
  } catch (error) {
    console.error('[Bigu]', error);
    return;
  }

  // Passages are the one source Home can do without: they are a fifth file
  // and nothing else on this screen depends on them, so a failure here costs
  // the line some variety and nothing more.
  try {
    passages = (await loadReading()).passages ?? [];
  } catch (error) {
    console.error('[Bigu]', error);
  }

  const line = lineForToday(collectLines(pool, passages));
  if (line) room.insertBefore(createLine(line), ways);

  // One row, no count and no minutes. What is waiting is a fact; how much of
  // it there is belongs to the schedule and to the other surface, not here.
  if (countDue(pool.everything).due > 0) {
    ways.append(createWay('#practice', '復習', 'давтах зүйл хүлээж байна'));
    ways.hidden = false;
  }
}

/* -- Init ----------------------------------------------------------------------------- */

function initHome() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getViewContainer(view, 'home-content');

  // Re-read on the way back in, same as the other two views that summarize
  // state they don't own: the lesson to continue and whether anything is
  // waiting both change while the reader is elsewhere in the app.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) === VIEW_ID) {
      render(content).catch((error) => console.error('[Bigu]', error));
    }
  });

  return render(content);
}

export { initHome };
