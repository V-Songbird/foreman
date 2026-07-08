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

/** Write ROADMAP.jsonl in a project dir from an array of line objects. */
function writeRoadmap(project, entries) {
  const text = entries.map((e) => JSON.stringify(e)).join('\n') + '\n';
  fs.writeFileSync(path.join(project, 'ROADMAP.jsonl'), text, 'utf-8');
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
  writeRoadmap,
  writeConfig,
  initGitRepo,
  commitFile,
  HOOKS_DIR,
  SCRIPTS_DIR,
};
