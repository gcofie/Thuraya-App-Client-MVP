// ============================================================
//  THURAYA — 4c + 4d  Attendance Module  attendance.js
//  Add to index.html after app.js:
//    <script src="attendance.js"></script>
//
//  Firestore collections used:
//    Staff_Schedules/{techEmail}  — working hours per tech
//    Staff_Leave/{autoId}         — leave requests
//    Staff_Leave_Balances/{techEmail}/{year}/entitlement — paid days
//    Users                        — tech list (already loaded in app.js)
// ============================================================


// ── Sub-tab switcher ──────────────────────────────────────────
window.att_switchSub = function(subId) {
    document.querySelectorAll('.att-sub').forEach(el => el.style.display = 'none');
    const target = document.getElementById(subId);
    if (target) target.style.display = 'block';

    // Lazy-load data when tab is first opened
    if (subId === 'att_roster')   att_initRoster();
    if (subId === 'att_schedule') att_initSchedule();
    if (subId === 'att_leave')    att_initLeave();
    if (subId === 'att_balances') att_initBalances();
};

// Called when attendanceView module is switched to
window.att_onModuleOpen = function() {
    att_populateTechDropdowns();
    att_initRoster(); // default sub-tab
};

// Override switchModule to hook into attendance open
const _att_origSwitchModule = window.switchModule;
window.switchModule = function(moduleId) {
    _att_origSwitchModule(moduleId);
    if (moduleId === 'attendanceView') att_onModuleOpen();
};


// ── Populate all tech dropdowns ───────────────────────────────
function att_populateTechDropdowns() {
    // allTechs is populated by fetchAllTechs() in app.js
    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);

    const selectors = ['att_schedTech', 'att_leaveTech', 'att_leaveTechFilter', 'att_blockTech'];
    selectors.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        const isFilter  = id === 'att_leaveTechFilter';
        const isOptional = id === 'att_blockTech';
        const current = el.value;
        el.innerHTML = isFilter
            ? '<option value="all">All Staff</option>'
            : isOptional
                ? '<option value="">All technicians</option>'
                : '<option value="">Select staff member…</option>';
        techs.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.email;
            opt.textContent = t.name || t.email;
            el.appendChild(opt);
        });
        if (current) el.value = current;
    });
}

// Resolve same-effective-date schedule segments safely.
// Example: Mon-Thu and Fri-Sat rows can both apply from the same date.
const ATT_DEFAULT_WORKING_DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat'];

function att_dayAbbr(dateStr) {
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return days[new Date(dateStr + 'T12:00:00').getDay()];
}

function att_scheduleDateValue(value) {
    if (!value) return '';
    if (typeof value === 'string') return value.slice(0, 10);
    if (value && typeof value.toDate === 'function') {
        try { return value.toDate().toISOString().slice(0, 10); } catch(e) {}
    }
    if (value instanceof Date) return value.toISOString().slice(0, 10);
    return '';
}

function att_scheduleMillis(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value && typeof value.toMillis === 'function') {
        try { return value.toMillis(); } catch(e) {}
    }
    if (value && typeof value.toDate === 'function') {
        try { return value.toDate().getTime(); } catch(e) {}
    }
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : 0;
    }
    return 0;
}

function att_scheduleRecord(data, sourceOrder) {
    if (!data) return null;
    return {
        workingDays: Array.isArray(data.workingDays) ? data.workingDays : [],
        startTime: data.startTime || '08:00',
        endTime: data.endTime || '20:00',
        effectiveFrom: att_scheduleDateValue(data.effectiveFrom) || '0000-00-00',
        _savedMillis: Math.max(att_scheduleMillis(data.savedAt), att_scheduleMillis(data.updatedAt), att_scheduleMillis(data.savedAtMs)),
        _sourceOrder: sourceOrder || 0
    };
}

function att_scheduleRecordsFromData(data, sourceOrder) {
    if (!data) return [];
    const segments = [];
    if (Array.isArray(data.scheduleSegments)) {
        data.scheduleSegments.forEach(segment => {
            const record = att_scheduleRecord(segment, sourceOrder || 3);
            if (record && record.workingDays.length) segments.push(record);
        });
    }
    if (segments.length) return segments;

    const records = [];
    const current = att_scheduleRecord(data, sourceOrder || 2);
    if (current && current.workingDays.length) records.push(current);
    return records;
}

function att_publicScheduleSegment(record) {
    return {
        workingDays: Array.from(new Set(record.workingDays || [])),
        startTime: record.startTime || '08:00',
        endTime: record.endTime || '20:00',
        effectiveFrom: record.effectiveFrom || att_todayStr(),
        savedAtMs: record._savedMillis || Date.now()
    };
}

function att_uniqueScheduleSegments(records) {
    const seen = new Set();
    return (records || [])
        .filter(Boolean)
        .filter(r => (r.workingDays || []).length)
        .sort(att_compareSchedules)
        .filter(r => {
            const key = [
                r.effectiveFrom || '',
                (r.workingDays || []).join('|'),
                r.startTime || '',
                r.endTime || ''
            ].join('::');
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .map(att_publicScheduleSegment)
        .slice(0, 30);
}

function att_mergeScheduleSegments(records, newData) {
    const next = att_scheduleRecord({ ...newData, savedAtMs: Date.now() }, 4);
    if (!next) return att_uniqueScheduleSegments(records);

    const nextDays = new Set(next.workingDays || []);
    const kept = [];

    (records || []).filter(Boolean).forEach(record => {
        if ((record.effectiveFrom || '') !== (next.effectiveFrom || '')) {
            kept.push(record);
            return;
        }
        const remainingDays = (record.workingDays || []).filter(day => !nextDays.has(day));
        if (remainingDays.length) kept.push({ ...record, workingDays: remainingDays });
    });

    kept.push(next);
    return att_uniqueScheduleSegments(kept);
}

function att_compareSchedules(a, b) {
    const eff = String(b.effectiveFrom || '').localeCompare(String(a.effectiveFrom || ''));
    if (eff) return eff;
    const saved = (b._savedMillis || 0) - (a._savedMillis || 0);
    if (saved) return saved;
    return (b._sourceOrder || 0) - (a._sourceOrder || 0);
}

function att_defaultSchedule() {
    return {
        workingDays: ATT_DEFAULT_WORKING_DAYS.slice(),
        startTime: '08:00',
        endTime: '20:00',
        effectiveFrom: '0000-00-00',
        _isDefault: true
    };
}

function att_resolveScheduleForDate(records, dateStr) {
    const dayAbbr = att_dayAbbr(dateStr);
    const effective = (records || [])
        .filter(Boolean)
        .filter(s => !s.effectiveFrom || s.effectiveFrom <= dateStr)
        .sort(att_compareSchedules);

    if (!effective.length) return att_defaultSchedule();

    const latest = effective[0] || {};
    if ((latest.workingDays || []).includes(dayAbbr)) return latest;

    // The newest effective schedule is authoritative; older records must not revive a configured day off.
    return {
        ...latest,
        startTime: latest.startTime || '08:00',
        endTime: latest.endTime || '20:00',
        _isDayOff: true
    };
}

async function att_scheduleHistoryRecords(email, isCurrent = window.ThurayaSessionResources.capture()) {
    if (!isCurrent()) return [];
    try {
        const snap = await db.collection('Staff_Schedules').doc(email)
            .collection('history')
            .orderBy('savedAt', 'desc')
            .limit(60)
            .get();
        if (!isCurrent()) return [];
        return snap.docs.flatMap(d => att_scheduleRecordsFromData(d.data(), 1)).filter(Boolean);
    } catch(e) {
        if (!isCurrent()) return [];
        console.warn('Schedule history unavailable for roster:', email, e);
        return [];
    }
}

async function att_buildScheduleMapForDate(techs, dateStr, schedSnap, isCurrent = window.ThurayaSessionResources.capture()) {
    if (!isCurrent()) return {};
    const current = {};
    schedSnap.forEach(d => { current[d.id] = d.data() || {}; });

    const entries = await Promise.all((techs || []).map(async t => {
        if (!isCurrent()) return null;
        const email = t.email;
        const records = [];
        if (current[email]) records.push(...att_scheduleRecordsFromData(current[email], 2));
        records.push(...await att_scheduleHistoryRecords(email, isCurrent));
        if (!isCurrent()) return null;
        return [email, att_resolveScheduleForDate(records, dateStr)];
    }));

    if (!isCurrent()) return {};
    return entries.reduce((map, [email, schedule]) => {
        map[email] = schedule || att_defaultSchedule();
        return map;
    }, {});
}


// ============================================================
//  DAILY ROSTER
// ============================================================
let att_rosterAttendanceUnsubscribe = null;
let att_rosterAttendanceDay = '';
let att_rosterRequestId = 0;
const att_rosterResources = window.ThurayaSessionResources;

att_rosterResources.onStop('attendance-roster-state', () => {
    att_rosterAttendanceUnsubscribe = null;
    att_rosterAttendanceDay = '';
    att_rosterRequestId++;
    const list = document.getElementById('att_rosterList');
    if (list) list.innerHTML = '';
});

function att_listenRosterAttendance(dateStr) {
    if (!att_rosterResources.active()) return;
    if (att_rosterAttendanceDay === dateStr && att_rosterResources.has('attendance-roster')) return;
    if (att_rosterAttendanceUnsubscribe) att_rosterAttendanceUnsubscribe();
    att_rosterAttendanceUnsubscribe = null;
    att_rosterAttendanceDay = dateStr;
    if (!window.thurayaAttendance?.listenDay) return;

    att_rosterAttendanceUnsubscribe = att_rosterResources.manage('attendance-roster', (current, dispose) =>
        window.thurayaAttendance.listenDay(db, dateStr, aggregate => {
            if (!current() || att_rosterAttendanceDay !== dateStr || document.getElementById('att_rosterDate')?.value !== dateStr) return;
            return window.att_loadRoster(aggregate);
        }, error => {
            if (!current()) return;
            dispose();
            att_rosterAttendanceDay = '';
            att_rosterAttendanceUnsubscribe = null;
            att_rosterRequestId++;
            console.warn('Daily roster Attendance listener failed', error);
        }));
}

function att_initRoster() {
    if (!att_rosterResources.active()) return;
    const dateEl = document.getElementById('att_rosterDate');
    if (dateEl && !dateEl.value) {
        // Default to today
        const now = new Date();
        dateEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }
    att_loadRoster();
}

function att_rosterAggregateForTech(attendanceAgg, email, dateStr) {
    const api = window.thurayaAttendance;
    const cleanEmail = api?.normalizeEmail ? api.normalizeEmail(email) : String(email || '').toLowerCase().trim();
    return attendanceAgg?.byEmailDate?.[`${cleanEmail}|${dateStr}`] || null;
}

function att_rosterTime(value) {
    if (window.thurayaAttendance?.formatTime) return window.thurayaAttendance.formatTime(value);
    return value ? 'Recorded' : '-';
}

function att_rosterScheduleText(schedule) {
    if (!schedule || schedule._isDayOff) return 'Not scheduled';
    return `${att_fmt12(schedule.startTime)} - ${att_fmt12(schedule.endTime)}`;
}

function att_rosterDurationText(minutes) {
    if (window.thurayaAttendance?.durationText) return window.thurayaAttendance.durationText(minutes || 0);
    const total = Math.max(0, parseInt(minutes || 0, 10));
    const h = Math.floor(total / 60);
    const m = total % 60;
    return h ? `${h}h ${m}m` : `${m}m`;
}

function att_rosterAttendanceHours(aggregate) {
    if (!aggregate) return '';
    if (aggregate.isPresent && aggregate.effectiveSession) {
        return `In: ${att_rosterTime(aggregate.effectiveSession.clockIn)}`;
    }
    if (aggregate.workedToday) {
        const start = att_rosterTime(aggregate.firstClockIn);
        const end = att_rosterTime(aggregate.lastClockOut || aggregate.effectiveSession?.clockOut);
        const duration = aggregate.totalMinutesWorked ? ` (${att_rosterDurationText(aggregate.totalMinutesWorked)})` : '';
        return `${start} - ${end}${duration}`;
    }
    return '';
}

function att_rosterStatusForTech({ aggregate, leaveType, worksDay, dayAbbr, schedule }) {
    const scheduleText = att_rosterScheduleText(schedule);

    if (aggregate?.isPresent) {
        return {
            statusHtml: `<span class="att-badge att-badge--working">${aggregate.onLunch ? 'On Lunch' : 'Clocked In'}</span>`,
            hours: att_rosterAttendanceHours(aggregate) || scheduleText,
            note: `${leaveType ? `Approved ${leaveType}; ` : ''}${worksDay ? `Scheduled ${scheduleText}` : `Unscheduled on ${dayAbbr}`}${aggregate.multipleOpen ? '; multiple open shifts flagged' : ''}`
        };
    }

    if (aggregate?.workedToday) {
        return {
            statusHtml: '<span class="att-badge att-badge--working">Worked Today</span>',
            hours: att_rosterAttendanceHours(aggregate) || scheduleText,
            note: `${leaveType ? `Approved ${leaveType}; ` : ''}${worksDay ? `Scheduled ${scheduleText}` : `Unscheduled on ${dayAbbr}`}`
        };
    }

    if (leaveType) {
        return {
            statusHtml: `<span class="att-badge att-badge--leave">${leaveType}</span>`,
            hours: '-',
            note: 'On approved leave'
        };
    }

    if (!worksDay) {
        return {
            statusHtml: '<span class="att-badge att-badge--off">Day Off</span>',
            hours: '-',
            note: `Not scheduled on ${dayAbbr}`
        };
    }

    return {
        statusHtml: '<span class="att-badge att-badge--working">Scheduled</span>',
        hours: scheduleText,
        note: 'Not clocked in'
    };
}
window.att_loadRoster = async function(attendanceOverride) {
    const current = att_rosterResources.capture();
    if (!current()) return;
    const dateStr = document.getElementById('att_rosterDate')?.value;
    const listEl  = document.getElementById('att_rosterList');
    if (!dateStr || !listEl) return;

    const requestId = ++att_rosterRequestId;
    const isCurrent = () => current() && requestId === att_rosterRequestId
        && document.getElementById('att_rosterDate')?.value === dateStr;
    att_listenRosterAttendance(dateStr);
    if (!isCurrent()) return;
    const dayAbbr = att_dayAbbr(dateStr);

    if (!attendanceOverride?.byEmailDate) {
        listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:20px 0;">Loading...</p>';
    }

    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);
    if (!techs.length) {
        listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px 0;">No staff found.</p>';
        return;
    }

    try {
        const attendancePromise = attendanceOverride?.byEmailDate
            ? Promise.resolve(attendanceOverride)
            : window.thurayaAttendance?.fetchDayAggregates
                ? window.thurayaAttendance.fetchDayAggregates(db, dateStr)
                : Promise.resolve({ byEmailDate: {} });

        const [schedSnap, leaveSnap, attendanceAgg] = await Promise.all([
            db.collection('Staff_Schedules').get(),
            db.collection('Staff_Leave').where('status', '==', 'Approved').get(),
            attendancePromise
        ]);

        if (!isCurrent()) return;
        const schedMap = await att_buildScheduleMapForDate(techs, dateStr, schedSnap, isCurrent);
        // Older reads must not replace a newer attendance event or selected day.
        if (!isCurrent()) return;

        const onLeave = {};
        leaveSnap.forEach(d => {
            const l = d.data();
            if (l.startDate <= dateStr && l.endDate >= dateStr && l.techEmail) {
                const email = window.thurayaAttendance?.normalizeEmail
                    ? window.thurayaAttendance.normalizeEmail(l.techEmail)
                    : String(l.techEmail || '').toLowerCase().trim();
                onLeave[email] = l.type || 'Leave';
            }
        });

        let html = '<table style="width:100%; border-collapse:collapse;">';
        html += `<thead><tr style="background:#f1f1f1;">
            <th style="padding:10px; text-align:left; font-size:0.85rem; color:var(--primary);">Staff Member</th>
            <th style="padding:10px; text-align:center; font-size:0.85rem; color:var(--primary);">Status</th>
            <th style="padding:10px; text-align:center; font-size:0.85rem; color:var(--primary);">Working Hours</th>
            <th style="padding:10px; text-align:center; font-size:0.85rem; color:var(--primary);">Note</th>
        </tr></thead><tbody>`;

        techs.forEach(t => {
            const email = window.thurayaAttendance?.normalizeEmail
                ? window.thurayaAttendance.normalizeEmail(t.email)
                : String(t.email || '').toLowerCase().trim();
            const sched = schedMap[t.email] || schedMap[email] || att_defaultSchedule();
            const worksDay = (sched.workingDays || []).includes(dayAbbr);
            const leaveType = onLeave[email];
            const aggregate = att_rosterAggregateForTech(attendanceAgg, email, dateStr);
            const rosterState = att_rosterStatusForTech({ aggregate, leaveType, worksDay, dayAbbr, schedule: sched });
            const esc = window.thurayaAttendance?.escapeHtml || (v => String(v ?? ''));

            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:12px 10px; font-weight:600; color:var(--primary);">${esc(t.name || t.email)}</td>
                <td style="padding:12px 10px; text-align:center;">${rosterState.statusHtml}</td>
                <td style="padding:12px 10px; text-align:center; color:#555; font-size:0.88rem;">${esc(rosterState.hours)}</td>
                <td style="padding:12px 10px; text-align:center; color:#999; font-size:0.82rem; font-style:italic;">${esc(rosterState.note)}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        listEl.innerHTML = html;

    } catch (e) {
        if (!isCurrent()) return;
        listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px 0;">Error loading roster: ${e.message}</p>`;
    }
};

// ============================================================
//  WORKING HOURS  (4c)
// ============================================================
function att_initSchedule() {
    att_populateTechDropdowns();
    const formEl = document.getElementById('att_schedForm');
    if (formEl) formEl.style.display = 'block';
    const effEl = document.getElementById('att_schedEffective');
    if (effEl && !effEl.value) {
        const now = new Date();
        effEl.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    }
    if (![...document.querySelectorAll('.att-day-cb')].some(cb => cb.checked)) {
        document.querySelectorAll('.att-day-cb').forEach(cb => {
            cb.checked = ['Mon','Tue','Wed','Thu','Fri','Sat'].includes(cb.value);
        });
    }
}

window.att_loadSchedule = async function() {
    const email = document.getElementById('att_schedTech')?.value;
    const formEl    = document.getElementById('att_schedForm');
    const badgeEl   = document.getElementById('att_schedCurrentBadge');
    const badgeTxt  = document.getElementById('att_schedCurrentText');
    const histBox   = document.getElementById('att_schedHistoryBox');
    const histEl    = document.getElementById('att_schedHistory');

    if (formEl)  formEl.style.display  = 'block';
    if (badgeEl) badgeEl.style.display = 'none';
    if (histBox) histBox.style.display = 'none';
    if (!email) return;

    try {
        const doc = await db.collection('Staff_Schedules').doc(email).get();
        if (doc.exists) {
            const s = doc.data();
            // Populate form
            const startEl = document.getElementById('att_schedStart');
            const endEl   = document.getElementById('att_schedEnd');
            if (startEl) startEl.value = s.startTime || '08:00';
            if (endEl)   endEl.value   = s.endTime   || '20:00';

            // Tick working days
            document.querySelectorAll('.att-day-cb').forEach(cb => {
                cb.checked = (s.workingDays || []).includes(cb.value);
            });

            // Show current summary badge
            const days = (s.workingDays || []).join(', ');
            if (badgeEl && badgeTxt) {
                badgeTxt.textContent = `${days} · ${att_fmt12(s.startTime)} – ${att_fmt12(s.endTime)}`;
                badgeEl.style.display = 'block';
            }
        } else {
            // Defaults
            document.querySelectorAll('.att-day-cb').forEach(cb => {
                cb.checked = ['Mon','Tue','Wed','Thu','Fri','Sat'].includes(cb.value);
            });
            const startEl = document.getElementById('att_schedStart');
            const endEl   = document.getElementById('att_schedEnd');
            if (startEl) startEl.value = '08:00';
            if (endEl)   endEl.value   = '20:00';
        }

        // Load history (Staff_Schedule_History sub-collection)
        const histSnap = await db.collection('Staff_Schedules').doc(email)
            .collection('history')
            .orderBy('savedAt', 'desc')
            .limit(10)
            .get();

        if (!histSnap.empty && histBox && histEl) {
            histBox.style.display = 'block';
            histEl.innerHTML = histSnap.docs.map(d => {
                const h = d.data();
                const days = (h.workingDays || []).join(', ');
                let savedAt = '';
                try { savedAt = h.savedAt?.toDate().toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); } catch(e) {}
                return `<div style="padding:8px 0; border-bottom:1px solid #eee; font-size:0.85rem; color:#555;">
                    <strong style="color:var(--primary);">${days}</strong> · ${att_fmt12(h.startTime)} – ${att_fmt12(h.endTime)}
                    <span style="float:right; color:#999;">${savedAt}</span>
                </div>`;
            }).join('');
        } else if (histBox) {
            histBox.style.display = 'none';
        }

    } catch (e) {
        console.error('att_loadSchedule:', e);
    }
};

function att_selectedScheduleFormData(requireTech) {
    const email   = document.getElementById('att_schedTech')?.value;
    const start   = document.getElementById('att_schedStart')?.value;
    const end     = document.getElementById('att_schedEnd')?.value;
    const effDate = document.getElementById('att_schedEffective')?.value;
    const days    = [...document.querySelectorAll('.att-day-cb:checked')].map(c => c.value);

    if (requireTech && !email) { alert('Please select a staff member.'); return null; }
    if (!days.length) { alert('Please select at least one working day.'); return null; }
    if (!start || !end) { alert('Please set start and end times.'); return null; }
    if (start >= end) { alert('End time must be after start time.'); return null; }

    return {
        email,
        workingDays: days,
        startTime: start,
        endTime: end,
        effectiveFrom: effDate || att_todayStr()
    };
}

async function att_buildScheduleSaveData(ref, formData) {
    const data = {
        workingDays:   formData.workingDays,
        startTime:     formData.startTime,
        endTime:       formData.endTime,
        effectiveFrom: formData.effectiveFrom,
        updatedAt:     firebase.firestore.FieldValue.serverTimestamp()
    };

    const existingRecords = [];
    try {
        const existingDoc = await ref.get();
        if (existingDoc.exists) existingRecords.push(...att_scheduleRecordsFromData(existingDoc.data(), 2));

        const histSnap = await ref.collection('history')
            .orderBy('savedAt', 'desc')
            .limit(60)
            .get();
        histSnap.forEach(d => {
            existingRecords.push(...att_scheduleRecordsFromData(d.data(), 1));
        });
    } catch(e) {
        console.warn('Existing schedule segments unavailable during save:', e);
    }

    data.scheduleSegments = att_mergeScheduleSegments(existingRecords, {
        workingDays: formData.workingDays,
        startTime: formData.startTime,
        endTime: formData.endTime,
        effectiveFrom: formData.effectiveFrom
    });

    return data;
}

function att_activeScheduleTechs() {
    const techs = (typeof allTechs !== 'undefined' && Array.isArray(allTechs)) ? allTechs : [];
    return techs.filter(t => t && t.email);
}

window.att_saveSchedule = async function() {
    const formData = att_selectedScheduleFormData(true);
    const btn     = document.getElementById('btnSaveSchedule');

    if (!formData) return;

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        const batch = db.batch();
        const ref   = db.collection('Staff_Schedules').doc(formData.email);
        const data  = await att_buildScheduleSaveData(ref, formData);

        // Save to main doc
        batch.set(ref, data, { merge: true });

        // Save snapshot to history sub-collection
        const histRef = ref.collection('history').doc();
        batch.set(histRef, { ...data, savedAt: firebase.firestore.FieldValue.serverTimestamp() });

        await batch.commit();

        btn.textContent = '✓ Saved';
        btn.style.background = 'var(--success)';
        setTimeout(() => { btn.disabled = false; btn.textContent = 'Save Working Hours'; btn.style.background = ''; }, 2000);

        // Refresh display
        att_loadSchedule();

    } catch (e) {
        alert('Error saving schedule: ' + e.message);
        btn.disabled = false; btn.textContent = 'Save Working Hours';
    }
};

window.att_applyScheduleToAllTechs = async function() {
    const formData = att_selectedScheduleFormData(false);
    const techs = att_activeScheduleTechs();
    const btn = document.getElementById('btnApplyScheduleAll');
    const saveBtn = document.getElementById('btnSaveSchedule');

    if (!formData) return;
    if (!techs.length) {
        alert('No technicians are loaded yet. Refresh Staff Matrix or reopen Attendance.');
        return;
    }

    const confirmed = confirm(
        `Apply this schedule to all ${techs.length} techs?\n\n` +
        `Days: ${formData.workingDays.join(', ')}\n` +
        `Hours: ${att_fmt12(formData.startTime)} - ${att_fmt12(formData.endTime)}\n` +
        `Effective from: ${formData.effectiveFrom}\n\n` +
        'This updates each tech schedule and writes schedule history for rollback.'
    );
    if (!confirmed) return;

    if (btn) { btn.disabled = true; btn.textContent = 'Applying...'; }
    if (saveBtn) saveBtn.disabled = true;

    let batch = db.batch();
    let writes = 0;
    let applied = 0;

    try {
        for (const tech of techs) {
            const ref = db.collection('Staff_Schedules').doc(tech.email);
            const data = await att_buildScheduleSaveData(ref, formData);

            batch.set(ref, data, { merge: true });
            batch.set(ref.collection('history').doc(), {
                ...data,
                savedAt: firebase.firestore.FieldValue.serverTimestamp(),
                appliedToAllTechs: true
            });
            writes += 2;
            applied += 1;

            if (writes >= 450) {
                await batch.commit();
                batch = db.batch();
                writes = 0;
            }
        }

        if (writes > 0) await batch.commit();

        if (btn) {
            btn.textContent = `Applied to ${applied}`;
            btn.style.background = 'var(--success)';
        }

        setTimeout(() => {
            if (btn) { btn.disabled = false; btn.textContent = 'Apply to All Techs'; btn.style.background = ''; }
            if (saveBtn) saveBtn.disabled = false;
        }, 2200);

        if (document.getElementById('att_schedTech')?.value) att_loadSchedule();
    } catch (e) {
        alert('Error applying schedule to all techs: ' + e.message);
        if (btn) { btn.disabled = false; btn.textContent = 'Apply to All Techs'; btn.style.background = ''; }
        if (saveBtn) saveBtn.disabled = false;
    }
};


// ============================================================
//  LEAVE MANAGEMENT  (4d)
// ============================================================
function att_initLeave() {
    att_populateTechDropdowns();
    att_loadLeaveRequests();
}

window.att_submitLeave = async function() {
    const email     = document.getElementById('att_leaveTech')?.value;
    const type      = document.getElementById('att_leaveType')?.value;
    const startDate = document.getElementById('att_leaveStart')?.value;
    const endDate   = document.getElementById('att_leaveEnd')?.value;
    const note      = document.getElementById('att_leaveNote')?.value?.trim() || '';
    const msgEl     = document.getElementById('att_leaveMsg');
    const btn       = document.getElementById('btnSubmitLeave');

    if (!email)     { att_leaveMsg('Select a staff member.', false); return; }
    if (!type)      { att_leaveMsg('Select a leave type.', false); return; }
    if (!startDate) { att_leaveMsg('Select a start date.', false); return; }
    if (!endDate)   { att_leaveMsg('Select an end date.', false); return; }
    if (endDate < startDate) { att_leaveMsg('End date cannot be before start date.', false); return; }

    btn.disabled = true; btn.textContent = 'Submitting…';

    try {
        const tech = (typeof allTechs !== 'undefined' ? allTechs : []).find(t => t.email === email);

        await db.collection('Staff_Leave').add({
            techEmail:   email,
            techName:    tech?.name || email,
            type,
            startDate,
            endDate,
            note,
            status:      'Approved', // Manager-submitted = auto-approved
            approvedBy:  typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            createdAt:   firebase.firestore.FieldValue.serverTimestamp()
        });

        att_leaveMsg('✓ Leave request submitted and approved.', true);

        // Reset form
        ['att_leaveTech','att_leaveType','att_leaveStart','att_leaveEnd'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.value = '';
        });
        const noteEl = document.getElementById('att_leaveNote');
        if (noteEl) noteEl.value = '';

        att_loadLeaveRequests();

    } catch (e) {
        att_leaveMsg('Error: ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = 'Submit Leave Request';
    }
};

function att_leaveMsg(msg, ok) {
    const el = document.getElementById('att_leaveMsg');
    if (!el) return;
    el.textContent = msg;
    el.style.color = ok ? 'var(--success)' : 'var(--error)';
}

window.att_loadLeaveRequests = async function() {
    const listEl      = document.getElementById('att_leaveList');
    const filterStatus= document.getElementById('att_leaveFilter')?.value || 'all';
    const filterTech  = document.getElementById('att_leaveTechFilter')?.value || 'all';
    if (!listEl) return;

    listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:20px 0;">Loading…</p>';

    try {
        let query = db.collection('Staff_Leave').orderBy('startDate', 'desc').limit(100);
        const snap = await query.get();

        let docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));

        // Client-side filter
        if (filterStatus !== 'all') docs = docs.filter(d => d.status === filterStatus);
        if (filterTech !== 'all')   docs = docs.filter(d => d.techEmail === filterTech);

        if (!docs.length) {
            listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px 0;">No leave requests found.</p>';
            return;
        }

        const statusColors = { Approved: 'var(--success)', Pending: 'var(--accent)', Rejected: 'var(--error)' };

        listEl.innerHTML = docs.map(d => {
            const days    = att_daysBetween(d.startDate, d.endDate);
            const color   = statusColors[d.status] || '#999';
            const actions = d.status === 'Pending' ? `
                <button onclick="att_updateLeaveStatus('${d.id}','Approved')"
                    style="background:var(--success); color:white; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:bold;">Approve</button>
                <button onclick="att_updateLeaveStatus('${d.id}','Rejected')"
                    style="background:var(--error); color:white; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:0.8rem; font-weight:bold; margin-left:6px;">Reject</button>` : '';

            const deleteBtn = `<button onclick="att_deleteLeave('${d.id}')"
                style="background:transparent; border:1px solid #ccc; color:#999; padding:4px 10px; border-radius:4px; cursor:pointer; font-size:0.78rem; margin-left:6px;">Delete</button>`;

            return `<div style="border:1px solid var(--border); border-radius:6px; padding:14px 16px; margin-bottom:10px; background:white;">
                <div style="display:flex; justify-content:space-between; align-items:flex-start; flex-wrap:wrap; gap:8px;">
                    <div>
                        <strong style="color:var(--primary); font-size:0.95rem;">${d.techName || d.techEmail}</strong>
                        <span style="margin-left:8px; background:${color}22; color:${color}; border:1px solid ${color}44; font-size:0.72rem; font-weight:700; padding:2px 8px; border-radius:10px; text-transform:uppercase;">${d.status}</span>
                        <span style="margin-left:6px; background:#f1f1f1; color:#555; font-size:0.72rem; padding:2px 8px; border-radius:10px;">${d.type}</span>
                    </div>
                    <div style="font-size:0.82rem; color:#666; text-align:right;">
                        ${att_fmtDate(d.startDate)} – ${att_fmtDate(d.endDate)}
                        <span style="margin-left:6px; font-weight:700; color:var(--primary);">(${days} day${days !== 1 ? 's' : ''})</span>
                    </div>
                </div>
                ${d.note ? `<p style="margin-top:6px; font-size:0.82rem; color:#666; font-style:italic;">${d.note}</p>` : ''}
                <div style="margin-top:10px; display:flex; align-items:center; gap:4px; flex-wrap:wrap;">
                    ${actions}${deleteBtn}
                    ${d.approvedBy ? `<span style="margin-left:auto; font-size:0.75rem; color:#999;">Approved by ${d.approvedBy}</span>` : ''}
                </div>
            </div>`;
        }).join('');

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px 0;">Error: ${e.message}</p>`;
    }
};

window.att_updateLeaveStatus = async function(id, status) {
    try {
        await db.collection('Staff_Leave').doc(id).update({
            status,
            approvedBy: typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            updatedAt:  firebase.firestore.FieldValue.serverTimestamp()
        });
        att_loadLeaveRequests();
    } catch (e) { alert('Error updating status: ' + e.message); }
};

window.att_deleteLeave = async function(id) {
    if (!confirm('Delete this leave request?')) return;
    try {
        await db.collection('Staff_Leave').doc(id).delete();
        att_loadLeaveRequests();
    } catch (e) { alert('Error deleting: ' + e.message); }
};


// ============================================================
//  LEAVE BALANCES  (4d)
// ============================================================
function att_initBalances() {
    // Populate year selector
    const yearEl = document.getElementById('att_balYear');
    if (yearEl && !yearEl.options.length) {
        const thisYear = new Date().getFullYear();
        for (let y = thisYear; y >= thisYear - 3; y--) {
            const opt = document.createElement('option');
            opt.value = y; opt.textContent = y;
            yearEl.appendChild(opt);
        }
    }
    att_loadBalances();
    att_loadEntitlements();
}

window.att_loadBalances = async function() {
    const year   = document.getElementById('att_balYear')?.value || new Date().getFullYear();
    const listEl = document.getElementById('att_balancesList');
    if (!listEl) return;

    listEl.innerHTML = '<p style="color:#999; font-style:italic; text-align:center; padding:20px 0;">Loading…</p>';

    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);
    if (!techs.length) { listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px 0;">No staff found.</p>'; return; }

    const yearStart = `${year}-01-01`;
    const yearEnd   = `${year}-12-31`;

    try {
        // Single where clause only — filter year client-side to avoid composite index
        const snap = await db.collection('Staff_Leave')
            .where('status', '==', 'Approved')
            .get();

        let docs = [];
        snap.forEach(d => docs.push(d.data()));
        // Filter to selected year client-side
        docs = docs.filter(d => d.startDate >= yearStart && d.startDate <= yearEnd);

        // Tally days per tech per type
        const tally = {};
        docs.forEach(l => {
            if (!tally[l.techEmail]) tally[l.techEmail] = {};
            const days = att_daysBetween(l.startDate, l.endDate);
            tally[l.techEmail][l.type] = (tally[l.techEmail][l.type] || 0) + days;
        });

        // Fetch entitlements
        const entSnap = await db.collection('Staff_Leave_Balances').get();
        const entitlements = {};
        entSnap.forEach(d => {
            const data = d.data();
            entitlements[d.id] = data[year] || data.annualLeave || 14; // default 14 days
        });

        const leaveTypes = ['Annual Leave', 'Day Off', 'Wellness Day', 'Sick Leave', 'Leave Without Pay', 'Public Holiday'];

        let html = `<table style="width:100%; border-collapse:collapse; font-size:0.88rem;">
            <thead><tr style="background:#f1f1f1;">
                <th style="padding:10px; text-align:left; color:var(--primary);">Staff Member</th>
                ${leaveTypes.map(t => `<th style="padding:10px; text-align:center; color:var(--primary);">${t}</th>`).join('')}
                <th style="padding:10px; text-align:center; color:var(--primary);">Annual Entitlement</th>
                <th style="padding:10px; text-align:center; color:var(--primary);">Balance Remaining</th>
            </tr></thead><tbody>`;

        techs.forEach(t => {
            const usage    = tally[t.email] || {};
            const entitled = entitlements[t.email] || 14;
            const annualUsed = usage['Annual Leave'] || 0;
            const remaining  = entitled - annualUsed;
            const remColor   = remaining < 0 ? 'var(--error)' : remaining <= 3 ? 'var(--accent)' : 'var(--success)';

            html += `<tr style="border-bottom:1px solid #eee;">
                <td style="padding:10px; font-weight:600; color:var(--primary);">${t.name || t.email}</td>
                ${leaveTypes.map(lt => `<td style="padding:10px; text-align:center; color:#555;">${usage[lt] || 0}</td>`).join('')}
                <td style="padding:10px; text-align:center; font-weight:700; color:var(--primary);">${entitled}</td>
                <td style="padding:10px; text-align:center; font-weight:700; color:${remColor};">${remaining}</td>
            </tr>`;
        });

        html += '</tbody></table>';
        listEl.innerHTML = html;

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error); text-align:center; padding:20px 0;">Error: ${e.message}</p>`;
    }
};

async function att_loadEntitlements() {
    const listEl = document.getElementById('att_entitlementsList');
    if (!listEl) return;

    const techs = (typeof allTechs !== 'undefined' ? allTechs : []);
    if (!techs.length) return;

    const year = new Date().getFullYear();

    try {
        const snap = await db.collection('Staff_Leave_Balances').get();
        const existing = {};
        snap.forEach(d => { existing[d.id] = d.data(); });

        listEl.innerHTML = `<div class="grid-3">` + techs.map(t => {
            const data    = existing[t.email] || {};
            const current = data[year] || data.annualLeave || 14;
            return `<div style="background:#f9f9f9; border:1px solid var(--border); border-radius:6px; padding:12px 14px;">
                <p style="font-weight:700; color:var(--primary); margin-bottom:8px; font-size:0.88rem;">${t.name || t.email}</p>
                <div style="display:flex; align-items:center; gap:8px;">
                    <input type="number" id="ent_${t.email.replace('@','_').replace('.','_')}"
                        value="${current}" min="0" max="365"
                        style="width:70px; padding:6px; border:1px solid var(--border); border-radius:4px; font-size:0.9rem; text-align:center;">
                    <span style="font-size:0.8rem; color:#666;">days / year</span>
                    <button onclick="att_saveEntitlement('${t.email}')"
                        style="background:var(--manager); color:white; border:none; padding:5px 12px; border-radius:4px; cursor:pointer; font-size:0.78rem; font-weight:bold; margin-left:auto;">Save</button>
                </div>
            </div>`;
        }).join('') + `</div>`;

    } catch (e) {
        listEl.innerHTML = `<p style="color:var(--error);">Error: ${e.message}</p>`;
    }
}

window.att_saveEntitlement = async function(email) {
    const safeId = email.replace('@','_').replace('.','_');
    const val    = parseInt(document.getElementById(`ent_${safeId}`)?.value || 14);
    const year   = new Date().getFullYear();
    try {
        await db.collection('Staff_Leave_Balances').doc(email).set(
            { [year]: val, updatedAt: firebase.firestore.FieldValue.serverTimestamp() },
            { merge: true }
        );
        // Brief visual confirmation
        const btn = document.querySelector(`button[onclick="att_saveEntitlement('${email}')"]`);
        if (btn) { btn.textContent = '✓'; btn.style.background = 'var(--success)'; setTimeout(() => { btn.textContent = 'Save'; btn.style.background = ''; }, 1500); }
    } catch (e) { alert('Error: ' + e.message); }
};


// ============================================================
//  UTILITIES
// ============================================================
function att_todayStr() {
    const n = new Date();
    return `${n.getFullYear()}-${String(n.getMonth()+1).padStart(2,'0')}-${String(n.getDate()).padStart(2,'0')}`;
}

function att_fmt12(timeStr) {
    if (!timeStr) return '—';
    const [h, m] = timeStr.split(':').map(Number);
    return `${h % 12 || 12}:${String(m).padStart(2,'0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

function att_fmtDate(dateStr) {
    if (!dateStr) return '—';
    try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }); }
    catch(e) { return dateStr; }
}

function att_daysBetween(start, end) {
    try {
        const ms = new Date(end + 'T12:00:00') - new Date(start + 'T12:00:00');
        return Math.max(1, Math.round(ms / 86400000) + 1);
    } catch(e) { return 1; }
}

function att_chunk(arr, size) {
    const chunks = [];
    for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
    return chunks;
}

console.log('Thuraya Attendance Module 4c+4d loaded.');


// ============================================================
//  MY ATTENDANCE MODULE — all staff roles
// ============================================================

const _myatt_origSwitch = window.switchModule;
window.switchModule = function(moduleId) {
    _myatt_origSwitch(moduleId);
    if (moduleId === 'myAttendanceView') myatt_onOpen();
};

function myatt_onOpen() {
    const startEl = document.getElementById('myatt_leaveStart');
    const endEl   = document.getElementById('myatt_leaveEnd');
    const today   = att_todayStr();
    if (startEl) startEl.min = today;
    if (endEl)   endEl.min   = today;
    myatt_loadSchedule();
    myatt_loadBalance();
}

window.myatt_switchSub = function(subId) {
    document.querySelectorAll('.myatt-sub').forEach(el => el.style.display = 'none');
    const target = document.getElementById(subId);
    if (target) target.style.display = 'block';
    if (subId === 'myatt_schedule') { myatt_loadSchedule(); myatt_loadBalance(); }
    if (subId === 'myatt_history')  myatt_loadHistory();
};

async function myatt_loadSchedule() {
    const el = document.getElementById('myatt_scheduleDisplay');
    if (!el) return;
    const email = typeof currentUserEmail !== 'undefined' ? currentUserEmail : '';
    if (!email) { el.innerHTML = '<p style="color:var(--error);">Not signed in.</p>'; return; }
    try {
        const doc = await db.collection('Staff_Schedules').doc(email).get();
        if (!doc.exists) {
            el.innerHTML = '<div style="padding:16px;background:#fafafa;border:1px solid var(--border);border-radius:6px;color:#666;font-size:0.9rem;">No schedule assigned yet. Please contact your manager.</div>';
            return;
        }
        const s = doc.data();
        const days = (s.workingDays || []).join('  ·  ');
        el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:16px;">
            <div style="flex:1;min-width:180px;background:#f0f7ff;border:1px solid #b8cddb;border-radius:8px;padding:16px 20px;text-align:center;">
                <p style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--manager);margin-bottom:6px;">Working Days</p>
                <p style="font-size:1rem;font-weight:700;color:var(--primary);">${days || '—'}</p>
            </div>
            <div style="flex:1;min-width:140px;background:#f0f7ff;border:1px solid #b8cddb;border-radius:8px;padding:16px 20px;text-align:center;">
                <p style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--manager);margin-bottom:6px;">Start Time</p>
                <p style="font-size:1.2rem;font-weight:700;color:var(--primary);">${att_fmt12(s.startTime)}</p>
            </div>
            <div style="flex:1;min-width:140px;background:#f0f7ff;border:1px solid #b8cddb;border-radius:8px;padding:16px 20px;text-align:center;">
                <p style="font-size:0.75rem;text-transform:uppercase;letter-spacing:1px;color:var(--manager);margin-bottom:6px;">End Time</p>
                <p style="font-size:1.2rem;font-weight:700;color:var(--primary);">${att_fmt12(s.endTime)}</p>
            </div>
        </div>`;
    } catch(e) {
        el.innerHTML = `<p style="color:var(--error);">Error: ${e.message}</p>`;
    }
}

async function myatt_loadBalance() {
    const el = document.getElementById('myatt_balanceDisplay');
    if (!el) return;
    const email = typeof currentUserEmail !== 'undefined' ? currentUserEmail : '';
    if (!email) return;
    const year = new Date().getFullYear();
    const yearStart = `${year}-01-01`, yearEnd = `${year}-12-31`;
    try {
        const [leaveSnap, entDoc] = await Promise.all([
            db.collection('Staff_Leave').where('techEmail','==',email).where('status','==','Approved').get(),
            db.collection('Staff_Leave_Balances').doc(email).get()
        ]);
        const tally = {};
        leaveSnap.forEach(d => {
            const l = d.data();
            if (l.startDate < yearStart || l.startDate > yearEnd) return;
            const days = att_daysBetween(l.startDate, l.endDate);
            tally[l.type] = (tally[l.type] || 0) + days;
        });
        const entData = entDoc.exists ? entDoc.data() : {};
        const entitled = entData[year] || entData.annualLeave || 14;
        const annualUsed = tally['Annual Leave'] || 0;
        const remaining  = entitled - annualUsed;
        const remColor   = remaining < 0 ? 'var(--error)' : remaining <= 3 ? 'var(--accent)' : 'var(--success)';
        const leaveTypes = ['Annual Leave','Day Off','Wellness Day','Sick Leave','Leave Without Pay'];
        el.innerHTML = `<div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:16px;">
            <div style="background:#f0fff4;border:1px solid #a3d9b1;border-radius:8px;padding:14px 20px;text-align:center;flex:1;min-width:130px;">
                <p style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--success);margin-bottom:4px;">Entitlement</p>
                <p style="font-size:1.6rem;font-weight:700;color:var(--success);">${entitled}</p>
                <p style="font-size:0.72rem;color:#666;">days / year</p>
            </div>
            <div style="background:#fff8f0;border:1px solid #f0c080;border-radius:8px;padding:14px 20px;text-align:center;flex:1;min-width:130px;">
                <p style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:var(--accent);margin-bottom:4px;">Annual Used</p>
                <p style="font-size:1.6rem;font-weight:700;color:var(--accent);">${annualUsed}</p>
                <p style="font-size:0.72rem;color:#666;">days in ${year}</p>
            </div>
            <div style="background:#f0f7ff;border:1px solid #b8cddb;border-radius:8px;padding:14px 20px;text-align:center;flex:1;min-width:130px;">
                <p style="font-size:0.72rem;text-transform:uppercase;letter-spacing:1px;color:${remColor};margin-bottom:4px;">Remaining</p>
                <p style="font-size:1.6rem;font-weight:700;color:${remColor};">${remaining}</p>
                <p style="font-size:0.72rem;color:#666;">days left</p>
            </div>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:0.85rem;">
            <thead><tr style="background:#f1f1f1;">${leaveTypes.map(t => `<th style="padding:8px 10px;text-align:center;color:var(--primary);">${t}</th>`).join('')}</tr></thead>
            <tbody><tr>${leaveTypes.map(t => `<td style="padding:8px 10px;text-align:center;color:#555;">${tally[t]||0} day${(tally[t]||0)!==1?'s':''}</td>`).join('')}</tr></tbody>
        </table>`;
    } catch(e) {
        el.innerHTML = `<p style="color:var(--error);">Error: ${e.message}</p>`;
    }
}

window.myatt_submitRequest = async function() {
    const type      = document.getElementById('myatt_leaveType')?.value;
    const startDate = document.getElementById('myatt_leaveStart')?.value;
    const endDate   = document.getElementById('myatt_leaveEnd')?.value;
    const note      = document.getElementById('myatt_leaveNote')?.value?.trim() || '';
    const msgEl     = document.getElementById('myatt_submitMsg');
    const btn       = document.getElementById('btnMyattSubmit');
    const setMsg = (msg, ok) => { if(msgEl){ msgEl.textContent=msg; msgEl.style.color=ok?'var(--success)':'var(--error)'; } };

    if (!type)      { setMsg('Please select a leave type.', false); return; }
    if (!startDate) { setMsg('Please select a start date.', false); return; }
    if (!endDate)   { setMsg('Please select an end date.', false); return; }
    if (endDate < startDate) { setMsg('End date cannot be before start date.', false); return; }
    if (!note)      { setMsg('Please add a reason for your request.', false); return; }

    const email = typeof currentUserEmail !== 'undefined' ? currentUserEmail : '';
    const name  = typeof currentUserName  !== 'undefined' ? currentUserName  : email;
    if (!email) { setMsg('Not signed in.', false); return; }

    btn.disabled = true; btn.textContent = 'Submitting…';
    try {
        await db.collection('Staff_Leave').add({
            techEmail: email, techName: name, type, startDate, endDate, note,
            status: 'Pending', approvedBy: '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });
        setMsg('✓ Request submitted. Your manager will review it shortly.', true);
        ['myatt_leaveType','myatt_leaveStart','myatt_leaveEnd'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });
        const noteEl = document.getElementById('myatt_leaveNote');
        if (noteEl) noteEl.value = '';
    } catch(e) {
        setMsg('Error: ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = 'Submit Request';
    }
};

window.myatt_loadHistory = async function() {
    const el = document.getElementById('myatt_historyList');
    if (!el) return;
    const email = typeof currentUserEmail !== 'undefined' ? currentUserEmail : '';
    if (!email) { el.innerHTML = '<p style="color:var(--error);">Not signed in.</p>'; return; }
    el.innerHTML = '<p style="color:#999;font-style:italic;text-align:center;padding:20px 0;">Loading…</p>';
    try {
        const snap = await db.collection('Staff_Leave').where('techEmail','==',email).get();
        if (snap.empty) { el.innerHTML = '<p style="color:#999;text-align:center;padding:20px 0;">No leave requests found.</p>'; return; }
        const docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
        docs.sort((a,b) => (b.startDate||'').localeCompare(a.startDate||''));
        const statusColors = { Approved:'var(--success)', Pending:'var(--accent)', Rejected:'var(--error)' };
        const statusIcons  = { Approved:'✓', Pending:'⏳', Rejected:'✕' };
        el.innerHTML = docs.map(d => {
            const days  = att_daysBetween(d.startDate, d.endDate);
            const color = statusColors[d.status] || '#999';
            const icon  = statusIcons[d.status]  || '?';
            return `<div style="border:1px solid var(--border);border-radius:6px;padding:14px 16px;margin-bottom:10px;background:white;border-left:4px solid ${color};">
                <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;">
                    <div>
                        <span style="background:${color}22;color:${color};border:1px solid ${color}44;font-size:0.72rem;font-weight:700;padding:2px 9px;border-radius:10px;text-transform:uppercase;">${icon} ${d.status}</span>
                        <span style="margin-left:8px;background:#f1f1f1;color:#555;font-size:0.72rem;padding:2px 8px;border-radius:10px;">${d.type}</span>
                    </div>
                    <div style="font-size:0.82rem;color:#666;text-align:right;">${att_fmtDate(d.startDate)} – ${att_fmtDate(d.endDate)} <span style="margin-left:6px;font-weight:700;color:var(--primary);">(${days} day${days!==1?'s':''})</span></div>
                </div>
                ${d.note ? `<p style="margin-top:8px;font-size:0.82rem;color:#666;font-style:italic;">"${d.note}"</p>` : ''}
                ${d.status==='Rejected'&&d.rejectionNote ? `<p style="margin-top:4px;font-size:0.8rem;color:var(--error);">Manager note: ${d.rejectionNote}</p>` : ''}
                ${d.approvedBy ? `<p style="margin-top:4px;font-size:0.75rem;color:#999;">${d.status==='Approved'?'Approved':'Actioned'} by ${d.approvedBy}</p>` : ''}
                ${d.status==='Pending' ? `<button onclick="myatt_cancelRequest('${d.id}')" style="margin-top:8px;background:transparent;border:1px solid var(--error);color:var(--error);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.78rem;">Withdraw Request</button>` : ''}
            </div>`;
        }).join('');
    } catch(e) {
        el.innerHTML = `<p style="color:var(--error);text-align:center;padding:20px 0;">Error: ${e.message}</p>`;
    }
};

window.myatt_cancelRequest = async function(id) {
    if (!confirm('Withdraw this leave request?')) return;
    try { await db.collection('Staff_Leave').doc(id).delete(); myatt_loadHistory(); }
    catch(e) { alert('Error: ' + e.message); }
};

// Manager: rejection note prompt
const _orig_updateStatus = window.att_updateLeaveStatus;
window.att_updateLeaveStatus = async function(id, status) {
    if (status === 'Rejected') {
        const note = prompt('Optional: Add a note explaining the rejection (shown to staff):') || '';
        try {
            await db.collection('Staff_Leave').doc(id).update({
                status, rejectionNote: note,
                approvedBy: typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            });
            att_loadLeaveRequests();
        } catch(e) { alert('Error: ' + e.message); }
    } else {
        _orig_updateStatus(id, status);
    }
};

// Manager Attendance: pending count badge
const _att_origOpen = window.att_onModuleOpen;
window.att_onModuleOpen = async function() {
    _att_origOpen();
    try {
        const snap = await db.collection('Staff_Leave').where('status','==','Pending').get();
        if (snap.size > 0) {
            const leaveRadio = document.querySelector('input[value="att_leave"]');
            if (leaveRadio) {
                const lbl = leaveRadio.closest('label');
                if (lbl && !lbl.querySelector('.pending-badge')) {
                    const badge = document.createElement('span');
                    badge.className = 'pending-badge';
                    badge.textContent = snap.size;
                    badge.style.cssText = 'background:var(--error);color:white;border-radius:50%;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;font-size:0.7rem;font-weight:700;margin-left:6px;';
                    lbl.appendChild(badge);
                }
            }
        }
    } catch(e) { /* silent */ }
};

// Expose tab show for app.js to call
window.myatt_showTab = function() {
    const tab = document.getElementById('tabMyAttendance');
    if (tab) tab.style.display = 'flex';
};

console.log('Thuraya My Attendance module loaded.');


// ============================================================
//  CALENDAR BLOCKS — 5b-ii
//  Manager blocks dates/times to prevent bookings
// ============================================================

// Add "Calendar Blocks" sub-tab to att_switchSub
const _att_origSwitchSub = window.att_switchSub;
window.att_switchSub = function(subId) {
    _att_origSwitchSub(subId);
    if (subId === 'att_blocks') att_initBlocks();
};

function att_initBlocks() {
    const dateEl = document.getElementById('att_blockDate');
    if (dateEl && !dateEl.value) dateEl.value = att_todayStr();
    // Re-populate tech dropdown in case allTechs wasn't ready on module open
    att_populateTechDropdowns();
    // Re-trigger field visibility in case type was already selected
    att_onBlockTypeChange();
    att_loadBlocks();
}

window.att_saveBlock = async function() {
    const type       = document.getElementById('att_blockType')?.value;
    const dateStr    = document.getElementById('att_blockDate')?.value;
    const rangeStart = document.getElementById('att_blockRangeStart')?.value;
    const rangeEnd   = document.getElementById('att_blockRangeEnd')?.value;
    const startTime  = document.getElementById('att_blockStart')?.value;
    const endTime    = document.getElementById('att_blockEnd')?.value;
    const techEmail  = document.getElementById('att_blockTech')?.value || '';
    const reason     = document.getElementById('att_blockReason')?.value?.trim() || '';
    const btn        = document.getElementById('btnSaveBlock');
    const msgEl      = document.getElementById('att_blockMsg');

    const setMsg = (msg, ok) => { if(msgEl){ msgEl.textContent=msg; msgEl.style.color=ok?'var(--success)':'var(--error)'; } };

    if (!type) { setMsg('Select a block type.', false); return; }

    if (type === 'date_range') {
        if (!rangeStart || !rangeEnd) { setMsg('Select start and end dates for the date range.', false); return; }
        if (rangeEnd < rangeStart)    { setMsg('End date must be after start date.', false); return; }
    } else {
        if (!dateStr) { setMsg('Select a date.', false); return; }
    }
    if (type === 'time_range' && (!startTime || !endTime)) { setMsg('Select start and end times.', false); return; }
    if (type === 'time_range' && endTime <= startTime)      { setMsg('End time must be after start time.', false); return; }

    btn.disabled = true; btn.textContent = 'Saving…';
    try {
        await db.collection('Calendar_Blocks').add({
            type,
            // Single date fields
            dateString:  (type !== 'date_range') ? dateStr : '',
            // Date range fields
            rangeStart:  type === 'date_range' ? rangeStart : '',
            rangeEnd:    type === 'date_range' ? rangeEnd   : '',
            // Time fields
            startTime:   type === 'time_range' ? startTime : '',
            endTime:     type === 'time_range' ? endTime   : '',
            techEmail,
            reason,
            createdBy: typeof currentUserEmail !== 'undefined' ? currentUserEmail : '',
            createdAt: firebase.firestore.FieldValue.serverTimestamp()
        });

        setMsg('✓ Block saved.', true);

        // Reset form
        ['att_blockDate','att_blockRangeStart','att_blockRangeEnd',
         'att_blockStart','att_blockEnd','att_blockReason'].forEach(id => {
            const el = document.getElementById(id); if(el) el.value = '';
        });
        const typeEl = document.getElementById('att_blockType');
        if (typeEl) { typeEl.value = ''; att_onBlockTypeChange(); }
        att_loadBlocks();

    } catch(e) {
        setMsg('Error: ' + e.message, false);
    } finally {
        btn.disabled = false; btn.textContent = 'Save Block';
    }
};

window.att_loadBlocks = async function() {
    const listEl = document.getElementById('att_blocksList');
    if (!listEl) return;
    listEl.innerHTML = '<p style="color:#999;font-style:italic;text-align:center;padding:16px 0;">Loading…</p>';
    try {
        const today = att_todayStr();
        const snap  = await db.collection('Calendar_Blocks').get();

        if (snap.empty) {
            listEl.innerHTML = '<p style="color:#999;text-align:center;padding:16px 0;">No upcoming blocks.</p>';
            return;
        }

        // Filter to upcoming only — for date_range use rangeEnd, else dateString
        let docs = [];
        snap.forEach(d => docs.push({ id: d.id, ...d.data() }));
        docs = docs.filter(d => {
            if (d.type === 'date_range') return (d.rangeEnd || '') >= today;
            return (d.dateString || '') >= today;
        });

        if (!docs.length) {
            listEl.innerHTML = '<p style="color:#999;text-align:center;padding:16px 0;">No upcoming blocks.</p>';
            return;
        }

        // Sort by start date
        docs.sort((a, b) => {
            const aDate = a.type === 'date_range' ? (a.rangeStart||'') : (a.dateString||'');
            const bDate = b.type === 'date_range' ? (b.rangeStart||'') : (b.dateString||'');
            return aDate.localeCompare(bDate);
        });

        const typeLabels = {
            full_day:     '🔴 Full Day',
            date_range:   '🟣 Date Range',
            time_range:   '🟡 Time Range',
            tech_specific:'🟠 Tech Specific'
        };

        listEl.innerHTML = docs.map(d => {
            const label = typeLabels[d.type] || d.type;
            let dateDisplay = '';
            if (d.type === 'date_range') {
                dateDisplay = `${att_fmtDate(d.rangeStart)} – ${att_fmtDate(d.rangeEnd)}`;
            } else {
                dateDisplay = att_fmtDate(d.dateString);
            }
            const times = d.type === 'time_range' ? ` · ${att_fmt12(d.startTime)} – ${att_fmt12(d.endTime)}` : '';
            const tech  = d.techEmail ? ` · ${d.techEmail}` : (d.type === 'tech_specific' || d.type === 'time_range' ? ' · All techs' : '');

            return `<div style="border:1px solid var(--border);border-radius:6px;padding:12px 14px;margin-bottom:8px;background:white;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">
                <div>
                    <span style="font-weight:700;color:var(--primary);font-size:0.88rem;">${dateDisplay}</span>
                    <span style="margin-left:8px;font-size:0.8rem;color:#666;">${label}${times}${tech}</span>
                    ${d.reason ? `<p style="margin:4px 0 0;font-size:0.78rem;color:#999;font-style:italic;">${d.reason}</p>` : ''}
                </div>
                <button onclick="att_deleteBlock('${d.id}')"
                    style="background:transparent;border:1px solid var(--error);color:var(--error);padding:4px 12px;border-radius:4px;cursor:pointer;font-size:0.78rem;flex-shrink:0;">
                    Remove
                </button>
            </div>`;
        }).join('');
    } catch(e) {
        listEl.innerHTML = `<p style="color:var(--error);text-align:center;padding:16px 0;">Error: ${e.message}</p>`;
    }
};

window.att_deleteBlock = async function(id) {
    if (!confirm('Remove this calendar block?')) return;
    try { await db.collection('Calendar_Blocks').doc(id).delete(); att_loadBlocks(); }
    catch(e) { alert('Error: ' + e.message); }
};

// Toggle fields based on block type
window.att_onBlockTypeChange = function() {
    const type            = document.getElementById('att_blockType')?.value;
    const singleDateField = document.getElementById('att_blockSingleDateField');
    const dateRangeFields = document.getElementById('att_blockDateRangeFields');
    const timeFields      = document.getElementById('att_blockTimeFields');
    const techField       = document.getElementById('att_blockTechField');
    const techLabel       = document.getElementById('att_blockTechLabel');

    // Single date shown for everything except date_range
    if (singleDateField) singleDateField.style.display = type === 'date_range' ? 'none' : 'block';
    // Date range shown only for date_range
    if (dateRangeFields) dateRangeFields.style.display = type === 'date_range' ? 'grid' : 'none';
    // Time fields shown only for time_range
    if (timeFields)      timeFields.style.display      = type === 'time_range'  ? 'grid' : 'none';
    // Tech field shown for time_range, tech_specific AND date_range
    if (techField)       techField.style.display       = (type === 'time_range' || type === 'tech_specific' || type === 'date_range') ? 'block' : 'none';
    // Update label hint for date_range — tech is required, not optional
    if (techLabel) {
        techLabel.textContent = type === 'date_range'
            ? 'Technician (leave blank to block all techs)'
            : 'Technician (leave blank to apply to all)';
    }
};

console.log('Thuraya Calendar Blocks module loaded.');
