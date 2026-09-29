"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { parseFlags, printHelp } = require("./runtime");
const root = path.resolve(__dirname, "..");

// [Foreman: 957] Codex may start commandWindows from cmd or PowerShell, and a
// PowerShell start costs 200-450 ms per hook, so cmd starts Node itself. The
// set keeps cmd from running a node.exe in the working directory. A command cmd
// cannot find sets ERRORLEVEL 9009 only after `&`, never inside `||`; then the
// encoded PowerShell launcher finds Node through fnm. 2>nul hides cmd's
// not-found text on that path, and with it Node's stderr, which no hook writes.
function build(source, hook) {
  if (!/^[a-z-]+\.js$/.test(hook)) throw Error("Invalid hook entry point");
  const inline = `try{require(require('path').join(process.env.PLUGIN_ROOT,'hooks','${hook}')).main()}catch{}`;
  // Unquoted inside cmd's quotes, the script must hold nothing cmd or PowerShell rewrites.
  if (/[\s"$%`]/.test(inline)) throw Error("Inline hook script needs quoting");
  const script = source.replace(/\r\n/g, "\n").replaceAll("__FOREMAN_HOOK__", hook);
  const fallback = "powershell.exe -NoLogo -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
  return `cmd /d /s /c "set NoDefaultCurrentDirectoryInExePath=1&& node -e ${inline} 2>nul & if errorlevel 9009 ${fallback}"`;
}

function main(write = false) {
  const file = path.join(root, "hooks/codex-hooks.json");
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  const source = fs.readFileSync(path.join(root, "hooks/windows-launcher.ps1"), "utf8");
  for (const groups of Object.values(config.hooks)) for (const group of groups) for (const handler of group.hooks) {
    const match = handler.command.match(/'hooks','([a-z-]+\.js)'/);
    if (!match) throw Error("Unknown hook command shape");
    const expected = build(source, match[1]);
    if (write) handler.commandWindows = expected;
    else if (handler.commandWindows !== expected) throw Error("Regenerate the Windows launcher for " + match[1]);
  }
  if (write) fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
}

const USAGE = `build-windows-launchers.js [--write] -- checks that each commandWindows in
hooks/codex-hooks.json is the one hooks/windows-launcher.ps1 builds, and fails
naming the first stale hook. --write regenerates them in place.
`;

module.exports = { build, main };
if (require.main === module) {
  const argv = process.argv.slice(2);
  if (!printHelp(argv, USAGE)) main(parseFlags("build-windows-launchers.js", { write: "switch" }, argv).write === true);
}
