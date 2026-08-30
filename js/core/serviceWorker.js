/* ==========================================================================
   serviceWorker.js
   Registers sw.js, and owns the one question a service worker forces on an
   app that never reloads: what to do when a newer version of the code is
   sitting on disk while the reader is still using the old one.

   Installed on a home screen, Bigu behaves nothing like a tab. A tab is
   closed and reopened several times a day and picks up a deploy on its own.
   An installed app is resumed rather than opened — it can hold the same
   document for weeks, and its hash router never triggers a navigation — so
   without something like this a reader could quite reasonably run last
   month's build until the phone reboots.

   So: the worker is registered, a waiting one is reported to whoever
   subscribed (js/ui/updateBanner.js, which is the only caller), and the
   swap happens when the reader asks for it rather than underneath them.

   No DOM here, deliberately — this is core/, and the banner that shows the
   result is ui/. What this module knows is that an update exists; what it
   looks like is not its business.
   ========================================================================== */

/* Half an hour between update checks, and only when the app comes back to
   the foreground. On a phone that is the moment a resumed app has to ask,
   because it is the only moment it has: `load` fired weeks ago. The
   throttle is there because "back to the foreground" on a phone also
   describes switching apps twice in ten seconds. */
const UPDATE_CHECK_INTERVAL = 30 * 60 * 1000;

const listeners = new Set();

let registration = null;
let waitingWorker = null;
let lastCheck = 0;
let updateRequested = false;
let reloading = false;

/* -- Support --------------------------------------------------------------
   A service worker needs a secure context, and file:// is not one. Bigu
   cannot run off the filesystem anyway (it fetches its JSON), but checking
   rather than trying keeps a pointless SecurityError out of the console of
   anyone who opens index.html by double-clicking it.
   -------------------------------------------------------------------------- */
function isSupported() {
  return 'serviceWorker' in navigator && window.isSecureContext;
}

function announce() {
  for (const handler of listeners) handler(Boolean(waitingWorker));
}

/* A worker in `installed` state with something already controlling the page
   is an update. The same state with no controller is the *first* worker
   this browser has ever had for Bigu, which is not news and must not be
   announced — telling a first-time reader that a new version is ready is
   both untrue and, since the app was already up to date, mystifying. */
function considerWorker(worker) {
  if (!worker) return;

  const check = () => {
    if (worker.state === 'installed' && navigator.serviceWorker.controller) {
      waitingWorker = worker;
      announce();
    }
  };

  check();
  worker.addEventListener('statechange', check);
}

/* -- Registration ---------------------------------------------------------
   After `load`, not before. Installing the worker fetches the entire app —
   every stylesheet, every module, all five content files — and doing that
   while the first view is still fetching its own data means the reader
   waits on a download that exists purely for their next visit.

   The path is resolved against the document rather than written as a bare
   string so it is right at a project Pages URL (/bigu/sw.js) as well as at
   a domain root, and so a reader who is deep in a route when the page
   loads still registers the worker at the top of the site rather than
   somewhere under it.
   -------------------------------------------------------------------------- */
async function register() {
  try {
    registration = await navigator.serviceWorker.register(new URL('sw.js', document.baseURI));

    if (registration.waiting && navigator.serviceWorker.controller) {
      waitingWorker = registration.waiting;
      announce();
    }

    considerWorker(registration.installing);
    registration.addEventListener('updatefound', () => considerWorker(registration.installing));
  } catch (error) {
    // Offline support is an enhancement; the app works without it. A reader
    // whose browser refused the registration should not see an error state
    // for a feature they never asked for.
    console.warn('[Bigu] the service worker could not be registered — the app will still run online.', error);
  }
}

/* -- Init ----------------------------------------------------------------- */
function initServiceWorker() {
  if (!isSupported()) return;

  if (document.readyState === 'complete') register();
  else window.addEventListener('load', register, { once: true });

  /* A new worker is in charge. Reload so the document, its modules and the
     worker serving them are all the same build — but ONLY if the reader
     asked for that, which is the whole of this guard's job.

     controllerchange fires in two situations and they could not be more
     different. The first is the one this is for: a waiting worker
     activating because applyUpdate() told it to. The second is the very
     first visit — sw.js calls clients.claim() so an uncontrolled page gets
     offline support without waiting for a reload, and that claim fires this
     event too. Reloading on that one means every reader's first ever visit
     to Bigu silently reloads itself under them, mid-view, for nothing. It
     also made the browser test flake, which is how it was found. */
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!updateRequested || reloading) return;
    reloading = true;
    location.reload();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !registration) return;

    const now = Date.now();
    if (now - lastCheck < UPDATE_CHECK_INTERVAL) return;
    lastCheck = now;
    registration.update().catch(() => {});
  });
}

/* -- The subscription -----------------------------------------------------
   Called back with true when an update is waiting and false when there is
   none. A late subscriber is told the current answer immediately, the same
   way the router redelivers a route target — the banner is built inside a
   view's first render and the worker may well have finished installing
   before that happened.
   -------------------------------------------------------------------------- */
function onUpdateReady(handler) {
  listeners.add(handler);
  handler(Boolean(waitingWorker));
  return () => listeners.delete(handler);
}

/* -- Taking the update ----------------------------------------------------
   The page does not reload here. It asks the waiting worker to activate,
   and the reload happens on `controllerchange` above — which is the only
   ordering where the reloaded document is served by the new worker rather
   than racing it.
   -------------------------------------------------------------------------- */
function applyUpdate() {
  if (!waitingWorker) return false;
  updateRequested = true;
  waitingWorker.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export { initServiceWorker, onUpdateReady, applyUpdate };
