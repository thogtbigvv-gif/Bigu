/* ==========================================================================
   content.js
   Shared machinery behind every reference view: the "fetch once, cache in
   memory, fail loudly" loader, the skeleton shown while that fetch is in
   flight, the retryable error state shown when it fails, and the search
   field that sits above each list. Each of these existed as four or five
   near-identical copies across vocabulary.js, grammar.js, kanji.js,
   lessons.js, reading.js, and dashboard.js; they live here once instead so
   the five views can't drift apart.
   ========================================================================== */

/* Returns a load() function scoped to one JSON file: the first call
   fetches and caches the parsed result, every call after that returns
   the cached value. A failed or non-OK fetch throws a labeled error
   (e.g. "Failed to load vocabulary (404)") so the caller's own
   try/catch can show its own message. Only successful responses are
   cached, so a retry after a failure really does re-fetch. */
function createContentLoader(url, label) {
  let cached = null;

  return async function load() {
    if (cached) return cached;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${label} (${response.status})`);
    }

    cached = await response.json();
    return cached;
  };
}

/* -- View plumbing --------------------------------------------------------------------
   Every view module opened with the same six lines: look for its own
   content wrapper inside the section, create it on first render, return it.
   Seven copies of one function that differed only in a class name — and
   because each was private, the one thing they all needed later (a
   scroll-margin hook, an aria-busy contract) had to be added seven times.
   ------------------------------------------------------------------------------------ */

function getViewContainer(view, className) {
  let content = view.querySelector(`.${className}`);
  if (!content) {
    content = document.createElement('div');
    content.className = className;
    view.append(content);
  }
  return content;
}

/* -- JLPT levels ------------------------------------------------------------------------
   The ladder, easiest first — the order a learner meets it in, and the
   order every chip row and every range label reads it in. It lives here
   once because vocabulary, kanji, grammar and reading all sort by it, and
   three private copies of the same five strings is three chances for one
   view to quietly know about a level the others don't.

   No level is special. N5 is not the default and N1 is not the goal; a
   level holding two entries is offered exactly like a level holding eight
   hundred, with a smaller number beside it.

   NO_LEVEL is the bucket for Japanese the exam has no opinion about —
   slang, a line out of a drama, a word picked up in the wild. Content
   files are allowed to carry entries with no JLPT level, and those entries
   belong somewhere reachable rather than being dropped from the chip row
   or silently filed under a level nobody chose for them.
   ------------------------------------------------------------------------------------ */

const JLPT_LEVELS = ['N5', 'N4', 'N3', 'N2', 'N1'];

const NO_LEVEL = 'Outside JLPT';

/* The same bucket said mid-sentence, for the summary line — "N5–N2 +
   outside JLPT" rather than a second capital in the middle of a phrase.
   The acronym keeps its capitals; only the ordinary word loses one. */
const NO_LEVEL_INLINE = 'outside JLPT';

/* The first JLPT level found among an entry's tags, or null when it has
   none. Null is a real answer here, not a missing one. */
function jlptLevelOf(tags) {
  return JLPT_LEVELS.find((level) => tags.includes(level)) ?? null;
}

/* An entry's facet bucket: its own level, or the unleveled one. */
function levelBucketOf(level) {
  return level ?? NO_LEVEL;
}

/* The span a set of entries actually covers, for a view's summary line:
   "N5" for one level, "N5–N2" across several, "N5–N2 + outside JLPT" when
   some entries sit outside the ladder, and just "Outside JLPT" when none
   of them have a level at all. Derived from the entries every time — there
   is no file-level field to read it off, and there hasn't been one since
   the day a file first held two levels and kept claiming one.

   Returns null when there is nothing to say, so a caller can leave the
   prefix off its summary rather than print an empty separator. */
function describeLevelSpan(buckets) {
  const present = new Set(buckets);
  const levels = JLPT_LEVELS.filter((level) => present.has(level));

  const parts = [];
  if (levels.length === 1) parts.push(levels[0]);
  else if (levels.length > 1) parts.push(`${levels[0]}–${levels[levels.length - 1]}`);
  if (present.has(NO_LEVEL)) parts.push(levels.length ? NO_LEVEL_INLINE : NO_LEVEL);

  return parts.length ? parts.join(' + ') : null;
}

/* -- Small utilities -------------------------------------------------------------------
   Counts are read, not just seen. "1132" is a string of digits a reader has
   to parse; "1,132" is a number. Used anywhere the app shows a catalogue
   size, which is the only place its figures get big enough to matter.
   ------------------------------------------------------------------------------------ */

const countFormatter = new Intl.NumberFormat('en');

function formatCount(value) {
  return countFormatter.format(value);
}

/* -- Facet chips ---------------------------------------------------------------------
   The chip row above a list. Which chips exist is read out of the data, not
   written down in a view: a chip appears when there are entries behind it
   and carries how many, so a control can never be pressed to produce an
   empty list. A row that would offer exactly one choice isn't a filter,
   it's a label, and it doesn't render at all.

   `order` is the preferred reading order; anything the data carries that
   the caller has never heard of still gets a chip, appended after the
   known ones, so a new topic tag doesn't have to be registered in two
   places to become usable.
   ------------------------------------------------------------------------------------ */

function collectFacets(tagLists, order) {
  const counts = new Map();
  for (const tags of tagLists) {
    for (const tag of tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }

  const known = order.filter((tag) => counts.has(tag));
  const extra = [...counts.keys()].filter((tag) => !order.includes(tag)).sort();
  const tags = [...known, ...extra];

  return tags.length > 1 ? tags.map((tag) => ({ tag, count: counts.get(tag) })) : [];
}

/* Multi-select, nothing pressed to begin with — pressing nothing means
   everything, which is how no level ends up being the default one. Reuses
   the same .toggle-chip pressed/unpressed language as the per-card memory
   button. */
function createFacetChips(facets, { className, ariaLabel }) {
  const wrap = document.createElement('div');
  wrap.className = className;
  wrap.hidden = facets.length === 0;
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', ariaLabel);

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

/* Trailing-edge debounce. Filtering used to run on every keystroke over
   every row in the list; at 800 words that is a full pass plus a layout
   flush per character typed, and it showed as dropped keys on a phone.
   One pass after the reader stops typing does the same job. */
function debounce(fn, wait = 140) {
  let timer = null;
  return function debounced(...args) {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => fn.apply(this, args), wait);
  };
}

/* -- Inline SVG ---------------------------------------------------------------------
   Every icon in the app is an inline <svg> (nav chevron, theme toggle,
   hamburger, lesson chevron, brand mark) except the two that used to be
   data-URI backgrounds in forms.css. A data URI can't reference a custom
   property, so those two had their color baked in as a literal hex with a
   comment asking future edits to keep it in sync with --color-ash by hand.
   Drawn inline they inherit currentColor and that whole class of drift
   disappears.
   ------------------------------------------------------------------------------------ */

const SVG_NS = 'http://www.w3.org/2000/svg';

function createIcon(className, draw) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');

  for (const [tag, attrs] of draw) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      node.setAttribute(name, value);
    }
    svg.append(node);
  }

  return svg;
}

/* -- Search field ---------------------------------------------------------------------
   The one input at the top of vocabulary, grammar, and kanji. The icon sits
   in a positioned wrapper around the input rather than on the input itself:
   an <input> is a replaced element, so it can't carry a pseudo-element of
   its own, and masking its background would take the field's own surface
   with it.
   ------------------------------------------------------------------------------------ */

function createSearchField({ id, label: labelText, placeholder }) {
  const wrap = document.createElement('div');
  wrap.className = 'search-field';

  const label = document.createElement('label');
  label.className = 'field-label';
  label.htmlFor = id;
  label.textContent = labelText;

  const control = document.createElement('div');
  control.className = 'search-field__control';

  const icon = createIcon('search-field__icon', [
    ['circle', { cx: '7', cy: '7', r: '5' }],
    ['line', { x1: '11', y1: '11', x2: '14', y2: '14' }],
  ]);

  const input = document.createElement('input');
  input.type = 'search';
  input.id = id;
  input.className = 'field';
  input.placeholder = placeholder;
  input.autocomplete = 'off';

  control.append(icon, input);
  wrap.append(label, control);
  return { wrap, input };
}

/* -- Loading skeletons -----------------------------------------------------------------
   Between page load and the first fetch resolving, each view used to hold
   nothing but its own <h1> — indistinguishable, from the reader's side,
   from the app being broken. A skeleton in the shape of the content that's
   coming answers "is this loading or is it dead?" before the data arrives,
   and matching the real grid means nothing jumps when the two swap.

   Shapes mirror the grid each view actually renders into, so the placeholder
   column count matches the real one at every width:
     card-grid     — vocabulary / reading: minmax(20rem, 1fr)
     compact-grid  — kanji: minmax(14rem, 1fr)
     list          — grammar: full-width rows
     rows          — lessons: a stack of collapsed group headers
     dashboard     — four summary cards: minmax(16rem, 1fr)
     memory        — a hero block over two shelf-height bands

   The pulse is a CSS animation, so reset.css's global prefers-reduced-motion
   rule already stops it — nothing extra is needed here.
   ------------------------------------------------------------------------------------ */

const SKELETON_SHAPES = {
  'card-grid': { count: 6, block: 'skeleton__block--card' },
  'compact-grid': { count: 8, block: 'skeleton__block--compact' },
  list: { count: 5, block: 'skeleton__block--row' },
  rows: { count: 6, block: 'skeleton__block--bar' },
  dashboard: { count: 4, block: 'skeleton__block--card' },
  memory: { count: 3, block: 'skeleton__block--row' },
};

function renderSkeleton(container, shape) {
  const spec = SKELETON_SHAPES[shape] ?? SKELETON_SHAPES.list;

  const wrap = document.createElement('div');
  wrap.className = `skeleton skeleton--${shape}`;
  // The placeholder carries no information a screen reader can use; the
  // aria-busy on the container is what actually announces the wait.
  wrap.setAttribute('aria-hidden', 'true');

  for (let i = 0; i < spec.count; i += 1) {
    const block = document.createElement('div');
    block.className = `skeleton__block ${spec.block}`;
    wrap.append(block);
  }

  container.setAttribute('aria-busy', 'true');
  container.replaceChildren(wrap);
}

/* -- Error state -------------------------------------------------------------------------
   Five modules each defined their own renderError() producing a bare
   <p class="meta"> — grey 14px text with no border and no presence, which
   made "something went wrong" look quieter on the page than "there's
   nothing here yet". This is the same shape as .empty-state with a solid
   error border, and it says what probably happened and offers a way out
   instead of stopping at "could not be loaded right now".

   The cause named in the detail line is the likely one: this app fetches
   its JSON, so opening index.html straight off the filesystem fails every
   load with no network involved (see README).
   ------------------------------------------------------------------------------------------ */

function renderError(container, { title, detail, onRetry }) {
  const wrap = document.createElement('div');
  wrap.className = 'error-state';
  wrap.setAttribute('role', 'alert');

  const heading = document.createElement('p');
  heading.className = 'error-state__title';
  heading.textContent = title;

  const body = document.createElement('p');
  body.className = 'error-state__detail';
  body.textContent = detail;

  wrap.append(heading, body);

  if (onRetry) {
    const retry = document.createElement('button');
    retry.type = 'button';
    retry.className = 'button button--secondary';
    retry.textContent = 'Try again';
    retry.addEventListener('click', onRetry);
    wrap.append(retry);
  }

  container.removeAttribute('aria-busy');
  container.replaceChildren(wrap);
}

/* -- The load cycle ----------------------------------------------------------------------
   Skeleton → fetch → render, with a retryable error state on failure. Every
   reference view runs exactly this sequence, so it's written once here
   rather than six times with six slightly different error messages.
   `render` is handed the container and the loaded data; `load` is one of
   the module loaders above.
   ------------------------------------------------------------------------------------------ */

async function loadIntoView(container, { skeleton, load, render, errorTitle, errorDetail }) {
  async function attempt() {
    renderSkeleton(container, skeleton);

    try {
      const data = await load();
      render(container, data);
      container.removeAttribute('aria-busy');
    } catch (error) {
      console.error('[Bigu]', error);
      renderError(container, { title: errorTitle, detail: errorDetail, onRetry: attempt });
    }
  }

  await attempt();
}

/* -- Storage warning ---------------------------------------------------------------------
   When localStorage throws — Safari private browsing, a locked-down
   profile, site data blocked — every store in the app silently becomes a
   no-op: chips un-press themselves on the next render, the streak never
   starts, a saved journal entry is gone on reload. app.js has always
   detected this at boot and told nobody but the console, which means the
   one failure that loses a reader's work was also the only one the reader
   was never shown.

   Shown on the Dashboard, because that is where people land, and on
   Settings, because that is the screen about their data. Stated plainly and
   without alarm: the app still works, nothing will be here tomorrow.
   ------------------------------------------------------------------------------------------ */

function createStorageNotice() {
  const wrap = document.createElement('div');
  wrap.className = 'error-state storage-notice';
  wrap.setAttribute('role', 'alert');

  const title = document.createElement('p');
  title.className = 'error-state__title';
  title.textContent = 'Энэ хөтөч Bigu-д юу ч хадгалахыг зөвшөөрөхгүй байна.';

  const detail = document.createElement('p');
  detail.className = 'error-state__detail';
  detail.textContent =
    'Та хэвийн сурч болно, гэхдээ давтах хуваарь, санах ой, тэмдэглэл тань таб хаагдахад алга болно. Ихэвчлэн нууц горимоос болдог; энэ хуудсанд сайтын өгөгдөл хадгалахыг зөвшөөрвөл засарна.';

  wrap.append(title, detail);
  return wrap;
}

/* The second half of every error message in the app. Named once so the six
   views can't describe the same failure six different ways. */
const OFFLINE_HINT =
  'Үүнийг татаж чадсангүй. Хэрэв та энэ хуудсыг файлаар нээсэн бол локал сервер дээр ажиллуулах хэрэгтэй — шаардлагатай нэг мөр тушаалыг README дотор бичсэн байгаа.';

/* Only what another module actually imports. renderError and
   renderSkeleton are the two halves of loadIntoView and are called from
   nowhere else; exporting them advertised an API with no callers, which is
   the kind of surface that quietly grows a second, slightly different
   error state the first time someone reaches for it. */
export {
  collectFacets,
  createContentLoader,
  createFacetChips,
  createIcon,
  createSearchField,
  describeLevelSpan,
  getViewContainer,
  formatCount,
  debounce,
  createStorageNotice,
  jlptLevelOf,
  levelBucketOf,
  loadIntoView,
  JLPT_LEVELS,
  NO_LEVEL,
  OFFLINE_HINT,
};
