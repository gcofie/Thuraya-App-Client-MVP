'use strict';
// Install with the authenticated callable transport and session scope supplied
// by the Staff host. The isolated candidate has no live route registration.
(function(root){
 function install({call, sessionScope, storage, locks, uuid}){
  let selected;
  const fields=['department','ritualGroup','ritualGroupDescription','category','categoryDescription',
   'serviceName','serviceDescription','serviceTypeDescription','duration','sortOrder'];
  async function begin(id){
   selected=null;
   const scope=sessionScope();
   if(!scope)throw Error('Sign in to edit the catalogue.');
   const {snapshot}=await call('workspace',{});
   if(scope!==sessionScope()||snapshot?.sourceChanged||!snapshot?.sourceFingerprint)
    throw Error('Catalogue baseline unavailable. Reload before editing.');
   const row=snapshot.catalogue.find(row=>row.id===id);
   if(!row)throw Error('Service no longer exists.');
   selected={id,scope,expectedFingerprint:snapshot.sourceFingerprint,row};
  }
  async function save(id,payload,form={}){
   const binding=selected;
   if(!binding||binding.id!==id||binding.scope!==sessionScope())throw Error('Reopen the service before saving.');
   const key='thuraya.catalogue.metadata.'+binding.scope+'.'+id;
   return locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||binding.scope!==sessionScope())throw Error('Catalogue save is already pending or session changed.');
    const effectiveType=binding.row.serviceType||'Main Therapy';
    const effectiveModel=binding.row.pricingModel||
        (form.defaultPricingModel ? form.defaultPricingModel(binding.row.inputType) :
         binding.row.inputType==='counter'?'per_nail':'fixed');
    for(const k of ['price','pricingModel','inputType','serviceType','status','isActive']){
      const expected=k==='serviceType'?effectiveType:k==='pricingModel'?effectiveModel:binding.row[k];
      const actual=k==='pricingModel'&&form.pricingModel!==undefined?form.pricingModel:payload[k];
      if(actual!==undefined&&(k==='price'?Number(actual)!==Number(expected):String(actual)!==String(expected)))
       throw Error('Use the approved workflow for commercial or activation changes.');
     }
    const saved=storage.getItem(key);
    let args=saved===null?null:JSON.parse(saved);
    if(!args){
     args={serviceId:id,expectedFingerprint:binding.expectedFingerprint,requestId:uuid(),
      changes:Object.fromEntries(fields.filter(k=>payload[k]!==undefined).map(k=>[k,payload[k]]))};
     const record=JSON.stringify(args);
     storage.setItem(key,record);
     if(storage.getItem(key)!==record)throw Error('Could not persist catalogue request.');
    } else if(args.serviceId!==id||typeof args.requestId!=='string'){
     throw Error('Saved catalogue request requires reconciliation.');
    } else if(Object.entries(args.changes).some(([k,v])=>payload[k]!==v)){
     throw Error('A previous save is pending. Reopen with the original values to reconcile.');
    }
    const {result}=await call(saved===null?'editServiceMetadata':'metadataStatus',args);
    if(binding.scope!==sessionScope()||!['UPDATED','NO_CHANGE'].includes(result?.status))
     throw Error('Catalogue save is unconfirmed. The original request is saved.');
    storage.removeItem(key);
    selected=null;
    return result;
   });
  }
  async function firstWorkspace(){
   const scope=sessionScope();
   if(!scope)throw Error('Sign in to manage first publication.');
   const {snapshot}=await call('workspace',{});
   if(scope!==sessionScope()||snapshot?.sourceChanged||!snapshot?.sourceFingerprint)
    throw Error('Reload the published catalogue before continuing.');
   return snapshot;
  }
  async function firstOperation(operation,input){
   const scope=sessionScope();
   if(!scope||!['saveFirstDraft','approveFirstDraft','publishFirstDraft','returnFirstDraft','maintainPublishedService'].includes(operation))throw Error('First publication operation unavailable.');
   const key='thuraya.catalogue.first.'+scope+'.'+input.serviceId;
   return locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||scope!==sessionScope())throw Error('First publication already pending or session changed.');
    const saved=storage.getItem(key);
    const args=saved===null?{operation,requestId:uuid(),input}:JSON.parse(saved);
    if(args.operation!==operation||JSON.stringify(args.input)!==JSON.stringify(input))
     throw Error('A different first publication request is pending. Check its result.');
    if(saved===null){
     const bytes=JSON.stringify(args);storage.setItem(key,bytes);
     if(storage.getItem(key)!==bytes)throw Error('Could not persist first publication request.');
    }
    const reply=await call(saved===null?operation:'firstActivationStatus',args);
    if(scope!==sessionScope()||!['DRAFT','APPROVED','SCHEDULED','PUBLISHED','UPDATED'].includes(reply.result?.status))
     throw Error('First publication is unconfirmed. The original request is saved.');
    storage.removeItem(key);return reply;
   });
  }
  async function reconcileFirst(serviceId){
   const scope=sessionScope();if(!scope)throw Error('Sign in to check first publication.');
   const key='thuraya.catalogue.first.'+scope+'.'+serviceId;
   return locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||scope!==sessionScope())throw Error('First publication already pending or session changed.');
    const saved=storage.getItem(key);
    if(saved===null)return {result:{status:'UNKNOWN'}};
    const args=JSON.parse(saved);
    if(args.input?.serviceId!==serviceId)throw Error('Saved first publication request requires review.');
    const reply=await call('firstActivationStatus',args);
    if(scope!==sessionScope())throw Error('Staff session changed.');
    if(['DRAFT','APPROVED','SCHEDULED','PUBLISHED','UPDATED'].includes(reply.result?.status))storage.removeItem(key);
    return reply;
   });
  }
  function pendingFirst(){
   const scope=sessionScope();if(!scope)return [];
   const prefix='thuraya.catalogue.first.'+scope+'.';
   return Object.keys(storage).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length));
  }
  async function reviewedCommand(operation,input){
   if(!['editServiceMetadata','retireTaxonomy'].includes(operation))throw Error('Unsupported reviewed catalogue command.');
   const scope=sessionScope();if(!scope)throw Error('Sign in to manage the catalogue.');
   const key='thuraya.catalogue.reviewed.'+scope+'.'+operation+'.'+input.serviceId;
   return locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||scope!==sessionScope())throw Error('Catalogue command pending or session changed.');
    const saved=storage.getItem(key),args=saved===null?{...input,requestId:uuid()}:JSON.parse(saved);
    const {requestId,...original}=args;
    if(JSON.stringify(original)!==JSON.stringify(input))throw Error('A different catalogue request is pending. Reconcile it before editing.');
    if(saved===null){const bytes=JSON.stringify(args);storage.setItem(key,bytes);if(storage.getItem(key)!==bytes)throw Error('Could not preserve catalogue request.');}
    const statusAction=operation==='retireTaxonomy'?'taxonomyStatus':'metadataStatus';
    const reply=await call(saved===null?operation:statusAction,args);
    if(scope!==sessionScope())throw Error('Staff session changed; reconcile the saved request.');
    if(!['UPDATED','NO_CHANGE','RETIRED'].includes(reply.result?.status)||!Array.isArray(reply.writeReceipts)||!reply.writeReceipts.length)
     throw Error('Catalogue outcome unconfirmed. Request retained for reconciliation.');
    storage.removeItem(key);return reply;
   });
  }
  async function reconcileReviewed(serviceId,operation='editServiceMetadata'){
   if(!['editServiceMetadata','retireTaxonomy'].includes(operation))throw Error('Unsupported reviewed catalogue command.');
   const scope=sessionScope();if(!scope)throw Error('Sign in to reconcile the catalogue.');
   const key='thuraya.catalogue.reviewed.'+scope+'.'+operation+'.'+serviceId;
   return locks.request(key,{ifAvailable:true},async lock=>{
    if(!lock||scope!==sessionScope())throw Error('Catalogue command pending or session changed.');
    const saved=storage.getItem(key);if(saved===null)return {result:{status:'UNKNOWN'}};
    const args=JSON.parse(saved);if(args.serviceId!==serviceId)throw Error('Saved catalogue request requires review.');
    const reply=await call(operation==='retireTaxonomy'?'taxonomyStatus':'metadataStatus',args);
    if(scope!==sessionScope())throw Error('Staff session changed.');
    if(['UPDATED','NO_CHANGE','RETIRED'].includes(reply.result?.status)&&reply.writeReceipts?.length)storage.removeItem(key);
    return reply;
   });
  }
  function pendingReviewed(){
   const scope=sessionScope();if(!scope)return [];
   const prefix='thuraya.catalogue.reviewed.'+scope+'.';
   return Object.keys(storage).filter(key=>key.startsWith(prefix)).flatMap(key=>{
    try{const args=JSON.parse(storage.getItem(key)),suffix=key.slice(prefix.length),operation=suffix.slice(0,suffix.indexOf('.'));
     if(!['editServiceMetadata','retireTaxonomy'].includes(operation)||!args?.serviceId||!args.requestId||suffix!==operation+'.'+args.serviceId)return [];
     return [{operation,serviceId:args.serviceId,requestId:args.requestId}];}catch{return [];}
   });
  }
  return Object.freeze({begin,save,firstWorkspace,firstOperation,reconcileFirst,pendingFirst,
   saveReviewedMetadata:input=>reviewedCommand('editServiceMetadata',input),
   retireTaxonomy:input=>reviewedCommand('retireTaxonomy',input),reconcileReviewed,pendingReviewed});
 }
 if(typeof module==='object'&&module.exports)module.exports={install};
 else root.installThurayaCatalogueMetadata=install;
})(typeof window==='undefined'?globalThis:window);

