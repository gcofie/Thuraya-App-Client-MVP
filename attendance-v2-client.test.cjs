'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {harness,withConfirmation,withGroup,read,section}=require('./schedule-client-fixture.cjs');
const {stripScheduling}=require('./attendance-v2-protected.cjs');
function seed(h,off=false) {
    for(const email of [h.fixture.email,h.fixture.other]) {
        const root=h.fixture.tables.Staff_Schedules.find(r=>r.id===email);
        Object.assign(root,{schemaVersion:2,v2EffectiveFrom:'2026-09-01',latestRevision:1,latestVersionId:'v1'});
        h.fixture.tables['Staff_Schedules/'+email+'/versions']=[{id:'v1',schemaVersion:2,technicianEmail:email,timezone:'UTC',effectiveFrom:'2026-09-01',effectiveTo:null,revision:1,parentRevision:0,previousVersionId:null,publishedBy:{uid:'manager',email:'manager@example.test'},publishedAt:'2026-08-31T12:00:00Z',provenance:{kind:'MANUAL',sourcePaths:[]},week:Object.fromEntries(['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=>[day,off?{status:'OFF',start:null,end:null}:{status:'WORKING',start:'10:00',end:'18:00'}]))}];
    }
    return h;
}
test('V2 Client reader uses complete week and reads versions from server',async()=>{
    const h=seed(harness());const result=await h.av_getSlotMap('2026-09-28',[h.fixture.email],60);
    assert.ok(Object.keys(result).length);assert.ok(h.fixture.reads.some(r=>r.path.endsWith('/versions')&&r.source==='server'));
});
test('V2 Client explicit off-day overrides legacy working plan',async()=>{
    const h=seed(harness(),true);await assert.rejects(h.av_validateBookingAssignments([{techEmail:h.fixture.email,date:'2026-09-28',time:'15:00',duration:60}]));assert.equal(h.fixture.writes.length,0);
});
for(const group of [false,true]) for(const off of [false,true]) test('V2 '+(group?'Group':'Individual')+' real confirmation '+(off?'blocks OFF':'preserves valid payload'),async()=>{
    const h=seed(group?withGroup(harness(),'2026-09-28'):withConfirmation(harness()),off);
    await (group?h.grp_confirmBooking():h.bk_confirmBooking());assert.equal(h.fixture.commits,off?0:1);
});
test('V2 version read failure prevents Client persistence',async()=>{
    const h=seed(withConfirmation(harness()));h.fixture.fail='versions';await h.bk_confirmBooking();assert.equal(h.fixture.commits,0);
});
test('frozen Client Issue 1 source unchanged outside reviewed scheduling overlay',()=>{
    const prior=file=>cp.execFileSync('git',['show','5c0006db02a03d2b6efacf277ff5e36ea95a9281:'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:16e6}).replace(/\r\n/g,'\n');
    assert.equal(read('tax-policy.js'),prior('tax-policy.js'));
    assert.equal(stripScheduling(read('group-booking.js')),stripScheduling(prior('group-booking.js')));
    const strip=s=>{s=stripScheduling(s);return s.replace(section(s,'(function thurayaClientHF19LunchAvailability()','// END HF19 Lunch Break Availability Alignment'),'<attendance-overlay>');};
    assert.equal(strip(read('app.js')),strip(prior('app.js')));
});
test('Group alternative planner excludes OFF and outside-shift Technicians without changing amounts',async()=>{
    const vm=require('node:vm'),h=seed(harness());
    vm.runInContext(section(read('group-booking.js'),'function grp_timeToMins(', 'function grp_formatTime(')+
        section(read('group-booking.js'),'async function grp_ensureTechs()', 'function grp_candidateSlots()')+';var grp_bookedCacheByDate={};',h);
    h.fixture.tables['Staff_Schedules/'+h.fixture.email+'/versions'][0].week.Monday={status:'OFF',start:null,end:null};
    const booked=await h.grp_getBookedSlots('2026-09-28');
    assert.equal(h.grp_getFreeTechsAt(h.bk_techs,booked,540,60).length,0);
    assert.equal(h.grp_getFreeTechsAt(h.bk_techs,booked,1050,60).length,0);
    assert.deepEqual(Array.from(h.grp_getFreeTechsAt(h.bk_techs,booked,900,60),t=>t.email),[h.fixture.other]);
    assert.equal(h.fixture.writes.length,0);
});
