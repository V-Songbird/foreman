# Result records

Every public performance claim Foreman makes has to point at a file in this
directory. A record is the evidence behind one sentence: the exact fixtures and
prompts it was measured with, the model and its settings, how many times it
ran, every individual run, the aggregate with its statistic named, the date,
the machine, and the things the number does *not* say.

A claim with no record does not ship. Not softened, not asterisked — it either
gets a record or it stops being a claim.

## The rules

**One record, one claim.** The `claim` field is the sentence, verbatim, that
the record is allowed to support. If you find yourself wanting to stretch it,
you want a second record.

**Records are immutable.** A published record is never edited. If it was wrong,
or the world moved, publish a *new* record whose `supersedes` names the old id.
The old file stays where it is — a correction that erases what it corrects is
not a correction.

**The id is the filename.** `R-001-prompt-overhead.json` has the id
`R-001-prompt-overhead`. Nothing to keep in sync.

**Nothing is backfilled.** A record describes a run that happened. There is no
legitimate reason to write one from an estimate, an extrapolation, a
remembered number, or a chart. If the run's output is gone, the claim is gone.

## Validate

```bash
node benchmarks/records/validate-records.js
```

Free, deterministic, no model call. It checks every record for the required
fields and their types, that `limitations` is non-empty, that every fixture and
prompt it names still exists **and still hashes to the bytes it was measured
against**, that `date` is a real ISO date, that `aggregate.statistic` says what
kind of average it is, that `runs` has as many entries as `repetitions` claims,
and that a `supersedes` pointer resolves. One JSON object on stdout; non-zero
exit if any record is invalid. `--records <dir>` points it elsewhere.

The hash check is the load-bearing one: it means a fixture cannot be edited out
from under a claim quietly. Change `prompt-template.md` and the record measured
against the old one fails, loudly, instead of going on supporting a sentence in
the README.

## Schema

| Field | Type | Meaning |
| --- | --- | --- |
| `claim` | string | The exact sentence this record supports. |
| `fixtures` | array | `{path, sha256, role?}` — repo-relative, hashed. Everything the run read. |
| `prompts` | array | `{path, sha256}` or `{text}` — the exact prompt(s) sent. `[]` when no model ran. |
| `model` | object or `null` | `{id, settings}` — settings carry temperature, reasoning effort, and anything else that changes the answer. `null` means no model ran. |
| `repetitions` | integer ≥ 1 | How many times it ran. Must equal `runs.length`. |
| `runs` | array | One entry per repetition, with that repetition's own numbers. Per-run results are not optional: an aggregate without its spread hides the thing a reader needs most. |
| `aggregate` | object | `{statistic, values}`. `statistic` names what kind of average it is — a bare number is not a result. |
| `date` | string | `YYYY-MM-DD`, the day it ran. |
| `environment` | object | `{os, node, foreman_commit}`. |
| `limitations` | array of strings | Non-empty. What this number does not establish. |
| `supersedes` | string | Optional. The id of the record this one replaces. |
| `command` | string | Optional but expected — the command that reproduces it. |

### `model: null`

A mechanical fact recomputed on demand from files in the repository — the
prompt-overhead ratio, for instance — is recorded with `model: null`,
`repetitions: 1`, and a limitation stating plainly that it is a static
computation and not a model trial. It is reproducible and it is honest, but it
is a different kind of evidence from a session that actually ran, and the
record has to say so rather than letting the two look alike.

## What is published

| Record | Kind | Claim |
| --- | --- | --- |
| [`R-001-prompt-overhead`](R-001-prompt-overhead.json) | static computation | The standard handoff profile carries 12% of the reinforced profile's fixed guardrail text — 499 words saved. |

**No model-run records exist yet.** The harness in [`../`](../README.md) drives
real sessions and reads real costs out of the API, but its output lands in
`results/`, which is local run output and not committed. Until a run's output
is published here as a record, the figures it produced are things we saw on our
machines — reproducible by you with the harness — and not claims Foreman makes.
