# Bigu 🇯🇵

> An environment for learning Japanese — read it, study it, look things up,
> write it by hand, and keep what you meet. One place, built to be lived in.

Bigu is a personal Japanese learning environment. Not a course, not a quiz
app, not a dictionary — an environment, meaning a place with enough in it that
you can arrive without a plan and still find something to do.

It is built around one learner's actual study: a paper textbook worked through
in order, JLPT preparation running alongside it, and everything else Japanese
that turns up in between — a line from a drama, a sentence from a game, a word
seen in the wild.

---

## What Bigu is for

**Learning the language, from the foundation upward.** Not one slice of it
aimed at one date on a calendar, but not a shapeless pile either. There is an
order to walk, and Bigu knows where you are in it.

**Preparing for the JLPT, without being only that.** The levels are a real
ladder here — a way to see what a band contains and to work through it. They
are one axis, not the purpose. Material the exam has no opinion about keeps
its place instead of being squeezed into a level it never had.

**Meeting Japanese, not just filing it.** Anything you read, write, or look up
leads somewhere else. A word reaches its kanji; a kanji reaches the words that
use it; a sentence is something you can bring in from outside and keep.

---

## Principles

### 1. Structure is not pressure

These two get confused, and the difference decides how the app feels.

**Pressure** is guilt: a broken streak, a red badge, a count of what you
haven't done, an app deciding you are behind. Bigu doesn't do this. Nothing
here tells you to come back, and nothing punishes you for not having.

**Structure** is a path: levels, lesson order, knowing what comes next, being
able to see the shape of what you're learning. Bigu does do this, deliberately.
An environment without structure isn't calm — it's just empty.

The rule: Bigu always shows you where you are and what is nearby. It never
tells you where you should be.

### 2. Everything is a door

An entry that leads nowhere is a page in a book. An entry that leads somewhere
is an environment.

Every word reaches the kanji inside it. Every kanji reaches the words that use
it and the lessons it turns up in. Every reading passage opens into the entries
for what's in it. A character pasted in from outside reaches its full entry and
everything already studied that is spelled with it.

None of that is written down anywhere. Not one entry in `data/` holds a
reference to another: the links are read off the headwords, so a word
transcribed tonight is linked tonight, and a link can never point at an entry
that has since been retired. What the app cannot explain it does not offer — a
door that doesn't open is worse than no door.

### 3. You should be able to make something, not only read something

Most learning apps are entirely consumption: look, tap, grade, repeat. Bigu
tries to give the language somewhere to come out — a surface to write kanji
by hand, a place to paste in a sentence you met somewhere else, a journal.

### 4. Nothing is ever finished

There is no "learned" in Bigu. A word is written in ink, and ink fades. What
you hold is a continuous quantity, not a checkbox — which is why Memory has
shelves rather than a completed list.

---

## How progression works

Two axes, and they do different jobs.

**Lesson is the spine.** The catalogue follows みんなの日本語 lesson order,
because that is the order the learner actually meets the language in. Lessons
1–15 are populated; 16–50 are being filled in by hand as they are studied.
This is the honest measure of "where I am".

**JLPT level is a tag.** Useful for filtering when you want to drill a band,
invisible when you don't. Present throughout the kanji catalogue; being filled
in for vocabulary and grammar over time. An entry with no level assigned is
shown as unlabelled rather than guessed at.

Neither axis produces a percentage, a completion state, or a target.

**And an entry has an address.** `#kanji/kj-n5-001` is one character;
`#vocabulary/n5-001` is one word. Every link between entries is one of these,
so following one is real navigation — it can be bookmarked, opened in a new
tab, and backed out of with the browser's own Back button.

---

## Features

### Learn

**📖 Vocabulary** — Meanings, readings, and an example sentence per entry.
Search, plus level and topic filters read out of the data, so a chip only
appears when there are words behind it. Rendered a page at a time; eight
hundred cards at once is a wall, not a list. Keep a word to give it a shelf in
Memory.

**📝 Grammar** — Pattern, meaning, formation, and a worked example, with usage
notes where a pattern needs one.

**漢字 Kanji** — Meanings, on'yomi and kun'yomi, example vocabulary, and a
detail panel per character — which is also where a character shows what it is
part of: every word in the catalogue spelled with it, every lesson it appears
in, and the related characters beside it. This is the half of the linking only
a kanji screen can offer, since a character has no way of knowing what uses it
without asking the whole catalogue.

**📚 Lessons** — The textbook spine. Each lesson holds its own word list. A
lesson not yet written down simply appears without content — a normal state,
not a gap to be filled under pressure.

### Immerse

**📚 Reading** — Passages with per-sentence readings, a translation view beside
the article view, and a third view listing the kanji in the passage — each one
a way into its own entry. Includes 縦書き, a per-session vertical writing mode,
because that is how the language is actually set on a page — the measure and
leading are tuned for extended reading rather than for scanning a UI.

**一文 Sentence capture** — Paste any Japanese you meet outside the app. It is
broken into characters, each one tappable to look up against the kanji
catalogue, and a sentence can be kept. A character the catalogue holds leads on
to its full entry and to the words already studied that use it, so a line from a
drama arrives as a stranger and leaves attached to everything else. This is the
door that lets the wild language in.

### Produce

**🖌 書き取り Writing** — A canvas for writing kanji by hand, prompted by
reading and meaning with the character hidden. Undo, clear, reveal, next. It
does not grade you, because there is no stroke data to grade against and
because being graded on handwriting is not the point. You compare, and you
decide.

**📓 Journal** — Somewhere to use what you have, in your own sentences.

### Remember

**🎯 Review** — Spaced repetition. Every graded item gets a due date, and the
interval widens (1 → 3 → 7 → 14 → 30 days) as you recall it, narrowing when
you don't. Sessions draw from what's actually due, oldest first. Round length
is yours, and so is how you're asked:

- **Choose** — four answers, checked for you. It varies what it asks, too: a
  word is a shape, a reading, a meaning and a place in a sentence, and the
  question you get depends on how well the schedule says you already hold it.
- **Flip** — the classic flashcard. Recall it, reveal, then say whether you
  knew it.
- **Build** — the answer arrives in pieces, in the wrong order, and putting it
  back is the question. A sentence is cut at the spaces its example is already
  written with; a word is cut into characters. The other two modes can be
  answered without ever producing a word — this one asks you to spell it.

**🖌 Memory** — What the studying leaves behind. Memory strength is a
continuous estimate of how much of a word you still hold, halving over that
word's own interval, drawn as a brush stroke that shortens and pales. Instead
of a list there are shelves — Waiting for you, Fading, Newly met, Hard to
hold, Kept, Deep ink — each a state of memory rather than a category of
content. Turn a slip over and answer in place; there is no session to start or
finish.

### Throughout

**⌨️ Keyboard** — Search focus, list navigation, dismissal, and grading are all
reachable from the keyboard, with a shortcut list available in-app. An
environment you can move through quickly is a more comfortable one.

**📲 Install** — Bigu is a progressive web app: added to a phone's home screen
it opens in one tap, fills the screen with no browser chrome, and works with
the network off. The whole app — every screen, every word, kanji and lesson —
is cached on the device, so a train with no signal is a normal place to study.
**Settings → Install** does it on Android and desktop, and writes out the three
taps on iOS.

**⚙️ Settings** — Appearance (system, light, dark), cards per round, installing
to the home screen, backup and restore as JSON, and start over.

---

## Design

The visual language comes from the content, not from ornament. No ensō, no
torii, no cherry blossoms, no brush-stroke decoration — the kanji themselves
are the graphic material, set large enough to be looked at rather than
scanned.

- **Ground** — near-white paper, true sumi ink, hairline rules
- **Accent** — 朱色, one signature red, reserved for where you are and for
  genuine errors. Absence and incompleteness are neutral, never warned about
- **Type** — Klee One, a Japanese textbook hand, for Japanese content; Zen
  Kaku Gothic New for interface copy; JetBrains Mono for data
- **Scale** — a wide range, so that the one thing a screen is about can be
  much larger than everything around it
- **Motion** — short, and honouring `prefers-reduced-motion`

Accessibility is part of the design rather than a pass over it: skip link,
semantic landmarks, real buttons, `aria-expanded` / `aria-controls` /
`aria-pressed`, visible focus, and touch targets sized for a phone.

---

## Tech Stack

HTML5 · CSS3 · JavaScript (native ES modules) · JSON

No frameworks, no build step, no dependencies. What the browser is served is
what is in the repository.

Styles are split into modules under `css/`, with every colour, size and
spacing value declared once in `css/variables.css` — keeping it this light is
what makes it possible to change the whole app's character by editing one
file. Scripts are split into five layers under `js/`, with the dependency
arrow running one way:

```
js/core/     storage, router, theme, preferences, bridge, backup, install
js/data/     the catalogue loaders, the shape guards, the link index
js/study/    the review model, streak, decks, session
js/ui/       shared widgets — content, quiz, nav, keyboard, doors, first run
js/views/    the thirteen screens
```

`sw.js` sits at the repository root rather than in `js/`, because a service
worker can only control pages at or below its own URL. With `manifest.json` it
is what makes Bigu installable and what serves the app offline.

Nothing below `views/` imports from `views/`. **[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)**
is the full account: the layers and why the arrow runs that way, how data
flows from a JSON file to a graded card, what is permanent about the stored
shapes, and what to do when adding a view, a content file or a store.

One thing Bigu writes is not for Bigu. `js/core/bridge.js` publishes what
the reader has been studying — what is due, when they last studied, the
rounds they have finished — to a single `bigu:bridge` key, for the separate
summer-project surface served from the same origin to read. It is one-way
and it is a copy: nothing in Bigu reads it back, nothing here behaves
differently because of it, and it invents no score, level or XP of its own.
Its shape is a contract with something outside this repository, so it is
versioned and never changed in place. **[docs/BRIDGE.md](docs/BRIDGE.md)**
is that contract, written for the reader on the other side.

---

## Running locally

Bigu loads its content with `fetch()`, which browsers block for pages opened
straight off the filesystem — so double-clicking `index.html` shows an error on
every view. Serve the folder over HTTP instead:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works; there is nothing to
build and no dependencies to install.

Your progress lives in this browser's `localStorage` and never leaves the
device. **Settings → Backup** downloads all of it as JSON and restores from it.
If the browser won't allow storage at all — private browsing, or site data
blocked — the app says so rather than silently forgetting everything.

### Installing it on a phone

Open the site in a phone browser and add it to the home screen — **Settings →
Install** inside Bigu offers the button where the browser supports one
(Android, Chromium desktop) and writes out the share-sheet steps on iOS, where
Safari has no install event to offer.

Installed, Bigu runs from its own cache: `sw.js` precaches every stylesheet,
module and content file the first time it is opened, so it starts with no
network at all. Updates arrive quietly — each file is served from the cache and
refetched behind it, so a deploy lands on the next open — and an installed app
that is resumed rather than reopened is offered a *Шинэчлэх* banner when a new
version has finished downloading.

Service workers need a secure context, so this works on the deployed site and
on `localhost` (browsers treat it as secure) but not over a plain-HTTP LAN
address.

### Checks

Four, cheapest first. CI runs all of them on every push and pull request; the
first three need nothing but Node.

```
node tools/check-structure.mjs         # modules parse, imports, exports and the offline cache resolve
node tools/validate-data.mjs           # every content file against its schema
node --test "test/*.test.mjs"          # the study model, storage, links, routes, backup
node --test "test/browser/*.test.mjs"  # the app itself, in real Chromium — including with the network off
```

The last one needs a browser and skips without one:

```
npm install --no-save playwright-core && npx playwright install chromium
```

`--no-save`, and there is no `package.json`: the app has no dependencies and
the browser harness is a test tool, not one of them.

Since the app has no build step, the first check is the one doing the work a
compiler would otherwise do — a wrong import path or a renamed export is
nothing at all until a reader opens the view that needs it.

### Deployment

`main` publishes to <https://thogtbigvv-gif.github.io/Bigu/> through
`.github/workflows/deploy.yml`. The repository is uploaded as-is and handed to
GitHub Pages; there is no build step.

This depends on one repository setting: **Settings → Pages → Source** must be
**GitHub Actions**. Set to "Deploy from a branch" instead, GitHub runs its own
Jekyll workflow and this one fails, because two workflows cannot both own the
same Pages site.

The deploy step waits up to 30 minutes rather than the action's default 10 —
not because deploying is slow, but because GitHub's Pages queue occasionally
stalls, and a queued deployment should mean a slow release rather than a failed
one. A stalled run can be retried from the Actions tab without pushing an empty
commit.

### Regenerating the app icons

The PNGs in `icons/` are rendered from `icons/icon.svg` — the touch icon, the
two manifest sizes, and two maskable copies inset for Android's launcher
masks:

```
pip install cairosvg && python3 tools/build-icons.py
```

---

## Status

🚧 Active development. Honest about what isn't done:

**Done, and the shape it took**
- **Cross-linking** — entries have addresses (`#kanji/kj-n5-001`) and the links
  between them are derived from the headwords rather than authored. Words reach
  their kanji; a kanji reaches its words, its lessons and its related
  characters; a passage reaches the kanji in it; a pasted character reaches all
  of it. `docs/ARCHITECTURE.md` has the account.

**In progress**
- **Lessons 16–50** — the spine exists; the content is being written by hand.
  Each lesson written is also, now, a lesson linked.
- **Level tags for vocabulary and grammar** — present for kanji, absent
  elsewhere. Being filled in rather than guessed.

**Unresolved**
- Linking is character-level, because that is what can be derived honestly. A
  word does not yet reach a *grammar pattern* it demonstrates, and a passage
  does not reach the vocabulary entries for the words in it — both need
  segmentation, which needs a tokenizer this app does not have.
- Stroke order and stroke animation need per-character data the catalogue
  doesn't have.

**Not planned**
- A daily assigned path, a "today's tasks" screen, or anything that decides on
  your behalf what you should study. Bigu shows you what's here. You choose.

---

## A note on content

The catalogue is written by hand. Textbook material is studied from the
textbook and processed here in the learner's own words and own example
sentences — no publisher's text is reproduced in this repository.

---

## License

MIT License
