/* ==========================================================================
   content.js
   Shared "fetch once, cache in memory, fail loudly" loader behind every
   reference module. vocabulary.js, grammar.js, kanji.js, and lessons.js
   each hand-roll this same four-line pattern today; new content modules
   (Reading, Listening, Conversation, Shadowing, …) can call
   createContentLoader() instead of writing a fifth copy. Existing modules
   are left as-is for now — swapping them over is a separate, isolated
   change, not bundled into this one.
   ========================================================================== */

/* Returns a load() function scoped to one JSON file: the first call
   fetches and caches the parsed result, every call after that returns
   the cached value. A failed or non-OK fetch throws a labeled error
   (e.g. "Failed to load vocabulary (404)") so the caller's own
   try/catch can show its own message — same contract today's
   per-module loaders already follow. */
function createContentLoader(url, label) {
  let cached = null;

  return async function load() {
    if (cached) return cached;

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to load ${label} (${response.status})`);
    }

    cached = await response.json();
    return cached;
  };
}

export { createContentLoader };
