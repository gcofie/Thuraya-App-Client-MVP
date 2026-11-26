'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const engine = require('./functions/commission-engine');
const { job, build } = require('./commission-test-fixtures.cjs');

function represented(changes = {}) {
    return job('137.50333333333333', {
        pricingMode: 'inclusive',
        serviceLineItems: [{ lineId: 'one', lineSubtotal: 137.50333333333333, taxAmount: 27.496666666666684, lineTotal: 165, priceMode: 'inclusive' }],
        taxTotal: 27.50, taxBreakdown: [{ amount: 27.496666666666684 }],
        receiptTotal: 165, amountPaid: 165, amountDue: 165, finalTotal: 165, totalGHC: 165, grandTotal: 165,
        ...changes
    });
}
function pending(changes, reason) {
    const j = represented(changes), before = structuredClone(j), row = build([j]).rows[0];
    assert.equal(row.status, 'PENDING');
    assert.equal(row.dailyPayable, null);
    assert.equal(row.pending[0].reason, reason);
    assert.deepEqual(j, before);
}
test('canonical full precision source remains exact and immutable', () => {
    const j = job('123.456'), before = structuredClone(j), r = engine.getCommissionableServiceRevenue(j);
    assert.equal(r.status, 'ELIGIBLE'); assert.equal(r.revenue, '123.456');
    assert.equal(r.taxExcluded, '24.6912'); assert.deepEqual(j, before);
});
test('inclusive browser subtraction representation reconciles without rounding revenue', () => {
    const j = represented(), before = structuredClone(j), r = engine.getCommissionableServiceRevenue(j);
    assert.equal(r.status, 'ELIGIBLE'); assert.equal(r.revenue, '137.50333333333333');
    assert.equal(r.taxExcluded, '27.496666666666684'); assert.equal(r.gross, '165');
    assert.deepEqual(j, before);
});
test('browser subtraction remains equivalent when decimal addition rounds to an adjacent double', () => {
    const j = represented({ serviceLineItems: [{ lineId: 'one', lineSubtotal: 291.66666666666663, taxAmount: 58.33333333333334, lineTotal: 350, priceMode: 'inclusive' }], taxTotal:58.33, taxBreakdown:[{amount:58.33333333333334}], receiptTotal:350, amountPaid:350, amountDue:350, finalTotal:350,totalGHC:350,grandTotal:350 });
    const r = engine.getCommissionableServiceRevenue(j);
    assert.equal(r.status, 'ELIGIBLE'); assert.equal(r.revenue, '291.66666666666663');
});
test('existing legacy summary arithmetic is interpreted as a stored Number, with no new fallback', () => {
    const j = job('181.33', { bookedService:'Synthetic service', bookedPrice:181.33, serviceLineItems:[], taxTotal:undefined, taxBreakdown:[{amount:'4.5332500000000005'},{amount:'27.1995'},{amount:'4.5332500000000005'}], receiptTotal:217.596, amountPaid:217.596, amountDue:217.596, finalTotal:217.596,totalGHC:217.596,grandTotal:217.596 });
    const r = engine.getCommissionableServiceRevenue(j);
    assert.equal(r.status,'ELIGIBLE'); assert.equal(r.revenue,'181.33');
    assert.equal(r.gross,'217.596000000000001');
});
test('rounded aggregate recorded tax reconciles while raw line precision is retained', () => {
    const r = engine.getCommissionableServiceRevenue(represented());
    assert.equal(r.status, 'ELIGIBLE'); assert.equal(r.taxExcluded, '27.496666666666684');
});
for (const [name, changes, reason] of [
    ['conflicting net', {serviceLineItems:[{lineId:'one',lineSubtotal:137.50,taxAmount:27.496666666666684,lineTotal:165,priceMode:'inclusive'}]}, 'LINE_TAX_COMPONENT_CONFLICT'],
    ['sub-pesewa mismatch is not a tolerance', {serviceLineItems:[{lineId:'one',lineSubtotal:137.5033,taxAmount:27.496666666666684,lineTotal:165,priceMode:'inclusive'}]}, 'LINE_TAX_COMPONENT_CONFLICT'],
    ['zero gross positive tax', {serviceLineItems:[{lineId:'one',lineSubtotal:0,taxAmount:0.0033333333333445125,lineTotal:0,priceMode:'inclusive'}]}, 'LINE_TAX_COMPONENT_CONFLICT'],
    ['missing line tax', {serviceLineItems:[{lineId:'one',lineSubtotal:137.50,lineTotal:165,priceMode:'inclusive'}]}, 'LINE_COMPONENTS_REQUIRED'],
    ['missing tax corroboration', {taxBreakdown:undefined}, 'TAX_TOTAL_CONFLICT'],
    ['conflicting raw recorded tax', {taxTotal:'27.4966'}, 'TAX_TOTAL_CONFLICT'],
    ['one-pesewa tax mismatch', {taxTotal:'27.49'}, 'TAX_TOTAL_CONFLICT'],
    ['tax breakdown mismatch', {taxBreakdown:[{amount:'27.49'}]}, 'TAX_BREAKDOWN_CONFLICT'],
    ['receipt mismatch', {receiptTotal:'165.01'}, 'FINAL_RECEIPT_LINE_CONFLICT'],
    ['sub-pesewa receipt mismatch', {receiptTotal:'165.001'}, 'FINAL_RECEIPT_LINE_CONFLICT'],
    ['conflicting final aliases', {totalGHC:'165.001'}, 'FINAL_TOTAL_CONFLICT'],
    ['all final fields disagree with service', {amountDue:166,finalTotal:166,totalGHC:166}, 'FINAL_RECEIPT_LINE_CONFLICT'],
    ['pre-post total conflict', {grandTotal:166}, 'PRE_POST_CHECKOUT_REVIEW'],
    ['unpaid balance', {remainingBalance:'0.01'}, 'UNSETTLED_BALANCE'],
    ['group member evidence incomplete', {groupId:'synthetic-group',groupSize:2}, 'GROUP_MEMBER_SET_INCOMPLETE'],
    ['group shared final conflict', {groupId:'synthetic-group',groupSize:2,totalGHC:330}, 'FINAL_TOTAL_CONFLICT'],
    ['identity conflict', {assignedTechName:'Unconfirmed'}, 'IDENTITY_REVIEW_REQUIRED'],
    ['gift settlement conflict', {giftCardRedemptions:[{amount:100}],topUpAmount:64}, 'GIFT_SETTLEMENT_CONFLICT'],
    ['voucher component conflict', {paymentComponents:[{method:'Voucher',amount:164}]}, 'PAYMENT_COMPONENT_CONFLICT'],
    ['complimentary approval absent', {complimentaryValue:165}, 'WAIVER_APPROVAL_REQUIRED'],
    ['refund conflict', {refundPending:true}, 'REFUND_REVIEW_REQUIRED'],
    ['Category-F unknown pricing shape', {serviceLineItems:[{lineSubtotal:137.50,taxAmount:27.50,lineTotal:165}],pricingMode:undefined}, 'LINE_COMPONENTS_REQUIRED'],
    ['missing all service evidence', {serviceLineItems:[],bookedService:undefined}, 'SERVICE_LINES_REQUIRED']
]) test(`representation handling preserves ${name}`, () => pending(changes, reason));
test('valid special-payment components still represent service revenue exactly once', () => {
    const r = engine.getCommissionableServiceRevenue(represented({paymentComponents:[{method:'Gift',amount:100},{method:'Cash',amount:65}]}));
    assert.equal(r.status,'ELIGIBLE'); assert.equal(r.revenue,'137.50333333333333');
});
test('Appointment source never becomes Commission fallback', () => {
    const r = build([represented({_source:'Appointments'})]);
    assert.equal(r.rows[0].eligibleRevenue,'0'); assert.equal(r.rows[0].contributions.length,0);
    assert.equal(r.diagnostics[0].reason,'ACTIVE_JOB_ONLY');
});
test('normalization cannot make a mixed pending day payable', () => {
    const r = build([represented({id:'good'}),represented({id:'bad',totalGHC:170})]).rows[0];
    assert.equal(r.status,'PENDING'); assert.equal(r.dailyPayable,null);
    assert.equal(r.contributions.length,1); assert.equal(r.pending.length,1);
});
test('distinct selected rule identity remains unchanged for normalized rows', () => {
    const r=build([represented()]).rows[0];
    assert.equal(r.rule.id,'rule-one'); assert.equal(r.dailyTarget,'1200');
    assert.equal(r.commissionRate,'0.10');
});
