/* ==========================================================================
   dashboard.js
   Renders the #dashboard view. Pulls its data by importing each feature
   module's own loader (loadVocabulary, loadGrammar, loadKanji, loadLessons)
   rather than re-fetching with duplicated logic — the browser cache makes
   the repeat fetch free, and this is the one view whose whole job is
   summarizing the others.

   The view leads with what to do next, not with what was done. Everything
   here used to be retrospective — a streak, four completion bars, the last
   session's score — so a reader opening the app had to decide for
   themselves where to go, every single time, and that friction is what
   kills a daily habit. The Today card answers the question instead: what's
   due, and one button that starts it.

   The completion bars are gone entirely; see the note above
   createMemoryCard() for why a learned/total ratio was the wrong shape for
   this app's subject, and what took its place.

   Backup/restore used to be a fourth card here. It moved to Settings: this
   is a status surface, and an action that overwrites every store in the
   browser does not belong in a grid of stat cards.
   ========================================================================== */

import { progress, journal, practice, isAvailable as isStorageAvailable } from './storage.js';
import {
  createStorageNotice,
  formatCount,
  getViewContainer,
  loadIntoView,
  OFFLINE_HINT,
} from './content.js';
import { dailyGoal } from './preferences.js';
import { bandFor, countDue, FAINT_STRENGTH, snapshotRecords, strengthOf } from './review.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';
import { loadLessons } from './lessons.js';

const VIEW_ID = 'dashboard';

/* -- Dates -------------------------------------------------------------------------- */

function toDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function todayKey() {
  return toDateKey(new Date());
}

const dateLabelFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
});

function formatSessionDate(timestamp) {
  return dateLabelFormatter.format(new Date(timestamp));
}

/* -- Study days -------------------------------------------------------------------------
   Which calendar days count toward the streak. This used to read the
   journal alone, which meant the app's hero number — biggest type on the
   page, bengara accent, first card in the grid — rewarded the one activity
   most readers do least. Someone who reviewed a hundred cards a day for a
   month saw a streak of zero, which is not just wrong, it's discouraging.

   A day counts as studied if any of three things happened on it: a journal
   entry was written, a review session was finished, or an item was put into
   memory. All three are already timestamped in storage, so this needs no
   new data — only for the streak to look at all of it. The set of kinds per
   day is kept, not just the fact of one, so the card can say which.
   ------------------------------------------------------------------------------------------ */

function collectStudyDays({ entries, sessions, records }) {
  const days = new Map();

  function mark(key, kind) {
    if (!key) return;
    if (!days.has(key)) days.set(key, new Set());
    days.get(key).add(kind);
  }

  for (const entry of entries) mark(entry.date, 'тэмдэглэл');
  for (const session of sessions) mark(toDateKey(new Date(session.createdAt)), 'давталт');
  for (const record of records) {
    if (record && record.lastSeen) mark(toDateKey(new Date(record.lastSeen)), 'шинэ үг');
  }

  return days;
}

/* Most recent unbroken run of study days. If today has nothing yet the count
   starts from yesterday instead — the streak isn't broken until a full day
   passes with nothing at all. */
function computeStreak(days) {
  const cursor = new Date();

  if (!days.has(toDateKey(cursor))) {
    cursor.setDate(cursor.getDate() - 1);
  }

  let streak = 0;
  while (days.has(toDateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

/**
 * Longest unbroken run of consecutive study days anywhere in the history,
 * not just the one ending today — a personal best that survives a broken
 * streak, shown next to the current one so a lapse doesn't erase it.
 */
function computeLongestStreak(days) {
  const sorted = [...days.keys()].sort();
  if (sorted.length === 0) return 0;

  let longest = 1;
  let current = 1;

  for (let i = 1; i < sorted.length; i += 1) {
    const diffDays = Math.round((new Date(sorted[i]) - new Date(sorted[i - 1])) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }

  return longest;
}

/* -- First visit ----------------------------------------------------------------------------
   What a brand-new reader used to be shown, on the first screen of the app,
   was four cards reading 0 items due, 0 days streak, 0 words in memory, and
   "You haven't reviewed yet." Every one of those sentences is true and none
   of them is any use: a status surface has nothing to report before there
   is any status, and a grid of zeroes is the least inviting thing a study
   app can open with. It also silently taught the wrong lesson — that the
   numbers are the point — to the one reader who has no other impression yet.

   So on the first visit the grid is replaced by one card that says what the
   app does, in the app's own metaphor, and offers the one door that makes
   sense from a standing start. It disappears for good the moment anything
   is studied; there is no dismiss button, because a welcome you have to
   dismiss is a welcome that outstayed its welcome.

   "First visit" is defined as "nothing in any store" rather than by a flag,
   so it is also correct after a reader clears their data or opens the app
   in a second browser — both of which are, from the app's side, exactly a
   first visit.
   -------------------------------------------------------------------------------------------------- */

function isFirstVisit({ records, entries, sessions }) {
  return records.size === 0 && entries.length === 0 && sessions.length === 0;
}

const FIRST_VISIT_STEPS = [
  {
    jp: '出会う',
    title: 'Meet a word',
    body: 'Lessons бол эхлэх зам — арван таван хичээл, тус бүр хэдхэн үгтэй. Харин зүгээр нэг эргэж харах юм бол Vocabulary, Grammar, Kanji гурав хүлээж байна.',
  },
  {
    jp: '思い出す',
    title: 'Try to recall it',
    body: 'Review чамд япон талыг үзүүлээд, утгыг харуулахаасаа өмнө асууна. Үнэнээр хариул; давтах хуваарь чинь оноогоор биш, чиний хариултаас бүтдэг.',
  },
  {
    jp: '薄れる',
    title: 'Watch the ink fade',
    body: 'Танилцсан үг бүр чинь тэр агшнаасаа бүдгэрч эхэлдэг. Memory аль нь бүдгэрч байгааг харуулна — тиймээс богинохон орж ирэхэд ч хийх үнэ цэнэтэй зүйл үргэлж байна.',
  },
];

function createWelcome() {
  const card = document.createElement('section');
  card.className = 'card dashboard-welcome';
  card.setAttribute('aria-labelledby', 'dashboard-welcome-heading');

  const kicker = document.createElement('p');
  kicker.className = 'dashboard-welcome__kicker';
  kicker.textContent = 'First time here';

  const heading = document.createElement('h2');
  heading.className = 'dashboard-welcome__heading';
  heading.id = 'dashboard-welcome-heading';
  heading.textContent = 'Гурван зүйл, аппын бүхий л агуулга нь тэр.';

  const steps = document.createElement('ol');
  steps.className = 'dashboard-welcome__steps';

  for (const step of FIRST_VISIT_STEPS) {
    const item = document.createElement('li');
    item.className = 'dashboard-welcome__step';

    const mark = document.createElement('p');
    mark.className = 'dashboard-welcome__step-mark';
    mark.lang = 'ja';
    mark.textContent = step.jp;
    mark.setAttribute('aria-hidden', 'true');

    const title = document.createElement('p');
    title.className = 'dashboard-welcome__step-title';
    title.textContent = step.title;

    const body = document.createElement('p');
    body.className = 'dashboard-welcome__step-body';
    body.textContent = step.body;

    item.append(mark, title, body);
    steps.append(item);
  }

  const actions = document.createElement('div');
  actions.className = 'dashboard-welcome__actions';

  const start = document.createElement('a');
  start.href = '#lessons';
  start.className = 'button button--primary';
  start.textContent = 'Start with lesson one';

  const browse = document.createElement('a');
  browse.href = '#vocabulary';
  browse.className = 'button button--secondary';
  browse.textContent = 'Browse the vocabulary';

  actions.append(start, browse);

  /* The note is wrapped rather than carrying the divider itself: typography
     gives every <p> a 68ch measure, so a rule drawn on the paragraph
     stopped two thirds of the way across the card and read as an underline
     on the text instead of as the foot of the section. */
  const foot = document.createElement('div');
  foot.className = 'dashboard-welcome__foot';

  const note = document.createElement('p');
  note.className = 'dashboard-welcome__note meta';
  note.textContent =
    'Таны хийсэн бүхэн энэ хөтөч дотор үлдэж, төхөөрөмжөөс хэзээ ч гардаггүй. Хуулбар авмаар бол Settings дотор нэг товшилтоор нөөцлөх боломж бий.';

  foot.append(note);
  card.append(kicker, heading, steps, actions, foot);
  return card;
}

/* -- Card builders --------------------------------------------------------------------------
   Each card reuses the generic .card surface from cards.css — the
   dashboard is the one view that's purely a summary of the others, so
   there's no reason to define its own card chrome from scratch.
   -------------------------------------------------------------------------------------------------- */

function createCard(titleText) {
  const card = document.createElement('div');
  card.className = 'card';

  const header = document.createElement('div');
  header.className = 'card__header';

  const title = document.createElement('p');
  title.className = 'card__title';
  title.textContent = titleText;

  header.append(title);
  card.append(header);

  return card;
}

/* -- Today ------------------------------------------------------------------------------------
   The one card that looks forward. Everything else on this screen reports
   what already happened; this says what's waiting and gives one button to
   start it, so opening the app is a decision the app has already made.
   ---------------------------------------------------------------------------------------------- */

/* The catalogue holds well over a thousand items nobody has met. That
   number used to appear here as "1204 items you haven't started yet", which
   is a fact about a JSON file dressed as a fact about the reader — and the
   one shape of sentence guaranteed never to shrink no matter how much they
   study. What's due is the part today can move, so that is what this says;
   the untouched pile is described as a supply rather than counted as a
   backlog. */
function describeToday({ due, new: fresh }) {
  if (due > 0) {
    return 'Өнгөрсөн удаад хэр сайн мэдэж байснаар чинь хуваарилагдсан — хамгийн эртнийх нь эхэлнэ.';
  }
  if (fresh > 0) {
    return 'Давтах юм алга. Оронд нь шинэ зүйлтэй танилцах сайхан өдөр.';
  }
  return 'Бүгд урьдчилан хуваарилагдсан. Өнөөдөр чамайг хүлээж буй зүйл алга.';
}

/* One line, only when the reader has asked for one. See the note on
   DAILY_GOALS in preferences.js: no goal is the default, and a goal that
   is set is reported plainly and never graded. "12 of 20 reviewed today"
   with a hairline under it, no badge, no streak-at-risk warning, and the
   same calm sentence whether the number is 2 or 40. */
function createGoalLine(reviewedToday, goal) {
  const wrap = document.createElement('div');
  wrap.className = 'dashboard-goal';

  const reached = reviewedToday >= goal;

  const label = document.createElement('p');
  label.className = 'dashboard-goal__label meta';
  label.textContent = reached
    ? `Өнөөдрийн зорилго биеллээ — ${reviewedToday} зүйл давталаа.`
    : `Өнөөдөр ${goal}-аас ${reviewedToday}-ыг давтлаа.`;

  const track = document.createElement('div');
  track.className = 'dashboard-goal__track';
  track.setAttribute('aria-hidden', 'true');

  const fill = document.createElement('span');
  fill.className = 'dashboard-goal__fill';
  fill.style.setProperty('--progress', Math.min(reviewedToday / goal, 1).toFixed(3));
  if (reached) fill.classList.add('is-met');
  track.append(fill);

  wrap.append(label, track);
  return wrap;
}

function createTodayCard(counts, { reviewedToday, goal }) {
  const card = createCard('Today');
  // By class, not by grid position — see .dashboard-card--hero in dashboard.css.
  card.classList.add('dashboard-card--hero');

  /* The card stays a column — heading, then body — and only the body is a
     row: the figure and the sentence about it on the left, the action on
     the right. Trying to make the whole card a wrapping row instead, with
     the heading forced onto its own line, left the heading floating in the
     middle of a card twice the height it needed. */
  const body = document.createElement('div');
  body.className = 'dashboard-today__body';

  const lead = document.createElement('div');
  lead.className = 'dashboard-today__lead';

  const headline = document.createElement('p');
  headline.className = 'dashboard-streak__count';
  headline.textContent = formatCount(counts.due);

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = 'зүйл давтах';

  const detail = document.createElement('p');
  detail.className = 'dashboard-today__detail';
  detail.textContent = describeToday(counts);

  lead.append(headline, label, detail);
  if (goal > 0) lead.append(createGoalLine(reviewedToday, goal));

  const cta = document.createElement('a');
  cta.href = '#practice';
  cta.className = 'dashboard-card__cta button';
  // Nothing due is not nothing to do — early review is still worth a button,
  // just a quieter one than the day's actual work.
  cta.classList.add(counts.due > 0 || counts.new > 0 ? 'button--primary' : 'button--secondary');
  cta.textContent = counts.due > 0 ? 'Start review' : 'Review early';

  body.append(lead, cta);
  card.append(body);
  return card;
}

function createStreakCard(days, entries) {
  const card = createCard('Streak');
  const streak = computeStreak(days);
  const longest = computeLongestStreak(days);
  const today = todayKey();
  const wroteToday = entries.some((entry) => entry.date === today);

  const count = document.createElement('p');
  count.className = 'dashboard-streak__count';
  count.textContent = String(streak);

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = 'өдрийн цуваа';

  // Names what today's activity actually was, so a streak counting three
  // kinds of study stays honest about which of them earned the day.
  const kinds = document.createElement('p');
  kinds.className = 'meta';
  kinds.textContent = days.has(today)
    ? `Өнөөдөр: ${[...days.get(today)].sort().join(' · ')}`
    : 'Давтах, шинэ үг сурах, тэмдэглэл бичих — бүгд тооцогдоно.';

  const best = document.createElement('p');
  best.className = 'meta';
  best.textContent = `Хамгийн урт цуваа: ${longest} ${longest === 1 ? 'өдөр' : 'өдөр'}`;

  card.append(count, label, kinds, best);

  if (!wroteToday) {
    const cta = document.createElement('a');
    cta.href = '#journal';
    cta.className = 'button button--secondary dashboard-card__cta';
    cta.textContent = 'Write today’s entry';
    card.append(cta);
  } else {
    const done = document.createElement('p');
    done.className = 'dashboard-card__status';
    done.textContent = 'Өнөөдрийн тэмдэглэл бичигдсэн ✓';
    card.append(done);
  }

  return card;
}

/* -- Memory --------------------------------------------------------------------------------
   This card used to be four learned/total progress bars, one per deck. They
   were removed rather than restyled, and the reasoning is worth keeping
   written down: a completion bar over a JLPT deck is a bar that can only
   ever crawl, that treats a word recalled this morning and a word "learned"
   in March as the same unit, and that quietly promises an end state a
   language does not have. Four of them made the app's home screen a
   progress report on a syllabus.

   What replaces them is one line about the state of the reader's memory
   right now — how much of it is fading — and a door into #memory, where
   that state is the whole subject. Same data, opposite posture: not how far
   through the list you are, but what is happening to what you already hold.
   -------------------------------------------------------------------------------------------- */

function createMemoryCard(entries) {
  const card = createCard('Memory');
  const now = Date.now();

  let held = 0;
  let fading = 0;
  let strengthTotal = 0;

  for (const record of entries) {
    if (!record.seen) continue;
    held += 1;
    const strength = strengthOf(record, now);
    strengthTotal += strength;
    // The same threshold #memory splits its Fading shelf on, so the two
    // screens can't quote different numbers for the same word.
    if (strength < FAINT_STRENGTH) fading += 1;
  }

  const count = document.createElement('p');
  count.className = 'dashboard-streak__count';
  count.textContent = formatCount(held);

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = 'үг санах ойд';

  const detail = document.createElement('p');
  detail.className = 'dashboard-today__detail';
  if (held === 0) {
    detail.textContent = 'Бичигдсэн юм хараахан алга. Танилцсан үг бүр чинь тэр агшнаасаа бүдгэрч эхэлдэг — түүнийг эндээс ажиглана.';
  } else {
    const band = bandFor(strengthTotal / held);
    detail.textContent = fading > 0
      ? `Бэх нийтдээ ${band.label} байна, ${fading} үг бүдгэрчээ.`
      : `Бүгдийнх нь бэх ${band.label} байна. Бүдгэрсэн юм алга.`;
  }

  const cta = document.createElement('a');
  cta.href = '#memory';
  cta.className = 'button button--secondary dashboard-card__cta';
  cta.textContent = held === 0 ? 'See how it works' : 'Open memory';

  card.append(count, label, detail, cta);
  return card;
}

/* -- Practice session labels ----------------------------------------------------------
   practice.js tags each saved session with the deck it was drawn from;
   older sessions saved before that existed simply have no `mode` field, so
   the label is omitted for those.
   -------------------------------------------------------------------------------------- */
const PRACTICE_MODE_LABELS = {
  due: 'Due today',
  vocabulary: 'Vocabulary',
  grammar: 'Grammar',
  kanji: 'Kanji',
  lessons: 'Lessons',
  mistakes: 'Review mistakes',
};

function createPracticeCard(sessions) {
  const card = createCard('Last review');
  const latest = sessions.slice().sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  if (!latest) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'Та хараахан давтаж эхлээгүй байна.';
    card.append(empty);
  } else {
    /* A step down from the other three figures, and its own class. A score
       is a pair of numbers with a rule between them, and at the 39px
       tabular size the single figures use it broke into three separate
       things — "8", "/", "10" — reading as an equation rather than as a
       result. It is also genuinely the least important number on this
       screen: the other three say what is true now, this one says what
       happened once. */
    const score = document.createElement('p');
    score.className = 'dashboard-streak__count dashboard-streak__count--score';
    score.textContent = `${latest.correct}/${latest.total}`;

    const modeLabel = PRACTICE_MODE_LABELS[latest.mode];
    const label = document.createElement('p');
    label.className = 'meta';
    label.textContent = modeLabel
      ? `"I knew it" гэж тэмдэглэсэн · ${modeLabel} · ${formatSessionDate(latest.createdAt)}`
      : `"I knew it" гэж тэмдэглэсэн · ${formatSessionDate(latest.createdAt)}`;

    card.append(score, label);
  }

  const cta = document.createElement('a');
  cta.href = '#practice';
  cta.className = 'button button--secondary dashboard-card__cta';
  cta.textContent = latest ? 'Review again' : 'Start review';
  card.append(cta);

  return card;
}

/* -- Rendering ------------------------------------------------------------------------- */

/* How many items were actually reviewed today, for the daily goal. Read off
   the progress records' own lastSeen rather than from a separate counter,
   so it needs no new stored state and stays correct across a restored
   backup — the same trick the streak already uses. */
function countReviewedToday(records) {
  const today = todayKey();
  let reviewed = 0;
  for (const record of records.values()) {
    if (record.lastSeen && toDateKey(new Date(record.lastSeen)) === today) reviewed += 1;
  }
  return reviewed;
}

/* The line under the page heading. Says the same thing as the Today card in
   one sentence, so the answer to "what now?" is readable before a single
   card is scanned. */
function renderHeroStatus(counts, { firstVisit }) {
  const status = document.getElementById('dashboard-status');
  if (!status) return;

  if (firstVisit) {
    status.textContent = 'Япон хэлийг хэдхэн үгээр нь тайван сурах орон зай.';
  } else if (counts.due > 0) {
    status.textContent = `Өнөөдөр ${formatCount(counts.due)} зүйл давтах ёстой.`;
  } else if (counts.new > 0) {
    status.textContent = 'Өнөөдөр давтах юм алга — шинэ зүйл эхлэх сайхан өдөр.';
  } else {
    status.textContent = 'Бүх зүйл гүйцсэн.';
  }
}

function renderGrid(container, [vocabData, grammarData, kanjiData, lessonData]) {
  const lessonWords = lessonData.flatMap((lesson) => lesson.words);

  // One read of the progress store for all four decks. countDue() would
  // otherwise re-read and re-parse it once per item, which on a catalogue
  // this size is thousands of parses to draw one card.
  const records = snapshotRecords();
  const now = Date.now();

  const stats = {
    lessons: countDue(lessonWords, now, records),
    vocabulary: countDue(vocabData.words, now, records),
    grammar: countDue(grammarData.points, now, records),
    kanji: countDue(kanjiData.kanji, now, records),
  };

  // One combined figure across every deck: the reader's day isn't split by
  // content type, so neither is the number they're asked to act on.
  const totals = Object.values(stats).reduce(
    (sum, deck) => ({
      due: sum.due + deck.due,
      new: sum.new + deck.new,
      remembered: sum.remembered + deck.remembered,
      total: sum.total + deck.total,
    }),
    { due: 0, new: 0, remembered: 0, total: 0 },
  );

  const entries = journal.getAll();
  const sessions = practice.getAll();
  const firstVisit = isFirstVisit({ records, entries, sessions });

  renderHeroStatus(totals, { firstVisit });

  /* Above everything, including the welcome — a reader whose browser can't
     save anything needs to know that before they spend an evening studying,
     not after. It only ever appears in the broken case. */
  const notices = isStorageAvailable() ? [] : [createStorageNotice()];

  if (firstVisit) {
    container.replaceChildren(...notices, createWelcome());
    return;
  }

  const days = collectStudyDays({
    entries,
    sessions,
    records: Object.values(progress.getAll()),
  });

  const grid = document.createElement('div');
  grid.className = 'dashboard-grid';

  grid.append(
    createTodayCard(totals, {
      reviewedToday: countReviewedToday(records),
      goal: dailyGoal(),
    }),
    createStreakCard(days, entries),
    createMemoryCard(records.values()),
    createPracticeCard(sessions),
  );

  container.replaceChildren(...notices, grid);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initDashboard() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getViewContainer(view, 'dashboard-content');

  /* The dashboard waits on four fetches at once, so it's the view that
     stays blank longest on a cold cache — the skeleton matters most here. */
  function render() {
    return loadIntoView(content, {
      skeleton: 'dashboard',
      load: () => Promise.all([loadVocabulary(), loadGrammar(), loadKanji(), loadLessons()]),
      render: renderGrid,
      errorTitle: 'Dashboard ачаалагдсангүй.',
      errorDetail: `Энэ нь хичээл, үг, хэл зүй, ханзыг нэгтгэн харуулдаг бөгөөд эдгээрийн ядаж нэг нь ирсэнгүй. ${OFFLINE_HINT}`,
    });
  }

  await render();

  // Due counts, the streak, and practice history all change while the reader
  // is on another view — grading a card moves its due date, finishing a round
  // adds to the history. All of it is re-read on the way back in rather than
  // showing whatever was true the one time this ran at boot.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) === VIEW_ID) render();
  });
}

export { initDashboard };
