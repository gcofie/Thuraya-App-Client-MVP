// ============================================================
// THURAYA ATTENDANCE — PHASE 4.3.3 MULTI-SHIFT CLOCK FIX
// Version: attendance-phase4-3-3-multishift-clock-20260427
// Purpose:
// - Clock In remains available after a completed shift.
// - Staff can start a new shift on the same day.
// - Clock Out only appears when there is an active open shift.
// - Login/logout remains separate from attendance.
// ============================================================
console.log("✅ Attendance Phase 4.3.3 loaded: multi-shift clock fix");

(function () {
    let unsubClock = null;
    let pollTimer = null;
    let clockOutPending = false;

    function today() {
        return window.ThurayaSchedulePolicy.businessDate();
    }

    function getDb() {
        if (typeof db !== "undefined" && db) return db;
        if (window.db) return window.db;
        if (window.firebase && firebase.firestore) return firebase.firestore();
        return null;
    }

    function getAuthUser() {
        try {
            return firebase.auth().currentUser || null;
        } catch (_) {
            return null;
        }
    }

    function emailSafe() {
        const user = getAuthUser();
        return String(user?.email || "").toLowerCase().trim();
    }

    function cleanId(v) {
        return String(v || "").replace(/[\/#[\]]/g, "_");
    }

    function primaryDocId(email) {
        return cleanId(`${email}_${today()}`);
    }

    function newShiftDocId(email) {
        return cleanId(`${email}_${today()}_shift_${Date.now()}`);
    }

    function deviceType() {
        const ua = navigator.userAgent || "";
        if (/Mobi|Android|iPhone/i.test(ua)) return "Mobile";
        if (/iPad|Tablet/i.test(ua)) return "Tablet";
        return "Web";
    }

    function toDate(v) {
        if (!v) return null;
        if (typeof v.toDate === "function") return v.toDate();
        if (typeof v === "object" && v.seconds) return new Date(v.seconds * 1000);
        if (v instanceof Date) return v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function sortDateValue(v) {
        const d = toDate(v);
        return d ? d.getTime() : 0;
    }

    function formatTime(v) {
        const d = toDate(v);
        if (!d) return "—";
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone: 'UTC' });
    }

    function durationText(clockIn, clockOut) {
        const s = toDate(clockIn);
        const e = toDate(clockOut);
        if (!s || !e) return "";
        const mins = Math.max(0, Math.floor((e - s) / 60000));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h ? `${h}h ${m}m` : `${m}m`;
    }

    function ensurePanel() {
        const dash = document.getElementById("appDashboard");
        if (!dash) return null;

        let panel = document.getElementById("properClockPanel");
        if (!panel) {
            panel = document.createElement("div");
            panel.id = "properClockPanel";
            panel.innerHTML = `
                <div class="pc431-left">
                    <div id="pc43StatusDot" class="pc431-dot"></div>
                    <div>
                        <div id="pc43StatusText" class="pc431-title">Attendance not loaded</div>
                        <div id="pc43StatusSub" class="pc431-sub">Login/logout is separate from attendance.</div>
                    </div>
                </div>
                <div class="pc431-actions">
                    <button id="pc43ClockInBtn" type="button" class="btn pc431-in">Clock In / Start Shift</button>
                    <button id="pc43ClockOutBtn" type="button" class="btn btn-secondary pc431-out">Clock Out / End Shift</button>
                </div>
            `;
            dash.prepend(panel);
        }

        const inBtn = document.getElementById("pc43ClockInBtn");
        const outBtn = document.getElementById("pc43ClockOutBtn");

        if (inBtn && !inBtn.__pc433Bound) {
            inBtn.__pc433Bound = true;
            inBtn.onclick = function (e) {
                e.preventDefault();
                clockIn();
            };
        }

        if (outBtn && !outBtn.__pc433Bound) {
            outBtn.__pc433Bound = true;
            outBtn.onclick = function (e) {
                e.preventDefault();
                clockOut();
            };
        }

        panel.style.display = getAuthUser() ? "flex" : "none";
        return panel;
    }

    function applyState(state) {
        const panel = ensurePanel();
        if (!panel) return;

        const inBtn = document.getElementById("pc43ClockInBtn");
        const outBtn = document.getElementById("pc43ClockOutBtn");
        const txt = document.getElementById("pc43StatusText");
        const sub = document.getElementById("pc43StatusSub");
        const dot = document.getElementById("pc43StatusDot");

        if (!txt || !sub || !dot || !inBtn || !outBtn) return;

        const active = state?.active || null;
        const lastEnded = state?.lastEnded || null;

        if (active && active.clockIn && !active.clockOut) {
            txt.textContent = "Clocked In";
            sub.textContent = `Since ${formatTime(active.clockIn)} · ${active.latenessStatus === 'UNAVAILABLE' ? 'Plan unavailable' : active.isLate ? "Late" : "On time"} · ${active.device || deviceType()}`;
            dot.style.background = "var(--success)";
            inBtn.style.display = "none";
            outBtn.style.display = "inline-flex";
            return;
        }

        if (lastEnded && lastEnded.clockIn && lastEnded.clockOut) {
            const dur = lastEnded.workDurationText || durationText(lastEnded.clockIn, lastEnded.clockOut);
            txt.textContent = "Shift Ended";
            sub.textContent = `Last shift: ${formatTime(lastEnded.clockIn)} → ${formatTime(lastEnded.clockOut)}${dur ? " · " + dur : ""}. You may start another shift.`;
            dot.style.background = "var(--error)";
            inBtn.textContent = "Clock In / Start New Shift";
            inBtn.style.display = "inline-flex";
            outBtn.style.display = "none";
            return;
        }

        txt.textContent = "Not clocked in today";
        sub.textContent = "Click Clock In when starting your shift.";
        dot.style.background = "#bbb";
        inBtn.textContent = "Clock In / Start Shift";
        inBtn.style.display = "inline-flex";
        outBtn.style.display = "none";
    }

    async function getTodayShiftState() {
        const isCurrent = window.ThurayaSessionResources.capture();
        const requireCurrent = () => { if (!isCurrent()) throw new Error("Attendance session changed."); };
        requireCurrent();
        const database = getDb();
        const user = getAuthUser();
        const email = emailSafe();

        if (!user) throw new Error("User session is still loading.");
        if (!database) throw new Error("Database is not ready.");
        if (!email) throw new Error("Staff email is not available.");

        const records = [];

        // Primary known ID.
        const primaryRef = database.collection("Attendance").doc(primaryDocId(email));
        try {
            const primary = await primaryRef.get();
            requireCurrent();
            if (primary.exists) {
                records.push({ id: primary.id, ref: primaryRef, data: primary.data() || {} });
            }
        } catch (e) {
            requireCurrent();
            console.warn("Primary attendance lookup failed.", e);
        }

        // All records for today, including multi-shift docs.
        try {
            const snap = await database.collection("Attendance")
                .where("email", "==", email)
                .where("dateString", "==", today())
                .get();
            requireCurrent();

            snap.forEach(doc => {
                if (!records.some(r => r.id === doc.id)) {
                    records.push({ id: doc.id, ref: doc.ref, data: doc.data() || {} });
                }
            });
        } catch (e) {
            requireCurrent();
            console.warn("Attendance query failed; using primary only.", e);
        }

        const openRecords = records.filter(r => r.data?.clockIn && !r.data?.clockOut);
        openRecords.sort((a, b) => sortDateValue(b.data.clockIn) - sortDateValue(a.data.clockIn));

        const endedRecords = records.filter(r => r.data?.clockIn && r.data?.clockOut);
        endedRecords.sort((a, b) => sortDateValue(b.data.clockOut) - sortDateValue(a.data.clockOut));

        return {
            email,
            database,
            primaryRef,
            records,
            activeRef: openRecords[0]?.ref || null,
            active: openRecords[0]?.data || null,
            lastEndedRef: endedRecords[0]?.ref || null,
            lastEnded: endedRecords[0]?.data || null
        };
    }

    async function getClockInRef(state) {
        // No records today: use primary doc.
        if (!state.records.length) return state.primaryRef;

        // Primary doc exists but has no clockIn: use it.
        const primary = state.records.find(r => r.id === primaryDocId(state.email));
        if (primary && !primary.data?.clockIn) return primary.ref;

        // If previous shift ended, create a new same-day shift doc.
        return state.database.collection("Attendance").doc(newShiftDocId(state.email));
    }

    async function refreshPanel() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        try {
            ensurePanel();
            const state = await getTodayShiftState();
            if (!isCurrent()) return;
            applyState(state);
        } catch (e) {
            if (!isCurrent()) return;
            ensurePanel();
            applyState(null);
            console.warn("Clock panel refresh waiting:", e.message);
        }
    }

    async function clockIn() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const businessDate = today();
        const user = getAuthUser();
        if (!user) {
            alert("Please wait, user session still loading. Try again in 2 seconds.");
            return;
        }

        let state;
        try {
            state = await getTodayShiftState();
            if (!isCurrent()) return;
        } catch (e) {
            if (!isCurrent()) return;
            console.error("ClockIn init error:", e);
            alert("Clock system is not ready yet. Please wait 2 seconds and try again.");
            return;
        }

        if (state.active) {
            alert("You are already clocked in.");
            applyState(state);
            return;
        }

        const email = state.email;
        const ref = await getClockInRef(state);
        if (!isCurrent()) return;

        try {
            if (today() !== businessDate) throw new Error('Business date changed. Refresh before checking in.');
            let plan;
            try { plan = await window.ThurayaSchedulePolicy.loadSchedule(state.database, email, businessDate, undefined, isCurrent); }
            catch (_) { plan = { worksToday: false, reason: 'SCHEDULE_READ_UNAVAILABLE' }; }
            if (!isCurrent()) return;
            if (today() !== businessDate) throw new Error('Business date changed. Refresh before checking in.');
            const now = new Date();
            const late = window.ThurayaSchedulePolicy.lateness(plan, businessDate, now);
            await ref.set({
                email,
                name: window.currentUserName || user.displayName || "Staff Member",
                roleString: Array.isArray(window.currentRoles) ? window.currentRoles.join(",") : "",
                roles: Array.isArray(window.currentRoles) ? window.currentRoles : [],
                date: today(),
                dateString: today(),
                clockIn: firebase.firestore.Timestamp.fromDate(now),
                clockOut: null,
                status: "Clocked In",
                method: "app",
                device: deviceType(),
                attendancePlanSchemaVersion: 2,
                shiftStart: plan.worksToday ? plan.startTime : null,
                plannedScheduleVersionId: plan.versionId || null,
                plannedScheduleRevision: plan.revision || null,
                plannedEffectiveFrom: plan.effectiveFrom || null,
                latenessStatus: late.status,
                latenessReason: late.reason,
                lateMinutes: late.lateMinutes,
                isLate: late.isLate,
                isMultiShift: state.records.length > 0,
                shiftSequence: state.records.length + 1,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true });

            if (!isCurrent()) return;
            await refreshPanel();
            if (!isCurrent()) return;
            window.ThurayaSessionResources.timeout(refreshPanel, 800);
            if (typeof sp4_loadMyAttendanceIdentity === "function") sp4_loadMyAttendanceIdentity();
            if (typeof att42_loadMyAttendanceIntelligence === "function") att42_loadMyAttendanceIntelligence();
        } catch (e) {
            if (!isCurrent()) return;
            console.error("Clock in failed", e);
            alert("Clock in failed: " + e.message);
        }
    }

    async function clockOut() {
        if (clockOutPending) return;
        clockOutPending = true;
        try {
            await completeClockOut();
        } finally {
            clockOutPending = false;
        }
    }

    async function completeClockOut() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const user = getAuthUser();
        if (!user) {
            alert("Please wait, user session still loading. Try again in 2 seconds.");
            return;
        }

        let state;
        try {
            state = await getTodayShiftState();
            if (!isCurrent()) return;
        } catch (e) {
            if (!isCurrent()) return;
            console.error("ClockOut init error:", e);
            alert("Clock system is not ready yet. Please wait 2 seconds and try again.");
            return;
        }

        if (!state.active || !state.activeRef) {
            alert("You are not currently clocked in.");
            applyState(state);
            return;
        }

        if (!confirm("Clock out and end your current shift now?")) return;

        try {
            if (!isCurrent()) return;
            await state.database.runTransaction(async tx => {
                const snapshot = await tx.get(state.activeRef);
                if (!isCurrent()) throw new Error('Attendance session changed.');
                const current = snapshot.exists ? snapshot.data() : {};
                const start = toDate(current.clockIn);
                const now = new Date();
                if (!start || !Number.isFinite(start.getTime()) || start > now || current.clockOut ||
                    start.getTime() !== toDate(state.active.clockIn)?.getTime()) {
                    throw new Error('No unchanged active shift found. Refresh Attendance before checking out.');
                }
                if (current.lunchActive || String(current.status).toLowerCase() === 'on lunch' ||
                    String(current.availabilityStatus).toLowerCase() === 'lunch') {
                    throw new Error('End the active lunch before checking out.');
                }
                const minutes = window.thurayaAttendance.netWorkingMinutes(Math.floor((now - start) / 60000), current);
                const text = window.thurayaAttendance.durationText(minutes);
                // The saved endpoint must use the same action time as the duration calculation.
                tx.set(state.activeRef, {
                    clockOut: firebase.firestore.Timestamp.fromDate(now),
                    status: 'Clocked Out',
                    workDurationMinutes: minutes,
                    workDurationText: text,
                    totalMinutesWorked: minutes,
                    totalHoursWorkedText: text,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            });

            if (!isCurrent()) return;
            await refreshPanel();
            if (!isCurrent()) return;
            window.ThurayaSessionResources.timeout(refreshPanel, 800);
            if (typeof sp4_loadMyAttendanceIdentity === "function") sp4_loadMyAttendanceIdentity();
            if (typeof att42_loadMyAttendanceIntelligence === "function") att42_loadMyAttendanceIntelligence();
        } catch (e) {
            if (!isCurrent()) return;
            console.error("Clock out failed", e);
            alert("Clock out failed: " + e.message);
        }
    }

    function startLiveListener() {
        const database = getDb();
        const email = emailSafe();
        if (!window.ThurayaSessionResources.active() || !getAuthUser() || !email || !database) return;

        if (unsubClock) {
            try { unsubClock(); } catch (_) {}
            unsubClock = null;
        }

        // Listen to all today's shift docs so button state survives logout/login/refresh.
        try {
            unsubClock = window.ThurayaSessionResources.listen("clock.attendance",
                database.collection("Attendance").where("email", "==", email).where("dateString", "==", today()),
                () => refreshPanel(), err => {
                    console.warn("Clock live listener failed", err);
                    refreshPanel();
                });
        } catch (e) {
            console.warn("Clock live listener setup failed", e);
        }

        pollTimer = window.ThurayaSessionResources.interval("clock.poll", refreshPanel, 15000);
    }

    function patchLogout() {
        window.logOut = async function () {
            // Authentication only. Never clock out on logout/browser close.
            window.ThurayaSessionResources.disposeAll("logout");
            await firebase.auth().signOut();
            if (typeof showLoggedOutOnly === "function") showLoggedOutOnly();
        };
    }

    patchLogout();
    window.pc43_clockIn = clockIn;
    window.pc43_clockOut = clockOut;
    window.pc43_refreshClockPanel = refreshPanel;

    function boot() {
        if (!window.ThurayaSessionResources.active()) return;
        ensurePanel();
        window.ThurayaSessionResources.timeout(ensurePanel, 200);
        window.ThurayaSessionResources.timeout(refreshPanel, 500);
        window.ThurayaSessionResources.timeout(refreshPanel, 1500);
        window.ThurayaSessionResources.timeout(startLiveListener, 1600);
    }

    function registerSession() {
        window.ThurayaSessionResources.onStart("clock", boot);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", registerSession, { once: true });
    else registerSession();
    window.ThurayaSessionResources.onStop("clock", () => {
        if (unsubClock) unsubClock();
        unsubClock = null;
        pollTimer = null;
        const panel = document.getElementById("properClockPanel");
        if (panel) panel.style.display = "none";
    });
})();
