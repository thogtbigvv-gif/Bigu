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
  button.className = 'grammar-card__progress';

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
  const summary = document.createElement('p');
  summary.className = 'grammar-meta meta';
  summary.textContent = `${data.level} · ${data.points.length} grammar points`;

  const list = document.createElement('ul');
  list.className = 'grammar-list';
  list.append(...data.points.map((point) => createCard(point, data.level)));

  container.replaceChildren(summary, list);
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
    console.error('[Nagi]', error);
    renderError(content, 'Grammar points could not be loaded right now.');
  }
}

export { initGrammar, loadGrammar };
