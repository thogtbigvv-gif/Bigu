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

/* -- Swipe the drawer shut ----------------------------------------------------------
   The gesture every phone reader already has in their hands. Without it the
   only ways out of an open drawer are a tap on the backdrop — a strip on the
   right of the screen — or the X back up in the corner the drawer exists to
   avoid, which is a strange place to send someone to undo opening a menu.

   Threshold, not a live drag. Following the finger would mean writing
   transforms onto the same element whose transform CSS animates, and the two
   fight over the frame the finger lifts: the panel snaps to the CSS value,
   then transitions from it. A drawer is a binary — open or shut — so the
   gesture only has to decide which, and it decides at 56px of leftward travel.

   The direction test is what keeps it from stealing scrolls. The drawer's own
   list scrolls vertically, and a thumb travelling down a list drifts sideways
   by tens of pixels on the way; requiring the horizontal component to be the
   larger one means a swipe has to actually be a swipe. `touchmove` is passive,
   so this never blocks or delays that scroll.
   ------------------------------------------------------------------------------------ */
const SWIPE_CLOSE_DISTANCE = 56;

function initDrawerSwipe(nav, close) {
  let startX = null;
  let startY = null;

  nav.addEventListener(
    'touchstart',
    (event) => {
      if (event.touches.length !== 1) {
        startX = null;
        return;
      }
      startX = event.touches[0].clientX;
      startY = event.touches[0].clientY;
    },
    { passive: true },
  );

  nav.addEventListener(
    'touchmove',
    (event) => {
      if (startX === null || !nav.classList.contains('is-open')) return;

      const deltaX = event.touches[0].clientX - startX;
      const deltaY = event.touches[0].clientY - startY;
      if (deltaX > -SWIPE_CLOSE_DISTANCE || Math.abs(deltaX) <= Math.abs(deltaY)) return;

      // One decision per gesture: null the origin so the rest of this swipe
      // can't re-trigger a close on the drawer that is already shutting.
      startX = null;
      close();
    },
    { passive: true },
  );

  // A cancelled touch (an incoming call, the system's own back gesture) leaves
  // no touchend, so the origin is cleared on both endings rather than only the
  // tidy one.
  for (const event of ['touchend', 'touchcancel']) {
    nav.addEventListener(event, () => { startX = null; }, { passive: true });
  }
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

   Inert is applied to the main region, the footer and the phone thumb bar,
   *not* to .app-shell__content. The header is inside that wrapper, and the
   header holds the toggle — so inerting the wrapper inerted the very button
   the drawer turns into an X, and the one control a reader would reach for to
   close it did nothing at all. The backdrop and Escape still worked, which
   is why this survived: it failed silently, on touch, on the obvious
   affordance. Naming the regions instead of their parent keeps the intent
   (page unreachable, header reachable) and makes it true.

   Being visually off-screen is handled in CSS (visibility:hidden on the
   closed drawer), so nothing here has to manage the tab order of the links
   themselves.
   -------------------------------------------------------------------------------------------- */
function initMobileDrawer(nav) {
  const toggleBtn = document.getElementById('site-nav-mobile-toggle');
  const backdrop = document.getElementById('site-nav-backdrop');
  const thumbNav = document.getElementById('thumb-nav');
  // The thumb bar's "More" row is a second opener for the same drawer, and
  // the one a thumb can actually reach — see the note on .thumb-nav in
  // index.html. It is not a second *control*: both buttons carry
  // aria-expanded and both are kept in sync by setExpanded below.
  const moreBtn = document.getElementById('thumb-nav-more');
  const openers = [toggleBtn, moreBtn].filter(Boolean);
  const behindDrawer = [
    document.getElementById('main-content'),
    document.querySelector('.site-footer'),
    // The bar slides off the bottom of the screen while the drawer is open
    // (CSS), so inerting it takes five rows out of the tab order that a
    // reader can no longer see — rather than stranding a visible dead
    // control, which is the trap the header toggle fell into above.
    thumbNav,
  ].filter(Boolean);
  if (!toggleBtn || !backdrop) return;

  function setBehindInert(inert) {
    for (const region of behindDrawer) region.inert = inert;
  }

  function setExpanded(expanded) {
    for (const opener of openers) opener.setAttribute('aria-expanded', String(expanded));
  }

  function isOpen() {
    return nav.classList.contains('is-open');
  }

  function open() {
    nav.classList.add('is-open');
    backdrop.hidden = false;
    setExpanded(true);
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
    setExpanded(false);
    setBehindInert(false);

    // Only when the drawer was actually open and the close came from a
    // keyboard/Escape path: pulling focus back on an ordinary link click
    // would fight the router, which moves focus to the new view's heading.
    //
    // Always the header toggle, never "More": by the time this runs the
    // thumb bar is inert and has slid off screen, so focusing a row inside
    // it would drop focus somewhere the reader cannot see.
    if (wasOpen && restoreFocus) toggleBtn.focus();
  }

  for (const opener of openers) {
    opener.addEventListener('click', () => {
      isOpen() ? close({ restoreFocus: true }) : open();
    });
  }
  backdrop.addEventListener('click', () => close());
  initDrawerSwipe(nav, close);
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
