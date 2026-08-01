/* ==========================================================================
   grammar.js
   Loads data/grammar.json and renders it as a list inside the #grammar
   view. Follows vocabulary.js's shape: same fetch-once/cache pattern, same
   progress-store mastery toggle, same createElement/append DOM building —
   only the card fields differ.
   ========================================================================== */

import { progress } from './storage.js';

const DATA_URL = 'data/grammar.json';
const VIEW_ID = 'grammar';

let cachedData = null;

/* -- Data --------------------------------------------------------------------------- */

async function loadGrammar() {
  if (cachedData) return cachedData;

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load grammar (${response.status})`);
  }

  cachedData = await response.json();
  return cachedData;
}

/* -- Progress ------------------------------------------------------------------------- */

function isMastered(pointId) {
  return Boolean(progress.get(pointId)?.learned);
}

function setMastered(pointId, learned) {
  progress.set(pointId, { ...progress.get(pointId), learned });
}

/* -- Card building --------------------------------------------------------------------- */

function createPatternHeading(point) {
  const heading = document.createElement('p');
  heading.className = 'grammar-card__pattern';
  heading.lang = 'ja';

  if (point.patternKana) {
    const ruby = document.createElement('ruby');
    const rt = document.createElement('rt');
    rt.textContent = point.patternKana;
    ruby.append(point.pattern, rt);
    heading.append('〜', ruby);
  } else {
    heading.textContent = `〜${point.pattern}`;
  }

  return heading;
}

function createExample(example) {
  const wrap = document.createElement('div');
  wrap.className = 'grammar-card__example';

  const jp = document.createElement('p');
  jp.lang = 'ja';
  jp.textContent = example.jp;

  const reading = document.createElement('p');
  reading.className = 'reading';
  reading.lang = 'ja';
  reading.textContent = example.reading;

  const translation = document.createElement('p');
  translation.className = 'meta';
  translation.textContent = example.en;

  wrap.append(jp, reading, translation);
  return wrap;
}

function createMasteryButton(point) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip grammar-card__progress';

  const sync = () => {
    const mastered = isMastered(point.id);
    button.setAttribute('aria-pressed', String(mastered));
    button.textContent = mastered ? 'Mastered ✓' : 'Mark as mastered';
  };

  button.addEventListener('click', () => {
    setMastered(point.id, !isMastered(point.id));
    sync();
  });

  sync();
  return button;
}

function createCard(point, level) {
  const item = document.createElement('li');
  item.className = 'grammar-card';
  item.dataset.pointId = point.id;

  const head = document.createElement('div');
  head.className = 'grammar-card__head';

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';
  tag.textContent = level;

  head.append(createPatternHeading(point), tag);

  const meaning = document.createElement('p');
  meaning.className = 'grammar-card__meaning';
  meaning.textContent = point.meaning;

  const structure = document.createElement('p');
  structure.className = 'grammar-card__structure meta';
  structure.textContent = point.structure;

  item.append(head, meaning, structure, createExample(point.example));

  if (point.notes) {
    const notes = document.createElement('p');
    notes.className = 'grammar-card__notes meta';
    notes.textContent = point.notes;
    item.append(notes);
  }

  item.append(createMasteryButton(point));
  return item;
}

/* -- Search/filter -------------------------------------------------------------------
   Same substring-match-and-hide approach as vocabulary.js — matches
   against the pattern (kanji + kana reading) and the meaning.
   -------------------------------------------------------------------------------------- */

function matchesQuery(point, query) {
  if (!query) return true;
  const haystack = `${point.pattern} ${point.patternKana ?? ''} ${point.meaning}`.toLowerCase();
  return haystack.includes(query);
}

function createSearchField() {
  const wrap = document.createElement('div');
  wrap.className = 'search-field';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = 'grammar-search';
  label.textContent = 'Search grammar';

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'grammar-search';
  input.className = 'field';
  input.placeholder = 'Search by pattern or meaning';
  input.autocomplete = 'off';

  wrap.append(label, input);
  return { wrap, input };
}

/* -- Rendering ------------------------------------------------------------------------- */

function getContentContainer(view) {
  let content = view.querySelector('.grammar-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'grammar-content';
    view.append(content);
  }
  return content;
}

function renderList(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField();

  const summary = document.createElement('p');
  summary.className = 'grammar-meta meta';

  const list = document.createElement('ul');
  list.className = 'grammar-list';
  const rows = data.points.map((point) => ({ point, item: createCard(point, data.level) }));
  list.append(...rows.map((row) => row.item));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'No grammar points match your search.';
  empty.hidden = true;

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const matches = matchesQuery(row.point, query);
      row.item.hidden = !matches;
      if (matches) visible += 1;
    }
    summary.textContent = query
      ? `${data.level} · ${visible} / ${data.points.length} grammar points`
      : `${data.level} · ${data.points.length} grammar points`;
    empty.hidden = visible > 0;
  }

  searchInput.addEventListener('input', applyFilter);
  applyFilter();

  container.replaceChildren(searchWrap, summary, list, empty);
}

function renderError(container, message) {
  const p = document.createElement('p');
  p.className = 'meta';
  p.textContent = message;
  container.replaceChildren(p);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initGrammar() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  try {
    const data = await loadGrammar();
    renderList(content, data);
  } catch (error) {
    console.error('[Bigu]', error);
    renderError(content, 'Grammar points could not be loaded right now.');
  }
}

export { initGrammar, loadGrammar };
