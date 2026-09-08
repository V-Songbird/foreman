# Working on the Codex port

Work on `Codex` or another explicitly authorized non-main branch. Never
edit, commit, merge, or reset this project on `main`. Check the branch before
making changes. This repository is Foundry's Foreman submodule. Keep Codex work
on `Codex`; the `main` branch retains the Claude Code release history.

Preserve roadmap format 2 and legacy records. Keep CLI behavior dependency-free
and testable with Node.js. Skills belong in `skills/`, plugin metadata in
`.codex-plugin/plugin.json`, and automatically discovered hooks in
`hooks/hooks.json`. Use actual Codex capabilities; document gaps instead of
inventing tool APIs or lifecycle events. Inherit the executing model unless the
user chooses one.

Run `node --test tests/*.test.js` for runtime changes. Validate the plugin and
edited skills with the installed plugin-creator and skill-creator validators
when available. Do not install the plugin or alter a marketplace as a side
effect of running tests.
