/* ==========================================================================
   theme.js
   Applies and persists the reader's light/dark appearance preference.
   Built on storage.js's settings store, so the preference is saved the
   same safe way as any other setting rather than talking to
   localStorage directly.
   ========================================================================== */

import { settings } from './storage.js';

const THEME_SETTING_KEY = 'theme';
const THEMES = ['light', 'dark'];
const DARK_QUERY = '(prefers-color-scheme: dark)';

function isValidTheme(value) {
  return THEMES.includes(value);
}

function storedTheme() {
  const value = settings.get(THEME_SETTING_KEY);
  return isValidTheme(value) ? value : null;
}

function systemTheme() {
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light';
}

function currentTheme() {
  return document.documentElement.dataset.theme || systemTheme();
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
}

function setTheme(theme) {
  if (!isValidTheme(theme)) return;
  applyTheme(theme);
  settings.set(THEME_SETTING_KEY, theme);
}

function toggleTheme() {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  setTheme(next);
  return next;
}

function initTheme() {
  applyTheme(storedTheme() ?? systemTheme());

  // Keep following the system while the reader hasn't made an explicit
  // choice of their own
  window.matchMedia(DARK_QUERY).addEventListener('change', (event) => {
    if (storedTheme() === null) {
      applyTheme(event.matches ? 'dark' : 'light');
    }
  });
}

export { initTheme, setTheme, toggleTheme, currentTheme };
