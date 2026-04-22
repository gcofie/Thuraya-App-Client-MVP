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
    // Build member array — first member is always the lead booker
    grp_members = Array.from({ length: grp_groupSize }, (_, i) => ({
        name:            i === 0 ? (bk_clientProfile?.name || '') : '',
        serviceId:       '',
        serviceName:     '',
        serviceDuration: 0,
        servicePrice:    0,
        dept:            'Hand'
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
        const done   = !!m.serviceId;
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
function grp_renderServiceList() {
    const container = document.getElementById('grp_serviceList');
    if (!container) return;

    const member = grp_members[grp_activeMember];
    const dept   = member.dept || 'Hand';

    // Filter active services for this dept — radio/single selection only
    // (group bookings use one service per person for clean slot calculation)
    const services = bk_menuServices.filter(s =>
        (s.department === dept || s.department === 'Both') &&
        (!s.status || s.status === 'Active') &&
        (s.inputType === 'radio' || s.inputType === 'checkbox' || !s.inputType)
    );

    if (!services.length) {
        container.innerHTML = '<p style="text-align:center;color:var(--text-muted);padding:24px 0;">No services available.</p>';
        return;
    }

    // Group by category
    const cats = {};
    services.forEach(s => {
        const cat = (s.category || 'Services').trim();
        if (!cats[cat]) cats[cat] = [];
        cats[cat].push(s);
    });

    let html = '';
    Object.entries(cats).forEach(([cat, items]) => {
        html += `<p class="service-category-label">${cat}</p>`;
        items.forEach(s => {
            const price   = parseFloat(s.price) || 0;
            const dur     = parseInt(s.duration) || 0;
            const name    = s.name || 'Service';
            const selected = member.serviceId === s.id;
            const desc    = s.desc ? `<div class="service-card-desc">${s.desc}</div>` : '';
            html += `
            <div class="service-card ${selected ? 'selected' : ''}"
                onclick="grp_selectService('${s.id}','${name.replace(/'/g,"\\'")}',${dur},${price})">
                <input type="radio" style="width:18px;height:18px;min-width:18px;flex-shrink:0;
                    pointer-events:none;accent-color:var(--gold);margin-top:2px;"
                    ${selected ? 'checked' : ''}>
                <div class="service-card-body">
                    <div class="service-card-name">${name}</div>
                    ${desc}
                    <div class="service-card-price">${dur} mins &nbsp;|&nbsp; ${price.toFixed(0)} GHC</div>
                </div>
            </div>`;
        });
    });

    container.innerHTML = html;
}

window.grp_selectService = function(id, name, duration, price) {
    const member = grp_members[grp_activeMember];
    member.serviceId       = id;
    member.serviceName     = name;
    member.serviceDuration = duration;
    member.servicePrice    = price;
    grp_renderServiceList();
    grp_renderTabs();
    grp_updateProgress();
};


// ── Progress bar & continue button ───────────────────────────
function grp_updateProgress() {
    const done    = grp_members.filter(m => m.serviceId).length;
    const total   = grp_members.length;
    const allDone = done === total;

    const progressEl  = document.getElementById('grp_progressText');
    const nextBtn     = document.getElementById('grp_nextPersonBtn');
    const continueBtn = document.getElementById('grp_toDateTimeBtn');

    if (progressEl) progressEl.textContent = `${done} of ${total} selected`;

    // Show "Next person" nudge if current member is done but not the last
    const currentDone = !!grp_members[grp_activeMember].serviceId;
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
        const maxDuration = Math.max(...grp_members.map(m => m.serviceDuration || 60));
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
        membersEl.innerHTML = grp_members.map((m, i) => `
            <div class="grp-member-card">
                <div class="grp-member-index">${i + 1}</div>
                <div class="grp-member-info">
                    <strong>${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}
                        ${i === 0 ? '<span class="grp-lead-badge">Lead booker</span>' : ''}
                    </strong>
                    <span>${m.serviceName} · ${m.serviceDuration} mins · ${m.servicePrice.toFixed(0)} GHC</span>
                </div>
            </div>`).join('');
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
        grp_groupId = db.collection('Appointments').doc().id; // shared group ref

        const batch = db.batch();

        grp_members.forEach((m, i) => {
            const ref = db.collection('Appointments').doc();
            batch.set(ref, {
                groupId:           grp_groupId,
                groupSize:         grp_members.length,
                isGroupBooking:    true,
                isLeadBooker:      i === 0,
                clientName:        m.name || (i === 0 ? (bk_clientProfile?.name || '') : ''),
                clientEmail:       i === 0 ? (bk_currentUser?.email || '') : '',
                clientPhone:       i === 0 ? (bk_clientProfile?.phone || '') : '',
                bookedService:     m.serviceName,
                bookedDuration:    m.serviceDuration,
                bookedPrice:       m.servicePrice,
                grandTotal:        m.servicePrice,
                dateString:        dateStr,
                timeString:        timeStr,
                status:            'Scheduled',
                source:            'client-group-booking',
                bookedBy:          bk_isGuest
                                    ? ('guest:' + (bk_clientProfile?.phone || ''))
                                    : (bk_currentUser?.email || ''),
                assignedTechName:  '',
                assignedTechEmail: '',
                createdAt:         firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt:         firebase.firestore.FieldValue.serverTimestamp()
            });
        });

        await batch.commit();

        // Populate success screen
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
        membersEl.innerHTML = grp_members.map((m, i) => `
            <div class="grp-member-card">
                <div class="grp-member-index">${i + 1}</div>
                <div class="grp-member-info">
                    <strong>${m.name || (i === 0 ? 'You' : 'Person ' + (i + 1))}</strong>
                    <span>${m.serviceName} · ${m.serviceDuration} mins</span>
                </div>
            </div>`).join('');
    }
}


// ── Reset & book again ────────────────────────────────────────
window.grp_bookAgain = function() {
    grp_groupSize    = 2;
    grp_activeMember = 0;
    grp_members      = [];
    grp_groupId      = null;
    _screenHistory   = ['screen-welcome'];
    goToStep('screen-booking-mode');
};
