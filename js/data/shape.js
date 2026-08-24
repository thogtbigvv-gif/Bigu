/* ==========================================================================
   data/shape.js
   The line between "the file arrived" and "the file is usable".

   Every content file in data/ is written by hand. That is the point — the
   catalogue is one learner's own study, not a scrape — and it is also the
   reason a missing comma or a forgotten `example` key is a normal Tuesday
   rather than an impossible state. Until now nothing checked: a loader
   handed whatever JSON.parse returned straight to a render function, so a
   file missing its top-level array threw `Cannot read properties of
   undefined (reading 'map')` from inside a view, six frames below the
   actual mistake, and the reader got a blank section with a stack trace in
   a console they will never open.

   These guards run once per file, at load, and throw a sentence that names
   the file and the field. The loader's own try/catch then shows the view's
   ordinary retryable error state — which is the state a broken data file
   should produce, and never did.

   Deliberately shallow. This is not the JSON Schema validator: that lives
   in tools/validate-data.mjs, runs in CI over every entry and every field,
   and is where authoring mistakes are supposed to be caught. What runs in
   the browser only has to answer the one question the render path cannot
   survive being wrong about — is the collection there, and is it a list of
   objects with ids? Anything deeper would be paying, on every reader's
   first paint, for a check CI already made.
   ========================================================================== */

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/* `data/<label>.json is not shaped like <label> content: <what>.`
   Written as one sentence because it is read as one line in a console. */
function malformed(label, what) {
  return new Error(`data/${label}.json is not shaped like ${label} content: ${what}`);
}

/* The collection every entry-carrying file wraps: `{ updatedAt, <key>: [...] }`
   for vocabulary, grammar, kanji and reading. Lessons is the one file that is
   a bare array, so it passes `key: null`. */
function requireCollection(data, { label, key }) {
  const entries = key === null ? data : (isPlainObject(data) ? data[key] : undefined);

  if (!Array.isArray(entries)) {
    throw malformed(label, key === null
      ? 'the top level is not an array'
      : `there is no "${key}" array at the top level`);
  }

  const bad = entries.findIndex((entry) => !isPlainObject(entry));
  if (bad !== -1) throw malformed(label, `entry ${bad} is not an object`);

  return entries;
}

/* An id is the key every progress record in localStorage is written under,
   so an entry without one is not merely incomplete — it is an item the
   reader can study and never keep, which is a silent failure rather than a
   visible one. Checked here, once, for the four files whose entries are
   themselves studiable. */
function requireIds(entries, label, describe = (index) => `entry ${index}`) {
  const bad = entries.findIndex((entry) => typeof entry.id !== 'string' || entry.id === '');
  if (bad !== -1) throw malformed(label, `${describe(bad)} has no usable id`);
  return entries;
}

function requireEntries(data, { label, key }) {
  return requireIds(requireCollection(data, { label, key }), label);
}

/* Lessons are the one file shaped differently, and the difference matters
   twice over. A lesson is identified by its number rather than by an id —
   it is a place in the textbook, not a thing you study — and what *is*
   studiable is the word list it carries. The flattened pool every study
   surface draws from is built out of those lists, so a lesson whose `words`
   is missing takes the whole review pool down with it, from a file the
   reader never opened. Checked here rather than at the flatMap. */
function requireLessons(data) {
  const lessons = requireCollection(data, { label: 'lessons', key: null });

  for (const [index, lesson] of lessons.entries()) {
    if (!Number.isInteger(lesson.lesson)) {
      throw malformed('lessons', `entry ${index} has no lesson number`);
    }
    if (!Array.isArray(lesson.words)) {
      throw malformed('lessons', `lesson ${lesson.lesson} has no "words" array`);
    }
    requireIds(lesson.words, 'lessons', (wordIndex) => `word ${wordIndex} of lesson ${lesson.lesson}`);
  }

  return lessons;
}

export { requireEntries, requireLessons, isPlainObject };
