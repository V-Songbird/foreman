# Foreman — model and effort fit

Read only when `render-sections.js`'s `modelSuggestions` field is `true`
(default `false` — most projects never load this file). It holds the three
notes `prompt-template.md`'s step 0 used to carry inline, moved out so a
project that never turns recommendations on never pays to load them: how
to judge the recommended model, how to judge the recommended reasoning
effort, and how the `Execute here` destination asks the operator to act
on both.

<!-- [Foreman: 116] -->
**All three notes below — Model fit, Effort fit, and Raise the
session — are gated on `modelSuggestions`, which defaults to
`false`.** When it is `false`, none of them produce anything: no model
is recommended, no effort line is said, and the `Execute here`
question is not asked. The executing-model question still runs on the
dispatching destinations, because a background `Agent` and a clipboard
paste both need a model named — it just offers the list with no
task-derived default. `targetModel` is a separate setting and is
unaffected either way: a concrete pin still drives elaboration, and
`inherit` still elaborates at the standard level.

**Model fit** — how to seed the recommended default when `targetModel`
is `inherit` and `modelSuggestions` is `true`; a recommendation the
operator confirms or overrides, never an automatic switch. Judge from
the task's own `what`/`planned_touches`, recorded fields only:
  - `haiku` for mechanical, well-scoped work — a single file or a
    bounded change with an unambiguous spec. Cheapest, and per the
    elaboration note above a fully-spelled-out Haiku prompt cut its
    own exploration overhead at equal correctness.
  - `sonnet` or `opus` when the task turns on judgment — design
    decisions, ambiguity, a cross-cutting predicted file surface, or logic no spec
    pins down.
  - one caution: a `what` that reconciles stale, renamed, or
    conflicting references hit a proven capability cliff on Haiku in
    every prompt format tested — recommend Sonnet/Opus there whatever
    the scope. Never bake this into the assembled prompt: the target
    model never sees a description of its own expected failure modes.

<!-- [Foreman: 101] -->
**Effort fit** — the second half of the same recommendation, seeded
the same way and confirmed in the same breath. This prompt tells the
destination to think rather than narrate, which makes reasoning
budget the only deliberation channel it has left — so effort moves
the outcome at least as much as the model does. Judge it by what
happens when the work goes wrong, not by how hard the work looks on
average:
  - a runnable check already sitting in `task_rules` makes a wrong
    attempt cheap and visible — `low` or `medium`, and escalate on a
    failure rather than pre-paying for one. One caveat on that
    escalation: re-running the same prompt at the same setting mostly
    re-buys the same failure (the samples are correlated), so a retry
    only earns its place when something structural changes between
    attempts — a corrected file path, a sharpened constraint, a
    higher effort.
  - a silent failure mode — breakage the existing checks would pass —
    has no cheap signal to escalate on, so pay up front: `high`.
  - no verification at all (a `--research` handoff, a judgment call
    with nothing runnable behind it) leaves nothing to catch a bad
    first pass: `max`.
Effort is a per-call parameter, never project config — there is no
`targetEffort` key and none should be added. It is also always
advisory: the `Agent` tool takes no effort argument, so a background
dispatch cannot set it even when the operator names one. Say the
recommendation out loud at craft time and let the operator act on
it — same rule as the model, and for the same reason. Never bake the
effort reasoning into the assembled prompt.

<!-- [Foreman: 111] -->
**Match the recommendation** — asked only when `modelSuggestions` is
`true`, and on the `Execute here` destination only. Both
halves above are stated together and followed by one question, asked
once per handoff and before the first task row exists: proceed as-is,
or take the prompt to a fresh session already set to the
recommendation. That destination has no dispatch value to carry
either half, so a line alone is the one thing a reader skims past.
Foreman never makes the comparison itself and must not try —
hook input carries no model at all, and effort is readable only
inside a hook, never by a skill — so the operator's answer IS the
comparison and the switch is theirs. It never sets a model, never
blocks, and never records anything. The other two destinations keep
asking exactly what they ask today.

**The wording must not assume a direction.** Foreman cannot see what
the session is running, so it cannot know whether the recommendation
is a step up, a step down, or already matched — a session on Opus told
a task suits Sonnet is being asked to go down. Never "raise", "upgrade",
"bump", or any other word that names a direction; word it as running
the task where the recommendation points, and let the operator supply
the comparison.

Switching this session's model or effort in place is deliberately
**not** an option. Either change invalidates the prompt cache, so
every remaining turn re-reads the whole conversation from scratch;
a fresh session pays that cost once, at the shortest history it will
ever have. A background `Agent` is not the substitute either — that
call takes a `model` but no effort argument, so it can only ever
close half the gap.
