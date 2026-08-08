/* ==========================================================================
   grammar.js
   Loads data/grammar.json and renders it as a list inside the #grammar
   view. Follows vocabulary.js's shape: same content.js loader and load/
   skeleton/error cycle, same review.js memory toggle, same createElement/
   append DOM building — only the card fields differ.
   ========================================================================== */

import { createStudyControls } from './studyControls.js';
import {
  collectFacets,
  createContentLoader,
  createFacetChips,
  createSearchField,
  debounce,
  describeLevelSpan,
  formatCount,
  getViewContainer,
  jlptLevelOf,
  levelBucketOf,
  loadIntoView,
  JLPT_LEVELS,
  NO_LEVEL,
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

  head.append(createPatternHeading(point));

  /* No level, no badge. A pattern picked up outside the exam syllabus is
     reachable through the unleveled chip above the list instead. */
  if (level) {
    const tag = document.createElement('span');
    tag.className = 'jlpt-tag';
    tag.textContent = level;
    head.append(tag);
  }

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

/* The chip row above the list, same shape as vocabulary.js's. A point's
   facets are its own `tags` array; grammar.json no longer carries a
   file-level `level` for them to fall back on, because a single string at
   the top of a file can only describe a file that holds a single level,
   and that is not a promise this catalogue keeps.

   Which chips appear is read out of the data, not written here. This row
   used to be a fixed N5/N4/N3/N2, three of which matched nothing and
   existed only to empty the list. Same reasoning as the facet row in
   vocabulary.js: a control that can only ever produce "no results" isn't a
   filter, it's a trap. A single remaining facet is a label rather than a
   choice, so the row disappears entirely in that case.

   The ladder itself is shared (content.js) rather than restated here; the
   unleveled bucket sits after it, for patterns that belong to the language
   without belonging to any exam level. */
const LEVEL_ORDER = [...JLPT_LEVELS, NO_LEVEL];

/* A point tagged with topics but no level still gets the unleveled bucket,
   so it stays filterable instead of falling out of the chip row. */
function getPointTags(point) {
  const tags = point.tags ?? [];
  return jlptLevelOf(tags) ? tags : [...tags, NO_LEVEL];
}

/* A point's own JLPT level, or null when it has none — which reaches the
   card as "draw no level badge" rather than as a level the data never
   claimed. */
function getPointLevel(point) {
  return jlptLevelOf(point.tags ?? []);
}

function matchesQuery(point, query) {
  if (!query) return true;
  const haystack = `${point.pattern} ${point.patternKana ?? ''} ${point.meaning}`.toLowerCase();
  return haystack.includes(query);
}

/* -- Rendering ------------------------------------------------------------------------- */

function renderList(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'grammar-search',
    label: 'Search grammar',
    placeholder: 'Хэлбэр эсвэл утга',
  });

  const summary = document.createElement('p');
  summary.className = 'grammar-meta meta';
  summary.setAttribute('aria-live', 'polite');

  const list = document.createElement('ul');
  list.className = 'grammar-list';
  const rows = data.points.map((point) => ({
    point,
    tags: getPointTags(point),
    bucket: levelBucketOf(getPointLevel(point)),
    item: createCard(point, getPointLevel(point)),
  }));
  list.append(...rows.map((row) => row.item));

  const levelLabel = describeLevelSpan(rows.map((row) => row.bucket));

  const { wrap: categoryWrap, buttons: categoryButtons } = createFacetChips(
    collectFacets(rows.map((row) => row.tags), LEVEL_ORDER),
    { className: 'grammar-filters__categories', ariaLabel: 'Filter by level' },
  );

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'Тохирох хэлбэр олдсонгүй. Хэлбэрийн хэсгээр, эсвэл утгаар нь оролдоод үз.';
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
    const count = query || selectedTags.size > 0
      ? `${total} хэлбэрээс ${formatCount(visible)}`
      : `${total} хэлбэр`;
    summary.textContent = levelLabel ? `${levelLabel} · ${count}` : count;
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
    errorTitle: 'Grammar ачаалагдсангүй.',
    errorDetail: `Хэлбэрийн жагсаалт data/grammar.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initGrammar, loadGrammar };
