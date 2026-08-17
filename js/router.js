/* ==========================================================================
   router.js
   Minimal hash-based router. Reads whichever `.view` sections exist inside
   #main-content — no hardcoded view list — so adding, removing, or renaming
   a view only means editing index.html, never this file.

   It also owns first-render: app.js registers one initializer per view and
   this module runs each the first time its view becomes active, so a view
   the reader never opens never fetches its data or builds its DOM.
   ========================================================================== */

/* Where an empty or unrecognised hash lands. This used to be the Dashboard,
   which meant opening the app dropped the reader into an admin panel — four
   summary cards and a grid of figures — before any Japanese was on screen.
   Home is the room; #dashboard is still a valid route and still renders, it
   is simply not the door any more. */
const DEFAULT_VIEW = 'home';
const APP_NAME = 'Bigu';

/* viewId -> initializer, and the set already run. A Map plus a Set rather
   than deleting from the Map, so a re-registration can't silently resurrect
   a view that already rendered. */
const initializers = new Map();
const initialized = new Set();

function registerView(viewId, initializer) {
  initializers.set(viewId, initializer);
}

/* -- Deep links ------------------------------------------------------------------
   A route is `#<view>` or `#<view>/<item id>`. The second half names a thing
   inside the view — a kanji, a word, a pattern, a lesson number — so a link can
   point at an entry rather than at a section. Everything below is additive: a
   bare `#kanji` parses to an empty item id and takes exactly the path it took
   before.

   Two mechanisms, because a view is initialized once and navigated to many
   times:

     the initializer's argument   the first arrival, while the view is still
                                  building itself and has the id to hand
     an item handler              every arrival after that, when the view is
                                  already on screen and only has to move

   A view registers its handler when it has finished rendering. Until then the
   router has nothing to call, which is exactly why the first id goes through
   the initializer instead of being delivered to a handler that does not exist
   yet. */
const itemHandlers = new Map();

function registerItemHandler(viewId, handler) {
  itemHandlers.set(viewId, handler);
}

function parseRoute() {
  const raw = location.hash.slice(1);
  const slash = raw.indexOf('/');
  if (slash === -1) return { viewId: raw, itemId: '' };

  /* decodeURIComponent throws on a malformed escape, and a hash is the one
     part of a URL a reader can hand-edit or a chat client can mangle. A route
     that cannot be decoded is a route with no item in it, not an exception. */
  const encoded = raw.slice(slash + 1);
  let itemId = encoded;
  try {
    itemId = decodeURIComponent(encoded);
  } catch {
    itemId = encoded;
  }
  return { viewId: raw.slice(0, slash), itemId };
}

/* Errors are logged rather than thrown: a view module that fails to
   initialize shouldn't stop the router from switching views, and each
   module already renders its own error state for the failures it expects. */
function ensureInitialized(viewId, itemId) {
  if (initialized.has(viewId)) return false;
  const initializer = initializers.get(viewId);
  if (!initializer) return false;

  initialized.add(viewId);
  try {
    const result = initializer(itemId);
    if (result && typeof result.catch === 'function') {
      result.catch((error) => console.error('[Bigu]', error));
    }
  } catch (error) {
    console.error('[Bigu]', error);
  }
  // Told the caller the id has been handed to the initializer, so it isn't
  // also delivered to a handler the view is about to register.
  return true;
}

function getViews() {
  return Array.from(document.querySelectorAll('#main-content > .view'));
}

/* Every navigation control in the document, sidebar and phone thumb bar
   alike, marked in one pass keyed off `data-view`.

   This used to be a single querySelector scoped to `.site-nav__link`, called
   once per view inside the render loop. Two things made that no longer enough.
   There is now more than one nav — the thumb bar in index.html points at the
   same routes — and one of its rows stands for a *set* of them: "Study" is the
   way into five views, and a tab bar that goes blank the moment you open
   Vocabulary has lost the thing a tab bar is for.

   `data-view-group` is that set, space-separated, and it wins over `data-view`
   where both are present — the group says which routes light the row, while
   `data-view` stays the one the row actually navigates to. A row with no group
   behaves exactly as before. */
function markActiveNavLinks(activeId) {
  for (const link of document.querySelectorAll('[data-view]')) {
    const group = link.dataset.viewGroup;
    const isActive = group
      ? group.split(/\s+/).includes(activeId)
      : link.dataset.view === activeId;

    if (isActive) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
}

function getHeading(viewId) {
  return document.getElementById(`${viewId}-heading`);
}

function resolveViewId(views, requested) {
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

  const { viewId, itemId } = parseRoute();
  const activeId = resolveViewId(views, viewId);

  /* Normalize an empty or unknown hash without adding a new history entry.
     The item id is part of what makes a route canonical — rewriting
     `#kanji/kj-n5-001` to `#kanji` would strip the deep link out of the
     address bar the moment it was opened, and out of the history entry the
     back button is meant to return to. So the comparison is against the whole
     route, and only a view the document does not have is rewritten. */
  const canonical = activeId === viewId && itemId ? `${activeId}/${itemId}` : activeId;
  if (location.hash.slice(1) !== canonical) {
    history.replaceState(null, '', `#${canonical}`);
  }

  let activeView = null;

  for (const view of views) {
    const isActive = view.id === activeId;
    view.hidden = !isActive;
    if (isActive) activeView = view;
  }

  markActiveNavLinks(activeId);
  updateDocumentTitle(activeId);

  // After the view is visible, so a module that measures or focuses
  // something on init isn't doing it inside a hidden section.
  const justInitialized = ensureInitialized(activeId, itemId);

  /* Move focus to the view's heading first, then let the view move it again
     onto the item. Doing it in that order means a route with no item behaves
     exactly as it did, and a route with one lands on the entry rather than on
     the top of the page — while a view that cannot find the id simply leaves
     focus where the router put it, which is the same place it has always been.

     Skipped when the initializer has just been handed the id: the view is
     still building and will handle its own arrival. */
  if (moveFocus && activeView) {
    focusView(activeView);
    playEnter(activeView);
  }

  if (itemId && !justInitialized) {
    const handler = itemHandlers.get(activeId);
    if (handler) handler(itemId, { moveFocus });
  }
}

/* A 150ms fade on the incoming view. Switching views is the one moment in this
   app where the entire screen is replaced at once, and without a transition it
   reads as a flash rather than as an arrival.

   The two views do NOT overlap, and that is the deliberate part. A true
   cross-fade holds both on screen at once, which for two screens of dense
   bilingual text means ~150ms of one paragraph ghosting through another —
   legible as neither, and exactly the kind of animation that draws attention
   to itself. Overlapping them also means the outgoing view has to leave the
   layout flow or the page is briefly as tall as both, which on a phone is the
   height change this app's motion rules forbid outright. So the outgoing view
   is replaced and the incoming one comes up through the paper: a dissolve
   through the page ground rather than a dissolve between two documents.

   Restarted the same way practice.js restarts its card animation — class off,
   reflow, class on — so rapid navigation doesn't leave a view stuck
   mid-animation. reset.css's reduced-motion rule collapses it to nothing. */
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

export { initRouter, registerItemHandler, registerView };
