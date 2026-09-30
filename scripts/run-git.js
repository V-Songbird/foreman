"use strict";

// [Foreman: 967] The Codex desktop app's Windows sandbox refuses a child
// process whose output is a pipe (spawnSync git EPERM) and allows one that
// writes to files, so a refused spawn runs again with stdout and stderr in
// temporary files. The rerun fails the way execFileSync would.
// [Foreman: 974] Every Foreman git call goes through here, so a close, its
// attestation and the post-commit hook read Git in that sandbox too.

const fs = require("fs");
const os = require("os");
const path = require("path");
// Called through the module object, so a test that mocks child_process
// reaches every caller however early this module loaded.
const childProcess = require("child_process");

function runGit(root, args, options = {}) {
  try {
    return childProcess.execFileSync("git", args, { cwd: root, ...options });
  } catch (error) {
    if (error.code !== "EPERM") throw error;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "foreman-git-"));
  try {
    const [outFile, errFile] = [path.join(dir, "out"), path.join(dir, "err")];
    const [out, err] = [fs.openSync(outFile, "w"), fs.openSync(errFile, "w")];
    let result;
    try {
      result = childProcess.spawnSync("git", args, { cwd: root, stdio: ["ignore", out, err], timeout: options.timeout });
    } finally {
      fs.closeSync(out);
      fs.closeSync(err);
    }
    if (result.error) throw result.error;
    if (result.status !== 0) {
      const stderr = fs.readFileSync(errFile, "utf-8");
      throw Object.assign(new Error(`Command failed: git ${args.join(" ")}\n${stderr}`), {
        status: result.status,
        stderr,
      });
    }
    return fs.readFileSync(outFile, options.encoding === "buffer" ? undefined : options.encoding);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { runGit };
