(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory(require('./vendor/decimal'));
    else root.ThurayaCommissionEngine = factory(root.Decimal);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Decimal) {
    'use strict';
    const D = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP });
    const VERSION = 'commission-daily-v2.1';
    const TYPE = 'DAILY_TARGET_MARGINAL';
    const POLICY = 'SETTLED_ACTIVE_JOB_OWN_SERVICE_V1';
    const norm = value => String(value == null ? '' : value).trim().toLowerCase();
    const present = value => value !== undefined && value !== null && value !== '';
    function fail(code, message) { const error = new Error(message || code); error.code = code; throw error; }
    function money(value) {
        if (!present(value) || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(String(value))) fail('INVALID_MONEY');
        const n = new D(String(value));
        if (!n.isFinite() || n.isNegative() || n.abs().gt('1e15') || n.sd() > 40) fail('INVALID_MONEY');
        return n;
    }
    function date(value) {
        if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
        const d = new Date(value + 'T12:00:00Z');
        return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
    }
    function today(now = new Date()) {
        const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Accra', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
        const get = type => parts.find(p => p.type === type).value;
        return `${get('year')}-${get('month')}-${get('day')}`;
    }
    function days(from, until) {
        if (!date(from) || !date(until) || until < from) fail('INVALID_PERIOD');
        const result = [];
        for (let d = from; d <= until;) {
            if (result.length >= 366) fail('PERIOD_TOO_LARGE');
            result.push(d);
            const next = new Date(d + 'T12:00:00Z'); next.setUTCDate(next.getUTCDate() + 1); d = next.toISOString().slice(0, 10);
        }
        return result;
    }
    const contains = (range, day) => date(day) && range.effectiveFrom <= day && (!range.effectiveUntil || day < range.effectiveUntil);
    const overlaps = (a, b) => a.effectiveFrom < (b.effectiveUntil || '9999-12-31') && b.effectiveFrom < (a.effectiveUntil || '9999-12-31');
    function validateRange(range) {
        if (!date(range.effectiveFrom) || (range.effectiveUntil != null && (!date(range.effectiveUntil) || range.effectiveUntil <= range.effectiveFrom))) fail('INVALID_EFFECTIVE_RANGE');
    }
    function validateRule(rule) {
        if (rule.schemaVersion !== 2 || rule.recordType !== 'commission_rule' || !rule.technicianPersonId || rule.ruleType !== TYPE || rule.roleKey !== 'tech') fail('INVALID_RULE');
        if (rule.taxTreatment !== 'EXCLUDE_TAX' || rule.eligibleRevenuePolicy !== POLICY || rule.currency !== 'GHS') fail('UNSUPPORTED_POLICY');
        if (!['DRAFT', 'PUBLISHED'].includes(rule.status)) fail('INVALID_RULE_STATUS');
        money(rule.dailyTarget); if (money(rule.commissionRate).gt(1)) fail('INVALID_RATE');
        if (rule.status === 'PUBLISHED' || rule.effectiveFrom) validateRange(rule);
        else if (rule.effectiveUntil) fail('INVALID_EFFECTIVE_RANGE');
        return rule;
    }
    function ruleHeads(rules, persons) {
        const ids = new Set(persons.flatMap(p => Object.values(p.ruleHeads || {})));
        return rules.filter(r => r.schemaVersion === 2 && r.status === 'PUBLISHED' && ids.has(r.id));
    }
    function assertNoOverlap(rules) {
        const published = rules.filter(r => r.status === 'PUBLISHED');
        published.forEach(validateRule);
        for (let i = 0; i < published.length; i++) for (let j = i + 1; j < published.length; j++) {
            if (published[i].technicianPersonId === published[j].technicianPersonId && overlaps(published[i], published[j])) fail('RULE_OVERLAP', `Overlapping rules: ${published[i].id} / ${published[j].id}`);
        }
    }
    function getEffectiveCommissionRule(personId, businessDate, rules) {
        if (!date(businessDate)) return { status: 'DATE_REVIEW_REQUIRED', rule: null };
        const matches = rules.filter(r => r.technicianPersonId === personId && r.status === 'PUBLISHED' && contains(r, businessDate));
        if (!matches.length) return { status: 'NOT_CONFIGURED', rule: null };
        if (matches.length !== 1) return { status: 'RULE_OVERLAP_ERROR', rule: null };
        try { validateRule(matches[0]); } catch (e) { return { status: e.code, rule: null }; }
        return { status: 'CONFIGURED', rule: matches[0] };
    }
    function validateBinding(binding) {
        validateRange(binding);
        if (!binding.personId || !binding.confirmedBy || !binding.confirmedAt) fail('UNCONFIRMED_IDENTITY');
        if (!binding.staffId && (!binding.stationEmail || !Array.isArray(binding.aliases) || !binding.aliases.length)) fail('IDENTITY_EVIDENCE_REQUIRED');
    }
    function assertBindings(bindings) {
        bindings.forEach(validateBinding);
        for (let i = 0; i < bindings.length; i++) for (let j = i + 1; j < bindings.length; j++) {
            const a = bindings[i], b = bindings[j];
            const shared = (a.stationEmail && norm(a.stationEmail) === norm(b.stationEmail)) || (a.staffId && a.staffId === b.staffId);
            if (overlaps(a, b) && (a.personId === b.personId || shared)) fail('IDENTITY_OVERLAP', 'IDENTITY_OVERLAP: Authoritative identity bindings overlap; correct the existing enrollment instead of adding duplicate coverage');
        }
    }
    function resolveCommissionIdentity(job, businessDate, persons, bindings) {
        const emails = [...new Set([job.assignedTechEmail, job.techEmail].filter(present).map(norm))];
        const aliases = [...new Set([job.assignedTechName, job.techName, job.technicianName].filter(present).map(norm))];
        const direct = job.technicianPersonId || job.personId;
        const staffId = job.technicianStaffId || job.assignedTechId || job.techId;
        const potential = bindings.filter(b => (b.stationEmail && emails.includes(norm(b.stationEmail))) || (staffId && b.staffId === staffId));
        const candidates = new Set(potential.map(b => b.personId));
        if (direct) candidates.add(direct);
        const active = potential.filter(b => contains(b, businessDate) && b.confirmedBy && b.confirmedAt);
        const matched = active.filter(b => {
            if (aliases.some(a => (b.excludedAliases || []).map(norm).includes(a))) return false;
            if (staffId && b.staffId === staffId) return !aliases.length || aliases.every(a => (b.aliases || []).map(norm).includes(a));
            return emails.length === 1 && aliases.length > 0 && aliases.every(a => (b.aliases || []).map(norm).includes(a));
        });
        const ids = new Set(matched.map(b => b.personId));
        if (direct && persons.some(p => p.personId === direct)) ids.add(direct);
        const contradictions = active.some(b => !matched.includes(b)) && !!direct;
        if (ids.size === 1 && (!direct || ids.has(direct)) && !contradictions) {
            const id = [...ids][0], person = persons.find(p => p.personId === id);
            if (person && date(person.enrollmentFrom) && businessDate >= person.enrollmentFrom) return { status: 'RESOLVED', personId: id, bindingIds: matched.filter(b => b.personId === id).map(b => b.id), candidatePersonIds: [...candidates] };
        }
        const relevant = persons.filter(p => candidates.has(p.personId) && (!date(businessDate) || businessDate >= p.enrollmentFrom));
        return { status: relevant.length ? 'IDENTITY_REVIEW_REQUIRED' : 'LEGACY', personId: null, candidatePersonIds: relevant.map(p => p.personId), bindingIds: [] };
    }
    function value(row, fields) {
        for (const field of fields) if (present(row[field])) return { amount: money(row[field]), field };
        return null;
    }
    function same(values, code) {
        const found = values.filter(Boolean);
        if (found.length && found.some(v => !v.amount.eq(found[0].amount))) fail(code);
        return found[0] || null;
    }
    function sum(values) { return values.reduce((total, v) => total.plus(v), new D(0)); }
    // The browser writer stores IEEE-754 arithmetic results, not arbitrary monetary tolerances.
    const storedNumber = amount => new D(String(amount.toNumber())).eq(amount);
    const computedAmountEquals = (computed, recorded) => computed.eq(recorded) || new D(String(computed.toNumber())).eq(recorded);
    const review = (reason, amount = null) => ({ status: 'REVIEW_REQUIRED', reason, revenue: null, pendingRevenueKnown: amount });
    function taxComponents(row) {
        const input = row.taxBreakdown;
        if (!present(input)) return [];
        const parsed = typeof input === 'string' ? JSON.parse(input) : input;
        if (!Array.isArray(parsed)) fail('TAX_BREAKDOWN_REVIEW');
        return parsed;
    }
    function lineComponents(line, job) {
        let net = value(line, ['netLineTotal', 'lineSubtotal']);
        let tax = value(line, ['taxAmount']);
        const mode = norm(line.priceMode || line.taxPricingMode || job.pricingMode || job.taxPricingMode);
        const raw = value(line, ['payableLineTotal', 'lineTotal']);
        if (!raw || !['inclusive', 'exclusive'].includes(mode)) fail('LINE_COMPONENTS_REQUIRED');
        if (!tax && present(line.taxRate) && line.taxCalculationModel === 'simple') {
            const rate = money(line.taxRate).div(100);
            const base = mode === 'inclusive' ? raw.amount.div(rate.plus(1)) : raw.amount;
            tax = { amount: mode === 'inclusive' ? raw.amount.minus(base) : base.times(rate), field: 'taxRate:simple' };
        }
        if (!tax) fail('LINE_COMPONENTS_REQUIRED');
        const gross = mode === 'inclusive' ? raw.amount : raw.amount.plus(tax.amount);
        if (!net) net = { amount: gross.minus(tax.amount), field: 'lineTotal:recorded-tax' };
        const writerEquivalent = mode === 'inclusive' && [net.amount, tax.amount, gross].every(storedNumber)
            && (net.amount.toNumber() + tax.amount.toNumber() === gross.toNumber()
                || gross.toNumber() - tax.amount.toNumber() === net.amount.toNumber());
        if (net.amount.isNegative() || (!net.amount.plus(tax.amount).eq(gross) && !writerEquivalent)) fail('LINE_TAX_COMPONENT_CONFLICT');
        return { net, tax, raw, mode, gross };
    }
    function legacyServiceComponents(lines, job, breakdown) {
        if (lines.some(line => ['netLineTotal', 'lineSubtotal', 'taxAmount', 'taxRate'].some(k => present(line[k])))) return null;
        if (!lines.every(line => line.name && present(line.price) && present(line.qty) && present(line.lineTotal))) return null;
        const modes = [job.pricingMode, job.taxPricingMode, ...lines.flatMap(line => [line.priceMode, line.taxPricingMode])].filter(present).map(norm);
        if (!(present(job.pricingMode) || present(job.taxPricingMode)) || modes.some(mode => mode !== 'exclusive')) fail('LEGACY_PRICING_MODE_REVIEW');
        const fullyApplied = row => norm(row.complimentaryStatus) === 'financial_applied' && row.complimentaryApprovedBy && row.complimentaryApprovalAuditId && row.complimentaryTotalsApplied === true;
        const hasWaiver = row => row.isComplimentary || present(row.complimentaryStatus) || ['complimentaryValue', 'waivedAmount'].some(k => present(row[k]) && money(row[k]).gt(0));
        for (const line of lines) {
            const quantity = money(line.qty), total = money(line.lineTotal);
            if (quantity.isZero() || !money(line.price).times(quantity).eq(total)) fail('LEGACY_LINE_AMOUNT_CONFLICT');
            if (['payableLineTotal', 'amount'].some(k => present(line[k]) && !money(line[k]).eq(total))) fail('LEGACY_LINE_AMOUNT_CONFLICT');
            if (hasWaiver(line) && (!fullyApplied(line) || !total.isZero())) fail('LEGACY_FULL_WAIVER_REQUIRED');
        }
        const net = sum(lines.map(line => money(line.lineTotal)));
        const corroborated = same(['bookedPrice', 'serviceSubtotal', 'taxableSubtotal'].map(k => value(job, [k])), 'LEGACY_SUBTOTAL_CONFLICT');
        if (!corroborated || !corroborated.amount.eq(net)) fail('LEGACY_SUBTOTAL_CONFLICT');
        if (!breakdown.length) fail('LEGACY_AGGREGATE_TAX_REQUIRED');
        const tax = sum(breakdown.map(t => money(t.amount))), gross = net.plus(tax);
        if (breakdown.some(t => present(t.rate) && !net.times(money(t.rate)).div(100).eq(money(t.amount)))) fail('LEGACY_TAX_RATE_CONFLICT');
        if (['taxTotal', 'totalTax'].some(k => present(job[k]) && !money(job[k]).eq(tax) && !money(job[k]).eq(tax.toDecimalPlaces(2, D.ROUND_HALF_UP)))) fail('TAX_TOTAL_CONFLICT');
        // Only current settled aliases participate; explicitly original/pre-review fields are not revenue.
        const settled = same(['totalGHC', 'finalTotal', 'amountDue', 'grandTotal', 'groupCheckoutAmount', 'memberServiceTotal', 'payableShare'].map(k => value(job, [k])), 'LEGACY_FINAL_TOTAL_CONFLICT');
        if (!present(job.totalGHC) || !settled || !settled.amount.eq(gross)) fail('LEGACY_FINAL_TOTAL_CONFLICT');
        const receipts = ['receiptTotal', 'receiptAmount'].map(k => value(job, [k])).concat(['total', 'amount', 'grandTotal'].map(k => value(job.receipt || {}, [k])));
        if (receipts.filter(Boolean).some(v => !v.amount.eq(gross))) fail('FINAL_RECEIPT_LINE_CONFLICT');
        if (['amountPaid', 'paidAmount', 'totalPaid'].some(k => present(job[k]) && !money(job[k]).eq(gross))) fail('PAYMENT_COMPONENT_CONFLICT');
        if (['remainingBalance', 'balanceDue'].some(k => present(job[k]) && money(job[k]).gt(0))) fail('UNSETTLED_BALANCE');
        if ((hasWaiver(job) || lines.some(hasWaiver)) && (!fullyApplied(job) || !lines.every(fullyApplied) || !net.isZero() || !tax.isZero())) fail('LEGACY_FULL_WAIVER_REQUIRED');
        // Preserve aggregate tax as job evidence; never invent a per-service tax allocation.
        return { key: 'legacy-price-qty-summary', net, tax, gross, mode: 'exclusive', fields: { net: 'serviceLineItems:price*qty', tax: 'taxBreakdown', total: 'totalGHC:reconciled' } };
    }
    function getCommissionableServiceRevenue(job, context = {}) {
        if (job._source !== 'Active_Jobs') return { status: 'EXCLUDED', reason: 'ACTIVE_JOB_ONLY' };
        if (job.archived === true) return { status: 'EXCLUDED', reason: 'ARCHIVED' };
        if (norm(job.status) !== 'closed' || norm(job.paymentStatus) !== 'paid') return { status: 'EXCLUDED', reason: 'NOT_CLOSED_PAID' };
        try {
            if (job.currency && !['GHS', 'GHC'].includes(job.currency)) fail('UNSUPPORTED_CURRENCY');
            if (job.refundStatus || job.refunded === true || job.refundPending === true || ['refundAmount', 'refundedAmount', 'chargebackAmount'].some(k => present(job[k]) && money(job[k]).gt(0))) fail('REFUND_REVIEW_REQUIRED');
            const group = job.isGroupBooking === true || !!job.groupId;
            const breakdown = taxComponents(job);
            let lines = Array.isArray(job.serviceLineItems) ? job.serviceLineItems : [];
            if (!lines.length && !group && job.bookedService) {
                const historicalNet = same(['serviceSubtotal', 'taxableSubtotal', 'bookedPrice'].map(k => value(job, [k])), 'LEGACY_SUBTOTAL_CONFLICT');
                const recordedTax = value(job, ['taxTotal', 'totalTax']) || (breakdown.length ? { amount: sum(breakdown.map(t => money(t.amount))), field: 'taxBreakdown' } : null);
                if (historicalNet && recordedTax) lines = [{ lineId: 'legacy-summary', lineSubtotal: historicalNet.amount.toString(), taxAmount: recordedTax.amount.toString(), lineTotal: historicalNet.amount.toString(), priceMode: 'exclusive', evidenceSchema: 'validated-legacy-subtotal-tax' }];
            }
            if (!lines.length) fail('SERVICE_LINES_REQUIRED');
            const legacy = legacyServiceComponents(lines, job, breakdown);
            const parts = lines.map((line, index) => {
                const components = legacy ? null : lineComponents(line, job);
                const lineOwner = line.technicianPersonId || line.assignedTechId || line.techId;
                const jobOwner = job.technicianPersonId || job.personId || job.assignedTechId || job.techId;
                if (lineOwner && lineOwner !== jobOwner && lineOwner !== context.personId) fail('LINE_OWNERSHIP_REVIEW_REQUIRED');
                if (line.assignedTechEmail && norm(line.assignedTechEmail) !== norm(job.assignedTechEmail || job.techEmail)) fail('LINE_OWNERSHIP_REVIEW_REQUIRED');
                const waived = value(line, ['complimentaryValue', 'waivedAmount']);
                if (waived && waived.amount.gt(0) && (!(norm(line.complimentaryStatus) === 'financial_applied' || norm(job.complimentaryStatus) === 'financial_applied') || !(line.complimentaryApprovedBy || job.complimentaryApprovedBy))) fail('WAIVER_APPROVAL_REQUIRED');
                if (legacy) return { key: String(line.lineId || index) };
                const { net, tax, raw, mode, gross: actualGross } = components;
                return { key: String(line.lineId || index), net: net.amount, tax: tax.amount, gross: actualGross, mode, fields: { net: net.field, tax: tax.field, total: raw.field } };
            });
            if (new Set(parts.map(p => p.key)).size !== parts.length) fail('DUPLICATE_SERVICE_LINE');
            if (legacy) parts.splice(0, parts.length, legacy);
            const net = sum(parts.map(p => p.net)), tax = sum(parts.map(p => p.tax)), gross = sum(parts.map(p => p.gross));
            const receiptId = job.receiptRef || job.receiptNumber || job.receiptId || (job.receipt && (job.receipt.id || job.receipt.receiptNumber));
            if (!receiptId || !(norm(job.receiptStatus) === 'generated' || job.receiptGenerated === true || norm(job.receipt && job.receipt.status) === 'generated')) fail('GENERATED_RECEIPT_REQUIRED');
            const receipt = value(job.receipt || {}, ['total', 'amount', 'grandTotal']) || value(job, ['receiptTotal', 'receiptAmount']) || (job.receiptRef && job.receiptGeneratedAt && job.closedAt ? value(job, ['groupCheckoutAmount']) : null);
            if (!receipt) fail('RECEIPT_TOTAL_REQUIRED');
            const remaining = value(job, ['remainingBalance', 'balanceDue']);
            if (remaining && remaining.amount.gt(0)) fail('UNSETTLED_BALANCE');
            const taxTotal = value(job, ['taxTotal', 'totalTax']);
            const aggregateTaxEquivalent = breakdown.length > 0
                && taxTotal && taxTotal.amount.eq(tax.toDecimalPlaces(2, D.ROUND_HALF_UP));
            if (taxTotal && !group && !taxTotal.amount.eq(tax) && !aggregateTaxEquivalent) fail('TAX_TOTAL_CONFLICT');
            if (breakdown.length && !group) {
                // Compare aggregate tax at pesewa precision, not separately rounded components.
                const expectedTax = sum(breakdown.map(t => money(t.amount))).toDecimalPlaces(2, D.ROUND_HALF_UP);
                if (!expectedTax.eq(tax.toDecimalPlaces(2, D.ROUND_HALF_UP))) fail('TAX_BREAKDOWN_CONFLICT');
            }
            const final = same(['finalTotal', 'amountDue', 'totalGHC'].map(k => value(job, [k])), 'FINAL_TOTAL_CONFLICT');
            if (!group && (!final || !computedAmountEquals(gross, final.amount) || !computedAmountEquals(gross, receipt.amount))) fail('FINAL_RECEIPT_LINE_CONFLICT');
            const discount = value(job, ['discountAmount', 'discountTotal', 'adjustmentTotal']);
            const waiver = value(job, ['complimentaryValue']);
            const original = value(job, ['grandTotal']);
            if (discount && discount.amount.gt(0) && (!original || !original.amount.minus(discount.amount).eq(gross))) fail('DISCOUNT_REPRESENTATION_REVIEW');
            if (waiver && waiver.amount.gt(0) && (norm(job.complimentaryStatus) !== 'financial_applied' || !job.complimentaryApprovedBy)) fail('WAIVER_APPROVAL_REQUIRED');
            if (!group && original && !computedAmountEquals(gross, original.amount) && !(discount && original.amount.minus(discount.amount).eq(gross)) && !(waiver && original.amount.minus(waiver.amount).eq(gross))) fail('PRE_POST_CHECKOUT_REVIEW');
            const components = Array.isArray(job.paymentComponents) ? job.paymentComponents : (Array.isArray(job.paymentSplits) ? job.paymentSplits : (Array.isArray(job.splitPayments) ? job.splitPayments : null));
            const paid = value(job, ['amountPaid', 'paidAmount', 'totalPaid']);
            if (components) {
                if (!components.length || !sum(components.map(c => money(c.amount))).eq(receipt.amount)) fail('PAYMENT_COMPONENT_CONFLICT');
            } else if (Array.isArray(job.giftCardRedemptions) && job.giftCardRedemptions.length) {
                const applied = sum(job.giftCardRedemptions.map(r => money(r.appliedAmount ?? r.amount)));
                const topUp = value(job, ['topUpAmount', 'paymentTopUpAmount']);
                if (!topUp || !applied.plus(topUp.amount).eq(receipt.amount)) fail('GIFT_SETTLEMENT_CONFLICT');
                const appliedTotal = value(job, ['giftCardAppliedAmount']);
                if (appliedTotal && !appliedTotal.amount.eq(applied)) fail('GIFT_APPLIED_CONFLICT');
            } else if (!paid || !paid.amount.eq(receipt.amount)) {
                const ordinary = ['cash', 'card / pos', 'card/pos', 'mobile money'].includes(norm(job.paymentMethod));
                const waivedZero = gross.isZero() && norm(job.complimentaryStatus) === 'financial_applied' && job.complimentaryApprovedBy;
                if (paid || !job.receiptRef || !job.receiptGeneratedAt || !job.closedAt || !(ordinary || waivedZero)) fail('SETTLEMENT_COMPONENTS_REQUIRED');
            }
            if (group) {
                const members = context.groupJobs || [];
                const memberIds = [...new Set(members.map(m => m.id))];
                if (!members.length || memberIds.length !== members.length || !members.some(m => m.id === job.id)) fail('GROUP_MEMBER_SET_REQUIRED');
                if (!job.groupSize || Number(job.groupSize) !== members.length) fail('GROUP_MEMBER_SET_INCOMPLETE');
                if (members.some(m => norm(m.status) !== 'closed' || norm(m.paymentStatus) !== 'paid' || m.archived || !Array.isArray(m.serviceLineItems))) fail('GROUP_SETTLEMENT_REVIEW');
                const shared = members.every(m => String(m.receiptRef || m.receiptNumber || m.receiptId || '') === String(receiptId));
                if (shared) {
                    const groupGross = sum(members.map(m => sum(m.serviceLineItems.map(l => {
                        const n = value(l, ['netLineTotal', 'lineSubtotal']), t = value(l, ['taxAmount']);
                        if (!n || !t) fail('GROUP_LINE_COMPONENTS_REQUIRED');
                        return n.amount.plus(t.amount);
                    }))));
                    if (!groupGross.eq(receipt.amount) || !final || !final.amount.eq(receipt.amount)) fail('GROUP_UNALLOCATED_VALUE');
                } else if (!receipt.amount.eq(gross) || !final || !final.amount.eq(gross)) fail('GROUP_MEMBER_PAYMENT_CONFLICT');
            }
            return { status: 'ELIGIBLE', reason: net.isZero() ? 'SETTLED_ZERO_SERVICE_VALUE' : 'VALIDATED_OWN_SERVICE', revenue: net.toString(), taxExcluded: tax.toString(), gross: gross.toString(), receiptId: String(receiptId), sourceFields: parts.map(p => ({ line: p.key, ...p.fields })), pendingRevenueKnown: null };
        } catch (e) { return review(e.code || 'FINANCIAL_EVIDENCE_REQUIRED'); }
    }
    function award(revenue, target, rate) {
        const excess = D.max(0, money(revenue).minus(money(target)));
        const r = money(rate); if (r.gt(1)) fail('INVALID_RATE');
        const raw = excess.times(r), payable = raw.toDecimalPlaces(2, D.ROUND_HALF_UP);
        return { excess: excess.toString(), rawCommission: raw.toString(), dailyPayable: payable.toFixed(2), payablePesewas: payable.times(100).toFixed(0) };
    }
    function buildCommissionDays({ jobs, persons, bindings, rules, start, end, complete = false }) {
        if (!complete) fail('CALCULATION_INCOMPLETE');
        const calendar = days(start, end), result = new Map(), diagnostics = [];
        for (const person of persons) for (const day of calendar) {
            if (!date(person.enrollmentFrom) || day < person.enrollmentFrom) continue;
            const resolved = getEffectiveCommissionRule(person.personId, day, rules);
            result.set(`${person.personId}:${day}`, { personId: person.personId, technician: person.displayName, businessDate: day, status: resolved.status, rule: resolved.rule, eligibleRevenue: '0', pendingRevenueKnown: '0', pendingAmountUnknown: false, pending: [], contributions: [], excluded: [], dailyPayable: null, payablePesewas: null, engineVersion: VERSION });
        }
        const seen = new Map();
        for (const job of jobs) {
            if (job._source !== 'Active_Jobs') { diagnostics.push({ jobId: job.id, reason: 'ACTIVE_JOB_ONLY' }); continue; }
            if (!job.id) fail('SOURCE_ID_REQUIRED');
            if (seen.has(job.id)) { if (stable(seen.get(job.id)) !== stable(job)) fail('DUPLICATE_SOURCE_CONFLICT'); continue; }
            seen.set(job.id, job);
        }
        for (const job of seen.values()) {
            if (job.archived || norm(job.status) !== 'closed' || norm(job.paymentStatus) !== 'paid') continue;
            if (date(job.dateString) && (job.dateString < start || job.dateString > end)) continue;
            const identity = resolveCommissionIdentity(job, job.dateString, persons, bindings);
            if (identity.status === 'LEGACY') {
                if (![job.technicianPersonId, job.personId, job.assignedTechId, job.techId, job.assignedTechEmail, job.techEmail, job.assignedTechName, job.techName].some(present)) {
                    diagnostics.push({ jobId: job.id, reason: 'UNASSIGNED_IDENTITY' });
                    for (const row of result.values()) if (!date(job.dateString) || row.businessDate === job.dateString) { row.pending.push({ jobId: job.id, reason: 'UNASSIGNED_IDENTITY', amount: null }); row.pendingAmountUnknown = true; }
                }
                continue;
            }
            const badDate = !date(job.dateString);
            const keys = identity.status === 'RESOLVED' ? [identity.personId] : identity.candidatePersonIds;
            const affected = [...result.values()].filter(row => keys.includes(row.personId) && (badDate || row.businessDate === job.dateString));
            const context = { personId: identity.personId, groupJobs: job.groupId ? [...seen.values()].filter(j => j.groupId === job.groupId) : [] };
            const receiptId = job.receiptRef || job.receiptNumber || job.receiptId;
            const duplicate = [...seen.values()].some(other => other.id !== job.id && !other.archived && norm(other.status) === 'closed' && norm(other.paymentStatus) === 'paid' && !(job.groupId && other.groupId === job.groupId) && ((receiptId && (other.receiptRef || other.receiptNumber || other.receiptId) === receiptId) || (job.sourceAppointmentId && job.sourceAppointmentId === other.sourceAppointmentId)));
            const revenue = badDate ? review('DATE_REVIEW_REQUIRED') : identity.status !== 'RESOLVED' ? review(identity.status) : duplicate ? review('COMPETING_RECEIPT_OR_SOURCE') : getCommissionableServiceRevenue(job, context);
            if (!affected.length && revenue.status === 'REVIEW_REQUIRED') diagnostics.push({ jobId: job.id, reason: revenue.reason });
            affected.forEach(row => {
                if (revenue.status === 'ELIGIBLE') {
                    row.eligibleRevenue = new D(row.eligibleRevenue).plus(revenue.revenue).toString();
                    row.contributions.push({ jobId: job.id, updateTime: job._updateTime || null, bindingIds: identity.bindingIds, ...revenue });
                } else if (revenue.status === 'REVIEW_REQUIRED') {
                    row.pending.push({ jobId: job.id, reason: revenue.reason, amount: revenue.pendingRevenueKnown });
                    row.pendingAmountUnknown ||= revenue.pendingRevenueKnown === null;
                    if (revenue.pendingRevenueKnown !== null) row.pendingRevenueKnown = new D(row.pendingRevenueKnown).plus(revenue.pendingRevenueKnown).toString();
                } else row.excluded.push({ jobId: job.id, reason: revenue.reason });
            });
        }
        for (const row of result.values()) {
            if (row.rule) {
                const calculation = award(row.eligibleRevenue, row.rule.dailyTarget, row.rule.commissionRate);
                row.dailyTarget = row.rule.dailyTarget; row.commissionRate = row.rule.commissionRate;
                row.excess = calculation.excess; row.rawCommission = calculation.rawCommission;
                row.nonPayableEstimate = calculation.dailyPayable;
                if (!row.pending.length) { Object.assign(row, calculation); row.status = calculation.excess === '0' ? 'TARGET_NOT_REACHED' : 'CALCULATED'; }
            }
            if (row.pending.length) row.status = 'PENDING';
        }
        const rows = [...result.values()].sort((a, b) => `${a.businessDate}:${a.personId}`.localeCompare(`${b.businessDate}:${b.personId}`));
        return { rows, diagnostics, summary: summarizeCommissionPeriod(rows), engineVersion: VERSION };
    }
    function summarizeCommissionPeriod(rows) {
        return { completeCommission: sum(rows.filter(r => r.dailyPayable !== null).map(r => money(r.dailyPayable))).toFixed(2), pendingDays: rows.filter(r => r.status === 'PENDING').length, notConfiguredDays: rows.filter(r => r.status === 'NOT_CONFIGURED').length, complete: rows.every(r => r.dailyPayable !== null) };
    }
    function stable(value) {
        if (Array.isArray(value)) return '[' + value.map(stable).join(',') + ']';
        if (value && typeof value === 'object') return '{' + Object.keys(value).sort().filter(k => value[k] !== undefined).map(k => JSON.stringify(k) + ':' + stable(value[k])).join(',') + '}';
        return JSON.stringify(value);
    }
    function csv(rows) {
        const fields = ['businessDate', 'personId', 'technician', 'status', 'eligibleRevenue', 'pendingRevenueKnown', 'pendingAmountUnknown', 'dailyTarget', 'excess', 'commissionRate', 'dailyPayable', 'ruleId', 'ruleType', 'effectiveFrom', 'effectiveUntil'];
        const escape = v => '"' + String(v == null ? '' : v).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
        return [fields, ...rows.map(r => fields.map(f => ({ ...r, ruleId: r.rule && r.rule.id, ruleType: r.rule && r.rule.ruleType, effectiveFrom: r.rule && r.rule.effectiveFrom, effectiveUntil: r.rule && r.rule.effectiveUntil })[f]))].map(row => row.map(escape).join(',')).join('\r\n');
    }
    return Object.freeze({ VERSION, TYPE, POLICY, money, date, today, days, contains, overlaps, validateRange, validateRule, ruleHeads, assertNoOverlap, getEffectiveCommissionRule, validateBinding, assertBindings, resolveCommissionIdentity, getCommissionableServiceRevenue, award, buildCommissionDays, summarizeCommissionPeriod, stable, csv });
});
