'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {harness,withConfirmation,withGroup}=require('./schedule-client-fixture.cjs');
const inactive=()=>({schemaVersion:1,status:'INACTIVE',effectiveAt:{seconds:1767225600,nanoseconds:0},revision:1,auditRef:'Technician_Status_Audit/'+'a'.repeat(64)});
test('actual availability excludes inactive from Any and Explicit without deleting identity',async()=>{
 const h=harness();h.fixture.tables.Users[0].technicianOperational=inactive();
 const slots=await h.av_getSlotMap('2026-09-28',[h.fixture.email,h.fixture.other],60);
 assert.ok(Object.keys(slots).length);for(const emails of Object.values(slots))assert.deepEqual(Array.from(emails),[h.fixture.other]);
 assert.equal(h.fixture.tables.Users.length,2);assert.equal(h.fixture.writes.length,0);
});
for(const group of [false,true])for(const malformed of [false,true])test('actual '+(group?'Group':'Individual')+' rejects '+(malformed?'malformed':'INACTIVE')+' at final confirmation',async()=>{
 const h=group?withGroup(harness(),'2026-09-28'):withConfirmation(harness());
 h.fixture.tables.Users[0].technicianOperational=malformed?{}:inactive();
 await(group?h.grp_confirmBooking():h.bk_confirmBooking());assert.equal(h.fixture.commits,0);assert.equal(h.fixture.writes.length,0);
});
for(const group of [false,true])test('actual '+(group?'Group':'Individual')+' revalidates status in final transaction after successful preflight',async()=>{
 const h=group?withGroup(harness(),'2026-09-28'):withConfirmation(harness());
 h.fixture.beforeTransaction=()=>{h.fixture.tables.Users[0].technicianOperational=inactive();};
 await(group?h.grp_confirmBooking():h.bk_confirmBooking());assert.equal(h.fixture.batches,1);assert.equal(h.fixture.commits,0);assert.equal(h.fixture.writes.length,0);
});
