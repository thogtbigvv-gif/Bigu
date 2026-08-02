/* ==========================================================================
   navigation.js
   Binds behavior to the static primary nav markup in index.html:
     - the "Study" submenu's expand/collapse
     - the mobile off-canvas drawer's open/close
   Active-link highlighting (aria-current) is handled entirely by
   router.js on every hashchange, same as before — this module only
   reads that state back to keep the Study submenu open whenever one
   of its own children is the active view.
   ========================================================================== */

const MOBILE_QUERY = '(max-width: 640px)';

function initStudyToggle(nav) {
  const toggleBtn = nav.querySelector('#site-nav-study-toggle');
  const parentItem = nav.querySelector('#site-nav-study');
  if (!toggleBtn || !parentItem) return;

  toggleBtn.addEventListener('click', () => {
    const expanded = toggleBtn.getAttribute('aria-expanded') === 'true';
    toggleBtn.setAttribute('aria-expanded', String(!expanded));
    parentItem.classList.toggle('is-open', !expanded);
  });

  // Router sets aria-current="page" on whichever link matches the active
  // route; if that link lives inside this submenu, keep the submenu open.
  function syncWithActiveRoute() {
    const hasActiveChild = !!parentItem.querySelector('.site-nav__sublink[aria-current="page"]');
    parentItem.classList.toggle('has-active-child', hasActiveChild);
    if (hasActiveChild) {
      parentItem.classList.add('is-open');
      toggleBtn.setAttribute('aria-expanded', 'true');
    }
  }

  window.addEventListener('hashchange', syncWithActiveRoute);
  syncWithActiveRoute();
}

function initMobileDrawer(nav) {
  const toggleBtn = document.getElementById('site-nav-mobile-toggle');
  const backdrop = document.getElementById('site-nav-backdrop');
  if (!toggleBtn || !backdrop) return;

  function open() {
    nav.classList.add('is-open');
    backdrop.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
  }

  function close() {
    nav.classList.remove('is-open');
    backdrop.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
  }

  toggleBtn.addEventListener('click', () => {
    nav.classList.contains('is-open') ? close() : open();
  });
  backdrop.addEventListener('click', close);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') close();
  });

  // Close the drawer once a real route is chosen. The Study toggle button
  // is excluded — clicking it only expands/collapses, it never navigates.
  nav.addEventListener('click', (event) => {
    if (event.target.closest('.site-nav__link:not(.site-nav__toggle)')) close();
  });

  // Resizing past the mobile breakpoint with the drawer open would leave
  // it stuck mid-transform once it becomes a static sidebar — reset it.
  window.matchMedia(MOBILE_QUERY).addEventListener('change', (event) => {
    if (!event.matches) close();
  });
}

function initNav() {
  const nav = document.getElementById('site-nav');
  if (!nav) return;
  initStudyToggle(nav);
  initMobileDrawer(nav);
}

export { initNav };
