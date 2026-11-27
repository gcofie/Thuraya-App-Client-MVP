'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const cp = require('node:child_process');
const vm = require('node:vm');
const BASE = '098702a4b4c37d9aad25a7730781b16547904a18';
const source = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const parent = cp.execFileSync('git', ['show', BASE + ':app.js'], {cwd:__dirname,encoding:'utf8',maxBuffer:20e6}).replace(/\r\n/g, '\n');
const marker = '// THURAYA PHASE 6.4 — AI ACTION LAYER';
function block(text, name) {
    const at = text.indexOf(name), start = text.indexOf('(function () {', at), end = text.indexOf('\n})();', start);
    assert.ok(at >= 0 && start > at && end > start);
    return text.slice(start, end + 7);
}
function harness(text = source) {
    const c = {console:{log(){},warn(){},error(){}},document:{readyState:'loading',addEventListener(){}},MutationObserver:class{observe(){}},setTimeout(){},clearTimeout(){},getLocalDateString:()=> '2025-06-18'};
    c.window = c;
    vm.createContext(c);
    vm.runInContext(block(text, '// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS'), c);
    if(text.includes('// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD')) vm.runInContext(block(text,'// THURAYA ISSUE 5 - SHARED INTELLIGENCE PERIOD'),c);
    const api = text === parent ? '{analyze:p64_analyze,bucket:p64_bucket,date:p64_date}' : '{resolve:p64_resolvePeriod,analyze:p64_analyze,content:p64_content,bucket:p64_bucket}';
    vm.runInContext(block(text, marker).replace('window.thurayaPhase64Render = p64_render;', `window.AI = ${api};`), c);
    return c;
}
const context = harness(), AI = context.AI;
const period = (mode, extra = {}) => AI.resolve({mode,anchorDate:'2025-06-18',...extra});
function job(id, date, gross = 100, extra = {}) {
    return {id,sourceAppointmentId:id,_collection:'Active_Jobs',status:'Closed',dateString:date,timeString:'10:00',finalTotal:gross,taxTotal:0,
        assignedTechName:id,clientName:id,clientPhone:id,
        serviceLineItems:[{menuItemId:id,name:id,qty:1,lineTotal:gross,lineSubtotal:gross,taxAmount:0,priceMode:'inclusive',durationAtBooking:30}],...extra};
}
const normalize = value => JSON.parse(JSON.stringify(value));
test('parent reproduces all-history client/technician and mixed owner summary', () => {
    const old = harness(parent).AI;
    const rows = [job('lifetime','2001-01-01',900),job('today','2025-06-18',100)].map(r=>({...r,_date:r.dateString,_revenue:r.finalTotal,_client:r.clientName,_tech:r.assignedTechName,_bucket:'Morning'}));
    const s = old.analyze(rows);
    assert.equal(s.totalRevenue,1000); assert.equal(s.topTech[0],'lifetime'); assert.equal(s.topClient[0],'lifetime'); assert.equal(s.todayRevenue,100);
    assert.match(block(parent,marker), /History analyzed:/);
    assert.doesNotMatch(block(parent,marker), /type="date"/);
});
test('parent reproduces unsupported menu reassurance and missing-time Morning inference', () => {
    const old = harness(parent).AI;
    assert.equal(old.bucket({}),'Morning');
    const s=old.analyze([{...job('legacy','2025-06-18'),serviceLineItems:[],_date:'2025-06-18',_revenue:100,_client:'A',_tech:'A',_bucket:'Morning'}]);
    assert.equal(s.serviceCoverage.coveragePercent,0); assert.equal(s.lowServices.length,0);
    assert.match(block(parent,marker), /No obvious low-demand service risk detected/);
});
test('daily defaults to operational today and contains one selected day only', () => {
    assert.equal(AI.resolve({mode:'daily'}).startDate,'2025-06-18');
    const s=AI.analyze([job('before','2025-06-17'),job('in','2025-06-18'),job('after','2025-06-19')],period('daily'));
    assert.deepEqual(normalize(s.valid.map(r=>r.id)),['in']);
});
test('weekly is exactly seven inclusive days ending at anchor', () => {
    const p=period('weekly'); assert.equal(p.startDate,'2025-06-12'); assert.equal(p.endDate,'2025-06-18');
    const s=AI.analyze(['11','12','18','19'].map(day=>job(day,'2025-06-'+day)),p);
    assert.deepEqual(normalize(s.valid.map(r=>r.id)),['12','18']);
});
for (const [anchor,start,end] of [['2024-02-20','2024-02-01','2024-02-29'],['2025-02-20','2025-02-01','2025-02-28'],['2025-12-31','2025-12-01','2025-12-31']]) {
    test('calendar month boundary ' + anchor, () => {
        const p=period('monthly',{anchorDate:anchor}); assert.equal(p.startDate,start); assert.equal(p.endDate,end);
        assert.equal(AI.analyze([job('first',start),job('last',end),job('old','2023-12-31'),job('next','2026-01-01')],p).totalRecords,2);
    });
}
test('custom includes both boundaries and excludes surrounding dates', () => {
    const p=period('custom',{startDate:'2025-05-03',endDate:'2025-05-05'});
    assert.equal(AI.analyze(['02','03','04','05','06'].map(d=>job(d,'2025-05-'+d)),p).totalRecords,3);
});
test('single-day custom equals daily', () => {
    const rows=[job('in','2025-06-18'),job('out','2025-06-19')];
    assert.equal(AI.analyze(rows,period('custom',{startDate:'2025-06-18',endDate:'2025-06-18'})).totalRevenue,AI.analyze(rows,period('daily')).totalRevenue);
});
for (const bad of [{mode:'custom',startDate:'2025-06-19',endDate:'2025-06-18'},{mode:'custom',startDate:'',endDate:'2025-06-18'},{mode:'daily',anchorDate:'2025-02-30'},{mode:'daily',anchorDate:''},{mode:'lifetime'},{mode:'monthly',anchorDate:'not-a-date'}]) {
    test('invalid period rejected ' + JSON.stringify(bad),()=>assert.throws(()=>AI.resolve(bad)));
}
test('calendar arithmetic crosses year and DST boundaries without changing operational dates',()=>{
    assert.equal(period('weekly',{anchorDate:'2025-01-02'}).startDate,'2024-12-27');
    assert.equal(period('weekly',{anchorDate:'2025-03-10'}).startDate,'2025-03-04');
    assert.match(period('monthly',{anchorDate:'2025-03-10'}).displayLabel,/1 Mar 2025 - 31 Mar 2025/);
});
test('canonical operational date precedence and timestamp fallback reused, invalid dates excluded',()=>{
    const rows=[job('date','2025-06-18',100,{closedAt:{toDate:()=>new Date(2025,5,17)}}),job('closed','',200,{createdAt:{toDate:()=>new Date(2000,0,1)},closedAt:{toDate:()=>new Date(2025,5,18)}}),job('bad','invalid',900)];
    const s=AI.analyze(rows,period('daily')); assert.equal(s.totalRevenue,300);assert.equal(s.undatedRecords,1);
});
test('all cards share one population and period top values replace lifetime leaders',()=>{
    const rows=[job('lifetime','2001-01-01',9000),...Array.from({length:3},(_,i)=>job('week'+i,'2025-06-12',200,{assignedTechName:'Weekly Tech',clientName:'Weekly Client',clientPhone:'weekly',serviceLineItems:[{menuItemId:'weekly-service',name:'Weekly Service',lineTotal:200,priceMode:'inclusive'}]})),job('daily','2025-06-18',100)];
    const s=AI.analyze(rows,period('weekly'));
    assert.equal(s.topTech[0],'Weekly Tech'); assert.equal(s.topClient[0],'Weekly Client');assert.equal(s.topServiceRow.id,'weekly-service');
    assert.equal(s.totalRevenue,700);assert.equal(s.totalRecords,4);assert.equal(s.bookingCount,4);assert.equal(s.avgTicket,175);
    const html=AI.content(s); assert.equal((html.match(/data-period-start="2025-06-12"/g)||[]).length,6);
    assert.doesNotMatch(html,/lifetime|9000/); assert.match(html,/700\.00 GHC/);
});
test('scheduled/arrived/ready-for-payment excluded and canonical booking duplicate counted once',()=>{
    const terminal=job('job','2025-06-18');
    const rows=[terminal,{...terminal,id:'duplicate'},job('appointment','2025-06-18',900,{_collection:'Appointments'}),job('scheduled','2025-06-18',900,{status:'Scheduled'}),job('arrived','2025-06-18',900,{status:'Arrived'}),job('ready','2025-06-18',900,{status:'Ready for Payment'})];
    const s=AI.analyze(rows,period('daily'));assert.equal(s.totalRevenue,100);assert.equal(s.bookingCount,1);
});
test('canonical service identities and gross allocation remain authoritative',()=>{
    const rows=[job('a','2025-06-18',120,{serviceLineItems:[{menuItemId:'one',name:'Alias A',qty:2,lineSubtotal:100,taxAmount:20,lineTotal:100,priceMode:'exclusive'}]}),job('b','2025-06-18',120,{serviceLineItems:[{menuItemId:'one',name:'Alias B',lineTotal:120,priceMode:'inclusive'}]}),job('c','2025-06-18',120,{serviceLineItems:[{menuItemId:'two',name:'Alias A',lineTotal:120,priceMode:'inclusive'}]})];
    const s=AI.analyze(rows,period('daily'));assert.equal(s.serviceCoverage.attributedRevenue,360);assert.equal(s.serviceCoverage.services.length,2);assert.equal(s.topServiceRow.id,'one');assert.equal(s.topServiceRow.revenue,240);assert.equal(s.topServiceRow.qty,3);
});
test('missing/positional service IDs never become upsell or menu recommendations',()=>{
    const rows=[job('missing','2025-06-18',100,{serviceLineItems:[]}),job('positional','2025-06-18',100,{serviceLineItems:[{id:'line-0',name:'Fake',lineTotal:100,priceMode:'inclusive'}]}),job('valid','2025-06-18')];
    const s=AI.analyze(rows,period('daily'));assert.equal(s.totalRevenue,300);assert.equal(s.serviceCoverage.unattributedRevenue,200);assert.equal(s.serviceEvidence,false);
    const html=AI.content(s);assert.match(html,/Insufficient canonical service data/);assert.doesNotMatch(html,/data-canonical-service-id="line-0"|No obvious low-demand/);
});
test('low-demand candidates are searched across every attributed canonical service, not the top ten',()=>{
    const rows=[];for(let n=0;n<12;n++)for(let i=0;i<(n===11?1:3);i++)rows.push(job(n+'-'+i,'2025-06-18',100,{serviceLineItems:[{menuItemId:'service-canonical-'+n,name:'Service '+n,lineTotal:100,priceMode:'inclusive'}]}));
    const s=AI.analyze(rows,period('daily'));assert.deepEqual(normalize(s.lowServices.map(r=>r.id)),['service-canonical-11']);
});
test('client canonical grouping distinguishes same-name clients and skips unidentified clients',()=>{
    const rows=[job('a','2025-06-18',200,{clientName:'Same',clientPhone:'one'}),job('b','2025-06-18',150,{clientName:'Same',clientPhone:'two'}),job('unknown','2025-06-18',900,{clientName:'',clientPhone:''})];
    const s=AI.analyze(rows,period('daily'));assert.equal(s.topClient[1],200);assert.equal(s.totalRevenue,1250);
});
test('technician uses reviewed historical-label grouping, not reused station email',()=>{
    const s=AI.analyze([job('a','2025-06-18',50,{assignedTechName:'First',assignedTechEmail:'shared'}),job('b','2025-06-18',100,{assignedTechName:'Second',assignedTechEmail:'shared'})],period('daily'));
    assert.deepEqual(normalize(s.topTech),['Second',100]);
});
test('time windows validate evidence then reuse canonical buckets',()=>{
    for(const [time,bucket] of [['00:00','Morning'],['11:59','Morning'],['12:00','Afternoon'],['16:59','Afternoon'],['17:00','Evening'],['23:59','Evening'],['',''],['25:00',''],['bad','']])assert.equal(AI.bucket({timeString:time}),bucket);
});
test('promo evidence requires volume, multiple dates, multiple observed windows and valid times',()=>{
    const rows=Array.from({length:6},(_,i)=>job('p'+i,i<3?'2025-06-17':'2025-06-18',i<3?100:200,{timeString:i<3?'10:00':'14:00'}));
    assert.equal(AI.analyze(rows,period('weekly')).promoEvidence,true);
    assert.equal(AI.analyze(rows.slice(0,5),period('weekly')).promoEvidence,false);
    assert.equal(AI.analyze(rows.map(r=>({...r,dateString:'2025-06-18'})),period('weekly')).promoEvidence,false);
    assert.equal(AI.analyze(rows.map(r=>({...r,timeString:''})),period('weekly')).promoEvidence,false);
    assert.equal(AI.analyze(rows.map(r=>({...r,finalTotal:100})),period('weekly')).promoEvidence,false);
});
test('empty and low-evidence cards are neutral and owner never mixes lifetime or today totals',()=>{
    const s=AI.analyze([job('old','2001-01-01',9000)],period('daily'));const html=AI.content(s);
    for(const text of ['No recognized revenue for this period','No qualifying client activity','No technician revenue','Insufficient data for promo','Insufficient canonical service data'])assert.ok(html.includes(text));
    assert.doesNotMatch(html,/History analyzed|Today’s revenue|9000/);assert.equal((html.match(/data-ai-card=/g)||[]).length,6);
});
test('certified canonical pipeline stays byte-identical while period ownership is global',()=>{
    const canonical='// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS';
    assert.equal(block(source,canonical),block(parent,canonical));
    assert.doesNotMatch(block(source,marker),/let p64Period|data-ai-period-form/);
    assert.match(block(source,marker),/ThurayaIntelligencePeriod\.get\(\)/);
});
