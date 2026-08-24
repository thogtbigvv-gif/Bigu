/* ==========================================================================
   core/backup.js
   The file a reader can carry their study out in, and the rules for letting
   one back in.

   Everything Bigu knows lives in one browser's localStorage. There is no
   account and no server copy — which is the point, and which also means the
   backup file is the only thing standing between a cleared cache and a lost
   year. That makes restore the one operation in this app that cannot be
   undone, and the reason this is a module of its own rather than three
   functions inside the Settings view: the code that can destroy a reader's
   progress should be readable on its own, and testable without a document.

   The view keeps only the parts that need one — turning a payload into a
   download, and reading a chosen file back off disk.

   The format, versioned by nothing but its own shape, deliberately:

     { app: 'Bigu', exportedAt, data: { <store>: <contents>, … } }

   `data` is keyed by store name, and which stores exist is STORES in
   storage.js rather than a list written out here. Export, validate and
   restore all walk the same one, so a seventh store is added in exactly one
   place and cannot be forgotten by two of the three.
   ========================================================================== */

import { STORES, isStoreShaped } from './storage.js';

const APP = 'Bigu';

/* Local calendar fields, not toISOString(): a backup taken at 23:30 is dated
   the day the reader took it, not tomorrow in UTC. */
function todayKey(now = new Date()) {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function backupFilename(now = new Date()) {
  return `bigu-backup-${todayKey(now)}.json`;
}

function buildBackupPayload() {
  return {
    app: APP,
    exportedAt: new Date().toISOString(),
    data: Object.fromEntries(STORES.map(({ name, store }) => [name, store.getAll()])),
  };
}

/* -- Validation ---------------------------------------------------------------------------
   What is wrong with this file, or null when nothing is.

   This used to answer a narrower question — are the four original keys
   present? — and presence was all it checked. That let a file through whose
   `progress` was `null`, or an array, or a leftover string, and restore then
   handed it to a store whose replaceAll turns anything ill-shaped into an
   empty one. The reader clicked Restore on a damaged file and read
   "Restored from backup" while their whole study history was overwritten
   with `{}`.

   So each store present in the file is checked against the kind it actually
   holds, and a single wrong one rejects the whole file rather than being
   quietly emptied. Returning the reason rather than a boolean is the other
   half: "this does not look like a Bigu backup" is not something a reader
   can act on when the file plainly is one and the problem is a single
   corrupted key.

   Contents are not inspected beyond their kind, and that is deliberate. A
   progress map whose records are half-written is not a reason to refuse the
   file — review.js normalizes every record it reads precisely so that a
   partial one degrades instead of throwing. What cannot be survived is a
   store of the wrong *kind*, because that is what silently becomes nothing.
   ------------------------------------------------------------------------------------------- */

function describeBackupProblem(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return 'Энэ файл дотор Bigu-гийн нөөцийн бүтэц алга.';
  }
  if (payload.app !== APP) {
    return 'Энэ нь Bigu-гийн нөөц файл биш бололтой.';
  }

  const data = payload.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return 'Нөөцийн "data" хэсэг дутуу байна.';
  }

  for (const { name, kind, required } of STORES) {
    if (!(name in data)) {
      // A store the format gained later is allowed to be absent; one it
      // shipped with is not, and its absence means a truncated file.
      if (required) return `Нөөц дутуу байна: "${name}" хэсэг алга.`;
      continue;
    }
    if (!isStoreShaped(kind, data[name])) {
      return `Нөөцийн "${name}" хэсэг эвдэрсэн байна. Сэргээгээгүй — одоо байгаа өгөгдөл тань хэвээрээ.`;
    }
  }

  return null;
}

/* -- Restore ------------------------------------------------------------------------------
   Overwrites every store from a validated payload. Absent keys are passed
   through as undefined on purpose: replaceAll reads that as "this file
   predates the store" and writes the store's own empty value, which is the
   correct reading of a backup taken before the store existed.

   Only ever reached once describeBackupProblem has returned null, so no key
   present here is the wrong kind.
   ------------------------------------------------------------------------------------------- */

function restoreBackup(payload) {
  for (const { name, store } of STORES) {
    store.replaceAll(payload.data[name]);
  }
}

export { backupFilename, buildBackupPayload, describeBackupProblem, restoreBackup, todayKey };
