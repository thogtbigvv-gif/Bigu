/* ==========================================================================
   vocabulary.js
   Loads data/vocabulary.json and renders it as a study list inside the
   #vocabulary view. Ruby/rt furigana, .jlpt-tag, .reading, and .meta all
   reuse the type treatment already defined in typography.css — no new
   text styling is invented here, only structure.
   ========================================================================== */

import { progress } from './storage.js';

const DATA_URL = 'data/vocabulary.json';
const VIEW_ID = 'vocabulary';

let cachedData = null;

/* -- Data ------------------------------------------------------------------------- */

async function loadVocabulary() {
  if (cachedData) return cachedData;

  const response = await fetch(DATA_URL);
  if (!response.ok) {
    throw new Error(`Failed to load vocabulary (${response.status})`);
  }

  cachedData = await response.json();
  return cachedData;
}

/* -- Progress ------------------------------------------------------------------------ */

function isLearned(wordId) {
  return Boolean(progress.get(wordId)?.learned);
}

function setLearned(wordId, learned) {
  progress.set(wordId, { ...progress.get(wordId), learned });
}

/* -- Card building -------------------------------------------------------------------- */

function createHeadword(word) {
  if (!word.kanji) {
    const span = document.createElement('span');
    span.lang = 'ja';
    span.textContent = word.kana;
    return span;
  }

  const ruby = document.createElement('ruby');
  ruby.lang = 'ja';
  const rt = document.createElement('rt');
  rt.textContent = word.kana;
  ruby.append(word.kanji, rt);
  return ruby;
}

function createExample(example) {
  const wrap = document.createElement('div');
  wrap.className = 'vocab-card__example';

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

function createProgressButton(word) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'vocab-card__progress';

  const sync = () => {
    const learned = isLearned(word.id);
    button.setAttribute('aria-pressed', String(learned));
    button.textContent = learned ? 'Learned ✓' : 'Mark as learned';
  };

  button.addEventListener('click', () => {
    setLearned(word.id, !isLearned(word.id));
    sync();
  });

  sync();
  return button;
}

function createCard(word, level) {
  const item = document.createElement('li');
  item.className = 'vocab-card';
  item.dataset.wordId = word.id;

  const head = document.createElement('div');
  head.className = 'vocab-card__head';

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';
  tag.textContent = level;

  const pos = document.createElement('span');
  pos.className = 'vocab-card__pos meta';
  pos.textContent = word.partOfSpeech;

  head.append(createHeadword(word), tag, pos);

  const meaning = document.createElement('p');
  meaning.className = 'vocab-card__meaning';
  meaning.textContent = word.meaning;

  item.append(head, meaning, createExample(word.example), createProgressButton(word));
  return item;
}

/* -- Rendering ------------------------------------------------------------------------- */

function getContentContainer(view) {
  let content = view.querySelector('.vocab-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'vocab-content';
    view.append(content);
  }
  return content;
}

function renderList(container, data) {
  const summary = document.createElement('p');
  summary.className = 'vocab-meta meta';
  summary.textContent = `${data.level} · ${data.words.length} words`;

  const list = document.createElement('ul');
  list.className = 'vocab-list';
  list.append(...data.words.map((word) => createCard(word, data.level)));

  container.replaceChildren(summary, list);
}

function renderError(container, message) {
  const p = document.createElement('p');
  p.className = 'meta';
  p.textContent = message;
  container.replaceChildren(p);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initVocabulary() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  const content = getContentContainer(view);

  try {
    const data = await loadVocabulary();
    renderList(content, data);
  } catch (error) {
    console.error('[Nagi]', error);
    renderError(content, 'Vocabulary could not be loaded right now.');
  }
}

export { initVocabulary, loadVocabulary };
