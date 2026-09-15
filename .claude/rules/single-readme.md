---
paths:
  - "**/README.md"
  - "**/assets/*.svg"
  - "**/assets/*.png"
---

# One README for both hosts

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
