/* ==========================================================================
   kanji.js
   Loads data/kanji.json and renders it as a grid inside the #kanji view.
   Same content.js loader and review.js memory pattern as vocabulary.js and
   grammar.js; laid out as a grid instead of a list since a single character
   card carries far less content than a vocab or grammar card.

   Each card also has a "View details" button opening a full-character
   detail panel — Meaning, On, Kun, Stroke Order, Animation, Examples,
   Related Kanji — in place of the grid, same list-hidden/detail-shown
   swap reading.js uses for its passage flow. Unlike reading.js's stage
   tabs, these sections are NOT tabbed: for one kanji, meaning/readings/
   examples/related characters are usually wanted together at a glance
   (a dictionary entry, not alternate views of the same content), so the
   detail panel just stacks them and lets the page scroll.

   There were two more sections, Stroke Order and Animation, and both are
   gone. They needed per-character stroke-path data — a KanjiVG-shaped
   dataset — that kanji.json does not have and that nobody is going to author
   by hand for 132 characters, each with its own ordered list of curves. They
   rendered a "coming soon" note for every entry, which is to say they were
   two headed sections whose only content was an apology, on the panel that
   is supposed to be the app's dictionary entry.

   What is left is what the data can answer: Meaning, On, Kun, Examples,
   Related Kanji. `examples` falls back to the single `example` field, and
   `related` is an array of characters, each rendered as a chip that jumps to
   that character's own entry. 118 of the 132 entries carry one; the other 14
   simply have no Related Kanji section, because a heading over an empty box
   is the same apology in a smaller font.
   ========================================================================== */

import { createStudyControls } from './studyControls.js';
import {
  collectFacets,
  createContentLoader,
  createEntryLink,
  createFacetChips,
  createLinkGroup,
  createSearchField,
  debounce,
  describeLevelSpan,
  formatCount,
  getViewContainer,
  levelBucketOf,
  loadIntoView,
  loadLinkIndex,
  revealEntry,
  JLPT_LEVELS,
  NO_LEVEL,
  OFFLINE_HINT,
} from './content.js';
import { registerItemHandler } from './router.js';
import { relatedKanji, routeTo, wordsUsingKanji } from './links.js';

const DATA_URL = 'data/kanji.json';
const VIEW_ID = 'kanji';

/* -- Data --------------------------------------------------------------------------- */

const loadKanji = createContentLoader(DATA_URL, 'kanji');

/* Set by renderGrid once the grid is on screen, and read by the router's item
   handler. A function rather than a stored id: the view is rendered once and
   navigated to many times, and each arrival is a fresh question about which
   entry to open. */
let showEntry = null;


/* -- Shared fields -------------------------------------------------------------------
   `examples` is optional; entries that don't have one yet (all of today's
   data) fall back to a single-item list built from the existing required
   `example`, so nothing needs to change in kanji.json for old entries.
   -------------------------------------------------------------------------------------- */

function getExamples(entry) {
  return entry.examples && entry.examples.length ? entry.examples : [entry.example];
}

/* The order the chip row and the summary label read the levels in, plus the
   bucket for characters the exam lists at no level at all. */
const LEVEL_ORDER = [...JLPT_LEVELS, NO_LEVEL];

/* An entry's own level, and only its own. kanji.json used to carry one
   `level` string for the whole file, which was wrong the moment the second
   level arrived and stayed wrong for as long as it existed. `level` is
   optional per entry; absent means unleveled, not "whatever the file says". */
function getEntryLevel(entry) {
  return entry.level ?? null;
}

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
  meaning.textContent = example.mn;

  wrap.append(wordEl, meaning);
  return wrap;
}

/* -- Grid card -------------------------------------------------------------------------
   The compact overview: character, meaning, readings, one example
   preview, memory controls, and now a "View details" button opening the
   full entry below. The card itself stays exactly as small as before —
   detail content only exists once the button is pressed.
   ------------------------------------------------------------------------------------------ */

function createCard(entry, level, onOpenDetail) {
  const item = document.createElement('li');
  /* No `card` — see the same note in vocabulary.js. A kanji entry is one row of
     a sparse list separated by hairlines, and carrying the card primitive only
     to cancel every one of its properties would misdescribe the view. */
  item.className = 'kanji-card card--deferred';
  item.dataset.kanjiId = entry.id;

  const head = document.createElement('div');
  head.className = 'kanji-card__head';

  const character = document.createElement('p');
  character.className = 'kanji-card__character';
  character.lang = 'ja';
  character.textContent = entry.character;

  head.append(character);

  /* No level, no badge — the chip row files the entry under the unleveled
     bucket rather than the card inventing a level for it. */
  if (level) {
    const tag = document.createElement('span');
    tag.className = 'jlpt-tag';
    tag.textContent = level;
    head.append(tag);
  }

  const meaning = document.createElement('p');
  meaning.className = 'kanji-card__meaning';
  meaning.textContent = entry.meaning;

  const detailButton = document.createElement('button');
  detailButton.type = 'button';
  detailButton.className = 'button button--secondary kanji-card__detail-button';
  detailButton.textContent = 'View details';
  detailButton.addEventListener('click', () => onOpenDetail(entry));

  /* One vocabulary across the app: a kanji is held in memory or it isn't,
     said the same way a word or a grammar pattern is — see
     js/studyControls.js. The bookmark beside it is the same control too. */
  item.append(
    head,
    meaning,
    createReadings(entry),
    createExample(entry.example),
    createStudyControls(entry.id, { className: 'kanji-card__controls' }).row,
    detailButton,
  );
  return item;
}

/* -- Detail panel ------------------------------------------------------------------------
   Opens in place of the grid (same swap reading.js uses for its passage
   flow). Sections render in the order the feature was specced in:
   Meaning, On, Kun, Stroke Order, Animation, Examples, Related Kanji.
   ------------------------------------------------------------------------------------------ */

function createDetailSection(title, content) {
  const section = document.createElement('div');
  section.className = 'card kanji-detail__section';

  const heading = document.createElement('h3');
  heading.className = 'kanji-detail__section-title';
  heading.textContent = title;

  section.append(heading, content);
  return section;
}

function createTextBlock(text, { lang } = {}) {
  const p = document.createElement('p');
  p.className = 'kanji-detail__text';
  if (lang) p.lang = lang;
  p.textContent = text;
  return p;
}

function createExamplesBlock(entry) {
  const list = document.createElement('div');
  list.className = 'kanji-detail__examples';
  list.append(...getExamples(entry).map((example) => createExample(example)));
  return list;
}

/* Every related character is a link to that character's own entry.

   These were chips — buttons with a click handler that swapped the panel in
   place. They are anchors now, with `#kanji/<id>` in the href, and the
   difference is not cosmetic: a chip cannot be middle-clicked into a new tab,
   cannot be copied out of the page, and does not tell the reader where it
   goes. Pressing one still swaps the panel in place, because the href points
   at this same view and router.js hands the id straight back here.

   A character with no entry of its own is dropped rather than shown inert:
   "Related Kanji" is a row of ways into other entries, and a character with
   nowhere to go is not one of those. Counted rather than assumed — of 521
   related references across the file, zero point outside the 132 characters. */
function createRelatedBlock(entry, index) {
  const links = relatedKanji(index, entry.id).map((id) => {
    const match = index.kanjiById.get(id);
    return createEntryLink({ href: routeTo('kanji', id), jp: match.character, gloss: match.meaning });
  });

  return createLinkGroup(null, links);
}

/* The words that use this character.

   The other half of the same relationship the app has held all along and never
   drawn: 315 of these across the file, 119 of the 132 characters having at
   least one. Ordered as vocabulary.json orders them, which is by level and
   then by the order they were authored — near enough to "easiest first" to be
   worth keeping, and not worth inventing a ranking for. */
function createWordsBlock(entry, index) {
  const links = wordsUsingKanji(index, entry.id).map((id) => {
    const word = index.wordById.get(id);
    return createEntryLink({
      href: routeTo('vocabulary', id),
      jp: word.kanji,
      gloss: word.meaning,
    });
  });

  return createLinkGroup(null, links);
}

function buildDetailPanel() {
  const wrap = document.createElement('div');
  wrap.className = 'kanji-detail';
  wrap.hidden = true;

  const exit = document.createElement('button');
  exit.type = 'button';
  exit.className = 'button button--secondary kanji-detail__exit';
  exit.textContent = '← Back to kanji';

  const head = document.createElement('div');
  head.className = 'kanji-detail__head';

  /* An <h2>, not a <p>. This panel replaces the whole grid and is the only
     thing on screen, so it is a section of the page and its character is
     that section's title — as a paragraph it was invisible to anyone
     navigating by heading, and the panel had no announced identity at all.
     It also gives the panel something to move focus to on open. */
  const character = document.createElement('h2');
  character.className = 'kanji-detail__character';
  character.lang = 'ja';
  character.tabIndex = -1;

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';

  head.append(character, tag);

  const sections = document.createElement('div');
  sections.className = 'kanji-detail__sections';

  wrap.append(exit, head, sections);

  return { wrap, exit, character, tag, sections };
}

function renderDetail(elements, entry, level) {
  elements.character.textContent = entry.character;
  elements.tag.textContent = level ?? '';
  elements.tag.hidden = !level;

  elements.sections.replaceChildren(
    createDetailSection('Meaning', createTextBlock(entry.meaning)),
    createDetailSection('On', createTextBlock(entry.onyomi || '—', { lang: 'ja' })),
    createDetailSection('Kun', createTextBlock(entry.kunyomi || '—', { lang: 'ja' })),
    createDetailSection('Examples', createExamplesBlock(entry)),
  );

  /* The two link sections arrive when the index does, appended rather than
     waited for. They need vocabulary.json, which the kanji view has no other
     reason to fetch, and blocking the panel on 336 KB would mean the reader
     stares at nothing to learn what 日 means.

     `token` guards against the reader opening a second character before the
     first one's links land: by then this render is stale, and its links belong
     to a panel that is no longer on screen. */
  const token = Symbol('detail');
  elements.pending = token;

  loadLinkIndex().then((index) => {
    if (elements.pending !== token) return;

    const words = createWordsBlock(entry, index);
    const related = createRelatedBlock(entry, index);

    /* Either can be absent and neither leaves a heading behind: 13 of the 132
       characters have no word in the file that uses them, and 14 have no
       related characters. */
    if (words) elements.sections.append(createDetailSection('Words using this kanji', words));
    if (related) elements.sections.append(createDetailSection('Related Kanji', related));
  }).catch(() => {
    /* A failed index is a panel with no link sections, which is the same
       panel this view had before they existed. Nothing to report to the
       reader: they asked what a character means, and that part arrived. */
  });

  /* The panel replaces the grid in place, so opening one from the bottom of
     a 130-card grid used to leave the reader scrolled a long way down,
     looking at whitespace below a panel whose top they never saw. This used
     to call wrap.scrollTo(), which does nothing: the panel isn't a scroll
     container, the page is. Scroll the page, then put focus on the panel's
     own heading so a keyboard reader arrives at the same place a sighted
     one does. */
  window.scrollTo({ top: 0, behavior: 'instant' });
  elements.character.focus({ preventScroll: true });
}

/* -- Search/filter -------------------------------------------------------------------
   Same substring-match-and-hide approach as vocabulary.js/grammar.js —
   matches against the character, meaning, and both readings.
   -------------------------------------------------------------------------------------- */

function matchesQuery(entry, query) {
  if (!query) return true;
  const haystack = `${entry.character} ${entry.meaning} ${entry.onyomi ?? ''} ${entry.kunyomi ?? ''}`.toLowerCase();
  return haystack.includes(query);
}

/* -- Rendering ------------------------------------------------------------------------- */

function renderGrid(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'kanji-search',
    label: 'Search kanji',
    placeholder: 'Тэмдэгт, дуудлага, эсвэл утга',
  });

  const summary = document.createElement('p');
  summary.className = 'kanji-meta meta';
  summary.setAttribute('aria-live', 'polite');

  const grid = document.createElement('ul');
  grid.className = 'kanji-grid';

  const detailElements = buildDetailPanel();
  let lastOpener = null;

  const rows = data.kanji.map((entry) => ({
    entry,
    level: getEntryLevel(entry),
    bucket: levelBucketOf(getEntryLevel(entry)),
    item: null,
  }));

  /* The chip row this view was once simply missing: without it, a reader
     wanting one level had to read every card in the grid to find them,
     while the two neighbouring views one row apart in the nav both had
     one. Levels are peers here — each chip carries its own count, and a
     level with a handful of characters is offered exactly like a level
     with a hundred. */
  const { wrap: levelWrap, buttons: levelButtons } = createFacetChips(
    collectFacets(rows.map((row) => [row.bucket]), LEVEL_ORDER),
    { className: 'kanji-filters__levels', ariaLabel: 'Filter by level' },
  );

  const levelLabel = describeLevelSpan(rows.map((row) => row.bucket));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'Тохирох ханз олдсонгүй.';
  empty.hidden = true;

  /* The grid, its search field and its facets are one thing — the browse
     surface — and the detail panel replaces all of it. Grouping them means
     opening and closing a detail is one flag rather than four `hidden`
     assignments that had already fallen out of step: `empty` was never in
     the list, so a detail opened after a search that found nothing came up
     with "No kanji match that" printed underneath it. */
  const browse = document.createElement('div');
  browse.className = 'kanji-browse';

  function openDetail(entry, opener) {
    if (opener) lastOpener = opener;
    browse.hidden = true;
    // Unhidden first: renderDetail moves focus to the panel's heading, and
    // focus() on a `hidden` element is silently dropped.
    detailElements.wrap.hidden = false;
    renderDetail(detailElements, entry, getEntryLevel(entry));
  }

  /* Focus goes back to the "View details" button that opened the panel, not
     to the top of the page: a reader who opened the 96th kanji and closed
     it again should be back at the 96th kanji, which is also where the
     browser leaves the scroll position.

     Only when the close was the reader backing out of the panel, though. The
     other caller is a route change, and there the router has already put
     focus on the incoming view's heading — reaching back into a section this
     app has just hidden to focus a button inside it is at best a no-op and
     at worst drops the reader somewhere they cannot see. */
  function closeDetail({ restoreFocus = true } = {}) {
    if (detailElements.wrap.hidden) return;
    detailElements.wrap.hidden = true;
    browse.hidden = false;
    if (restoreFocus) lastOpener?.focus();
    lastOpener = null;
  }

  detailElements.exit.addEventListener('click', () => closeDetail());

  // Escape closes the panel, matching the review session and the mobile
  // drawer — one key means "back out of this" everywhere in the app.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (location.hash.slice(1) !== VIEW_ID) return;
    closeDetail();
  });

  // Leaving the view and coming back should land on the grid. Without this
  // the panel was still open on return, showing one character with no sign
  // that a list of 132 was behind it.
  window.addEventListener('hashchange', () => closeDetail({ restoreFocus: false }));

  function cardFor(row) {
    if (!row.item) {
      row.item = createCard(row.entry, row.level, (entry) =>
        openDetail(entry, row.item.querySelector('.kanji-card__detail-button')));
    }
    return row.item;
  }

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const selected = new Set(
      levelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tag),
    );

    const matched = rows.filter((row) =>
      (selected.size === 0 || selected.has(row.bucket)) && matchesQuery(row.entry, query));

    grid.replaceChildren(...matched.map(cardFor));

    const total = formatCount(data.kanji.length);
    const count = query || selected.size > 0
      ? `${total} ханзаас ${formatCount(matched.length)} нь тохирлоо`
      : `${total} ханз`;
    summary.textContent = levelLabel ? `${levelLabel} · ${count}` : count;
    empty.hidden = matched.length > 0;
  }

  searchInput.addEventListener('input', debounce(applyFilter));
  levelButtons.forEach((button) => {
    button.addEventListener('click', () => {
      button.setAttribute('aria-pressed', String(button.getAttribute('aria-pressed') !== 'true'));
      applyFilter();
    });
  });

  applyFilter();

  browse.append(searchWrap, levelWrap, summary, grid, empty);
  container.replaceChildren(browse, detailElements.wrap);

  /* `#kanji/kj-n5-001` opens that character's panel rather than the grid.

     Registered here, at the end of a successful render, because a handler that
     fires before the grid exists has nothing to open. An id that names no
     entry does nothing at all — the grid stays as it is and focus stays where
     router.js put it, which is what a stale bookmark or a hand-typed hash
     should do. */
  showEntry = (itemId) => {
    const entry = data.kanji.find((candidate) => candidate.id === itemId);
    if (!entry) return;
    openDetail(entry);
    revealEntry(detailElements.character);
  };
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initKanji(itemId) {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'kanji-content'), {
    skeleton: 'compact-grid',
    load: loadKanji,
    render: renderGrid,
    errorTitle: 'Kanji ачаалагдсангүй.',
    errorDetail: `Тэмдэгтийн багц data/kanji.json дотор байгаа. ${OFFLINE_HINT}`,
  });

  /* Both halves of arriving at an entry. The argument is the first arrival,
     while this view is still being built and the router has no handler to call
     yet; the handler is every arrival after that, when the view is already on
     screen and only has to open the right panel. */
  registerItemHandler(VIEW_ID, (id) => showEntry?.(id));
  if (itemId) showEntry?.(itemId);
}

export { initKanji, loadKanji };
