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

// [Foreman: 1124] Codex and Antigravity run a Bash command in PowerShell on
// Windows, where `<<` does not parse, so each heredoc wording carries this.
const POWERSHELL_HEREDOC = "in PowerShell, pipe a literal here-string `@'...'@` into the command instead";

// [Foreman: 828] The duplicate check both commit-time wordings carry, Claude
// Code's and a delegated session's.
function duplicateCheckStep(scriptPath) {
  return (
    "Every candidate MUST go through the duplicate check before you offer or report it — the roadmap's " +
    "existing entries are deliberately not in your context, so this call is " +
    `the only thing between a suggestion and a duplicate (a quoted heredoc keeps an apostrophe as written; ${POWERSHELL_HEREDOC}):\n` +
    `node "${scriptPath}" check-duplicate <<'EOF'\n{"title":"...","why":"..."}\nEOF\n` +
    "Matches carry each entry's status. A rejected match means the user " +
    "already declined it: skip silently. Any other status (planned/" +
    "in_progress/done/...) means it's already tracked: skip it, or mention " +
    "the existing entry's id if the new observation adds something."
  );
}

// [Foreman: 825, 828] A session delegatedAcceptance lists gets this in place
// of the ask-the-user policy, after a commit and at a Codex checkpoint alike.
function delegatedDiscoveryInstructions(orchestrator, host, scriptPath) {
  return (
    "[Foreman] Roadmap discovery is enabled for this project. Scan this " +
    "session's work for CONFIRMED opportunities, bugs, or ideas — not vague " +
    "hunches — and for work it already did beyond its entry's `what`. " +
    duplicateCheckStep(scriptPath) + " " +
    `Acceptance for this session belongs to the orchestrator ${orchestrator}, so ` +
    "don't ask the user. A worker lists each unmatched candidate, with its " +
    `evidence, in its report to ${orchestrator}; the orchestrator adds it itself, through a quoted heredoc (${POWERSHELL_HEREDOC}):\n` +
    `node "${scriptPath}" add <<'EOF'\n{"title":"...","why":"...","what":"...","source":"${host}-suggested","status":"planned"}\nEOF\n` +
    "Say nothing if nothing is confirmed."
  );
}

module.exports = { discoveryEnabled, discoveryInstructions, duplicateCheckStep, delegatedDiscoveryInstructions, POWERSHELL_HEREDOC };
