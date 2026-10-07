const crypto = require('crypto');

/** Short, URL-safe, time-sortable id (e.g. "lz3k9a1-4f9c2b7e1a"). */
function newId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`;
}

module.exports = { newId };
