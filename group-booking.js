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

    // FIX: ensure bk_techs is loaded before generating slots
    let techList = (typeof bk_techs !== 'undefined') ? [...bk_techs] : [];
    if (!techList.length) {
        try { await loadTechs(); techList = [...(bk_techs||[])]; } catch(e) {}
    }
    if (!techList.length) {
        try {
            const snap = await db.collection('Users').get();
            snap.forEach(doc => {
                const d = doc.data();
                const roles = (Array.isArray(d.roles)?d.roles:[d.role||'']).map(r=>(r||'').toLowerCase());
                if (roles.some(r=>r.includes('tech')) && d.visibleToClients!==false)
                    techList.push({ email: doc.id, name: d.name||doc.id });
            });
            // Update global bk_techs
            if (typeof bk_techs !== 'undefined') bk_techs = techList;
        } catch(e) {}
    }

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
        _grp_bookedSlotsCache = bookedSlots; // cache for shortage detection

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

            // Available if fewer conflicts than total techs
            const totalTechs   = Math.max(techList.length, 1);
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

window.grp_selectSlot = async function(timeStr, btn) {
    document.querySelectorAll('#grp_slots .slot-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('grp_time').value = timeStr;
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = false;

    // Check if enough techs are free at this slot
    const dateStr = document.getElementById('grp_date')?.value || '';
    await grp_checkTechShortage(dateStr, timeStr);
};

// ── Tech shortage detection ───────────────────────────────────
// Called when a slot is selected. If not enough techs are free,
// shows a warning modal with two options.

let _grp_bookedSlotsCache  = []; // cached from grp_generateSlots
let _grp_allSlotsCache     = []; // all slots with freeTech count
let _grp_splitConfig       = []; // [{members:[], timeStr:'', techs:[]}]

async function grp_checkTechShortage(dateStr, timeStr) {
    // Ensure tech list is loaded
    let techList = (typeof bk_techs !== 'undefined') ? [...bk_techs] : [];
    if (!techList.length) {
        try { await loadTechs(); techList = [...(bk_techs||[])]; } catch(e) {}
    }
    if (!techList.length) {
        try {
            const snap = await db.collection('Users').get();
            snap.forEach(doc => {
                const d = doc.data();
                const roles = (Array.isArray(d.roles)?d.roles:[d.role||'']).map(r=>(r||'').toLowerCase());
                if (roles.some(r=>r.includes('tech')) && d.visibleToClients!==false)
                    techList.push({ email: doc.id, name: d.name||doc.id });
            });
        } catch(e) {}
    }

    const neededTechs = grp_members.length;

    // Count free techs at selected slot
    const [hh, mm]   = timeStr.split(':').map(Number);
    const slotStart  = hh * 60 + mm;
    const maxDuration = Math.max(...grp_members.map(m =>
        (m.selectedServices||[]).reduce((s,sv)=>s+(sv.dur*(sv.qty||1)),0)||60
    ));
    const slotEnd = slotStart + maxDuration;

    // Use cached booked slots from slot generation
    const busyEmails = new Set();
    _grp_bookedSlotsCache.forEach(b => {
        if (b.startMins < slotEnd && b.endMins > slotStart) busyEmails.add(b.techEmail);
    });
    const freeTechs = techList.filter(t => t.email && !busyEmails.has(t.email));

    if (freeTechs.length >= neededTechs) {
        // Enough techs — hide any warning
        const w = document.getElementById('grp_shortageWarning');
        if (w) w.style.display = 'none';
        return;
    }

    // Not enough techs — show warning
    grp_showShortageWarning(timeStr, dateStr, freeTechs, techList, neededTechs);
}

function grp_showShortageWarning(timeStr, dateStr, freeTechs, techList, neededTechs) {
    // Remove existing warning if any
    const existing = document.getElementById('grp_shortageWarning');
    if (existing) existing.remove();

    const fmt12 = (t) => {
        const [h,m] = t.split(':').map(Number);
        return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
    };

    const warning = document.createElement('div');
    warning.id = 'grp_shortageWarning';
    warning.style.cssText = `
        background: #fff8e7;
        border: 1.5px solid #f59e0b;
        border-radius: 10px;
        padding: 18px 16px;
        margin-top: 14px;
        font-size: 0.88rem;
    `;

    warning.innerHTML = `
        <p style="font-weight:700;color:#b45309;margin:0 0 6px;">
            ⚠️ Not enough technicians at ${fmt12(timeStr)}
        </p>
        <p style="color:#78350f;margin:0 0 14px;font-size:0.82rem;">
            Your group needs <strong>${neededTechs} technicians</strong> but only 
            <strong>${freeTechs.length}</strong> ${freeTechs.length===1?'is':'are'} free at this time.
            Please choose an option below:
        </p>

        <div style="display:flex;flex-direction:column;gap:10px;">

            <button onclick="grp_findEarliestForAll('${dateStr}')" 
                style="background:#f59e0b;color:white;border:none;border-radius:8px;padding:12px 14px;font-weight:700;font-size:0.85rem;cursor:pointer;text-align:left;">
                📅 Option 1 — Find earliest time for the whole group
                <span style="display:block;font-weight:400;font-size:0.75rem;margin-top:3px;opacity:0.9;">
                    We'll find the next slot where all ${neededTechs} technicians are free simultaneously.
                </span>
            </button>

            <button onclick="grp_showSplitPlanner('${dateStr}', '${timeStr}', ${freeTechs.length})"
                style="background:white;color:#b45309;border:1.5px solid #f59e0b;border-radius:8px;padding:12px 14px;font-weight:700;font-size:0.85rem;cursor:pointer;text-align:left;">
                ✂️ Option 2 — Split the group across different times
                <span style="display:block;font-weight:400;font-size:0.75rem;margin-top:3px;color:#78350f;">
                    Divide your group into smaller sub-groups, each at their own convenient time.
                </span>
            </button>

        </div>

        <div id="grp_shortageResult" style="margin-top:14px;"></div>
    `;

    // Insert after the slots container
    const slotsContainer = document.getElementById('grp_slotsContainer');
    slotsContainer?.after(warning);
}

// ── Option 1: Find earliest slot for whole group ──────────────
window.grp_findEarliestForAll = async function(dateStr) {
    const resultEl = document.getElementById('grp_shortageResult');
    if (resultEl) resultEl.innerHTML = '<p style="color:#b45309;font-size:0.82rem;">🔍 Searching for available slot…</p>';

    let techList = (typeof bk_techs !== 'undefined') ? [...bk_techs] : [];
    if (!techList.length) { try { await loadTechs(); techList=[...(bk_techs||[])]; } catch(e){} }

    const neededTechs = grp_members.length;
    const maxDuration = Math.max(...grp_members.map(m =>
        (m.selectedServices||[]).reduce((s,sv)=>s+(sv.dur*(sv.qty||1)),0)||60
    ));
    const closingMins = 18 * 60;

    const fmt12 = (t) => {
        const [h,m] = t.split(':').map(Number);
        return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
    };

    // Check today first, then up to 14 days ahead
    const toDateStr = (d) => d.toISOString().slice(0,10);
    const dates = [dateStr];
    const base = new Date(dateStr+'T12:00:00');
    for (let i=1; i<=13; i++) {
        const d = new Date(base); d.setDate(d.getDate()+i);
        dates.push(toDateStr(d));
    }

    for (const d of dates) {
        // Fetch booked slots for this date
        let bookedSlots = [];
        try {
            const snap = await db.collection('Appointments')
                .where('dateString','==',d)
                .where('status','in',['Scheduled','Arrived','In Progress'])
                .get();
            snap.forEach(doc => {
                const data = doc.data();
                if (!data.timeString||!data.bookedDuration) return;
                const [hh,mm] = data.timeString.split(':').map(Number);
                const start = hh*60+mm;
                bookedSlots.push({ techEmail: data.assignedTechEmail||'', startMins: start, endMins: start+(parseInt(data.bookedDuration)||0) });
            });
        } catch(e) {}

        const slots = [];
        for (let h=9; h<=17; h++) for (let m of [0,30]) { if(h===17&&m===30)continue; slots.push(h*60+m); }

        for (const startMins of slots) {
            if (startMins + maxDuration > closingMins) continue;
            const slotEnd = startMins + maxDuration;
            const busyEmails = new Set();
            bookedSlots.forEach(b => { if(b.startMins<slotEnd&&b.endMins>startMins) busyEmails.add(b.techEmail); });
            const freeTechs = techList.filter(t=>t.email&&!busyEmails.has(t.email));
            if (freeTechs.length >= neededTechs) {
                const hh = Math.floor(startMins/60);
                const mm = startMins%60;
                const timeStr = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
                const isSameDay = d === dateStr;
                const dateLabel = isSameDay ? 'today' : new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long'});

                if (resultEl) resultEl.innerHTML = `
                    <div style="background:#f0fdf4;border:1.5px solid #22c55e;border-radius:8px;padding:14px;">
                        <p style="font-weight:700;color:#15803d;margin:0 0 6px;">✅ Slot found!</p>
                        <p style="margin:0 0 10px;font-size:0.85rem;color:#166534;">
                            <strong>${fmt12(timeStr)}</strong> on <strong>${dateLabel}</strong> — 
                            ${freeTechs.length} technicians available for your group of ${neededTechs}.
                        </p>
                        <button onclick="grp_acceptSuggestedSlot('${d}','${timeStr}')"
                            style="background:#22c55e;color:white;border:none;border-radius:6px;padding:10px 18px;font-weight:700;cursor:pointer;font-size:0.85rem;">
                            ✓ Book this slot
                        </button>
                    </div>`;
                return;
            }
        }
    }

    if (resultEl) resultEl.innerHTML = `
        <p style="color:var(--error);font-size:0.85rem;">
            No available slot found for your whole group in the next 14 days. 
            Please try Option 2 to split the group.
        </p>`;
};

window.grp_acceptSuggestedSlot = function(dateStr, timeStr) {
    // Update date and time inputs
    const dateEl = document.getElementById('grp_date');
    if (dateEl) { dateEl.value = dateStr; }
    document.getElementById('grp_time').value = timeStr;

    // Remove warning
    const w = document.getElementById('grp_shortageWarning');
    if (w) w.remove();

    // Mark slot as selected visually
    document.querySelectorAll('#grp_slots .slot-btn').forEach(b => b.classList.remove('active'));

    // Enable confirm button
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = false;

    // Regenerate slots for new date if date changed
    grp_generateSlots();
};

// ── Option 2: Split group planner ────────────────────────────
window.grp_showSplitPlanner = function(dateStr, selectedTime, availableTechCount) {
    const resultEl = document.getElementById('grp_shortageResult');
    if (!resultEl) return;

    const memberCount = grp_members.length;

    // Build sub-group size options — all ways to split memberCount into groups
    // where each group size <= availableTechCount
    const splits = [];
    function findSplits(remaining, current, maxSize) {
        if (remaining === 0) { splits.push([...current]); return; }
        for (let i = Math.min(remaining, maxSize); i >= 1; i--) {
            current.push(i);
            findSplits(remaining-i, current, i); // descending to avoid duplicates
            current.pop();
        }
    }
    findSplits(memberCount, [], Math.min(memberCount, availableTechCount || memberCount));

    // Format split options
    const splitOptions = splits.map(s => s.join(' + ')).join('|');
    const splitOptionHTML = splits.map((s,i) =>
        `<option value="${i}">${s.join(' + ')} people</option>`
    ).join('');

    resultEl.innerHTML = `
        <div style="background:#fff;border:1.5px solid #e5e7eb;border-radius:10px;padding:16px;">
            <p style="font-weight:700;color:var(--primary);margin:0 0 10px;">✂️ Split Group Planner</p>

            <div style="margin-bottom:12px;">
                <label style="font-size:0.8rem;font-weight:600;color:#374151;display:block;margin-bottom:4px;">
                    How would you like to split your group of ${memberCount}?
                </label>
                <select id="grp_splitChoice" onchange="grp_renderSplitAssignment(${JSON.stringify(splits).replace(/"/g,'&quot;')})"
                    style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:0.85rem;">
                    <option value="">— Select split —</option>
                    ${splitOptionHTML}
                </select>
            </div>

            <div id="grp_splitAssignment"></div>
        </div>`;
};

window.grp_renderSplitAssignment = function(splits) {
    const idx = parseInt(document.getElementById('grp_splitChoice')?.value);
    if (isNaN(idx) || !splits[idx]) return;

    const split     = splits[idx];
    const container = document.getElementById('grp_splitAssignment');
    if (!container) return;

    const fmt12 = (t) => {
        if (!t) return '—';
        const [h,m] = t.split(':').map(Number);
        return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
    };

    // Build member dropdown options
    const memberOptions = grp_members.map((m,i) =>
        `<option value="${i}">${m.name || (i===0?'You':'Person '+(i+1))}</option>`
    ).join('');

    // Build sub-group cards
    const subGroupHTML = split.map((size, gi) => `
        <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:10px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                <p style="font-weight:700;color:var(--primary);margin:0;font-size:0.85rem;">
                    Sub-group ${gi+1} (${size} ${size===1?'person':'people'})
                </p>
                <span id="grp_sg_time_${gi}" style="font-size:0.78rem;color:#6b7280;">Finding time…</span>
            </div>
            ${Array.from({length:size},(_,mi) => `
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <label style="font-size:0.78rem;color:#374151;min-width:60px;">Slot ${mi+1}:</label>
                    <select id="grp_sg_${gi}_${mi}" 
                        style="flex:1;padding:6px 8px;border:1px solid #d1d5db;border-radius:5px;font-size:0.82rem;">
                        <option value="">— Assign member —</option>
                        ${memberOptions}
                    </select>
                </div>`).join('')}
        </div>`).join('');

    container.innerHTML = `
        ${subGroupHTML}
        <button onclick="grp_confirmSplitBooking(${JSON.stringify(split).replace(/"/g,'&quot;')})"
            style="width:100%;background:var(--primary);color:white;border:none;border-radius:8px;padding:12px;font-weight:700;font-size:0.85rem;cursor:pointer;margin-top:4px;">
            ✓ Confirm Split Booking
        </button>`;

    // Find best slot for each sub-group
    const dateStr = document.getElementById('grp_date')?.value || '';
    split.forEach((size, gi) => grp_findSlotForSubGroup(gi, size, dateStr));
};

async function grp_findSlotForSubGroup(gi, size, dateStr) {
    const timeEl = document.getElementById(`grp_sg_time_${gi}`);
    if (timeEl) timeEl.textContent = 'Finding time…';

    let techList = (typeof bk_techs !== 'undefined') ? [...bk_techs] : [];
    if (!techList.length) { try { await loadTechs(); techList=[...(bk_techs||[])]; } catch(e){} }

    const maxDuration = Math.max(...grp_members.map(m =>
        (m.selectedServices||[]).reduce((s,sv)=>s+(sv.dur*(sv.qty||1)),0)||60
    ));
    const closingMins = 18*60;

    const fmt12 = (t) => {
        const [h,m] = t.split(':').map(Number);
        return `${h%12||12}:${String(m).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
    };

    const toDateStr = (d) => d.toISOString().slice(0,10);
    const dates = [dateStr];
    const base = new Date(dateStr+'T12:00:00');
    for (let i=1;i<=13;i++) { const d=new Date(base); d.setDate(d.getDate()+i); dates.push(toDateStr(d)); }

    for (const d of dates) {
        let bookedSlots = [];
        try {
            const snap = await db.collection('Appointments')
                .where('dateString','==',d)
                .where('status','in',['Scheduled','Arrived','In Progress'])
                .get();
            snap.forEach(doc => {
                const data = doc.data();
                if (!data.timeString||!data.bookedDuration) return;
                const [hh,mm] = data.timeString.split(':').map(Number);
                const start = hh*60+mm;
                bookedSlots.push({ techEmail:data.assignedTechEmail||'', startMins:start, endMins:start+(parseInt(data.bookedDuration)||0) });
            });
        } catch(e) {}

        const slots = [];
        for (let h=9;h<=17;h++) for (let m of [0,30]) { if(h===17&&m===30)continue; slots.push(h*60+m); }

        for (const startMins of slots) {
            if (startMins+maxDuration>closingMins) continue;
            const slotEnd = startMins+maxDuration;
            const busyEmails = new Set();
            bookedSlots.forEach(b=>{ if(b.startMins<slotEnd&&b.endMins>startMins) busyEmails.add(b.techEmail); });
            const freeTechs = techList.filter(t=>t.email&&!busyEmails.has(t.email));
            if (freeTechs.length >= size) {
                const hh = Math.floor(startMins/60);
                const mm = startMins%60;
                const timeStr = `${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}`;
                const isSameDay = d===dateStr;
                const dateLabel = isSameDay?'today':new Date(d+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'});
                if (timeEl) timeEl.innerHTML = `<span style="color:#15803d;font-weight:700;">${fmt12(timeStr)} ${isSameDay?'':'· '+dateLabel}</span>`;
                // Store on element for use at confirmation
                timeEl.dataset.timeStr = timeStr;
                timeEl.dataset.dateStr = d;
                timeEl.dataset.freeTechs = JSON.stringify(freeTechs.slice(0,size));
                return;
            }
        }
        if (timeEl) timeEl.textContent = 'No slot found in 14 days';
    }
}

// ── Confirm split booking ─────────────────────────────────────
window.grp_confirmSplitBooking = async function(split) {
    // Validate all members assigned
    const assignments = []; // [{memberIdx, subGroupIdx, timeStr, dateStr, techs}]
    let valid = true;
    const assignedMembers = new Set();

    split.forEach((size, gi) => {
        const timeEl = document.getElementById(`grp_sg_time_${gi}`);
        const timeStr = timeEl?.dataset.timeStr || '';
        const dateStr = timeEl?.dataset.dateStr || '';
        let freeTechs = [];
        try { freeTechs = JSON.parse(timeEl?.dataset.freeTechs||'[]'); } catch(e){}

        for (let mi=0; mi<size; mi++) {
            const sel = document.getElementById(`grp_sg_${gi}_${mi}`);
            const memberIdx = parseInt(sel?.value);
            if (isNaN(memberIdx) || sel?.value === '') { valid=false; return; }
            if (assignedMembers.has(memberIdx)) { valid=false; return; }
            assignedMembers.add(memberIdx);
            assignments.push({ memberIdx, subGroupIdx: gi, timeStr, dateStr, tech: freeTechs[mi] || { email:'', name:'To be assigned' } });
        }
    });

    if (!valid || assignedMembers.size !== grp_members.length) {
        toast('Please assign all group members to a sub-group slot.', 'warning');
        return;
    }

    // Write all appointments
    try {
        const groupId = db.collection('Appointments').doc().id;
        grp_groupId   = groupId;
        const batch   = db.batch();

        assignments.forEach((a, i) => {
            const m          = grp_members[a.memberIdx];
            const ref        = db.collection('Appointments').doc();
            const services   = (m.selectedServices||[]).map(s=>`${s.name}${s.qty>1?' (x'+s.qty+')':''}`).join(', ');
            const totalMins  = (m.selectedServices||[]).reduce((sum,s)=>sum+(s.dur*(s.qty||1)),0);
            const totalPrice = (m.selectedServices||[]).reduce((sum,s)=>sum+(s.price*(s.qty||1)),0);

            batch.set(ref, {
                groupId,
                groupSize:         grp_members.length,
                isGroupBooking:    true,
                splitGroup:        true,
                subGroupIndex:     a.subGroupIdx + 1,
                isLeadBooker:      a.memberIdx === 0,
                clientName:        m.name||(a.memberIdx===0?(bk_clientProfile?.name||''):''),
                clientEmail:       a.memberIdx===0?(bk_currentUser?.email||''):'',
                clientPhone:       a.memberIdx===0?(bk_clientProfile?.phone||''):'',
                bookedService:     services,
                bookedDuration:    totalMins,
                bookedPrice:       totalPrice,
                grandTotal:        totalPrice,
                dateString:        a.dateStr,
                timeString:        a.timeStr,
                status:            'Scheduled',
                source:            'client-group-booking-split',
                bookedBy:          bk_isGuest?('guest:'+(bk_clientProfile?.phone||'')):(bk_currentUser?.email||''),
                assignedTechName:  a.tech.name  || 'To be assigned',
                assignedTechEmail: a.tech.email || '',
                createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt:         firebase.firestore.FieldValue.serverTimestamp()
            });

            // Store on member for success screen
            m.assignedTechName  = a.tech.name  || 'To be assigned';
            m.assignedTechEmail = a.tech.email || '';
            m.splitTimeStr      = a.timeStr;
            m.splitDateStr      = a.dateStr;
            m.subGroupIndex     = a.subGroupIdx + 1;
        });

        await batch.commit();

        // Show success — use split success screen
        grp_populateSplitSuccess();
        _screenHistory = ['screen-welcome','screen-booking-mode'];
        _origGoToStep('screen-group-success');

    } catch(e) {
        toast('Split booking failed: '+e.message, 'error');
    }
};

function grp_populateSplitSuccess() {
    document.getElementById('grp_suc_datetime').textContent = 'Split across multiple times — see details below';
    document.getElementById('grp_suc_size').textContent     = `${grp_members.length} people`;
    document.getElementById('grp_suc_ref').textContent      = grp_groupId?.slice(0,8).toUpperCase()||'—';

    const membersEl = document.getElementById('grp_suc_members');
    if (membersEl) {
        membersEl.innerHTML = grp_members.map((m,i) => {
            const services  = (m.selectedServices||[]).map(s=>`${s.name}${s.qty>1?' (x'+s.qty+')':''}`).join(', ');
            const totalMins = (m.selectedServices||[]).reduce((sum,s)=>sum+(s.dur*(s.qty||1)),0);
            const techName  = m.assignedTechName || 'To be assigned';
            const timeLabel = m.splitTimeStr ? (() => {
                const [h,mn] = m.splitTimeStr.split(':').map(Number);
                return `${h%12||12}:${String(mn).padStart(2,'0')} ${h>=12?'PM':'AM'}`;
            })() : '';
            const dateLabel = m.splitDateStr
                ? new Date(m.splitDateStr+'T12:00:00').toLocaleDateString('en-GB',{weekday:'short',day:'numeric',month:'short'})
                : '';
            return `
            <div class="grp-member-card">
                <div class="grp-member-index">${i+1}</div>
                <div class="grp-member-info">
                    <strong>${m.name||(i===0?'You':'Person '+(i+1))}</strong>
                    <span>${services||'—'} · ${totalMins} mins</span>
                    <span style="color:var(--accent);font-size:0.78rem;margin-top:2px;display:block;">
                        👩‍🔧 <strong>${techName}</strong>
                        ${timeLabel?`· 🕐 Sub-group ${m.subGroupIndex}: ${timeLabel} ${dateLabel}`:''}
                    </span>
                </div>
            </div>`;
        }).join('');
    }
}


// ── Populate & navigate to confirm screen ─────────────────────
// Override goToStep for screen-group-confirm to populate first
const _origGoToStep = goToStep;
window.goToStep = function(id) {
    if (id === 'screen-group-confirm') {
        // Pre-assign techs first, THEN show the confirm screen
        grp_preAssignTechs().then(() => {
            grp_populateConfirm();
            _origGoToStep(id);
        });
        return; // Don't call _origGoToStep yet
    }
    _origGoToStep(id);
};

// ── Pre-assign techs before confirm screen ────────────────────
async function grp_preAssignTechs() {
    const dateStr = document.getElementById('grp_date')?.value || '';
    const timeStr = document.getElementById('grp_time')?.value || '';

    // Get full tech list
    let techList = (typeof bk_techs !== 'undefined') ? [...bk_techs] : [];
    if (!techList.length) {
        try { await loadTechs(); techList = [...(bk_techs||[])]; } catch(e) {}
    }
    if (!techList.length) {
        try {
            const snap = await db.collection('Users').get();
            snap.forEach(doc => {
                const d = doc.data();
                const roles = (Array.isArray(d.roles) ? d.roles : [d.role||'']).map(r=>(r||'').toLowerCase());
                if (roles.some(r => r.includes('tech')) && d.visibleToClients !== false) {
                    techList.push({ email: doc.id, name: d.name || doc.id });
                }
            });
        } catch(e) {}
    }

    // Find busy techs at this slot
    const busyTechEmails = new Set();
    if (dateStr && timeStr) {
        try {
            const [hh, mm] = timeStr.split(':').map(Number);
            const slotStart = hh * 60 + mm;
            const maxDuration = Math.max(...grp_members.map(m =>
                (m.selectedServices||[]).reduce((s,sv) => s+(sv.dur*(sv.qty||1)), 0) || 60
            ));
            const slotEnd = slotStart + maxDuration;

            const existingSnap = await db.collection('Appointments')
                .where('dateString', '==', dateStr)
                .where('status', 'in', ['Scheduled','Arrived','In Progress'])
                .get();

            existingSnap.forEach(doc => {
                const d = doc.data();
                if (!d.timeString || !d.assignedTechEmail) return;
                const [eh, em] = d.timeString.split(':').map(Number);
                const eStart = eh * 60 + em;
                const eEnd   = eStart + (parseInt(d.bookedDuration) || 60);
                if (eStart < slotEnd && eEnd > slotStart) busyTechEmails.add(d.assignedTechEmail);
            });
        } catch(e) {}
    }

    // Build free tech pool
    const freeTechs  = techList.filter(t => t.email && !busyTechEmails.has(t.email));
    const assignPool = freeTechs.length >= grp_members.length
        ? freeTechs
        : techList.length > 0
            ? techList
            : [{ email: '', name: 'To be assigned' }];

    // Assign unique tech per member and store on grp_members
    const assignedInThisBooking = new Set();
    grp_members.forEach((m, i) => {
        const uniqueTech = assignPool.find(t => !assignedInThisBooking.has(t.email));
        if (uniqueTech) {
            assignedInThisBooking.add(uniqueTech.email);
            m.assignedTechName  = uniqueTech.name;
            m.assignedTechEmail = uniqueTech.email;
        } else {
            const fallback = assignPool[i % assignPool.length];
            m.assignedTechName  = fallback.name  || 'To be assigned';
            m.assignedTechEmail = fallback.email || '';
        }
    });
}

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
            const services   = (m.selectedServices||[]).map(s => `${s.name}${s.qty>1?' (x'+s.qty+')':''}`).join(', ');
            const totalMins  = (m.selectedServices||[]).reduce((sum,s) => sum+(s.dur*(s.qty||1)), 0);
            const totalPrice = (m.selectedServices||[]).reduce((sum,s) => sum+(s.price*(s.qty||1)), 0);
            const techName   = m.assignedTechName || 'To be assigned';
            return `
            <div class="grp-member-card">
                <div class="grp-member-index">${i + 1}</div>
                <div class="grp-member-info">
                    <strong>${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}
                        ${i === 0 ? '<span class="grp-lead-badge">Lead booker</span>' : ''}
                    </strong>
                    <span>${services || '—'} · ${totalMins} mins · ${totalPrice.toFixed(0)} GHC</span>
                    <span style="color:var(--accent);font-size:0.78rem;margin-top:2px;display:block;">
                        👩‍🔧 Technician: <strong>${techName}</strong>
                    </span>
                </div>
            </div>`;
        }).join('');
    }

    // ── Billing mode selector ─────────────────────────────────
    const totalGroupAmount = grp_members.reduce((sum,m) =>
        sum + (m.selectedServices||[]).reduce((s,sv) => s+(sv.price*(sv.qty||1)),0), 0
    );
    const perPersonAmount = grp_members.length > 0
        ? (totalGroupAmount / grp_members.length).toFixed(2)
        : '0.00';

    // Remove existing billing selector if any
    const existingBilling = document.getElementById('grp_billingModeWrap');
    if (existingBilling) existingBilling.remove();

    const billingWrap = document.createElement('div');
    billingWrap.id = 'grp_billingModeWrap';
    billingWrap.style.cssText = 'margin-top:16px;padding:14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;';
    billingWrap.innerHTML = `
        <p style="font-weight:700;color:var(--primary);font-size:0.88rem;margin:0 0 10px;">💳 How will payment be handled?</p>
        <div style="display:flex;flex-direction:column;gap:8px;">
            <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;background:white;border:1.5px solid #e5e7eb;border-radius:8px;" id="grp_bill_single_lbl">
                <input type="radio" name="grp_billingMode" value="single" onchange="grp_onBillingChange()" style="margin-top:3px;flex-shrink:0;">
                <span>
                    <strong style="display:block;font-size:0.85rem;">One person pays for everyone</strong>
                    <span style="font-size:0.78rem;color:#6b7280;">
                        Total: <strong>${totalGroupAmount.toFixed(2)} GHC</strong> — paid by the lead booker at checkout
                    </span>
                </span>
            </label>
            <label style="display:flex;align-items:flex-start;gap:10px;cursor:pointer;padding:10px;background:white;border:1.5px solid #e5e7eb;border-radius:8px;" id="grp_bill_split_lbl">
                <input type="radio" name="grp_billingMode" value="split" onchange="grp_onBillingChange()" style="margin-top:3px;flex-shrink:0;">
                <span>
                    <strong style="display:block;font-size:0.85rem;">Each person pays separately</strong>
                    <span style="font-size:0.78rem;color:#6b7280;">
                        Each person is billed individually for their own services
                    </span>
                </span>
            </label>
        </div>`;

    // Insert after members list
    const confMembersEl = document.getElementById('grp_conf_members');
    confMembersEl?.after(billingWrap);
}

window.grp_onBillingChange = function() {
    const val = document.querySelector('input[name="grp_billingMode"]:checked')?.value;
    // Highlight selected option
    document.getElementById('grp_bill_single_lbl')?.style.setProperty('border-color', val==='single'?'var(--primary)':'#e5e7eb');
    document.getElementById('grp_bill_split_lbl')?.style.setProperty('border-color', val==='split'?'var(--primary)':'#e5e7eb');
};


// ── Batch Firestore write ─────────────────────────────────────
window.grp_confirmBooking = async function() {
    const btn     = document.getElementById('grp_btnConfirm');
    const dateStr = document.getElementById('grp_date')?.value || '';
    const timeStr = document.getElementById('grp_time')?.value || '';

    if (!dateStr || !timeStr) { toast('Missing date or time.', 'warning'); return; }

    setBtnLoading(btn, true, 'Confirm Group Booking');
    try {
        grp_groupId = db.collection('Appointments').doc().id;

        // Read billing mode — default to split if not selected
        const billingMode = document.querySelector('input[name="grp_billingMode"]:checked')?.value || 'split';

        // Tech assignments already calculated in grp_preAssignTechs()
        const batch = db.batch();

        grp_members.forEach((m, i) => {
            const ref        = db.collection('Appointments').doc();
            const services   = (m.selectedServices||[]).map(s => `${s.name}${s.qty>1?' (x'+s.qty+')':''}`).join(', ');
            const totalMins  = (m.selectedServices||[]).reduce((sum,s) => sum+(s.dur*(s.qty||1)), 0);
            const totalPrice = (m.selectedServices||[]).reduce((sum,s) => sum+(s.price*(s.qty||1)), 0);

            batch.set(ref, {
                groupId:           grp_groupId,
                groupSize:         grp_members.length,
                isGroupBooking:    true,
                isLeadBooker:      i === 0,
                billingMode:       billingMode,
                clientName:        m.name || (i === 0 ? (bk_clientProfile?.name||'') : ''),
                clientEmail:       i === 0 ? (bk_currentUser?.email||'') : '',
                clientPhone:       i === 0 ? (bk_clientProfile?.phone||'') : '',
                bookedService:     services,
                bookedDuration:    totalMins,
                bookedPrice:       totalPrice,
                grandTotal:        totalPrice,
                dateString:        dateStr,
                timeString:        timeStr,
                status:            'Scheduled',
                source:            'client-group-booking',
                bookedBy:          bk_isGuest
                                    ? ('guest:'+(bk_clientProfile?.phone||''))
                                    : (bk_currentUser?.email||''),
                assignedTechName:  m.assignedTechName  || 'To be assigned',
                assignedTechEmail: m.assignedTechEmail || '',
                createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt:         firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        grp_populateSuccess(dateStr, timeStr);
        _screenHistory = ['screen-welcome', 'screen-booking-mode'];
        _origGoToStep('screen-group-success');

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
            const services  = (m.selectedServices||[]).map(s => `${s.name}${s.qty>1?' (x'+s.qty+')':''}`).join(', ');
            const totalMins = (m.selectedServices||[]).reduce((sum,s) => sum+(s.dur*(s.qty||1)), 0);
            const techName  = m.assignedTechName || 'To be assigned';
            return `
            <div class="grp-member-card">
                <div class="grp-member-index">${i + 1}</div>
                <div class="grp-member-info">
                    <strong>${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}</strong>
                    <span>${services || '—'} · ${totalMins} mins</span>
                    <span style="color:var(--accent);font-size:0.78rem;margin-top:2px;display:block;">
                        👩‍🔧 <strong>${techName}</strong>
                    </span>
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
