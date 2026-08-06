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

/* Mirrors the 1024px line in navigation.css and the breakpoint block in
   variables.css — a media query can't read a custom property, so the number
   is written in both places and the three have to move together. */
const MOBILE_QUERY = '(max-width: 1024px)';

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

/* -- Mobile drawer -----------------------------------------------------------------------
   Open/close plus the focus handling an off-canvas drawer needs to be
   usable without a mouse:

     - focus moves into the drawer when it opens, so the next Tab lands on a
       nav link rather than wherever the reader happened to be on the page;
     - focus returns to the toggle when it closes, so they aren't dropped
       back at the top of the document;
     - the page behind the backdrop is marked `inert` while it's open, which
       both traps Tab inside the drawer and stops a screen reader wandering
       into the content behind it. One attribute, and it's the whole focus
       trap — no keydown cycling of first/last focusable elements.

   Inert is applied to the main region and the footer, *not* to
   .app-shell__content. The header is inside that wrapper, and the header
   holds the toggle — so inerting the wrapper inerted the very button the
   drawer turns into an X, and the one control a reader would reach for to
   close it did nothing at all. The backdrop and Escape still worked, which
   is why this survived: it failed silently, on touch, on the obvious
   affordance. Two named regions instead of their parent keeps the intent
   (page unreachable, header reachable) and makes it true.

   Being visually off-screen is handled in CSS (visibility:hidden on the
   closed drawer), so nothing here has to manage the tab order of the links
   themselves.
   -------------------------------------------------------------------------------------------- */
function initMobileDrawer(nav) {
  const toggleBtn = document.getElementById('site-nav-mobile-toggle');
  const backdrop = document.getElementById('site-nav-backdrop');
  const behindDrawer = [
    document.getElementById('main-content'),
    document.querySelector('.site-footer'),
  ].filter(Boolean);
  if (!toggleBtn || !backdrop) return;

  function setBehindInert(inert) {
    for (const region of behindDrawer) region.inert = inert;
  }

  function isOpen() {
    return nav.classList.contains('is-open');
  }

  function open() {
    nav.classList.add('is-open');
    backdrop.hidden = false;
    toggleBtn.setAttribute('aria-expanded', 'true');
    setBehindInert(true);

    // visibility flips to visible on the same frame the class lands, but
    // focus() before style resolution can be dropped on a still-hidden
    // element in some engines. The next frame is safely past that.
    requestAnimationFrame(() => {
      nav.querySelector('.site-nav__link')?.focus();
    });
  }

  function close({ restoreFocus = false } = {}) {
    const wasOpen = isOpen();
    nav.classList.remove('is-open');
    backdrop.hidden = true;
    toggleBtn.setAttribute('aria-expanded', 'false');
    setBehindInert(false);

    // Only when the drawer was actually open and the close came from a
    // keyboard/Escape path: pulling focus back on an ordinary link click
    // would fight the router, which moves focus to the new view's heading.
    if (wasOpen && restoreFocus) toggleBtn.focus();
  }

  toggleBtn.addEventListener('click', () => {
    isOpen() ? close({ restoreFocus: true }) : open();
  });
  backdrop.addEventListener('click', () => close());
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) close({ restoreFocus: true });
  });

  // Close the drawer once a real route is chosen. The Study toggle button
  // is excluded — clicking it only expands/collapses, it never navigates.
  nav.addEventListener('click', (event) => {
    if (event.target.closest('.site-nav__link:not(.site-nav__toggle)')) close();
  });

  // Any route change closes it, not only a tap on one of these links. The
  // back button is a route change the drawer never heard about: pressing it
  // with the menu open left the drawer sitting over a view it hadn't
  // navigated to, with the page behind it still inert.
  window.addEventListener('hashchange', () => close());

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
