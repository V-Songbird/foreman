# One package for Claude Code and Codex

`main` is Foreman's package branch: one plugin for Claude Code and Codex. It is
not documentation-only. Make changes on a topic branch and merge them into
`main` through a pull request. The separate releases ended with 2.7.0 and
3.0.4-codex.1, and their `Claude` and `Codex` branches were deleted on
2026-09-15. This repository is Foundry's Foreman submodule.

Keep one runtime, one `skills/` tree with the five skills, one
`prompt-template.md`, one README and one CHANGELOG. Claude Code reads
`.claude-plugin/plugin.json` and `hooks/hooks.json`. Codex reads
`.codex-plugin/plugin.json`, whose `hooks` field names `hooks/codex-hooks.json`.
Register each host's events only in its own hook file. Code that behaves
differently per host asks `scripts/runtime.js` which host is running; handoff
wording that differs per host is a `host="claude"` or `host="codex"` block in
`prompt-template.md`. Use each host's actual capabilities and document gaps
instead of inventing tool APIs or lifecycle events. Inherit the executing model
unless the user chooses one.

Reviewed increments stay a Codex feature until the owner decides otherwise.
The shared assembler accepts review rows on both hosts, but Claude Code's
skills do not offer the protocol, and the documentation says it is not
available in Claude Code yet.

Preserve roadmap format 2 and records written by either host. Keep scripts
dependency-free Node.js. One version covers both hosts: bump it in both
`.claude-plugin/plugin.json` and `.codex-plugin/plugin.json` in the release
commit, and a test keeps the two equal. Foundry's catalogs carry no version for
Foreman; both pin the same `main` commit, and a release only moves their
`source.sha`.

Run `node --test tests/*.test.js` for runtime changes, and exercise changed
hooks on Windows as well as Unix. Validate the manifests and edited skills with
each host's validator when it is available. Do not install the plugin, alter a
marketplace or start model sessions as a side effect of running tests.
