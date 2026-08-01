"use strict";

// The repository-state helpers safe-commit.js shares: is the tree clean, what
// is its exact fingerprint, does this sha resolve, and which files are
// Foreman's own bookkeeping rather than the user's work. The name is
// historical — batch execution was cut for 1.0 and this module kept the six
// names safe-commit.js already imported from it, rather than moving them and
// rewriting every call site.

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
// One collision rule for planning and for picking; re-exported below so
// safe-commit.js keeps importing it from here. [Foreman: 125]
const { normalizedTouch, touchesOverlap } = require("./roadmap");

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

// [Foreman: 202] The two backup shapes roadmap.js's migrateFile writes as
// sibling, untracked files right before an automatic format upgrade. They
// are not the ledger itself, but they are still Foreman's own bookkeeping —
// the user-visible recovery copy of a ledger write — so they get every
// consequence isSharedLedger already carries: carved out of dirt at begin,
// excluded from a unit's staging, forbidden in a worker's own commit.
const LEDGER_BACKUP_RE = /^(?:ROADMAP\.jsonl\.backup-|\.foreman\/archive\.jsonl\.backup-)/;

function isSharedLedger(file) {
  const normalized = file.replaceAll("\\", "/");
  // [Foreman: 132] The archive is the roadmap's other half — same single
  // writer rule, so a worker must not commit it either. safe-commit's
  // roadmap_close carve-out stays ROADMAP.jsonl only: a close writes the
  // roadmap, never the archive. A project's own CHANGELOG.md is NOT one of
  // Foreman's files and never was — an ordinary edit to it belongs in the
  // task's own commit like any other change.
  // The trial log and its session marker are Foreman's own writes into the
  // project's .foreman directory: a flow records an event mid-unit, so the
  // tree goes dirty through no fault of the user's work. Treated like the
  // ledger, that dirt stops blocking begin and stops being swept into a unit.
  return (
    normalized === "ROADMAP.jsonl"
    || normalized === ".foreman/archive.jsonl"
    || normalized === ".foreman/trial-log.jsonl"
    || normalized === ".foreman/trial-session"
    || LEDGER_BACKUP_RE.test(normalized)
  );
}

// [Foreman: 184] Every path `git status` reports as differing, porcelain -z so
// special characters survive; a rename/copy record carries both sides.
function dirtyFiles(root) {
  const tokens = git(root, ["status", "--porcelain", "-z"]).split("\0").filter(Boolean);
  const files = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    files.push(token.slice(3).replaceAll("\\", "/"));
    if (/[RC]/.test(token.slice(0, 2)) && tokens[index + 1] !== undefined) {
      index += 1;
      files.push(tokens[index].replaceAll("\\", "/"));
    }
  }
  return files;
}

// [Foreman: 184] The one distinction begin and the plan gate act on: dirt
// confined to shared-ledger files is Foreman's own bookkeeping (the entry's
// in_progress flip on a tracked roadmap), not someone else's work in the
// tree. Anything else keeps the ordinary dirty refusal.
function ledgerOnlyDirt(root) {
  const files = dirtyFiles(root);
  return files.length && files.every(isSharedLedger) ? files : null;
}

module.exports = {
  repositoryState,
  repositorySnapshot,
  normalizeCommit,
  isSharedLedger,
  ledgerOnlyDirt,
  normalizedTouch,
  touchesOverlap,
};
