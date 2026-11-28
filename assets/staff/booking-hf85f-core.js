/* ============================================================
   THURAYA STAFF — HF84 CLEAN BOOKING CORE
   Purpose-built Staff booking wizard.
   Keeps Menu_Settings_V2 and sched_* runtime; retires layered wizard UI.
   ============================================================ */
(function(){
  if (window.__THURAYA_HF84_CLEAN_BOOKING_CORE__) return;
  window.__THURAYA_HF84_CLEAN_BOOKING_CORE__ = true;

  const VERSION = 'HF86 · Individual Stable · Group Rebuild Frozen';
  const ANY = '__ANY_AVAILABLE_TECH__';
  const session = window.ThurayaSessionResources;
  const state = window.THURAYA_HF84_BOOKING = {
    step: 1,
    mode: 'individual',
    groupSize: 1,
    members: [],
    mounted: false,
    bookingInProgress: false
  };

  const q = id => document.getElementById(id);
  session.onStop('booking-core-state', () => {
    state.step = 1; state.mode = 'individual'; state.groupSize = 1; state.members = [];
    ['thHF84Members', 'thHF84Review', 'thHF84SummaryRows'].forEach(id => { const el = q(id); if (el) el.innerHTML = ''; });
    ['sched_name', 'sched_phone', 'sched_search', 'sched_groupId'].forEach(id => { const el = q(id); if (el) el.value = ''; });
    const size = q('sched_groupSize'); if (size) size.value = '1';
  });
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const nint = (v, fb=0) => { const n = parseInt(v,10); return Number.isFinite(n) ? n : fb; };
  const money = v => { const n = Number(String(v ?? '').replace(/[^0-9.-]/g,'')); return Number.isFinite(n) ? n.toFixed(2) : '0.00'; };

  function makeGroupId(){
    const el = q('sched_groupId');
    if (el && el.value) return el.value;
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = 'GRP-';
    for (let i=0;i<6;i++) out += chars[Math.floor(Math.random()*chars.length)];
    if (el) el.value = out;
    return out;
  }

  function getLeadName(){ return (q('sched_name')?.value || '').trim(); }
  function getLeadPhone(){ return (q('sched_phone')?.value || '').trim(); }

  function ensureAnyOption(){
    const sel = q('sched_techSelect');
    if (!sel) return;
    let opt = Array.from(sel.options || []).find(o => o.value === ANY);
    if (!opt) {
      opt = document.createElement('option');
      opt.value = ANY;
      opt.textContent = 'Any available technician';
      const firstReal = Array.from(sel.options || []).find(o => o.value && !o.disabled);
      if (firstReal) sel.insertBefore(opt, firstReal); else sel.appendChild(opt);
    } else opt.textContent = 'Any available technician';
  }

  function selectedServices(){
    const services = [];
    document.querySelectorAll('.sched-service-item:checked').forEach(cb => {
      const name = cb.getAttribute('data-name');
      if (name) services.push(name);
    });
    const counters = document.querySelectorAll('#sched_serviceMenu .sched-service-counter, .sched-service-counter');
    const seen = new Set();
    counters.forEach(input => {
      if (seen.has(input)) return; seen.add(input);
      const qty = nint(input.value, 0);
      const name = input.getAttribute('data-name');
      if (qty > 0 && name) services.push(`${name} (x${qty})`);
    });
    return services;
  }

  function selectedTech(){
    const sel = q('sched_techSelect');
    if (!sel) return { email:'', name:'' };
    const opt = sel.options[sel.selectedIndex];
    return { email: sel.value || '', name: opt ? opt.textContent.replace(' 🔒','') : '' };
  }

  function syncRuntimeGroup(){
    const size = state.mode === 'group' ? Math.max(2, Math.min(8, state.groupSize || 2)) : 1;
    state.groupSize = size;
    const sel = q('sched_groupSize');
    if (sel) {
      if (!Array.from(sel.options || []).some(o => String(o.value) === String(size))) {
        const opt = document.createElement('option'); opt.value = String(size); opt.textContent = `${size} people`; sel.appendChild(opt);
      }
      if (String(sel.value) !== String(size)) sel.value = String(size);
    }
    const note = q('groupSizeNote');
    const count = q('groupSizeNoteCount');
    const gid = q('sched_groupId');
    if (size > 1) { if (gid && !gid.value) gid.value = makeGroupId(); if (note) note.style.display='block'; if (count) count.textContent = String(size); }
    else { if (gid) gid.value=''; if (note) note.style.display='none'; }
    ensureMembers();
  }

  function ensureMembers(){
    const size = state.mode === 'group' ? state.groupSize : 1;
    while (state.members.length < size) state.members.push({ name:'' });
    if (state.members.length > size) state.members = state.members.slice(0, size);
    const lead = getLeadName();
    if (lead && !state.members[0].name) state.members[0].name = lead;
  }

  function setMode(mode){
    // HF86: freeze unstable Staff group booking inside the live wizard.
    // Individual booking remains production-stable while group booking is rebuilt separately.
    if (mode === 'group') {
      state.mode = 'individual';
      state.groupSize = 1;
      syncRuntimeGroup();
      refresh();
      alert('Group booking is temporarily disabled while the dedicated Staff group module is rebuilt. Please use individual bookings for live operations.');
      return;
    }
    state.mode = 'individual';
    state.groupSize = 1;
    syncRuntimeGroup();
    try { if (typeof window.generateTimeSlots === 'function') window.generateTimeSlots(); } catch(e) { console.warn('HF86 slot refresh skipped', e); }
    renderMembers();
    refresh();
  }

  function adjustGroup(delta){
    state.mode = 'group';
    state.groupSize = Math.max(2, Math.min(8, (state.groupSize || 2) + (parseInt(delta,10)||0)));
    syncRuntimeGroup();
    try { if (typeof window.generateTimeSlots === 'function') window.generateTimeSlots(); } catch(e) {}
    renderMembers(); refresh();
  }

  function updateMember(index, value){
    ensureMembers();
    if (!state.members[index]) state.members[index] = { name:'' };
    // HF85D: keep the exact typed value and do not rebuild member inputs while FOH is typing.
    // The previous layered fixes could steal focus or reset the field.
    state.members[index].name = String(value || '');
    renderSummary();
    renderReview();
  }

  function syncMembersFromDom(){
    ensureMembers();
    const inputs = Array.from(document.querySelectorAll('#thHF84Members [data-hf85e-member-input]'));
    inputs.forEach(input => {
      const idx = parseInt(input.closest('[data-member-index]')?.getAttribute('data-member-index') || '-1', 10);
      if (idx >= 0) {
        if (!state.members[idx]) state.members[idx] = { name:'' };
        state.members[idx].name = String(input.value || '').trim();
      }
    });
    if (state.members[0]) state.members[0].name = state.members[0].name || getLeadName();
    return state.members;
  }

  function memberName(i){
    ensureMembers();
    const lead = getLeadName();
    if (i === 0) return (state.members[0]?.name || lead || 'Lead Client').trim();
    return (state.members[i]?.name || `Member ${i+1}`).trim();
  }

  function renderMembers(force=false){
    const box = q('thHF84Members');
    if (!box) return;
    ensureMembers();

    // HF85E: never rebuild member inputs while a member field is active.
    // This is the hard stop for the typing/focus loss issue.
    const active = document.activeElement;
    if (!force && active && active.closest && active.closest('#thHF84Members')) {
      const idx = parseInt(active.closest('[data-member-index]')?.getAttribute('data-member-index') || '-1', 10);
      if (idx >= 0 && state.members[idx]) state.members[idx].name = active.value;
      return;
    }

    // Preserve any DOM-entered values before rebuilding due to group-size/client changes.
    box.querySelectorAll('[data-hf85e-member-input], [data-hf85e-member-input]').forEach(input => {
      const idx = parseInt(input.closest('[data-member-index]')?.getAttribute('data-member-index') || '-1', 10);
      if (idx >= 0 && state.members[idx]) state.members[idx].name = input.value;
    });

    box.innerHTML = '';
    state.members.forEach((m, i) => {
      const card = document.createElement('div');
      card.className = 'th-hf84-member';
      card.setAttribute('data-member-index', String(i));

      const label = document.createElement('label');
      label.textContent = i === 0 ? 'Lead Client' : 'Group Member ' + (i + 1);

      const input = document.createElement('input');
      input.type = 'text';
      input.setAttribute('data-hf85e-member-input', '1');
      input.autocomplete = 'off';
      input.placeholder = i === 0 ? 'Lead client name' : 'Enter member name';
      input.value = (i === 0 && !m.name ? getLeadName() : (m.name || ''));

      // Block parent/delegated booking handlers from stealing focus or remounting.
      ['click','mousedown','mouseup','keydown','keyup','keypress','input','change','focus'].forEach(evt => {
        input.addEventListener(evt, function(ev){ ev.stopPropagation(); }, true);
      });
      input.addEventListener('input', function(){
        const idx = parseInt(this.closest('[data-member-index]')?.getAttribute('data-member-index') || '0', 10) || 0;
        updateMember(idx, this.value);
      });

      card.appendChild(label);
      card.appendChild(input);
      box.appendChild(card);
    });
  }

  function moveRuntime(){
    const mount = q('thHF84RuntimeMount');
    if (!mount) return;
    const clientBox = q('sched_search')?.closest('.module-box');
    const serviceBox = q('sched_serviceMenu')?.closest('.module-box');
    const timeBox = q('sched_date')?.closest('.module-box');
    if (clientBox && q('thHF84ClientSlot') && clientBox.parentElement !== q('thHF84ClientSlot')) q('thHF84ClientSlot').appendChild(clientBox);
    if (serviceBox && q('thHF84ServiceSlot') && serviceBox.parentElement !== q('thHF84ServiceSlot')) q('thHF84ServiceSlot').appendChild(serviceBox);
    if (timeBox && q('thHF84TimeSlot') && timeBox.parentElement !== q('thHF84TimeSlot')) q('thHF84TimeSlot').appendChild(timeBox);
    // HF85D: keep the booking screen clean. Upcoming Schedule remains in its own operational area,
    // not inside the booking wizard. Live Summary stays visible.
    const upcoming = Array.from(document.querySelectorAll('.module-box')).find(el => /Upcoming Schedule/i.test(el.textContent || '') && el.querySelector('#upcomingScheduleList'));
    if (upcoming) upcoming.style.display = 'none';
    // Keep the old Clients schedule wrapper from showing as a second booking page.
    const subSchedule = q('subView_Schedule');
    if (subSchedule) subSchedule.classList.add('th-hf84-hidden-runtime');
  }

  function hideOldLayers(){
    [
      'thB11HeaderHF72','thB11ReviewPaneHF72','thHF75VisitChoice','thHF75EngineBadge',
      'thHF76SingleMountBadge','thHF83StableGroupNotice','thHF79GroupBuilder','thHF79PaymentBox'
    ].forEach(id => { const el = q(id); if (el) el.remove(); });
    document.querySelectorAll('[id^="thHF79"], .th-hf79-member, .th-hf79-member-tab, .th-hf79-group-builder, .th-hf79-payment-box').forEach(el => el.remove());
  }

  function mount(){
    if (!session.active()) return;
    const view = q('bookingWizardView');
    if (!view) return;
    view.classList.add('th-hf84-active');
    view.setAttribute('data-booking-core-version', VERSION);
    // A legacy navigation listener can mount the original schedule inside this view
    // before HF84 starts. Preserve that live runtime before replacing its shell.
    const schedule = q('subView_Schedule');
    const clients = q('clientsView');
    if (schedule && clients && view.contains(schedule)) clients.appendChild(schedule);
    hideOldLayers();

    let shell = q('thHF84Shell');
    if (!shell) {
      view.innerHTML = `
        <div id="thHF84Shell" class="th-hf84-shell">
          <div class="th-hf84-hero th-hf90b-entry-hero th-hf90b-entry-hero-compact">
            <div class="th-hf90b-entry-copy">
              <div class="th-hf84-kicker">THURAYA STAFF BOOKING</div>
              <h2>Start a Booking</h2>
            </div>
          </div>
          <div class="th-hf90b-booking-choice" id="thHF90BBookingChoice" aria-label="Booking type selection">
            <button type="button" class="th-hf90b-choice-card th-hf90b-choice-individual" onclick="thHF84SetMode('individual'); thHF84SetStep(1);">
              <span class="th-hf90b-icon" aria-hidden="true">👤</span>
              <strong>Individual Booking</strong>
              <small>One client, one appointment record</small>
              <span class="th-hf90b-cta">Continue Individual →</span>
            </button>
            <button type="button" class="th-hf90b-choice-card th-hf90b-choice-group th-hf90b-choice-primary-group" onclick="window.thHF87OpenGroup ? window.thHF87OpenGroup() : thHF84SetMode('group');">
              <span class="th-hf90b-icon" aria-hidden="true">👥</span>
              <strong>Group Booking</strong>
              <small>Multiple clients · per-member services</small>
              <span class="th-hf90b-cta">Open Group Module →</span>
            </button>
          </div>
          <div class="th-hf84-stepper" id="thHF84Stepper">
            <button type="button" class="th-hf84-step" data-step="1" onclick="thHF84SetStep(1)"><span>1</span>Client</button>
            <button type="button" class="th-hf84-step" data-step="2" onclick="thHF84SetStep(2)"><span>2</span>Services</button>
            <button type="button" class="th-hf84-step" data-step="3" onclick="thHF84SetStep(3)"><span>3</span>Date & Time</button>
            <button type="button" class="th-hf84-step" data-step="4" onclick="thHF84SetStep(4)"><span>4</span>Review</button>
          </div>
          <div class="th-hf84-grid">
            <div class="th-hf84-panel">
              <div id="thHF84Pane1" class="th-hf84-pane">
                <h3>Find Client</h3>
                <p class="th-hf84-sub">Search and select the client for this individual booking.</p>
                <div class="th-hf84-choice-grid th-hf90b-hidden-mode-cards" aria-hidden="true">
                  <button type="button" id="thHF84ChoiceIndividual" class="th-hf84-choice" onclick="thHF84SetMode('individual')"><strong>Individual Booking</strong><span>One client, one service package, one appointment record.</span></button>
                  <button type="button" id="thHF84ChoiceGroup" class="th-hf84-choice th-hf86-disabled-group" onclick="thHF84SetMode('group')"><strong>Group Booking</strong><span>Open the dedicated Staff group module from the booking start cards.</span></button>
                </div>
                <div id="thHF84GroupCard" class="th-hf84-group-card">
                  <div class="th-hf84-group-top">
                    <div><strong>Group Size</strong><br><span style="color:#666;font-size:.84rem;">Availability will look for the selected number of simultaneous technicians.</span></div>
                    <div class="th-hf84-counter"><button type="button" onclick="thHF84AdjustGroup(-1)">−</button><div class="th-hf84-count"><span id="thHF84GroupCount">2</span> people</div><button type="button" onclick="thHF84AdjustGroup(1)">+</button></div>
                  </div>
                  <div id="thHF84Members" class="th-hf84-members"></div>
                </div>
                <div id="thHF84ClientSlot" class="th-hf84-runtime-slot"></div>
                <div class="th-hf84-actions"><button type="button" class="btn th-hf84-primary" onclick="thHF84GoServices()">Continue to Services</button></div>
              </div>
              <div id="thHF84Pane2" class="th-hf84-pane">
                <h3>Select Services</h3><p class="th-hf84-sub">This is the live Menu_Settings_V2 menu. No fallback menu or simplified schema is used.</p>
                <div id="thHF84ServiceSlot" class="th-hf84-runtime-slot"></div>
                <div class="th-hf84-actions"><button type="button" class="btn btn-secondary" onclick="thHF84SetStep(1)">Back</button><button type="button" class="btn th-hf84-primary" onclick="thHF84GoTime()">Continue to Date & Time</button></div>
              </div>
              <div id="thHF84Pane3" class="th-hf84-pane">
                <h3>Date, Technician & Time</h3><p class="th-hf84-sub">Use a named technician or Any Available Technician. Group mode keeps one shared time and linked group records.</p>
                <div id="thHF84TimeSlot" class="th-hf84-runtime-slot"></div>
                <div class="th-hf84-actions"><button type="button" class="btn btn-secondary" onclick="thHF84SetStep(2)">Back</button><button type="button" class="btn th-hf84-primary" onclick="thHF84GoReview()">Review Booking</button></div>
              </div>
              <div id="thHF84Pane4" class="th-hf84-pane">
                <h3>Review & Confirm</h3><p class="th-hf84-sub">Confirm the booking exactly as it will be saved.</p>
                <div id="thHF84Review"></div>
                <div class="th-hf84-actions"><button type="button" class="btn btn-secondary" onclick="thHF84SetStep(3)">Back</button><button type="button" class="btn th-hf84-primary" onclick="thHF84ConfirmBooking()">Confirm Booking</button></div>
              </div>
            </div>
            <div class="th-hf84-side">
              <div class="th-hf84-summary"><h4>Live Summary</h4><div id="thHF84SummaryRows"></div></div>
              <div id="thHF84UpcomingSlot" class="th-hf84-upcoming-slot"></div>
            </div>
          </div>
          <div id="thHF84RuntimeMount" style="display:none"></div>
        </div>`;
    }

    moveRuntime();
    ensureAnyOption();
    syncRuntimeGroup();
    renderMembers();
    setStep(state.step || 1);
    refresh();
  }

  function setStep(step){
    state.step = Math.max(1, Math.min(4, parseInt(step,10)||1));
    document.querySelectorAll('.th-hf84-step').forEach(b => b.classList.toggle('active', String(b.dataset.step) === String(state.step)));
    for (let i=1;i<=4;i++) q('thHF84Pane'+i)?.classList.toggle('active', i === state.step);
    hideOldLayers();
    moveRuntime();
    refresh();
  }

  function validateClient(){
    if (!getLeadPhone() || !getLeadName()) { alert('Please search and select a lead client first.'); return false; }
    if (state.mode === 'group') {
      syncMembersFromDom();
      const unnamed = state.members.findIndex((m,i) => i > 0 && !String(m.name || '').trim());
      if (unnamed >= 0) { alert(`Please enter the name for Group Member ${unnamed + 1}.`); return false; }
    }
    return true;
  }
  function validateServices(){ if (!selectedServices().length) { alert('Please select at least one service.'); return false; } return true; }
  function validateTime(){
    const tech = selectedTech();
    if (!q('sched_date')?.value || !q('sched_time')?.value || !tech.email) { alert('Please select date, technician, and available time.'); return false; }
    return true;
  }

  function goServices(){ if (validateClient()) setStep(2); }
  function goTime(){ if (validateServices()) { try { window.generateTimeSlots?.(); } catch(e){} setStep(3); } }
  function goReview(){ if (validateClient() && validateServices() && validateTime()) setStep(4); }

  function refresh(renderMemberList=false){
    if (!session.active()) return;
    ensureAnyOption();
    const isGroup = state.mode === 'group';
    q('thHF84ChoiceIndividual')?.classList.toggle('active', !isGroup);
    q('thHF84ChoiceGroup')?.classList.toggle('active', isGroup);
    q('thHF84GroupCard')?.classList.toggle('active', isGroup);
    const gc = q('thHF84GroupCount'); if (gc) gc.textContent = String(state.groupSize || 1);
    if (renderMemberList) renderMembers();
    renderSummary();
    renderReview();
  }

  function renderSummary(){
    const tech = selectedTech();
    const rows = q('thHF84SummaryRows');
    if (!rows) return;
    const services = selectedServices();
    const date = q('sched_date')?.value || '—';
    const time = q('sched_time')?.value || '—';
    const dur = q('sched_totalDuration')?.innerText || '0';
    const total = q('sched_finalTotal')?.value || q('sched_totalCost')?.innerText || '0';
    rows.innerHTML = `
      <div class="th-hf84-summary-row"><span>Type</span><strong>${state.mode === 'group' ? 'Group · ' + state.groupSize + ' people' : 'Individual'}</strong></div>
      <div class="th-hf84-summary-row"><span>Client</span><strong>${esc(getLeadName() || 'Not selected')}</strong></div>
      <div class="th-hf84-summary-row"><span>Services</span><strong>${services.length || 0}</strong></div>
      <div class="th-hf84-summary-row"><span>Date / Time</span><strong>${esc(date)} ${esc(time)}</strong></div>
      <div class="th-hf84-summary-row"><span>Technician</span><strong>${esc(tech.name || 'Not selected')}</strong></div>
      <div class="th-hf84-summary-row"><span>Duration</span><strong>${esc(dur)} mins</strong></div>
      <div class="th-hf84-summary-row"><span>Total</span><strong>${money(total)} GHC</strong></div>`;
  }

  function renderReview(){
    const el = q('thHF84Review'); if (!el) return;
    const services = selectedServices();
    const tech = selectedTech();
    const gid = state.mode === 'group' ? makeGroupId() : '';
    const members = state.mode === 'group' ? state.members.map((m,i) => memberName(i)) : [];
    el.innerHTML = `
      <div class="th-hf84-review-card"><strong>${state.mode === 'group' ? 'Group Booking' : 'Individual Booking'}</strong><span>${state.mode === 'group' ? `${state.groupSize} linked appointments · Group ID ${esc(gid)}` : 'One appointment record'}</span></div>
      <div class="th-hf84-review-card"><strong>Lead Client</strong><span>${esc(getLeadName() || 'Not selected')} · ${esc(getLeadPhone() || '')}</span></div>
      ${state.mode === 'group' ? `<div class="th-hf84-review-card"><strong>Members</strong><span>${members.map(esc).join('<br>')}</span></div>` : ''}
      <div class="th-hf84-review-card"><strong>Services</strong><span>${services.length ? services.map(esc).join('<br>') : 'No services selected'}</span></div>
      <div class="th-hf84-review-card"><strong>Date & Time</strong><span>${esc(q('sched_date')?.value || 'No date')} · ${esc(q('sched_time')?.value || 'No time')} · ${esc(tech.name || 'No technician')}</span></div>
      <div class="th-hf84-review-card"><strong>Total</strong><span>${money(q('sched_finalTotal')?.value || q('sched_totalCost')?.innerText)} GHC · ${esc(q('sched_totalDuration')?.innerText || '0')} mins</span></div>`;
  }

  function basePayload(memberIndex, memberNameValue, groupId){
    const policy = window.thRequireCurrentTaxPolicy();
    if (state.mode === 'group') throw new Error('Use the current group booking workflow.');
    if (typeof window.thCurrentScheduleFinancials !== 'function') throw new Error('FINANCIAL_CALCULATOR_UNAVAILABLE');
    const canonicalFinancialShape = window.thCurrentScheduleFinancials();
    if (!canonicalFinancialShape || !canonicalFinancialShape.serviceLineItems.length) throw new Error('FINANCIAL_CALCULATION_UNAVAILABLE');
    const tech = selectedTech();
    const services = selectedServices();
    const bookingFinancials = {
      bookedService: canonicalFinancialShape.bookedService || services.join(', '),
      bookedDuration: String(canonicalFinancialShape.bookedDuration),
      bookedPrice: canonicalFinancialShape.bookedPrice,
      taxBreakdown: JSON.stringify(canonicalFinancialShape.taxBreakdown || []),
      grandTotal: canonicalFinancialShape.grandTotal,
      serviceLineItems: canonicalFinancialShape.serviceLineItems,
      serviceSubtotal: canonicalFinancialShape.serviceSubtotal,
      taxableSubtotal: canonicalFinancialShape.taxableSubtotal,
      taxTotal: canonicalFinancialShape.taxTotal,
      amountDue: canonicalFinancialShape.amountDue,
      groupTotal: canonicalFinancialShape.grandTotal,
      memberServiceTotal: canonicalFinancialShape.memberServiceTotal,
      payableShare: canonicalFinancialShape.payableShare,
      finalTotal: canonicalFinancialShape.finalTotal,
      totalGHC: canonicalFinancialShape.totalGHC,
      pricingMode: canonicalFinancialShape.pricingMode,
      taxPricingMode: canonicalFinancialShape.taxPricingMode
    };
    return {
      financialPolicySnapshot: canonicalFinancialShape.financialPolicySnapshot || policy,
      adjustments: canonicalFinancialShape.adjustments || [],
      adjustmentTotal: canonicalFinancialShape.adjustmentTotal || 0,
      clientPhone: getLeadPhone(),
      clientName: memberNameValue,
      leadClientName: getLeadName(),
      leadClientPhone: getLeadPhone(),
      groupMemberIndex: memberIndex,
      dateString: q('sched_date')?.value || '',
      timeString: q('sched_time')?.value || '',
      assignedTechEmail: tech.email === ANY ? '' : tech.email,
      assignedTechName: tech.email === ANY ? 'Any available technician' : tech.name,
      bookedService: bookingFinancials.bookedService,
      bookedDuration: bookingFinancials.bookedDuration,
      bookedPrice: bookingFinancials.bookedPrice,
      taxBreakdown: bookingFinancials.taxBreakdown,
      grandTotal: bookingFinancials.grandTotal,
      serviceLineItems: bookingFinancials.serviceLineItems,
      serviceSubtotal: bookingFinancials.serviceSubtotal,
      taxTotal: bookingFinancials.taxTotal,
      amountDue: bookingFinancials.amountDue,
      groupTotal: bookingFinancials.groupTotal,
      memberServiceTotal: bookingFinancials.memberServiceTotal,
      payableShare: bookingFinancials.payableShare,
      ...(canonicalFinancialShape ? {
        taxableSubtotal: bookingFinancials.taxableSubtotal,
        totalGHC: bookingFinancials.totalGHC,
        pricingMode: bookingFinancials.pricingMode,
        taxPricingMode: bookingFinancials.taxPricingMode
      } : {}),
      promoCode: q('sched_promoCode')?.value || '',
      promoName: q('sched_promoName')?.value || '',
      promoType: q('sched_promoType')?.value || '',
      discountPercent: Number(q('sched_discountPercent')?.value || 0),
      discountAmount: canonicalFinancialShape.adjustmentTotal || 0,
      originalTotal: canonicalFinancialShape.grandTotal,
      finalTotal: bookingFinancials.finalTotal,
      hasPromoApplied: !!(q('sched_promoCode')?.value || ''),
      packageWalletId: q('sched_packageWalletId')?.value || '',
      packageSessionsUsed: nint(q('sched_packageSessionsUsed')?.value, 0),
      packageRemainingAfter: q('sched_packageRemainingAfter')?.value === '' ? null : nint(q('sched_packageRemainingAfter')?.value, 0),
      isPackageRedemption: !!(q('sched_packageWalletId')?.value || ''),
      status: 'Scheduled',
      bookedBy: window.currentUserEmail || (typeof currentUserEmail !== 'undefined' ? currentUserEmail : ''),
      groupSize: state.mode === 'group' ? state.groupSize : 1,
      isGroupBooking: state.mode === 'group',
      groupId: state.mode === 'group' ? groupId : '',
      groupRole: state.mode === 'group' ? (memberIndex === 0 ? 'lead' : 'member') : '',
      bookingCoreVersion: VERSION,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp()
    };
  }
  async function confirmBooking(){
    syncMembersFromDom();
    if (state.bookingInProgress) return;
    if (typeof editingApptId !== 'undefined' && editingApptId) {
      alert('Use Quick Edit to preserve this appointment\'s financial evidence.');
      return;
    }
    if (!(validateClient() && validateServices() && validateTime())) return;
    const date = q('sched_date')?.value || '';
    if (typeof todayDateStr !== 'undefined' && date < todayDateStr) { alert('You cannot create an appointment in the past.'); return; }

    state.bookingInProgress = true;
    const btns = Array.from(document.querySelectorAll('#thHF84Pane4 button'));
    btns.forEach(b => b.disabled = true);
    try {
      if (window.THURAYA_TRUSTED_BOOKING === true) {
        if (state.mode !== 'individual') throw Error('Use the Group Booking workflow for linked appointments.');
        if (!window.ThurayaLocalStaffBooking) throw Error('Trusted local Staff booking is unavailable.');
        const receipt = await window.ThurayaLocalStaffBooking.submit([basePayload(0, getLeadName(), '')]);
        alert('Appointment saved with verified slot.');
        window.cancelEditMode?.();
        resetHF84();
        return receipt;
      }
      if (window.thurayaMenuPricingBookingQuote || window.thurayaRequiresQualifiedBooking?.()) {
        if (state.mode === 'group') throw new Error('Protected versioned group booking route is not connected.');
        if (typeof window.thurayaSubmitVersionedStaffBooking !== 'function') throw new Error('Protected price-version booking route is not connected. This reviewed selection was not saved.');
        const committed = await window.thurayaSubmitVersionedStaffBooking({ payload: basePayload(0, getLeadName(), ''), priceQuote: window.thurayaMenuPricingBookingQuote });
        if (!committed?.committed) throw new Error('Protected booking confirmation is required.');
        window.thurayaMenuPricingBookingQuote = null;
        alert('Appointment saved with verified slot.');
        try { window.cancelEditMode?.(); } catch(e) {}
        resetHF84();
        return;
      }
      const validateAssignment = async payload => {
        if (typeof window.thurayaValidateStaffScheduleAssignments !== 'function') throw new Error('Working schedule could not be verified. Please retry.');
        await window.thurayaValidateStaffScheduleAssignments([{
          techEmail: payload.assignedTechEmail, date: payload.dateString,
          time: payload.timeString, duration: Number(payload.bookedDuration)
        }]);
      };
      if (typeof editingApptId !== 'undefined' && editingApptId) {
        if (state.mode === 'group') { alert('Group edit is temporarily limited. Please edit members individually from Upcoming Schedule.'); return; }
        const payload = basePayload(0, getLeadName(), '');
        await validateAssignment(payload);
        await db.collection('Appointments').doc(editingApptId).update(payload);
        alert('Appointment successfully updated.');
      } else if (state.mode === 'group') {
        syncRuntimeGroup();
        const gid = makeGroupId();
        const payloads = state.members.map((m, i) => basePayload(i, memberName(i), gid));
        if (typeof window.thurayaValidateStaffScheduleAssignments !== 'function') throw new Error('Working schedule could not be verified. Please retry.');
        await window.thurayaValidateStaffScheduleAssignments(payloads.map(payload => ({ techEmail: payload.assignedTechEmail, date: payload.dateString, time: payload.timeString, duration: Number(payload.bookedDuration) })));
        const batch = db.batch();
        ensureMembers();
        state.members.forEach((m, i) => {
          const ref = db.collection('Appointments').doc();
          batch.set(ref, {
            ...payloads[i],
            groupMemberCount: state.groupSize,
            sharedServiceBooking: true,
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
          });
        });
        await batch.commit();
        alert(`Group booking confirmed.\n\nGroup ID: ${gid}\nMembers booked: ${state.groupSize}`);
      } else {
        const payload = basePayload(0, getLeadName(), '');
        payload.createdAt = firebase.firestore.FieldValue.serverTimestamp();
        await validateAssignment(payload);
        await db.collection('Appointments').add(payload);
        alert('Appointment successfully secured.');
      }
      try { window.cancelEditMode?.(); } catch(e) {}
      resetHF84();
    } catch(e) {
      alert('Error booking: ' + (e.message || e));
    } finally {
      state.bookingInProgress = false;
      btns.forEach(b => b.disabled = false);
      refresh();
    }
  }

  function resetHF84(){
    state.step = 1; state.mode = 'individual'; state.groupSize = 1; state.members = [];
    const gid = q('sched_groupId'); if (gid) gid.value = '';
    const sel = q('sched_groupSize'); if (sel) sel.value = '1';
    setStep(1);
  }

  window.thHF84BuildPricingPayload=()=>{const payload=basePayload(0,getLeadName(),'');delete payload.updatedAt;delete payload.createdAt;return payload;};

  // Public API
  window.thHF84SetStep = setStep;
  window.thHF84SetMode = setMode;
  window.thHF84AdjustGroup = adjustGroup;
  window.thHF84UpdateMember = updateMember;
  window.thHF84GoServices = goServices;
  window.thHF84GoTime = goTime;
  window.thHF84GoReview = goReview;
  window.thHF84ConfirmBooking = confirmBooking;
  window.thHF84Refresh = refresh;

  // Retire old layered wizard public surfaces without touching core engines.
  window.thB11SetStep = function(){ return false; };
  window.thB11GoServices = function(){ return false; };
  window.thB11GoTime = function(){ return false; };
  window.thB11GoReview = function(){ return false; };
  window.thB11RefreshState = refresh;
  window.thHF79SwitchMember = function(){ return false; };
  window.thHF79UpdateMemberName = function(){ return false; };
  window.thHF79SetBillingMode = function(){ return false; };
  window.thHF79SaveActive = function(){ return false; };

  // Sync after existing runtime actions.
  ['click','change','input'].forEach(evt => document.addEventListener(evt, function(e){
    const t = e.target;
    if (!t) return;
    if (t.closest && (t.closest('#sched_serviceMenu') || t.closest('#sched_timeSlots') || t.id === 'sched_date' || t.id === 'sched_techSelect' || t.id === 'sched_search')) {
      session.timeout(() => refresh(false), 80);
    }
  }, true));

  const oldSelectClient = window.selectClientForSchedule;
  if (typeof oldSelectClient === 'function' && !oldSelectClient.__hf84Wrapped) {
    window.selectClientForSchedule = function(clientData){
      const out = oldSelectClient.apply(this, arguments);
      session.timeout(() => { ensureMembers(); if (state.members[0]) state.members[0].name = getLeadName(); renderMembers(true); refresh(false); }, 80);
      return out;
    };
    window.selectClientForSchedule.__hf84Wrapped = true;
  }

  const oldOnGroupSizeChange = window.onGroupSizeChange;
  window.onGroupSizeChange = function(){
    const val = nint(q('sched_groupSize')?.value, 1);
    state.mode = val > 1 ? 'group' : 'individual';
    state.groupSize = Math.max(1, val);
    syncRuntimeGroup();
    try { if (oldOnGroupSizeChange && oldOnGroupSizeChange !== window.onGroupSizeChange) oldOnGroupSizeChange.apply(this, arguments); } catch(e) {}
    refresh();
  };

  const oldSwitch = window.switchModule;
  if (typeof oldSwitch === 'function' && !oldSwitch.__hf84Wrapped) {
    window.switchModule = function(moduleId){
      const out = oldSwitch.apply(this, arguments);
      if (moduleId === 'bookingWizardView') session.timeout(mount, 60);
      return out;
    };
    window.switchModule.__hf84Wrapped = true;
  }

  function boot(){
    if (!session.active()) return;
    mount();
    ensureAnyOption();
    hideOldLayers();
    if (q('bookingWizardView')?.style.display === 'block' || q('nav_new_booking')?.checked) setStep(state.step || 1);
  }

  function startBoot(){
    session.onStart('booking-core-boot', boot);
    session.startupTimeout('booking-core-250', boot, 250);
    session.startupTimeout('booking-core-900', boot, 900);
    session.startupTimeout('booking-core-1800', boot, 1800);
  }
  document.addEventListener('DOMContentLoaded', startBoot, { once:true });
  if (document.readyState !== 'loading') startBoot();

  console.log('THURAYA STAFF HF86 booking core loaded. Individual stable; group rebuild frozen.');
})();
