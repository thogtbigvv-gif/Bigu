 /* ==========================================================================
   app.js
   Application entry point. Boots the pieces every view depends on — theme,
   storage availability, footer housekeeping — then initializes each view
   module (they render into their own hidden/visible <section> regardless
   of which one is currently active) before handing off to router.js for
   view switching.
   ========================================================================== */

import { isAvailable as isStorageAvailable } from './storage.js';
import { initTheme } from './theme.js';
import { initRouter } from './router.js';
import { initDashboard } from './dashboard.js';
import { initVocabulary } from './vocabulary.js';
import { initGrammar } from './grammar.js';
import { initKanji } from './kanji.js';
import { initPractice } from './practice.js';
import { initJournal } from './journal.js';

/* -- Storage ------------------------------------------------------------------
   Confirms localStorage actually works (Safari private mode and locked-down
   browsers can throw) before any feature tries to read or write progress.
   ---------------------------------------------------------------------------- */
function checkStorage() {
  if (!isStorageAvailable()) {
    console.warn('[Nagi] localStorage is unavailable — progress and preferences will not persist this session.');
  }
}

/* -- Footer --------------------------------------------------------------------- */
function initFooterYear() {
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
}

/* -- Boot -------------------------------------------------------------------------
   Order matters only where one step depends on another: theme before first
   paint, storage checked before any store is touched, router last so every
   view already has content by the time it's revealed.
   ------------------------------------------------------------------------------------ */
function init() {
  initTheme();
  checkStorage();
  initFooterYear();

  initDashboard();
  initVocabulary();
  initGrammar();
  initKanji();
  initPractice();
  initJournal();

  initRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
  
