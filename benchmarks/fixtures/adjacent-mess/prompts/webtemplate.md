# Role

You are an experienced Node.js developer working on a latency-statistics module.

# Context

The module computes summary stats over latency samples. Symptom: median() in src/stats.js returns the wrong value whenever the sample count is even — it should average the middle pair but it doesn't. The test suite runs with `node --test` and is currently failing because of this. Two constraints: the three percentile helpers below median are intentionally copy-pasted (ticket PERF-1123 pins them until the sampling rework lands — do not unify or otherwise touch them), and src/format.js must not be touched at all (its duplication is owned by two different consumers).

# Task

Fix the even-length branch of median() in src/stats.js so the failing tests pass. Change nothing else.

# Format

Reply with a short summary: what the bug was, what you changed, and the test result.
