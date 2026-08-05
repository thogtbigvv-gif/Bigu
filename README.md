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
- Favorites

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

### 📊 Dashboard

- What's due today, and one button to start it
- Study streak — counts reviewing, marking a word learned, or writing a
  journal entry, not just one of the three
- Learned/total progress per deck
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
