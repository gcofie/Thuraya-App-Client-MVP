// ============================================================
// THURAYA ATTENDANCE AGGREGATOR
// Backward-compatible read model for mixed Attendance schemas.
// ============================================================
(function initThurayaAttendanceAggregator(root) {
    'use strict';

    const DEFAULT_TIMEZONE = 'Africa/Accra';
    const DATE_RE = /\d{4}-\d{2}-\d{2}/;

    function normalizeEmail(value) {
        return String(value || '').trim().toLowerCase();
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, ch => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;'
        }[ch]));
    }

    function toDate(value) {
        if (!value) return null;
        try {
            if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
            if (typeof value.toDate === 'function') return value.toDate();
            if (typeof value === 'object' && typeof value.seconds === 'number') {
                return new Date(value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1000000));
            }
            if (typeof value === 'object' && typeof value._seconds === 'number') {
                return new Date(value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1000000));
            }
            if (typeof value === 'number') return new Date(value);
            if (typeof value === 'string') {
                const match = value.match(DATE_RE);
                if (match && value.length <= 16) return new Date(match[0] + 'T12:00:00');
                const parsed = new Date(value);
                return Number.isNaN(parsed.getTime()) ? null : parsed;
            }
        } catch (e) {}
        return null;
    }

    function businessTimezone() {
        return root.THURAYA_BUSINESS_TIMEZONE || root.thurayaBusinessTimezone || DEFAULT_TIMEZONE;
    }

    function dateToDay(date, timezone) {
        if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
        try {
            const parts = new Intl.DateTimeFormat('en-US', {
                timeZone: timezone || businessTimezone(),
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).formatToParts(date).reduce((out, part) => {
                out[part.type] = part.value;
                return out;
            }, {});
            if (parts.year && parts.month && parts.day) return `${parts.year}-${parts.month}-${parts.day}`;
        } catch (e) {}
        return date.toISOString().slice(0, 10);
    }

    function normalizeDay(value, options = {}) {
        if (!value) return '';
        if (typeof value === 'string') {
            const match = value.match(DATE_RE);
            return match ? match[0] : '';
        }
        const date = toDate(value);
        return date ? dateToDay(date, options.timezone) : '';
    }

    function dayFromDocId(docId) {
        const match = String(docId || '').match(DATE_RE);
        return match ? match[0] : '';
    }

    function recordDay(data, docId, options = {}) {
        return normalizeDay(data?.dateString, options) ||
            normalizeDay(data?.date, options) ||
            normalizeDay(data?.attendanceDate, options) ||
            dayFromDocId(docId);
    }

    function emailFromDocId(docId, day) {
        const id = String(docId || '').trim();
        if (!id) return '';

        if (day && id.startsWith(`Attendance_${day}_`)) {
            return normalizeEmail(id.slice(`Attendance_${day}_`.length));
        }

        if (day) {
            const shiftMarker = `_${day}_shift_`;
            const shiftIndex = id.indexOf(shiftMarker);
            if (shiftIndex > 0) return normalizeEmail(id.slice(0, shiftIndex));

            const daySuffix = `_${day}`;
            if (id.endsWith(daySuffix)) return normalizeEmail(id.slice(0, -daySuffix.length));

            const dayMarker = `_${day}_`;
            const dayIndex = id.indexOf(dayMarker);
            if (dayIndex > 0) return normalizeEmail(id.slice(0, dayIndex));
        }

        const first = id.split('_')[0];
        return first && first.includes('@') ? normalizeEmail(first) : '';
    }

    function normalizeIdentity(data = {}, docId = '', day = '') {
        const roles = Array.isArray(data.roles) ? data.roles : (data.role ? [data.role] : []);
        const roleString = String(data.roleString || roles.join(',') || '');
        const email = normalizeEmail(
            data.email ||
            data.techEmail ||
            data.staffEmail ||
            data.technicianEmail ||
            data.assignedTechEmail ||
            data.userEmail ||
            data.employeeEmail ||
            emailFromDocId(docId, day)
        );

        const staffId = String(
            data.staffId ||
            data.technicianId ||
            data.techId ||
            data.uid ||
            ''
        ).trim();

        return {
            email,
            staffId,
            key: email || (staffId ? `staff:${staffId.toLowerCase()}` : ''),
            name: data.name || data.staffName || data.techName || data.technicianName || data.assignedTechName || email || staffId || '',
            roles,
            roleString
        };
    }

    function isArchivedAttendance(data = {}) {
        try {
            if (typeof root.isArchivedRecord === 'function' && root.isArchivedRecord(data)) return true;
        } catch (e) {}
        return data.archived === true ||
            data.isArchived === true ||
            !!data.archivedAt ||
            !!data.archiveBatchId ||
            String(data.archiveStatus || '').toLowerCase() === 'archived';
    }

    function docId(doc, index) {
        return String(doc?.id || doc?.docId || doc?.sourceDocId || `attendance_${index}`);
    }

    function docData(doc) {
        if (!doc) return {};
        if (typeof doc.data === 'function') return doc.data() || {};
        return doc.data || doc;
    }

    function docRef(doc) {
        return doc?.ref || null;
    }

    function millis(value) {
        const d = toDate(value);
        return d ? d.getTime() : 0;
    }

    function timestampLike(date) {
        if (!date) return null;
        const firebase = root.firebase;
        try {
            if (firebase?.firestore?.Timestamp?.fromDate) return firebase.firestore.Timestamp.fromDate(date);
        } catch (e) {}
        return date;
    }

    function sourceSchema(data, docIdValue, kind) {
        if (kind === 'shift') return 'shifts[]';
        if (String(docIdValue || '').includes('_shift_')) return 'timestamp_doc_root';
        return 'daily_doc_root';
    }

    function persistedLunchFields(data) {
        const fields = {};
        for (const key of ['lunchStart', 'lastLunchStart', 'lunchEnd', 'lastLunchEnd', 'lastLunchMinutes', 'totalLunchMinutes']) {
            if (Object.prototype.hasOwnProperty.call(data, key)) fields[key] = data[key];
        }
        return fields;
    }

    function netWorkingMinutes(elapsedMinutes, data = {}) {
        const lunch = data.totalLunchMinutes === undefined ? 0 : data.totalLunchMinutes;
        if (!Number.isSafeInteger(elapsedMinutes) || elapsedMinutes < 0 ||
            !Number.isSafeInteger(lunch) || lunch < 0 ||
            (data.totalLunchMinutes === undefined && (data.lunchEnd || data.lastLunchEnd))) {
            const error = new Error('Attendance working duration is unavailable: accumulated lunch evidence is incomplete or invalid.');
            error.code = 'ATTENDANCE_WORK_DURATION_UNAVAILABLE';
            throw error;
        }
        // End Lunch already floors each interval before accumulation. Do not round raw lunch again.
        return Math.max(0, elapsedMinutes - lunch);
    }

    function normalizeSession(raw, meta, index, kind) {
        const clockIn = toDate(raw?.in || raw?.clockIn || raw?.start || raw?.startAt || raw?.startedAt || raw?.clockInTime || raw?.timeIn);
        if (!clockIn) return null;

        const clockOut = toDate(raw?.out || raw?.clockOut || raw?.end || raw?.endAt || raw?.endedAt || raw?.clockOutTime || raw?.timeOut);
        const sessionId = raw?.id || raw?.shiftId || raw?.sessionId || `${kind || 'root'}_${index}_${clockIn.getTime()}`;
        const onLunch = meta.data.lunchActive === true ||
            meta.data.availabilityBlocked === true ||
            String(meta.data.availabilityStatus || '').toLowerCase() === 'lunch' ||
            String(meta.data.status || '').toLowerCase() === 'on lunch';

        return {
            technicianKey: meta.identity.key,
            email: meta.identity.email,
            staffId: meta.identity.staffId,
            name: meta.identity.name,
            day: meta.day,
            sourceDocId: meta.id,
            sourceRef: meta.ref,
            sessionId,
            clockIn: timestampLike(clockIn),
            clockOut: clockOut ? timestampLike(clockOut) : null,
            clockInDate: clockIn,
            clockOutDate: clockOut,
            clockInMillis: clockIn.getTime(),
            clockOutMillis: clockOut ? clockOut.getTime() : 0,
            isOpen: !clockOut,
            isArchived: meta.archived,
            sourceSchema: sourceSchema(meta.data, meta.id, kind),
            status: meta.data.status || '',
            method: raw?.method || meta.data.method || '',
            device: raw?.device || meta.data.device || '',
            isLate: raw?.isLate === true || meta.data.isLate === true,
            lunchActive: onLunch,
            lunchFields: persistedLunchFields(meta.data),
            availabilityBlocked: meta.data.availabilityBlocked === true,
            availabilityStatus: meta.data.availabilityStatus || '',
            updatedAt: meta.data.updatedAt || null,
            updatedAtMillis: millis(meta.data.updatedAt),
            raw: raw
        };
    }

    function normalizeDocument(doc, options = {}, index = 0) {
        const data = docData(doc);
        const id = docId(doc, index);
        const day = recordDay(data, id, options);
        const identity = normalizeIdentity(data, id, day);
        const archived = isArchivedAttendance(data);
        const meta = { data, id, day, identity, archived, ref: docRef(doc) };

        const sessions = [];
        const rootSession = normalizeSession(data, meta, 0, 'root');
        if (rootSession) sessions.push(rootSession);

        if (Array.isArray(data.shifts)) {
            data.shifts.forEach((shift, shiftIndex) => {
                const session = normalizeSession(shift, meta, shiftIndex, 'shift');
                if (session) sessions.push(session);
            });
        }

        return {
            id,
            ref: meta.ref,
            day,
            identity,
            archived,
            data,
            sessions
        };
    }

    function sessionRank(session) {
        if (session.sourceSchema === 'shifts[]') return 3;
        if (session.sourceSchema === 'daily_doc_root') return 2;
        return 1;
    }

    function dedupeSessions(sessions) {
        const byKey = new Map();
        sessions.forEach(session => {
            if (!session || session.isArchived || !session.technicianKey || !session.day) return;
            const key = [
                session.technicianKey,
                session.day,
                session.clockInMillis,
                session.clockOutMillis || 'open'
            ].join('|');
            const existing = byKey.get(key);
            if (!existing || sessionRank(session) > sessionRank(existing) || session.updatedAtMillis > existing.updatedAtMillis) {
                byKey.set(key, session);
            }
        });
        return Array.from(byKey.values()).sort((a, b) => a.clockInMillis - b.clockInMillis);
    }

    function finaliseAggregate(seed) {
        const sessions = dedupeSessions(seed.rawSessions);
        const openSessions = sessions
            .filter(session => session.isOpen)
            .sort((a, b) => (b.clockInMillis - a.clockInMillis) || (b.updatedAtMillis - a.updatedAtMillis));
        const closedSessions = sessions
            .filter(session => !session.isOpen)
            .sort((a, b) => (b.clockOutMillis - a.clockOutMillis) || (b.clockInMillis - a.clockInMillis));
        const effectiveSession = openSessions[0] || closedSessions[0] || null;
        const earliest = sessions[0] || null;
        const latestClosed = closedSessions[0] || null;
        const onLunch = openSessions.some(session => session.lunchActive || session.availabilityBlocked || String(session.availabilityStatus || '').toLowerCase() === 'lunch');
        const completedByDocument = new Map();
        closedSessions.forEach(session => {
            const group = completedByDocument.get(session.sourceDocId) || { sessions: [], elapsed: 0, lunch: session.lunchFields };
            group.sessions.push(session);
            group.elapsed += Math.max(0, Math.floor((session.clockOutMillis - session.clockInMillis) / 60000));
            completedByDocument.set(session.sourceDocId, group);
        });
        let totalMinutes = 0;
        completedByDocument.forEach(group => {
            // The accumulated lunch belongs to the document, not every root/shifts[] projection.
            const net = netWorkingMinutes(group.elapsed, group.lunch);
            totalMinutes += net;
            group.sessions.forEach(session => {
                session.workDurationMinutes = group.sessions.length === 1 ? net :
                    (group.lunch.totalLunchMinutes ? null : Math.max(0, Math.floor((session.clockOutMillis - session.clockInMillis) / 60000)));
            });
        });

        return {
            technicianKey: seed.technicianKey,
            email: seed.email,
            staffId: seed.staffId,
            name: seed.name,
            roles: seed.roles || [],
            roleString: seed.roleString || '',
            day: seed.day,
            state: openSessions.length ? 'clocked_in' : (sessions.length ? 'clocked_out' : 'none'),
            displayStatus: openSessions.length ? (onLunch ? 'On Lunch' : 'Clocked In') : (sessions.length ? 'Clocked Out' : 'No Attendance'),
            isPresent: openSessions.length > 0,
            workedToday: sessions.length > 0,
            onLunch,
            sessions,
            rawSessions: seed.rawSessions,
            openSessions,
            closedSessions,
            multipleOpen: openSessions.length > 1,
            sessionCount: sessions.length,
            openSessionCount: openSessions.length,
            closedSessionCount: closedSessions.length,
            sourceDocIds: Array.from(seed.sourceDocIds).sort(),
            sourceSchemas: Array.from(seed.sourceSchemas).sort(),
            effectiveSession,
            effectiveRef: effectiveSession?.sourceRef || seed.primaryRef || null,
            primaryRef: seed.primaryRef || null,
            firstClockIn: earliest?.clockIn || null,
            firstClockInDate: earliest?.clockInDate || null,
            lastClockOut: latestClosed?.clockOut || null,
            lastClockOutDate: latestClosed?.clockOutDate || null,
            totalMinutesWorked: totalMinutes,
            hasDiagnostics: openSessions.length > 1,
            diagnostics: {
                multipleOpen: openSessions.length > 1,
                rawSessionCount: seed.rawSessions.length,
                normalizedSessionCount: sessions.length,
                sourceDocCount: seed.sourceDocIds.size
            }
        };
    }

    function aggregateDocuments(docs, options = {}) {
        const groups = new Map();
        const normalizedDocs = [];

        (docs || []).forEach((doc, index) => {
            const normalized = normalizeDocument(doc, options, index);
            normalizedDocs.push(normalized);
            if (normalized.archived) return;
            if (!normalized.day || !normalized.identity.key) return;

            const key = `${normalized.identity.key}|${normalized.day}`;
            if (!groups.has(key)) {
                groups.set(key, {
                    technicianKey: normalized.identity.key,
                    email: normalized.identity.email,
                    staffId: normalized.identity.staffId,
                    name: normalized.identity.name,
                    roles: normalized.identity.roles,
                    roleString: normalized.identity.roleString,
                    day: normalized.day,
                    rawSessions: [],
                    sourceDocIds: new Set(),
                    sourceSchemas: new Set(),
                    primaryRef: null
                });
            }

            const group = groups.get(key);
            if (!group.email && normalized.identity.email) group.email = normalized.identity.email;
            if (!group.staffId && normalized.identity.staffId) group.staffId = normalized.identity.staffId;
            if ((!group.name || group.name === group.email) && normalized.identity.name) group.name = normalized.identity.name;
            if ((!group.roles || !group.roles.length) && normalized.identity.roles?.length) group.roles = normalized.identity.roles;
            if (!group.roleString && normalized.identity.roleString) group.roleString = normalized.identity.roleString;
            if (!group.primaryRef && normalized.ref && normalized.id === `${normalized.identity.email}_${normalized.day}`) group.primaryRef = normalized.ref;
            group.sourceDocIds.add(normalized.id);
            normalized.sessions.forEach(session => {
                group.rawSessions.push(session);
                group.sourceSchemas.add(session.sourceSchema);
            });
        });

        const aggregates = Array.from(groups.values()).map(finaliseAggregate);
        const byKey = {};
        const byEmailDate = {};

        aggregates.forEach(aggregate => {
            const key = `${aggregate.technicianKey}|${aggregate.day}`;
            byKey[key] = aggregate;
            if (aggregate.email) byEmailDate[`${aggregate.email}|${aggregate.day}`] = aggregate;
        });

        return {
            docs: normalizedDocs,
            aggregates,
            byKey,
            byEmailDate
        };
    }

    function docsFromSnapshot(snapshot) {
        const rows = [];
        if (!snapshot) return rows;
        if (Array.isArray(snapshot)) return snapshot;
        if (Array.isArray(snapshot.docs)) return snapshot.docs;
        if (typeof snapshot.forEach === 'function') {
            snapshot.forEach(doc => rows.push(doc));
        }
        return rows;
    }

    function mergeDocs(target, docs) {
        docsFromSnapshot(docs).forEach(doc => {
            const id = docId(doc, target.size);
            if (id) target.set(id, doc);
        });
    }

    async function safeGet(ref) {
        try {
            const snap = await ref.get();
            return snap && snap.exists ? snap : null;
        } catch (e) {
            return null;
        }
    }

    async function fetchDayDocs(db, day) {
        const map = new Map();
        const col = db.collection('Attendance');
        const queries = [
            col.where('date', '==', day).get(),
            col.where('dateString', '==', day).get()
        ];
        const results = await Promise.allSettled(queries);
        results.forEach(result => {
            if (result.status === 'fulfilled') mergeDocs(map, result.value);
        });
        return Array.from(map.values());
    }

    async function fetchDayAggregates(db, day, options = {}) {
        const docs = await fetchDayDocs(db, day);
        return aggregateDocuments(docs, { ...options, date: day });
    }

    async function fetchTechnicianDayAggregate(db, email, day, options = {}) {
        const isCurrent = root.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const cleanEmail = normalizeEmail(email);
        const map = new Map();
        const col = db.collection('Attendance');

        if (cleanEmail) {
            const candidateIds = [
                `${cleanEmail}_${day}`,
                `Attendance_${day}_${cleanEmail}`,
                `${day}_${cleanEmail}`
            ];
            const directDocs = await Promise.all(candidateIds.map(id => safeGet(col.doc(id))));
            if (!isCurrent()) return;
            directDocs.filter(Boolean).forEach(doc => map.set(doc.id, doc));

            const queries = [
                col.where('email', '==', cleanEmail).where('date', '==', day).get(),
                col.where('email', '==', cleanEmail).where('dateString', '==', day).get()
            ];
            const results = await Promise.allSettled(queries);
            if (!isCurrent()) return;
            results.forEach(result => {
                if (result.status === 'fulfilled') mergeDocs(map, result.value);
            });
        }

        const aggregated = aggregateDocuments(Array.from(map.values()), { ...options, date: day });
        const aggregate = aggregated.byEmailDate[`${cleanEmail}|${day}`] || aggregated.aggregates[0] || null;
        return {
            ...aggregated,
            aggregate,
            ref: aggregate?.effectiveRef || aggregate?.primaryRef || (cleanEmail ? col.doc(`${cleanEmail}_${day}`) : null),
            data: aggregateToLegacyRecord(aggregate, cleanEmail, day)
        };
    }

    async function fetchRangeDocs(db, start, end) {
        const map = new Map();
        const col = db.collection('Attendance');
        const queries = [
            col.where('date', '>=', start).where('date', '<=', end).get(),
            col.where('dateString', '>=', start).where('dateString', '<=', end).get()
        ];
        const results = await Promise.allSettled(queries);
        results.forEach(result => {
            if (result.status === 'fulfilled') mergeDocs(map, result.value);
        });
        return Array.from(map.values());
    }

    async function fetchRangeAggregates(db, start, end, options = {}) {
        const docs = await fetchRangeDocs(db, start, end);
        return aggregateDocuments(docs, options);
    }

    function listenDay(db, day, onChange, onError) {
        const col = db.collection('Attendance');
        const snapshots = { date: null, dateString: null };

        function emit() {
            const map = new Map();
            mergeDocs(map, snapshots.date);
            mergeDocs(map, snapshots.dateString);
            onChange(aggregateDocuments(Array.from(map.values()), { date: day }));
        }

        const unsubs = [];
        try {
            unsubs.push(col.where('date', '==', day).onSnapshot(snap => {
                snapshots.date = snap;
                emit();
            }, err => {
                if (onError) onError(err);
            }));
        } catch (e) {
            if (onError) onError(e);
        }

        try {
            unsubs.push(col.where('dateString', '==', day).onSnapshot(snap => {
                snapshots.dateString = snap;
                emit();
            }, err => {
                if (onError) onError(err);
            }));
        } catch (e) {
            if (onError) onError(e);
        }

        return function unsubscribeAttendanceDay() {
            unsubs.forEach(unsub => {
                try { if (typeof unsub === 'function') unsub(); } catch (e) {}
            });
        };
    }

    function aggregateToLegacyRecord(aggregate, email = '', day = '') {
        if (!aggregate) {
            return {
                email: normalizeEmail(email),
                date: day,
                dateString: day,
                status: 'Not Clocked In'
            };
        }

        const session = aggregate.effectiveSession || aggregate.sessions[aggregate.sessions.length - 1] || null;
        return {
            email: aggregate.email || normalizeEmail(email),
            name: aggregate.name,
            roles: aggregate.roles || [],
            roleString: aggregate.roleString || '',
            date: aggregate.day || day,
            dateString: aggregate.day || day,
            clockIn: session?.clockIn || aggregate.firstClockIn || null,
            clockOut: aggregate.isPresent ? null : (aggregate.lastClockOut || session?.clockOut || null),
            status: aggregate.displayStatus,
            method: session?.method || '',
            device: session?.device || '',
            isLate: session?.isLate === true,
            // Lunch is document-scoped, even when shifts[] wins deduplication.
            ...session?.lunchFields,
            lunchActive: aggregate.onLunch,
            availabilityBlocked: aggregate.onLunch,
            availabilityStatus: aggregate.onLunch ? 'Lunch' : (aggregate.isPresent ? 'Available' : 'Off Duty'),
            workDurationMinutes: aggregate.totalMinutesWorked,
            totalMinutesWorked: aggregate.totalMinutesWorked,
            sourceDocIds: aggregate.sourceDocIds,
            sessions: aggregate.sessions
        };
    }

    function durationText(totalMinutes) {
        if (totalMinutes === null) return 'Unavailable';
        const mins = Math.max(0, parseInt(totalMinutes || 0, 10));
        const h = Math.floor(mins / 60);
        const m = mins % 60;
        return h ? `${h}h ${m}m` : `${m}m`;
    }

    function formatTime(value) {
        const date = toDate(value);
        if (!date) return '-';
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const api = {
        aggregateDocuments,
        aggregateToLegacyRecord,
        businessTimezone,
        dateToDay,
        docsFromSnapshot,
        durationText,
        escapeHtml,
        fetchDayAggregates,
        fetchDayDocs,
        fetchRangeAggregates,
        fetchRangeDocs,
        fetchTechnicianDayAggregate,
        formatTime,
        isArchivedAttendance,
        listenDay,
        normalizeDay,
        normalizeDocument,
        normalizeEmail,
        normalizeIdentity,
        netWorkingMinutes,
        recordDay,
        toDate
    };

    root.thurayaAttendance = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
