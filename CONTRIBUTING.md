# Contributing to the Codex port

This branch ports Foreman from the [Foundry collection](https://github.com/V-Songbird/foundry)
while preserving its roadmap, handoff, acceptance, and continuity behavior.
Keep the original Foundry checkout and Claude Code submodule unchanged.

Work on `codex/port` or an authorized non-main branch. Never write or commit on
`main`. Do not push, merge, or publish as a side effect of local development.

## Structure

- `.codex-plugin/plugin.json`: Codex metadata and this port's version.
- `skills/`: five workflows, supporting references, and Codex UI metadata.
- `hooks/hooks.json`: automatically discovered Codex command hooks.
- `hooks/codex-task.js`: explicit start/check lifecycle bridge.
- `scripts/`: dependency-free Node.js roadmap, prompt, evidence and metrics core.
- `tests/`: behavioral regressions, hook payload fixtures and prompt contracts.
- `CODEX.md`: supported runtime contract and limitations.

Use Codex's native capabilities where they improve the implementation. Preserve
Foreman's intent and data contracts. Historical Claude model/source values stay
readable; runtime compatibility is not a reason to rewrite past records.

## Validation

Run with Node.js 22 or later and Git on PATH:

```sh
node --test tests/*.test.js
node scripts/git-hooks/check-readme-nav.js
```

CI runs on Linux and Windows. Use the installed plugin-creator validator for
`.codex-plugin/plugin.json` and skill-creator's `quick_validate.py` for edited
skills when available. Those validators live in the Codex installation, not in
this repository. Real installed-host smoke testing complements local hook
fixtures; report which was actually performed.

Preserve meaningful assertions when adapting Claude-specific test contracts.
Test observable behavior and edge cases, not only new prose. Keep hooks quick,
local, bounded, and tolerant of missing host data. Do not install anything or
write a user's marketplace/configuration as part of a test.

## Optional Git hooks

```sh
git config core.hooksPath scripts/git-hooks
```

The pre-commit hook runs the test suite and the existing repository checks.
Reference-name checks pass silently when the private blocklist is absent.
Add user-visible changes under `[Unreleased]` in `CHANGELOG.md`. The original
release history remains historical; the Codex manifest owns this branch's
prerelease version. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
