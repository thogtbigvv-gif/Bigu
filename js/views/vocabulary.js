/* ==========================================================================
   vocabulary.js
   Loads data/vocabulary.json and renders it as a study list inside the
   #vocabulary view. Ruby/rt furigana, .jlpt-tag, .reading, and .meta all
   reuse the type treatment already defined in typography.css — no new
   text styling is invented here, only structure.

   The list is kept in 五十音順 and broken into the ten rows of a kana chart,
   because eight hundred entries in the order somebody happened to write them
   down is not a list a reader can find their way around. That was the state
   of this screen: an arbitrary sequence, twenty-four at a time behind a "Show
   more" button, each entry a card deep enough that reaching the end of the
   file meant thirty presses and a document a hundred and fifty thousand
   pixels tall. Looking one word up meant searching for it, and there was no
   way to answer "what is in here" at all.

   So: sorted (js/data/kana.js), sectioned by kana row with the section's
   heading sticking to the top of the window while you are inside it, and an
   index rail across the top that jumps to any row in one press. What is on
   screen always says where in the list it is.

   And an entry is a row, not a card. It carries the headword, its reading
   and its meaning on one line — which is what browsing and looking up both
   need — and opens in place for the rest: the example sentence, the kanji it
   is spelled with, and the two study controls. That is what makes showing
   all eight hundred at once affordable, and paging unnecessary: a row is a
   handful of nodes rather than a dozen, and the detail behind a row — the
   example, the doors, the controls — is not built until the row is opened.
   The whole list then lays out in about a millisecond and stands thirty-eight
   thousand pixels tall instead of a hundred and fifty.

   Each open row carries a row of doors into the kanji it is spelled with, and
   the view answers to `#vocabulary/n5-001` by finding that word and putting
   it on screen. The two go together: a kanji screen sends the reader to a
   word that uses it, so the reveal below drops any filter that would have
   excluded that word and opens the row, rather than landing the reader on a
   list that does not contain what they followed a link to read.
   ========================================================================== */

import { isRemembered } from '../study/review.js';
import { createStudyControls } from '../ui/studyControls.js';
import {
  collectFacets,
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
  readingAdds,
} from '../ui/content.js';
import { createDoorRow, revealEntry } from '../ui/doors.js';
import { loadVocabulary, loadLinkIndex } from '../data/catalogue.js';
import { KANA_ROWS, compareKana, rowOf } from '../data/kana.js';
import { onRouteTarget } from '../core/router.js';

const VIEW_ID = 'vocabulary';

/* -- Data ------------------------------------------------------------------------- */


/* -- Rows -------------------------------------------------------------------------
   One entry, one line: the headword, its reading, its meaning. Everything
   else — the example sentence, the doors into its kanji, the two study
   controls — is behind the row and built the first time it is opened.

   A button rather than a details/summary pair or a click handler on the li:
   the row is one control that opens one thing, which is what a button is,
   and aria-expanded/aria-controls then say so without any of it being
   described in a label.
   -------------------------------------------------------------------------------------- */

function createHeadword(word) {
  const span = document.createElement('span');
  span.className = 'vocab-row__word';
  span.lang = 'ja';
  span.textContent = word.kanji || word.kana;
  return span;
}

/* The reading, and only where it says something the headword does not. A
   word written in kana alone would otherwise print itself twice. */
function createReading(word) {
  if (!word.kanji) return null;
  const span = document.createElement('span');
  span.className = 'vocab-row__reading reading';
  span.lang = 'ja';
  span.textContent = word.kana;
  return span;
}

function createExample(example) {
  const wrap = document.createElement('div');
  wrap.className = 'vocab-row__example';

  const jp = document.createElement('p');
  jp.lang = 'ja';
  jp.textContent = example.jp;

  const translation = document.createElement('p');
  translation.className = 'meta';
  translation.textContent = example.mn;

  wrap.append(jp);

  /* Only when it says something the line above does not — see readingAdds in
     js/ui/content.js. A kana-only sentence reads back as itself. */
  if (readingAdds(example.jp, example.reading)) {
    const reading = document.createElement('p');
    reading.className = 'reading';
    reading.lang = 'ja';
    reading.textContent = example.reading;
    wrap.append(reading);
  }

  wrap.append(translation);
  return wrap;
}

/* The kanji inside a headword, as doors. Read off the link index rather than
   written into vocabulary.json: what a word is spelled with is a fact about
   its own headword, and the day a word is added it is linked, because being
   linked is not a field anybody has to remember to fill in.

   A word written in kana alone contributes no characters and gets no row,
   which is the ordinary case for a good part of the list rather than a gap
   in it. */
function createKanjiDoors(word, links) {
  return createDoorRow({
    label: 'Kanji',
    doors: links.kanjiIn(word.kanji).map((entry) => ({
      view: 'kanji',
      target: entry.id,
      headword: entry.character,
      gloss: entry.meaning,
    })),
  });
}

/* Two controls, two different questions: the chip answers "do I hold this?"
   (schedule state), the bookmark answers "do I want this?" (a choice). Both
   come from studyControls.js so this entry, a grammar point, a kanji, and a
   lesson word all say it the same way. */
function createDetail(word, links, onProgressChange) {
  const detail = document.createElement('div');
  detail.className = 'vocab-row__detail';

  const { row } = createStudyControls(word.id, {
    onChange: onProgressChange,
    className: 'vocab-row__controls',
  });

  detail.append(createExample(word.example), row);

  const doors = createKanjiDoors(word, links);
  if (doors) detail.append(doors);

  return detail;
}

let rowCount = 0;

function createRow(word, level, links, onProgressChange) {
  const item = document.createElement('li');
  item.className = 'vocab-row';
  item.dataset.wordId = word.id;

  const detailId = `vocab-detail-${(rowCount += 1)}`;

  const face = document.createElement('button');
  face.type = 'button';
  face.className = 'vocab-row__face';
  face.setAttribute('aria-expanded', 'false');
  face.setAttribute('aria-controls', detailId);

  face.append(createHeadword(word));

  const reading = createReading(word);
  if (reading) face.append(reading);

  const meaning = document.createElement('span');
  meaning.className = 'vocab-row__meaning';
  meaning.textContent = word.meaning;
  face.append(meaning);

  const pos = document.createElement('span');
  pos.className = 'vocab-row__pos meta';
  pos.textContent = word.partOfSpeech;
  face.append(pos);

  /* A word with no JLPT level gets no level badge — not a guessed one and
     not an "Outside JLPT" pill crowding the line. It is still reachable: the
     chip row above the list files it under that bucket, which is where a
     reader goes looking for it. */
  if (level) {
    const tag = document.createElement('span');
    tag.className = 'jlpt-tag';
    tag.textContent = level;
    face.append(tag);
  }

  item.append(face);

  /* Built on the first press. Eight hundred example sentences and door rows
     that nobody has asked to see is the wall this screen was replacing. */
  let detail = null;
  function open() {
    if (!detail) {
      detail = createDetail(word, links, onProgressChange);
      detail.id = detailId;
      item.append(detail);
    }
    detail.hidden = false;
    face.setAttribute('aria-expanded', 'true');
  }

  function close() {
    if (detail) detail.hidden = true;
    face.setAttribute('aria-expanded', 'false');
  }

  face.addEventListener('click', () => {
    if (face.getAttribute('aria-expanded') === 'true') close();
    else open();
  });

  return { item, open };
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

/* The index rail: one press per kana row, and the only way to cross eight
   hundred entries without scrolling through them. A row with nothing in it
   under the current filters is disabled rather than removed, so the rail is
   the same ten marks in the same ten places whatever is being filtered —
   which is what makes it readable as a chart rather than as a changing menu.
   ------------------------------------------------------------------------------------ */
function createIndexRail(onJump) {
  const nav = document.createElement('nav');
  nav.className = 'vocab-index';
  nav.setAttribute('aria-label', '五十音順');

  const buttons = new Map();
  for (const row of KANA_ROWS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'vocab-index__mark';
    button.lang = 'ja';
    button.textContent = row.label;
    button.dataset.row = row.key;
    button.addEventListener('click', () => onJump(row.key));
    buttons.set(row.key, button);
    nav.append(button);
  }

  return { nav, buttons };
}

/* A section per kana row, in chart order, each holding its own list. The
   heading sticks while the reader is inside the section, so the answer to
   "where am I" is on screen the whole way down rather than only at the
   moment they crossed the boundary. */
function createSection(rowDefinition) {
  const section = document.createElement('section');
  section.className = 'vocab-section';
  section.id = `vocab-row-${rowDefinition.key}`;

  const head = document.createElement('h2');
  head.className = 'vocab-section__head';

  const mark = document.createElement('span');
  mark.className = 'vocab-section__mark';
  mark.lang = 'ja';
  mark.textContent = rowDefinition.label;

  const count = document.createElement('span');
  count.className = 'vocab-section__count';

  head.append(mark, count);

  const list = document.createElement('ul');
  list.className = 'vocab-rows';

  section.append(head, list);
  return { section, list, count };
}

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

  const list = document.createElement('div');
  list.className = 'vocab-list';

  /* Rows are the model; the elements are built lazily and cached the first
     time a row is actually shown. Filtering therefore costs a pass over 816
     small objects — not over 816 live DOM subtrees. */
  const rows = data.words
    .map((word) => ({
      word,
      tags: getWordTags(word),
      level: getWordLevel(word),
      kanaRow: rowOf(word.kana),
      item: null,
      open: null,
    }))
    /* Sorted here rather than in the file. data/vocabulary.json is written by
       hand in the order the learner met each word, which is the right order
       for the lesson it came from and no order at all for a list of eight
       hundred; the reading is already on every entry, so the order the
       language files itself in is derivable rather than authored. */
    .sort((a, b) => compareKana(a.word.kana, b.word.kana));

  /* The span the file actually covers, read off the words themselves. */
  const levelLabel = describeLevelSpan(rows.map((row) => levelBucketOf(row.level)));

  const { wrap: facetWrap, buttons: facetButtons } = createFacetChips(
    collectFacets(rows.map((row) => row.tags), FACET_ORDER),
    { className: 'vocab-filters__categories', ariaLabel: 'Filter by level or topic' },
  );

  const sections = new Map();
  for (const definition of KANA_ROWS) {
    const built = createSection(definition);
    sections.set(definition.key, built);
    list.append(built.section);
  }

  const { nav: indexRail, buttons: indexButtons } = createIndexRail((key) => {
    const target = sections.get(key);
    if (!target || target.section.hidden) return;
    target.section.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.hidden = true;

  const selectedTags = new Set();
  let matched = [];

  /* Marking a word only re-filters when the filter is actually watching for
     it. Handing applyFilter() straight to every row meant pressing "Remember
     this" on the 200th word rebuilt the list under the reader's finger. With
     the toggle off, the word's own state is the only thing that changed, and
     the control has already redrawn itself. */
  function onRowProgressChange() {
    if (rememberedToggle.getAttribute('aria-pressed') === 'true') applyFilter();
  }

  function elementFor(row) {
    if (!row.item) {
      const built = createRow(row.word, row.level, data.links, onRowProgressChange);
      row.item = built.item;
      row.open = built.open;
    }
    return row.item;
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
    if (!filtering) return withSpan(`${total} үг · あ–わ`);
    return withSpan(`${total} үгээс ${formatCount(matched.length)} нь тохирлоо`);
  }

  /* Recomputes the match set and refills each section from it. Every matching
     row goes into the document — there is no page boundary any more — and the
     sections carry content-visibility, so the browser lays out the ones near
     the viewport and skips the rest. */
  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const hideRemembered = rememberedToggle.getAttribute('aria-pressed') === 'true';

    matched = rows.filter((row) => {
      if (selectedTags.size > 0 && !row.tags.some((tag) => selectedTags.has(tag))) return false;
      if (!matchesQuery(row.word, query)) return false;
      if (hideRemembered && isRemembered(row.word.id)) return false;
      return true;
    });

    const byRow = new Map(KANA_ROWS.map((definition) => [definition.key, []]));
    for (const row of matched) {
      const bucket = byRow.get(row.kanaRow);
      if (bucket) bucket.push(row);
    }

    for (const [key, built] of sections) {
      const inRow = byRow.get(key) ?? [];
      built.list.replaceChildren(...inRow.map(elementFor));
      built.count.textContent = inRow.length > 0 ? formatCount(inRow.length) : '';
      built.section.hidden = inRow.length === 0;

      const mark = indexButtons.get(key);
      if (mark) mark.disabled = inRow.length === 0;
    }

    summary.textContent = describeSummary();
    empty.hidden = matched.length > 0;
    /* One line, and no instruction after it. Every empty state in the app used
       to end by telling the reader what to type or which control to clear —
       advice they did not ask for about a screen they can already see. */
    empty.textContent = hideRemembered && !query && selectedTags.size === 0
      ? 'Энд байгаа бүхэн аль хэдийн санах ойд орсон байна.'
      : 'Тохирох үг олдсонгүй.';
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

  /* Every filter back to nothing, in one place. Pressed chips are cleared as
     well as the field, because a reveal that only cleared the search would
     still be unable to show a word two levels away from whatever chip the
     reader last pressed. */
  function clearFilters() {
    searchInput.value = '';
    selectedTags.clear();
    for (const button of facetButtons) button.setAttribute('aria-pressed', 'false');
    rememberedToggle.setAttribute('aria-pressed', 'false');
    applyFilter();
  }

  /* Arriving from a door. Two things stand between a word's id and the reader
     seeing it, and both are states this view is normally right to be in: a
     filter that excludes it and a search that excludes it. The page boundary
     used to be a third and is gone — every matching row is in the document.

     The filters are dropped only when they are actually hiding the word — a
     reader who followed a link to a word already in front of them keeps the
     list they had. The row is opened as well as scrolled to: they followed a
     link to read the entry, not to see its headword.

     An id nothing matches leaves the list exactly as it was. That is a
     retired entry or an old bookmark, and the right answer to it is the word
     list, not an error. */
  function revealWord(id) {
    const row = rows.find((candidate) => candidate.word.id === id);
    if (!row) return;

    if (!matched.includes(row)) clearFilters();
    if (!matched.includes(row)) return;

    const element = elementFor(row);
    row.open();
    revealEntry(element);
  }

  applyFilter();

  container.replaceChildren(filters, facetWrap, indexRail, summary, list, empty);

  // After the list is in the document: revealEntry scrolls to the row and
  // moves focus onto it, and neither works on an element that has not been
  // laid out. Same reason kanji.js subscribes at the end of its own render.
  onRouteTarget(VIEW_ID, revealWord);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initVocabulary() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'vocab-content'), {
    skeleton: 'card-grid',
    // The link index alongside the words, so a card can name the kanji it is
    // spelled with. It never rejects (see catalogue.js), so a missing
    // kanji.json costs this view its door rows and nothing else.
    load: async () => {
      const [data, links] = await Promise.all([loadVocabulary(), loadLinkIndex()]);
      return { ...data, links };
    },
    render: renderList,
    errorTitle: 'Vocabulary ачаалагдсангүй.',
    errorDetail: `Үгийн жагсаалт data/vocabulary.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initVocabulary };
