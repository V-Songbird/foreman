# Foreman — why-notes and the decision log

<!-- foreman:decision-log lastmod:2026-07-28 -->

Git remembers every diff. Nobody remembers *why*. Six months from now, the
question isn't what changed — it's why anyone thought that was the right
call, and whether it's still true.

The decision log is Foreman's answer. A task whose deliverable *is* a
decision writes a short note: the choice, the options that lost, and what it
commits you to. One file per decision task, tagged into the code it governs.
When someone opens that code later, the note comes to them.

## What earns a note

Exactly one thing: a roadmap entry marked `kind: "decision"` — a task added
to resolve an open question ("X or Y?", "decide whether", "pick an
approach") rather than to build something — in a project that has turned
the feature on.

**Ordinary implementation work never earns one.** An entry with no `kind` is
a build, and a build closes with nothing to record: no prompt asks it for a
note, no close check demands one, no hook nudges about it. Foreman never
assumes a task maps to a decision just because it changed code. If a build
turns out to have decided something real, the honest move is a
`kind: "decision"` entry of its own — one decision, one id, one note.

**It's off by default.** It writes files into your repo and comments into
your source, and that's not something to switch on behind your back. Foreman
asks once, the first time you add a decision task, and remembers the answer.
One line in `.foreman/config.json` turns it on:

```json
{
  "decisionLog": {
    "enabled": true
  }
}
```

That's the whole active config. `dir` and `gate` fall back to their
defaults, so a project that's happy with `docs/foreman` and no close gate
never has to name them.

## One task, one id

Every roadmap task gets an id of three or more digits, and that id is the thread. It
starts in the roadmap, ends in your git history, and picks up the reasoning
on the way.

<p align="center"><img src="assets/paper-trail.svg" alt="Task 019 across four places: the roadmap entry, the why-note at docs/foreman/019.md, a [Foreman: 019] anchor comment in your own code, and a Foreman: 019 trailer on the commit message" width="700"></p>

## Why your commits say `Foreman: 019`

That last box is the one people ask about.

A finished task closes in the *same* commit as the code it changed. The
roadmap file is written before the commit exists, so the entry can't record
a commit id that hasn't happened yet. The trailer points the link the other
way: the commit names the task. One commit, nothing dangling, no second
"update the roadmap" commit cluttering your history.

You'll see it whenever a tracked task finishes alongside code, whether or
not why-notes are on.

## What actually gets written

Closing decision task `019` with the log on produces two things. (Closing an
ordinary build task produces neither.)

**The note**, at `docs/foreman/019.md`:

```markdown
---
id: "019"
title: Expire sessions server-side
date: 2026-07-23
---

## Decision
...the choice, named, in one short paragraph.

## Context
...what forced a choice — the constraint or the conflict.

## Alternatives rejected
...one line each: the option, and the single reason it lost.

## Consequences
...what this commits future work to, including never-touch warnings.
```

**The anchor**, in the code that decision governs, in that file's own
comment syntax:

```js
// [Foreman: 019]
function expireSession(token) {
```

One site can carry several: `// [Foreman: 019, 034]`. Notes are dated
records and never edited backward — a reversal is a new note that names the
old one in its `supersedes` frontmatter.

A decision task's close then records where its reasoning lives, or says
outright that there wasn't any: the entry gets
`"doc": "docs/foreman/019.md"`, or `"doc": "none"`. A build's close carries
no `doc` at all — nothing asks it for one.

## When Foreman reads it back

Three moments, and none of them cost you a keystroke:

| Moment | What happens |
| --- | --- |
| You open a file carrying an anchor | The notes it names surface before you change what they govern — once per file per session |
| You commit while a task is open | The trailer says which task, so Foreman doesn't have to guess from filenames |
| You go digging months later | `git log --grep="Foreman: 019"` is the whole paper trail |

The first one keeps working even in a project that later turns authoring
off. Once an anchor exists in a codebase, it stays findable.

## Settings

Three keys under `decisionLog` in `.foreman/config.json`. `enabled` turns
authoring on, `dir` says where notes go (default `docs/foreman`), and
`gate: "block"` refuses to close a decision task until it records one.

> [!NOTE]
> `gate: "block"` is worth thinking about before you set it. Refusing to
> close a task until it records a note is a good way to teach yourself to
> type `"none"` without reading the question — and a reflexive `"none"` is
> worse than an empty field, because it looks like a decision.

Set `"enabled": false`, or drop the block entirely, and nothing new gets
written. Notes and anchors already in the repo stay where they are, and
still surface when you open the files they tag — they're your files now,
not Foreman's state.
