/* ==========================================================================
   settings.js
   Renders the #settings view: appearance, how a round is shaped, putting
   Bigu on the home screen, and the two-way JSON backup (download + restore)
   of everything in localStorage.

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

import { clearAll, isAvailable as isStorageAvailable } from '../core/storage.js';
import {
  backupFilename,
  buildBackupPayload,
  describeBackupProblem,
  restoreBackup,
} from '../core/backup.js';
import { setThemePreference, themePreference, THEME_CHANGE_EVENT } from '../core/theme.js';
import {
  installPlatform,
  installState,
  onInstallStateChange,
  promptInstall,
} from '../core/install.js';
import { createStorageNotice, getViewContainer } from '../ui/content.js';
import {
  DAILY_GOALS,
  SESSION_SIZES,
  dailyGoal,
  sessionSize,
  setDailyGoal,
  setSessionSize,
} from '../core/preferences.js';

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
    'Нэг давталтад хэдэн карт багтахыг заана. Богино давталтыг эхлүүлэхэд амархан бөгөөд сарын туршид энэ нь урт байхаас илүү чухал.';

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
    'Өнөөдөр хэдэн зүйл давтсаныг хөтлөх нэг мөрийг Dashboard дээр харуулна. Анхдагчаар унтраалттай — зорилт зарим хүнд тусалж, заримыг нь чимээгүйхэн шийтгэдэг тул Bigu үүнийг өөрөө тогтоохгүй.';

  const { group: goalGroup } = createChoiceRow({
    options: DAILY_GOALS.map((value) => ({ value, label: value === 0 ? 'No goal' : String(value) })),
    labelledBy: 'settings-daily-goal',
    read: dailyGoal,
    write: setDailyGoal,
  });

  card.append(sizeLabel, sizeNote, sizeGroup, goalLabel, goalNote, goalGroup);
  return card;
}

/* -- Install ------------------------------------------------------------------------
   Bigu is a daily habit or it is nothing, and a daily habit does not live
   behind a browser tab and a typed URL. On a home screen it opens in one
   tap, fills the screen the layout was actually designed for, and — because
   sw.js has the whole app cached — opens on a train with no signal at all.
   That is worth one card rather than leaving readers to find "Add to Home
   Screen" in a menu they have never opened.

   The card has three faces, and which one it shows is the browser's answer
   rather than ours (see js/core/install.js). Chrome hands over a real
   install event, so it gets a button. Safari has never implemented that
   event, so iOS gets the three taps written out. And inside the installed
   app there is nothing to offer, so it says so and stops.

   It redraws itself on the state changing, because all three transitions
   happen while the reader is looking at this screen: the event can arrive
   late, the install can complete in the browser's own UI, and a desktop
   install switches display-mode under the open page.
   ------------------------------------------------------------------------------------ */

const INSTALL_DESCRIPTION =
  'Bigu-г утасныхаа дэлгэц дээр нэмбэл нэг товшилтоор нээгдэж, хөтчийн мөргүйгээр бүтэн дэлгэцээр ажиллана. Нэмсний дараа интернэт байхгүй үед ч нээгдэнэ — бүх хичээл, үг, ханз, тэмдэглэл нь таны төхөөрөмж дээр хадгалагдсан байдаг.';

const IOS_STEPS = [
  'Доод талын Хуваалцах (Share) товчийг дарна.',
  '"Add to Home Screen" / "Нүүр дэлгэцэд нэмэх"-ийг сонгоно.',
  'Баруун дээд буланд "Add" гэж баталгаажуулна.',
];

const OTHER_HINT =
  'Хөтчийнхөө цэсийг нээгээд "Install app" эсвэл "Add to Home screen" гэснийг сонгоно уу. Зарим хөтөч хэсэг ашигласны дараа энэ боломжийг санал болгодог.';

function createInstallCard() {
  const card = createCard('Install', 'settings-install-heading');

  const description = document.createElement('p');
  description.className = 'meta';
  description.textContent = INSTALL_DESCRIPTION;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'button button--secondary';
  button.textContent = 'Install Bigu';

  const steps = document.createElement('ol');
  steps.className = 'settings-install__steps';
  for (const text of IOS_STEPS) {
    const item = document.createElement('li');
    item.textContent = text;
    steps.append(item);
  }

  const hint = document.createElement('p');
  hint.className = 'meta';
  hint.textContent = OTHER_HINT;

  const status = document.createElement('p');
  status.className = 'meta settings-install__status';
  status.setAttribute('aria-live', 'polite');
  status.hidden = true;

  /* Only the button is an action. The steps, the hint and the status line
     are prose about what to do next, and putting them inside
     .settings__actions gave the card a stack of paragraphs indented as if
     each were a control. */
  const actions = document.createElement('div');
  actions.className = 'settings__actions';
  actions.append(button);

  button.addEventListener('click', async () => {
    button.disabled = true;
    const outcome = await promptInstall();
    button.disabled = false;

    if (outcome === 'dismissed') {
      /* The browser's install event is spent once it has been answered, so
         the button goes with it and the hint underneath takes over. The
         line therefore points at the browser's own menu rather than at a
         button that is no longer there. */
      status.textContent = 'Одоохондоо нэмсэнгүй. Хөтчийн цэснээс хэдийд ч нэмж болно.';
      status.hidden = false;
    }
    /* 'accepted' needs no line of its own: the browser installs, fires
       appinstalled, and sync() below replaces the whole card with the
       sentence that says it is done. */
  });

  function sync() {
    const state = installState();
    const platform = installPlatform();

    button.hidden = state !== 'ready';
    // …and the row with it, or an empty flex box keeps its own margin.
    actions.hidden = button.hidden;
    steps.hidden = !(state === 'unavailable' && platform === 'ios');
    hint.hidden = !(state === 'unavailable' && platform !== 'ios');

    if (state === 'installed') {
      description.textContent =
        'Bigu суулгагдсан байна. Интернэтгүй үед ч нээгдэх ба шинэчлэлт нь дараагийн нээлтэд өөрөө ирнэ.';
      status.hidden = true;
    } else {
      description.textContent = INSTALL_DESCRIPTION;
    }
  }

  sync();
  onInstallStateChange(sync);

  card.append(description, actions, steps, hint, status);
  return card;
}

/* -- Backup export ----------------------------------------------------------------------
   Everything this app knows lives only in this browser's localStorage, so
   there's no server copy to fall back on if a cache gets cleared. The file
   itself — what goes in it, and what makes an arriving one valid — is
   core/backup.js. What is left here is the part that needs a document:
   turning the payload into a download, and reading a chosen file back.
   ------------------------------------------------------------------------------------------ */

function downloadBackup() {
  const payload = buildBackupPayload();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.href = url;
  link.download = backupFilename();
  document.body.append(link);
  link.click();
  link.remove();
  // The click starts the download asynchronously, so revoking in the same tick
  // can pull the blob out from under it before it's read. Freeing it on the
  // next turn of the event loop keeps the file intact.
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

/* -- Backup restore ---------------------------------------------------------------------
   Read a previously-downloaded JSON file, check it, then overwrite
   everything in localStorage in one go. This is destructive, so it always
   asks for confirmation before touching a single key, and the page reloads
   afterward so every view (not just this one) picks up the restored data
   instead of running with whatever it already had in memory.
   ------------------------------------------------------------------------------------------ */

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

    const problem = describeBackupProblem(payload);
    if (problem) {
      setRestoreStatus(statusEl, problem, true);
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
    setRestoreStatus(statusEl, 'Файлыг уншиж чадсангүй.', true);
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
    'Энэ хөтөчид хадгалагдсан бүхнийг устгана: давтах хуваарь, санах ой, хадгалсан үгс, тэмдэглэл, давталтын түүх, эдгээр тохиргоо. Буцаах боломжгүй бөгөөд өөр хаана ч хуулбар байхгүй — хэрэгтэй болох магадлал байвал эхлээд нөөцөө татаж авна уу.';

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
     studies, where it lives, how to keep a copy, how to let go of
     everything. The one destructive action on this screen is last, which is
     both the conventional place for it and the furthest point from where a
     reader lands. */
  const sections = [
    createAppearanceCard(),
    createStudyCard(),
    createInstallCard(),
    createBackupCard(),
    createResetCard(),
  ];

  if (!isStorageAvailable()) sections.unshift(createStorageNotice());

  // No fetch here — everything on this screen reads localStorage, which is
  // synchronous, so there's nothing to show a skeleton for.
  getViewContainer(view, 'settings-content').replaceChildren(...sections);
}

export { initSettings };
