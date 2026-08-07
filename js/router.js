/* ==========================================================================
   router.js
   Minimal hash-based router. Reads whichever `.view` sections exist inside
   #main-content — no hardcoded view list — so adding, removing, or renaming
   a view only means editing index.html, never this file.

   It also owns first-render: app.js registers one initializer per view and
   this module runs each the first time its view becomes active, so a view
   the reader never opens never fetches its data or builds its DOM.
   ========================================================================== */

const DEFAULT_VIEW = 'dashboard';
const APP_NAME = 'Bigu';

/* viewId -> initializer, and the set already run. A Map plus a Set rather
   than deleting from the Map, so a re-registration can't silently resurrect
   a view that already rendered. */
const initializers = new Map();
const initialized = new Set();

function registerView(viewId, initializer) {
  initializers.set(viewId, initializer);
}

/* Errors are logged rather than thrown: a view module that fails to
   initialize shouldn't stop the router from switching views, and each
   module already renders its own error state for the failures it expects. */
function ensureInitialized(viewId) {
  if (initialized.has(viewId)) return;
  const initializer = initializers.get(viewId);
  if (!initializer) return;

  initialized.add(viewId);
  try {
    const result = initializer();
    if (result && typeof result.catch === 'function') {
      result.catch((error) => console.error('[Bigu]', error));
    }
  } catch (error) {
    console.error('[Bigu]', error);
  }
}

function getViews() {
  return Array.from(document.querySelectorAll('#main-content > .view'));
}

function getNavLink(viewId) {
  return document.querySelector(`.site-nav__link[data-view="${viewId}"]`);
}

function getHeading(viewId) {
  return document.getElementById(`${viewId}-heading`);
}

function resolveViewId(views) {
  const requested = location.hash.slice(1);
  const isKnown = views.some((view) => view.id === requested);
  return isKnown ? requested : DEFAULT_VIEW;
}

function updateDocumentTitle(viewId) {
  const heading = getHeading(viewId);
  document.title = heading ? `${heading.textContent} — ${APP_NAME}` : APP_NAME;
}

/* Two things happen on every navigation, in this order.

   Scroll first. Views are siblings in one document, so the scroll offset
   survives the switch: leaving the vocabulary list 4,000px down and opening
   Settings landed the reader below a two-card page, looking at the footer,
   with no indication that anything had happened. `instant` rather than a
   smooth scroll because this is a page change, not a jump within a page —
   and reset.css's reduced-motion rule can't reach a scroll started from JS.

   Focus second, on the new view's heading, so a keyboard or screen-reader
   reader starts at the top of what they asked for. `preventScroll` keeps
   that focus from undoing the scroll above; the heading is already at the
   top of the page, and without it the browser would re-scroll to put the
   heading flush against the viewport edge — underneath the sticky header.
   (css/layout.css also gives headings a scroll-margin-top for the same
   reason, for the anchor-link path this doesn't own.) */
function focusView(view) {
  window.scrollTo({ top: 0, behavior: 'instant' });

  const target = getHeading(view.id) || view;
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
}

function render({ moveFocus = false } = {}) {
  const views = getViews();
  if (views.length === 0) return;

  const activeId = resolveViewId(views);

  // Normalize an empty or unknown hash without adding a new history entry
  if (location.hash.slice(1) !== activeId) {
    history.replaceState(null, '', `#${activeId}`);
  }

  let activeView = null;

  for (const view of views) {
    const isActive = view.id === activeId;
    view.hidden = !isActive;
    if (isActive) activeView = view;

    const link = getNavLink(view.id);
    if (!link) continue;
    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }

  updateDocumentTitle(activeId);

  // After the view is visible, so a module that measures or focuses
  // something on init isn't doing it inside a hidden section.
  ensureInitialized(activeId);

  if (moveFocus && activeView) {
    focusView(activeView);
    playEnter(activeView);
  }
}

/* A 160ms rise-and-fade on the incoming view. Switching views is the one
   moment in this app where the entire screen is replaced at once, and
   without a transition it reads as a flash rather than as an arrival. Kept
   under the app's own motion ceiling and restarted the same way practice.js
   restarts its card animation — class off, reflow, class on — so rapid
   navigation doesn't leave a view stuck mid-animation. reset.css's
   reduced-motion rule collapses it to nothing. */
function playEnter(view) {
  view.classList.remove('is-entering');
  void view.offsetWidth;
  view.classList.add('is-entering');
  view.addEventListener('animationend', () => view.classList.remove('is-entering'), { once: true });
}

function initRouter() {
  /* Every route here is a fragment, which means the browser's own anchor
     handling fires before this module renders anything: loading #vocabulary
     scrolls `#vocabulary` to the top of the viewport, underneath the sticky
     header, so the view's heading was cut off above the fold on every
     direct load and every bookmark. css/layout.css's scroll-margin softens
     that; starting at the top of the page removes it. A hash here names a
     view, not a position within one, so there is never a position to
     preserve — including across a reload, which is what scrollRestoration
     turns off. */
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';

  window.addEventListener('hashchange', () => render({ moveFocus: true }));
  render();

  // Next frame, not this one: the view being routed to is `hidden` until
  // render() above un-hides it, and the browser performs its own anchor
  // scroll once that element finally has a box — which is after this tick.
  requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: 'instant' }));
}

export { initRouter, registerView };
