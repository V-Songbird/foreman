"use strict";

const { afterEach, describe, test } = require("node:test");
const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  lockPathForRoot,
  withRoadmapLock,
} = require("../scripts/roadmap-lock");

const temporaryPaths = [];

function makeTemporaryDirectory(label) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), `${label}-`));
  temporaryPaths.push(directory);
  return directory;
}

function waitForChild(child) {
  return new Promise((resolve, reject) => {
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`child exited ${code ?? signal}: ${stderr}`));
      }
    });
  });
}

// Both prefixes, deliberately: filtering on `claim-` alone would let a leaked
// `staging-` directory pass every emptiness assertion in this file.
function activeClaims(lockPath) {
  if (!fs.existsSync(lockPath)) return [];
  return fs.readdirSync(lockPath, { withFileTypes: true })
    .filter((item) => item.isDirectory()
      && (item.name.startsWith("claim-") || item.name.startsWith("staging-")))
    .map((item) => path.join(lockPath, item.name));
}

function writeAbandonedClaim(lockPath, pid, token, { choosing = false } = {}) {
  fs.mkdirSync(lockPath, { recursive: true });
  const claimPath = path.join(lockPath, `claim-${pid}-${token}`);
  fs.mkdirSync(claimPath);
  fs.writeFileSync(
    path.join(claimPath, "owner.json"),
    JSON.stringify({
      pid,
      timestamp: Date.now(),
      token,
    }),
    "utf8"
  );
  if (!choosing) {
    fs.writeFileSync(
      path.join(claimPath, "ticket.json"),
      JSON.stringify({ number: 1, token }),
      "utf8"
    );
  }
  return claimPath;
}

afterEach(() => {
  for (const target of temporaryPaths.splice(0)) {
    const lockPath = lockPathForRoot(target);
    fs.rmSync(lockPath, { recursive: true, force: true });
    for (const sibling of fs.readdirSync(path.dirname(lockPath))) {
      if (sibling.startsWith(`${path.basename(lockPath)}.`)) {
        fs.rmSync(path.join(path.dirname(lockPath), sibling), {
          recursive: true,
          force: true,
        });
      }
    }
    fs.rmSync(target, { recursive: true, force: true });
  }
});

describe("withRoadmapLock", () => {
  test("stores project-specific owner metadata outside the project", () => {
    const project = makeTemporaryDirectory("foreman-lock-owner");
    const expectedLockPath = lockPathForRoot(project);

    withRoadmapLock(project, () => {
      assert.equal(path.dirname(expectedLockPath), os.tmpdir());
      assert.ok(fs.statSync(expectedLockPath).isDirectory());
      const claims = activeClaims(expectedLockPath);
      assert.equal(claims.length, 1);

      const owner = JSON.parse(
        fs.readFileSync(path.join(claims[0], "owner.json"), "utf8")
      );
      assert.equal(owner.pid, process.pid);
      assert.equal(typeof owner.timestamp, "number");
      assert.ok(owner.timestamp <= Date.now());
      assert.equal(typeof owner.token, "string");
      assert.ok(owner.token.length > 0);
      assert.ok(owner.process_identity);
      const realProject = fs.realpathSync.native(project);
      const expectedProject = process.platform === "win32"
        ? realProject.toLowerCase()
        : realProject;
      assert.equal(owner.project, expectedProject);
    });

    assert.deepEqual(activeClaims(expectedLockPath), []);
  });

  test("serializes concurrent child processes without losing an update", { timeout: 10000 }, async () => {
    const project = makeTemporaryDirectory("foreman-lock-shared");
    const counterPath = path.join(project, "counter.txt");
    const modulePath = path.resolve(__dirname, "../scripts/roadmap-lock.js");
    fs.writeFileSync(counterPath, "0", "utf8");

    const worker = `
      const fs = require("node:fs");
      const { withRoadmapLock } = require(process.argv[1]);
      const root = process.argv[2];
      const counter = process.argv[3];
      withRoadmapLock(root, () => {
        const value = Number(fs.readFileSync(counter, "utf8"));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75);
        fs.writeFileSync(counter, String(value + 1), "utf8");
      });
    `;

    const children = Array.from({ length: 5 }, () =>
      spawn(process.execPath, ["-e", worker, modulePath, project, counterPath], {
        stdio: ["ignore", "ignore", "pipe"],
      })
    );
    const results = await Promise.allSettled(children.map(waitForChild));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;

    assert.equal(fs.readFileSync(counterPath, "utf8"), "5");
    assert.deepEqual(activeClaims(lockPathForRoot(project)), []);
  });

  test("roadmap mutation commands automatically share the same lock", { timeout: 10000 }, async () => {
    const project = makeTemporaryDirectory("foreman-lock-roadmap");
    const roadmapModule = path.resolve(__dirname, "../scripts/roadmap.js");
    const worker = `
      const { cmdAdd } = require(process.argv[1]);
      const root = process.argv[2];
      const n = process.argv[3];
      cmdAdd(root, { title: "task-" + n, why: "why", what: "what", source: "user" });
    `;
    const children = Array.from({ length: 5 }, (_, index) =>
      spawn(process.execPath, ["-e", worker, roadmapModule, project, String(index)], {
        stdio: ["ignore", "ignore", "pipe"],
      })
    );

    const results = await Promise.allSettled(children.map(waitForChild));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;

    const lines = fs
      .readFileSync(path.join(project, "ROADMAP.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
      // Line 1 is the format marker every write stamps, not an entry.
      .filter((row) => row.id !== undefined);
    assert.equal(lines.length, 5);
    assert.deepEqual(lines.map((entry) => entry.id).sort(), ["001", "002", "003", "004", "005"]);
  });

  test("recovers a lock owned by a process that has exited", () => {
    const project = makeTemporaryDirectory("foreman-lock-stale");
    const lockPath = lockPathForRoot(project);
    const exitedChild = spawnSync(process.execPath, ["-e", ""]);
    assert.equal(exitedChild.status, 0);
    assert.ok(Number.isSafeInteger(exitedChild.pid));

    writeAbandonedClaim(lockPath, exitedChild.pid, "abandoned");

    const result = withRoadmapLock(project, () => "recovered");

    assert.equal(result, "recovered");
    assert.deepEqual(activeClaims(lockPath), []);
  });

  test("serializes contenders recovering the same abandoned owner", { timeout: 10000 }, async () => {
    const project = makeTemporaryDirectory("foreman-lock-recovery-race");
    const lockPath = lockPathForRoot(project);
    const counterPath = path.join(project, "counter.txt");
    const modulePath = path.resolve(__dirname, "../scripts/roadmap-lock.js");
    const exitedChild = spawnSync(process.execPath, ["-e", ""]);
    assert.equal(exitedChild.status, 0);

    fs.writeFileSync(counterPath, "0", "utf8");
    writeAbandonedClaim(lockPath, exitedChild.pid, "shared-abandoned-owner", {
      choosing: true,
    });

    const worker = `
      const fs = require("node:fs");
      const { withRoadmapLock } = require(process.argv[1]);
      const root = process.argv[2];
      const counter = process.argv[3];
      withRoadmapLock(root, () => {
        const value = Number(fs.readFileSync(counter, "utf8"));
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60);
        fs.writeFileSync(counter, String(value + 1), "utf8");
      }, { waitMs: 4000, retryMs: 5 });
    `;
    const children = Array.from({ length: 6 }, () =>
      spawn(process.execPath, ["-e", worker, modulePath, project, counterPath], {
        stdio: ["ignore", "ignore", "pipe"],
      })
    );

    const results = await Promise.allSettled(children.map(waitForChild));
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;

    assert.equal(fs.readFileSync(counterPath, "utf8"), "6");
    assert.deepEqual(activeClaims(lockPath), []);
  });

  test("recovers an abandoned claim even when its pid has been reused", () => {
    const project = makeTemporaryDirectory("foreman-lock-pid-reuse");
    const lockPath = lockPathForRoot(project);
    let currentIdentity;
    withRoadmapLock(project, () => {
      const [liveClaim] = activeClaims(lockPath);
      const liveOwner = JSON.parse(
        fs.readFileSync(path.join(liveClaim, "owner.json"), "utf8")
      );
      currentIdentity = liveOwner.process_identity;
    });
    const claimPath = writeAbandonedClaim(
      lockPath,
      process.pid,
      "reused-pid-owner"
    );
    const ownerPath = path.join(claimPath, "owner.json");
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    owner.process_identity = currentIdentity.kind === "epoch-ms"
      ? { kind: "epoch-ms", value: 0 }
      : { kind: currentIdentity.kind, value: `${currentIdentity.value}-reused` };
    fs.writeFileSync(ownerPath, JSON.stringify(owner), "utf8");

    const result = withRoadmapLock(
      project,
      () => "recovered",
      { staleMs: 0 }
    );

    assert.equal(result, "recovered");
    assert.deepEqual(activeClaims(lockPath), []);
  });

  test("does not remove a live claim whose identity kind is incomparable", () => {
    const project = makeTemporaryDirectory("foreman-lock-identity-kind");
    const lockPath = lockPathForRoot(project);
    const claimPath = writeAbandonedClaim(
      lockPath,
      process.pid,
      "live-incomparable-owner"
    );
    const ownerPath = path.join(claimPath, "owner.json");
    const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
    owner.process_identity = { kind: "different-mechanism", value: "unknown" };
    fs.writeFileSync(ownerPath, JSON.stringify(owner), "utf8");

    assert.throws(
      () => withRoadmapLock(
        project,
        () => {},
        { waitMs: 0, staleMs: 0 }
      ),
      (err) => err.code === "FOREMAN_ROADMAP_LOCK_TIMEOUT"
    );
    assert.ok(fs.existsSync(claimPath));
  });

  test("publishes only locks that already contain complete owner metadata", () => {
    const project = makeTemporaryDirectory("foreman-lock-publish");
    const lockPath = lockPathForRoot(project);

    withRoadmapLock(project, () => {
      const claims = activeClaims(lockPath);
      assert.equal(claims.length, 1);
      const ownerPath = path.join(claims[0], "owner.json");
      assert.ok(fs.existsSync(ownerPath));
      const owner = JSON.parse(fs.readFileSync(ownerPath, "utf8"));
      assert.equal(owner.pid, process.pid);
      assert.ok(owner.token);
      const ticket = JSON.parse(
        fs.readFileSync(path.join(claims[0], "ticket.json"), "utf8")
      );
      assert.ok(Number.isSafeInteger(ticket.number));
    }, { staleMs: 0 });
  });

  test("recovers when container creation reports a concurrent removal", (t) => {
    const project = makeTemporaryDirectory("foreman-lock-container-race");
    const lockPath = lockPathForRoot(project);
    const mkdirSync = fs.mkdirSync;
    let interrupted = false;
    let mutations = 0;
    t.mock.method(fs, "mkdirSync", (target, options) => {
      if (target === lockPath && !interrupted) {
        interrupted = true;
        throw Object.assign(new Error("container removed during mkdir"), { code: "ENOENT" });
      }
      return mkdirSync(target, options);
    });

    withRoadmapLock(project, () => {
      mutations++;
      const [claim] = activeClaims(lockPath);
      assert.ok(JSON.parse(fs.readFileSync(path.join(claim, "owner.json"), "utf8")).token);
      assert.ok(JSON.parse(fs.readFileSync(path.join(claim, "ticket.json"), "utf8")).number);
    });

    assert.equal(interrupted, true);
    assert.equal(mutations, 1);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test("recovers repeated container removals before staging is created", (t) => {
    const project = makeTemporaryDirectory("foreman-lock-repeated-container-race");
    const lockPath = lockPathForRoot(project);
    const mkdirSync = fs.mkdirSync;
    let removals = 0;
    let mutations = 0;
    t.mock.method(fs, "mkdirSync", (target, options) => {
      if (path.dirname(target) === lockPath && removals < 2) {
        fs.rmdirSync(lockPath);
        removals++;
      }
      return mkdirSync(target, options);
    });

    withRoadmapLock(project, () => { mutations++; });

    assert.equal(removals, 2);
    assert.equal(mutations, 1);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test("bounds persistent publication ENOENT by the acquisition deadline", (t) => {
    const project = makeTemporaryDirectory("foreman-lock-publication-timeout");
    const lockPath = lockPathForRoot(project);
    const mkdirSync = fs.mkdirSync;
    const now = Date.now;
    const startedAt = now();
    let elapsed = 0;
    let attempts = 0;
    t.mock.method(Date, "now", () => startedAt + elapsed);
    t.mock.method(fs, "mkdirSync", (target, options) => {
      if (target === lockPath) {
        attempts++;
        elapsed += 10;
        throw Object.assign(new Error("container repeatedly removed"), { code: "ENOENT" });
      }
      return mkdirSync(target, options);
    });

    assert.throws(
      () => withRoadmapLock(project, () => assert.fail("mutation must not run"), {
        waitMs: 30,
        retryMs: 1,
      }),
      (err) => {
        assert.equal(err.code, "FOREMAN_ROADMAP_LOCK_TIMEOUT");
        assert.equal(err.lockPath, lockPath);
        assert.match(err.message, /timed out after 30ms/);
        return true;
      }
    );
    assert.equal(attempts, 3);
    assert.equal(fs.existsSync(lockPath), false);
  });

  test("propagates publication errors other than ENOENT without retrying", (t) => {
    const project = makeTemporaryDirectory("foreman-lock-publication-error");
    const lockPath = lockPathForRoot(project);
    const mkdirSync = fs.mkdirSync;
    const denied = Object.assign(new Error("access denied"), { code: "EACCES" });
    let attempts = 0;
    t.mock.method(fs, "mkdirSync", (target, options) => {
      if (target === lockPath) {
        attempts++;
        throw denied;
      }
      return mkdirSync(target, options);
    });

    assert.throws(
      () => withRoadmapLock(project, () => assert.fail("mutation must not run")),
      (err) => err === denied
    );
    assert.equal(attempts, 1);
  });

  test("removes its lock when the mutation throws", () => {
    const project = makeTemporaryDirectory("foreman-lock-throw");
    const lockPath = lockPathForRoot(project);

    assert.throws(
      () =>
        withRoadmapLock(project, () => {
          throw new Error("mutation failed");
        }),
      /mutation failed/
    );
    assert.deepEqual(activeClaims(lockPath), []);
  });

  test("leaves no lock directory behind once the last holder releases", () => {
    const project = makeTemporaryDirectory("foreman-lock-teardown");
    const lockPath = lockPathForRoot(project);

    withRoadmapLock(project, () => {
      assert.ok(fs.existsSync(lockPath));
    });

    assert.equal(fs.existsSync(lockPath), false);
  });

  test("sweeps a staging directory orphaned between mkdir and rename", () => {
    const project = makeTemporaryDirectory("foreman-lock-staging");
    const lockPath = lockPathForRoot(project);
    const orphan = path.join(lockPath, "staging-999999-abandoned");
    fs.mkdirSync(orphan, { recursive: true });
    fs.writeFileSync(
      path.join(orphan, "owner.json"),
      JSON.stringify({ pid: 999999, token: "abandoned" }),
      "utf8"
    );
    assert.deepEqual(activeClaims(lockPath), [orphan]);

    withRoadmapLock(project, () => {}, { staleMs: 0 });

    assert.equal(fs.existsSync(orphan), false);
  });

  test("does not make distinct project roots contend", () => {
    const first = makeTemporaryDirectory("foreman-lock-first");
    const second = makeTemporaryDirectory("foreman-lock-second");
    assert.notEqual(lockPathForRoot(first), lockPathForRoot(second));

    withRoadmapLock(first, () => {
      withRoadmapLock(
        second,
        () => {
          assert.ok(fs.existsSync(lockPathForRoot(first)));
          assert.ok(fs.existsSync(lockPathForRoot(second)));
        },
        { waitMs: 0 }
      );
    });
  });

  test("stops waiting at the configured deadline", () => {
    const project = makeTemporaryDirectory("foreman-lock-timeout");
    const startedAt = Date.now();

    withRoadmapLock(project, () => {
      assert.throws(
        () => withRoadmapLock(project, () => {}, { waitMs: 60, retryMs: 10 }),
        (err) => {
          assert.equal(err.code, "FOREMAN_ROADMAP_LOCK_TIMEOUT");
          assert.match(err.message, /timed out after 60ms/);
          return true;
        }
      );
    });

    const elapsed = Date.now() - startedAt;
    assert.ok(elapsed >= 50, `wait returned too early after ${elapsed}ms`);
    assert.ok(elapsed < 500, `wait exceeded its short bound: ${elapsed}ms`);
  });
});
