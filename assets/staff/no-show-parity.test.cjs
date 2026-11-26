'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const parity = require('./scheduling-source-parity.cjs').legacyParity('no-show-source-parity.cjs');
for (const file of ['app.js', 'index.html', 'reports-v2.js']) test('Scoped No Show host parity: ' + file, () => parity.check(file));
// Commission evolution has executable reader and trusted-service boundary coverage.
for (const file of ['functions/canonical-financial-core.js', 'functions/gift-service.js', 'functions/gift-authorization.js', 'gift-card-model.js', 'gift-card-api.js', 'sales-promo-v1.js', 'attendance.js', 'firebase-config.js']) test('Unchanged financial/security source: ' + file, () => assert.equal(parity.read(file), parity.original(file)));
test('Linked paid evidence outranks stale group summary', () => {
    const model = require('./no-show-model');
    assert.equal(model.groupSummary([{status:'No Show'}, {status:'Arrived',linkedFinancial:true}]), 'Mixed / Partial Completion');
    assert.equal(model.groupSummary([{status:'No Show',linkedFinancial:true}]), 'Mixed / Partial Completion');
});
