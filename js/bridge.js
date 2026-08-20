/* ==========================================================================
   bridge.js
   A one-way publish of study activity to a single localStorage key outside
   the app's own `nagi:` namespace, for anything else served from the same
   origin to read. Nothing here is read back into Bigu and nothing here
   changes how Bigu behaves — if no one is listening, this is a write into
   a key nobody opens. There is no UI for it, and it awards nothing: it
   reports what the study stores already say, and computes no score of its
   own.

   Same guarding rule as storage.js: every read and write is wrapped, so a
   quota error, disabled storage or corrupted JSON turns into `false`, not
   an exception. A study session must finish normally even when the bridge
   cannot write a byte.

   The shape is a contract, not an internal structure — it is versioned by
   `v` and must not be changed in place:

     { v, app, updatedAt, status: { … }, events: [ … ] }

   `events` is append-only, oldest first, capped at the newest 50, and each
   entry carries the id the `practice` store already generated for that
   round so a reader can dedupe on it. `status` is a flat snapshot of
   display-ready values — already-counted numbers and an already-formatted
   date, so a reader can print them without knowing anything about how Bigu
   schedules or what it stores.

   Both publishers re-read the envelope, merge into it, bump `updatedAt` and
   write once: publishing an event leaves the status exactly as it was found
   and vice versa.
   ========================================================================== */

const KEY = 'bigu:bridge';
const VERSION = 2;
const APP = 'Bigu';
const EVENT_LIMIT = 50;

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
   tomorrow in UTC. The result is still an ISO-8601 calendar date, which is
   what the reader prints.
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
  return { v: VERSION, app: APP, updatedAt: 0, status: null, events: [] };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
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
  if (!isPlainObject(parsed)) return emptyState();
  const state = emptyState();
  if (Array.isArray(parsed.events)) {
    state.events = parsed.events.filter(isPlainObject);
  }
  if (isPlainObject(parsed.status)) {
    state.status = parsed.status;
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

/* Appends one thing that happened. `id` is the id the practice store
   generated for that same round, so a reader that has already seen it can
   skip it — which is also why re-publishing the same id here is a no-op
   rather than a second entry.

   `value` is the one number worth showing next to the event and `detail`
   the one line of text under it; both arrive already decided, because
   choosing them is the publishing surface's job, not the reader's. */
function publishEvent({ id, type, value, detail } = {}) {
  try {
    if (!id || !type) return false;
    const state = readState();
    if (state.events.some((event) => event.id === id)) return true;
    const now = Date.now();
    state.events.push({
      id,
      type,
      at: now,
      date: localDate(new Date(now)),
      value,
      detail,
    });
    if (state.events.length > EVENT_LIMIT) {
      state.events = state.events.slice(-EVENT_LIMIT);
    }
    return writeState(state);
  } catch {
    return false;
  }
}

/* Replaces the status object outright — it describes how things stand right
   now, so there is nothing to merge with how they stood an hour ago. Fields
   that arrive undefined are dropped rather than written as null: a caller
   with no streak to report publishes a status with no `streak` key, which
   is a reader's cue to show nothing there rather than a zero. */
function publishStatus(status = {}) {
  try {
    const next = {};
    for (const [field, value] of Object.entries(status)) {
      if (value !== undefined) next[field] = value;
    }
    const state = readState();
    state.status = next;
    return writeState(state);
  } catch {
    return false;
  }
}

export { publishEvent, publishStatus };
