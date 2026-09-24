# Foreman

Foreman is one plugin for Claude Code, Codex and Antigravity: a roadmap beside the project's
code, grounded handoffs and clear task status. Its hooks, scripts and tests are dependency-free Node.js and run
with Node.js 22 or later and Git; there is no install or build step. This repository is
Foundry's Foreman submodule and ships from `main`.

## Start here

- Before changing what Foreman promises or refuses, read [the product scope](docs/knowledge/scope.md); the README's never-list must agree with it.
- Before touching reviewed increments, read [incremental acceptance](docs/knowledge/incremental-acceptance.md); the protocol is Codex-only.
- Before editing a handoff block, read `prompt-template.md`; `check-prompt.js` and `craft-handoff.js` read its canonical blocks at run time.
- Before a release, read [the changelog](docs/knowledge/changelog.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Rules that outrank everything

- One package on `main` serves the three hosts: one runtime, one `skills/` tree with the five skills, one `prompt-template.md`, one README and one changelog. Develop on a topic branch and merge through a pull request.
- Register Claude Code events only in `hooks/hooks.json`, Codex events only in `hooks/codex-hooks.json` and Antigravity events only in the root `hooks.json`, which runs `hooks/antigravity-hook.js`. Host-specific code asks `scripts/runtime.js` which host is running; host-specific handoff wording is a `host="claude"` or `host="codex"` block in `prompt-template.md`, and an Antigravity handoff takes the Codex form.
- The three manifests, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `plugin.json`, carry the same version, bumped together in the release commit; a test fails when they differ. Foundry's catalogs carry no version for Foreman and only move `source.sha`.

## Commands

| Command | Purpose | Cost |
| --- | --- | --- |
| `node --test tests/*.test.js` | The suite, three hosts | Local temporary repositories; exercise changed hooks on Windows as well as Unix |
| `node scripts/git-hooks/check-readme-nav.js README.md` | Every README nav anchor resolves | Local |
| `claude plugin validate .` | Claude Code package shape | Local |
| `agy plugin validate .` | Antigravity package shape | Local; needs the Antigravity CLI |
| `node scripts/build-windows-launchers.js` | Codex Windows hook commands are current; `--write` regenerates them | Local |
| `git config core.hooksPath scripts/git-hooks` | One-time: the pre-commit hook runs the suite and the nav check | Local |

Codex validators live in the Codex installation, not here. Tests never install the plugin,
alter a marketplace or start model sessions.

## Where things live

| Path | Content |
| --- | --- |
| `skills/` | The five skills, one text for every host: `foreman`, `roadmap`, `init`, `survey`, `craft-prompt` |
| `hooks/` | Hook scripts and the Claude Code and Codex registrations; `antigravity-hook.js` translates Antigravity's events and runs the shared hooks as children; `lib.js` resolves project and host; `windows-launcher.ps1` is the source of the Codex Windows command |
| `scripts/` | Dependency-free CLIs such as `roadmap.js`, `craft-handoff.js`, `check-prompt.js`, `safe-commit.js` and `ledger.js`; `health/` holds the metrics tools |
| `tests/` | The `node:test` suite for the three hosts |
| `prompt-template.md` | The one handoff template, read at run time |
| `HOW-IT-WORKS.md`, `settings.md`, `roadmap-schema.md`, `ledger.md`, `TRIALS.md`, `CODEX.md`, `CODEX-PROMPTING.md` | Reference pages the skills, scripts and tests load or cite; they stay at the root |
| `docs/knowledge/` | The product scope, the incremental-acceptance contract and the changelog |
| `.claude-plugin/`, `.codex-plugin/`, `plugin.json`, `hooks.json` | Host manifests with the same version; the Codex manifest names `hooks/codex-hooks.json`, and the root manifest and `hooks.json` are what Antigravity reads |

## Conventions

The README serves every host. Its shared sections read the same for everyone; host differences
sit in the How to ask table, one Install subsection per host, the Differences between hosts
table and one results table per host under The numbers: Claude Code results, Codex results and
Antigravity results. A feature one host lacks is named as not available there, never described
with the other host's behavior. Keep benchmark questions and columns identical across the host
tables; each table carries its own `foundry:evidence` declaration, model and date, plus a source
naming a public page when one exists. Never
present a Claude Code result as a Codex result, never treat unit tests as a performance run, and
show `Not measured` where evidence is absent.

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
- **Antigravity's PostToolUse answer is always `{}`.** What a commit or a file touch has to say waits in a temp queue and reaches the model at its next call, through PreInvocation; nothing arrives at the moment of the command.
