"use strict";

// The two helpers every Foreman hook shares. Hook stdin is the harness's
// one delivery channel and a hook must never die on bad input, so both
// read failures collapse to {}; projectDir resolves the same way in every
// hook so all of them agree on which project a payload belongs to. The
// tmpdir latches deliberately stay local to each hook — their key
// semantics differ per hook, so there is nothing shared to extract there.

const fs = require("fs");
const path = require("path");

function readInput() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    return {};
  }
  try {
    return JSON.parse(raw || "{}");
  } catch {
    return {};
  }
}

function projectDir(data) {
  return path.resolve(process.env.CLAUDE_PROJECT_DIR || data.cwd || process.cwd());
}

module.exports = { readInput, projectDir };
