/* ==========================================================================
   dashboard.js
   Renders the #dashboard view: a journal writing streak, learned/total
   progress across vocabulary/grammar/kanji, and the most recent practice
   session. Pulls its data by importing each feature module's own loader
   (loadVocabulary, loadGrammar, loadKanji) rather than re-fetching with
   duplicated logic — the browser cache makes the repeat fetch free, and
   this is the one view whose whole job is summarizing the others.
   ========================================================================== */

import { progress, journal, practice } from './storage.js';
import { loadVocabulary } from './vocabulary.js';
import { loadGrammar } from './grammar.js';
import { loadKanji } from './kanji.js';

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

/* -- Streak ---------------------------------------------------------------------------
   Counts the most recent unbroken run of days with a journal entry. If
   today has no entry yet, the count starts from yesterday instead — the
   streak isn't broken until a full day passes with nothing written.
   ------------------------------------------------------------------------------------------ */

function computeStreak(entries) {
  const days = new Set(entries.map((entry) => entry.date));
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

/* -- Progress ---------------------------------------------------------------------------- */

function countLearned(items) {
  const total = items.length;
  const learned = items.filter((item) => Boolean(progress.get(item.id)?.learned)).length;
  return { learned, total };
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

function createStreakCard(entries) {
  const card = createCard('Streak');
  const streak = computeStreak(entries);
  const wroteToday = entries.some((entry) => entry.date === todayKey());

  const count = document.createElement('p');
  count.className = 'dashboard-streak__count';
  count.textContent = String(streak);

  const label = document.createElement('p');
  label.className = 'meta';
  label.textContent = streak === 1 ? 'day streak' : 'day streak';

  const total = document.createElement('p');
  total.className = 'meta';
  total.textContent = `${entries.length} journal ${entries.length === 1 ? 'entry' : 'entries'} total`;

  card.append(count, label, total);

  if (!wroteToday) {
    const cta = document.createElement('a');
    cta.href = '#journal';
    cta.className = 'button button--primary dashboard-card__cta';
    cta.textContent = 'Write today\u2019s entry';
    card.append(cta);
  } else {
    const done = document.createElement('p');
    done.className = 'dashboard-card__status';
    done.textContent = 'Today\u2019s entry is written ✓';
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

  const track = document.createElement('div');
  track.className = 'dashboard-stat__track';

  const fill = document.createElement('div');
  fill.className = 'dashboard-stat__fill';
  const percent = stats.total === 0 ? 0 : Math.round((stats.learned / stats.total) * 100);
  fill.style.width = `${percent}%`;

  track.append(fill);
  row.append(head, track);
  return row;
}

function createProgressCard({ vocabulary, grammar, kanji }) {
  const card = createCard('Progress');
  card.append(
    createProgressRow('Vocabulary', vocabulary),
    createProgressRow('Grammar', grammar),
    createProgressRow('Kanji', kanji),
  );
  return card;
}

function createPracticeCard(sessions) {
  const card = createCard('Last practice');
  const latest = sessions.slice().sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;

  if (!latest) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'You haven\u2019t practiced yet.';
    card.append(empty);
  } else {
    const score = document.createElement('p');
    score.className = 'dashboard-streak__count';
    score.textContent = `${latest.correct} / ${latest.total}`;

    const label = document.createElement('p');
    label.className = 'meta';
    label.textContent = `marked "I knew it" · ${formatSessionDate(latest.createdAt)}`;

    card.append(score, label);
  }

  const cta = document.createElement('a');
  cta.href = '#practice';
  cta.className = 'button button--secondary dashboard-card__cta';
  cta.textContent = latest ? 'Practice again' : 'Start practice';
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

function renderError(container, message) {
  const p = document.createElement('p');
  p.className = 'meta';
  p.textContent = message;
  container.replaceChildren(p);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initDashboard() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  try {
    const [vocabData, grammarData, kanjiData] = await Promise.all([
      loadVocabulary(),
      loadGrammar(),
      loadKanji(),
    ]);

    const grid = document.createElement('div');
    grid.className = 'dashboard-grid';

    grid.append(
      createStreakCard(journal.getAll()),
      createProgressCard({
        vocabulary: countLearned(vocabData.words),
        grammar: countLearned(grammarData.points),
        kanji: countLearned(kanjiData.kanji),
      }),
      createPracticeCard(practice.getAll()),
    );

    content.replaceChildren(grid);
  } catch (error) {
    console.error('[Nagi]', error);
    renderError(content, 'Dashboard data could not be loaded right now.');
  }
}

export { initDashboard };
