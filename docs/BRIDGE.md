# The bridge

Bigu publishes what the reader has been studying to one `localStorage` key,
for the separate summer-project surface served from the same origin to read.
This is the account of that key, written for whoever is on the other side of
it.

It is one-way and it is a copy. Bigu never reads the key back, nothing in the
app changes because of what is in it, and if nobody is listening it is a write
into a key nobody opens. Everything in it is already true somewhere else —
these are numbers Bigu counts for its own screens, republished so a reader
does not have to know how Bigu schedules or what it stores.

Written by [`js/core/bridge.js`](../js/core/bridge.js). Published from
[`js/study/session.js`](../js/study/session.js) as rounds finish and from
[`js/app.js`](../js/app.js) at boot.

---

## Where it is

```
key      bigu:bridge
origin   whatever origin Bigu is served from
```

`localStorage` is per-origin, not per-path, so a page anywhere under
`https://<user>.github.io/` shares this store with every other project
published there. That is what makes the bridge possible and also why the key
is namespaced: `bigu:bridge` is Bigu's, `bigu:progress` and the other
`bigu:<store>` keys are Bigu's own data and are not part of this contract —
they are internal shapes and will change without notice.

**Read this key. Do not write to it.** A writer would be overwritten without
warning by the next round the reader finishes.

---

## The envelope

```json
{
  "v": 2,
  "app": "Bigu",
  "updatedAt": 1756600000000,
  "status": {
    "dueCount": 12,
    "learnedCount": 240,
    "lastStudied": "2026-08-30",
    "streak": 5
  },
  "events": [
    {
      "id": "0f1c…",
      "type": "review.session",
      "at": 1756590000000,
      "date": "2026-08-30",
      "value": 7,
      "detail": "10 items · 7 correct"
    }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `v` | Contract version. Currently `2`. Check it (see [Versioning](#versioning)). |
| `app` | Always `"Bigu"`. |
| `updatedAt` | Epoch ms of the last write that changed something. |
| `status` | How things stand now, or `null` if nothing has been published yet. |
| `events` | Rounds that happened, oldest first. Possibly empty. |

`status` and `events` are published separately and merged into the same
envelope, so a write to one leaves the other exactly as it was.

### `status`

A flat snapshot of display-ready values, replaced outright on each publish.
Every field is optional, and an absent field means *nothing to show* rather
than zero — print nothing there rather than a `0`.

| Field | Type | Meaning |
| --- | --- | --- |
| `dueCount` | number | Items waiting to be reviewed right now. |
| `learnedCount` | number | Items the reader is holding — met and not yet faded out of the schedule. |
| `lastStudied` | `YYYY-MM-DD` | The local calendar day of the most recent round. Absent if there has never been one. |
| `streak` | number | Consecutive days studied. **Absent, never `0`.** There is a difference between "your run is broken" and "you have no run", and only the first is worth screen space. |

Published at boot, after every graded round, and after a card is graded in
Memory — those are the moments any of it can have changed.

### `events`

Append-only, oldest first, capped at the newest **50**.

| Field | Type | Meaning |
| --- | --- | --- |
| `id` | string | The id Bigu's own practice store generated for that round. Stable. **Dedupe on this.** |
| `type` | string | `review.session` or `lesson.quiz`. |
| `at` | number | Epoch ms of when the round *happened* — not when it was published. |
| `date` | `YYYY-MM-DD` | The same moment as the reader's local calendar day. Built from local fields, so a round finished at 23:30 belongs to the day they just spent, not to tomorrow in UTC. |
| `value` | number | Items answered correctly. |
| `detail` | string | One line already written out, e.g. `10 items · 7 correct`. |

An id is published once. Re-publishing one is a no-op, which is what makes it
safe for a reader to keep its own list and merge on every read.

---

## Reading it

```js
function readBigu() {
  let payload = null;
  try {
    payload = JSON.parse(localStorage.getItem('bigu:bridge') ?? 'null');
  } catch {
    return null;
  }
  if (!payload || payload.v !== 2) return null;   // absent, damaged, or another contract
  return {
    status: payload.status ?? {},
    events: Array.isArray(payload.events) ? payload.events : [],
    updatedAt: payload.updatedAt ?? 0,
  };
}
```

Three things to handle, all of them normal:

**No key at all.** Bigu has not been opened in this browser — or it has been
opened and the reader has erased everything, or restored a backup over it. All
of them mean *there is nothing to say about this reader yet*, and none of them
is an error. Show whatever you show before someone starts.

**A key that has stopped moving.** `updatedAt` is the only staleness signal
there is, and Bigu will not update it while nobody is opening Bigu. Treat old
figures as old figures; do not present a two-week-old `dueCount` as today's.

**A change while your page is open.** The browser fires a `storage` event at
*other* documents on the origin, so a page open beside Bigu can listen rather
than poll:

```js
window.addEventListener('storage', (event) => {
  if (event.key === 'bigu:bridge') render(readBigu());
});
```

That covers another tab. A page in the *same* document as the write, and a
page opened after it, both just read the key.

---

## What is not here, and will not be

- **No score, level, XP or grade.** Bigu does not compute one, and the bridge
  is not the place to start. `value` is a count of correct answers in one
  round, not a currency.
- **No content the reader wrote.** Journal entries, captured sentences and
  kept words stay in Bigu's own stores. The bridge carries counts and dates.
- **No per-item schedule.** What is due is a number here, never a list of
  which words.
- **Nothing invented for the occasion.** If a figure is not already on one of
  Bigu's own screens, it does not belong in the key.

---

## Versioning

`v` is the whole of the compatibility story. The shape above is version `2`.

- A reader must check `v` and ignore an envelope it does not recognise. Bigu
  does the same: an envelope written under a different version is dropped
  whole rather than merged into, because relabelling one version's entries
  with another's `v` is exactly the lie the field exists to prevent. The
  rounds survive it — they live in Bigu's practice store, and the next boot
  republishes them from there.
- Fields are added without a bump. A reader that ignores fields it does not
  know keeps working.
- **Renaming, removing or changing the meaning of a field bumps `v`.** The
  shape is not changed in place.

---

## Keeping it honest

The event log is a copy; Bigu's practice store is the original. They can drift
whenever the store gains history the bridge did not watch arrive — a restored
backup, a key cleared by hand or evicted by the browser, an envelope from an
older contract being dropped. So Bigu offers the whole practice history at
every boot, and every id already in the log is skipped. On an ordinary visit
that adds nothing and writes nothing; after any of those, it rebuilds the log
from the store.

Which is also why `updatedAt` means *when something last changed* rather than
*when Bigu was last opened*: a republish that adds nothing does not touch the
envelope.

The two moments the key is taken away entirely are **Settings → Start over**
and a **restore from a backup file**. In both, this browser's study history
stops being the history the key describes, and the honest state is the one a
reader already handles: no key.
