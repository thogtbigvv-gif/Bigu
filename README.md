# Bigu 🇯🇵

> A modern Japanese learning platform built around clarity, consistency, and real progress.

## Why Bigu?

Learning Japanese is difficult enough.

Many learning platforms try to solve that by adding more content, more features, more statistics, and more distractions. Over time, studying becomes less about understanding the language and more about navigating the platform.

Bigu was created with a different philosophy.

Every feature should have a clear purpose.
Every page should reduce friction.
Every improvement should help learners spend more time learning and less time searching.

The goal isn't to build the biggest Japanese learning platform.

The goal is to build one that simply feels better to use.

---

## Philosophy

Instead of asking:

> "What else can we add?"

Bigu asks:

> "What can we remove to make learning easier?"

That philosophy influences every design and development decision.

- Clean interface
- Fast navigation
- Focused study experience
- No unnecessary complexity
- Built for long-term learning

---

## Features

### 📖 Vocabulary

- JLPT-organized vocabulary
- Word meanings
- Readings
- Example sentences
- Search and filtering
- Keep a word (bookmark) — kept words get their own shelf in Memory

### 📝 Grammar

- JLPT grammar lessons
- Clear explanations
- Usage examples
- Common mistakes
- Practice exercises

### 漢字 Kanji

- Stroke order
- Onyomi & Kunyomi
- Meanings
- Example vocabulary
- JLPT organization

### 📚 Reading

- Reading passages
- Vocabulary support
- Grammar references
- Progressive difficulty

### 🎯 Review

- Spaced repetition — every item you grade gets a due date, and the ladder
  widens (1 → 3 → 7 → 14 → 30 days) each time you recall it, narrowing again
  when you don't
- Sessions drawn from what's actually due, oldest first, topped up with items
  you haven't started
- One deck per content type, plus "Due today" across all of them
- Self-graded: reveal, then "I knew it" or "Still learning"

### 🖌 Memory

There is no "learned" in Bigu. A word is never finished — it is written in
ink, and ink fades.

- **Memory strength** — a continuous estimate of how much of each word you
  still hold, halving over that word's own review interval. Drawn as a brush
  stroke that shortens and pales as the memory does
- **Shelves instead of a list** — Waiting for you, Fading, Newly met, Hard to
  hold, Kept, Deep ink. Each one is a state of memory, not a category of
  content, and each is capped so no shelf becomes a wall
- **Review in place** — turn a slip over, answer, watch the ink darken. No
  session to start or finish
- **This week** — seven marks, one per day, and your review streak
- Every shelf is derived from the schedule except Kept, which is yours

### 📊 Dashboard

- What's due today, and one button to start it
- Study streak — counts reviewing, taking a word into memory, or writing a
  journal entry, not just one of the three
- How much of what you hold has gone faint, and a door into Memory
- Your last review session at a glance

---

## Tech Stack

- HTML5
- CSS3
- JavaScript
- JSON
- Responsive Design

No frameworks.

Keeping the project lightweight makes it easier to understand, maintain, and improve.

---

## Running locally

Bigu loads its content with `fetch()`, which browsers block for pages opened
straight off the filesystem — so opening `index.html` by double-clicking it
shows an error on every view. Serve the folder over HTTP instead:

```
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Any static server works; there is nothing
to build and no dependencies to install.

Your progress lives in this browser's `localStorage` and never leaves the
device. **Settings → Backup** downloads all of it as a JSON file, and restores
from one.

### Deployment

`main` publishes to <https://thogtbigvv-gif.github.io/Bigu/> through
`.github/workflows/deploy.yml` — the repository is uploaded as-is and handed
to GitHub Pages. There is no build step, because there is nothing to build.

This depends on one repository setting: **Settings → Pages → Source** must be
**GitHub Actions**. If it is set to "Deploy from a branch" instead, GitHub runs
its own Jekyll workflow and this one fails, because two workflows cannot both
own the same Pages site.

The deploy step waits up to 30 minutes rather than the action's default 10.
That is not because deploying is slow — it normally takes seconds — but
because GitHub's Pages queue occasionally stalls, and a queued deployment
should mean a slow release, not a failed one. A stalled run can also be
retried from the Actions tab (`Deploy to GitHub Pages` → `Run workflow`)
without pushing an empty commit.

### Regenerating the app icons

The PNGs in `icons/` are rendered from `icons/icon.svg`. If you edit the SVG:

```
pip install cairosvg && python3 tools/build-icons.py
```

---

## Project Status

🚧 Active Development

Bigu is continuously evolving.

New lessons, learning tools, interface improvements, and study systems are added over time as the project grows.

---

## Vision

This project isn't trying to replace every Japanese learning platform.

Instead, it aims to become a place where studying feels simple, focused, and enjoyable.

A platform that learners actually want to come back to every day.

---

## Contributing

Suggestions, ideas, bug reports, and feedback are always welcome.

Every contribution helps make Bigu better.

---

## License

MIT License
