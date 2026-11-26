(function (root, factory) {
    const model = factory();
    if (typeof module === 'object' && module.exports) module.exports = model;
    else root.ThurayaNoShowModel = model;
})(typeof window !== 'undefined' ? window : globalThis, function () {
    'use strict';
    const normalize = value => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    const isNoShow = value => ['no show', 'noshow'].includes(normalize(value));
    const isGroup = row => row?.isGroupBooking === true || !!String(row?.groupId || '').trim();
    const present = value => value !== undefined && value !== null && value !== false && value !== '' && value !== 0 && value !== '0';
    function businessDate(now = new Date()) {
        const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Africa/Accra', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const get = type => parts.find(p => p.type === type).value;
        return `${get('year')}-${get('month')}-${get('day')}`;
    }
    function validDate(value) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return false;
        const [y, m, d] = value.split('-').map(Number);
        const date = new Date(Date.UTC(y, m - 1, d));
        return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
    }
    const denied = (code, reason) => ({ eligible: false, code, reason });
    function protection(row) {
        const r = row || {}, statuses = [normalize(r.status), normalize(r.serviceStatus), normalize(r.paymentStatus)];
        if (statuses.some(s => ['closed', 'paid', 'completed', 'complete', 'ready for payment'].includes(s)) ||
            ['paidAt', 'closedAt', 'completedAt', 'receiptGeneratedAt', 'receiptCompletedAt', 'receiptIssuedAt', 'receiptRef', 'receiptNumber', 'receiptId'].some(k => present(r[k])) ||
            r.receiptGenerated === true || r.receiptCompleted === true || r.receiptIssued === true ||
            ['generated', 'completed', 'complete', 'issued', 'final'].includes(normalize(r.receiptStatus || r.receiptState))) return denied('FINANCIAL', 'This booking is already completed, paid, closed or has receipt evidence.');
        if (statuses.some(s => ['in progress', 'in service', 'started'].includes(s)) ||
            ['serviceStartedAt', 'startedAt', 'actualStartTime', 'actualStartAt', 'serviceStartTime', 'inServiceAt'].some(k => present(r[k]))) return denied('STARTED', 'Service has already started.');
        if (statuses.some(s => ['arrived', 'checked in', 'checkedin', 'waiting'].includes(s)) ||
            ['checkedInAt', 'checkInAt', 'arrivedAt'].some(k => present(r[k]))) return denied('ARRIVED', 'The client has already arrived or checked in.');
        if (Object.entries(r).some(([k, v]) => /^(giftCheckout|giftCard|hasGiftCard|voucher|deposit|prepaid|prepayment)/i.test(k) && present(v) && (!Array.isArray(v) || v.length)) ||
            /gift|voucher/i.test(String(r.paymentMethod || '')) ||
            ['paidAmount', 'amountPaid', 'paymentAmount', 'totalPaid', 'complimentaryApprovedAt', 'complimentaryApprovalId'].some(k => present(r[k])) ||
            Array.isArray(r.paymentSplits) && r.paymentSplits.length || ['partial', 'partially paid'].includes(normalize(r.paymentStatus))) return denied('PAYMENT_REVIEW', 'Payment or special-payment evidence requires financial review.');
        return null;
    }
    function classifyMember(row, jobs = [], today = businessDate()) {
        if (row?.archived === true) return denied('ARCHIVED', 'This booking is archived.');
        const financial = protection(row);
        const jobProtection = jobs.map(j => protection(j.data || j)).find(Boolean);
        if (financial?.code === 'FINANCIAL' || jobProtection?.code === 'FINANCIAL') return financial?.code === 'FINANCIAL' ? financial : jobProtection;
        if (isNoShow(row?.status)) return denied('ALREADY_NO_SHOW', 'This member is already No Show.');
        if (financial || jobProtection) return financial || jobProtection;
        if (['cancelled', 'canceled'].includes(normalize(row?.status))) return denied('CANCELLED', 'This booking is cancelled.');
        if (!validDate(row?.dateString)) return denied('INVALID_DATE', 'The booking date needs review.');
        if (row.dateString > today) return denied('NOT_DUE', 'The booking date is not yet eligible.');
        if (normalize(row.status) !== 'scheduled') return denied('STATUS', 'Only a Scheduled, unserved group member can be marked No Show.');
        if (jobs.length || row.activeJobId) return denied('ACTIVE_JOB_REVIEW', 'An Active Job already exists. Review check-in before marking No Show.');
        return { eligible: true, code: 'ELIGIBLE', reason: 'Only this member Appointment will be marked No Show.' };
    }
    function groupSummary(rows) {
        const members = rows.filter(r => !r.archived);
        if (!members.length) return 'Archived group';
        if (members.every(r => isNoShow(r.status) && !r.linkedFinancial && protection(r)?.code !== 'FINANCIAL')) return 'Group No Show';
        const noShow = members.some(r => isNoShow(r.status));
        if (noShow && members.some(r => r.linkedFinancial || protection(r)?.code === 'FINANCIAL')) return 'Mixed / Partial Completion';
        if (noShow && members.some(r => normalize(r.status) === 'scheduled')) return 'Mixed / Partially Active';
        if (noShow || new Set(members.map(r => normalize(r.status))).size > 1) return 'Mixed';
        return members[0].status || 'Group booking';
    }
    function distinctGroups(rows) { return new Set(rows.filter(isGroup).map(r => r.groupId || `unlinked:${r.id}`)).size; }
    function appendNoShows(jobs, appointments) {
        const result = jobs.slice(), seen = new Set(jobs.flatMap(r => [r.id, r.sourceAppointmentId].filter(Boolean)));
        for (const row of appointments) if (!row.archived && isNoShow(row.status) && !seen.has(row.id)) {
            result.push({ ...row, _source: 'Appointments (No Show lifecycle)' }); seen.add(row.id);
        }
        return result;
    }
    return Object.freeze({ normalize, isNoShow, isGroup, businessDate, validDate, protection, classifyMember, groupSummary, distinctGroups, appendNoShows });
});
