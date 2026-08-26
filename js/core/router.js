/* ==========================================================================
   router.js
   Minimal hash-based router. Reads whichever `.view` sections exist inside
   #main-content — no hardcoded view list — so adding, removing, or renaming
   a view only means editing index.html, never this file.

   It also owns first-render: app.js registers one initializer per view and
   this module runs each the first time its view becomes active, so a view
   the reader never opens never fetches its data or builds its DOM.

   THE ROUTE GRAMMAR IS TWO SEGMENTS: `#view` and `#view/entry-id`. The
   second is what makes an entry reachable from outside the screen it lives
   on — a kanji linking to a word that uses it, a word linking to the kanji
   inside it — and it is the whole mechanism behind cross-linking. Before it,
   the only address in this app was a screen, so "everything is a door" could
   not be built no matter what the views drew: there was nowhere for a door
   to point.

   A target is a catalogue id and nothing else, which is why nothing here
   encodes or decodes one. Ids are ASCII (`n5-001`, `kj-n5-001`, `l7-12`) and
   pass through a hash untouched; a target that is not an id simply matches
   no entry and the view lands on its list, which is the same thing that
   happens when an id is retired from the data. A wrong deep link is a normal
   arrival, never an error state.

   The router does not know how a view reveals an entry — a kanji opens a
   panel, a word pages a list, a lesson expands a group. It only says *which*
   entry was asked for, through onRouteTarget, and each view answers in its
   own vocabulary.
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

/* -- The route grammar ------------------------------------------------------
   `#view` or `#view/entry-id`. Split on the first slash only, so a target
   containing one is handed on whole rather than quietly truncated — the
   second segment is the view's business, not this file's.

   Pure, and takes the hash rather than reading it, because that is the half
   of routing worth testing without a document.
   -------------------------------------------------------------------------- */
function parseRoute(hash) {
  const raw = String(hash ?? '').replace(/^#/, '');
  const slash = raw.indexOf('/');
  if (slash === -1) return { viewId: raw, target: null };

  // A trailing slash and nothing after it is `#view`, not `#view/''`.
  return { viewId: raw.slice(0, slash), target: raw.slice(slash + 1) || null };
}

/* The hash a route should be written as. One function, so the two places
   that construct one — normalizing on render, and routeTo below — cannot
   disagree about the shape and bounce the URL between them. */
function hashFor(viewId, target) {
  return target ? `#${viewId}/${target}` : `#${viewId}`;
}

/* Which view is on screen, for the modules that used to read
   `location.hash.slice(1)` themselves. Every one of those comparisons broke
   the day a hash could carry a second segment: `#vocabulary/n5-001` is the
   Vocabulary view, and a view asking "is this me?" by string equality
   against the whole hash would have answered no on its own screen — and
   quietly, since each of those checks guards a refresh or a keystroke rather
   than anything that throws. */
function activeViewId() {
  return parseRoute(location.hash).viewId;
}

function resolveViewId(views) {
  const { viewId } = parseRoute(location.hash);
  const isKnown = views.some((view) => view.id === viewId);
  return isKnown ? viewId : DEFAULT_VIEW;
}

/* -- Delivering a target ----------------------------------------------------
   A view is initialized once and then lives; a deep link can arrive at any
   moment after that, including at boot while the view's own fetch is still
   in flight. So this is a subscription rather than an argument: a view calls
   onRouteTarget once it has content to reveal, and is told the target it
   missed as well as every one that arrives later.

   `serial` counts navigations, and one handler is told about one navigation
   at most once. That is what lets both delivery paths exist without
   double-firing: render() offers the target to whoever is already listening,
   and a view registering afterwards — the ordinary case, since a view
   registers after its first render, which is after its fetch — is offered
   the same navigation's target on subscribing.
   -------------------------------------------------------------------------- */
const targetHandlers = new Map();
const deliveredAt = new Map();
let serial = 0;

function deliver(handler, viewId) {
  const route = parseRoute(location.hash);
  if (!route.target || route.viewId !== viewId) return;
  if (deliveredAt.get(handler) === serial) return;

  deliveredAt.set(handler, serial);
  // Same reasoning as ensureInitialized: one view's failure to reveal an
  // entry is not a reason to stop routing.
  try {
    handler(route.target);
  } catch (error) {
    console.error('[Bigu]', error);
  }
}

function onRouteTarget(viewId, handler) {
  let handlers = targetHandlers.get(viewId);
  if (!handlers) {
    handlers = new Set();
    targetHandlers.set(viewId, handlers);
  }
  handlers.add(handler);
  deliver(handler, viewId);
}

/* Go to an entry. Setting the hash is enough whenever it changes, because
   the browser then fires hashchange and render() does the rest — but a door
   pointing at where the reader already is changes nothing, and doing nothing
   is the wrong answer for a control that was just pressed. So an unchanged
   hash counts as a navigation of its own and the target is redelivered. */
function routeTo(viewId, target = null) {
  const next = hashFor(viewId, target);
  if (location.hash === next) {
    serial += 1;
    for (const handler of targetHandlers.get(viewId) ?? []) deliver(handler, viewId);
    return;
  }
  location.hash = next;
}

/* Drop the entry from the address, keeping the view. For a view whose
   revealed entry can be closed from inside it — the kanji detail panel backs
   out to its grid — the URL would otherwise go on naming an entry that is no
   longer on screen, and coming back to that view would open it again. */
function clearRouteTarget(viewId) {
  const route = parseRoute(location.hash);
  if (route.viewId !== viewId || !route.target) return;
  history.replaceState(null, '', hashFor(viewId, null));
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
  serial += 1;

  /* Normalize an empty or unknown hash without adding a new history entry.
     The target survives normalization only when the view it was addressed to
     is the one that resolved — `#nope/n5-001` names no screen, so it lands on
     Home carrying nothing, rather than handing Home an entry it has never
     heard of. */
  const { viewId: requestedId, target } = parseRoute(location.hash);
  const canonical = hashFor(activeId, requestedId === activeId ? target : null);
  if (location.hash !== canonical) {
    history.replaceState(null, '', canonical);
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
  ensureInitialized(activeId);

  if (moveFocus && activeView) {
    focusView(activeView);
    playEnter(activeView);
  }

  /* Last, and after the focus move above rather than before it. A deep link
     ends with the reader looking at one entry, so the view's own reveal is
     the final word on where focus and scroll should be — offered the target
     any earlier, it would put the reader on the entry and then the line above
     would pull them back to the top of the screen.

     Only whoever is already listening. A view opening for the first time is
     not listening yet — its fetch has not resolved — and picks the same
     target up when it subscribes. */
  for (const handler of targetHandlers.get(activeId) ?? []) deliver(handler, activeId);
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

export { initRouter, registerView, activeViewId, parseRoute, routeTo, onRouteTarget, clearRouteTarget };
