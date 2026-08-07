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

   Stroke Order and Animation need real per-character stroke-path data
   (something like the KanjiVG dataset) that doesn't exist in kanji.json
   yet, so both render a "coming soon" note for every entry today — same
   empty-state language used elsewhere for not-yet-built stages. Examples
   and Related Kanji are wired to real (optional) data fields now:
   `examples` (falls back to the existing single `example`) and `related`
   (an array of characters; each renders as a jump-to-that-kanji chip when
   the character is found in this same dataset, plain text otherwise).
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

const DATA_URL = 'data/kanji.json';
const VIEW_ID = 'kanji';

/* -- Data --------------------------------------------------------------------------- */

const loadKanji = createContentLoader(DATA_URL, 'kanji');


/* -- Shared fields -------------------------------------------------------------------
   `examples` is optional; entries that don't have one yet (all of today's
   data) fall back to a single-item list built from the existing required
   `example`, so nothing needs to change in kanji.json for old entries.
   -------------------------------------------------------------------------------------- */

function getExamples(entry) {
  return entry.examples && entry.examples.length ? entry.examples : [entry.example];
}

/* The JLPT levels, hardest-last — the order the summary label reads them in. */
const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

/* An entry's own level, not the file's: the set spans N5 and N2 now, so a
   card labelled with `data.level` would put the wrong chip on most of the
   grid. `level` is optional, so older entries still fall back to the file. */
function getEntryLevel(entry, data) {
  return entry.level ?? data.level;
}

/* "N5" for a single-level file, "N5–N2" once it spans several. */
function getLevelLabel(data) {
  const present = JLPT_LEVELS.filter((level) =>
    data.kanji.some((entry) => getEntryLevel(entry, data) === level));
  if (present.length === 0) return data.level;
  return present.length === 1 ? present[0] : `${present[0]}–${present[present.length - 1]}`;
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
  item.className = 'card kanji-card card--deferred';
  item.dataset.kanjiId = entry.id;

  const head = document.createElement('div');
  head.className = 'kanji-card__head';

  const character = document.createElement('p');
  character.className = 'kanji-card__character';
  character.lang = 'ja';
  character.textContent = entry.character;

  const tag = document.createElement('span');
  tag.className = 'jlpt-tag';
  tag.textContent = level;

  head.append(character, tag);

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

function createComingSoonBlock(message) {
  const p = document.createElement('p');
  p.className = 'empty-state';
  p.textContent = message;
  return p;
}

function createExamplesBlock(entry) {
  const list = document.createElement('div');
  list.className = 'kanji-detail__examples';
  list.append(...getExamples(entry).map((example) => createExample(example)));
  return list;
}

/* Each related character becomes a jump-to-entry chip when it exists in
   this same dataset; otherwise it's just shown as plain text, since there's
   nowhere for it to link to. */
function createRelatedBlock(entry, allEntries, onJump) {
  const related = entry.related ?? [];

  if (related.length === 0) {
    return createComingSoonBlock('Related kanji are coming soon.');
  }

  const wrap = document.createElement('div');
  wrap.className = 'kanji-detail__related';

  for (const character of related) {
    const match = allEntries.find((candidate) => candidate.character === character);

    if (match) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'toggle-chip';
      button.lang = 'ja';
      button.textContent = character;
      button.addEventListener('click', () => onJump(match));
      wrap.append(button);
    } else {
      const span = document.createElement('span');
      span.className = 'toggle-chip';
      span.lang = 'ja';
      span.setAttribute('aria-disabled', 'true');
      span.textContent = character;
      wrap.append(span);
    }
  }

  return wrap;
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

function renderDetail(elements, entry, level, allEntries, onJump) {
  elements.character.textContent = entry.character;
  elements.tag.textContent = level;

  elements.sections.replaceChildren(
    createDetailSection('Meaning', createTextBlock(entry.meaning)),
    createDetailSection('On', createTextBlock(entry.onyomi || '—', { lang: 'ja' })),
    createDetailSection('Kun', createTextBlock(entry.kunyomi || '—', { lang: 'ja' })),
    createDetailSection('Stroke Order', createComingSoonBlock('Stroke order diagrams are coming soon.')),
    createDetailSection('Animation', createComingSoonBlock('Stroke order animation is coming soon.')),
    createDetailSection('Examples', createExamplesBlock(entry)),
    createDetailSection('Related Kanji', createRelatedBlock(entry, allEntries, onJump)),
  );

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

/* The same level facets vocabulary and grammar offer, which this view was
   simply missing. The set spans N5 and N2, so a reader wanting to drill one
   level had to read 132 cards to find them — while the two neighbouring
   views one row apart in the nav both had a chip row. A single level
   present means no row, same rule as the other two. */
function collectLevels(rows) {
  const counts = new Map();
  for (const row of rows) counts.set(row.level, (counts.get(row.level) ?? 0) + 1);
  const present = JLPT_LEVELS.filter((level) => counts.has(level));
  return present.length > 1 ? present.map((level) => ({ tag: level, count: counts.get(level) })) : [];
}

function createLevelFilters(facets) {
  const wrap = document.createElement('div');
  wrap.className = 'kanji-filters__levels';
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

function renderGrid(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'kanji-search',
    label: 'Search kanji',
    placeholder: 'Character, reading, or meaning',
  });

  const summary = document.createElement('p');
  summary.className = 'kanji-meta meta';
  summary.setAttribute('aria-live', 'polite');
  const levelLabel = getLevelLabel(data);

  const grid = document.createElement('ul');
  grid.className = 'kanji-grid';

  const detailElements = buildDetailPanel();
  let lastOpener = null;

  const rows = data.kanji.map((entry) => ({
    entry,
    level: getEntryLevel(entry, data),
    item: null,
  }));

  const { wrap: levelWrap, buttons: levelButtons } = createLevelFilters(collectLevels(rows));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'No kanji match that. Try the character itself, a reading, or a meaning.';
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
    renderDetail(detailElements, entry, getEntryLevel(entry, data), data.kanji, openDetail);
  }

  /* Focus goes back to the "View details" button that opened the panel, not
     to the top of the page: a reader who opened the 96th kanji and closed
     it again should be back at the 96th kanji, which is also where the
     browser leaves the scroll position. */
  function closeDetail() {
    if (detailElements.wrap.hidden) return;
    detailElements.wrap.hidden = true;
    browse.hidden = false;
    lastOpener?.focus();
    lastOpener = null;
  }

  detailElements.exit.addEventListener('click', closeDetail);

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
  window.addEventListener('hashchange', closeDetail);

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
      (selected.size === 0 || selected.has(row.level)) && matchesQuery(row.entry, query));

    grid.replaceChildren(...matched.map(cardFor));

    const total = formatCount(data.kanji.length);
    summary.textContent = query || selected.size > 0
      ? `${levelLabel} · ${formatCount(matched.length)} of ${total} kanji`
      : `${levelLabel} · ${total} kanji`;
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
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initKanji() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'kanji-content'), {
    skeleton: 'compact-grid',
    load: loadKanji,
    render: renderGrid,
    errorTitle: 'Kanji didn’t load.',
    errorDetail: `The character set is in data/kanji.json. ${OFFLINE_HINT}`,
  });
}

export { initKanji, loadKanji };
