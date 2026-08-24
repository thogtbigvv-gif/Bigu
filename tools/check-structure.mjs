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

for (const file of files) {
  checkSyntax(file);
  await checkImports(file, exportsByFile);
}
await checkEntryPoint();
await checkStylesheets();
await checkGroundColours();

if (problems.length > 0) {
  console.error(`\n${problems.length} structural problem(s):\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('');
  process.exit(1);
}

console.log(`✓ ${files.length} modules parse; every import, named export, stylesheet and ground colour resolves`);
