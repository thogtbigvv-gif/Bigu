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
   stayed that way; the N5 set alone is four times the current lesson count.
   Now the Dashboard renders at boot (it's the default view) and everything
   else builds the first time the reader actually goes there.
   ========================================================================== */

import { isAvailable as isStorageAvailable } from './storage.js';
import { initTheme, bindToggleButton } from './theme.js';
import { initRouter, registerView } from './router.js';
import { initNav } from './navigation.js';
import { initDashboard } from './dashboard.js';
import { initVocabulary } from './vocabulary.js';
import { initGrammar } from './grammar.js';
import { initKanji } from './kanji.js';
import { initPractice } from './practice.js';
import { initJournal } from './journal.js';
import { initLessons } from './lessons.js';
import { initReading } from './reading.js';
import { initSettings } from './settings.js';
import { initIntro } from './logoIntro.js';

/* -- Storage ------------------------------------------------------------------
   Confirms localStorage actually works (Safari private mode and locked-down
   browsers can throw) before any feature tries to read or write progress.
   ---------------------------------------------------------------------------- */
function checkStorage() {
  if (!isStorageAvailable()) {
    console.warn('[Bigu] localStorage is unavailable — progress and preferences will not persist this session.');
  }
}

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
  dashboard: initDashboard,
  vocabulary: initVocabulary,
  grammar: initGrammar,
  kanji: initKanji,
  practice: initPractice,
  journal: initJournal,
  lessons: initLessons,
  reading: initReading,
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

  for (const [viewId, initializer] of Object.entries(VIEW_INITIALIZERS)) {
    registerView(viewId, initializer);
  }

  initRouter();
  initNav();

  // The header logo's own animation. Scoped entirely to the mark — it never
  // blocks the app, so where it sits in this order does not matter.
  initIntro();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
