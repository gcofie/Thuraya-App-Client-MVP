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
            !Number.isInteger(latest.startMins) || !Number.isInteger(latest.endMins) ||
            latest.startMins < 0 || latest.endMins > 1440 || latest.startMins >= latest.endMins) {
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
    return Object.freeze({ calendarDate, weekday, minutes, record, records, resolve, check });
});
