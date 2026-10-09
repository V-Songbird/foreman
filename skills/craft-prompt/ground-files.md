# Ground the file options (one read-only pass, before Call 2)

Call 2's Q3 is the one answer that has to produce a real path, so ground it
instead of asking it cold: run **one** bounded, read-only pass over the
project now, before Call 2, and turn what it finds into the options. In
Claude Code, dispatch **one** `Explore` agent at medium breadth; in Codex,
read the project directly, using a collaboration worker only when useful
independent work can proceed alongside it. In Antigravity, do the same as in
Codex, with an `invoke_subagent` worker as that collaboration worker.

The pass takes Call 1's request verbatim and returns four things:

- up to three candidate file lines, each `path — the symbols that matter`
- the project's test command, written the way it would actually be typed
  (in Codex, when there is none, the available human review of the
  requested result — never an invented command)
- one file that already does something similar, for the `Pattern:` line
- one way this project can be *driven or looked at*, when it has one — a
  project skill (under `.claude/skills/` in Claude Code), a script, a
  fixture harness — so the handoff names a check the destination runs
  instead of handing it back to the user. It has to clear three bars, all
  of them: it runs unattended, it exits on its own, and it does not rewrite
  the thing it checks. Name the command, or return nothing.

The three bars are judgment, not a gate: a dev server, a command that
needs someone at the keyboard, or a test run that regenerates its own
golden files fails them, and returning nothing beats returning a near-miss.
One pass only. Never a second one — a follow-up pass is the second
interview this whole skill is shaped to avoid.

**What comes back is a proposal, not a finding.** Offer it; never assert
it. The user's `Other` answer always wins (in Codex, their free-text
answer), and a candidate they did not pick is dropped rather than argued
for. Nothing the pass returns reaches `touches` until the user has chosen
it.

**When the pass returns nothing usable** — no repository, an empty result,
or candidates naming no file — every question below keeps its free-text
wording. A grounded option upgrades the question; it is never a
precondition for asking it.
