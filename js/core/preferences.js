/* ==========================================================================
   preferences.js
   The handful of study settings a reader can actually change, read from and
   written to storage.js's `settings` store.

   Two of them, and both were previously constants: the review round was
   fixed at ten cards in practice.js, and there was no notion of a daily
   target at all. Ten is a fine default and a poor rule — a reader with five
   minutes on a train and a reader sitting down for a session are the same
   person on different days, and the app asking both of them for exactly ten
   cards is the app deciding something it has no information about.

   Everything here is defensive on read: a value that isn't one of the
   offered options falls back to the default rather than reaching a view,
   because these are also the values a restored backup can carry and a
   hand-edited store can hold anything.
   ========================================================================== */

import { settings } from './storage.js';

const SESSION_SIZE_KEY = 'sessionSize';
const DAILY_GOAL_KEY = 'dailyGoal';

/* Short, standard, long. Not a free number field: three named sizes are a
   choice a reader can make in a second, where a spinner is a small research
   project about what the right number is. */
const SESSION_SIZES = [5, 10, 20];
const DEFAULT_SESSION_SIZE = 10;

/* 0 means "no goal", and it is the default. A daily target is genuinely
   useful to some learners and quietly corrosive to others — it turns a
   short honest visit into a failure — so the app does not assume one. When
   it is set, it is reported and never celebrated or scolded; see the goal
   line in dashboard.js. */
const DAILY_GOALS = [0, 5, 10, 20, 40];
const DEFAULT_DAILY_GOAL = 0;

function readChoice(key, allowed, fallback) {
  const value = Number(settings.get(key));
  return allowed.includes(value) ? value : fallback;
}

function sessionSize() {
  return readChoice(SESSION_SIZE_KEY, SESSION_SIZES, DEFAULT_SESSION_SIZE);
}

function setSessionSize(value) {
  if (!SESSION_SIZES.includes(value)) return;
  settings.set(SESSION_SIZE_KEY, value);
}

function dailyGoal() {
  return readChoice(DAILY_GOAL_KEY, DAILY_GOALS, DEFAULT_DAILY_GOAL);
}

function setDailyGoal(value) {
  if (!DAILY_GOALS.includes(value)) return;
  settings.set(DAILY_GOAL_KEY, value);
}

export {
  SESSION_SIZES,
  DAILY_GOALS,
  sessionSize,
  setSessionSize,
  dailyGoal,
  setDailyGoal,
};
