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


// ── Phase 8 helpers: formatting + smart slot scoring ───────
function av_formatTimeFromMins(t) {
    const hrs  = Math.floor(Number(t) / 60), mins = Number(t) % 60;
    const ampm = hrs >= 12 ? 'PM' : 'AM';
    const h12  = hrs % 12 || 12;
    return `${h12}:${String(mins).padStart(2, '0')} ${ampm}`;
}

function av_escapeAttr(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function av_slotSmartScore(mins, techs, loadMap) {
    const techCount = (techs || []).length;
    const avgLoad = techCount ? techs.reduce((sum, email) => sum + (loadMap[email] || 0), 0) / techCount : 99;
    const preferred = (mins >= 10 * 60 && mins <= 15 * 60) ? 18 : 0;
    const avoidLate = mins >= 18 * 60 ? -8 : 0;
    const capacity  = Math.min(techCount, 6) * 12;
    const fairness  = Math.max(0, 18 - (avgLoad * 4));
    return Math.round(capacity + fairness + preferred + avoidLate);
}

function av_rankSlotMap(slotMap, loadMap) {
    const ranked = Object.entries(slotMap || {}).map(([mins, techs]) => ({
        mins: Number(mins),
        techs: [...new Set(techs || [])].sort((a, b) => (loadMap[a] || 0) - (loadMap[b] || 0)),
        score: av_slotSmartScore(Number(mins), techs || [], loadMap || {})
    })).sort((a, b) => b.score - a.score || a.mins - b.mins);
    const normalized = {};
    ranked.slice().sort((a, b) => a.mins - b.mins).forEach(r => { normalized[r.mins] = r.techs; });
    return { ranked, normalized };
}

async function av_getDailyLoadMap(dateStr) {
    const loadMap = {};
    try {
        const snap = await db.collection('Appointments')
            .where('dateString', '==', dateStr)
            .where('status', 'in', ['Scheduled', 'Arrived', 'In Progress', 'Ready for Payment'])
            .get();
        snap.forEach(doc => {
            const a = doc.data() || {};
            const email = a.assignedTechEmail;
            if (email) loadMap[email] = (loadMap[email] || 0) + 1;
        });
    } catch (e) {
        console.warn('Availability smart load map skipped:', e.message || e);
    }
    return loadMap;
}

function av_renderSmartHeader(ranked, container, onSelect) {
    if (!ranked || !ranked.length) return '';
    const best = ranked[0];
    const alternatives = ranked.slice(1, 3);
    const altHtml = alternatives.length
        ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;">${alternatives.map(r => {
            const hh = String(Math.floor(r.mins / 60)).padStart(2, '0');
            const mm = String(r.mins % 60).padStart(2, '0');
            const t24 = `${hh}:${mm}`;
            return `<button type="button" class="btn-outline btn-sm" style="font-size:0.76rem;padding:7px 10px;" onclick="${onSelect}('${t24}', document.querySelector('[data-time=&quot;${t24}&quot;]'))">${av_formatTimeFromMins(r.mins)}</button>`;
        }).join('')}</div>`
        : '';
    const best24 = `${String(Math.floor(best.mins / 60)).padStart(2, '0')}:${String(best.mins % 60).padStart(2, '0')}`;
    return `
        <div class="smart-booking-card" style="grid-column:1/-1;border:1px solid rgba(180,132,58,.28);background:linear-gradient(135deg,rgba(180,132,58,.10),rgba(255,255,255,.92));border-radius:16px;padding:14px;margin-bottom:6px;box-shadow:0 8px 24px rgba(0,0,0,.04);">
            <div style="display:flex;align-items:flex-start;gap:10px;">
                <div style="width:34px;height:34px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(180,132,58,.16);">✨</div>
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:700;color:var(--primary);font-size:.92rem;">Smart Booking recommends ${av_formatTimeFromMins(best.mins)}</div>
                    <div style="color:var(--text-muted);font-size:.78rem;line-height:1.35;margin-top:3px;">Best balance of technician availability, workload and client-friendly timing.</div>
                    ${altHtml}
                </div>
                <button type="button" class="btn-primary btn-sm" style="padding:8px 11px;font-size:.76rem;white-space:nowrap;" onclick="${onSelect}('${best24}', document.querySelector('[data-time=&quot;${best24}&quot;]'))">Pick</button>
            </div>
        </div>`;
}

// ── Helper: render slot buttons into a container ─────────────
function av_getSlotLabel(t, info, slotMap) {
    const techCount = (slotMap[t] || []).length;
    if (info.rank === 1) return { text: 'Best Time', cls: 'smart-best' };
    const firstSlot = Math.min(...Object.keys(slotMap).map(Number));
    if (t === firstSlot) return { text: 'Earliest', cls: 'smart-earliest' };
    if (techCount >= 3) return { text: 'More Choice', cls: 'smart-choice' };
    if (t >= 10 * 60 && t <= 15 * 60) return { text: 'Quiet Time', cls: 'smart-quiet' };
    return null;
}

function av_injectSmartStyles() {
    if (document.getElementById('thuraya-phase8b-smart-style')) return;
    const style = document.createElement('style');
    style.id = 'thuraya-phase8b-smart-style';
    style.textContent = `
        .slot-btn.smart-recommended {
            border-color: rgba(180,132,58,.85) !important;
            box-shadow: 0 8px 22px rgba(180,132,58,.16);
            transform: translateY(-1px);
        }
        .slot-btn .slot-smart-tag {
            display:block;
            font-size:.61rem;
            line-height:1;
            margin-top:4px;
            font-weight:800;
            letter-spacing:.02em;
            color:var(--gold-dark,#9a6a18);
        }
        .smart-booking-card {
            animation: thurayaSmartFade .28s ease both;
        }
        @keyframes thurayaSmartFade {
            from { opacity:0; transform:translateY(6px); }
            to { opacity:1; transform:translateY(0); }
        }
    `;
    document.head.appendChild(style);
}

// ── Helper: render slot buttons into a container ─────────────
function av_renderSlots(slotMap, container, onSelect, smartOptions = {}) {
    av_injectSmartStyles();

    const loadMap = smartOptions.loadMap || {};
    const rankedInput = smartOptions.ranked || av_rankSlotMap(slotMap, loadMap).ranked;
    const rankedByMin = {};
    rankedInput.forEach((r, idx) => { rankedByMin[r.mins] = { ...r, rank: idx + 1 }; });

    const slots = Object.keys(slotMap).map(Number).sort((a, b) => a - b);
    if (!slots.length) {
        container.innerHTML = '<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">No available times for this date. Try a different date.</p>';
        return;
    }

    const smartHeader = smartOptions.showSmartHeader === false ? '' : av_renderSmartHeader(rankedInput, container, onSelect);
    container.innerHTML = smartHeader + slots.map(t => {
        const t24  = `${String(Math.floor(t / 60)).padStart(2,'0')}:${String(t % 60).padStart(2,'0')}`;
        const info = rankedByMin[t] || { score: 0, rank: 99 };
        const techList = av_escapeAttr(JSON.stringify(slotMap[t] || []));
        const label = av_getSlotLabel(t, info, slotMap);
        const labelHtml = label ? `<span class="slot-smart-tag ${label.cls}">${label.text}</span>` : '';
        const manyTechs = (slotMap[t] || []).length > 1 ? ` title="${slotMap[t].length} technicians available"` : '';
        return `<button class="slot-btn ${info.rank === 1 ? 'smart-recommended' : ''}" data-time="${t24}" data-smart-score="${info.score}" data-techs='${techList}'${manyTechs}
            onclick="${onSelect}('${t24}', this)">${av_formatTimeFromMins(t)}${labelHtml}</button>`;
    }).join('');
}


// ============================================================
//  CORE ENGINE
//  Fetches all 4 layers in parallel and returns a slotMap:
//  { minutesSinceMidnight: [availableTechEmail, ...] }
//
//  Layer 0 — Calendar_Blocks: full day / time range / tech blocks
//  Layer 1 — Staff_Schedules: working days + hours
//  Layer 2 — Staff_Leave:     approved leave
//  Layer 3 — Appointments:    existing bookings
// ============================================================
async function av_getSlotMap(dateStr, techEmails, totalMins) {
    techEmails = (techEmails || []).filter(Boolean);
    totalMins = parseInt(totalMins || 0, 10);

    const dayAbbr  = av_dayAbbr(dateStr);
    const isToday  = dateStr === todayStr;
    const nowMins  = isToday ? (new Date().getHours() * 60 + new Date().getMinutes()) : -1;

    // ── Fetch all 4 layers in parallel ───────────────────────
    const [blockSnap, schedSnap, leaveSnap, apptSnap] = await Promise.all([
        // Layer 0: fetch ALL calendar blocks and filter client-side.
        // This supports full_day, time_range, tech_specific and date_range blocks.
        // Calendar_Blocks is expected to be small; this avoids missing date_range records.
        db.collection('Calendar_Blocks').get(),

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

    // ── Layer 0: parse calendar blocks ───────────────────────
    let fullDayBlock  = false;           // blocks ALL techs all day
    const techBlocked = new Set();       // techs blocked all day
    const timeBlocks  = [];              // [{ startMins, endMins, techEmail }] — '' = all

    blockSnap.forEach(doc => {
        const b = doc.data() || {};
        const type = b.type || '';

        const appliesByDate =
            (b.dateString && b.dateString === dateStr) ||
            (b.rangeStart && b.rangeEnd && b.rangeStart <= dateStr && b.rangeEnd >= dateStr);

        if (!appliesByDate) return;

        if (type === 'full_day' && !b.techEmail) {
            fullDayBlock = true;
        } else if ((type === 'full_day' || type === 'tech_specific' || type === 'date_range') && b.techEmail) {
            techBlocked.add(b.techEmail);
        } else if (type === 'time_range') {
            timeBlocks.push({
                startMins: av_toMins(b.startTime),
                endMins:   av_toMins(b.endTime),
                techEmail: b.techEmail || ''   // '' means all techs
            });
        }
    });

    // If full day block — return empty slot map immediately
    if (fullDayBlock) return {};

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
        const a = doc.data() || {};
        const email = a.assignedTechEmail;
        if (!email) {
            console.warn('Availability: appointment missing assignedTechEmail and was ignored:', doc.id, a);
            return;
        }

        const startMins = av_toMins(a.timeString);
        const duration = parseInt(a.bookedDuration || a.duration || a.totalDuration || 0, 10);
        if (!a.timeString || !duration) {
            console.warn('Availability: appointment missing time or duration and was ignored:', doc.id, a);
            return;
        }

        if (!busyMap[email]) busyMap[email] = [];
        busyMap[email].push({
            start: startMins,
            end:   startMins + duration
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

        // Layer 0a: skip if tech is blocked all day
        if (techBlocked.has(email)) return;

        const busy      = busyMap[email] || [];
        const openTime  = sched.startMins;
        const closeTime = sched.endMins;

        for (let t = openTime; t + totalMins <= closeTime; t += 30) {
            // Skip past slots for today
            if (isToday && t <= nowMins) continue;

            const slotEnd = t + totalMins;

            // Layer 0b: skip if any time range block covers this slot
            const blockedByTimeRange = timeBlocks.some(b => {
                const appliesToTech = b.techEmail === '' || b.techEmail === email;
                const overlaps      = slotEnd > b.startMins && t < b.endMins;
                return appliesToTech && overlaps;
            });
            if (blockedByTimeRange) continue;

            // Layer 3: check no appointment conflict
            const free = busy.every(b => slotEnd <= b.start || t >= b.end);
            if (free) {
                if (!slotMap[t]) slotMap[t] = [];
                slotMap[t].push(email);
            }
        }
    });

    console.log('Availability slot map', {
        dateStr,
        totalMins,
        techsChecked: techEmails.length,
        slotCount: Object.keys(slotMap).length,
        techs: techEmails
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
        const [maps, loadMap] = await Promise.all([
            Promise.all(chunks.map(chunk => av_getSlotMap(date, chunk, totalMins))),
            av_getDailyLoadMap(date)
        ]);
        const slotMap  = av_mergeSlotMaps(maps);
        const rankedResult = av_rankSlotMap(slotMap, loadMap);

        if (!Object.keys(rankedResult.normalized).length) {
            slotsEl.innerHTML = '<p style="color:var(--error);font-size:0.875rem;grid-column:1/-1;">No available times for this date. Try a different date.</p>';
            return;
        }

        window.av_lastSlotContext = { date, loadMap, ranked: rankedResult.ranked, slotMap: rankedResult.normalized };
        av_renderSlots(rankedResult.normalized, slotsEl, 'bk_selectSlot', { loadMap, ranked: rankedResult.ranked });

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
                const loadMap = window.av_lastSlotContext?.loadMap || {};
                const assignedEmail = [...available].sort((a, b) => (loadMap[a] || 0) - (loadMap[b] || 0))[0];
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
        const [maps, loadMap] = await Promise.all([
            Promise.all(chunks.map(chunk => av_getSlotMap(dateStr, chunk, maxDuration))),
            av_getDailyLoadMap(dateStr)
        ]);
        const slotMap = av_mergeSlotMaps(maps);

        // Filter: slot must have at least as many free techs as group members
        const groupSize    = grp_members.length;
        const filteredMap  = {};
        Object.entries(slotMap).forEach(([t, techs]) => {
            if (techs.length >= groupSize) filteredMap[t] = techs;
        });
        const rankedResult = av_rankSlotMap(filteredMap, loadMap);

        if (!Object.keys(rankedResult.normalized).length) {
            grid.innerHTML = '<p style="color:var(--error);grid-column:1/-1;text-align:center;padding:16px 0;">No slots available for your group on this date. Try a different date.</p>';
            return;
        }

        window.av_lastGroupSlotContext = { date: dateStr, loadMap, ranked: rankedResult.ranked, slotMap: rankedResult.normalized };
        // Render with grp_selectSlot handler
        av_renderSlots(rankedResult.normalized, grid, 'grp_selectSlot', { loadMap, ranked: rankedResult.ranked });

    } catch (e) {
        grid.innerHTML = `<p style="color:var(--error);grid-column:1/-1;">Could not load slots: ${e.message}</p>`;
        console.error('av group slots error:', e);
    }
};


// ============================================================
//  PHASE 8B SAFETY — GROUP SLOT SELECTOR FALLBACK
//  Keeps group slots clickable even if group-booking.js does not
//  expose grp_selectSlot globally before availability.js renders.
// ============================================================
window.grp_selectSlot = window.grp_selectSlot || function(time, btn) {
    try {
        document.querySelectorAll('#grp_slots .slot-btn').forEach(b => b.classList.remove('selected'));
        if (btn) btn.classList.add('selected');

        const timeEl = document.getElementById('grp_time');
        if (timeEl) timeEl.value = time;

        let availableTechs = [];
        try {
            availableTechs = JSON.parse(btn?.getAttribute('data-techs') || '[]');
        } catch (e) {
            availableTechs = [];
        }

        const loadMap = window.av_lastGroupSlotContext?.loadMap || {};
        window.grp_selectedTime = time;
        window.grp_selectedSlotTechs = [...availableTechs].sort((a, b) => (loadMap[a] || 0) - (loadMap[b] || 0));

        const confirmBtn = document.getElementById('grp_toConfirmBtn');
        if (confirmBtn) confirmBtn.disabled = false;

        console.log('Phase 8B group slot selected:', { time, availableTechs: window.grp_selectedSlotTechs });
    } catch (e) {
        console.error('grp_selectSlot fallback failed:', e);
        if (typeof toast === 'function') toast('Could not select this time. Please try again.', 'error');
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
window.av_getDailyLoadMap = av_getDailyLoadMap;
window.av_rankSlotMap  = av_rankSlotMap;
window.av_formatTimeFromMins = av_formatTimeFromMins;
window.av_getSlotLabel = av_getSlotLabel;

console.log('Thuraya availability engine 4b loaded.');


// Phase 5.5E: Unified solo/group availability alignment loaded.
console.log('Thuraya availability engine Phase 8B Client Intelligence loaded.');
