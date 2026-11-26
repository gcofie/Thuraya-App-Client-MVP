const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./functions/commission-engine');
const fixture = require('./commission-test-fixtures.cjs');
const { person, binding, rule, job, build } = fixture;

for (const [target, revenue, expected] of [
    ['1500', '1499.99', '0.00'], ['1500', '1500', '0.00'], ['1500', '1500.01', '0.00'],
    ['1500', '1500.05', '0.01'], ['1500', '1800', '30.00'], ['1200', '1500', '30.00'],
    ['1200', '2200', '100.00'], ['1200', '1200.01', '0.00'], ['1500', '119072.192', '11757.22']
]) test(`HALF-UP ${revenue} against ${target}`, () => assert.equal(engine.award(revenue, target, '0.10').dailyPayable, expected));
for (const [amounts, expected] of [[['700', '600'], '10.00'], [['500', '400'], '0.00'], [['700', '800'], '30.00']]) {
    test(`daily target applied once: ${amounts}`, () => assert.equal(build(amounts.map((n, i) => job(n, { id: 'j' + i }))).rows[0].dailyPayable, expected));
}
test('no configured rule differs from calculated zero', () => {
    const no = build([job('100')], { rules: [] }).rows[0];
    assert.equal(no.status, 'NOT_CONFIGURED'); assert.equal(no.dailyPayable, null);
    const zero = build([job('100')]).rows[0]; assert.equal(zero.status, 'TARGET_NOT_REACHED'); assert.equal(zero.dailyPayable, '0.00');
});
test('above-target commission rounded to zero remains calculated', () => {
    const row = build([job('1500.01')], { rules: [{ ...rule, dailyTarget: '1500' }] }).rows[0];
    assert.equal(row.excess, '0.01'); assert.equal(row.rawCommission, '0.001');
    assert.equal(row.dailyPayable, '0.00'); assert.equal(row.status, 'CALCULATED');
});
test('one applicable published rule', () => assert.equal(engine.getEffectiveCommissionRule(person.personId, '2026-09-05', [rule]).rule.id, rule.id));
test('future, expired and adjacent rules use half-open dates', () => {
    const old = { ...rule, effectiveUntil: '2026-09-06' }, next = { ...rule, id: 'next', effectiveFrom: '2026-09-06', dailyTarget: '1500', commissionRate: '0.12' };
    engine.assertNoOverlap([old, next]);
    assert.equal(engine.getEffectiveCommissionRule(person.personId, '2026-09-05', [old, next]).rule.id, old.id);
    assert.equal(engine.getEffectiveCommissionRule(person.personId, '2026-09-06', [old, next]).rule.id, next.id);
    assert.equal(engine.getEffectiveCommissionRule(person.personId, '2026-09-05', [next]).status, 'NOT_CONFIGURED');
    assert.equal(engine.getEffectiveCommissionRule(person.personId, '2026-09-06', [old]).status, 'NOT_CONFIGURED');
});
test('overlap is an error, never newest-wins', () => {
    assert.throws(() => engine.assertNoOverlap([rule, { ...rule, id: 'duplicate' }]), /Overlapping/);
    assert.equal(engine.getEffectiveCommissionRule(person.personId, '2026-09-05', [rule, rule]).status, 'RULE_OVERLAP_ERROR');
});
test('rule heads exclude old revisions and drafts', () => assert.deepEqual(engine.ruleHeads([rule, { ...rule, id: 'old' }], [{ ...person, ruleHeads: { one: rule.id } }]).map(r => r.id), [rule.id]));
test('invalid calendar and effective interval rejected', () => {
    assert.equal(engine.date('2026-02-29'), false); assert.equal(engine.date('2028-02-29'), true);
    assert.throws(() => engine.validateRule({ ...rule, effectiveUntil: rule.effectiveFrom }));
});
for (const [label, change] of [['unpaid', { paymentStatus: 'Unpaid' }], ['nonclosed', { status: 'In Progress' }], ['archived', { archived: true }], ['appointment fallback', { _source: 'Appointments' }]]) {
    test(`exclude ${label}`, () => assert.equal(engine.getCommissionableServiceRevenue(job('100', change)).status, 'EXCLUDED'));
}
for (const method of ['Cash', 'Card/POS', 'Mobile Money', 'Gift Card', 'Voucher']) {
    test(`${method} funds service without adding tender revenue`, () => assert.equal(build([job('1500', { paymentMethod: method })]).rows[0].dailyPayable, '30.00'));
}
test('split components reconcile exactly once', () => {
    const j = job('1500', { paymentComponents: [{ method: 'Card', amount: '1000' }, { method: 'Gift Card', amount: '800' }] });
    assert.equal(build([j]).rows[0].dailyPayable, '30.00');
    j.paymentComponents[0].amount = '900'; assert.equal(build([j]).rows[0].status, 'PENDING');
});
test('exclusive tax excluded', () => assert.equal(engine.getCommissionableServiceRevenue(job('100')).revenue, '100'));
test('inclusive tax excluded once', () => {
    const j = job('100'); j.pricingMode = 'inclusive'; j.serviceLineItems[0].priceMode = 'inclusive'; j.serviceLineItems[0].lineTotal = '120';
    assert.equal(engine.getCommissionableServiceRevenue(j).revenue, '100');
});
test('subtotal/tax inconsistency is pending, not double subtraction', () => {
    const j = job('100'); j.serviceLineItems[0].lineSubtotal = '120';
    assert.equal(build([j]).rows[0].status, 'PENDING');
});
test('fully waived settled service has zero commissionable revenue', () => {
    const j = job('0', { complimentaryStatus: 'financial_applied', complimentaryApprovedBy: 'test-approver', complimentaryValue: '100', grandTotal: '100' });
    assert.equal(engine.getCommissionableServiceRevenue(j).revenue, '0');
});
test('discounted final lines not discounted twice', () => {
    const j = job('100', { grandTotal: '150', discountAmount: '30' });
    assert.equal(engine.getCommissionableServiceRevenue(j).revenue, '100');
});
test('final FOH lines are authority when final/receipt match', () => assert.equal(engine.getCommissionableServiceRevenue(job('100', { fohFinancialAmended: true, bookedPrice: '300' })).revenue, '100'));
test('refund and missing settlement evidence block the whole day', () => {
    for (const change of [{ refundStatus: 'pending' }, { receiptTotal: null }, { amountPaid: null }, { remainingBalance: '1' }]) {
        const row = build([job('1500'), job('100', { id: 'problem', ...change })]).rows[0];
        assert.equal(row.status, 'PENDING'); assert.equal(row.dailyPayable, null); assert.equal(row.eligibleRevenue, '1500'); assert.equal(row.pendingAmountUnknown, true);
    }
});
test('own member net only, shared receipt is not duplicated', () => {
    const a = job('700', { id: 'a', groupId: 'g', groupSize: 2 }), b = job('600', { id: 'b', groupId: 'g', groupSize: 2 });
    for (const j of [a, b]) Object.assign(j, { receiptId: 'shared', receiptTotal: '1560', finalTotal: '1560', amountDue: '1560', totalGHC: '1560', amountPaid: '1560', grandTotal: undefined });
    assert.equal(build([a, b]).rows[0].dailyPayable, '10.00');
});
test('unallocated pooled amount is pending', () => {
    const a = job('700', { id: 'a', groupId: 'g', groupSize: 2 }), b = job('600', { id: 'b', groupId: 'g', groupSize: 2 });
    for (const j of [a, b]) Object.assign(j, { receiptId: 'shared', receiptTotal: '1660', finalTotal: '1660', amountDue: '1660', totalGHC: '1660', amountPaid: '1660', grandTotal: undefined });
    assert.equal(build([a, b]).rows[0].status, 'PENDING');
});
test('incomplete group member set blocks', () => assert.equal(build([job('100', { groupId: 'g', groupSize: 2 })]).rows[0].status, 'PENDING'));
test('confirmed aliases and case normalize to one person', () => {
    const j = job('100', { assignedTechEmail: ' STATION@EXAMPLE.TEST ', assignedTechName: ' TEST.TECH ' });
    assert.equal(engine.resolveCommissionIdentity(j, j.dateString, [person], [binding]).personId, person.personId);
});
test('reused station excluded historical alias never maps to new owner', () => {
    const j = job('100', { assignedTechName: 'Prior.Owner' });
    assert.equal(engine.resolveCommissionIdentity(j, j.dateString, [person], [binding]).status, 'IDENTITY_REVIEW_REQUIRED');
    assert.equal(build([j]).rows[0].dailyPayable, null);
});
test('binding date start is enforced', () => {
    const late = { ...binding, effectiveFrom: '2026-09-06' };
    assert.equal(engine.resolveCommissionIdentity(job('100'), '2026-09-05', [person], [late]).status, 'IDENTITY_REVIEW_REQUIRED');
});
test('ambiguous station ownership rejected', () => assert.throws(() => engine.assertBindings([binding, { ...binding, personId: 'other' }]), /IDENTITY_OVERLAP/));
test('dateString wins over after-midnight closure', () => assert.equal(build([job('1500', { closedAt: '2026-09-06T01:00:00Z' })]).rows[0].businessDate, '2026-09-05'));
test('Accra today does not use browser locale', () => assert.equal(engine.today(new Date('2026-09-05T23:30:00-05:00')), '2026-09-06'));
test('invalid date becomes review rather than disappearing', () => assert.equal(build([job('100', { dateString: null })]).rows[0].status, 'PENDING'));
test('repeat query row is deduplicated without losing real jobs', () => { const j = job('1500'); assert.equal(build([j, structuredClone(j)]).rows[0].dailyPayable, '30.00'); });
test('incomplete query cannot yield zero award', () => assert.throws(() => build([], { complete: false }), /CALCULATION_INCOMPLETE/));
test('weekly/monthly sum rounded daily awards', () => {
    const r = { ...rule, dailyTarget: '1500' };
    const rows = build([job('1500.05'), job('1500.05', { id: 'other', dateString: '2026-09-06' })], { rules: [r], end: '2026-09-06' });
    assert.equal(rows.summary.completeCommission, '0.02');
});
test('CSV preserves null vs zero, model, person and dates', () => {
    const text = engine.csv(build([job('100')], { rules: [] }).rows);
    assert.match(text, /NOT_CONFIGURED/); assert.match(text, /dailyPayable/); assert.match(text, /personId/);
});
for (const invalid of [null, '', 'garbage', 'NaN', Infinity, '-1']) test(`reject invalid monetary value ${invalid}`, () => assert.throws(() => engine.money(invalid)));

module.exports = fixture;
