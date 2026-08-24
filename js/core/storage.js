/* ==========================================================================
   storage.js
   Safe localStorage wrapper. Every read/write is guarded against browsers
   that throw (Safari private mode, storage disabled) and against corrupted
   JSON, so a bad value never crashes a feature — it just falls back.
   Exposes three ready-made stores for the data this app actually needs:
   settings (flat preferences), progress (per-item study state), and
   journal (an ordered list of study-log entries).
   ========================================================================== */

const NAMESPACE = 'nagi';

function buildKey(name) {
  return `${NAMESPACE}:${name}`;
}

function createId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

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

function readJSON(key, fallback) {
  const raw = readRaw(key);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  try {
    return writeRaw(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

/* Valid JSON is not the same thing as the shape a store expects, and only
   the first was being checked. A key holding `null`, `5` or `[]` where a map
   belongs parses cleanly and then throws on the very next line — `'x' in
   null` is a TypeError, and so is pushing onto a string. Because every view
   reads progress through review.js, one such key took the whole app down
   with a blank screen, which is exactly the failure this module says it
   exists to prevent. A wrong-shaped value is corruption like any other and
   falls back the same way. */
function readMap(key) {
  const value = readJSON(key, null);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function readList(key) {
  const value = readJSON(key, null);
  return Array.isArray(value) ? value : [];
}

/* -- Availability ----------------------------------------------------------------- */

function isAvailable() {
  const testKey = buildKey('__test__');
  const ok = writeRaw(testKey, '1');
  removeRaw(testKey);
  return ok;
}

/* -- Map store: a flat object of key → value under one storage key -----------------
   Used for settings and progress — both are "look up by id" data.
   -------------------------------------------------------------------------------------- */

function createMapStore(name) {
  const key = buildKey(name);
  return {
    getAll() {
      return readMap(key);
    },
    get(itemKey, fallback) {
      const all = readMap(key);
      return itemKey in all ? all[itemKey] : fallback;
    },
    set(itemKey, value) {
      const all = readMap(key);
      all[itemKey] = value;
      return writeJSON(key, all);
    },
    remove(itemKey) {
      const all = readMap(key);
      delete all[itemKey];
      return writeJSON(key, all);
    },
    clear() {
      return removeRaw(key);
    },
    // Bulk overwrite for backup restore — replaces the whole object in one
    // write instead of merging key by key. A non-object input falls back to
    // an empty map rather than corrupting the store with garbage.
    replaceAll(newAll) {
      return writeJSON(key, newAll && typeof newAll === 'object' && !Array.isArray(newAll) ? newAll : {});
    },
  };
}

/* -- List store: an ordered array of records under one storage key -----------------
   Used for journal — entries are appended, not looked up by a fixed key.
   -------------------------------------------------------------------------------------- */

function createListStore(name) {
  const key = buildKey(name);
  return {
    getAll() {
      return readList(key);
    },
    add(entry) {
      const entries = readList(key);
      const record = { id: createId(), createdAt: Date.now(), ...entry };
      entries.push(record);
      writeJSON(key, entries);
      return record;
    },
    update(id, changes) {
      const entries = readList(key);
      const index = entries.findIndex((item) => item && item.id === id);
      if (index === -1) return null;
      entries[index] = { ...entries[index], ...changes, updatedAt: Date.now() };
      writeJSON(key, entries);
      return entries[index];
    },
    remove(id) {
      const entries = readList(key).filter((item) => !item || item.id !== id);
      return writeJSON(key, entries);
    },
    clear() {
      return removeRaw(key);
    },
    // Bulk overwrite for backup restore — replaces the whole array in one
    // write. A non-array input falls back to an empty list rather than
    // corrupting the store with garbage.
    replaceAll(newEntries) {
      return writeJSON(key, Array.isArray(newEntries) ? newEntries : []);
    },
  };
}

/* -- App stores ----------------------------------------------------------------------- */

const settings = createMapStore('settings');
const progress = createMapStore('progress');
const journal = createListStore('journal');
const practice = createListStore('practice');
/* Sentences the reader brought in from outside the app — see ichibun.js. A
   list rather than a map for the same reason journal is: they are kept in the
   order they arrived and never looked up by a fixed key. */
const sentences = createListStore('sentences');
/* id → true for anything the reader has chosen to keep. A map rather than a
   list so the "is this one kept?" lookup every card does is a key check, and
   so un-keeping is a delete instead of a filter. */
const favorites = createMapStore('favorites');

/* -- The stores, as data -------------------------------------------------------------
   Everything this app persists, in one list. It exists because the backup
   card in settings.js described the same six stores three separate times —
   once to export them, once to decide whether a file was a valid backup, and
   once to write them back — and the three lists had already drifted. Two of
   the stores were added after the backup format was, and each addition
   needed remembering in all three places; `sentences` was missing from the
   validator's list, which is the drift, not a hypothetical.

   `kind` is what a valid value looks like. It is not decoration: restore
   overwrites the reader's real data with whatever the file holds, and a
   store handed the wrong kind falls back to empty — so an array where a map
   belongs is not a rejected file, it is a wiped one. The check that stops
   that is in settings.js and reads this field.

   `required` marks the four stores the format shipped with. A backup taken
   before `favorites` or `sentences` existed is still a perfectly good
   backup, and demanding the newer keys would reject every file already on
   a reader's disk.
   ---------------------------------------------------------------------------------------- */

const STORES = [
  { name: 'settings', store: settings, kind: 'map', required: true },
  { name: 'progress', store: progress, kind: 'map', required: true },
  { name: 'journal', store: journal, kind: 'list', required: true },
  { name: 'practice', store: practice, kind: 'list', required: true },
  { name: 'favorites', store: favorites, kind: 'map', required: false },
  { name: 'sentences', store: sentences, kind: 'list', required: false },
];

/* Whether a value is the kind a given store holds. The same question
   readMap and readList ask of what they find in localStorage, asked of what
   arrives in a backup file — one definition, so a value the restore accepts
   is a value the store will actually keep. */
function isStoreShaped(kind, value) {
  return kind === 'list'
    ? Array.isArray(value)
    : Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clearAll() {
  return STORES.map(({ store }) => store.clear()).every(Boolean);
}

export {
  isAvailable,
  settings,
  progress,
  journal,
  practice,
  favorites,
  sentences,
  STORES,
  isStoreShaped,
  clearAll,
};
