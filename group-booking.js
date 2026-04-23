// ============================================================
//  GROUP BOOKING — app.js additions
//  Paste this entire block at the BOTTOM of app.js
//
//  Also make these 3 small edits to existing app.js code:
//
//  EDIT 1 — line ~150 (inside auth.onAuthStateChanged, returning user branch):
//    CHANGE:  goToStep('screen-services');
//    TO:      goToStep('screen-booking-mode');
//
//  EDIT 2 — saveProfile() function, last line before catch:
//    CHANGE:  goToStep('screen-services');
//    TO:      goToStep('screen-booking-mode');
//
//  EDIT 3 — saveGuestProfile() function:
//    CHANGE:  goToStep('screen-services');
//    TO:      goToStep('screen-booking-mode');
//
//  EDIT 4 — bk_bookAgain() function at bottom of app.js:
//    CHANGE:  goToStep('screen-services');
//    TO:      goToStep('screen-booking-mode');
// ============================================================


// ── Group state ───────────────────────────────────────────────
let grp_groupSize    = 2;
let grp_activeMember = 0;        // index of tab currently shown
let grp_members      = [];       // [{ name, serviceId, serviceName, serviceDuration, servicePrice, dept }]
let grp_groupId      = null;     // shared Firestore groupId written on confirm


// ── Solo shortcut (replaces direct goToStep calls) ────────────
window.grp_soloMode = function() {
    goToStep('screen-services');
};


// ── Group size picker ─────────────────────────────────────────
window.grp_changeSize = function(delta) {
    grp_groupSize = Math.min(6, Math.max(2, grp_groupSize + delta));
    const el = document.getElementById('grp_sizeNumber');
    if (el) el.textContent = grp_groupSize;
};

window.grp_initMembers = function() {
    // Each member stores the same shape as bk_selectedServices
    // selectedServices: [{ id, type, price, dur, name, qty }]
    grp_members = Array.from({ length: grp_groupSize }, (_, i) => ({
        name:             i === 0 ? (bk_clientProfile?.name || '') : '',
        selectedServices: [],
        dept:             'Hand'
    }));
    grp_activeMember = 0;
    grp_renderMemberTab(0);
    goToStep('screen-group-services');
};


// ── Tab rendering ─────────────────────────────────────────────
function grp_renderTabs() {
    const container = document.getElementById('grp_personTabs');
    if (!container) return;
    container.innerHTML = grp_members.map((m, i) => {
        const done   = m.selectedServices && m.selectedServices.length > 0;
        const active = i === grp_activeMember;
        return `<button
            class="grp-tab ${active ? 'grp-tab--active' : ''} ${done && !active ? 'grp-tab--done' : ''}"
            onclick="grp_renderMemberTab(${i})">
            ${done ? '<span class="grp-tab-check">✓</span>' : ''}
            ${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}
        </button>`;
    }).join('');
}

window.grp_renderMemberTab = function(index) {
    grp_activeMember = index;
    const member = grp_members[index];

    // Name input
    const nameInput = document.getElementById('grp_activeName');
    const nameLabel = document.getElementById('grp_nameLabel');
    if (nameInput) nameInput.value = member.name;
    if (nameLabel) nameLabel.textContent = index === 0 ? 'Your name' : `Person ${index + 1}'s name`;

    // Dept toggle
    document.querySelectorAll('#grp_deptToggle .dept-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.dept === member.dept);
    });

    grp_renderServiceList();
    grp_renderTabs();
    grp_updateProgress();
};

window.grp_saveName = function(val) {
    if (grp_members[grp_activeMember] !== undefined) {
        grp_members[grp_activeMember].name = val;
        grp_renderTabs(); // refresh tab label live
    }
};


// ── Dept switcher (group version) ────────────────────────────
window.grp_switchDept = function(dept, btn) {
    grp_members[grp_activeMember].dept = dept;
    document.querySelectorAll('#grp_deptToggle .dept-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    grp_renderServiceList();
};


// ── Service list for active member ───────────────────────────
// Mirrors _buildCard() / renderMenuForDept() from app.js exactly —
// same radio, checkbox, counter logic, same category groupings.
function grp_renderServiceList() {
    const container = document.getElementById('grp_serviceList');
    if (!container) return;

    const member = grp_members[grp_activeMember];
    const dept   = member.dept || 'Hand';
    const sel    = member.selectedServices || [];

    // ── Build dbData the same way renderMenuForDept does ──────
    const ALIASES = {
        'I. HAND THERAPIES':  'I. HAND THERAPY RITUALS',
        'I. HAND THERAPIES ': 'I. HAND THERAPY RITUALS',
    };
    const T_ORDER = { radio: 0, checkbox: 1, counter: 2 };

    const dbData = { Hand: {}, Foot: {} };
    bk_menuServices.forEach(s => {
        let cat = ((s.category || 'Uncategorized').trim().replace(/\s+/g, ' '));
        cat = ALIASES[cat] ?? ALIASES[cat.toUpperCase()] ?? cat;
        if (s.department === 'Both') {
            ['Hand','Foot'].forEach(d => {
                if (!dbData[d][cat]) dbData[d][cat] = [];
                dbData[d][cat].push(s);
            });
        } else {
            const d = s.department || 'Hand';
            if (!dbData[d]) dbData[d] = {};
            if (!dbData[d][cat]) dbData[d][cat] = [];
            dbData[d][cat].push(s);
        }
    });

    Object.values(dbData).forEach(dObj =>
        Object.values(dObj).forEach(arr =>
            arr.sort((a, b) => (T_ORDER[a.inputType] ?? 1) - (T_ORDER[b.inputType] ?? 1))
        )
    );

    const numRe = /^(\d+|I{1,3}|IV|V|VI|VII|VIII|IX|X)\./i;
    const sortedCats = Object.keys(dbData[dept] || {}).sort((a, b) => {
        const aU = a.trim().toUpperCase(), bU = b.trim().toUpperCase();
        const aNum = numRe.test(aU), bNum = numRe.test(bU);
        if (aNum && !bNum) return -1;
        if (!aNum && bNum) return  1;
        const aR = (dbData[dept][a][0]?.inputType || 'checkbox') === 'radio';
        const bR = (dbData[dept][b][0]?.inputType || 'checkbox') === 'radio';
        if (aR && !bR) return -1;
        if (!aR && bR) return  1;
        return aU.localeCompare(bU, undefined, { numeric: true, sensitivity: 'base' });
    });

    if (!sortedCats.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px 0;">No services available for this category.</p>';
        return;
    }

    // ── Render using _grp_buildCard (mirrors _buildCard) ──────
    let html = '';
    sortedCats.forEach(cat => {
        const items   = dbData[dept][cat];
        const singles = items.filter(s => (s.inputType || 'radio') === 'radio');
        const multis  = items.filter(s => (s.inputType || 'radio') !== 'radio');

        html += `<div class="menu-section"><div class="menu-section-heading">${cat}</div>`;

        if (singles.length && multis.length) {
            html += `<div class="menu-subgroup-label">Choose your ritual <span style="color:#bbb;font-size:0.68rem;text-transform:none;letter-spacing:0;">— select one</span></div>`;
            singles.forEach(s => { html += _grp_buildCard(s, dept, sel); });
            html += `<div class="menu-subgroup-divider"></div>`;
            html += `<div class="menu-subgroup-label">Enhancements &amp; Add-ons <span style="color:#bbb;font-size:0.68rem;text-transform:none;letter-spacing:0;">— select any</span></div>`;
            multis.forEach(s => { html += _grp_buildCard(s, dept, sel); });
        } else {
            items.forEach(s => { html += _grp_buildCard(s, dept, sel); });
        }

        html += `</div>`;
    });

    container.innerHTML = html;

    // Restore counter values
    sel.filter(s => s.type === 'counter').forEach(s => {
        const el = document.getElementById('grp_qty_' + s.id);
        if (el) el.value = s.qty || 0;
    });
}

// ── Mirrors _buildCard() exactly, scoped to group member ─────
function _grp_buildCard(s, dept, sel) {
    const type     = s.inputType || 'radio';
    const name     = s.name      || 'Service';
    const dur      = Number(s.duration) || 0;
    const price    = Number(s.price)    || 0;
    const descHtml = s.desc ? `<div class="service-card-desc">${s.desc}</div>` : '';
    const tagHtml  = (s.tag && s.tag !== 'None') ? `<span class="hl-tag">${s.tag}</span>` : '';
    const priceTag = `<span class="service-price-pill">${dur > 0 ? dur + ' mins &nbsp;|&nbsp; ' : ''}${price} GHC</span>`;
    const safeName = name.replace(/'/g, "\\'");

    if (type === 'counter') {
        const qty = sel.find(x => x.id === s.id)?.qty || 0;
        return `
            <div class="service-card" style="align-items:center;">
                <div class="service-card-body" style="pointer-events:none;">
                    <div class="service-card-name">${name} ${tagHtml}</div>
                    ${descHtml}${priceTag}
                </div>
                <div class="counter-box">
                    <button class="counter-btn" onclick="grp_updateCounter('${s.id}',${price},${dur},'${safeName}',-1)">−</button>
                    <input type="number" id="grp_qty_${s.id}" value="${qty}" min="0" readonly
                        style="width:44px;height:36px;text-align:center;padding:4px;font-weight:700;border:1px solid var(--border);border-radius:6px;">
                    <button class="counter-btn" onclick="grp_updateCounter('${s.id}',${price},${dur},'${safeName}',1)">+</button>
                </div>
            </div>`;
    }

    const groupName = type === 'radio' ? `grp_base_${dept}_${grp_activeMember}` : `grp_cb_${s.id}`;
    const isSelected = sel.some(x => x.id === s.id);
    const inputEl = type === 'radio'
        ? `<input type="radio" name="${groupName}" id="grp_cb_${s.id}"
               style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;"
               ${isSelected ? 'checked' : ''}>`
        : `<input type="checkbox" id="grp_cb_${s.id}"
               style="width:18px;height:18px;min-width:18px;flex-shrink:0;pointer-events:none;accent-color:var(--gold);margin-top:2px;"
               ${isSelected ? 'checked' : ''}>`;

    return `
        <div class="service-card ${isSelected ? 'selected' : ''}"
            onclick="grp_toggleCard(event,this,'${s.id}','${type}','${groupName}',${price},${dur},'${safeName}')">
            ${inputEl}
            <div class="service-card-body">
                <div class="service-card-name">${name} ${tagHtml}</div>
                ${descHtml}${priceTag}
            </div>
        </div>`;
}

// ── Toggle card — mirrors bk_toggleCard scoped to member ─────
window.grp_toggleCard = function(event, card, id, type, groupName, price, dur, name) {
    event.preventDefault();
    const member = grp_members[grp_activeMember];
    const input  = document.getElementById('grp_cb_' + id);
    if (!input) return;

    if (type === 'radio') {
        // Deselect all in group, remove from member selections
        document.querySelectorAll(`input[name="${groupName}"]`).forEach(r => {
            r.checked = false;
            r.closest('.service-card')?.classList.remove('selected');
        });
        member.selectedServices = member.selectedServices.filter(s => {
            const el = document.getElementById('grp_cb_' + s.id);
            return !el || el.name !== groupName;
        });
        const wasSelected = input.checked;
        if (!wasSelected) {
            input.checked = true;
            card.classList.add('selected');
            member.selectedServices.push({ id, type, price, dur, name, qty: 1 });
        }
    } else {
        input.checked = !input.checked;
        card.classList.toggle('selected', input.checked);
        if (input.checked) {
            member.selectedServices.push({ id, type, price, dur, name, qty: 1 });
        } else {
            member.selectedServices = member.selectedServices.filter(s => s.id !== id);
        }
    }
    grp_renderTabs();
    grp_updateProgress();
};

// ── Counter — mirrors bk_updateCounter scoped to member ──────
window.grp_updateCounter = function(id, price, dur, name, delta) {
    const input  = document.getElementById('grp_qty_' + id);
    const member = grp_members[grp_activeMember];
    if (!input) return;
    let val = Math.max(0, (parseInt(input.value) || 0) + delta);
    input.value = val;
    member.selectedServices = member.selectedServices.filter(s => s.id !== id);
    if (val > 0) member.selectedServices.push({ id, type: 'counter', price, dur, name, qty: val });
    grp_renderTabs();
    grp_updateProgress();
};


// ── Progress bar & continue button ───────────────────────────
function grp_updateProgress() {
    const done    = grp_members.filter(m => m.selectedServices && m.selectedServices.length > 0).length;
    const total   = grp_members.length;
    const allDone = done === total;

    const progressEl  = document.getElementById('grp_progressText');
    const nextBtn     = document.getElementById('grp_nextPersonBtn');
    const continueBtn = document.getElementById('grp_toDateTimeBtn');

    if (progressEl) progressEl.textContent = `${done} of ${total} selected`;

    // Show "Next person" nudge if current member has selections but is not the last
    const currentDone = grp_members[grp_activeMember].selectedServices?.length > 0;
    const isLast      = grp_activeMember === total - 1;
    if (nextBtn) nextBtn.style.display = (currentDone && !isLast) ? 'inline' : 'none';

    if (continueBtn) continueBtn.disabled = !allDone;
}

window.grp_nextPerson = function() {
    if (grp_activeMember < grp_members.length - 1) {
        grp_renderMemberTab(grp_activeMember + 1);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
};


// ── Navigate to date/time ─────────────────────────────────────
window.grp_goToDateTime = function() {
    // Set min date on group date picker
    const dateEl = document.getElementById('grp_date');
    if (dateEl) { dateEl.min = todayStr; dateEl.value = ''; }

    // Reset slot state
    const slotsContainer = document.getElementById('grp_slotsContainer');
    if (slotsContainer) slotsContainer.style.display = 'none';
    document.getElementById('grp_time').value = '';
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    // Update subtitle
    const sub = document.getElementById('grp_datetimeSubtitle');
    if (sub) sub.textContent =
        `Showing slots where all ${grp_members.length} people can be seen at the same time.`;

    goToStep('screen-group-datetime');
};


// ── Slot generation ───────────────────────────────────────────
// Uses real Firestore Appointments data to check availability.
// For each slot: queries whether any appointment conflicts for
// each service's required duration window.

window.grp_generateSlots = async function() {
    const dateEl = document.getElementById('grp_date');
    const dateStr = dateEl?.value;
    if (!dateStr) return;

    const container = document.getElementById('grp_slotsContainer');
    const grid      = document.getElementById('grp_slots');
    if (!grid || !container) return;

    container.style.display = 'block';
    grid.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1;">Checking availability…</div>';

    // Reset time selection
    document.getElementById('grp_time').value = '';
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        // Fetch all appointments for this date once
        const snap = await db.collection('Appointments')
            .where('dateString', '==', dateStr)
            .where('status', 'in', ['Scheduled', 'Arrived', 'In Progress'])
            .get();

        const bookedSlots = []; // [{ techEmail, startMins, endMins }]
        snap.forEach(doc => {
            const d = doc.data();
            if (!d.timeString || !d.bookedDuration) return;
            const [hh, mm] = d.timeString.split(':').map(Number);
            const startMins = hh * 60 + mm;
            bookedSlots.push({
                techEmail: d.assignedTechEmail || '',
                startMins,
                endMins: startMins + (parseInt(d.bookedDuration) || 0)
            });
        });

        // Build time slots from 09:00 to 17:30 in 30-min steps
        const slots = [];
        for (let h = 9; h <= 17; h++) {
            for (let m of [0, 30]) {
                if (h === 17 && m === 30) continue;
                slots.push(h * 60 + m);
            }
        }

        // For each slot check if ALL members can be accommodated.
        // Since the client doesn't pick techs, we check if there are
        // enough non-conflicting tech slots for all services simultaneously.
        // Simplified: slot is "available" if it's not past 5pm minus
        // the longest service duration, and within business hours.
        const maxDuration = Math.max(...grp_members.map(m =>
            (m.selectedServices || []).reduce((sum, s) => sum + (s.dur * (s.qty || 1)), 0) || 60
        ));
        const closingMins = 18 * 60; // 6pm hard close

        let html = '';
        let anyAvailable = false;

        slots.forEach(startMins => {
            // Don't offer slots that would run past closing
            if (startMins + maxDuration > closingMins) return;

            const hh = Math.floor(startMins / 60);
            const mm = startMins % 60;
            const timeStr  = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
            const displayH = hh > 12 ? hh - 12 : hh;
            const period   = hh >= 12 ? 'PM' : 'AM';
            const label    = `${displayH}:${String(mm).padStart(2,'0')} ${period}`;

            // Check: does the booked list have enough conflicts to block ALL techs?
            // Real implementation: each member needs one free tech with the right service skill.
            // Here we count how many "tech-slots" are blocked in this window and compare to
            // total available techs — a conservative but correct approximation.
            const windowEnd = startMins + maxDuration;
            const conflictsInWindow = bookedSlots.filter(b =>
                b.startMins < windowEnd && b.endMins > startMins
            ).length;

            // Available if fewer conflicts than total techs (bk_techs loaded at login)
            const totalTechs   = Math.max(bk_techs.length, 1);
            const neededTechs  = grp_members.length;
            const freeTechs    = totalTechs - conflictsInWindow;
            const available    = freeTechs >= neededTechs;

            if (available) anyAvailable = true;

            html += `
            <button class="slot-btn ${available ? '' : 'slot-btn--taken'}"
                ${available ? '' : 'disabled'}
                onclick="grp_selectSlot('${timeStr}', this)">
                ${label}
            </button>`;
        });

        grid.innerHTML = html || '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;padding:16px 0;">No slots available.</p>';

        if (!anyAvailable) {
            grid.innerHTML += '<p style="color:var(--text-muted);font-size:0.82rem;text-align:center;grid-column:1/-1;">Try a different date.</p>';
        }

    } catch (e) {
        grid.innerHTML = `<p style="color:var(--error);grid-column:1/-1;">Could not load slots: ${e.message}</p>`;
    }
};

window.grp_selectSlot = function(timeStr, btn) {
    document.querySelectorAll('#grp_slots .slot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('grp_time').value = timeStr;
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = false;
};


// ── Populate & navigate to confirm screen ─────────────────────
// Override goToStep for screen-group-confirm to populate first
const _origGoToStep = goToStep;
window.goToStep = function(id) {
    if (id === 'screen-group-confirm') grp_populateConfirm();
    _origGoToStep(id);
};

function grp_populateConfirm() {
    const dateStr = document.getElementById('grp_date')?.value || '';
    const timeStr = document.getElementById('grp_time')?.value || '';

    let dateFormatted = dateStr;
    try { dateFormatted = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB',
        { weekday:'long', day:'numeric', month:'long' }); } catch(e) {}

    let timeFormatted = timeStr;
    try {
        const [h, m] = timeStr.split(':').map(Number);
        timeFormatted = `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    } catch(e) {}

    document.getElementById('grp_conf_date').textContent = dateFormatted;
    document.getElementById('grp_conf_time').textContent = timeFormatted;
    document.getElementById('grp_conf_size').textContent = `${grp_members.length} people`;

    const membersEl = document.getElementById('grp_conf_members');
    if (membersEl) {
        membersEl.innerHTML = grp_members.map((m, i) => {
            const services  = (m.selectedServices || []).map(s => `${s.name}${s.qty > 1 ? ' (x'+s.qty+')' : ''}`).join(', ');
            const totalMins = (m.selectedServices || []).reduce((sum, s) => sum + (s.dur * (s.qty || 1)), 0);
            const totalPrice= (m.selectedServices || []).reduce((sum, s) => sum + (s.price * (s.qty || 1)), 0);
            return `
            <div class="grp-member-card">
                <div class="grp-member-index">${i + 1}</div>
                <div class="grp-member-info">
                    <strong>${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}
                        ${i === 0 ? '<span class="grp-lead-badge">Lead booker</span>' : ''}
                    </strong>
                    <span>${services || '—'} · ${totalMins} mins · ${totalPrice.toFixed(0)} GHC</span>
                </div>
            </div>`;
        }).join('');
    }
}


// ── Batch Firestore write ─────────────────────────────────────
window.grp_confirmBooking = async function() {
    const btn     = document.getElementById('grp_btnConfirm');
    const dateStr = document.getElementById('grp_date')?.value || '';
    const timeStr = document.getElementById('grp_time')?.value || '';

    if (!dateStr || !timeStr) { toast('Missing date or time.', 'warning'); return; }

    setBtnLoading(btn, true, 'Confirm Group Booking');
    try {
        grp_groupId = db.collection('Appointments').doc().id;

        // FIX: ensure bk_techs is loaded before assigning techs
        if (typeof bk_techs === 'undefined' || bk_techs.length === 0) {
            try { await loadTechs(); } catch(e) {}
        }

        // If still empty after load, fetch directly
        let availableTechs = (typeof bk_techs !== 'undefined' && bk_techs.length > 0)
            ? bk_techs
            : [];

        if (!availableTechs.length) {
            // Last resort — load techs directly from Firestore
            try {
                const snap = await db.collection('Users').get();
                snap.forEach(doc => {
                    const d = doc.data();
                    const roles = (Array.isArray(d.roles) ? d.roles : [d.role||'']).map(r=>(r||'').toLowerCase());
                    if (roles.some(r => r.includes('tech')) && d.visibleToClients !== false) {
                        availableTechs.push({ email: doc.id, name: d.name || doc.id });
                    }
                });
            } catch(e) {}
        }

        // Final fallback
        if (!availableTechs.length) {
            availableTechs = [{ email: '', name: 'To be assigned' }];
        }

        const batch = db.batch();

        grp_members.forEach((m, i) => {
            const ref        = db.collection('Appointments').doc();
            const services   = (m.selectedServices || []).map(s => `${s.name}${s.qty > 1 ? ' (x'+s.qty+')' : ''}`).join(', ');
            const totalMins  = (m.selectedServices || []).reduce((sum, s) => sum + (s.dur  * (s.qty || 1)), 0);
            const totalPrice = (m.selectedServices || []).reduce((sum, s) => sum + (s.price * (s.qty || 1)), 0);

            // Round-robin tech assignment
            const tech = availableTechs[i % availableTechs.length];

            batch.set(ref, {
                groupId:           grp_groupId,
                groupSize:         grp_members.length,
                isGroupBooking:    true,
                isLeadBooker:      i === 0,
                clientName:        m.name || (i === 0 ? (bk_clientProfile?.name || '') : ''),
                clientEmail:       i === 0 ? (bk_currentUser?.email || '') : '',
                clientPhone:       i === 0 ? (bk_clientProfile?.phone || '') : '',
                bookedService:     services,
                bookedDuration:    totalMins,
                bookedPrice:       totalPrice,
                grandTotal:        totalPrice,
                dateString:        dateStr,
                timeString:        timeStr,
                status:            'Scheduled',
                source:            'client-group-booking',
                bookedBy:          bk_isGuest
                                    ? ('guest:' + (bk_clientProfile?.phone || ''))
                                    : (bk_currentUser?.email || ''),
                assignedTechName:  tech.name  || 'To be assigned',
                assignedTechEmail: tech.email || '',
                createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt:         firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        grp_populateSuccess(dateStr, timeStr);
        _screenHistory = ['screen-welcome', 'screen-booking-mode'];
        goToStep('screen-group-success');

    } catch (e) {
        toast('Booking failed: ' + e.message, 'error');
    } finally {
        setBtnLoading(btn, false, 'Confirm Group Booking');
    }
};


// ── Success screen ────────────────────────────────────────────
function grp_populateSuccess(dateStr, timeStr) {
    let dateFormatted = dateStr;
    try { dateFormatted = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB',
        { weekday:'long', day:'numeric', month:'long' }); } catch(e) {}

    let timeFormatted = timeStr;
    try {
        const [h, m] = timeStr.split(':').map(Number);
        timeFormatted = `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
    } catch(e) {}

    document.getElementById('grp_suc_datetime').textContent = `${dateFormatted} at ${timeFormatted}`;
    document.getElementById('grp_suc_size').textContent     = `${grp_members.length} people`;
    document.getElementById('grp_suc_ref').textContent      = grp_groupId?.slice(0, 8).toUpperCase() || '—';

    const membersEl = document.getElementById('grp_suc_members');
    if (membersEl) {
        membersEl.innerHTML = grp_members.map((m, i) => {
            const services  = (m.selectedServices || []).map(s => `${s.name}${s.qty > 1 ? ' (x'+s.qty+')' : ''}`).join(', ');
            const totalMins = (m.selectedServices || []).reduce((sum, s) => sum + (s.dur * (s.qty || 1)), 0);
            return `
            <div class="grp-member-card">
                <div class="grp-member-index">${i + 1}</div>
                <div class="grp-member-info">
                    <strong>${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}</strong>
                    <span>${services || '—'} · ${totalMins} mins</span>
                </div>
            </div>`;
        }).join('');
    }
}


window.grp_bookAgain = function() {
    grp_groupSize    = 2;
    grp_activeMember = 0;
    grp_members      = [];
    grp_groupId      = null;
    _screenHistory   = ['screen-welcome'];
    goToStep('screen-booking-mode');
};
