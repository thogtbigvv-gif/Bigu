/* ==========================================================================
   sw.js
   The service worker. It is what makes Bigu installable on a phone and what
   makes it work with the network off.

   Bigu is meant to be opened every day, and the days it is most needed are
   the ones spent on a train, in a basement classroom, or on a plan that ran
   out of data. An app that is a browser tab is fine there; an app that is a
   home-screen icon and then shows the dinosaur is worse than either. So the
   worker's job is the whole app, not a fallback page: every stylesheet,
   every module and all five content files are in the cache before the
   reader ever loses signal.

   It also earns the install itself. A manifest and a set of icons are
   enough for iOS, but Chrome on Android will not offer "Install app" for a
   site with no service worker handling fetches — so the two halves of
   installability are manifest.json and this file, and neither is optional.

   THIS FILE IS SERVED AT THE SITE ROOT, AND MUST BE. A worker's scope
   cannot reach above its own URL, so js/sw.js could only ever control
   js/ — which is none of the pages. Every path below is relative to this
   file, which is what lets the same worker serve the app at a project
   Pages URL (/bigu/) and at a domain root without either being written
   down anywhere.

   THE CACHE IS NOT VERSIONED PER DEPLOY, AND THAT IS THE DESIGN. Bigu has
   no build step, so filenames never carry a hash and there is nothing to
   bump automatically — and a version constant a person has to remember to
   bump is a constant that ships stale after the first busy week. Instead
   every response is served stale-while-revalidate: the reader gets the
   cached copy instantly and the worker refetches it in the background, so
   a deploy lands on the next open rather than on this one. CACHE_VERSION
   below is therefore about *this file's own strategy*, not about content:
   bump it when what is cached or how it is matched changes, and the old
   caches are dropped on activation.
   ========================================================================== */

const CACHE_VERSION = 'v1';
const APP_CACHE = `bigu-app-${CACHE_VERSION}`;
const FONT_CACHE = `bigu-fonts-${CACHE_VERSION}`;
const CURRENT_CACHES = new Set([APP_CACHE, FONT_CACHE]);

/* The two Google Fonts origins, cached separately because they are the one
   thing this app loads from off-origin and they are replaced on a different
   schedule from anything in the repository. Without them an installed Bigu
   opened offline paints its Japanese in whatever the system has, which is
   usually a Chinese face — the exact failure typography.css spends a
   paragraph on. */
const FONT_ORIGINS = new Set(['https://fonts.googleapis.com', 'https://fonts.gstatic.com']);

/* -- The shell ------------------------------------------------------------
   Without any one of these there is no app, so they are fetched as a set:
   if a single one fails, the install fails and the browser retries on the
   next visit rather than leaving a half-cached app that breaks only once
   the reader is offline.

   The list is written out by hand and kept honest by
   tools/check-structure.mjs, which fails the build both ways — a path here
   with no file, and a stylesheet or module on disk that nobody precached.
   That check is the only reason this is safe to maintain as a literal.

   './' rather than './index.html': the document is fetched as the
   directory, and that is the URL the cache is keyed on.
   -------------------------------------------------------------------------- */
const SHELL = [
  './',
  './manifest.json',

  './css/variables.css',
  './css/reset.css',
  './css/typography.css',
  './css/layout.css',
  './css/navigation.css',
  './css/buttons.css',
  './css/forms.css',
  './css/cards.css',
  './css/dashboard.css',
  './css/vocabulary.css',
  './css/grammar.css',
  './css/kanji.css',
  './css/quiz.css',
  './css/practice.css',
  './css/journal.css',
  './css/lessons.css',
  './css/reading.css',
  './css/settings.css',
  './css/memory.css',
  './css/intro.css',
  './css/home.css',
  './css/kakitori.css',
  './css/ichibun.css',
  './css/doors.css',
  './css/keyboard.css',
  './css/install.css',
  './css/first-run.css',

  './js/app.js',
  './js/core/backup.js',
  './js/core/bridge.js',
  './js/core/install.js',
  './js/core/preferences.js',
  './js/core/router.js',
  './js/core/serviceWorker.js',
  './js/core/storage.js',
  './js/core/theme.js',
  './js/data/catalogue.js',
  './js/data/kana.js',
  './js/data/links.js',
  './js/data/shape.js',
  './js/study/decks.js',
  './js/study/favorites.js',
  './js/study/puzzle.js',
  './js/study/review.js',
  './js/study/session.js',
  './js/study/streak.js',
  './js/ui/content.js',
  './js/ui/doors.js',
  './js/ui/favoriteButton.js',
  './js/ui/firstRun.js',
  './js/ui/keyboard.js',
  './js/ui/logoIntro.js',
  './js/ui/navigation.js',
  './js/ui/quiz.js',
  './js/ui/studyControls.js',
  './js/ui/updateBanner.js',
  './js/views/dashboard.js',
  './js/views/grammar.js',
  './js/views/home.js',
  './js/views/ichibun.js',
  './js/views/journal.js',
  './js/views/kakitori.js',
  './js/views/kanji.js',
  './js/views/lessons.js',
  './js/views/memory.js',
  './js/views/practice.js',
  './js/views/reading.js',
  './js/views/settings.js',
  './js/views/vocabulary.js',
];

/* -- The rest -------------------------------------------------------------
   Wanted offline, but not worth failing an install over: the content files
   (which any visit fetches anyway, so they land in the cache under their
   own steam) and the icons (which the browser reads from the manifest, not
   from the page). Each is added on its own and a failure is shrugged off.
   -------------------------------------------------------------------------- */
const CONTENT = [
  './data/vocabulary.json',
  './data/kanji.json',
  './data/grammar.json',
  './data/lessons.json',
  './data/reading.json',

  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];

/* -- Install --------------------------------------------------------------
   No skipWaiting(). A new worker sits in `waiting` until the reader says so
   (js/ui/updateBanner.js offers them the button) or until every tab is
   closed, because swapping the code out from under a running app means the
   next module the router lazily loads comes from a different build than the
   one that asked for it.
   -------------------------------------------------------------------------- */
self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_CACHE);
    await cache.addAll(SHELL);
    await Promise.allSettled(CONTENT.map((path) => cache.add(path)));
  })());
});

/* -- Activate -------------------------------------------------------------
   Drop every cache this version does not know about, then take control of
   pages that are already open. Claiming matters on the very first visit:
   without it the tab that installed the worker stays uncontrolled until it
   is reloaded, so a reader who installs Bigu and immediately goes offline
   would find nothing cached-serving despite the cache being full.
   -------------------------------------------------------------------------- */
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('bigu-') && !CURRENT_CACHES.has(name)) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

/* -- What may be written to the cache -------------------------------------
   A 404 from Pages is a perfectly valid response and caching one would
   pin the failure until the cache version changes. Opaque responses
   (status 0, no readable body) are allowed for fonts only: a stylesheet
   link is a no-cors request, so that is the only form the font CSS ever
   arrives in, and there is no way to tell a good one from a bad one — which
   is exactly why nothing on our own origin is trusted that way.
   -------------------------------------------------------------------------- */
function isCacheable(response, allowOpaque) {
  if (!response) return false;
  // 200 exactly, not response.ok: a 206 is a partial body, and a Cache
  // refuses to store one. Nothing here is ranged today, and the day
  // something is, this must not turn into a failed request.
  if (response.status === 200) return true;
  return allowOpaque && response.type === 'opaque';
}

/* -- Stale-while-revalidate -----------------------------------------------
   The one strategy this app uses, for both origins.

   Cache-first alone would pin a reader to whatever they first downloaded
   until the cache name changed, which for a repository with no build step
   means forever. Network-first would hand back the freshest possible copy
   and pay a round trip for it on every single request, on the connection
   least able to afford one. Serving the cached copy and refetching behind
   it costs nothing on screen and is one open behind — and "one open behind"
   is the honest description of a site with no versioned filenames anyway.

   The revalidation is handed to waitUntil so the browser keeps the worker
   alive to finish it after the response has already gone to the page.
   -------------------------------------------------------------------------- */
async function staleWhileRevalidate(event, request, cacheName, allowOpaque = false) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const refresh = fetch(request)
    .then((response) => {
      /* Written to the cache without being waited on, and its failure
         swallowed. A cache.put can reject on its own — a device out of
         storage is the ordinary case — and letting that reject the response
         would turn a full disk into a page that will not load. */
      if (isCacheable(response, allowOpaque)) cache.put(request, response.clone()).catch(() => {});
      return response;
    });

  if (cached) {
    // Swallowed, not surfaced: the reader already has their answer, and a
    // failed background refetch is just "still offline".
    event.waitUntil(refresh.catch(() => {}));
    return cached;
  }

  return refresh;
}

/* -- Fetch ----------------------------------------------------------------
   Three kinds of request and nothing else is touched — a request this
   worker does not call respondWith on goes to the network exactly as it
   would with no worker installed.

   Navigations are answered from the shell rather than from the URL asked
   for. Bigu is one document with a hash router, so every route in the app
   is './' with something after the '#' — which the server never sees, and
   which the cache must not be keyed on either. Anything else (a stray
   query string, /index.html typed by hand) is the same document too.
   -------------------------------------------------------------------------- */
self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    const shell = new Request(new URL('./', self.location).href);
    event.respondWith(staleWhileRevalidate(event, shell, APP_CACHE));
    return;
  }

  if (url.origin === self.location.origin) {
    event.respondWith(staleWhileRevalidate(event, request, APP_CACHE));
    return;
  }

  if (FONT_ORIGINS.has(url.origin)) {
    event.respondWith(staleWhileRevalidate(event, request, FONT_CACHE, true));
  }
});

/* -- Messages -------------------------------------------------------------
   One message, sent by js/core/serviceWorker.js when the reader presses
   the button in the update banner: stop waiting and become the active
   worker. The page reloads itself on `controllerchange`.
   -------------------------------------------------------------------------- */
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
