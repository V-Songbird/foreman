'use strict';

// Tests for scripts/resolve-symbols.js — resolves a roadmap entry's `touches`
// paths into a per-file map of top-level definitions for prompt-template.md's
// craft-time step, alongside render-sections.js.
//
// Covers:
//   - a real file yields top-level symbols only, no local-variable noise
//   - a path that no longer exists is flagged missing, not an error
//   - an identifier in the entry's `what` that matches no symbol lands in
//     unresolved; one that does match stays out of it
//   - a directory and an unsupported extension each degrade cleanly, with a
//     warning instead of a thrown error
//   - touches arrive by --touches flag or by JSON on stdin

const { test, describe, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { runNodeScript, makeTmpProject, SCRIPTS_DIR } = require('./helpers');

const SCRIPT = path.join(SCRIPTS_DIR, 'resolve-symbols.js');

let project;

beforeEach(() => {
  project = makeTmpProject();
});

/** Write a file (creating parents) inside the temp project. */
function writeFile(relPath, content) {
  const full = path.join(project, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
}

function run({ argv, stdin } = {}) {
  const result = runNodeScript(SCRIPT, argv || [], stdin === undefined ? '' : stdin, {
    CLAUDE_PROJECT_DIR: project,
  });
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error(`non-JSON stdout (status ${result.status}): ${result.stdout}\n${result.stderr}`);
  }
  return { status: result.status, json };
}

const SAMPLE_JS = [
  "'use strict';",
  '',
  'const fs = require("fs");',
  '',
  'function topLevel(a) {',
  '  const localOnly = a + 1;',
  '  let alsoLocal = 2;',
  '  return localOnly + alsoLocal;',
  '}',
  '',
  'class Widget {',
  '  method() {}',
  '}',
  '',
  'const arrow = () => 1;',
  '',
].join('\n');

describe('resolve-symbols', () => {
  test('a real file yields top-level symbols only', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { status, json } = run({ argv: ['--touches', 'src/sample.js'] });

    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal(json.files.length, 1);

    const names = json.files[0].symbols.map((s) => s.name);
    assert.deepEqual(names, ['fs', 'topLevel', 'Widget', 'arrow']);
    assert.ok(!names.includes('localOnly'), 'indented locals must not be reported');
    assert.ok(!names.includes('alsoLocal'), 'indented locals must not be reported');
    assert.ok(!names.includes('method'), 'class members are not top-level definitions');
    assert.deepEqual(json.warnings, []);
  });

  test('symbol lines are 1-indexed and point at the definition', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({ argv: ['--touches', 'src/sample.js'] });
    const byName = Object.fromEntries(json.files[0].symbols.map((s) => [s.name, s.line]));

    assert.equal(byName.fs, 3);
    assert.equal(byName.topLevel, 5);
    assert.equal(byName.Widget, 11);
  });

  test('a missing path is flagged, not an error', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { status, json } = run({ argv: ['--touches', 'src/sample.js,src/gone.js'] });

    assert.equal(status, 0);
    assert.equal(json.ok, true);

    const gone = json.files.find((f) => f.path === 'src/gone.js');
    assert.equal(gone.missing, true);
    assert.deepEqual(gone.symbols, []);
    assert.ok(
      json.warnings.some((w) => w.includes('src/gone.js') && w.includes('stale')),
      `expected a stale-touches warning, got ${JSON.stringify(json.warnings)}`
    );
    assert.equal(json.files.find((f) => f.path === 'src/sample.js').symbols.length, 4);
  });

  test('an identifier in `what` that matches no symbol lands in unresolved', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({
      stdin: JSON.stringify({
        touches: ['src/sample.js'],
        what: 'Call topLevel() first, then renameTheThing() to finish.',
      }),
    });

    assert.ok(json.unresolved.includes('renameTheThing'), 'an invented name must surface');
    assert.ok(!json.unresolved.includes('topLevel'), 'a name that exists must not surface');
  });

  test('prose with no identifier shape produces no unresolved noise', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({
      stdin: JSON.stringify({
        touches: ['src/sample.js'],
        what: 'Make the thing faster and simpler than it is today.',
      }),
    });

    assert.deepEqual(json.unresolved, []);
  });

  test('a directory and an unsupported extension degrade cleanly', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    writeFile('docs/notes.md', '# notes\n');
    fs.mkdirSync(path.join(project, 'src', 'nested'), { recursive: true });

    const { status, json } = run({ argv: ['--touches', 'src/nested,docs/notes.md'] });

    assert.equal(status, 0);
    assert.equal(json.ok, true);

    const dir = json.files.find((f) => f.path === 'src/nested');
    assert.equal(dir.directory, true);
    assert.deepEqual(dir.symbols, []);
    assert.ok(!dir.missing, 'a directory is not a missing path');

    const md = json.files.find((f) => f.path === 'docs/notes.md');
    assert.equal(md.unsupported, true);
    assert.deepEqual(md.symbols, []);
    assert.ok(json.warnings.some((w) => w.includes('docs/notes.md')));
  });

  test('python and kotlin definitions are recognized', () => {
    writeFile('src/thing.py', ['import os', '', 'CONST = 1', '', 'def run(x):', '    local = x', '    return local', '', 'class Thing:', '    pass', ''].join('\n'));
    writeFile('src/Thing.kt', ['package demo', '', 'class Thing {', '    fun ignored() {}', '}', '', 'fun topFun() {}', '', 'val topVal = 1', ''].join('\n'));

    const { json } = run({ argv: ['--touches', 'src/thing.py,src/Thing.kt'] });

    const py = json.files.find((f) => f.path === 'src/thing.py').symbols.map((s) => s.name);
    assert.deepEqual(py, ['CONST', 'run', 'Thing']);

    const kt = json.files.find((f) => f.path === 'src/Thing.kt').symbols.map((s) => s.name);
    assert.deepEqual(kt, ['Thing', 'topFun', 'topVal']);
  });

  test('no touches at all warns instead of failing', () => {
    const { status, json } = run({ stdin: '' });

    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.deepEqual(json.files, []);
    assert.ok(json.warnings.some((w) => w.includes('nothing to resolve')));
  });
});
