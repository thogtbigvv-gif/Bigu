/* ==========================================================================
   app.js
   Application entry point. Boots the pieces every view depends on —
   theme, storage availability, footer housekeeping — then hands off to
   router.js for view switching.
   ========================================================================== */

import { initRouter } from './router.js';

const STORAGE_PREFIX = 'nagi:';
const THEME_KEY = `${STORAGE_PREFIX}theme`;

/* -- Theme --------------------------------------------------------------------
   Applies a `data-theme` attribute on <html> so CSS can key dark/light
   overrides off it later. An explicit saved choice wins; otherwise the
   reader's system preference is used, and kept in sync with system
   changes only until they make an explicit choice of their own.
   ------------------------------------------------------------------------------ */

function readStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : null;
  } catch {
    return null;
  }
}

function systemTheme() {
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function setTheme(theme) {
  applyTheme(theme);
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* preference just won't persist across visits */
  }
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

function initTheme() {
  applyTheme(readStoredTheme() ?? systemTheme());

  window
    .matchMedia('(prefers-color-scheme: dark)')
    .addEventListener('change', (event) => {
      if (readStoredTheme() === null) {
        applyTheme(event.matches ? 'dark' : 'light');
      }
    });
}

/* -- Storage --------------------------------------------------------------------
   Confirms localStorage actually works (Safari private mode and locked-down
   browsers can throw) so later features can persist progress safely. A
   dedicated storage.js is the natural next extraction once more than a
   theme preference needs saving.
   ---------------------------------------------------------------------------------- */

function isStorageAvailable() {
  try {
    const testKey = `${STORAGE_PREFIX}__test__`;
    localStorage.setItem(testKey, '1');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function initStorage() {
  const available = isStorageAvailable();
  if (!available) {
    console.warn('[Nagi] localStorage is unavailable — progress and preferences will not persist this session.');
  }
  return { available, prefix: STORAGE_PREFIX };
}

/* -- Footer ---------------------------------------------------------------------- */

function initFooterYear() {
  const yearEl = document.getElementById('year');
  if (yearEl) {
    yearEl.textContent = String(new Date().getFullYear());
  }
}

/* -- Boot ------------------------------------------------------------------------- */

function init() {
  initTheme();
  initStorage();
  initFooterYear();
  initRouter();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

export { toggleTheme };
