/* ==========================================================================
   intro/introSession.js
   The once-per-browser-session gate. Wrapped the same defensive way as
   storage.js wraps localStorage: Safari private mode and locked-down browsers
   throw on access, and an intro that crashes the boot sequence would be far
   worse than one that plays twice.

   Reading is duplicated by the inline script in index.html, which has to run
   synchronously before first paint to decide whether the overlay is shown at
   all. This module owns the writing and the key name.
   ========================================================================== */

const SESSION_KEY = 'biguIntroPlayed';

function hasPlayed() {
  try {
    return sessionStorage.getItem(SESSION_KEY) !== null;
  } catch {
    // No sessionStorage: treat it as "already played" so the app renders
    // immediately rather than replaying a ten-second intro on every view.
    return true;
  }
}

function markPlayed() {
  try {
    sessionStorage.setItem(SESSION_KEY, 'true');
    return true;
  } catch {
    return false;
  }
}

export { hasPlayed, markPlayed, SESSION_KEY };
