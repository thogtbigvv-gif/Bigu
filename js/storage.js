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
      return readJSON(key, {});
    },
    get(itemKey, fallback) {
      const all = readJSON(key, {});
      return itemKey in all ? all[itemKey] : fallback;
    },
    set(itemKey, value) {
      const all = readJSON(key, {});
      all[itemKey] = value;
      return writeJSON(key, all);
    },
    remove(itemKey) {
      const all = readJSON(key, {});
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
      return readJSON(key, []);
    },
    add(entry) {
      const entries = readJSON(key, []);
      const record = { id: createId(), createdAt: Date.now(), ...entry };
      entries.push(record);
      writeJSON(key, entries);
      return record;
    },
    update(id, changes) {
      const entries = readJSON(key, []);
      const index = entries.findIndex((item) => item.id === id);
      if (index === -1) return null;
      entries[index] = { ...entries[index], ...changes, updatedAt: Date.now() };
      writeJSON(key, entries);
      return entries[index];
    },
    remove(id) {
      const entries = readJSON(key, []).filter((item) => item.id !== id);
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
/* id → true for anything the reader has chosen to keep. A map rather than a
   list so the "is this one kept?" lookup every card does is a key check, and
   so un-keeping is a delete instead of a filter. */
const favorites = createMapStore('favorites');

function clearAll() {
  const results = [settings.clear(), progress.clear(), journal.clear(), practice.clear(), favorites.clear()];
  return results.every(Boolean);
}

export { isAvailable, settings, progress, journal, practice, favorites, clearAll };
