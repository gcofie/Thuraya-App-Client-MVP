const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./functions/commission-materiality-policy');
const engine = require('./functions/commission-engine');
const { createCommissionService } = require('./functions/commission-v2-service');
const f = require('./commission-test-fixtures.cjs');

class MemoryDb {
    constructor() { this.docs = new Map(); this.version = 0; }
    seed(path, data) { this.docs.set(path, structuredClone(data)); this.version++; }
    collection(name) { return { name, doc: id => ({ path: name + '/' + id, get: async () => this.get({ path: name + '/' + id }, this.docs) }), get: async () => this.get({ name }, this.docs) }; }
    get(query, docs) {
        if (query.path) return { exists: docs.has(query.path), data: () => structuredClone(docs.get(query.path)) };
        const rows = [...docs].filter(([p]) => p.split('/').length === 2 && p.startsWith(query.name + '/'));
        return { size: rows.length, docs: rows.map(([path, data]) => ({ id: path.split('/')[1], data: () => structuredClone(data), updateTime: null })) };
    }
    async runTransaction(fn) {
        for (let i = 0; i < 8; i++) {
            const version = this.version, docs = structuredClone(this.docs), writes = [];
            const result = await fn({ get: async q => { assert.equal(writes.length, 0); return this.get(q, docs); }, set: (r, d) => writes.push([r.path, structuredClone(d)]) });
            if (version !== this.version) continue;
            writes.forEach(([p, d]) => this.docs.set(p, d)); this.version++; return result;
        }
        throw new Error('contention');
    }
}
function setup(net = '200', change = {}) {
    const db = new MemoryDb();
    for (const [email, role] of [['owner@example.test', 'Admin'], ['manager@example.test', 'Manager'], [f.binding.stationEmail, 'Tech']]) db.seed('Users/' + email, { email, roles: [role], active: true });
    const operators = { version: 1, projectId: 'thuraya-staging', operators: ['owner', 'manager'].map(name => ({ uid: name + '-uid', email: name + '@example.test', roles: [name === 'owner' ? 'Admin' : 'Manager'], enabled: true })) };
    db.seed('Commission_Settings/v2_control', { schemaVersion: 2, recordType: 'commission_control', enabled: true, revision: 1 });
    db.seed('Commission_Settings/' + f.person.id, { ...f.person, schemaVersion: 2, recordType: 'commission_person' });
    db.seed('Commission_Settings/' + f.binding.id, f.binding); db.seed('Commission_Rules/' + f.rule.id, f.rule);
    const source = f.job(net, { sourceAppointmentId: 'appt-one', paymentMethod: 'Gift Card / Voucher', giftCardAppliedAmount: engine.money(net).times('1.2').toString(), giftCardRedemptions: [{ appliedAmount: engine.money(net).times('1.2').toString() }], ...change });
    db.seed('Active_Jobs/job-one', source);
    const service = createCommissionService({ db, projectId: 'thuraya-staging', now: () => new Date('2026-09-06T12:00:00Z'), operatorConfig: () => operators, targetConfigurationEnabled: () => true });
    const call = (data, who = 'owner') => {
        const auth = who === 'tech' ? { uid: 'tech-uid', token: { email: f.binding.stationEmail } } : { uid: who + '-uid', token: { email: who + '@example.test' } };
        return service.handle({ auth, data });
    };
    const preview = () => call({ action: 'materialityPreview', personId: f.person.personId, businessDate: '2026-09-05' });
    const report = () => call({ action: 'preview', personId: f.person.personId, start: '2026-09-05', end: '2026-09-05' });
    const command = async (action, requestId, extra = {}, who) => { const p = await preview(); return call({ action, requestId, expectedRevision: p.revision, personId: f.person.personId, businessDate: '2026-09-05', proofFingerprint: p.proof.proofFingerprint, approvalReason: 'Synthetic zero-impact review', confirmed: true, ...extra }, who); };
    const approve = (id = 'approve') => command('approveImmaterialException', id);
    const lock = async () => { const p = await report(); return call({ action: 'lock', requestId: 'lock', expectedRevision: p.revision, personId: f.person.personId, start: p.start, end: p.end, fingerprint: p.fingerprint }); };
    const record = () => [...db.docs].find(([p]) => p.startsWith('Commission_Records/'));
    const pay = async () => { const p = await report(); return call({ action: 'markPaid', requestId: 'pay', expectedRevision: p.revision, recordId: record()[0].split('/')[1] }); };
    return { db, source, service, operators, call, preview, report, command, approve, lock, record, pay };
}
test('valid bounded M2 preserves raw pending row and all financial inputs', async () => {
    const s = setup(), before = structuredClone(s.db.docs.get('Active_Jobs/job-one')), p = await s.preview();
    assert.equal(p.proof.eligible, true); assert.equal(p.proof.blockedRevenueCeiling, '240'); assert.equal(p.proof.maximumCommissionDelta, '0.00');
    assert.equal(p.row.dailyPayable, null); await s.approve(); const r = await s.report();
    assert.equal(r.rows[0].dailyPayable, null); assert.equal(r.rows[0].status, 'PENDING'); assert.equal(r.rows[0].auditDisposition.valid, true); assert.equal(r.rows[0].finalizationEligible, true);
    assert.deepEqual(s.db.docs.get('Active_Jobs/job-one'), before); assert.equal(r.summary.completeCommission, '0.00');
});
for (const [label, net, changes] of [['M1', '1500', {}], ['unbounded', '200', { receiptId: null, receiptStatus: null }], ['unsupported refund', '200', { refundStatus: 'pending' }], ['unknown price', '200', { serviceLineItems: [{ name: 'No amount' }] }]]) test(label + ' cannot be approved or locked', async () => {
    const s = setup(net, changes); assert.equal((await s.preview()).proof.eligible, false);
    await assert.rejects(s.approve(), /not proven/); await assert.rejects(s.lock(), /complete configured/);
    assert.equal([...s.db.docs.keys()].filter(p => p.startsWith('Commission_Records/')).length, 0);
});
test('equality is allowed but a positive raw excess cannot round into M2', async () => {
    assert.equal((await setup('1000').preview()).proof.eligible, true);
    assert.equal((await setup('1000.001').preview()).proof.eligible, false);
});
for (const who of ['manager', 'tech', 'unknown']) test(who + ' cannot approve or view owner proof', async () => {
    const s = setup(); await assert.rejects(s.command('approveImmaterialException', 'deny', {}, who), /Admin|Staff|operator/);
    await assert.rejects(s.call({ action: 'materialityPreview', personId: f.person.personId, businessDate: '2026-09-05' }, who), /Admin|Staff/);
});
test('forged proof, wrong rule and missing owner confirmation are rejected', async () => {
    const s = setup();
    await assert.rejects(s.command('approveImmaterialException', 'forge', { proofFingerprint: 'forged' }), /stale/);
    await assert.rejects(s.command('approveImmaterialException', 'wrong', { ruleId: 'wrong-rule' }), /rule/);
    await assert.rejects(s.command('approveImmaterialException', 'unconfirmed', { confirmed: false }), /confirmation/);
});
test('client-writable legacy metadata cannot masquerade as approval', async () => {
    const s = setup(), p = await s.preview();
    s.db.seed('Commission_Settings/forged', { schemaVersion: 0, recordType: policy.EVENT, sequence: 9999, personId: f.person.personId, businessDate: '2026-09-05', state: 'APPROVED', certificate: p.proof });
    assert.equal((await s.report()).rows[0].auditDisposition.valid, false);
});
test('approval retry is idempotent; revoke/reapprove retains old events', async () => {
    const s = setup(), p = await s.preview(), data = { action: 'approveImmaterialException', requestId: 'once', expectedRevision: p.revision, personId: f.person.personId, businessDate: '2026-09-05', proofFingerprint: p.proof.proofFingerprint, approvalReason: 'Owner review', confirmed: true };
    assert.deepEqual(await s.call(data), await s.call(data));
    await assert.rejects(s.call({ ...data, approvalReason: 'changed' }), /different payload/);
    const original = structuredClone(s.db.docs.get('Commission_Settings/v2_materiality_event_once'));
    await s.command('revokeImmaterialException', 'revoke'); assert.equal((await s.report()).rows[0].auditDisposition.state, 'REVOKED');
    await s.approve('again'); assert.equal((await s.report()).rows[0].auditDisposition.valid, true);
    assert.deepEqual(s.db.docs.get('Commission_Settings/v2_materiality_event_once'), original);
});
const mutations = [
    ['job update', s => s.db.seed('Active_Jobs/job-one', { ...s.source, note: 'updated evidence' })],
    ['new job', s => s.db.seed('Active_Jobs/inserted', f.job('100', { id: 'inserted' }))],
    ['receipt insertion', s => s.db.seed('Receipts/new', { receiptId: 'receipt-one', amount: 240 })],
    ['payment insertion', s => s.db.seed('Payments/new', { jobId: 'job-one', amount: 240 })],
    ['gift redemption insertion', s => s.db.seed('Gift_Card_Redemptions/new', { receiptId: 'receipt-one', giftCardCode: 'GIFT-ONE', amount: 240 })],
    ['group evidence', s => s.db.seed('Appointments/appt-one', { groupId: 'new-group' })],
    ['identity change', s => s.db.seed('Commission_Settings/' + f.binding.id, { ...f.binding, notes: 'reviewed identity' })],
    ['target change', s => s.db.seed('Commission_Rules/' + f.rule.id, { ...f.rule, dailyTarget: '100' })],
    ['rule version', s => s.db.seed('Commission_Rules/' + f.rule.id, { ...f.rule, revision: 2 })]
];
for (const [label, mutate] of mutations) {
    test(label + ' invalidates approval and blocks lock', async () => { const s = setup(); await s.approve(); mutate(s); assert.equal((await s.report()).rows[0].auditDisposition.state, 'STALE'); await assert.rejects(s.lock(), /complete configured/); });
    test(label + ' blocks markPaid after snapshot', async () => { const s = setup(); await s.approve(); await s.lock(); const before = structuredClone(s.record()[1]); mutate(s); await assert.rejects(s.pay(), /stale|invalid|diagnostics/); assert.deepEqual(s.record()[1], before); });
}
test('valid lock retains raw pending and zero certificate; payment revalidation passes', async () => {
    const s = setup(); await s.approve(); await s.lock(); const rec = s.record()[1];
    assert.equal(rec.calculation.dailyPayable, null); assert.equal(rec.calculation.status, 'PENDING'); assert.equal(rec.auditException.certificate.maximumCommissionDelta, '0.00'); assert.equal(rec.commissionAmount, '0.00');
    await s.pay(); assert.equal(s.record()[1].payoutStatus, 'paid'); assert.equal(s.record()[1].snapshotHash, rec.snapshotHash);
});
test('missing exception snapshot cannot bypass a different record payment gate', async () => {
    const s = setup(); await s.approve(); await s.lock(); const [path, rec] = s.record();
    s.db.seed(path, { ...rec, auditException: null }); await assert.rejects(s.pay(), /count changed/);
});
test('source invalidation can be recorded append-only and cannot reapprove locked history', async () => {
    const s = setup(); await s.approve(); await s.lock(); s.db.seed('Payments/new', { jobId: 'job-one', amount: 240 });
    await s.command('reviewImmaterialException', 'review'); assert.equal((await s.report()).rows[0].auditDisposition.valid, false);
    await assert.rejects(s.approve('reapprove'), /Locked commission/);
});
test('technician report retains own visible audit disposition without owner capability', async () => {
    const s = setup(); await s.approve(); const r = await s.call({ action: 'preview', personId: f.person.personId, start: '2026-09-05', end: '2026-09-05' }, 'tech');
    assert.equal(r.rows[0].auditDisposition.state, 'APPROVED'); assert.equal((await s.call({ action: 'config' }, 'tech')).capabilities.auditExceptions, false);
});
test('caller-supplied zero ceiling cannot override material source evidence', async () => {
    const s = setup('1500'); await assert.rejects(s.command('approveImmaterialException', 'forge-ceiling', { blockedRevenueCeiling: '0', maximumCommissionDelta: '0.00', eligible: true }), /not proven/);
});
test('unrelated later sale does not invalidate a historical approval', async () => {
    const s = setup(); await s.approve(); await s.lock();
    s.db.seed('Active_Jobs/later', f.job('2000', { id: 'later', dateString: '2026-09-06' }));
    assert.equal((await s.report()).rows[0].auditDisposition.valid, true); await s.pay();
});
test('service/menu catalog overlap does not link an unrelated future Appointment', async () => {
    const sharedLine = { ...f.job('200').serviceLineItems[0], id: 'shared-catalog-id', serviceId: 'shared-service-id', menuItemId: 'shared-menu-item' };
    const s = setup('200', { quickEditV4Items: [{ id: 'shared-catalog-id', serviceId: 'shared-service-id', menuItemId: 'shared-menu-item' }], serviceLineItems: [sharedLine] });
    const before = (await s.preview()).proof;
    s.db.seed('Appointments/unrelated-future-menu', {
        id: 'unrelated-future-menu',
        dateString: '2026-09-16',
        assignedTechEmail: f.binding.stationEmail,
        quickEditV4Items: [{ id: 'shared-catalog-id', serviceId: 'shared-service-id', menuItemId: 'shared-menu-item' }],
        serviceLineItems: [{ id: 'shared-catalog-id', serviceId: 'shared-service-id', menuItemId: 'shared-menu-item' }]
    });
    const after = (await s.preview()).proof;
    assert.equal(after.proofFingerprint, before.proofFingerprint);
    assert.equal(after.fingerprints.queryMembershipFingerprint, before.fingerprints.queryMembershipFingerprint);
});
test('future Active_Jobs sharing service/menu catalog IDs do not enter a historical proof', async () => {
    const sharedLine = { ...f.job('200').serviceLineItems[0], id: 'shared-future-catalog', serviceId: 'shared-service-id', menuItemId: 'shared-menu-item' };
    const s = setup('200', { quickEditV4Items: [{ id: 'shared-future-catalog', serviceId: 'shared-service-id', menuItemId: 'shared-menu-item' }], serviceLineItems: [sharedLine] });
    const before = (await s.preview()).proof.proofFingerprint;
    s.db.seed('Active_Jobs/future-same-tech', f.job('500', { id: 'future-same-tech', dateString: '2026-09-16', quickEditV4Items: [{ id: 'shared-future-catalog' }], serviceLineItems: [sharedLine] }));
    s.db.seed('Active_Jobs/future-other-tech', f.job('500', { id: 'future-other-tech', dateString: '2026-09-16', assignedTechEmail: 'other@example.test', assignedTechName: 'Other.Tech', quickEditV4Items: [{ id: 'shared-future-catalog' }], serviceLineItems: [sharedLine] }));
    assert.equal((await s.preview()).proof.proofFingerprint, before);
});
test('linked Appointment and Gift/Voucher evidence remain security-critical invalidators', async () => {
    const s = setup(); await s.approve();
    s.db.seed('Appointments/appt-one', { id: 'appt-one', dateString: '2026-09-05', fohReviewedAmount: '240' });
    assert.equal((await s.report()).rows[0].auditDisposition.state, 'STALE');
    const t = setup(); await t.approve();
    t.db.seed('Gift_Card_Redemptions/gift-one', { id: 'gift-one', receiptId: 'receipt-one', giftCardCode: 'GIFT-ONE', amount: '240' });
    assert.equal((await t.report()).rows[0].auditDisposition.state, 'STALE');
});
test('canonical evidence ordering and review/approval proof parity are stable', async () => {
    const left = setup(), right = setup();
    left.db.seed('Receipts/b-receipt', { id: 'b-receipt', receiptId: 'receipt-one', amount: '240' });
    left.db.seed('Payments/a-payment', { id: 'a-payment', jobId: 'job-one', amount: '240' });
    right.db.seed('Payments/a-payment', { id: 'a-payment', jobId: 'job-one', amount: '240' });
    right.db.seed('Receipts/b-receipt', { id: 'b-receipt', receiptId: 'receipt-one', amount: '240' });
    assert.equal((await left.preview()).proof.proofFingerprint, (await right.preview()).proof.proofFingerprint);
    const s = setup(), preview = await s.preview();
    await s.call({ action: 'approveImmaterialException', requestId: 'proof-parity', expectedRevision: preview.revision, personId: f.person.personId, businessDate: '2026-09-05', proofFingerprint: preview.proof.proofFingerprint, approvalReason: 'Owner parity review', confirmed: true });
    assert.equal(s.db.docs.get('Commission_Settings/v2_materiality_event_proof-parity').certificate.proofFingerprint, preview.proof.proofFingerprint);
});
for (const [label, change] of [
    ['line net alias', { serviceLineItems: [{ ...f.job('200').serviceLineItems[0], netLineTotal: '2000' }] }],
    ['payable line alias', { serviceLineItems: [{ ...f.job('200').serviceLineItems[0], payableLineTotal: '2000' }] }],
    ['nested receipt', { receipt: { total: '2000' } }],
    ['receipt amount alias', { receiptAmount: '2000' }],
    ['service subtotal', { serviceSubtotal: '2000' }],
    ['taxable subtotal', { taxableSubtotal: '2000' }],
    ['paid amount alias', { paidAmount: '2000' }],
    ['missing group identity', { isGroupBooking: true }],
    ['conflicting quantities', { serviceLineItems: [{ ...f.job('200').serviceLineItems[0], price: '20', quantity: 1, qty: 100 }] }]
]) test('materiality cannot ignore ' + label, async () => {
    const s = setup('200', change); assert.equal((await s.preview()).proof.eligible, false); await assert.rejects(s.approve(), /not proven/);
});
test('linked payment exceeding the service envelope prevents initial approval', async () => {
    const s = setup(); s.db.seed('Payments/conflict', { jobId: 'job-one', amount: '2000' });
    assert.equal((await s.preview()).proof.reason, 'LINKED_SETTLEMENT_BOUND_UNPROVEN'); await assert.rejects(s.approve(), /not proven/);
});
test('owner demotion denies even a previously successful approval replay', async () => {
    const s = setup(), p = await s.preview(), data = { action: 'approveImmaterialException', personId: f.person.personId, businessDate: '2026-09-05', requestId: 'owner-only-retry', expectedRevision: p.revision, proofFingerprint: p.proof.proofFingerprint, approvalReason: 'Owner decision', confirmed: true };
    await s.call(data); s.operators.operators[0].roles.push('Manager');
    s.db.seed('Users/owner@example.test', { email: 'owner@example.test', roles: ['Manager'], active: true });
    await assert.rejects(s.call(data), /Admin or System Admin/);
});
test('unsupported linked receipt structure cannot be silently ignored', async () => {
    const s = setup(); s.db.seed('Receipts/unsupported', { jobId: 'job-one', unrecognizedTender: 'unknown' });
    assert.equal((await s.preview()).proof.eligible, false);
});
test('review with unchanged evidence appends history without invalidating a locked approval', async () => {
    const s = setup(); await s.approve(); await s.lock(); await s.command('reviewImmaterialException', 'review-unchanged');
    assert.equal(s.db.docs.get('Commission_Settings/v2_materiality_event_review-unchanged').state, 'REVIEWED');
    assert.equal((await s.report()).rows[0].auditDisposition.valid, true); await s.pay();
});
test('record read revalidates exception status instead of presenting stored approval as current', async () => {
    const s = setup(); await s.approve(); await s.lock(); s.db.seed('Active_Jobs/new', f.job('1500', { id: 'new' }));
    const data = await s.call({ action: 'records' }); assert.equal(data.records[0].auditCurrent.auditDisposition.valid, false);
    assert.equal(data.records[0].calculation.status, 'PENDING');
});
test('audit status is visible to technicians but approval controls are owner-only', () => {
    const view = require('./commission-presentation'), row = f.build([f.job('200', { giftCardRedemptions: [{ amount: 240 }] })]).rows[0];
    row.auditDisposition = { state: 'APPROVED', valid: true, maximumCommissionDelta: '0.00' };
    assert.match(view.renderDays([row]), /AUDIT OPEN - ZERO COMMISSION IMPACT APPROVED/); assert.match(view.renderDays([row]), /no Commission amount was removed/);
    assert.doesNotMatch(view.renderDays([row]), /data-audit-review/); assert.match(view.renderDays([row], { canReview: true }), /data-audit-review/);
    row.locked = true; row.auditDisposition = { state: 'STALE', valid: false }; assert.match(view.status(row), /LOCKED.*STALE/);
});
test('CSV, summary and Staff Summary preserve visible zero-impact disposition', () => {
    const fs = require('node:fs'), vm = require('node:vm'), view = require('./commission-presentation');
    const context = { window: { ThurayaCommissionEngine: engine, ThurayaCommissionPresentation: view } };
    vm.runInNewContext(fs.readFileSync(require.resolve('./commission-target-ui.js'), 'utf8'), context);
    const row = { ...f.build([f.job('200', { giftCardRedemptions: [{ amount: 240 }] })]).rows[0], auditDisposition: { state: 'APPROVED', valid: true, maximumCommissionDelta: '0.00' }, finalizationEligible: true };
    const ui = context.window.ThurayaCommissionV2;
    assert.match(ui.csvRows([row]), /AUDIT OPEN - ZERO COMMISSION IMPACT APPROVED/); assert.match(ui.csvRows([row]), /"PENDING"/);
    assert.match(ui.summary([row]), /Pending days: 1/); assert.match(ui.summary([row]), /zero impact approved: 1/); assert.match(ui.renderPeople([row]), /audit open, zero impact approved/);
});
for (const stale of [false, true]) test('positive award payment revalidates other period exception: ' + (stale ? 'stale blocked' : 'valid unchanged'), async () => {
    const s = setup(); s.db.seed('Active_Jobs/complete', f.job('1500', { id: 'complete', dateString: '2026-09-04' })); await s.approve();
    const range = { personId: f.person.personId, start: '2026-09-04', end: '2026-09-05' }, p = await s.call({ action: 'preview', ...range });
    assert.equal(p.summary.completeCommission, '30.00');
    await s.call({ action: 'lock', ...range, requestId: 'period-lock', expectedRevision: p.revision, fingerprint: p.fingerprint });
    const r = [...s.db.docs.values()].find(r => r.recordType === 'commission_daily_snapshot' && r.businessDate === '2026-09-04'); assert.equal(r.commissionAmount, '30.00');
    if (stale) s.db.seed('Active_Jobs/job-one', { ...s.source, revision: 'changed' });
    const config = await s.call({ action: 'config' }), payment = s.call({ action: 'markPaid', recordId: (await s.call({ action: 'records' })).records.find(r => r.businessDate === '2026-09-04').id, requestId: 'positive-award-payment', expectedRevision: config.revision });
    if (stale) await assert.rejects(payment, /stale or invalid/); else await payment;
    const records = (await s.call({ action: 'records' })).records;
    assert.equal(records.find(r => r.businessDate === '2026-09-04').payoutStatus, stale ? 'pending' : 'paid');
    assert.equal(records.reduce((sum, r) => sum.plus(r.commissionAmount), engine.money('0')).toString(), '30');
});
