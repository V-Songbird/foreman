# Working on Foreman

These are Foreman's contributor rules. Claude Code reads the same rules from
`.claude/rules/`; when one changes, change both copies together. The Foundry
roadmap rule is copied word for word from Foundry's
`.claude/rules/project-roadmap.md`.

## One package for Claude Code and Codex

`main` is Foreman's package branch: one plugin for Claude Code and Codex. It is
not documentation-only. Make changes on a topic branch and merge them into
`main` through a pull request. The `Claude` and `Codex` branches are
historical; they keep the last separate releases, 2.7.0 and 3.0.4-codex.1, and
take no new work. This repository is Foundry's Foreman submodule.

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

## One roadmap for Foundry development

Development of this Foundry collection uses the parent Foundry ROADMAP.jsonl.
Do not create or maintain a separate project roadmap inside foreman, hush,
razor or their platform worktrees. Run roadmap commands from Foundry and ensure
any host project-directory override points at that same root. Plugin tests and
source commands can still run from their own checkout.

Version Foundry's root ROADMAP.jsonl and its .foreman/config.json,
.foreman/notes.jsonl and .foreman/archive.jsonl when present. These preserve
planning, shared settings, lessons and archived task history in a fresh clone.
Trial logs, session markers, locks and temporary execution state remain local.
Do not publish an entire .foreman directory by removing its exclusions.

This governs maintenance of the collection, not the unrelated user projects
where a plugin is installed. Test fixtures and archival backups are not active
project roadmaps. Do not change the plugin's general project-resolution behavior
to force all installations to use a particular Foundry checkout.

Before importing work, compare identities, dependencies and history. Keep
existing Foundry IDs; preserve free source IDs and remap collisions with an
explicit provenance map. Preserve dates, notes and acceptance state. Related
work on another platform does not establish completion of an existing task.

The former Foreman-local IDs 294–300 map to Foundry 302–308. ID 301 is unchanged;
read its current status from the root roadmap. Historical notes retain their original local
IDs, interpreted through docs/shared/validation/roadmap-reconciliation-2026-09-08.md.

## Benchmark ownership in Foundry

Keep benchmark runners, datasets, measurement tests and experiments in the
parent Foundry `benchmarks/<plugin>/` directory. Do not add a benchmark tree to
the installable plugin or recreate the old `.benchmarks/` directory.

Plugin `tests/` contains functional tests of the product. Tests of a benchmark
runner, scorer or evidence schema belong beside that harness in Foundry.
Preserve existing test coverage when moving a harness.

Use `.scratch/` for local maintenance output, migration backups and temporary
validation dependencies. Research narratives belong in `docs/<plugin>/`.
Keep model names, revisions and historical results attached to their actual
experiments. Organization work does not authorize paid runs or global installs.

## One README for both hosts

Foreman has one README, on `main`, for Claude Code and Codex users alike. Its
shared product sections — What is this?, Why you'd want it, How it works, What
you can do and Good to know — stay outside host-specific parts and read the
same for everyone. Host differences have fixed places: the How to ask table,
one Get started subsection per host, the Differences between hosts table and
one results table per host under The numbers. A feature one host lacks is named
as not available there, never described with the other host's behavior.

Keep benchmark questions, metrics and table columns identical in both host
tables. Each table carries its own `foundry:evidence` declaration and its own
model and setup rows, values and limits. Identify the actual host, model,
source and date. Preserve losses and measurement limits. Never turn a Claude
Code result into a Codex result by moving it or renaming a model, and never
treat unit tests as a comparative performance run. Show `Not measured` when
equivalent evidence is absent. Research and extensive methodology belong in
Foundry's central documentation; product usage and plugin decisions belong
with the plugin.

The short never-list under Good to know must agree with `docs/adr/SCOPE.md`.
Before considering a README change ready, check navigation with
`node scripts/git-hooks/check-readme-nav.js` and review the source of every
claim; a passing check verifies anchors, not measurements. Do not run paid
benchmarks, install plugins, publish or create commits merely to fill an
evidence gap.
