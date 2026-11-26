'use strict';
(function(root){
 const ordinary=root.ThurayaOrdinaryStaging;ordinary.requireReady();const app=root.firebase.app(),inflight=new Set();
 const keyFor=(uid,kind)=>'thuraya.ordinary.staff-booking.'+ordinary.namespace+'.'+uid+'.'+kind;
 async function commit(pending,key){
  ordinary.requireSession(pending.uid);const result=await ordinary.call(ordinary.config.endpoints.staff,{payloads:pending.payloads,requestId:pending.requestId,priceQuote:pending.priceQuote});
  if(result?.outcome==='NOT_COMMITTED_STALE_REVIEW'&&result.requestId===pending.requestId){root.localStorage.removeItem(key);throw Error('Published booking details changed. Review the selection again.');}
  const ids=result?.appointmentIds||[result?.appointmentId];ordinary.requireSession(pending.uid);
  if(result?.committed!==true||ids.length!==pending.payloads.length||ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)throw Error('Staff booking receipt requires reconciliation.');
  root.localStorage.removeItem(key);return result;
 }
 async function submit(payloads){
  const uid=ordinary.sessionUid();if(!uid||!Array.isArray(payloads)||!payloads.length)throw Error('An authenticated Staff session is required.');
  const key=keyFor(uid,payloads.length===1?'individual':'group');if(inflight.has(key))throw Error('Booking confirmation is already in progress.');inflight.add(key);
  try{return await root.navigator.locks.request(key,{mode:'exclusive'},async()=>{
   ordinary.requireSession(uid);const clean=payloads.map(({createdAt,updatedAt,...row})=>row),hash=await ordinary.digest(clean),raw=root.localStorage.getItem(key);let pending=raw===null?null:JSON.parse(raw);
   if(pending&&(pending.uid!==uid||pending.hash!==hash))throw Error('An earlier booking is unresolved. Resume its original request before changing the selection.');
   if(!pending){const quote=await ordinary.call(ordinary.config.endpoints.quote,{channel:'staff',payloads:clean,...(clean[0].groupPaymentMode?{paymentMode:clean[0].groupPaymentMode}:{})});if(!quote?.priceQuote?.menuSourceVersions||quote.financials?.length!==clean.length)throw Error('Published pricing is unavailable.');ordinary.requireSession(uid);pending={uid,hash,payloads:clean,requestId:ordinary.allocate('bookingRequest'),priceQuote:quote.priceQuote};const bytes=JSON.stringify(pending);root.localStorage.setItem(key,bytes);if(root.localStorage.getItem(key)!==bytes)throw Error('Could not preserve the booking request.');}
   return commit(pending,key);
  });}finally{inflight.delete(key);}
 }
 function pendingKinds(){const uid=ordinary.sessionUid();return uid?['individual','group'].filter(kind=>root.localStorage.getItem(keyFor(uid,kind))!==null):[];}
 async function resumePending(kind){const uid=ordinary.sessionUid();if(!uid||!['individual','group'].includes(kind))throw Error('Authenticated original booking required.');const key=keyFor(uid,kind);return root.navigator.locks.request(key,{mode:'exclusive'},async()=>{ordinary.requireSession(uid);const pending=JSON.parse(root.localStorage.getItem(key)||'null');if(!pending||pending.uid!==uid||!/^[a-f0-9]{64}$/.test(pending.requestId||'')||await ordinary.digest(pending.payloads)!==pending.hash)throw Error('Saved booking requires reconciliation.');return commit(pending,key);});}
 root.ThurayaLocalStaffBooking=Object.freeze({submit,pendingKinds,resumePending});
})(window);
