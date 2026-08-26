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

import { journal, practice, isAvailable as isStorageAvailable } from '../core/storage.js';
import {
  createStorageNotice,
  formatCount,
  getViewContainer,
  loadIntoView,
  OFFLINE_HINT,
} from '../ui/content.js';
import { dailyGoal } from '../core/preferences.js';
import { activeViewId } from '../core/router.js';
import { bandFor, countDue, FAINT_STRENGTH, snapshotRecords, strengthOf } from '../study/review.js';
import { loadVocabulary, loadGrammar, loadKanji, loadLessons } from '../data/catalogue.js';
import { DECK_LABELS } from '../study/decks.js';
import { collectStudyDays, computeStreak, toDateKey, todayKey } from '../study/streak.js';

const VIEW_ID = 'dashboard';

const dateLabelFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
});

function formatSessionDate(timestamp) {
  return dateLabelFormatter.format(new Date(timestamp));
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
    body: 'Lessons бол эхлэх зам — арван таван хичээл, тус бүр хэдхэн үгтэй. Харин чөлөөтэй эргүүлж үзмээр бол Vocabulary, Grammar, Kanji гурав хүлээж байна.',
  },
  {
    jp: '思い出す',
    title: 'Try to recall it',
    body: 'Review нь япон үгийг эхэлж үзүүлээд, утгыг нь харуулахаасаа өмнө тухайн үгийг асууна. Үнэнээр хариулаарай; давтах хуваарь тань оноогоор биш, таны хариултаар тогтоно.',
  },
  {
    jp: '薄れる',
    title: 'Watch the ink fade',
    body: 'Таны танилцсан үг бүр тэр агшнаасаа бүдгэрч эхэлнэ. Memory аль нь бүдгэрч байгааг харуулдаг — тиймээс богинохон орж ирсэн ч хийх үнэ цэнэтэй зүйл үргэлж байна.',
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
  heading.textContent = 'Ердөө гурван зүйл — аппын бүх учир нь тэр.';

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
    'Таны хийсэн бүхэн энэ хөтөч дотор үлдэж, төхөөрөмжөөс хэзээ ч гардаггүй. Хуулбар авмаар бол Settings дотор нэг товшилтоор нөөцлөх боломжтой.';

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
    return 'Өнгөрсөн удаад та хэр сайн мэдэж байснаар нь хуваарилагдсан — хамгийн эртнийх нь түрүүлнэ.';
  }
  if (fresh > 0) {
    return 'Давтах зүйл алга. Өнөөдөр шинэ үгтэй танилцахад тохиромжтой.';
  }
  return 'Бүгдийн давтах хугацаа хараахан болоогүй байна. Өнөөдөр таныг хүлээж буй юм алга.';
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
    ? `Өнөөдрийн зорилго биеллээ — ${reviewedToday} зүйл давтлаа.`
    : `Өнөөдөр ${reviewedToday} зүйл давтлаа — зорилт ${goal}.`;

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

  /* A phrase, not a figure. "14" over "давтах зүйл" was the app's largest
     number and the only one that described work owed rather than work done —
     and it grew on exactly the days the reader had least appetite for it.
     What is useful here is whether there is anything waiting at all, which is
     a two-state fact, so it is said in two words and set as text rather than
     in the tabular figure style the counts below it use. */
  const headline = document.createElement('p');
  headline.className = 'dashboard-today__headline';
  headline.textContent = counts.due > 0 ? 'Хэдэн зүйл' : 'Юм алга';

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = counts.due > 0 ? 'эргэж ирэхэд бэлэн' : 'өнөөдөр хүлээж буй';

  const detail = document.createElement('p');
  detail.className = 'dashboard-today__detail';
  detail.textContent = describeToday(counts);

  lead.append(headline, label, detail);
  if (goal > 0) lead.append(createGoalLine(reviewedToday, goal));

  const cta = document.createElement('a');
  cta.href = '#practice';
  cta.className = 'dashboard-card__cta button';
  /* Loud only when something is actually ready. The condition used to include
     counts.new, which meant a day with nothing waiting still got the app's
     most emphatic button — "Юм алга" and a primary CTA in the accent colour,
     on the same card, disagreeing about whether there was anything to do. */
  cta.classList.add(counts.due > 0 ? 'button--primary' : 'button--secondary');
  cta.textContent = counts.due > 0 ? 'Start review' : 'Review early';

  body.append(lead, cta);
  card.append(body);
  return card;
}

function createStreakCard(days, entries) {
  const card = createCard('Streak');
  const streak = computeStreak(days);
  const today = todayKey();
  const wroteToday = entries.some((entry) => entry.date === today);

  const count = document.createElement('p');
  count.className = 'dashboard-streak__count';
  count.textContent = String(streak);

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = 'өдөр дараалан';

  // Names what today's activity actually was, so a streak counting three
  // kinds of study stays honest about which of them earned the day.
  const kinds = document.createElement('p');
  kinds.className = 'meta';
  kinds.textContent = days.has(today)
    ? `Өнөөдөр: ${[...days.get(today)].sort().join(' · ')}`
    : 'Давтах, шинэ үг сурах, тэмдэглэл бичих — бүгд тооцогдоно.';

  /* No "longest streak" line, and no computeLongestStreak to feed it. A
     personal best is only ever readable as a measurement of the present
     against it: on the day a run of forty ends, "Хамгийн урт цуваа: 40 өдөр"
     sits under a 1 and says one thing. A streak in this app reports presence
     — the days that happened — and nothing about the days that did not.

     The journal door is unconditional for the same reason. It used to appear
     only when today had no entry, which made its presence the notification
     that something was missing. */
  card.append(count, label, kinds);

  const cta = document.createElement('a');
  cta.href = '#journal';
  cta.className = 'button button--secondary dashboard-card__cta';
  cta.textContent = 'Journal';
  card.append(cta);

  if (wroteToday) {
    const done = document.createElement('p');
    done.className = 'dashboard-card__status';
    done.textContent = 'Өнөөдрийн тэмдэглэл бичигдлээ ✓';
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
  label.textContent = 'санах ойд буй үг';

  const detail = document.createElement('p');
  detail.className = 'dashboard-today__detail';
  if (held === 0) {
    detail.textContent = 'Хараахан юу ч бичигдээгүй. Таны танилцсан үг бүр тэр агшнаасаа бүдгэрч эхэлнэ — түүнийг эндээс ажиглана.';
  } else {
    const band = bandFor(strengthTotal / held);
    /* No count of what has faded. Fading is what ink does in this app — it is
       the mechanism, not a backlog — and a figure attached to it turns the one
       screen that describes a natural process into a tally of neglect. */
    detail.textContent = fading > 0
      ? `Бэх нийтдээ ${band.label} байна. Заримынх нь бүдгэрчээ.`
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

   The names come from practice.js's own DECK_LABELS rather than a copy kept
   here. The copy had drifted: the deck the Review screen calls "Tricky ones"
   was labelled "Review mistakes" on this card, so one round appeared under
   two names depending on which screen the reader was looking at.
   -------------------------------------------------------------------------------------- */

function createPracticeCard(sessions) {
  const card = createCard('Last review');
  const latest = sessions.slice().sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  if (!latest) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'Дуусгасан давталт хараахан алга.';
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

    const modeLabel = DECK_LABELS[latest.mode];
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
    status.textContent = 'Япон хэлийг өдөрт хэдхэн үгээр, тайвнаар сурах орон зай.';
  } else if (counts.due > 0) {
    status.textContent = 'Эргэж ирэхэд бэлэн зүйл хүлээж байна.';
  } else if (counts.new > 0) {
    status.textContent = 'Өнөөдөр хүлээж буй юм алга — шинэ зүйл эхлэх сайхан өдөр.';
  } else {
    status.textContent = 'Өнөөдөр хүлээж буй юм алга.';
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

  /* The bridge's snapshot used to be published from right here, on the
     grounds that this was the one screen holding the figures across all four
     decks and the one screen every visit started on. The second half of that
     stopped being true: this view has no nav row and is off the entry path,
     so publishing from it meant the summer-project surface went stale the
     moment a reader stopped opening a screen they have no reason to open.
     js/app.js publishes at boot instead — see publishStatusSnapshot(), which
     lives in practice.js beside the pool it counts over. Nothing else about
     this view changed. */

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

  /* The snapshot taken above, not a second raw read of the same store. The
     raw records are whatever version wrote them — a pre-scheduling record
     has no firstSeen at all — where the snapshot is normalized, which is
     what the two dates below are read as. */
  const days = collectStudyDays({
    entries,
    sessions,
    records: records.values(),
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
      errorDetail: `Энэ нь хичээл, үг, хэл зүй, ханзыг нэгтгэн харуулдаг бөгөөд эдгээрийн ядаж нэг нь ирээгүй байна. ${OFFLINE_HINT}`,
    });
  }

  await render();

  // Due counts, the streak, and practice history all change while the reader
  // is on another view — grading a card moves its due date, finishing a round
  // adds to the history. All of it is re-read on the way back in rather than
  // showing whatever was true the one time this ran at boot.
  window.addEventListener('hashchange', () => {
    if (activeViewId() === VIEW_ID) render();
  });
}

export { initDashboard };
