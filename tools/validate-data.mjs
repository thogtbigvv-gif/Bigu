#!/usr/bin/env node
/* ==========================================================================
   tools/validate-data.mjs
   Checks every content file in data/ against its schema, then against the
   things a schema cannot express.

   The catalogue is written by hand — that is the point of this project, and
   it is also why a missing `example`, a tag outside the enum or a
   copy-pasted id is a normal Tuesday. data/schema/ has always described all
   of that precisely and enforced none of it: the schemas were read by people
   and by nothing else, so the first thing to notice a mistake was a reader
   opening the view, in production, on GitHub Pages.

   Two passes, because they catch different mistakes:

     per file    the schema. Required fields, types, enums, date formats.

     across      the invariants that live between files. An id must be
     files       unique across the *whole* catalogue, because ids are
                 localStorage keys and two entries sharing one share a
                 memory. An id must also be routable by study/decks.js, or
                 the entry is content no round can ever ask about — which
                 fails silently and forever.

   Zero dependencies, like everything else here.

     node tools/validate-data.mjs
   ========================================================================== */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validate } from './lib/jsonschema.mjs';
import { deckKeyForItemId } from '../js/study/decks.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Each file, the schema that describes it, and where its studiable entries
   live. `collect` returns [id, label] pairs for the cross-file pass; a file
   whose entries are not studiable returns none. */
const FILES = [
  {
    name: 'vocabulary',
    collect: (data) => data.words.map((word, i) => [word.id, `words[${i}]`]),
    deck: 'vocabulary',
  },
  {
    name: 'grammar',
    collect: (data) => data.points.map((point, i) => [point.id, `points[${i}]`]),
    deck: 'grammar',
  },
  {
    name: 'kanji',
    collect: (data) => data.kanji.map((entry, i) => [entry.id, `kanji[${i}]`]),
    deck: 'kanji',
  },
  {
    name: 'lessons',
    collect: (data) => data.flatMap((lesson) =>
      lesson.words.map((word, i) => [word.id, `lesson ${lesson.lesson} words[${i}]`])),
    deck: 'lessons',
  },
  {
    name: 'reading',
    // A passage is something you read, not something the schedule can ask a
    // question about, so its ids are checked for uniqueness but not for a
    // deck — see the note on deckKeyForItemId.
    collect: (data) => data.passages.map((passage, i) => [passage.id, `passages[${i}]`]),
    deck: null,
  },
];

const problems = [];
const note = (file, message) => problems.push(`${file}: ${message}`);

async function readJSON(file) {
  const text = await readFile(path.join(ROOT, file), 'utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    note(file, `is not valid JSON — ${error.message}`);
    return null;
  }
}

/* -- Per file -------------------------------------------------------------- */

const loaded = new Map();

for (const spec of FILES) {
  const dataFile = `data/${spec.name}.json`;
  const schemaFile = `data/schema/${spec.name}.schema.json`;

  const [data, schema] = await Promise.all([readJSON(dataFile), readJSON(schemaFile)]);
  if (!data || !schema) continue;

  for (const error of validate(data, schema)) note(dataFile, error);
  loaded.set(spec, data);
}

/* -- Across files ---------------------------------------------------------- */

/* An id is the key every progress and favourite record in localStorage is
   written under. Two entries sharing one share a study history: grading the
   word moves the kanji's due date, and neither screen can show anything but
   the other's state. Uniqueness has to hold across the whole catalogue, not
   within each file — which is the check no per-file schema can make. */
const seen = new Map();

for (const [spec, data] of loaded) {
  let entries;
  try {
    entries = spec.collect(data);
  } catch {
    // The schema pass already reported whatever made this unwalkable.
    continue;
  }

  for (const [id, where] of entries) {
    if (typeof id !== 'string' || id === '') continue; // reported by the schema

    const previous = seen.get(id);
    if (previous) {
      note(`data/${spec.name}.json`, `${where}: id "${id}" is already used by ${previous}`);
    } else {
      seen.set(id, `data/${spec.name}.json ${where}`);
    }

    if (spec.deck === null) continue;

    /* An id study/decks.js cannot route is an entry no round will ever ask
       about. Nothing errors — the review pool simply drops it — so this is
       invisible from inside the app, permanently. */
    const deck = deckKeyForItemId(id);
    if (deck !== spec.deck) {
      note(
        `data/${spec.name}.json`,
        deck === null
          ? `${where}: id "${id}" matches no deck prefix, so nothing will ever quiz it`
          : `${where}: id "${id}" routes to the ${deck} deck, not ${spec.deck}`,
      );
    }
  }
}

/* -- Report ----------------------------------------------------------------- */

if (problems.length > 0) {
  console.error(`\n${problems.length} content problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ ${loaded.size} content files match their schemas; ${seen.size} ids, all unique and routable`);
