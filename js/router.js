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

function focusView(view) {
  const target = getHeading(view.id) || view;
  target.setAttribute('tabindex', '-1');
  target.focus();
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
  }
}

function initRouter() {
  window.addEventListener('hashchange', () => render({ moveFocus: true }));
  render();
}

export { initRouter, registerView };
