/* ==========================================================================
   test/helpers/localStorage.mjs
   An in-memory localStorage, installed as a global before the modules under
   test are imported.

   This is what makes most of Bigu testable at all. The study model, the
   streak, the bridge and the backup format all read and write through
   core/storage.js, which reaches for `localStorage` — but only when called,
   never at import time. So the whole persistence layer runs unchanged in
   Node as long as the global is there first.

   It is the real Web Storage contract, not a Map with two of its methods:
   values are coerced to strings, a missing key is null rather than
   undefined, and `length`/`key(n)` work. Coercion is the one that matters —
   a stub that stored objects by reference would let a test pass on a value
   JSON.stringify never touched, which is exactly the class of bug
   storage.js exists to absorb.

   `installFailingStorage` is the other half. Safari private browsing and
   locked-down profiles throw from setItem rather than returning false, and
   every guard in storage.js exists for that case; a suite that only ever
   ran against a working store would never once execute them.
   ========================================================================== */

function createMemoryStorage() {
  const entries = new Map();

  return {
    get length() {
      return entries.size;
    },
    key(index) {
      return [...entries.keys()][index] ?? null;
    },
    getItem(key) {
      const value = entries.get(String(key));
      return value === undefined ? null : value;
    },
    setItem(key, value) {
      entries.set(String(key), String(value));
    },
    removeItem(key) {
      entries.delete(String(key));
    },
    clear() {
      entries.clear();
    },
  };
}

/* A store that throws on every operation, the way a browser with site data
   blocked does. */
function createFailingStorage() {
  const refuse = () => { throw new Error('SecurityError: the operation is insecure.'); };
  return {
    get length() { return refuse(); },
    key: refuse,
    getItem: refuse,
    setItem: refuse,
    removeItem: refuse,
    clear: refuse,
  };
}

/* Installs a fresh empty store. Call it in a beforeEach so no test can see
   what another one wrote. */
function installMemoryStorage() {
  const storage = createMemoryStorage();
  globalThis.localStorage = storage;
  return storage;
}

function installFailingStorage() {
  globalThis.localStorage = createFailingStorage();
}

export { createMemoryStorage, installMemoryStorage, installFailingStorage };
