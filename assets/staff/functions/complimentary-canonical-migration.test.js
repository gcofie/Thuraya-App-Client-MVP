"use strict";

const assert = require("node:assert/strict");
const { buildCanonicalFinancialShape } = require("./canonical-financial-core");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeNumber(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function parseTaxRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function taxRatesFromJob(job) {
  return parseTaxRows(job && job.taxBreakdown)
    .map((row) => ({
      name: String(row && row.name || "Tax").trim() || "Tax",
      rate: safeNumber(row && row.rate, 0)
    }))
    .filter((row) => row.rate > 0);
}

function inferTaxPricingMode(job, rates) {
  const explicit = String(job && (job.taxPricingMode || job.pricingMode) || "").trim().toLowerCase();
  if (explicit === "exclusive" || explicit === "inclusive") return explicit;

  const taxableSubtotal = safeNumber(job && (job.taxableSubtotal ?? job.bookedPrice), 0);
  const finalTotal = safeNumber(job && (job.amountDue ?? job.finalTotal ?? job.grandTotal ?? job.totalGHC), 0);
  const storedTaxTotal = safeNumber(
    job && job.taxTotal,
    parseTaxRows(job && job.taxBreakdown).reduce((sum, row) => sum + safeNumber(row && row.amount, 0), 0)
  );
  if (rates.length && storedTaxTotal > 0 && Math.abs(finalTotal - (taxableSubtotal + storedTaxTotal)) <= 0.05) {
    return "exclusive";
  }
  return "inclusive";
}

function serviceQty(item) {
  const q = Number.parseInt(item && (item.qty || item.quantity) || "1", 10);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function serviceUnitPrice(item) {
  const explicit = item && (item.price ?? item.unitPrice ?? item.amount);
  if (explicit !== undefined && explicit !== null && explicit !== "") return safeNumber(explicit, 0);
  const qty = serviceQty(item);
  return safeNumber(item && item.lineTotal, 0) / qty;
}

function serviceLineTotal(item) {
  const qty = serviceQty(item);
  return safeNumber(item && item.lineTotal, serviceUnitPrice(item) * qty);
}

function isFinancialAppliedComplimentaryLine(item) {
  return !!(
    item &&
    String(item.complimentaryStatus || "").trim().toLowerCase() === "financial_applied" &&
    (
      item.isComplimentary === true ||
      item.complimentaryTotalsApplied === true ||
      item.complimentaryValue !== undefined ||
      item.approvalAuditId ||
      item.complimentaryApprovalAuditId
    )
  );
}

function lineComplimentaryValue(item) {
  if (!isFinancialAppliedComplimentaryLine(item)) return 0;
  const fallback = safeNumber(item.originalLineTotal, serviceLineTotal(item));
  if (item.complimentaryValue === undefined || item.complimentaryValue === null || item.complimentaryValue === "") {
    return fallback;
  }
  return safeNumber(item.complimentaryValue, fallback);
}

function migratedTotals(job, serviceLineItems) {
  const rates = taxRatesFromJob(job);
  const pricingMode = inferTaxPricingMode(job, rates);
  const canonical = buildCanonicalFinancialShape({
    serviceLineItems: Array.isArray(serviceLineItems) ? serviceLineItems : [],
    pricingMode,
    taxRates: rates,
    compatibility: { includeMemberTotals: true }
  });
  const payableMenuTotal = canonical.serviceLineItems
    .reduce((sum, item) => sum + serviceLineTotal(item || {}), 0);

  return {
    serviceLineItems: canonical.serviceLineItems,
    payableMenuTotal,
    taxableSubtotal: canonical.taxableSubtotal,
    taxRows: canonical.taxBreakdown,
    taxTotal: canonical.taxTotal,
    grandTotal: canonical.grandTotal,
    pricingMode: canonical.pricingMode,
    memberServiceTotal: canonical.memberServiceTotal ?? canonical.grandTotal
  };
}

function buildWritePayload(job, updatedItems) {
  const totals = migratedTotals(job, updatedItems);
  const totalComplimentaryValue = totals.serviceLineItems
    .reduce((sum, item) => sum + lineComplimentaryValue(item || {}), 0);
  return {
    serviceLineItems: totals.serviceLineItems,
    complimentaryNetMenuTotal: totals.payableMenuTotal,
    complimentaryNetTaxableSubtotal: totals.taxableSubtotal,
    complimentaryNetTaxTotal: totals.taxTotal,
    complimentaryNetTotal: totals.grandTotal,
    complimentaryTaxPricingMode: totals.pricingMode,
    complimentaryValue: totalComplimentaryValue,
    bookedPrice: totals.taxableSubtotal,
    taxableSubtotal: totals.taxableSubtotal,
    taxBreakdown: JSON.stringify(totals.taxRows),
    taxTotal: totals.taxTotal,
    taxPricingMode: totals.pricingMode,
    pricingMode: totals.pricingMode,
    grandTotal: totals.grandTotal,
    finalTotal: totals.grandTotal,
    amountDue: totals.grandTotal,
    totalGHC: totals.grandTotal,
    memberServiceTotal: totals.memberServiceTotal
  };
}

function complimentaryLine(row, version = "SERVICE_COMP_FINANCIAL_V2") {
  const originalLineTotal = safeNumber(row.originalLineTotal ?? row.lineTotal, serviceLineTotal(row));
  return {
    ...row,
    isComplimentary: true,
    complimentaryStatus: "financial_applied",
    complimentaryTotalsApplied: true,
    complimentaryValue: row.complimentaryValue ?? originalLineTotal,
    originalUnitPrice: row.originalUnitPrice ?? row.unitPrice ?? row.price ?? row.amount ?? 0,
    originalLineTotal,
    originalQty: row.originalQty ?? serviceQty(row),
    complimentaryAdjustmentVersion: version,
    unitPrice: 0,
    price: 0,
    amount: 0,
    lineTotal: 0,
    payableLineTotal: 0
  };
}

function assertMigratedPayload(name, job, updatedItems) {
  const inputBefore = JSON.stringify(updatedItems);
  const payload = buildWritePayload(job, updatedItems);
  const repeatPayload = buildWritePayload(job, updatedItems);
  const canonical = buildCanonicalFinancialShape({
    serviceLineItems: updatedItems,
    pricingMode: inferTaxPricingMode(job, taxRatesFromJob(job)),
    taxRates: taxRatesFromJob(job),
    compatibility: { includeMemberTotals: true }
  });

  assert.equal(JSON.stringify(updatedItems), inputBefore, `${name}: input serviceLineItems mutated`);
  assert.deepEqual(repeatPayload, payload, `${name}: calculation not deterministic across retry`);
  assert.deepEqual(payload.serviceLineItems, canonical.serviceLineItems, `${name}: serviceLineItems not canonical`);
  assert.equal(payload.bookedPrice, canonical.taxableSubtotal, `${name}: bookedPrice mismatch`);
  assert.equal(payload.taxableSubtotal, canonical.taxableSubtotal, `${name}: taxableSubtotal mismatch`);
  assert.deepEqual(JSON.parse(payload.taxBreakdown), canonical.taxBreakdown, `${name}: taxBreakdown mismatch`);
  assert.equal(payload.taxTotal, canonical.taxTotal, `${name}: taxTotal mismatch`);
  assert.equal(payload.grandTotal, canonical.grandTotal, `${name}: grandTotal mismatch`);
  assert.equal(payload.finalTotal, canonical.grandTotal, `${name}: finalTotal mismatch`);
  assert.equal(payload.amountDue, canonical.grandTotal, `${name}: amountDue mismatch`);
  assert.equal(payload.totalGHC, canonical.grandTotal, `${name}: totalGHC mismatch`);
  assert.equal(payload.memberServiceTotal, canonical.memberServiceTotal, `${name}: memberServiceTotal mismatch`);
  assert.equal(payload.pricingMode, canonical.pricingMode, `${name}: pricingMode mismatch`);
  assert.equal(payload.taxPricingMode, canonical.taxPricingMode, `${name}: taxPricingMode mismatch`);
  ["paymentMethod", "receiptNumber", "commissionAmount", "archiveBatchId", "timerStartedAt"].forEach((field) => {
    assert.equal(Object.prototype.hasOwnProperty.call(payload, field), false, `${name}: payload unexpectedly writes ${field}`);
  });
  return payload;
}

function run() {
  const taxBreakdown = JSON.stringify([
    { name: "VAT", rate: 12.5, amount: 0, pricingMode: "inclusive" },
    { name: "NHIL", rate: 2.5, amount: 0, pricingMode: "inclusive" },
    { name: "GETFund", rate: 2.5, amount: 0, pricingMode: "inclusive" }
  ]);
  const baseJob = {
    status: "In Progress",
    taxBreakdown,
    taxPricingMode: "inclusive",
    pricingMode: "inclusive",
    paymentMethod: "Cash",
    receiptNumber: "RCPT-KEEP",
    commissionAmount: 12.5,
    archiveBatchId: "ARCHIVE_KEEP",
    timerStartedAt: "KEEP"
  };
  const rows = [
    { menuItemId: "hand", serviceId: "hand", serviceName: "Hand Service", unitPrice: 150, lineTotal: 150, quantity: 1, durationAtBooking: 45, department: "Hands", unknownMeta: { keep: true } },
    { menuItemId: "foot", serviceId: "foot", serviceName: "Foot Service", unitPrice: 200.25, lineTotal: 200.25, quantity: 1, durationAtBooking: 35, department: "Feet" },
    { menuItemId: "zero", serviceId: "zero", serviceName: "Zero Service", unitPrice: 0, lineTotal: 0, quantity: 1, durationAtBooking: 10, department: "Other" }
  ];

  const scenarios = [
    ["single complimentary inclusive", baseJob, [complimentaryLine(rows[0], "SERVICE_COMP_FINANCIAL_V1"), rows[1], rows[2]]],
    ["multiple complimentary inclusive", baseJob, [complimentaryLine(rows[0]), complimentaryLine(rows[1]), rows[2]]],
    ["partial complimentary inclusive", baseJob, [rows[0], complimentaryLine(rows[1]), rows[2]]],
    ["full complimentary inclusive", baseJob, rows.map(row => complimentaryLine(row))],
    ["single complimentary exclusive", { ...baseJob, taxPricingMode: "exclusive", pricingMode: "exclusive" }, [complimentaryLine(rows[0]), rows[1], rows[2]]],
    ["missing taxBreakdown", { ...baseJob, taxBreakdown: "", taxPricingMode: "inclusive", pricingMode: "inclusive" }, [complimentaryLine(rows[0]), rows[1]]],
    ["mode inferred exclusive", { ...baseJob, taxPricingMode: "", pricingMode: "", taxableSubtotal: 350, taxTotal: 61.25, amountDue: 411.25 }, [complimentaryLine(rows[0]), rows[1]]],
    ["invalid numeric values", baseJob, [complimentaryLine({ serviceName: "Bad", unitPrice: "bad", quantity: -1, durationAtBooking: "bad", lineTotal: "bad" }), rows[2]]]
  ];

  const results = scenarios.map(([name, job, serviceLineItems]) => {
    const payload = assertMigratedPayload(name, clone(job), clone(serviceLineItems));
    return {
      name,
      pricingMode: payload.pricingMode,
      lineCount: payload.serviceLineItems.length,
      taxTotal: payload.taxTotal,
      grandTotal: payload.grandTotal,
      complimentaryValue: payload.complimentaryValue
    };
  });

  const metadataPayload = assertMigratedPayload("metadata preservation", clone(baseJob), [complimentaryLine(rows[0]), rows[1]]);
  assert.deepEqual(metadataPayload.serviceLineItems[0].unknownMeta, { keep: true }, "unknown service metadata not preserved");

  console.log(JSON.stringify({ ok: true, scenarioCount: results.length, results }, null, 2));
}

run();
