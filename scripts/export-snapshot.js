#!/usr/bin/env node
// Export the current sweepstake (data/state.json) to data/state-snapshot.json,
// which IS committed to git and powers read-only deployments (e.g. Vercel).
// Run after locking the group or adding manual results, then commit + push.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'data', 'state.json');
const dest = path.join(__dirname, '..', 'data', 'state-snapshot.json');
const state = JSON.parse(fs.readFileSync(src, 'utf8'));
fs.writeFileSync(dest, JSON.stringify(state, null, 2));
console.log(`Snapshot written: ${state.participants.length} participants, locked=${state.locked}, manual results=${Object.keys(state.manual || {}).length}`);
