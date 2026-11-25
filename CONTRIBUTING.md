# Contributing

Foreman is part of the [Foundry marketplace](https://github.com/V-Songbird/foundry) and has a single maintainer. Contributions are welcome as bug reports, suggestions and pull requests.

One package serves Claude Code, Codex and Antigravity. Most of the code serves all three hosts, the assistants Foreman runs inside, so a change to shared behavior reaches every host at once.

---

## Before opening a PR

- Check existing issues first. The problem may already be tracked or deliberately deferred.
- For a substantial change, such as a new skill or a significant refactor, open an issue first to agree on direction.
- Branch from `main` and open the pull request against `main`.

---

## Structure

```text
.claude-plugin/
└── plugin.json          # Claude Code metadata and the release version
.codex-plugin/
└── plugin.json          # Codex metadata, the same release version, and
                         # the hooks field that names hooks/codex-hooks.json
plugin.json              # Antigravity metadata and the same release version
hooks.json               # Antigravity hook wiring, keyed by the plugin name
.github/
└── workflows/
    └── test.yml         # CI: runs the test suite
CONTRIBUTING.md          # this file
SECURITY.md              # how to report a vulnerability
LICENSE                  # MIT
assets/                  # the README art (banners, host cards, Ember scene,
                         # hero, demo) and the icons the manifests name
docs/
└── knowledge/           # how-it-works.md, settings.md, limits.md, benchmarks.md
README.md                # one README for every host, the front page
roadmap-schema.md        # ROADMAP.jsonl and .foreman/ file reference
prompt-template.md       # the one handoff template; host-tuned blocks
                         # carry host="claude" or host="codex"
skills/                  # the five skills, shared by every host
└── <skill>/
    ├── SKILL.md         # skill instructions
    ├── *.md             # branch and reference files the skill loads
    ├── agents/
    │   └── openai.yaml  # Codex skill metadata
    └── assets/          # the skill's Codex icons, copied from Foundry's brand kit
hooks/
├── hooks.json           # Claude Code hook wiring
├── codex-hooks.json     # Codex hook wiring
├── windows-launcher.ps1 # fnm fallback of the Codex Windows hook command
├── codex-task.js        # explicit task start/check for Codex and Antigravity
├── antigravity-hook.js  # Antigravity entrypoint: translates its events and
│                        # runs the shared hooks as child processes
└── *.js                 # hook scripts; lib.js resolves the project and host
scripts/                 # dependency-free Node.js CLIs; runtime.js detects the host
└── git-hooks/           # the commit gates and the README nav check
tests/                   # behavioral tests for the three hosts
types/
└── index.d.ts           # the roadmap pane's types
```

The README is the front page. The pages under `docs/knowledge/` hold the detail it links, and a fact lives in one place: the README states the short form and links the page. Foreman keeps one README for every host. Host differences sit in the How to ask table, one Install subsection per host, the Good to know table and one results table per host under The numbers.

---

## What to keep in mind

**Skills are instruction files every host follows.** A change to a `SKILL.md` or one of its reference files changes how Claude Code, Codex and Antigravity carry out that skill. Be precise, and try the affected skill in a real session on each host you can before submitting. Label a step that applies to only one host.

**Hooks are scripts that run on every tool call or session event.** Keep them fast (no network, no blocking I/O), tolerant of missing host data, and test them on both Unix and Windows. Hooks fail open, so a Foreman error never breaks a session: a hook's entry point catches every error and exits 0 without reporting it, and the Codex commands, on Unix and in `hooks/windows-launcher.ps1`, wrap the hook in the same empty catch. To see an error a hook would hide, run it from the plugin root without the catch, with the event's JSON on stdin, for example in Bash or cmd: `node -e "require('./hooks/session-start.js').main()" < payload.json`. Register Claude Code events in `hooks/hooks.json`, Codex events in `hooks/codex-hooks.json` and Antigravity events in the root `hooks.json`, never two hosts in one file. Antigravity's registration runs `hooks/antigravity-hook.js`, which translates the event and runs the shared hook scripts as child processes; a new shared hook reaches that host only when the entrypoint learns its event. After changing a Codex hook command or `hooks/windows-launcher.ps1`, regenerate the Windows commands with `node scripts/build-windows-launchers.js --write`; without `--write`, the script only checks that they are current.

**Host differences live in one place each.** Scripts ask `scripts/runtime.js` which host is running (`FOREMAN_HOST`, then Codex's own environment markers, then Claude Code's `CLAUDECODE`, then Antigravity's, otherwise Claude Code). Handoff wording that differs by host is a tagged block in `prompt-template.md`; `craft-handoff.js` takes a `host` input and `check-prompt.js` takes `--host`, and both give an Antigravity handoff the Codex form.

**Reviewed increments are offered on Codex only, by decision.** The prompt builder accepts review rows on both hosts, but the skills of Claude Code and Antigravity do not offer the protocol.

**Published figures follow one rule.** Each result names its host, model, date and sample size. Losses and limits stay, a host with no results shows `Not measured`, and a result from one host never stands for another.

---

## Tests

Run these with Node.js 22 or later and Git on your PATH:

```bash
node --test tests/*.test.js
node scripts/git-hooks/check-readme-nav.js
```

Tests give each script or hook they spawn 90 seconds, so the suite still passes while other suites run on the same machine, and a hung script still fails. To allow more, set `FOREMAN_TEST_SPAWN_TIMEOUT_MS` to a larger number of milliseconds; a smaller value is ignored. The suite's other time bounds are set for 30 seconds, so the test helpers stretch them by the limit divided by 30 seconds, which is 3 by default.

The suite runs in one private temporary folder per process. `tests/helpers.js` points `TEMP`, `TMP` and `TMPDIR` at it and removes it when the process exits, and the next run removes the folder of a run that was killed. A test file that creates temporary files loads `tests/helpers.js` first.

A pull request that changes behavior without updating its tests is not merged. Preserve meaningful assertions when adapting a host-specific test, and test observable behavior and edge cases, not only new wording. Do not install anything, or write a user's marketplace or configuration, as part of a test.

Validate the package for each host when you can:

- **Claude Code:** `claude plugin validate .`, and `claude plugin test .` for the roadmap pane's tests in `hooks/register.test.tsx`. `tests/desktop_mod.test.js` covers the part Node can run: how the pane is registered, its reader of `ROADMAP.jsonl` against what `roadmap.js` writes, and the requests its card buttons send.
- **Codex:** the installed plugin-creator validator for `.codex-plugin/plugin.json`, and skill-creator's `quick_validate.py` for edited skills. Those validators live in the Codex installation, not in this repository. The plugin-creator validator does not accept the manifest's `hooks` field yet, although Codex itself reads it.
- **Antigravity:** `agy plugin validate .` with the Antigravity CLI installed.

Installed-host smoke tests complement the local hook fixtures; report which one you actually ran.

### Trying reviewed increments from source

This tries the Codex reviewed-increment workflow from this checkout, without installing anything, editing a marketplace or publishing.

1. Read the [workflow](docs/knowledge/how-it-works.md#review-between-increments). Save this payload, which asks for one reviewed documentation result with no roadmap entry behind it, as a UTF-8 file in a temporary location. Its `"host": "codex"` makes the builder write the Codex form of the prompt even outside Codex. One `judgment.verification` row is one increment; a row needs at least one complete pair, `run` with `expected` or `review.action` with `review.expected`, and in a reviewed run every row needs `review`.

   ```json
   {
     "title": "Clarify the review example",
     "why": "Readers need to know when execution waits for them.",
     "what": "Clarify the review example in README.md.",
     "touches": ["README.md"],
     "host": "codex",
     "destination": "clipboard",
     "reviewEachIncrement": true,
     "judgment": {
       "role": "a documentation editor",
       "goal": "to make the review example clear and actionable",
       "context": "This is the Codex-only reviewed-increment workflow.",
       "steps": ["Read the existing example and clarify its wait behavior."],
       "constraints": ["Keep the existing task acceptance policy."],
       "verification": [{
         "goal": "Explain the wait before the next result",
         "files": ["README.md"],
         "review": {
           "action": "Read the revised review example",
           "expected": "You can tell when to accept, request changes or pause; no installation is included"
         }
       }]
     }
   }
   ```

   From this checkout, run `Get-Content -Raw '<payload-file>' | node ./scripts/craft-handoff.js` in PowerShell, or `node ./scripts/craft-handoff.js < '<payload-file>'` in a POSIX shell.
2. Inspect the returned `ok`, `gate`, `warnings` and `prompt`. Assembly validates the payload and generates text; it does not implement the example, copy it to the clipboard, or demonstrate a real wait. The embedded script paths refer to this checkout. For another project, set `FOREMAN_PROJECT_DIR` and adjust the example's files and checks to real ones.
3. Run `node --test tests/*.test.js` for runtime regressions. Keep any behavioral exercise in a disposable project with its own files and roadmap. Run the generated prompt only when you intend to start that work, keeping its review protocol and actual source paths.
4. Observe a real pause before dependent work, give a real decision, then resume. Exercise Request changes and Pause deliberately, and label those exercises as rehearsals. Interrupt and resume once with sufficient evidence and once with an ambiguous or changed artifact; the latter must ask for revalidation. A run without a human channel must leave the review pending.

Keep automated regressions, headless observations, deliberate rehearsals and actual user acceptance separate in the evidence. Generated wording or a passing structural check alone does not prove that an executor waited. An explicit waiver for one evaluation run records an omitted review; it does not change the product default or establish human acceptance of the feature.

---

## Git hooks

Run this once after cloning:

```bash
git config core.hooksPath scripts/git-hooks
```

This enables a `pre-commit` hook that runs `node --test tests/*.test.js` and blocks the commit on failure. When any Markdown file is staged, it also blocks the commit while the root `README.md` lacks its navigation line, or while a link to a heading anchor in any tracked Markdown file no longer resolves. The test step no-ops if this plugin has no `tests/` directory.

Every Foundry plugin keeps byte-identical copies of the commit gates under `scripts/git-hooks/` and of the tests that cover them. A change to one goes into all of them.

Public source names and attribution are allowed in documentation and commit messages. Keep credentials and personal session data out of commits.

---

## Release notes

Release notes live on the [releases page](https://github.com/V-Songbird/foreman/releases). Describe every user-visible change in your pull request, so it can go into the next release's notes. Name the host each change affects: every host, Claude Code, Codex, Antigravity, or a combination such as Codex and Antigravity.

One version number covers every host. Bump it in the three manifests, `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json` and `plugin.json`, in the release commit; a test fails when they differ. Both [Foundry](https://github.com/V-Songbird/foundry) catalogs pin the same `main` commit. The Claude Code catalog also repeats the version, because the Claude desktop app offers an update only when that field changes, so a release moves both pins and that version together.

A pull request never changes a contributor's installed plugins or personal configuration.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). To report behavior that goes against it, contact the maintainer privately through the address in [SECURITY.md](SECURITY.md).
