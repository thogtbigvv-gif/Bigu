/* ==========================================================================
   intro/introOverlay.js
   Owns the overlay element and everything that has to be true while it is up:
   the app underneath is inert and hidden from assistive tech, the header logo
   waits invisibly for its hand-off, and teardown puts all of it back.

   The markup itself lives in index.html rather than being built here. It has
   to exist before first paint or the reader sees a frame of the dashboard
   before the overlay covers it — the same reason the theme is applied by an
   inline script in that file.
   ========================================================================== */

import { SELECTORS } from './introConfig.js';

/* Collects the elements the sequence works with. Returns null if any required
   piece is missing, which the caller treats as "no intro" — a missing overlay
   should never stop the app from booting. */
function queryOverlay() {
  const overlay = document.querySelector(SELECTORS.overlay);
  const backdrop = document.querySelector(SELECTORS.backdrop);
  const video = document.querySelector(SELECTORS.video);
  const headerMark = document.querySelector(SELECTORS.headerMark);
  const appShell = document.querySelector(SELECTORS.appShell);
  const appContent = document.querySelector(SELECTORS.appContent);

  if (!overlay || !backdrop || !video || !headerMark || !appShell || !appContent) return null;

  return {
    overlay,
    backdrop,
    video,
    headerMark,
    appShell,
    appContent,
    skip: document.querySelector(SELECTORS.skip),
  };
}

/* While the intro plays the app is visually hidden, so it must be hidden from
   screen readers and taken out of the tab order too — otherwise the reader can
   Tab into a dashboard they cannot see. `inert` does both where supported;
   aria-hidden covers the rest. */
function lockApp({ appShell }) {
  appShell.setAttribute('aria-hidden', 'true');
  appShell.inert = true;
}

function unlockApp({ appShell }) {
  appShell.removeAttribute('aria-hidden');
  appShell.inert = false;
}

/* Removes every trace of the intro: the overlay element, the state attribute
   the CSS keys off, and any animation or inline style left on the app.

   Cancelling the animations is not housekeeping — it is required. They run
   with fill:'forwards', so a finished reveal leaves .app-shell__content
   holding transform: matrix(1,0,0,1,0,0). That is an identity matrix but it is
   not `none`, and *any* transform other than `none` makes an element the
   containing block for its position:fixed descendants. Nothing fixed lives
   inside the content column today — the nav drawer and its backdrop are
   siblings, deliberately — but leaving a permanent transform there would turn
   the next fixed element anyone nests inside it into a mystery bug.

   Order matters: the state attribute goes first so the CSS that pins the app
   and the header mark to opacity 0 stops applying, and only then are the
   animations holding them visible cancelled. Doing it the other way round
   flashes both to transparent for a frame. */
function teardown(elements) {
  const { overlay, appShell, appContent, headerMark } = elements;

  unlockApp(elements);
  document.documentElement.removeAttribute('data-intro');

  for (const element of [appShell, appContent, headerMark]) {
    element.getAnimations?.().forEach((animation) => animation.cancel());
  }

  appShell.style.opacity = '';
  appContent.style.transform = '';
  appContent.style.willChange = '';

  overlay.remove();
}

export { queryOverlay, lockApp, unlockApp, teardown };
