/* ==========================================================================
   vocabulary.js
   Loads data/vocabulary.json and renders it as a study list inside the
   #vocabulary view. Ruby/rt furigana, .jlpt-tag, .reading, and .meta all
   reuse the type treatment already defined in typography.css — no new
   text styling is invented here, only structure.

   Rendering is paged. It did not used to be, and the difference is the
   difference between a page and a wall: the N5 set landed in a view built
   for a few dozen N2 words, and 816 cards came out as ~13,000 DOM nodes and
   a document 150,000 pixels tall. Every keystroke in the search field then
   walked all 816 rows and toggled `hidden` on each, forcing a full layout
   of that document per character typed. Nothing about that was visible as a
   bug — it was just an app that felt slow and a list nobody could reach the
   bottom of.

   Now a page of cards is built at a time and the rest arrive on request,
   which is also the honest reading of what a reader wants here: a
   vocabulary list is somewhere you look a word up or browse a little, not
   something you scroll to the end of.
   ========================================================================== */

import { isRemembered } from './review.js';
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

const DATA_URL = 'data/vocabulary.json';
const VIEW_ID = 'vocabulary';

/* How many cards exist in the document at once, and how many more each
   "Show more" adds. 24 fills roughly two screens of the widest grid, so the
   first page always overflows the fold — a list that ends exactly at the
   bottom edge reads as the whole list. */
const PAGE_SIZE = 24;

/* -- Data ------------------------------------------------------------------------- */

const loadVocabulary = createContentLoader(DATA_URL, 'vocabulary');

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

/* Two controls, two different questions: the chip answers "do I hold this?"
   (schedule state), the bookmark answers "do I want this?" (a choice). Both
   come from studyControls.js so this card, a grammar point, a kanji, and a
   lesson word all say it the same way. */
function createCard(word, level, onProgressChange) {
  const item = document.createElement('li');
  item.className = 'card vocab-card card--deferred';
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

  const { row } = createStudyControls(word.id, {
    onChange: onProgressChange,
    className: 'vocab-card__controls',
  });

  item.append(head, meaning, createExample(word.example), row);
  return item;
}

/* -- Facets -------------------------------------------------------------------------
   The chip row above the list. A word's tags come from an optional `tags`
   array on the word itself; words without one fall back to the dataset's
   `level`, so untagged data needs no migration.

   Which chips are offered is now read out of the data rather than written
   here as a fixed list. It used to be a nine-chip row — four JLPT levels
   and five topics (Business, Daily, Travel, Anime, News) — of which five
   matched nothing at all, so a third of the visible controls on this screen
   did nothing but empty the list and show "No words match your search."
   That is the same broken promise the navigation was cleaned up to remove
   ("every row goes somewhere real"), and the fix is the same: a facet
   appears when there is something behind it.
   ------------------------------------------------------------------------------------ */

/* The order facets are offered in when they are present. JLPT levels first
   and easiest-first, because that is how a learner reads them; topics after,
   in a fixed order so the row doesn't reshuffle as data is added. */
const FACET_ORDER = ['N5', 'N4', 'N3', 'N2', 'N1', 'Business', 'Daily', 'Travel', 'Anime', 'News'];

const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

function getWordTags(word, data) {
  return word.tags && word.tags.length ? word.tags : [data.level];
}

/* A word's own JLPT tag, not the file's. The dataset holds more than one
   level now (816 N5 words alongside the older N2 set), so a card that
   labelled itself with `data.level` would put the wrong chip on most of
   the list. Topic-only tags fall through to the file level, same as before. */
function getWordLevel(word, data) {
  const tags = getWordTags(word, data);
  return JLPT_LEVELS.find((level) => tags.includes(level)) ?? data.level;
}

/* "N5" for a single-level file, "N5–N2" once it spans several. */
function getLevelLabel(data) {
  const present = JLPT_LEVELS.filter((level) =>
    data.words.some((word) => getWordLevel(word, data) === level));
  if (present.length === 0) return data.level;
  return present.length === 1 ? present[0] : `${present[0]}–${present[present.length - 1]}`;
}

function collectFacets(rows) {
  const counts = new Map();
  for (const row of rows) {
    for (const tag of row.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  const present = [...counts.keys()];
  const ordered = FACET_ORDER.filter((tag) => counts.has(tag));
  // Anything the data carries that this file has never heard of still gets
  // a chip, appended after the known ones — new topic tags shouldn't have
  // to be registered in two places to become usable.
  const extra = present.filter((tag) => !FACET_ORDER.includes(tag)).sort();

  // One facet is not a filter, it's a label: a lone "N5" chip on an all-N5
  // file can only ever be pressed to show exactly what is already shown.
  const tags = [...ordered, ...extra];
  return tags.length > 1 ? tags.map((tag) => ({ tag, count: counts.get(tag) })) : [];
}

function matchesQuery(word, query) {
  if (!query) return true;
  const haystack = `${word.kanji ?? ''} ${word.kana} ${word.meaning}`.toLowerCase();
  return haystack.includes(query);
}

/* Reuses the same .toggle-chip look as the per-card "Remember this"
   button — a filled chip here means "words already in memory are hidden",
   same pressed/unpressed language as everywhere else the class is used. */
function createRememberedToggle() {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip vocab-filters__memory-toggle';
  button.setAttribute('aria-pressed', 'false');
  button.textContent = 'Hide what’s in memory';
  return button;
}

/* One chip per facet, multi-select, each carrying how many words are behind
   it. The count is the discoverability half of the fix above: a reader can
   see that N5 holds 816 words and N2 holds 20 before spending a tap to
   find out. */
function createFacetFilters(facets) {
  const wrap = document.createElement('div');
  wrap.className = 'vocab-filters__categories';
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Filter by level or topic');

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
    id: 'vocabulary-search',
    label: 'Search vocabulary',
    placeholder: 'Kanji, kana, or meaning',
  });
  const rememberedToggle = createRememberedToggle();

  const filters = document.createElement('div');
  filters.className = 'vocab-filters';
  filters.append(searchWrap, rememberedToggle);

  const summary = document.createElement('p');
  summary.className = 'vocab-meta meta';
  summary.setAttribute('aria-live', 'polite');
  const levelLabel = getLevelLabel(data);

  const list = document.createElement('ul');
  list.className = 'vocab-list';

  /* Rows are the model; cards are built lazily and cached on the row the
     first time that row is actually shown. Filtering therefore costs a pass
     over 816 small objects — not over 816 live DOM subtrees. */
  const rows = data.words.map((word) => ({
    word,
    tags: getWordTags(word, data),
    level: getWordLevel(word, data),
    item: null,
  }));

  const { wrap: facetWrap, buttons: facetButtons } = createFacetFilters(collectFacets(rows));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.hidden = true;

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'button button--secondary vocab-more';
  more.hidden = true;

  const selectedTags = new Set();
  let matched = [];
  let shown = 0;

  function cardFor(row) {
    if (!row.item) row.item = createCard(row.word, row.level, applyFilter);
    return row.item;
  }

  /* Appends the next page into the list. The cards already on screen are
     left alone — re-rendering them would drop the reader's scroll position
     and rebuild every control they can see. */
  function showMore() {
    const next = matched.slice(shown, shown + PAGE_SIZE);
    list.append(...next.map(cardFor));
    shown += next.length;
    syncMore();
  }

  function syncMore() {
    const remaining = matched.length - shown;
    more.hidden = remaining <= 0;
    more.textContent = `Show ${formatCount(Math.min(remaining, PAGE_SIZE))} more`;
    summary.textContent = describeSummary();
  }

  function describeSummary() {
    const filtering = searchInput.value.trim() !== '' || selectedTags.size > 0
      || rememberedToggle.getAttribute('aria-pressed') === 'true';
    const total = formatCount(data.words.length);

    if (!filtering) {
      return matched.length > shown
        ? `${levelLabel} · showing ${formatCount(shown)} of ${total} words`
        : `${levelLabel} · ${total} words`;
    }

    const found = `${formatCount(matched.length)} of ${total} words`;
    return matched.length > shown
      ? `${levelLabel} · ${found} — showing ${formatCount(shown)}`
      : `${levelLabel} · ${found}`;
  }

  /* Recomputes the match set and starts the list again from the first page.
     replaceChildren rather than toggling `hidden` on every card: the point
     of paging is that the document only ever holds a screenful or two, and
     hiding cards would keep all 816 of them in it. */
  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const hideRemembered = rememberedToggle.getAttribute('aria-pressed') === 'true';

    matched = rows.filter((row) => {
      if (selectedTags.size > 0 && !row.tags.some((tag) => selectedTags.has(tag))) return false;
      if (!matchesQuery(row.word, query)) return false;
      if (hideRemembered && isRemembered(row.word.id)) return false;
      return true;
    });

    list.replaceChildren();
    shown = 0;
    showMore();

    empty.hidden = matched.length > 0;
    empty.textContent = hideRemembered && !query && selectedTags.size === 0
      ? 'Everything here is already in memory. Clear the filter to see the whole list.'
      : 'No words match that. Try a different reading, or fewer filters.';
  }

  searchInput.addEventListener('input', debounce(applyFilter));
  rememberedToggle.addEventListener('click', () => {
    const pressed = rememberedToggle.getAttribute('aria-pressed') === 'true';
    rememberedToggle.setAttribute('aria-pressed', String(!pressed));
    applyFilter();
  });
  facetButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const tag = button.dataset.tag;
      const pressed = button.getAttribute('aria-pressed') === 'true';
      button.setAttribute('aria-pressed', String(!pressed));
      if (pressed) selectedTags.delete(tag);
      else selectedTags.add(tag);
      applyFilter();
    });
  });
  more.addEventListener('click', showMore);

  applyFilter();

  container.replaceChildren(filters, facetWrap, summary, list, empty, more);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initVocabulary() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'vocab-content'), {
    skeleton: 'card-grid',
    load: loadVocabulary,
    render: renderList,
    errorTitle: 'Vocabulary didn’t load.',
    errorDetail: `The word list is in data/vocabulary.json. ${OFFLINE_HINT}`,
  });
}

export { initVocabulary, loadVocabulary };
