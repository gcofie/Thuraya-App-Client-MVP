'use strict';
(function(root){
 const core=root.ThurayaMenuPricing,doc=root.document,esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 let provider=null,manager=null,actor=null,catalogue=[],selection=[],selectionQuote=null,serial=0,generation=0,sourceFingerprint='',pricingStale=false;
 const q=id=>doc.getElementById(id),money=n=>'GHS '+core.amount(n),message=(text,error=false)=>{q('mpMessage').textContent=text;q('mpMessage').dataset.error=String(error);};
 function configure(p){generation++;provider=p;manager=p.manager;actor=p.actor;reload();}
 function getCatalogue(){return (provider?.getCatalogue?provider.getCatalogue():root.thurayaGetMenuV2Services?.({activeOnly:true})||[]).filter(s=>s.isActive!==false&&s.deleted!==true&&!['inactive','deleted','disabled','archived'].includes(String(s.status||'').toLowerCase()));}
 function reload(){catalogue=getCatalogue();const fingerprint=JSON.stringify(catalogue.map(x=>[x.id,x.price,x.duration,x.publicationVersion??0]));if(!provider&&manager&&sourceFingerprint&&fingerprint!==sourceFingerprint)pricingStale=true;sourceFingerprint=fingerprint;if(!manager&&catalogue.length){const store=core.memoryStore(catalogue);manager=core.createManager({store,authorize:async()=>false});actor={uid:'local-private-editor'};}renderComposer();renderPrices();}
 function guard(){const token=generation,valid=root.ThurayaSessionResources?.capture?.()||(()=>provider?.mode==='synthetic');if(!valid())throw Error('Verified Staff session required.');return()=>token===generation&&valid();}
 function key(s){return [s.department,s.ritualGroup,s.category].join(' / ');}
 function options(rows){return rows.map(s=>`<option value="${esc(s.id)}">${esc(s.serviceName)} · ${esc(s.department)} · ${money(core.minor(s.price))}</option>`).join('');}
// Structural presentation evidence: Hand DOCX body 26/53; Foot DOCX body 11/17.
function referenceFoundation(service){return reviewedTherapyRole(service);}
function reviewedTherapyRole(service) {
    const roles = {"foot__foundation_rituals__foundation_rituals__main_therapy__silk_skin_ritual": ["Silk Skin Ritual", "Foot", "Foundation Rituals", "Foundation Rituals", ""], "foot__foundation_rituals__foundation_rituals__main_therapy__the_refinement_indulgence": ["The Refinement Indulgence", "Foot", "Foundation Rituals", "Foundation Rituals", ""], "foot__urban_express_rituals__urban_express_rituals__main_therapy__rapid_reboot": ["Rapid Reboot", "Foot", "Foundation Rituals", "Foundation Rituals", ""], "hand__hand_therapies__hand_therapies__main_therapy__precision_groom_men": ["Precision Groom — Men", "Hand", "Hand Therapies", "Core Hand Rituals", ""], "hand__hand_therapies__hand_therapies__main_therapy__silken_restore_hand_balance": ["Silken Restore — Hand Balance", "Hand", "Hand Therapies", "Core Hand Rituals", ""], "hand__hand_therapies__hand_therapies__main_therapy__youthful_touch_hand_renewal": ["Youthful Touch — Hand Renewal", "Hand", "Hand Therapies", "Core Hand Rituals", ""]};
    if (!Object.hasOwn(roles, service.id)) return false;
    const published = [service.serviceName || service.name, service.department,
        service.ritualGroup || service.mainCategory, service.category || service.subCategory, service.serviceType || ''];
    return roles[service.id].every((value,index) => value === published[index]);
}
function referenceFoundationKnown(id){return new Set(["foot__foundation_rituals__foundation_rituals__main_therapy__silk_skin_ritual", "foot__foundation_rituals__foundation_rituals__main_therapy__the_refinement_indulgence", "foot__urban_express_rituals__urban_express_rituals__main_therapy__rapid_reboot", "hand__hand_therapies__hand_therapies__main_therapy__precision_groom_men", "hand__hand_therapies__hand_therapies__main_therapy__silken_restore_hand_balance", "hand__hand_therapies__hand_therapies__main_therapy__youthful_touch_hand_renewal"]).has(id);}
function referenceElevation(base, extra) {
    const foundations = {"foot__foundation_rituals__foundation_rituals__main_therapy__silk_skin_ritual": "Foot", "foot__foundation_rituals__foundation_rituals__main_therapy__the_refinement_indulgence": "Foot", "foot__urban_express_rituals__urban_express_rituals__main_therapy__rapid_reboot": "Foot", "hand__hand_therapies__hand_therapies__main_therapy__precision_groom_men": "Hand", "hand__hand_therapies__hand_therapies__main_therapy__silken_restore_hand_balance": "Hand", "hand__hand_therapies__hand_therapies__main_therapy__youthful_touch_hand_renewal": "Hand"};
    const indulgences = {"foot__finishing_indulgences__finishing_indulgences__add_on__hot_stone_foot_therapy": "Foot", "foot__finishing_indulgences__finishing_indulgences__add_on__paraffin_restoration_mask": "Foot", "hand__finishing_indulgences__finishing_indulgences__add_on__hot_stone_arm_massage": "Hand", "hand__finishing_indulgences__finishing_indulgences__add_on__lush_arm_sculpt_massage": "Hand"};
    const roles={"foot__finishing_indulgences__finishing_indulgences__add_on__hot_stone_foot_therapy": ["Hot Stone Foot Therapy", "Foot", "Finishing Indulgences", "Finishing Indulgences", ""], "foot__finishing_indulgences__finishing_indulgences__add_on__paraffin_restoration_mask": ["Paraffin Restoration Mask", "Foot", "Finishing Indulgences", "Finishing Indulgences", ""], "hand__finishing_indulgences__finishing_indulgences__add_on__hot_stone_arm_massage": ["Hot Stone Arm Massage", "Hand", "Finishing Indulgences", "Finishing Indulgences", ""], "hand__finishing_indulgences__finishing_indulgences__add_on__lush_arm_sculpt_massage": ["Lush Arm Sculpt Massage", "Hand", "Finishing Indulgences", "Finishing Indulgences", ""]};
    const current=[extra.serviceName||extra.name,extra.department,extra.ritualGroup||extra.mainCategory,extra.category||extra.subCategory,extra.serviceType||''];
    if(!Object.hasOwn(roles,extra.id)||!roles[extra.id].every((v,i)=>v===current[i]))return false;
    const side=foundations[base.id];
    return reviewedTherapyRole(base) && (side==='Hand'||side==='Foot') && side===indulgences[extra.id] &&
        base.department===side && extra.department===side &&
        Number(base.duration)>0 && Number(extra.duration)>0 &&
        String(extra.ritualGroup||extra.mainCategory||'').trim().toLowerCase()==='finishing indulgences' &&
        !Object.hasOwn(extra,'compatibleWith') && !Object.hasOwn(extra,'compatibleRitualGroups');
}
 function isFoundation(service){
  const type=String(service.serviceType||'').trim().toLowerCase();
  if (referenceFoundationKnown(service.id) && !reviewedTherapyRole(service)) return false;
  const finishGroups=new Set(['design canvas','polish & finish','editorial nail art','finishing indulgences','couture nail art','embellishment drawers']);
  if([service.ritualGroup,service.category].some(value=>finishGroups.has(String(value||'').trim().toLowerCase())))return false;
  const therapyReference=['hand','foot'].includes(String(service.department||'').toLowerCase()) &&
   referenceFoundation(service);
  return Number(service.duration)>0&&service.inputType!=='counter'&&(therapyReference||['main','main therapy','base','foundation','structure'].includes(type));
 }
 function guidedStage(service,base){
  if(service.id===base?.id)return 'Foundation';
  const group=String(service.ritualGroup||'').trim().toLowerCase();
  const category=String(service.category||'').trim().toLowerCase();
  if(treatmentHouse(service)==='House III · Design Canvas')
   return ['finish','quantity'].includes(String(service.serviceType||'').trim().toLowerCase())?'Design Canvas':'Other published treatments';
  if(group==='the pleiades studio')return 'The Pleiades Studio';
  if(group==='finishing indulgences'||category==='finishing indulgences')return 'Finishing Indulgence';
  return 'Other published treatments';
 }
// Display labels from the Hand/Foot menu references. Published data is left intact.
function treatmentHouse(service, department) {
    const group=String(service.ritualGroup||service.mainCategory||'').trim().toLowerCase();
    const category=String(service.category||service.subCategory||'').trim().toLowerCase();
    const canvas=['design canvas','polish & finish','editorial nail art','couture nail art','embellishment drawers'];
    if(canvas.includes(group)||canvas.includes(category))return 'House III · Design Canvas';
    if(['the pleiades studio','nail architecture','nail care','nail care & refinements'].includes(group))return 'House II · The Pleiades Studio';
    if(['hand therapies','hand therapy rituals','foot therapies','foot therapy rituals','foundation rituals','finishing indulgences','the medi-cleanse series'].includes(group)||category==='finishing indulgences'){
        const side=['Hand','Foot'].includes(service.department)?service.department:department;
        if(['Hand','Foot'].includes(side))return 'House I · '+side+' Therapy Rituals';
    }
    return 'Published treatments · House unassigned';
}
 function renderStaffHouses(rows,renderService,dept){
  const houses=new Map();
  for(const row of rows){
   const house=treatmentHouse(row,dept);
   if(!houses.has(house))houses.set(house,[]);
   houses.get(house).push(row);
  }
  return [...houses].map(([house,items])=>`<section aria-label="${esc(house)}"><h5>${esc(house)}</h5>${items.map(renderService).join('')}</section>`).join('');
 }
 function renderComposer(){if(!q('mpFoundation'))return;const previous=q('mpFoundation').value;q('mpFoundation').innerHTML='<option value="">Choose a foundation</option>'+options(catalogue.filter(isFoundation));q('mpFoundation').value=previous;const base=catalogue.find(s=>s.id===q('mpFoundation').value),guided=q('mpMode').value==='guided';q('mpFoundationWrap').hidden=!guided;
  const renderService=s=>{const foundation=s.id===base?.id,allowed=!guided||foundation||(base&&isGuidedOption(s,base)),counter=s.inputType==='counter';return `<label class="mp-service ${!allowed?'mp-unavailable':''}"><span><strong>${esc(s.serviceName)}</strong><small>${esc(key(s))} · ${s.duration} min · ${money(core.minor(s.price))}</small>${guided&&!foundation&&!allowed?'<small>Compatibility not configured for this foundation</small>':''}</span>${counter?`<input aria-label="Quantity ${esc(s.serviceName)}" type="number" min="0" max="99" value="0" data-mp-service="${esc(s.id)}" ${!allowed?'disabled':''}>`:`<input aria-label="Select ${esc(s.serviceName)}" type="${!guided&&s.inputType==='radio'?'radio':'checkbox'}" name="${!guided&&s.inputType==='radio'?esc(encodeURIComponent(key(s))):''}" data-mp-service="${esc(s.id)}" ${foundation?'checked':''} ${!allowed?'disabled':''}>`}</label>`;};
  const guidance=base?.department==='Hand'&&['hand therapies','hand therapy rituals'].includes(String(base.ritualGroup||'').trim().toLowerCase())?'Finishing Indulgence is recommended with Hand Therapy Rituals.':base?.department==='Foot'?'Add a Finishing Indulgence if desired.':'';
  const stages=[
   ['Foundation',['Foundation']],
   ['Elevation / Finishing Indulgence',['Finishing Indulgence','The Pleiades Studio','Other published treatments']],
   ['Design Canvas',['Design Canvas']]
  ];
  q('mpServices').innerHTML=(guided?stages.map(([label,stages])=>{
   const rows=catalogue.filter(s=>stages.includes(guidedStage(s,base)));
   return rows.length?`<section aria-label="${esc(label)}"><h4>${esc(label)}</h4>${stages.includes('Finishing Indulgence')&&guidance?`<p>${esc(guidance)}</p>`:''}${renderStaffHouses(rows,renderService,base?.department)}</section>`:'';
  }).join(''):renderStaffHouses(catalogue,renderService))||'<p>Published menu is loading. Reload when available.</p>';selection=[];selectionQuote=null;q('mpComposition').textContent='Choose treatments to review.';
 }
 function isGuidedOption(row,base){
  if(treatmentHouse(row)==='House III · Design Canvas'&&guidedStage(row,base)!=='Design Canvas')return false;
  return core.compatible(base,row)||referenceElevation(base,row);
 }
 function review(){selection=Array.from(q('mpServices').querySelectorAll('[data-mp-service]')).map(el=>({id:el.dataset.mpService,qty:el.type==='number'?Number(el.value):(el.checked?1:0)})).filter(x=>x.qty>0);if(q('mpMode').value==='guided'&&!catalogue.some(s=>s.id===q('mpFoundation').value&&isFoundation(s)))throw Error('Choose a published foundation.');
 const base=catalogue.find(row=>row.id===q('mpFoundation').value);
 if(q('mpMode').value==='guided'&&base){
  const extras=selection.filter(item=>item.id!==base.id).map(item=>catalogue.find(row=>row.id===item.id));
  if(extras.some(row=>!row||!isGuidedOption(row,base)))throw Error('Treatment compatibility changed. Review the selection again.');
  if(extras.filter(row=>guidedStage(row,base)==='Design Canvas').length>1)throw Error('Choose at most one Design Canvas finish.');
 }
 const guidedCatalogue=q('mpMode').value==='guided'&&base?catalogue.map(row=>referenceElevation(base,row)?{...row,compatibleWith:[base.id]}:row):catalogue;
 const result=core.compose(guidedCatalogue,{mode:q('mpMode').value,baseId:q('mpFoundation').value,selections:selection});selectionQuote={rows:selection.map(x=>{const s=catalogue.find(s=>s.id===x.id);return {id:s.id,price:s.price,duration:s.duration,publicationVersion:s.publicationVersion??0,qty:x.qty};})};q('mpComposition').textContent=`${result.duration} minutes · treatment subtotal ${money(result.subtotalMinor)}. Existing New Booking calculates tax, adjustments and the final quote.`;return result;}
 async function openBooking(){const valid=guard();root.thurayaMenuPricingBookingQuote=null;if(root.thurayaMenuComposerHasEdit?.())throw Error('Close the existing appointment edit before starting a new booking.');const group=root.THURAYA_HF87_GROUP;
 const activeGroup=doc.getElementById('thHF87Shell')?.classList.contains('active');
 const member=activeGroup?group?.members[group.activeMember]:null;
 if(activeGroup&&(!member||typeof root.thHF87ApplyComposerSelection!=='function'))throw Error('Group treatment handoff is unavailable.');
 review();const reviewedMode=q('mpMode').value,reviewedBase=q('mpFoundation').value;
 const reviewed=selectionQuote;const reviewedSelection=selection;if(provider?.beforeBooking)await provider.beforeBooking();if(!valid()||reviewed!==selectionQuote)throw Error('Staff session or selection changed.');const fresh=getCatalogue();for(const row of reviewed.rows){const s=fresh.find(s=>s.id===row.id);if(!s||core.minor(s.price)!==core.minor(row.price)||s.duration!==row.duration||(s.publicationVersion??0)!==row.publicationVersion)throw Error('Published treatment changed. Reload and review your selection.');}

  if(q('mpMode').value!==reviewedMode||q('mpFoundation').value!==reviewedBase)throw Error('Treatment selection changed.');
  if(reviewedMode==='guided'){
   const base=fresh.find(row=>row.id===reviewedBase);
   if(!base||!isFoundation(base))throw Error('Published foundation changed. Review the selection again.');
   const guided=fresh.map(row=>referenceElevation(base,row)?{...row,compatibleWith:[base.id]}:row);
   core.compose(guided,{mode:'guided',baseId:reviewedBase,selections:reviewedSelection});
  }
  if(activeGroup){
   if(!doc.getElementById('thHF87Shell')?.classList.contains('active')||group.members[group.activeMember]!==member)throw Error('The active group member changed. Review the selection again.');
   root.thHF87ApplyComposerSelection(member,reviewed.rows);
   message('Selection applied to the active group member. Review group availability before saving.');
   return;
  }
  if(doc.getElementById('thHF87Shell')?.classList.contains('active'))throw Error('The booking mode changed. Review the selection again.');
  if(typeof root.switchModule!=='function')throw Error('Existing New Booking is unavailable.');root.switchModule('bookingWizardView');if(!valid())throw Error('Staff session changed.');root.thHF84SetMode?.('individual');const controls=Array.from(doc.querySelectorAll('#sched_serviceMenu .sched-service-item, #sched_serviceMenu .sched-service-counter'));const selected=reviewedSelection.map(row=>{const el=controls.find(el=>el.id==='sched_cb_'+row.id||el.id==='sched_qty_'+row.id);if(!el)throw Error('Selected treatment is unavailable in New Booking.');const live=fresh.find(s=>s.id===row.id);if(core.minor(el.dataset.price)!==core.minor(live.price)||Number(el.dataset.duration)!==live.duration)throw Error('New Booking menu is stale. Reload its published menu before continuing.');return {row,el};});const groups=new Set();for(const {el} of selected)if(el.type==='radio'&&el.name){if(groups.has(el.name))throw Error('Choose one treatment from each existing booking option group.');groups.add(el.name);}
  controls.forEach(el=>{if(el.classList.contains('sched-service-counter'))el.value='0';else el.checked=false;});for(const {row,el} of selected){if(el.classList.contains('sched-service-counter'))el.value=String(row.qty);else el.checked=true;el.dispatchEvent(new Event('change',{bubbles:true}));}root.calculateScheduleTotals?.();root.thHF84Refresh?.();root.thHF84SetStep?.(1);if(q('nav_new_booking'))q('nav_new_booking').checked=true;if(provider?.mode==='persistent')root.thurayaMenuPricingBookingQuote={...JSON.parse(JSON.stringify(selectionQuote)),menuVersions:Object.fromEntries(selectionQuote.rows.map(r=>[r.id,r.publicationVersion])),taxVersion:manager.snapshot().taxVersion};message('Selection opened in existing New Booking. No appointment was saved.');
 }
 function renderHistoryEvent(h){
  if(/^FIRST_SERVICE_(DRAFT|APPROVED|SCHEDULED|PUBLISHED)$/.test(h.event)){
   return `<li><strong>${esc(h.event.replace('FIRST_SERVICE_','First service · '))}</strong> · ${esc(h.serviceId)}<br>${esc(h.by?.name||h.by?.uid)} · revision ${esc(h.revision)} · ${esc(h.at)}${h.approval?.uid?' · approver '+esc(h.approval.uid):''}${h.effectiveAt?' · effective '+esc(h.effectiveAt):''}</li>`;
  }
  if(h.event==='CATALOGUE_METADATA_EDITED'){
   const actor=h.by?.name||h.by?.uid||'Unavailable';
   const details=Object.entries(h.changes||{}).map(([field,change])=>
    esc(field)+': '+esc(change.before??'—')+' → '+esc(change.after??'—')).join('<br>');
   return `<li><strong>Catalogue metadata edited</strong> · ${esc(h.serviceId)}<br>Edited by ${esc(actor)} · ${esc(h.at)}<br>${details}</li>`;
  }
  return `<li><strong>${esc(h.event)}</strong> · ${esc(h.draftId)} · ${esc(h.outcome)}<br>${esc(h.reason)} · approver ${esc(h.approval?.by?.name||h.approval?.by?.uid||'recorded previously')} · ${esc(h.at)}<br>${(h.rows||[]).map(r=>esc(r.name||r.id)+': '+money(r.beforeMinor)+' → '+money(r.afterMinor)).join('<br>')}${h.effectiveAt?' · effective '+esc(h.effectiveAt):''}</li>`;
 }
 function renderPrices(){if(!q('mpScope'))return;const rituals=new Map();for(const s of catalogue)rituals.set(s.department+' / '+s.ritualGroup,{type:'ritual',department:s.department,value:s.ritualGroup});const scope=q('mpScope').value;const groups=new Map();for(const s of catalogue)groups.set(key(s),{type:'category',department:s.department,ritualGroup:s.ritualGroup,value:s.category});q('mpScope').innerHTML='<optgroup label="Individual treatments">'+catalogue.map(s=>`<option value="${esc(JSON.stringify({type:'service',value:s.id}))}">${esc(s.serviceName)} · ${esc(s.department)}</option>`).join('')+'</optgroup><optgroup label="Approved hierarchy groups">'+[...groups].map(([label,scope])=>`<option value="${esc(JSON.stringify(scope))}">${esc(label)}</option>`).join('')+'</optgroup><optgroup label="Ritual groups">'+[...rituals].map(([label,scope])=>`<option value="${esc(JSON.stringify(scope))}">${esc(label)}</option>`).join('')+'</optgroup><option value="set">Selected composer treatment set</option>';if(scope&&(scope!=='set'||selection.length))q('mpScope').value=scope;const s=manager?.snapshot();q('mpPublished').textContent=s?`${pricingStale?'Published menu changed; reset this private workspace before creating another price proposal.':'Published '+(provider?.mode==='persistent'?'server':'local')+' revision '+s.revision+'. Drafts and scheduled prices are excluded from this catalogue.'}`:'Published menu unavailable.';q('mpDrafts').innerHTML=s?Object.values(s.drafts).map(d=>`<option value="${esc(d.id)}">${esc(d.id)} · ${d.status} · ${esc(d.reason)}</option>`).join(''):'';q('mpHistory').innerHTML=s?.history.length?s.history.slice().reverse().map(renderHistoryEvent).join(''):'<li>No price publication has occurred.</li>';q('mpVersions').innerHTML=s?s.history.filter(h=>h.event==='PUBLISHED').map(h=>`<option value="${h.revision-1}">Undo publication ${h.revision} for its affected services</option>`).join(''):'';if(provider?.mode==='persistent'){q('mpAuthority').textContent='Persistent server workspace · authenticated authority checked for every operation. Publication writes only the existing menu source.';q('mpPersistence').textContent='Private drafts, approvals, receipts and history are restored from the protected server workspace on reload.';}else if(provider?.mode==='synthetic')q('mpAuthority').textContent=`LOCAL SYNTHETIC PREVIEW · ${actor?.name||actor?.uid}. No live catalogue, booking, payment or Firebase writes.`;else q('mpAuthority').textContent='Private local drafts only. Live business-price publisher, protected storage, Client synchronization and activation worker are not connected. No live publication is possible.';}
 function scope(){const value=q('mpScope').value;if(value==='set'){review();return {type:'set',ids:selection.map(x=>x.id)};}return JSON.parse(value);}
 function preview(){if(pricingStale)throw Error('Published menu changed. Reset the private workspace before creating another proposal.');if(!manager)throw Error('Published menu is unavailable.');const rows=manager.preview(scope(),q('mpAdjustment').value,q('mpAmount').value);q('mpPreview').innerHTML='<table><thead><tr><th>Treatment</th><th>Current</th><th>Proposed</th><th>Duration unchanged</th></tr></thead><tbody>'+rows.map(r=>`<tr><td>${esc(r.name)}</td><td>${money(r.beforeMinor)}</td><td>${money(r.afterMinor)}</td><td>${r.duration} min</td></tr>`).join('')+'</tbody></table>';return rows;}

 async function action(name){const valid=guard();if(pricingStale)throw Error('Published menu changed. Reset the private workspace before creating another proposal.');if(!manager)throw Error('Published menu is unavailable.');actor=provider?.actor||actor;let result;if(name==='preview')return preview();if(name==='draft'){preview();result=await manager.draft(actor,{draftId:(provider?.mode==='persistent'?'price-draft-'+root.crypto.randomUUID():'price-draft-'+(++serial)),scope:scope(),mode:q('mpAdjustment').value,value:q('mpAmount').value,reason:q('mpReason').value});}else if(name==='approve')result=await manager.approve(actor,q('mpDrafts').value);else if(name==='publish')result=await manager.publish(actor,q('mpDrafts').value,{requestId:'publication-'+q('mpDrafts').value,effectiveAt:q('mpTiming').value==='scheduled'?q('mpEffective').value:null});else if(name==='activate')result=await manager.activateDue(actor);else if(name==='rollback')result=await manager.rollbackDraft(actor,{draftId:(provider?.mode==='persistent'?'price-rollback-'+root.crypto.randomUUID():'price-rollback-'+(++serial)),targetRevision:Number(q('mpVersions').value),reason:q('mpReason').value});if(!valid())throw Error('Session changed; reconcile the existing publication request.');if(provider?.onPublishedChange)provider.onPublishedChange(manager.snapshot());catalogue=getCatalogue();renderPrices();if(result?.id)q('mpDrafts').value=result.id;else if(result?.draftId)q('mpDrafts').value=result.draftId;renderComposer();message(Array.isArray(result)?(result.length?JSON.stringify(result):'Nothing is due. Published menu unchanged.'):`${result.status||'Complete'} · ${result.id||result.draftId||''}`);return result;}
 function mountFirstPublication(box){
  const panel=doc.createElement('section');
  panel.innerHTML='<h3>First service publication</h3><label>Saved draft<select data-first-draft></select></label><p data-first-review></p><label>Ghana effective time (optional)<input type="datetime-local" data-first-time></label><button type="button" data-first="reload">Refresh drafts</button><button type="button" data-first="approveFirstDraft">Approve selected draft</button><button type="button" data-first="publishFirstDraft">Publish or schedule selected draft</button><button type="button" data-first="edit">Edit selected draft</button><button type="button" data-first="returnFirstDraft">Return scheduled draft to editing</button><button type="button" data-first="activateFirstDraft">Activate selected due draft</button><label>Pending request<select data-first-pending></select></label><button type="button" data-first="check">Check saved request</button><button type="button" data-first="resumeWorker">Resume saved activation</button><p role="status"></p>';
  box.appendChild(panel);
  const list=panel.querySelector('[data-first-draft]'),status=panel.querySelector('[role="status"]');
  const review=panel.querySelector('[data-first-review]');
  let snapshot;
  function selectedDraft(){
   return snapshot?.firstServiceDrafts?.find(row=>row.serviceId===list.value);
  }
  list.addEventListener('change',()=>{
   time.value='';
   const draft=selectedDraft();
   if(!draft){review.textContent='';return;}
   const service=draft.service;
   review.textContent=[
    service.serviceName,'ID '+draft.serviceId,'version '+draft.version,
    'GHS '+service.price,'duration '+service.duration+' min',
    service.department,service.ritualGroup,service.category,service.serviceType,draft.status,
    draft.effectiveAt?'Effective '+draft.effectiveAt:'No effective time recorded'
   ].filter(Boolean).join(' · ');
  });
  const pending=panel.querySelector('[data-first-pending]'),time=panel.querySelector('[data-first-time]');
  root.ThurayaSessionResources?.onStop?.('first-publication-panel',()=>{
   snapshot=null;list.replaceChildren();pending.replaceChildren();time.value='';review.textContent='';status.textContent='';
  });
  function showPending(api){
   pending.replaceChildren(...[...new Set([...(api.pendingFirst?.()||[]),...(root.ThurayaFirstActivationWorker?.pending?.()||[])])].map(id=>{const option=doc.createElement('option');option.value=id;option.textContent=id;return option;}));
  }
  function show(next){
   snapshot=next;time.value='';review.textContent='';
   if(Array.isArray(snapshot?.history))q('mpHistory').innerHTML=snapshot.history.slice().reverse().map(renderHistoryEvent).join('');
   list.replaceChildren(...(snapshot?.firstServiceDrafts||[]).map(d=>{
    const option=doc.createElement('option');option.value=d.serviceId;option.textContent=d.service.serviceName+' · '+d.status;return option;
   }));
   list.selectedIndex=-1;
  }
  panel.addEventListener('click',async event=>{
   const button=event.target.closest('[data-first]');
   if(!button)return;
   button.disabled=true;const token=generation;
   try{
    const api=root.ThurayaCatalogueMetadata,action=button.dataset.first;
    if(!api)throw Error('Controlled catalogue drafting is unavailable.');
    if(action==='reload'){showPending(api);const fresh=await api.firstWorkspace();if(token!==generation)return;show(fresh);status.textContent='Drafts refreshed.';return;}
    if(action==='resumeWorker'){const id=pending.value||list.value;if(!root.ThurayaFirstActivationWorker?.pending?.().includes(id))throw Error('Select a saved worker activation.');if(!root.confirm('Resume the original saved activation? If it has not committed and is now due, this may publish that exact draft.'))return;const reply=await root.ThurayaFirstActivationWorker.resume(id);if(token!==generation)return;if(reply.snapshot)show(reply.snapshot);showPending(api);status.textContent='Original activation outcome: '+reply.result.status+(reply.result.currentPostimagesMatch===false?' Current contents have since changed.':'');return;}
    if(action==='check'){
     const id=pending.value||list.value;if(!id)throw Error('Select a saved request.');
     const reply=await (root.ThurayaFirstActivationWorker?.pending?.().includes(id)?root.ThurayaFirstActivationWorker.reconcile(id):api.reconcileFirst(id));if(token!==generation)return;
     const current=reply.snapshot?.firstServiceDrafts?.find(row=>row.serviceId===reply.result.serviceId);
     const known=reply.result.status==='UNKNOWN'?'Request outcome unconfirmed.':'Recorded request outcome: '+reply.result.status+'.';
     const present=current?' Current workspace state: '+current.status+'.':' Current service state unavailable in this response.';
     const ownership=reply.result.currentPostimagesMatch===false?' Recorded document contents have since changed.':'';
     if(reply.snapshot)show(reply.snapshot);
     showPending(api);status.textContent=known+present+ownership;return;
    }
    const draft=selectedDraft();
    if(!draft||!review.textContent)throw Error('Select a saved draft.');
    if(action==='edit'){root.thOpenPrivateCatalogueDraft(draft,snapshot.sourceFingerprint);snapshot=null;list.selectedIndex=-1;review.textContent='';time.value='';return;}
    if(action==='activateFirstDraft'&&draft.status!=='SCHEDULED')throw Error('Select an approved scheduled draft for the protected worker.');
    if(!root.confirm(action==='activateFirstDraft'?'Ask the designated worker to activate this exact due draft?':action==='approveFirstDraft'?'Approve this exact draft?':action==='returnFirstDraft'?'Return this schedule to draft and clear approval?':'Publish this approved draft at the selected time?'))return;
    const input={serviceId:draft.serviceId,expectedVersion:draft.version,expectedFingerprint:snapshot.sourceFingerprint};
    if(action==='publishFirstDraft')input.effectiveAt=panel.querySelector('[data-first-time]').value||null;
    const reply=await (action==='activateFirstDraft'?root.ThurayaFirstActivationWorker.activate(input):api.firstOperation(action,input));
    if(token!==generation)return;
    if(reply.snapshot)show(reply.snapshot);
    showPending(api);
    status.textContent=reply.result.status==='UNKNOWN'?'Request outcome unconfirmed.':'Recorded request outcome: '+reply.result.status;
   }catch(error){if(token===generation)status.textContent=error.message;}
   finally{button.disabled=false;}
  });
 }
 function mount(){if(!core||!q('menuSettingsView')||q('mpWorkspace'))return;const box=doc.createElement('section');box.id='mpWorkspace';box.className='mp-workspace';box.innerHTML=`<header><p class="mp-eyebrow">MENU BUILDER & CONTROLLED PRICE PUBLISHING</p><h2>Prepare the experience. Publish with control.</h2><p id="mpAuthority"></p></header><div class="mp-columns"><section><h3>Guided Treatment Composer</h3><p>Reuse the published Menu_Settings_V2 catalogue and existing New Booking.</p><div class="mp-controls"><label>Selection mode<select id="mpMode"><option value="guided">Guided Treatment Composer</option><option value="quick">Quick Selection</option></select></label><label id="mpFoundationWrap">Foundation<select id="mpFoundation"></select></label></div><div id="mpServices"></div><p id="mpComposition" role="status"></p><div class="mp-actions"><button type="button" data-mp-action="review">Review selection</button><button type="button" data-mp-action="booking">Open New Booking</button></div></section><section><h3>Price Adjustment Manager</h3><p id="mpPublished"></p><div class="mp-controls"><label>Scope<select id="mpScope"></select></label><label>Adjustment<select id="mpAdjustment"><option value="percent">Percentage increase / decrease</option><option value="fixed">Fixed GHS increase / decrease</option><option value="exact">Exact new GHS price</option></select></label><label>Value (negative reduces)<input id="mpAmount" value="0" inputmode="decimal"></label><label>Reason<input id="mpReason" placeholder="Required for approval and history"></label></div><div class="mp-actions"><button type="button" data-mp-action="preview">Preview prices</button><button type="button" data-mp-action="draft">Save private draft</button></div><div id="mpPreview"></div><hr><label>Draft<select id="mpDrafts"></select></label><div class="mp-controls"><label>Publication<select id="mpTiming"><option value="immediate">Immediately after approval</option><option value="scheduled">Scheduled Ghana time</option></select></label><label>Ghana effective date / time<input id="mpEffective" type="datetime-local"></label></div><div class="mp-actions"><button type="button" data-mp-action="approve">Approve draft</button><button type="button" data-mp-action="publish">Publish / schedule</button><button type="button" data-mp-action="activate">Check due publications</button></div><hr><label>Controlled correction<select id="mpVersions"></select></label><button type="button" data-mp-action="rollback">Prepare rollback draft</button><h4>Append-only publication history</h4><ol id="mpHistory"></ol></section></div><p id="mpMessage" role="status" aria-live="polite"></p><button type="button" data-mp-action="reload">Reload published menu</button><button type="button" data-mp-action="reset">Reset private workspace</button><p id="mpPersistence" style="margin:20px">Local drafts are held only in this tab. Reloading the page discards them. Live storage is not connected.</p>`;q('menuSettingsView').prepend(box);mountFirstPublication(box);box.addEventListener('click',e=>{const button=e.target.closest('[data-mp-action]');if(!button)return;const name=button.dataset.mpAction,token=generation;Promise.resolve().then(()=>name==='review'?review():name==='booking'?openBooking():name==='reload'?(provider?.manager.refresh?provider.manager.refresh().then(()=>{reload();message('Persistent workspace refreshed.');}):reload()):name==='reset'?(provider?message('The synthetic preview can be reset by reloading the page.'):(manager=null,pricingStale=false,reload(),message('Private local workspace reset.'))):action(name)).catch(e=>{if(token===generation)message(({BUSINESS_PRICE_AUTHORITY_REQUIRED:'A verified business price publisher is required. Technical Admin access does not grant price authority.',APPROVAL_REQUIRED:'Approve this exact draft before publishing.',DRAFT_ID_AND_REASON_REQUIRED:'Add a reason for the price proposal.',PUBLISHED_MENU_CHANGED:'Published prices changed. Prepare a new draft from the current version.'})[e.message]||e.message,true);});});q('mpMode').addEventListener('change',renderComposer);q('mpFoundation').addEventListener('change',renderComposer);reload();}
 root.ThurayaSessionResources?.onStop?.('menu-builder-pricing',()=>{generation++;provider?.stop?.();root.thurayaMenuPricingBookingQuote=null;sourceFingerprint='';pricingStale=false;provider=null;manager=null;actor=null;catalogue=[];selection=[];selectionQuote=null;for(const id of ['mpDrafts','mpHistory','mpServices','mpPreview','mpVersions','mpScope','mpFoundation'])q(id)?.replaceChildren();if(q('mpReason'))q('mpReason').value='';if(q('mpComposition'))q('mpComposition').textContent='';if(q('mpPublished'))q('mpPublished').textContent='Session ended. Private local workspace cleared.';if(q('mpMessage'))q('mpMessage').textContent='';if(q('mpAuthority'))q('mpAuthority').textContent='No verified business-price publisher.';});
 root.ThurayaMenuBuilderUI=Object.freeze({mount,configure,reload,review,openBooking,action,getManager:()=>manager});
 async function connectExisting(user){if(!user||!root.ThurayaMenuPricingTransport)return;const token=generation,p=root.ThurayaMenuPricingTransport.firebaseProvider(user);try{await p.connect();if(token!==generation){p.stop();return;}configure(p);}catch(e){p.stop();if(token===generation&&q('mpMessage'))message('Persistent price service is unavailable or this session has no business price authority. Private local preview remains available.',true);}}
 if(root.firebase?.auth){root.firebase.auth().onAuthStateChanged(user=>{if(user)connectExisting(user);});}
 if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',mount);else mount();doc.addEventListener('thuraya:menu-v2-updated',()=>{if(!provider)reload();});
})(typeof window!=='undefined'?window:globalThis);

