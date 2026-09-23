# Contributing

This plugin is part of the [Foundry Collection](https://github.com/V-Songbird/foundry) and is maintained by a single author. Contributions are welcome in the form of bug reports, suggestions, and pull requests.

Foreman is one package for three hosts — the assistants it runs inside, Claude Code, Codex and Antigravity. Most of the code serves all of them, so a change to shared behavior reaches every host at once.

---

## Before opening a PR

- Check existing issues first — the problem may already be tracked or intentionally deferred.
- For substantial changes (new skills, significant refactors), open an issue first to align on direction before writing code.
- Branch from `main` and open the pull request against `main`, the package branch. The separate Claude Code and Codex releases ended with 2.7.0 and 3.0.4-codex.1.

---

## Structure

```
.claude-plugin/
└── plugin.json          # Claude Code metadata and the release version
.codex-plugin/
└── plugin.json          # Codex metadata, the same release version, and
                         # the hooks field that names hooks/codex-hooks.json
plugin.json              # Antigravity metadata and the same release version
hooks.json               # Antigravity hook wiring, keyed by the plugin name
AGENTS.md                # contributor rules for every host; CLAUDE.md imports it
LICENSE                  # MIT
README.md                # one README for every host
HOW-IT-WORKS.md          # how Foreman works, with the host differences
settings.md              # .foreman/config.json reference
roadmap-schema.md        # ROADMAP.jsonl and .foreman/ file reference
ledger.md                # the optional ledger
TRIALS.md                # the local trial log
CODEX.md                 # Codex host notes and limits
CODEX-PROMPTING.md       # the guidance Codex handoffs follow
prompt-template.md       # the one handoff template; host-tuned blocks
                         # carry host="claude" or host="codex"
docs/knowledge/          # product scope, the incremental-acceptance contract
                         # and the changelog, one history for every host
skills/                  # the five skills, shared by every host
└── <skill>/
    ├── SKILL.md         # skill instructions
    ├── *.md             # branch and reference files the skill loads
    └── agents/
        └── openai.yaml  # Codex skill metadata
hooks/
├── hooks.json           # Claude Code hook wiring
├── codex-hooks.json     # Codex hook wiring
├── windows-launcher.ps1 # source of the Codex Windows hook command
├── codex-task.js        # explicit task start/check for Codex and Antigravity
├── antigravity-hook.js  # Antigravity entrypoint: translates its events and
│                        # runs the shared hooks as child processes
└── *.js                 # hook scripts; lib.js resolves the project and host
scripts/                 # dependency-free Node.js CLIs; runtime.js detects the host
tests/                   # behavioral tests for the three hosts
```

Foreman keeps one README for every host, plain-language sections first and technical depth behind links; [`AGENTS.md`](AGENTS.md) says where the host-specific parts go.

---

## What to keep in mind

**Skills are instruction files every host follows.** A change to a `SKILL.md` or one of its reference files changes how Claude Code, Codex and Antigravity carry out that skill — be precise, and try the affected skill in a real session on each host you can before submitting. Label a step that applies to only one host.

**Hooks are scripts that run on every tool call or session event.** Keep them fast (no network, no blocking I/O), tolerant of missing host data, and test them on both Unix and Windows. Register Claude Code events in `hooks/hooks.json`, Codex events in `hooks/codex-hooks.json` and Antigravity events in the root `hooks.json`, never two hosts in one file. Antigravity's registration runs `hooks/antigravity-hook.js`, which translates the event and runs the shared hook scripts as child processes; a new shared hook reaches that host only when the entrypoint learns its event. After changing a Codex hook command or `hooks/windows-launcher.ps1`, regenerate the Windows commands with `node scripts/build-windows-launchers.js --write`; without `--write`, the script only checks that they are current.

**Host differences live in one place each.** Scripts ask `scripts/runtime.js` which host is running (`FOREMAN_HOST`, then Codex's own environment markers, then Antigravity's, otherwise Claude Code). Handoff wording that differs by host is a tagged block in `prompt-template.md`; `craft-handoff.js` takes a `host` input and `check-prompt.js` takes `--host`, and both give an Antigravity handoff the Codex form.

**Reviewed increments are Codex-only for now.** The prompt builder accepts review rows on both hosts, but Claude Code's skills do not offer the protocol until the owner decides otherwise.

---

## Tests

Run these with Node.js 22 or later and Git on your PATH:

```
node --test tests/*.test.js
node scripts/git-hooks/check-readme-nav.js
```

Tests give each script or hook they spawn 30 seconds. On a heavily loaded
machine, set `FOREMAN_TEST_SPAWN_TIMEOUT_MS` to a larger number of
milliseconds to raise that limit; a smaller value is ignored.

PRs that change script behavior without updating tests will not be merged. Preserve meaningful assertions when adapting a host-specific test, and test observable behavior and edge cases, not only new wording. Do not install anything, or write a user's marketplace or configuration, as part of a test.

Validate the package for each host when you can:

- **Claude Code:** `claude plugin validate .`
- **Codex:** the installed plugin-creator validator for `.codex-plugin/plugin.json`, and skill-creator's `quick_validate.py` for edited skills. Those validators live in the Codex installation, not in this repository. The plugin-creator validator does not accept the manifest's `hooks` field yet, although Codex itself reads it.
- **Antigravity:** `agy plugin validate .` with the Antigravity CLI installed.

Installed-host smoke tests complement the local hook fixtures; report which one you actually ran.

---

## Trying reviewed increments from source

This tries the Codex reviewed-increment workflow from this checkout, without installing anything, editing a marketplace or publishing.

1. Read the [workflow and complete payload](HOW-IT-WORKS.md#review-between-increments). Save the JSON example as a UTF-8 file in a temporary location and add `"host": "codex"` to it, so the builder writes the Codex form of the prompt even outside Codex. From this checkout, run `Get-Content -Raw '<payload-file>' | node ./scripts/craft-handoff.js` in PowerShell, or `node ./scripts/craft-handoff.js < '<payload-file>'` in a POSIX shell.
2. Inspect the returned `ok`, `gate`, `warnings` and `prompt`. Assembly validates the payload and generates text; it does not implement the example, copy it to the clipboard, or demonstrate a real wait. The embedded script paths refer to this checkout. For another project, set `FOREMAN_PROJECT_DIR` and adjust the example's files and checks to real ones.
3. Run `node --test tests/*.test.js` for runtime regressions. Keep any behavioral exercise in a disposable project with its own files and roadmap. Run the generated prompt only when you intend to start that work, keeping its review protocol and actual source paths.
4. Observe a real pause before dependent work, give a real decision, then resume. Exercise Request changes and Pause deliberately, and label those exercises as rehearsals. Interrupt and resume once with sufficient evidence and once with an ambiguous or changed artifact; the latter must ask for revalidation. A run without a human channel must leave the review pending.

Keep automated regressions, headless observations, deliberate rehearsals and actual user acceptance separate in the evidence. Generated wording or a passing structural check alone does not prove that an executor waited. An explicit waiver for one evaluation run records an omitted review; it does not change the product default or establish human acceptance of the feature.

---

## Git hooks

Run this once after cloning:

```
git config core.hooksPath scripts/git-hooks
```

This enables a `pre-commit` hook that runs `node --test tests/*.test.js` and blocks the commit on failure, then checks the README's navigation links when `README.md` is staged. The test step no-ops if this plugin has no `tests/` directory.

Foreman, Hush and Razor keep byte-identical copies of `pre-commit`; change them together.

Public source names and attribution are allowed in documentation and commit messages. Keep credentials and personal session data out of commits.

---

## Versions and the changelog

Add an entry to [`docs/knowledge/changelog.md`](docs/knowledge/changelog.md), under the unreleased version at the top, for every user-visible change, and say which host it affects when it is not both. Follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format.

One version number covers every host. Bump it in the three manifests, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `plugin.json`, in the release commit; a test fails when they differ. Claude Code reads a plugin's version from `plugin.json` before anything in its marketplace entry, so the version lives only in the manifests. Both [foundry](https://github.com/V-Songbird/foundry) catalogs pin the same `main` commit with `ref: "main"` and carry no version for Foreman: a release only moves their `source.sha` to the release commit.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
