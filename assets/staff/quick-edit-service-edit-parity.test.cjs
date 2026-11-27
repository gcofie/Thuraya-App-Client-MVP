'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { baselineSource, parentSource } = require('./quick-edit-service-edit-parity.cjs');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
test('only exact reviewed Quick Edit evidence helper and read plumbing differ from production', () => {
    assert.equal(baselineSource('app.js', source), parentSource());
});
test('source parity rejects any unreviewed eligibility alteration', () => {
    assert.throws(() => baselineSource('app.js', source.replace("appt.source === 'client-booking'", 'true')));
});
test('source parity rejects any unreviewed canonical arithmetic or unrelated change', () => {
    assert.throws(() => baselineSource('app.js', source + '\n// unreviewed change\n'));
});
test('source parity rejects any unreviewed Appointment write', () => {
    const start = source.indexOf('    async function saveEdit()');
    const target = "                dateString: date,";
    assert.ok(source.indexOf(target, start) > start);
    const changed = source.slice(0, start) + source.slice(start).replace(target, target + '\n                paymentStatus: "Paid",');
    assert.throws(() => baselineSource('app.js', changed));
});
test('source parity rejects weakened fresh-record validation', () => {
    assert.throws(() => baselineSource('app.js', source.replace('!latest.exists || latest.metadata?.fromCache || quickEditV4RecordState', 'false || quickEditV4RecordState')));
});
