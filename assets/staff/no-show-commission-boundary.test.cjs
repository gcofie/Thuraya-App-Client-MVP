'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { createRequire } = require('node:module');
const path = require('node:path');
const parity = require('./no-show-source-parity.cjs');
const current = require('./functions/commission-engine');
const { person, binding, rule, job } = require('./commission-test-fixtures.cjs');
const { memoryDb } = require('./gift-test-fixtures.cjs');
const { createNoShowService } = require('./functions/no-show-service');
const model = require('./no-show-model');
const plain = x => JSON.parse(JSON.stringify(x));
const context = { module: { exports: {} }, require: createRequire(path.join(__dirname, 'functions/commission-engine.js')) };
vm.runInNewContext(parity.original('functions/commission-engine.js'), context);
const original = context.module.exports;
const build = (engine, jobs) => plain(engine.buildCommissionDays({ jobs, persons: [person], bindings: [binding], rules: [rule], start:'2026-09-05', end:'2026-09-05', complete:true }));
function compare(jobs) {
    const before = structuredClone(jobs), a = build(original, jobs), b = build(current, jobs);
    assert.deepEqual(b, a); assert.deepEqual(jobs, before);
    return b;
}
test('No Show Commission public API and policy identity remain compatible', () => {
    assert.deepEqual(Object.keys(current).sort(), Object.keys(original).sort());
    for (const key of ['TYPE','POLICY','VERSION']) assert.equal(current[key], original[key]);
});
for (const status of ['Scheduled','Arrived','Waiting','Started','In Service','In Progress','Completed','Paid','Cancelled','No Show','Action Required']) {
    for (const paymentStatus of ['Unpaid','Paid']) test(`Commission lifecycle exclusion: ${status} / ${paymentStatus}`, () => {
        const j=job('1500',{status,paymentStatus}), r=compare([j]);
        assert.deepEqual(plain(current.getCommissionableServiceRevenue(j)),plain(original.getCommissionableServiceRevenue(j)));
        assert.equal(r.rows[0].contributions.length,0); assert.equal(r.rows[0].eligibleRevenue,'0');
        assert.equal(r.rows[0].dailyPayable,'0.00'); assert.equal(r.rows[0].pending.length,0);
    });
}
test('No Show exclusion precedes reading quoted or malformed financial evidence', () => {
    for (const engine of [original,current]) {
        const j={_source:'Active_Jobs',status:'No Show',paymentStatus:'Paid'};
        Object.defineProperty(j,'serviceLineItems',{get(){throw Error('No Show financial fields must not be read');}});
        assert.deepEqual(plain(engine.getCommissionableServiceRevenue(j)),{status:'EXCLUDED',reason:'NOT_CLOSED_PAID'});
    }
});
test('No Show Appointment never becomes realized Commission fallback', () => {
    const r=compare([job('9000',{_source:'Appointments',status:'No Show'})]);
    assert.equal(r.rows[0].eligibleRevenue,'0'); assert.equal(r.rows[0].contributions.length,0);
    assert.deepEqual(r.diagnostics,[{jobId:'job-one',reason:'ACTIVE_JOB_ONLY'}]);
});
test('canonical paid/closed Active Job retains financial truth despite a No Show Appointment', () => {
    const r=compare([job('1500',{id:'paid',sourceAppointmentId:'a'}),job('9000',{id:'a',_source:'Appointments',status:'No Show'})]);
    assert.equal(r.rows[0].eligibleRevenue,'1500'); assert.equal(r.rows[0].dailyPayable,'30.00');
    assert.deepEqual(r.rows[0].contributions.map(j=>j.jobId),['paid']);
});
test('archived paid/closed source remains excluded', () => {
    assert.equal(compare([job('1500',{archived:true})]).rows[0].contributions.length,0);
});
function fixture({group=true,second='Scheduled',linked=null,status='Scheduled'}={}) {
    const seed={'Users/operator@example.test':{uid:'operator',roles:['FOH'],role:'FOH',active:true}};
    for (const [id,state] of [['a',status],['b',second]]) seed['Appointments/'+id]={status:state,dateString:'2026-09-05',groupId:group?'group':'',groupSize:2,subGroupIndex:id==='a'?1:2,bookedService:'Synthetic',grandTotal:9000};
    if(linked)seed['Active_Jobs/linked']=linked;
    const db=memoryDb(seed), config={version:1,projectId:'thuraya-staging',operators:[{uid:'operator',email:'operator@example.test',roles:['FOH'],enabled:true}]};
    const service=createNoShowService({db,projectId:'thuraya-staging',config:()=>config,clock:()=>new Date('2026-09-05T12:00:00Z'),fieldValue:{serverTimestamp:()=>'2026-09-05T12:00:00Z',delete:()=>({__delete:true})}});
    const call=(command,data)=>service.handle({auth:{uid:'operator',token:{email:'operator@example.test'}},data:{projectId:'thuraya-staging',command,...data}});
    const rows=()=>[...db.rows].filter(([p])=>/^(Appointments|Active_Jobs)\//.test(p)).map(([p,v])=>({...v.data,id:p.split('/')[1],_source:p.split('/')[0]}));
    return {db,call,rows};
}
for(const [name,options,scope,eligible] of [
    ['individual',{group:false},'member',1],['group member',{},'member',1],['entire group',{},'group-date',2],
    ['mixed group',{second:'Arrived'},'group-date',1],['arrived member',{status:'Arrived'},'member',0],
    ['started member',{status:'In Progress'},'member',0],['completed member',{status:'Completed'},'member',0],
    ['paid member',{status:'Paid'},'member',0],['cancelled member',{status:'Cancelled'},'member',0],
    ['group linked job',{linked:job('1500',{id:'linked',sourceAppointmentId:'a'})},'member',0],
    ['individual linked unstarted job',{group:false,status:'Arrived',linked:{status:'Waiting',sourceAppointmentId:'a',dateString:'2026-09-05'}},'member',1]
])test(`No Show transition preserves the Commission boundary: ${name}`,async()=>{
    const f=fixture(options), before=f.rows();compare(before);
    const p=await f.call('preview',{appointmentId:'a',scope});assert.equal(p.eligibleCount,eligible);
    const result=await f.call('commit',{appointmentId:'a',scope,fingerprint:p.fingerprint,requestId:'boundary-test'});
    assert.equal(result.changedIds.length,eligible);
    const after=f.rows(), report=compare(after);
    if(!options.linked||options.linked.status==='Waiting')assert.equal(report.rows[0].eligibleRevenue,'0');
    else assert.equal(report.rows[0].eligibleRevenue,'1500');
    const allowed=new Set(['status','serviceStatus','noShowAt','noShowBy','availabilityReleasedAt','updatedAt','needsFOHAttention','rescheduleRequested']);
    for(const row of after){const previous=before.find(r=>r.id===row.id&&r._source===row._source);assert.ok(previous);for(const key of new Set([...Object.keys(previous),...Object.keys(row)]))if(!allowed.has(key))assert.deepEqual(row[key],previous[key],key);}
    assert.ok(f.db.writes.every(w=>/^(Appointments|Active_Jobs|No_Show_Commands)\//.test(w.path)));
});
for(const mode of ['reinstate','reschedule'])test(`No Show ${mode} remains nonfinancial and excludes Appointment fallback`,async()=>{
    const f=fixture({status:'No Show'});compare(f.rows());await f.call('restore',{appointmentId:'a',mode});
    assert.equal(f.db.rows.get('Appointments/a').data.status,mode==='reinstate'?'Scheduled':'Action Required');
    assert.equal(compare(f.rows()).rows[0].eligibleRevenue,'0');
    assert.equal(f.db.rows.get('Appointments/a').data.grandTotal,9000);
    assert.ok(f.db.writes.every(w=>w.path==='Appointments/a'));
});
test('No Show reporting deduplicates linked jobs and leaves Commission source authority intact',()=>{
    const jobs=[job('1500',{id:'paid'}),job('9000',{id:'noshow',sourceAppointmentId:'a',status:'No Show'})];
    const rows=model.appendNoShows(jobs,[{id:'a',status:'No Show',grandTotal:9000},{id:'b',status:'No Show',grandTotal:8000},{id:'b',status:'No Show',grandTotal:8000}]);
    assert.equal(rows.length,3);assert.equal(rows.filter(r=>r._source==='Appointments (No Show lifecycle)').length,1);
    assert.equal(compare(rows).rows[0].dailyPayable,'30.00');
});
test('actual Sales report excludes quoted No Show and Cancelled amounts',()=>{
    const c={window:{},console:{log(){},warn(){}},document:{addEventListener(){}},setTimeout(){},setInterval(){}};
    const source=parity.read('reports-v2.js').replace('    const previousSwitchModule = window.switchModule;','    window.boundary = { isRealizedSale, computedRevenue };\n    const previousSwitchModule = window.switchModule;');
    vm.runInNewContext(source,c);
    for(const status of ['No Show','Cancelled']){const row={status,grandTotal:9000,finalTotal:9000,paymentStatus:'Paid'};assert.equal(c.window.boundary.isRealizedSale(row),false);assert.equal(c.window.boundary.computedRevenue([row]),0);}
    assert.equal(c.window.boundary.isRealizedSale({status:'Closed',paymentStatus:'Paid'}),true);
});
