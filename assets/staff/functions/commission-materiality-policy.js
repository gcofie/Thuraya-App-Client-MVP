'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const engine = require('./commission-engine');
const VERSION = 'commission-zero-impact-v1';
const EVENT = 'commission_materiality_event';
const EVIDENCE_COLLECTIONS = ['Appointments', 'Receipts', 'Payments', 'Gift_Cards', 'Gift_Card_Redemptions', 'Gift_Checkouts', 'Sales_Redemptions', 'Approval_Audit', 'Bookings'];
const hash = value => crypto.createHash('sha256').update(engine.stable(value)).digest('hex');
const sourceHash = hash([__filename, require.resolve('./commission-engine')].map(file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')));
const money = engine.money;
const has = value => value !== null && value !== undefined && value !== '';
const max = values => values.reduce((n, v) => money(v).gt(n) ? money(v) : n, money('0'));
const sum = values => values.reduce((n, v) => n.plus(money(v)), money('0'));
const norm = value => String(value || '').trim().toLowerCase();
const closed = job => norm(job.status) === 'closed' && norm(job.paymentStatus) === 'paid' && job.archived !== true;
const RECEIPT_FIELDS = ['receiptTotal', 'receiptAmount', 'totalGHC', 'grandTotal', 'groupCheckoutAmount', 'finalTotal', 'amountDue', 'amountPaid', 'paidAmount', 'totalPaid', 'memberServiceTotal', 'payableShare'];
const NET_FIELDS = ['bookedPrice', 'serviceSubtotal', 'taxableSubtotal', 'subtotal', 'netRevenue'];
const receiptIdentity = job => job.receiptRef || job.receiptNumber || job.receiptId || job.receipt?.id || job.receipt?.receiptNumber;
const REASONS = new Set(['IDENTITY_REVIEW_REQUIRED', 'GIFT_SETTLEMENT_CONFLICT', 'LEGACY_PRICING_MODE_REVIEW', 'TAX_TOTAL_CONFLICT', 'LINE_TAX_COMPONENT_CONFLICT', 'INVALID_MONEY', 'FINAL_RECEIPT_LINE_CONFLICT', 'FINAL_TOTAL_CONFLICT', 'GROUP_SETTLEMENT_REVIEW', 'GROUP_MEMBER_SET_INCOMPLETE']);
const CATALOG_CONTENT_CONTAINERS = new Set(['servicelineitems', 'complimentaryoriginalservicelineitems', 'quickeditv4items', 'quickedititems']);
const CATALOG_CONTENT_KEYS = new Set(['serviceid', 'menuitemid', 'servicedefinitionid', 'servicecatalogid', 'catalogid', 'catalogitemid', 'menuid', 'quickedititemid']);
const TRANSACTION_ID_CONTAINERS = new Set(['receipt', 'receipts', 'payment', 'payments', 'checkout', 'giftcard', 'giftcards', 'voucher', 'vouchers', 'redemption', 'redemptions', 'source', 'appointment', 'appointments', 'job', 'jobs', 'activejob', 'activejobs', 'booking', 'bookings', 'foh', 'group', 'groups']);
const TRANSACTION_REFERENCE_KEYS = /^(groupId|sourceAppointmentId|activeJobId|activeJobIds|jobId|jobIds|appointmentId|appointmentIds|receiptId|receiptRef|receiptReference|receiptNumber|receiptCode|checkoutId|checkoutRef|checkoutReference|redemptionId|redemptionRef|giftCardId|giftCardCode|giftCode|voucherId|voucherCode|code|codes|paymentId|paymentRef|paymentReference|transactionId|transactionRef|transactionReference|sourceId|sourceRef|sourceReference|reference|references|referenceId|referenceIds|referenceNo|bookingId|bookingRef|bookingReference|linkedActiveJobId|linkedAppointmentId)$/i;
function reject(reason) { throw new Error(reason); }
function pathPart(value) { return String(value).replace(/[^a-z0-9]/gi, '').toLowerCase(); }
function pathHasCatalogContainer(path) {
    return path.some(part => CATALOG_CONTENT_CONTAINERS.has(pathPart(part)));
}
function pathHasTransactionContainer(path) {
    return path.some(part => TRANSACTION_ID_CONTAINERS.has(pathPart(part)));
}
function isCatalogContentKey(key, path) {
    const lower = String(key).toLowerCase();
    if (pathHasCatalogContainer(path) && ['id', 'code', 'codes', 'reference', 'references'].includes(lower)) return true;
    return CATALOG_CONTENT_KEYS.has(lower);
}
function isTransactionReferenceKey(key, path) {
    const lower = String(key).toLowerCase();
    if (isCatalogContentKey(key, path)) return false;
    if (lower === 'id') return path.length === 1 || pathHasTransactionContainer(path.slice(0, -1));
    return TRANSACTION_REFERENCE_KEYS.test(key);
}
function strings(value) {
    return Array.isArray(value) ? value.flatMap(strings) : typeof value === 'string' && value ? [value] : [];
}
function collectTransactionReferences(value, ids, path = []) {
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (isTransactionReferenceKey(key, nextPath)) for (const v of strings(item)) ids.add(v);
        if (item && typeof item === 'object') collectTransactionReferences(item, ids, nextPath);
    }
}
function hasTransactionReference(value, ids, path = []) {
    if (!value || typeof value !== 'object') return false;
    for (const [key, item] of Object.entries(value)) {
        const nextPath = [...path, key];
        if (isTransactionReferenceKey(key, nextPath) && strings(item).some(v => ids.has(v))) return true;
        if (item && typeof item === 'object' && hasTransactionReference(item, ids, nextPath)) return true;
    }
    return false;
}
function receipt(job) {
    const id = receiptIdentity(job);
    if (!id || !(norm(job.receiptStatus) === 'generated' || job.receiptGeneratedAt)) reject('RECEIPT_EVIDENCE_REQUIRED');
    const values = RECEIPT_FIELDS.filter(k => has(job[k])).map(k => ({ field: k, value: money(job[k]).toString() }));
    for (const k of ['total', 'amount', 'grandTotal']) if (has(job.receipt?.[k])) values.push({ field: 'receipt.' + k, value: money(job.receipt[k]).toString() });
    if (!values.length) reject('RECEIPT_AMOUNT_REQUIRED');
    return { id, values, ceiling: max(values.map(v => v.value)).toString() };
}
function lineCeiling(lines) {
    if (!Array.isArray(lines) || !lines.length) reject('SERVICE_EVIDENCE_REQUIRED');
    return sum(lines.map(line => {
        const quantity = money(line.quantity ?? line.qty ?? 1);
        if (has(line.quantity) && has(line.qty) && !money(line.quantity).eq(line.qty)) reject('SERVICE_QUANTITY_CONFLICT');
        if (!quantity.isInteger() || quantity.lte(0)) reject('SERVICE_QUANTITY_REQUIRED');
        const values = ['payableLineTotal', 'netLineTotal', 'lineTotal', 'lineSubtotal', 'originalLineTotal', 'amount'].filter(k => has(line[k])).map(k => money(line[k]));
        for (const k of ['price', 'unitPrice', 'unitPriceAtBooking', 'originalUnitPrice']) if (has(line[k])) values.push(money(line[k]).times(quantity));
        if (!values.length || !(line.name || line.serviceName || line.serviceId)) reject('SERVICE_PRICE_REQUIRED');
        return max(values);
    }));
}
function transactionCeiling(job) {
    if (!closed(job) || !engine.date(job.dateString)) reject('CLOSED_SOURCE_REQUIRED');
    if (job.isGroupBooking === true && !job.groupId) reject('GROUP_ID_REQUIRED');
    if (job.refundStatus || job.refunded === true || job.refundAmount || job.chargeback) reject('REFUND_BOUND_UNPROVEN');
    const rec = receipt(job), lines = job.serviceLineItems;
    const alternatives = [{ field: 'receiptEnvelope', value: rec.ceiling }];
    for (const k of NET_FIELDS) if (has(job[k])) alternatives.push({ field: k, value: money(job[k]).toString() });
    for (const k of ['paymentComponents', 'paymentSplits', 'splitPayments']) if (has(job[k])) {
        if (!Array.isArray(job[k]) || !job[k].length) reject('TENDER_COMPONENT_BOUND_UNPROVEN');
        alternatives.push({ field: k, value: sum(job[k].map(c => money(c.amount))).toString() });
    }
    if (Array.isArray(lines) && lines.length) alternatives.push({ field: 'serviceLineEnvelope', value: lineCeiling(lines).toString() });
    else {
        if (!String(job.bookedService || '').trim() || !has(job.bookedPrice) || !has(job.totalGHC) || !has(job.grandTotal) || !money(job.totalGHC).eq(job.grandTotal)) reject('LEGACY_TRANSACTION_BOUND_UNPROVEN');
        alternatives.push({ field: 'bookedPrice', value: money(job.bookedPrice).toString() });
    }
    if (has(job.fohCheckoutPreviousTotal)) alternatives.push({ field: 'explicitPreviousFohTotal', value: money(job.fohCheckoutPreviousTotal).toString() });
    if (job.complimentaryOriginalTotals) {
        if (!Array.isArray(job.complimentaryOriginalServiceLineItems) || !job.complimentaryOriginalServiceLineItems.length) reject('WAIVER_ORIGINAL_EVIDENCE_REQUIRED');
        alternatives.push({ field: 'originalServiceEnvelope', value: lineCeiling(job.complimentaryOriginalServiceLineItems).toString() });
        for (const k of [...RECEIPT_FIELDS, ...NET_FIELDS]) if (has(job.complimentaryOriginalTotals[k])) alternatives.push({ field: 'complimentaryOriginalTotals.' + k, value: money(job.complimentaryOriginalTotals[k]).toString() });
    }
    // These are conservative outer envelopes, never eligible revenue or tax normalization.
    return { jobId: job.id, receiptId: rec.id, alternatives, ceiling: max(alternatives.map(v => v.value)).toString() };
}
function groupCeiling(job, jobs, evidence) {
    const members = jobs.filter(j => j.groupId === job.groupId && j.archived !== true);
    const size = Number(job.groupSize);
    if (!Number.isSafeInteger(size) || size < 2 || members.length !== size || members.some(j => Number(j.groupSize) !== size || !closed(j))) reject('GROUP_TERMINAL_MEMBERSHIP_UNPROVEN');
    const appointments = (evidence.Appointments || []).filter(a => a.groupId === job.groupId && a.archived !== true);
    if (appointments.length && (appointments.length !== size || members.some(j => !appointments.some(a => a.id === j.sourceAppointmentId)))) reject('GROUP_APPOINTMENT_MEMBERSHIP_UNPROVEN');
    const transactions = members.map(transactionCeiling), receipts = new Set(transactions.map(t => t.receiptId));
    if (receipts.size !== 1) reject('GROUP_RECEIPT_ENVELOPE_UNPROVEN');
    const shared = members.map(j => {
        if (!has(j.groupCheckoutAmount) || !has(j.totalGHC) || !money(j.groupCheckoutAmount).eq(j.totalGHC)) reject('GROUP_TOTAL_ENVELOPE_UNPROVEN');
        return money(j.groupCheckoutAmount).toString();
    });
    if (new Set(shared).size !== 1) reject('GROUP_SHARED_TOTAL_CONFLICT');
    const serviceTotal = sum(members.map(j => lineCeiling(j.serviceLineItems)));
    if (serviceTotal.gt(shared[0])) reject('GROUP_RECEIPT_DOES_NOT_CAP_SERVICES');
    if (transactions.some(t => money(t.ceiling).gt(shared[0]))) reject('GROUP_ALTERNATIVE_EXCEEDS_RECEIPT');
    return { groupId: job.groupId, jobIds: members.map(j => j.id).sort(), receiptId: transactions[0].receiptId, ceiling: shared[0], method: 'WHOLE_CLOSED_GROUP_RECEIPT_ONCE_NO_ALLOCATION' };
}
function fingerprints({ jobs, persons, bindings, rules, evidence }, businessDate) {
    if (businessDate) {
        const dayJobs = jobs.filter(j => j.dateString === businessDate || !engine.date(j.dateString));
        const groups = new Set(dayJobs.map(j => j.groupId).filter(Boolean));
        jobs = jobs.filter(j => dayJobs.includes(j) || groups.has(j.groupId));
        const ids = new Set();
        const references = value => collectTransactionReferences(value, ids);
        jobs.forEach(references);
        const linked = value => hasTransactionReference(value, ids);
        const selected = Object.fromEntries(EVIDENCE_COLLECTIONS.map(c => [c, []]));
        // Close the reference graph, including newly inserted linked evidence.
        let added;
        do {
            added = false;
            for (const c of EVIDENCE_COLLECTIONS) for (const record of evidence[c] || []) {
                if (selected[c].includes(record) || !linked(record)) continue;
                selected[c].push(record); references(record); added = true;
            }
        } while (added);
        evidence = selected;
    }
    const canonical = rows => [...rows].sort((a, b) => String(a.id || a.personId).localeCompare(String(b.id || b.personId)));
    const sources = { Active_Jobs: canonical(jobs), ...Object.fromEntries(EVIDENCE_COLLECTIONS.map(k => [k, canonical(evidence[k] || [])])) };
    const sourceFingerprint = hash(sources), queryMembershipFingerprint = hash(Object.fromEntries(Object.entries(sources).map(([k, rows]) => [k, rows.map(r => r.id)])));
    return { sourceFingerprint, queryMembershipFingerprint, ruleFingerprint: hash(canonical(rules)), identityFingerprint: hash({ persons: canonical(persons), bindings: canonical(bindings) }), receiptGroupFingerprint: hash({ evidence: sources, groups: jobs.filter(j => j.groupId).map(j => [j.id, j.groupId]).sort() }), policyVersion: VERSION, sourceHash };
}
function validateLinkedEvidence(part, context) {
    const jobs = context.jobs.filter(j => (part.jobIds || [part.jobId]).includes(j.id));
    const ids = new Set([part.receiptId, ...jobs.flatMap(j => [j.id, j.sourceAppointmentId])].filter(Boolean));
    const linked = value => hasTransactionReference(value, ids);
    const fields = new Set(['amount', 'total', 'totalGHC', 'grandTotal', 'finalTotal', 'receiptTotal', 'serviceTotal', 'amountPaid', 'appliedAmount', 'topUpAmount', 'paymentTopUpAmount', 'cashAmount', 'cardAmount', 'mobileMoneyAmount', 'netAmount', 'grossAmount']);
    const amounts = value => !value || typeof value !== 'object' ? [] : Object.entries(value).flatMap(([key, item]) => fields.has(key) && has(item) ? [money(item)] : item && typeof item === 'object' ? amounts(item) : []);
    const verified = [];
    for (const collection of ['Receipts', 'Payments', 'Gift_Card_Redemptions', 'Gift_Checkouts', 'Sales_Redemptions', 'Approval_Audit']) {
        for (const record of context.evidence[collection] || []) {
            if (!linked(record)) continue;
            const values = amounts(record);
            if ((!values.length && collection !== 'Approval_Audit') || values.some(v => v.gt(part.ceiling))) reject('LINKED_SETTLEMENT_BOUND_UNPROVEN');
            const components = record.paymentComponents || record.paymentSplits || record.result?.paymentMeta?.paymentSplits;
            if (components && (!Array.isArray(components) || sum(components.map(c => money(c.amount))).gt(part.ceiling))) reject('LINKED_TENDER_EXCEEDS_BOUND');
            verified.push({ collection, id: record.id, fingerprint: hash(record) });
        }
    }
    return verified;
}
function evaluate(row, context, roots = fingerprints(context, row.businessDate)) {
    const base = { schemaVersion: 2, policyVersion: VERSION, personId: row.personId, businessDate: row.businessDate, originalPendingReasons: row.pending || [], underlyingJobIds: (row.pending || []).map(p => p.jobId), acceptedRevenue: row.eligibleRevenue, target: row.dailyTarget ?? null, ruleId: row.rule?.id || null, ruleRevision: row.rule?.revision || null, fingerprints: roots, appointmentFallback: 0 };
    try {
        if (context.complete !== true || context.diagnostics?.length) reject('INCOMPLETE_SOURCE_UNIVERSE');
        if (row.status !== 'PENDING' || !row.pending?.length || !engine.date(row.businessDate)) reject('PENDING_CONFIGURED_DAY_REQUIRED');
        const selected = engine.getEffectiveCommissionRule(row.personId, row.businessDate, context.rules);
        if (selected.status !== 'CONFIGURED' || hash(selected.rule) !== hash(row.rule)) reject('DETERMINISTIC_RULE_REQUIRED');
        const person = context.persons.find(p => p.personId === row.personId);
        if (!person || !context.bindings.some(b => b.personId === row.personId && engine.contains(b, row.businessDate))) reject('PERSON_BINDING_REQUIRED');
        const accepted = money(row.eligibleRevenue), target = money(row.rule.dailyTarget);
        if (!accepted.eq(sum(row.contributions.map(c => c.revenue)))) reject('ACCEPTED_REVENUE_MISMATCH');
        for (const contribution of row.contributions) {
            const j = context.jobs.find(j => j.id === contribution.jobId);
            if (!j || engine.resolveCommissionIdentity(j, row.businessDate, context.persons, context.bindings).personId !== row.personId) reject('ACCEPTED_IDENTITY_UNPROVEN');
        }
        const parts = [], seenGroups = new Set(), seenReceipts = new Set();
        for (const pending of row.pending) {
            if (!REASONS.has(pending.reason)) reject('UNSUPPORTED_BOUND_REASON');
            const job = context.jobs.find(j => j.id === pending.jobId);
            if (!job || job._source !== 'Active_Jobs' || job.dateString !== row.businessDate) reject('CANONICAL_SOURCE_REQUIRED');
            const identity = engine.resolveCommissionIdentity(job, row.businessDate, context.persons, context.bindings);
            if (identity.personId !== row.personId && !(identity.status === 'IDENTITY_REVIEW_REQUIRED' && identity.candidatePersonIds?.length === 1 && identity.candidatePersonIds[0] === row.personId && accepted.eq(0))) reject('IDENTITY_BOUND_UNPROVEN');
            let part;
            if (job.groupId) { if (seenGroups.has(job.groupId)) continue; seenGroups.add(job.groupId); part = groupCeiling(job, context.jobs, context.evidence); }
            else part = transactionCeiling(job);
            if (seenReceipts.has(part.receiptId) || row.contributions.some(c => { const j = context.jobs.find(j => j.id === c.jobId); return j && receiptIdentity(j) === part.receiptId; })) reject('OVERLAPPING_RECEIPT_UNIVERSE');
            part.linkedEvidence = validateLinkedEvidence(part, context);
            seenReceipts.add(part.receiptId); parts.push(part);
        }
        const ceiling = sum(parts.map(p => p.ceiling)), maximumRevenue = accepted.plus(ceiling);
        const eligible = maximumRevenue.lte(target);
        const result = { ...base, parts, blockedRevenueCeiling: ceiling.toString(), maximumRevenue: maximumRevenue.toString(), maximumCommissionDelta: eligible ? '0.00' : null, eligible, materiality: eligible ? 'M2' : 'MATERIALITY_UNPROVEN', reason: eligible ? null : 'ZERO_DELTA_NOT_PROVEN' };
        return { ...result, proofFingerprint: hash(result) };
    } catch (error) {
        const result = { ...base, eligible: false, materiality: 'M3', reason: error.message, blockedRevenueCeiling: null, maximumCommissionDelta: null };
        return { ...result, proofFingerprint: hash(result) };
    }
}
function latest(events, personId, businessDate) {
    return events.filter(e => e.schemaVersion === 2 && e.id?.startsWith('v2_materiality_event_') && e.recordType === EVENT && e.state !== 'REVIEWED' && e.personId === personId && e.businessDate === businessDate).sort((a, b) => b.sequence - a.sequence)[0] || null;
}
function disposition(proof, event) {
    if (!event) return { state: 'UNAPPROVED', valid: false, materiality: proof.materiality, eligible: proof.eligible };
    const revoked = ['REVOKED', 'INVALIDATED'].includes(event.state);
    const valid = !revoked && event.state === 'APPROVED' && proof.eligible && event.certificate?.proofFingerprint === proof.proofFingerprint;
    return { state: valid ? 'APPROVED' : revoked ? event.state : 'STALE', valid, eligible: proof.eligible, materiality: proof.materiality, approvalId: event.id, approvedAt: event.createdAt, approvedBy: event.actorUid, reason: event.reason, maximumCommissionDelta: valid ? '0.00' : null };
}
module.exports = { VERSION, EVENT, EVIDENCE_COLLECTIONS, evaluate, fingerprints, latest, disposition, hash };
