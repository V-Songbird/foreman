# Selectable questions in Codex

Use this protocol for task selection and execution preferences. Ask one picker
at a time: collect the task, then the destination, skipping either already
specified by the user. A preference needed to continue this flow is not an
approval request merely because Foreman waits for it.

For a handoff carrying `reviewEachIncrement:true`, use the result-specific
[review protocol](../roadmap/increment-review.md). Its Accept / Request changes /
Pause choices replace recommendation labels: do not mark Accept as recommended.
A preselected option is never a submitted answer. The same answer handling and
text fallback below still apply.

## Choose the tool

Prefer `request_user_input_async` when exposed and permitted by the current
host. Submit one `questions` item with a self-contained `title` and an `options`
array of visible choice strings. Include the task id or destination in each
option, followed by a brief explanation. Put the recommended option first and
mark it `(Recommended)`; keep the remaining options in their relative order.
The user can also answer in free text. Do not add an Other placeholder.

For example, the async payload for a task menu has this shape; replace the
example rows with the actual CLI menu fields:

```json
{"questions":[{"title":"Which task next?","options":["002 - Clarify the profile (Recommended) - Helps recruiters understand your work; unblocks six tasks.","006 - Remove legacy models - Removes unused assets; unblocks three tasks."]}]}
```

If only `request_user_input` is usable, follow its different schema and current
mode restrictions. It can be Plan-only; being listed does not authorize calling
it in another mode. Do not switch modes just to display a picker.

Fit the usable tool's option limit with grouped or paged selectable menus.
For task pages, preserve CLI order and include a More tasks choice until every
row is reachable. For the four destinations, use the grouping described in
[destination-question.md](../roadmap/destination-question.md). A smaller option
limit alone is not a reason to replace the picker with text.

## Collect the answer

Actually call the tool; writing a menu in a message does not create a picker.
With the async tool, `accepted:true` acknowledges submission only. The answer
arrives in a later user message. Continue useful independent preparation or
use an available interruptible wait in intervals of at most 60 seconds. Keep
the choice pending; do not finalize with "Select an option above", resubmit
the same pending question, or advance on a timer or preselected recommendation.
For a synchronous tool, consume its returned answer. Honor free-text choices
and changed preferences just as selected options.

Do not append "Foreman requires this question" or a skill citation to routine
pickers. Once answered, continue the flow without requesting the same choice
again. Ask a focused clarification only when the answer is ambiguous.

If no permitted question tool exists, a call fails, or the user reports a
missing picker, briefly explain the concrete limitation and ask a self-contained
question using the host's allowed text format. Never refer to invisible options
or claim a modal appeared based only on a submission acknowledgment.
