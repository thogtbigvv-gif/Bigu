/* ==========================================================================
   settings.js
   Renders the #settings view: appearance, and the two-way JSON backup
   (download + restore) of everything in localStorage.

   Both used to live elsewhere — appearance only as the header's icon toggle,
   backup as a card in the Dashboard grid. The Dashboard is a status surface,
   and a restore that overwrites every store in the browser and reloads the
   page is the highest-consequence action in the app; sitting it among the
   lowest-consequence ones (a streak count, a progress bar) was a misfire.
   Settings is where a reader goes expecting to change things, so that is
   where the things that change everything belong.

   The header toggle stays as the one-tap switch. The control here is the
   fuller version of the same setting, including the "follow my system"
   option a two-state button can't express.
   ========================================================================== */

import { settings, progress, journal, practice } from './storage.js';
import { setThemePreference, themePreference, THEME_CHANGE_EVENT } from './theme.js';

const VIEW_ID = 'settings';

/* -- Appearance ------------------------------------------------------------------------- */

const THEME_OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];

function createAppearanceCard() {
  const card = createCard('Appearance', 'settings-appearance-heading');

  const description = document.createElement('p');
  description.className = 'meta';
  description.textContent =
    'System follows your device’s light/dark setting and changes with it through the day.';

  const group = document.createElement('div');
  group.className = 'settings__choice-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', 'settings-appearance-heading');

  /* data-theme-choice, not data-theme: variables.css keys the dark palette
     off [data-theme="dark"], and an attribute selector matches any element
     — so a button carrying data-theme="dark" became its own dark-theme
     scope and rendered in dark-mode ink on the light page. The token
     selectors are :root-scoped now as well, but the attribute still has no
     business being reused here. */
  const buttons = THEME_OPTIONS.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip';
    button.dataset.themeChoice = value;
    button.textContent = label;
    button.addEventListener('click', () => setThemePreference(value));
    group.append(button);
    return button;
  });

  // Reads the preference back rather than tracking its own state, so the
  // header toggle and this row can never disagree about what's selected.
  function sync() {
    const active = themePreference();
    for (const button of buttons) {
      button.setAttribute('aria-pressed', String(button.dataset.themeChoice === active));
    }
  }

  document.addEventListener(THEME_CHANGE_EVENT, sync);
  sync();

  card.append(description, group);
  return card;
}

/* -- Backup export ----------------------------------------------------------------------
   Everything this app knows lives only in this browser's localStorage, so
   there's no server copy to fall back on if a cache gets cleared. This
   bundles all four stores into one downloadable JSON file.
   ------------------------------------------------------------------------------------------ */

function todayKey() {
  const date = new Date();
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

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
  // The click starts the download asynchronously, so revoking in the same tick
  // can pull the blob out from under it before it's read. Freeing it on the
  // next turn of the event loop keeps the file intact.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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
  statusEl.classList.toggle('settings-backup__status--error', Boolean(isError));
}

function handleRestoreFile(file, statusEl, fileInput) {
  const reader = new FileReader();

  reader.onload = () => {
    let payload;
    try {
      payload = JSON.parse(String(reader.result));
    } catch {
      setRestoreStatus(statusEl, 'That file isn’t valid JSON.', true);
      fileInput.value = '';
      return;
    }

    if (!isValidBackupPayload(payload)) {
      setRestoreStatus(statusEl, 'That doesn’t look like a Bigu backup file.', true);
      fileInput.value = '';
      return;
    }

    const confirmed = window.confirm(
      'Restoring will overwrite all current progress, journal entries, and practice history in this browser. This can’t be undone. Continue?',
    );
    if (!confirmed) {
      setRestoreStatus(statusEl, 'Restore cancelled.', false);
      fileInput.value = '';
      return;
    }

    restoreBackup(payload);
    setRestoreStatus(statusEl, 'Backup restored. Reloading…', false);
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
  const card = createCard('Backup', 'settings-backup-heading');

  const description = document.createElement('p');
  description.className = 'meta';
  description.textContent =
    'Your progress lives only in this browser. Download a copy so clearing your cache or switching devices doesn’t lose it.';

  const downloadButton = document.createElement('button');
  downloadButton.type = 'button';
  downloadButton.className = 'button button--secondary';
  downloadButton.textContent = 'Download backup (.json)';
  downloadButton.addEventListener('click', downloadBackup);

  const restoreButton = document.createElement('button');
  restoreButton.type = 'button';
  restoreButton.className = 'button button--secondary';
  restoreButton.textContent = 'Restore from backup…';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;

  const status = document.createElement('p');
  status.className = 'meta settings-backup__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  restoreButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    if (file) handleRestoreFile(file, status, fileInput);
  });

  const warning = document.createElement('p');
  warning.className = 'settings-backup__warning';
  warning.textContent =
    'Restoring replaces everything already saved here — progress, journal, and review history — and can’t be undone.';

  const actions = document.createElement('div');
  actions.className = 'settings__actions';
  actions.append(downloadButton, restoreButton, fileInput, status);

  card.append(description, actions, warning);
  return card;
}

/* -- Rendering ------------------------------------------------------------------------- */

/* Each settings group is a .card with a real <h2>, not a styled <p> like the
   Dashboard's summary cards: these are document sections a reader navigates
   by heading, not tiles they glance at. */
function createCard(titleText, headingId) {
  const card = document.createElement('section');
  card.className = 'card settings__group';

  const title = document.createElement('h2');
  title.className = 'settings__group-title';
  title.id = headingId;
  title.textContent = titleText;

  card.setAttribute('aria-labelledby', headingId);
  card.append(title);
  return card;
}

function getContentContainer(view) {
  let content = view.querySelector('.settings-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'settings-content';
    view.append(content);
  }
  return content;
}

/* -- Init ---------------------------------------------------------------------------------- */

function initSettings() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  // No fetch here — everything on this screen reads localStorage, which is
  // synchronous, so there's nothing to show a skeleton for.
  getContentContainer(view).replaceChildren(createAppearanceCard(), createBackupCard());
}

export { initSettings };
