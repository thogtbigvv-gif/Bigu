# Bigu (ビグ)

A calm, minimal, data-driven JLPT learning platform built with Vanilla HTML, CSS, and JavaScript.

Bigu is designed to help learners master Japanese through structured lessons, vocabulary, grammar, kanji, reading practice, listening, and spaced repetition while keeping everything lightweight and completely offline.

No frameworks.
No build tools.
No backend required.

---

# Features

## Dashboard

- Daily study overview
- Study streak
- XP & progress
- Daily goals
- Continue learning
- Weak points
- Recent activity

---

## Study

### Vocabulary

- JLPT N5 → N1
- Business
- Daily Life
- Travel
- News
- Anime

Each vocabulary entry contains:

- Reading
- Meaning
- English
- Example sentence
- Translation
- Audio
- Related words
- Tags
- Difficulty
- Bookmark

---

### Grammar

Each grammar point includes:

- Meaning
- Structure
- Usage
- Common situations
- Difference from similar grammar
- Example sentences
- Common mistakes
- Quiz

---

### Kanji

Each kanji includes:

- Meaning
- Onyomi
- Kunyomi
- Stroke order
- Example vocabulary
- Related kanji
- JLPT level

---

### Reading

Each lesson contains:

- Reading passage
- Vocabulary list
- Grammar used
- Translation
- Questions
- Shadowing audio

---

### Listening (Planned)

- Native audio
- Adjustable speed
- Transcript
- Translation
- Listening quiz

---

## Practice

Multiple practice modes:

- Multiple Choice
- Fill in the Blank
- Typing
- Matching
- Sentence Ordering
- Listening Quiz
- Flashcards

---

## Review

Spaced repetition inspired by Anki.

Cards are scheduled based on learning history.

Buttons:

- Again
- Hard
- Good
- Easy

---

## Journal

Personal study journal stored locally.

Supports:

- Daily notes
- Goals
- Reflection
- Progress log

---

## Statistics

Track learning progress:

- Words learned
- Grammar completed
- Kanji learned
- Accuracy
- Study time
- Streak
- Monthly calendar

---

# Project Structure

```
index.html

css/
    main.css
    variables.css
    dashboard.css
    vocabulary.css
    grammar.css
    kanji.css
    reading.css
    lessons.css
    practice.css
    journal.css

js/
    app.js
    router.js
    storage.js
    dashboard.js
    vocabulary.js
    grammar.js
    kanji.js
    reading.js
    listening.js
    lessons.js
    practice.js
    review.js
    journal.js
    search.js
    statistics.js
    achievements.js
    theme.js

data/
    vocabulary/
    grammar/
    kanji/
    reading/
    listening/
    quizzes/
    lessons/
```

---

# Content Architecture

Bigu follows a **data-driven architecture**.

The application logic never depends on a specific textbook.

Instead, every textbook is converted into structured JSON files.

```
Textbook (PDF)

        ↓

Content Extraction

        ↓

JSON

        ↓

data/

        ├── vocabulary
        ├── grammar
        ├── kanji
        ├── reading
        ├── listening
        └── quizzes

        ↓

Application UI
```

Adding a new textbook only requires adding new JSON files.

No application code should need modification.

---

# Local Storage

Everything is stored locally.

```
nagi:

progress

review

journal

bookmarks

settings

statistics

achievements
```

No user data leaves the device.

---

# Design Principles

- Calm UI
- Minimal design
- Fast loading
- Offline-first
- Mobile-first
- Accessible
- Modular
- Easily expandable

---

# Future Roadmap

## Phase 1

- Dashboard
- Vocabulary
- Grammar
- Search

## Phase 2

- Reading
- Kanji improvements
- Practice modes

## Phase 3

- Spaced repetition
- Statistics
- Achievements

## Phase 4

- Listening
- Shadowing
- AI explanations
- Offline content packages

---

# Running locally

Because the app loads JSON using fetch(), it must be served over HTTP.

```bash
python -m http.server 8000

# or

npx serve
```

Open:

http://localhost:8000

---

# Philosophy

Bigu is not just another JLPT word list.

It is designed to become a complete Japanese learning companion that combines structured lessons, spaced repetition, reference materials, and personal study tracking in one lightweight offline application.
