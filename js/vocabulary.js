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

/* -- Search/filter -------------------------------------------------------------------
   Client-side substring match over kanji, kana, and meaning — the dataset
   is small enough that filtering by hiding/showing existing <li> elements
   on every keystroke is simpler (and cheaper) than rebuilding the list.
   -------------------------------------------------------------------------------------- */

function matchesQuery(word, query) {
  if (!query) return true;
  const haystack = `${word.kanji ?? ''} ${word.kana} ${word.meaning}`.toLowerCase();
  return haystack.includes(query);
}

function createSearchField() {
  const wrap = document.createElement('div');
  wrap.className = 'vocab-search';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = 'vocabulary-search';
  label.textContent = 'Search vocabulary';

  const input = document.createElement('input');
  input.type = 'search';
  input.id = 'vocabulary-search';
  input.className = 'field';
  input.placeholder = 'Search by kanji, kana, or meaning';
  input.autocomplete = 'off';

  wrap.append(label, input);
  return { wrap, input };
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
  const { wrap: searchWrap, input: searchInput } = createSearchField();

  const summary = document.createElement('p');
  summary.className = 'vocab-meta meta';

  const list = document.createElement('ul');
  list.className = 'vocab-list';
  const rows = data.words.map((word) => ({ word, item: createCard(word, data.level) }));
  list.append(...rows.map((row) => row.item));

  const empty = document.createElement('p');
  empty.className = 'meta vocab-empty';
  empty.textContent = 'No words match your search.';
  empty.hidden = true;

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const matches = matchesQuery(row.word, query);
      row.item.hidden = !matches;
      if (matches) visible += 1;
    }
    summary.textContent = query
      ? `${data.level} · ${visible} / ${data.words.length} words`
      : `${data.level} · ${data.words.length} words`;
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
