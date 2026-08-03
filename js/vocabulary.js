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
  translation.textContent = example.mn;

  wrap.append(jp, reading, translation);
  return wrap;
}

function createProgressButton(word, onChange) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip vocab-card__progress';

  const sync = () => {
    const learned = isLearned(word.id);
    button.setAttribute('aria-pressed', String(learned));
    button.textContent = learned ? 'Learned ✓' : 'Mark as learned';
  };

  button.addEventListener('click', () => {
    setLearned(word.id, !isLearned(word.id));
    sync();
    onChange();
  });

  sync();
  return button;
}

function createCard(word, level, onProgressChange) {
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

  item.append(head, meaning, createExample(word.example), createProgressButton(word, onProgressChange));
  return item;
}

/* -- Search/filter -------------------------------------------------------------------
   Client-side substring match over kanji, kana, and meaning — the dataset
   is small enough that filtering by hiding/showing existing <li> elements
   on every keystroke is simpler (and cheaper) than rebuilding the list.
   -------------------------------------------------------------------------------------- */

/* JLPT level + topic facets shown as a chip row above the list. A word's
   tags come from an optional `tags` array on the word itself; words that
   don't have one yet (all of today's data) fall back to the dataset's own
   `level`, so existing untagged words keep showing up under their JLPT
   chip with no data migration needed. Topic tags (Business, Daily, etc.)
   are additive — future data entries can add `"tags": ["N2", "business"]`
   without touching this list. */
const CATEGORY_TAGS = ['N5', 'N4', 'N3', 'N2', 'Business', 'Daily', 'Travel', 'Anime', 'News'];

function getWordTags(word, data) {
  return word.tags && word.tags.length ? word.tags : [data.level];
}

function matchesQuery(word, query) {
  if (!query) return true;
  const haystack = `${word.kanji ?? ''} ${word.kana} ${word.meaning}`.toLowerCase();
  return haystack.includes(query);
}

function createSearchField() {
  const wrap = document.createElement('div');
  wrap.className = 'search-field';

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

/* Reuses the same .toggle-chip look as the per-card "Mark as learned"
   button — a filled chip here means "learned words are hidden", same
   pressed/unpressed language as everywhere else the class is used. */
function createLearnedToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip vocab-filters__learned-toggle';
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'Hide learned';
  return button;
}

/* One chip per JLPT level / topic tag, multi-select. Reuses the same
   .toggle-chip look and pressed/unpressed language as the learned toggle
   and per-card progress button above, just applied as a group instead of
   a single switch. */
function createCategoryFilters() {
  const wrap = document.createElement('div');
  wrap.className = 'vocab-filters__categories';

  const buttons = CATEGORY_TAGS.map((tag) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip';
    button.dataset.tag = tag;
    button.setAttribute('aria-pressed', 'false');
    button.textContent = tag;
    wrap.append(button);
    return button;
  });

  return { wrap, buttons };
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
  const learnedToggle = createLearnedToggle();
  const { wrap: categoryWrap, buttons: categoryButtons } = createCategoryFilters();

  const filters = document.createElement('div');
  filters.className = 'vocab-filters';
  filters.append(searchWrap, learnedToggle);

  const summary = document.createElement('p');
  summary.className = 'vocab-meta meta';

  const list = document.createElement('ul');
  list.className = 'vocab-list';
  const rows = data.words.map((word) => ({
    word,
    tags: getWordTags(word, data),
    item: createCard(word, data.level, applyFilter),
  }));
  list.append(...rows.map((row) => row.item));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'No words match your search.';
  empty.hidden = true;

  const selectedTags = new Set();

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const hideLearned = learnedToggle.getAttribute('aria-pressed') === 'true';
    let visible = 0;
    for (const row of rows) {
      const inSelectedTags = selectedTags.size === 0 || row.tags.some((tag) => selectedTags.has(tag));
      const matches = inSelectedTags && matchesQuery(row.word, query) && !(hideLearned && isLearned(row.word.id));
      row.item.hidden = !matches;
      if (matches) visible += 1;
    }
    summary.textContent = query || hideLearned || selectedTags.size > 0
      ? `${data.level} · ${visible} / ${data.words.length} words`
      : `${data.level} · ${data.words.length} words`;
    empty.hidden = visible > 0;
  }

  searchInput.addEventListener('input', applyFilter);
  learnedToggle.addEventListener('click', () => {
    const pressed = learnedToggle.getAttribute('aria-pressed') === 'true';
    learnedToggle.setAttribute('aria-pressed', String(!pressed));
    applyFilter();
  });
  categoryButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.tag;
      const pressed = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!pressed));
      if (pressed) selectedTags.delete(tag);
      else selectedTags.add(tag);
      applyFilter();
    });
  });
  applyFilter();

  container.replaceChildren(filters, categoryWrap, summary, list, empty);
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
    console.error('[Bigu]', error);
    renderError(content, 'Vocabulary could not be loaded right now.');
  }
}

export { initVocabulary, loadVocabulary };
