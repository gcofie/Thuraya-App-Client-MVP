'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { memoryDb } = require('./gift-test-fixtures.cjs');
const { createNoShowService } = require('./functions/no-show-service');
const { parseConfig } = require('./functions/no-show-authorization');
const model = require('./no-show-model');
function fixture(count = 2) {
    let now = new Date('2026-09-11T12:00:00Z');
    const roles = { foh: 'FOH', manager: 'Manager', admin: 'System Admin', tech: 'Tech', unknown: 'Manager' };
    const seed = Object.fromEntries(Object.entries(roles).map(([uid, role]) => [`Users/${uid}@example.test`, { uid, role, roles: [role], active: true }]));
    for (let i = 0; i < count; i++) seed['Appointments/a' + i] = { status: 'Scheduled', groupId: 'GROUP', groupRole: i ? 'member' : 'lead',
        groupMemberIndex: i, groupSize: count, subGroupIndex: 1, dateString: '2026-09-11', clientName: 'Synthetic ' + i, bookedService: 'Synthetic service', grandTotal: '100' };
    const db = memoryDb(seed), config = { version: 1, projectId: 'thuraya-staging', operators: ['foh', 'manager', 'admin'].map(uid => ({ uid, email: uid + '@example.test', enabled: true, roles: [roles[uid]] })) };
    const service = createNoShowService({ db, projectId: config.projectId, config: () => config, clock: () => now,
        fieldValue: { serverTimestamp: () => now.toISOString(), delete: () => ({ __delete: true }) } });
    const req = (command, data = {}, uid = 'foh') => ({ auth: uid ? { uid, token: { email: uid + '@example.test' } } : null, data: { projectId: 'thuraya-staging', command, ...data } });
    const call = (command, data, uid) => service.handle(req(command, data, uid));
    const patch = (id, changes) => db.set('Appointments/' + id, { ...db.rows.get('Appointments/' + id).data, ...changes });
    const preview = (scope = 'member', uid) => call('preview', { appointmentId: 'a0', scope }, uid);
    const commit = (p, id = 'request-one', uid) => call('commit', { appointmentId: p.appointmentId, scope: p.scope, fingerprint: p.fingerprint, requestId: id }, uid);
    return { db, config, service, req, call, preview, commit, patch, now: value => { now = new Date(value); } };
}
for (const role of ['foh', 'manager', 'admin']) test(`${role} trusted No Show allowed`, async () => {
    const f = fixture(), p = await f.preview('member', role); assert.equal(p.eligibleCount, 1); const r = await f.commit(p, 'allowed', role); assert.equal(r.changedIds.length, 1);
});
for (const role of ['tech', 'unknown', null]) test(`${role} denied at backend`, async () => {
    const f = fixture(); await assert.rejects(f.preview('member', role), e => ['permission-denied', 'unauthenticated'].includes(e.code)); assert.equal(f.db.writes.length, 0);
});
for (const issue of ['missing', 'malformed', 'project', 'duplicate', 'tech-role', 'email']) test(`authorization fails closed: ${issue}`, () => {
    const f = fixture(), c = structuredClone(f.config);
    if (issue === 'missing') return assert.equal(parseConfig(null, 'thuraya-staging'), null);
    if (issue === 'malformed') return assert.equal(parseConfig('{', 'thuraya-staging'), null);
    if (issue === 'project') c.projectId = 'thuraya-client-telling';
    if (issue === 'duplicate') c.operators.push(c.operators[0]);
    if (issue === 'tech-role') c.operators[0].roles = ['Tech'];
    if (issue === 'email') c.operators[0].email = 'FOH@example.test';
    assert.equal(parseConfig(c, 'thuraya-staging'), null);
});
for (const scenario of ['wrong-env', 'wrong-email', 'inactive', 'uid-mismatch', 'role-escalation', 'missing-staff']) test(`Staff binding rejects ${scenario}`, async () => {
    const f = fixture(), req = f.req('preview', { appointmentId: 'a0', scope: 'member' });
    if (scenario === 'wrong-env') req.data.projectId = 'thuraya-client-telling';
    if (scenario === 'wrong-email') req.auth.token.email = 'admin@example.test';
    if (scenario === 'inactive') f.db.set('Users/foh@example.test', { role: 'FOH', active: false });
    if (scenario === 'uid-mismatch') f.db.set('Users/foh@example.test', { uid: 'different', role: 'FOH', active: true });
    if (scenario === 'role-escalation') { req.auth.uid = 'tech'; req.auth.token.email = 'tech@example.test'; f.db.set('Users/tech@example.test', { uid: 'tech', role: 'System Admin', active: true }); }
    if (scenario === 'missing-staff') f.db.rows.delete('Users/foh@example.test');
    await assert.rejects(f.service.handle(req), e => e.code === 'permission-denied'); assert.equal(f.db.writes.length, 0);
});
test('preview/capabilities are read only', async () => { const f = fixture(); await f.preview('group-date'); await f.call('capabilities'); assert.equal(f.db.writes.length, 0); });
for (const id of ['a0', 'a1']) test(`member ${id} only, metadata/peers/financials preserved`, async () => {
    const f = fixture(), other = id === 'a0' ? 'a1' : 'a0', before = structuredClone(f.db.rows.get('Appointments/' + other));
    const p = await f.call('preview', { appointmentId: id, scope: 'member' }); await f.commit(p);
    assert.equal(f.db.rows.get('Appointments/' + id).data.status, 'No Show'); assert.equal(f.db.rows.get('Appointments/' + id).data.grandTotal, '100');
    assert.equal(f.db.rows.get('Appointments/' + id).data.groupId, 'GROUP'); assert.deepEqual(f.db.rows.get('Appointments/' + other), before);
    assert.deepEqual([...new Set(f.db.writes.map(w => w.path.split('/')[0]))].sort(), ['Appointments', 'No_Show_Commands']);
});
for (const [name, changes, code] of [
    ['archived', { archived: true }, 'ARCHIVED'], ['future', { dateString: '2026-09-12' }, 'NOT_DUE'], ['malformed-date', { dateString: '11/09/2026' }, 'INVALID_DATE'],
    ['arrived', { status: 'Arrived' }, 'ARRIVED'], ['check-in-marker', { checkedInAt: 'now' }, 'ARRIVED'], ['in-progress', { status: 'In Progress' }, 'STARTED'],
    ['started', { serviceStartedAt: 'now' }, 'STARTED'], ['in-service', { status: 'In Service' }, 'STARTED'], ['completed', { status: 'Completed' }, 'FINANCIAL'],
    ['paid', { paymentStatus: 'Paid' }, 'FINANCIAL'], ['closed', { status: 'Closed' }, 'FINANCIAL'], ['receipt', { receiptGeneratedAt: 'now' }, 'FINANCIAL'],
    ['cancelled', { status: 'Cancelled' }, 'CANCELLED'], ['already', { status: 'No Show' }, 'ALREADY_NO_SHOW'], ['gift', { giftCardCode: 'private' }, 'PAYMENT_REVIEW'],
    ['deposit', { depositAmount: 20 }, 'PAYMENT_REVIEW'], ['partial-paid', { paymentStatus: 'Partially Paid' }, 'PAYMENT_REVIEW'], ['complimentary', { complimentaryApprovalId: 'approval' }, 'PAYMENT_REVIEW']
]) test(`member blocks ${name}`, async () => { const f = fixture(); f.patch('a0', changes); const p = await f.preview(); assert.equal(p.eligibleCount, 0); assert.equal(p.members[0].code, code); await f.commit(p); assert.equal(f.db.writes.length, 0); });
for (const status of ['Paid', 'Closed', 'In Progress', 'Waiting', 'Ready for Payment', 'FOH Review']) test(`group existing Active Job ${status} remains untouched`, async () => {
    const f = fixture(); f.db.set('Active_Jobs/legacy', { sourceAppointmentId: 'a0', status, groupId: 'GROUP' }); const before = structuredClone(f.db.rows.get('Active_Jobs/legacy'));
    const p = await f.preview(); assert.equal(p.eligibleCount, 0); await f.commit(p); assert.deepEqual(f.db.rows.get('Active_Jobs/legacy'), before);
});
for (const count of [2, 6, 12, 50]) test(`entire ${count}-member group atomic`, async () => { const f = fixture(count), p = await f.preview('group-date'); assert.equal(p.eligibleCount, count); const r = await f.commit(p); assert.equal(r.changedIds.length, count); assert.equal(r.groupSummary, 'Group No Show'); });
test('oversized group requires review', async () => { const f = fixture(51); await assert.rejects(f.preview('group-date'), e => e.code === 'resource-exhausted'); assert.equal(f.db.writes.length, 0); });
for (const status of ['Arrived', 'In Progress', 'Completed', 'Paid', 'Cancelled', 'No Show']) test(`mixed Scheduled + ${status} only updates eligible`, async () => {
    const f = fixture(); f.patch('a1', { status }); const before = structuredClone(f.db.rows.get('Appointments/a1')); const p = await f.preview('group-date');
    assert.equal(p.eligibleCount, 1); const r = await f.commit(p); assert.deepEqual(r.changedIds, ['a0']); assert.deepEqual(f.db.rows.get('Appointments/a1'), before);
    assert.equal(r.groupSummary, status === 'No Show' ? 'Group No Show' : ['Completed', 'Paid'].includes(status) ? 'Mixed / Partial Completion' : 'Mixed');
});
test('subgroups included, other dates excluded even if in past', async () => {
    const f = fixture(4); f.patch('a1', { subGroupIndex: 2 }); f.patch('a2', { dateString: '2026-09-12' }); f.patch('a3', { dateString: '2026-09-10' });
    const p = await f.preview('group-date'); assert.equal(p.eligibleCount, 2); assert.equal(p.members.filter(m => m.code === 'OTHER_DATE').length, 2);
    await f.commit(p); assert.equal(f.db.rows.get('Appointments/a2').data.status, 'Scheduled'); assert.equal(f.db.rows.get('Appointments/a3').data.status, 'Scheduled');
});
for (const race of ['check-in', 'started', 'paid', 'member-added', 'date', 'legacy-job', 'deterministic-job', 'archive', 'midnight']) test(`stale ${race} aborts entire group`, async () => {
    const f = fixture(), p = await f.preview('group-date');
    if (race === 'check-in') f.patch('a1', { status: 'Arrived' });
    if (race === 'started') f.patch('a1', { serviceStartedAt: 'now' });
    if (race === 'paid') f.patch('a1', { paymentStatus: 'Paid' });
    if (race === 'member-added') f.db.set('Appointments/new', { groupId: 'GROUP', status: 'Scheduled', dateString: '2026-09-11' });
    if (race === 'date') f.patch('a1', { dateString: '2026-09-12' });
    if (race === 'legacy-job') f.db.set('Active_Jobs/legacy', { sourceAppointmentId: 'a1', status: 'Waiting' });
    if (race === 'deterministic-job') f.db.set('Active_Jobs/a1', { status: 'Waiting' });
    if (race === 'archive') f.patch('a1', { archived: true });
    if (race === 'midnight') f.now('2026-09-12T00:00:00Z');
    await assert.rejects(f.commit(p), e => e.code === 'aborted'); assert.equal(f.db.writes.length, 0); assert.equal(f.db.rows.get('Appointments/a0').data.status, 'Scheduled');
});
test('commit failure has no partial changes, retry succeeds', async () => { const f = fixture(), p = await f.preview('group-date'); f.db.failCommit = true; await assert.rejects(f.commit(p)); assert.equal(f.db.writes.length, 0); f.db.failCommit = false; assert.equal((await f.commit(p)).changedIds.length, 2); });
test('repeated request returns original result once', async () => { const f = fixture(), p = await f.preview('group-date'); const first = await f.commit(p); const count = f.db.writes.length; const again = await f.commit(p); assert.equal(again.replayed, true); assert.deepEqual(again.changedIds, first.changedIds); assert.equal(f.db.writes.length, count); });
test('concurrent operators cannot duplicate lifecycle effect', async () => { const f = fixture(), one = await f.preview('group-date', 'foh'), two = await f.preview('group-date', 'manager'); const r = await Promise.allSettled([f.commit(one, 'one', 'foh'), f.commit(two, 'two', 'manager')]); assert.equal(r.filter(x => x.status === 'fulfilled').length, 1); assert.equal(f.db.writes.filter(w => w.path.startsWith('Appointments/')).length, 2); });
test('zero eligible is a read-only no-op', async () => { const f = fixture(); f.patch('a0', { status: 'Cancelled' }); f.patch('a1', { status: 'No Show' }); const p = await f.preview('group-date'); assert.equal(p.eligibleCount, 0); assert.equal((await f.commit(p)).state, 'NO_CHANGE'); assert.equal(f.db.writes.length, 0); });
test('unknown same-group job evidence fails closed', async () => { const f = fixture(); f.db.set('Active_Jobs/unlinked', { groupId: 'GROUP', status: 'Closed' }); assert.equal((await f.preview('group-date')).eligibleCount, 0); });
test('individual Scheduled normal functionality remains', async () => { const f = fixture(1); f.patch('a0', { groupId: '', isGroupBooking: false }); const p = await f.preview(); await f.commit(p); assert.equal(f.db.rows.get('Appointments/a0').data.status, 'No Show'); });
test('certified individual Arrived + unstarted exact job reconciliation remains', async () => { const f = fixture(1); f.patch('a0', { groupId: '', status: 'Arrived' }); f.db.set('Active_Jobs/legacy', { sourceAppointmentId: 'a0', status: 'Waiting' }); const p = await f.preview(); await f.commit(p); assert.equal(f.db.rows.get('Active_Jobs/legacy').data.status, 'No Show'); });
test('individual paid job still protected', async () => { const f = fixture(1); f.patch('a0', { groupId: '' }); f.db.set('Active_Jobs/legacy', { sourceAppointmentId: 'a0', status: 'Closed', paymentStatus: 'Paid' }); assert.equal((await f.preview()).eligibleCount, 0); });
test('safe appointment-only reinstatement stays trusted', async () => { const f = fixture(); await f.commit(await f.preview()); await f.call('restore', { appointmentId: 'a0', mode: 'reinstate' }); assert.equal(f.db.rows.get('Appointments/a0').data.status, 'Scheduled'); });
test('reinstatement cannot erase linked job evidence', async () => { const f = fixture(); f.patch('a0', { status: 'No Show' }); f.db.set('Active_Jobs/a0', { status: 'No Show', sourceAppointmentId: 'a0' }); await assert.rejects(f.call('restore', { appointmentId: 'a0', mode: 'reinstate' }), e => e.code === 'failed-precondition'); assert.equal(f.db.writes.length, 0); });
test('request IDs cannot be reused for different details', async () => { const f = fixture(); await f.commit(await f.preview()); const p = await f.call('preview', { appointmentId: 'a1', scope: 'member' }); await assert.rejects(f.commit(p), e => e.code === 'already-exists'); });
test('fresh Accra date across midnight and timezone offsets', () => { assert.equal(model.businessDate(new Date('2026-09-11T23:59:59Z')), '2026-09-11'); assert.equal(model.businessDate(new Date('2026-09-12T00:00:00Z')), '2026-09-12'); assert.equal(model.businessDate(new Date('2026-09-12T08:00:00+08:00')), '2026-09-12'); });
test('group KPI distinct IDs, No Shows appended only once', () => { assert.equal(model.distinctGroups([{ id: 'a', groupId: 'g' }, { id: 'b', groupId: 'g' }]), 1); const jobs = [{ id: 'j', sourceAppointmentId: 'a', status: 'No Show' }, { id: 'paid', status: 'Closed', totalGHC: 100 }]; const r = model.appendNoShows(jobs, [{ id: 'a', status: 'No Show' }, { id: 'b', status: 'No Show' }, { id: 'b', status: 'No Show' }]); assert.equal(r.length, 3); assert.deepEqual(r[1], jobs[1]); });
for (const [statuses, expected] of [[['No Show', 'No Show'], 'Group No Show'], [['No Show', 'Scheduled'], 'Mixed / Partially Active'], [['No Show', 'Paid'], 'Mixed / Partial Completion'], [['No Show', 'Cancelled'], 'Mixed']]) test(`derived summary ${statuses}`, () => assert.equal(model.groupSummary(statuses.map(status => ({ status }))), expected));
test('production and staging rules close additive No Show write bypasses', () => {
    for (const profile of ['production', 'staging']) { const s = fs.readFileSync(`${__dirname}/firestore.${profile}-noshow.rules`, 'utf8'); assert.match(s, /match \/No_Show_Commands/); assert.equal((s.match(/giftSafeUpdate\(\) && noShowUpdateSafe/g) || []).length, 2); assert.equal((s.match(/"No_Show_Commands"/g) || []).length, 2); }
});
module.exports = { fixture };
