// Mechanically extracted legacy evaluator from production 64e5968d.
// Keep legacy semantics isolated from the stricter target-model engine.
'use strict';
const window = { allMenuServicesCache: [] };
(function(){
    if (window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__) return;
    window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__ = true;

    function num(value, fallback = 0){
        const n = Number(String(value ?? '').replace(/[^0-9.-]/g, ''));
        return Number.isFinite(n) ? n : fallback;
    }
    function nameOf(item, fallback){
        return String(item?.name || item?.serviceName || item?.label || item?.service || fallback || 'Service').trim();
    }
    function qtyOf(item){
        const q = parseInt(item?.qty || item?.quantity || item?.count || '1', 10);
        return Number.isFinite(q) && q > 0 ? q : 1;
    }
    function durationOf(item){
        const d = parseInt(item?.duration || item?.minutes || item?.durationMins || '0', 10);
        return Number.isFinite(d) ? d : 0;
    }
    function unitPriceOf(item){
        const direct = item?.unitPrice ?? item?.basePrice ?? item?.price ?? item?.amount;
        if (direct !== undefined && direct !== null && direct !== '') return num(direct, 0);
        const lineTotal = num(item?.lineTotal ?? item?.totalPrice, NaN);
        return Number.isFinite(lineTotal) ? lineTotal / qtyOf(item) : 0;
    }
    function lineTotalOf(item){
        const explicit = num(item?.lineTotal ?? item?.totalPrice, NaN);
        if (Number.isFinite(explicit)) return explicit;
        return unitPriceOf(item) * qtyOf(item);
    }
    function sourceTotal(record){
        const source = record || {};
        return num(
            source.taxableSubtotal ??
            source.bookedPrice ??
            source.serviceTotal ??
            source.memberServiceSubtotal ??
            source.memberServiceTotal ??
            source.finalTotal ??
            source.grandTotal ??
            source.amountDue ??
            source.totalGHC ??
            source.price,
            0
        );
    }
    function serviceNameKey(value){
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/\s*\(x\s*\d+\)\s*$/i, '')
            .replace(/\s*(?:[xX]|\u00d7)\s*\d+\s*$/i, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/gi, ' ')
            .trim()
            .toLowerCase();
    }
    function parseServicePart(value){
        let name = String(value || '').trim();
        let qty = 1;
        const parenQty = name.match(/\s*\(x\s*(\d+)\)\s*$/i);
        if (parenQty) {
            qty = Math.max(1, parseInt(parenQty[1], 10) || 1);
            name = name.replace(/\s*\(x\s*\d+\)\s*$/i, '').trim();
            name = name.replace(/\s*(?:[xX]|\u00d7)\s*\d+\s*$/, '').trim();
        } else {
            const plainQty = name.match(/\s*(?:[xX]|\u00d7)\s*(\d+)\s*$/);
            if (plainQty) {
                qty = Math.max(1, parseInt(plainQty[1], 10) || 1);
                name = name.replace(/\s*(?:[xX]|\u00d7)\s*\d+\s*$/, '').trim();
            }
        }
        return name ? { name, qty } : null;
    }
    function splitServiceText(value){
        return String(value || '').split(',').map(parseServicePart).filter(Boolean);
    }
    function menuServices(){
        try {
            if (Array.isArray(window.allMenuServicesCache)) return window.allMenuServicesCache;
            if (typeof allMenuServicesCache !== 'undefined' && Array.isArray(allMenuServicesCache)) return allMenuServicesCache;
        } catch(e) {}
        return [];
    }
    function menuServiceName(item){
        return String(item?.serviceName || item?.name || item?.displayName || item?.service || '').trim();
    }
    function findMenuService(name){
        const key = serviceNameKey(name);
        if (!key) return null;
        return menuServices().find(item => serviceNameKey(menuServiceName(item)) === key) || null;
    }
    function normalizeLineItem(item, fallbackName, sourceName){
        const qty = qtyOf(item);
        const unitPrice = unitPriceOf(item);
        const lineTotal = lineTotalOf(item);
        return {
            id: item?.id || item?.serviceId || '',
            name: nameOf(item, fallbackName),
            qty,
            quantity: qty,
            unitPrice,
            price: unitPrice,
            lineTotal,
            duration: durationOf(item),
            source: sourceName || item?.source || '',
            department: item?.department || item?.appliesTo || '',
            ritualGroup: item?.ritualGroup || '',
            category: item?.category || item?.mainCategory || '',
            serviceType: item?.serviceType || '',
            isComplimentary: item?.isComplimentary === true,
            complimentaryStatus: item?.complimentaryStatus || '',
            complimentaryReason: item?.complimentaryReason || '',
            complimentaryApprovedBy: item?.complimentaryApprovedBy || '',
            complimentaryApprovedAt: item?.complimentaryApprovedAt || null,
            complimentaryAppliedBy: item?.complimentaryAppliedBy || '',
            complimentaryAppliedAt: item?.complimentaryAppliedAt || null,
            complimentaryRequestedBy: item?.complimentaryRequestedBy || '',
            complimentaryTotalsApplied: item?.complimentaryTotalsApplied === true,
            complimentaryMarkerVersion: item?.complimentaryMarkerVersion || '',
            complimentaryAdjustmentVersion: item?.complimentaryAdjustmentVersion || '',
            approvalAuditId: item?.approvalAuditId || item?.complimentaryApprovalAuditId || '',
            complimentaryApprovalAuditId: item?.complimentaryApprovalAuditId || item?.approvalAuditId || '',
            originalName: item?.originalName || '',
            originalQty: item?.originalQty ?? null,
            originalUnitPrice: item?.originalUnitPrice ?? null,
            originalLineTotal: item?.originalLineTotal ?? null,
            payableLineTotal: item?.payableLineTotal ?? null,
            complimentaryValue: item?.complimentaryValue ?? null
        };
    }
    function isAppliedComplimentaryLine(item){
        const row = item || {};
        const status = String(row.complimentaryStatus || '').toLowerCase();
        return row.isComplimentary === true &&
            (status === 'financial_applied' ||
                row.complimentaryTotalsApplied === true ||
                row.complimentaryAdjustmentVersion === 'SERVICE_COMP_FINANCIAL_V1') &&
            !!(row.approvalAuditId || row.complimentaryApprovalAuditId || row.complimentaryApprovedBy || row.complimentaryAppliedBy);
    }
    function rowsFromArray(raw, sourceName, fallbackName){
        if (!Array.isArray(raw) || !raw.length) return [];
        return raw.flatMap(item => {
            const row = normalizeLineItem(item, fallbackName, sourceName);
            if (isAppliedComplimentaryLine(row)) return [row];
            const parts = splitServiceText(row.name);
            const hasEmbeddedQty = parts.some(part => part.qty > 1);
            const shouldTryItemize = parts.length > 1 || hasEmbeddedQty || serviceNameKey(parts[0]?.name) !== serviceNameKey(row.name);
            if (parts.length && shouldTryItemize) {
                const matched = parts.map(part => ({ part, service: findMenuService(part.name) }));
                if (matched.every(match => match.service)) {
                    const parentQty = hasEmbeddedQty ? 1 : qtyOf(row);
                    const itemized = matched.map(match => normalizeLineItem({
                        ...match.service,
                        name: menuServiceName(match.service),
                        qty: match.part.qty * parentQty,
                        source: sourceName
                    }, match.part.name, sourceName));
                    const actual = itemized.reduce((sum, child) => sum + num(child.lineTotal, 0), 0);
                    const hasLineTotal = row.lineTotal !== undefined && row.lineTotal !== null && Number.isFinite(num(row.lineTotal, NaN));
                    if (!hasLineTotal || Math.abs(row.lineTotal - actual) <= 0.05) return itemized;
                }
            }
            return [row];
        }).filter(item => item.name && item.lineTotal >= 0);
    }
    function rowsFromBookedService(record){
        const source = record || {};
        const fallbackName = String(source.bookedService || source.services || '').trim();
        if (!fallbackName) return [];

        const parts = splitServiceText(fallbackName);
        if (parts.length > 1) {
            const matched = parts.map(part => ({ part, service: findMenuService(part.name) }));
            if (matched.every(row => row.service)) {
                const rows = matched.map(row => normalizeLineItem({
                    ...row.service,
                    name: menuServiceName(row.service),
                    qty: row.part.qty,
                    source: 'bookedService match'
                }, row.part.name, 'bookedService match'));
                const expected = sourceTotal(source);
                const actual = rows.reduce((sum, item) => sum + num(item.lineTotal, 0), 0);
                if (!expected || Math.abs(expected - actual) <= 0.05) return rows;
            }
        }

        return [normalizeLineItem({
            name: fallbackName,
            qty: 1,
            price: sourceTotal(source),
            lineTotal: sourceTotal(source),
            duration: source.bookedDuration || source.duration || 0,
            source: 'bookedService fallback'
        }, fallbackName, 'bookedService fallback')];
    }

    window.thNormalizeServiceLineItem = normalizeLineItem;
    window.thServiceLineItemsFromRecord = function(record){
        const source = record || {};
        const fallbackName = String(source.bookedService || source.services || 'Service').trim();
        const sources = [
            ['serviceLineItems', source.serviceLineItems],
            ['checkoutReviewItems', source.checkoutReviewItems],
            ['consultationTicketItems', source.consultationTicketItems],
            ['quickEditV4Items', source.quickEditV4Items]
        ];
        for (const [sourceName, raw] of sources) {
            const rows = rowsFromArray(raw, sourceName, fallbackName);
            if (rows.length) return rows;
        }
        return rowsFromBookedService(source);
    };
    window.thServiceLineSummaryText = function(items){
        return (Array.isArray(items) ? items : []).map(item => {
            const qty = qtyOf(item);
            return qty > 1 ? `${nameOf(item)} (x${qty})` : nameOf(item);
        }).join(', ');
    };
})();

(function(){
    if (window.__TH_COMP_FINANCIAL_NORMALIZER_20260601__) return;
    window.__TH_COMP_FINANCIAL_NORMALIZER_20260601__ = true;

    function nfNumber(value, fallback = null) {
        if (value === undefined || value === null || value === '') return fallback;
        const parsed = Number(String(value).replace(/[^0-9.-]/g, ''));
        return Number.isFinite(parsed) ? parsed : fallback;
    }

    function nfRound(value) {
        const n = nfNumber(value, 0);
        return Math.round((n + Number.EPSILON) * 100) / 100;
    }

    function nfFirstNumber(source, keys, fallback = null) {
        const record = source || {};
        for (const key of keys) {
            const value = nfNumber(record[key], null);
            if (value !== null) return value;
        }
        return fallback;
    }

    function nfPushWarning(warnings, code) {
        if (code && !warnings.includes(code)) warnings.push(code);
    }

    function nfIsGroupJob(job) {
        const source = job || {};
        if (typeof gb_isGroup === 'function') {
            try { if (gb_isGroup(source)) return true; } catch(e) {}
        }
        const groupSize = nfNumber(source.groupSize, 1);
        return source.isGroupBooking === true || !!source.groupId || groupSize > 1;
    }

    function nfTaxRows(job, warnings) {
        const raw = job && job.taxBreakdown;
        if (!raw) return [];
        if (Array.isArray(raw)) return raw;
        try {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) return parsed;
        } catch(e) {
            nfPushWarning(warnings, 'tax-breakdown-unparseable');
        }
        return [];
    }

    function nfTaxTotal(job, warnings) {
        const explicit = nfFirstNumber(job, ['taxTotal', 'totalTax', 'taxAmount'], null);
        if (explicit !== null) return explicit;
        const rows = nfTaxRows(job, warnings);
        if (rows.length) {
            nfPushWarning(warnings, 'tax-total-inferred-from-breakdown');
            return rows.reduce((sum, row) => sum + nfNumber(row && row.amount, 0), 0);
        }
        return 0;
    }

    function nfQty(row) {
        const qty = parseInt(row?.qty ?? row?.quantity ?? row?.count ?? 1, 10);
        return Number.isFinite(qty) && qty > 0 ? qty : 1;
    }

    function nfLinePayable(row) {
        const qty = nfQty(row);
        const direct = nfFirstNumber(row, ['payableLineTotal', 'lineTotal', 'totalPrice', 'amount'], null);
        if (direct !== null) return direct;
        const unit = nfFirstNumber(row, ['unitPrice', 'price', 'basePrice'], 0);
        return unit * qty;
    }

    function nfLineOriginal(row, payable) {
        const qty = nfQty(row);
        const originalLine = nfFirstNumber(row, ['originalLineTotal'], null);
        if (originalLine !== null) return originalLine;
        const originalUnit = nfFirstNumber(row, ['originalUnitPrice'], null);
        if (originalUnit !== null) {
            const originalQty = nfNumber(row?.originalQty, qty);
            return originalUnit * (originalQty || qty);
        }
        const compValue = nfNumber(row?.complimentaryValue, 0);
        return payable + Math.max(0, compValue);
    }

    function nfIsFinancialComplimentaryLine(row) {
        const source = row || {};
        const status = String(source.complimentaryStatus || '').toLowerCase();
        return source.isComplimentary === true &&
            (status === 'financial_applied' ||
                source.complimentaryTotalsApplied === true ||
                source.complimentaryAdjustmentVersion === 'SERVICE_COMP_FINANCIAL_V1') &&
            !!(source.approvalAuditId || source.complimentaryApprovalAuditId || source.complimentaryApprovedBy || source.complimentaryAppliedBy);
    }

    function nfIsMarkerOnlyLine(row) {
        const source = row || {};
        const status = String(source.complimentaryStatus || '').toLowerCase();
        return source.isComplimentary === true && !nfIsFinancialComplimentaryLine(source) &&
            (status === 'approved_marker_only' || !!source.approvalAuditId || !!source.complimentaryApprovedBy);
    }

    function nfIsFinancialComplimentaryJob(job) {
        const source = job || {};
        const status = String(source.complimentaryStatus || '').toLowerCase();
        return source.hasComplimentaryAdjustment === true &&
            (status === 'financial_applied' ||
                source.complimentaryTotalsApplied === true ||
                source.complimentaryAdjustmentPhase === 'financial_applied_v1' ||
                source.complimentaryFinancialAdjustmentVersion === 'SERVICE_COMP_FINANCIAL_V1');
    }

    function nfRawLineItems(job) {
        const source = job || {};
        try {
            if (typeof window.thServiceLineItemsFromRecord === 'function') {
                const rows = window.thServiceLineItemsFromRecord(source);
                if (Array.isArray(rows) && rows.length) return rows;
            }
        } catch(e) {}
        const sources = [
            source.serviceLineItems,
            source.checkoutReviewItems,
            source.consultationTicketItems,
            source.quickEditV4Items
        ];
        for (const rows of sources) {
            if (Array.isArray(rows) && rows.length) return rows;
        }
        return [];
    }

    function nfOriginalTotals(job) {
        return (job && typeof job.complimentaryOriginalTotals === 'object' && job.complimentaryOriginalTotals)
            ? job.complimentaryOriginalTotals
            : {};
    }

    function nfOriginalServiceTotal(job, warnings) {
        const original = nfOriginalTotals(job);
        const value = nfFirstNumber(original, [
            'taxableSubtotal',
            'bookedPrice',
            'serviceTotal',
            'memberServiceSubtotal',
            'memberServiceTotal'
        ], null);
        if (value !== null) {
            nfPushWarning(warnings, 'gross-derived-from-original-snapshot');
            return value;
        }
        return null;
    }

    function nfCurrentServiceSubtotal(job, taxTotal, payableTotal, warnings) {
        const direct = nfFirstNumber(job, [
            'taxableSubtotal',
            'complimentaryNetTaxableSubtotal',
            'serviceTotal',
            'bookedPrice',
            'memberServiceSubtotal',
            'memberServiceTotal'
        ], null);
        if (direct !== null) return direct;
        if (payableTotal !== null) {
            nfPushWarning(warnings, 'taxable-subtotal-inferred');
            return Math.max(0, payableTotal - (taxTotal || 0));
        }
        nfPushWarning(warnings, 'taxable-subtotal-missing');
        return 0;
    }

    function nfPaymentSplitsTotal(job) {
        const rows = Array.isArray(job?.paymentSplits) ? job.paymentSplits : [];
        if (!rows.length) return null;
        const total = rows.reduce((sum, row) => sum + nfNumber(row && row.amount, 0), 0);
        return total > 0 ? total : null;
    }

    function nfGiftRedemptionsTotal(job) {
        const rows = Array.isArray(job?.giftCardRedemptions) ? job.giftCardRedemptions : [];
        if (!rows.length) return null;
        const total = rows.reduce((sum, row) => sum + nfNumber(row && (row.appliedAmount ?? row.amount), 0), 0);
        return total > 0 ? total : null;
    }

    function nfPaidAmount(job, payableTotal, netRevenue, taxTotal, warnings) {
        const splitTotal = nfFirstNumber(job, ['paymentSplitTotal'], null);
        if (splitTotal !== null) return splitTotal;
        const splits = nfPaymentSplitsTotal(job);
        if (splits !== null) return splits;
        const explicit = nfFirstNumber(job, ['paidAmount', 'amountPaid', 'paymentAmount', 'totalPaid'], null);
        if (explicit !== null) return explicit;
        const giftTotal = nfGiftRedemptionsTotal(job);
        const topUp = nfFirstNumber(job, ['topUpAmount', 'paymentTopUpAmount'], null);
        if (giftTotal !== null && topUp !== null) return giftTotal + topUp;
        if (payableTotal !== null) {
            nfPushWarning(warnings, 'paid-amount-inferred-from-payable-total');
            return payableTotal;
        }
        nfPushWarning(warnings, 'paid-amount-inferred-from-net-plus-tax');
        return Math.max(0, (netRevenue || 0) + (taxTotal || 0));
    }

    function nfLineSummary(job, warnings) {
        const rows = nfRawLineItems(job);
        if (!rows.length) {
            nfPushWarning(warnings, 'no-service-line-items-used-fallback');
            return null;
        }

        let gross = 0;
        let net = 0;
        let comp = 0;
        let financialLines = 0;
        let markerOnlyLines = 0;
        let originalSource = 'serviceLineItems';

        rows.forEach(row => {
            const payable = Math.max(0, nfLinePayable(row));
            if (nfIsFinancialComplimentaryLine(row)) {
                financialLines += 1;
                const original = Math.max(payable, nfLineOriginal(row, payable));
                const explicitComp = nfNumber(row?.complimentaryValue, null);
                const derivedComp = Math.max(0, original - payable);
                const waived = explicitComp !== null && explicitComp > 0 ? explicitComp : derivedComp;
                gross += Math.max(original, payable + waived);
                net += payable;
                comp += waived;
                if (row?.originalLineTotal !== undefined || row?.originalUnitPrice !== undefined) {
                    originalSource = 'serviceLineItems.originalLineTotal';
                }
            } else {
                if (nfIsMarkerOnlyLine(row)) markerOnlyLines += 1;
                gross += payable;
                net += payable;
            }
        });

        if (markerOnlyLines) nfPushWarning(warnings, 'marker-only-complimentary-not-financial');

        return {
            gross,
            net,
            comp,
            financialLines,
            markerOnlyLines,
            originalSource
        };
    }

    window.normalizeComplimentaryFinancials = function normalizeComplimentaryFinancials(job, options = {}) {
        const warnings = [];
        const source = job || {};
        const commissionOnComplimentaryServices = options.commissionOnComplimentaryServices === true;
        if (!job || typeof job !== 'object') nfPushWarning(warnings, 'missing-job');

        let taxTotal = nfTaxTotal(source, warnings);
        const payableTotal = nfFirstNumber(source, [
            'amountDue',
            'finalTotal',
            'totalGHC',
            'grandTotal',
            'groupCheckoutAmount',
            'memberServiceTotal'
        ], null);
        const isGroup = nfIsGroupJob(source);
        const jobHasComplimentary = source.hasComplimentaryAdjustment === true ||
            source.complimentaryTotalsApplied === true ||
            !!source.complimentaryStatus ||
            !!source.complimentaryApprovalAuditId;

        if (isGroup) {
            if (jobHasComplimentary) nfPushWarning(warnings, 'group-complimentary-not-normalized');
            const groupRevenue = nfFirstNumber(source, [
                'groupCheckoutAmount',
                'amountDue',
                'totalGHC',
                'finalTotal',
                'grandTotal',
                'bookedPrice',
                'memberServiceTotal'
            ], 0);
            const paidAmount = nfPaidAmount(source, groupRevenue, groupRevenue, taxTotal, warnings);
            return {
                grossServiceValue: nfRound(groupRevenue),
                complimentaryValue: 0,
                netRevenue: nfRound(groupRevenue),
                taxableSubtotal: nfRound(nfCurrentServiceSubtotal(source, taxTotal, groupRevenue, warnings)),
                taxTotal: nfRound(taxTotal),
                paidAmount: nfRound(paidAmount),
                commissionableRevenue: nfRound(groupRevenue),
                hasComplimentaryAdjustment: jobHasComplimentary,
                isFullyComplimentary: false,
                isMixedComplimentary: false,
                commissionOnComplimentaryServices,
                originalTotalsSource: 'group-existing-behavior',
                warnings
            };
        }

        const lineSummary = nfLineSummary(source, warnings);
        const financialJob = nfIsFinancialComplimentaryJob(source);
        let grossServiceValue = lineSummary ? lineSummary.gross : 0;
        let netRevenue = lineSummary ? lineSummary.net : nfCurrentServiceSubtotal(source, taxTotal, payableTotal, warnings);
        let complimentaryValue = lineSummary ? lineSummary.comp : 0;
        let originalTotalsSource = lineSummary ? lineSummary.originalSource : 'current-fields';

        const lineItemsProveFullyComplimentary = !!(lineSummary &&
            financialJob &&
            lineSummary.financialLines > 0 &&
            lineSummary.comp > 0 &&
            lineSummary.net <= 0.009 &&
            (payableTotal === null || payableTotal <= 0.009));
        const explicitTaxable = nfFirstNumber(source, ['taxableSubtotal', 'complimentaryNetTaxableSubtotal'], null);
        if (explicitTaxable !== null && !lineSummary) {
            netRevenue = explicitTaxable;
        } else if (explicitTaxable !== null && lineItemsProveFullyComplimentary && explicitTaxable > 0.009) {
            nfPushWarning(warnings, 'stale-taxable-subtotal-ignored-for-fully-complimentary');
        }

        if (financialJob) {
            const originalService = nfOriginalServiceTotal(source, warnings);
            if (originalService !== null && originalService > grossServiceValue) {
                grossServiceValue = originalService;
                originalTotalsSource = 'complimentaryOriginalTotals';
            }
            const jobComp = nfFirstNumber(source, ['complimentaryValue'], null);
            if (jobComp !== null && jobComp > complimentaryValue) complimentaryValue = jobComp;
            if (complimentaryValue <= 0 && grossServiceValue > netRevenue) {
                complimentaryValue = Math.max(0, grossServiceValue - netRevenue);
            }
        }

        if (!lineSummary && grossServiceValue <= 0) {
            grossServiceValue = netRevenue;
        }

        grossServiceValue = Math.max(0, grossServiceValue);
        netRevenue = Math.max(0, netRevenue);
        complimentaryValue = Math.max(0, Math.min(complimentaryValue, Math.max(grossServiceValue, complimentaryValue)));

        const hasComplimentaryAdjustment = jobHasComplimentary || complimentaryValue > 0 || !!(lineSummary && lineSummary.financialLines > 0);
        const isFullyComplimentary = hasComplimentaryAdjustment && complimentaryValue > 0 && netRevenue <= 0.009;
        const isMixedComplimentary = hasComplimentaryAdjustment && complimentaryValue > 0 && netRevenue > 0.009;
        if (isFullyComplimentary && lineItemsProveFullyComplimentary && taxTotal > 0.009) {
            nfPushWarning(warnings, 'stale-tax-total-ignored-for-fully-complimentary');
            taxTotal = 0;
        }
        const paidAmount = nfPaidAmount(source, payableTotal, netRevenue, taxTotal, warnings);
        const commissionableRevenue = commissionOnComplimentaryServices
            ? netRevenue + complimentaryValue
            : netRevenue;

        return {
            grossServiceValue: nfRound(grossServiceValue),
            complimentaryValue: nfRound(complimentaryValue),
            netRevenue: nfRound(netRevenue),
            taxableSubtotal: nfRound(netRevenue),
            taxTotal: nfRound(taxTotal),
            paidAmount: nfRound(paidAmount),
            commissionableRevenue: nfRound(commissionableRevenue),
            hasComplimentaryAdjustment,
            isFullyComplimentary,
            isMixedComplimentary,
            commissionOnComplimentaryServices,
            originalTotalsSource,
            warnings
        };
    };
})();

    function num(v) {
        const n = Number(parseFloat(v || 0));
        return Number.isFinite(n) ? n : 0;
    }

    function money(v) { return num(v).toFixed(2); }

    function firstNumber(source, keys, fallback = null) {
        const row = source || {};
        for (const key of keys) {
            const value = row[key];
            if (value !== undefined && value !== null && value !== "") {
                const parsed = num(value);
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        return fallback;
    }


    function roleText(roleKey, customName) {
        if (roleKey === "tech") return "Technician";
        if (roleKey === "foh") return "Front of House";
        if (roleKey === "manager") return "Manager";
        return customName || "Custom Role";
    }


    function isClosedJob(row) {
        return String(row.status || "").trim().toLowerCase() === "closed";
    }

    function isGroup(row) {
        return row?.isGroupBooking === true || !!row?.groupId;
    }

    function isLead(row) {
        return row?.isLeadBooker === true ||
               row?.groupRole === "lead" ||
               row?.payableBy === "lead_booker" ||
               row?.payableBy === "lead_booker_final_bill";
    }

    function billingMode(row) {
        return row.billingMode || row.groupCheckoutType || row.billingScenario || "";
    }

    function commissionOnComplimentaryServices() {
        return false;
    }

    function fallbackCommissionFinancials(row) {
        const netRevenue = firstNumber(row, [
            "groupCheckoutAmount",
            "amountDue",
            "totalGHC",
            "grandTotal",
            "finalTotal",
            "bookedPrice",
            "price"
        ], 0);

        return {
            grossServiceValue: netRevenue,
            complimentaryValue: 0,
            netRevenue,
            taxableSubtotal: firstNumber(row, ["taxableSubtotal", "bookedPrice", "price"], netRevenue),
            taxTotal: firstNumber(row, ["taxTotal", "totalTax", "taxAmount"], 0),
            paidAmount: firstNumber(row, ["paidAmount", "amountPaid", "paymentAmount", "totalPaid"], netRevenue),
            commissionableRevenue: netRevenue,
            hasComplimentaryAdjustment: false,
            isFullyComplimentary: false,
            isMixedComplimentary: false,
            commissionOnComplimentaryServices: commissionOnComplimentaryServices(),
            originalTotalsSource: "commissions-v1-fallback",
            warnings: ["normalizer-unavailable"]
        };
    }

    function commissionFinancials(job) {
        let out = null;
        if (typeof window.normalizeComplimentaryFinancials === "function") {
            try {
                out = window.normalizeComplimentaryFinancials(job || {}, {
                    commissionOnComplimentaryServices: commissionOnComplimentaryServices()
                });
            } catch(e) {
                console.warn("Commissions financial normalizer fallback", e);
            }
        }

        if (!out || typeof out !== "object") out = fallbackCommissionFinancials(job || {});

        return {
            grossServiceValue: num(out.grossServiceValue),
            complimentaryValue: num(out.complimentaryValue),
            netRevenue: num(out.netRevenue),
            taxableSubtotal: num(out.taxableSubtotal),
            taxTotal: num(out.taxTotal),
            paidAmount: num(out.paidAmount),
            commissionableRevenue: num(out.commissionableRevenue),
            hasComplimentaryAdjustment: out.hasComplimentaryAdjustment === true,
            isFullyComplimentary: out.isFullyComplimentary === true,
            isMixedComplimentary: out.isMixedComplimentary === true,
            commissionOnComplimentaryServices: out.commissionOnComplimentaryServices === true,
            originalTotalsSource: out.originalTotalsSource || "",
            warnings: Array.isArray(out.warnings) ? out.warnings : []
        };
    }

    function revenue(row) {
        return commissionFinancials(row).commissionableRevenue;
    }

    function addonRevenue(row) {
        let total = num(row.upsellTotal || row.addOnTotal || row.addonsTotal || row.addOnsTotal || 0);
        if (total > 0) return total;
        const arr = row.pendingUpsells || row.upsells || row.addOns || row.addons || [];
        if (Array.isArray(arr)) return arr.reduce((sum, x) => sum + num(x.price || x.amount || x.total || 0), 0);
        return 0;
    }

    function revenueKey(row) {
        const mode = billingMode(row);
        const gid = row.groupId || "";
        const sg = row.subGroupIndex || 1;

        if (!isGroup(row)) return `solo:${row._source}:${row.id}`;

        if (
            mode === "lead_pays_all" ||
            mode === "lead_pays_all_after_last" ||
            mode === "group_lead_all" ||
            mode === "group_lead_final"
        ) return `group:${gid}:lead-final`;

        if (mode === "subgroup_pays_separately" || mode === "subgroup") {
            return `group:${gid}:subgroup:${sg}`;
        }

        return `group:${gid}:member:${row.id}`;
    }

    function shouldCountRevenue(row, seen) {
        if (!isGroup(row)) return true;

        const mode = billingMode(row);
        const key = revenueKey(row);

        if (
            mode === "lead_pays_all" ||
            mode === "lead_pays_all_after_last" ||
            mode === "group_lead_all" ||
            mode === "group_lead_final"
        ) {
            if (seen.has(key)) return false;
            if (!(isLead(row) || row.groupCheckoutAmount || row.groupCheckoutType)) return false;
            seen.add(key);
            return true;
        }

        if (mode === "subgroup_pays_separately" || mode === "subgroup") {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }

        return true;
    }

    function valueForRule(job, rule) {
        const appliesTo = rule.appliesTo || "serviceRevenue";
        if (appliesTo === "upsells") return addonRevenue(job);
        if (appliesTo === "closedJobs") return 1;
        return commissionFinancials(job).commissionableRevenue;
    }

    function calculateCommission(value, rule) {
        const type = rule.commissionType || "percentage";
        const pct = num(rule.percentage);
        const fixed = num(rule.fixedAmount);

        if (type === "percentage") return value * (pct / 100);
        if (type === "fixed") return fixed;
        if (type === "hybrid") return (value * (pct / 100)) + fixed;
        return 0; // tiered handled later
    }

    function getStaffForRole(job, roleKey, roleName) {
        if (roleKey === "tech") {
            return {
                email: String(job.assignedTechEmail || job.techEmail || "unassigned-tech").toLowerCase(),
                name: job.assignedTechName || job.techName || job.technicianName || "Unassigned Technician"
            };
        }
        if (roleKey === "foh") {
            return {
                email: String(job.fohEmail || job.checkedInByEmail || job.createdByEmail || job.createdBy || job.staffEmail || "foh-pool").toLowerCase(),
                name: job.fohName || job.checkedInByName || job.createdByName || "FOH Pool"
            };
        }
        if (roleKey === "manager") {
            return {
                email: String(job.managerEmail || "manager-pool").toLowerCase(),
                name: job.managerName || "Manager Pool"
            };
        }
        return {
            email: `${String(roleName || "custom").toLowerCase().replace(/\s+/g, "-")}-pool`,
            name: roleName || "Custom Role Pool"
        };
    }


    function calculateRows(jobs, rules) {
        const out = [];
        const revenueSeen = new Set();

        jobs.forEach(job => {
            const fin = commissionFinancials(job);
            const countRevenue = shouldCountRevenue(job, revenueSeen);
            const baseRevenue = countRevenue ? fin.commissionableRevenue : 0;

            rules.forEach(rule => {
                const roleName = roleText(rule.roleKey, rule.customRoleName);
                const staff = getStaffForRole(job, rule.roleKey, roleName);

                let baseValue = valueForRule(job, rule);
                if ((rule.appliesTo === "serviceRevenue" || rule.appliesTo === "totalBill") && !countRevenue) {
                    baseValue = 0;
                }

                if (num(rule.minRevenue) > 0 && baseValue < num(rule.minRevenue)) return;

                const commissionAmount = calculateCommission(baseValue, rule);

                out.push({
                    dateString: job.dateString || "",
                    timeString: job.timeString || "",
                    jobId: job.id || "",
                    source: job._source || "",
                    clientName: job.clientName || job.name || "",
                    service: job.bookedService || job.serviceName || "",
                    roleKey: rule.roleKey || "",
                    roleName,
                    staffEmail: staff.email,
                    staffName: staff.name,
                    ruleId: rule.id || "",
                    commissionType: rule.commissionType || "",
                    appliesTo: rule.appliesTo || "",
                    baseRevenue,
                    baseValue,
                    grossServiceValue: countRevenue ? fin.grossServiceValue : 0,
                    complimentaryValue: countRevenue ? fin.complimentaryValue : 0,
                    netRevenue: countRevenue ? fin.netRevenue : 0,
                    commissionableRevenue: countRevenue ? fin.commissionableRevenue : 0,
                    commissionOnComplimentaryServices: fin.commissionOnComplimentaryServices === true,
                    commissionAmount,
                    status: "estimated"
                });
            });
        });

        return out;
    }


function calculateWithMenu(jobs, rules, menu) {
    window.allMenuServicesCache = menu;
    try { return calculateRows(jobs, rules); }
    finally { window.allMenuServicesCache = []; }
}
module.exports = { calculateRows, calculateWithMenu, commissionFinancials, getStaffForRole, roleText };

// LEGACY_EXTRACTION_END
