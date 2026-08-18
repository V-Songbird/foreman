"use strict";

const crypto = require("crypto");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const DEFAULT_WAIT_MS = 2000;
const DEFAULT_RETRY_MS = 25;
const DEFAULT_STALE_MS = 30000;
const OWNER_FILE = "owner.json";
const TICKET_FILE = "ticket.json";

function resolvedProjectPath(root) {
  let resolved = path.resolve(root);
  try {
    resolved = fs.realpathSync.native(resolved);
  } catch {
    // A project can be initialized before its directory is fully populated.
    // path.resolve still gives the lock a deterministic identity.
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function lockPathForRoot(root) {
  const project = resolvedProjectPath(root);
  const digest = crypto.createHash("sha256").update(project).digest("hex");
  return path.join(os.tmpdir(), `foreman-roadmap-${digest}.lock`);
}

function sleepSync(milliseconds) {
  if (milliseconds <= 0) return;
  const signal = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(signal, 0, 0, milliseconds);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function processIsAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  if (pid === process.pid) return true;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM means the process exists but this user cannot signal it.
    return err && err.code === "EPERM";
  }
}

function currentProcessIdentity() {
  if (process.platform === "linux") {
    try {
      const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = fs.readFileSync(`/proc/${process.pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      return { kind: "linux-start-tick", value: `${bootId}:${fields[19]}` };
    } catch {
      // Fall through to the portable process.uptime estimate.
    }
  }
  return {
    kind: "epoch-ms",
    value: Math.round(Date.now() - process.uptime() * 1000),
  };
}

const THIS_PROCESS_IDENTITY = currentProcessIdentity();

function processIdentity(pid, deadline = Infinity) {
  if (pid === process.pid) return THIS_PROCESS_IDENTITY;
  if (process.platform === "linux") {
    try {
      const bootId = fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
      const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
      const fields = stat.slice(stat.lastIndexOf(")") + 1).trim().split(/\s+/);
      return { kind: "linux-start-tick", value: `${bootId}:${fields[19]}` };
    } catch {
      return null;
    }
  }

  try {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) return null;
    const timeout = Math.max(1, Math.min(3000, remainingMs));
    if (process.platform === "win32") {
      const script = [
        `$p = Get-Process -Id ${pid} -ErrorAction Stop`,
        "([DateTimeOffset]$p.StartTime.ToUniversalTime()).ToUnixTimeMilliseconds()",
      ].join("; ");
      const value = Number(execFileSync(
        "powershell.exe",
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout }
      ).trim());
      return Number.isFinite(value) ? { kind: "epoch-ms", value } : null;
    }

    const value = Date.parse(execFileSync(
      "ps",
      ["-o", "lstart=", "-p", String(pid)],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout }
    ).trim());
    return Number.isFinite(value) ? { kind: "epoch-ms", value } : null;
  } catch {
    return null;
  }
}

function ownerStillOwnsProcess(owner, staleMs, deadline) {
  if (!owner || !processIsAlive(owner.pid)) return false;
  if (!owner.process_identity) return true;
  // A fresh, live PID cannot be a long-abandoned claim. Defer the
  // platform-specific start-time lookup until the claim is old enough to be
  // suspicious; this keeps ordinary contention cheap.
  if (
    Number.isFinite(owner.timestamp)
    && Date.now() - owner.timestamp < staleMs
  ) {
    return true;
  }
  const actual = processIdentity(owner.pid, deadline);
  if (!actual) return true;
  // Different identity mechanisms are not comparable. This can happen when
  // a process recorded the portable fallback during a transient /proc
  // failure and a later lookup succeeds. Preserve safety and keep waiting.
  if (actual.kind !== owner.process_identity.kind) return true;
  if (actual.kind === "epoch-ms") {
    return Math.abs(actual.value - owner.process_identity.value) <= 2000;
  }
  return actual.value === owner.process_identity.value;
}

function pathAge(target, now = Date.now()) {
  try {
    return Math.max(0, now - fs.statSync(target).mtimeMs);
  } catch {
    return 0;
  }
}

function claimDirectories(lockPath) {
  try {
    return fs.readdirSync(lockPath, { withFileTypes: true })
      .filter((item) => item.isDirectory() && item.name.startsWith("claim-"))
      .map((item) => path.join(lockPath, item.name));
  } catch {
    return [];
  }
}

function stagingDirectories(lockPath) {
  try {
    return fs.readdirSync(lockPath, { withFileTypes: true })
      .filter((item) => item.isDirectory() && item.name.startsWith("staging-"))
      .map((item) => path.join(lockPath, item.name));
  } catch {
    return [];
  }
}

// A hard kill between publishClaim's mkdirSync and its renameSync orphans a
// staging directory that no contention scan will ever look at. Sweep it on the
// same age rule the claim sweep uses: a publish completes in microseconds, so
// anything this old cannot be a live one, and no stat here can race a rename.
function sweepAbandonedStaging(lockPath, staleMs) {
  for (const stagingPath of stagingDirectories(lockPath)) {
    if (pathAge(stagingPath) < staleMs) continue;
    fs.rmSync(stagingPath, { recursive: true, force: true });
  }
}

// The per-project container is created by whoever arrives first and, until
// now, by nobody removed — one orphan per project root that never returns,
// which is every temporary root a test builds. rmdir refuses a non-empty
// directory, so a contender's claim always wins over this cleanup.
function discardEmptyLockContainer(lockPath) {
  try {
    fs.rmdirSync(lockPath);
  } catch {
    // ENOTEMPTY means a contender still holds a claim; ENOENT means another
    // releaser got there first. Both are the normal outcome, not a failure.
  }
}

function removeAbandonedClaim(claimPath, staleMs, deadline = Infinity) {
  const owner = readJson(path.join(claimPath, OWNER_FILE));
  if (owner && Number.isSafeInteger(owner.pid) && owner.pid > 0) {
    if (ownerStillOwnsProcess(owner, staleMs, deadline)) return false;
  } else if (pathAge(claimPath) < staleMs) {
    return false;
  }

  // Claim paths contain a cryptographically random token and are never
  // reused. Removing this exact abandoned path therefore cannot delete a
  // later contender's claim, unlike replacing one shared stale-lock path.
  fs.rmSync(claimPath, { recursive: true, force: true });
  return true;
}

function publishClaim(lockPath, project, token) {
  fs.mkdirSync(lockPath, { recursive: true });
  const claimPath = path.join(lockPath, `claim-${process.pid}-${token}`);
  // The staging directory is deliberately outside the `claim-` prefix that
  // claimDirectories scans. A contender that saw it would stat it and read
  // its owner file, and an open handle inside a directory makes the publish
  // rename below fail with EPERM on Windows.
  const candidatePath = path.join(lockPath, `staging-${process.pid}-${token}`);
  try {
    fs.mkdirSync(candidatePath);
  } catch (err) {
    // A releaser can discard the container between the two mkdirs above.
    // Recreating it and retrying once is the whole recovery.
    if (err.code !== "ENOENT") throw err;
    fs.mkdirSync(lockPath, { recursive: true });
    fs.mkdirSync(candidatePath);
  }
  try {
    fs.writeFileSync(
      path.join(candidatePath, OWNER_FILE),
      `${JSON.stringify({
        pid: process.pid,
        timestamp: Date.now(),
        token,
        project,
        process_identity: THIS_PROCESS_IDENTITY,
      })}\n`,
      { encoding: "utf8", flag: "wx" }
    );
    fs.renameSync(candidatePath, claimPath);
  } catch (err) {
    fs.rmSync(candidatePath, { recursive: true, force: true });
    throw err;
  }
  return claimPath;
}

function chooseTicket(lockPath, claimPath, token, staleMs, deadline) {
  sweepAbandonedStaging(lockPath, staleMs);
  let maximum = 0;
  for (const otherPath of claimDirectories(lockPath)) {
    if (
      otherPath !== claimPath
      && removeAbandonedClaim(otherPath, staleMs, deadline)
    ) {
      continue;
    }
    const ticket = readJson(path.join(otherPath, TICKET_FILE));
    if (ticket && Number.isSafeInteger(ticket.number) && ticket.number > maximum) {
      maximum = ticket.number;
    }
  }

  const number = maximum + 1;
  const ticketPath = path.join(claimPath, TICKET_FILE);
  const candidatePath = `${ticketPath}.${token}.init`;
  fs.writeFileSync(
    candidatePath,
    `${JSON.stringify({ number, token })}\n`,
    { encoding: "utf8", flag: "wx" }
  );
  try {
    fs.renameSync(candidatePath, ticketPath);
  } catch (err) {
    fs.rmSync(candidatePath, { force: true });
    throw err;
  }
  return number;
}

function claimBlocks(otherPath, ownTicket, ownToken, staleMs, deadline) {
  if (removeAbandonedClaim(otherPath, staleMs, deadline)) return false;
  const owner = readJson(path.join(otherPath, OWNER_FILE));
  const ticket = readJson(path.join(otherPath, TICKET_FILE));

  // No ticket means the other contender is still choosing. Waiting here is
  // the bakery-lock rule that prevents two simultaneous starters from each
  // believing they were first.
  if (!owner || !ticket || !Number.isSafeInteger(ticket.number)) return true;
  if (ticket.number < ownTicket) return true;
  return ticket.number === ownTicket && String(ticket.token) < ownToken;
}

function acquireLock(root, options = {}) {
  const waitMs = options.waitMs ?? DEFAULT_WAIT_MS;
  const retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  if (!Number.isFinite(waitMs) || waitMs < 0) {
    throw new TypeError("roadmap lock waitMs must be a non-negative number");
  }
  if (!Number.isFinite(retryMs) || retryMs <= 0) {
    throw new TypeError("roadmap lock retryMs must be a positive number");
  }
  if (!Number.isFinite(staleMs) || staleMs < 0) {
    throw new TypeError("roadmap lock staleMs must be a non-negative number");
  }

  const project = resolvedProjectPath(root);
  const lockPath = lockPathForRoot(project);
  const token = crypto.randomBytes(16).toString("hex");
  const startedAt = Date.now();
  const deadline = startedAt + waitMs;
  let claimPath;

  try {
    claimPath = publishClaim(lockPath, project, token);
    const ticket = chooseTicket(lockPath, claimPath, token, staleMs, deadline);

    while (true) {
      const blocked = claimDirectories(lockPath).some(
          (otherPath) =>
            otherPath !== claimPath
            && claimBlocks(otherPath, ticket, token, staleMs, deadline)
        );
      if (!blocked) return { lockPath, claimPath, token };

      const elapsed = Date.now() - startedAt;
      if (elapsed >= waitMs) {
        const err = new Error(
          `timed out after ${waitMs}ms waiting for another Foreman roadmap mutation`
        );
        err.code = "FOREMAN_ROADMAP_LOCK_TIMEOUT";
        err.lockPath = lockPath;
        throw err;
      }
      sleepSync(Math.min(retryMs, waitMs - elapsed));
    }
  } catch (err) {
    if (claimPath) {
      fs.rmSync(claimPath, { recursive: true, force: true });
      discardEmptyLockContainer(lockPath);
    }
    throw err;
  }
}

function releaseLock(lock) {
  if (!lock) return;
  const owner = readJson(path.join(lock.claimPath, OWNER_FILE));
  // Claim paths are unique, but retain a token check so an externally
  // replaced path is never removed.
  if (owner && owner.token !== lock.token) return;
  fs.rmSync(lock.claimPath, { recursive: true, force: true });
  discardEmptyLockContainer(lock.lockPath);
}

function withRoadmapLock(root, fn, options) {
  if (typeof fn !== "function") {
    throw new TypeError("withRoadmapLock requires a function");
  }
  const lock = acquireLock(root, options);
  try {
    return fn();
  } finally {
    releaseLock(lock);
  }
}

module.exports = {
  DEFAULT_WAIT_MS,
  DEFAULT_RETRY_MS,
  DEFAULT_STALE_MS,
  lockPathForRoot,
  withRoadmapLock,
};
