'use strict';

// The roadmap pane (hooks/register.tsx) is tested by `claude plugin test .`, which needs the Claude
// Code CLI. These checks hold what Node can read: how the mod is registered beside the command hooks,
// that it adds no command, and that its reader and its buttons still match what Foreman writes and routes.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { HOOKS_DIR, SCRIPTS_DIR, makeTmpProject, initGitRepo } = require('./helpers');

const root = path.join(__dirname, '..');
const json = (...parts) => JSON.parse(fs.readFileSync(path.join(root, ...parts), 'utf-8'));
const mod = fs.readFileSync(path.join(HOOKS_DIR, 'register.tsx'), 'utf-8');
const roadmap = require(path.join(SCRIPTS_DIR, 'roadmap.js'));

test('hooks.json names the pane module beside the command hooks, and it exists', () => {
  const hooks = json('hooks', 'hooks.json');
  assert.deepStrictEqual(hooks.modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(HOOKS_DIR, hooks.modules[0])));
  assert.ok(Object.keys(hooks.hooks).length > 0, 'the command hooks stay registered');
});

test('only Claude Code loads the module: Codex and Antigravity register no module', () => {
  assert.equal(json('hooks', 'codex-hooks.json').modules, undefined);
  assert.equal(json('hooks.json').modules, undefined);
  assert.equal(json('.claude-plugin', 'plugin.json').types, './types/index.d.ts');
  assert.ok(fs.existsSync(path.join(root, 'types', 'index.d.ts')));
  for (const other of [json('.codex-plugin', 'plugin.json'), json('plugin.json')]) {
    assert.equal(other.types, undefined);
    assert.equal(other.modules, undefined);
  }
});

test('the mod adds no command to the list and keeps its state under foreman', () => {
  assert.doesNotMatch(mod, /command\.(register|run)/);
  const declared = [...fs.readFileSync(path.join(root, 'types', 'index.d.ts'), 'utf-8').matchAll(/^\s{6}(roadmap\w+):/gm)].map((m) => m[1]).sort();
  const atoms = [...mod.matchAll(/atom\(\{ plugin: 'foreman', key: '(\w+)' \}/g)].map((m) => m[1]).sort();
  assert.equal(atoms.length, 8);
  assert.deepStrictEqual(atoms, declared);
  assert.doesNotMatch(mod, /plugin: '(?!foreman')/);
});

test('the pane reader and Foreman agree on the format roadmap.js writes', async () => {
  const { parse, CLOSED } = await import(pathToFileURL(path.join(HOOKS_DIR, 'roadmap-entries.mjs')).href);
  assert.deepStrictEqual([...CLOSED].sort(), [...roadmap.TERMINAL_STATUSES].sort());

  const project = makeTmpProject();
  initGitRepo(project);
  const add = (title, extra = {}) => roadmap.cmdAdd(project, { title, why: `why ${title}`, what: `what ${title}`, source: 'claude-suggested', ...extra }).entry;
  const first = add('First');
  const second = add('Second', { depends_on: [first.id], planned_touches: ['src/a.js', 'src/b/'] });
  const third = add('Third');
  const fourth = add('Fourth');
  const fifth = add('Fifth');
  roadmap.cmdUpdateStatus(project, { id: first.id, status: 'in_progress' });
  roadmap.cmdUpdateStatus(project, { id: third.id, status: 'in_progress' });
  roadmap.cmdUpdateStatus(project, { id: third.id, status: 'awaiting_acceptance' });
  roadmap.cmdUpdateStatus(project, { id: fourth.id, status: 'deferred' });
  roadmap.cmdUpdateStatus(project, { id: fifth.id, status: 'done' });

  const { entries, deferred } = parse(fs.readFileSync(path.join(project, 'ROADMAP.jsonl'), 'utf-8'));
  assert.deepStrictEqual(entries.map((x) => [x.id, x.status]), [[first.id, 'in_progress'], [second.id, 'planned'], [third.id, 'awaiting_acceptance']]);
  assert.deepStrictEqual(deferred.map((x) => x.id), [fourth.id]);
  assert.deepStrictEqual(entries[1], {
    id: second.id,
    title: 'Second',
    status: 'planned',
    dependsOn: [first.id],
    waitsOn: [first.id],
    touches: ['src/a.js', 'src/b/'],
    why: 'why Second',
    createdAt: second.created_at,
    source: 'claude-suggested',
  });

  // Every status the pane branches on is one Foreman has.
  for (const status of mod.match(/'(?:in_progress|awaiting_acceptance|planned|deferred)'/g).map((s) => s.slice(1, -1))) {
    assert.ok(roadmap.STATUSES.has(status), status);
  }
});

test('each card button asks for an entry that step pick routes to the matching branch', () => {
  const project = makeTmpProject();
  initGitRepo(project);
  const add = (title) => roadmap.cmdAdd(project, { title, why: 'why', what: 'what', source: 'user' }).entry.id;
  const started = add('Started');
  const waiting = add('Waiting');
  const ready = add('Ready');
  roadmap.cmdUpdateStatus(project, { id: started, status: 'in_progress' });
  roadmap.cmdUpdateStatus(project, { id: waiting, status: 'in_progress' });
  roadmap.cmdUpdateStatus(project, { id: waiting, status: 'awaiting_acceptance' });
  const next = (id) => roadmap.cmdStepPick(project, { flow: 'pick', chose: id }).next;
  assert.equal(next(started), 'resume');
  assert.equal(next(waiting), 'accept');
  assert.equal(next(ready), 'gather_checks');

  // The prompts name the entry and the action in plain words and no slash command.
  const ask = mod.match(/ask: \{\n([\s\S]*?)\n {2}\},/)[1];
  assert.deepStrictEqual([...ask.matchAll(/(resume|accept|pick): \(id: string\) => `([^`]*)`/g)].map((m) => m[2].replace('${id}', 'ID')), [
    'Resume roadmap entry ID with Foreman.',
    'Accept roadmap entry ID with Foreman.',
    'Start roadmap entry ID with Foreman.',
  ]);
});
