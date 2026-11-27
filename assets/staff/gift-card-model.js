(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.ThurayaGiftCard = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const zone = 'Africa/Accra';
    const formatter = new Intl.DateTimeFormat('en-GB', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' });
    function businessDate(now = new Date()) {
        const date = now instanceof Date ? now : new Date(now);
        if (!Number.isFinite(date.getTime())) throw new Error('Invalid clock');
        const parts = Object.fromEntries(formatter.formatToParts(date).map(p => [p.type, p.value]));
        return `${parts.year}-${parts.month}-${parts.day}`;
    }
    function calendarDate(text) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
        const [year, month, day] = text.split('-').map(Number);
        if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
        return day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
    }
    function normalizeDate(value) {
        if (value === null || value === undefined || value === '') return { ok: true, date: null };
        try {
            if (typeof value === 'string') {
                const text = value.trim();
                if (calendarDate(text)) return { ok: true, date: text };
                const match = text.match(/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/);
                if (!match || !calendarDate(match[1]) || +match[2] > 23 || +match[3] > 59 || +match[4] > 59) return { ok: false, date: null };
                if (match[5] !== 'Z' && (+match[5].slice(1, 3) > 23 || +match[5].slice(4) > 59)) return { ok: false, date: null };
                value = new Date(text);
            } else if (value && typeof value.toDate === 'function') {
                value = value.toDate();
            } else if (!(value instanceof Date) && value && typeof value === 'object') {
                const seconds = value.seconds ?? value._seconds;
                const nanos = value.nanoseconds ?? value._nanoseconds ?? 0;
                if (!Number.isFinite(seconds) || !Number.isInteger(nanos) || nanos < 0 || nanos >= 1e9) return { ok: false, date: null };
                value = new Date(seconds * 1000 + nanos / 1e6);
            }
            if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return { ok: false, date: null };
            const date = businessDate(value);
            return { ok: calendarDate(date), date };
        } catch (e) { return { ok: false, date: null }; }
    }
    function expiry(card) {
        const primary = normalizeDate(card.expiryDate);
        const legacy = normalizeDate(card.validUntil);
        if (!primary.ok || !legacy.ok || (primary.date && legacy.date && primary.date !== legacy.date)) return { ok: false, date: null };
        return { ok: true, date: primary.date || legacy.date };
    }
    function displayDate(value, missing = 'Not recorded') {
        const result = normalizeDate(value);
        if (!result.ok) return 'Date needs review';
        if (!result.date) return missing;
        const [year, month, day] = result.date.split('-');
        return `${day} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(month) - 1]} ${year}`;
    }
    function defaultExpiry(now = new Date()) {
        const [year, month, day] = businessDate(now).split('-').map(Number);
        // Preserve the existing +12 calendar-month rollover policy.
        const date = new Date(Date.UTC(year, month - 1, day));
        date.setUTCMonth(date.getUTCMonth() + 12);
        return businessDate(date);
    }
    function normalizeCode(value) {
        const text = String(value ?? '').trim().toUpperCase().replace(/[\u2010-\u2015\u2212\uFE63\uFF0D]/g, '-').replace(/\s/g, '');
        // A present prefix is never reinterpreted as missing substantive code characters.
        const body = text.startsWith('THGC') ? text.replace(/^THGC-?/, '') : text;
        const match = body.match(/^([A-Z0-9]{4})-?([A-Z0-9]{4})$/);
        return match ? { ok: true, code: `THGC-${match[1]}-${match[2]}` } : { ok: false, code: null };
    }
    const money = value => { const n = Number(value || 0); return Number.isFinite(n) ? n : 0; };
    function budget(card) {
        const remaining = money(card.remainingBalance ?? card.amount ?? 0);
        const maxUses = Math.max(1, Number(parseInt(card.totalAllowedUses || 1, 10)) || 1);
        const usedCount = Math.max(0, Number(parseInt(card.usedCount || 0, 10)) || 0);
        const stored = card.remainingUses === undefined || card.remainingUses === null || card.remainingUses === '' ? null : Math.max(0, Number(parseInt(card.remainingUses, 10)) || 0);
        const calculated = Math.max(0, maxUses - usedCount);
        return { remaining, maxUses, usedCount, remainingUses: stored === null ? calculated : Math.min(stored, calculated) };
    }
    const labels = { VALID: 'Available', NOT_FOUND: 'Not found', INVALID_CODE_FORMAT: 'Check code', EXPIRED: 'Expired', REDEEMED: 'Redeemed', USE_LIMIT_REACHED: 'Use limit reached', NO_BALANCE: 'No balance', INACTIVE: 'Inactive', MALFORMED_DATE: 'Date needs review', NETWORK_ERROR: 'Validation unavailable', ALREADY_APPLIED: 'Already applied', CHECKOUT_COVERED: 'Checkout covered' };
    function message(state, expiryDate) {
        return ({ VALID: 'Gift Card is available.', NOT_FOUND: 'Gift Card code not found. Please check the code and try again.', INVALID_CODE_FORMAT: 'Please check the Gift Card code and try again.', EXPIRED: `This Gift Card expired on ${displayDate(expiryDate)}.`, REDEEMED: 'This Gift Card has already been redeemed.', USE_LIMIT_REACHED: 'This Gift Card has reached its allowed number of uses.', NO_BALANCE: 'This Gift Card has no remaining balance.', INACTIVE: 'This Gift Card is inactive.', MALFORMED_DATE: 'This Gift Card has an invalid or conflicting expiry date. Ask a Manager to review it.', NETWORK_ERROR: 'Gift Card validation could not be completed. Please try again.', ALREADY_APPLIED: 'This Gift Card is already applied to this checkout.', CHECKOUT_COVERED: 'This checkout is already fully covered by voucher credit.' })[state] || labels.NETWORK_ERROR;
    }
    function outcome(state, details = {}) { return { ...details, state, valid: state === 'VALID', label: labels[state], message: message(state, details.expiryDate) }; }
    function classify(card, now = new Date()) {
        if (!card) return outcome('NOT_FOUND');
        const values = budget(card), end = expiry(card), status = String(card.status || '').trim().toLowerCase();
        const details = { ...values, expiryDate: end.date, businessDate: businessDate(now) };
        if (card.archived === true || card.voided === true) return outcome('INACTIVE', details);
        if (status === 'redeemed') return outcome(values.remaining > 0 && values.remainingUses <= 0 ? 'USE_LIMIT_REACHED' : 'REDEEMED', details);
        if (!['active', 'partial', 'partially redeemed'].includes(status)) return outcome('INACTIVE', details);
        if (!end.ok) return outcome('MALFORMED_DATE', details);
        if (end.date && end.date < details.businessDate) return outcome('EXPIRED', details);
        if (values.remaining <= 0) return outcome('NO_BALANCE', details);
        if (values.remainingUses <= 0) return outcome('USE_LIMIT_REACHED', details);
        return outcome('VALID', details);
    }
    function error(result) { return Object.assign(new Error(result.message), { giftCardState: result.state }); }
    function requireValid(card, now) { const result = classify(card, now); if (!result.valid) throw error(result); return result; }
    function friendlyError(e) { return e?.giftCardState ? e.message : message('NETWORK_ERROR'); }
    return Object.freeze({ zone, businessDate, normalizeDate, expiry, displayDate, defaultExpiry, normalizeCode, budget, classify, outcome, error, requireValid, friendlyError });
});
