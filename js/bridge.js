/* ==========================================================================
   bridge.js
   A one-way publish of study activity to a single localStorage key outside
   the app's own `nagi:` namespace, for anything else served from the same
   origin to read. Nothing here is read back into Bigu and nothing here
   changes how Bigu behaves — if no one is listening, this is a write into
   a key nobody opens.

   Same guarding rule as storage.js: every read and write is wrapped, so a
   quota error, disabled storage or corrupted JSON turns into `false`, not
   an exception. A study session must finish normally even when the bridge
   cannot write a byte.

   The shape is a contract, not an internal structure — it is versioned by
   `v` and must not be changed in place:

     { v, app, updatedAt, due: { date, count }, sessions: [ … ] }

   `sessions` is append-only, oldest first, capped at the newest 50, and
   each entry carries the id the `practice` store already generated for
   that round so a reader can dedupe on it.
   ========================================================================== */

const KEY = 'bigu:bridge';
const VERSION = 1;
const APP = 'Bigu';
const SESSION_LIMIT = 50;

/* -- Raw access ----------------------------------------------------------------- */

function readRaw(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeRaw(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/* -- Local date -----------------------------------------------------------------
   Built from the local calendar fields, never from toISOString(): a round
   finished at 23:30 belongs to the day the reader just spent, not to
   tomorrow in UTC.
   -------------------------------------------------------------------------------------- */

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/* -- State ----------------------------------------------------------------------
   A partly-corrupted payload is repaired field by field rather than thrown
   away, and an unreadable one falls back to an empty payload. Either way a
   publish of one field leaves the other field as it was found.
   -------------------------------------------------------------------------------------- */

function emptyState() {
  return { v: VERSION, app: APP, updatedAt: 0, due: null, sessions: [] };
}

function readState() {
  const raw = readRaw(KEY);
  if (raw === null) return emptyState();
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return emptyState();
  const state = emptyState();
  if (Array.isArray(parsed.sessions)) {
    state.sessions = parsed.sessions.filter((entry) => entry && typeof entry === 'object' && !Array.isArray(entry));
  }
  if (parsed.due && typeof parsed.due === 'object' && !Array.isArray(parsed.due)) {
    state.due = parsed.due;
  }
  return state;
}

function writeState(state) {
  state.v = VERSION;
  state.app = APP;
  state.updatedAt = Date.now();
  try {
    return writeRaw(KEY, JSON.stringify(state));
  } catch {
    return false;
  }
}

/* -- Publishing ---------------------------------------------------------------------- */

/* Appends one finished round. `id` is the id the practice store generated
   for that same round, so a reader that has already seen it can skip it —
   which is also why re-publishing the same id here is a no-op rather than
   a second entry. */
function publishSession({ id, mode, total, correct } = {}) {
  try {
    if (!id) return false;
    const state = readState();
    if (state.sessions.some((entry) => entry.id === id)) return true;
    const now = Date.now();
    state.sessions.push({
      id,
      at: now,
      date: localDate(new Date(now)),
      mode,
      total,
      correct,
    });
    if (state.sessions.length > SESSION_LIMIT) {
      state.sessions = state.sessions.slice(-SESSION_LIMIT);
    }
    return writeState(state);
  } catch {
    return false;
  }
}

/* Replaces the due snapshot outright — it describes today, so there is
   nothing to merge with yesterday's. */
function publishDue(count) {
  try {
    const state = readState();
    state.due = { date: localDate(), count };
    return writeState(state);
  } catch {
    return false;
  }
}

export { publishSession, publishDue };
