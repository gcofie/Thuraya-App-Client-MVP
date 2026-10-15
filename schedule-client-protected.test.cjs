'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), vm = require('node:vm');
const { read, section, harness, withConfirmation, withGroup } = require('./schedule-client-fixture.cjs');
const baseline = '3f4cd123b8078a42f33d699f80994d5cd304d4b2';
const { stripScheduling } = require('./attendance-v2-protected.cjs');
const prior = file => cp.execFileSync('git', ['show', baseline + ':' + file], { cwd: __dirname, encoding: 'utf8', maxBuffer: 16e6 }).replace(/\r\n/g, '\n');
test('Client source outside reviewed pricing, summary and booking financial paths is unchanged', () => {
    function strip(text) {
        text = stripScheduling(text);
        text = text.replace('let bk_taxInclusive   = null;\nlet bk_taxPolicy      = null;', 'let bk_taxInclusive   = false;');
        for (const [start, end] of [
            ['function applyTaxes(', "document.addEventListener('DOMContentLoaded'"],
            ['function loadTaxConfig()', 'const CATEGORY_ALIASES'],
            ['function populateConfirmScreen()', '// ── Promo code'],
            ['window.bk_confirmBooking = async function()', 'function populateSuccessScreen('],
            ['(function thurayaClientHF19LunchAvailability()', '// END HF19 Lunch Break Availability Alignment']
        ]) text = text.replace(section(text, start, end), '<reviewed-financial>\n');
        return text.replace('Number(appt.finalTotal ?? appt.grandTotal)', 'parseFloat(appt.grandTotal)')
            .replace('a.finalTotal ?? a.grandTotal ?? a.bookedPrice ?? 0', 'a.grandTotal || a.bookedPrice || 0');
    }
    assert.equal(strip(read('app.js')), strip(prior('app.js')));
});
test('group source outside reviewed financial functions and committed-summary retention is unchanged', () => {
    function strip(text) {
        text = stripScheduling(text);
        text = text.replace('let grp_confirmedTotals = [];\n', '').replace('    grp_confirmedTotals = [];\n', '');
        text = text.replaceAll('grp_memberDuration(grp_members[i])', 'grp_memberTotals(grp_members[i]).totalMins')
            .replaceAll('grp_groupDuration() || 60', 'grp_groupTotals().totalMinsMax || 60')
            .replaceAll('const group = { totalMinsMax: grp_groupDuration() };', 'const group = grp_groupTotals();');
        for (const [start, end] of [
            ['function grp_memberTotals(', 'async function grp_ensureTechs('],
            ['function grp_billingOptionsHtml()', 'window.grp_onBillingChange'],
            ['function grp_populateConfirm()', 'async function grp_preAssignSameTimeIfNeeded('],
            ['function grp_computeBillingForMember(', 'function grp_populateSuccess()']
        ]) text = text.replace(section(text, start, end), '<reviewed-financial>\n');
        return text.replace('const mt = grp_confirmedTotals[i];', 'const mt = grp_memberTotals(m);')
            .replace("}).catch(error => { toast(error.message, 'error'); });", '});');
    }
    assert.equal(strip(read('group-booking.js')), strip(prior('group-booking.js')));
});
test('Client configuration, auth, engagement and inactive alternate script are untouched', () => {
    const files = cp.execFileSync('git', ['ls-tree', '-r', '--name-only', baseline], { cwd: __dirname, encoding: 'utf8' })
        .trim().split('\n').filter(file => file.endsWith('.js') && !['app.js', 'group-booking.js', 'availability.js', 'schedule-policy.js'].includes(file));
    assert.ok(files.includes('firebase-config.js')); assert.ok(files.includes('app_client_fixed.js'));
    for (const file of files) assert.equal(read(file), prior(file), file);
});
test('Client HTML adds only tax policy prerequisite with existing script order retained', () => {
    assert.equal(read('index.html').replace('<script src="tax-policy.js?v=rc2-client-tax-parity-1"></script>\n', ''), prior('index.html'));
    assert.ok(read('index.html').indexOf('tax-policy.js') < read('index.html').indexOf('src="app.js'));
});
const financialKeys = new Set(['bookedPrice', 'grandTotal', 'amountDue', 'serviceLineItems', 'serviceSubtotal', 'taxTotal',
    'memberServiceTotal', 'payableShare', 'taxBreakdown', 'discountAmount', 'originalGrandTotal', 'groupTotal', 'totalGHC',
    'pricingMode', 'taxPricingMode', 'financialPolicySnapshot', 'grossServiceValue', 'finalTotal', 'finalServiceGross', 'taxableSubtotal']);
const nonFinancial = row => Object.fromEntries(Object.entries(JSON.parse(JSON.stringify(row))).filter(([key]) => !financialKeys.has(key)));
for (const group of [false, true]) {
    test((group ? 'group' : 'individual') + ' real persistence preserves all non-financial identity, lifecycle, payer and scheduling fields', async () => {
        const current = group ? withGroup(harness(), '2026-09-28') : withConfirmation(harness());
        const old = group ? withGroup(harness(), '2026-09-28') : withConfirmation(harness());
        vm.runInContext("globalThis.bk_liveTaxes = []; globalThis.bk_taxInclusive = false;\n" +
            section(prior('app.js'), 'function applyTaxes(', "document.addEventListener('DOMContentLoaded'"), old);
        vm.runInContext(group
            ? section(prior('group-booking.js'), 'window.grp_confirmBooking = async function()', 'function grp_populateSuccess()')
            : section(prior('app.js'), 'window.bk_confirmBooking = async function()', 'function populateSuccessScreen('), old);
        await (group ? old.grp_confirmBooking() : old.bk_confirmBooking());
        await (group ? current.grp_confirmBooking() : current.bk_confirmBooking());
        assert.equal(old.fixture.commits, 1); assert.equal(current.fixture.commits, 1);
        assert.deepEqual(Array.from(current.fixture.writes, row => nonFinancial(row.data)), Array.from(old.fixture.writes, row => nonFinancial(row.data)));
    });
}
