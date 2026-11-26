'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {read}=require('./no-show-source-parity.cjs');
function intelligence(source) {
    const c={console:{log(){},warn(){}},document:{addEventListener(){}},setTimeout(){},Date,Map,Set};
    c.window=c;vm.createContext(c);
    const app=read('app.js'),marker=app.indexOf('// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS');
    const start=app.indexOf('(function () {',marker),end=app.indexOf('\n})();',start);
    assert.ok(marker>=0&&start>marker&&end>start);
    vm.runInContext(app.slice(start,end+7),c);
    vm.runInContext(source.replace('    window.thurayaRunIntelligenceEngine = run;','    window.__test = { aggregateDay, STATE };\n    window.thurayaRunIntelligenceEngine = run;'),c);
    return c.__test;
}
function active(row){return{_collection:'Active_Jobs',...row};}
function appt(row){return{_collection:'Appointments',...row};}
test('Intelligence No Shows counted once, quoted amounts never revenue',()=>{const e=intelligence(read('intelligence-engine-v1.js'));e.aggregateDay([appt({id:'a',status:'No Show',grandTotal:500}),active({id:'j',sourceAppointmentId:'a',status:'No Show',grandTotal:500}),active({id:'paid',sourceAppointmentId:'paid',status:'Closed',finalTotal:120})],true);assert.equal(e.STATE.noShowsToday,1);assert.equal(e.STATE.revenueToday,120);assert.equal(e.STATE.closedJobsToday,1);});
test('Intelligence excludes positive non-terminal revenue candidates',()=>{const e=intelligence(read('intelligence-engine-v1.js'));const rows=[active({id:'x',sourceAppointmentId:'x',status:'Closed',finalTotal:120}),appt({id:'s',sourceAppointmentId:'s',status:'Scheduled',grandTotal:200}),active({id:'i',sourceAppointmentId:'i',status:'In Progress',grandTotal:80}),active({id:'r',sourceAppointmentId:'r',status:'Ready for Payment',grandTotal:300})];e.aggregateDay(rows,true);assert.equal(e.STATE.revenueToday,120);assert.equal(e.STATE.closedJobsToday,1);assert.equal(e.STATE.pendingJobsToday,1);assert.equal(e.STATE.activeJobsToday,1);assert.equal(e.STATE.bookingsToday,4);});
test('Intelligence dedupes Appointment plus terminal Active Job revenue',()=>{const e=intelligence(read('intelligence-engine-v1.js'));e.aggregateDay([appt({id:'appt1',sourceAppointmentId:'shared',status:'Closed',grandTotal:999}),active({id:'job1',sourceAppointmentId:'shared',status:'Paid',finalTotal:210})],true);assert.equal(e.STATE.revenueToday,210);assert.equal(e.STATE.closedJobsToday,1);assert.equal(e.STATE.bookingsToday,1);});
