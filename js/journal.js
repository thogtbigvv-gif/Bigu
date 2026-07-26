/* ==========================================================================
   journal.js
   Daily journal for writing practice in Japanese plain form (普通形 /
   tameguchi). Renders the composer and entry history inside the #journal
   view and persists entries through storage.js's `journal` list store —
   this module never touches localStorage directly.
   ========================================================================== */

import { journal } from './storage.js';

const VIEW_ID = 'journal';

/* -- Plain-form (普通形) check ----------------------------------------------------
   A lightweight, encouraging nudge rather than a grammar checker: flags the
   most common polite-form (丁寧語) endings so the writer can notice and
   rephrase them in casual form. Longer markers are matched first and their
   character range is "claimed" so a marker like ませんでした isn't also
   double-counted as ません.
   ------------------------------------------------------------------------------ */
const POLITE_MARKERS = [
  'でございます', 'いらっしゃいます', 'ませんでした', 'ございます',
  'でしょうか', 'ましょうか', 'でしょう', 'ましょう',
  'ませんか', 'ください', 'いたします', 'なさいます',
  'ません', 'ました', 'でした',
  'です', 'ます',
].sort((a, b) => b.length - a.length);

function detectPoliteForms(text) {
  const claimed = new Array(text.length).fill(false);
  const found = [];

  for (const marker of POLITE_MARKERS) {
    let from = 0;
    let index;
    while ((index = text.indexOf(marker, from)) !== -1) {
      from = index + marker.length;
      const overlapsClaimed = claimed.slice(index, from).some(Boolean);
      if (!overlapsClaimed) {
        found.push(marker);
        claimed.fill(true, index, from);
      }
    }
  }

  return found;
}

function computeStats(text) {
  return { length: text.length, politeHits: detectPoliteForms(text) };
}

/** Verbose feedback for the composer, where there's room to name the markers. */
function describeStats({ length, politeHits }) {
  if (length === 0) return 'Nothing written yet';
  const countLabel = `${length} character${length === 1 ? '' : 's'}`;
  if (politeHits.length === 0) return `${countLabel} · all plain form ◎`;
  const unique = [...new Set(politeHits)];
  const markerLabel = `${politeHits.length} polite marker${politeHits.length === 1 ? '' : 's'} (${unique.join('、')})`;
  return `${countLabel} · ${markerLabel}`;
}

/** Compact feedback for the history list, where row space is tight. */
function summarizeStats({ length, politeHits }) {
  const countLabel = `${length} char${length === 1 ? '' : 's'}`;
  const markerLabel = politeHits.length === 0 ? 'plain ◎' : `${politeHits.length} polite`;
  return `${countLabel} · ${markerLabel}`;
}

/* -- Dates ------------------------------------------------------------------------ */

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
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

function formatDateLabel(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return dateLabelFormatter.format(new Date(y, m - 1, d));
}

function formatTimeLabel(timestamp) {
  return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function previewText(text, maxLength = 60) {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > maxLength ? `${collapsed.slice(0, maxLength)}…` : collapsed;
}

/* -- Entry lookup ------------------------------------------------------------------- */

function findEntryByDate(dateKey) {
  return journal.getAll().find((entry) => entry.date === dateKey) ?? null;
}

function entriesNewestFirst() {
  return journal.getAll().slice().sort((a, b) => b.date.localeCompare(a.date));
}

/* -- Calendar / heat-map computation -----------------------------------------------
   Pure date math for the journal calendar — no rendering yet, that lands in a
   follow-up pass. Builds a full month grid (padded to whole weeks) with each
   in-month day's saved entry (if any) attached, so a heat-map view can just
   read `hasEntry` / `stats` per cell without touching storage itself.
   ------------------------------------------------------------------------------ */

const WEEK_LENGTH = 7;

const monthLabelFormatter = new Intl.DateTimeFormat('en', { month: 'long', year: 'numeric' });

function daysInMonth(year, month) {
  return new Date(year, month + 1, 0).getDate();
}

function entriesByDateInMonth(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const map = new Map();
  for (const entry of journal.getAll()) {
    if (entry.date.startsWith(prefix)) map.set(entry.date, entry);
  }
  return map;
}

function emptyCell() {
  return { dateKey: null, day: null, inMonth: false, hasEntry: false, entry: null, stats: null, isToday: false };
}

/**
 * Builds one month's calendar as full weeks (Sun–Sat), padded with empty
 * cells before day 1 and after the last day so every row has exactly 7 cells.
 * `month` is 0-indexed, matching Date's convention.
 */
function buildMonthCalendar(year, month) {
  const entryMap = entriesByDateInMonth(year, month);
  const total = daysInMonth(year, month);
  const firstWeekday = new Date(year, month, 1).getDay();
  const todayStr = todayKey();

  const days = [];
  for (let i = 0; i < firstWeekday; i += 1) days.push(emptyCell());

  for (let day = 1; day <= total; day += 1) {
    const dateKey = toDateKey(new Date(year, month, day));
    const entry = entryMap.get(dateKey) ?? null;
    days.push({
      dateKey,
      day,
      inMonth: true,
      hasEntry: Boolean(entry),
      entry,
      stats: entry ? computeStats(entry.text) : null,
      isToday: dateKey === todayStr,
    });
  }

  while (days.length % WEEK_LENGTH !== 0) days.push(emptyCell());

  const weeks = [];
  for (let i = 0; i < days.length; i += WEEK_LENGTH) weeks.push(days.slice(i, i + WEEK_LENGTH));

  return {
    year,
    month,
    label: monthLabelFormatter.format(new Date(year, month, 1)),
    weeks,
    entryCount: entryMap.size,
  };
}

/** Returns the {year, month} that is `delta` months away from (year, month). */
function shiftMonth(year, month, delta) {
  const shifted = new Date(year, month + delta, 1);
  return { year: shifted.getFullYear(), month: shifted.getMonth() };
}

/* -- DOM builders --------------------------------------------------------------------
   Structure built with createElement/append (no innerHTML) so journal text —
   which is free-form user input — is always inserted as text, never markup.
   -------------------------------------------------------------------------------------- */

function createComposer() {
  const composer = document.createElement('div');
  composer.className = 'journal__composer';

  const head = document.createElement('div');
  head.className = 'journal__composer-head';

  const date = document.createElement('p');
  date.className = 'journal__date';

  const backToToday = document.createElement('button');
  backToToday.type = 'button';
  backToToday.className = 'journal__back';
  backToToday.textContent = '← Back to today';
  backToToday.hidden = true;

  head.append(date, backToToday);

  const hint = document.createElement('p');
  hint.className = 'journal__hint meta';
  hint.lang = 'ja';
  hint.textContent = '普通形で書いてみましょう。「です・ます」は使わずに。';

  const textarea = document.createElement('textarea');
  textarea.className = 'journal__textarea';
  textarea.lang = 'ja';
  textarea.rows = 12;
  textarea.spellcheck = false;
  textarea.placeholder = '今日は…';
  textarea.setAttribute('aria-label', 'Journal entry, written in plain form');

  const foot = document.createElement('div');
  foot.className = 'journal__composer-foot';

  const stats = document.createElement('p');
  stats.className = 'journal__stats meta';

  const actions = document.createElement('div');
  actions.className = 'journal__actions';

  const status = document.createElement('span');
  status.className = 'journal__save-status meta';
  status.setAttribute('aria-live', 'polite');

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'journal__save';
  saveButton.textContent = 'Save entry';

  actions.append(status, saveButton);
  foot.append(stats, actions);
  composer.append(head, hint, textarea, foot);

  return { composer, date, backToToday, textarea, stats, status, saveButton };
}

function createHistory() {
  const history = document.createElement('div');
  history.className = 'journal__history';

  const heading = document.createElement('h2');
  heading.className = 'journal__history-heading';
  heading.textContent = 'Past entries';

  const empty = document.createElement('p');
  empty.className = 'journal__empty meta';
  empty.textContent = 'Entries you save will appear here.';

  const list = document.createElement('ul');
  list.className = 'journal__entry-list';

  history.append(heading, empty, list);

  return { history, empty, list };
}

function createEntryItem(entry, { isActive, onSelect, onDelete }) {
  const item = document.createElement('li');
  item.className = 'journal__entry';
  if (isActive) item.classList.add('journal__entry--active');

  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'journal__entry-row';
  row.addEventListener('click', () => onSelect(entry));

  const dateEl = document.createElement('span');
  dateEl.className = 'journal__entry-date';
  dateEl.textContent = formatDateLabel(entry.date);

  const preview = document.createElement('span');
  preview.className = 'journal__entry-preview';
  preview.lang = 'ja';
  preview.textContent = previewText(entry.text);

  const meta = document.createElement('span');
  meta.className = 'journal__entry-meta meta';
  meta.textContent = summarizeStats(computeStats(entry.text));

  row.append(dateEl, preview, meta);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'journal__entry-delete';
  deleteButton.textContent = 'Delete';
  deleteButton.dataset.confirming = 'false';

  let confirmTimer = null;
  deleteButton.addEventListener('click', () => {
    if (deleteButton.dataset.confirming === 'true') {
      clearTimeout(confirmTimer);
      onDelete(entry);
      return;
    }
    deleteButton.dataset.confirming = 'true';
    deleteButton.textContent = 'Confirm?';
    confirmTimer = setTimeout(() => {
      deleteButton.dataset.confirming = 'false';
      deleteButton.textContent = 'Delete';
    }, 3000);
  });

  item.append(row, deleteButton);
  return item;
}

/* -- View controller -------------------------------------------------------------------
   `state` tracks whichever entry the composer currently represents: today's
   entry (new or existing) by default, or a past entry opened from the
   history list for review and revision.
   ----------------------------------------------------------------------------------------- */

function initJournalView(view) {
  const { composer, date, backToToday, textarea, stats, status, saveButton } = createComposer();
  const { history, empty, list } = createHistory();

  const wrapper = document.createElement('div');
  wrapper.className = 'journal';
  wrapper.append(composer, history);
  view.append(wrapper);

  const state = { date: todayKey(), entryId: null, savedText: '' };

  function refreshStats() {
    stats.textContent = describeStats(computeStats(textarea.value));
  }

  function syncSaveButton() {
    const hasText = textarea.value.trim().length > 0;
    const hasChanges = textarea.value !== state.savedText;
    saveButton.disabled = !(hasText && hasChanges);
  }

  function renderHeader() {
    date.textContent = formatDateLabel(state.date);
    backToToday.hidden = state.date === todayKey();
  }

  function renderHistory() {
    const entries = entriesNewestFirst();
    empty.hidden = entries.length > 0;
    list.replaceChildren(
      ...entries.map((entry) =>
        createEntryItem(entry, {
          isActive: entry.id === state.entryId,
          onSelect: openEntry,
          onDelete: deleteEntry,
        }),
      ),
    );
  }

  function loadInto(entry) {
    state.date = entry ? entry.date : todayKey();
    state.entryId = entry ? entry.id : null;
    state.savedText = entry ? entry.text : '';
    textarea.value = state.savedText;
    renderHeader();
    refreshStats();
    syncSaveButton();
    status.textContent = entry ? `Saved · ${formatTimeLabel(entry.updatedAt ?? entry.createdAt)}` : '';
  }

  function openEntry(entry) {
    loadInto(entry);
    renderHistory();
    textarea.focus();
  }

  function goToToday() {
    loadInto(findEntryByDate(todayKey()));
    renderHistory();
    textarea.focus();
  }

  function deleteEntry(entry) {
    const wasActive = entry.id === state.entryId;
    journal.remove(entry.id);
    if (wasActive) {
      loadInto(findEntryByDate(todayKey()));
    }
    renderHistory();
  }

  function saveEntry() {
    const text = textarea.value.trim();
    if (!text || text === state.savedText) return;

    const record = state.entryId
      ? journal.update(state.entryId, { text, date: state.date })
      : journal.add({ text, date: state.date });

    if (!record) {
      status.textContent = 'Could not save — check your browser storage settings.';
      return;
    }

    state.entryId = record.id;
    state.savedText = record.text;
    status.textContent = `Saved · ${formatTimeLabel(record.updatedAt ?? record.createdAt)}`;
    syncSaveButton();
    renderHistory();
  }

  textarea.addEventListener('input', () => {
    refreshStats();
    syncSaveButton();
    if (textarea.value !== state.savedText) status.textContent = 'Unsaved changes';
  });

  textarea.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      event.preventDefault();
      saveEntry();
    }
  });

  saveButton.addEventListener('click', saveEntry);
  backToToday.addEventListener('click', goToToday);

  loadInto(findEntryByDate(state.date));
  renderHistory();
}

function initJournal() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;
  initJournalView(view);
}

export { initJournal, buildMonthCalendar, shiftMonth };
