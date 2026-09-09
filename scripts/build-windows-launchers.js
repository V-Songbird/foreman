"use strict";
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

function build(source, hook) {
  if (!/^[a-z-]+\.js$/.test(hook)) throw Error("Invalid hook entry point");
  const script = source.replace(/\r\n/g, "\n").replaceAll("__FOREMAN_HOOK__", hook);
  return "powershell.exe -NoProfile -NonInteractive -EncodedCommand " + Buffer.from(script, "utf16le").toString("base64");
}

function main(write = false) {
  const file = path.join(root, "hooks/hooks.json");
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

module.exports = { build, main };
if (require.main === module) main(process.argv[2] === "--write");
