/* ============================================================
   THURAYA STAFF APP — HF91C5 TECH MY CLIENTS TODAY CONSOLIDATED
   Staff App only. Single read-only technician preparation layer.
   - No booking mutations
   - No availability changes
   - No Firebase structure changes
   - One renderer / one ownership point
   ============================================================ */
(function () {
    if (window.THURAYA_TECH_MY_CLIENTS_TODAY_LOADED) return;
    window.THURAYA_TECH_MY_CLIENTS_TODAY_LOADED = true;

    let apptUnsub = null;
    let jobsUnsub = null;
    let apptRows = [];
    let jobRows = [];
    let currentTechEmail = '';
    let userIsTech = false;
    let ensureTimer = null;

    const HIDE_APPT_STATUSES = new Set([
        'cancelled', 'canceled', 'no show', 'closed', 'completed',
        'ready for payment', 'action required', 'foh review'
    ]);
    const ACTIVE_JOB_STATUSES = new Set(['waiting', 'in progress']);
    const COMPLETE_JOB_STATUSES = new Set(['ready for payment', 'closed', 'completed', 'cancelled', 'canceled', 'no show', 'foh review']);

    function todayString() {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    }

    function safe(value) {
        return String(value ?? '').replace(/[&<>'"]/g, ch => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
        }[ch]));
    }

    function normalize(value) {
        return String(value || '').trim().toLowerCase();
    }

    function fmtTime(timeStr) {
        if (!timeStr) return '—';
        const parts = String(timeStr).split(':');
        const hr = parseInt(parts[0], 10) || 0;
        const min = String(parts[1] || '00').padStart(2, '0');
        return `${hr % 12 || 12}:${min} ${hr >= 12 ? 'PM' : 'AM'}`;
    }

    function isReturnedToFOH(appt) {
        return appt?.needsFOHAttention === true ||
            appt?.rescheduleRequested === true ||
            normalize(appt?.fohAction) === 'reschedule requested' ||
            normalize(appt?.status) === 'action required' ||
            normalize(appt?.status) === 'foh review';
    }

    function ensurePanel() {
        const atelier = document.getElementById('atelierView');
        if (!atelier || !userIsTech) return null;

        let list = document.getElementById('techExpectedTodayList');
        if (list) return list;

        const panel = document.createElement('div');
        panel.id = 'techExpectedTodayPanel';
        panel.className = 'module-box th-tech-my-clients-panel';
        panel.style.cssText = 'border-top:4px solid #111; margin-bottom:20px; display:block;';
        panel.innerHTML = `
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:14px; flex-wrap:wrap; margin-bottom:12px;">
                <div>
                    <h3 style="color:#111; border-bottom-color:var(--accent); margin-bottom:6px; text-transform:uppercase; letter-spacing:.06em;">My Clients Today</h3>
                    <p style="font-size:.85rem; color:#666; margin:0;">Read-only preparation view. FOH still controls booking changes.</p>
                </div>
                <span id="techExpectedTodayCount" class="ticket-badge" style="background:#111; color:#fff; margin-top:2px;">0 Clients</span>
            </div>
            <div id="techExpectedTodayList" style="display:flex; flex-direction:column; gap:10px;">
                <p style="color:#999; font-style:italic; margin:0;">Loading your expected clients...</p>
            </div>
        `;

        const boxes = Array.from(atelier.querySelectorAll('.module-box'));
        const commissionBox = boxes.find(box => /my commission today/i.test(box.textContent || ''));
        const dailyBox = boxes.find(box => /my daily earnings/i.test(box.textContent || ''));
        const queueBox = document.getElementById('techLiveQueue')?.closest('.module-box') || null;
        const anchor = commissionBox || dailyBox || queueBox || boxes[0] || null;

        if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(panel, anchor.nextSibling);
        else atelier.prepend(panel);

        return document.getElementById('techExpectedTodayList');
    }

    function renderEmpty(message) {
        const list = ensurePanel();
        const count = document.getElementById('techExpectedTodayCount');
        if (count) count.textContent = '0 Clients';
        if (list) list.innerHTML = `<p style="color:#999; font-style:italic; margin:0;">${safe(message || 'No expected clients assigned to you today.')}</p>`;
    }

    function appointmentKey(appt) {
        return [
            normalize(appt?.clientPhone),
            normalize(appt?.clientName),
            normalize(appt?.assignedTechEmail),
            normalize(appt?.bookedService)
        ].join('|');
    }

    function looseAppointmentKey(appt) {
        return [
            normalize(appt?.clientPhone),
            normalize(appt?.clientName),
            normalize(appt?.assignedTechEmail)
        ].join('|');
    }

    function matchingJobs(appt) {
        const strict = appointmentKey(appt);
        const loose = looseAppointmentKey(appt);
        let matches = jobRows.filter(job => appointmentKey(job) === strict);
        if (!matches.length) matches = jobRows.filter(job => looseAppointmentKey(job) === loose);
        return matches;
    }

    function lifecycleFor(appt) {
        const matches = matchingJobs(appt);
        if (!matches.length) return { hasJob: false, active: false, completed: false, displayStatus: appt.status || 'Scheduled' };
        const statuses = matches.map(j => normalize(j.status));
        const active = statuses.some(s => ACTIVE_JOB_STATUSES.has(s));
        const completed = statuses.some(s => COMPLETE_JOB_STATUSES.has(s));
        const displayStatus = active
            ? (statuses.includes('in progress') ? 'In Progress' : 'Waiting')
            : (matches[0]?.status || appt.status || 'Scheduled');
        return { hasJob: true, active, completed, displayStatus };
    }

    function shouldShow(appt) {
        if (normalize(appt.assignedTechEmail) !== currentTechEmail) return false;
        if (isReturnedToFOH(appt)) return false;

        const apptStatus = normalize(appt.status || 'Scheduled');
        if (HIDE_APPT_STATUSES.has(apptStatus)) return false;

        const life = lifecycleFor(appt);

        // Future/not-yet-started bookings stay visible for prep.
        if (apptStatus === 'scheduled') return true;

        // Arrived bookings only remain while the floor job is actually active.
        if (apptStatus === 'arrived') return life.active && !life.completed;

        // Any other active-like status should only show while there is an active job.
        if (['waiting', 'in progress'].includes(apptStatus)) return life.active && !life.completed;

        return false;
    }

    function render() {
        const list = ensurePanel();
        const count = document.getElementById('techExpectedTodayCount');
        if (!list) return;

        const rows = apptRows
            .filter(shouldShow)
            .map(appt => {
                const life = lifecycleFor(appt);
                return { ...appt, displayStatus: life.displayStatus || appt.status || 'Scheduled' };
            })
            .sort((a, b) => String(a.timeString || '').localeCompare(String(b.timeString || '')));

        if (count) count.textContent = `${rows.length} ${rows.length === 1 ? 'Client' : 'Clients'}`;

        if (!rows.length) {
            renderEmpty('No expected clients assigned to you today.');
            return;
        }

        list.innerHTML = rows.map(appt => {
            const status = appt.displayStatus || appt.status || 'Scheduled';
            const statusNorm = normalize(status);
            const borderColor = statusNorm === 'scheduled' ? 'var(--primary)' : 'var(--accent)';
            const duration = appt.bookedDuration ? `${safe(appt.bookedDuration)} mins` : 'Duration not set';
            return `
                <div class="ticket th-tech-my-client-card" style="border-color:${borderColor}; background:#fff; padding:12px; align-items:flex-start; gap:12px;">
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
                        <p style="margin:5px 0 0; font-size:.78rem; color:#666;">⏱ ${duration} · <span style="color:${borderColor}; font-weight:800;">${safe(status)}</span></p>
                    </div>
                </div>`;
        }).join('');
    }

    function stopListeners() {
        if (apptUnsub) { try { apptUnsub(); } catch (e) {} apptUnsub = null; }
        if (jobsUnsub) { try { jobsUnsub(); } catch (e) {} jobsUnsub = null; }
        apptRows = [];
        jobRows = [];
    }

    function startTechMyClientsTodayListener() {
        if (!window.firebase || !firebase.firestore || !currentTechEmail || !userIsTech) return;
        stopListeners();
        ensurePanel();
        const db = firebase.firestore();
        const today = todayString();

        apptUnsub = db.collection('Appointments')
            .where('dateString', '==', today)
            .onSnapshot(snap => {
                apptRows = [];
                snap.forEach(doc => apptRows.push({ id: doc.id, ...(doc.data() || {}) }));
                render();
            }, err => {
                console.error('My Clients Today appointment listener error:', err);
                renderEmpty('Unable to load today\'s expected clients.');
            });

        jobsUnsub = db.collection('Active_Jobs')
            .where('dateString', '==', today)
            .where('assignedTechEmail', '==', currentTechEmail)
            .onSnapshot(snap => {
                jobRows = [];
                snap.forEach(doc => jobRows.push({ id: doc.id, ...(doc.data() || {}) }));
                render();
            }, err => {
                console.warn('My Clients Today active jobs listener warning:', err);
                jobRows = [];
                render();
            });
    }

    window.startTechExpectedTodayListener = startTechMyClientsTodayListener;
    window.thStartTechMyClientsToday = startTechMyClientsTodayListener;

    function scheduleEnsure() {
        clearTimeout(ensureTimer);
        ensureTimer = setTimeout(() => {
            ensurePanel();
            render();
            setTimeout(() => { ensurePanel(); render(); }, 500);
            setTimeout(() => { ensurePanel(); render(); }, 1400);
        }, 80);
    }

    async function hydrateUser(user) {
        currentTechEmail = normalize(user?.email);
        userIsTech = false;

        if (!currentTechEmail || !window.firebase || !firebase.firestore) return;

        try {
            const doc = await firebase.firestore().collection('Users').doc(currentTechEmail).get();
            const data = doc.exists ? (doc.data() || {}) : {};
            const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
            userIsTech = roles.some(r => normalize(r).includes('tech'));
        } catch (e) {
            console.warn('My Clients Today could not read user role.', e);
        }

        if (userIsTech) {
            scheduleEnsure();
            startTechMyClientsTodayListener();
        } else {
            stopListeners();
            const panel = document.getElementById('techExpectedTodayPanel');
            if (panel) panel.remove();
        }
    }

    function wireNav() {
        document.addEventListener('click', evt => {
            const target = evt.target;
            const isAtelierClick = target?.closest?.('label[for="nav_atelier"], #nav_atelier, [onclick*="atelierView"]');
            if (isAtelierClick && userIsTech) scheduleEnsure();
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
                    const panel = document.getElementById('techExpectedTodayPanel');
                    if (panel) panel.remove();
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
