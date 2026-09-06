'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { projectDir } = require('../scripts/runtime');
const { cmdAdd, cmdUpdateStatus, cmdList, cmdDoctor } = require('../scripts/roadmap');
const { makeTmpProject } = require('./helpers');

test('project selection honors explicit Foreman root, Codex hint, legacy hint, then cwd', () => {
  const root = makeTmpProject();
  try {
    assert.equal(projectDir({FOREMAN_PROJECT_DIR: root, CODEX_CWD: 'codex', CLAUDE_PROJECT_DIR: 'legacy'}, 'fallback'), root);
    assert.equal(projectDir({CODEX_CWD: root, CLAUDE_PROJECT_DIR: 'legacy'}, 'fallback'), root);
    assert.equal(projectDir({CLAUDE_PROJECT_DIR: root}, 'fallback'), root);
    assert.equal(projectDir({}, root), root);
  } finally { fs.rmSync(path.dirname(root), {recursive: true, force: true}); }
});

test('Codex records round trip with legacy model history and remain healthy', () => {
  const root = makeTmpProject();
  try {
    const newer = cmdAdd(root, {title: 'New work', why: 'Need a result', what: 'Deliver result', source: 'codex-suggested'}).entry;
    const legacy = cmdAdd(root, {title: 'Historical work', why: 'Old context', what: 'Keep history', source: 'claude-suggested'}).entry;
    cmdUpdateStatus(root, {id: newer.id, status: 'done', model: 'gpt-6-astra', effort: 'ultra'});
    cmdUpdateStatus(root, {id: legacy.id, status: 'done', model: 'opus', effort: 'high'});
    const listing = cmdList(root, {stats: true});
    assert.deepEqual(listing.stats.by_model, {'gpt-6-astra': 1, opus: 1});
    assert.equal(listing.stats.by_effort.ultra, 1);
    assert.equal(cmdDoctor(root, {}).summary.errors, 0);
    assert.equal(cmdList(root, {ids: newer.id}).entries[0].source, 'codex-suggested');
  } finally { fs.rmSync(path.dirname(root), {recursive: true, force: true}); }
});
