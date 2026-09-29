"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseFlags, printHelp } = require("./runtime");
const root = path.resolve(__dirname, "..");

// [Foreman: 957] Codex may start commandWindows from cmd or PowerShell, and a
// PowerShell start costs 200-450 ms per hook, so cmd starts Node itself. The
// set keeps cmd from running a node.exe in the working directory.
// [Foreman: 963] cmd's `for` PATH search finds node.exe before Node runs, so
// cmd never prints its not-found text and Node's stderr and exit code reach
// Codex. Without node.exe on PATH, the encoded PowerShell launcher finds Node
// through fnm. The search reads a copy of PATH named .P, because a PowerShell
// parent would expand `$PATH` in the command.
// [Foreman: 959] Node runs last, so cmd ends with Node's exit code.
function build(source, hook) {
  if (!/^[a-z-]+\.js$/.test(hook)) throw Error("Invalid hook entry point");
  const inline = `try{require(require('path').join(process.env.PLUGIN_ROOT,'hooks','${hook}')).main()}catch{}`;
  // Unquoted inside cmd's quotes, with delayed expansion on, the script must
  // hold nothing cmd or PowerShell rewrites.
  if (/[\s"$%`!]/.test(inline)) throw Error("Inline hook script needs quoting");
  const script = source.replace(/\r\n/g, "\n").replaceAll("__FOREMAN_HOOK__", hook);
  const fallback = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
  return `cmd /d /s /v:on /c "set NoDefaultCurrentDirectoryInExePath=1&& set .N=&& set .P=!PATH!&& (for %i in (node.exe) do @set .N=%~$.P:i)& set .P=& if not defined .N (${fallback}) else node -e ${inline}"`;
}

function main(write = false) {
  const file = path.join(root, "hooks/codex-hooks.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const source = fs.readFileSync(path.join(root, "hooks/windows-launcher.ps1"), "utf8");
  for (const groups of Object.values(config.hooks)) for (const group of groups) for (const handler of group.hooks) {
    const match = handler.command.match(/'hooks','([a-z-]+\.js)'/);
    if (!match) throw Error("Unknown hook command shape");
    const expected = build(source, match[1]);
    // build() repeats the -e body of command; an edit to either copy fails here.
    const body = handler.command.match(/^node -e "(.*)"$/)?.[1];
    if (!expected.endsWith(` else node -e ${body}"`)) throw Error("Windows inline script differs from the command for " + match[1]);
    if (write) handler.commandWindows = expected;
    else if (handler.commandWindows !== expected) throw Error("Regenerate the Windows launcher for " + match[1]);
  }
  if (write) fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

const USAGE = `build-windows-launchers.js [--write] -- checks that each commandWindows in
hooks/codex-hooks.json is the one this script builds, with
hooks/windows-launcher.ps1 as its fallback, and fails naming the first stale
hook. --write regenerates them in place.
`;

module.exports = { build, main };
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (!printHelp(argv, USAGE)) main(parseFlags("build-windows-launchers.js", { write: "switch" }, argv).write === true);
}
