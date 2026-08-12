/* ==========================================================================
   home.js
   道 — fills the five blocks laid out in index.html's #home section.

   Home is the space of the reader's own path. It shows presence, not plans:
   what Japanese is on the desk today, the one line they wrote for
   themselves, the marks their practice has left, and at most two quiet
   sentences about where they stand. Nothing here is a task, nothing is a
   call to action, and nothing keeps score.

   Three rules this module is built to keep, and each one is a constraint on
   the code rather than a note about the design:

     No numbers reach the screen. Not a count, not a percentage, not a
     streak, not a level, not a lesson number. That extends to the *content*:
     the day's Japanese is picked from candidates filtered to those with no
     digit in them, because "1,000円です" would put a figure on the calmest
     screen in the app just as surely as a due count would. The reader's own
     道 line is exempt — it is their writing, not the app's.

     The page never changes its tone. A day on which nothing happened
     renders exactly like any other day: an unmarked cell in ③ is fainter
     ink and nothing else, and there is no branch anywhere below that praises
     a good week or notices a bad one.

     Nothing is invented. Every line comes from a store that already exists
     or from data/. Where there is nothing true to say — no history to point
     at, no line written — the block is hidden outright rather than filled
     with an empty state explaining what the reader has not done.

   One new stored value, as specified: the 道 line, inside the existing
   `settings` store. No new key namespace, no new store, no schema change.
   ========================================================================== */

import { journal, practice, settings } from './storage.js';
import { snapshotRecords } from './review.js';
import { deckKeyForItemId, furigana } from './quiz.js';
import { loadReviewPool } from './practice.js';
import { loadIntoView, OFFLINE_HINT } from './content.js';

const VIEW_ID = 'home';

/* The 道 line, inside the settings store the app already keeps. A single
   string under a single key: the only value this module writes. */
const WAY_KEY = 'wayLine';

/* How many days ③ shows. A rendering parameter, never rendered — two weeks
   across on a wide screen and one week across on a phone (see home.css),
   which is a window long enough to have a shape and short enough that its
   far end is still something the reader remembers. */
const DAYS_WINDOW = 56;

/* Anything with a digit in it is out of the running for ①. Full-width kana
   digits included: the data is Japanese, and ５ is as much a figure as 5. */
const HAS_DIGIT = /[0-9０-９]/;

/* -- The hour ------------------------------------------------------------------------
   Four bands, named the way a room is named rather than the way a clock is
   read. Ordered by their start hour and scanned in order, so the last band
   whose `from` has passed is the current one — which leaves the small hours
   (00:00-04:59) holding the initial value, 夜, with no wrapping case.

   `key` is what home.css keys its tonal shift off; it is never shown.
   ------------------------------------------------------------------------------------ */

const HOURS = [
  { from: 5, key: 'asa', jp: '朝', reading: 'あさ' },
  { from: 11, key: 'hiru', jp: '昼', reading: 'ひる' },
  { from: 17, key: 'yuu', jp: '夕', reading: 'ゆう' },
  { from: 20, key: 'yoru', jp: '夜', reading: 'よる' },
];

function hourMark(now = new Date()) {
  const hour = now.getHours();
  let mark = HOURS[HOURS.length - 1];
  for (const band of HOURS) {
    if (hour >= band.from) mark = band;
  }
  return mark;
}

/* -- Dates ---------------------------------------------------------------------------
   Local calendar fields, never toISOString(): a session finished at 23:30
   belongs to the day the reader just spent, not to tomorrow in UTC. Same
   rule bridge.js states for the same reason.
   ------------------------------------------------------------------------------------ */

function dateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/* -- ① 言葉 -----------------------------------------------------------------------------
   One item from data/, the same one all day.

   Three shapes, because three kinds of thing live in these files and each is
   read differently. A *word* carries its reading over itself as ruby — the
   same rule quiz.js and lessons.js follow, including the part where a word
   whose reading equals itself gets no ruby at all. A *sentence* is prose and
   keeps its kana on a line of its own, because ruby over a whole sentence is
   the file's full-sentence reading stacked on one line, which is not
   furigana. A *kanji* has two readings and neither is an annotation of the
   other, so they sit together under it.

   Every candidate is checked for digits before it is offered. It costs about
   an eighth of the vocabulary examples and one grammar example out of
   fourteen, which is a price worth paying to keep the rule absolute.
   ------------------------------------------------------------------------------------ */

function candidateLines({ lessonWords, vocabulary, grammar, kanji }) {
  const lines = [];

  function offer(line, ...text) {
    if (text.some((part) => part && HAS_DIGIT.test(part))) return;
    lines.push(line);
  }

  for (const item of lessonWords) {
    if (!item.word || !item.english) continue;
    offer(
      { shape: 'word', jp: item.word, reading: item.reading, meaning: item.english },
      item.word, item.reading, item.english,
    );
  }

  for (const item of vocabulary) {
    const head = item.kanji || item.kana;
    if (head && item.meaning) {
      offer(
        { shape: 'word', jp: head, reading: item.kana, meaning: item.meaning },
        head, item.kana, item.meaning,
      );
    }

    const example = item.example;
    if (example?.jp && example.mn) {
      offer(
        { shape: 'sentence', jp: example.jp, reading: example.reading, meaning: example.mn },
        example.jp, example.reading, example.mn,
      );
    }
  }

  for (const item of grammar) {
    const example = item.example;
    if (!example?.jp || !example.mn) continue;
    offer(
      { shape: 'sentence', jp: example.jp, reading: example.reading, meaning: example.mn },
      example.jp, example.reading, example.mn,
    );
  }

  for (const item of kanji) {
    if (!item.character || !item.meaning) continue;
    const readings = [item.onyomi, item.kunyomi].filter(Boolean).join(' ・ ');
    offer(
      { shape: 'kanji', jp: item.character, reading: readings, meaning: item.meaning },
      item.character, readings, item.meaning,
    );
  }

  return lines;
}

/* Seeded off the YYYY-MM-DD string itself rather than off a number built
   from its parts, so the pick is stable for the whole of a calendar day and
   genuinely unrelated between one day and the next — an arithmetic seed like
   y*10000+m*100+d walks the candidate list in near-lockstep with the date,
   and consecutive days land on neighbouring entries in the same file.
   djb2: small, well-behaved over short ASCII strings, and no dependency. */
function seedFrom(key) {
  let hash = 5381;
  for (let i = 0; i < key.length; i += 1) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function lineForToday(lines, now = new Date()) {
  if (lines.length === 0) return null;
  return lines[seedFrom(dateKey(now)) % lines.length];
}

function renderWords(container, pool) {
  const line = lineForToday(candidateLines(pool));
  if (!line) return;

  const jp = document.createElement('p');
  jp.className = line.shape === 'sentence' ? 'home__jp home__jp--sentence' : 'home__jp';
  jp.lang = 'ja';

  if (line.shape === 'word') jp.append(furigana(line.jp, line.reading));
  else jp.textContent = line.jp;

  container.append(jp);

  // A word already carries its reading as ruby; printing it again underneath
  // would be the same kana twice on a screen built around one line.
  if (line.shape !== 'word' && line.reading) {
    const reading = document.createElement('p');
    reading.className = 'reading home__reading';
    reading.lang = 'ja';
    reading.textContent = line.reading;
    container.append(reading);
  }

  const meaning = document.createElement('p');
  meaning.className = 'home__meaning';
  meaning.textContent = line.meaning;
  container.append(meaning);
}

/* -- ② 道 --------------------------------------------------------------------------------
   One sentence the reader writes. An <input> rather than a block that swaps
   into one: it is already click-to-edit, it is reachable by keyboard with no
   focus scripting at all, and its placeholder is the empty state — inline,
   quiet, and gone the instant anything is typed.

   Saved on blur and on Enter, and only when the value has actually changed,
   so tabbing through the page does not write the store on every pass.
   Escape restores what was last saved, which is the one thing a chromeless
   editable line otherwise gives no way back from.
   ------------------------------------------------------------------------------------ */

function renderWay(container) {
  const label = container.querySelector('.home__label');

  const field = document.createElement('input');
  field.type = 'text';
  field.className = 'home__way-line';
  field.id = 'home-way-line';
  field.autocomplete = 'off';
  field.placeholder = 'Өөрийн нэг мөр';
  // The block's own 道 label is the accessible name; a second visible label
  // would be the same word twice.
  if (label) field.setAttribute('aria-labelledby', label.id);

  let saved = String(settings.get(WAY_KEY, '') ?? '');
  field.value = saved;

  function commit() {
    const next = field.value.trim();
    if (next === saved) return;
    saved = next;
    settings.set(WAY_KEY, next);
  }

  field.addEventListener('blur', commit);
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      field.blur();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      field.value = saved;
      field.blur();
    }
  });

  container.append(field);
}

/* -- ③ 積み重ね ---------------------------------------------------------------------------
   One mark per day over the window, oldest first.

   A day counts as present if anything at all happened on it: a review
   session finished, an item first met or last seen, a journal entry
   written. All three are already timestamped in stores this module only
   reads, so the grid needs no new state and stays correct across a restored
   backup.

   Presence and absence, and nothing else. No scale, no legend, no tooltip
   and no total — an intensity ramp is a count wearing a colour, and this
   screen does not count. The two states differ only in how much ink is on
   the paper (see home.css), so a fortnight of absence reads as a fortnight
   and not as a reproach.

   Marked as one image with one name: per-cell labels would hand a screen
   reader a day-by-day audit of the reader's month, which is exactly the
   thing the visual design refuses to spell out.
   ------------------------------------------------------------------------------------ */

function collectStudyDays({ records, sessions, entries }) {
  const days = new Set();

  for (const entry of entries) {
    if (entry?.date) days.add(entry.date);
  }

  for (const session of sessions) {
    if (session?.createdAt) days.add(dateKey(new Date(session.createdAt)));
  }

  for (const record of records.values()) {
    if (record.lastSeen) days.add(dateKey(new Date(record.lastSeen)));
    if (record.firstSeen) days.add(dateKey(new Date(record.firstSeen)));
  }

  return days;
}

function renderDays(container, days, now = new Date()) {
  const grid = document.createElement('div');
  grid.className = 'home__days-grid';
  grid.setAttribute('role', 'img');
  grid.setAttribute('aria-label', 'Сүүлийн үеийн өдрүүд');

  const cursor = new Date(now);
  cursor.setDate(cursor.getDate() - (DAYS_WINDOW - 1));

  for (let i = 0; i < DAYS_WINDOW; i += 1) {
    const cell = document.createElement('span');
    cell.className = days.has(dateKey(cursor)) ? 'home__day home__day--marked' : 'home__day';
    grid.append(cell);
    cursor.setDate(cursor.getDate() + 1);
  }

  container.append(grid);
}

/* -- ④ 現在地 and ⑤ 続き --------------------------------------------------------------------
   Where the reader stands, in words.

   The source concept for 現在地 was a level and a progression figure. The
   no-numbers rule bans exactly that, and no-numbers wins: this is a
   sentence, and the numeric version of the same question belongs on the
   summer-project dashboard, which already owns progress display. Where a
   line cannot be said without a figure it is not said.

   Which is why a lesson is named by its *title* and never "Lesson 7". Both
   lines are derived from one fact — the most recently touched item in the
   progress store — so they appear and disappear together, and neither
   renders at all for a reader with no history.
   ------------------------------------------------------------------------------------ */

const LESSON_ID = /^l(\d+)-/;

/* Where the deck names live in the reader's own language. quiz.js's adapter
   labels are the English nav words; these are the same four places said in
   the language the rest of the app's prose is written in. */
const AREA_NAMES = {
  lessons: 'хичээл',
  vocabulary: 'үг',
  grammar: 'хэл зүй',
  kanji: 'ханз',
};

function mostRecent(records) {
  let best = null;

  for (const [itemId, record] of records) {
    if (!record.lastSeen) continue;
    if (!best || record.lastSeen > best.record.lastSeen) best = { itemId, record };
  }

  return best;
}

/* The name of the place the reader last stood, and the route back to it.
   A lesson is named by its title, which is the only way to say which lesson
   without saying a number; everything else is named by its area. A title
   carrying a digit is dropped back to the area name rather than bending the
   rule for one entry. */
function describeWhere(records, lessons) {
  const latest = mostRecent(records);
  if (!latest) return null;

  // All four deck keys are also view ids, which is what makes ⑤ a one-line
  // lookup rather than a route table.
  const kind = deckKeyForItemId(latest.itemId);
  if (!kind || !AREA_NAMES[kind]) return null;

  const where = { kind, href: `#${kind}`, name: AREA_NAMES[kind] };

  if (kind === 'lessons') {
    const match = LESSON_ID.exec(latest.itemId);
    const lesson = match && lessons.find((entry) => entry.lesson === Number(match[1]));
    if (lesson?.title && !HAS_DIGIT.test(lesson.title)) {
      where.name = lesson.title;
      where.lang = 'ja';
    }
  }

  return where;
}

function renderWhere(container, where) {
  container.textContent = 'Сүүлд: ';

  const name = document.createElement('span');
  if (where.lang) name.lang = where.lang;
  name.textContent = where.name;

  container.append(name);
  container.hidden = false;
}

function renderNext(container, where) {
  const link = document.createElement('a');
  link.className = 'home__next-link';
  link.href = where.href;
  link.lang = 'ja';
  link.textContent = '続き';

  container.append(link);
  container.hidden = false;
}

/* -- Rendering --------------------------------------------------------------------------
   Everything but ① comes out of localStorage and is on screen on the first
   frame. ① waits on the content files and goes through content.js's own
   load cycle — skeleton, then render, then a retryable error state on
   failure — rather than growing a sixth private copy of that machinery here.

   The skeleton shape is the three-row one: three short bars is what this
   block resolves into, so nothing on the page moves when the data lands.
   ---------------------------------------------------------------------------------------- */

function initHome() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const room = document.getElementById('home-room');
  const blocks = {
    words: document.getElementById('home-words'),
    way: document.getElementById('home-way'),
    days: document.getElementById('home-days'),
    where: document.getElementById('home-where'),
    next: document.getElementById('home-next'),
    hour: document.getElementById('home-hour'),
  };
  if (!room || Object.values(blocks).some((block) => !block)) return;

  /* Built once. The 道 line holds the reader's cursor and possibly an
     uncommitted edit, so it must survive a re-render of everything around
     it — which is the whole reason the blocks are separate containers
     rather than one region this module replaces wholesale. */
  renderWay(blocks.way);

  function renderHour() {
    const { key, jp, reading } = hourMark();
    room.dataset.hour = key;
    blocks.hour.replaceChildren(furigana(jp, reading));
  }

  function renderState() {
    const records = snapshotRecords();
    const sessions = practice.getAll();
    const entries = journal.getAll();

    blocks.days.querySelector('.home__days-grid')?.remove();
    renderDays(blocks.days, collectStudyDays({ records, sessions, entries }));

    return records;
  }

  async function render() {
    renderHour();
    const records = renderState();

    /* ④ and ⑤ need one field off the lesson list, so they resolve with the
       catalogue rather than on the first frame. Hidden until then, which is
       also how they stay for a reader with no history. */
    blocks.where.hidden = true;
    blocks.where.replaceChildren();
    blocks.next.hidden = true;
    blocks.next.replaceChildren();

    await loadIntoView(blocks.words, {
      skeleton: 'memory',
      load: loadReviewPool,
      render(container, pool) {
        container.replaceChildren();
        renderWords(container, pool);

        const where = describeWhere(records, pool.lessons);
        if (where) {
          renderWhere(blocks.where, where);
          renderNext(blocks.next, where);
        }
      },
      errorTitle: 'Өнөөдрийн япон ирсэнгүй.',
      errorDetail: `Энэ мөр data/ доторх агуулгаас гардаг. ${OFFLINE_HINT}`,
    });
  }

  /* Re-read on the way back in. The marks, where the reader stands and the
     hour all move while they are elsewhere in the app; the 道 line does not,
     and is deliberately left alone by this path. */
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) !== VIEW_ID) return;
    render().catch((error) => console.error('[Bigu]', error));
  });

  return render();
}

export { initHome };
