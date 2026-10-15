'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const tax = require('./tax-policy.js');
const rates = [{ name: 'VAT', rate: 15 }, { name: 'NHIL', rate: 2.5 }, { name: 'GETFund', rate: 2.5 }];
const calculate = (amount, fields = { pricingMode: 'inclusive' }) => tax.calculate([{ amount }], tax.read({ rates, ...fields }));
for (const fields of [{ pricingMode: 'inclusive' }, { taxPricingMode: 'inclusive' }, { inclusive: true },
    { pricingMode: 'INCLUSIVE', taxPricingMode: ' inclusive ' }, { pricingMode: 'inclusive', inclusive: false }]) {
    test('canonical inclusive mode: ' + JSON.stringify(fields), () => {
        const result = calculate(225, fields);
        assert.equal(result.grandTotal, 225); assert.equal(result.basePrice, 187.49); assert.equal(result.taxTotal, 37.51);
        assert.deepEqual(result.taxLines.map(row => row.amount), [28.13, 4.69, 4.69]);
        assert.equal(tax.sum(result.taxLines.slice(1).map(row => row.amount)), 9.38);
        assert.equal(tax.sum([result.basePrice, result.taxTotal]), 225);
    });
}
for (const fields of [{ pricingMode: 'exclusive' }, { taxPricingMode: 'exclusive' }, { inclusive: false }]) {
    test('explicit exclusive remains additive: ' + JSON.stringify(fields), () => {
        const result = calculate(225, fields);
        assert.equal(result.basePrice, 225); assert.equal(result.grandTotal, 270);
        assert.deepEqual(result.taxLines.map(row => row.amount), [33.75, 5.63, 5.62]);
        assert.equal(result.grandTotal, tax.sum([result.basePrice, result.taxTotal]));
    });
}
for (const fields of [{}, { inclusive: 'true' }, { pricingMode: null }, { pricingMode: '' }, { pricingMode: 'unknown' },
    { pricingMode: true }, { pricingMode: 'inclusive', taxPricingMode: 'exclusive' }, { pricingMode: 'bad', inclusive: true }]) {
    test('mode fail-closed: ' + JSON.stringify(fields), () => assert.throws(() => calculate(225, fields), /TAX_MODE/));
}
for (const value of [null, {}, { pricingMode: 'inclusive' }, { pricingMode: 'inclusive', rates: null },
    { pricingMode: 'inclusive', rates: [{ name: 'VAT', rate: 'bad' }] },
    { pricingMode: 'inclusive', rates: [{ name: 'VAT', rate: -1 }] },
    { pricingMode: 'inclusive', rates: [{ name: 'VAT', rate: null }] },
    { pricingMode: 'inclusive', rates: [{ name: '', rate: 15 }] },
    { pricingMode: 'inclusive', rates: [{ name: 'VAT', rate: 15 }, { name: 'vat', rate: 15 }] }]) {
    test('invalid configuration: ' + JSON.stringify(value), () => assert.throws(() => tax.read(value)));
}
test('inactive components excluded; explicit zero rate and empty rates remain valid', () => {
    const policy = tax.read({ pricingMode: 'inclusive', rates: [...rates, { name: 'Old', rate: 100, active: false }, { name: 'Disabled', rate: 10, enabled: false }] });
    assert.deepEqual(policy.rates, rates); assert.equal(tax.calculate([{ amount: 225 }], policy).taxTotal, 37.51);
    for (const rates of [[], [{ name: 'Zero', rate: 0 }]]) assert.equal(tax.calculate([{ amount: 225 }], tax.read({ pricingMode: 'exclusive', rates })).grandTotal, 225);
});
test('zero is real zero with complete evidence and valid policy', () => {
    const result = calculate(0); assert.equal(result.grandTotal, 0); assert.equal(result.basePrice, 0);
    assert.equal(result.taxTotal, 0); assert.deepEqual(result.taxLines.map(row => row.amount), [0, 0, 0]);
    assert.throws(() => tax.calculate([{ amount: 0 }], null));
});
test('HALF_UP uses decimal minor units', () => {
    assert.equal(tax.money('1.005'), 1.01); assert.equal(tax.money('2.675'), 2.68);
    assert.equal(tax.sum([0.1, 0.2]), 0.3);
});
test('multi-line component allocation sums exactly and retains gross', () => {
    const result = tax.calculate([{ amount: 100, id: 'a' }, { amount: 125, id: 'b' }], tax.read({ pricingMode: 'inclusive', rates }));
    assert.deepEqual(result.taxLines.map(row => row.amount), [28.13, 4.69, 4.69]);
    assert.deepEqual(result.lines.map(row => row.gross), [100, 125]);
    assert.equal(tax.sum(result.lines.map(row => row.net)), 187.49);
    assert.equal(tax.sum(result.lines.map(row => row.tax)), 37.51);
    for (let i = 0; i < rates.length; i++) assert.equal(tax.sum(result.lines.map(row => row.taxLines[i].amount)), result.taxLines[i].amount);
});
test('line tie allocation is deterministic by service identity', () => {
    const policy = tax.read({ pricingMode: 'inclusive', rates: [{ name: 'VAT', rate: 20 }] });
    const a = tax.calculate([{ amount: 0.03, id: 'a' }, { amount: 0.03, id: 'b' }], policy);
    const b = tax.calculate([{ amount: 0.03, id: 'b' }, { amount: 0.03, id: 'a' }], policy);
    assert.deepEqual(a.lines, b.lines.slice().reverse());
});
test('equal shares conserve every cent including zero', () => {
    assert.deepEqual(tax.equalShares(225.01, 3), [75.01, 75, 75]);
    assert.deepEqual(tax.equalShares(0, 3), [0, 0, 0]);
    for (let cents = 0; cents < 500; cents++) for (let people = 1; people <= 8; people++) {
        const shares = tax.equalShares(cents / 100, people);
        assert.equal(tax.sum(shares), cents / 100);
        assert.ok(Math.max(...shares.map(tax.minor)) - Math.min(...shares.map(tax.minor)) <= 1);
    }
});
test('policy snapshot retains authority metadata without selecting a different historical policy', () => {
    const policy = tax.read({ pricingMode: 'inclusive', rates, effectiveDate: '2026-10-01', version: 'approved-v1' });
    assert.equal(policy.effectiveAt, '2026-10-01'); assert.equal(policy.policyVersion, 'approved-v1');
    assert.equal(policy.source, 'Tax_Settings/current_taxes'); assert.ok(Object.isFrozen(policy.rates));
});
test('accepted policy is stable when revalidated for a quote or persisted snapshot', () => {
    for (const version of [undefined, 'v2']) {
        const policy = tax.read({ pricingMode: 'inclusive', rates, version });
        assert.deepEqual(tax.read(policy), policy);
        assert.deepEqual(tax.calculate([{ amount: 225 }], policy).financialPolicySnapshot, policy);
    }
});
for (const amount of [null, undefined, NaN, Infinity, -1, '', true, '225 GHC']) {
    test('invalid money fails closed: ' + String(amount), () => assert.throws(() => calculate(amount)));
}
