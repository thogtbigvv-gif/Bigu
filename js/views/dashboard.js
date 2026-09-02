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
import { createFirstRun, isFirstVisit } from '../ui/firstRun.js';
import { activeViewId } from '../core/router.js';
import { bandFor, countDue, FAINT_STRENGTH, snapshotRecords, strengthOf } from '../study/review.js';
import { loadVocabulary, loadGrammar, loadKanji, loadLessons } from '../data/catalogue.js';
import { DECK_LABELS } from '../study/decks.js';
import { collectStudyDays, computeStreak, todayKey } from '../study/streak.js';

const VIEW_ID = 'dashboard';

const dateLabelFormatter = new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
});

function formatSessionDate(timestamp) {
  return dateLabelFormatter.format(new Date(timestamp));
}

/* -- Card builders --------------------------------------------------------------------------
   Each card reuses the generic .card surface from cards.css — the
   dashboard is the one view that's purely a summary of the others, so
   there's no reason to define its own card chrome from scratch.
   -------------------------------------------------------------------------------------------------- */

/* The one card left on this screen. It names itself in the same tracked label
   voice the three panels below use — one voice for "what this block is",
   across a view that otherwise now has two kinds of block in it. A bold 20px
   heading here and small caps three inches below it were two answers to the
   same question. */
function createCard(titleText) {
  const card = document.createElement('div');
  card.className = 'card';

  const title = document.createElement('p');
  title.className = 'dashboard-panel__label';
  title.textContent = titleText;

  card.append(title);
  return card;
}

/* The other three, and they are not cards.

   This screen used to be four of the same object: same surface, same border,
   same padding, same recipe inside — a bold title, a figure, a line under it
   and an outlined button at the foot. Four boxes in a row is the shape of a
   settings page, and it flattened a view that has one thing to say and three
   footnotes to it into four things of equal weight.

   So only the one card that carries today's action is still a card. These sit
   directly on the page, separated by a hairline and by space, in the same
   rule-not-box language Home uses between its desk and its shelf and Memory
   uses between its sentence and its week. Nothing about what they report has
   changed: same three figures, same three sentences, same three doors.

   The title comes down to a tracked label as it comes out of its box, because
   an open block does not need a bold heading to be found — the figure under it
   is already the loudest thing in the column, and a 20px bold title above a
   39px figure was two headings arguing. */
function createPanel(titleText) {
  const panel = document.createElement('div');
  panel.className = 'dashboard-panel';

  const title = document.createElement('p');
  title.className = 'dashboard-panel__label';
  title.textContent = titleText;

  panel.append(title);
  return panel;
}

/* The door out of a panel. A way link (buttons.css) rather than the outlined
   button this used to be: three bordered rectangles stacked down a phone
   screen were the most form-like thing in the app, and the app already has a
   settled treatment for "this leads on to something" — the short rule that
   grows toward the label, which Home wears on exactly the same kind of link. */
function createPanelWay(href, label) {
  const way = document.createElement('a');
  way.className = 'way-link dashboard-panel__way';
  way.href = href;
  way.textContent = label;
  return way;
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

/* The daily-goal line used to be rendered here, inside this card. It moved
   to the Review screen with the rest of what this view was still holding
   for a reader who cannot reach it: a goal is set in Settings and reported
   on the screen where rounds are actually run, not on one with no nav row.
   See createGoalLine in js/views/practice.js. */

function createTodayCard(counts) {
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
  const card = createPanel('Streak');
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

  /* Before the door, not after it. The remark is part of what this panel
     reports; the way out is the last thing in every panel on the screen, and
     the three of them line up along one baseline only if nothing follows. */
  if (wroteToday) {
    const done = document.createElement('p');
    done.className = 'dashboard-card__status';
    done.textContent = 'Өнөөдрийн тэмдэглэл бичигдлээ ✓';
    card.append(done);
  }

  card.append(createPanelWay('#journal', 'Journal'));

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
  const card = createPanel('Memory');
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

  card.append(count, label, detail, createPanelWay('#memory', held === 0 ? 'See how it works' : 'Open memory'));
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
  const card = createPanel('Last review');
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

  card.append(createPanelWay('#practice', latest ? 'Review again' : 'Start review'));

  return card;
}

/* -- Rendering ------------------------------------------------------------------------- */

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
    /* Built by js/ui/firstRun.js, which Home draws too. The card surface is
       added here rather than there: this screen is a grid of cards, Home is
       a page with no boxes on it, and the explanation is the same either
       way. */
    const welcome = createFirstRun();
    welcome.classList.add('card');
    container.replaceChildren(...notices, welcome);
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
    createTodayCard(totals),
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
