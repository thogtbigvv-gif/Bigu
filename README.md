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
should lead somewhere else. A word should reach its kanji; a kanji should
reach the words that use it; a sentence should be something you can bring in
from outside and keep.

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

Every word should reach the kanji inside it. Every kanji should reach the words
that use it, and the lesson it belongs to. Every reading passage should open
into the entries for what's in it. Every grammar pattern should reach a real
sentence that uses it.

*This is the current focus of development and is not finished — see
[Status](#status).*

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
1–25 are populated; 26–50 are being filled in by hand as they are studied.
This is the honest measure of "where I am".

**JLPT level is a tag.** Useful for filtering when you want to drill a band,
invisible when you don't. Present throughout the kanji catalogue; being filled
in for vocabulary and grammar over time. An entry with no level assigned is
shown as unlabelled rather than guessed at.

Neither axis produces a percentage, a completion state, or a target.

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
detail panel per character.

**📚 Lessons** — The textbook spine. Each lesson holds its own word list. A
lesson not yet written down simply appears without content — a normal state,
not a gap to be filled under pressure.

### Immerse

**📚 Reading** — Passages with per-sentence readings and a translation view
beside the article view. Includes 縦書き, a per-session vertical writing mode,
because that is how the language is actually set on a page — the measure and
leading are tuned for extended reading rather than for scanning a UI.

**一文 Sentence capture** — Paste any Japanese you meet outside the app. It is
broken into characters, each one tappable to look up against the kanji
catalogue, and a sentence can be kept. This is the door that lets the wild
language in.

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
you don't. Sessions draw from what's actually due, oldest first. Self-graded:
reveal, then "I knew it" or "Still learning". Round length is yours.

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

**⚙️ Settings** — Appearance (system, light, dark), cards per round, backup and
restore as JSON, and start over.

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

No frameworks, no build step, no dependencies. Styles are split into modules
under `css/`, with every colour, size and spacing value declared once in
`css/variables.css`. Keeping it this light is what makes it possible to change
the whole app's character by editing one file.

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

The PNGs in `icons/` are rendered from `icons/icon.svg`:

```
pip install cairosvg && python3 tools/build-icons.py
```

---

## Status

🚧 Active development. Honest about what isn't done:

**In progress**
- **Cross-linking** — the layer that turns entries into doors. Currently the
  only navigation between views is view-level; no entry links to another entry.
  This is the highest-priority work.
- **Lessons 26–50** — the spine exists; the content is being written by hand.
- **Level tags for vocabulary and grammar** — present for kanji, absent
  elsewhere. Being filled in rather than guessed.

**Unresolved**
- Several placeholder stages remain in Reading and Kanji. Each will either be
  built or removed — a door that doesn't open is worse than no door.
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
