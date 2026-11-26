// ============================================================
// THURAYA ATTENDANCE — PHASE 4.3.4 IDENTITY SYNC FIX
// Version: attendance-phase4-3-4-identity-sync-20260427
// Purpose: sync My Profile Attendance Identity with multi-shift clock records.
// ============================================================
console.log("✅ Attendance Phase 4.3.4 loaded: identity sync fix");

(function () {
    function today() {
        return window.ThurayaSchedulePolicy.businessDate();
    }

    function getDb() {
        if (typeof db !== "undefined" && db) return db;
        if (window.db) return window.db;
        if (window.firebase && firebase.firestore) return firebase.firestore();
        return null;
    }

    function userEmail() {
        try {
            return String(firebase.auth().currentUser?.email || "").toLowerCase().trim();
        } catch (_) {
            return "";
        }
    }

    function toDate(v) {
        if (!v) return null;
        if (typeof v.toDate === "function") return v.toDate();
        if (typeof v === "object" && v.seconds) return new Date(v.seconds * 1000);
        if (v instanceof Date) return v;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    }

    function time(v) {
        const d = toDate(v);
        if (!d) return "—";
        return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }

    function durationText(start, end) {
        const s = toDate(start);
        const e = toDate(end);
        if (!s || !e) return "—";
        const mins = Math.max(0, Math.floor((e - s) / 60000));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h ? `${h}h ${m}m` : `${m}m`;
    }

    function sortVal(v) {
        const d = toDate(v);
        return d ? d.getTime() : 0;
    }

    async function getTodayShifts() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return [];
        const database = getDb();
        const email = userEmail();
        const day = today();

        if (!database || !email) return [];

        if (window.thurayaAttendance?.fetchTechnicianDayAggregate) {
            try {
                const result = await window.thurayaAttendance.fetchTechnicianDayAggregate(database, email, day);
                if (!isCurrent()) return [];
                const aggregate = result.aggregate;
                if (!aggregate) return [];

                return aggregate.sessions
                    .slice()
                    .sort((a, b) => {
                        const av = a.clockOutMillis || a.clockInMillis || 0;
                        const bv = b.clockOutMillis || b.clockInMillis || 0;
                        return bv - av;
                    })
                    .map((session, index) => ({
                        id: `${session.sourceDocId}:${session.sessionId}`,
                        ref: session.sourceRef || null,
                        email: aggregate.email || email,
                        name: aggregate.name || email,
                        date: aggregate.day,
                        dateString: aggregate.day,
                        clockIn: session.clockIn,
                        clockOut: session.clockOut,
                        isLate: typeof session.raw?.isLate === 'boolean' ? session.raw.isLate :
                            (session.raw?.shiftStart && typeof att42_isLate === 'function' ?
                                att42_isLate(session.clockInDate, session.raw.shiftStart) : session.isLate === true),
                        latenessStatus: session.raw?.latenessStatus || null,
                        method: session.method || "app",
                        device: session.device || "Web",
                        sourceDocId: session.sourceDocId,
                        sessionId: session.sessionId,
                        shiftSequence: aggregate.sessions.length - index,
                        workDurationText: session.clockOut ? window.thurayaAttendance.durationText(session.workDurationMinutes) : "In progress",
                        aggregateState: aggregate.state,
                        multipleOpen: aggregate.multipleOpen
                    }));
            } catch (e) {
                if (!isCurrent()) return [];
                if (e.code === 'ATTENDANCE_WORK_DURATION_UNAVAILABLE') throw e;
                console.warn("Identity sync aggregate query failed", e);
            }
        }

        const rowsById = new Map();
        async function queryField(field) {
            if (!isCurrent()) return;
            try {
                const snap = await database.collection("Attendance")
                    .where("email", "==", email)
                    .where(field, "==", day)
                    .get();

                if (!isCurrent()) return;
                snap.forEach(doc => rowsById.set(doc.id, { id: doc.id, ref: doc.ref, ...(doc.data() || {}) }));
            } catch (e) {
                if (!isCurrent()) return;
                console.warn("Identity sync query failed", e);
            }
        }

        await queryField("dateString");
        await queryField("date");

        const rows = Array.from(rowsById.values());
        rows.sort((a, b) => {
            const av = sortVal(a.clockOut || a.clockIn || a.updatedAt || a.createdAt);
            const bv = sortVal(b.clockOut || b.clockIn || b.updatedAt || b.createdAt);
            return bv - av;
        });

        return rows;
    }

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.innerText = value;
    }

    function setColor(id, value) {
        const el = document.getElementById(id);
        if (el) el.style.color = value;
    }

    async function loadIdentity() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        try {
            const shifts = await getTodayShifts();
            if (!isCurrent()) return;

            const active = shifts.find(s => s.clockIn && !s.clockOut);
            const lastEnded = shifts.find(s => s.clockIn && s.clockOut);
            const current = active || lastEnded || null;

            if (!current) {
                setText("myProfileAttendanceStatus", "Not Clocked In");
                setText("myProfileClockIn", "—");
                setText("myProfileClockOut", "—");
                setText("myProfileWorkDuration", "—");
                setText("myProfileLateStatus", "—");
                setText("myProfileClockMethod", "—");

                const note = document.getElementById("myProfileAttendanceNote");
                if (note) note.innerHTML = `No attendance record found for today.`;
                return;
            }

            if (active) {
                setText("myProfileAttendanceStatus", "Clocked In");
                setText("myProfileClockIn", time(active.clockIn));
                setText("myProfileClockOut", "—");
                setText("myProfileWorkDuration", "In progress");
                setText("myProfileLateStatus", active.latenessStatus === "UNAVAILABLE" ? "Plan unavailable" : (active.isLate ? "Late" : "On Time"));
                setColor("myProfileLateStatus", active.latenessStatus === "UNAVAILABLE" ? "#888" : (active.isLate ? "var(--error)" : "var(--success)"));
                setText("myProfileClockMethod", `${active.method || "app"} / ${active.device || "Web"}`);

                const note = document.getElementById("myProfileAttendanceNote");
                if (note) note.innerHTML = `✅ Active shift linked for <strong>${today()}</strong>${shifts.length > 1 ? ` · Shift ${active.shiftSequence || shifts.length}` : ""}.`;
                return;
            }

            setText("myProfileAttendanceStatus", "Shift Ended");
            setText("myProfileClockIn", time(lastEnded.clockIn));
            setText("myProfileClockOut", time(lastEnded.clockOut));
            setText("myProfileWorkDuration", lastEnded.workDurationText || durationText(lastEnded.clockIn, lastEnded.clockOut));
            setText("myProfileLateStatus", lastEnded.latenessStatus === "UNAVAILABLE" ? "Plan unavailable" : (lastEnded.isLate ? "Late" : "On Time"));
            setColor("myProfileLateStatus", lastEnded.latenessStatus === "UNAVAILABLE" ? "#888" : (lastEnded.isLate ? "var(--error)" : "var(--success)"));
            setText("myProfileClockMethod", `${lastEnded.method || "app"} / ${lastEnded.device || "Web"}`);

            const note = document.getElementById("myProfileAttendanceNote");
            if (note) note.innerHTML = `✅ Last completed shift linked for <strong>${today()}</strong>${shifts.length > 1 ? ` · ${shifts.length} shift records today` : ""}.`;
        } catch (e) {
            if (!isCurrent()) return;
            console.warn("Identity sync failed", e);
        }
    }

    function patchClockRefresh() {


        const wrap = fnName => {
            if (typeof window[fnName] === "function" && !window[fnName].__att434Wrapped) {
                const original = window[fnName];
                window[fnName] = async function (...args) {
                    const isCurrent = window.ThurayaSessionResources.capture();
                    if (!isCurrent()) return;
                    const result = await original.apply(this, args);
                    if (!isCurrent()) return result;
                    window.ThurayaSessionResources.timeout(loadIdentity, 500);
                    window.ThurayaSessionResources.timeout(loadIdentity, 1300);
                    return result;
                };
                window[fnName].__att434Wrapped = true;
            }
        };

        wrap("pc43_clockIn");
        wrap("pc43_clockOut");
        window.__att434Patched = true;
    }

    function boot() {
        if (!window.ThurayaSessionResources.active()) return;
        patchClockRefresh();

        // Override older My Profile identity loader with multi-shift aware version.
        window.sp4_loadMyAttendanceIdentity = loadIdentity;
        window.att434_loadIdentity = loadIdentity;

        window.ThurayaSessionResources.timeout(loadIdentity, 600);
        window.ThurayaSessionResources.timeout(loadIdentity, 1600);
    }

    function registerSession() {
        window.ThurayaSessionResources.onStart("attendance.identity", boot);
    }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", registerSession, { once: true });
    else registerSession();
    window.ThurayaSessionResources.onStop("attendance.identity", () => {
        ["myProfileAttendanceStatus", "myProfileClockIn", "myProfileClockOut", "myProfileWorkDuration",
            "myProfileLateStatus", "myProfileClockMethod", "myProfileAttendanceNote"].forEach(id => setText(id, ""));
    });
})();
