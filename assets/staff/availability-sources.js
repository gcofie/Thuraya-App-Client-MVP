(function(root){
 'use strict';
 const policy=root.ThurayaAvailabilitySchedulePolicy;
 const effective=root.ThurayaEffectiveSchedule.create({legacy:policy,v2:root.ThurayaSchedulePolicy});
 const norm=x=>String(x||'').trim().toLowerCase();
 async function fresh(query){const s=await query.get({source:'server'});if(s.metadata?.fromCache||s.metadata?.hasPendingWrites||s.size>1000)throw Error('Complete fresh availability is unavailable.');return s;}
 async function schedules(date,emails){
  const out={};
  for(const email of [...new Set(emails.map(norm))]){
   const ref=root.db.collection('Staff_Schedules').doc(email);
   const [current,history,versions]=await Promise.all([fresh(ref),fresh(ref.collection('history').limit(1001)),fresh(ref.collection('versions').limit(1001))]);
   const data=current.exists?current.data():null;
   const legacyRows=[...policy.records(data?.workingDays||data?.scheduleSegments?data:null),...history.docs.flatMap(d=>policy.records(d.data(),1))];
   out[email]=effective.resolve({root:data,legacyRows,versions:versions.docs.map(d=>({...d.data(),versionId:d.id}))},date,email);
  }
  return out;
 }
 async function busy(date,{prepMinutes=0}={}){
  const reply=await root.ThurayaOrdinaryStaging.call(root.ThurayaOrdinaryStaging.requireReady().endpoints.busy,{date});
  const data=reply?.data;if(data?.date!==date||data.complete!==true||!data.occupied||typeof data.occupied!=='object')throw Error('Complete fresh occupied periods unavailable.');
  return new Map(Object.entries(data.occupied).map(([email,intervals])=>[norm(email),intervals.map(([start,end])=>{if(!Number.isInteger(start)||!Number.isInteger(end)||start<0||end>1440||start>=end)throw Error('Invalid occupied period.');return[start,end+prepMinutes];})]));
 }
 root.thurayaAvailabilitySources=Object.freeze({schedules,busy,normalizeMenu:(data,i)=>root.ThurayaMenuV2Normalizer.normalize(data,i,root.thFinancialEvidence.amount)});
})(window);
