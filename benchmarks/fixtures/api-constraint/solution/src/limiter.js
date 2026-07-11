'use strict';

// Internal fixed-window counter behind the public RateLimiter facade.

class SlidingCounter {
  constructor({ limit = 5, windowMs = 60000 } = {}) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.windows = new Map(); // key -> { start, count }
  }

  allow(key, now = Date.now()) {
    let w = this.windows.get(key);
    if (!w) {
      w = { start: now, count: 0 };
      this.windows.set(key, w);
    }
    if (now - w.start >= this.windowMs) {
      w.start = now;
      w.count = 0;
    }
    if (w.count < this.limit) {
      w.count += 1;
      return true;
    }
    return false;
  }

  remaining(key, now = Date.now()) {
    const w = this.windows.get(key);
    if (!w) return this.limit;
    if (now - w.start >= this.windowMs) return this.limit;
    return Math.max(0, this.limit - w.count);
  }
}

module.exports = { SlidingCounter };
