'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const engine=require('./functions/commission-engine');
const {job,build}=require('./commission-test-fixtures.cjs');
test('audited receiptRef checkout shape needs no invented receiptTotal field',()=>{
 const j=job('100',{receiptId:undefined,receiptTotal:undefined,amountPaid:undefined,receiptRef:'THR-SYNTH',receiptGeneratedAt:'2026-09-05T12:00:00Z',closedAt:'2026-09-05T12:00:00Z',groupCheckoutAmount:'120'});
 assert.equal(engine.getCommissionableServiceRevenue(j).revenue,'100');
});
test('audited legacy subtotal and JSON tax breakdown reconcile without menu lookup',()=>{
 const j=job('420',{serviceLineItems:undefined,bookedService:'Synthetic service',bookedPrice:'420',taxBreakdown:JSON.stringify([{name:'A',amount:'10.5'},{name:'B',amount:'63'},{name:'C',amount:'10.5'}])});
 assert.equal(engine.getCommissionableServiceRevenue(j).revenue,'420');
 j.bookedPrice='504'; assert.equal(engine.getCommissionableServiceRevenue(j).status,'REVIEW_REQUIRED');
});
test('gross plus recorded simple inclusive tax extracts net once',()=>{
 const j=job('100'); j.serviceLineItems=[{lineId:'x',priceMode:'inclusive',lineTotal:'120',taxCalculationModel:'simple',taxRate:'20'}];
 assert.equal(engine.getCommissionableServiceRevenue(j).revenue,'100');
 delete j.serviceLineItems[0].taxCalculationModel; assert.equal(engine.getCommissionableServiceRevenue(j).status,'REVIEW_REQUIRED');
});
test('zero cash gift redemption funds service, face value not additional revenue',()=>{
 const j=job('1500',{paymentMethod:'Gift Card / Voucher',amountPaid:'0',giftCardRedemptions:[{id:'redemption-test',appliedAmount:'1800',faceValue:'5000'}],giftCardAppliedAmount:'1800',topUpAmount:'0'});
 assert.equal(build([j]).rows[0].dailyPayable,'30.00');
 j.giftCardAppliedAmount='1900';assert.equal(build([j]).rows[0].status,'PENDING');
});
test('unapproved material waiver cannot be commissioned',()=>{
 assert.equal(engine.getCommissionableServiceRevenue(job('0',{complimentaryStatus:'financial_applied',complimentaryValue:'100',grandTotal:'100'})).reason,'WAIVER_APPROVAL_REQUIRED');
});
test('competing source or receipt blocks instead of paying duplicate jobs',()=>{
 const jobs=[job('700',{id:'one',sourceAppointmentId:'same'}),job('600',{id:'two',sourceAppointmentId:'same'})];
 assert.equal(build(jobs).rows[0].status,'PENDING');
});
test('unassigned financially eligible job blocks the affected business day',()=>{
 const j=job('700',{assignedTechEmail:null,assignedTechName:null});
 const result=build([j]);assert.equal(result.rows[0].status,'PENDING');assert.equal(result.diagnostics[0].reason,'UNASSIGNED_IDENTITY');
});
