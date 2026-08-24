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

/* Fired on <document> whenever the applied theme changes, from anywhere.
   The header toggle and the Settings view are two controls over one piece
   of state, and without this the one you didn't touch goes stale. */
const THEME_CHANGE_EVENT = 'bigu:themechange';

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

/* What the reader chose, as opposed to what's currently applied: 'system'
   when they've expressed no preference and the OS is deciding. */
function themePreference() {
  return storedTheme() ?? 'system';
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: { theme } }));
}

function setTheme(theme) {
  if (!isValidTheme(theme)) return;
  applyTheme(theme);
  settings.set(THEME_SETTING_KEY, theme);
}

/* 'system' isn't a stored value — it's the absence of one, so the existing
   matchMedia listener in initTheme() starts following the OS again. */
function setThemePreference(preference) {
  if (preference === 'system') {
    settings.remove(THEME_SETTING_KEY);
    applyTheme(systemTheme());
    return;
  }
  setTheme(preference);
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

/* -- UI binding ----------------------------------------------------------------------
   Wires the header's icon button to toggleTheme() and keeps its
   aria-pressed state (which the CSS reads to swap the sun/moon icon)
   in sync — both on click and whenever the system preference changes
   the theme out from under it.
   -------------------------------------------------------------------------------------- */
function bindToggleButton(button) {
  if (!button) return;

  const sync = () => {
    button.setAttribute('aria-pressed', String(currentTheme() === 'dark'));
  };

  button.addEventListener('click', toggleTheme);

  document.addEventListener(THEME_CHANGE_EVENT, sync);
  window.matchMedia(DARK_QUERY).addEventListener('change', sync);
  sync();
}

/* setTheme, toggleTheme and currentTheme drive bindToggleButton from
   inside this module; the rest of the app talks to the *preference*
   (setThemePreference / themePreference), which is the setting a reader
   actually chose rather than whatever is applied right now. */
export {
  initTheme,
  setThemePreference,
  themePreference,
  bindToggleButton,
  THEME_CHANGE_EVENT,
};
