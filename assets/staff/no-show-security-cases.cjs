'use strict';
const cases = [];
const roles = ['Unauthenticated', 'Technician', 'FOH', 'Manager', 'System Admin', 'Unknown'];
function add(name, collection, method, role, before, after, allow = false) {
    const path = '/databases/(default)/documents/' + collection + '/synthetic';
    cases.push({ name, test: { expectation: allow ? 'ALLOW' : 'DENY', request: { path, method, auth: role === 'Unauthenticated' ? null : { uid: 'synthetic', token: { role } }, resource: { data: after } }, resource: { data: before }, pathEncoding: 'PLAIN' } });
}
for (const role of roles) for (const collection of ['Appointments','Active_Jobs']) {
    for (const status of ['No Show','NO SHOW','no-show','noshow',' no_show ','No  Show','No\tShow']) {
        add(role+' enter '+collection+' '+status,collection,'update',role,{status:'Scheduled'},{status});
        add(role+' create '+collection+' '+status,collection,'create',role,{}, {status});
    }
    add(role+' exit '+collection,collection,'update',role,{status:'No Show'},{status:'Scheduled'});
    add(role+' delete '+collection,collection,'delete',role,{status:'No Show'},{});
    for (const patch of [{noShowAt:'now'},{noShowBy:'forged'},{autoNoShow:true},{serviceStatus:'No Show'}]) add(role+' audit tamper '+collection+' '+Object.keys(patch)[0],collection,'update',role,{status:'Scheduled'},{status:'Scheduled',...patch});
    add(role+' No Show notes '+collection,collection,'update',role,{status:'No Show'},{status:'No Show',notes:'Allowed nonfinancial note'},role!=='Unauthenticated');
    add(role+' Scheduled checkin '+collection,collection,'update',role,{status:'Scheduled'},{status:'Arrived'},role!=='Unauthenticated');
    add(role+' No Show read '+collection,collection,'get',role,{status:'No Show'}, {},true);
    add(role+' legacy null create '+collection,collection,'create',role,{}, {status:null},collection==='Appointments'||role!=='Unauthenticated');
    add(role+' legacy null update '+collection,collection,'update',role,{status:null},{status:null,notes:'Legacy note'},role!=='Unauthenticated');
}
for (const role of roles) for (const method of ['get','list','create','update','delete']) add(role+' private command '+method,'No_Show_Commands',method,role,{},{});
module.exports = cases;
