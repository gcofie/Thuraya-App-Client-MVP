(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.ThurayaAllocationTransport=api;})(typeof globalThis==='object'?globalThis:this,function(root){
 'use strict';
 const roots=new Set(['Appointments','Active_Jobs','Bookings']),fail=code=>{throw Object.assign(Error(code),{code});};
 function install(db,firebase,channel,binding){
  const ordinary=root.ThurayaOrdinaryStaging,config=ordinary.requireReady(),endpoint=config.endpoints.reviewed;
  if(channel!=='staff'||binding?.projectId!==config.projectId||binding.endpoint!==endpoint||binding.busyEndpoint!==config.endpoints.busy||db.app.options.projectId!==config.projectId)fail('EXACT_ORDINARY_BOOKING_BINDING_REQUIRED');
  const transforms=new WeakMap();
  const FieldValue=Object.freeze(Object.fromEntries(['serverTimestamp','delete'].map(name=>[name,()=>{const marker=Object.freeze({});transforms.set(marker,{__taTransform:name});return marker;}]))) ;
  function wire(x){if(x&&typeof x==='object'){if(transforms.has(x))return wire(transforms.get(x));if(typeof x.toDate==='function'&&Number.isInteger(x.seconds))return{__taType:'timestamp',seconds:x.seconds,nanoseconds:x.nanoseconds};if(typeof x.path==='string'&&typeof x.get==='function')return{__taType:'reference',path:x.path};if(typeof x.toBase64==='function')return{__taType:'bytes',base64:x.toBase64()};if(Number.isFinite(x.latitude)&&Number.isFinite(x.longitude)&&Object.getPrototypeOf(x)!==Object.prototype)return{__taType:'geo',latitude:x.latitude,longitude:x.longitude};if(Array.isArray(x))return x.map(wire);if(Object.getPrototypeOf(x)!==Object.prototype&&Object.getPrototypeOf(x)!==null)fail('UNKNOWN_BOOKING_WIRE_SCALAR');return Object.fromEntries(Object.keys(x).sort().map(k=>[k,wire(x[k])]));}if(x===undefined||typeof x==='function'||typeof x==='number'&&!Number.isFinite(x))fail('INVALID_BOOKING_WIRE_VALUE');return x;}
  const sha=async value=>ordinary.digest(wire(value));
  function owned(ref){return ref&&ref.firestore===db&&typeof ref.path==='string'&&ref.path.split('/').length===2&&roots.has(ref.path.split('/')[0]);}
  function stored(target,actor){const raw=root.localStorage.getItem(ordinary.reviewJournal(target,actor));if(raw===null)return null;let pending;try{pending=JSON.parse(raw);}catch{fail('REVIEW_JOURNAL_INVALID');}
   if(pending?.uid!==actor||pending.target!==target||!/^[a-f0-9]{64}$/.test(pending.data?.requestId||'')||!Array.isArray(pending.data?.operations)||pending.data.reviewedBookingIntent?.targetAppointmentId!==target)fail('REVIEW_JOURNAL_INVALID');return pending;
  }
  async function submitPending(pending){
   ordinary.requireSession(pending.uid);if(await sha(pending.payload)!==pending.digest||ordinary.stable(pending.data)!==ordinary.stable({requestId:pending.data.requestId,...pending.payload}))fail('REVIEW_JOURNAL_CONFLICT');
   const result=await ordinary.call(endpoint,pending.data);
   if(result?.committed!==true||result.generation!==config.generation||!Array.isArray(result.paths)||ordinary.stable([...result.paths].sort())!==ordinary.stable(pending.data.operations.map(op=>op.path).sort()))fail('BOOKING_COMMIT_NOT_VERIFIED');
   ordinary.requireSession(pending.uid);const key=ordinary.reviewJournal(pending.target,pending.uid);root.localStorage.removeItem(key);root.localStorage.removeItem(key.replace('.review.','.review-history.'));return result;
  }
  async function transaction(callback,{reviewedBookingIntent}={}){
   const actor=ordinary.sessionUid(),target=reviewedBookingIntent?.targetAppointmentId,key=ordinary.reviewJournal(target,actor);
   return root.navigator.locks.request(key,{mode:'exclusive'},async()=>{
    ordinary.requireSession(actor);const pending=stored(target,actor);
    if(pending){if(ordinary.stable(pending.data.reviewedBookingIntent)!==ordinary.stable(reviewedBookingIntent))fail('REVIEW_PENDING_INTENT_CONFLICT');await submitPending(pending);return pending.clientResult;}
    let staged;
    const value=await db.runTransaction(async native=>{
     const reads=[],records=[],api={get:async ref=>{if(!owned(ref))fail('UNSUPPORTED_REVIEW_READ');const snap=await native.get(ref);if(!reads.some(r=>r.path===ref.path))reads.push({path:ref.path,data:snap.exists?wire(snap.data()):null});return snap;},
      set(ref,data,options){if(!owned(ref)||!ref.path.startsWith('Appointments/')||options?.merge!==true)fail('UNSUPPORTED_REVIEW_WRITE');records.push({action:'set',path:ref.path,data:wire(data),merge:true});return api;}};
     const result=await callback(api);staged={reads,records};return result;
    },{maxAttempts:1});
    ordinary.requireSession(actor);if(!staged.records.length)return value;
    const payload={channel:'staff',operations:staged.records,reads:await Promise.all(staged.reads.map(async r=>({path:r.path,digest:await sha(r.data)}))),reviewedBookingIntent:wire(reviewedBookingIntent)};
    const record={uid:actor,target,digest:await sha(payload),payload,data:{requestId:ordinary.allocate('reviewRequest'),...payload},...(value===undefined?{}:{clientResult:wire(value)})};
    ordinary.requireSession(actor);const bytes=JSON.stringify(record);root.localStorage.setItem(key,bytes);if(root.localStorage.getItem(key)!==bytes)fail('REVIEW_JOURNAL_UNCONFIRMED');
    await submitPending(record);return value;
   });
  }
  function pendingTargets(){const actor=ordinary.sessionUid();if(!actor)return[];const prefix='thuraya.ordinary.review.'+ordinary.namespace+'.'+actor+'.';return Object.keys(root.localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length)).filter(target=>/^[A-Za-z0-9_-]{1,128}$/.test(target));}
  // This is an explicit resume, NOT a read-only status query. The original
  // request may execute if it has not committed; callers must obtain confirmation.
  async function resumePending(target){const actor=ordinary.sessionUid(),key=ordinary.reviewJournal(target,actor);return root.navigator.locks.request(key,{mode:'exclusive'},async()=>{ordinary.requireSession(actor);const pending=stored(target,actor);if(!pending)fail('NO_PENDING_REVIEW_REQUEST');return submitPending(pending);});}
  const surface={app:db.app,collection:db.collection.bind(db),runTransaction:transaction};Object.defineProperty(surface,'__thurayaAllocationProtocol',{value:Object.freeze({version:1,channel,endpoint})});
  return Object.freeze({database:Object.freeze(surface),transaction,FieldValue,pendingTargets,resumePending});
 }
 return{install};
});
