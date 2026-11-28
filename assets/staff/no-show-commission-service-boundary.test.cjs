'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm'), path = require('node:path');
const { createRequire } = require('node:module');
const parity = require('./no-show-source-parity.cjs'), fixtures = require('./commission-test-fixtures.cjs');
const { memoryDb } = require('./gift-test-fixtures.cjs');
const current = require('./functions/commission-v2-service');
const context = { module: { exports: {} }, require: createRequire(path.join(__dirname, 'functions/commission-v2-service.js')), Buffer };
vm.runInNewContext(parity.original('functions/commission-v2-service.js'), context);
const original = context.module.exports;
const plain = value => JSON.parse(JSON.stringify(value));
function setup(factory, status, options = {}) {
    const { person, binding, rule, job } = fixtures;
    const source = job('1500', { status, sourceAppointmentId: 'appt', ...options });
    const db = memoryDb({
        'Users/admin@example.test': { email: 'admin@example.test', active: true, role: 'Admin' },
        ['Users/' + binding.stationEmail]: { email: binding.stationEmail, active: true, role: 'Tech' },
        'Commission_Settings/v2_control': { schemaVersion: 2, recordType: 'commission_control', enabled: true, revision: 1 },
        ['Commission_Settings/' + person.id]: { ...person, schemaVersion: 2, recordType: 'commission_person' }, ['Commission_Settings/' + binding.id]: binding,
        ['Commission_Rules/' + rule.id]: rule,
        'Active_Jobs/job-one': source,
        'Appointments/appt': { status: 'No Show', dateString: '2026-09-05', grandTotal: 9000, activeJobId: 'job-one' }
    });
    const service = factory({ db, projectId: 'thuraya-staging', now: () => new Date('2026-09-06T12:00:00Z'), targetConfigurationEnabled: () => true,
        operatorConfig: () => ({ version: 1, projectId: 'thuraya-staging', operators: [{ uid: 'admin', email: 'admin@example.test', roles: ['Admin'], enabled: true }] }) });
    const call = (data, tech = false) => service.handle({ data, auth: { uid: tech ? 'tech-uid' : 'admin', token: { email: tech ? binding.stationEmail : 'admin@example.test' } } });
    return { db, call };
}
function withoutDisposition(report) {
    return plain({ ...report, rows: report.rows.map(({ auditDisposition, finalizationEligible, ...row }) => row) });
}
test('Commission service exported API remains compatible with No Show baseline', () => assert.deepEqual(Object.keys(current).sort(), Object.keys(original).sort()));
for (const [name, status, options] of [
    ['individual', 'No Show', {}], ['group member', 'No Show', { groupId: 'group', groupSize: 2 }],
    ['entire group', 'No Show', { groupId: 'group', groupSize: 1 }], ['reinstate', 'Scheduled', {}], ['reschedule', 'Action Required', {}],
    ['arrived', 'Arrived', {}], ['started', 'In Progress', {}], ['completed', 'Completed', {}], ['paid nonclosed', 'Paid', {}],
    ['cancelled', 'Cancelled', {}], ['closed paid linked stale No Show', 'Closed', {}], ['closed unpaid', 'Closed', { paymentStatus: 'Unpaid' }]
]) test('Trusted Commission service No Show boundary: ' + name, async () => {
    const a = setup(original.createCommissionService, status, options), b = setup(current.createCommissionService, status, options);
    const input = { action: 'preview', start: '2026-09-05', end: '2026-09-05', personId: fixtures.person.personId };
    for (const tech of [false, true]) assert.deepEqual(withoutDisposition(await b.call(input, tech)), plain(await a.call(input, tech)));
    const ar = await a.call({ ...input, action: 'report' }), br = await b.call({ ...input, action: 'report' });
    assert.deepEqual({ ...plain(br), target: withoutDisposition(br.target) }, plain(ar));
    const before = plain([...b.db.rows]);
    const ap = await a.call(input), bp = await b.call(input);
    const command = p => ({ action: 'lock', requestId: 'boundary-lock', expectedRevision: p.revision, personId: fixtures.person.personId, start: input.start, end: input.end, fingerprint: p.fingerprint });
    assert.deepEqual(plain(await b.call(command(bp))), plain(await a.call(command(ap))));
    const clean = rows => plain(rows.map(([key, value]) => { if (key.startsWith('Commission_Locks/')) { const { auditExceptionCount, ...data } = value.data; return [key, { ...value, data }]; } return [key, value]; }));
    assert.deepEqual(clean([...b.db.rows]), clean([...a.db.rows]));
    for (const [key, value] of before.filter(([key]) => /^(Active_Jobs|Appointments)\//.test(key))) assert.deepEqual(plain(b.db.rows.get(key)), value);
    assert.ok(b.db.writes.every(w => /^(Commission_Settings|Commission_Locks|Commission_Records)\//.test(w.path)));
});
