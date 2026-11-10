(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ThurayaAllocationTransport=api;})(typeof globalThis==='object'?globalThis:this,function(){
 'use strict';
 const roots=new Set(['Appointments','Active_Jobs','Bookings']);
 const fail=code=>{throw Object.assign(Error(code),{code});};
 const owned=ref=>!!ref&&typeof ref.path==='string'&&roots.has(ref.path.split('/')[0]);
 function install(db,firebase,channel,binding){
  const projectId=binding?.projectId||'thuraya-client-telling',endpoint=binding?.endpoint||'commitBookingAllocation';
  if(binding&&(projectId!=='thuraya-staging'||endpoint!=='rc2AvailabilityNextCommit'||binding.busyEndpoint!=='rc2AvailabilityNextBusy'))fail('EXACT_QUALIFICATION_BINDING_REQUIRED');
  if(!['staff','client'].includes(channel)||db.app.options.projectId!==projectId)fail('EXACT_BOOKING_PROJECT_REQUIRED');
  if(db.__thurayaAllocationProtocol)return db;
  if(Object.getPrototypeOf(db).__thurayaAllocationBinding)fail('SECOND_BOOKING_INSTANCE_NOT_SUPPORTED');
  if(typeof firebase.functions!=='function')fail('BOOKING_CALLABLE_SDK_REQUIRED');
  const callable=firebase.app().functions('us-central1').httpsCallable(endpoint);
  const transforms=new WeakMap(),FV=firebase.firestore.FieldValue;
  for(const name of ['serverTimestamp','delete','increment','arrayUnion','arrayRemove']){const fn=FV[name];FV[name]=function(...args){const result=fn.apply(this,args);transforms.set(result,{__taTransform:name,...(name==='increment'?{value:args[0]}:['arrayUnion','arrayRemove'].includes(name)?{values:args}:{})});return result;};}
  function wire(x){if(x&&typeof x==='object'){if(transforms.has(x))return wire(transforms.get(x));if(typeof x.toDate==='function'&&Number.isInteger(x.seconds))return{__taType:'timestamp',seconds:x.seconds,nanoseconds:x.nanoseconds};if(typeof x.path==='string'&&typeof x.get==='function')return{__taType:'reference',path:x.path};if(typeof x.toBase64==='function')return{__taType:'bytes',base64:x.toBase64()};if(Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)&&Object.getPrototypeOf(x)!==Object.prototype)return{__taType:'geo',latitude:x.latitude,longitude:x.longitude};if(Array.isArray(x))return x.map(wire);if(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null)fail('UNKNOWN_BOOKING_WIRE_SCALAR');return Object.fromEntries(Object.keys(x).sort().map(k=>[k,wire(x[k])]));}if(x===undefined||typeof x==='function'||typeof x==='number'&&!Number.isFinite(x))fail('INVALID_BOOKING_WIRE_VALUE');return x;}
  const sha=async x=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(wire(x)))))).map(v=>v.toString(16).padStart(2,'0')).join('');
  const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(32))).map(v=>v.toString(16).padStart(2,'0')).join('');
  function op(action,ref,args){if(action==='set'&&args[1]&&Object.keys(args[1]).some(k=>k!=='merge'))fail('UNSUPPORTED_BOOKING_SET_OPTIONS');if(ref.path.split('/').length!==2)fail('BOOKING_DESCENDANT_WRITE_NOT_SUPPORTED');if(action==='update'&&(args.length!==1||!args[0]||typeof args[0]!=='object'))fail('USE_EXISTING_OBJECT_BOOKING_UPDATE');return{action,path:ref.path,...(action==='delete'?{}:{data:wire(args[0]),merge:action==='set'&&args[1]?.merge===true})};}
  async function send(records,reads,id){
   const booking=records.filter(r=>owned(r.ref));if(records.some(r=>r.ref.firestore!==db||r.ref.firestore.app.options.projectId!==projectId))fail('CROSS_PROJECT_BOOKING_WRITE');const extra=records.filter(r=>!owned(r.ref));let promoCounter;
   if(extra.length){if(channel!=='client'||extra.length!==1||extra[0].action!=='update'||!/^Promos\/[^/]+$/.test(extra[0].ref.path)||Object.keys(extra[0].args[0]||{}).join()!=='usedCount'||JSON.stringify(wire(extra[0].args[0].usedCount))!==JSON.stringify({__taTransform:'increment',value:1}))fail('MIXED_BOOKING_BATCH_NOT_QUALIFIED');promoCounter={path:extra[0].ref.path,delta:1};}
   const result=await callable({requestId:id,channel,operations:booking.map(r=>op(r.action,r.ref,r.args)),reads:await Promise.all(reads.map(async r=>({path:r.path,digest:await sha(r.data)}))),...(promoCounter?{promoCounter}:{})});
   if(result?.data?.committed!==true)fail('BOOKING_COMMIT_NOT_VERIFIED');return result.data;
  }
  const refProto=Object.getPrototypeOf(db.collection('Appointments').doc()),original={};
  for(const action of ['set','update','delete']){original[action]=refProto[action];refProto[action]=function(...args){if(!owned(this))return original[action].apply(this,args);if(this.firestore!==db||this.firestore.app.options.projectId!==projectId)fail('CROSS_PROJECT_BOOKING_WRITE');return send([{action,ref:this,args}],[],requestId()).then(()=>undefined);};}
  const colProto=Object.getPrototypeOf(db.collection('Appointments')),add=colProto.add;
  colProto.add=function(data){if(!roots.has(this.path))return add.call(this,data);const ref=this.doc();return ref.set(data).then(()=>ref);};
  const dbProto=Object.getPrototypeOf(db),batch=dbProto.batch,runTransaction=dbProto.runTransaction;
  dbProto.batch=function(){const currentDb=this;const native=batch.call(this),records=[];let used=false;const api={};for(const action of ['set','update','delete'])api[action]=function(ref,...args){records.push({action,ref,args});return api;};api.commit=async function(){if(used)fail('BOOKING_BATCH_ALREADY_COMMITTED');used=true;if(records.some(r=>owned(r.ref))){if(currentDb!==db||currentDb.app.options.projectId!==projectId)fail('CROSS_PROJECT_BOOKING_WRITE');return send(records,[],requestId()).then(()=>[]);}for(const r of records)native[r.action](r.ref,...r.args);return native.commit();};return api;};
  dbProto.runTransaction=async function(callback,options){const currentDb=this;let staged;const id=requestId();const result=await runTransaction.call(this,async native=>{const records=[],reads=[],api={get:async ref=>{const snap=await native.get(ref);reads.push({path:ref.path,data:snap.exists?wire(snap.data()):null});return snap;}};for(const action of ['set','update','delete'])api[action]=function(ref,...args){records.push({action,ref,args});return api;};const value=await callback(api);if(records.some(r=>owned(r.ref))){if(currentDb!==db||currentDb.app.options.projectId!==projectId)fail('CROSS_PROJECT_BOOKING_WRITE');staged={records,reads};return value;}for(const r of records)native[r.action](r.ref,...r.args);return value;},options);if(staged)await send(staged.records,staged.reads,id);return result;};
  Object.defineProperty(dbProto,'__thurayaAllocationBinding',{value:{db,channel}});
  Object.defineProperty(db,'__thurayaAllocationProtocol',{value:Object.freeze({version:1,channel,endpoint})});return db;
 }
 return{install};
});
