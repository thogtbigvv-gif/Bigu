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

/* -- Small utilities -------------------------------------------------------------------
   Counts are read, not just seen. "1132" is a string of digits a reader has
   to parse; "1,132" is a number. Used anywhere the app shows a catalogue
   size, which is the only place its figures get big enough to matter.
   ------------------------------------------------------------------------------------ */

const countFormatter = new Intl.NumberFormat('en');

function formatCount(value) {
  return countFormatter.format(value);
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
  title.textContent = 'This browser isn’t letting Bigu save anything.';

  const detail = document.createElement('p');
  detail.className = 'error-state__detail';
  detail.textContent =
    'You can study normally, but your schedule, memory and journal will be gone when you close the tab. Private browsing is the usual cause; allowing site data for this page fixes it.';

  wrap.append(title, detail);
  return wrap;
}

/* The second half of every error message in the app. Named once so the six
   views can't describe the same failure six different ways. */
const OFFLINE_HINT =
  'It couldn’t be fetched. If you opened this page as a file, it needs to run from a local server — check the README for the one-line command.';

/* Only what another module actually imports. renderError and
   renderSkeleton are the two halves of loadIntoView and are called from
   nowhere else; exporting them advertised an API with no callers, which is
   the kind of surface that quietly grows a second, slightly different
   error state the first time someone reaches for it. */
export {
  createContentLoader,
  createIcon,
  createSearchField,
  getViewContainer,
  formatCount,
  debounce,
  createStorageNotice,
  loadIntoView,
  OFFLINE_HINT,
};
