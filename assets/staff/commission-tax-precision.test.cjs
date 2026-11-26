const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./functions/commission-engine');
const { job, build } = require('./commission-test-fixtures.cjs');

function precisionJob(changes = {}) {
    return job('166.67', {
        taxTotal: '33.33', receiptTotal: '200', amountPaid: '200', amountDue: '200',
        finalTotal: '200', totalGHC: '200', pricingMode: 'inclusive',
        taxBreakdown: [{ amount: '4.166666666666667' }, { amount: '25.000000000000004' }, { amount: '4.166666666666667' }],
        serviceLineItems: [{ lineId: 'one', lineSubtotal: '166.67', taxAmount: '33.33', lineTotal: '200', priceMode: 'inclusive' }],
        ...changes
    });
}

test('aggregate raw tax reconciles after HALF-UP without rounding revenue', () => {
    const j = precisionJob(), before = structuredClone(j);
    const result = engine.getCommissionableServiceRevenue(j);
    assert.equal(result.status, 'ELIGIBLE'); assert.equal(result.revenue, '166.67');
    assert.equal(result.taxExcluded, '33.33'); assert.equal(result.gross, '200');
    assert.deepEqual(j, before);
});
test('round-each total is not used instead of round-aggregate', () => {
    const j = precisionJob();
    const each = j.taxBreakdown.reduce((s, t) => s.plus(engine.money(t.amount).toDecimalPlaces(2, 4)), engine.money('0'));
    assert.equal(each.toString(), '33.34');
    assert.equal(engine.getCommissionableServiceRevenue(j).status, 'ELIGIBLE');
});
for (const [raw, expected] of [['33.325', 'ELIGIBLE'], ['33.3249', 'REVIEW_REQUIRED'], ['33.335', 'REVIEW_REQUIRED'], ['33.34', 'REVIEW_REQUIRED'], ['34.33', 'REVIEW_REQUIRED']]) {
    test(`aggregate HALF-UP boundary ${raw} versus recorded 33.33`, () => {
        const r = engine.getCommissionableServiceRevenue(precisionJob({ taxBreakdown: [{ amount: raw }] }));
        assert.equal(r.status, expected);
        if (expected === 'REVIEW_REQUIRED') assert.equal(r.reason, 'TAX_BREAKDOWN_CONFLICT');
    });
}
test('already consistent sub-pesewa values retain full canonical precision', () => {
    const r = engine.getCommissionableServiceRevenue(job('123.456'));
    assert.equal(r.status, 'ELIGIBLE'); assert.equal(r.revenue, '123.456');
    assert.equal(r.taxExcluded, '24.6912');
});
for (const [name, changes, reason] of [
    ['receipt mismatch', { receiptTotal: '200.01' }, 'FINAL_RECEIPT_LINE_CONFLICT'],
    ['final mismatch', { totalGHC: '201' }, 'FINAL_TOTAL_CONFLICT'],
    ['recorded tax mismatch', { taxTotal: '33.34' }, 'TAX_TOTAL_CONFLICT'],
    ['unsettled balance', { remainingBalance: '0.01' }, 'UNSETTLED_BALANCE'],
    ['missing generated receipt', { receiptStatus: 'missing' }, 'GENERATED_RECEIPT_REQUIRED'],
    ['special payment conflict', { paymentComponents: [{ method: 'Voucher', amount: '199.99' }] }, 'PAYMENT_COMPONENT_CONFLICT'],
    ['refund ambiguity', { refundPending: true }, 'REFUND_REVIEW_REQUIRED'],
    ['missing group member', { groupId: 'synthetic-group', groupSize: 2 }, 'GROUP_MEMBER_SET_REQUIRED']
]) test(`normalized tax does not bypass ${name}`, () => {
    const j = precisionJob(changes), r = engine.getCommissionableServiceRevenue(j);
    assert.equal(r.status, 'REVIEW_REQUIRED'); assert.equal(r.reason, reason);
    const row = build([j]).rows[0]; assert.equal(row.status, 'PENDING'); assert.equal(row.dailyPayable, null);
});
test('group pooled FINAL_TOTAL_CONFLICT remains pending despite precision normalization', () => {
    const row = build([precisionJob({ groupId: 'synthetic-group', groupSize: 2, totalGHC: '300' })]).rows[0];
    assert.equal(row.status, 'PENDING'); assert.equal(row.pending[0].reason, 'FINAL_TOTAL_CONFLICT');
    assert.equal(row.dailyPayable, null); assert.equal(row.eligibleRevenue, '0');
});
for (const changes of [{ paymentStatus: 'Unpaid' }, { status: 'In Progress' }, { archived: true }, { _source: 'Appointments' }]) {
    test(`normalized tax does not bypass eligibility ${JSON.stringify(changes)}`, () => {
        assert.equal(engine.getCommissionableServiceRevenue(precisionJob(changes)).status, 'EXCLUDED');
        const r = build([precisionJob(changes)]);
        assert.equal(r.rows[0].eligibleRevenue, '0'); assert.equal(r.rows[0].contributions.length, 0);
    });
}
test('normalized no-rule revenue remains visible but not payable', () => {
    const row = build([precisionJob()], { rules: [] }).rows[0];
    assert.equal(row.status, 'NOT_CONFIGURED'); assert.equal(row.eligibleRevenue, '166.67');
    assert.equal(row.dailyPayable, null); assert.equal(row.rule, null); assert.equal(row.pending.length, 0);
});
