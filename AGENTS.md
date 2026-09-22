# Foreman

Foreman is one plugin for Claude Code and Codex: a roadmap beside the project's code, grounded
handoffs and clear task status. Its hooks, scripts and tests are dependency-free Node.js and run
with Node.js 22 or later and Git; there is no install or build step. This repository is
Foundry's Foreman submodule and ships from `main`.

## Start here

- Before changing what Foreman promises or refuses, read [the product scope](docs/knowledge/scope.md); the README's never-list must agree with it.
- Before touching reviewed increments, read [incremental acceptance](docs/knowledge/incremental-acceptance.md); the protocol is Codex-only.
- Before editing a handoff block, read `prompt-template.md`; `check-prompt.js` and `craft-handoff.js` read its canonical blocks at run time.
- Before a release, read [the changelog](docs/knowledge/changelog.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Rules that outrank everything

- One package on `main` serves both hosts: one runtime, one `skills/` tree with the five skills, one `prompt-template.md`, one README and one changelog. Develop on a topic branch and merge through a pull request.
- Register Claude Code events only in `hooks/hooks.json` and Codex events only in `hooks/codex-hooks.json`. Host-specific code asks `scripts/runtime.js` which host is running; host-specific handoff wording is a `host="claude"` or `host="codex"` block in `prompt-template.md`.
- Both manifests carry the same version, bumped together in the release commit; a test fails when they differ. Foundry's catalogs carry no version for Foreman and only move `source.sha`.

## Commands

| Command | Purpose | Cost |
| --- | --- | --- |
| `node --test tests/*.test.js` | The suite, both hosts | Local temporary repositories; exercise changed hooks on Windows as well as Unix |
| `node scripts/git-hooks/check-readme-nav.js README.md` | Every README nav anchor resolves | Local |
| `claude plugin validate .` | Claude Code package shape | Local |
| `node scripts/build-windows-launchers.js` | Codex Windows hook commands are current; `--write` regenerates them | Local |
| `git config core.hooksPath scripts/git-hooks` | One-time: the pre-commit hook runs the suite and the nav check | Local |

Codex validators live in the Codex installation, not here. Tests never install the plugin,
alter a marketplace or start model sessions.

## Where things live

| Path | Content |
| --- | --- |
| `skills/` | The five skills, one text for both hosts: `foreman`, `roadmap`, `init`, `survey`, `craft-prompt` |
| `hooks/` | Hook scripts and both registrations; `lib.js` resolves project and host; `windows-launcher.ps1` is the source of the Codex Windows command |
| `scripts/` | Dependency-free CLIs such as `roadmap.js`, `craft-handoff.js`, `check-prompt.js`, `safe-commit.js` and `ledger.js`; `health/` holds the metrics tools |
| `tests/` | The `node:test` suite for both hosts |
| `prompt-template.md` | The one handoff template, read at run time |
| `HOW-IT-WORKS.md`, `settings.md`, `roadmap-schema.md`, `ledger.md`, `TRIALS.md`, `CODEX.md`, `CODEX-PROMPTING.md` | Reference pages the skills, scripts and tests load or cite; they stay at the root |
| `docs/knowledge/` | The product scope, the incremental-acceptance contract and the changelog |
| `.claude-plugin/`, `.codex-plugin/` | Host manifests with the same version; the Codex manifest names `hooks/codex-hooks.json` |

## Conventions

The README serves both hosts. Its shared sections read the same for everyone; host differences
sit in the How to ask table, one Get started subsection per host, the Differences between hosts
table and one results table per host under The numbers. A feature one host lacks is named as not
available there, never described with the other host's behavior. Keep benchmark questions and
columns identical across the host tables; each table carries its own `foundry:evidence`
declaration, model, source and date. Never present a Claude Code result as a Codex result, never
treat unit tests as a performance run, and show `Not measured` where evidence is absent.

Reviewed increments stay a Codex feature until the owner decides otherwise: the assembler
accepts review rows on both hosts, but Claude Code's skills do not offer the protocol.

Preserve roadmap format 2 and records written by either host. Keep scripts dependency-free.
Benchmark runners, datasets and experiments are not part of the package; `tests/` holds
functional tests only.

`CLAUDE.md` imports this file; keep shared contributor facts here.

## Pitfalls

- **Claude Code substitutes `${CLAUDE_PLUGIN_ROOT}` in skill text; Codex does not.** Skills carry a relative link beside each such path.
- **A passing nav check verifies anchors, not measurements.** Review the source of every README claim; never run paid benchmarks, install plugins or publish to fill an evidence gap.
- **A prompt copied out of one host carries that host's script paths.** Craft it again in the other.
