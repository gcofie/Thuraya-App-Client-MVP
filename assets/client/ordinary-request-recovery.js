'use strict';
(function(root){
 const ordinary=root.ThurayaOrdinaryStaging;ordinary.requireReady();
 // User action only. Resume may execute the originally approved request if its
 // commit never happened; it is never described as read-only status checking.
 async function resumeReview(target){
  const transport=root.ThurayaLocalReviewedEdit;if(!transport?.resumePending)throw Error('Saved review recovery unavailable.');
  if(!root.confirm('Resume the original saved reviewed change? If it has not committed, this may complete that exact edit. No new selection will be submitted.'))return null;
  return transport.resumePending(target);
 }
 async function resumeStaff(kind){
  if(!root.confirm('Resume the original saved '+kind+' booking? If it has not committed, this may complete that exact booking.'))return null;
  return root.ThurayaLocalStaffBooking.resumePending(kind);
 }
 async function resumeClient(kind){if(!root.confirm('Resume your original saved '+kind+' booking? If it has not committed, this may complete that exact booking.'))return null;return root.ThurayaTrustedClientBooking.resumePending(kind);}
 async function resumeWorker(id){if(!root.confirm('Resume the original saved scheduled activation? If it has not committed and is now due, the designated server worker may publish that exact draft.'))return null;return root.ThurayaFirstActivationWorker.resume(id);}
 const wrapped=new Set();
 function wrapReviews(){for(const name of ['editAppointment','thOpenExpectedTodayQuickEdit','thOpenExpectedTodayQuickEditV4','thStaffQuickEditAppointment','cancelAppointment']){const current=root[name];if(typeof current!=='function'||wrapped.has(current))continue;const wrappedCall=async function(id,...rest){if(root.ThurayaLocalReviewedEdit?.pendingTargets().includes(String(id))){try{const result=await resumeReview(String(id));if(!result)return;if(name==='cancelAppointment'){root.alert('Original saved change confirmed. Refresh the appointment to see its persisted state.');return result;}}catch(e){root.alert('Saved review remains unconfirmed. '+e.message);return;}}return current.call(this,id,...rest);};wrapped.add(wrappedCall);root[name]=wrappedCall;}}
 function mount(){
  const host=root.document?.body;if(!host||root.document.getElementById('thurayaOrdinaryPendingRequests'))return;
  const box=root.document.createElement('aside');box.id='thurayaOrdinaryPendingRequests';box.setAttribute('aria-live','polite');host.appendChild(box);
  function refresh(){const actor=ordinary.sessionUid(),staff=actor?(root.ThurayaLocalStaffBooking?.pendingKinds()||[]):[],reviews=actor?(root.ThurayaLocalReviewedEdit?.pendingTargets()||[]):[],client=root.ThurayaTrustedClientBooking?.pendingKinds()||[],worker=actor?(root.ThurayaFirstActivationWorker?.pending()||[]):[];box.replaceChildren();
   for(const [kind,value,label]of [...staff.map(k=>['staff',k,'Resume original '+k+' booking']),...reviews.map(id=>['review',id,'Resume original reviewed change']),...client.map(k=>['client',k,'Resume original '+k+' booking']),...worker.map(id=>['worker',id,'Resume original scheduled activation'])]){const button=root.document.createElement('button');button.type='button';button.textContent=label;button.addEventListener('click',async()=>{button.disabled=true;try{const result=kind==='staff'?await resumeStaff(value):kind==='client'?await resumeClient(value):kind==='worker'?await resumeWorker(value):await resumeReview(value);if(result){root.alert('Original request confirmed. Refresh the relevant record to see the persisted result.');refresh();}}catch(e){root.alert('Saved request remains unconfirmed. '+e.message);}finally{button.disabled=false;}});box.appendChild(button);}
  }
  refresh();root.firebase.auth().onAuthStateChanged(()=>{refresh();wrapReviews();});box.addEventListener('pointerenter',refresh);
 }
 root.ThurayaOrdinaryRequestRecovery=Object.freeze({resumeReview,resumeStaff,resumeClient,resumeWorker,wrapReviews,mount});
 if(root.document?.readyState==='loading')root.document.addEventListener('DOMContentLoaded',()=>{wrapReviews();mount();});else{wrapReviews();mount();}
})(window);
