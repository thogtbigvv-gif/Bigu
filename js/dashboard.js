/* ==========================================================================
   dashboard.js
   Renders the #dashboard view: a journal writing streak (current + best),
   learned/total progress across vocabulary/grammar/kanji, the most recent
   practice session, and a two-way JSON backup (download + restore) of
   everything in localStorage. Pulls its data by importing each feature
   module's own loader
   (loadVocabulary, loadGrammar, loadKanji) rather than re-fetching with
   duplicated logic — the browser cache makes the repeat fetch free, and
   this is the one view whose whole job is summarizing the others.
   ========================================================================== */

import { progress, journal, practice, settings } from './storage.js';
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

/**
 * Longest unbroken run of consecutive-day entries anywhere in the journal's
 * history, not just the one ending today — a personal best that survives a
 * broken streak, shown next to the current one so a lapse doesn't erase it.
 */
function computeLongestStreak(entries) {
  const days = [...new Set(entries.map((entry) => entry.date))].sort();
  if (days.length === 0) return 0;

  let longest = 1;
  let current = 1;

  for (let i = 1; i < days.length; i += 1) {
    const diffDays = Math.round((new Date(days[i]) - new Date(days[i - 1])) / 86400000);
    current = diffDays === 1 ? current + 1 : 1;
    longest = Math.max(longest, current);
  }

  return longest;
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
  const longest = computeLongestStreak(entries);
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

  const best = document.createElement('p');
  best.className = 'meta';
  best.textContent = `Best streak: ${longest} ${longest === 1 ? 'day' : 'days'}`;

  card.append(count, label, total, best);

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

/* -- Practice session labels ----------------------------------------------------------
   practice.js tags each saved session with the deck it was drawn from
   (vocabulary/grammar/kanji); older sessions saved before that existed
   simply have no `mode` field, so the label is omitted for those.
   -------------------------------------------------------------------------------------- */
const PRACTICE_MODE_LABELS = { vocabulary: 'Vocabulary', grammar: 'Grammar', kanji: 'Kanji' };

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
  cta.textContent = latest ? 'Practice again' : 'Start practice';
  card.append(cta);

  return card;
}

/* -- Backup export ----------------------------------------------------------------------
   Everything this app knows lives only in this browser's localStorage, so
   there's no server copy to fall back on if a cache gets cleared. This
   bundles all four stores into one downloadable JSON file.
   ------------------------------------------------------------------------------------------ */

function buildBackupPayload() {
  return {
    app: 'Bigu',
    exportedAt: new Date().toISOString(),
    data: {
      settings: settings.getAll(),
      progress: progress.getAll(),
      journal: journal.getAll(),
      practice: practice.getAll(),
    },
  };
}

function downloadBackup() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = `bigu-backup-${todayKey()}.json`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* -- Backup restore ---------------------------------------------------------------------
   The reverse of the export above: read a previously-downloaded JSON file,
   confirm it's actually a Bigu backup with all four stores present, then
   overwrite everything in localStorage in one go. This is destructive, so
   it always asks for confirmation before touching a single key, and the
   page reloads afterward so every view (not just this one) picks up the
   restored data instead of running with whatever it already had in memory.
   ------------------------------------------------------------------------------------------ */

function isValidBackupPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  if (payload.app !== 'Bigu') return false;
  const data = payload.data;
  if (!data || typeof data !== 'object') return false;
  return ['settings', 'progress', 'journal', 'practice'].every((storeKey) => storeKey in data);
}

function restoreBackup(payload) {
  const { data } = payload;
  settings.replaceAll(data.settings);
  progress.replaceAll(data.progress);
  journal.replaceAll(data.journal);
  practice.replaceAll(data.practice);
}

function setRestoreStatus(statusEl, message, isError) {
  statusEl.textContent = message;
  statusEl.hidden = false;
  statusEl.classList.toggle('dashboard-backup__status--error', Boolean(isError));
}

function handleRestoreFile(file, statusEl, fileInput) {
  const reader = new FileReader();

  reader.onload = () => {
    let payload;
    try {
      payload = JSON.parse(String(reader.result));
    } catch {
      setRestoreStatus(statusEl, 'That file isn\u2019t valid JSON.', true);
      fileInput.value = '';
      return;
    }

    if (!isValidBackupPayload(payload)) {
      setRestoreStatus(statusEl, 'That doesn\u2019t look like a Bigu backup file.', true);
      fileInput.value = '';
      return;
    }

    const confirmed = window.confirm(
      'Restoring will overwrite all current progress, journal entries, and practice history in this browser. This can\u2019t be undone. Continue?',
    );
    if (!confirmed) {
      setRestoreStatus(statusEl, 'Restore cancelled.', false);
      fileInput.value = '';
      return;
    }

    restoreBackup(payload);
    setRestoreStatus(statusEl, 'Backup restored. Reloading\u2026', false);
    fileInput.value = '';
    window.setTimeout(() => location.reload(), 700);
  };

  reader.onerror = () => {
    setRestoreStatus(statusEl, 'Could not read that file.', true);
    fileInput.value = '';
  };

  reader.readAsText(file);
}

function createBackupCard() {
  const card = createCard('Backup');

  const description = document.createElement('p');
  description.className = 'meta';
  description.textContent =
    'Your progress lives only in this browser. Download a copy so clearing your cache or switching devices doesn\u2019t lose it.';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'button button--secondary';
  downloadButton.textContent = 'Download backup (.json)';
  downloadButton.addEventListener('click', downloadBackup);

  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'button button--secondary';
  restoreButton.textContent = 'Restore from backup\u2026';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  const status = document.createElement('p');
  status.className = 'meta dashboard-backup__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  restoreButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleRestoreFile(file, status, fileInput);
  });

  const actions = document.createElement('div');
  actions.className = 'dashboard-backup__actions';
  actions.append(downloadButton, restoreButton, fileInput, status);

  card.append(description, actions);
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

  async function render() {
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
        createBackupCard(),
      );

      content.replaceChildren(grid);
    } catch (error) {
      console.error('[Bigu]', error);
      renderError(content, 'Dashboard data could not be loaded right now.');
    }
  }

  await render();

  // Progress, streak, and practice history can all change while looking at
  // a different view (marking a word learned, finishing a practice round),
  // so re-render with fresh data every time the reader navigates back here
  // instead of showing whatever was true the one time this ran at boot.
  window.addEventListener('hashchange', () => {
    if (location.hash.slice(1) === VIEW_ID) render();
  });
}

export { initDashboard };
