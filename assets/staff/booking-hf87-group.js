/* ============================================================
   THURAYA STAFF — HF88D GROUP BOOKING POLISH
   Additive module. Does not touch the validated HF86 individual flow.
   Critical fix: group service selection uses the same Menu_Settings_V2 hierarchy/UI pattern
   as individual booking. No Most Popular or custom group menu filters.
   ============================================================ */
(function(){
  if (window.__THURAYA_HF87_GROUP_MODULE__) return;
  window.__THURAYA_HF87_GROUP_MODULE__ = true;

  const VERSION = 'HF89A · Staff Menu Consumer Audit';
  const ANY = '__ANY_AVAILABLE_TECH__';
  const session = window.ThurayaSessionResources;
  const q = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = v => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g,'')); return Number.isFinite(n) ? n : 0; };
  const nint = (v, fb=0) => { const n = parseInt(v,10); return Number.isFinite(n) ? n : fb; };
  const money = v => { const amount = window.thFinancialEvidence.amount(v); return amount === null ? 'Unavailable' : amount.toFixed(2); };
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };

  const state = window.THURAYA_HF87_GROUP = {
    step: 1,
    activeMember: 0,
    lead: null,
    members: [{ name:'Lead Client', phone:'', services:{} }, { name:'Member 2', phone:'', services:{} }],
    date: '',
    time: '',
    techMode: ANY,
    flexibility: 15,
    timingMode: 'simultaneous',
    paymentMode: 'lead',
    assignments: [],
    menuServices: [],
    menuLoading: false,
    serviceDept: 'Hand',
    slotSuggestions: [],
    slotLoading: false,
    serviceSearch: '',
    saving: false
  };
  let searchRequestId = 0;
  let searchTimer = 0;

  session.onStop('booking-group-state', () => {
    searchRequestId++;
    searchTimer = 0;
    reset();
    state.saving = false;
    state.menuServices = [];
    state.menuLoading = false;
    state.serviceSearch = '';
    delete state.menuLoadedAt;
    delete state.menuSource;
    window.THURAYA_HF87_LEAD_MATCHES = [];
    closeGroup();
    for (let i=1; i<=5; i++) { const pane = q('thHF87Pane'+i); if (pane) pane.innerHTML = ''; }
    const summary = q('thHF87Summary'); if (summary) summary.innerHTML = '';
  });

  function dbRef(){ return window.db || (window.firebase && firebase.firestore ? firebase.firestore() : null); }
  function techs(){ try { return Array.isArray(allTechs) ? allTechs : []; } catch(e){ return []; } }
  function clients(){ try { return Array.isArray(allClientsCache) ? allClientsCache : []; } catch(e){ return []; } }
  function taxes(){ try { return Array.isArray(liveTaxes) ? liveTaxes : []; } catch(e){ return []; } }

  function makeGroupId(){ if(!state._reviewGroupId)throw Error('Review this group before requesting its finite identity.');return state._reviewGroupId; }
  function toMins(t){ const [h,m]=String(t||'0:0').split(':').map(x=>parseInt(x,10)||0); return h*60+m; }
  function minsToTime(mins){ mins=((mins%1440)+1440)%1440; return `${String(Math.floor(mins/60)).padStart(2,'0')}:${String(mins%60).padStart(2,'0')}`; }
  function toLabel(t){ const [h,m]=String(t||'0:0').split(':').map(x=>parseInt(x,10)||0); const ampm=h>=12?'PM':'AM'; const hr=((h+11)%12)+1; return `${hr}:${String(m).padStart(2,'0')} ${ampm}`; }
  const DEFAULT_GROUP_WINDOW_START = 9 * 60;
  const DEFAULT_GROUP_WINDOW_END = 20 * 60;

  function parseWindowMins(value, fallback){
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2}):(\d{2})$/);
    if(!match) return fallback;
    const h = Number(match[1]);
    const m = Number(match[2]);
    if(!Number.isFinite(h) || !Number.isFinite(m) || h < 0 || h > 23 || m < 0 || m > 59) return fallback;
    return h * 60 + m;
  }

  async function groupBookingWindow(){
    let startMins = DEFAULT_GROUP_WINDOW_START;
    let endMins = DEFAULT_GROUP_WINDOW_END;
    try {
      const db = dbRef();
      if (db) {
        const doc = await db.collection('Settings').doc('operations_engine').get();
        const data = doc && doc.exists ? (doc.data() || {}) : {};
        startMins = parseWindowMins(data.bookingWindowStartTime, startMins);
        endMins = parseWindowMins(data.bookingWindowEndTime, endMins);
      }
    } catch(e) {
      console.warn('Group booking window settings unavailable', e);
    }
    if (startMins >= endMins) return { startMins: DEFAULT_GROUP_WINDOW_START, endMins: DEFAULT_GROUP_WINDOW_END };
    return { startMins, endMins };
  }

  function normalizeInputType(value){
    const t = String(value || 'radio').trim().toLowerCase();
    if (['counter','quantity','qty','number','numeric','per unit','per-unit','unit'].some(x=>t.includes(x))) return 'counter';
    if (['checkbox','multi','multiple','add-on','addon'].some(x=>t.includes(x))) return 'checkbox';
    return 'radio';
  }


  // HF88F: Group service menu must follow the same approved Menu_Settings_V2
  // priority order used by Individual Booking. Do not introduce group-only filters.
  const HAND_RITUAL_PRIORITY = [
    'Hand Therapies',
    'Finishing Indulgences',
    'Nail Architecture',
    'Polish & Finish',
    'The Pleiades Studio',
    'Editorial Nail Art',
    'Couture Nail Art',
    'Embellishment Drawers'
  ];
  const FOOT_RITUAL_PRIORITY = [
    'Foundation Rituals',
    'Urban Express Rituals',
    'The Medi-Cleanse Series',
    'Finishing Indulgences',
    'Polish & Finish',
    'Editorial Nail Art'
  ];
  function normKey(v){
    return String(v || '').toLowerCase().replace(/&/g,'and').replace(/[^a-z0-9]+/g,' ').trim();
  }
  function priorityIndex(name, list){
    const key = normKey(name);
    const idx = list.findIndex(item => {
      const itemKey = normKey(item);
      return key === itemKey || key.includes(itemKey) || itemKey.includes(key);
    });
    return idx >= 0 ? idx : 999;
  }
  function ritualPriority(name, dept){
    return dept === 'Foot' ? priorityIndex(name, FOOT_RITUAL_PRIORITY) : priorityIndex(name, HAND_RITUAL_PRIORITY);
  }
  function categoryPriority(name, dept){
    // Categories often mirror ritual groups in Menu_Settings_V2. Apply the same approved order.
    return dept === 'Foot' ? priorityIndex(name, FOOT_RITUAL_PRIORITY) : priorityIndex(name, HAND_RITUAL_PRIORITY);
  }
  function menuOrderValue(nodeOrder, name, dept, kind){
    const approved = kind === 'category' ? categoryPriority(name, dept) : ritualPriority(name, dept);
    if (approved < 999) return approved * 10000 + Math.min(Number(nodeOrder) || 9999, 9999);
    return 9990000 + (Number(nodeOrder) || 9999);
  }
  function sortServicesLikeIndividual(a,b){
    const ao = Number(a.sortOrder) || 9999;
    const bo = Number(b.sortOrder) || 9999;
    if (ao !== bo) return ao - bo;
    const ac = String(a.category || '').localeCompare(String(b.category || ''), undefined, {numeric:true, sensitivity:'base'});
    if (ac) return ac;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, {numeric:true, sensitivity:'base'});
  }
  function firstValue(raw, keys, fallback='') {
    for (const k of keys) {
      if (raw[k] !== undefined && raw[k] !== null && String(raw[k]).trim() !== '') return raw[k];
    }
    return fallback;
  }

  function normalizeDepartment(value){
    const v = String(value || '').trim();
    if (/foot/i.test(v)) return 'Foot';
    if (/hand/i.test(v)) return 'Hand';
    if (/both/i.test(v)) return 'Both';
    return v || 'Hand';
  }

  function normalizeServiceRecord(id, raw){
    raw = raw || {};
    const statusRaw = String(firstValue(raw, ['status','Status'], raw.isActive === false ? 'inactive' : 'active')).trim().toLowerCase();
    const isActive = raw.isActive !== false && !['inactive','disabled','archived','deleted','false','no'].includes(statusRaw);
    const department = normalizeDepartment(firstValue(raw, ['department','Department','appliesTo','Applies To','dept','Dept'], 'Hand'));
    const serviceName = String(firstValue(raw, ['serviceName','Service Name','name','Name','displayName','Display Name','service','Service'], 'Unnamed Service')).trim() || 'Unnamed Service';
    const ritualGroup = String(firstValue(raw, ['ritualGroup','Ritual Group','ritual','Ritual','mainCategory','Main Category'], 'Uncategorized Rituals')).trim() || 'Uncategorized Rituals';
    const category = String(firstValue(raw, ['category','Category','subCategory','Sub Category'], 'General')).trim() || 'General';
    const serviceType = String(firstValue(raw, ['serviceType','Service Type','type','Type'], '')).trim();
    const description = firstValue(raw, ['serviceDescription','Service Description','description','Description','desc','Desc'], '');
    const pricingModel = String(firstValue(raw, ['pricingModel','Pricing Model','pricingType','Pricing Type'], '')).trim();
    const inputType = normalizeInputType(firstValue(raw, ['inputType','Input Type','selection','Selection','pricingType','Pricing Type','pricingModel','Pricing Model'], 'radio'));
    return {
      ...raw,
      id: String(firstValue(raw, ['id','ID'], id || serviceName)),
      name: serviceName,
      serviceName,
      description,
      department,
      appliesTo: raw.appliesTo || department,
      ritualGroup,
      ritualGroupDescription: firstValue(raw, ['ritualGroupDescription','Ritual Group Description','mainCategoryDescription','Main Category Description'], ''),
      category,
      categoryDescription: firstValue(raw, ['categoryDescription','Category Description','subCategoryDescription','Sub Category Description'], ''),
      serviceType,
      serviceTypeDescription: firstValue(raw, ['serviceTypeDescription','Service Type Description'], ''),
      duration: nint(firstValue(raw, ['duration','Duration'], 0), 0),
      price: window.thFinancialEvidence.amount(Object.hasOwn(raw, 'price') ? raw.price : raw.Price),
      inputType,
      pricingType: pricingModel,
      sortOrder: nint(firstValue(raw, ['sortOrder','Sort Order','priority','Priority'], 9999), 9999),
      status: statusRaw || 'active',
      isActive
    };
  }

  function allServices(){
    // HF88B: The separate group module must use Menu_Settings_V2 directly.
    // Do not read allMenuServicesCache here because that cache may contain legacy/runtime
    // transformed service rows from the individual booking engine.
    const source = Array.isArray(state.menuServices) ? state.menuServices : [];
    const seen = new Set();
    return source
      .map((s,i)=>normalizeServiceRecord(s && s.id ? s.id : i, s))
      .filter(s=>s && s.id && s.isActive)
      .filter(s=>{ const key=[s.department,s.ritualGroup,s.category,s.serviceType,s.serviceName,s.price].join('|').toLowerCase(); if(seen.has(key)) return false; seen.add(key); return true; })
      .sort((a,b)=>{
        const ad = normalizeDepartment(a.department || a.appliesTo || state.serviceDept || 'Hand') === 'Foot' ? 'Foot' : 'Hand';
        const bd = normalizeDepartment(b.department || b.appliesTo || state.serviceDept || 'Hand') === 'Foot' ? 'Foot' : 'Hand';
        const rp = menuOrderValue(a.sortOrder, a.ritualGroup, ad, 'ritual') - menuOrderValue(b.sortOrder, b.ritualGroup, bd, 'ritual');
        if (rp) return rp;
        return sortServicesLikeIndividual(a,b);
      });
  }

  async function loadMenuServicesForGroup(force=false){
    const current = session.capture();
    if (!current()) return [];
    if (!force && allServices().length) return allServices();
    if (state.menuLoading) return allServices();
    state.menuLoading = true;
    try {
      // HF89A: Prefer the shared Staff Menu_Settings_V2 consumer when available.
      // This keeps Group Booking aligned with Individual Booking, Service Menu, and Upsell.
      if (typeof window.thurayaGetMenuV2Services === 'function') {
        const shared = window.thurayaGetMenuV2Services({ activeOnly:true });
        if (Array.isArray(shared) && shared.length) {
          state.menuServices = shared.map((s,i)=>normalizeServiceRecord(s.id || i, { ...s, _hf89aSource:'shared_staff_menu_v2_consumer' }));
          state.menuLoadedAt = new Date().toISOString();
          state.menuSource = 'Menu_Settings_V2 shared Staff consumer';
          return allServices();
        }
      }

      // Fallback remains direct Menu_Settings_V2 read. Never fallback to legacy arrays.
      const db = dbRef(); if (!db) return [];
      const snap = await db.collection('Menu_Settings_V2').get();
      if (!current()) return [];
      const rows = [];
      snap.forEach(doc => rows.push(normalizeServiceRecord(doc.id, { id: doc.id, _hf89aSource:'direct_Menu_Settings_V2', ...(doc.data() || {}) })));
      state.menuServices = rows.filter(s=>s.isActive);
      state.menuLoadedAt = new Date().toISOString();
      state.menuSource = 'Menu_Settings_V2 direct read';
      return allServices();
    } catch(e) {
      if (!current()) return [];
      console.error('HF89A group menu load failed', e);
      const list = q('thHF87ServiceList');
      if (list) list.innerHTML = `<div class="th-hf87-empty">Could not load Menu_Settings_V2: ${esc(e.message || e)}</div>`;
      return [];
    } finally { if (current()) state.menuLoading = false; }
  }

  function selectedMap(i){ return state.members[i]?.services || {}; }
  function serviceQty(i, id){ return nint(selectedMap(i)[id], 0); }
  function selectedServices(i){ const map=selectedMap(i); const all=allServices(); return Object.keys(map).map(id=>{ const s=all.find(x=>x.id===id); return s ? { ...s, qty: Math.max(1, nint(map[id],1)) } : null; }).filter(Boolean); }
  function memberDuration(i){ return selectedServices(i).reduce((sum,s)=>sum + Math.max(0,nint(s.duration,0))*Math.max(1,nint(s.qty,1)),0); }
  function memberFinancials(i){
    const policy = window.thRequireCurrentTaxPolicy();
    if (selectedServices(i).some(s => window.thFinancialEvidence.amount(s.price) === null)) throw new Error('SERVICE_PRICE_UNAVAILABLE');
    const rows = selectedServices(i).map(s => ({ menuItemId: s.id, serviceId: s.id, department: s.department,
      serviceName: s.name, unitPrice: num(s.price), unitPriceAtBooking: num(s.price), quantity: Math.max(1, nint(s.qty, 1)),
      durationAtBooking: nint(s.duration, 0), snapshotSource: s._hf89aSource || state.menuSource || 'staff_hf87_group_module' }));
    return { ...window.thBuildCanonicalFinancialShape({ serviceLineItems: rows, pricingMode: policy.pricingMode, taxRates: policy.rates }), financialPolicySnapshot: policy };
  }
  function memberSubtotal(i){ return memberFinancials(i).taxableSubtotal; }
  function memberTaxBreakdown(i){ return memberFinancials(i).taxBreakdown; }
  function memberTotal(i){ return memberFinancials(i).grandTotal; }
  function groupTotal(){ return window.thFinancialEvidence.sumMoney(state.members.map((_,i)=>memberTotal(i))); }
  function paymentLabel(){ return state.paymentMode==='split_own'?'Split by own services':state.paymentMode==='split_equal'?'Split equally':'Lead pays'; }
  function paymentDue(i){ if(state.paymentMode==='split_equal') return window.thAllocateMoneyShares(groupTotal(), state.members.length)[i]; if(state.paymentMode==='split_own') return memberTotal(i); return i===0 ? groupTotal() : 0; }
  function serviceSnapshotsForMember(i, taxBreakdown){
    return memberFinancials(i).serviceLineItems;
  }

  function groupTaxRatesFromBreakdown(taxBreakdown){
    if (typeof window.thCanonicalTaxRatesFromBreakdown === 'function') {
      return window.thCanonicalTaxRatesFromBreakdown(taxBreakdown);
    }
    return (Array.isArray(taxBreakdown) ? taxBreakdown : [])
      .map(t => ({ name: t.name || 'Tax', rate: num(t.rate) }))
      .filter(t => t.rate > 0);
  }

  function legacyTaxBreakdownRows(taxBreakdown){
    return (Array.isArray(taxBreakdown) ? taxBreakdown : []).map(t => ({
      name: t.name || 'Tax',
      rate: num(t.rate),
      amount: num(t.amount)
    }));
  }

  function groupFinancialsForMember(i, taxBreakdown, legacyGrandTotal){
    const canonical = memberFinancials(i);
    const memberDue = paymentDue(i);
    return {
      bookedService: canonical.bookedService || selectedServices(i).map(s=>`${s.name}${s.qty>1?' (x'+s.qty+')':''}`).join(', '),
      bookedDuration: String(Math.max(15, canonical.bookedDuration)),
      bookedPrice: String(canonical.bookedPrice),
      taxBreakdown: JSON.stringify(canonical.taxBreakdown),
      grandTotal: String(canonical.grandTotal),
      serviceLineItems: canonical.serviceLineItems,
      serviceSubtotal: String(canonical.serviceSubtotal),
      taxableSubtotal: String(canonical.taxableSubtotal),
      taxTotal: String(canonical.taxTotal),
      amountDue: String(memberDue),
      memberServiceTotal: String(canonical.grandTotal),
      payableShare: String(memberDue),
      amountDueByMember: String(memberDue),
      finalTotal: String(canonical.finalTotal),
      totalGHC: String(memberDue),
      pricingMode: canonical.pricingMode,
      taxPricingMode: canonical.taxPricingMode,
      financialPolicySnapshot: canonical.financialPolicySnapshot
    };
  }
  async function setStep(step){ const next=Math.max(1,Math.min(5,nint(step,1)));if(next===5&&!state._reviewGroupId){const current=session.capture();if(!current())return;try{state._reviewGroupIdPending ||= window.ThurayaOrdinaryStaging.allocate('staffGroupId');const groupId=await state._reviewGroupIdPending;if(!current())return;state._reviewGroupId=groupId;delete state._reviewGroupIdPending;}catch(e){alert(e.message);return;}} state.step=next;render(); }
  function openGroup(){ const current=session.capture(); if(!current()) return; const stable=q('thHF84Shell'); if(stable) stable.style.display='none'; ensureShell(); q('thHF87Shell')?.classList.add('active'); loadMenuServicesForGroup(true).then(()=>{ if(!current()) return; if(state.step===3) renderServices(); renderSummary(); }); render(); window.scrollTo({ top:q('bookingWizardView')?.offsetTop || 0, behavior:'smooth' }); }
  function closeGroup(){ q('thHF87Shell')?.classList.remove('active'); const stable=q('thHF84Shell'); if(stable) stable.style.display=''; }

  function addLauncher(){
    const shell=q('thHF84Shell'); if(!shell || q('thHF87Launcher')) return;
    const hero=shell.querySelector('.th-hf84-hero') || shell.firstElementChild;
    const card=document.createElement('div'); card.id='thHF87Launcher'; card.className='th-hf87-launch-card';
    card.innerHTML=`<div><strong>Enterprise Group Booking</strong><span>Separate group workflow with per-member services, flexible availability and payment responsibility options.</span></div><button type="button" onclick="thHF87OpenGroup()">Open Group Module</button>`;
    if(hero) hero.insertAdjacentElement('afterend',card); else shell.prepend(card);
  }

  function ensureShell(){
    const view=q('bookingWizardView'); if(!view || q('thHF87Shell')) return;
    const wrap=document.createElement('div'); wrap.id='thHF87Shell'; wrap.className='th-hf87-shell';
    wrap.innerHTML=`
      <div class="th-hf87-hero"><div><div class="th-hf87-kicker">THURAYA STAFF GROUP BOOKING</div><h2>Enterprise Group Module</h2><p>Separate group workflow with its own state, member cards, quantity-aware per-member services, flexible date/time assignment, payment responsibility options, linked Group ID, and review/save pipeline. Individual booking remains untouched.</p></div><div class="th-hf87-version">${VERSION}</div></div>
      <div class="th-hf87-stepper" id="thHF87Stepper">
        <button type="button" class="th-hf87-step" data-step="1" onclick="thHF87SetStep(1)"><span>1</span>Lead</button>
        <button type="button" class="th-hf87-step" data-step="2" onclick="thHF87SetStep(2)"><span>2</span>Members</button>
        <button type="button" class="th-hf87-step" data-step="3" onclick="thHF87SetStep(3)"><span>3</span>Services</button>
        <button type="button" class="th-hf87-step" data-step="4" onclick="thHF87SetStep(4)"><span>4</span>Date & Time</button>
        <button type="button" class="th-hf87-step" data-step="5" onclick="thHF87SetStep(5)"><span>5</span>Review</button>
      </div>
      <div class="th-hf87-grid"><div class="th-hf87-panel"><div id="thHF87Pane1" class="th-hf87-pane"></div><div id="thHF87Pane2" class="th-hf87-pane"></div><div id="thHF87Pane3" class="th-hf87-pane"></div><div id="thHF87Pane4" class="th-hf87-pane"></div><div id="thHF87Pane5" class="th-hf87-pane"></div></div><div class="th-hf87-side"><div class="th-hf87-summary"><h4>Group Summary</h4><div id="thHF87Summary"></div></div></div></div>`;
    view.appendChild(wrap);
  }

  async function searchLead(){
    const current=session.capture(); if(!current()) return;
    const requestId=++searchRequestId;
    const val=(q('thHF87ClientSearch')?.value || '').toLowerCase().trim(); const box=q('thHF87ClientResults'); if(!box) return;
    const isCurrent=()=>current() && requestId===searchRequestId && q('thHF87ClientResults')===box
      && (q('thHF87ClientSearch')?.value || '').toLowerCase().trim()===val;
    if(val.length<2){ box.style.display='none'; box.innerHTML=''; return; }
    let list=clients();
    if(!list.length && dbRef()){
      box.style.display='block'; box.innerHTML='<div style="padding:12px;color:#777;">Loading clients...</div>';
      try {
        const snap = await dbRef().collection('Clients').get();
        if (!isCurrent()) return;
        list = [];
        snap.forEach(doc => list.push({ ...doc.data(), id: doc.id }));
        try { allClientsCache = list; } catch (e) {}
      } catch (e) {
        if (isCurrent()) box.innerHTML = '<div style="padding:12px;color:#b91c1c;">Client search unavailable.</div>';
        return;
      }
    }
    if(!isCurrent()) return;
    const matches=list.filter(c=>{ const phone=String(c.Tel_Number||''); const fname=String(c.Forename||'').toLowerCase(); const sname=String(c.Surname||'').toLowerCase(); return phone.includes(val)||fname.includes(val)||sname.includes(val)||(fname+' '+sname).includes(val); }).slice(0,8);
    box.innerHTML=matches.length ? matches.map((m,i)=>{ const nm=esc(((m.Forename||'')+' '+(m.Surname||'')).trim() || 'Unknown Client'); const ph=esc(m.Tel_Number||'No phone'); return `<button type="button" class="th-hf87-client-result" onclick="thHF87SelectLead(${i})" data-lead-index="${i}"><strong>${nm}</strong><small>${ph}</small></button>`; }).join('') : '<div class="th-hf87-empty">No client found.</div>';
    window.THURAYA_HF87_LEAD_MATCHES = matches; box.style.display='block';
  }
  function selectedClientHtml(){
    if (!state.lead) return '';
    return `<div class="th-hf87-selected-client-row"><div><span class="th-hf87-check">✓</span><strong>Selected: ${esc(state.lead.name || 'Unknown Client')}</strong><span class="th-hf87-sep">|</span><span class="th-hf87-phone">📞 ${esc(state.lead.phone || 'No phone')}</span></div><button type="button" class="th-hf87-clear-client" onclick="thHF87ClearLead()" aria-label="Clear selected client">×</button></div>`;
  }
  function selectLeadByIndex(i){ const list=window.THURAYA_HF87_LEAD_MATCHES || []; if(list[i]) selectLead(list[i]); }
  function selectLead(c){
    searchRequestId++;
    session.clearTimer(searchTimer);
    const name=`${c.Forename||''} ${c.Surname||''}`.trim() || 'Unknown Client';
    state.lead={ name, phone:c.Tel_Number || '', raw:c }; state.members[0].name=name; state.members[0].phone=c.Tel_Number || '';
    const sel=q('thHF87SelectedClient'); if(sel){ sel.style.display='block'; sel.innerHTML=selectedClientHtml(); }
    if(q('thHF87ClientSearch')) q('thHF87ClientSearch').value=''; if(q('thHF87ClientResults')) { q('thHF87ClientResults').style.display='none'; q('thHF87ClientResults').innerHTML=''; }
    renderSummary();
  }
  function clearLead(){
    searchRequestId++;
    session.clearTimer(searchTimer);
    state.lead=null;
    state.members[0].name=''; state.members[0].phone='';
    const sel=q('thHF87SelectedClient'); if(sel){ sel.style.display='none'; sel.innerHTML=''; }
    const input=q('thHF87ClientSearch'); if(input) input.focus();
    renderSummary();
  }

  function setSize(size){ const n=Math.max(2,Math.min(12,nint(size,2))); while(state.members.length<n) state.members.push({ name:`Member ${state.members.length+1}`, phone:'', services:{} }); if(state.members.length>n) state.members=state.members.slice(0,n); if(state.lead){ state.members[0].name=state.lead.name; state.members[0].phone=state.lead.phone; } state.assignments=[]; render(); }
  function updateMember(i, field, value){ if(!state.members[i]) return; state.members[i][field]=value; renderSummary(); }
  function setActiveMember(i){ state.activeMember=Math.max(0,Math.min(state.members.length-1,nint(i,0))); render(); }
  function applyComposerSelection(member, rows){
    if (!session.capture()() || state.saving || !q('thHF87Shell')?.classList.contains('active') ||
        state.members[state.activeMember] !== member || !Array.isArray(rows) || !rows.length)
      throw Error('The active group member is unavailable.');
    const catalogue = new Map(allServices().map(service => [service.id,service]));
    const entries = new Map();
    for (const row of rows) {
      const service = catalogue.get(row.id);
      if (!service || entries.has(row.id) || !Number.isInteger(row.qty) || row.qty < 1 || row.qty > 99 ||
          (serviceInputType(service) !== 'counter' && row.qty !== 1) ||
          Number(service.price) !== Number(row.price) || Number(service.duration) !== Number(row.duration) ||
          (service.publicationVersion ?? 0) !== row.publicationVersion)
        throw Error('The group catalogue or quantity changed. Refresh before applying treatments.');
      entries.set(row.id,row.qty);
    }
    member.services = Object.fromEntries(entries);
    searchRequestId++;
    state.assignments=[];
    state.slotSuggestions=[];
    state.slotLoading=false;
    state.time='';
    setStep(3);
  }
  window.thHF87ApplyComposerSelection=applyComposerSelection;
  function toggleService(serviceId){ const m=state.members[state.activeMember]; if(!m) return; if(m.services[serviceId]) delete m.services[serviceId]; else m.services[serviceId]=1; state.assignments=[]; render(); }
  function setServiceQty(serviceId, qty){ const m=state.members[state.activeMember]; if(!m) return; const qv=Math.max(0,nint(qty,0)); if(qv<=0) delete m.services[serviceId]; else m.services[serviceId]=qv; state.assignments=[]; render(); }
  function adjustServiceQty(serviceId, delta){ const cur=serviceQty(state.activeMember, serviceId); setServiceQty(serviceId, cur + nint(delta,0)); }
  function setFilter(filter){ state.serviceDept = filter === 'Foot' ? 'Foot' : 'Hand'; renderServices(); }

  function renderLead(){
    searchRequestId++;
    session.clearTimer(searchTimer);
    const pane=q('thHF87Pane1'); if(!pane) return; const selected=selectedClientHtml();
    pane.innerHTML=`<h3>Lead Client</h3><p class="th-hf87-sub">Search and select the lead client. Member 1 will use this client as the group lead.</p><div class="th-hf87-field"><label>Search Client</label><input id="thHF87ClientSearch" type="text" placeholder="Search by name or phone" autocomplete="off"><div id="thHF87ClientResults" class="th-hf87-client-results"></div></div><div id="thHF87SelectedClient" class="th-hf87-selected-client" style="display:${state.lead?'block':'none'};">${selected}</div><div class="th-hf87-actions"><button type="button" class="btn btn-secondary" onclick="thHF87CloseGroup()">Back to Individual Booking</button><button type="button" class="btn th-hf87-primary" onclick="thHF87GoMembers()">Continue to Members</button></div>`;
    const input=q('thHF87ClientSearch'); if(input) input.addEventListener('input',()=>{ searchRequestId++; session.clearTimer(searchTimer); searchTimer=session.timeout(searchLead,250); });
  }

  function renderMembers(){
    const pane=q('thHF87Pane2'); if(!pane) return;
    const cards=state.members.map((m,i)=>`<div class="th-hf87-member"><div class="th-hf87-member-top"><label>${i===0?'Lead Client':'Group Member '+(i+1)}</label>${i===0?'<span class="th-hf87-badge">Lead</span>':''}</div><input type="text" value="${esc(m.name||'')}" ${i===0?'readonly':''} oninput="thHF87UpdateMember(${i},'name',this.value)" placeholder="Member name"><div style="height:8px"></div><input type="tel" value="${esc(m.phone||'')}" ${i===0?'readonly':''} oninput="thHF87UpdateMember(${i},'phone',this.value)" placeholder="Optional phone"></div>`).join('');
    pane.innerHTML=`<h3>Group Members</h3><p class="th-hf87-sub">Member names are owned by this separate module only. They are not remounted by the individual wizard.</p><div class="th-hf87-form-grid"><div class="th-hf87-field"><label>Group Size</label><select onchange="thHF87SetSize(this.value)">${Array.from({length:11},(_,i)=>i+2).map(n=>`<option value="${n}" ${state.members.length===n?'selected':''}>${n} people</option>`).join('')}</select></div></div><div style="height:12px"></div><div class="th-hf87-member-grid">${cards}</div><div class="th-hf87-actions"><button type="button" class="btn btn-secondary" onclick="thHF87SetStep(1)">Back</button><button type="button" class="btn th-hf87-primary" onclick="thHF87GoServices()">Continue to Services</button></div>`;
  }

  function serviceMatchesDepartment(s){
    const dept = state.serviceDept || 'Hand';
    const d = String(s.department || s.appliesTo || '').toLowerCase();
    if (dept === 'Foot') return d.includes('foot') || d.includes('both');
    return d.includes('hand') || d.includes('both') || !d;
  }

  function serviceInputType(s){
    const t = normalizeInputType(s.inputType || s.selection || s.pricingType || 'radio');
    return t;
  }

  function servicePriceLabel(s){
    const price = num(s.price);
    const suffix = /unit|quantity|per/i.test(String(s.pricingType || s.inputType || '')) ? ' / qty' : '';
    return price > 0 ? `GHC${money(price)}${suffix}` : 'Consultation';
  }

  function renderServiceControl(s){
    const id=s.id;
    const qty=serviceQty(state.activeMember,id);
    const checked=qty>0;
    const type=serviceInputType(s);
    const qtyMode=type==='counter' || /unit|quantity|per/i.test(String(s.pricingType||''));
    const desc=s.description ? `<div class="th-ritual-desc">${esc(s.description)}</div>` : '';
    const inputType = qtyMode ? 'checkbox' : (type === 'radio' ? 'radio' : 'checkbox');
    const inputName = `thhf87_${state.activeMember}_${String(s.category || 'menu').replace(/[^a-z0-9]+/gi,'_')}`;
    return `<div class="service-card th-ritual-service th-hf87-v2-service ${checked?'selected':''} ${qtyMode?'is-counter':''}" onclick="thHF87ToggleService('${esc(id)}')">
      <input type="${inputType}" ${inputType==='radio'?`name="${esc(inputName)}"`:''} ${checked?'checked':''} onclick="event.stopPropagation();thHF87ToggleService('${esc(id)}')">
      <label>
        <div class="th-ritual-row"><div><div class="th-ritual-name">${esc(s.name || 'Unnamed Service')}</div>${desc}</div><div class="th-ritual-price">${esc(servicePriceLabel(s))}</div></div>
        <small class="th-hf87-v2-meta">${esc([s.category,s.serviceType].filter(Boolean).join(' · '))}${s.duration ? ` · ${nint(s.duration,0)} mins` : ''}</small>
      </label>
      ${qtyMode?`<div class="counter-box th-ritual-counter-box th-hf87-qty"><button type="button" onclick="event.preventDefault();event.stopPropagation();thHF87AdjustServiceQty('${esc(id)}',-1)">−</button><input type="number" min="0" value="${qty}" onchange="thHF87SetServiceQty('${esc(id)}',this.value)" onclick="event.stopPropagation()"><button type="button" onclick="event.preventDefault();event.stopPropagation();thHF87AdjustServiceQty('${esc(id)}',1)">+</button></div>`:''}
    </div>`;
  }

  function groupServicesForV2(list){
    const tree = {};
    list.forEach(s=>{
      const ritual=s.ritualGroup || 'Uncategorized Rituals';
      const cat=s.category || 'General';
      if(!tree[ritual]) tree[ritual]={ desc:s.ritualGroupDescription||'', order:s.sortOrder||9999, cats:{} };
      tree[ritual].order=Math.min(tree[ritual].order, s.sortOrder||9999);
      if(!tree[ritual].desc && s.ritualGroupDescription) tree[ritual].desc=s.ritualGroupDescription;
      if(!tree[ritual].cats[cat]) tree[ritual].cats[cat]={ desc:s.categoryDescription||'', order:s.sortOrder||9999, services:[] };
      tree[ritual].cats[cat].order=Math.min(tree[ritual].cats[cat].order, s.sortOrder||9999);
      if(!tree[ritual].cats[cat].desc && s.categoryDescription) tree[ritual].cats[cat].desc=s.categoryDescription;
      tree[ritual].cats[cat].services.push(s);
    });
    return tree;
  }

  function renderV2Hierarchy(list){
    if(!list.length) return `<div class="th-hf87-empty">${state.menuLoading?'Loading live Menu_Settings_V2 services…':'No active Menu_Settings_V2 services found for this department.'}</div>`;
    const tree=groupServicesForV2(list);
    const dept = state.serviceDept === 'Foot' ? 'Foot' : 'Hand';
    return `<div class="th-ritual-menu th-hf87-v2-individual-menu">` + Object.entries(tree)
      .sort((a,b)=>menuOrderValue(a[1].order, a[0], dept, 'ritual') - menuOrderValue(b[1].order, b[0], dept, 'ritual') || a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}))
      .map(([ritual,node],ri)=>{
        const cats=Object.entries(node.cats).sort((a,b)=>menuOrderValue(a[1].order, a[0], dept, 'category') - menuOrderValue(b[1].order, b[0], dept, 'category') || a[0].localeCompare(b[0],undefined,{numeric:true,sensitivity:'base'}));
        const inner=cats.map(([cat,catNode])=>`<div class="th-ritual-submenu"><h3>${esc(cat)}</h3>${catNode.desc?`<p class="th-ritual-subdesc">${esc(catNode.desc)}</p>`:''}${catNode.services.sort(sortServicesLikeIndividual).map(renderServiceControl).join('')}</div>`).join('');
        return `<details class="th-ritual-main" ${ri===0?'open':''}><summary><div class="th-ritual-title-block"><strong>${esc(ritual)}</strong>${node.desc?`<span>${esc(node.desc)}</span>`:''}</div><div class="th-ritual-chev">+</div></summary><div class="th-ritual-content">${inner}</div></details>`;
      }).join('') + `</div>`;
  }

  function renderServices(){
    const current=session.capture(); if(!current()) return;
    const pane=q('thHF87Pane3'); if(!pane) return;
    let all=allServices(); if(!all.length && !state.menuLoading) loadMenuServicesForGroup().then(list=>{ if(current() && list.length && state.step===3) renderServices(); });
    const visible=all.filter(s=>serviceMatchesDepartment(s));
    const tabs=state.members.map((mem,i)=>`<button type="button" class="th-hf87-service-tab ${i===state.activeMember?'active':''}" onclick="thHF87SetActiveMember(${i})">${esc(mem.name || 'Member '+(i+1))}<small>${selectedServices(i).length || ''}</small></button>`).join('');
    const deptTabs = `<div class="dept-tabs th-hf87-dept-tabs"><label><input type="radio" name="thHF87Dept" value="Hand" ${state.serviceDept==='Hand'?'checked':''} onchange="thHF87SetDept('Hand')"> HAND THERAPY MENU</label><label><input type="radio" name="thHF87Dept" value="Foot" ${state.serviceDept==='Foot'?'checked':''} onchange="thHF87SetDept('Foot')"> FOOT THERAPY MENU</label></div>`;
    const sourceCount = all.length ? `${all.length} active services from ${state.menuSource || 'Menu_Settings_V2'}` : 'Loading Menu_Settings_V2…';
    const menuHtml = renderV2Hierarchy(visible);
    pane.innerHTML=`<h3>Per-Member Services</h3><p class="th-hf87-sub">This stage uses the same Menu_Settings_V2 display pattern as Individual Booking: Department → Ritual Group → Category → Service. No Most Popular/custom group filter is used.</p><div class="th-hf87-source-pill">HF89A Source: Menu_Settings_V2 · ${esc(sourceCount)}</div><div class="th-hf87-service-tabs">${tabs}</div>${deptTabs}<div id="thHF87ServiceList" class="th-hf87-v2-menu-clone">${menuHtml}</div><div class="th-hf87-actions"><button type="button" class="btn btn-secondary" onclick="thHF87SetStep(2)">Back</button><button type="button" class="btn th-hf87-primary" onclick="thHF87GoTime()">Continue to Smart Time</button></div>`;
  }

  function setDept(v){ state.serviceDept = v === 'Foot' ? 'Foot' : 'Hand'; renderServices(); }

  function setServiceSearch(v){ state.serviceSearch=String(v||''); renderServices(); }

  function serviceSummaryForMember(i){ return selectedServices(i).map(s=>`${s.name}${s.qty>1?' x'+s.qty:''}`).join(', '); }

  async function appointmentsForDate(dateStr){
    const appts=[];
    try{
      const snap=await dbRef().collection('Appointments').where('dateString','==',dateStr).where('status','in',['Scheduled','Arrived','Action Required']).get();
      snap.forEach(doc=>{
        const row=doc.data()||{};
        if(typeof isArchivedRecord==='function' && isArchivedRecord(row)) return;
        appts.push(row);
      });
    }catch(e){ console.warn('Availability query failed',e); }
    return appts;
  }

  // Reuse Client therapy eligibility, scoped to this member's selected services.
  function groupNormalizeTherapyTypes(value) {
      let raw = value;
      if (!raw) raw = ['hand', 'foot'];
      if (!Array.isArray(raw)) raw = [raw];
  
      const out = new Set();
      raw.forEach(v => {
          const t = String(v || '').trim().toLowerCase();
          if (!t) return;
          if (t === 'both' || t === 'hand & foot' || t === 'hand/foot') {
              out.add('hand');
              out.add('foot');
          } else if (t.includes('hand')) {
              out.add('hand');
          } else if (t.includes('foot') || t.includes('feet')) {
              out.add('foot');
          }
      });
  
      if (!out.size) {
          out.add('hand');
          out.add('foot');
      }
      return Array.from(out);
  }

  function groupRequiredTherapyTypes(services) {
      const required = new Set();
  
      (services || []).forEach(s => {
          const dept = String(s.department || s.dept || s.appliesTo || '').toLowerCase();
          if (dept.includes('hand')) required.add('hand');
          if (dept.includes('foot')) required.add('foot');
      });
  
      if (!required.size) {
          const dept = String(state.serviceDept || '').toLowerCase();
          if (dept.includes('foot')) required.add('foot');
          else required.add('hand');
      }
  
      return Array.from(required);
  }

  function techMatchesMemberTherapy(tech, services) {
    const techTypes = groupNormalizeTherapyTypes(tech?.therapyTypes || tech?.therapyType || tech?.therapy);
    return groupRequiredTherapyTypes(services).every(t => techTypes.includes(t));
  }

  async function assignmentsForMembersAt(timeValue, appts, schedules){
    const techPool=techs().filter(t=>t && t.email);
    if(!techPool.length) return null;
    if(typeof window.thurayaResolveStaffWorkingSchedulesForDate !== 'function') return null;
    schedules=schedules || await window.thurayaResolveStaffWorkingSchedulesForDate(state.date,techPool.map(t=>t.email));
    const usedGlobal=new Set();
    const assignments=[];
    for(let i=0;i<state.members.length;i++){
      const dur=Math.max(15, memberDuration(i));
      const svc=selectedServices(i);
      const start=toMins(timeValue);
      const free=techPool.filter(t=>!usedGlobal.has(t.email)).find(t=>
        techMatchesMemberTherapy(t,svc) && window.ThurayaSchedulePolicy.check(schedules[String(t.email).trim().toLowerCase()],state.date,timeValue,dur).ok && isFree(t.email,start,dur,appts));
      if(!free) return null;
      usedGlobal.add(free.email);
      assignments.push({ memberIndex:i, memberName:state.members[i].name, techEmail:free.email, techName:free.name||free.email, time:timeValue, duration:dur, serviceText:svc.map(s=>`${s.name}${s.qty>1?' x'+s.qty:''}`).join(', ') });
    }
    return assignments;
  }

  async function findAssignmentsForTime(timeValue, appts, schedules){
    return assignmentsForMembersAt(timeValue, appts, schedules);
  }
  async function buildSmartSlots(showAlert=true){
    const current=session.capture(); if(!current()) return [];
    state.slotSuggestions=[]; state.assignments=[];
    if(!state.date){ if(showAlert) alert('Please select a group date first.'); renderTime(); return []; }
    if(state.date < today()){ if(showAlert) alert('Past dates are not available.'); renderTime(); return []; }
    const missing=state.members.findIndex((_,i)=>!selectedServices(i).length);
    if(missing>=0){ if(showAlert) alert(`Please select at least one service for ${state.members[missing].name || 'Member '+(missing+1)}.`); setStep(3); return []; }
    if(!techs().filter(t=>t && t.email).length){ if(showAlert) alert('No technician profiles are loaded. Check Staff Matrix or refresh after login.'); renderTime(); return []; }
    state.slotLoading=true; renderTime();
    try {
    const appts=await appointmentsForDate(state.date);
    if(!current()) return [];
    if(typeof window.thurayaResolveStaffWorkingSchedulesForDate !== 'function') throw new Error('Schedule unavailable');
    const schedules=await window.thurayaResolveStaffWorkingSchedulesForDate(state.date,techs().map(t=>t.email));
    if(!current()) return [];
    const suggestions=[];
    const now=new Date();
    const isToday=state.date===today();
    const bookingWindow = await groupBookingWindow();
    if(!current()) return [];
    const startBase = bookingWindow.startMins;
    const endBase = bookingWindow.endMins;
    const requiredDuration = Math.max(15, ...state.members.map((_,i)=>memberDuration(i)));
    for(let start=startBase; start<=endBase; start+=15){
      if(isToday && start < (now.getHours()*60 + now.getMinutes() + 15)) continue;
      if(start + requiredDuration > endBase) continue;
      const t=minsToTime(start);
      const assignments=await findAssignmentsForTime(t, appts, schedules);
      if(!current()) return [];
      if(assignments){
        const names=assignments.map(a=>a.techName).join(' + ');
        suggestions.push({ time:t, label:toLabel(t), assignments, names });
      }
    }
    state.slotSuggestions=suggestions;
    state.slotLoading=false;
    renderTime(); renderSummary();
    if(showAlert && !suggestions.length) alert('No smart slots found for this date. Try another date.');
    return suggestions;
    } catch(e) {
      if(!current()) return [];
      state.slotSuggestions=[]; state.assignments=[];
      alert('Availability could not be verified. Please refresh slots before continuing.');
      return [];
    } finally {
      if(current()){ state.slotLoading=false; renderTime(); renderSummary(); }
    }
  }
  function selectSmartSlot(timeValue){
    const slot=(state.slotSuggestions||[]).find(s=>s.time===timeValue);
    if(!slot) return;
    state.time=slot.time;
    state.assignments=slot.assignments || [];
    renderTime(); renderSummary();
  }
  function renderTime(){
    const pane=q('thHF87Pane4'); if(!pane) return;
    const assignments=state.assignments.length ? state.assignments.map(a=>`<div class="th-hf87-assignment"><span><strong>${esc(a.memberName)}</strong><br><small>${esc(a.serviceText)} - ${a.duration} mins</small></span><strong>${esc(a.techName)} - ${esc(toLabel(a.time))}</strong></div>`).join('') : '<div style="color:#777;">Select a smart slot to assign technicians automatically.</div>';
    const slots = state.slotLoading ? '<div class="th-hf87-empty">Finding all available group times...</div>' : ((state.slotSuggestions||[]).length ? state.slotSuggestions.map(slot=>`<button type="button" class="th-hf87-slot ${state.time===slot.time?'selected':''}" onclick="thHF87SelectSmartSlot('${esc(slot.time)}')"><strong>${esc(slot.label)}</strong><span>${esc(slot.names)}</span></button>`).join('') : '<div class="th-hf87-empty">Choose a date. Smart time suggestions will load automatically from availability.</div>');
    pane.innerHTML=`<h3>Smart Date & Time</h3><p class="th-hf87-sub">Any Available Technician is fixed for group bookings. After FOH selects a date, all available group slots display automatically for selection.</p><div class="th-hf87-form-grid th-hf87-time-grid"><div class="th-hf87-field"><label>Date</label><input type="date" min="${today()}" value="${esc(state.date)}" onchange="thHF87SetDate(this.value)"></div><div class="th-hf87-field th-hf87-anyonly"><label>Technician Assignment</label><div class="th-hf87-any-card">Any Available Technician</div></div></div><div class="th-hf87-slot-panel"><div class="th-hf87-slot-head"><strong>Available Smart Slots</strong><button type="button" class="btn btn-secondary" onclick="thHF87FindSmartSlots()">Refresh Slots</button></div><div class="th-hf87-slot-grid">${slots}</div></div><div class="th-hf87-availability-box"><strong>Selected Assignment</strong><div id="thHF87AvailabilityResult">${assignments}</div></div><div class="th-hf87-actions"><button type="button" class="btn btn-secondary" onclick="thHF87SetStep(3)">Back</button><button type="button" class="btn th-hf87-primary" onclick="thHF87GoReview()">Review Group</button></div>`;
  }
  async function checkAvailability(showAlert=true){
    const current=session.capture(); if(!current()) return false;
    try {
    if(!state.date){ if(showAlert) alert('Please select a group date.'); renderTime(); return false; }
    if(!state.time && !(state.slotSuggestions||[]).length) await buildSmartSlots(false);
    if(!current()) return false;
    if(!state.time){ if(showAlert) alert('Please choose one of the smart time suggestions.'); renderTime(); return false; }
    const slot=(state.slotSuggestions||[]).find(s=>s.time===state.time);
    if(slot && slot.assignments){ state.assignments=slot.assignments; renderTime(); renderSummary(); return true; }
    const appts=await appointmentsForDate(state.date);
    if(!current()) return false;
    const assignments=await findAssignmentsForTime(state.time, appts);
    if(!current()) return false;
    if(!assignments){ if(showAlert) alert('This time is no longer available for the full group. Please find smart slots again.'); state.assignments=[]; renderTime(); return false; }
    state.assignments=assignments;
    renderTime(); renderSummary(); return true;
    } catch(e) {
      if(!current()) return false;
      state.assignments=[]; renderTime();
      if(showAlert) alert('Availability could not be verified. Please refresh slots before continuing.');
      return false;
    }
  }
  function isFree(email,start,dur,appts){ const end=start+dur; return !appts.some(a=>{ if(String(a.assignedTechEmail||'')!==String(email)) return false; const aStart=toMins(a.timeString||'00:00'); const aEnd=aStart+nint(a.bookedDuration,0); return start<aEnd && end>aStart; }); }

  function renderReview(){
    const pane=q('thHF87Pane5'); if(!pane) return; const gid=state._reviewGroupId || makeGroupId(); state._reviewGroupId=gid;
    try { window.thRequireCurrentTaxPolicy(); } catch(e) { pane.innerHTML='<p>Financial configuration unavailable. Booking cannot be confirmed.</p>'; return; }
    const payOptions=[['lead','Lead pays'],['split_own','Split by own services'],['split_equal','Split equally']].map(([v,l])=>`<label class="th-hf87-pay-option ${state.paymentMode===v?'active':''}"><input type="radio" name="thHF87Payment" value="${v}" ${state.paymentMode===v?'checked':''} onchange="thHF87SetPayment(this.value)"><strong>${l}</strong><span>${v==='lead'?'One payment under lead client':v==='split_own'?'Each member pays their own service total':'Group total divided equally'}</span></label>`).join('');
    const cards=state.members.map((m,i)=>`<div class="th-hf87-review-card"><strong>${esc(m.name || 'Member '+(i+1))}</strong><span>${esc(selectedServices(i).map(s=>`${s.name}${s.qty>1?' x'+s.qty:''}`).join(', ') || 'No services')}<br>${esc(state.assignments[i]?.techName || 'No assignment')} - ${esc(toLabel(state.assignments[i]?.time || state.time || ''))}<br>Subtotal GHC ${money(memberSubtotal(i))} - Total GHC ${money(memberTotal(i))} - Due now GHC ${money(paymentDue(i))}</span></div>`).join('');
    pane.innerHTML=`<h3>Review, Payment & Confirm Group</h3><p class="th-hf87-sub">Confirm linked appointment records. Group ID: <strong>${esc(gid)}</strong></p><div class="th-hf87-payment-box"><h4>Payment Responsibility</h4><div class="th-hf87-pay-grid">${payOptions}</div></div>${cards}<div class="th-hf87-review-card"><strong>Group Total</strong><span>GHC ${money(groupTotal())}<br>Payment: ${esc(paymentLabel())}</span></div><div class="th-hf87-actions"><button type="button" class="btn btn-secondary" onclick="thHF87SetStep(4)">Back</button><button type="button" class="btn th-hf87-primary" onclick="thHF87ConfirmGroup()">Confirm Group Booking</button></div>`;
  }
  function buildPricingPayloads(){const gid=state._reviewGroupId||makeGroupId();const assignments=state.assignments.map((a,i)=>({techEmail:a.techEmail,date:state.date,time:a.time||state.time,duration:memberDuration(i)}));const payloads=[];
      const isSplit=false;
      state.members.forEach((m,i)=>{

        const taxBreakdown=memberTaxBreakdown(i);
        const legacyGrandTotal=memberTotal(i);
        const a=state.assignments[i];
        if(a.techEmail!==assignments[i].techEmail || state.date!==assignments[i].date || (a.time||state.time)!==assignments[i].time || memberDuration(i)!==assignments[i].duration) throw new Error('Group selection changed. Please check availability again.');
        const financials=groupFinancialsForMember(i,taxBreakdown,legacyGrandTotal);
        payloads.push({
          clientPhone:i===0?(state.lead?.phone||m.phone||''):(m.phone||state.lead?.phone||''),
          clientName:m.name||`Member ${i+1}`,
          leadClientName:state.lead?.name||state.members[0]?.name||'',
          leadClientPhone:state.lead?.phone||state.members[0]?.phone||'',
          dateString:isSplit?(a.dateStr||state.date):state.date,
          timeString:a.time || state.time,
          assignedTechEmail:a.techEmail,
          assignedTechName:a.techName,
          bookedService:financials.bookedService,
          bookedDuration:financials.bookedDuration,
          bookedPrice:financials.bookedPrice,
          taxBreakdown:financials.taxBreakdown,
          grandTotal:financials.grandTotal,
          serviceLineItems:financials.serviceLineItems,
          serviceSubtotal:financials.serviceSubtotal,
          taxableSubtotal:financials.taxableSubtotal,
          taxTotal:financials.taxTotal,
          amountDue:financials.amountDue,
          groupTotal:String(groupTotal()),
          memberServiceTotal:financials.memberServiceTotal,
          payableShare:financials.payableShare,
          amountDueByMember:financials.amountDueByMember,
          finalTotal:financials.finalTotal,
          totalGHC:financials.totalGHC,
          pricingMode:financials.pricingMode,
          taxPricingMode:financials.taxPricingMode,
          financialPolicySnapshot:financials.financialPolicySnapshot,
          status:'Scheduled',
          bookedBy:(typeof currentUserEmail!=='undefined'?currentUserEmail:''),
          groupSize:state.members.length,
          isGroupBooking:true,
          groupId:gid,
          groupRole:i===0?'lead':'member',
          groupMemberIndex:i,
          groupMemberCount:state.members.length,
          splitGroup:!!isSplit,
          subGroupIndex:isSplit?(a.subGroupIndex||1):1,
          groupPaymentMode:state.paymentMode,
          groupPaymentLabel:paymentLabel(),
          paymentResponsibility:state.paymentMode==='lead'?(i===0?'lead_pays':'covered_by_lead'):(state.paymentMode==='split_own'?'own_services':'equal_split'),
          billingScenario:isSplit?'split_group_different_times':'whole_group_same_time',
          createdAt:firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          bookingSource:isSplit?'staff_hf87_group_module_split':'staff_hf88d_group_module'
        });
      });

return payloads.map(p=>{delete p.createdAt;delete p.updatedAt;return p;});}
  window.thHF87BuildPricingPayloads=buildPricingPayloads;
  async function confirmGroup(){
    const current=window.ThurayaSessionResources.capture();
    if(!current() || state.saving) return; state.saving=true;
    try{
      const local=window.THURAYA_TRUSTED_BOOKING===true;
      if(local&&(!state._reviewGroupId||state.assignments.length!==state.members.length))
       throw Error('Review the complete group selection before confirming.');
      const reviewed=local?buildPricingPayloads():null;
      if(!await validateAll() || !current()) return;
      window.thRequireCurrentTaxPolicy();
      if(typeof window.thurayaValidateStaffScheduleAssignments !== 'function') throw new Error('Working schedule could not be verified. Please retry.');
      const assignments=state.assignments.map((a,i)=>({techEmail:a.techEmail,date:state.date,time:a.time||state.time,duration:memberDuration(i)}));
      await window.thurayaValidateStaffScheduleAssignments(assignments);
      if(!current()) return;
      const gid=state._reviewGroupId || makeGroupId();
      if(local){
        if(JSON.stringify(reviewed)!==JSON.stringify(buildPricingPayloads()))
         throw Error('Group selection changed. Review the booking again.');
        if(!window.ThurayaLocalStaffBooking)throw Error('Trusted local Staff booking is unavailable.');
        const receipt=await window.ThurayaLocalStaffBooking.submit(reviewed);
        if(!current())return;
        alert('Group saved with verified slots.');
        closeGroup();
        return receipt;
      }
      const batch=dbRef().batch();
      const isSplit=false;
      state.members.forEach((m,i)=>{
        const ref=dbRef().collection('Appointments').doc();
        const taxBreakdown=memberTaxBreakdown(i);
        const legacyGrandTotal=memberTotal(i);
        const a=state.assignments[i];
        if(a.techEmail!==assignments[i].techEmail || state.date!==assignments[i].date || (a.time||state.time)!==assignments[i].time || memberDuration(i)!==assignments[i].duration) throw new Error('Group selection changed. Please check availability again.');
        const financials=groupFinancialsForMember(i,taxBreakdown,legacyGrandTotal);
        batch.set(ref,{
          clientPhone:i===0?(state.lead?.phone||m.phone||''):(m.phone||state.lead?.phone||''),
          clientName:m.name||`Member ${i+1}`,
          leadClientName:state.lead?.name||state.members[0]?.name||'',
          leadClientPhone:state.lead?.phone||state.members[0]?.phone||'',
          dateString:isSplit?(a.dateStr||state.date):state.date,
          timeString:a.time || state.time,
          assignedTechEmail:a.techEmail,
          assignedTechName:a.techName,
          bookedService:financials.bookedService,
          bookedDuration:financials.bookedDuration,
          bookedPrice:financials.bookedPrice,
          taxBreakdown:financials.taxBreakdown,
          grandTotal:financials.grandTotal,
          serviceLineItems:financials.serviceLineItems,
          serviceSubtotal:financials.serviceSubtotal,
          taxableSubtotal:financials.taxableSubtotal,
          taxTotal:financials.taxTotal,
          amountDue:financials.amountDue,
          groupTotal:String(groupTotal()),
          memberServiceTotal:financials.memberServiceTotal,
          payableShare:financials.payableShare,
          amountDueByMember:financials.amountDueByMember,
          finalTotal:financials.finalTotal,
          totalGHC:financials.totalGHC,
          pricingMode:financials.pricingMode,
          taxPricingMode:financials.taxPricingMode,
          financialPolicySnapshot:financials.financialPolicySnapshot,
          status:'Scheduled',
          bookedBy:(typeof currentUserEmail!=='undefined'?currentUserEmail:''),
          groupSize:state.members.length,
          isGroupBooking:true,
          groupId:gid,
          groupRole:i===0?'lead':'member',
          groupMemberIndex:i,
          groupMemberCount:state.members.length,
          splitGroup:!!isSplit,
          subGroupIndex:isSplit?(a.subGroupIndex||1):1,
          groupPaymentMode:state.paymentMode,
          groupPaymentLabel:paymentLabel(),
          paymentResponsibility:state.paymentMode==='lead'?(i===0?'lead_pays':'covered_by_lead'):(state.paymentMode==='split_own'?'own_services':'equal_split'),
          billingScenario:isSplit?'split_group_different_times':'whole_group_same_time',
          createdAt:firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt:firebase.firestore.FieldValue.serverTimestamp(),
          bookingSource:isSplit?'staff_hf87_group_module_split':'staff_hf88d_group_module'
        });
      });
      await batch.commit();
      if(!current()) return;
      alert(`Group booking confirmed.\n\nGroup ID: ${gid}\nMembers booked: ${state.members.length}\nPayment: ${paymentLabel()}`); reset(); closeGroup();
    }catch(e){ if(current()) alert('Group booking failed: '+(e.message||e)); } finally{ if(current()) state.saving=false; }
  }
  async function validateAll(){
    const current=window.ThurayaSessionResources.capture(); if(!current()) return false;
    if(!state.lead || !state.lead.phone){ alert('Please select a lead client.'); setStep(1); return false; }
    const unnamed=state.members.findIndex(m=>!String(m.name||'').trim()); if(unnamed>=0){ alert(`Please enter the name for Member ${unnamed+1}.`); setStep(2); return false; }
    const noSvc=state.members.findIndex((_,i)=>!selectedServices(i).length); if(noSvc>=0){ alert(`Please select services for ${state.members[noSvc].name}.`); setStep(3); return false; }
    if(!state.assignments.length || state.assignments.length!==state.members.length){ const ok=await checkAvailability(false); if(!current()) return false; if(!ok){ setStep(4); alert('Please run a successful availability check before confirming.'); return false; } }
    return true;
  }
  function reset(){ state.step=1; state.activeMember=0; state.lead=null; state.members=[{name:'Lead Client',phone:'',services:{}},{name:'Member 2',phone:'',services:{}}]; state.date=''; state.time=''; state.techMode=ANY; state.flexibility=15; state.timingMode='simultaneous'; state.paymentMode='lead'; state.serviceDept='Hand'; state.assignments=[]; state.slotSuggestions=[]; state.slotLoading=false; delete state._reviewGroupId; delete state._reviewGroupIdPending; render(); }
  function goMembers(){ if(!state.lead){ alert('Please select a lead client first.'); return; } setStep(2); }
  async function goServices(){ const current=session.capture(); if(!current()) return; const idx=state.members.findIndex(m=>!String(m.name||'').trim()); if(idx>=0){ alert(`Please enter the name for Member ${idx+1}.`); return; } await loadMenuServicesForGroup(true); if(current()) setStep(3); }
  function goTime(){ const idx=state.members.findIndex((_,i)=>!selectedServices(i).length); if(idx>=0){ alert(`Please select services for ${state.members[idx].name}.`); return; } setStep(4); if(state.date) buildSmartSlots(false); }
  async function goReview(){ const current=session.capture(); if(!current()) return; const ok=await checkAvailability(false); if(!current()) return; if(!ok){ alert('Please complete a successful availability check first.'); return; } return setStep(5); }

  function renderSummary(){
    if(!session.active()) return;
    const box=q('thHF87Summary'); if(!box) return;
    try { window.thRequireCurrentTaxPolicy(); } catch(e) { box.innerHTML='<p>Financial configuration unavailable.</p>'; return; }
    const timeLabel=`${state.date || '-'} ${state.time?toLabel(state.time):''}`;
    box.innerHTML=`<div class="th-hf87-summary-row"><span>Lead</span><strong>${esc(state.lead?.name || 'Not selected')}</strong></div><div class="th-hf87-summary-row"><span>Members</span><strong>${state.members.length}</strong></div><div class="th-hf87-summary-row"><span>Services</span><strong>${state.members.reduce((s,_,i)=>s+selectedServices(i).reduce((a,x)=>a+x.qty,0),0)}</strong></div><div class="th-hf87-summary-row"><span>Date/Time</span><strong>${esc(timeLabel)}</strong></div><div class="th-hf87-summary-row"><span>Assignments</span><strong>${state.assignments.length}/${state.members.length}</strong></div><div class="th-hf87-summary-row"><span>Payment</span><strong>${esc(paymentLabel())}</strong></div><div class="th-hf87-summary-row"><span>Total</span><strong>GHC ${money(groupTotal())}</strong></div>`;
  }
  function render(){ if(!session.active()) return; ensureShell(); document.querySelectorAll('.th-hf87-step').forEach(b=>b.classList.toggle('active',String(b.dataset.step)===String(state.step))); for(let i=1;i<=5;i++) q('thHF87Pane'+i)?.classList.toggle('active',i===state.step); if(state.step===1) renderLead(); if(state.step===2) renderMembers(); if(state.step===3) renderServices(); if(state.step===4) renderTime(); if(state.step===5) renderReview(); renderSummary(); }
  function boot(){ if(!session.active()) return; addLauncher(); ensureShell(); renderSummary(); }
  function startBoot(){ session.startupTimeout('booking-group-800',boot,800); session.startupTimeout('booking-group-1800',boot,1800); }
  document.addEventListener('DOMContentLoaded',startBoot,{ once:true }); if(document.readyState!=='loading') startBoot();

  session.onStart('booking-group-menu', () => session.manage('booking-group-menu', current => {
    const onMenuUpdated = function(){
      if(!current()) return;
    // HF89A: when Staff's shared Menu_Settings_V2 consumer changes, refresh group service menu safely.
    state.menuServices = [];
    loadMenuServicesForGroup(true).then(function(){
      if(!current()) return;
      if (state.step === 3) renderServices();
      renderSummary();
    });
    };
    document.addEventListener('thuraya:menu-v2-updated', onMenuUpdated);
    return () => document.removeEventListener('thuraya:menu-v2-updated', onMenuUpdated);
  }));

  window.thHF87OpenGroup=openGroup; window.thHF87CloseGroup=closeGroup; window.thHF87SetStep=setStep; window.thHF87GoMembers=goMembers; window.thHF87GoServices=goServices; window.thHF87GoTime=goTime; window.thHF87GoReview=goReview; window.thHF87SetSize=setSize; window.thHF87UpdateMember=updateMember; window.thHF87SelectLead=selectLeadByIndex; window.thHF87ClearLead=clearLead; window.thHF87SetActiveMember=setActiveMember; window.thHF87ToggleService=toggleService; window.thHF87SetServiceQty=setServiceQty; window.thHF87AdjustServiceQty=adjustServiceQty; window.thHF87SetFilter=setFilter; window.thHF87SetDept=setDept; window.thHF87SetServiceSearch=function(){}; window.thHF87SetDate=v=>{state.date=v;state.time='';state.assignments=[];state.slotSuggestions=[];renderTime();renderSummary(); if(state.date) buildSmartSlots(false);}; window.thHF87SetTime=v=>{state.time=v;state.assignments=[];renderSummary();}; window.thHF87SetTech=v=>{state.techMode=ANY;state.assignments=[];renderSummary();}; window.thHF87SetFlex=v=>{state.flexibility=nint(v,15);state.assignments=[];renderSummary();}; window.thHF87SetTimingMode=v=>{state.timingMode=v||'simultaneous';state.assignments=[];renderSummary();}; window.thHF87SetPayment=v=>{state.paymentMode=v||'lead'; renderReview(); renderSummary();}; window.thHF87CheckAvailability=checkAvailability; window.thHF87FindSmartSlots=buildSmartSlots; window.thHF87SelectSmartSlot=selectSmartSlot; window.thHF87ConfirmGroup=confirmGroup;
  console.log('THURAYA HF88D group booking menu parity loaded');
})();

