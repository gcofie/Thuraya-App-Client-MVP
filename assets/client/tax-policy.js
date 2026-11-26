(function(root, factory) {
    const policy = factory();
    if (typeof module === 'object' && module.exports) module.exports = policy;
    else root.ThurayaClientTax = policy;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
    'use strict';
    function fail(code) { throw new Error(code); }
    function fraction(value) {
        if (!['number', 'string'].includes(typeof value)) fail('TAX_AMOUNT_INVALID');
        const text = String(value).trim();
        const match = /^(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i.exec(text);
        if (!match || !Number.isFinite(Number(text))) fail('TAX_AMOUNT_INVALID');
        const scale = (match[2] || '').length - Number(match[3] || 0);
        if (Math.abs(scale) > 100) fail('TAX_AMOUNT_OUT_OF_RANGE');
        const n = BigInt(match[1] + (match[2] || ''));
        return scale < 0 ? { n: n * 10n ** BigInt(-scale), d: 1n } : { n, d: 10n ** BigInt(scale) };
    }
    const halfUp = (n, d) => n / d + ((n % d) * 2n >= d ? 1n : 0n);
    function safe(n) {
        if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER)) fail('TAX_AMOUNT_OUT_OF_RANGE');
        return Number(n);
    }
    function minor(value) { const f = fraction(value); return safe(halfUp(f.n * 100n, f.d)); }
    const money = value => minor(value) / 100;
    const sum = values => safe(values.reduce((total, value) => total + BigInt(minor(value)), 0n)) / 100;
    function percentage(amount, rate) {
        const value = fraction(rate);
        return safe(halfUp(BigInt(minor(amount)) * value.n, 100n * value.d)) / 100;
    }
    function mode(data) {
        const fields = ['pricingMode', 'taxPricingMode'].filter(key => Object.hasOwn(data, key));
        if (fields.length) {
            const modes = fields.map(key => {
                if (typeof data[key] !== 'string') fail('TAX_MODE_INVALID');
                const value = data[key].trim().toLowerCase();
                if (!['inclusive', 'exclusive'].includes(value)) fail('TAX_MODE_INVALID');
                return value;
            });
            if (new Set(modes).size !== 1) fail('TAX_MODE_CONFLICT');
            return modes[0];
        }
        if (typeof data.inclusive === 'boolean') return data.inclusive ? 'inclusive' : 'exclusive';
        fail('TAX_MODE_UNAVAILABLE');
    }
    function read(data) {
        if (!data || !Array.isArray(data.rates)) fail('TAX_POLICY_UNAVAILABLE');
        const pricingMode = mode(data), names = new Set();
        const rates = data.rates.filter(row => row?.enabled !== false && row?.active !== false).map(row => {
            if (!row || typeof row.name !== 'string' || !row.name.trim()) fail('TAX_COMPONENT_INVALID');
            const name = row.name.trim(), key = name.toLowerCase();
            if (names.has(key)) fail('TAX_COMPONENT_DUPLICATE');
            fraction(row.rate); names.add(key);
            return Object.freeze({ name, rate: Number(row.rate) });
        });
        const metadata = value => value == null ? null : typeof value.toDate === 'function'
            ? value.toDate().toISOString() : value instanceof Date ? value.toISOString() : String(value);
        return Object.freeze({ version: 1, pricingMode, rates: Object.freeze(rates), source: 'Tax_Settings/current_taxes',
            effectiveAt: metadata(data.effectiveAt ?? data.effectiveDate),
            policyVersion: metadata(Object.hasOwn(data, 'policyVersion') ? data.policyVersion : data.version) });
    }
    function calculate(lines, policy) {
        if (!policy) fail('TAX_POLICY_UNAVAILABLE');
        const accepted = read(policy), inclusive = accepted.pricingMode === 'inclusive';
        const listed = lines.map(row => BigInt(minor(row.amount)));
        const rates = accepted.rates.map(row => fraction(row.rate));
        const scale = rates.reduce((s, rate) => s * rate.d, 1n);
        const weights = rates.map(rate => rate.n * (scale / rate.d));
        const weightTotal = weights.reduce((s, n) => s + n, 0n);
        const denominator = 100n * scale + (inclusive ? weightTotal : 0n);
        const listedTotal = listed.reduce((s, n) => s + n, 0n);
        const exclusiveTax = halfUp(listedTotal * weightTotal, 100n * scale);
        let exclusiveAllocated = 0n;
        const lineTax = listed.map(() => 0n), lineComponents = listed.map(() => []);
        // Round each component on the total, then distribute its cents by largest
        // remainder, matching the closed Staff inclusive component-first contract.
        const taxLines = weights.map((weight, component) => {
            const rows = listed.map((value, index) => ({ index, id: String(lines[index].id ?? index),
                numerator: value * weight, amount: value * weight / denominator, remainder: value * weight % denominator }));
            const total = inclusive ? halfUp(rows.reduce((s, row) => s + row.numerator, 0n), denominator)
                : component === weights.length - 1 ? exclusiveTax - exclusiveAllocated
                : weightTotal === 0n ? 0n : halfUp(exclusiveTax * weight, weightTotal);
            if (!inclusive) {
                safe(total); exclusiveAllocated += total;
                for (const row of rows) {
                    row.numerator = total * listed[row.index];
                    row.amount = listedTotal ? row.numerator / listedTotal : 0n;
                    row.remainder = listedTotal ? row.numerator % listedTotal : 0n;
                }
            }
            let left = total - rows.reduce((s, row) => s + row.amount, 0n);
            rows.sort((a, b) => a.remainder === b.remainder
                ? (a.id < b.id ? -1 : a.id > b.id ? 1 : a.index - b.index) : a.remainder > b.remainder ? -1 : 1);
            for (const row of rows) {
                if (left > 0n) { row.amount++; left--; }
                lineTax[row.index] += row.amount;
                lineComponents[row.index][component] = { ...accepted.rates[component], amount: safe(row.amount) / 100, pricingMode: accepted.pricingMode };
            }
            if (left !== 0n) fail('TAX_ALLOCATION_UNREPRESENTABLE');
            return { ...accepted.rates[component], amount: safe(total) / 100, pricingMode: accepted.pricingMode };
        });
        if (inclusive && lineTax.some((n, i) => n > listed[i])) fail('TAX_ALLOCATION_UNREPRESENTABLE');
        const total = listed.reduce((s, n) => s + n, 0n), taxes = lineTax.reduce((s, n) => s + n, 0n);
        return { basePrice: safe(inclusive ? total - taxes : total) / 100,
            grandTotal: safe(inclusive ? total : total + taxes) / 100, taxTotal: safe(taxes) / 100,
            taxLines, pricingMode: accepted.pricingMode, financialPolicySnapshot: accepted,
            lines: listed.map((value, index) => ({ net: safe(inclusive ? value - lineTax[index] : value) / 100,
                gross: safe(inclusive ? value : value + lineTax[index]) / 100,
                tax: safe(lineTax[index]) / 100, taxLines: lineComponents[index] })) };
    }
    function equalShares(total, count) {
        if (!Number.isSafeInteger(count) || count < 1) fail('BILLING_MEMBERS_INVALID');
        const cents = minor(total), share = Math.floor(cents / count), remainder = cents % count;
        return Array.from({ length: count }, (_, index) => (share + (index < remainder ? 1 : 0)) / 100);
    }
    return Object.freeze({ read, mode, calculate, money, minor, sum, percentage, equalShares });
});
