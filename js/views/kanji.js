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
   Words, In lessons, Related Kanji. `examples` falls back to the single
   `example` field, and `related` is an array of characters, each rendered as
   a door into that character's own entry. 118 of the 132 entries carry one;
   the other 14 simply have no Related Kanji section, because a heading over
   an empty box is the same apology in a smaller font.

   Words and In lessons are the two sections that were not written by hand.
   They are read off data/links.js — every word in the catalogue whose
   headword contains this character — and they are the half of cross-linking
   that only a kanji screen can offer: a word can name the characters inside
   it by looking at itself, but a character has no way of knowing what uses
   it without asking the whole catalogue. 132 characters, 47 words behind the
   busiest of them, and not one reference written into kanji.json.

   THE PANEL IS THE ROUTE NOW, which is the other change here. Opening a
   detail sets `#kanji/kj-n5-001` and the panel is drawn in answer to that,
   rather than the panel being opened directly and the address left saying
   `#kanji`. Every way in goes through the same door: a card's own button, a
   Related Kanji chip, a link from a word on another screen, a bookmark, a
   reload. Backing out clears the entry from the address, so coming back to
   this screen lands on the grid rather than on whatever was last open.
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
  levelBucketOf,
  loadIntoView,
  JLPT_LEVELS,
  NO_LEVEL,
  OFFLINE_HINT,
} from '../ui/content.js';
import { createDoorRow } from '../ui/doors.js';
import { loadKanji, loadLinkIndex } from '../data/catalogue.js';
import { activeViewId, clearRouteTarget, onRouteTarget, parseRoute, routeTo } from '../core/router.js';

const VIEW_ID = 'kanji';

/* -- Data --------------------------------------------------------------------------- */



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

function createExample(example) {
  const wrap = document.createElement('div');
  wrap.className = 'kanji-detail__example';

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

function createTile(entry, onOpenDetail) {
  const item = document.createElement('li');
  item.className = 'kanji-tile';
  item.dataset.kanjiId = entry.id;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'kanji-tile__face';
  button.addEventListener('click', () => onOpenDetail(entry));

  const character = document.createElement('span');
  character.className = 'kanji-tile__character';
  character.lang = 'ja';
  character.textContent = entry.character;

  /* One gloss, and the first one only. A tile is a cell in a chart, and the
     chart's job is to let the eye find a character; the full list of meanings
     is one press away in the panel. */
  const meaning = document.createElement('span');
  meaning.className = 'kanji-tile__meaning';
  meaning.textContent = firstGloss(entry.meaning);

  button.append(character, meaning);
  item.append(button);

  /* A mark, not a badge: the characters already held show a short rule under
     them, so the chart answers "how far into this am I" at a glance without
     counting anything or printing a number. Read once, when the chart is
     built — pressing a character opens the panel, and coming back rebuilds. */
  if (isRemembered(entry.id)) item.dataset.remembered = 'true';

  return item;
}

const GLOSS_SEPARATOR = /[,、;·]/;

function firstGloss(meaning = '') {
  const [first] = String(meaning).split(GLOSS_SEPARATOR);
  return (first ?? '').trim();
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

/* Every related character is a chip that opens that character's own entry.
   The section is built only from characters this dataset actually holds, and
   returns null when that leaves nothing — renderDetail drops the whole
   section rather than heading an empty box.

   A character not in the dataset is dropped rather than shown inert. It used
   to render as an aria-disabled chip, which is a control that exists to be
   unusable: "Related Kanji" is a row of ways into other entries, and a
   character with no entry is not one of those. Counted rather than assumed —
   of 521 related references across the file, zero point outside the 132
   characters, so this branch changes nothing today and only decides what
   happens if the data ever grows past the app. */
function createRelatedBlock(entry, allEntries) {
  const matches = (entry.related ?? [])
    .map((character) => allEntries.find((candidate) => candidate.character === character))
    .filter(Boolean);

  /* Doors rather than the buttons this used to build. Visually a smaller
     change than it sounds — they sat in a row and jumped to another entry
     either way — but a button jumped *in place*, leaving the address on
     `#kanji` no matter how many characters deep the reader had walked. Three
     related characters in and the Back button took them out of the app. */
  return createDoorRow({
    doors: matches.map((match) => ({ view: VIEW_ID, target: match.id, headword: match.character })),
  });
}

/* -- The words behind a character -------------------------------------------
   Read off the link index, not out of kanji.json. Two rows rather than one,
   because a vocabulary entry and a lesson word are not the same kind of
   thing: one is an entry in the dictionary half of the app, the other is a
   line in a numbered lesson of a book the reader owns, and the door to each
   should say which it is before it is pressed.

   The gloss under each door is the entry's own meaning, trimmed. A door is a
   label on a room, not the room: enough to recognise the word by, and short
   enough that twelve of them still read as a row.
   ---------------------------------------------------------------------------- */

const GLOSS_LIMIT = 18;

function trimGloss(text) {
  const value = String(text ?? '').trim();
  return value.length > GLOSS_LIMIT ? `${value.slice(0, GLOSS_LIMIT - 1)}…` : value;
}

function createWordsBlock(entry, links) {
  return createDoorRow({
    doors: links.usesOf(entry.character).words.map((word) => ({
      view: 'vocabulary',
      target: word.id,
      headword: word.kanji || word.kana,
      gloss: trimGloss(word.meaning),
    })),
  });
}

function createLessonWordsBlock(entry, links) {
  return createDoorRow({
    doors: links.usesOf(entry.character).lessonWords.map(({ word, lesson }) => ({
      view: 'lessons',
      target: word.id,
      headword: word.word,
      gloss: `${lesson.lesson}. ${trimGloss(word.english)}`,
    })),
  });
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

  /* The two study controls, which used to sit on every card in the grid.
     The grid is a chart of characters now — a cell there holds a character
     and one gloss — so they live here, on the entry itself, which is also
     where a reader who has just read the meaning is when they decide they
     hold it. Rebuilt per entry rather than reused: studyControls binds to
     one id. */
  const controls = document.createElement('div');
  controls.className = 'kanji-detail__controls';

  head.append(character, tag, controls);

  const sections = document.createElement('div');
  sections.className = 'kanji-detail__sections';

  wrap.append(exit, head, sections);

  return { wrap, exit, character, tag, controls, sections };
}

function renderDetail(elements, entry, level, allEntries, links) {
  elements.character.textContent = entry.character;
  elements.tag.textContent = level ?? '';
  elements.tag.hidden = !level;
  elements.controls.replaceChildren(
    createStudyControls(entry.id, { className: 'kanji-detail__control-row' }).row,
  );

  /* Three of the seven sections can be absent, and each is built
     conditionally for the same reason: 14 of the 132 entries have no related
     characters, a character can appear in no word the catalogue holds, and
     the link index answers nothing at all when the files behind it failed to
     load. A panel of four sections, or five, or seven, is a panel showing
     what there is — a heading over an empty box is an apology in a smaller
     font, which is what took Stroke Order and Animation out of here. */
  const words = createWordsBlock(entry, links);
  const lessonWords = createLessonWordsBlock(entry, links);
  const related = createRelatedBlock(entry, allEntries);

  elements.sections.replaceChildren(
    ...[
      createDetailSection('Meaning', createTextBlock(entry.meaning)),
      createDetailSection('On', createTextBlock(entry.onyomi || '—', { lang: 'ja' })),
      createDetailSection('Kun', createTextBlock(entry.kunyomi || '—', { lang: 'ja' })),
      createDetailSection('Examples', createExamplesBlock(entry)),
      words && createDetailSection('Words', words),
      lessonWords && createDetailSection('In lessons', lessonWords),
      related && createDetailSection('Related Kanji', related),
    ].filter(Boolean),
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
   Same substring-match-and-hide approach as vocabulary.js/views/grammar.js —
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

  const grid = document.createElement('div');
  grid.className = 'kanji-chart';

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
    renderDetail(detailElements, entry, getEntryLevel(entry), data.kanji, data.links);
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
    // The address stops naming an entry that is no longer on screen. Without
    // this, backing out of 日 left the reader on `#kanji/kj-n5-001`, and the
    // next arrival at this view — a nav click, a reload, the Back button —
    // would open 日 again over the grid they asked for.
    clearRouteTarget(VIEW_ID);
  }

  detailElements.exit.addEventListener('click', () => closeDetail());

  // Escape closes the panel, matching the review session and the mobile
  // drawer — one key means "back out of this" everywhere in the app.
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if (activeViewId() !== VIEW_ID) return;
    closeDetail();
  });

  /* Leaving the view and coming back should land on the grid. Without this
     the panel was still open on return, showing one character with no sign
     that a list of 132 was behind it.

     Every navigation except one: a hash still naming an entry on this screen
     is a reader moving *between* entries — a Related Kanji door, a link from
     a word on another screen — and the router has already reopened the panel
     on the new one by the time this runs. Closing it here would shut the
     door they just went through. */
  window.addEventListener('hashchange', () => {
    const route = parseRoute(location.hash);
    if (route.viewId === VIEW_ID && route.target) return;
    closeDetail({ restoreFocus: false });
  });

  function tileFor(row) {
    if (!row.item) {
      row.item = createTile(row.entry, (entry) => routeTo(VIEW_ID, entry.id));
    }
    return row.item;
  }

  /* One band per level, in ladder order, each a heading and a chart of the
     characters in it. The bands are what makes 132 characters a set a reader
     can hold in their head rather than a run: N5 is a hundred and eighteen
     characters and N2 is fourteen, and a chart that says so is answering the
     question the level chips above it can only filter by. */
  function createBand(bucket, entries) {
    const band = document.createElement('section');
    band.className = 'kanji-band';

    const head = document.createElement('h2');
    head.className = 'kanji-band__head';

    const label = document.createElement('span');
    label.className = 'kanji-band__label';
    label.textContent = bucket;

    const count = document.createElement('span');
    count.className = 'kanji-band__count';
    count.textContent = formatCount(entries.length);

    head.append(label, count);

    const chart = document.createElement('ul');
    chart.className = 'kanji-chart__grid';
    chart.append(...entries.map(tileFor));

    band.append(head, chart);
    return band;
  }

  function applyFilter() {
    const query = searchInput.value.trim().toLowerCase();
    const selected = new Set(
      levelButtons.filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.dataset.tag),
    );

    const matched = rows.filter((row) =>
      (selected.size === 0 || selected.has(row.bucket)) && matchesQuery(row.entry, query));

    const bands = [];
    for (const bucket of LEVEL_ORDER) {
      const inBand = matched.filter((row) => row.bucket === bucket);
      if (inBand.length > 0) bands.push(createBand(bucket, inBand));
    }
    grid.replaceChildren(...bands);

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

  /* Last, and after the panel is in the document rather than before it. Where
     every way into the detail converges: a card's own button, a Related Kanji
     door, a word linking back from another screen, a bookmarked URL. Each
     sets the address, and this draws whatever the address names.

     Registered here because opening the panel ends by moving focus into it,
     and focus() on an element that is not yet in the document is silently
     dropped — subscribing three lines earlier would have left a reader who
     followed a link looking at the top of the page instead of at the
     character they asked for.

     An id the catalogue no longer holds is not an error — a retired entry, a
     mistyped link, a bookmark older than the data — and it lands on the grid,
     which is where a reader who asked for a kanji that isn't there should be
     standing. */
  onRouteTarget(VIEW_ID, (id) => {
    const row = rows.find((candidate) => candidate.entry.id === id);
    if (!row) return;
    openDetail(row.entry, tileFor(row).querySelector('.kanji-tile__face'));
  });
}

/* -- Init ---------------------------------------------------------------------------------- */

async function initKanji() {
  const view = document.getElementById(VIEW_ID);
  if (!view) return;

  await loadIntoView(getViewContainer(view, 'kanji-content'), {
    skeleton: 'compact-grid',
    /* The link index alongside the characters. It never rejects — see
       catalogue.js — so pairing it with loadKanji here cannot turn a missing
       lesson file into this view's error state; at worst the panel comes up
       without its Words and In lessons sections. */
    load: async () => {
      const [data, links] = await Promise.all([loadKanji(), loadLinkIndex()]);
      return { ...data, links };
    },
    render: renderGrid,
    errorTitle: 'Kanji ачаалагдсангүй.',
    errorDetail: `Тэмдэгтийн багц data/kanji.json дотор байгаа. ${OFFLINE_HINT}`,
  });
}

export { initKanji };
