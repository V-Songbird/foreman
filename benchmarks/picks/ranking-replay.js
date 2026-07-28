#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { readEntries, cmdNextCandidates } = require("../../scripts/roadmap");

const CLOSED = new Set(["done", "dropped", "rejected"]);

function assertAcyclicDependencies(entries) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) throw new Error(`dependency cycle reaches ${id}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id)?.depends_on || []) {
      if (byId.has(dependency)) visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const entry of entries) visit(entry.id);
}

function openDependents(entries) {
  const map = new Map(entries.map((entry) => [entry.id, []]));
  for (const entry of entries) {
    if (CLOSED.has(entry.status)) continue;
    for (const dependency of entry.depends_on || []) {
      if (map.has(dependency)) map.get(dependency).push(entry.id);
    }
  }
  return map;
}

function criticalDepths(entries) {
  assertAcyclicDependencies(entries);
  const dependents = openDependents(entries);
  const visiting = new Set();
  const memo = new Map();

  function depth(id) {
    if (memo.has(id)) return memo.get(id);
    if (visiting.has(id)) throw new Error(`dependency cycle reaches ${id}`);
    visiting.add(id);
    const children = dependents.get(id) || [];
    const value = children.length ? 1 + Math.max(...children.map(depth)) : 0;
    visiting.delete(id);
    memo.set(id, value);
    return value;
  }

  for (const entry of entries) depth(entry.id);
  return memo;
}

function candidateComparator(strategy) {
  return (left, right) => {
    if ((right.hint_score || 0) !== (left.hint_score || 0)) {
      return (right.hint_score || 0) - (left.hint_score || 0);
    }
    if (strategy === "depth-first" && right.critical_depth !== left.critical_depth) {
      return right.critical_depth - left.critical_depth;
    }
    if (right.unblocks_total !== left.unblocks_total) {
      return right.unblocks_total - left.unblocks_total;
    }
    if (right.unblocks !== left.unblocks) return right.unblocks - left.unblocks;
    if (left.collision !== right.collision) return left.collision ? 1 : -1;
    if (strategy === "depth-tiebreaker" && right.critical_depth !== left.critical_depth) {
      return right.critical_depth - left.critical_depth;
    }
    return String(left.created_at || "").localeCompare(String(right.created_at || ""));
  };
}

function replay(root, options = {}) {
  const entries = readEntries(root);
  const depths = criticalDepths(entries);
  const currentResult = cmdNextCandidates(root, {
    limit: String(Math.max(entries.length, 1)),
    ...(options.hint ? { hint: String(options.hint) } : {}),
  });
  const candidates = currentResult.candidates.map((candidate) => ({
    ...candidate,
    critical_depth: depths.get(candidate.id) || 0,
  }));
  const strategies = {
    current: candidates.map((candidate) => candidate.id),
    depth_first: candidates.slice().sort(candidateComparator("depth-first")).map((candidate) => candidate.id),
    depth_tiebreaker: candidates
      .slice()
      .sort(candidateComparator("depth-tiebreaker"))
      .map((candidate) => candidate.id),
  };
  const currentTop = strategies.current[0] || null;
  return {
    candidates: candidates.map(({ id, title, unblocks, unblocks_total, collision, critical_depth }) => ({
      id,
      title,
      unblocks,
      unblocks_total,
      critical_depth,
      collision,
    })),
    strategies,
    disagreements: Object.entries(strategies)
      .filter(([name, ids]) => name !== "current" && ids[0] !== currentTop)
      .map(([name, ids]) => ({ strategy: name, current: currentTop, alternative: ids[0] || null })),
  };
}

function flag(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main() {
  const argv = process.argv.slice(2);
  const roadmap = flag(argv, "roadmap");
  if (!roadmap) throw new Error("usage: ranking-replay.js --roadmap <ROADMAP.jsonl> [--hint \"words\"]");
  const absolute = path.resolve(roadmap);
  if (!fs.existsSync(absolute)) throw new Error(`roadmap not found: ${absolute}`);
  const result = replay(path.dirname(absolute), { hint: flag(argv, "hint") });
  process.stdout.write(JSON.stringify({ ok: true, roadmap: absolute, ...result }, null, 2));
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
    process.exit(1);
  }
}

module.exports = {
  CLOSED,
  assertAcyclicDependencies,
  openDependents,
  criticalDepths,
  candidateComparator,
  replay,
};
