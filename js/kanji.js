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

import { isRemembered, setRemembered } from './review.js';
import { createFavoriteButton } from './favorites.js';
import { createContentLoader, createSearchField, loadIntoView, OFFLINE_HINT } from './content.js';

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

/* One vocabulary across the app: a kanji is held in memory or it isn't,
   said the same way a word or a grammar pattern is. The bookmark beside it
   is the same control too — see js/favorites.js. */
function createMemoryControls(entry) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'toggle-chip';

  const sync = () => {
    const remembered = isRemembered(entry.id);
    button.setAttribute('aria-pressed', String(remembered));
    button.textContent = remembered ? 'In memory' : 'Remember this';
  };

  button.addEventListener('click', () => {
    setRemembered(entry.id, !isRemembered(entry.id));
    sync();
  });

  sync();

  const controls = document.createElement('div');
  controls.className = 'kanji-card__controls';
  controls.append(button, createFavoriteButton(entry.id));
  return controls;
}

/* -- Grid card -------------------------------------------------------------------------
   The compact overview: character, meaning, readings, one example
   preview, memory controls, and now a "View details" button opening the
   full entry below. The card itself stays exactly as small as before —
   detail content only exists once the button is pressed.
   ------------------------------------------------------------------------------------------ */

function createCard(entry, level, onOpenDetail) {
  const item = document.createElement('li');
  item.className = 'card kanji-card';
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

  item.append(
    head,
    meaning,
    createReadings(entry),
    createExample(entry.example),
    createMemoryControls(entry),
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

  const character = document.createElement('p');
  character.className = 'kanji-detail__character';
  character.lang = 'ja';

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

  elements.wrap.scrollTo?.(0, 0);
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

function getContentContainer(view) {
  let content = view.querySelector('.kanji-content');
  if (!content) {
    content = document.createElement('div');
    content.className = 'kanji-content';
    view.append(content);
  }
  return content;
}

function renderGrid(container, data) {
  const { wrap: searchWrap, input: searchInput } = createSearchField({
    id: 'kanji-search',
    label: 'Search kanji',
    placeholder: 'Search by character, reading, or meaning',
  });

  const summary = document.createElement('p');
  summary.className = 'kanji-meta meta';
  const levelLabel = getLevelLabel(data);

  const grid = document.createElement('ul');
  grid.className = 'kanji-grid';

  const detailElements = buildDetailPanel();

  function openDetail(entry) {
    searchWrap.hidden = true;
    summary.hidden = true;
    grid.hidden = true;
    renderDetail(detailElements, entry, getEntryLevel(entry, data), data.kanji, openDetail);
    detailElements.wrap.hidden = false;
  }

  detailElements.exit.addEventListener('click', () => {
    detailElements.wrap.hidden = true;
    searchWrap.hidden = false;
    summary.hidden = false;
    grid.hidden = false;
  });

  const rows = data.kanji.map((entry) => ({
    entry,
    item: createCard(entry, getEntryLevel(entry, data), openDetail),
  }));
  grid.append(...rows.map((row) => row.item));

  const empty = document.createElement('p');
  empty.className = 'empty-state';
  empty.textContent = 'No kanji match your search.';
  empty.hidden = true;

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    let visible = 0;
    for (const row of rows) {
      const matches = matchesQuery(row.entry, query);
      row.item.hidden = !matches;
      if (matches) visible += 1;
    }
    summary.textContent = query
      ? `${levelLabel} · ${visible} / ${data.kanji.length} kanji`
      : `${levelLabel} · ${data.kanji.length} kanji`;
    empty.hidden = visible > 0;
  }

  searchInput.addEventListener('input', applyFilter);
  applyFilter();

  container.replaceChildren(searchWrap, summary, grid, empty, detailElements.wrap);
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initKanji() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getContentContainer(view), {
    skeleton: 'compact-grid',
    load: loadKanji,
    render: renderGrid,
    errorTitle: 'Kanji didn’t load.',
    errorDetail: `The character set is in data/kanji.json. ${OFFLINE_HINT}`,
  });
}

export { initKanji, loadKanji };
