/* ==========================================================================
   install.js
   Whether Bigu can be put on the reader's home screen, and the one gesture
   that puts it there.

   Installing is the difference between a bookmark and a thing that is on
   the phone: a home-screen icon, no browser chrome eating the top of a
   screen this app already fills carefully, and — with sw.js — a Bigu that
   opens on the underground. That is worth offering out loud rather than
   leaving to a browser menu most readers have never opened.

   Three states, and the interesting part is that a *browser* decides which
   one you are in, not this file:

     installed     already on the home screen, or running as one — nothing
                   to offer
     ready         Chrome (and the Chromium browsers) fired
                   `beforeinstallprompt`, so there is a real one-tap install
                   to hand
     unavailable   everything else, which very much includes iOS: Safari has
                   never implemented that event and never says whether Bigu
                   is installable. So this is not "you cannot install" — it
                   is "no button can do it for you", and the caller answers
                   it with instructions instead.

   THE EVENT MUST BE CAUGHT AT BOOT. It fires once, early, usually before a
   reader has been anywhere near Settings, and a listener bound when the
   Settings view first renders would miss it on every visit that did not
   start there. So the capture happens in app.js's init and the captured
   event waits here; the view asks what state we are in whenever it is
   drawn, and subscribes for the answer changing under it.

   No DOM. This is core/ — it holds the event and the state, and
   js/views/settings.js is the only thing that draws them.
   ========================================================================== */

const listeners = new Set();

/* The browser's own install event, kept because it can only be used once
   and only later: calling prompt() outside a user gesture is rejected, so
   the event is parked here until a reader presses something. */
let deferredPrompt = null;

/* Set by `appinstalled`, and the only way this page can know. An install
   started from a browser tab leaves that tab a tab — display-mode does not
   change, navigator.standalone does not change, and nothing else here would
   ever come back true. Without this the card would answer a reader who has
   just successfully installed Bigu with instructions for installing Bigu. */
let installedHere = false;

function announce() {
  for (const handler of listeners) handler(installState());
}

/* -- Already installed? ---------------------------------------------------
   Two questions, because the two platforms answer different ones.
   display-mode is the standard and covers Android and desktop; iOS reports
   an installed web app through the non-standard navigator.standalone and
   has done since long before it supported anything else here.

   This is only ever true *inside* the installed app. A reader with Bigu on
   their home screen who opens the site in a browser tab looks exactly like
   a reader who has never installed it, and nothing can tell the difference
   — which is why the card this feeds says "add it" rather than "you have
   not added it". The one exception is an install that happened in this very
   page, which `appinstalled` reports; see installedHere above.
   -------------------------------------------------------------------------- */
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches
    || window.matchMedia('(display-mode: fullscreen)').matches
    || window.matchMedia('(display-mode: minimal-ui)').matches
    || window.navigator.standalone === true;
}

function installState() {
  if (installedHere || isStandalone()) return 'installed';
  return deferredPrompt ? 'ready' : 'unavailable';
}

/* -- Which instructions to give -------------------------------------------
   Used only in the `unavailable` state, where the answer is a sentence
   rather than a button. iPadOS 13 and later report themselves as a Mac, so
   a touch-capable "Mac" is the one case where the user-agent string alone
   is wrong; maxTouchPoints is what separates them.
   -------------------------------------------------------------------------- */
function installPlatform() {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua)
    || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  return iOS ? 'ios' : 'other';
}

/* -- Init -----------------------------------------------------------------
   preventDefault() on beforeinstallprompt suppresses the browser's own
   install bar. That is deliberate: an infobar that slides over the bottom
   of the screen sits exactly where the thumb bar is, and the offer belongs
   somewhere the reader can find it again after dismissing it once — which
   a mini-infobar, gone for good after a dismissal, is not.
   -------------------------------------------------------------------------- */
function initInstall() {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    announce();
  });

  /* Fired after an install completes, from anywhere — this button, the
     browser's own menu, or a second tab. The event is spent either way. */
  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    installedHere = true;
    announce();
  });

  /* And the app being *launched* installed, which is a display-mode change
     rather than an install. Rare on a phone and ordinary on a desktop. */
  window.matchMedia('(display-mode: standalone)').addEventListener('change', announce);
}

/* -- The prompt -----------------------------------------------------------
   Must be called from inside a user gesture. Returns what the reader chose,
   or 'unavailable' if there was nothing to show — the caller uses that to
   redraw rather than to report an error, because a state that changed under
   the button is not a failure.
   -------------------------------------------------------------------------- */
async function promptInstall() {
  if (!deferredPrompt) return 'unavailable';

  const event = deferredPrompt;
  /* Cleared before awaiting the choice, not after. The event cannot be
     prompted twice, so holding on to it through an await is holding on to
     something a second press would fail on. */
  deferredPrompt = null;

  try {
    event.prompt();
    const { outcome } = await event.userChoice;
    announce();
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    announce();
    return 'unavailable';
  }
}

function onInstallStateChange(handler) {
  listeners.add(handler);
  return () => listeners.delete(handler);
}

export { initInstall, installState, installPlatform, promptInstall, onInstallStateChange };
