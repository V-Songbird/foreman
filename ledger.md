# Foreman — the ledger

<!-- foreman:ledger lastmod:2026-08-20 -->

Your project history remembers every change. Nobody remembers what the last
person learned on the way. Six months later the question isn't what changed —
it's what someone already found out about this code, and whether it's still
true.

The ledger is Foreman's answer, and it is one thing, not two. A task that
finishes can leave one sentence about the code it touched. A later task that
plans to touch the same files gets that sentence handed to it before it
starts. So does anyone who opens one of those files.

## What gets recorded

One sentence, on a close, when the task learned something a future task would
need and could not cheaply work out again. Passing it is optional and skipping
it is the common answer — most tasks teach nothing that generalises.

```
echo '{"id":"019","status":"done","lesson":"token refresh lives in session.js refresh(); tests must fake time via test/helpers/clock.js"}' | node scripts/roadmap.js update-status
```

Everything lands in `.foreman/notes.jsonl`, one line per record, appended and
never rewritten. Each record keeps the files the task actually touched, the
entry id, the commit, and the date — that is what makes the staleness label
possible later.

**It's off by default**, because it writes a file into your project. One line
in `.foreman/config.json` turns it on:

```json
{
  "ledger": {
    "enabled": true
  }
}
```

Foreman asks once, the first time a task plans to touch files an earlier task
already closed over, and remembers the answer.

## One task, one id

Every roadmap task gets an id of three or more digits, and that id is the
thread. It starts in the roadmap, ends in your git history, and picks up what
was learned on the way.

<p align="center"><img src="assets/paper-trail.svg" alt="Task 019 across four places: the roadmap entry, the ledger line in .foreman/notes.jsonl, a [Foreman: 019] anchor comment in your own code, and a Foreman: 019 trailer on the commit message" width="700"></p>

## Why your commits say `Foreman: 019`

That last box is the one people ask about.

A finished task closes in the *same* commit as the code it changed. The
roadmap file is written before the commit exists, so the entry can't record a
commit id that hasn't happened yet. The trailer points the link the other way:
the commit names the task. One commit, nothing dangling, no second "update the
roadmap" commit cluttering your history.

You'll see it whenever a tracked task finishes alongside code, whether or not
the ledger is on. Foreman adds that one line and nothing else — the rest of
your commit message is yours.

## Anchors

An `[Foreman: 019]` comment in your own code says which task governs that
code:

```js
// [Foreman: 019]
function expireSession(token) {
```

One site can carry several: `// [Foreman: 019, 034]`. Anchors are yours to
place, in the file's own comment syntax. Foreman only reads them.

If your project already writes decisions down somewhere — an ADR, a design
note, whatever you keep — put it at `docs/foreman/019.md` and the anchor will
find it. Point `dir` elsewhere if that isn't where you keep them. Foreman
never writes those files and has no opinion on what's inside them.

## When Foreman reads it back

Four moments, and none of them cost you a keystroke:

| Moment | What happens |
| --- | --- |
| A task is handed out | Lessons recorded about the files it plans to touch ride in the prompt |
| ...and in the same breath | So does any `[Foreman: <id>]` anchor already sitting in those files |
| You open an anchored file | What's recorded about it surfaces before you change it — once per file per session |
| You go digging months later | `git log --grep="Foreman: 019"` is the whole paper trail |

The first two are the point: the session starts knowing what the last one
found, instead of working it out again.

The anchor channel keeps working even in a project that never turned the
ledger on. Once an anchor exists in a codebase, it stays findable.

## Staleness, and being wrong

Every served line says how stale it is. Foreman checks each record against
git at the moment it serves it, and labels it unchanged, possibly stale, or
unknown. A record whose files are all gone is dropped rather than served.

A line that proved wrong is retired during a survey and never quoted again.
You can also retire one by hand:

```
echo '{"key":"<the key notes reports>"}' | node scripts/roadmap.js note-supersede
```

## Settings

Two keys under `ledger` in `.foreman/config.json`. `enabled` turns recording
on; `dir` says where an anchor looks for a document (default `docs/foreman`).

Two environment variables override the config after it is read.
`FOREMAN_LEDGER` accepts `1`, `true`, `0`, or `false` and sets `enabled`
accordingly; any other value is ignored silently. `FOREMAN_LEDGER_DIR` sets
`dir`, and takes a relative path with no `..` segments — anything else is
warned about and ignored.

If your config still says `decisionLog` or `areaNotes`, it keeps working —
both are read as `ledger`. `decisionLog.gate` no longer does anything.

Set `"enabled": false`, or drop the block entirely, and nothing new gets
recorded. What's already in `.foreman/notes.jsonl` stays, and anchors still
surface when you open the files they tag — they're your files now, not
Foreman's state.
