#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const {
  cmdNextCandidates,
  commitTrailerFor,
  trailerIdsIn,
  isValidId,
  // One collision rule for planning and for picking; re-exported below so
  // safe-commit.js keeps importing it from here. [Foreman: 125]
  normalizedTouch,
  touchesOverlap,
} = require("./roadmap");

const DEFAULT_LIMIT = 3;
const MAX_LIMIT = 5;
const MAX_OVERLAP_PATHS = 4;

function projectDir() {
  return require("path").resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
}

function parseLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  const raw = String(value).trim();
  if (!/^\d+$/.test(raw)) {
    throw new Error("--limit must be a positive integer");
  }
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return Math.min(parsed, MAX_LIMIT);
}

function repositoryState(root) {
  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (inside !== "true") return { clean: false, reason: "not_a_git_worktree" };
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd: root,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return status.trim()
      ? { clean: false, reason: "working_tree_has_changes" }
      : { clean: true, reason: null };
  } catch {
    return { clean: false, reason: "git_status_unavailable" };
  }
}

function git(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 4 * 1024 * 1024,
  });
}

function gitBuffer(root, args) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "buffer",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

function addHashPart(hash, label, value) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(String(value));
  hash.update(`${label}:${buffer.length}\0`);
  hash.update(buffer);
}

function statusFingerprint(root) {
  const hash = crypto.createHash("sha256");
  const porcelain = gitBuffer(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
  ]);
  const stagedDiff = gitBuffer(root, ["diff", "--cached", "--binary", "--no-ext-diff"]);
  const unstagedDiff = gitBuffer(root, ["diff", "--binary", "--no-ext-diff"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    .split("\0")
    .filter(Boolean)
    .sort();

  addHashPart(hash, "porcelain", porcelain);
  addHashPart(hash, "staged", stagedDiff);
  addHashPart(hash, "unstaged", unstagedDiff);
  for (const relative of untracked) {
    const fullPath = path.join(root, relative);
    const stat = fs.lstatSync(fullPath);
    addHashPart(hash, "untracked-path", relative);
    addHashPart(hash, "untracked-mode", stat.mode);
    addHashPart(
      hash,
      "untracked-content",
      stat.isSymbolicLink()
        ? fs.readlinkSync(fullPath)
        : stat.isFile()
          ? fs.readFileSync(fullPath)
          : `${stat.mode}:${stat.size}`
    );
  }
  return hash.digest("hex");
}

function repositorySnapshot(root) {
  return {
    head: git(root, ["rev-parse", "HEAD"]).trim(),
    state_hash: statusFingerprint(root),
  };
}

function normalizeCommit(root, commit) {
  if (!/^[0-9a-fA-F]{7,64}$/.test(String(commit || ""))) return null;
  try {
    return git(root, ["rev-parse", "--verify", `${commit}^{commit}`]).trim();
  } catch {
    return null;
  }
}

function changedFiles(root, baseline, head) {
  // Show both sides of a rename. Otherwise moving ROADMAP.jsonl to an
  // innocent-looking name would hide the protected source path.
  return git(root, ["diff", "--name-only", "--no-renames", "-z", baseline, head])
    .split("\0")
    .filter(Boolean)
    .map((file) => file.replaceAll("\\", "/"));
}

function foremanTrailerIds(root, commit) {
  const message = git(root, ["log", "-1", "--format=%B", commit]);
  return {
    ids: trailerIdsIn(message),
    lines: message
      .split(/\r?\n/)
      .filter((line) => /^foreman:/i.test(line)),
  };
}

function isSharedLedger(file) {
  const normalized = file.replaceAll("\\", "/");
  if (normalized === "ROADMAP.jsonl") return true;
  return !normalized.includes("/") && /^CHANGELOG(?:\.[^/]+)?$/i.test(normalized);
}

function attestUnit(root, options = {}) {
  const entryId = String(options.entryId || "");
  const baseline = normalizeCommit(root, options.baseline);
  if (!isValidId(entryId)) {
    throw new Error("--entry must be a Foreman id (three or more digits, zero-padded to at least three)");
  }
  if (!baseline) throw new Error("--baseline must name an existing commit");
  if (!/^[0-9a-f]{64}$/i.test(String(options.stateHash || ""))) {
    throw new Error("--state-hash must be a sprint snapshot hash");
  }

  const head = git(root, ["rev-parse", "HEAD"]).trim();
  const stateHash = statusFingerprint(root);
  const reportedCommit = options.commit
    ? normalizeCommit(root, options.commit)
    : null;
  const reasons = [];
  const files = changedFiles(root, baseline, head);
  const forbiddenFiles = files.filter(isSharedLedger);
  let commitCount = 0;
  let trailerIds = [];
  let trailerLines = [];

  if (stateHash !== options.stateHash) {
    reasons.push("working_tree_or_index_changed");
  }

  if (options.commit) {
    if (!reportedCommit) {
      reasons.push("invalid_reported_commit");
    } else {
      if (reportedCommit !== head) reasons.push("reported_commit_is_not_head");
      commitCount = Number.parseInt(
        git(root, ["rev-list", "--count", `${baseline}..${head}`]).trim(),
        10
      );
      if (commitCount !== 1) reasons.push("unit_did_not_create_exactly_one_commit");
      const parents = git(root, ["rev-list", "--parents", "-n", "1", head])
        .trim()
        .split(/\s+/)
        .slice(1);
      if (parents.length !== 1 || parents[0] !== baseline) {
        reasons.push("unit_commit_is_not_directly_on_baseline");
      }
      const trailers = foremanTrailerIds(root, head);
      trailerIds = trailers.ids;
      trailerLines = trailers.lines;
      if (
        trailerLines.length !== 1
        || trailerLines[0] !== commitTrailerFor(entryId)
        || trailerIds.length !== 1
        || trailerIds[0] !== entryId
      ) {
        reasons.push("exact_foreman_trailer_missing");
      }
    }
  } else if (head !== baseline) {
    reasons.push("unexpected_commit_created");
  }

  if (forbiddenFiles.length) reasons.push("shared_ledger_committed_by_worker");

  return {
    ok: reasons.length === 0,
    entry_id: entryId,
    baseline,
    head,
    reported_commit: reportedCommit,
    commit_count: commitCount,
    repository_state_unchanged: stateHash === options.stateHash,
    changed_files: files,
    forbidden_files: forbiddenFiles,
    trailer_ids: trailerIds,
    trailer_lines: trailerLines,
    reasons,
  };
}

function candidateRow(candidate) {
  return {
    id: candidate.id,
    title: candidate.title,
  };
}

function plannedOverlaps(entries) {
  const overlaps = [];
  for (let leftIndex = 0; leftIndex < entries.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < entries.length; rightIndex += 1) {
      const left = entries[leftIndex];
      const right = entries[rightIndex];
      const paths = new Set();
      for (const leftPath of left.touches || []) {
        for (const rightPath of right.touches || []) {
          if (!touchesOverlap(leftPath, rightPath)) continue;
          paths.add(String(leftPath).replaceAll("\\", "/"));
          paths.add(String(rightPath).replaceAll("\\", "/"));
        }
      }
      if (paths.size) {
        const sortedPaths = [...paths].sort();
        overlaps.push({
          ids: [left.id, right.id],
          paths: sortedPaths.slice(0, MAX_OVERLAP_PATHS),
          ...(sortedPaths.length > MAX_OVERLAP_PATHS
            ? { more_paths: sortedPaths.length - MAX_OVERLAP_PATHS }
            : {}),
        });
      }
    }
  }
  return overlaps;
}

function buildPlan(root, options = {}) {
  const limit = parseLimit(options.limit);
  const result = cmdNextCandidates(root, {
    limit: String(limit),
    ...(options.hint ? { hint: String(options.hint) } : {}),
  });
  const selected = result.candidates.slice(0, limit);
  const overlaps = plannedOverlaps(selected);
  const tree = repositoryState(root);
  const reasons = [];
  if (!tree.clean) reasons.push(tree.reason);
  if (result.in_progress.length) reasons.push("existing_work_in_progress");

  return {
    limit,
    mode: "serial",
    runnable: tree.clean && result.in_progress.length === 0,
    selected: selected.map(candidateRow),
    serial: selected.map(candidateRow),
    overlaps,
    has_overlaps: overlaps.length > 0,
    repository_clean: tree.clean,
    reasons: [...new Set(reasons)],
    total_unblocked: result.total_unblocked,
    in_progress: result.in_progress.map(candidateRow),
    ...(result.hint_matched !== undefined ? { hint_matched: result.hint_matched } : {}),
  };
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      index += 1;
    } else {
      flags[key] = true;
    }
  }
  return flags;
}

function main() {
  const [, , subcommand, ...rest] = process.argv;
  const flags = parseFlags(rest);
  const root = projectDir();
  let result;
  if (subcommand === "plan") {
    result = { ok: true, ...buildPlan(root, { limit: flags.limit, hint: flags.hint }) };
  } else if (subcommand === "snapshot") {
    result = { ok: true, ...repositorySnapshot(root) };
  } else if (subcommand === "attest") {
    result = attestUnit(root, {
      entryId: flags.entry,
      baseline: flags.baseline,
      stateHash: flags["state-hash"],
      commit: flags.commit,
    });
  } else {
    throw new Error(
      "usage: sprint.js plan [--limit N] [--hint \"words\"] | snapshot | attest --entry ID --baseline SHA --state-hash HASH [--commit SHA]"
    );
  }
  process.stdout.write(JSON.stringify(result));
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
  DEFAULT_LIMIT,
  MAX_LIMIT,
  MAX_OVERLAP_PATHS,
  parseLimit,
  repositoryState,
  repositorySnapshot,
  statusFingerprint,
  normalizeCommit,
  isSharedLedger,
  attestUnit,
  candidateRow,
  normalizedTouch,
  touchesOverlap,
  plannedOverlaps,
  buildPlan,
};
