"use strict";

function snapNum(value, fallback = 0) {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function snapInt(value, fallback = 0) {
  const n = parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function firstPresent(source, keys, fallback = "") {
  source = source || {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") return value;
  }
  return fallback;
}

function normalizeTaxPricingModeValue(value) {
  const raw = String(value ?? "").trim();
  if (!raw) return "";
  const key = raw.toLowerCase().replace(/[\s_-]+/g, "");
  if (key === "inclusive" || key === "taxinclusive" || key === "vatinclusive") return "inclusive";
  if (key === "exclusive" || key === "taxexclusive" || key === "vatexclusive") return "exclusive";
  return "";
}

function roundMoney(value) {
  const n = snapNum(value, 0);
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

function canonicalQty(row) {
  const qty = snapInt(firstPresent(row || {}, ["quantity", "qty", "count"], 1), 1);
  return qty > 0 ? qty : 1;
}

function canonicalUnitPrice(row) {
  const direct = firstPresent(row || {}, ["unitPrice", "unitPriceAtBooking", "price", "basePrice", "amount"], "");
  if (direct !== "") return snapNum(direct, 0);
  const qty = canonicalQty(row);
  const line = firstPresent(row || {}, ["lineTotal", "totalPrice", "payableLineTotal"], 0);
  return qty > 0 ? snapNum(line, 0) / qty : 0;
}

function canonicalLineGross(row) {
  const direct = firstPresent(row || {}, ["lineTotal", "totalPrice", "payableLineTotal"], "");
  if (direct !== "") return snapNum(direct, 0);
  return canonicalUnitPrice(row) * canonicalQty(row);
}

function normalizeCanonicalTaxRates(taxRates) {
  return (Array.isArray(taxRates) ? taxRates : []).map((rate, index) => {
    const source = typeof rate === "number" ? { rate } : (rate || {});
    const normalizedRate = snapNum(firstPresent(source, ["rate", "taxRate", "percentage", "percent"], 0), 0);
    return {
      name: String(firstPresent(source, ["name", "label", "taxName"], index === 0 ? "Tax" : `Tax ${index + 1}`) || "Tax"),
      rate: normalizedRate > 0 ? normalizedRate : 0
    };
  }).filter(rate => rate.rate > 0);
}

function normalizeCanonicalAdjustmentList(adjustments) {
  if (!adjustments) return [];
  const rows = Array.isArray(adjustments) ? adjustments : [adjustments];
  return rows.map((row, index) => {
    const source = row || {};
    const type = String(firstPresent(source, ["type", "kind", "name"], `adjustment_${index + 1}`) || `adjustment_${index + 1}`);
    const rawAmount = firstPresent(source, ["amount", "value", "discountAmount", "complimentaryValue", "manualAdjustment"], 0);
    const amount = Math.max(0, snapNum(rawAmount, 0));
    return {
      type,
      amount,
      source
    };
  }).filter(row => row.amount > 0);
}

function allocateRounded(total, weights) {
  const roundedTotal = roundMoney(total);
  const safeWeights = (Array.isArray(weights) ? weights : []).map(weight => Math.max(0, snapNum(weight, 0)));
  const weightTotal = safeWeights.reduce((sum, weight) => sum + weight, 0);
  let allocated = 0;
  return safeWeights.map((weight, index) => {
    if (index === safeWeights.length - 1) return roundMoney(roundedTotal - allocated);
    const value = weightTotal > 0 ? roundMoney((weight / weightTotal) * roundedTotal) : 0;
    allocated = roundMoney(allocated + value);
    return value;
  });
}

function normalizeCanonicalServiceRows(serviceLineItems, pricingMode, rowTaxAllocations) {
  const rows = Array.isArray(serviceLineItems) ? serviceLineItems : [];
  return rows.map((row, index) => {
    const source = row || {};
    const quantity = canonicalQty(source);
    const unitPrice = roundMoney(canonicalUnitPrice(source));
    const gross = roundMoney(canonicalLineGross(source));
    const taxAmount = roundMoney((rowTaxAllocations || [])[index] || 0);
    const lineSubtotal = pricingMode === "inclusive"
      ? roundMoney(gross - taxAmount)
      : gross;
    const lineTotal = gross;
    return {
      ...source,
      menuItemId: String(firstPresent(source, ["menuItemId", "id", "docId", "serviceId"], "") || ""),
      serviceId: String(firstPresent(source, ["serviceId", "id", "menuItemId", "docId"], firstPresent(source, ["menuItemId"], "")) || ""),
      name: String(firstPresent(source, ["name", "serviceName", "label", "service"], "") || ""),
      serviceName: String(firstPresent(source, ["serviceName", "name", "label", "service"], "") || ""),
      quantity,
      qty: quantity,
      unitPrice,
      unitPriceAtBooking: unitPrice,
      durationAtBooking: snapInt(firstPresent(source, ["durationAtBooking", "duration", "minutes", "durationMins"], 0), 0),
      department: String(firstPresent(source, ["department", "appliesTo", "dept"], "") || ""),
      priceMode: pricingMode,
      lineSubtotal,
      taxAmount,
      lineTotal,
      snapshotSource: String(firstPresent(source, ["snapshotSource", "source"], "canonical_financial_builder") || "canonical_financial_builder")
    };
  });
}

// Round each inclusive component independently; only net receives the balancing residual.
function inclusiveComponentAmounts(grossLines, taxRates, ids = []) {
    function fraction(value) {
        const text = String(value);
        const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
        if (!match) throw new Error('TAX_MONEY_INVALID');
        const scale = (match[2] || '').length - Number(match[3] || 0);
        const n = BigInt(match[1] + (match[2] || ''));
        return scale < 0 ? { n: n * 10n ** BigInt(-scale), d: 1n } : { n, d: 10n ** BigInt(scale) };
    }
    const halfUp = (n, d) => n / d + ((n % d) * 2n >= d ? 1n : 0n);
    function safe(n) {
        if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('TAX_MONEY_OUT_OF_RANGE');
        return Number(n);
    }
    const gross = grossLines.map(value => { const f = fraction(value); return halfUp(f.n * 100n, f.d); });
    const rates = taxRates.map(row => fraction(row.rate));
    const scale = rates.reduce((s, r) => s * r.d, 1n);
    const weights = rates.map(r => r.n * (scale / r.d));
    const denominator = 100n * scale + weights.reduce((s, n) => s + n, 0n);
    const lineTax = gross.map(() => 0n);
    const components = weights.map(weight => {
        const rows = gross.map((g, index) => ({
            index, id: String(ids[index] ?? index), numerator: g * weight,
            amount: g * weight / denominator, remainder: g * weight % denominator
        }));
        const target = halfUp(rows.reduce((s, r) => s + r.numerator, 0n), denominator);
        let left = target - rows.reduce((s, r) => s + r.amount, 0n);
        rows.sort((a, b) => a.remainder === b.remainder
            ? (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index)
            : a.remainder > b.remainder ? -1 : 1);
        for (const row of rows) {
            if (left > 0n) { row.amount++; left--; }
            lineTax[row.index] += row.amount;
        }
        if (left !== 0n) throw new Error('TAX_ALLOCATION_UNREPRESENTABLE');
        return target;
    });
    if (lineTax.some((n, i) => n > gross[i])) throw new Error('TAX_ALLOCATION_UNREPRESENTABLE');
    const grossMinor = gross.reduce((s, n) => s + n, 0n);
    const taxMinor = components.reduce((s, n) => s + n, 0n);
    return {
        gross: safe(grossMinor) / 100, net: safe(grossMinor - taxMinor) / 100,
        taxTotal: safe(taxMinor) / 100, components: components.map(n => safe(n) / 100),
        lineTax: lineTax.map(n => safe(n) / 100)
    };
}

function buildCanonicalFinancialShape(options = {}) {
  const requestedMode = normalizeTaxPricingModeValue(options.pricingMode || options.taxPricingMode);
  const pricingMode = requestedMode || "inclusive";
  const sourceRows = Array.isArray(options.serviceLineItems) ? options.serviceLineItems : [];
  const lineGrossValues = sourceRows.map(canonicalLineGross).map(roundMoney);
  const grossMenuTotal = roundMoney(lineGrossValues.reduce((sum, value) => sum + value, 0));
  const taxRates = normalizeCanonicalTaxRates(options.taxRates);
  const totalTaxRate = taxRates.reduce((sum, row) => sum + row.rate, 0);
  const inclusive = pricingMode === "inclusive" && options.legacyNetFirst !== true
    ? inclusiveComponentAmounts(lineGrossValues, taxRates, sourceRows.map((row, i) => row.taxLineId || row.lineId || row.menuItemId || row.serviceId || row.id || String(i)))
    : null;
  const serviceSubtotal = inclusive ? inclusive.net : pricingMode === "inclusive" && totalTaxRate > 0
    ? roundMoney(grossMenuTotal / (1 + (totalTaxRate / 100)))
    : grossMenuTotal;
  const preAdjustmentGrandTotal = pricingMode === "inclusive"
    ? grossMenuTotal
    : roundMoney(serviceSubtotal + (serviceSubtotal * totalTaxRate / 100));
  const taxTotal = inclusive ? inclusive.taxTotal : roundMoney(preAdjustmentGrandTotal - serviceSubtotal);
  const taxAllocations = inclusive ? inclusive.components : allocateRounded(taxTotal, taxRates.map(row => row.rate));
  const taxBreakdown = taxRates.map((row, index) => ({
    name: row.name,
    rate: row.rate,
    amount: taxAllocations[index] || 0,
    pricingMode
  }));
  const rowTaxAllocations = inclusive ? inclusive.lineTax : allocateRounded(taxTotal, lineGrossValues);
  const serviceLineItems = normalizeCanonicalServiceRows(sourceRows, pricingMode, rowTaxAllocations);
  const bookedDuration = serviceLineItems.reduce((sum, row) => sum + (snapInt(row.durationAtBooking, 0) * canonicalQty(row)), 0);
  const bookedService = serviceLineItems.map(row => {
    const name = row.serviceName || row.name || "Service";
    return row.quantity > 1 ? `${name} (x${row.quantity})` : name;
  }).join(", ");
  const adjustmentRows = normalizeCanonicalAdjustmentList(options.adjustments);
  const adjustmentTotal = roundMoney(adjustmentRows.reduce((sum, row) => sum + row.amount, 0));
  const finalTotal = roundMoney(Math.max(0, preAdjustmentGrandTotal - adjustmentTotal));
  const compatibility = options.compatibility || {};
  const amountDue = roundMoney(firstPresent(compatibility, ["amountDue"], finalTotal));
  const output = {
    serviceLineItems,
    bookedService,
    bookedDuration,
    bookedPrice: serviceSubtotal,
    serviceSubtotal,
    taxableSubtotal: serviceSubtotal,
    taxBreakdown,
    taxTotal,
    grandTotal: preAdjustmentGrandTotal,
    finalTotal,
    amountDue,
    totalGHC: amountDue,
    pricingMode,
    taxPricingMode: pricingMode
  };
  if (compatibility.includeMemberTotals === true || compatibility.memberServiceTotal !== undefined) {
    output.memberServiceTotal = roundMoney(firstPresent(compatibility, ["memberServiceTotal"], preAdjustmentGrandTotal));
  }
  if (compatibility.includePayableShare === true || compatibility.payableShare !== undefined) {
    output.payableShare = roundMoney(firstPresent(compatibility, ["payableShare"], amountDue));
  }
  if (adjustmentRows.length) {
    output.adjustments = adjustmentRows.map(row => ({
      type: row.type,
      amount: row.amount
    }));
    output.adjustmentTotal = adjustmentTotal;
  }
  return output;
}

module.exports = {
  buildCanonicalFinancialShape,
  normalizeTaxPricingModeValue,
  _internals: {
    snapNum,
    snapInt,
    firstPresent,
    roundMoney,
    canonicalQty,
    canonicalUnitPrice,
    canonicalLineGross,
    normalizeCanonicalTaxRates,
    normalizeCanonicalAdjustmentList,
    allocateRounded,
    normalizeCanonicalServiceRows
  }
};
