/* ==========================================================================
   kanji.js
   Loads data/kanji.json and renders it as a grid inside the #kanji view.
   Same fetch-once/cache and progress-store mastery pattern as vocabulary.js
   and grammar.js; laid out as a grid instead of a list since a single
   character card carries far less content than a vocab or grammar card.
   ========================================================================== */

import { progress } from './storage.js';

const DATA_URL = 'data/kanji.json';
const VIEW_ID = 'kanji';

let cachedData = null;

/* -- Data --------------------------------------------------------------------------- */

async function loadKanji() {
  if (cachedData) return cachedData;

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load kanji (${response.status})`);
  }

  cachedData = await response.json();
  return cachedData;
}

/* -- Progress ------------------------------------------------------------------------- */

function isMastered(kanjiId) {
  return Boolean(progress.get(kanjiId)?.learned);
}

function setMastered(kanjiId, learned) {
  progress.set(kanjiId, { ...progress.get(kanjiId), learned });
}

/* -- Card building --------------------------------------------------------------------- */

function createReadings(entry) {
  const wrap = document.createElement('p');
  wrap.className = 'kanji-card__readings reading';
  wrap.lang = 'ja';

  const parts = [];
  if (entry.onyomi) parts.push(entry.onyomi);
  if (entry.kunyomi) parts.push(entry.kunyomi);
  wrap.textContent = parts.join(' ・ ');

  return wrap;
}

function createExample(example) {
  const wrap = document.createElement('div');
  wrap.className = 'kanji-card__example';

  const wordEl = document.createElement('ruby');
  wordEl.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = example.reading;
  wordEl.append(example.word, rt);

  const meaning = document.createElement('p');
  meaning.className = 'meta';
  meaning.textContent = example.meaning;

  wrap.append(wordEl, meaning);
  return wrap;
}

function createMasteryButton(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kanji-card__progress';

  const sync = () => {
    const mastered = isMastered(entry.id);
    button.setAttribute('aria-pressed', String(mastered));
    button.textContent = mastered ? 'Mastered ✓' : 'Mark as mastered';
  };

  button.addEventListener('click', () => {
    setMastered(entry.id, !isMastered(entry.id));
    sync();
  });

  sync();
  return button;
}

function createCard(entry, level) {
  const item = document.createElement('li');
  item.className = 'kanji-card';
  item.dataset.kanjiId = entry.id;

  const head = document.createElement('div');
  head.className = 'kanji-card__head';

  const character = document.createElement('p');
  character.className = 'kanji-card__character';
  character.lang = 'ja';
  character.textContent = entry.character;

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';
  tag.textContent = level;

  head.append(character, tag);

  const meaning = document.createElement('p');
  meaning.className = 'kanji-card__meaning';
  meaning.textContent = entry.meaning;

  item.append(head, meaning, createReadings(entry), createExample(entry.example), createMasteryButton(entry));
  return item;
}

/* -- Search/filter -------------------------------------------------------------------
   Same substring-match-and-hide approach as vocabulary.js/grammar.js —
   matches against the character, meaning, and both readings.
   -------------------------------------------------------------------------------------- */

function matchesQuery(entry, query) {
  if (!query) return true;
  const haystack = `${entry.character} ${entry.meaning} ${entry.onyomi ?? ''} ${entry.kunyomi ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

function createSearchField() {
  const wrap = document.createElement('div');
  wrap.className = 'kanji-search';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = 'kanji-search';
  label.textContent = 'Search kanji';

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'kanji-search';
  input.className = 'field';
  input.placeholder = 'Search by character, reading, or meaning';
  input.autocomplete = 'off';

  wrap.append(label, input);
  return { wrap, input };
}

/* -- Rendering ------------------------------------------------------------------------- */

function getContentContainer(view) {
  let content = view.querySelector('.kanji-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'kanji-content';
    view.append(content);
  }
  return content;
}

function renderGrid(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField();

  const summary = document.createElement('p');
  summary.className = 'kanji-meta meta';

  const grid = document.createElement('ul');
  grid.className = 'kanji-grid';
  const rows = data.kanji.map((entry) => ({ entry, item: createCard(entry, data.level) }));
  grid.append(...rows.map((row) => row.item));

  const empty = document.createElement('p');
  empty.className = 'meta kanji-empty';
  empty.textContent = 'No kanji match your search.';
  empty.hidden = true;

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const matches = matchesQuery(row.entry, query);
      row.item.hidden = !matches;
      if (matches) visible += 1;
    }
    summary.textContent = query
      ? `${data.level} · ${visible} / ${data.kanji.length} kanji`
      : `${data.level} · ${data.kanji.length} kanji`;
    empty.hidden = visible > 0;
  }

  searchInput.addEventListener('input', applyFilter);
  applyFilter();

  container.replaceChildren(searchWrap, summary, grid, empty);
}

function renderError(container, message) {
  const p = document.createElement('p');
  p.className = 'meta';
  p.textContent = message;
  container.replaceChildren(p);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initKanji() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  try {
    const data = await loadKanji();
    renderGrid(content, data);
  } catch (error) {
    console.error('[Nagi]', error);
    renderError(content, 'Kanji could not be loaded right now.');
  }
}

export { initKanji, loadKanji };
