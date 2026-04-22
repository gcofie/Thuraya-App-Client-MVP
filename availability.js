// ============================================================
//  THURAYA — 4b  Live Availability Engine
//  Replaces the slot logic in app.js (solo) and
//  group-booking.js (group) with a real 3-layer check:
//
//  Layer 1 — Staff_Schedules: is the tech scheduled to work?
//  Layer 2 — Staff_Leave:     does the tech have approved leave?
//  Layer 3 — Appointments:    is the tech already booked?
//
//  Add this file to index.html AFTER app.js and group-booking.js:
//    <script src="availability.js"></script>
// ============================================================


// ── Helper: convert "HH:MM" to minutes since midnight ────────
function av_toMins(str) {
    if (!str) return 0;
    const [h, m] = str.split(':').map(Number);
    return h * 60 + (m || 0);
}

// ── Helper: get day-of-week abbreviation from YYYY-MM-DD ─────
function av_dayAbbr(dateStr) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[new Date(dateStr + 'T12:00:00').getDay()];
}

// ── Helper: render slot buttons into a container ─────────────
function av_renderSlots(slotMap, container, onSelect) {
    const slots = Object.keys(slotMap).map(Number).sort((a, b) => a - b);
    if (!slots.length) {
        container.innerHTML = '<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">No available times for this date. Try a different date.</p>';
        return;
    }
    container.innerHTML = slots.map(t => {
        const hrs  = Math.floor(t / 60), mins = t % 60;
        const ampm = hrs >= 12 ? 'PM' : 'AM';
        const h12  = hrs % 12 || 12;
        const mm   = String(mins).padStart(2, '0');
        const t24  = `${String(hrs).padStart(2,'0')}:${mm}`;
        const techList = JSON.stringify(slotMap[t]);
        return `<button class="slot-btn" data-time="${t24}" data-techs='${techList}'
            onclick="${onSelect}('${t24}', this)">${h12}:${mm} ${ampm}</button>`;
    }).join('');
}


// ============================================================
//  CORE ENGINE
//  Fetches all 3 layers in parallel and returns a slotMap:
//  { minutesSinceMidnight: [availableTechEmail, ...] }
// ============================================================
async function av_getSlotMap(dateStr, techEmails, totalMins) {
    const dayAbbr  = av_dayAbbr(dateStr);
    const isToday  = dateStr === todayStr;
    const nowMins  = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;

    // ── Fetch all 3 layers in parallel ───────────────────────
    const [schedSnap, leaveSnap, apptSnap] = await Promise.all([
        // Layer 1: fetch ALL schedules — tiny collection, no index needed
        db.collection('Staff_Schedules').get(),

        // Layer 2: approved leave — single where, filter dates client-side
        db.collection('Staff_Leave')
            .where('status', '==', 'Approved')
            .get(),

        // Layer 3: existing appointments on this date
        db.collection('Appointments')
            .where('dateString', '==', dateStr)
            .where('status', 'in', ['Scheduled', 'Arrived', 'In Progress'])
            .get()
    ]);

    // ── Build schedule map: techEmail → { startMins, endMins, worksToday } ──
    const scheduleMap = {};
    schedSnap.forEach(doc => {
        const s = doc.data();
        // Find the most recent effectiveFrom that is <= dateStr
        scheduleMap[doc.id] = {
            worksToday: (s.workingDays || []).includes(dayAbbr),
            startMins:  av_toMins(s.startTime || '08:00'),
            endMins:    av_toMins(s.endTime   || '20:00'),
        };
    });

    // Fallback for techs with no schedule doc — assume default hours
    techEmails.forEach(email => {
        if (!scheduleMap[email]) {
            scheduleMap[email] = { worksToday: true, startMins: 8*60, endMins: 20*60 };
        }
    });

    // ── Build leave set: Set of techEmails on leave this date ─
    const onLeave = new Set();
    leaveSnap.forEach(doc => {
        const l = doc.data();
        // Filter client-side: leave must cover dateStr
        if (l.startDate <= dateStr && l.endDate >= dateStr && l.techEmail) {
            onLeave.add(l.techEmail);
        }
    });

    // ── Build busy map: techEmail → [{ start, end }] ─────────
    const busyMap = {};
    apptSnap.forEach(doc => {
        const a = doc.data();
        const email = a.assignedTechEmail;
        if (!email) return;
        if (!busyMap[email]) busyMap[email] = [];
        busyMap[email].push({
            start: av_toMins(a.timeString),
            end:   av_toMins(a.timeString) + parseInt(a.bookedDuration || 0)
        });
    });

    // ── Build slot map ────────────────────────────────────────
    const slotMap = {};

    techEmails.forEach(email => {
        const sched = scheduleMap[email];

        // Layer 1: skip if not working today
        if (!sched.worksToday) return;

        // Layer 2: skip if on approved leave
        if (onLeave.has(email)) return;

        const busy     = busyMap[email] || [];
        const openTime = sched.startMins;
        const closeTime= sched.endMins;

        for (let t = openTime; t + totalMins <= closeTime; t += 30) {
            // Skip past slots for today
            if (isToday && t <= nowMins) continue;

            const slotEnd = t + totalMins;

            // Layer 3: check no appointment conflict
            const free = busy.every(b => slotEnd <= b.start || t >= b.end);
            if (free) {
                if (!slotMap[t]) slotMap[t] = [];
                slotMap[t].push(email);
            }
        }
    });

    return slotMap;
}


// ============================================================
//  SOLO FLOW — replaces bk_generateSlots in app.js
// ============================================================
window.bk_generateSlots = async function() {
    const date      = document.getElementById('bk_date').value;
    const timeEl    = document.getElementById('bk_time');
    const slotsEl   = document.getElementById('bk_slots');
    const container = document.getElementById('bk_slotsContainer');
    const nextBtn   = document.getElementById('btnToConfirm');

    timeEl.value    = '';
    nextBtn.disabled = true;

    if (!date) { container.style.display = 'none'; return; }
    if (date < todayStr) {
        container.style.display = 'block';
        slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;">Cannot book in the past.</p>';
        return;
    }

    const totalMins = bk_selectedServices.reduce((s, x) => s + (x.dur * (x.qty || 1)), 0);
    if (totalMins === 0) {
        container.style.display = 'none';
        toast('Select at least one service first.', 'warning');
        return;
    }

    const mode          = document.getElementById('bk_techMode').value;
    const specificEmail = document.getElementById('bk_techEmail').value;
    const techsToCheck  = (mode === 'specific' && specificEmail)
        ? [specificEmail]
        : bk_techs.map(t => t.email);

    if (!techsToCheck.length) {
        container.style.display = 'none';
        toast('No technicians available for this date.', 'warning');
        return;
    }

    container.style.display = 'block';
    slotsEl.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1;">Checking availability…</div>';

    try {
        // Firestore 'in' operator supports max 30 items; chunk if needed
        const chunks   = av_chunkArray(techsToCheck, 30);
        const maps     = await Promise.all(chunks.map(chunk => av_getSlotMap(date, chunk, totalMins)));
        const slotMap  = av_mergeSlotMaps(maps);

        if (!Object.keys(slotMap).length) {
            slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">No available times for this date. Try a different date.</p>';
            return;
        }

        av_renderSlots(slotMap, slotsEl, 'bk_selectSlot');

    } catch (e) {
        slotsEl.innerHTML = `<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">Error loading slots: ${e.message}</p>`;
        console.error('av solo slots error:', e);
    }
};

// bk_selectSlot stays the same — auto-assigns tech from data-techs attribute
window.bk_selectSlot = function(time, btn) {
    document.querySelectorAll('#bk_slots .slot-btn').forEach(b => b.classList.remove('selected'));
    btn.classList.add('selected');
    document.getElementById('bk_time').value = time;

    const mode = document.getElementById('bk_techMode').value;
    if (mode === 'any') {
        try {
            const available = JSON.parse(btn.getAttribute('data-techs') || '[]');
            if (available.length) {
                const assignedEmail = available[0];
                const tech = bk_techs.find(t => t.email === assignedEmail);
                document.getElementById('bk_techEmail').value = assignedEmail;
                document.getElementById('bk_techName').value  = tech?.name || assignedEmail;
            }
        } catch (e) { /* silent */ }
    }
    document.getElementById('btnToConfirm').disabled = false;
};


// ============================================================
//  GROUP FLOW — replaces grp_generateSlots in group-booking.js
//  For group: a slot is only shown if ALL members can be
//  served simultaneously (one free tech per member).
// ============================================================
window.grp_generateSlots = async function() {
    const dateEl  = document.getElementById('grp_date');
    const dateStr = dateEl?.value;
    if (!dateStr) return;

    const container = document.getElementById('grp_slotsContainer');
    const grid      = document.getElementById('grp_slots');
    if (!grid || !container) return;

    container.style.display = 'block';
    grid.innerHTML = '<div class="loading-pulse" style="grid-column:1/-1;">Checking availability…</div>';

    document.getElementById('grp_time').value = '';
    const confirmBtn = document.getElementById('grp_toConfirmBtn');
    if (confirmBtn) confirmBtn.disabled = true;

    try {
        const allTechEmails = bk_techs.map(t => t.email);
        if (!allTechEmails.length) {
            grid.innerHTML = '<p style="color:var(--error);grid-column:1/-1;">No technicians found.</p>';
            return;
        }

        // Each member needs their own duration window
        const memberDurations = grp_members.map(m =>
            (m.selectedServices || []).reduce((sum, s) => sum + (s.dur * (s.qty || 1)), 0) || 60
        );
        const maxDuration = Math.max(...memberDurations);

        // Fetch availability using the longest duration as the window
        // (conservative — ensures the slot fits everyone)
        const chunks  = av_chunkArray(allTechEmails, 30);
        const maps    = await Promise.all(chunks.map(chunk => av_getSlotMap(dateStr, chunk, maxDuration)));
        const slotMap = av_mergeSlotMaps(maps);

        // Filter: slot must have at least as many free techs as group members
        const groupSize    = grp_members.length;
        const filteredMap  = {};
        Object.entries(slotMap).forEach(([t, techs]) => {
            if (techs.length >= groupSize) filteredMap[t] = techs;
        });

        if (!Object.keys(filteredMap).length) {
            grid.innerHTML = '<p style="color:var(--error);grid-column:1/-1;text-align:center;padding:16px 0;">No slots available for your group on this date. Try a different date.</p>';
            return;
        }

        // Render with grp_selectSlot handler
        av_renderSlots(filteredMap, grid, 'grp_selectSlot');

    } catch (e) {
        grid.innerHTML = `<p style="color:var(--error);grid-column:1/-1;">Could not load slots: ${e.message}</p>`;
        console.error('av group slots error:', e);
    }
};


// ============================================================
//  UTILITIES
// ============================================================

// Split array into chunks (Firestore 'in' max is 30)
function av_chunkArray(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

// Merge multiple slotMaps from chunked queries into one
function av_mergeSlotMaps(maps) {
    const merged = {};
    maps.forEach(map => {
        Object.entries(map).forEach(([t, techs]) => {
            if (!merged[t]) merged[t] = [];
            merged[t].push(...techs);
        });
    });
    return merged;
}

// ── Expose av_getSlotMap globally for future use (Phase 4c) ──
window.av_getSlotMap   = av_getSlotMap;
window.av_chunkArray   = av_chunkArray;
window.av_mergeSlotMaps= av_mergeSlotMaps;
window.av_toMins       = av_toMins;
window.av_dayAbbr      = av_dayAbbr;

console.log('Thuraya availability engine 4b loaded.');
