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

function activeClaims(lockPath) {
  if (!fs.existsSync(lockPath)) return [];
  return fs.readdirSync(lockPath, { withFileTypes: true })
    .filter((item) => item.isDirectory() && item.name.startsWith("claim-"))
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
    await Promise.all(children.map(waitForChild));

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

    await Promise.all(children.map(waitForChild));

    const lines = fs
      .readFileSync(path.join(project, "ROADMAP.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map(JSON.parse);
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

    await Promise.all(children.map(waitForChild));

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
