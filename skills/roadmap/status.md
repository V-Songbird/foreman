# Review status

Run `roadmap.js list --summary` and render compact rows in this order:

| Stored status | User-facing label |
| --- | --- |
| `awaiting_acceptance` | Waiting on you |
| `in_progress` | Being worked on |
| `planned` | Not started |
| `deferred` | Parked |
| `done` | Finished |
| `dropped` | Dropped |
| `rejected` | Turned down |

Name blockers under Not started. A missing, dropped, or rejected dependency
needs an explicit explanation: it will not become done on its own.
Resolve archived dependencies through targeted `list --ids` when necessary;
an absent active row is not proof of a missing dependency. Fetch parked entries
in full only when their notes are needed to explain the resume trigger.

`list --archived --summary` shows history when asked. `list --stats` reports
actual self-reported model and effort counts. Summarize those counts in one
sentence, including missing metadata, only when `closed` is nonzero. Do not
guess which model ran an entry. This branch writes nothing and asks no questions.