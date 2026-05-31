/**
 * Verify dist/ contains a complete Nest build before starting the server.
 * Incremental watch can leave main.js without app.module.js when dist was wiped mid-session.
 */
const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, '..', 'dist');
const required = [
  'main.js',
  'app.module.js',
  path.join('posts', 'posts.module.js'),
  path.join('users', 'users.module.js'),
];

const missing = required.filter((rel) => !fs.existsSync(path.join(dist, rel)));

if (missing.length > 0) {
  console.warn(
    `[ensure-dist] Incomplete dist (missing: ${missing.join(', ')}). Running full build…`,
  );
  process.exit(2);
}

process.exit(0);
