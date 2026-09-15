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

const { runNodeScript, makeTmpProject, initGitRepo, commitFile, SCRIPTS_DIR } = require('./helpers');

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

  // [Foreman: 187] Containment: a roadmap path is repository data, and one
  // that resolves outside the project is flagged, never read.
  test('a path escaping the project is flagged outside_project, its content never read', () => {
    const secret = path.join(path.dirname(project), 'outside-secret.js');
    fs.writeFileSync(secret, 'const leakedSecretToken = 1;\n', 'utf-8');

    const { status, json } = run({ argv: ['--touches', '../outside-secret.js'] });

    assert.equal(status, 0);
    const flagged = json.files[0];
    assert.equal(flagged.outside_project, true);
    assert.deepEqual(flagged.symbols, []);
    assert.equal(flagged.missing, undefined);
    assert.ok(!JSON.stringify(json).includes('leakedSecretToken'), 'outside content must not leak into the payload');
    assert.ok(
      json.warnings.some((w) => w.includes('outside the project')),
      `expected an outside-project warning, got ${JSON.stringify(json.warnings)}`
    );
  });

  test('an absolute path outside the project is flagged the same way', () => {
    const { json } = run({ argv: ['--touches', path.join(path.dirname(project), 'nope.js')] });
    assert.equal(json.files[0].outside_project, true);
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

  // [Foreman: 279] Prose puts parentheses after ordinary words, and the
  // call-shaped regex read every one of them as a call site. All three strings
  // below are from live entries: `group`, `show` and `it` each shipped in the
  // "an invented API or an un-caught rename" line.
  test('an ordinary word before a parenthesis is prose, not a call site', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const prose = [
      'plan it as remove-group plus insert-group (entry 031 splice), refusing commands',
      'map each internal term to the word the UI should show (History, Clean up, move to trash)',
      'the first stated goal was that it (simple to use) still holds',
    ];
    for (const what of prose) {
      const { json } = run({ stdin: JSON.stringify({ touches: ['src/sample.js'], what }) });
      assert.deepEqual(json.unresolved, [], what);
    }
  });

  test('a call site that looks like code still surfaces, backticked or compound', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({
      stdin: JSON.stringify({
        touches: ['src/sample.js'],
        what: 'Call renameTheThing() and AsyncView(), then `deny(reason)` from the renderer.',
      }),
    });

    for (const name of ['renameTheThing', 'AsyncView', 'deny']) {
      assert.ok(json.unresolved.includes(name), `${name} must still surface: ${JSON.stringify(json.unresolved)}`);
    }
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

// Craft-time preflight: three further facts on the same call — whether the
// named verification command resolves at all, which other files already
// import the same helper, and when each touched file last changed.
describe('resolve-symbols preflight', () => {
  test('a package.json script the project declares resolves', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    writeFile('package.json', JSON.stringify({ scripts: { test: 'node --test' } }));

    const { json } = run({ stdin: JSON.stringify({ touches: ['src/sample.js'], verify: 'npm test' }) });

    assert.equal(json.verification.resolves, true);
    assert.equal(json.verification.via, 'package.json script');
    assert.deepEqual(json.warnings, []);
  });

  test('a script the project never declares fails to resolve, with a warning', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    writeFile('package.json', JSON.stringify({ scripts: { build: 'tsc' } }));

    const { status, json } = run({
      stdin: JSON.stringify({ touches: ['src/sample.js'], verify: 'npm run verify' }),
    });

    assert.equal(status, 0, 'an unresolvable command is a finding, never a failure');
    assert.equal(json.verification.resolves, false);
    assert.equal(json.verification.via, null);
    assert.ok(
      json.warnings.some((w) => w.includes('npm run verify') && w.includes('does not resolve')),
      `expected an unresolvable-command warning, got ${JSON.stringify(json.warnings)}`
    );
  });

  test('a leading cd into a subdirectory is honored', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    writeFile('sub/package.json', JSON.stringify({ scripts: { test: 'node --test' } }));

    const { json } = run({
      stdin: JSON.stringify({ touches: ['src/sample.js'], verify: 'cd sub && npm test' }),
    });

    assert.equal(json.verification.resolves, true);
    assert.equal(json.verification.via, 'package.json script');
  });

  test('a bare binary resolves off PATH', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({
      stdin: JSON.stringify({ touches: ['src/sample.js'], verify: 'node --test tests/*.test.js' }),
    });

    assert.equal(json.verification.resolves, true);
    assert.equal(json.verification.via, 'PATH');
  });

  test('a binary that exists nowhere fails to resolve', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({
      stdin: JSON.stringify({ touches: ['src/sample.js'], verify: 'definitelynotarealbinary --run' }),
    });

    assert.equal(json.verification.resolves, false);
    assert.equal(json.verification.via, null);
  });

  // [Foreman] A command-shape denylist was built here on 2026-08-29 and cut the
  // same day: `dev`/`serve`/`--update`/`--fix` is one ecosystem's vocabulary,
  // it never ends, and termination cannot be read off a string. This pins the
  // absence, so the list is not quietly reintroduced — a dev server resolves,
  // and resolving is all this script claims to know.
  test('a dev server resolves like any other script — no shape judgment here', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    writeFile('package.json', JSON.stringify({ scripts: { dev: 'vite' } }));

    const { json } = run({
      stdin: JSON.stringify({ touches: ['src/sample.js'], verify: 'npm run dev' }),
    });

    assert.equal(json.verification.resolves, true);
    assert.equal('unattended' in json.verification, false, 'a command-shape denylist came back');
    assert.deepEqual(json.warnings, []);
  });

  test('no verify given means no verification field at all', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { json } = run({ argv: ['--touches', 'src/sample.js'] });

    assert.equal('verification' in json, false);
    assert.deepEqual(json.warnings, []);
  });

  test('another file importing the same helper is offered as a reference', () => {
    writeFile('src/helper.js', 'module.exports = { help: () => 1 };\n');
    writeFile('src/sample.js', `const { help } = require('./helper');\n${SAMPLE_JS}`);
    writeFile('src/sibling.js', "const { help } = require('./helper');\n");
    writeFile('src/unrelated.js', "const os = require('os');\n");

    const { json } = run({ argv: ['--touches', 'src/sample.js'] });

    const ref = json.references.find((r) => r.helper === 'src/helper');
    assert.ok(ref, `expected src/helper among ${JSON.stringify(json.references)}`);
    assert.deepEqual(ref.files, ['src/sibling.js']);
    assert.ok(!ref.files.includes('src/sample.js'), 'the touched file is not its own reference');
    assert.ok(!ref.files.includes('src/unrelated.js'), 'a file importing something else is not a reference');
  });

  test('a helper nobody else imports yields no reference', () => {
    writeFile('src/helper.js', 'module.exports = {};\n');
    writeFile('src/sample.js', `const h = require('./helper');\n${SAMPLE_JS}`);

    const { json } = run({ argv: ['--touches', 'src/sample.js'] });

    assert.deepEqual(json.references, []);
  });

  test('package imports are not treated as references', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    writeFile('src/sibling.js', "const fs = require('fs');\n");

    const { json } = run({ argv: ['--touches', 'src/sample.js'] });

    assert.deepEqual(json.references, []);
  });

  test('outside a git repository the last-changed date is simply absent', () => {
    writeFile('src/sample.js', SAMPLE_JS);
    const { status, json } = run({ argv: ['--touches', 'src/sample.js'] });

    assert.equal(status, 0);
    assert.equal(json.ok, true);
    assert.equal('lastChanged' in json.files[0], false);
  });

  test('inside a git repository each touched file carries its last-changed date', () => {
    initGitRepo(project);
    commitFile(project, 'src/sample.js', SAMPLE_JS);

    const { json } = run({ argv: ['--touches', 'src/sample.js'] });

    assert.match(json.files[0].lastChanged, /^\d{4}-\d{2}-\d{2}$/);
  });

  // A submodule layout: the project root tracks `sub` as one gitlink, so
  // `git log` at the root either finds nothing for a path inside it or
  // (worse) reports the gitlink's own commit date instead of the file's.
  test('a file inside a submodule reports the submodule\'s own last-changed date', () => {
    initGitRepo(project);
    fs.writeFileSync(path.join(project, '.gitmodules'), '[submodule "sub"]\n\tpath = sub\n\turl = ./sub\n', 'utf-8');
    const sub = path.join(project, 'sub');
    fs.mkdirSync(sub, { recursive: true });
    initGitRepo(sub);
    commitFile(sub, 'scripts/foo.js', SAMPLE_JS);

    const { json } = run({ argv: ['--touches', 'sub/scripts/foo.js'] });

    assert.match(json.files[0].lastChanged, /^\d{4}-\d{2}-\d{2}$/);
  });
});
