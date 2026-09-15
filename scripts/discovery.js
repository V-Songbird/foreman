"use strict";

const fs = require("fs");
const path = require("path");
const { readConfigFile } = require("./foreman-config");

function discoveryEnabled(root) {
  return fs.existsSync(path.join(root, "ROADMAP.jsonl")) &&
    readConfigFile(root).config.discoverySuggestions !== false;
}

// One policy for skill readers, portable handoffs and explicit checkpoints.
function discoveryInstructions() {
  return fs.readFileSync(path.join(__dirname, "../skills/foreman/discovery.md"), "utf8").trim();
}

module.exports = { discoveryEnabled, discoveryInstructions };
