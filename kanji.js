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
  const summary = document.createElement('p');
  summary.className = 'kanji-meta meta';
  summary.textContent = `${data.level} · ${data.kanji.length} kanji`;

  const grid = document.createElement('ul');
  grid.className = 'kanji-grid';
  grid.append(...data.kanji.map((entry) => createCard(entry, data.level)));

  container.replaceChildren(summary, grid);
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
