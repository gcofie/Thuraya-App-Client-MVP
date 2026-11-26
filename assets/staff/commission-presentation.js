(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./functions/commission-engine'));
    else root.ThurayaCommissionPresentation = factory(root.ThurayaCommissionEngine);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (engine) {
    'use strict';
    const safe = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const date = value => !value ? 'Open-ended' : /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Accra' }).format(new Date(value + 'T12:00:00Z')) : new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'Africa/Accra' }).format(new Date(value));
    const amount = value => value == null ? 'Not payable' : safe(value) + ' GHS';
    const actions = { enrollPerson: 'Initial enrollment', saveBinding: 'Identity binding added', correctEnrollment: 'Enrollment corrected', closeBinding: 'Enrollment closed', voidEnrollment: 'Enrollment voided', LEGACY_ENROLLMENT_BASELINE_CAPTURE: 'Original enrollment' };
    function auditStatus(row) {
        const a = row.auditDisposition;
        if (a?.valid) return 'AUDIT OPEN - ZERO COMMISSION IMPACT APPROVED';
        if (a?.state === 'STALE' || a?.state === 'INVALIDATED') return 'AUDIT APPROVAL STALE';
        if (a?.state === 'REVOKED') return 'AUDIT APPROVAL REVOKED';
        if (a?.eligible) return 'PENDING - ZERO IMPACT REVIEW';
        if (a?.materiality === 'MATERIALITY_UNPROVEN') return 'PENDING - POTENTIALLY MATERIAL';
        if (a) return 'PENDING - MATERIALITY UNKNOWN';
        return '';
    }
    function status(row) { return (row.locked ? 'LOCKED' + (auditStatus(row) ? ' | ' + auditStatus(row) : '') : auditStatus(row)) || (!row.rule && row.status === 'NOT_CONFIGURED' ? 'NOT CONFIGURED' : ({ TARGET_NOT_REACHED: 'BELOW TARGET', PENDING: 'PENDING REVIEW' })[row.status] || String(row.status).replaceAll('_', ' ')); }
    function hasActivity(row) {
        return !!(row.locked || row.lockId || row.payoutStatus || row.contributions?.length || row.pending?.length || row.pendingAmountUnknown || Number(row.eligibleRevenue) || Number(row.pendingRevenueKnown) || Number(row.dailyPayable) || !['NOT_CONFIGURED', 'TARGET_NOT_REACHED', 'CALCULATED'].includes(row.status));
    }
    function initialPeriod(person, bindings) {
        const ranges = person.enrollmentRanges || bindings.filter(b => b.personId === person.personId);
        return { effectiveFrom: person.enrollmentFrom || '', effectiveUntil: Object.hasOwn(person, 'enrollmentUntil') ? person.enrollmentUntil : ranges.some(b => !b.effectiveUntil) ? null : ranges.map(b => b.effectiveUntil).filter(Boolean).sort().at(-1) || null };
    }
    function friendly(error) {
        const text = String(error?.message || error || '');
        const messages = { IDENTITY_EVIDENCE_REQUIRED: 'Confirmed Alias and Station Email are required for this technician.', IDENTITY_OVERLAP: 'This identity period overlaps an existing enrollment. Use Correct Enrollment, or choose a non-overlapping period.', INVALID_EFFECTIVE_RANGE: 'Enter valid effective dates. The end date must be after the start date.', INVALID_MONEY: 'Enter a valid non-negative target and rate.', INVALID_RATE: 'Commission rate must be between 0% and 100%.', UNCONFIRMED_IDENTITY: 'Confirm the technician identity before continuing.' };
        for (const [code, message] of Object.entries(messages)) if (text.includes(code)) return message;
        if (/impact.*(missing|stale)|Preview is stale/i.test(text)) return 'The reviewed information has changed. Preview the impact again before confirming.';
        if (/Configuration changed|revision changed/i.test(text)) return 'Another change was saved. Reload the current enrollment or rule before continuing.';
        if (/approved Commission operator/.test(text)) return 'Your account is not authorized to manage Commission configuration. Ask the owner to review operator access.';
        return text || 'The request could not be completed. Review the diagnostic details.';
    }
    function reviewReason(reason) {
        return ({ IDENTITY_REVIEW_REQUIRED: 'Technician identity requires review', UNASSIGNED_IDENTITY: 'Technician is not identified', DATE_REVIEW_REQUIRED: 'Business date requires review', COMPETING_RECEIPT_OR_SOURCE: 'Conflicting receipt or source records require review', REFUND_REVIEW_REQUIRED: 'Refund information requires review', GROUP_ALLOCATION_REVIEW_REQUIRED: 'Group service allocation requires review' })[reason] || 'Service revenue requires financial review';
    }
    function renderDays(rows, options = {}) {
        if (!rows.length) return '<p>No technician activity in the selected period.</p>';
        const hidden = rows.filter(r => !hasActivity(r)).length;
        const metric = (label, value) => `<div><dt>${label}</dt><dd>${value}</dd></div>`;
        const cards = rows.map(r => {
            const state = r.auditDisposition?.valid ? 'approved' : ['STALE', 'INVALIDATED'].includes(r.auditDisposition?.state) ? 'stale' : r.pending?.length ? 'pending' : 'complete';
            return `<article class="cv-day ${hasActivity(r) ? '' : 'cv-zero'}" data-audit-state="${state}" data-person-id="${safe(r.personId)}" data-business-date="${safe(r.businessDate)}"><header><div><h4>${safe(r.technician)}</h4><time>${safe(date(r.businessDate))}</time></div><strong class="cv-status">${safe(status(r))}</strong></header><dl>${metric('Eligible Revenue', amount(r.eligibleRevenue))}${metric('Daily Target', r.dailyTarget == null ? '-' : amount(r.dailyTarget))}${metric('Above Target', r.excess == null ? '-' : amount(r.excess))}${metric('Rate', r.commissionRate == null ? '-' : safe(engine.money(r.commissionRate).times(100).toString()) + '%')}${metric('Daily Commission', `<strong>${amount(r.dailyPayable)}</strong>`)}${metric('Pending / Review', r.pendingAmountUnknown ? 'Amount unknown' : amount(r.pendingRevenueKnown))}</dl>
            ${r.auditDisposition?.valid ? '<p class="cv-audit-note">Historical transaction remains under audit. Current approved evidence proves zero Commission impact; no Commission amount was removed.</p>' : ''}
            <p class="cv-rule-caption">${r.rule ? `Effective Rule: ${safe(date(r.rule.effectiveFrom))} to ${safe(date(r.rule.effectiveUntil))} (end exclusive)` : 'No rule configured. Commission is not payable.'}${r.sourceChanged ? '<br>Source changed: review required.' : ''}</p>${r.pending?.length ? `<details><summary>${r.pending.length} item(s) require review</summary>${r.pending.map(p => `<p>${safe(reviewReason(p.reason))}</p>`).join('')}</details>` : ''}
            ${options.canReview && (r.pending?.length || r.auditDisposition) ? `<button type="button" class="com-btn" data-audit-review data-person-id="${safe(r.personId)}" data-business-date="${safe(r.businessDate)}">Review Audit Exception</button>` : ''}
            <details><summary>View audit details</summary><pre>${safe(JSON.stringify({ rule: r.rule, contributions: r.contributions, pending: r.pending, excluded: r.excluded, locked: r.locked, auditDisposition: r.auditDisposition }, null, 2))}</pre></details></article>`;
        }).join('');
        return `<section class="cv-daily"><div class="cv-section-heading"><h3>Daily Target Commission</h3><label>Audit status <select class="cv-audit-filter"><option value="all">All days</option><option value="pending">Pending review</option><option value="approved">Audit open, zero impact approved</option><option value="stale">Audit approval stale</option><option value="complete">Complete</option></select></label>${hidden ? `<label><input type="checkbox" class="cv-show-zero" onchange="this.closest('.cv-daily').classList.toggle('cv-show-all',this.checked)"> Show zero-activity days (${hidden})</label>` : ''}</div>${hidden === rows.length ? '<p class="cv-no-activity">No activity in this period. Zero-activity days remain available.</p>' : ''}<div class="cv-day-grid">${cards}</div></section>`;
    }
    function installStyles(document) {
        if (document.getElementById('cv_business_style')) return;
        const style = document.createElement('style'); style.id = 'cv_business_style';
        style.textContent = `
        #cv_audit_dialog{margin:auto}#cv_audit_dialog #cv_audit_confirm{width:18px;height:18px;display:inline-block;vertical-align:middle;margin:0 8px 0 0}
        .cv-day[hidden]{display:none!important}.cv-audit-filter{max-width:100%;min-height:36px}.cv-status{overflow-wrap:anywhere;max-width:100%}.cv-audit-note{font-size:13px;border-left:3px solid #267565;padding-left:10px}#cv_audit_dialog{box-sizing:border-box;width:560px;max-width:calc(100% - 24px);max-height:90vh;overflow:auto;border:1px solid #b7c6c0;border-radius:6px;padding:24px;color:#22362f}#cv_audit_dialog::backdrop{background:rgba(0,0,0,.35)}#cv_audit_dialog h3{font-size:19px}#cv_audit_dialog label{display:block;margin-top:14px}#cv_audit_dialog textarea,#cv_audit_dialog select{display:block;width:100%;box-sizing:border-box;margin-top:6px}#cv_audit_dialog dl{display:grid;grid-template-columns:1fr 1fr;gap:10px}#cv_audit_dialog dd{margin:0;overflow-wrap:anywhere}#cv_audit_dialog p{overflow-wrap:anywhere}#cv_audit_dialog .com-actions{display:flex;flex-wrap:wrap;gap:12px}#cv_audit_dialog button{min-height:40px}#cv_audit_message{color:#9b2525}
        #cv_rules,.cv-daily{min-width:0;letter-spacing:0}#com_dashboardOutput,#mycom_output,.cv-daily,.cv-people{font-style:normal;text-align:left}#cv_rules h3,.cv-daily h3{font-size:19px}#cv_rules h4,.cv-daily h4{font-size:16px;margin:0 0 8px}
        #cv_rules input,#cv_rules select,#cv_rules textarea{max-width:100%;box-sizing:border-box}#cv_rules input:not([type=checkbox]),#cv_rules select,#cv_rules textarea{width:100%;min-width:0!important}
        #cv_rules .com-filter-bar{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,220px),1fr));gap:16px}#cv_rules .form-group{min-width:0!important;margin:0}#cv_rules label{display:block;overflow-wrap:anywhere}
        #cv_rules input[type=checkbox],.cv-daily input[type=checkbox]{width:18px;height:18px;vertical-align:middle;margin-right:6px;flex:none}#cv_rules button{white-space:normal;min-height:40px;max-width:100%}
        #cv_rules button:disabled,#cv_rules input:disabled{opacity:.55;cursor:not-allowed}#cv_rules :focus-visible,.cv-daily :focus-visible{outline:3px solid #256c61;outline-offset:3px}
        #cv_rules summary,.cv-daily summary{cursor:pointer;font-weight:600;padding:10px 0}#cv_rules details,.cv-daily details{min-width:0}
        #cv_rules pre,.cv-daily pre{white-space:pre-wrap;overflow-wrap:anywhere;max-width:100%;max-height:320px;overflow:auto;font-size:12px}#cv_rules td,#cv_rules th{overflow-wrap:anywhere;white-space:normal}#cv_rules .com-table{min-width:0;width:100%;table-layout:fixed}
        .cv-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.cv-day-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,370px),1fr));gap:16px}
        .cv-day{border:1px solid #d7dfdc;border-radius:6px;background:#fff;padding:18px;min-width:0;color:#22362f}.cv-day header{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}.cv-day h4{overflow-wrap:anywhere}.cv-day time,.cv-rule-caption{font-size:13px;color:#52625c}
        .cv-status{font-size:12px;border-left:3px solid #267565;padding-left:8px;align-self:flex-start}.cv-day dl{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin:20px 0}.cv-day dt{font-size:12px;color:#52625c}.cv-day dd{margin:4px 0 0;font-size:17px;overflow-wrap:anywhere}.cv-zero{display:none}.cv-show-all .cv-zero{display:block}.cv-show-all .cv-no-activity{display:none}
        .cv-enrollment-row,.cv-history-row{display:grid;grid-template-columns:minmax(140px,1.2fr) minmax(180px,1.4fr) minmax(110px,.7fr) minmax(180px,1.3fr);gap:16px;border-bottom:1px solid #d7dfdc;padding:18px 0;align-items:start;min-width:0}.cv-enrollment-row>* ,.cv-history-row>*{min-width:0;overflow-wrap:anywhere}.cv-enrollment-row .com-actions{margin:0;border:0;padding:0}
        #cv_enrollment,#cv_form,#cv_bindings,#cv_enrollmentHistory,#cv_history,#cv_correction,#cv_void{padding:20px 0;border-bottom:1px solid #d7dfdc}#cv_message:empty{display:none}.cv-warning{border-left:3px solid #b27a12;padding:12px;background:#fff6df;color:#604405}.cv-review{padding:16px 0;border-top:1px solid #d7dfdc}.cv-steps{display:flex;gap:24px;flex-wrap:wrap;font-size:13px;padding-left:20px}
        #com_content>.com-card,#com_dashboardOutput>.com-card,#mycom_output>.com-card{border:0;box-shadow:none;background:none;padding:18px 0;border-radius:0}.cv-legacy{margin-top:28px;border-top:1px solid #d7dfdc;padding-top:16px}.cv-legacy>.com-grid{display:block}.cv-legacy .com-card{box-shadow:none;border:0;background:none;padding:16px 0}
        .cv-people .com-table{min-width:0;width:100%;table-layout:fixed}.cv-people td,.cv-people th{overflow-wrap:anywhere;white-space:normal}
        @media(max-width:800px){.cv-people{overflow:visible}.cv-people thead{display:none}.cv-people tr{display:block;border-bottom:1px solid #d7dfdc}.cv-people td{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:auto;padding:10px 0;border:0}.cv-people td::before{content:attr(data-label);font-weight:600}.cv-enrollment-row,.cv-history-row{grid-template-columns:1fr 1fr}#cv_rules .com-table-wrap{overflow:visible}#cv_rules .com-table thead{display:none}#cv_rules .com-table tr{display:block;border-bottom:1px solid #d7dfdc;padding:12px 0}#cv_rules .com-table td,#cv_rules .com-table th{display:block;width:auto;padding:8px 0;border:0}#cv_edit_form tr>td:nth-child(2)::before{content:'Current value: ';font-weight:600}#cv_edit_form tr>td:nth-child(3)::before{content:'Proposed value: ';font-weight:600}}
        @media(max-width:480px){.cv-enrollment-row,.cv-history-row{grid-template-columns:1fr}.cv-day{padding:14px}.cv-day dd{font-size:16px}#cv_rules .com-actions{gap:8px}#cv_rules .com-actions button{flex:1 1 140px}.cv-steps{gap:8px 22px}}
        `;
        document.head.append(style);
    }
    return Object.freeze({ safe, date, amount, actions, status, auditStatus, hasActivity, initialPeriod, friendly, renderDays, installStyles });
});
