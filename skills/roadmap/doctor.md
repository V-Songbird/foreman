# Check the roadmap

Run `roadmap.js doctor`. It reports findings and
`summary:{errors,warnings}`; informational hook-capability disclosures do not
make a healthy file unhealthy. Explain actionable findings in plain language.
The structural check does not inspect implementation code or select work.

For an authorized repair, use the named operation:

| Finding | Operation |
| --- | --- |
| Unsupported schema version | `migrate` |
| Duplicate id | `reassign-id`, identifying the specific row |
| Same id active and archived | inspect and recover the interrupted archive/restore |
| Stale description, kind, or planned files | `correct` with expected values |
| Bad status | `update-status` |
| Missing, repeated, cyclic, or stuck dependency | `update-deps` |
| Completion has no recorded evidence | `annotate` actual findings |
| Mechanical default/self/repeated-dependency repair | `doctor --fix` for findings marked repairable |

Show a concrete proposed repair before asking for any missing authorization.
An explicit request to fix these mechanical defects permits applying the
reported repairs. A health-check request alone remains read-only. Invalid ids,
unknown metadata, malformed configuration, or merely similar titles may require
human judgment; do not invent a repair command or hand-edit the stores.