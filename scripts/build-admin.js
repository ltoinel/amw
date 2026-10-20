#!/usr/bin/env node

/**
 * Builds the administration portal (admin/) into dist/admin.
 *
 * The portal has its own package.json so that its front-end toolchain never
 * reaches the server's dependencies. It is installed here when missing or
 * outdated, so that `npm ci && npm run build` at the root is still enough.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ADMIN_DIR = path.join(__dirname, '../admin');
const LOCK_FILE = path.join(ADMIN_DIR, 'package-lock.json');
const INSTALLED_LOCK = path.join(ADMIN_DIR, 'node_modules', '.package-lock.json');

function run(command) {
  execSync(command, { cwd: ADMIN_DIR, stdio: 'inherit' });
}

// npm rewrites node_modules/.package-lock.json on every install
const upToDate = fs.existsSync(INSTALLED_LOCK)
  && fs.statSync(INSTALLED_LOCK).mtimeMs >= fs.statSync(LOCK_FILE).mtimeMs;

if (!upToDate) {
  run('npm ci --no-audit --no-fund');
}
run('npm run build');
