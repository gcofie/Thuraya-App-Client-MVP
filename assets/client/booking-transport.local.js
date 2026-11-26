'use strict';
(function(root){
 const ordinary=root.ThurayaOrdinaryStaging;ordinary.requireReady();
 const scope=()=>ordinary.config.projectId+'.'+(ordinary.sessionUid()||'guest');
 const keyFor=kind=>'thuraya.ordinary.client-booking.'+scope()+'.'+kind;
 function confirm(requestId){for(const kind of ['individual','group']){const key=keyFor(kind),raw=root.localStorage.getItem(key);if(raw){const pending=JSON.parse(raw);if(pending.data?.requestId===requestId)root.localStorage.removeItem(key);}}}
 async function submit(data){const actor=ordinary.sessionUid(),key=keyFor(data.kind);if(!['individual','group'].includes(data.kind)||!/^[a-f0-9]{64}$/.test(data.requestId||''))throw Error('Original booking identity required.');
  return root.navigator.locks.request(key,{mode:'exclusive'},async()=>{ordinary.requireSession(actor);const raw=root.localStorage.getItem(key);const fingerprint=await ordinary.digest(data);let pending=raw===null?null:JSON.parse(raw);
   if(pending&&(pending.uid!==actor||pending.fingerprint!==fingerprint))throw Error('An earlier booking is unresolved. Resume its original request first.');
   if(!pending){pending={uid:actor,fingerprint,data};const bytes=JSON.stringify(pending);root.localStorage.setItem(key,bytes);if(root.localStorage.getItem(key)!==bytes)throw Error('Could not preserve original booking.');}
   const result=await ordinary.call(ordinary.config.endpoints.client,pending.data);
   if(result?.outcome==='NOT_COMMITTED_STALE_REVIEW'&&result.requestId===pending.data.requestId)confirm(pending.data.requestId);
   return result;
  });
 }
 async function resumePending(kind){const actor=ordinary.sessionUid(),raw=root.localStorage.getItem(keyFor(kind));if(!raw)throw Error('No original booking is pending.');const pending=JSON.parse(raw);if(pending.uid!==actor||await ordinary.digest(pending.data)!==pending.fingerprint)throw Error('Saved booking requires reconciliation.');
  const result=await submit(pending.data);ordinary.requireSession(actor);
  if(result?.outcome==='NOT_COMMITTED_STALE_REVIEW'&&result.requestId===pending.data.requestId){root.sessionStorage.removeItem('thuraya.booking.review.'+scope()+':'+kind);throw Error('Original booking did not commit. Review current availability and prices again.');}
  if(typeof root.bk_verifyTrustedBookingReceipt!=='function')throw Error('Original receipt verification unavailable.');root.bk_verifyTrustedBookingReceipt(pending.data,result);confirm(pending.data.requestId);root.sessionStorage.removeItem('thuraya.booking.review.'+scope()+':'+kind);return result;
 }
 root.ThurayaTrustedClientBooking=Object.freeze({quote:data=>ordinary.call(ordinary.config.endpoints.quote,data),submit,sessionScope:scope,confirm,pendingKinds:()=>['individual','group'].filter(kind=>root.localStorage.getItem(keyFor(kind))!==null),resumePending});
})(window);
