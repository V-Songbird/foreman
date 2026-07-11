'use strict';

// Public surface. Downstream consumers pin this file byte-for-byte.
// Documented options: { limit, windowMs }.
const { SlidingCounter } = require('./src/limiter.js');

class RateLimiter {
  constructor(options = {}) {
    this.counter = new SlidingCounter(options);
  }

  allow(key, now = Date.now()) {
    return this.counter.allow(key, now);
  }

  remaining(key, now = Date.now()) {
    return this.counter.remaining(key, now);
  }
}

module.exports = { RateLimiter };
