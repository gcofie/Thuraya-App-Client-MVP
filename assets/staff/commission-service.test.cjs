const test = require('node:test');
const assert = require('node:assert/strict');
const { createCommissionService } = require('./functions/commission-v2-service');
const { person, binding, rule, job } = require('./commission-test-fixtures.cjs');

class MemoryDb {
    constructor() { this.docs = new Map(); this.version = 0; }
    seed(path, value) { this.docs.set(path, structuredClone(value)); this.version++; }
    collection(name) { return { name, doc: key => ({ path: `${name}/${key}`, get: async () => this.document(this.docs, `${name}/${key}`) }), get: async () => this.snapshot(this.docs, name) }; }
    document(docs, path) { return { exists: docs.has(path), data: () => structuredClone(docs.get(path)) }; }
    snapshot(docs, name) {
        const entries = [...docs].filter(([p]) => p.startsWith(name + '/') && p.split('/').length === 2);
        return { size: entries.length, docs: entries.map(([p, d]) => ({ id: p.split('/')[1], data: () => structuredClone(d), updateTime: null })) };
    }
    async runTransaction(callback) {
        for (let n = 0; n < 8; n++) {
            const version = this.version, snapshot = structuredClone(this.docs), writes = []; let writing = false;
            const result = await callback({ get: async query => { assert.equal(writing, false, 'all reads before writes'); return query.path ? this.document(snapshot, query.path) : this.snapshot(snapshot, query.name); }, set: (ref, value) => { writing = true; writes.push([ref.path, structuredClone(value)]); } });
            if (version !== this.version) continue;
            for (const [p, value] of writes) this.docs.set(p, value);
            this.version++; return result;
        }
        throw new Error('transaction contention');
    }
}
function setup({ enabled = true, projectId = 'thuraya-staging', configurationEnabled = projectId === 'thuraya-staging' } = {}) {
    const db = new MemoryDb();
    for (const [email, role] of [['manager@example.test', 'Manager'], [binding.stationEmail, 'Tech']]) db.seed('Users/' + email, { email, roles: [role], active: true });
    const operators = { version: 1, projectId, operators: [{ uid: 'manager-uid', email: 'manager@example.test', roles: ['Manager'], enabled: true }] };
    if (enabled) db.seed('Commission_Settings/v2_control', { schemaVersion: 2, recordType: 'commission_control', enabled: true, revision: 1 });
    db.seed('Commission_Settings/' + person.id, { ...person, schemaVersion: 2, recordType: 'commission_person' });
    db.seed('Commission_Settings/' + binding.id, binding);
    db.seed('Commission_Rules/' + rule.id, rule);
    db.seed('Active_Jobs/job-one', job('1500'));
    const serviceOptions = { db, projectId, operatorConfig: () => operators, targetConfigurationEnabled: () => configurationEnabled };
    const service = createCommissionService({ ...serviceOptions, now: () => new Date('2026-09-05T12:00:00Z') });
    const auth = { uid: 'manager-uid', token: { email: 'manager@example.test' } };
    const call = data => service.handle({ auth, data: { notes: 'Synthetic test approval', ...data } });
    return { db, service, auth, call, operators, serviceOptions };
}
const newRule = { ...rule, status: 'PUBLISHED', effectiveFrom: '2026-10-01', effectiveUntil: null, dailyTarget: '1500', commissionRate: '0.12' };
test('role claims cannot grant operator authority', async () => {
    const { service } = setup();
    await assert.rejects(service.handle({ auth: { uid: 'tech', token: { email: binding.stationEmail, roles: ['Admin'] } }, data: { action: 'enable', roles: ['Admin'] } }), /approved Commission operator/);
    await assert.rejects(service.handle({ data: { action: 'config' } }), /Sign in/);
});
test('initial activation requires separate environment authorization', async () => {
    const { call } = setup({ projectId: 'thuraya-client-telling', enabled: false });
    await assert.rejects(call({ action: 'enable', requestId: 'enable', expectedRevision: 0, activationConfirmed: true }), /separate authorization/);
});
test('overlapping published rule rejected with zero partial writes', async () => {
    const { call, db } = setup(); const before = structuredClone(db.docs);
    await assert.rejects(call({ action: 'saveRule', requestId: 'overlap', expectedRevision: 1, personId: person.personId, rule: newRule }), /Overlapping/);
    assert.deepEqual(db.docs, before);
});
test('close and successor preserves prior revision atomically', async () => {
    const { call, db } = setup();
    await call({ action: 'successor', requestId: 'next', expectedRevision: 1, personId: person.personId, ruleId: rule.id, rule: newRule });
    assert.equal(db.docs.get('Commission_Rules/' + rule.id).effectiveUntil, null);
    assert.equal(db.docs.get('Commission_Rules/v2_rule_next_closed').effectiveUntil, '2026-10-01');
    const report = await call({ action: 'preview', personId: person.personId, start: '2026-09-30', end: '2026-10-01' });
    assert.equal(report.rows[0].rule.dailyTarget, '1200'); assert.equal(report.rows[1].rule.dailyTarget, '1500');
});
test('concurrent conflicting successors cannot both commit', async () => {
    const { call, db } = setup();
    const results = await Promise.allSettled(['a', 'b'].map(requestId => call({ action: 'successor', requestId, expectedRevision: 1, personId: person.personId, ruleId: rule.id, rule: newRule })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal([...db.docs.keys()].filter(k => /^Commission_Rules\/v2_rule_[ab]$/.test(k)).length, 1);
});
test('published terms cannot be edited', async () => {
    const { call } = setup();
    await assert.rejects(call({ action: 'saveRule', requestId: 'edit', expectedRevision: 1, personId: person.personId, ruleId: rule.id, rule: newRule }), /cannot be edited/);
});
test('past rule publication needs confirmation, never guesses effective dates', async () => {
    const { call } = setup();
    await assert.rejects(call({ action: 'saveRule', requestId: 'past', expectedRevision: 1, personId: person.personId, rule: { ...newRule, effectiveFrom: '2026-09-02' } }), /Backdating/);
});
test('lock stores immutable daily rule/evidence snapshot', async () => {
    const { call, db } = setup();
    const report = await call({ action: 'preview', personId: person.personId, start: '2026-09-05', end: '2026-09-05' });
    const locked = await call({ action: 'lock', requestId: 'lock', expectedRevision: 1, personId: person.personId, start: report.start, end: report.end, fingerprint: report.fingerprint });
    const record = [...db.docs].find(([p]) => p.startsWith('Commission_Records/'))[1];
    assert.equal(record.commissionAmount, '30.00'); assert.equal(record.ruleSnapshot.id, rule.id); assert.equal(record.lockId, locked.lockId);
    db.seed('Active_Jobs/job-one', job('2000'));
    const later = await call({ action: 'preview', personId: person.personId, start: report.start, end: report.end });
    assert.equal(later.rows[0].dailyPayable, '30.00'); assert.equal(later.rows[0].sourceChanged, true);
});
test('stale preview rejected before any record is written', async () => {
    const { call, db } = setup();
    const report = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-05' }); db.seed('Active_Jobs/late', job('100', { id: 'late' }));
    await assert.rejects(call({ action: 'lock', requestId: 'stale', expectedRevision: 1, start: report.start, end: report.end, fingerprint: report.fingerprint }), /stale/);
    assert.equal([...db.docs.keys()].some(k => k.startsWith('Commission_Records/')), false);
});
test('pending day is not lockable', async () => {
    const { call, db } = setup(); db.seed('Active_Jobs/job-one', job('1500', { refundStatus: 'pending' }));
    const report = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-05' });
    await assert.rejects(call({ action: 'lock', requestId: 'pending', expectedRevision: 1, start: report.start, end: report.end, fingerprint: report.fingerprint }), /complete configured/);
});
test('overlapping period cannot lock same technician/day again', async () => {
    const { call } = setup();
    let report = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-05' });
    await call({ action: 'lock', requestId: 'first', expectedRevision: 1, start: report.start, end: report.end, fingerprint: report.fingerprint });
    report = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-06' });
    await assert.rejects(call({ action: 'lock', requestId: 'second', expectedRevision: 2, start: report.start, end: report.end, fingerprint: report.fingerprint }), /Locked commission/);
});
test('locked day rejects a backdated close or rule edit', async () => {
    const { call } = setup();
    const report = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-05' });
    await call({ action: 'lock', requestId: 'first', expectedRevision: 1, start: report.start, end: report.end, fingerprint: report.fingerprint });
    await assert.rejects(call({ action: 'closeRule', requestId: 'close', expectedRevision: 2, personId: person.personId, ruleId: rule.id, effectiveUntil: '2026-09-05' }), /Locked commission/);
    await call({ action: 'successor', requestId: 'future', expectedRevision: 2, personId: person.personId, ruleId: rule.id, rule: newRule });
});
test('request replay is idempotent; changed payload is rejected', async () => {
    const { call } = setup();
    const command = { action: 'successor', requestId: 'same', expectedRevision: 1, personId: person.personId, ruleId: rule.id, rule: newRule };
    assert.deepEqual(await call(command), await call(command));
    await assert.rejects(call({ ...command, notes: 'different' }), /different payload/);
});
test('personal reporting requires bound UID, not matching station email', async () => {
    const { service } = setup();
    await assert.rejects(service.handle({ auth: { uid: 'unbound', token: { email: binding.stationEmail, roles: ['Tech'] } }, data: { action: 'preview', personId: person.personId, start: '2026-09-05', end: '2026-09-05' } }), /not authorized/);
    const report = await service.handle({ auth: { uid: 'tech-uid', token: { email: binding.stationEmail } }, data: { action: 'preview', start: '2026-09-05', end: '2026-09-05' } });
    assert.equal(report.rows.length, 1);
});
test('mark paid preserves snapshot amounts and hash', async () => {
    const { call } = setup();
    const preview = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-05' });
    await call({ action: 'lock', requestId: 'first', expectedRevision: 1, start: preview.start, end: preview.end, fingerprint: preview.fingerprint });
    const before = (await call({ action: 'records' })).records[0];
    await call({ action: 'markPaid', requestId: 'pay', expectedRevision: 2, recordId: before.id, commissionAmount: '999999' });
    const after = (await call({ action: 'records' })).records[0];
    assert.equal(after.payoutStatus, 'paid'); assert.equal(after.commissionAmount, before.commissionAmount); assert.equal(after.snapshotHash, before.snapshotHash);
});
module.exports = { MemoryDb, setup };

function correctionSetup(options = {}) {
    const base = setup();
    base.db.docs.delete('Commission_Rules/' + rule.id);
    base.db.seed('Commission_Settings/' + person.id, { ...person, recordType: 'commission_person', schemaVersion: 2, enrollmentFrom: '2026-09-06', staffRef: binding.stationEmail, accessUids: [], ruleHeads: {} });
    base.db.seed('Commission_Settings/' + binding.id, { ...binding, effectiveFrom: '2026-09-06' });
    const service = createCommissionService({ ...base.serviceOptions, now: () => new Date('2026-09-07T12:00:00Z'), resolveLoginUid: async uid => ({ uid, email: binding.stationEmail, disabled: false }), ...options });
    const call = data => service.handle({ auth: base.auth, data });
    const proposal = {
        action: 'correctEnrollment', requestId: 'correct', expectedRevision: 1, personId: person.personId,
        bindingId: binding.id, expectedBindingRevision: 1, expectedEnrollmentRevision: 1,
        approvalReason: 'Owner confirmed the synthetic identity start', identityConfirmed: true, backdateConfirmed: true,
        proposed: { displayName: person.displayName, staffRef: binding.stationEmail, accessUids: [], binding: { ...binding, effectiveFrom: '2026-08-01' } }
    };
    const preview = (p = proposal) => call({ action: 'impact', proposal: p });
    const save = async (p = proposal) => { const review = await preview(p); return call({ ...p, impactFingerprint: review.fingerprint, correctionConfirmed: true }); };
    return { ...base, service, call, proposal, preview, save };
}

test('enrollment correction preserves person and immutable old revision with readable audit', async () => {
    const { db, call, save, proposal } = correctionSetup(); const old = structuredClone(db.docs.get('Commission_Settings/' + binding.id));
    const result = await save(); const config = await call({ action: 'config' });
    assert.equal(result.personId, person.personId); assert.equal(config.persons.length, 1);
    assert.equal(config.persons[0].enrollmentFrom, '2026-08-01'); assert.equal(config.bindings.length, 1);
    assert.equal(config.bindings[0].effectiveUntil, null); assert.equal(config.bindings[0].revision, 2);
    assert.equal(config.bindings[0].supersedesRevisionId, binding.id);
    assert.deepEqual(db.docs.get('Commission_Settings/' + binding.id), old);
    assert.equal(config.enrollmentHistory.length, 2);
    const current = config.enrollmentHistory.find(r => r.authoritative), prior = config.enrollmentHistory.find(r => !r.authoritative);
    assert.equal(prior.supersededBy, current.id); assert.equal(current.previousValues.binding.effectiveFrom, '2026-09-06');
    assert.equal(current.newValues.binding.effectiveFrom, '2026-08-01'); assert.equal(current.approvalReason, proposal.approvalReason);
    assert.equal(current.backdateConfirmed, true); assert.equal(current.confirmedBy, 'manager-uid'); assert.equal(current.confirmedAt, '2026-09-07T12:00:00.000Z');
    assert.match(current.impactFingerprint, /^[a-f0-9]{64}$/); assert.equal(current.finalConfirmed, true);
    assert.equal(db.docs.get('Commission_Settings/v2_request_correct').identityAudit.approvalReason, proposal.approvalReason);
});

for (const [name, edit, expected] of [
    ['display name', p => { p.proposed.displayName = 'Corrected display'; p.proposed.binding.effectiveFrom = '2026-09-06'; p.backdateConfirmed = false; }, 'DISPLAY_CORRECTION'],
    ['future end date', p => { p.proposed.binding.effectiveFrom = '2026-09-06'; p.proposed.binding.effectiveUntil = '2026-10-01'; p.backdateConfirmed = false; }, 'IDENTITY_CORRECTION'],
    ['station', p => { p.proposed.binding.stationEmail = 'corrected@example.test'; }, 'BACKDATED_CORRECTION'],
    ['staff identity', p => { p.proposed.binding.staffId = 'staff-corrected'; }, 'BACKDATED_CORRECTION'],
    ['confirmed alias', p => { p.proposed.binding.aliases = ['Corrected.Tech']; }, 'BACKDATED_CORRECTION'],
    ['excluded alias', p => { p.proposed.binding.excludedAliases = ['Prior.Owner', 'Another.Owner']; }, 'BACKDATED_CORRECTION'],
    ['login UID', p => { p.proposed.accessUids = ['new-tech-uid']; }, 'BACKDATED_CORRECTION']
]) test('audited enrollment field correction: ' + name, async () => {
    const { proposal, preview, save, call } = correctionSetup(); edit(proposal);
    const impact = await preview(); assert.equal(impact.classification, expected); await save();
    const config = await call({ action: 'config' }); assert.equal(config.enrollmentHistory.find(r => r.authoritative).classification, expected);
});

for (const [name, change, pattern] of [
    ['reason', p => { p.approvalReason = ''; }, /reason/],
    ['backdate confirmation', p => { p.backdateConfirmed = false; }, /backdating confirmation/],
    ['identity confirmation', p => { p.identityConfirmed = false; }, /identity confirmation/],
    ['person ID immutability', p => { p.proposed.personId = 'another'; }, /not editable/],
    ['binding revision', p => { p.expectedBindingRevision = 99; }, /revision changed/],
    ['person revision', p => { p.expectedEnrollmentRevision = 99; }, /revision changed/],
    ['excluded alias removal', p => { p.proposed.binding.excludedAliases = []; }, /Removing an excluded/],
    ['invalid login UID', p => { p.proposed.accessUids = ['bad/uid']; }, /Invalid confirmed login/],
    ['malformed station', p => { p.proposed.binding.stationEmail = 'invalid'; }, /station email/],
    ['empty interval', p => { p.proposed.binding.effectiveUntil = p.proposed.binding.effectiveFrom; }, /RANGE/]
]) test('correction rejects missing or invalid ' + name, async () => {
    const { proposal, preview, db } = correctionSetup(); change(proposal); const before = structuredClone(db.docs);
    await assert.rejects(preview(), pattern); assert.deepEqual(db.docs, before);
});

test('correction requires fresh fingerprint and explicit final confirmation', async () => {
    const { proposal, call, preview, db } = correctionSetup();
    await assert.rejects(call({ ...proposal, correctionConfirmed: true }), /missing or stale/);
    const review = await preview(); await assert.rejects(call({ ...proposal, impactFingerprint: review.fingerprint }), /final enrollment correction confirmation/);
    db.seed('Active_Jobs/late', job('300', { id: 'late', dateString: '2026-08-02' }));
    await assert.rejects(call({ ...proposal, impactFingerprint: review.fingerprint, correctionConfirmed: true }), /stale/);
});

test('correction fingerprint binds proposed values and actor', async () => {
    const { proposal, call, preview } = correctionSetup(); const review = await preview();
    await assert.rejects(call({ ...proposal, proposed: { ...proposal.proposed, displayName: 'Tampered' }, impactFingerprint: review.fingerprint, correctionConfirmed: true }), /stale/);
});

test('sequential and concurrent correction attempts cannot create duplicate authority', async () => {
    const { proposal, preview, call, db } = correctionSetup(); const review = await preview();
    const results = await Promise.allSettled(['a', 'b'].map(requestId => call({ ...proposal, requestId, impactFingerprint: review.fingerprint, correctionConfirmed: true })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal((await call({ action: 'config' })).bindings.length, 1);
    assert.equal([...db.docs.keys()].filter(k => /^Commission_Settings\/v2_binding_[ab]$/.test(k)).length, 1);
    await assert.rejects(call({ ...proposal, requestId: 'later', expectedRevision: 2, impactFingerprint: review.fingerprint, correctionConfirmed: true }), /Current enrollment binding not found/);
});

test('correction request replay returns same revision without additional writes', async () => {
    const { proposal, preview, call, db } = correctionSetup(); const review = await preview();
    const command = { ...proposal, impactFingerprint: review.fingerprint, correctionConfirmed: true };
    const first = await call(command); const before = structuredClone(db.docs);
    assert.deepEqual(await call(command), first); assert.deepEqual(db.docs, before);
});

test('technician and self-promoted unapproved Manager cannot correct enrollment', async () => {
    const { proposal, service, db } = correctionSetup();
    const request = { auth: { uid: 'tech-uid', token: { email: binding.stationEmail } }, data: proposal };
    await assert.rejects(service.handle(request), /approved Commission operator/);
    db.seed('Users/' + binding.stationEmail, { email: binding.stationEmail, role: 'System Admin', roles: ['System Admin'] });
    await assert.rejects(service.handle(request), /approved Commission operator/);
    await assert.rejects(service.handle({ data: proposal }), /Sign in/);
});

test('configuration exposes correction capability only to authorized operator', async () => {
    const { call, service } = correctionSetup(); assert.equal((await call({ action: 'config' })).capabilities.correctEnrollment, true);
    const config = await service.handle({ auth: { uid: 'tech-uid', token: { email: binding.stationEmail } }, data: { action: 'config' } });
    assert.equal(config.capabilities.correctEnrollment, false); assert.deepEqual(config.enrollmentHistory, []);
});

test('client-editable legacy-shaped records cannot masquerade as trusted enrollment audit', async () => {
    const { db, call } = correctionSetup();
    db.seed('Commission_Settings/legacy-lookalike', { recordType: 'commission_enrollment_revision', personId: person.personId, newRevision: 500, approvalReason: 'Untrusted spoof' });
    assert.deepEqual((await call({ action: 'config' })).enrollmentHistory, []);
});

for (const [name, resolver, pattern] of [
    ['unknown account', async () => { throw new Error('not found'); }, /does not resolve/],
    ['disabled account', async uid => ({ uid, email: binding.stationEmail, disabled: true }), /must match/],
    ['different Staff account', async uid => ({ uid, email: 'other@example.test' }), /must match/]
]) test('login correction rejects ' + name, async () => {
    const { proposal, preview } = correctionSetup({ resolveLoginUid: resolver }); proposal.proposed.accessUids = ['new-tech']; await assert.rejects(preview(), pattern);
});

test('login correction rejects UID already bound to another person', async () => {
    const { proposal, preview, db } = correctionSetup(); proposal.proposed.accessUids = ['another-uid'];
    db.seed('Commission_Settings/v2_person_other', { schemaVersion: 2, recordType: 'commission_person', personId: 'other', accessUids: ['another-uid'] });
    await assert.rejects(preview(), /already belongs/);
});

for (const [name, collection, value] of [
    ['immutable snapshot', 'Commission_Records', { schemaVersion: 2, personId: person.personId, businessDate: '2026-08-10' }],
    ['legacy paid record', 'Commission_Records', { staffEmail: binding.stationEmail, periodStart: '2026-08-01', periodEnd: '2026-08-31', payoutStatus: 'paid' }],
    ['orphan V2 lock', 'Commission_Locks', { schemaVersion: 2, personId: person.personId, periodStart: '2026-08-01', periodEnd: '2026-08-31', recordIds: ['missing'] }],
    ['legacy lock', 'Commission_Locks', { roleFilter: 'tech', periodStart: '2026-08-01', periodEnd: '2026-08-31' }]
]) test('locked coverage blocks correction: ' + name, async () => {
    const { db, preview, save } = correctionSetup(); db.seed(collection + '/locked', value);
    const review = await preview(); assert.equal(review.blocked, true); const before = structuredClone(db.docs);
    await assert.rejects(save(), /LOCKED PERIOD CORRECTION/); assert.deepEqual(db.docs, before);
});

test('display-only correction preserves locked financial truth', async () => {
    const { proposal, db, save } = correctionSetup(); proposal.proposed.binding.effectiveFrom = '2026-09-06'; proposal.proposed.displayName = 'Typo corrected'; proposal.backdateConfirmed = false;
    db.seed('Commission_Records/locked', { schemaVersion: 2, personId: person.personId, businessDate: '2026-09-06', commissionAmount: '30.00' });
    const before = structuredClone(db.docs.get('Commission_Records/locked')); await save(); assert.deepEqual(db.docs.get('Commission_Records/locked'), before);
});

test('same-person Add Binding duplicate is rejected and superseded intervals remain auditable', async () => {
    const { call, save, db } = correctionSetup(); await save();
    const proposal = { action: 'saveBinding', requestId: 'duplicate', expectedRevision: 2, personId: person.personId, binding: { ...binding, effectiveFrom: '2026-10-01' }, notes: 'Duplicate should fail', identityConfirmed: true };
    await assert.rejects(call(proposal), /IDENTITY_OVERLAP/);
    assert.equal(db.docs.get('Commission_Settings/' + binding.id).effectiveUntil, null);
    assert.equal((await call({ action: 'config' })).bindings.length, 1);
});

test('cross-person identity overlap cannot be introduced by correction', async () => {
    const { db, preview } = correctionSetup();
    db.seed('Commission_Settings/v2_person_other', { schemaVersion: 2, recordType: 'commission_person', personId: 'other', enrollmentFrom: '2026-08-01', bindingHeads: { other: 'other-binding' } });
    db.seed('Commission_Settings/other-binding', { ...binding, id: 'other-binding', personId: 'other', bindingFamilyId: 'other', effectiveFrom: '2026-08-01', effectiveUntil: '2026-09-06' });
    await assert.rejects(preview(), /IDENTITY_OVERLAP/);
});

test('finite binding revision preserves end and reconciles earliest coverage', async () => {
    const { db, proposal, save, call } = correctionSetup();
    db.seed('Commission_Settings/' + binding.id, { ...binding, effectiveFrom: '2026-09-06', effectiveUntil: '2026-12-01' });
    proposal.proposed.binding.effectiveUntil = '2026-12-01'; await save();
    const config = await call({ action: 'config' }); assert.equal(config.bindings[0].effectiveUntil, '2026-12-01'); assert.equal(config.persons[0].enrollmentFrom, '2026-08-01');
});

test('excluded prior owner remains excluded after backdated correction', async () => {
    const { save, call } = correctionSetup(); await save(); const config = await call({ action: 'config' });
    const engine = require('./functions/commission-engine');
    const excluded = engine.resolveCommissionIdentity(job('100', { assignedTechName: 'Prior.Owner', dateString: '2026-08-10' }), '2026-08-10', config.persons, config.bindings);
    assert.notEqual(excluded.personId, person.personId);
    const included = engine.resolveCommissionIdentity(job('100', { dateString: '2026-08-10' }), '2026-08-10', config.persons, config.bindings);
    assert.equal(included.personId, person.personId);
});

test('rule-start gate follows corrected authoritative enrollment and creates no automatic rule', async () => {
    const { save, call, db } = correctionSetup(); await save(); assert.equal([...db.docs.keys()].some(k => k.startsWith('Commission_Rules/')), false);
    const proposal = { action: 'saveRule', requestId: 'new-rule', expectedRevision: 2, personId: person.personId, notes: 'Synthetic rule after correction', backdateConfirmed: true, rule: { ...rule, effectiveFrom: '2026-08-01' } };
    let review = await call({ action: 'impact', proposal }); await call({ ...proposal, impactFingerprint: review.fingerprint });
    const tooEarly = { ...proposal, requestId: 'too-early', expectedRevision: 3, rule: { ...rule, effectiveFrom: '2026-07-31', status: 'DRAFT' } };
    review = await call({ action: 'impact', proposal: tooEarly }); await assert.rejects(call({ ...tooEarly, impactFingerprint: review.fingerprint }), /before enrollment/);
});

test('correction performs no financial, payout, rule or enrollment-duplicate writes', async () => {
    const { db, save } = correctionSetup(); db.seed('Sales/untouched', { amount: 123 }); db.seed('Appointments/untouched', { amount: 456 });
    const before = structuredClone(db.docs); await save();
    for (const [path, value] of before) if (!path.startsWith('Commission_Settings/')) assert.deepEqual(db.docs.get(path), value);
    for (const path of db.docs.keys()) if (!before.has(path)) assert.ok(path.startsWith('Commission_Settings/'));
    assert.equal([...db.docs.keys()].filter(k => k.startsWith('Commission_Settings/v2_person_')).length, 1);
});

test('backdated new person retains confirmation reason fingerprint actor and open-ended coverage', async () => {
    const { call, db } = correctionSetup();
    const proposal = { action: 'enrollPerson', requestId: 'new-person', expectedRevision: 1, personId: 'new-person', displayName: 'Generic new technician', enrollmentFrom: '2026-05-08', identityConfirmed: true, backdateConfirmed: true, approvalReason: 'Owner reference NEW-2026', binding: { stationEmail: 'new@example.test', aliases: ['New.Tech'], excludedAliases: ['Former.Tech'], effectiveFrom: '2026-05-08', effectiveUntil: null } };
    const review = await call({ action: 'impact', proposal }); await call({ ...proposal, impactFingerprint: review.fingerprint });
    const audit = db.docs.get('Commission_Settings/v2_enrollment_new-person');
    assert.equal(audit.approvalReason, proposal.approvalReason); assert.equal(audit.backdateConfirmed, true); assert.equal(audit.impactFingerprint, review.fingerprint); assert.equal(audit.confirmedBy, 'manager-uid');
    assert.equal(audit.newValues.binding.effectiveUntil, null); assert.equal(audit.newValues.enrollmentFrom, '2026-05-08');
});

test('new-person enrollment cannot have a different first binding start', async () => {
    const { call } = correctionSetup(); await assert.rejects(call({ action: 'enrollPerson', requestId: 'different-start', expectedRevision: 1, personId: 'new-person', displayName: 'New', enrollmentFrom: '2026-10-01', identityConfirmed: true, notes: 'Synthetic', binding: { stationEmail: 'new@example.test', aliases: ['New'], effectiveFrom: '2026-10-02' } }), /must match person enrollment/);
});

test('cancel future rule retains original revision and does not calculate its period',async()=>{
 const {call,db}=setup();
 await call({action:'successor',requestId:'future-one',expectedRevision:1,personId:person.personId,ruleId:rule.id,rule:newRule});
 await call({action:'cancelRule',requestId:'cancel-future',expectedRevision:2,personId:person.personId,ruleId:'v2_rule_future-one'});
 assert.equal(db.docs.get('Commission_Rules/v2_rule_future-one').status,'PUBLISHED');
 const report=await call({action:'preview',personId:person.personId,start:'2026-10-01',end:'2026-10-01'});
 assert.equal(report.rows[0].status,'NOT_CONFIGURED');
});

test('backdating requires a fresh trusted impact preview', async () => {
    const { db, auth, serviceOptions } = setup();
    const service=createCommissionService({...serviceOptions,now:()=>new Date('2026-09-10T12:00:00Z')});
    const call=data=>service.handle({auth,data});
    const proposal={action:'closeRule',requestId:'impact-close',expectedRevision:1,personId:person.personId,ruleId:rule.id,effectiveUntil:'2026-09-09',notes:'Explicit owner-approved backdate',backdateConfirmed:true};
    await assert.rejects(call(proposal),/impact preview/);
    const review=await call({action:'impact',proposal});
    assert.equal(review.start,'2026-09-09');assert.equal(review.required,true);
    db.seed('Active_Jobs/late',job('100',{id:'late',dateString:'2026-09-09'}));
    await assert.rejects(call({...proposal,impactFingerprint:review.fingerprint}),/stale/);
    const fresh=await call({action:'impact',proposal});
    await call({...proposal,impactFingerprint:fresh.fingerprint});
    assert.equal(db.docs.get('Commission_Rules/v2_rule_impact-close_closed').effectiveUntil,'2026-09-09');
});

test('closing requires notes, and undated draft may be retained without publication',async()=>{
    const {call}=setup();
    await assert.rejects(call({action:'closeRule',requestId:'no-note',expectedRevision:1,personId:person.personId,ruleId:rule.id,effectiveUntil:'2026-10-01',notes:''}),/approval note/);
    const result=await call({action:'saveRule',requestId:'draft',expectedRevision:1,personId:person.personId,rule:{...newRule,status:'DRAFT',effectiveFrom:''}});
    assert.ok(result.ruleId);
});

for (const role of ['Admin', 'Manager', 'System Admin']) test('claimless approved ' + role + ' resolves operator capability', async () => {
    const { db, operators, call } = setup();
    db.seed('Users/manager@example.test', { role, active: true });
    operators.operators[0].roles = [role];
    const config = await call({ action: 'config' });
    assert.equal(config.manager, true);
    assert.equal(config.capabilities.legacyAdmin, true);
});

for (const [name, change] of [
    ['approved UID with technician Staff role', ({ db }) => db.seed('Users/manager@example.test', { roles: ['Tech'] })],
    ['manager Staff role without approved UID', ({ operators }) => { operators.operators = []; }],
    ['wrong environment configuration', ({ operators }) => { operators.projectId = 'different-project'; }],
    ['revoked operator', ({ operators }) => { operators.operators[0].enabled = false; }],
    ['pinned email mismatch', ({ operators }) => { operators.operators[0].email = 'other@example.test'; }],
    ['manager-like substring role', ({ db }) => db.seed('Users/manager@example.test', { roles: ['not-manager'] })],
    ['duplicate UID configuration', ({ operators }) => { operators.operators.push({ ...operators.operators[0] }); }]
]) test(name + ' cannot mutate Commission', async () => {
    const state = setup(); change(state); const before = structuredClone(state.db.docs);
    assert.equal((await state.call({ action: 'config' })).manager, false);
    await assert.rejects(state.call({ action: 'legacySaveRule', requestId: 'forbidden', expectedRevision: 1 }), /approved Commission operator/);
    assert.deepEqual(state.db.docs, before);
});

test('missing or malformed server configuration fails closed, including forged role claims', async () => {
    const { serviceOptions, auth } = setup();
    for (const raw of ['', '{broken', '{}', null]) {
        const service = createCommissionService({ ...serviceOptions, operatorConfig: () => raw });
        const request = { auth: { ...auth, token: { ...auth.token, roles: ['System Admin'] } } };
        assert.equal((await service.handle({ ...request, data: { action: 'config' } })).manager, false);
        await assert.rejects(service.handle({ ...request, data: { action: 'legacyLock' } }), /approved Commission operator/);
    }
});

test('client Staff role self-escalation never supplies UID approval', async () => {
    const { db, service } = setup();
    db.seed('Users/' + binding.stationEmail, { roles: ['System Admin'], uid: 'manager-uid', email: 'manager@example.test' });
    const auth = { uid: 'tech-uid', token: { email: binding.stationEmail, roles: ['Manager'] } };
    assert.equal((await service.handle({ auth, data: { action: 'config' } })).manager, false);
    for (const action of ['saveRule', 'successor', 'saveBinding', 'lock', 'markPaid', 'enable', 'legacySaveRule']) {
        await assert.rejects(service.handle({ auth, data: { action } }), /approved Commission operator/);
    }
});

test('missing and disabled Staff profiles fail closed', async () => {
    for (const data of [null, { active: false }, { disabled: true }, { status: 'terminated' }]) {
        const { db, call } = setup();
        if (data === null) db.docs.delete('Users/manager@example.test');
        else db.seed('Users/manager@example.test', { roles: ['Manager'], ...data });
        await assert.rejects(call({ action: 'config' }), /Staff/);
    }
});

test('Staff and operator authority are rechecked in the transaction', async () => {
    for (const field of ['staff', 'allowlist']) {
        const { db, call, operators } = setup();
        const original = db.runTransaction.bind(db);
        db.runTransaction = callback => {
            if (field === 'staff') db.seed('Users/manager@example.test', { roles: ['Tech'] });
            else operators.operators = [];
            return original(callback);
        };
        await assert.rejects(call({ action: 'successor', requestId: 'race', expectedRevision: 1, personId: person.personId, ruleId: rule.id, rule: newRule }), /approved Commission operator/);
        assert.equal(db.docs.has('Commission_Rules/v2_rule_race'), false);
    }
});

function emptyConfiguration(state) {
    for (const path of state.db.docs.keys()) if (path.startsWith('Commission_')) state.db.docs.delete(path);
    return state;
}
const legacyInput = { roleKey: 'tech', roleName: 'Technician', commissionType: 'percentage', appliesTo: 'serviceRevenue', percentage: 10, active: true };
test('production-shaped legacy administration works without target activation', async () => {
    const { db, call } = emptyConfiguration(setup({ enabled: false, projectId: 'thuraya-client-telling' }));
    const before = structuredClone(db.docs);
    const config = await call({ action: 'config' });
    assert.equal(config.capabilities.legacyAdmin, true);
    assert.equal(config.capabilities.targetAdmin, false);
    assert.equal(config.capabilities.enableTarget, false);
    const blank = await call({ action: 'preview', start: '2026-09-05', end: '2026-09-05' });
    assert.equal(blank.status, 'NOT_CONFIGURED');
    await call({ action: 'report', start: '2026-09-05', end: '2026-09-05' });
    assert.deepEqual(db.docs, before, 'startup/config/report are read-only');
    const saved = await call({ action: 'legacySaveRule', requestId: 'legacy', expectedRevision: 0, rule: legacyInput });
    assert.equal(db.docs.get('Commission_Settings/v2_control').enabled, false);
    assert.equal((await call({ action: 'config' })).persons.length, 0);
    await call({ action: 'legacyToggleRule', requestId: 'toggle', expectedRevision: 1, ruleId: saved.ruleId, active: false });
    await call({ action: 'legacyToggleRule', requestId: 'toggle-on', expectedRevision: 2, ruleId: saved.ruleId, active: true });
    const report = await call({ action: 'report', start: '2026-09-05', end: '2026-09-05' });
    assert.ok(report.rows.length);
    await call({ action: 'legacyLock', requestId: 'legacy-lock', expectedRevision: 3, start: '2026-09-05', end: '2026-09-05', roleFilter: 'tech', rowsHash: report.rowsHash });
    const record = (await call({ action: 'records' })).records[0];
    await call({ action: 'markPaid', requestId: 'legacy-paid', expectedRevision: 4, recordId: record.id });
    assert.equal((await call({ action: 'records' })).records[0].payoutStatus, 'paid');
    assert.equal(db.docs.get('Commission_Settings/v2_control').enabled, false);
    assert.equal([...db.docs.values()].some(d => d.ruleType === 'DAILY_TARGET_MARGINAL'), false);
});

test('explicit target setup works without project-name staging special cases', async () => {
    const { db, call } = emptyConfiguration(setup({ enabled: false, projectId: 'thuraya-client-telling', configurationEnabled: true }));
    await assert.rejects(call({ action: 'enable', requestId: 'missing-confirmation', expectedRevision: 0 }), /explicit confirmation/);
    assert.equal(db.docs.has('Commission_Settings/v2_control'), false);
    await call({ action: 'enable', requestId: 'confirmed', expectedRevision: 0, activationConfirmed: true });
    const config = await call({ action: 'config' });
    assert.equal(config.capabilities.targetAdmin, true);
    assert.equal(config.rules.length, 0);
    assert.equal(config.persons.length, 0);
    assert.equal(config.bindings.length, 0);
});

test('target mutation remains denied when only legacy control exists', async () => {
    const { call, db } = emptyConfiguration(setup({ enabled: false, configurationEnabled: false }));
    await call({ action: 'legacySaveRule', requestId: 'legacy-only', expectedRevision: 0, rule: legacyInput });
    const before = structuredClone(db.docs);
    await assert.rejects(call({ action: 'enrollPerson', requestId: 'no-enroll', expectedRevision: 1 }), /not enabled/);
    await assert.rejects(call({ action: 'enable', requestId: 'no-activate', expectedRevision: 1, activationConfirmed: true }), /separate authorization/);
    assert.deepEqual(db.docs, before);
});

function stabilizationSetup() {
    const s = setup();
    s.db.seed('Users/manager@example.test', { email: 'manager@example.test', name: 'Synthetic Owner', roles: ['Admin'], active: true });
    s.operators.operators[0].roles = ['Admin'];
    s.db.docs.delete('Commission_Rules/' + rule.id); s.db.docs.delete('Active_Jobs/job-one');
    s.db.seed('Commission_Settings/' + person.id, { ...person, schemaVersion: 2, recordType: 'commission_person', ruleHeads: {}, enrollmentRevision: 1 });
    s.proposal = { action: 'voidEnrollment', requestId: 'void-one', personId: person.personId, expectedRevision: 1, expectedEnrollmentRevision: 1, approvalReason: 'Synthetic enrollment was entered by mistake', notes: 'Synthetic test approval' };
    s.review = proposal => s.call({ action: 'impact', proposal: proposal || s.proposal });
    s.void = async () => { const preview = await s.review(); return s.call({ ...s.proposal, impactFingerprint: preview.fingerprint, voidConfirmed: true }); };
    return s;
}
test('safe Void preserves original bindings and audit, removes authority and selection, writes no financial data', async () => {
    const s = stabilizationSetup(), before = structuredClone(s.db.docs), oldBinding = before.get('Commission_Settings/' + binding.id);
    const preview = await s.review(); assert.equal(preview.blocked, false); assert.deepEqual(s.db.docs, before);
    await s.void(); const config = await s.call({ action: 'config' });
    assert.equal(config.persons.length, 0); assert.equal(config.bindings.length, 0); assert.equal(config.archivedPersons[0].status, 'VOIDED');
    assert.deepEqual(s.db.docs.get('Commission_Settings/' + binding.id), oldBinding);
    const audit = config.enrollmentHistory.find(r => r.action === 'voidEnrollment');
    assert.equal(audit.approvalReason, s.proposal.approvalReason); assert.equal(audit.voidConfirmed, true); assert.equal(audit.confirmedBy, 'manager-uid'); assert.match(audit.impactFingerprint, /^[a-f0-9]{64}$/);
    assert.equal(audit.previousValues.personId, person.personId); assert.equal(audit.newValues.personId, person.personId);
    const changed = [...s.db.docs].filter(([path,value]) => !before.has(path) || JSON.stringify(value) !== JSON.stringify(before.get(path)));
    assert.equal(changed.length, 4); assert.ok(changed.every(([path]) => path.startsWith('Commission_Settings/')));
});
for (const [label,seed] of [
    ['published rule', s => s.db.seed('Commission_Rules/' + rule.id, rule)],
    ['draft rule', s => s.db.seed('Commission_Rules/' + rule.id, { ...rule, status: 'DRAFT' })],
    ['cancelled rule evidence', s => s.db.seed('Commission_Rules/' + rule.id, { ...rule, status: 'CANCELLED' })],
    ['source activity', s => s.db.seed('Active_Jobs/job-one', job('1450'))],
    ['unpaid activity', s => s.db.seed('Active_Jobs/job-one', job('1450', { paymentStatus: 'Unpaid' }))],
    ['immutable payout', s => s.db.seed('Commission_Records/protected', { personId: person.personId, payoutStatus: 'paid' })],
    ['orphan lock', s => s.db.seed('Commission_Locks/protected', { schemaVersion: 2, roleFilter: 'tech', periodStart: '2026-09-01', periodEnd: '2026-09-30' })]
]) test('Void blocks ' + label + ' without partial writes', async () => {
    const s = stabilizationSetup(); seed(s); const before = structuredClone(s.db.docs);
    assert.equal((await s.review()).blocked, true); await assert.rejects(s.void(), /source activity, rules or protected/); assert.deepEqual(s.db.docs, before);
});
test('Void requires pinned Admin capability, not Manager self-promotion', async () => {
    const s = stabilizationSetup(); s.operators.operators[0].roles = ['Manager'];
    s.db.seed('Users/manager@example.test', { email: 'manager@example.test', roles: ['Manager','Admin'], active: true });
    const before = structuredClone(s.db.docs), config = await s.call({ action: 'config' });
    assert.equal(config.capabilities.voidEnrollment, false); await assert.rejects(s.review(), /approved Admin/); assert.deepEqual(s.db.docs, before);
});
test('Void rejects missing reason, stale fingerprint, missing confirmation and concurrent requests', async () => {
    const s = stabilizationSetup(); await assert.rejects(s.review({ ...s.proposal, approvalReason: '', notes: '' }), /reason/);
    const reviewed = await s.review(); await assert.rejects(s.call({ ...s.proposal, impactFingerprint: reviewed.fingerprint }), /final Void/);
    await assert.rejects(s.call({ ...s.proposal, impactFingerprint: 'stale', voidConfirmed: true }), /stale/);
    s.db.seed('Active_Jobs/new', job('1500')); await assert.rejects(s.call({ ...s.proposal, impactFingerprint: reviewed.fingerprint, voidConfirmed: true }), /stale/);
    s.db.docs.delete('Active_Jobs/new'); const fresh = await s.review();
    const results = await Promise.allSettled(['void-a','void-b'].map(requestId => s.call({ ...s.proposal, requestId, impactFingerprint: fresh.fingerprint, voidConfirmed: true })));
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
});
test('voided person cannot acquire a rule or be re-created with the same immutable ID', async () => {
    const s = stabilizationSetup(); await s.void();
    await assert.rejects(s.call({ action:'saveRule',requestId:'later',expectedRevision:2,personId:person.personId,rule:newRule }), /Person not found/);
    const request = { action:'enrollPerson',requestId:'reuse',expectedRevision:2,personId:person.personId,displayName:'Duplicate',enrollmentFrom:'2026-10-01',identityConfirmed:true,binding:{...binding,effectiveFrom:'2026-10-01'} };
    await assert.rejects(s.call(request), /Person already exists/);
});
for(const end of [null, '2026-12-01']) test('configuration derives authoritative enrollment end ' + end, async()=>{
    const s=stabilizationSetup();s.db.seed('Commission_Settings/'+binding.id,{...binding,effectiveUntil:end});
    const p=(await s.call({action:'config'})).persons[0];assert.equal(p.enrollmentFrom,person.enrollmentFrom);assert.equal(p.enrollmentUntil,end);
});
test('initial rule narrowing needs confirmation and preserves the coverage-gap audit', async()=>{
    const s=stabilizationSetup();
    const p={action:'saveRule',requestId:'first',expectedRevision:1,personId:person.personId,notes:'Owner chooses later coverage',rule:{...newRule,effectiveFrom:'2026-09-06',status:'DRAFT'}};
    await assert.rejects(s.call(p),/coverage-gap confirmation/);
    await s.call({...p,coverageGapConfirmed:true});assert.equal(s.db.docs.get('Commission_Rules/v2_rule_first').coverageGapConfirmed,true);
});
test('rule cannot run outside finite enrollment or across a binding gap', async()=>{
    const s=stabilizationSetup();s.db.seed('Commission_Settings/'+binding.id,{...binding,effectiveUntil:'2026-10-01'});
    await assert.rejects(s.call({action:'saveRule',requestId:'long',expectedRevision:1,personId:person.personId,coverageGapConfirmed:true,rule:{...newRule,effectiveFrom:'2026-09-06'}}),/entire rule period/);
});
test('published future terms require successor rather than an independent replacement', async()=>{
    const s=setup();s.db.seed('Commission_Rules/'+rule.id,{...rule,effectiveUntil:'2026-10-01'});
    await assert.rejects(s.call({action:'saveRule',requestId:'independent',expectedRevision:1,personId:person.personId,rule:newRule}),/Create Successor/);
});
