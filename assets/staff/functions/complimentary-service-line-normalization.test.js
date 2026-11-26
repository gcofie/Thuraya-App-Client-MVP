"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadComplimentaryHelpers() {
  const source = fs.readFileSync(path.join(__dirname, "index.js"), "utf8");
  const start = source.indexOf("function safeNumber");
  const end = source.indexOf("\nfunction parseTaxRows", start);
  assert.ok(start >= 0, "complimentary helper start not found");
  assert.ok(end > start, "complimentary helper end not found");

  const sandbox = { assert, console };
  vm.createContext(sandbox);
  vm.runInContext(source.slice(start, end), sandbox, {
    filename: "index.js:complimentary-service-line-helpers"
  });
  return sandbox;
}

function runInHelperContext(sandbox) {
  vm.runInContext(`
    function assertNoUndefined(value, path) {
      if (value === undefined) throw new Error(path + " is undefined");
      if (value === null) return;
      if (Array.isArray(value)) {
        value.forEach((entry, index) => assertNoUndefined(entry, path + "." + index));
        return;
      }
      if (value && typeof value === "object") {
        Object.keys(value).forEach((key) => assertNoUndefined(value[key], path + "." + key));
      }
    }

    const missingInput = {
      serviceName: "True Zero Test Service",
      lineTotal: 0,
      price: 0,
      amount: 0,
      qty: 1,
      legacyMeta: {
        keep: true,
        drop: undefined,
        nested: { value: "x", missing: undefined },
        array: ["a", undefined, { keep: 3, drop: undefined }]
      }
    };
    const missing = normalizeComplimentaryServiceLine(missingInput, "serviceLineItems", {});
    assert.equal(Object.prototype.hasOwnProperty.call(missingInput.legacyMeta, "drop"), true, "input metadata was mutated");
    assert.equal(missing.serviceId, "", "missing serviceId should persist as empty string");
    assert.equal(missing.menuItemId, "", "missing menuItemId should persist as empty string");
    assert.equal(missing.department, "", "missing department should persist as empty string");
    assert.equal(missing.priceMode, "", "missing priceMode should persist as empty string");
    assert.equal(missing.lineTotal, 0, "zero-value line total changed");
    assert.equal(missing.price, 0, "zero-value price changed");
    assert.equal(missing.amount, 0, "zero-value amount changed");
    assert.equal(missing.legacyMeta.keep, true, "unknown metadata was not preserved");
    assert.equal(Object.prototype.hasOwnProperty.call(missing.legacyMeta, "drop"), false, "undefined metadata key was preserved");
    assert.equal(Object.prototype.hasOwnProperty.call(missing.legacyMeta.nested, "missing"), false, "nested undefined metadata key was preserved");
    assert.equal(missing.legacyMeta.array[1], null, "undefined array entry should be Firestore-safe null");
    assert.equal(Object.prototype.hasOwnProperty.call(missing.legacyMeta.array[2], "drop"), false, "nested array object kept undefined key");
    assertNoUndefined(missing, "missing");
    const serializedMissing = JSON.stringify(missing);
    assert.ok(serializedMissing.includes('"serviceId":""'), "serialized missing line omitted serviceId");
    assert.ok(serializedMissing.includes('"menuItemId":""'), "serialized missing line omitted menuItemId");

    const validIds = normalizeComplimentaryServiceLine({
      id: "ignored-id",
      serviceId: "svc-valid",
      menuItemId: "menu-valid",
      serviceName: "Valid IDs",
      lineTotal: 40,
      unitPriceAtBooking: 40,
      quantity: 1,
      durationAtBooking: 30,
      unknownMeta: { keep: true }
    }, "serviceLineItems", { taxPricingMode: "inclusive" });
    assert.equal(validIds.serviceId, "svc-valid", "valid serviceId changed");
    assert.equal(validIds.menuItemId, "menu-valid", "valid menuItemId changed");
    assert.equal(validIds.unknownMeta.keep, true, "valid metadata changed");
    assertNoUndefined(validIds, "validIds");

    const menuOnly = normalizeComplimentaryServiceLine({
      menuItemId: "menu-only",
      serviceName: "Menu Only",
      lineTotal: 25,
      quantity: 1
    }, "serviceLineItems", {});
    assert.equal(menuOnly.serviceId, "menu-only", "menuItemId fallback did not populate serviceId");
    assert.equal(menuOnly.menuItemId, "menu-only", "menuItemId was not preserved");
    assertNoUndefined(menuOnly, "menuOnly");

    const sourceRows = [
      { serviceName: "True Zero Test Service", lineTotal: 0, price: 0, amount: 0, qty: 1 },
      { serviceName: "Payable Not Selected", lineTotal: 40, price: 40, amount: 40, qty: 1 }
    ];
    const resolved = resolveComplimentaryServiceLines({ serviceLineItems: sourceRows, pricingMode: "inclusive" });
    assert.equal(resolved.length, 2, "serviceLineItems count changed");
    assert.equal(resolved[0].serviceName, "True Zero Test Service", "zero line index changed");
    assert.equal(resolved[0].lineTotal, 0, "zero line value changed");
    assert.equal(resolved[1].serviceName, "Payable Not Selected", "payable line index changed");
    assert.equal(resolved[1].lineTotal, 40, "payable selected line value changed");
    assert.equal(resolved[1].serviceId, "", "payable missing serviceId should be empty string");
    assert.equal(resolved[1].menuItemId, "", "payable missing menuItemId should be empty string");
    resolved.forEach((row, index) => assertNoUndefined(row, "resolved." + index));

    const snapshot = resolved.map((row) => firestoreSafeComplimentaryServiceLine(row));
    snapshot.forEach((row, index) => assertNoUndefined(row, "snapshot." + index));
    assert.equal(snapshot[0].serviceId, "", "snapshot missing serviceId should be empty string");
    assert.equal(snapshot[0].menuItemId, "", "snapshot missing menuItemId should be empty string");

    const rc1Job = {
      serviceLineItems: [
        { serviceId: "svc-current", menuItemId: "menu-current", serviceName: "Current RC1 Service", lineTotal: 80, unitPriceAtBooking: 80, quantity: 1, durationAtBooking: 45, unknownMeta: { keep: true } }
      ],
      checkoutReviewItems: [
        { serviceId: "checkout-fallback", serviceName: "Fallback", lineTotal: 999 }
      ],
      quickEditV4Items: [
        { serviceId: "quick-fallback", serviceName: "Quick", lineTotal: 999 }
      ]
    };
    const rc1Resolved = resolveComplimentaryServiceLines(rc1Job);
    assert.equal(rc1Resolved.length, 1, "current RC1 serviceLineItems path changed count");
    assert.equal(rc1Resolved[0].serviceId, "svc-current", "current RC1 serviceLineItems path did not stay first priority");
    assert.equal(rc1Resolved[0].menuItemId, "menu-current", "current RC1 menuItemId changed");
    assert.equal(rc1Resolved[0].lineTotal, 80, "current RC1 line total changed");
    assert.equal(rc1Resolved[0].unknownMeta.keep, true, "current RC1 metadata changed");
    assertNoUndefined(rc1Resolved[0], "rc1Resolved.0");

    const legacySynthetic = resolveComplimentaryServiceLines({
      bookedService: "Legacy Synthetic Service",
      bookedPrice: 55,
      bookedDuration: 35,
      pricingMode: "inclusive"
    });
    assert.equal(legacySynthetic.length, 1, "legacy synthetic fallback count changed");
    assert.equal(legacySynthetic[0].serviceId, "", "legacy synthetic serviceId should be empty string");
    assert.equal(legacySynthetic[0].menuItemId, "", "legacy synthetic menuItemId should be empty string");
    assert.equal(legacySynthetic[0].lineTotal, 55, "legacy synthetic price changed");
    assert.equal(legacySynthetic[0].legacySyntheticComplimentaryLine, true, "legacy synthetic marker changed");
    assertNoUndefined(legacySynthetic[0], "legacySynthetic.0");

    const blockedGroupFallback = resolveComplimentaryServiceLines({
      groupId: "group-1",
      bookedService: "Group Legacy Service",
      bookedPrice: 55,
      bookedDuration: 35
    });
    assert.equal(blockedGroupFallback.length, 0, "group fallback should remain blocked");

    globalThis.results = {
      ok: true,
      missingIds: { serviceId: missing.serviceId, menuItemId: missing.menuItemId },
      serializedMissingHasIds: serializedMissing.includes('"serviceId":""') && serializedMissing.includes('"menuItemId":""'),
      resolvedLineTotals: resolved.map((row) => row.lineTotal),
      rc1FirstPath: rc1Resolved[0].serviceId,
      legacySyntheticIds: { serviceId: legacySynthetic[0].serviceId, menuItemId: legacySynthetic[0].menuItemId }
    };
  `, sandbox, { filename: "complimentary-service-line-normalization.test.vm.js" });
  return sandbox.results;
}

const sandbox = loadComplimentaryHelpers();
const results = runInHelperContext(sandbox);
console.log(JSON.stringify(results, null, 2));