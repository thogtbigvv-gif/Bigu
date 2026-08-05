/* ==========================================================================
   dashboard.js
   Renders the #dashboard view. Pulls its data by importing each feature
   module's own loader (loadVocabulary, loadGrammar, loadKanji, loadLessons)
   rather than re-fetching with duplicated logic — the browser cache makes
   the repeat fetch free, and this is the one view whose whole job is
   summarizing the others.

   The view leads with what to do next, not with what was done. Everything
   here used to be retrospective — a streak, three progress bars, the last
   session's score — so a reader opening the app had to decide for
   themselves where to go, every single time, and that friction is what
   kills a daily habit. The Today card answers the question instead: what's
   due, and one button that starts it.

   Backup/restore used to be a fourth card here. It moved to Settings: this
   is a status surface, and an action that overwrites every store in the
   browser does not belong in a grid of stat cards.
   ========================================================================== */

import { progress, journal, practice } from './storage.js';
import { loadIntoView, OFFLINE_HINT } from './content.js';
import { countDue } from './review.js';
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
   entry was written, a review session was finished, or an item was marked
   learned. All three are already timestamped in storage, so this needs no
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

  for (const entry of entries) mark(entry.date, 'journal');
  for (const session of sessions) mark(toDateKey(new Date(session.createdAt)), 'review');
  for (const record of records) {
    if (record && record.lastSeen) mark(toDateKey(new Date(record.lastSeen)), 'learning');
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

function describeToday({ due, new: fresh }) {
  if (due > 0 && fresh > 0) {
    return `${due} ready to review, and ${fresh} you haven’t started yet.`;
  }
  if (due > 0) {
    return 'Scheduled by how well you knew them last time.';
  }
  if (fresh > 0) {
    return `Nothing due — ${fresh} item${fresh === 1 ? '' : 's'} you haven’t started yet.`;
  }
  return 'Everything is scheduled ahead. Nothing needs you today.';
}

function createTodayCard(counts) {
  const card = createCard('Today');
  // By class, not by grid position — see .dashboard-card--hero in dashboard.css.
  card.classList.add('dashboard-card--hero');

  const headline = document.createElement('p');
  headline.className = 'dashboard-streak__count';
  headline.textContent = String(counts.due);

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = counts.due === 1 ? 'item due' : 'items due';

  const detail = document.createElement('p');
  detail.className = 'dashboard-today__detail';
  detail.textContent = describeToday(counts);

  card.append(headline, label, detail);

  const cta = document.createElement('a');
  cta.href = '#practice';
  cta.className = 'dashboard-card__cta button';
  // Nothing due is not nothing to do — early review is still worth a button,
  // just a quieter one than the day's actual work.
  cta.classList.add(counts.due > 0 || counts.new > 0 ? 'button--primary' : 'button--secondary');
  cta.textContent = counts.due > 0 ? 'Start review' : 'Review early';
  card.append(cta);

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
  label.textContent = streak === 1 ? 'day streak' : 'days streak';

  // Names what today's activity actually was, so a streak counting three
  // kinds of study stays honest about which of them earned the day.
  const kinds = document.createElement('p');
  kinds.className = 'meta';
  kinds.textContent = days.has(today)
    ? `Today: ${[...days.get(today)].sort().join(' · ')}`
    : 'Reviewing, learning a word, or writing an entry all count.';

  const best = document.createElement('p');
  best.className = 'meta';
  best.textContent = `Best streak: ${longest} ${longest === 1 ? 'day' : 'days'}`;

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
    done.textContent = 'Today’s entry is written ✓';
    card.append(done);
  }

  return card;
}

function createProgressRow(label, stats) {
  const row = document.createElement('div');
  row.className = 'dashboard-stat';

  const head = document.createElement('div');
  head.className = 'dashboard-stat__head';

  const name = document.createElement('span');
  name.textContent = label;

  const fraction = document.createElement('span');
  fraction.className = 'meta';
  fraction.textContent = `${stats.learned} / ${stats.total}`;

  head.append(name, fraction);

  /* The track is a plain <div>, so without these it's decoration a screen
     reader steps over — the "12 / 14" line beside it is announced, but the
     bar itself carries no value. role + the three value attributes make it
     a real progress bar; aria-label names which deck it belongs to, since
     the adjacent label text isn't wired to it as an accessible name. */
  const track = document.createElement('div');
  track.className = 'dashboard-stat__track';
  track.setAttribute('role', 'progressbar');
  track.setAttribute('aria-label', `${label} learned`);
  track.setAttribute('aria-valuemin', '0');
  track.setAttribute('aria-valuemax', String(stats.total));
  track.setAttribute('aria-valuenow', String(stats.learned));
  track.setAttribute('aria-valuetext', `${stats.learned} of ${stats.total} learned`);

  const fill = document.createElement('div');
  fill.className = 'dashboard-stat__fill';
  const percent = stats.total === 0 ? 0 : Math.round((stats.learned / stats.total) * 100);
  fill.style.width = `${percent}%`;

  track.append(fill);
  row.append(head, track);
  return row;
}

function createProgressCard(stats) {
  const card = createCard('Progress');
  card.append(
    createProgressRow('Lessons', stats.lessons),
    createProgressRow('Vocabulary', stats.vocabulary),
    createProgressRow('Grammar', stats.grammar),
    createProgressRow('Kanji', stats.kanji),
  );
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
    empty.textContent = 'You haven’t reviewed yet.';
    card.append(empty);
  } else {
    const score = document.createElement('p');
    score.className = 'dashboard-streak__count';
    score.textContent = `${latest.correct} / ${latest.total}`;

    const modeLabel = PRACTICE_MODE_LABELS[latest.mode];
    const label = document.createElement('p');
    label.className = 'meta';
    label.textContent = modeLabel
      ? `marked "I knew it" · ${modeLabel} · ${formatSessionDate(latest.createdAt)}`
      : `marked "I knew it" · ${formatSessionDate(latest.createdAt)}`;

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

function getContentContainer(view) {
  let content = view.querySelector('.dashboard-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'dashboard-content';
    view.append(content);
  }
  return content;
}

/* The line under the page heading. Says the same thing as the Today card in
   one sentence, so the answer to "what now?" is readable before a single
   card is scanned. */
function renderHeroStatus(counts) {
  const status = document.getElementById('dashboard-status');
  if (!status) return;

  if (counts.due > 0) {
    status.textContent = `${counts.due} item${counts.due === 1 ? '' : 's'} due today.`;
  } else if (counts.new > 0) {
    status.textContent = 'Nothing due today — a good day to start something new.';
  } else {
    status.textContent = 'All caught up.';
  }
}

function renderGrid(container, [vocabData, grammarData, kanjiData, lessonData]) {
  const lessonWords = lessonData.flatMap((lesson) => lesson.words);

  const stats = {
    lessons: countDue(lessonWords),
    vocabulary: countDue(vocabData.words),
    grammar: countDue(grammarData.points),
    kanji: countDue(kanjiData.kanji),
  };

  // One combined figure across every deck: the reader's day isn't split by
  // content type, so neither is the number they're asked to act on.
  const totals = Object.values(stats).reduce(
    (sum, deck) => ({
      due: sum.due + deck.due,
      new: sum.new + deck.new,
      learned: sum.learned + deck.learned,
      total: sum.total + deck.total,
    }),
    { due: 0, new: 0, learned: 0, total: 0 },
  );

  renderHeroStatus(totals);

  const days = collectStudyDays({
    entries: journal.getAll(),
    sessions: practice.getAll(),
    records: Object.values(progress.getAll()),
  });

  const grid = document.createElement('div');
  grid.className = 'dashboard-grid';

  grid.append(
    createTodayCard(totals),
    createStreakCard(days, journal.getAll()),
    createProgressCard(stats),
    createPracticeCard(practice.getAll()),
  );

  container.replaceChildren(grid);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initDashboard() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  /* The dashboard waits on four fetches at once, so it's the view that
     stays blank longest on a cold cache — the skeleton matters most here. */
  function render() {
    return loadIntoView(content, {
      skeleton: 'dashboard',
      load: () => Promise.all([loadVocabulary(), loadGrammar(), loadKanji(), loadLessons()]),
      render: renderGrid,
      errorTitle: 'The dashboard didn’t load.',
      errorDetail: `It summarizes lessons, vocabulary, grammar, and kanji, and at least one of those didn’t arrive. ${OFFLINE_HINT}`,
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
