/* ==========================================================================
   grammar.js
   Loads data/grammar.json and renders it as a list inside the #grammar
   view. Follows vocabulary.js's shape: same content.js loader and load/
   skeleton/error cycle, same review.js memory toggle, same createElement/
   append DOM building — only the card fields differ.
   ========================================================================== */

import { createStudyControls } from './studyControls.js';
import {
  createContentLoader,
  createSearchField,
  debounce,
  formatCount,
  getViewContainer,
  loadIntoView,
  OFFLINE_HINT,
} from './content.js';

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

  /* Same two controls, same two questions, same words as every other study
     card in the app — "Mastered ✓" used to be a third vocabulary for what
     is one state, and a pattern you have "mastered" is an even bolder claim
     than a word you have "learned". Built by studyControls.js now, so the
     four views can't drift back apart. */
  item.append(createStudyControls(point.id, { className: 'grammar-card__controls' }).row);
  return item;
}

/* -- Search/filter -------------------------------------------------------------------
   Same substring-match-and-hide approach as vocabulary.js — matches
   against the pattern (kanji + kana reading) and the meaning.
   -------------------------------------------------------------------------------------- */

/* JLPT level facet shown as a chip row above the list, same pattern as
   vocabulary.js's chips. A point's tags come from an optional `tags` array
   on the point itself; points that don't have one yet (all of today's data)
   fall back to the dataset's own `level`, so nothing needs to change in
   grammar.json for the existing N2 points to keep showing up.

   Which chips appear is read out of the data, not written here. This row
   used to be a fixed N5/N4/N3/N2 — and every point in the file is N2, so
   three of the four chips existed only to empty the list. Same reasoning as
   the facet row in vocabulary.js: a control that can only ever produce "no
   results" isn't a filter, it's a trap. A single remaining level is a label
   rather than a choice, so the row disappears entirely in that case. */
const LEVEL_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1'];

function getPointTags(point, data) {
  return point.tags && point.tags.length ? point.tags : [data.level];
}

/* A point's own JLPT level, not the file's — the same correction
   vocabulary.js and kanji.js already make. Today's file is single-level so
   nothing changes on screen, but the moment an N3 point is added the card
   would have claimed N2 and the reader would have had no way to tell. */
function getPointLevel(point, data) {
  const tags = getPointTags(point, data);
  return LEVEL_ORDER.find((level) => tags.includes(level)) ?? data.level;
}

function getLevelLabel(data) {
  const present = LEVEL_ORDER.filter((level) =>
    data.points.some((point) => getPointLevel(point, data) === level));
  if (present.length === 0) return data.level;
  return present.length === 1 ? present[0] : `${present[0]}–${present[present.length - 1]}`;
}

function matchesQuery(point, query) {
  if (!query) return true;
  const haystack = `${point.pattern} ${point.patternKana ?? ''} ${point.meaning}`.toLowerCase();
  return haystack.includes(query);
}

function collectFacets(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  const known = LEVEL_ORDER.filter((tag) => counts.has(tag));
  const extra = [...counts.keys()].filter((tag) => !LEVEL_ORDER.includes(tag)).sort();
  const tags = [...known, ...extra];
  return tags.length > 1 ? tags.map((tag) => ({ tag, count: counts.get(tag) })) : [];
}

/* One chip per level present, multi-select, each carrying its own count.
   Reuses the same .toggle-chip look and pressed/unpressed language as the
   per-card memory button. */
function createCategoryFilters(facets) {
  const wrap = document.createElement('div');
  wrap.className = 'grammar-filters__categories';
  wrap.hidden = facets.length === 0;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Filter by level');

  const buttons = facets.map(({ tag, count }) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'toggle-chip';
    button.dataset.tag = tag;
    button.setAttribute('aria-pressed', 'false');

    const label = document.createElement('span');
    label.textContent = tag;

    const badge = document.createElement('span');
    badge.className = 'toggle-chip__count';
    badge.textContent = formatCount(count);

    button.append(label, badge);
    wrap.append(button);
    return button;
  });

  return { wrap, buttons };
}

/* -- Rendering ------------------------------------------------------------------------- */

function renderList(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'grammar-search',
    label: 'Search grammar',
    placeholder: 'Pattern or meaning',
  });

  const summary = document.createElement('p');
  summary.className = 'grammar-meta meta';
  summary.setAttribute('aria-live', 'polite');
  const levelLabel = getLevelLabel(data);

  const list = document.createElement('ul');
  list.className = 'grammar-list';
  const rows = data.points.map((point) => ({
    point,
    tags: getPointTags(point, data),
    item: createCard(point, getPointLevel(point, data)),
  }));
  list.append(...rows.map((row) => row.item));

  const { wrap: categoryWrap, buttons: categoryButtons } = createCategoryFilters(collectFacets(rows));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'No patterns match that. Try part of the pattern, or its meaning.';
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
    const total = formatCount(data.points.length);
    summary.textContent = query || selectedTags.size > 0
      ? `${levelLabel} · ${formatCount(visible)} of ${total} patterns`
      : `${levelLabel} · ${total} patterns`;
    empty.hidden = visible > 0;
  }

  searchInput.addEventListener('input', debounce(applyFilter));
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

  await loadIntoView(getViewContainer(view, 'grammar-content'), {
    skeleton: 'list',
    load: loadGrammar,
    render: renderList,
    errorTitle: 'Grammar points didn’t load.',
    errorDetail: `The pattern list is in data/grammar.json. ${OFFLINE_HINT}`,
  });
}

export { initGrammar, loadGrammar };
