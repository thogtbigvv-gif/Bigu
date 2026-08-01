# Bigu (ビグ)

A calm, minimal personal study companion for JLPT N2 — vocabulary, grammar,
kanji, lesson reference, spaced practice, and a study journal. Vanilla
HTML/CSS/JS (ES modules), no build step, no frameworks.

## Running locally

The app loads its data with `fetch()`, which browsers block against
`file://` pages, so it needs to be served over HTTP:

```bash
python -m http.server 8000
# or
npx serve
```

Then open `http://localhost:8000`.

## Structure

- `index.html` — single-page shell; view sections are shown/hidden by `js/router.js`
- `js/` — one module per feature (`vocabulary.js`, `grammar.js`, `kanji.js`, `practice.js`, `journal.js`, `lessons.js`, `dashboard.js`), plus `storage.js` (localStorage wrapper), `theme.js`, `router.js`
- `css/` — one stylesheet per feature/component, imported through `css/main.css`; design tokens live in `css/variables.css`
- `data/` — static JSON content (vocabulary, grammar, kanji, lessons)

Progress and journal entries are stored in the browser's `localStorage`
under the `nagi:` key prefix — nothing leaves the device.
