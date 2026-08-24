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
| `core/` | storage, router, theme, preferences, bridge, backup | `core` |
| `data/` | the catalogue loaders, the shape guards | `core`, `data`, `study` |
| `study/` | the review model, streak, decks, favorites, session | `core`, `data`, `study` |
| `ui/` | shared widgets: content, quiz, nav, keyboard, favoriteButton | `core`, `data`, `study`, `ui` |
| `views/` | the thirteen screens | anything |

`data/` and `study/` may each import the other — the one bidirectional pair,
and deliberate: the catalogue asks `study/decks.js` which items are studiable,
and `study/session.js` asks the catalogue for the pool it counts over. No
module imports another one back, so there is no cycle.

**`core/`** is the machinery with no opinion about Japanese. `storage.js`
is the only module that knows a localStorage key by name (with one
deliberate exception — see *Storage* below). `bridge.js` writes to an
outside contract and is never read back.

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

**A round is logged in one place.** `study/session.js` writes the practice
record, republishes it as a bridge event under the same id, and redraws the
bridge status. Three surfaces run rounds — Review, a lesson quiz, and
Home — and all three call it, so none of them can log a round differently.

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
node tools/check-structure.mjs        # parses, imports, exports, sheets, colours
node tools/validate-data.mjs          # every content file, every id
node --test "test/*.test.mjs"         # the logic suite, no browser needed
node --test "test/browser/*.test.mjs" # thirteen views in real Chromium
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
  `--color-paper`.
- **content** — the failure hand-authoring creates. It found nothing on the
  day it was written and will find something on some later day; that is
  what it is for.
- **logic** — the failure that does not throw. The review ladder schedules
  something wrong and nobody finds out for a month, so every function there
  takes `now` and is checked exactly.
- **browser** — the failure nothing else can see. Thirteen views, each must
  open, render something, and log nothing.

Run the app the way the README says (`python3 -m http.server 8000`) for
anything visual. `fetch` will not work off the filesystem.

---

## Adding things

**A view.** Add a `<section id="x" class="view" hidden aria-labelledby="x-heading">`
to `index.html` with an `<h1 id="x-heading">`, a module at `js/views/x.js`
exporting `initX()`, a row in `VIEW_INITIALIZERS` in `js/app.js`, a
stylesheet at the end of the `<link>` run, and `'x'` in the `VIEWS` list in
`test/browser/smoke.test.mjs`. The router needs nothing.

**A content file.** Add the JSON, a schema beside it in `data/schema/`, a
loader in `js/data/catalogue.js` with a shape guard, and an entry in
`FILES` in `tools/validate-data.mjs`. If its entries are studiable, they
need an id prefix `deckKeyForItemId` recognises and a deck in
`js/study/decks.js`.

**A store.** One row in `STORES` in `js/core/storage.js` — `required: false`,
because every backup already on a reader's disk predates it. Add its name
to `STORE_NAMES` too, so a legacy key would be carried across. Export,
validation and restore all walk `STORES`, so there is nothing else to
update.
