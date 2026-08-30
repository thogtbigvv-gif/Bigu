#!/usr/bin/env node
/* ==========================================================================
   tools/check-structure.mjs
   The cheapest check this repository can run, and the one it went longest
   without: does every module parse, and does every import point at a file
   that exists?

   Bigu ships its source unbuilt — the browser is the first thing that has
   ever resolved these specifiers. A typo in a relative path is therefore
   invisible until a reader opens the view that needs it, and a stale path
   left behind by a rename is invisible until someone opens the *other*
   view. Neither shows up in a diff. Both show up here.

   Zero dependencies, on purpose: the app has none and a checker that needed
   an install would not be run.

     node tools/check-structure.mjs
   ========================================================================== */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { glob } from './lib/walk.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* Matches static `import … from '…'`, bare `import '…'`, and `export … from
   '…'`. Dynamic import() is deliberately not matched: this app has none, and
   a regex that tried would also match the word in prose. */
const SPECIFIER = /(?:^|\n)\s*(?:import|export)[\s\S]{0,400}?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g;

const problems = [];

function fail(file, message) {
  problems.push(`${path.relative(ROOT, file)}: ${message}`);
}

/* -- Syntax ---------------------------------------------------------------
   `node --check` in module mode. It is the same parser the browser will use
   on the same text, minus the DOM — which is all that is being asked here.
   -------------------------------------------------------------------------- */
function checkSyntax(file) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
  } catch (error) {
    const detail = String(error.stderr ?? error.message).trim().split('\n').slice(0, 4).join('\n  ');
    fail(file, `does not parse\n  ${detail}`);
  }
}

/* -- Exports --------------------------------------------------------------
   Every name a module offers. Bigu declares its exports in one `export {}`
   list at the foot of each file — a house style worth having, because it
   means the module's public surface is readable in one place — so that is
   the form parsed, alongside the inline `export function`/`export const`
   the tools directory uses.
   -------------------------------------------------------------------------- */
const NAMED_EXPORT_LIST = /export\s*\{([^}]*)\}\s*(?!from)/g;
const INLINE_EXPORT = /export\s+(?:async\s+)?(?:function|const|let|class)\s+([A-Za-z_$][\w$]*)/g;

function exportsOf(source) {
  const names = new Set();

  for (const match of source.matchAll(NAMED_EXPORT_LIST)) {
    for (const entry of match[1].split(',')) {
      // `a as b` publishes b; a bare `a` publishes a.
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  for (const match of source.matchAll(INLINE_EXPORT)) names.add(match[1]);

  return names;
}

/* The names an import statement asks for, or null when it asks for all of
   them (`import * as x`) or for none (`import './side-effect.js'`). */
const IMPORT_CLAUSE = /(?:^|\n)\s*import\s+([\s\S]{0,400}?)\s+from\s*['"]([^'"]+)['"]/g;

function requestedNames(clause) {
  if (clause.includes('*')) return null;
  const braces = clause.match(/\{([^}]*)\}/);
  if (!braces) return [];
  return braces[1]
    .split(',')
    .map((entry) => entry.trim().split(/\s+as\s+/)[0].trim())
    .filter(Boolean);
}

/* -- Imports --------------------------------------------------------------
   Three questions per import, in the order they can go wrong.

   Only relative specifiers are resolved. There are no bare specifiers in
   this app — no dependencies is the whole point — so one appearing is
   itself worth failing on rather than skipping over.

   The third question is the one that earns this file its keep. A moved
   module is caught by the browser on the first load; a *renamed export*
   is not caught until something navigates to the one view that imports it,
   and it fails as `does not provide an export named …` with the whole
   module graph dead behind it. That is a five-second check here.
   -------------------------------------------------------------------------- */
async function checkImports(file, exportsByFile) {
  const source = await readFile(file, 'utf8');

  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (!specifier) continue;

    if (!specifier.startsWith('.')) {
      /* The no-dependencies rule is about what ships. Node's own builtins
         are fair game in tools/ and test/, which run on a developer's
         machine and in CI and are never served to a reader; anything else,
         anywhere, is a dependency this app does not have. */
      const isTooling = !file.startsWith(path.join(ROOT, 'js'));
      if (!(isTooling && specifier.startsWith('node:'))) {
        fail(file, `imports "${specifier}", which is not a relative path — this app ships no dependencies`);
      }
      continue;
    }

    const target = path.resolve(path.dirname(file), specifier);
    if (!existsSync(target)) {
      fail(file, `imports "${specifier}", which does not exist`);
    }
  }

  for (const match of source.matchAll(IMPORT_CLAUSE)) {
    const target = path.resolve(path.dirname(file), match[2]);
    const available = exportsByFile.get(target);
    if (!available) continue;

    for (const name of requestedNames(match[1]) ?? []) {
      if (!available.has(name)) {
        fail(file, `imports { ${name} } from "${match[2]}", which does not export it`);
      }
    }
  }
}

/* -- Entry point ----------------------------------------------------------
   index.html loads exactly one module. If that path is wrong nothing else
   matters, so it is checked by name rather than left to the sweep.
   -------------------------------------------------------------------------- */
async function checkEntryPoint() {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const entry = html.match(/<script[^>]+type="module"[^>]+src="([^"]+)"/);

  if (!entry) {
    problems.push('index.html: no <script type="module"> entry point found');
    return;
  }
  if (!existsSync(path.join(ROOT, entry[1]))) {
    problems.push(`index.html: entry point "${entry[1]}" does not exist`);
  }
}

/* -- Stylesheets ----------------------------------------------------------
   Same failure mode, different file type: every stylesheet is linked by
   hand from index.html, so a renamed one is a view that silently loses its
   styling. Both directions are checked — a link with no file, and a file
   with no link, because an orphaned stylesheet is dead weight nobody knows
   is dead.
   -------------------------------------------------------------------------- */
async function checkStylesheets() {
  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const linked = [...html.matchAll(/<link[^>]+rel="stylesheet"[^>]+href="([^"]+)"/g)].map((m) => m[1]);

  for (const href of linked) {
    if (!existsSync(path.join(ROOT, href))) {
      problems.push(`index.html: stylesheet "${href}" does not exist`);
    }
  }

  const onDisk = (await glob(path.join(ROOT, 'css'), '.css')).map((f) => path.relative(ROOT, f));
  for (const file of onDisk) {
    if (!linked.includes(file)) {
      problems.push(`${file}: on disk but never linked from index.html`);
    }
  }
}

/* -- Layers ----------------------------------------------------------------
   js/ is five directories and the dependency arrow runs one way. A module
   may import from its own layer or from one it is allowed to depend on;
   nothing beneath views/ may import a view.

   This is the rule that stops the app from tangling itself back up. It had
   already been broken once in the obvious direction — six modules imported
   *views* to reach a JSON file, so the Dashboard depended on the Vocabulary
   screen — and once in a quieter one: study/favorites.js imported a drawing
   helper in order to build a button, which made the study layer the only
   place below the UI that touched the DOM.

   Neither would have been caught by review a second time. Both are caught
   here in milliseconds.

   data/ and study/ may each import the other, which is the one bidirectional
   pair and is deliberate: the catalogue asks study/decks.js which items are
   studiable, and study/session.js asks the catalogue for the pool it counts
   over. Neither module imports the other one back, so there is no cycle —
   which is checked separately below.
   -------------------------------------------------------------------------- */
const LAYERS = {
  core: ['core'],
  data: ['core', 'data', 'study'],
  study: ['core', 'data', 'study'],
  ui: ['core', 'data', 'study', 'ui'],
  views: ['core', 'data', 'study', 'ui', 'views'],
  // js/app.js is the entry point and wires everything together.
  app: ['core', 'data', 'study', 'ui', 'views', 'app'],
};

function layerOf(file) {
  const parts = path.relative(path.join(ROOT, 'js'), file).split(path.sep);
  return parts.length > 1 ? parts[0] : 'app';
}

function checkLayers(file, source) {
  const from = layerOf(file);
  const allowed = LAYERS[from];
  if (!allowed) {
    fail(file, `sits in an unknown layer "${from}" — add it to LAYERS or move the file`);
    return;
  }

  for (const match of source.matchAll(SPECIFIER)) {
    const specifier = match[1] ?? match[2];
    if (!specifier?.startsWith('.')) continue;

    const to = layerOf(path.resolve(path.dirname(file), specifier));
    if (!allowed.includes(to)) {
      fail(file, `is in js/${from}/ and imports from js/${to}/, which that layer may not depend on`);
    }
  }
}

/* -- Cycles ----------------------------------------------------------------
   An import cycle in ES modules does not error — it leaves one of the two
   modules holding an uninitialised binding, which surfaces as a
   `Cannot access '<name>' before initialization` at whatever moment the
   wrong one happened to load first. That is a hard bug to read and a
   trivial one to prevent.
   -------------------------------------------------------------------------- */
function checkCycles(graph) {
  const visited = new Set();
  const stack = [];

  function walk(file) {
    const at = stack.indexOf(file);
    if (at !== -1) {
      const cycle = [...stack.slice(at), file].map((f) => path.relative(ROOT, f)).join(' → ');
      problems.push(`import cycle: ${cycle}`);
      return;
    }
    if (visited.has(file)) return;

    visited.add(file);
    stack.push(file);
    for (const next of graph.get(file) ?? []) walk(next);
    stack.pop();
  }

  for (const file of [...graph.keys()].sort()) walk(file);
}

/* -- The ground colour, in the three places it has to be written ----------
   --color-paper is the page ground, and a <meta> cannot read a custom
   property — so the same two hex values are hand-copied into index.html's
   theme-color tags and into manifest.json, and only css/variables.css is
   the source of truth.

   They had already drifted: both copies carried a retired palette long
   after the grounds changed, so an installed Bigu painted its status bar
   and splash screen in a colour the app no longer used. Nothing caught it
   because nothing looks wrong in a browser tab — only once the app is
   installed, which is where nobody thinks to check. A comment asking the
   next editor to keep three files in sync is what allowed the drift; this
   is the same request, enforced.
   -------------------------------------------------------------------------- */
async function checkGroundColours() {
  const css = await readFile(path.join(ROOT, 'css', 'variables.css'), 'utf8');

  /* The light ground is declared on the bare :root; the dark one under
     :root[data-theme="dark"]. Reading them in document order is enough —
     there are exactly two, and the light one comes first. */
  const grounds = [...css.matchAll(/--color-paper:\s*(#[0-9A-Fa-f]{6})/g)].map((m) => m[1].toUpperCase());
  if (grounds.length !== 2) {
    problems.push(`css/variables.css: expected two --color-paper declarations, found ${grounds.length}`);
    return;
  }
  const [light, dark] = grounds;

  const html = await readFile(path.join(ROOT, 'index.html'), 'utf8');
  const metas = new Map(
    [...html.matchAll(/<meta name="theme-color" content="(#[0-9A-Fa-f]{6})" media="\(prefers-color-scheme: (light|dark)\)"/g)]
      .map((m) => [m[2], m[1].toUpperCase()]),
  );

  for (const [scheme, expected] of [['light', light], ['dark', dark]]) {
    const found = metas.get(scheme);
    if (!found) problems.push(`index.html: no theme-color meta for prefers-color-scheme: ${scheme}`);
    else if (found !== expected) {
      problems.push(`index.html: the ${scheme} theme-color is ${found}, but --color-paper is ${expected}`);
    }
  }

  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  // A manifest carries no media queries, so both of its colours are the
  // light ground — the one an install preview and a splash screen use.
  for (const field of ['theme_color', 'background_color']) {
    const found = String(manifest[field] ?? '').toUpperCase();
    if (found !== light) {
      problems.push(`manifest.json: ${field} is ${manifest[field]}, but the light --color-paper is ${light}`);
    }
  }
}

/* -- The offline cache ----------------------------------------------------
   sw.js names every file an installed Bigu needs, as a literal list, and
   the list is maintained by hand for the same reason index.html's <link>
   run is: there is no build step to derive one.

   That makes it exactly as fragile as the stylesheet run, and worse in one
   respect — a mistake here is invisible in every browser that is online.
   A path with no file behind it fails `cache.addAll`, which fails the whole
   install, which means no offline app at all and no error anywhere a
   developer would see it. A file on disk that nobody precached is the
   quieter half: the app works, installs, passes every other check, and then
   one view is blank on the underground.

   So both directions again, over everything the browser is served:
   stylesheets, modules and content. The one entry with no file behind it is
   './', which is the document itself.
   -------------------------------------------------------------------------- */
function precachedPaths(source, name) {
  const list = source.match(new RegExp(`const ${name} = \\[([\\s\\S]*?)\\];`));
  if (!list) {
    problems.push(`sw.js: no ${name} list found — the offline cache cannot be checked`);
    return [];
  }
  return [...list[1].matchAll(/'([^']+)'/g)].map((match) => match[1].replace(/^\.\//, ''));
}

async function checkServiceWorker() {
  const worker = path.join(ROOT, 'sw.js');
  if (!existsSync(worker)) {
    problems.push('sw.js: missing — without a service worker Bigu is not installable and has no offline copy');
    return;
  }

  // It is not in js/, so the sweep below never sees it. It is still shipped.
  checkSyntax(worker);

  const source = await readFile(worker, 'utf8');
  const precached = new Set([...precachedPaths(source, 'SHELL'), ...precachedPaths(source, 'CONTENT')]);

  if (!precached.has('')) {
    problems.push("sw.js: the shell does not precache './' — an installed Bigu would have no document offline");
  }

  for (const entry of precached) {
    if (entry !== '' && !existsSync(path.join(ROOT, entry))) {
      problems.push(`sw.js: precaches "${entry}", which does not exist — cache.addAll rejects, and nothing is cached at all`);
    }
  }

  const shipped = [
    ...await glob(path.join(ROOT, 'css'), '.css'),
    ...await glob(path.join(ROOT, 'js'), '.js'),
    ...await glob(path.join(ROOT, 'data'), '.json'),
  ].map((file) => path.relative(ROOT, file).split(path.sep).join('/'));

  for (const file of shipped) {
    // Schemas are read by tools/validate-data.mjs in CI and never by the app.
    if (file.startsWith('data/schema/')) continue;
    if (!precached.has(file)) {
      problems.push(`${file}: on disk but never precached by sw.js — it would be missing offline`);
    }
  }

  /* The manifest's icons are the other half of installability, and the one
     part of it a reader sees before they have installed anything: a broken
     path there is an install prompt with no picture in it. */
  const manifest = JSON.parse(await readFile(path.join(ROOT, 'manifest.json'), 'utf8'));
  const iconSources = [
    ...(manifest.icons ?? []),
    ...(manifest.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? []),
  ].map((icon) => icon.src);

  for (const src of new Set(iconSources)) {
    if (!existsSync(path.join(ROOT, src))) {
      problems.push(`manifest.json: declares the icon "${src}", which does not exist`);
    } else if (!precached.has(src)) {
      problems.push(`manifest.json: declares the icon "${src}", which sw.js does not precache`);
    }
  }
}

const files = [
  ...await glob(path.join(ROOT, 'js'), '.js'),
  ...await glob(path.join(ROOT, 'tools'), '.mjs'),
  ...await glob(path.join(ROOT, 'test'), '.mjs'),
];

// Every module's exports first: an import can only be checked against a
// surface that has already been read.
const exportsByFile = new Map();
for (const file of files) {
  exportsByFile.set(file, exportsOf(await readFile(file, 'utf8')));
}

/* file -> the files it imports, for the cycle walk. */
const graph = new Map();

for (const file of files) {
  const source = await readFile(file, 'utf8');

  checkSyntax(file);
  await checkImports(file, exportsByFile);
  if (file.startsWith(path.join(ROOT, 'js'))) checkLayers(file, source);

  graph.set(file, [...source.matchAll(SPECIFIER)]
    .map((match) => match[1] ?? match[2])
    .filter((specifier) => specifier?.startsWith('.'))
    .map((specifier) => path.resolve(path.dirname(file), specifier))
    .filter((target) => existsSync(target)));
}

checkCycles(graph);
await checkEntryPoint();
await checkStylesheets();
await checkGroundColours();
await checkServiceWorker();

if (problems.length > 0) {
  console.error(`\n${problems.length} structural problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(
  `✓ ${files.length} modules parse; imports, named exports, layers, stylesheets, ground colours and the offline cache all resolve; no cycles`,
);
