---
type: knowledge
summary: "Every published Foreman measurement: the 2026-08-29 Claude Code comparison on Claude Sonnet 5 and Claude Opus 5, and the Codex and Antigravity hosts that have no paired measurement; read before changing a published number."
related_files:
  - README.md
  - CONTRIBUTING.md
---

# Foreman benchmarks

This page holds every measurement Foreman publishes, with its method and its limits. The README shows the same table under [The numbers](../../README.md#the-numbers).

Each result belongs to the named model and recorded run. Each host keeps its own table. Missing measurements stay marked as unmeasured. Results can vary between runs.

## Contents

- [Claude Code, 2026-08-29](#claude-code-2026-08-29)
- [Codex](#codex)
- [Antigravity](#antigravity)
- [Where the records are](#where-the-records-are)

## Claude Code, 2026-08-29

The run compared Foreman with a well-written task paragraph on Claude Sonnet 5 and Claude Opus 5. The sample size was not recorded. No public record names the Foreman revision it measured.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Sonnet 5","Claude Opus 5"],"date":"2026-08-29","reviewedAt":"2026-10-12","revision":"not recorded","revisionReason":"No public record names the Foreman revision the 2026-08-29 run measured."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Claude Sonnet 5 | Written task paragraph | 100% | $0.0757 |
| Claude Sonnet 5 | Foreman | 100% | $0.0820 |
| Claude Opus 5 | Written task paragraph | 100% | $0.1627 |
| Claude Opus 5 | Foreman | 100% | $0.1746 |

Foreman tied the well-written paragraph on correctness and cost more: 8.3% on Sonnet and 7.3% on Opus. The figures describe that run only. They are not a claim about the current release or another model, and the current release has no separate measurement.

*Results can vary between runs.*

The task trail and the recorded demo in the README are illustrations. The demo is one recorded Claude Code exchange on Claude Opus 5, replayed on its recorded clock. Neither is a measurement.

## Codex

No paired performance measurement exists for Codex. Codex functional tests establish specific behaviors, not a speed, cost or correctness advantage over a baseline. Comparative performance remains unmeasured. No Claude Code result is presented as Codex evidence.

<!-- foundry:evidence {"platform":"Codex","status":"pending","reason":"Functional Codex validation exists; equivalent paired performance measurements are not available."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Not measured | Without plugin | Not measured | Not measured |
| Not measured | foreman | Not measured | Not measured |

The live checks that did run are listed under [Host limits](limits.md#host-limits) in Foreman limits.

## Antigravity

No Antigravity performance measurements are available.

<!-- foundry:evidence {"platform":"Antigravity","status":"pending","reason":"No Antigravity performance measurements are available."} -->
| Model | Setup | Correct tasks | Mean session cost |
| --- | --- | --- | --- |
| Not measured | Not measured | Not measured | Not measured |

## Where the records are

The benchmark instruments and research records behind the numbers are kept outside this repository and are not distributed with the plugin.
