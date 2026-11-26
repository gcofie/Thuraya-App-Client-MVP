'use strict';
// Request/resource values are simulations for the Rules test service, never Firestore writes.
const cases=[];
function add(name,collection,method,expectation,{auth={uid:'synthetic-tech',token:{roles:['Tech']}},before={},after={},doc='synthetic-record'}={}){
 cases.push({name,test:{expectation,request:{path:'/databases/(default)/documents/'+collection+'/'+doc,method,auth,resource:{data:after}},resource:{data:before},pathEncoding:'PLAIN'}});
}
for(const collection of ['Commission_Rules','Commission_Locks','Commission_Records']) for(const method of ['get','create','update','delete']) {
 add(collection+' technician '+method,collection,method,'DENY');
 add(collection+' manager direct '+method,collection,method,'DENY',{auth:{uid:'synthetic-manager',token:{roles:['Manager']}}});
}
for(const method of ['get','create','update','delete']) add('typed settings '+method,'Commission_Settings',method,'DENY',{doc:'v2_person_synthetic',before:{schemaVersion:2,recordType:'commission_person'},after:{schemaVersion:2,recordType:'commission_person'}});
add('typed setting downgrade denied','Commission_Settings','update','DENY',{doc:'innocent',before:{schemaVersion:2,recordType:'commission_person'},after:{rate:90}});
add('legacy setting upgrade denied','Commission_Settings','update','DENY',{doc:'legacy',before:{rate:10},after:{schemaVersion:2,recordType:'commission_person'}});
add('legacy setting read preserved','Commission_Settings','get','ALLOW',{auth:null,before:{rate:10},doc:'default'});
add('legacy setting write preserved','Commission_Settings','update','ALLOW',{before:{rate:10},after:{rate:12},doc:'default'});
for(const collection of ['Sales','Active_Jobs','Appointments']){
 add(collection+' authenticated update unchanged',collection,'update','ALLOW');
 add(collection+' unauthenticated update denied',collection,'update','DENY',{auth:null});
}
for(const collection of ['Approval_Pin_Secrets','Approval_Audit'])add(collection+' remains denied',collection,'get','DENY');
for(const collection of ['Commission_Rules','Commission_Locks','Commission_Records','Commission_Settings']) {
 add(collection+' nested authenticated bypass denied',collection,'update','DENY',{doc:'v2_synthetic/nested/record'});
 add(collection+' nested unauthenticated read denied',collection,'get','DENY',{auth:null,doc:'v2_synthetic/nested/record'});
}
add('untyped v2 control ID denied','Commission_Settings','create','DENY',{doc:'v2_control',after:{enabled:true}});
add('legacy-shaped v2 ID read denied','Commission_Settings','get','DENY',{doc:'v2_operator',before:{roles:['Manager']}});
add('unauthenticated legacy setting write denied','Commission_Settings','update','DENY',{auth:null,doc:'default',before:{rate:10},after:{rate:12}});
add('client Users role edit remains unrelated live behavior','Users','update','ALLOW',{doc:'synthetic@example.test',before:{roles:['Tech']},after:{roles:['Manager']}});
for (const [kind, auth] of [['anonymous', null], ['technician', {uid:'synthetic-tech',token:{roles:['Tech']}}], ['manager', {uid:'synthetic-manager',token:{roles:['Manager']}}], ['owner', {uid:'synthetic-owner',token:{roles:['System Admin']}}]]) {
 for (const method of ['get','create','update','delete']) add('enrollment revision '+kind+' '+method,'Commission_Settings',method,'DENY',{auth,doc:'v2_enrollment_synthetic',before:{schemaVersion:2,recordType:'commission_enrollment_revision',approvalReason:'Synthetic prior reason'},after:{schemaVersion:2,recordType:'commission_enrollment_revision',approvalReason:'Synthetic replacement'}});
}
add('enrollment revision typed downgrade denied','Commission_Settings','update','DENY',{doc:'synthetic',before:{schemaVersion:2,recordType:'commission_enrollment_revision'},after:{approvalReason:'Synthetic'}});
add('enrollment revision nested bypass denied','Commission_Settings','create','DENY',{doc:'v2_enrollment_synthetic/history/entry',after:{approvalReason:'Synthetic'}});
module.exports=cases;
