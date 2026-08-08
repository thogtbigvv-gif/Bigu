/* ==========================================================================
   vocabulary.js
   Loads data/vocabulary.json and renders it as a study list inside the
   #vocabulary view. Ruby/rt furigana, .jlpt-tag, .reading, and .meta all
   reuse the type treatment already defined in typography.css — no new
   text styling is invented here, only structure.

   Rendering is paged. It did not used to be, and the difference is the
   difference between a page and a wall: the view was built for a few dozen
   cards, the word list grew into the hundreds, and 816 cards came out as
   ~13,000 DOM nodes and a document 150,000 pixels tall. Every keystroke in
   the search field then walked all 816 rows and toggled `hidden` on each,
   forcing a full layout of that document per character typed. Nothing about
   that was visible as a bug — it was just an app that felt slow and a list
   nobody could reach the bottom of.

   Now a page of cards is built at a time and the rest arrive on request,
   which is also the honest reading of what a reader wants here: a
   vocabulary list is somewhere you look a word up or browse a little, not
   something you scroll to the end of.
   ========================================================================== */

import { isRemembered } from './review.js';
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

  const pos = document.createElement('span');
  pos.className = 'vocab-card__pos meta';
  pos.textContent = word.partOfSpeech;

  head.append(createHeadword(word));

  /* A word with no JLPT level gets no level badge — not a guessed one and
     not an "Outside JLPT" pill crowding a two-character headword. It is
     still reachable: the chip row above the list files it under that
     bucket, which is where a reader goes looking for it. */
  if (level) {
    const tag = document.createElement('span');
    tag.className = 'jlpt-tag';
    tag.textContent = level;
    head.append(tag);
  }

  head.append(pos);

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
   The chip row above the list. A word's facets are its own `tags` array and
   nothing else — there is no file-level `level` to fall back on any more,
   and there shouldn't be: one string at the top of vocabulary.json could
   only ever describe a file holding one level, and this file has held
   several for a long time while still claiming "N5".

   Which chips are offered is read out of the data rather than written here
   as a fixed list. It used to be a nine-chip row — four JLPT levels and
   five topics (Business, Daily, Travel, Anime, News) — of which five
   matched nothing at all, so a third of the visible controls on this screen
   did nothing but empty the list and show "No words match your search."
   That is the same broken promise the navigation was cleaned up to remove
   ("every row goes somewhere real"), and the fix is the same: a facet
   appears when there is something behind it.
   ------------------------------------------------------------------------------------ */

/* Topics, in a fixed order so the row doesn't reshuffle as data is added.
   A word can carry both a level and a topic and shows up under each. */
const TOPIC_ORDER = ['Business', 'Daily', 'Travel', 'Anime', 'News'];

/* The whole ladder first, easiest-first, because that is how a learner
   reads it; the unleveled bucket after it, since it is a level's peer
   rather than a topic; topics last. */
const FACET_ORDER = [...JLPT_LEVELS, NO_LEVEL, ...TOPIC_ORDER];

/* A word's facet tags. A word with topic tags but no JLPT level — slang, a
   line out of a drama, something met in the wild — picks up the unleveled
   bucket alongside its topics, so it is filterable rather than invisible. */
function getWordTags(word) {
  const tags = word.tags ?? [];
  return jlptLevelOf(tags) ? tags : [...tags, NO_LEVEL];
}

/* A word's own JLPT level, or null when it has none. Null reaches the card
   as "draw no level badge" and the chip row as the unleveled bucket. */
function getWordLevel(word) {
  return jlptLevelOf(word.tags ?? []);
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

/* -- Rendering ------------------------------------------------------------------------- */

function renderList(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'vocabulary-search',
    label: 'Search vocabulary',
    placeholder: 'Ханз, кана, эсвэл утга',
  });
  const rememberedToggle = createRememberedToggle();

  const filters = document.createElement('div');
  filters.className = 'vocab-filters';
  filters.append(searchWrap, rememberedToggle);

  const summary = document.createElement('p');
  summary.className = 'vocab-meta meta';
  summary.setAttribute('aria-live', 'polite');

  const list = document.createElement('ul');
  list.className = 'vocab-list';

  /* Rows are the model; cards are built lazily and cached on the row the
     first time that row is actually shown. Filtering therefore costs a pass
     over 816 small objects — not over 816 live DOM subtrees. */
  const rows = data.words.map((word) => ({
    word,
    tags: getWordTags(word),
    level: getWordLevel(word),
    item: null,
  }));

  /* The span the file actually covers, read off the words themselves. */
  const levelLabel = describeLevelSpan(rows.map((row) => levelBucketOf(row.level)));

  const { wrap: facetWrap, buttons: facetButtons } = createFacetChips(
    collectFacets(rows.map((row) => row.tags), FACET_ORDER),
    { className: 'vocab-filters__categories', ariaLabel: 'Filter by level or topic' },
  );

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

  /* The span is a prefix, not a heading — and it is dropped rather than
     printed as an empty separator when there is no span to state. */
  function withSpan(text) {
    return levelLabel ? `${levelLabel} · ${text}` : text;
  }

  function describeSummary() {
    const filtering = searchInput.value.trim() !== '' || selectedTags.size > 0
      || rememberedToggle.getAttribute('aria-pressed') === 'true';
    const total = formatCount(data.words.length);

    if (!filtering) {
      return withSpan(matched.length > shown
        ? `${total} үгээс ${formatCount(shown)}-ыг харуулж байна`
        : `${total} үг`);
    }

    const found = `${total} үгээс ${formatCount(matched.length)}`;
    return withSpan(matched.length > shown ? `${found} — ${formatCount(shown)}-ыг харуулж байна` : found);
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
      ? 'Эндэх бүхэн аль хэдийн санах ойд орсон байна. Бүтэн жагсаалтыг харахын тулд шүүлтүүрээ цэвэрлэ.'
      : 'Тохирох үг олдсонгүй. Өөр дуудлагаар, эсвэл цөөн шүүлтүүрээр оролдоод үз.';
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
    errorTitle: 'Vocabulary ачаалагдсангүй.',
    errorDetail: `Үгийн жагсаалт data/vocabulary.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initVocabulary, loadVocabulary };
