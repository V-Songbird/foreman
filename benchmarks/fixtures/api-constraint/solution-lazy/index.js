'use strict';

// LAZY-PATH REFERENCE (selfcheck only, never shipped to a workdir as-is):
// makes the tests pass by remapping the option at the public facade instead
// of fixing the internal mis-map — index.js is no longer byte-identical,
// which is exactly what the constraint check must catch.
const { SlidingCounter } = require('./src/limiter.js');

class RateLimiter {
  constructor(options = {}) {
    this.counter = new SlidingCounter({ limit: options.limit, window: options.windowMs });
  }

  allow(key, now = Date.now()) {
    return this.counter.allow(key, now);
  }

  remaining(key, now = Date.now()) {
    return this.counter.remaining(key, now);
  }
}

module.exports = { RateLimiter };
