#!/usr/bin/env node
"use strict";

// Craft-time symbol resolver. Given a roadmap entry's `touches` paths (and
// optionally its `what` prose), emits a per-file map of top-level
// definitions so an assembled prompt can cite symbols instead of making the
// handed-off session rediscover what lives in each file.
//
// Honest limit, and the reason this never replaces truth_grounding: the
// extraction is a per-language regex anchored at column 0, not a parser.
// Overloads, generated code, and macros will slip. The output narrows the
// search; the handed-off session still verifies.
//
// Runs in the same craft-time slot as render-sections.js: plain CommonJS, no
// dependencies (neither rg nor ctags is on PATH), one JSON object on stdout,
// fail-soft — an unreadable or missing path is reported in the payload, never
// thrown at the caller.

const fs = require("fs");
const path = require("path");

function projectDir() {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

// Column-0 anchoring is what keeps local variables out: an indented `const`
// inside a function body never matches. Each entry maps an extension family
// to the definition forms that language declares at top level.
const LANGUAGES = [
  {
    extensions: [".js", ".mjs", ".cjs", ".jsx", ".ts", ".tsx", ".mts", ".cts"],
    patterns: [
      /^(?:export\s+(?:default\s+)?)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/,
      /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/,
      /^(?:export\s+)?(?:declare\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)/,
      /^(?:export\s+)?(?:declare\s+)?(?:interface|type|enum)\s+([A-Za-z_$][\w$]*)/,
    ],
  },
  {
    extensions: [".py"],
    patterns: [
      /^(?:async\s+)?def\s+([A-Za-z_]\w*)/,
      /^class\s+([A-Za-z_]\w*)/,
      /^([A-Za-z_]\w*)\s*(?::[^=]+)?=(?!=)/,
    ],
  },
  {
    extensions: [".kt", ".kts"],
    patterns: [
      /^(?:[a-z]+\s+)*fun\s+(?:<[^>]*>\s*)?([A-Za-z_]\w*)/,
      /^(?:[a-z]+\s+)*(?:class|object|interface)\s+([A-Za-z_]\w*)/,
      /^(?:[a-z]+\s+)*(?:val|var)\s+([A-Za-z_]\w*)/,
    ],
  },
];

function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return LANGUAGES.find((lang) => lang.extensions.includes(ext)) || null;
}

/** Top-level definitions in `source`, in file order, deduped by name. */
function extractSymbols(source, language) {
  const symbols = [];
  const seen = new Set();
  source.split(/\r?\n/).forEach((line, i) => {
    for (const pattern of language.patterns) {
      const match = pattern.exec(line);
      if (!match) continue;
      const name = match[1];
      if (seen.has(name)) break;
      seen.add(name);
      symbols.push({ name, line: i + 1 });
      break;
    }
  });
  return symbols;
}

// Resolves one `touches` entry against the tree. A path that no longer
// exists is the signal this whole script exists to surface early, so it is a
// flag on the payload rather than an error: stale entries get caught at craft
// time instead of mid-task.
function resolveFile(root, relPath) {
  const full = path.resolve(root, relPath);
  let stat;
  try {
    stat = fs.statSync(full);
  } catch {
    return { path: relPath, missing: true, symbols: [] };
  }
  if (stat.isDirectory()) return { path: relPath, directory: true, symbols: [] };

  const language = languageFor(relPath);
  if (!language) return { path: relPath, unsupported: true, symbols: [] };

  try {
    return { path: relPath, symbols: extractSymbols(fs.readFileSync(full, "utf-8"), language) };
  } catch {
    return { path: relPath, unreadable: true, symbols: [] };
  }
}

// Identifier-shaped words in the entry's prose: a call site (`foo(`) or a
// camelCase/snake_case token. Plain English words are deliberately not
// candidates — a lowercase word with no shape to it is prose, and treating it
// as a symbol would bury the real misses in noise.
const CALL_SHAPED = /\b([A-Za-z_$][\w$]*)\s*\(/g;
const COMPOUND_SHAPED = /\b([a-z$][\w$]*(?:[A-Z][\w$]*|_[\w$]+)[\w$]*)\b/g;

function candidateIdentifiers(what) {
  const found = new Set();
  for (const re of [CALL_SHAPED, COMPOUND_SHAPED]) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(String(what))) !== null) found.add(match[1]);
  }
  return [...found];
}

// Names in `what` that match no symbol in any touched file. A hit here is
// usually one of two things: an invented API, or a rename the entry never
// caught up with. Anything that reads as a path fragment is dropped — those
// are `touches` restated, not claims about code.
function unresolvedIdentifiers(what, files) {
  if (!what) return [];
  const known = new Set();
  for (const file of files) {
    for (const symbol of file.symbols) known.add(symbol.name);
    path
      .basename(file.path)
      .split(/[.\-_]/)
      .forEach((part) => part && known.add(part));
  }
  return candidateIdentifiers(what)
    .filter((name) => !known.has(name))
    .filter((name) => !String(what).includes(`${name}.`) && !String(what).includes(`/${name}`));
}

function resolve(root, touches, what) {
  const warnings = [];
  const list = Array.isArray(touches) ? touches.filter((p) => typeof p === "string" && p.trim()) : [];
  if (!list.length) warnings.push("no touches paths given — nothing to resolve");

  const files = list.map((relPath) => resolveFile(root, relPath.trim()));
  for (const file of files) {
    if (file.missing) warnings.push(`${file.path}: no longer exists — the entry's touches are stale`);
    if (file.unsupported) warnings.push(`${file.path}: no definition patterns for this file type — skipped`);
    if (file.unreadable) warnings.push(`${file.path}: could not be read — skipped`);
  }

  return { files, unresolved: unresolvedIdentifiers(what, files), warnings };
}

function readStdin() {
  try {
    const raw = fs.readFileSync(0, "utf-8").trim();
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function parseArgv(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--touches" && argv[i + 1] !== undefined) out.touches = argv[i + 1].split(",");
    if (argv[i] === "--what" && argv[i + 1] !== undefined) out.what = argv[i + 1];
  }
  return out;
}

function main() {
  const flags = parseArgv(process.argv.slice(2));
  const stdin = flags.touches ? {} : readStdin();
  const touches = flags.touches || stdin.touches;
  const what = flags.what !== undefined ? flags.what : stdin.what;
  process.stdout.write(JSON.stringify({ ok: true, ...resolve(projectDir(), touches, what) }));
}

if (require.main === module) {
  main();
}

module.exports = {
  projectDir,
  languageFor,
  extractSymbols,
  resolveFile,
  candidateIdentifiers,
  unresolvedIdentifiers,
  resolve,
  LANGUAGES,
};
