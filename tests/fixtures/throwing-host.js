'use strict';

// A --require preload for context_fill.test.js: it replaces hooks/lib.js
// hostName with one that throws, so context-fill.js main() throws on a
// dependency call and only the entry point's catch stands between the throw
// and a failed hook.
require('../../hooks/lib').hostName = () => {
  throw new Error('preload: hostName throws');
};
