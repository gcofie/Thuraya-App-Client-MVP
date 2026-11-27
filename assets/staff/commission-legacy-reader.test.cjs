'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const e = require('./functions/commission-engine'), f = require('./commission-test-fixtures.cjs');
const line = (price = '150', qty = '1', extra = {}) => ({name:'Synthetic service',price,qty,lineTotal:e.money(price).times(qty).toString(),...extra});
function legacy(net = '150', extra = {}) {
    const tax=e.money(net).times('0.2').toString(),gross=e.money(net).plus(tax).toString();
    return f.job(net,{pricingMode:'exclusive',taxPricingMode:'exclusive',bookedPrice:net,taxableSubtotal:net,
        grandTotal:gross,serviceLineItems:[line(net)],taxBreakdown:[{name:'Recorded tax',rate:20,amount:tax}],...extra});
}
const read = j => e.getCommissionableServiceRevenue(j);
const approved = {isComplimentary:true,complimentaryStatus:'financial_applied',complimentaryApprovedBy:'synthetic-approver',complimentaryApprovalAuditId:'synthetic-audit',complimentaryTotalsApplied:true,complimentaryValue:'150'};
const waived = () => legacy('0',{...approved,serviceLineItems:[line('0','1',{...approved,payableLineTotal:'0',originalPrice:'150'})],complimentaryOriginalTotals:{grandTotal:'180'},paymentMethod:'Complimentary'});
test('F1: canonical modern rows retain financial result',()=>{const j=f.job('150');assert.equal(read(j).revenue,'150');});
test('F1: exact legacy price/quantity is accepted',()=>{assert.equal(read(legacy()).revenue,'150');});
test('F1: multiple quantities and rows reconcile without per-line tax allocation',()=>{const j=legacy('300',{serviceLineItems:[line('50','2'),line('200')]});const r=read(j);assert.equal(r.revenue,'300');assert.equal(r.sourceFields.length,1);assert.equal(r.sourceFields[0].tax,'taxBreakdown');});
test('F1: string tax breakdown is accepted',()=>{const j=legacy();j.taxBreakdown=JSON.stringify(j.taxBreakdown);assert.equal(read(j).revenue,'150');});
test('F1: FOH current reviewed values ignore explicitly original quotes',()=>{const j=legacy('200',{serviceLineItems:[line('200','1',{manual:true,source:'serviceLineItems'})],quotedAmount:900,checkoutReviewItems:[{price:900}],consultationTicketItems:[{price:900}]});assert.equal(read(j).revenue,'200');});
test('F1: approved fully waived rows yield zero revenue',()=>{const j=waived();assert.equal(read(j).revenue,'0');assert.equal(f.build([j]).summary.completeCommission,'0.00');});
test('F1: full zero waiver may contain multiple approved zero rows',()=>{const j=waived();j.serviceLineItems.push(line('0','1',approved));assert.equal(read(j).revenue,'0');});
test('F1: certified aggregate HALF-UP tax normalization remains accepted',()=>{const j=legacy('1.03',{taxTotal:'0.21'});assert.equal(read(j).revenue,'1.03');});
test('F1: ordinary generated-receipt settlement metadata remains required',()=>{const j=legacy();delete j.amountPaid;j.receiptRef='synthetic-receipt';j.receiptGeneratedAt='2026-09-05T12:00:00Z';j.closedAt='2026-09-05T12:00:00Z';j.paymentMethod='Cash';assert.equal(read(j).revenue,'150');});
const rejects = [
 ['price multiplication conflict',j=>j.serviceLineItems[0].price='149','LEGACY_LINE_AMOUNT_CONFLICT'],
 ['quantity conflict',j=>j.serviceLineItems[0].qty='2','LEGACY_LINE_AMOUNT_CONFLICT'],
 ['zero quantity',j=>Object.assign(j.serviceLineItems[0],{price:0,qty:0,lineTotal:0}),'LEGACY_LINE_AMOUNT_CONFLICT'],
 ['payable alias conflict',j=>j.serviceLineItems[0].payableLineTotal=149,'LEGACY_LINE_AMOUNT_CONFLICT'],
 ['amount alias conflict',j=>j.serviceLineItems[0].amount=149,'LEGACY_LINE_AMOUNT_CONFLICT'],
 ['current net alias conflict',j=>j.taxableSubtotal=151,'LEGACY_SUBTOTAL_CONFLICT'],
 ['all net corroboration missing',j=>{delete j.bookedPrice;delete j.taxableSubtotal;delete j.serviceSubtotal;},'LEGACY_SUBTOTAL_CONFLICT'],
 ['aggregate tax missing',j=>delete j.taxBreakdown,'LEGACY_AGGREGATE_TAX_REQUIRED'],
 ['aggregate tax malformed',j=>j.taxBreakdown='{}','TAX_BREAKDOWN_REVIEW'],
 ['tax rate contradicts amount',j=>j.taxBreakdown[0].amount=31,'LEGACY_TAX_RATE_CONFLICT'],
 ['tax total conflicts',j=>j.taxTotal=31,'TAX_TOTAL_CONFLICT'],
 ['secondary tax total conflicts',j=>j.totalTax=31,'TAX_TOTAL_CONFLICT'],
 ['sub-pesewa tolerance is not allowed',j=>j.taxBreakdown[0].amount='30.00000001','LEGACY_TAX_RATE_CONFLICT'],
 ['final total conflicts',j=>j.finalTotal=181,'LEGACY_FINAL_TOTAL_CONFLICT'],
 ['required settled alias missing',j=>delete j.totalGHC,'LEGACY_FINAL_TOTAL_CONFLICT'],
 ['FOH current values conflict despite matching original quote',j=>{j.bookedPrice=160;j.checkoutReviewItems=[{price:160}];},'LEGACY_SUBTOTAL_CONFLICT'],
 ['receipt conflicts',j=>j.receiptTotal=181,'FINAL_RECEIPT_LINE_CONFLICT'],
 ['nested receipt alias conflicts',j=>j.receipt={total:180,amount:181},'FINAL_RECEIPT_LINE_CONFLICT'],
 ['paid alias conflicts',j=>j.paidAmount=181,'PAYMENT_COMPONENT_CONFLICT'],
 ['unsettled balance',j=>j.balanceDue=1,'UNSETTLED_BALANCE'],
 ['generated receipt missing',j=>j.receiptStatus='Pending','GENERATED_RECEIPT_REQUIRED'],
 ['contradictory inclusive job mode',j=>j.pricingMode='inclusive','LEGACY_PRICING_MODE_REVIEW'],
 ['contradictory line mode',j=>j.serviceLineItems[0].priceMode='inclusive','LEGACY_PRICING_MODE_REVIEW'],
 ['mode missing',j=>{delete j.pricingMode;delete j.taxPricingMode;},'LEGACY_PRICING_MODE_REVIEW'],
 ['modern evidence cannot be overwritten by legacy reader',j=>j.serviceLineItems[0].lineSubtotal=150,'LINE_COMPONENTS_REQUIRED'],
 ['price missing',j=>delete j.serviceLineItems[0].price,'LINE_COMPONENTS_REQUIRED'],
 ['quantity missing',j=>delete j.serviceLineItems[0].qty,'LINE_COMPONENTS_REQUIRED'],
 ['line ownership conflict',j=>j.serviceLineItems[0].technicianPersonId='another-person','LINE_OWNERSHIP_REVIEW_REQUIRED'],
 ['line station ownership conflict',j=>j.serviceLineItems[0].assignedTechEmail='other@example.test','LINE_OWNERSHIP_REVIEW_REQUIRED'],
 ['duplicate service identity',j=>{j.serviceLineItems=[line('75','1',{lineId:'same'}),line('75','1',{lineId:'same'})];},'DUPLICATE_SERVICE_LINE'],
 ['F5 Gift lacks explicit top-up',j=>j.giftCardRedemptions=[{amount:180}],'GIFT_SETTLEMENT_CONFLICT'],
 ['split settlement conflicts',j=>j.paymentComponents=[{method:'Cash',amount:179}],'PAYMENT_COMPONENT_CONFLICT'],
 ['positive complimentary revenue conflict',j=>Object.assign(j,approved),'LEGACY_FULL_WAIVER_REQUIRED'],
 ['partially waived line',j=>Object.assign(j.serviceLineItems[0],approved),'LEGACY_FULL_WAIVER_REQUIRED'],
 ['refund stays pending',j=>j.refundPending=true,'REFUND_REVIEW_REQUIRED']
];
for(const [name,mutate,reason] of rejects)test('F1 rejects '+name,()=>{const j=legacy();mutate(j);const r=read(j);assert.equal(r.status,'REVIEW_REQUIRED');assert.equal(r.reason,reason);});
for(const key of ['complimentaryApprovedBy','complimentaryApprovalAuditId','complimentaryTotalsApplied'])test('F1 zero waiver requires '+key,()=>{const j=waived();delete j[key];assert.equal(read(j).reason,'LEGACY_FULL_WAIVER_REQUIRED');});
test('F1 zero waiver requires approval on every line',()=>{const j=waived();delete j.serviceLineItems[0].complimentaryApprovalAuditId;assert.equal(read(j).reason,'LEGACY_FULL_WAIVER_REQUIRED');});
test('F1 zero gross / positive tax modern conflict remains pending',()=>{const j=waived();j.serviceLineItems=[{lineId:'zero',lineSubtotal:0,taxAmount:0.0033,lineTotal:0,priceMode:'inclusive'}];assert.equal(read(j).reason,'LINE_TAX_COMPONENT_CONFLICT');});
test('F1 zero value cannot carry positive aggregate tax',()=>{const j=waived();j.taxBreakdown=[{amount:1,rate:20}];assert.equal(read(j).reason,'LEGACY_TAX_RATE_CONFLICT');});
test('F1 separate group member receipts pass only complete member-set guards',()=>{const j=legacy('150',{groupId:'synthetic-group',groupSize:2}),k=legacy('200',{id:'other',receiptId:'other-receipt',groupId:'synthetic-group',groupSize:2});assert.equal(e.getCommissionableServiceRevenue(j,{groupJobs:[j,k]}).revenue,'150');assert.equal(e.getCommissionableServiceRevenue(j,{groupJobs:[j]}).status,'REVIEW_REQUIRED');});
test('F1 shared group receipt never receives inferred member tax allocation',()=>{const j=legacy('150',{groupId:'synthetic-group',groupSize:2}),k=legacy('150',{id:'other',receiptId:j.receiptId,groupId:j.groupId,groupSize:2});assert.equal(e.getCommissionableServiceRevenue(j,{groupJobs:[j,k]}).status,'REVIEW_REQUIRED');});
test('F1 identity ambiguity remains a whole-day hold',()=>{const r=f.build([legacy('150',{assignedTechName:'Unconfirmed'})]);assert.equal(r.summary.pendingDays,1);assert.equal(r.rows[0].dailyPayable,null);});
test('F1 excluded identity is not inferred from station',()=>{const r=f.build([legacy('150',{assignedTechName:'Prior.Owner'})]);assert.equal(r.summary.pendingDays,1);assert.equal(r.rows[0].eligibleRevenue,'0');});
test('F1 Appointment-only financial fallback remains zero',()=>{const j=legacy('2000',{_source:'Appointments'});assert.equal(read(j).reason,'ACTIVE_JOB_ONLY');assert.equal(f.build([j]).summary.completeCommission,'0.00');});
test('F1 accepted revenue on mixed day does not become payable',()=>{const good=legacy('1500'),bad=legacy('50',{id:'other',receiptId:'other-receipt',giftCardRedemptions:[{amount:60}]});const r=f.build([good,bad]);assert.equal(r.summary.pendingDays,1);assert.equal(r.summary.completeCommission,'0.00');assert.equal(r.rows[0].dailyPayable,null);assert.equal(r.rows[0].eligibleRevenue,'1500');});
test('F1 does not mutate financial inputs, rule selection or targets',()=>{const j=legacy('1500'),before=JSON.stringify(j),r=f.build([j]);assert.equal(JSON.stringify(j),before);assert.equal(r.rows[0].rule.id,f.rule.id);assert.equal(r.rows[0].dailyPayable,'30.00');});
