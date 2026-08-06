/* ==========================================================================
   grammar.js
   Loads data/grammar.json and renders it as a list inside the #grammar
   view. Follows vocabulary.js's shape: same content.js loader and load/
   skeleton/error cycle, same review.js memory toggle, same createElement/
   append DOM building — only the card fields differ.
   ========================================================================== */

import { isRemembered, setRemembered } from './review.js';
import { createFavoriteButton } from './favorites.js';
import { createContentLoader, createSearchField, loadIntoView, OFFLINE_HINT } from './content.js';

const DATA_URL = 'data/grammar.json';
const VIEW_ID = 'grammar';

/* -- Data --------------------------------------------------------------------------- */

const loadGrammar = createContentLoader(DATA_URL, 'grammar');


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
  translation.textContent = example.mn;

  wrap.append(jp, reading, translation);
  return wrap;
}

/* Same two controls, same two questions, same words as every other study
   card in the app — "Mastered ✓" used to be a third vocabulary for what is
   one state, and a pattern you have "mastered" is an even bolder claim than
   a word you have "learned". */
function createMemoryControls(point) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip grammar-card__progress';

  const sync = () => {
    const remembered = isRemembered(point.id);
    button.setAttribute('aria-pressed', String(remembered));
    button.textContent = remembered ? 'In memory' : 'Remember this';
  };

  button.addEventListener('click', () => {
    setRemembered(point.id, !isRemembered(point.id));
    sync();
  });

  sync();

  const controls = document.createElement('div');
  controls.className = 'grammar-card__controls';
  controls.append(button, createFavoriteButton(point.id));
  return controls;
}

function createCard(point, level) {
  const item = document.createElement('li');
  item.className = 'card grammar-card';
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

  item.append(createMemoryControls(point));
  return item;
}

/* -- Search/filter -------------------------------------------------------------------
   Same substring-match-and-hide approach as vocabulary.js — matches
   against the pattern (kanji + kana reading) and the meaning.
   -------------------------------------------------------------------------------------- */

/* JLPT level facet shown as a chip row above the list, same pattern as
   vocabulary.js's category chips (just levels here, no topic tags). A
   point's tags come from an optional `tags` array on the point itself;
   points that don't have one yet (all of today's data) fall back to the
   dataset's own `level`, so nothing needs to change in grammar.json for
   the existing N2 points to keep showing up under their chip. */
const CATEGORY_TAGS = ['N5', 'N4', 'N3', 'N2'];

function getPointTags(point, data) {
  return point.tags && point.tags.length ? point.tags : [data.level];
}

function matchesQuery(point, query) {
  if (!query) return true;
  const haystack = `${point.pattern} ${point.patternKana ?? ''} ${point.meaning}`.toLowerCase();
  return haystack.includes(query);
}

/* One chip per JLPT level, multi-select. Reuses the same .toggle-chip
   look and pressed/unpressed language as the per-card memory button. */
function createCategoryFilters() {
  const wrap = document.createElement('div');
  wrap.className = 'grammar-filters__categories';

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
  let content = view.querySelector('.grammar-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'grammar-content';
    view.append(content);
  }
  return content;
}

function renderList(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'grammar-search',
    label: 'Search grammar',
    placeholder: 'Search by pattern or meaning',
  });
  const { wrap: categoryWrap, buttons: categoryButtons } = createCategoryFilters();

  const summary = document.createElement('p');
  summary.className = 'grammar-meta meta';

  const list = document.createElement('ul');
  list.className = 'grammar-list';
  const rows = data.points.map((point) => ({
    point,
    tags: getPointTags(point, data),
    item: createCard(point, data.level),
  }));
  list.append(...rows.map((row) => row.item));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'No grammar points match your search.';
  empty.hidden = true;

  const selectedTags = new Set();

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const inSelectedTags = selectedTags.size === 0 || row.tags.some((tag) => selectedTags.has(tag));
      const matches = inSelectedTags && matchesQuery(row.point, query);
      row.item.hidden = !matches;
      if (matches) visible += 1;
    }
    summary.textContent = query || selectedTags.size > 0
      ? `${data.level} · ${visible} / ${data.points.length} grammar points`
      : `${data.level} · ${data.points.length} grammar points`;
    empty.hidden = visible > 0;
  }

  searchInput.addEventListener('input', applyFilter);
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

  container.replaceChildren(searchWrap, categoryWrap, summary, list, empty);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initGrammar() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getContentContainer(view), {
    skeleton: 'list',
    load: loadGrammar,
    render: renderList,
    errorTitle: 'Grammar points didn’t load.',
    errorDetail: `The pattern list is in data/grammar.json. ${OFFLINE_HINT}`,
  });
}

export { initGrammar, loadGrammar };
