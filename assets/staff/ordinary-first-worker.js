'use strict';
(function(root){
 const ordinary=root.ThurayaOrdinaryStaging;ordinary.requireReady();
 const keyFor=(uid,id)=>'thuraya.ordinary.first-worker.'+ordinary.namespace+'.'+uid+'.'+id;
 async function run(serviceId,input,onlyReconcile=false,executePending=false){
  const uid=ordinary.sessionUid();if(!uid||typeof serviceId!=='string'||!/^[A-Za-z0-9_-]{1,120}$/.test(serviceId))throw Error('Sign in to manage this scheduled service.');
  const key=keyFor(uid,serviceId);return root.navigator.locks.request(key,{mode:'exclusive'},async()=>{
   ordinary.requireSession(uid);const raw=root.localStorage.getItem(key);let args=raw===null?null:JSON.parse(raw);
   if(!args){if(onlyReconcile)return {result:{status:'UNKNOWN'}};if(!input||input.serviceId!==serviceId||!Number.isSafeInteger(input.expectedVersion)||input.expectedVersion<1||!/^[a-f0-9]{64}$/.test(input.expectedFingerprint||''))throw Error('Review the exact scheduled draft version before activation.');args={operation:'activateFirstDraft',requestId:ordinary.allocate('catalogueRequest'),input};const bytes=JSON.stringify(args);root.localStorage.setItem(key,bytes);if(root.localStorage.getItem(key)!==bytes)throw Error('Could not preserve the worker request.');}
   else if(args.input?.serviceId!==serviceId||args.operation!=='activateFirstDraft'||typeof args.requestId!=='string')throw Error('Saved activation requires reconciliation.');
   if(input&&ordinary.stable(args.input)!==ordinary.stable(input))throw Error('An earlier activation is unresolved. Check its original request before changing selection.');
   const status=onlyReconcile||raw!==null&&!executePending,reply=await ordinary.call(status?ordinary.config.endpoints.publisher:ordinary.config.endpoints.due,{action:status?'firstActivationStatus':'activateFirstDraft',args});
   ordinary.requireSession(uid);if(!reply?.snapshot||!reply.result?.status)throw Error('Scheduled activation is unconfirmed. The request is retained.');
   if(['PUBLISHED','SCHEDULED','DRAFT','APPROVED','UPDATED'].includes(reply.result.status))root.localStorage.removeItem(key);
   return reply;
  });
 }
 // Explicit UI-confirmed resume may execute the original request. Never called
 // by startup, status reconciliation or a timer; original UUID/input stay fixed.
 root.ThurayaFirstActivationWorker=Object.freeze({activate:input=>run(input?.serviceId,input),reconcile:id=>run(id,null,true),resume:id=>run(id,null,false,true),pending:()=>{const uid=ordinary.sessionUid();if(!uid)return[];const prefix=keyFor(uid,'');return Object.keys(root.localStorage).filter(k=>k.startsWith(prefix)).map(k=>k.slice(prefix.length));}});
})(window);
