"use strict";

const path = require("path");

const HOSTS = new Set(["claude", "codex", "antigravity"]);

// Which agent host runs this process. FOREMAN_HOST wins so tests and wrappers
// can pin it. Otherwise each host's own markers decide: Codex sets PLUGIN_ROOT
// for plugin hooks and CODEX_THREAD_ID/CODEX_SESSION_ID for shell commands;
// Antigravity's environment carries ANTIGRAVITY_CONVERSATION_ID and
// ANTIGRAVITY_AGENT, and its plugin hooks run through hooks/antigravity-hook.js,
// which pins FOREMAN_HOST. Claude Code sets none of these (its hooks get
// CLAUDE_PLUGIN_ROOT, which Codex also sets for compatibility), so everything
// else is Claude Code, including plain terminal use of these scripts. Codex's
// markers are read first: a Codex session opened from Antigravity's terminal
// inherits that editor's variables.
function detectHost(env = process.env) {
  const forced = String(env.FOREMAN_HOST || "").trim().toLowerCase();
  if (HOSTS.has(forced)) return forced;
  if (env.PLUGIN_ROOT || env.CODEX_THREAD_ID || env.CODEX_SESSION_ID) return "codex";
  return env.ANTIGRAVITY_CONVERSATION_ID || env.ANTIGRAVITY_AGENT ? "antigravity" : "claude";
}

// Explicit project selection wins. Codex hosts need not provide CODEX_CWD;
// ordinary CLI use runs in cwd. Keep the old variable for existing integrations.
function projectDir(env = process.env, cwd = process.cwd()) {
  return path.resolve(env.FOREMAN_PROJECT_DIR || env.CODEX_CWD || env.CLAUDE_PROJECT_DIR || cwd);
}

// [Foreman: 691] Each flag is a switch or takes one value, given as `--flag
// value` or `--flag=value`. An argument no flag claims, a value flag without
// its value and a value on a switch fail too: `list 640` printed the whole
// roadmap and `list --ids 640 641` dropped 641.
// [Foreman: 692] Every Foreman CLI parses its flags here, so a typo such as
// `safe-commit.js finish --no-comit` fails before anything is written instead
// of committing. `valid` maps each flag name to "switch", "value" or "list"
// (a value its command splits on commas); `name` is the command the errors
// name.
// [Foreman: 735] A value flag given twice fails instead of keeping the last:
// `list --ids 691 --ids 999` listed 999 alone.
// [Foreman: 780] Only a "list" flag's error suggests commas; `--limit 3
// --limit 5` would have been steered to a list it does not parse.
function parseFlags(name, valid, argv) {
  const names = Object.keys(valid);
  const validHelp = `Valid flags: ${names.map((f) => `--${f}`).join(", ")}`;
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) {
      throw new Error(
        `unexpected argument for ${name}: ${a}. ` +
          (names.length
            ? `A value goes after its flag (--flag value or --flag=value); join several with commas and quote one that has spaces. ${validHelp}`
            : `${name} takes no arguments`)
      );
    }
    const eq = a.indexOf("=");
    const key = eq === -1 ? a.slice(2) : a.slice(2, eq);
    if (!Object.hasOwn(valid, key)) {
      throw new Error(`unknown flag for ${name}: --${key}. ` + (names.length ? validHelp : `${name} takes no flags`));
    }
    if (valid[key] === "switch") {
      if (eq !== -1) throw new Error(`unexpected value for ${name}: ${a}. --${key} is a switch and takes no value`);
      flags[key] = true;
      continue;
    }
    if (Object.hasOwn(flags, key)) {
      throw new Error(
        `repeated flag for ${name}: --${key}. Give --${key} once` +
          (valid[key] === "list" ? "; join several values with commas in that one value" : ".")
      );
    }
    let value;
    if (eq !== -1) value = a.slice(eq + 1);
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) value = argv[++i];
    if (!value) throw new Error(`missing value for ${name}: --${key}. Give it as --${key} <value> or --${key}=<value>`);
    flags[key] = value;
  }
  return flags;
}

// [Foreman: 779] `--help` anywhere among a CLI's arguments prints its usage to
// stdout and runs nothing, the way `roadmap.js <subcommand> --help` does. Call
// it before parseFlags, so --help wins over every other flag, good or bad.
function printHelp(argv, usage) {
  if (!argv.includes("--help")) return false;
  process.stdout.write(usage.endsWith("\n") ? usage : usage + "\n");
  return true;
}

module.exports = { HOSTS, detectHost, projectDir, parseFlags, printHelp };
