'use strict';

// Shared fixtures and helpers for foreman tests.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const SCRIPTS_DIR = path.join(__dirname, '..', 'scripts');

function buildStdin(stdinData) {
  if (stdinData === null || stdinData === undefined) return undefined;
  if (typeof stdinData === 'string') return stdinData;
  return JSON.stringify(stdinData);
}

/** Run a .js file by absolute path and return the raw spawnSync result. */
function runNodeScript(fullPath, argv, stdinData, env) {
  return spawnSync('node', [fullPath, ...(argv || [])], {
    input: buildStdin(stdinData),
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
  });
}

/** Run a hook script from hooks/ and return the raw spawnSync result. */
function runScriptRaw(name, stdinData, env) {
  return runNodeScript(path.join(HOOKS_DIR, name), [], stdinData, env);
}

/** Run foreman/scripts/roadmap.js with the given subcommand + argv. */
function runRoadmap(argv, stdinData, env) {
  return runNodeScript(path.join(SCRIPTS_DIR, 'roadmap.js'), argv, stdinData, env);
}

/** Run foreman/scripts/render-sections.js. */
function runRenderSections(env) {
  return runNodeScript(path.join(SCRIPTS_DIR, 'render-sections.js'), [], null, env);
}

/** Create a fresh empty temp directory usable as a project root. */
function makeTmpProject() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'foreman-project-'));
  const project = path.join(tmpDir, 'project');
  fs.mkdirSync(project);
  return project;
}

const {
  ROADMAP_FORMAT_KEY,
  CURRENT_ROADMAP_FORMAT,
  splitTouches,
} = require(path.join(SCRIPTS_DIR, 'roadmap'));

/**
 * The exact bytes of a roadmap holding these entries, at the CURRENT format:
 * the marker line first, then one line per entry.
 *
 * [Foreman: 130] A fixture written the old way (a single `touches` array, no
 * marker) is converted through the real 1 -> 2 upgrade rather than written to
 * disk as-is. Format 1 is now a read-only shape — every mutation refuses it
 * and names `migrate` — so an unconverted fixture would make every write-path
 * test assert the migrate gate instead of the behavior it was written for. A
 * test that actually wants an unmigrated file writes the raw lines itself
 * (see tests/planned_observed.test.js).
 */
function roadmapText(entries) {
  return [
    JSON.stringify({ [ROADMAP_FORMAT_KEY]: CURRENT_ROADMAP_FORMAT }),
    ...entries.map((e) => JSON.stringify(splitTouches(e))),
  ].join('\n') + '\n';
}

/** Write ROADMAP.jsonl in a project dir from an array of line objects. */
function writeRoadmap(project, entries) {
  fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), roadmapText(entries), 'utf-8');
}

/** Write .foreman/archive.jsonl the same way — same format, same converter. */
function writeArchiveFile(project, entries) {
  const dir = path.join(project, '.foreman');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'archive.jsonl'), roadmapText(entries), 'utf-8');
}

/** Write .foreman/config.json in a project dir. */
function writeConfig(project, config) {
  const dir = path.join(project, '.foreman');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config), 'utf-8');
}

/** Init a throwaway git repo in a project dir, for tests exercising git-backed features. */
function initGitRepo(project) {
  spawnSync('git', ['init', '-q'], { cwd: project });
  spawnSync('git', ['config', 'user.email', 'foreman-test@example.com'], { cwd: project });
  spawnSync('git', ['config', 'user.name', 'Foreman Test'], { cwd: project });
}

/** Write a file and commit it in a project's git repo. Returns the short SHA. */
function commitFile(project, relPath, content) {
  const full = path.join(project, relPath);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content, 'utf-8');
  spawnSync('git', ['add', relPath], { cwd: project });
  spawnSync('git', ['commit', '-q', '-m', 'test commit'], { cwd: project });
  return spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: project, encoding: 'utf-8' }).stdout.trim();
}

module.exports = {
  runScriptRaw,
  runNodeScript,
  runRoadmap,
  runRenderSections,
  makeTmpProject,
  roadmapText,
  writeRoadmap,
  writeArchiveFile,
  writeConfig,
  initGitRepo,
  commitFile,
  HOOKS_DIR,
  SCRIPTS_DIR,
};
