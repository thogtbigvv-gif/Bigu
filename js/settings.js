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

import {
  settings,
  progress,
  journal,
  practice,
  favorites,
  clearAll,
  isAvailable as isStorageAvailable,
} from './storage.js';
import { setThemePreference, themePreference, THEME_CHANGE_EVENT } from './theme.js';
import { createStorageNotice, getViewContainer } from './content.js';
import {
  DAILY_GOALS,
  SESSION_SIZES,
  dailyGoal,
  sessionSize,
  setDailyGoal,
  setSessionSize,
} from './preferences.js';

const VIEW_ID = 'settings';

/* -- A row of mutually exclusive chips ---------------------------------------------
   Appearance was the only setting here, and it built its own chip group
   inline. Three settings later that would be three copies of the same
   twelve lines, so the group is a builder: options in, a sync() that reads
   the current value back out of wherever it actually lives, and one
   pressed chip.

   sync() reads rather than tracks, deliberately — the same reason the
   appearance row already did. Two controls over one piece of state (the
   header's theme toggle and this row) can't disagree if neither of them
   remembers anything.
   ------------------------------------------------------------------------------------ */
function createChoiceRow({ options, labelledBy, read, write }) {
  const group = document.createElement('div');
  group.className = 'settings__choice-group';
  group.setAttribute('role', 'group');
  group.setAttribute('aria-labelledby', labelledBy);

  const buttons = options.map(({ value, label }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip';
    button.textContent = label;
    button.addEventListener('click', () => {
      write(value);
      sync();
    });
    group.append(button);
    return { button, value };
  });

  function sync() {
    const active = read();
    for (const { button, value } of buttons) {
      button.setAttribute('aria-pressed', String(value === active));
    }
  }

  sync();
  return { group, sync };
}

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
    'System нь таны төхөөрөмжийн гэрэл/харанхуй тохиргоог дагаж, өдрийн турш түүнтэй хамт өөрчлөгдөнө.';

  const { group, sync } = createChoiceRow({
    options: THEME_OPTIONS,
    labelledBy: 'settings-appearance-heading',
    read: themePreference,
    write: setThemePreference,
  });

  // The theme can also change from the header toggle and from the OS, so
  // this row listens as well as reads.
  document.addEventListener(THEME_CHANGE_EVENT, sync);

  card.append(description, group);
  return card;
}

/* -- Studying -----------------------------------------------------------------------
   Two things that used to be decided for the reader: how long a round is
   (a constant of 10 in practice.js) and whether there is a daily target at
   all (there wasn't one).

   Both are here rather than on the Review screen because they describe how
   the app should behave, not what to do next — and a control that changes
   the shape of every future session does not belong beside the button that
   starts this one.
   ------------------------------------------------------------------------------------ */
function createStudyCard() {
  const card = createCard('Studying', 'settings-study-heading');

  const sizeLabel = document.createElement('h3');
  sizeLabel.className = 'settings__field-label';
  sizeLabel.id = 'settings-session-size';
  sizeLabel.textContent = 'Cards per round';

  const sizeNote = document.createElement('p');
  sizeNote.className = 'meta';
  sizeNote.textContent =
    'Нэг давталтад хэдэн карт багтахыг заана. Богино давталт эхлэхэд амархан бөгөөд сарын хугацаанд урт эсэхээс илүү чухал.';

  const { group: sizeGroup } = createChoiceRow({
    options: SESSION_SIZES.map((value) => ({ value, label: String(value) })),
    labelledBy: 'settings-session-size',
    read: sessionSize,
    write: setSessionSize,
  });

  const goalLabel = document.createElement('h3');
  goalLabel.className = 'settings__field-label';
  goalLabel.id = 'settings-daily-goal';
  goalLabel.textContent = 'Daily goal';

  const goalNote = document.createElement('p');
  goalNote.className = 'meta';
  goalNote.textContent =
    'Өнөөдөр хэдэн зүйл давтсаныг хөтлөх нэг мөрийг Dashboard дээр харуулна. Анхдагчаар унтраалттай — зорилт зарим хүнд тусалж, заримыг нь чимээгүйхэн шийтгэдэг тул Bigu өөрөө таамаглахгүй.';

  const { group: goalGroup } = createChoiceRow({
    options: DAILY_GOALS.map((value) => ({ value, label: value === 0 ? 'No goal' : String(value) })),
    labelledBy: 'settings-daily-goal',
    read: dailyGoal,
    write: setDailyGoal,
  });

  card.append(sizeLabel, sizeNote, sizeGroup, goalLabel, goalNote, goalGroup);
  return card;
}

/* -- Backup export ----------------------------------------------------------------------
   Everything this app knows lives only in this browser's localStorage, so
   there's no server copy to fall back on if a cache gets cleared. This
   bundles all five stores into one downloadable JSON file.
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
      favorites: favorites.getAll(),
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
   confirm it's actually a Bigu backup with the core stores present, then
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
  // Four required, not five: `favorites` arrived after this format did, and
  // a backup downloaded before it existed is still a perfectly good backup.
  // Requiring the new key would have rejected every file already on disk.
  return ['settings', 'progress', 'journal', 'practice'].every((storeKey) => storeKey in data);
}

function restoreBackup(payload) {
  const { data } = payload;
  settings.replaceAll(data.settings);
  progress.replaceAll(data.progress);
  journal.replaceAll(data.journal);
  practice.replaceAll(data.practice);
  // Absent in pre-favorites backups; replaceAll's own guard turns undefined
  // into an empty map, which is the correct reading of "this file predates
  // keeping things".
  favorites.replaceAll(data.favorites);
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
      setRestoreStatus(statusEl, 'Энэ файл зөв JSON биш байна.', true);
      fileInput.value = '';
      return;
    }

    if (!isValidBackupPayload(payload)) {
      setRestoreStatus(statusEl, 'Энэ нь Bigu-гийн нөөц файл шиг харагдахгүй байна.', true);
      fileInput.value = '';
      return;
    }

    const confirmed = window.confirm(
      'Сэргээх нь энэ хөтөч дэх бүх ахиц, тэмдэглэл, давталтын түүхийг дарж бичнэ. Үүнийг буцаах боломжгүй. Үргэлжлүүлэх үү?',
    );
    if (!confirmed) {
      setRestoreStatus(statusEl, 'Сэргээхийг цуцаллаа.', false);
      fileInput.value = '';
      return;
    }

    restoreBackup(payload);
    setRestoreStatus(statusEl, 'Нөөцөөс сэргээлээ. Дахин ачаалж байна…', false);
    fileInput.value = '';
    window.setTimeout(() => location.reload(), 700);
  };

  reader.onerror = () => {
    setRestoreStatus(statusEl, 'Тэр файлыг уншиж чадсангүй.', true);
    fileInput.value = '';
  };

  reader.readAsText(file);
}

function createBackupCard() {
  const card = createCard('Backup', 'settings-backup-heading');

  const description = document.createElement('p');
  description.className = 'meta';
  description.textContent =
    'Таны ахиц зөвхөн энэ хөтөч дотор байдаг. Кэшээ цэвэрлэх юм уу төхөөрөмжөө сольсон ч алдагдахгүйн тулд хуулбар татаж авна уу.';

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
    'Сэргээх нь энд хадгалагдсан бүхнийг — ахиц, тэмдэглэл, давталтын түүхийг — орлуулах бөгөөд буцаах боломжгүй.';

  const actions = document.createElement('div');
  actions.className = 'settings__actions';
  actions.append(downloadButton, restoreButton, fileInput, status);

  card.append(description, actions, warning);
  return card;
}

/* -- Start over -------------------------------------------------------------------------
   storage.js has had a clearAll() since it was written and nothing has ever
   called it — the app could restore over your data but never let go of it.
   That gap shows up in two ordinary situations: a reader who tried the app,
   left it a year, and wants to begin again rather than face a thousand
   overdue items; and anyone handing the browser to someone else.

   Two confirmations, because there is no undo and no server copy. The first
   is the button turning into its own confirmation — the same pattern the
   journal's delete already uses, so the app asks twice in one voice — and
   the second is the browser's own dialog naming what goes. The offer to
   download a backup first sits directly above it, which is the actual
   answer for most people who click this.
   ------------------------------------------------------------------------------------------ */

function createResetCard() {
  const card = createCard('Start over', 'settings-reset-heading');

  const description = document.createElement('p');
  description.className = 'meta';
  description.textContent =
    'Энэ хөтөчид хадгалагдсан бүхнийг устгана: давтах хуваарь, санах ой, хадгалсан үгс, тэмдэглэл, хичээллэлтийн түүх, эдгээр тохиргоо. Буцаах боломжгүй бөгөөд өөр хаана ч хуулбар байхгүй — хэрэгтэй болох магадлал байвал эхлээд нөөцөө татаж авна уу.';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--secondary settings-reset__button';
  button.textContent = 'Erase everything…';

  const status = document.createElement('p');
  status.className = 'meta settings-backup__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  let armed = false;
  let disarmTimer = null;

  function disarm() {
    armed = false;
    button.textContent = 'Erase everything…';
    button.classList.remove('is-armed');
  }

  button.addEventListener('click', () => {
    if (!armed) {
      armed = true;
      button.textContent = 'Erase everything — are you sure?';
      button.classList.add('is-armed');
      // Disarms itself, so a stray click never leaves a loaded button
      // sitting on the page waiting for the next one.
      disarmTimer = window.setTimeout(disarm, 5000);
      return;
    }

    window.clearTimeout(disarmTimer);
    const confirmed = window.confirm(
      'Энэ хөтөч дэх Bigu-гийн бүх өгөгдлийг устгах уу? Таны хуваарь, санах ой, хадгалсан үгс, тэмдэглэл, түүх бүгд алга болох ба үүнийг буцаах боломжгүй.',
    );

    if (!confirmed) {
      disarm();
      status.textContent = 'Юу ч устгаагүй.';
      status.hidden = false;
      return;
    }

    clearAll();
    status.textContent = 'Бүгдийг устгалаа. Шинээр эхэлж байна…';
    status.hidden = false;
    button.disabled = true;
    // Reload rather than re-render: every view holds its own already-built
    // DOM and its own idea of the reader's progress, and only a fresh boot
    // puts all of them back to a true first visit.
    window.setTimeout(() => location.reload(), 700);
  });

  card.append(description, button, status);
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

/* -- Init ---------------------------------------------------------------------------------- */

function initSettings() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  /* Order runs from the everyday to the irreversible: how it looks, how it
     studies, how to keep a copy, how to let go of everything. The one
     destructive action on this screen is last, which is both the
     conventional place for it and the furthest point from where a reader
     lands. */
  const sections = [
    createAppearanceCard(),
    createStudyCard(),
    createBackupCard(),
    createResetCard(),
  ];

  if (!isStorageAvailable()) sections.unshift(createStorageNotice());

  // No fetch here — everything on this screen reads localStorage, which is
  // synchronous, so there's nothing to show a skeleton for.
  getViewContainer(view, 'settings-content').replaceChildren(...sections);
}

export { initSettings };
