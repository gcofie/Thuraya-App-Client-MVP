"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { buildCanonicalFinancialShape } = require("./canonical-financial-core");

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function loadFrontendBuilder() {
  const appPath = path.join(__dirname, "..", "app.js");
  const source = fs.readFileSync(appPath, "utf8");
  const markerIndex = source.indexOf("window.__TH_SERVICE_SNAPSHOT_HELPERS_PHASE_1A__");
  assert.ok(markerIndex >= 0, "frontend service snapshot helper marker not found");
  const start = source.lastIndexOf("(function(){", markerIndex);
  const endToken = "})();";
  const end = source.indexOf(endToken, markerIndex);
  assert.ok(start >= 0, "frontend helper IIFE start not found");
  assert.ok(end >= 0, "frontend helper IIFE end not found");

  const sandbox = {
    window: {},
    console: {
      warn() {},
      log() {},
      error() {}
    }
  };
  sandbox.window.window = sandbox.window;
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end + endToken.length), sandbox, {
    filename: "app.js:service-snapshot-helper"
  });
  assert.equal(typeof sandbox.window.thBuildCanonicalFinancialShape, "function");
  return sandbox.window.thBuildCanonicalFinancialShape;
}

function assertParity(frontendBuilder, name, options) {
  const frontendInput = clone(options);
  const serverInput = clone(options);
  const frontendBefore = JSON.stringify(frontendInput);
  const serverBefore = JSON.stringify(serverInput);
  const frontend = clone(frontendBuilder(frontendInput));
  const server = clone(buildCanonicalFinancialShape(serverInput));

  assert.equal(JSON.stringify(frontendInput), frontendBefore, `${name}: frontend input mutated`);
  assert.equal(JSON.stringify(serverInput), serverBefore, `${name}: server input mutated`);
  assert.deepEqual(server, frontend, `${name}: server output diverged from frontend builder`);
  return server;
}

function run() {
  const frontendBuilder = loadFrontendBuilder();
  const taxRates = [{ name: "VAT", rate: 12.5 }, { name: "NHIL", rate: 2.5 }, { name: "GETFund", rate: 2.5 }];
  const single = [
    { menuItemId: "svc_100", serviceId: "svc_100", serviceName: "Service A", unitPrice: 100, quantity: 1, durationAtBooking: 45, department: "Hands" }
  ];
  const multiple = [
    { menuItemId: "svc_150", serviceId: "svc_150", serviceName: "Service A", unitPrice: 150, quantity: 1, durationAtBooking: 45, department: "Hands" },
    { menuItemId: "svc_200", serviceId: "svc_200", serviceName: "Service B", unitPrice: 200, quantity: 1, durationAtBooking: 35, department: "Feet" }
  ];
  const decimalPrices = [
    { id: "decimal_a", name: "Decimal A", unitPrice: "99.99", quantity: 2, durationAtBooking: "30" },
    { id: "decimal_b", name: "Decimal B", lineTotal: "12.35", quantity: 1, durationAtBooking: 15 }
  ];
  const zeroValue = [
    { serviceName: "Zero Service", unitPrice: 0, quantity: 1, durationAtBooking: 20 }
  ];
  const invalidNumericValues = [
    { name: "Invalid A", unitPrice: "", quantity: null, durationAtBooking: "bad" },
    { name: "Invalid B", lineTotal: "not-a-number", quantity: -2, durationAtBooking: undefined }
  ];
  const compatibility = {
    includeMemberTotals: true,
    memberServiceTotal: 350,
    includePayableShare: true,
    payableShare: 175,
    amountDue: 330
  };
  const adjustments = [
    { type: "complimentary", amount: 20 },
    { type: "manual", value: "5.50" },
    { type: "ignored_zero", amount: 0 }
  ];

  const scenarios = [
    ["inclusive single service", { serviceLineItems: single, pricingMode: "inclusive", taxRates }],
    ["inclusive multiple services", { serviceLineItems: multiple, pricingMode: "inclusive", taxRates }],
    ["exclusive single service", { serviceLineItems: single, pricingMode: "exclusive", taxRates }],
    ["exclusive multiple services", { serviceLineItems: multiple, pricingMode: "exclusive", taxRates }],
    ["mixed durations no tax", { serviceLineItems: multiple, pricingMode: "inclusive", taxRates: [] }],
    ["decimal prices inclusive", { serviceLineItems: decimalPrices, pricingMode: "tax_inclusive", taxRates }],
    ["decimal prices exclusive", { serviceLineItems: decimalPrices, pricingMode: "taxExclusive", taxRates }],
    ["zero value service", { serviceLineItems: zeroValue, pricingMode: "inclusive", taxRates }],
    ["invalid numeric values", { serviceLineItems: invalidNumericValues, pricingMode: "inclusive", taxRates }],
    ["adjustments and compatibility", { serviceLineItems: multiple, pricingMode: "exclusive", taxRates, adjustments, compatibility }]
  ];

  const results = scenarios.map(([name, options]) => {
    const result = assertParity(frontendBuilder, name, options);
    return {
      name,
      pricingMode: result.pricingMode,
      serviceSubtotal: result.serviceSubtotal,
      taxTotal: result.taxTotal,
      grandTotal: result.grandTotal,
      finalTotal: result.finalTotal,
      amountDue: result.amountDue,
      lineTotals: result.serviceLineItems.map(row => row.lineTotal)
    };
  });

  console.log(JSON.stringify({ ok: true, scenarioCount: results.length, results }, null, 2));
}

run();
