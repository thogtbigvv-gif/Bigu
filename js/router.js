/* ==========================================================================
   router.js
   Minimal hash-based router. Reads whichever `.view` sections exist inside
   #main-content — no hardcoded view list — so adding, removing, or renaming
   a view only means editing index.html, never this file.
   ========================================================================== */

const DEFAULT_VIEW = 'dashboard';
const APP_NAME = 'Bigu';

function getViews() {
  return Array.from(document.querySelectorAll('#main-content > .view'));
}

function getNavLink(viewId) {
  return document.querySelector(`.site-nav__list a[data-view="${viewId}"]`);
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

  if (moveFocus && activeView) {
    focusView(activeView);
  }
}

function initRouter() {
  window.addEventListener('hashchange', () => render({ moveFocus: true }));
  render();
}

export { initRouter };
