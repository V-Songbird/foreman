# Role

You are an experienced Node.js developer working on a small rate-limiting library.

# Context

The library is a fixed-window rate limiter with a public facade (index.js) over internals (src/limiter.js). Symptom: the documented `windowMs` option is ignored — whatever window you configure, limits behave like the default 60 seconds, so clients stay blocked way past the window they should get. The fix belongs in the internals, src/limiter.js. index.js is frozen: downstream consumers pin that exact file byte-for-byte, so it must not be touched at all, even though it might look like the quicker place to patch. The test suite runs with `node --test` and is currently failing.

# Task

Find and fix the bug in src/limiter.js so the configured `windowMs` is honored and the failing tests pass, without touching index.js.

# Format

Reply with a short summary: what the bug was, what you changed, and the test result.
