/* Reviewed, prospective group appointment changes. Financial builders and
 * scheduling policy are the existing Staff App authorities. No payment actions. */
(function(root, factory){
    const api = factory(root);
    if (typeof module === 'object' && module.exports) module.exports = api;
    else { root.ThurayaGroupAppointmentReview = api; api.install(); }
})(typeof window === 'object' ? window : globalThis, function(root){
    'use strict';
    const norm = v => String(v || '').trim().toLowerCase();
    const clone = v => JSON.parse(JSON.stringify(v));
    const fail = message => { throw new Error(message); };
    const present = v => v !== undefined && v !== null && v !== false && v !== '' && v !== 0 &&
        !(Array.isArray(v) && !v.length);
    function stable(value){
        if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
        if (Array.isArray(value)) return value.map(stable);
        if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
        return value;
    }
    const signature = value => JSON.stringify(stable(value));
    const LEGACY_CONTROL='group_review_safe_20261112',LEGACY_RELEASE_TAG='GROUP_REVIEW_SAFE_20261112_V1';
    function isGroup(row){ return !!(row && (row.isGroupBooking === true || row.groupId || Number(row.groupSize) > 1)); }
    function requireProspective(row){
        if (!['scheduled','action required'].includes(norm(row.status))) fail('This member has entered treatment or is terminal. Use the existing treatment or financial review workflow.');
        if (row.archived === true || row.isArchived === true || row.archiveBatchId) fail('Archived appointments cannot be changed.');
        const empty = v => v == null || v === false || v === '' || v === 0 || (typeof v === 'string' && /^0(?:\.0+)?$/.test(v.trim())) || (Array.isArray(v) && !v.length);
        const financial = /payment|paid|settle|checkout|receipt|refund|gift|deposit|credit|promo|discount|adjust|complimentary|voucher|package|prepaid|redeem|redemption|balance|waiv|override|approvalAudit/i;
        function inspect(record){for(const [key,value] of Object.entries(record || {})){
            if(empty(value))continue;
            if(key==='paymentStatus'&&['unpaid','pending_or_paid_by_booker','pending_or_paid_by_lead'].includes(norm(value)))continue;
            if(['paymentResponsibility','groupPaymentMode','groupPaymentLabel'].includes(key))continue;
            if(key==='groupReviewHistory')continue; // Immutable history is not new settlement evidence.
            if(financial.test(key))fail('Existing payment, adjustment or receipt evidence requires its financial review workflow.');
            if(Array.isArray(value))value.forEach(x=>{if(x&&typeof x==='object')inspect(x);});else if(value&&typeof value==='object')inspect(value);
        }}
        inspect(row);
        if (row.serviceStatus && !['scheduled','action required'].includes(norm(row.serviceStatus))) fail('This member has entered treatment.');
        if (row.hasPromoApplied || row.isPackageRedemption || row.hasComplimentaryAdjustment || row.complimentaryTotalsApplied ||
            Number(row.adjustmentTotal) || Number(row.discountAmount) || (Array.isArray(row.adjustments) && row.adjustments.length)) fail('Adjusted bookings require their existing financial review workflow.');
    }
    function create(helpers){
        function mode(row){
            const result = helpers.thNormalizeGroupPaymentResponsibility(row).billingMode;
            if (!['lead_pays_all','lead_pays_all_after_last','each_pays_own','split_equally','subgroup_pays_separately'].includes(result)) fail('The historical group payer arrangement is incomplete. No payer was guessed.');
            return result;
        }
        function canonical(row, items){
            const policy = helpers.thTransactionTaxPolicy(row);
            if (!Array.isArray(items) || !items.length || items.some(x => !x || !x.menuItemId ||
                !Number.isSafeInteger(Number(x.quantity ?? x.qty)) || Number(x.quantity ?? x.qty) < 1 ||
                !Number.isFinite(Number(x.unitPriceAtBooking ?? x.unitPrice ?? x.price)) || Number(x.unitPriceAtBooking ?? x.unitPrice ?? x.price) < 0 ||
                !Number.isSafeInteger(Number(x.durationAtBooking ?? x.duration)) || Number(x.durationAtBooking ?? x.duration) <= 0)) fail('Valid itemized service prices and durations are required.');
            const rows = items.map(({_groupReviewAdded,...x}) => ({ ...x, quantity:Number(x.quantity ?? x.qty), qty:Number(x.quantity ?? x.qty),
                unitPriceAtBooking:Number(x.unitPriceAtBooking ?? x.unitPrice ?? x.price), durationAtBooking:Number(x.durationAtBooking ?? x.duration), priceMode:policy.pricingMode }));
            const built = helpers.thBuildCanonicalFinancialShape({ serviceLineItems:rows, pricingMode:policy.pricingMode, taxRates:policy.rates,
                compatibility:{ includeMemberTotals:true, includePayableShare:true } });
            return { ...built, amountDueByMember:built.amountDue, bookedService:rows.map(x => (x.serviceName || x.name) + (x.quantity > 1 ? ' (x' + x.quantity + ')' : '')).join(', '),
                bookedDuration:String(rows.reduce((n,x) => n + x.quantity * x.durationAtBooking, 0)),
                taxBreakdown:JSON.stringify(built.taxBreakdown), financialPolicySnapshot:row.financialPolicySnapshot || policy };
        }
        function snapshot(row){
            return { ...helpers.thCopyFinancialEvidence(row), dateString:row.dateString || '', timeString:row.timeString || '',
                assignedTechEmail:row.assignedTechEmail || '', assignedTechName:row.assignedTechName || '',
                bookedService:row.bookedService || '', bookedDuration:row.bookedDuration || '', serviceLineItems:clone(row.serviceLineItems || []), status:row.status };
        }
        function plan(records, targetId, command, draft){
            const leadFlag=row=>row.groupRole==='lead'||row.isLeadBooker===true||row.isGroupLead===true||Number(row.groupMemberIndex)===0;
            const rows = records.slice().sort((a,b) => Number(leadFlag(b))-Number(leadFlag(a)) || Number(a.groupMemberIndex ?? 1000) - Number(b.groupMemberIndex ?? 1000) || a.id.localeCompare(b.id));
            const target = rows.find(x => x.id === targetId);
            if (!target || !target.groupId || rows.some(x => x.groupId !== target.groupId) || new Set(rows.map(x => x.id)).size !== rows.length || rows.length > 100) fail('The complete linked group could not be verified.');
            if (!['edit_member','cancel_member','cancel_group'].includes(command)) fail('Choose an explicit review action.');
            if (!draft || !String(draft.reason || '').trim()) fail('Enter a review reason before confirming.');
            const active = rows.filter(x => !['cancelled','canceled'].includes(norm(x.status)));
            active.forEach(requireProspective);
            for(const row of active){const evidence=helpers.thFinancialEvidence.read(row);if(!evidence.available||evidence.finalGross===null||evidence.due===null||evidence.due<0||evidence.contradictions.length)fail('Original group financial snapshots are incomplete or conflicting.');}
            const originalGross=helpers.thFinancialEvidence.sumMoney(active.map(row=>helpers.thFinancialEvidence.read(row).finalGross));
            const originalDue=helpers.thFinancialEvidence.sumMoney(active.map(row=>helpers.thFinancialEvidence.read(row).due));
            if(Math.abs(originalGross-originalDue)>0.001)fail('Original group payer allocations do not reconcile.');
            if (!active.some(x => x.id === targetId)) fail('The selected appointment is already cancelled.');
            const paymentMode = mode(target);
            if (active.some(x => mode(x) !== paymentMode)) fail('Conflicting group payment responsibility requires financial review.');
            if(['each_pays_own','subgroup_pays_separately'].includes(paymentMode)&&active.some(row=>Math.abs(helpers.thFinancialEvidence.read(row).due-helpers.thFinancialEvidence.read(row).finalGross)>0.001))fail('Original own-service allocations do not match payment responsibility.');
            if(paymentMode==='split_equally'){
                const cents=Math.round(originalGross*100),base=Math.floor(cents/active.length);
                if(active.some(row=>![base,base+1].includes(Math.round(helpers.thFinancialEvidence.read(row).due*100))))fail('Original equal-share allocations require financial review.');
            }
            const updates = new Map();
            if (command === 'edit_member') {
                if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.dateString || '') || !/^\d{2}:\d{2}$/.test(draft.timeString || '') || !draft.assignedTechEmail) fail('Choose technician, date and exact time.');
                const changed = signature(draft.serviceLineItems) !== signature(target.serviceLineItems);
                const financial = changed ? canonical(target, draft.serviceLineItems) : {};
                updates.set(target.id, { ...financial, dateString:draft.dateString, timeString:draft.timeString,
                    assignedTechEmail:draft.assignedTechEmail, assignedTechName:draft.assignedTechName || target.assignedTechName || '', status:target.status });
            } else for (const row of active.filter(x => command === 'cancel_group' || x.id === targetId)) updates.set(row.id, { status:'Cancelled' });
            const next = active.map(row => ({ ...row, ...(updates.get(row.id) || {}) })).filter(row => row.status !== 'Cancelled');
            const groupTotal = helpers.thFinancialEvidence.sumMoney(next.map(row => {
                const evidence = helpers.thFinancialEvidence.read(row);
                if (!evidence.available || evidence.finalGross === null || evidence.contradictions.length) fail('Stored group financial snapshots need review.');
                return evidence.finalGross;
            }));
            const leads=rows.filter(x => x.groupRole === 'lead' || x.isLeadBooker === true || x.isGroupLead === true || Number(x.groupMemberIndex) === 0 ||
                ['lead_pays','lead_booker','lead_booker_final_bill'].includes(norm(x.paymentResponsibility || x.payableBy)));
            const originalLead=leads.length===1?leads[0]:null;
            const leadMode = ['lead_pays_all','lead_pays_all_after_last'].includes(paymentMode);
            let payer;
            if (leadMode) {
                if(!originalLead)fail('The original lead payer is ambiguous. No payer was selected or replaced.');
                payer = target.groupPayer || rows.find(x => x.groupPayer)?.groupPayer;
                if (!payer) {
                    if (!originalLead || !originalLead.clientName || !(originalLead.clientId || originalLead.clientPhone || originalLead.leadClientId)) fail('The original lead payer identity is incomplete.');
                    payer = { version:1, groupId:target.groupId, appointmentId:originalLead.id,
                        clientId:originalLead.clientId || originalLead.leadClientId || '', clientName:originalLead.clientName,
                        clientPhone:originalLead.clientPhone || originalLead.leadClientPhone || '', clientEmail:originalLead.clientEmail || originalLead.email || '' };
                }
                if (payer.version !== 1 || payer.groupId !== target.groupId || !payer.appointmentId || !payer.clientName) fail('The stored original payer identity is invalid.');
                if(payer.appointmentId!==originalLead.id||payer.clientName!==originalLead.clientName||
                    (originalLead.clientId&&payer.clientId!==originalLead.clientId)||(originalLead.clientPhone&&payer.clientPhone!==originalLead.clientPhone))fail('The original payer snapshot does not match the preserved lead appointment.');
                if (rows.some(x => x.groupPayer && signature(x.groupPayer) !== signature(payer))) fail('Conflicting original payer identities require financial review.');
            }
            const previousCarriers=[...new Set(rows.map(x=>x.groupInvoiceCarrierAppointmentId).filter(Boolean))];
            if(leadMode&&previousCarriers.length>1)fail('Conflicting original invoice carriers require financial review.');
            const originalCarrier=leadMode&&(active.find(x=>x.id===payer.appointmentId)||active.find(x=>x.id===previousCarriers[0])||active.find(x=>helpers.thFinancialEvidence.read(x).due>0)||active[0]);
            if(leadMode&&active.some(row=>Math.abs(helpers.thFinancialEvidence.read(row).due-(row.id===originalCarrier.id?originalGross:0))>0.001))fail('Original lead-payer allocations require financial review.');
            const carrier = leadMode && (next.find(x => x.id === payer.appointmentId) || next.find(x=>x.id===originalCarrier.id) || next[0]);
            const shares = paymentMode === 'split_equally' && next.length ? helpers.thAllocateMoneyShares(groupTotal, next.length) : [];
            const retainAllocation=next.length===active.length&&Math.abs(groupTotal-originalGross)<0.001;
            next.forEach((row,i) => {
                const own = helpers.thFinancialEvidence.read(row).finalGross;
                const due = retainAllocation?helpers.thFinancialEvidence.read(active.find(x=>x.id===row.id)).due:leadMode ? row.id === carrier.id ? groupTotal : 0 : paymentMode === 'split_equally' ? shares[i] : own;
                const allocation = { groupTotal:String(groupTotal), amountDue:String(due), payableShare:String(due), amountDueByMember:String(due), totalGHC:String(due),
                    ...(payer ? { groupPayer:clone(payer), groupInvoiceCarrierAppointmentId:carrier.id } : {}) };
                const patch = { ...(updates.get(row.id) || {}) };
                for (const [key,value] of Object.entries(allocation)) if (signature(value) !== signature(row[key])) patch[key] = value;
                if (Object.keys(patch).length) updates.set(row.id, patch);
            });
            return { groupId:target.groupId, paymentMode, groupTotal, payer:payer || null, command, targetId,
                updates:[...updates].map(([id,patch]) => ({ id, patch, before:snapshot(rows.find(x => x.id === id)), after:snapshot({ ...rows.find(x => x.id === id), ...patch }) })) };
        }
        return { plan, canonical, snapshot };
    }
    const q = id => root.document.getElementById(id);
    const esc = v => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let context = null, saving = false;
    function database(){ return typeof db !== 'undefined' ? db : root.db; }
    function auth(){ return root.firebase.auth().currentUser; }
    async function authorize(){
        const user = auth(); if (!user?.email) fail('Sign in with your existing Staff account.');
        const snap = await database().collection('Users').doc(user.email.toLowerCase()).get({ source:'server' });
        const record = snap.exists && snap.data();
        const roles = record && (Array.isArray(record.roles) ? record.roles : [record.role]);
        if (!record || snap.metadata?.fromCache || record.active === false || record.disabled === true ||
            ['uid','authUid','loginUid'].some(key=>record[key]&&record[key]!==user.uid)||(record.email&&norm(record.email)!==norm(user.email))||
            ['inactive','disabled','archived','terminated'].includes(norm(record.status)) ||
            !roles.some(role => ['manager','admin','system admin','foh','front of house','test manager','test admin','test foh'].includes(norm(role)))) fail('Group review is restricted to authorized FOH, Manager and Admin staff.');
        return user.email.toLowerCase();
    }
    function requireSession(email){ if (norm(auth()?.email) !== email) fail('The Staff session changed. Reopen the review.'); }
    function requireManagedBooking(){
        const descriptor=Object.getOwnPropertyDescriptor(database(),'__thurayaAllocationProtocol'),protocol=descriptor?.value;
        if(descriptor?.writable!==false||descriptor?.configurable!==false||!Object.isFrozen(protocol)||protocol.version!==1||protocol.channel!=='staff'||protocol.endpoint!=='commitBookingAllocation')fail('The protected booking service is unavailable. No group change can be saved.');
    }
    function managedBooking(){
        if(!Object.getOwnPropertyDescriptor(database(),'__thurayaAllocationProtocol'))return false;
        requireManagedBooking();return true;
    }
    function checkLegacyGate(data){
        if(data?.version!==1||data.releaseTag!==LEGACY_RELEASE_TAG||data.enabled!==true)fail('Group review is temporarily unavailable. No changes were saved.');
        return true;
    }
    async function readLegacyGate(){
        const ref=database().collection('Settings').doc(LEGACY_CONTROL),snapshot=await ref.get({source:'server'});
        if(!snapshot.exists||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)fail('Group review availability could not be verified. No changes were saved.');
        checkLegacyGate(snapshot.data());return ref;
    }
    function requireLegacyFlatRecords(records){
        if(records.some(row=>row.members!=null||row.groupMembers!=null))fail('This historical group uses embedded member records and needs a controlled review. No changes were saved.');
    }
    function requireLegacyScope(plan,records){
        for(const update of plan.updates){
            const before=records.find(row=>row.id===update.id),after=update.after;
            if(!before||!after)fail('The exact reviewed group member could not be verified.');
            if(norm(after.status)==='cancelled')continue;
            if(after.dateString!==before.dateString||after.timeString!==before.timeString||norm(after.assignedTechEmail)!==norm(before.assignedTechEmail)||
                !Number.isSafeInteger(Number(before.bookedDuration))||!Number.isSafeInteger(Number(after.bookedDuration))||Number(after.bookedDuration)<=0||Number(after.bookedDuration)>Number(before.bookedDuration)){
                fail('This release keeps the existing technician, date and time. Service changes must fit within the existing appointment duration; a moved or longer appointment needs the full protected booking workflow.');
            }
        }
    }
    function docs(snapshot){ if (snapshot.metadata?.fromCache) fail('Fresh server evidence is required.'); const out=[]; snapshot.forEach(s => out.push({ id:s.id, ...s.data() })); return out; }
    async function loadGroup(id){
        const snap = await database().collection('Appointments').doc(id).get({ source:'server' });
        if (!snap.exists || snap.metadata?.fromCache) fail('Appointment could not be verified.');
        const row = { id:snap.id, ...snap.data() }; if (!isGroup(row)) return { individual:true, row };
        if (!row.groupId) fail('This historical group has no exact group link. No booking was changed.');
        return { row, records:docs(await database().collection('Appointments').where('groupId','==',row.groupId).get({ source:'server' })) };
    }
    async function linkedEvidence(records){
        const collection = database().collection('Active_Jobs'), refs = new Map();
        for (const row of records) {
            const ids = new Set([row.id]);
            for (const key of ['activeJobId','jobId','linkedJobId']) if (present(row[key])) {
                if (typeof row[key] !== 'string' || row[key].includes('/')) fail('Unknown treatment record reference.'); ids.add(row[key]);
            }
            for (const id of ids) {
                const ref=collection.doc(id), snap=await ref.get({ source:'server' }); refs.set(ref.path,ref);
                if (snap.metadata?.fromCache || snap.exists) fail('A linked treatment or checkout job exists. Use its existing reviewed workflow.');
            }
            for (const field of ['sourceAppointmentId','appointmentId','appointmentDocId','appointmentRef','bookingId']) {
                const found=await collection.where(field,'==',row.id).get({ source:'server' });
                if (found.metadata?.fromCache) fail('Fresh treatment evidence is required.');
                if (!found.empty && (found.size || docs(found).length)) fail('A linked treatment or checkout job exists. Use its existing reviewed workflow.');
            }
        }
        return [...refs.values()];
    }
    async function legacyBookingShadows(records){
        const snapshot=await database().collection('Bookings').limit(1).get({source:'server'});
        if(snapshot.metadata?.fromCache||docs(snapshot).length)fail('Separate booking records require a controlled linked-record review. No group changes were saved.');
        return [];
    }
    function techs(){ return typeof allTechs !== 'undefined' && Array.isArray(allTechs) ? allTechs : root.allTechs || []; }
    function draft(){ return { reason:q('thGroupReviewReason').value.trim(), serviceLineItems:context.items,
        dateString:q('thGroupReviewDate').value, timeString:q('thGroupReviewTime').value,
        assignedTechEmail:q('thGroupReviewTech').value, assignedTechName:techs().find(t => norm(t.email) === norm(q('thGroupReviewTech').value))?.name || '' }; }
    function message(value){ if(q('thGroupReviewMessage')) q('thGroupReviewMessage').textContent=value; }
    function renderItems(){
        q('thGroupReviewItems').innerHTML=context.items.map((x,i) => `<li>${esc(x.serviceName || x.name)} · GHC ${Number(x.unitPriceAtBooking ?? x.unitPrice ?? x.price).toFixed(2)} × <input aria-label="Quantity for ${esc(x.serviceName || x.name)}" type="number" min="1" max="20" value="${Number(x.quantity ?? x.qty)}" data-quantity="${i}" style="width:65px"> · ${Number(x.durationAtBooking ?? x.duration)} mins <button type="button" data-remove="${i}">Remove</button></li>`).join('');
        q('thGroupReviewItems').querySelectorAll('[data-remove]').forEach(button => button.onclick=()=>{context.items.splice(Number(button.dataset.remove),1); renderItems();});
        q('thGroupReviewItems').querySelectorAll('[data-quantity]').forEach(input => input.onchange=()=>{const row=context.items[Number(input.dataset.quantity)];row.quantity=Number(input.value);row.qty=Number(input.value);});
        q('thGroupReviewSummary').textContent='Review service and billing changes before confirming. Existing selected services retain their booked prices. Added services use the current published menu.';
    }
    function ensureModal(){
        let modal=q('thGroupAppointmentReview'); if(modal)return modal;
        modal=root.document.createElement('div'); modal.id='thGroupAppointmentReview';modal.setAttribute('role','dialog');modal.setAttribute('aria-modal','true');modal.setAttribute('aria-labelledby','thGroupReviewTitle');
        modal.style.cssText='position:fixed;inset:0;background:#0008;z-index:11000;display:none;align-items:center;justify-content:center;padding:12px;box-sizing:border-box';
        modal.innerHTML=`<div style="background:white;color:#111;border-radius:14px;padding:20px;width:min(850px,100%);max-height:90vh;overflow:auto;box-sizing:border-box"><h2 id="thGroupReviewTitle">Reviewed Group Appointment</h2><p id="thGroupReviewContext"></p><label>Action <select id="thGroupReviewAction"><option value="edit_member">Edit selected member</option><option value="cancel_member">Cancel selected member only</option><option value="cancel_group">Cancel entire group</option></select></label><div id="thGroupReviewEdit"><ul id="thGroupReviewItems" style="padding-left:18px"></ul><label>Add or substitute service <select id="thGroupReviewMenu" style="max-width:100%"></select></label><button type="button" id="thGroupReviewAdd">Add service</button><div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:15px"><label>Date <input id="thGroupReviewDate" type="date"></label><label>Time <input id="thGroupReviewTime" type="time" step="900"></label><label>Technician <select id="thGroupReviewTech"></select></label></div></div><p id="thGroupReviewSummary"></p><label style="display:block">Review reason <textarea id="thGroupReviewReason" required maxlength="1000" style="display:block;width:100%;box-sizing:border-box"></textarea></label><div id="thGroupReviewMessage" role="status" style="white-space:pre-wrap;margin:12px 0"></div><button type="button" id="thGroupReviewPreview">Review changes</button> <button type="button" id="thGroupReviewSave" disabled>Confirm reviewed changes</button> <button type="button" id="thGroupReviewClose">Close</button></div>`;
        root.document.body.appendChild(modal);
        q('thGroupReviewClose').onclick=()=>{if(!saving){modal.style.display='none';context=null;}};
        q('thGroupReviewAction').onchange=()=>{q('thGroupReviewEdit').hidden=q('thGroupReviewAction').value!=='edit_member';q('thGroupReviewSave').disabled=true;message('Review the exact scope before confirming.');};
        q('thGroupReviewAdd').onclick=()=>{const item=context.menu.find(x=>x.id===q('thGroupReviewMenu').value); if(!item)return;context.items.push({ menuItemId:item.id,serviceId:item.id,name:item.serviceName||item.name,serviceName:item.serviceName||item.name,unitPriceAtBooking:Number(item.price),durationAtBooking:Number(item.duration),quantity:1,qty:1,source:'Menu_Settings_V2',_groupReviewAdded:true });renderItems();};
        modal.addEventListener('input',()=>{q('thGroupReviewSave').disabled=true;context && (context.reviewed=null);});
        modal.addEventListener('click',event=>{if(event.target.closest('[data-remove],#thGroupReviewAdd')){q('thGroupReviewSave').disabled=true;context.reviewed=null;}});
        q('thGroupReviewPreview').onclick=()=>{try{const plan=create(root).plan(context.records,context.id,q('thGroupReviewAction').value,draft());if(!managedBooking())requireLegacyScope(plan,context.records);context.reviewed=signature({command:plan.command,draft:draft()});message((plan.command==='cancel_group'?'CANCEL ENTIRE GROUP\n':'')+plan.updates.map(x=>`${context.records.find(r=>r.id===x.id)?.clientName||x.id}${x.id===context.id?' (selected)':''}: ${x.before.status} → ${x.after.status}; services GHC ${x.before.grandTotal} → ${x.after.grandTotal}; payable GHC ${x.before.amountDue} → ${x.after.amountDue}`).join('\n')+`\nGroup payable total: GHC ${plan.groupTotal.toFixed(2)}${plan.payer?'\nOriginal payer remains '+plan.payer.clientName:''}`);q('thGroupReviewSave').disabled=false;}catch(e){message(e.message);}};
        q('thGroupReviewSave').onclick=save;
        return modal;
    }
    async function open(id,command='edit_member'){
        try{
            const actor=await authorize(), loaded=await loadGroup(id);requireSession(actor);
            if(loaded.individual)return root.__thOriginalGroupReviewV4?.(id);
            if(!managedBooking()){await readLegacyGate();requireLegacyFlatRecords(loaded.records);}
            loaded.records.filter(x=>!['cancelled','canceled'].includes(norm(x.status))).forEach(requireProspective);
            await linkedEvidence(loaded.records);requireSession(actor);
            const menu=docs(await database().collection('Menu_Settings_V2').get({source:'server'})).filter(x=>x.deleted!==true&&x.isActive!==false&&!['inactive','archived','deleted'].includes(norm(x.status))&&Number.isFinite(Number(x.price))&&Number(x.duration)>0);
            context={id,actor,records:loaded.records,items:clone(loaded.row.serviceLineItems||[]),menu,reviewed:null};
            const modal=ensureModal(); q('thGroupReviewContext').textContent=`${loaded.row.clientName || 'Selected member'} · Group ${loaded.row.groupId}. Only the selected member's services and schedule change. Shared billing allocations are reviewed together.`;
            q('thGroupReviewDate').value=loaded.row.dateString||'';q('thGroupReviewTime').value=loaded.row.timeString||'';
            q('thGroupReviewTech').innerHTML=techs().map(t=>`<option value="${esc(t.email)}">${esc(t.name)}</option>`).join('');q('thGroupReviewTech').value=loaded.row.assignedTechEmail||'';
            q('thGroupReviewMenu').innerHTML=menu.map(x=>`<option value="${esc(x.id)}">${esc(x.serviceName||x.name)} · GHC ${Number(x.price).toFixed(2)} · ${Number(x.duration)} mins</option>`).join('');
            q('thGroupReviewReason').value='';q('thGroupReviewReason').disabled=false;q('thGroupReviewPreview').disabled=false;q('thGroupReviewAction').disabled=false;q('thGroupReviewAction').value=command;q('thGroupReviewEdit').hidden=command!=='edit_member';q('thGroupReviewSave').disabled=true;message('');renderItems();
            const managed=managedBooking();for(const id of ['thGroupReviewDate','thGroupReviewTime','thGroupReviewTech'])q(id).disabled=!managed;
            if(!managed)q('thGroupReviewSummary').textContent='Keep the existing technician, date and time. Services may be added, removed or substituted only within the existing appointment duration. Longer or moved appointments require the full protected booking workflow.';
            modal.style.display='flex';q('thGroupReviewAction').focus();return true;
        }catch(e){root.alert(e.message);return{outcome:'blocked',message:e.message};}
    }
    async function validateSchedule(plan){
        if(plan.command!=='edit_member')return;
        const changed=plan.updates.find(x=>x.id===plan.targetId).after, policy=root.ThurayaSchedulePolicy;
        if(!policy||changed.dateString<policy.businessDate()||typeof root.thurayaValidateStaffScheduleAssignments!=='function'||typeof root.thurayaBuildAvailabilityBusyMap!=='function')fail('Working schedule and live availability must be verified.');
        const duration=Number(changed.bookedDuration);await root.thurayaValidateStaffScheduleAssignments([{techEmail:changed.assignedTechEmail,date:changed.dateString,time:changed.timeString,duration}]);
        const techSnap=await database().collection('Users').doc(changed.assignedTechEmail).get({source:'server'});
        if(!techSnap.exists||techSnap.metadata?.fromCache||typeof root.normalizeTherapyTypes!=='function')fail('Technician treatment eligibility could not be verified.');
        const therapies=root.normalizeTherapyTypes(techSnap.data());
        for(const item of changed.serviceLineItems){
            const menu=context.menu.find(x=>x.id===item.menuItemId),department=norm(menu?.department||menu?.appliesTo||item.department||item.appliesTo);
            const treatment=/^(hand|hands)$/.test(department)?'hand':/^(foot|feet)$/.test(department)?'foot':null;
            if(!treatment||!therapies.includes(treatment))fail('This technician is not eligible for every selected treatment.');
        }
        const busy=await root.thurayaBuildAvailabilityBusyMap(changed.dateString,{ignoreAppointmentId:plan.targetId});
        const start=policy.minutes(changed.timeString),end=start+duration,blocks=busy.get(norm(changed.assignedTechEmail))||[];
        if(blocks.some(([s,e])=>start<e&&end>s))fail('The exact technician slot is no longer available.');
    }
    async function save(){
        if(!context||saving)return;const current=context,command=q('thGroupReviewAction').value,selected=draft();
        if(current.reviewed!==signature({command,draft:selected})){message('Review the current changes before confirming.');return;}
        saving=true;q('thGroupReviewSave').disabled=true;
        try{
            const managed=managedBooking();
            const legacyControl=managed?null:await readLegacyGate();
            const actor=await authorize();requireSession(current.actor);if(actor!==current.actor)fail('The reviewing Staff identity changed.');
            const menus=docs(await database().collection('Menu_Settings_V2').get({source:'server'}));
            for(const item of selected.serviceLineItems.filter(x=>x._groupReviewAdded)){
                const fresh=menus.find(x=>x.id===item.menuItemId);
                if(!fresh||fresh.deleted===true||fresh.isActive===false||['inactive','archived','deleted'].includes(norm(fresh.status))||Number(fresh.price)!==Number(item.unitPriceAtBooking)||Number(fresh.duration)!==Number(item.durationAtBooking))fail('An added service price or duration changed. Close and reopen the reviewed edit.');
            }
            const linked=await linkedEvidence(current.records),shadows=managed?[]:await legacyBookingShadows(current.records),fresh=await loadGroup(current.id);
            if(signature(fresh.records)!==signature(current.records))fail('The group changed while being reviewed. Close and reopen it.');
            if(!managed)requireLegacyFlatRecords(fresh.records);
            const plan=create(root).plan(fresh.records,current.id,command,selected);if(!managed)requireLegacyScope(plan,fresh.records);await validateSchedule(plan);requireSession(actor);
            const requestId=Array.from(root.crypto.getRandomValues(new Uint8Array(16))).map(x=>x.toString(16).padStart(2,'0')).join(''),FieldValue=root.firebase.firestore.FieldValue;
            await database().runTransaction(async tx=>{
                if(legacyControl){const gate=await tx.get(legacyControl);if(!gate.exists)fail('Group review is temporarily unavailable.');checkLegacyGate(gate.data());}
                const records=[];
                for(const row of current.records){const snap=await tx.get(database().collection('Appointments').doc(row.id));if(!snap.exists)fail('A group member changed. Reopen the review.');records.push({id:snap.id,...snap.data()});}
                if(signature(records)!==signature(current.records))fail('The group changed while being saved. Reopen the review.');
                for(const ref of linked){const snap=await tx.get(ref);if(snap.exists)fail('A treatment job appeared. No group changes were saved.');}
                for(const ref of shadows){const snap=await tx.get(ref);if(snap.exists)fail('A separate booking record appeared. No group changes were saved.');}
                requireSession(actor);const verified=create(root).plan(records,current.id,command,selected);
                if(!managed){requireLegacyFlatRecords(records);requireLegacyScope(verified,records);}
                for(const update of verified.updates){
                    const cancelling=update.patch.status==='Cancelled';
                    tx.set(database().collection('Appointments').doc(update.id),{...update.patch,
                        ...(cancelling?{cancelledAt:FieldValue.serverTimestamp(),cancelledBy:actor,availabilityReleasedAt:FieldValue.serverTimestamp()}:{}),
                        groupReviewedAt:FieldValue.serverTimestamp(),groupReviewedBy:actor,updatedAt:FieldValue.serverTimestamp(),
                        ...(!managed?{groupReviewReleaseTag:LEGACY_RELEASE_TAG}:{}),
                        groupReviewHistory:{[requestId]:{version:1,command,targetAppointmentId:current.id,reason:selected.reason,actor,at:FieldValue.serverTimestamp(),before:update.before,after:update.after,payer:verified.payer}}},{merge:true});
                }
            });
            message(command==='edit_member'?'Reviewed group appointment saved. Close this review before another change.':'Reviewed cancellation saved. Unaffected members and financial history are retained. Close this review before another change.');current.reviewed=null;
            q('thGroupReviewPreview').disabled=true;q('thGroupReviewAction').disabled=true;q('thGroupReviewEdit').hidden=true;q('thGroupReviewReason').disabled=true;
            try{Promise.resolve(root.thLoadUpcomingEnterpriseCalendar?.()).catch(()=>{});Promise.resolve(root.generateTimeSlots?.()).catch(()=>{});}catch(e){}
            return{outcome:'saved',command};
        }catch(e){message('Review stopped; changes were not confirmed. '+e.message+' Close and reopen to verify the current booking before retrying.');return{outcome:'blocked',message:e.message};}
        finally{saving=false;}
    }
    function payerFor(job){return job?.groupPayer?.version===1&&job.groupPayer.groupId===job.groupId?job.groupPayer:null;}
    function install(){
        if(root.__TH_GROUP_APPOINTMENT_REVIEW__)return;root.__TH_GROUP_APPOINTMENT_REVIEW__=true;
        const original=root.thOpenExpectedTodayQuickEditV4;root.__thOriginalGroupReviewV4=original;
        const copy=root.thCopyFinancialEvidence;if(copy)root.thCopyFinancialEvidence=function(record){const result=copy(record);for(const key of ['groupPayer','groupInvoiceCarrierAppointmentId'])if(record?.[key]!==undefined)result[key]=clone(record[key]);return result;};
        const route=async id=>{try{const loaded=await loadGroup(id);return isGroup(loaded.row)?open(id):original?.(id);}catch(e){root.alert(e.message);}};
        for(const name of ['editAppointment','thOpenExpectedTodayQuickEdit','thOpenExpectedTodayQuickEditV4','thStaffQuickEditAppointment'])root[name]=route;
        const cancel=root.cancelAppointment;root.cancelAppointment=async id=>{try{const loaded=await loadGroup(id);return isGroup(loaded.row)?open(id,'cancel_member'):cancel?.(id);}catch(e){root.alert(e.message);}};
        const compute=root.gb_computeCheckoutPlan;
        if(compute)root.gb_computeCheckoutPlan=function(job,jobs){const plan=compute(job,jobs),payers=(jobs||[job]).map(payerFor).filter(Boolean),payer=payerFor(job)||payers[0];if(payer&&['group_lead_all','group_lead_final'].includes(plan.type)){if(payer.groupId!==job.groupId||payers.some(p=>signature(p)!==signature(payer)))fail('The original group payer identity is conflicting. Financial review is required.');plan.title=(plan.type==='group_lead_final'?'Final group bill — ':'Group checkout — ')+payer.clientName;plan.payer=clone(payer);}return plan;};
        const receipt=root.th_receiptPayloadFromJob;
        if(receipt)root.th_receiptPayloadFromJob=function(job){const payload=receipt.apply(this,arguments),payer=payerFor(job),mode=root.thNormalizeGroupPaymentResponsibility(job).billingMode;if(payer&&payload.isGroup&&['lead_pays_all','lead_pays_all_after_last'].includes(mode)){payload.clientName=payer.clientName;payload.clientEmail=payer.clientEmail||'';payload.clientPhone=payer.clientPhone||'';payload.phoneE164=payer.clientPhone||'';payload.payerClientId=payer.clientId||'';}return payload;};
    }
    return { create, isGroup, requireProspective, signature, payerFor, install, open, save, validateSchedule, authorize, requireManagedBooking, managedBooking, requireLegacyScope, checkLegacyGate, requireLegacyFlatRecords, LEGACY_CONTROL, LEGACY_RELEASE_TAG };
});
