#!/usr/bin/env node
"use strict";

// Craft-time symbol resolver. Given a roadmap entry's `touches` paths (and
// optionally its `what` prose), emits a per-file map of top-level
// definitions so an assembled prompt can cite symbols instead of making the
// handed-off session rediscover what lives in each file.
//
// Three further craft-time facts ride the same call, on the same principle:
// replace agent inference with a fact, never delete it. Each touched file
// carries the date it last changed; `references` names other files already
// importing the same helper; and a `verify` command is checked for whether
// it resolves at all here.
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
const { spawnSync } = require("child_process");

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

// [Foreman: 109]
// A verification command the project cannot actually run wastes a whole
// handoff, so craft time answers "does this entry point exist here" — never
// "does it pass", which is the handed-off session's job. A leading
// `cd <dir> &&` is honored because that is how a submodule's suite is named
// from the repo root.
const CD_PREFIX = /^cd\s+("[^"]+"|'[^']+'|\S+)\s*&&\s*/;
const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);

function commandRoot(root, command) {
  const match = CD_PREFIX.exec(command);
  if (!match) return { dir: root, rest: command };
  return {
    dir: path.resolve(root, match[1].replace(/^["']|["']$/g, "")),
    rest: command.slice(match[0].length),
  };
}

function scriptNames(dir) {
  try {
    return new Set(Object.keys(JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8")).scripts || {}));
  } catch {
    return new Set();
  }
}

function onPath(binary) {
  const exts =
    process.platform === "win32"
      ? (process.env.PATHEXT || ".EXE;.CMD;.BAT").split(";").filter(Boolean)
      : [""];
  return (process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .some((dir) =>
      exts.some((ext) => {
        try {
          return fs.statSync(path.join(dir, binary + ext)).isFile();
        } catch {
          return false;
        }
      })
    );
}

function resolveCommand(root, command) {
  const text = String(command).trim();
  if (!text) return null;
  const { dir, rest } = commandRoot(root, text);
  const tokens = rest.split(/\s+/).filter(Boolean);
  const binary = tokens[0] || "";

  if (PACKAGE_RUNNERS.has(binary)) {
    const name = tokens[1] === "run" ? tokens[2] : tokens[1];
    const ok = Boolean(name) && scriptNames(dir).has(name);
    return { command: text, resolves: ok, via: ok ? "package.json script" : null };
  }
  if (/^\.?[/\\]?gradlew(\.bat)?$/.test(binary)) {
    const ok = fs.existsSync(path.join(dir, "gradlew")) || fs.existsSync(path.join(dir, "gradlew.bat"));
    return { command: text, resolves: ok, via: ok ? "gradlew" : null };
  }
  const ok = onPath(binary);
  return { command: text, resolves: ok, via: ok ? "PATH" : null };
}

// [Foreman: 109]
// Other files that already import a helper the touched files import. A named
// analogue in the prompt beats a bullet telling the session to follow
// existing conventions. Scoped to relative specifiers: a package import says
// nothing about this codebase's own shape.
const IMPORT_SPECIFIER = /(?:require\(\s*|from\s+)["']([^"']+)["']/g;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "coverage", "vendor"]);
const WALK_LIMIT = 2000;

function normalizeTarget(target) {
  return target.replace(/\.(js|mjs|cjs|jsx|ts|tsx|mts|cts|py|kt|kts)$/, "");
}

function localImports(root, relPath) {
  const full = path.resolve(root, relPath);
  const targets = new Set();
  let source;
  try {
    source = fs.readFileSync(full, "utf-8");
  } catch {
    return targets;
  }
  IMPORT_SPECIFIER.lastIndex = 0;
  let match;
  while ((match = IMPORT_SPECIFIER.exec(source)) !== null) {
    if (!match[1].startsWith(".")) continue;
    targets.add(normalizeTarget(path.resolve(path.dirname(full), match[1])));
  }
  return targets;
}

// Bounded on purpose: the walk is craft-time overhead paid on every prompt,
// so it stops at WALK_LIMIT and says so rather than growing with the repo.
function walkCodeFiles(root) {
  const files = [];
  const stack = [root];
  let truncated = false;
  while (stack.length && !truncated) {
    const dir = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith(".")) stack.push(full);
      } else if (languageFor(entry.name)) {
        if (files.length >= WALK_LIMIT) {
          truncated = true;
          break;
        }
        files.push(full);
      }
    }
  }
  return { files, truncated };
}

function toPosix(relPath) {
  return relPath.split(path.sep).join("/");
}

function referenceImplementations(root, files) {
  const wanted = new Map();
  const touched = new Set(files.map((file) => path.resolve(root, file.path)));
  for (const file of files) {
    if (file.missing || file.directory || file.unsupported || file.unreadable) continue;
    for (const target of localImports(root, file.path)) wanted.set(target, new Set());
  }
  if (!wanted.size) return { references: [], truncated: false };

  const { files: candidates, truncated } = walkCodeFiles(root);
  for (const candidate of candidates) {
    if (touched.has(candidate)) continue;
    for (const target of localImports(root, candidate)) {
      if (wanted.has(target)) wanted.get(target).add(toPosix(path.relative(root, candidate)));
    }
  }

  const references = [...wanted.entries()]
    .filter(([, citing]) => citing.size)
    .map(([target, citing]) => ({ helper: toPosix(path.relative(root, target)), files: [...citing].sort() }));
  return { references, truncated };
}

// [Foreman: 109]
// How long ago each touched file changed is the cheapest signal for how much
// of an entry's claims have aged since it was written. Outside a repo the
// field is simply absent — an unknown date is one fewer fact, not a failure.
function gitAvailable(root) {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd: root, encoding: "utf-8" });
  return result.status === 0 && String(result.stdout).trim() === "true";
}

function lastChanged(root, relPath) {
  const result = spawnSync("git", ["log", "-1", "--format=%ad", "--date=short", "--", relPath], {
    cwd: root,
    encoding: "utf-8",
  });
  return result.status === 0 ? String(result.stdout).trim() || null : null;
}

function resolve(root, touches, what, verify) {
  const warnings = [];
  const list = Array.isArray(touches) ? touches.filter((p) => typeof p === "string" && p.trim()) : [];
  if (!list.length) warnings.push("no touches paths given — nothing to resolve");

  const files = list.map((relPath) => resolveFile(root, relPath.trim()));
  for (const file of files) {
    if (file.missing) warnings.push(`${file.path}: no longer exists — the entry's touches are stale`);
    if (file.unsupported) warnings.push(`${file.path}: no definition patterns for this file type — skipped`);
    if (file.unreadable) warnings.push(`${file.path}: could not be read — skipped`);
  }

  if (gitAvailable(root)) {
    for (const file of files) {
      if (file.missing) continue;
      const date = lastChanged(root, file.path);
      if (date) file.lastChanged = date;
    }
  }

  const { references, truncated } = referenceImplementations(root, files);
  if (truncated) {
    warnings.push(`reference scan stopped at ${WALK_LIMIT} files — the reference list may be incomplete`);
  }

  const verification = verify ? resolveCommand(root, verify) : null;
  if (verification && !verification.resolves) {
    warnings.push(
      `verification command "${verification.command}" does not resolve here — fix it before handing off, a prompt naming a command that cannot run wastes the whole session`
    );
  }

  return {
    files,
    unresolved: unresolvedIdentifiers(what, files),
    references,
    ...(verification ? { verification } : {}),
    warnings,
  };
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
    if (argv[i] === "--verify" && argv[i + 1] !== undefined) out.verify = argv[i + 1];
  }
  return out;
}

function main() {
  const flags = parseArgv(process.argv.slice(2));
  const stdin = flags.touches ? {} : readStdin();
  const touches = flags.touches || stdin.touches;
  const what = flags.what !== undefined ? flags.what : stdin.what;
  const verify = flags.verify !== undefined ? flags.verify : stdin.verify;
  process.stdout.write(JSON.stringify({ ok: true, ...resolve(projectDir(), touches, what, verify) }));
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
  resolveCommand,
  localImports,
  walkCodeFiles,
  referenceImplementations,
  gitAvailable,
  lastChanged,
  resolve,
  LANGUAGES,
  WALK_LIMIT,
};
