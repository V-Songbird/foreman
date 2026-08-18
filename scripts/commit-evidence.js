"use strict";

// [Foreman: 134]
// The one interpreter of "what commit evidence does this entry have".
//
// Two kinds of link exist between a task and the git history that closed it:
// the shas an entry records in `commits[]`, and the `Foreman: <id>` trailer a
// commit message carries (how a staged close links, where `commits[]` stays
// empty on purpose). Every status view -- roadmap list, the doctor, the close
// gate, survey -- used to read those two facts with its own git call,
// so the same entry could be "has evidence" in one view and "missing" in
// another. The divergence that motivated this: a recorded sha living inside a
// submodule resolves for `update-status`'s touches derivation (which walks
// submodules) and does NOT resolve for a root-only `git cat-file -e`.
//
// Everything here fails soft. No git, no repo, a sha nothing knows: the fact
// comes back unresolved, never as a throw. "Unresolved" therefore means "not
// resolvable from here", NOT "deleted" -- a reader that reports it as missing
// evidence is over-reading it.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

// roadmap.js requires this module at load time, so requiring it back up here
// would capture a half-built exports object. Same deferred-require shape
// roadmap-doctor.js uses; Node's module cache makes the call a map lookup.
function roadmap() {
  return require("./roadmap");
}

// Every git read in this module: fail-soft, never throws. null means git could
// not answer at all (absent binary, not a repo, unknown object) -- which the
// callers keep distinct from an empty answer.
function gitRead(cwd, args) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 8 * 1024 * 1024,
      // A hook runs this on the completion path; a hung git must not hang the
      // session, so a timeout is a failed read like any other.
      timeout: 30000,
    });
  } catch {
    return null;
  }
}

// Both caches are keyed by root and live for the process, which is exactly one
// CLI invocation or one hook run -- every Foreman consumer is a short-lived
// process. They exist because `list --ids` asks about several entries at once
// and each answer would otherwise re-run the same history scan.
const scopesCache = new Map();
const trailerCache = new Map();

/**
 * The project repo, then every submodule declared in .gitmodules. ROADMAP.jsonl
 * lives at the project root, but the commit an entry records may sit inside a
 * submodule and be invisible to the root repo -- so every lookup that asks git
 * about a Foreman commit walks this list instead of assuming the root. Read
 * from .gitmodules, so no submodule has to be initialized for the walk to work.
 * `prefix` is the submodule's path, so a file it names reads the way `touches`
 * does.
 */
function repoScopes(root) {
  if (!scopesCache.has(root)) {
    scopesCache.set(root, [
      { cwd: root, prefix: "" },
      ...roadmap()
        .submodulePaths(root)
        .map((sub) => ({ cwd: path.join(root, sub), prefix: sub })),
    ]);
  }
  return scopesCache.get(root);
}

/**
 * Run one git file-listing command at the root, then in each submodule until
 * one yields files, prefixing a submodule's paths so they read exactly the way
 * `touches` does. The walk roadmap.js's touches derivation has always used --
 * now shared rather than reimplemented per lookup.
 */
function filesFromGit(root, args, keep) {
  for (const { cwd, prefix } of repoScopes(root)) {
    const out = gitRead(cwd, args);
    const files = (out === null ? [] : out.split("\n").map((line) => line.trim())).filter(keep);
    if (files.length) return prefix ? files.map((file) => `${prefix}/${file}`) : files;
  }
  return [];
}

// Windows path comparison needs realpath + case-insensitive compare, same
// normalization spirit as roadmap-lock.js's resolvedProjectPath -- kept
// local since nothing else here needs that module's lock-file machinery.
function normalizedPath(p) {
  let resolved = path.resolve(p);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // best effort -- a path git could not confirm still compares by string
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

/**
 * Which repoScopes(root) entry a hook event's own cwd belongs to -- the
 * answer to "did the commit that fired this hook even land in a repo this
 * project owns". `cwd` (the hook input's own working directory) is resolved
 * to its git toplevel -- fail-soft, no git / not a repo -> null -- and
 * matched against the root and every declared submodule. null either way
 * means the commit is some other repository's business, not this project's:
 * a caller that gets null should stay silent rather than assume the root.
 */
function resolveHookScope(root, cwd) {
  const toplevel = gitRead(cwd, ["rev-parse", "--show-toplevel"]);
  if (!toplevel || !toplevel.trim()) return null;
  const target = normalizedPath(toplevel.trim());
  return repoScopes(root).find((scope) => normalizedPath(scope.cwd) === target) || null;
}

// The sha shape git can be asked to look up. Same 7..64 hex window
// --baseline guard uses, so there is one answer to "is that even a sha".
const SHA_RE = /^[0-9a-fA-F]{7,64}$/;

/**
 * Where a recorded sha lives, if anywhere.
 * `{sha, exists, full?, in_submodule?}` -- `full` is what git resolved it to,
 * so a short sha and the full sha it abbreviates are one fact rather than two.
 * `in_submodule` names the submodule path when the commit lives there.
 * Never throws: an unknown sha, a non-git project, or no git at all all come
 * back `exists: false`.
 */
function resolveSha(root, sha) {
  const recorded = String(sha === undefined || sha === null ? "" : sha).trim();
  const fact = { sha: recorded, exists: false };
  if (!SHA_RE.test(recorded)) return fact;
  for (const { cwd, prefix } of repoScopes(root)) {
    const full = gitRead(cwd, ["rev-parse", "--verify", `${recorded}^{commit}`]);
    if (full && full.trim()) {
      fact.exists = true;
      fact.full = full.trim();
      if (prefix) fact.in_submodule = prefix;
      return fact;
    }
  }
  return fact;
}

/**
 * The shas an entry records, non-empty strings only. Pure -- no git -- because
 * the write gate validates every mutation through the doctor and must not pay
 * for a history scan. This is the one reading of `commits[]`, so a view that
 * only counts and a view that resolves agree on what is in the list.
 */
function recordedCommits(entry) {
  const commits = entry && Array.isArray(entry.commits) ? entry.commits : [];
  return commits
    .filter((sha) => typeof sha === "string" && sha.trim())
    .map((sha) => sha.trim());
}

// The lines a commit message offers as Foreman trailers, before any grammar is
// applied. Separate from trailerIdsIn on purpose: an attest needs to know a
// second `Foreman:` line existed even when it parses to no ids.
function trailerLinesIn(message) {
  return String(message === undefined || message === null ? "" : message)
    .split(/\r?\n/)
    .filter((line) => /^foreman:/i.test(line));
}

/**
 * The strict per-commit reading, deliberately narrower than trailerIdsIn:
 * exactly one `Foreman:` line, exactly this entry's canonical trailer, exactly
 * one id, and that id. General parsing accepts multi-id trailers
 * (`Foreman: 041, 042`) because a hand-written commit legitimately closes two
 * entries; an attested unit does not, because that commit is the unit's single
 * claim about which entry it closes. Both readings live here so the difference
 * is a named choice rather than two copies drifting apart.
 */
function hasExactTrailer(message, id) {
  const lines = trailerLinesIn(message);
  const ids = roadmap().trailerIdsIn(message);
  return (
    lines.length === 1
    && lines[0] === roadmap().commitTrailerFor(id)
    && ids.length === 1
    && ids[0] === String(id)
  );
}

// id -> [sha], from one pass over every repo's history. null when no repo could
// be read at all, which callers keep distinct from "no commit names it": the
// close gate must never block on infrastructure failure.
function trailerIndex(root) {
  if (trailerCache.has(root)) return trailerCache.get(root);
  const index = new Map();
  let answered = false;
  for (const { cwd } of repoScopes(root)) {
    const out = gitRead(cwd, ["log", "--grep=Foreman:", "--format=%h%x00%B%x1e"]);
    if (out === null) continue;
    answered = true;
    for (const record of out.split("\x1e")) {
      const [sha, body] = record.split("\x00");
      if (!sha || !sha.trim() || !body) continue;
      for (const id of roadmap().trailerIdsIn(body)) {
        if (!index.has(id)) index.set(id, []);
        index.get(id).push(sha.trim());
      }
    }
  }
  const result = answered ? index : null;
  trailerCache.set(root, result);
  return result;
}

/**
 * Commits whose message names this entry in a `Foreman: <id>` trailer -- the
 * staged close's inverse pointer. Candidates come from a loose --grep, then
 * every message is verified with the canonical trailerIdsIn grammar. Searched
 * in the project repo AND its submodules, because that is where a Foreman
 * commit may actually live. null on total git failure, [] when no commit names
 * the id -- callers distinguish the two.
 */
function trailerShasFor(root, id) {
  const index = trailerIndex(root);
  if (index === null) return null;
  return index.get(String(id)) || [];
}

/**
 * Combined patch text for a set of recorded shas, each shown from whichever
 * repo actually holds it. null when nothing could be shown -- the caller's
 * signal that git, not the code, is what failed.
 */
function showCommits(root, shas) {
  const parts = [];
  for (const sha of shas) {
    const where = resolveSha(root, sha);
    if (!where.exists) continue;
    const cwd = where.in_submodule ? path.join(root, where.in_submodule) : root;
    const patch = gitRead(cwd, ["show", "--pretty=format:", where.full]);
    if (patch !== null) parts.push(patch);
  }
  return parts.length ? parts.join("\n") : null;
}

/**
 * Every commit fact one entry carries, as one reading.
 * `recorded` answers "does this sha resolve, and where" for each stored sha.
 * `trailer_shas` answers the same question from the other direction: commits
 * whose message names this entry (null when git could not be asked at all).
 */
function resolveEntryEvidence(root, entry) {
  return {
    recorded: recordedCommits(entry).map((sha) => resolveSha(root, sha)),
    trailer_shas: entry && entry.id ? trailerShasFor(root, entry.id) : null,
  };
}

/**
 * The one sha an entry's recorded work should be dated by, or null.
 * A recorded sha wins when git can still find it; otherwise the newest commit
 * whose message names the entry, which is all a staged close leaves behind. A
 * rebase splits a recorded sha from its trailer, so falling through to the
 * trailer is the ordinary case rather than the exotic one.
 */
function anchorShaFor(root, entry) {
  const { recorded, trailer_shas: trailerShas } = resolveEntryEvidence(root, entry);
  const found = recorded.filter((fact) => fact.exists);
  if (found.length) return found[found.length - 1].full;
  // git log answers newest-first, so the head of the list is the latest commit
  // that named this entry.
  return Array.isArray(trailerShas) && trailerShas.length ? trailerShas[0] : null;
}

/**
 * Which of `paths` git says changed between `sha` and the working tree.
 *
 * `{state: "fresh"|"stale"|"unknown", changed, checked}`. Every failure --
 * no git, a sha nothing resolves, a sha off this history line, a diff git
 * would not run -- comes back "unknown" and never "fresh": a lead nobody can
 * date is not a lead anybody should trust.
 *
 * Deliberately no `-M`. Without it a renamed anchor path reports as deleted,
 * which is exactly the "this moved, do not follow it" signal a caller wants.
 * `-z` defeats core.quotepath, so a non-ASCII path comes back verbatim.
 */
function changedSince(root, sha, paths) {
  const wanted = (Array.isArray(paths) ? paths : [])
    .filter((p) => typeof p === "string" && p.trim());
  const unknown = { state: "unknown", changed: [], checked: 0 };
  if (!wanted.length) return unknown;

  const where = resolveSha(root, sha);
  if (!where.exists) return unknown;

  const prefix = where.in_submodule || "";
  const cwd = prefix ? path.join(root, prefix) : root;

  // Off the current history line -- a divergent branch, a squash-merge -- makes
  // the diff below meaningless rather than clean.
  if (gitRead(cwd, ["merge-base", "--is-ancestor", where.full, "HEAD"]) === null) return unknown;

  // filesFromGit re-prefixes what a submodule's git hands back. The pathspecs
  // going in need the mirror of that: without de-prefixing, a submodule diff
  // matches nothing and reads fresh forever.
  const scoped = [];
  for (const p of wanted) {
    if (!prefix) scoped.push(p);
    else if (p === prefix) scoped.push(".");
    else if (p.startsWith(`${prefix}/`)) scoped.push(p.slice(prefix.length + 1));
  }
  if (!scoped.length) return unknown;

  const out = gitRead(cwd, ["diff", "--name-only", "-z", where.full, "--", ...scoped]);
  if (out === null) return unknown;

  const changed = out.split("\0").map((f) => f.trim()).filter(Boolean)
    .map((f) => (prefix ? `${prefix}/${f}` : f));
  return {
    state: changed.length ? "stale" : "fresh",
    changed,
    checked: scoped.length,
  };
}

/**
 * The compact form a status view reports.
 * `commit_count`   shas the entry records.
 * `resolved_count` how many of those git found, here or in a submodule.
 * `unresolved`     the ones it did not -- "not resolvable from here", which is
 *                  a question (rewritten history, unfetched submodule, no git),
 *                  not a verdict that the commit never existed.
 * `has_trailer_match` whether any commit's message names this entry, which is
 *                  the only evidence a staged close leaves.
 */
function evidenceSummary(root, entry) {
  const { recorded, trailer_shas: trailerShas } = resolveEntryEvidence(root, entry);
  return {
    commit_count: recorded.length,
    resolved_count: recorded.filter((fact) => fact.exists).length,
    unresolved: recorded.filter((fact) => !fact.exists).map((fact) => fact.sha),
    has_trailer_match: Array.isArray(trailerShas) && trailerShas.length > 0,
  };
}

module.exports = {
  repoScopes,
  filesFromGit,
  resolveHookScope,
  resolveSha,
  recordedCommits,
  trailerLinesIn,
  hasExactTrailer,
  trailerShasFor,
  showCommits,
  resolveEntryEvidence,
  anchorShaFor,
  changedSince,
  evidenceSummary,
  SHA_RE,
};
