/* ==========================================================================
   app.js
   Application entry point. Boots the pieces every view depends on — theme,
   storage availability, footer housekeeping — then registers each view
   module with the router and hands off.

   Views are rendered on first navigation, not at boot. Every initX() used
   to run in sequence at startup: eight modules, five parallel JSON fetches,
   and the full DOM for all of them built before a single one was on screen
   — including all 242 lesson word rows across 15 groups, 14 of which are
   collapsed. That was survivable at today's data size and would not have
   stayed that way; the word list alone is several times the lesson count
   and is the part of the catalogue that grows fastest.
   Now Home renders at boot (it's the default view) and everything else
   builds the first time the reader actually goes there.
   ========================================================================== */

import { isAvailable as isStorageAvailable } from './core/storage.js';
import { initTheme, bindToggleButton } from './core/theme.js';
import { initServiceWorker } from './core/serviceWorker.js';
import { initInstall } from './core/install.js';
import { initRouter, registerView } from './core/router.js';
import { initNav } from './ui/navigation.js';
import { initHome } from './views/home.js';
import { initDashboard } from './views/dashboard.js';
import { initVocabulary } from './views/vocabulary.js';
import { initGrammar } from './views/grammar.js';
import { initKanji } from './views/kanji.js';
import { initKakitori } from './views/kakitori.js';
import { initPractice } from './views/practice.js';
import { initMemory } from './views/memory.js';
import { initJournal } from './views/journal.js';
import { initLessons } from './views/lessons.js';
import { initReading } from './views/reading.js';
import { initIchibun } from './views/ichibun.js';
import { initSettings } from './views/settings.js';
import { initIntro } from './ui/logoIntro.js';
import { initKeyboard } from './ui/keyboard.js';
import { initUpdateBanner } from './ui/updateBanner.js';
import { publishHistory, publishStatusSnapshot } from './study/session.js';

/* -- Storage ------------------------------------------------------------------
   Confirms localStorage actually works (Safari private mode and locked-down
   browsers can throw) before any feature tries to read or write progress.
   ---------------------------------------------------------------------------- */
function checkStorage() {
  if (!isStorageAvailable()) {
    console.warn('[Bigu] localStorage is unavailable — progress and preferences will not persist this session.');
  }
}

/* -- The bridge's status snapshot ------------------------------------------------
   One write to the `bigu:bridge` key saying how things stand — what is due,
   when the reader last studied, how much they are holding, their streak —
   for the separate summer-project surface served from the same origin,
   alongside one offer of the rounds the practice store already holds. Both
   are boot's business only because both are about the whole browser rather
   than any one screen; a round as it finishes is still published by
   study/session.js from whichever surface ran it, and none of that is
   touched here.

   Publishing it from boot rather than from a view is the whole point. It
   used to live inside dashboard.js's renderGrid(), which was correct only
   for as long as the Dashboard was the view every visit started on. It
   isn't any more — it has no nav row and is off the entry path — so left
   there the figures would have been written on a screen most sessions never
   open, and the reader on the other side would have been looking at
   whenever they last happened to visit it. Boot happens on every visit
   regardless of where the Dashboard sits in the IA, or whether it exists.

   Fire and forget, deliberately: publishStatusSnapshot() waits on the four
   content files and swallows its own errors, so calling it here cannot
   throw into the boot path or hold the first paint of Home behind fetches
   nothing on screen needs.
   ---------------------------------------------------------------------------- */

/* -- Footer --------------------------------------------------------------------- */
function initFooterYear() {
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
}

/* -- View registry ------------------------------------------------------------------
   One entry per view that has a module behind it. router.js calls each of
   these the first time its view becomes active and never again — the
   modules that need to refresh on return (dashboard, practice) already
   listen for hashchange themselves.
   ------------------------------------------------------------------------------------ */
const VIEW_INITIALIZERS = {
  home: initHome,
  dashboard: initDashboard,
  vocabulary: initVocabulary,
  grammar: initGrammar,
  kanji: initKanji,
  practice: initPractice,
  memory: initMemory,
  journal: initJournal,
  lessons: initLessons,
  reading: initReading,
  ichibun: initIchibun,
  kakitori: initKakitori,
  settings: initSettings,
};

/* -- Boot -------------------------------------------------------------------------
   Order matters only where one step depends on another: theme before first
   paint, storage checked before any store is touched, router last so it can
   render whichever view the URL asks for once every module is registered.
   ------------------------------------------------------------------------------------ */
function init() {
  initTheme();
  bindToggleButton(document.getElementById('theme-toggle'));
  checkStorage();
  initFooterYear();

  /* Installability, first of the three because one of them cannot wait:
     `beforeinstallprompt` fires early, once, and is gone — a listener bound
     any later than boot misses it on most visits, and Settings would then
     have no button to offer on a browser that was perfectly willing to
     install. The other two are ordered behind it out of tidiness rather
     than need; the worker registers itself on `load`, well after all of
     this, and the banner only draws if that worker later finds an update.
     See js/core/install.js and js/core/serviceWorker.js. */
  initInstall();
  initServiceWorker();
  initUpdateBanner();

  for (const [viewId, initializer] of Object.entries(VIEW_INITIALIZERS)) {
    registerView(viewId, initializer);
  }

  initRouter();
  initNav();

  /* After the router and the nav, because it defers to both: it reads which
     view is on screen, and it stands down while the drawer is open. Binding
     one document listener costs nothing and needs no view to have rendered. */
  initKeyboard();

  // After the router, so the first view is already rendering while the four
  // content files this needs are still in flight. Nothing on screen depends
  // on either.
  //
  // The history first and the status second, in that order: the log is the
  // part that can be behind — a restore, a cleared key or an older contract
  // leaves the practice store holding rounds the bridge never saw — and
  // publishing it before the snapshot means the reader is never handed a
  // "last studied" date with no round behind it. It reads localStorage and
  // returns; on every visit but the first it finds nothing new and writes
  // nothing at all.
  publishHistory();
  publishStatusSnapshot();

  // The header logo's own animation. Scoped entirely to the mark — it never
  // blocks the app, so where it sits in this order does not matter.
  initIntro();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
