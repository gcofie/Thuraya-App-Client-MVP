/* ============================================================
   THURAYA STAFF APP — HF91C3 TECH MY CLIENTS TODAY
   Staff App only. Read-only technician preparation layer.
   - No booking mutations
   - No availability changes
   - No Firebase structure changes
   - Excludes Returned To FOH / Action Required and completed service lifecycle bookings
   ============================================================ */
(function () {
    if (window.THURAYA_HF91C3_TECH_EXPECTED_LOADED) return;
    window.THURAYA_HF91C3_TECH_EXPECTED_LOADED = true;

    let unsubscribe = null;
    let activeJobsUnsubscribe = null;
    let appointmentRows = [];
    let activeJobRows = [];
    let currentTechEmail = '';
    let currentTechName = '';
    let userIsTech = false;
    let renderTimer = null;

    function todayString() {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function safe(value) {
        return String(value ?? '').replace(/[&<>'"]/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[ch]));
    }

    function fmtTime(timeStr) {
        if (!timeStr) return '—';
        const parts = String(timeStr).split(':');
        const hr = parseInt(parts[0], 10) || 0;
        const min = String(parts[1] || '00').padStart(2, '0');
        const ampm = hr >= 12 ? 'PM' : 'AM';
        const hr12 = hr % 12 || 12;
        return `${hr12}:${min} ${ampm}`;
    }

    function isReturnedToFOH(appt) {
        return appt?.needsFOHAttention === true ||
            appt?.rescheduleRequested === true ||
            appt?.fohAction === 'Reschedule Requested' ||
            appt?.status === 'Action Required' ||
            appt?.status === 'FOH Review';
    }

    function ensurePanel() {
        const atelier = document.getElementById('atelierView');
        if (!atelier || !userIsTech) return null;

        let list = document.getElementById('techExpectedTodayList');
        if (list) return list;

        const panel = document.createElement('div');
        panel.id = 'techExpectedTodayPanel';
        panel.className = 'module-box th-tech-expected-panel';
        panel.style.cssText = 'border-top:4px solid #111; margin-bottom:20px; display:block;';
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom:12px;">
                <div>
                    <h3 style="color:#111; border-bottom-color:var(--accent); margin-bottom:6px;">My Clients Today</h3>
                    <p style="font-size:.85rem; color:#666; margin:0;">Read-only preparation view. FOH still controls booking changes.</p>
                </div>
                <span id="techExpectedTodayCount" class="ticket-badge" style="background:#111; color:#fff; margin-top:2px;">0 Clients</span>
            </div>
            <div id="techExpectedTodayList" style="display:flex; flex-direction:column; gap:10px;">
                <p style="color:#999; font-style:italic; margin:0;">Loading your expected clients...</p>
            </div>
        `;

        const boxes = Array.from(atelier.querySelectorAll('.module-box'));
        const dailyBox = boxes.find(box => /my daily earnings/i.test(box.textContent || ''));
        const queueBox = document.getElementById('techLiveQueue')?.closest('.module-box') || null;
        const anchor = dailyBox || queueBox || boxes[0] || null;

        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor);
        else atelier.prepend(panel);

        return document.getElementById('techExpectedTodayList');
    }

    function renderEmpty(msg) {
        const list = ensurePanel();
        const count = document.getElementById('techExpectedTodayCount');
        if (count) count.textContent = '0 Clients';
        if (list) list.innerHTML = `<p style="color:#999; font-style:italic; margin:0;">${safe(msg || 'No expected clients assigned to you today.')}</p>`;
    }

    function renderAppointments(appts) {
        const list = ensurePanel();
        const count = document.getElementById('techExpectedTodayCount');
        if (!list) return;

        appts.sort((a, b) => String(a.timeString || '').localeCompare(String(b.timeString || '')));
        if (count) count.textContent = `${appts.length} ${appts.length === 1 ? 'Client' : 'Clients'}`;

        if (!appts.length) {
            renderEmpty('No expected clients assigned to you today.');
            return;
        }

        list.innerHTML = appts.map(appt => {
            const status = appt.status || 'Scheduled';
            const statusColor = status === 'Arrived' ? 'var(--accent)' : 'var(--primary)';
            const duration = appt.bookedDuration ? `${safe(appt.bookedDuration)} mins` : 'Duration not set';
            return `
                <div class="ticket th-tech-expected-card" style="border-color:${statusColor}; background:#fff; padding:12px; align-items:flex-start; gap:12px;">
                    <div style="min-width:86px; text-align:center; border-right:1px solid #eee; padding-right:12px;">
                        <div style="font-size:.72rem; text-transform:uppercase; letter-spacing:.12em; color:#888; font-weight:800;">Time</div>
                        <div style="font-size:1rem; color:#111; font-weight:900; margin-top:3px; white-space:nowrap;">${fmtTime(appt.timeString)}</div>
                    </div>
                    <div style="flex:1; min-width:0;">
                        <h4 style="margin:0; font-size:1rem; color:#111; line-height:1.25;">
                            ${safe(appt.clientName || 'Unknown Client')}
                            ${appt.isGroupBooking ? `<span class="group-badge">👥 GROUP · ${safe(appt.groupSize || '')}</span>` : ''}
                        </h4>
                        <p style="margin:5px 0 0; font-size:.83rem; color:var(--primary); line-height:1.35;">💅 <strong>${safe(appt.bookedService || 'N/A')}</strong></p>
                        <p style="margin:5px 0 0; font-size:.78rem; color:#666;">⏱ ${duration} · <span style="color:${statusColor}; font-weight:800;">${safe(status)}</span></p>
                    </div>
                </div>`;
        }).join('');
    }

    function jobKey(row) {
        return [
            String(row?.clientPhone || '').trim(),
            String(row?.clientName || '').trim().toLowerCase(),
            String(row?.assignedTechEmail || '').trim().toLowerCase()
        ].join('|');
    }

    function jobLifecycleStatusForAppointment(appt) {
        const key = jobKey(appt);
        const matches = activeJobRows.filter(job => jobKey(job) === key);
        if (!matches.length) return '';
        const priority = ['Waiting', 'In Progress', 'Ready for Payment', 'Closed', 'Completed', 'FOH Review'];
        matches.sort((a, b) => priority.indexOf(a.status) - priority.indexOf(b.status));
        return matches[0]?.status || '';
    }

    function rebuildTechExpectedToday() {
        const rows = [];
        appointmentRows.forEach(appt => {
            const assigned = String(appt.assignedTechEmail || '').toLowerCase();
            const status = appt.status || 'Scheduled';
            if (assigned !== currentTechEmail) return;
            if (isReturnedToFOH(appt)) return;
            if (['Cancelled', 'No Show', 'Closed', 'Completed', 'Ready for Payment'].includes(status)) return;

            const jobStatus = jobLifecycleStatusForAppointment(appt);

            // Scheduled bookings are future prep and should show.
            if (status === 'Scheduled') {
                rows.push(appt);
                return;
            }

            // Arrived bookings should only remain visible while there is an active floor job.
            // Once the Active_Job is Ready for Payment / Closed / Completed, remove from prep list.
            if (status === 'Arrived') {
                if (['Waiting', 'In Progress'].includes(jobStatus)) {
                    rows.push({ ...appt, status: jobStatus || status });
                }
                return;
            }
        });
        renderAppointments(rows);
    }

    function stopListeners() {
        if (unsubscribe) { try { unsubscribe(); } catch (e) {} unsubscribe = null; }
        if (activeJobsUnsubscribe) { try { activeJobsUnsubscribe(); } catch (e) {} activeJobsUnsubscribe = null; }
        appointmentRows = [];
        activeJobRows = [];
    }

    function startListener() {
        if (!window.firebase || !firebase.firestore || !currentTechEmail || !userIsTech) return;
        ensurePanel();
        stopListeners();

        const db = firebase.firestore();

        unsubscribe = db.collection('Appointments')
            .where('dateString', '==', todayString())
            .onSnapshot(snap => {
                appointmentRows = [];
                snap.forEach(doc => appointmentRows.push({ id: doc.id, ...(doc.data() || {}) }));
                rebuildTechExpectedToday();
            }, err => {
                console.error('HF91C3 My Clients Today appointments listener error:', err);
                renderEmpty('Unable to load today\'s expected clients.');
            });

        activeJobsUnsubscribe = db.collection('Active_Jobs')
            .where('dateString', '==', todayString())
            .where('assignedTechEmail', '==', currentTechEmail)
            .onSnapshot(snap => {
                activeJobRows = [];
                snap.forEach(doc => activeJobRows.push({ id: doc.id, ...(doc.data() || {}) }));
                rebuildTechExpectedToday();
            }, err => {
                console.warn('HF91C3 My Clients Today active jobs listener warning:', err);
                activeJobRows = [];
                rebuildTechExpectedToday();
            });
    }

    async function hydrateUser(user) {
        currentTechEmail = String(user?.email || '').toLowerCase();
        currentTechName = user?.displayName || '';
        userIsTech = false;

        if (!currentTechEmail || !window.firebase || !firebase.firestore) return;

        try {
            const doc = await firebase.firestore().collection('Users').doc(currentTechEmail).get();
            const data = doc.exists ? (doc.data() || {}) : {};
            currentTechName = data.name || currentTechName;
            const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
            userIsTech = roles.some(r => String(r || '').toLowerCase().includes('tech'));
        } catch (e) {
            console.warn('HF91C3 could not read user role; will not show tech panel.', e);
        }

        if (userIsTech) {
            scheduleEnsure();
            startListener();
        } else {
            stopListeners();
            const panel = document.getElementById('techExpectedTodayPanel');
            if (panel) panel.remove();
        }
    }

    function scheduleEnsure() {
        clearTimeout(renderTimer);
        renderTimer = setTimeout(() => {
            ensurePanel();
            // Run again shortly because commission/attendance modules may inject after auth.
            setTimeout(ensurePanel, 400);
            setTimeout(ensurePanel, 1200);
        }, 50);
    }

    function wireNav() {
        document.addEventListener('click', evt => {
            const target = evt.target;
            if (!target) return;
            const label = target.closest?.('label[for="nav_atelier"], #nav_atelier, [onclick*="atelierView"]');
            if (label && userIsTech) scheduleEnsure();
        }, true);
    }

    function init() {
        wireNav();
        if (window.firebase && firebase.auth) {
            firebase.auth().onAuthStateChanged(user => {
                if (user) hydrateUser(user);
                else {
                    currentTechEmail = '';
                    userIsTech = false;
                    stopListeners();
                }
            });
        }

        const observer = new MutationObserver(() => {
            if (userIsTech && document.getElementById('atelierView') && !document.getElementById('techExpectedTodayPanel')) {
                scheduleEnsure();
            }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
