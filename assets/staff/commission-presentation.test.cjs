'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const view=require('./commission-presentation'),engine=require('./functions/commission-engine');
const {job,build,person,binding}=require('./commission-test-fixtures.cjs');
test('eligible revenue remains authoritative without any effective rule',()=>{
 const row=build([job('1450')],{rules:[]}).rows[0];assert.equal(row.eligibleRevenue,'1450');assert.equal(row.status,'NOT_CONFIGURED');assert.equal(row.dailyPayable,null);
 const html=view.renderDays([row]);for(const marker of ['1450 GHS','NOT CONFIGURED','Not payable','No rule configured','<dd>-</dd>'])assert.ok(html.includes(marker));
});
test('rule-free financial ambiguity remains visible and not payable',()=>{
 const row=build([job('1450',{refundStatus:'pending'})],{rules:[]}).rows[0];assert.equal(row.dailyPayable,null);assert.ok(row.pending.length);assert.match(view.renderDays([row]),/Amount unknown/);
});
test('zero-activity filter preserves data and exposes an optional toggle',()=>{
 const rows=build([],{rules:[],end:'2026-09-06'}).rows,copy=structuredClone(rows);const html=view.renderDays(rows);assert.deepEqual(rows,copy);assert.equal(rows.length,2);assert.equal(rows.filter(view.hasActivity).length,0);assert.match(html,/Show zero-activity days \(2\)/);assert.match(html,/cv-zero/);
});
for(const [label,patch]of [['pending',{pending:[{jobId:'pending'}]}],['unknown',{pendingAmountUnknown:true}],['locked',{locked:true}],['payable',{dailyPayable:'1.00'}],['activity',{contributions:[{jobId:'zero-service'}]}],['configuration error',{status:'RULE_OVERLAP_ERROR'}]])test(label+' is never hidden as zero activity',()=>{assert.equal(view.hasActivity({status:'NOT_CONFIGURED',eligibleRevenue:'0',...patch}),true);});
test('below-target and locked statuses are readable without color',()=>{
 assert.equal(view.status({status:'TARGET_NOT_REACHED'}),'BELOW TARGET');assert.equal(view.status({status:'CALCULATED',locked:true}),'LOCKED');assert.equal(view.status({status:'PENDING'}),'PENDING REVIEW');
});
for(const [start,alias,excluded]of [['2026-08-01','Synthetic.Senior','Previous.Senior'],['2026-05-08','Synthetic.Junior','Synthetic.Junior1'],['2026-05-08','Synthetic.Therapist','Unconfirmed.Therapist']])test('effective identity '+alias+' excludes unconfirmed historical aliases without a rule',()=>{
 const p={...person,enrollmentFrom:start},b={...binding,effectiveFrom:start,aliases:[alias],excludedAliases:[excluded]};
 const rows=build([job('1450',{assignedTechName:alias,dateString:start}),job('500',{id:'excluded',assignedTechName:excluded,dateString:start})],{persons:[p],bindings:[b],rules:[],start,end:start}).rows;
 assert.equal(rows[0].eligibleRevenue,'1450');assert.equal(rows[0].dailyPayable,null);assert.notEqual(engine.resolveCommissionIdentity(job('500',{assignedTechName:excluded}),start,[p],[b]).status,'RESOLVED');
});
test('friendly identity error retains actionable advice',()=>{assert.match(view.friendly(new Error('IDENTITY_EVIDENCE_REQUIRED')),/Confirmed Alias.*Station Email/);assert.match(view.friendly(new Error('Backdating impact preview is missing or stale')),/Preview.*again/i);});
test('history action labels are generic and dates use Accra calendar',()=>{assert.equal(view.actions.enrollPerson,'Initial enrollment');assert.equal(view.actions.voidEnrollment,'Enrollment voided');assert.equal(view.date('2026-05-08'),'08 May 2026');assert.equal(view.date(null),'Open-ended');});
test('presentation escapes technician names and diagnostic source',()=>{const row=build([job('1500')]).rows[0];row.technician='<script>bad</script>';assert.doesNotMatch(view.renderDays([row]),/<script>/);});

test('percentage display does not introduce binary floating-point artifacts',()=>{
 const row=build([job('1500')]).rows[0];row.commissionRate='0.29';const html=view.renderDays([row]);assert.ok(html.includes('<dt>Rate</dt><dd>29%</dd>'));assert.doesNotMatch(html,/28.999/);
});
