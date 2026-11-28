'use strict';
// Load after the actual Staff scripts. No protected direct Firestore writes.
(function(root){
 const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.keys(v).sort().reduce((a,k)=>(a[k]=v[k],a),{}):v);
 const clone=x=>JSON.parse(JSON.stringify(x));
 const storedData=row=>row.__catalogueStoredData?clone(row.__catalogueStoredData):Object.fromEntries(Object.entries(row).filter(([k])=>k!=='id'));
 const active=row=>row.deleted!==true&&!['inactive','deleted','archived'].includes(String(row.status||'').toLowerCase())&&row.isActive!==false;
 const aliases={department:['appliesTo','dept','departmentName'],ritualGroup:['mainMenu','mainCategory'],category:['subMenu','subCategory'],serviceName:['name'],serviceDescription:['description','desc'],ritualGroupDescription:['mainMenuDescription','mainCategoryDescription'],categoryDescription:['subMenuDescription','subCategoryDescription'],serviceTypeDescription:['typeDescription'],sortOrder:['priority'],ritualGroupOrder:['mainCategoryOrder'],categoryOrder:['subCategoryOrder']};
 function explicitRepair(row,kind){
  const changes={},unresolved=[];
  for(const [field,names] of Object.entries(aliases)){
   if(row[field]!==undefined&&row[field]!==null&&row[field]!=='')continue;
   const values=names.map(k=>row[k]).filter(v=>v!==undefined&&v!==null&&v!=='');
   if(!values.length)continue;
   if(values.some(v=>v!==values[0])){unresolved.push(field);continue;}
   const value=values[0],integer=['sortOrder','ritualGroupOrder','categoryOrder'].includes(field);
   if(integer?(!Number.isSafeInteger(value)||value<(field==='sortOrder'?1:0)):(typeof value!=='string'||value.length>512||!value.trim())){unresolved.push(field);continue;}
   if(field==='department'&&!['Hand','Foot','Both'].includes(value)){unresolved.push(field);continue;}
   changes[field]=value;
  }
  if(kind==='mixed'&&!['Hand','Foot'].includes(row.department||changes.department))unresolved.push('department');
  return {changes,unresolved};
 }
 function matches(item,row){
  const field={ritualGroup:'ritualGroup',category:'category',serviceType:'serviceType'}[item.level];
  return !!field&&(item.department==='Both'||row.department===item.department||row.department==='Both')&&row[field]===item.name&&
   (!item.ritualGroup||row.ritualGroup===item.ritualGroup)&&(!item.category||row.category===item.category);
 }
 function createController({api,readMenu,readTaxonomy,digest,sessionScope}){
  let state;
  function assertSession(scope){if(!scope||scope!==sessionScope())throw Error('Staff session changed. Reconcile before continuing.');}
  async function prepare(kind){
   if(!['repair','mapping','backfill','mixed'].includes(kind))throw Error('Unsupported catalogue maintenance.');
   const scope=sessionScope();assertSession(scope);
   const before=await api.firstWorkspace(),rows=await readMenu(),after=await api.firstWorkspace();assertSession(scope);
   if(before.sourceFingerprint!==after.sourceFingerprint)throw Error('Catalogue changed while preparing review.');
   if(rows.length>300)throw Error('Catalogue requires its existing paged release qualification.');
   const entries=[],unresolved=[];
   for(const row of rows){if(row.deleted===true||String(row.status).toLowerCase()==='deleted')continue;
    const planned=explicitRepair(row,kind);
    if(planned.unresolved.length)unresolved.push({serviceId:row.id,fields:planned.unresolved});
    if(Object.keys(planned.changes).length)entries.push({serviceId:row.id,changes:planned.changes,prior:clone(row)});
   }
   state={scope,kind,entries,unresolved,index:0,nextFingerprint:after.sourceFingerprint,pending:null};
   return clone(state);
  }
  async function settle(reply){
   const entry=state.entries[state.index],receipt=reply.writeReceipts?.find(r=>r.path==='Menu_Settings_V2/'+entry.serviceId);
   const noChange=reply.result?.status==='NO_CHANGE';
   const immutableReceipt=reply.writeReceipts?.find(r=>r.path.startsWith('Menu_Pricing_Receipts/metadata_')&&r.version&&r.sha256);
   if(!['UPDATED','NO_CHANGE'].includes(reply.result?.status)||(!noChange&&(!receipt?.version||!receipt.sha256))||(noChange&&!immutableReceipt))throw Error('Owned catalogue outcome requires reconciliation.');
   const rows=await readMenu(),row=rows.find(r=>r.id===entry.serviceId);if(!row)throw Error('Published row disappeared.');
   const data=storedData(row);
   if((receipt&&await digest(data)!==receipt.sha256)||Object.entries(entry.changes).some(([k,v])=>row[k]!==v))throw Error('Catalogue postimage changed. Stop for reconciliation.');
   for(const key of ['price','publicationVersion','status','isActive','inputType','pricingModel','serviceType','duration'])
    if(row[key]!==entry.prior[key])throw Error('Protected catalogue field changed: '+key);
   const fresh=await api.firstWorkspace();assertSession(state.scope);
   if((noChange&&fresh.sourceFingerprint!==state.nextFingerprint)||fresh.sourceFingerprint!==reply.snapshot?.sourceFingerprint)throw Error('Catalogue changed after its owned command.');
   state.nextFingerprint=fresh.sourceFingerprint;state.pending=null;state.index++;
  }
  async function apply(){
   if(!state)throw Error('Review a catalogue plan first.');assertSession(state.scope);
   if(state.pending)throw Error('Reconcile the pending command before continuing.');
   while(state.index<state.entries.length){
    const fresh=await api.firstWorkspace();assertSession(state.scope);
    if(fresh.sourceFingerprint!==state.nextFingerprint)throw Error('Reviewed catalogue baseline changed. Prepare a fresh review.');
    const entry=state.entries[state.index],input={serviceId:entry.serviceId,expectedFingerprint:state.nextFingerprint,changes:entry.changes};
    state.pending=input;
    await settle(await api.saveReviewedMetadata(input));
   }
   return {status:'COMPLETE',completed:state.index,unresolved:clone(state.unresolved)};
  }
  async function reconcile(){
   if(!state?.pending)throw Error('No pending catalogue command.');assertSession(state.scope);
   await settle(await api.reconcileReviewed(state.pending.serviceId));
   return {status:'RECONCILED',completed:state.index,remaining:state.entries.length-state.index};
  }
  async function retireTaxonomy(id){
   const scope=sessionScope();assertSession(scope);
   const item=await readTaxonomy(id);if(!item)throw Error('Schema item not found.');
   if(!['Hand','Foot','Both'].includes(item.department)||!['ritualGroup','category','serviceType'].includes(item.level)||!item.name)throw Error('Review the explicit schema identity before retirement.');
   let snapshot=await api.firstWorkspace();assertSession(scope);
   const dependencies=snapshot.catalogue.filter(row=>matches(item,row));
   // Reconcile every retained dependant request, including currently inactive rows.
   const pending=new Set(api.pendingFirst?.()||[]);
   for(const row of dependencies){
    if(pending.has(row.id)){
     const proof=await api.reconcileFirst(row.id);assertSession(scope);
     if(proof.result?.status!=='UPDATED'||!proof.writeReceipts?.length)throw Error('Dependant request remains uncertain; schema preserved.');
    }
    snapshot=await api.firstWorkspace();assertSession(scope);
    const current=snapshot.catalogue.find(r=>r.id===row.id);if(!current||!active(current))continue;
    const reply=await api.firstOperation('maintainPublishedService',{serviceId:current.id,command:'deactivate',expectedVersion:current.publicationVersion??0,expectedFingerprint:snapshot.sourceFingerprint});
    if(reply.result?.status!=='UPDATED'||!reply.writeReceipts?.length)throw Error('Dependant deactivation unconfirmed; schema preserved.');
    const reread=await api.firstWorkspace();assertSession(scope);
    if(active(reread.catalogue.find(r=>r.id===current.id)||{}))throw Error('Dependant remains active; schema preserved.');
   }
   snapshot=await api.firstWorkspace();assertSession(scope);
   if(snapshot.catalogue.some(row=>matches(item,row)&&active(row)))throw Error('New active dependant detected; schema preserved.');
   // The server repeats this complete dependency check in the same transaction
   // which retires the taxonomy and writes its durable receipt/audit evidence.
   const reply=await api.retireTaxonomy({serviceId:id,expectedFingerprint:snapshot.sourceFingerprint,expectedTaxonomyHash:await digest(item)});
   assertSession(scope);
   const receipt=reply.writeReceipts?.find(r=>r.path==='Menu_Taxonomy_V2/'+id),current=await readTaxonomy(id);
   if(reply.result?.status!=='RETIRED'||!receipt?.version||!current||await digest(current)!==receipt.sha256||current.status!=='inactive')throw Error('Schema retirement requires reconciliation.');
   return {status:'RETIRED',deactivated:dependencies.filter(active).map(row=>row.id)};
  }
  async function reconcilePending(serviceId,operation){
   const scope=sessionScope();assertSession(scope);
   const reply=await api.reconcileReviewed(serviceId,operation);assertSession(scope);
   if(!['UPDATED','NO_CHANGE','RETIRED'].includes(reply.result?.status)||!reply.writeReceipts?.some(r=>r.path.startsWith('Menu_Pricing_Receipts/metadata_')&&r.version&&r.sha256))throw Error('Saved catalogue request remains unconfirmed. No mutation retried.');
   state=null;return {status:'KNOWN_COMMIT',operation,serviceId,currentPostimagesMatch:reply.result.currentPostimagesMatch??null,message:'Original request reconciled. Prepare a fresh review; no old bulk plan is resumed.'};
  }
  return Object.freeze({stop:()=>{state=null;},prepare,apply,reconcile,reconcilePending,pendingReviewed:()=>api.pendingReviewed?.()||[],retireTaxonomy,inspect:()=>state?clone(state):null});
 }
 function installBrowser(){
  if(!root.document)return;
  const doc=root.document,api=new Proxy({}, {get:(_,name)=>(...args)=>{const current=root.ThurayaCatalogueMetadata;if(!current||typeof current[name]!=='function')throw Error('Controlled catalogue management is unavailable.');return current[name](...args);}});
  const sessionScope=()=>{const app=root.firebase?.app();const uid=app?.auth().currentUser?.uid;return uid?app.options.projectId+'.'+uid:null;};
  const digest=async value=>[...new Uint8Array(await root.crypto.subtle.digest('SHA-256',new TextEncoder().encode(stable(value))))].map(b=>b.toString(16).padStart(2,'0')).join('');
  const readMenu=async()=>{const snap=await root.db.collection('Menu_Settings_V2').get();return snap.docs.map(d=>({...d.data(),id:d.id,__catalogueStoredData:d.data()}));};
  const readTaxonomy=async id=>{const snap=await root.db.collection('Menu_Taxonomy_V2').doc(id).get();return snap.exists?snap.data():null;};
  const controller=createController({api,readMenu,readTaxonomy,digest,sessionScope});
  function panel(){let el=doc.getElementById('controlledLegacyCatalogue');if(el)return el;el=doc.createElement('section');el.id='controlledLegacyCatalogue';el.innerHTML='<h3>Review catalogue maintenance</h3><p>Existing prices, durations and publication authority are preserved. Only explicit existing metadata is proposed. Unresolved classifications open in the existing service editor.</p><pre data-review></pre><button type="button" data-apply>Apply reviewed metadata</button><button type="button" data-reconcile>Reconcile pending command</button><label>Saved catalogue request<select data-saved></select></label><button type="button" data-saved-refresh>Refresh saved requests</button><button type="button" data-saved-reconcile>Reconcile selected saved request</button><div data-manual></div><p role="status"></p>';doc.getElementById('menuSettingsView')?.prepend(el);
   const status=el.querySelector('[role="status"]'),saved=el.querySelector('[data-saved]');
   const refreshSaved=()=>saved.replaceChildren(...controller.pendingReviewed().map(item=>{const option=doc.createElement('option');option.value=JSON.stringify(item);option.textContent=item.operation+' · '+item.serviceId;return option;}));
   el.querySelector('[data-saved-refresh]').onclick=refreshSaved;
   el.querySelector('[data-saved-reconcile]').onclick=()=>{try{const item=JSON.parse(saved.value);controller.reconcilePending(item.serviceId,item.operation).then(r=>{status.textContent=JSON.stringify(r);refreshSaved();}).catch(e=>status.textContent=e.message);}catch(e){status.textContent='Select a saved request.';}};
   el.querySelector('[data-apply]').onclick=()=>{if(root.confirm('Apply this exact reviewed metadata plan? Prices and publication versions will be preserved.'))controller.apply().then(r=>status.textContent=JSON.stringify(r)).catch(e=>status.textContent=e.message);};
   el.querySelector('[data-reconcile]').onclick=()=>controller.reconcile().then(r=>status.textContent=JSON.stringify(r)).catch(e=>status.textContent=e.message);return el;
  }
  const show=kind=>async()=>{try{const plan=await controller.prepare(kind),el=panel();el.querySelector('[data-review]').textContent=JSON.stringify(plan,null,2);el.querySelector('[data-manual]').replaceChildren(...plan.unresolved.map(row=>{const button=doc.createElement('button');button.type='button';button.textContent='Review '+row.serviceId;button.onclick=()=>root.editMenuService?.(row.serviceId);return button;}));el.scrollIntoView?.({block:'start'});return plan;}catch(e){root.alert(e.message);}};
  for(const [name,kind] of Object.entries({thurayaRepairMenuV2Data:'repair',thurayaMapServicesToMenuCards:'mapping',thurayaFixMixedHandFootMenuHF58:'mixed',thurayaBackfillCategoryMenuHF69:'backfill',thurayaBackfillCategoryOrder:'backfill'}))root[name]=show(kind);
  const intake=side=>()=>{
   root.clearAdvForm?.(false);const dept=doc.getElementById('adv_applies_to');if(dept&&side){dept.value=side;if(root.Event)dept.dispatchEvent?.(new root.Event('change',{bubbles:true}));}
   doc.getElementById('menuSettingsView')?.scrollIntoView?.({block:'start'});
   root.alert('Historical embedded price/duration installation and destructive catalogue replacement are retired. Use this existing private-draft editor for one service, or IMPORT FINAL CLEAN CSV for an explicit reviewed bulk intake (up to 20 rows). Existing published services are preserved. New services require approval and controlled publication.');
   return {status:'PRIVATE_DRAFT_INTAKE',single:true,bulkInputId:'thImportCleanV2CsvInput'};
  };
  root.thurayaInstallApprovedMenuCards=intake(null);root.thurayaRestoreApprovedFootMenuHf54=intake('Foot');root.thurayaRestoreApprovedHandMenuHf55=intake('Hand');
  root.thurayaTaxonomyDelete=async id=>{try{if(root.confirm('Retire this exact schema after trusted deactivation and reconciliation of every matching published service? No service or financial history is deleted.')){const result=await controller.retireTaxonomy(id);root.alert('Schema retired. '+result.deactivated.length+' dependant service(s) deactivated through trusted commands.');return result;}}catch(e){root.alert(e.message);return {status:'HELD',reason:e.message};}};
  root.ThurayaLegacyCatalogue=controller;
  root.ThurayaSessionResources?.onStop?.('legacy-catalogue-governance',()=>{controller.stop();const el=doc.getElementById('controlledLegacyCatalogue');if(el){el.querySelector('[data-review]').textContent='';el.querySelector('[data-manual]').replaceChildren();el.querySelector('[data-saved]').replaceChildren();el.querySelector('[role="status"]').textContent='Staff session ended. Saved requests remain scoped to their original account.';}});
 }
 if(typeof module==='object'&&module.exports)module.exports={createController,explicitRepair,matches,stable};
 else {root.installThurayaLegacyCatalogueGovernance=installBrowser;installBrowser();}
})(typeof window==='undefined'?globalThis:window);
