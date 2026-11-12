'use strict';

// Keep this pure contract and its test vectors identical in Staff and Client.
(function(root, factory) {
    const policy = factory();
    if (typeof module === 'object' && module.exports) module.exports = policy;
    else root.ThurayaSchedulePolicy = policy;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    function calendarDate(value) {
        if (value && typeof value.toDate === 'function') value = value.toDate();
        if (value instanceof Date) {
            if (!Number.isFinite(value.getTime())) return '';
            value = value.toISOString().slice(0, 10);
        }
        if (typeof value !== 'string') return '';
        let match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!match) {
            const local = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
            if (local) match = [value, local[3], local[2], local[1]];
        }
        if (!match) return '';
        const [year, month, day] = match.slice(1).map(Number);
        const date = new Date(0);
        date.setUTCFullYear(year, month - 1, day);
        date.setUTCHours(12, 0, 0, 0);
        if (year < 1900 || year > 9999 || date.getUTCFullYear() !== year ||
            date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return '';
        return `${match[1]}-${match[2]}-${match[3]}`;
    }
    function weekday(value) {
        const date = calendarDate(value);
        return date ? DAYS[new Date(date + 'T12:00:00Z').getUTCDay()] : '';
    }
    function minutes(value) {
        if (typeof value !== 'string' || !/^\d{2}:\d{2}$/.test(value)) return NaN;
        const [hour, minute] = value.split(':').map(Number);
        return hour < 24 && minute < 60 ? hour * 60 + minute : NaN;
    }
    function millis(value) {
        if (value && typeof value.toMillis === 'function') return value.toMillis();
        if (value && typeof value.toDate === 'function') value = value.toDate();
        if (value && typeof value.seconds === 'number') return value.seconds * 1000;
        const n = typeof value === 'number' ? value : value instanceof Date ? value.getTime() : Date.parse(value);
        return Number.isFinite(n) ? n : 0;
    }
    function record(data, sourceOrder = 2) {
        if (!data || typeof data !== 'object') return null;
        return {
            effectiveFrom: calendarDate(data.effectiveFrom),
            workingDays: Array.isArray(data.workingDays) ? data.workingDays.slice() : null,
            startMins: minutes(data.startTime), endMins: minutes(data.endTime),
            startTime: data.startTime, endTime: data.endTime,
            _savedMillis: Math.max(millis(data.savedAt), millis(data.updatedAt), millis(data.savedAtMs)),
            _sourceOrder: sourceOrder
        };
    }
    function records(data, sourceOrder = 2) {
        if (!data) return [];
        if (Array.isArray(data.scheduleSegments) && data.scheduleSegments.length) {
            return data.scheduleSegments.map(row => record(row, 3)).filter(Boolean);
        }
        const row = record(data, sourceOrder);
        return row ? [row] : [];
    }
    function resolve(rows, value) {
        const date = calendarDate(value);
        const unavailable = reason => ({ worksToday: false, reason });
        if (!date) return unavailable('INVALID_DATE');
        if (!Array.isArray(rows) || rows.some(row => !row || !calendarDate(row.effectiveFrom))) {
            return unavailable('INVALID_SCHEDULE');
        }
        const applicable = rows.filter(row => row.effectiveFrom <= date).slice().sort((a, b) =>
            b.effectiveFrom.localeCompare(a.effectiveFrom) ||
            (b._savedMillis || 0) - (a._savedMillis || 0) || (b._sourceOrder || 0) - (a._sourceOrder || 0));
        if (!applicable.length) return unavailable('NO_APPLICABLE_SCHEDULE');
        const latest = applicable[0];
        if (!Array.isArray(latest.workingDays) || latest.workingDays.some(day => !DAYS.includes(day)) ||
            (latest.workingDays.length && (!Number.isInteger(latest.startMins) || !Number.isInteger(latest.endMins) ||
            latest.startMins < 0 || latest.endMins > 1440 || latest.startMins >= latest.endMins))) {
            return unavailable('INVALID_SCHEDULE');
        }
        const worksToday = latest.workingDays.includes(weekday(date));
        return { ...latest, worksToday, _isDayOff: !worksToday, reason: worksToday ? 'WORKING' : 'OFF_DAY' };
    }
    function check(schedule, date, time, duration) {
        const start = minutes(time);
        if (!calendarDate(date) || !Number.isInteger(start) || !Number.isInteger(duration) || duration <= 0 || duration > 1440) {
            return { ok: false, code: 'INVALID_APPOINTMENT' };
        }
        if (!schedule || !schedule.worksToday) return { ok: false, code: schedule?.reason || 'SCHEDULE_UNAVAILABLE' };
        if (start < schedule.startMins || start + duration > schedule.endMins) return { ok: false, code: 'OUTSIDE_WORKING_HOURS' };
        return { ok: true, code: 'AVAILABLE' };
    }
    const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    const DAY_NAMES = ['Sunday', ...WEEK.slice(0, 6)];
    const failure = reason => ({ worksToday: false, reason });
    function businessDate(now = new Date()) { return calendarDate(now); }
    function businessMinutes(now = new Date()) { return now.getUTCHours() * 60 + now.getUTCMinutes(); }
    function validateVersion(v, email) {
        const errors = [];
        if (!v || typeof v !== 'object') return ['INVALID_VERSION'];
        if (v.schemaVersion !== 2) errors.push('SCHEMA_VERSION');
        if (typeof v.technicianEmail !== 'string' || !/^[^/\s@]+@[^/\s@]+$/.test(v.technicianEmail) ||
            (email && v.technicianEmail !== email)) errors.push('TECHNICIAN_IDENTITY');
        if (v.timezone !== 'UTC') errors.push('TIMEZONE');
        if (!calendarDate(v.effectiveFrom) || v.effectiveFrom !== calendarDate(v.effectiveFrom) ||
            !(v.effectiveTo === null || (v.effectiveTo === calendarDate(v.effectiveTo) && v.effectiveTo > v.effectiveFrom))) errors.push('EFFECTIVE_INTERVAL');
        if (!Number.isSafeInteger(v.revision) || v.revision < 1 || v.parentRevision !== v.revision - 1) errors.push('REVISION');
        if (!(v.previousVersionId === null || (typeof v.previousVersionId === 'string' && v.previousVersionId && !v.previousVersionId.includes('/'))) ||
            (v.revision === 1) !== (v.previousVersionId === null)) errors.push('PREVIOUS_VERSION');
        if (!v.publishedBy || typeof v.publishedBy.uid !== 'string' || !v.publishedBy.uid ||
            typeof v.publishedBy.email !== 'string' || !v.publishedBy.email) errors.push('PUBLISHER');
        if (!millis(v.publishedAt)) errors.push('PUBLICATION_TIME');
        if (!v.provenance || !['MANUAL', 'LEGACY_MIGRATION', 'ROLLBACK'].includes(v.provenance.kind) ||
            !Array.isArray(v.provenance.sourcePaths) || v.provenance.sourcePaths.some(p => typeof p !== 'string')) errors.push('PROVENANCE');
        if (!v.week || Object.keys(v.week).length !== 7 || WEEK.some(day => !Object.hasOwn(v.week, day))) errors.push('COMPLETE_WEEK');
        for (const day of WEEK) {
            const d = v.week?.[day];
            if (!d || Object.keys(d).sort().join(',') !== 'end,start,status' ||
                !(d.status === 'OFF' ? d.start === null && d.end === null :
                    d.status === 'WORKING' && Number.isInteger(minutes(d.start)) && Number.isInteger(minutes(d.end)) && minutes(d.end) > minutes(d.start))) errors.push('DAY_' + day);
        }
        return errors;
    }
    function legacyWeek(row) {
        if (!row || !calendarDate(row.effectiveFrom) || !Array.isArray(row.workingDays) ||
            new Set(row.workingDays).size !== row.workingDays.length || row.workingDays.some(d => !DAYS.includes(d))) return null;
        if (row.workingDays.length && (!Number.isInteger(row.startMins) || !Number.isInteger(row.endMins) || row.startMins < 0 || row.endMins > 1439 || row.endMins <= row.startMins)) return null;
        return Object.fromEntries(WEEK.map(day => [day, row.workingDays.includes(day.slice(0, 3)) ?
            { status: 'WORKING', start: row.startTime, end: row.endTime } : { status: 'OFF', start: null, end: null }]));
    }
    function resolveEffective({ root = null, versions = [], legacy = [] }, value, email) {
        const date = calendarDate(value);
        if (!date) return failure('INVALID_DATE');
        const v2 = root?.schemaVersion === 2 || versions.length > 0;
        if (!v2) {
            const result = resolve(legacy, date);
            if (result.effectiveFrom && !legacyWeek(result)) return failure('AMBIGUOUS_LEGACY_SCHEDULE');
            // Equal-authority contradictory legacy records cannot safely be ordered.
            const peers = legacy.filter(r => r && r.effectiveFrom === result.effectiveFrom && r._savedMillis === result._savedMillis && r._sourceOrder === result._sourceOrder);
            if (new Set(peers.map(r => JSON.stringify(legacyWeek(r)))).size > 1) return failure('AMBIGUOUS_LEGACY_SCHEDULE');
            return result;
        }
        if (!root || root.schemaVersion !== 2 || !calendarDate(root.v2EffectiveFrom) || !Number.isSafeInteger(root.latestRevision) ||
            root.latestRevision < 1 || !root.latestVersionId) return failure('INVALID_VERSION_INDEX');
        if (date < root.v2EffectiveFrom) return resolveEffective({ legacy }, date, email);
        if (versions.some(v => !calendarDate(v.effectiveFrom))) return failure('INVALID_SCHEDULE');
        if (!versions.some(v => v.versionId === root.latestVersionId && v.revision === root.latestRevision) ||
            versions.some(v => v.revision > root.latestRevision)) return failure('VERSION_INDEX_MISMATCH');
        const applicable = versions.filter(v => v.effectiveFrom <= date).sort((a, b) =>
            b.effectiveFrom.localeCompare(a.effectiveFrom) || b.revision - a.revision);
        if (!applicable.length) return failure('NO_APPLICABLE_SCHEDULE');
        const selected = applicable[0];
        if (versions.filter(v => v.revision === selected.revision).length !== 1) return failure('CONTRADICTORY_REVISION');
        if (validateVersion(selected, email).length) return failure('INVALID_SCHEDULE');
        // Expiry, OFF and malformed days never revive an older whole-week version.
        if (selected.effectiveTo !== null && date >= selected.effectiveTo) return failure('SCHEDULE_EXPIRED');
        const day = selected.week[DAY_NAMES[new Date(date + 'T12:00:00Z').getUTCDay()]];
        return { ...selected, worksToday: day.status === 'WORKING', _isDayOff: day.status === 'OFF',
            workingDays: WEEK.filter(d => selected.week[d].status === 'WORKING').map(d => d.slice(0, 3)),
            startTime: day.start, endTime: day.end, startMins: minutes(day.start), endMins: minutes(day.end),
            reason: day.status === 'WORKING' ? 'WORKING' : 'OFF_DAY' };
    }
    async function loadSchedule(database, email, date, current, isCurrent = () => true) {
        const requireCurrent = () => { if (!isCurrent()) throw Error('SCHEDULE_SESSION_ENDED'); };
        requireCurrent();
        const ref = database.collection('Staff_Schedules').doc(email);
        const root = current === undefined ? await ref.get({ source: 'server' }).then(s => s.exists ? s.data() : null) : current;
        requireCurrent();
        const legacy = records(root?.workingDays || root?.scheduleSegments ? root : null);
        const history = await ref.collection('history').get({ source: 'server' });
        requireCurrent();
        history.forEach(d => legacy.push(...records(d.data(), 1)));
        const versions = [];
        if (root?.schemaVersion === 2) {
            const snap = await ref.collection('versions').get({ source: 'server' });
            requireCurrent();
            snap.forEach(d => versions.push({ ...d.data(), versionId: d.id }));
        }
        return resolveEffective({ root, legacy, versions }, date, email);
    }
    function lateness(schedule, date, clockIn) {
        const instant = new Date(millis(clockIn));
        if (!millis(clockIn) || businessDate(instant) !== calendarDate(date)) return { status: 'UNAVAILABLE', reason: 'INVALID_CHECK_IN', lateMinutes: null, isLate: null };
        if (!schedule?.worksToday) return { status: 'UNAVAILABLE', reason: schedule?.reason || 'SCHEDULE_UNAVAILABLE', lateMinutes: null, isLate: null };
        const start = Date.parse(date + 'T' + schedule.startTime + ':00Z');
        if (!Number.isFinite(start)) return { status: 'UNAVAILABLE', reason: 'INVALID_SCHEDULE', lateMinutes: null, isLate: null };
        const lateMinutes = Math.max(0, Math.floor((instant.getTime() - start) / 60000));
        return { status: 'AVAILABLE', reason: null, lateMinutes, isLate: instant.getTime() > start };
    }
    function operationalOverlay(actual, date, now = new Date()) {
        if (calendarDate(date) !== businessDate(now) || calendarDate(actual?.dateString || actual?.date) !== calendarDate(date)) return [];
        const at = value => { const n = millis(value); return n && businessDate(new Date(n)) === date ? businessMinutes(new Date(n)) : null; };
        const blocks = [];
        const lunch = at(actual.lunchStart || actual.lastLunchStart);
        const lunchEnd = at(actual.lunchEnd || actual.lastLunchEnd);
        const onLunch = actual.lunchActive || actual.isOnLunch || actual.availabilityBlocked || String(actual.availabilityStatus).toLowerCase() === 'lunch' || String(actual.status).toLowerCase() === 'on lunch';
        if (onLunch) blocks.push([lunch ?? 0, 1440]);
        else if (lunch !== null && lunchEnd !== null && lunchEnd > lunch) blocks.push([lunch, lunchEnd]);
        const out = at(actual.clockOut || actual.lastClockOut);
        if (out !== null && !actual.isPresent) blocks.push([out, 1440]);
        if (String(actual.availabilityStatus).toLowerCase() === 'absent') blocks.push([0, 1440]);
        return blocks;
    }
    return Object.freeze({ calendarDate, weekday, minutes, record, records, resolve, check,
        WEEK, businessDate, businessMinutes, validateVersion, legacyWeek, resolveEffective, loadSchedule, lateness, operationalOverlay });
});
