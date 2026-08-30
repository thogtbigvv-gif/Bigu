# How Bigu is built

The README says what Bigu is for. This says how it is put together, and —
where the answer is not obvious — why it is put together that way rather
than the other way.

Read it before moving anything between directories, adding a content file,
or touching `js/core/storage.js`.

---

## The shape of it

No framework, no build step, no runtime dependencies. `index.html` links
the stylesheets by hand and loads exactly one module, `js/app.js`. What the
browser is served is what is in the repository.

Two files sit outside `js/` because they have to: `manifest.json` and
`sw.js`, which are what make Bigu installable. A service worker cannot
control pages above its own URL, so `sw.js` is at the root or it is
nothing — see *Installing, and offline* below.

That is a real constraint, not a boast. It means:

- **Nothing is compiled, so nothing is checked by compiling.** A wrong
  import path is not an error anywhere until a reader opens the one view
  that needs it. This is why `tools/check-structure.mjs` exists.
- **A file is only lazy if it is fetched lazily.** Every module in the
  graph is parsed at boot; what defers is the *fetching and rendering*,
  which the router owns.
- **The stylesheet order in `index.html` is the cascade.** Tokens, reset,
  type, structure, components — new component sheets go at the end.

---

## The layers

`js/` is five directories, and the dependency arrow runs one way down this
list. A module may import from its own layer or a layer below it. Nothing
below `views/` may import from `views/`.

| Layer | Holds | May import |
|---|---|---|
| `core/` | storage, router, theme, preferences, bridge, backup, the service worker, install | `core` |
| `data/` | the catalogue loaders, the shape guards, the link index | `core`, `data`, `study` |
| `study/` | the review model, streak, decks, favorites, session | `core`, `data`, `study` |
| `ui/` | shared widgets: content, quiz, nav, keyboard, favoriteButton, doors, the update banner | `core`, `data`, `study`, `ui` |
| `views/` | the thirteen screens | anything |

`data/` and `study/` may each import the other — the one bidirectional pair,
and deliberate: the catalogue asks `study/decks.js` which items are studiable,
and `study/session.js` asks the catalogue for the pool it counts over. No
module imports another one back, so there is no cycle.

**`core/`** is the machinery with no opinion about Japanese. `storage.js`
is the only module that knows a localStorage key by name (with one
deliberate exception — see *Storage* below). `bridge.js` writes to an
outside contract and is never read back. `serviceWorker.js` and `install.js`
hold the two halves of being installable and neither touches the DOM — the
banner and the Settings card that draw them are `ui/` and `views/`.

**`data/`** is the only place that knows where content lives. Every loader
is here; no view owns one. This matters more than it sounds: the loaders
used to live in whichever view rendered them first, so six other modules
imported *views* to reach a JSON file, and the Dashboard depended on the
Vocabulary screen.

**`study/`** is the model — what the reader has met, how strongly they hold
it, when it comes back, and what a deck is. All of it is pure enough to
test, and all of it is tested.

**`ui/`** is shared drawing. A module here builds DOM and knows nothing
about which screen it is on.

**`views/`** is one module per `<section class="view">` in `index.html`,
each exporting a single `initX()`.

### Why the arrow runs that way

Breaking it has a specific cost that has already been paid twice. In the
obvious direction: when a view owned its data loader, six other modules
imported *views* to reach a JSON file, so the Dashboard depended on the
Vocabulary screen and a change to how a list rendered could break a screen
that renders no list. And in a quieter one: `study/favorites.js` imported a
drawing helper in order to build a button, which made the study layer the
only place below the UI that touched the DOM — so the model of "I want to
keep this" could not be reasoned about, or tested, without a document.

If you find yourself importing from `views/`, what you want is almost
certainly a function that belongs in `data/` or `study/`. If a module below
`ui/` needs to build an element, it is two modules.

The rule is not a convention — `tools/check-structure.mjs` fails the build
on a violation, and on any import cycle.

---

## Boot and routing

`js/app.js` runs four things in an order that matters only where one step
depends on another: theme before first paint, storage checked before any
store is touched, the router last so it can render whichever view the URL
asks for once every module is registered.

`js/core/router.js` is a hash router that reads the `.view` sections out of
the document rather than holding a list of its own — adding or renaming a
view means editing `index.html`, never the router. It also owns
first-render: `app.js` registers one initializer per view, and the router
runs each the first time its view becomes active. A view the reader never
opens never fetches its data or builds its DOM.

**The route grammar is two segments.** `#view`, and `#view/entry-id`. The
second is the app's addressing scheme for a single entry — `#kanji/kj-n5-001`,
`#vocabulary/n5-001`, `#lessons/l7-12` — and it is what makes cross-linking
possible at all: before it, the only thing this app could name was a screen,
so a door had nowhere to point no matter what the views drew.

A target is a catalogue id, so nothing is encoded or decoded: ids are ASCII and
pass through a hash untouched. A target naming no entry is a normal arrival at
the view's own list, never an error — that is a retired id or an old bookmark,
and the list is the right answer to it.

The router does not know how a view *reveals* an entry, and must not: a kanji
opens a panel, a word pages a list forward and drops a filter, a lesson expands
a disclosure. It says which entry was asked for and each view answers in its
own vocabulary:

- `activeViewId()` — which view is on screen. Every module that used to read
  `location.hash.slice(1)` itself calls this instead; those comparisons all
  broke the day a hash could carry a second segment.
- `onRouteTarget(viewId, handler)` — a subscription, not an argument. A view
  registers **after** its first render, because revealing an entry ends by
  moving focus onto it and `focus()` on an element not yet in the document is
  silently dropped. The router tells a late subscriber about the navigation it
  missed, and tells each handler about one navigation at most once.
- `routeTo(viewId, target)` — go to an entry. An unchanged hash fires no
  `hashchange`, so it counts as a navigation of its own and redelivers.
- `clearRouteTarget(viewId)` — drop the entry, keep the view, for a panel the
  reader can close from inside it.

A view module is therefore called **exactly once**. Anything that must
refresh when the reader comes back (`dashboard`, `practice`, `memory`,
`home`) listens for `hashchange` itself.

---

## Data flow

```
data/*.json
    │  fetch, once per file, promise memoized
    ▼
js/data/catalogue.js ──► js/data/shape.js   (is this file usable?)
    │
    ├──► views/         render a list
    ├──► loadLinkIndex() ──► js/data/links.js  (what leads where?)
    │                              │
    │                              └──► js/ui/doors.js ──► #view/entry-id
    └──► loadReviewPool()
             │
             ▼
        js/study/review.js  ──►  localStorage (bigu:progress)
             │
             ├──► js/ui/quiz.js        ask, grade
             └──► js/study/session.js  log the round
                       │
                       ├──► bigu:practice
                       └──► js/core/bridge.js ──► bigu:bridge
```

**One fetch per file, whoever asks first.** The loaders memoize the
*promise*, not the value. Caching the value only closes the window after
the first fetch resolves, and several surfaces start within a frame of each
other. A failure drops the cache so a retry really does re-fetch.

**Shape is checked at load, not at render.** `data/shape.js` runs once per
file and throws a sentence naming the file and the field, which lands in
the view's ordinary retryable error state. It is deliberately shallow — the
deep check is `tools/validate-data.mjs`, which runs in CI over every field.
Do not move CI's work into the browser.

**The link index is the one loader that never rejects.** A view's own content
failing to load is that view's error state — the reader asked for the word
list, and an empty screen with a retry is the honest answer. A *door* failing
to load is not: the reader asked for a kanji, the kanji is on screen, and the
only thing missing is the row of words underneath it. So `loadLinkIndex()`
resolves to an index that knows nothing, every door row asks it what it holds,
and each of them draws nothing.

**A round is logged in one place.** `study/session.js` writes the practice
record, republishes it as a bridge event under the same id, and redraws the
bridge status. Three surfaces run rounds — Review, a lesson quiz, and
Home — and all three call it, so none of them can log a round differently.

---

## Cross-linking

Bigu's second principle is that every entry leads somewhere. Three things have
to be true for that, and they are in three different layers:

```
data/links.js      what is related to what      (derived, never authored)
core/router.js     how an entry is addressed    (#view/entry-id)
ui/doors.js        what a link looks like       (a row of doors, and arriving)
```

**Nothing in `data/` holds a reference to anything else in `data/`, and nothing
should.** Every relation the principle describes is already present as a shape:
駅 is inside ～駅 because the string contains the character. `data/links.js`
reads those shapes once — every headword in vocabulary and every lesson word,
against the 132 characters kanji.json holds — and answers three questions:

- `kanjiIn(text)` — the kanji entries in a headword, an example sentence, or a
  whole passage. The same question at three scales, which is why it takes text
  rather than an entry.
- `usesOf(character)` — the vocabulary words and the lesson words spelled with
  it, kept apart, because the door to each is labelled differently.
- `lessonOf(wordId)` — the lesson a word was written down in, read from the
  lesson that holds it rather than off the id's prefix.

Deriving rather than authoring is what makes this survivable in a hand-written
catalogue. A word transcribed tonight is linked tonight; a link can never point
at an entry that has since been retired; and nobody has to remember to fill in
a field. It also fixes the scope of what can be claimed: **a link is a
character in a headword that the kanji catalogue has an entry for, and nothing
else.** No guessing and no segmenting — the argument `ichibun.js` makes about
morphological analysis applies with more force here, because a missing link is
a door that was never drawn while a wrong one is a door onto the wrong room,
and the reader cannot tell them apart.

`js/ui/doors.js` draws them. A door is an `<a href>` and not a button, so it
can be copied, opened in a new tab and backed out of; the click handler exists
only for the case the browser cannot help with, a door pointing at where the
reader already is. `createDoorRow` returns **null** when there is nothing to
draw, so every caller reads as `const row = createDoorRow(…); if (row) …` and
"no doors" and "no section" are the same statement. `revealEntry` is the other
end: it scrolls, focuses, and marks the entry for three seconds with a static
outline — static because reset.css collapses animation to 0.01ms under
`prefers-reduced-motion`, so a fading highlight would be invisible to exactly
the readers who need it most.

### Adding a door

1. Ask the index the question — usually `links.kanjiIn(headword)`.
2. Build a `createDoorRow({ label, doors })`, where each door is
   `{ view, target, headword, gloss }`. Append it only if it came back non-null.
3. If the destination view cannot yet reveal an entry, give it an
   `onRouteTarget(VIEW_ID, …)` at the **end** of its render, and make that
   handler undo whatever state is hiding the entry — a filter, a page boundary,
   a collapsed group, a running quiz — but only when that state is actually
   hiding it. A reader who followed a link to something already on screen keeps
   the list they had.
4. Whichever view now needs the index, load it beside its own content:
   `Promise.all([loadX(), loadLinkIndex()])`. It never rejects, so this cannot
   turn a missing kanji.json into that view's error state.

---

## Storage

Everything the reader has is in one browser. There is no account and no
server copy.

- **Namespace.** `bigu:<store>`. Keys written under the retired `nagi:`
  prefix are copied across on first load and the originals are left in
  place — see `migrateLegacyKeys` in `js/core/storage.js`.
- **Every access is guarded.** A browser that refuses to store (private
  mode, blocked site data) turns every read into a fallback and every write
  into `false`, never an exception.
- **Valid JSON is not the right shape.** A key holding `null` or `[]` where
  a map belongs parses fine and then throws on the next line, so reads
  check the kind and fall back.
- **`STORES` is the list.** Adding a store means adding one row there;
  export, validation and restore all walk it. They used to name the stores
  separately and had already drifted.
- **The one exception to "only storage.js knows a key".** The pre-paint
  theme script in `index.html` reads `bigu:settings` directly, because it
  must run synchronously before any module loads. If you change how the
  theme is persisted, change it in both places.

### Persisted shapes are permanent

A progress record is stored with `learned`, not `remembered`, and lesson
words gloss into a field called `english` that holds Mongolian. Both names
are wrong and both are deliberate: they are in every backup file any reader
has ever downloaded, and renaming a persisted field to match a change of
vocabulary in the UI silently drops those readers' progress on restore.
`normalizeRecord` in `js/study/review.js` is where old shapes are read into
current ones.

---

## Installing, and offline

Bigu is a progressive web app, and the reason is the same one behind
everything else here: it is meant to be lived in daily. Daily includes the
days with no signal, and a home-screen icon that opens an error page is
worse than a bookmark.

Three files, and each does a separate job:

```
manifest.json            what the installed app is called, coloured and shaped
sw.js                    what is cached, and what is served when the network is gone
js/core/serviceWorker.js registration, and the update a running app must be offered
js/core/install.js       whether an install can be offered, and the one gesture
```

**Everything is precached, not a fallback page.** `sw.js` lists every
stylesheet, every module and all five content files, and fetches them on
install. Anything less would give a reader an app that opens offline and
then cannot show them a word.

**The list is hand-written, and `tools/check-structure.mjs` keeps it
honest** — both directions, exactly like the stylesheet run in
`index.html`. A path with no file fails `cache.addAll`, which fails the
install, which means no offline app at all and no error where anyone would
see it; a file with no entry is one blank view on the underground. Adding a
module, a stylesheet or a content file means adding a line to `SHELL`.

**Every response is stale-while-revalidate, and the cache is not versioned
per deploy.** There is no build step, so no filename ever carries a hash and
there is nothing to bump automatically — and a version constant somebody has
to remember to bump ships stale within a month. So the cached copy is served
immediately and refetched behind it: a deploy lands on the reader's *next*
open. `CACHE_VERSION` in `sw.js` describes that strategy, not the content;
bump it when what is cached or how it is matched changes.

**The update flow exists because an installed app never reloads.** A tab
picks up a deploy by being reopened. A home-screen app is resumed rather
than opened and its hash router never navigates, so a new build could sit in
the cache unused indefinitely. `js/core/serviceWorker.js` reports a waiting
worker, `js/ui/updateBanner.js` offers it, and the swap happens on a press —
never underneath a reader mid-round.

**`controllerchange` fires for two different reasons and only one of them is
an update.** The other is `clients.claim()` on a first visit, and reloading
on that one means every reader's first visit silently reloads itself. The
guard is that the reload only happens when `applyUpdate()` asked for it.

**Whether an install can be offered is the browser's answer, not ours.**
Chromium fires `beforeinstallprompt`, which `js/core/install.js` catches *at
boot* — it fires once, early, and a listener bound when the Settings view
first renders would miss it on most visits. Safari has never implemented it
and never says whether a site is installable, so iOS gets the three taps
written out instead of a button. Both live in the Install card in Settings.

**Only `test/browser/offline.test.mjs` can see any of this work.** The
scope, the navigation fallback and a rejected `addAll` all look identical to
a working app right up until the network goes away, which is the moment
nobody is testing.

---

## Content

Five hand-written files in `data/`, each with a schema beside it in
`data/schema/`. Four are `{ updatedAt, <collection>: [...] }`; `lessons.json`
is a bare array, because a lesson is a place in the textbook rather than a
studiable item and carries no id.

**An id is a database key.** It is what every progress and favourite record
in localStorage is written under, so:

- it must be unique across the *whole* catalogue, not within its file — two
  entries sharing an id share a study history;
- it must be routable by `deckKeyForItemId` in `js/study/decks.js`, or the
  entry is content no round will ever ask about, silently and forever;
- it never changes once written, even when the entry's level does. The
  prefix in an id is history, not a level. Read the entry's own `level`.

Both rules are enforced by `tools/validate-data.mjs`.

**Absence is a normal state.** A lesson with no title and no words is one
not yet written down. An entry with no JLPT tag is Japanese the exam has no
opinion about. Neither is an error, and the schemas say so.

---

## Verifying a change

Four commands, cheapest first. CI runs all four on every push and pull
request (`.github/workflows/check.yml`).

```
node tools/check-structure.mjs        # parses, imports, exports, sheets, colours, precache
node tools/validate-data.mjs          # every content file, every id
node --test "test/*.test.mjs"         # the logic suite, no browser needed
node --test "test/browser/*.test.mjs" # thirteen views in real Chromium, and the app offline
```

The last needs a browser and **skips** without one:

```
npm install --no-save playwright-core
npx playwright install chromium
```

`--no-save` and the absence of a `package.json` are the point. The app has
no dependencies; the browser harness is a test tool and nothing in `js/`
may ever import it.

### What each check is actually for

- **structure** — the failure the missing build step creates. A moved
  module, a renamed export, an unlinked stylesheet, a layer reaching
  upward, an import cycle, a theme colour that no longer matches
  `--color-paper`, a file `sw.js` forgot to precache or precaches without
  it existing.
- **content** — the failure hand-authoring creates. It found nothing on the
  day it was written and will find something on some later day; that is
  what it is for.
- **logic** — the failure that does not throw. The review ladder schedules
  something wrong and nobody finds out for a month, so every function there
  takes `now` and is checked exactly. The same argument covers the link index:
  a wrong link draws a door the reader will believe, because the app has no
  other opinion to offer them.
- **browser** — the failure nothing else can see. Thirteen views, each must
  open, render something, and log nothing — and, in the second file, an
  installed app that still opens with the network switched off.

Run the app the way the README says (`python3 -m http.server 8000`) for
anything visual. `fetch` will not work off the filesystem.

---

## Adding things

**A view.** Add a `<section id="x" class="view" hidden aria-labelledby="x-heading">`
to `index.html` with an `<h1 id="x-heading">`, a module at `js/views/x.js`
exporting `initX()`, a row in `VIEW_INITIALIZERS` in `js/app.js`, a
stylesheet at the end of the `<link>` run, both new files in `SHELL` in
`sw.js`, and `'x'` in the `VIEWS` list in `test/browser/smoke.test.mjs`. The
router needs nothing.

**A content file.** Add the JSON, a schema beside it in `data/schema/`, a
loader in `js/data/catalogue.js` with a shape guard, an entry in `FILES` in
`tools/validate-data.mjs`, and a line in `CONTENT` in `sw.js` so it is on
the device before the reader needs it. If its entries are studiable, they
need an id prefix `deckKeyForItemId` recognises and a deck in
`js/study/decks.js`. If its entries are spelled with kanji, add them to
`buildLinkIndex` in `js/data/links.js` — an entry outside the index is an
entry no door can reach.

**A door.** See *Cross-linking* above; it is four steps and none of them is in
`data/`.

**A store.** One row in `STORES` in `js/core/storage.js` — `required: false`,
because every backup already on a reader's disk predates it. Add its name
to `STORE_NAMES` too, so a legacy key would be carried across. Export,
validation and restore all walk `STORES`, so there is nothing else to
update.
