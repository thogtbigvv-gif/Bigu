/* ==========================================================================
   bridge.js
   A one-way publish of study activity to a single localStorage key beside
   the app's own `bigu:<store>` keys, for anything else served from the same
   origin to read. `bigu:bridge` is deliberately not a store: nothing in
   storage.js knows about it, nothing in Bigu reads it back, and its shape
   is a contract with an outside surface rather than an internal structure. Nothing here is read back into Bigu and nothing here
   changes how Bigu behaves — if no one is listening, this is a write into
   a key nobody opens. There is no UI for it, and it awards nothing: it
   reports what the study stores already say, and computes no score of its
   own.

   Same guarding rule as storage.js: every read and write is wrapped, so a
   quota error, disabled storage or corrupted JSON turns into `false`, not
   an exception. A study session must finish normally even when the bridge
   cannot write a byte.

   The shape is a contract, not an internal structure — it is versioned by
   `v` and must not be changed in place. docs/BRIDGE.md is the account of it
   written for the reader on the other side:

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

   The three writers, and why there are three:

     publishStatus   how things stand now — replaced outright
     publishEvent    one round that happened — appended, deduped by id
     publishEvents   several at once, same rules, one write

   And one eraser, clearBridge(), for the two moments this browser's study
   history stops being the history the key describes: Start over, and a
   restore from someone else's backup file.
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

function removeRaw(key) {
  try {
    localStorage.removeItem(key);
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

   An envelope written by a *different* version of the contract is dropped
   whole rather than repaired. Merging into it would relabel one version's
   entries with another version's `v`, which is the one lie the version
   field exists to prevent — a reader that checks `v` and then trusts what
   is under it would be reading v1 events out of an envelope stamped v2.
   Dropping costs the reader the older history and nothing else: the rounds
   themselves live in the practice store, and study/session.js republishes
   them from there on the next boot.
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
  if (parsed.v !== VERSION) return emptyState();
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

/* One entry, built from what a caller hands over. `at` is the moment the
   round happened rather than the moment it is being published — the same
   thing for a round finishing now, and not the same thing at all for one
   being republished out of the practice store, where writing today's date
   onto a round from last week would hand the reader a timeline it cannot
   correct. */
function buildEvent({ id, type, value, detail, at }) {
  const when = Number.isFinite(at) && at > 0 ? at : Date.now();
  return { id, type, at: when, date: localDate(new Date(when)), value, detail };
}

/* Merges entries into the log in the order given, drops any whose id is
   already there, and caps the result at the newest EVENT_LIMIT. Returns the
   number actually added, so a caller can tell an append from a no-op. */
function mergeEvents(state, entries) {
  const seen = new Set(state.events.map((event) => event.id));
  let added = 0;
  for (const entry of entries) {
    if (!entry || !entry.id || !entry.type) continue;
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    state.events.push(buildEvent(entry));
    added += 1;
  }
  if (state.events.length > EVENT_LIMIT) {
    state.events = state.events.slice(-EVENT_LIMIT);
  }
  return added;
}

/* Appends one thing that happened. `id` is the id the practice store
   generated for that same round, so a reader that has already seen it can
   skip it — which is also why re-publishing the same id here is a no-op
   rather than a second entry.

   `value` is the one number worth showing next to the event and `detail`
   the one line of text under it; both arrive already decided, because
   choosing them is the publishing surface's job, not the reader's. */
function publishEvent({ id, type, value, detail, at } = {}) {
  try {
    if (!id || !type) return false;
    const state = readState();
    if (mergeEvents(state, [{ id, type, value, detail, at }]) === 0) return true;
    return writeState(state);
  } catch {
    return false;
  }
}

/* The same append for a batch, in one read and one write rather than one of
   each per entry. This exists for the republish at boot, which offers the
   whole practice history every time and on all but the first visit adds
   nothing at all — so a batch that adds nothing writes nothing, and the
   reader's `updatedAt` keeps meaning "when something last changed" instead
   of "when Bigu was last opened". Entries are expected oldest first, the
   order the log is kept in. */
function publishEvents(entries = []) {
  try {
    if (!Array.isArray(entries) || entries.length === 0) return true;
    const state = readState();
    if (mergeEvents(state, entries) === 0) return true;
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

/* Takes the key away. The only destructive call in this module, and it
   exists because clearing Bigu used not to clear what Bigu had said about
   itself: `bigu:bridge` is not one of storage.js's stores, so Start over
   emptied every one of them and left a streak, a due count and fifty
   finished rounds standing on the other surface, describing study this
   browser no longer holds any record of. A restore from a backup file is
   the same problem wearing different clothes — the history in the key is
   the history of whoever the browser belonged to before the file landed.

   Removed rather than written empty: no key at all is exactly what a reader
   sees before Bigu has ever been opened here, which is the true statement
   in both cases and a state the reader already has to handle. What comes
   next is a reload, and boot republishes the status and whatever rounds the
   stores now actually hold. */
function clearBridge() {
  return removeRaw(KEY);
}

export { publishEvent, publishEvents, publishStatus, clearBridge };
