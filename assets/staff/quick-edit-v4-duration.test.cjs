'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const source = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const issue1 = '45574b575928e65b0587b3b0bd324ed519090fb6';
function section(text, from, to) {
    const start = text.indexOf(from), end = text.indexOf(to, start + from.length);
    assert.ok(start >= 0 && end > start, `Missing source section: ${from}`);
    return text.slice(start, end);
}
function sharedBlock(text) {
    const marker = text.indexOf('window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__');
    assert.ok(marker >= 0);
    return text.slice(text.lastIndexOf('(function(){', marker), text.indexOf('})();', marker) + 5);
}
const quickEdit = section(source, '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
const part = (from, to) => section(quickEdit, from, to);
function harness() {
    const elements = { thQeV4Duration: {}, thQeV4Amount: {}, thQeV4ServicesText: {} };
    const context = { window: {}, elements };
    vm.runInNewContext(sharedBlock(source), context);
    vm.runInNewContext(`
        const MENU_COLLECTION = 'Menu_Settings_V2';
        let selectedItems = [];
        function q(id) { return elements[id]; }
        function num(v, fallback = 0) { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : fallback; }
        function renderItems() {}
        ${part('    function normalizeQuickEditItem(', '    function itemLineTotal(')}
        ${part('    function buildInitialItems(appt)', '    function addSelectedService()')}
        ${part('    function syncTotalsFromItems(', '    function clearSelectedTime(')}
        globalThis.api = { buildInitialItems, items: () => selectedItems };
    `, context);
    return { ...context.api, elements, shared: context.window.thServiceLineItemsFromRecord };
}
const line = extra => ({
    serviceId: 'canonical-original', menuItemId: 'canonical-original', serviceName: 'Original service',
    quantity: 1, unitPriceAtBooking: 165, lineTotal: 165, ...extra
});

for (const [label, aliases, expected] of [
    ['snapshot fallback', { durationAtBooking: 30 }, 30],
    ['duration wins', { duration: 25, durationAtBooking: 30 }, 25],
    ['minutes wins', { minutes: 20, durationAtBooking: 30 }, 20],
    ['durationMins wins', { durationMins: 10, durationAtBooking: 30 }, 10],
    ['string zero wins', { duration: '0', durationAtBooking: 30 }, 0],
    ['string zero minutes wins', { minutes: '0', durationAtBooking: 30 }, 0],
    ['string zero durationMins wins', { durationMins: '0', durationAtBooking: 30 }, 0],
    ['numeric zero falls back', { duration: 0, minutes: 0, durationMins: 0, durationAtBooking: 30 }, 30],
    ['numeric zero preserves later alias', { duration: 0, minutes: 15, durationAtBooking: 30 }, 15],
    ['missing aliases', {}, 0],
    ['null snapshot', { durationAtBooking: null }, 0],
    ['zero snapshot', { durationAtBooking: 0 }, 0],
    ['truthy invalid alias does not fall back', { duration: 'invalid', durationAtBooking: 30 }, 0],
    ['existing precedence', { duration: 25, minutes: 20, durationMins: 10, durationAtBooking: 30 }, 25]
]) {
    test(`Quick Edit local duration compatibility: ${label}`, () => {
        const h = harness();
        h.buildInitialItems({ serviceLineItems: [line(aliases)] });
        assert.equal(h.items()[0].duration, expected);
        assert.equal(h.items()[0].price, 165);
        assert.equal(h.items()[0].qty, 1);
        assert.equal(h.items()[0].id, 'canonical-original');
    });
}

for (const field of ['serviceLineItems', 'checkoutReviewItems', 'consultationTicketItems', 'quickEditV4Items']) {
    test(`Quick Edit adapts ${field} without mutating persisted input or shared reads`, () => {
        const h = harness();
        const row = Object.freeze(line({ durationAtBooking: 30 }));
        const record = Object.freeze({ [field]: Object.freeze([row]) });
        const before = JSON.stringify(record);
        assert.equal(h.shared(record)[0].duration, 0);
        h.buildInitialItems(record);
        assert.equal(h.items()[0].duration, 30);
        assert.equal(JSON.stringify(record), before);
        assert.equal(h.shared(record)[0].duration, 0);
    });
}

test('Quick Edit reconstructs 30 + 15 minutes and 165 + 60 without duplicate or substituted lines', () => {
    const h = harness();
    const record = { serviceLineItems: [line({ durationAtBooking: 30 }), line({
        serviceId: 'canonical-added', menuItemId: 'canonical-added', serviceName: 'Added service',
        unitPriceAtBooking: 60, lineTotal: 60, duration: 15, durationAtBooking: 15
    })] };
    for (let i = 0; i < 2; i++) {
        h.buildInitialItems(record);
        assert.equal(h.elements.thQeV4Duration.value, 45);
        assert.equal(h.elements.thQeV4Amount.value, '225.00');
        assert.deepEqual(Array.from(h.items(), item => [item.id, item.qty, item.price, item.duration]), [
            ['canonical-original', 1, 165, 30], ['canonical-added', 1, 60, 15]
        ]);
    }
});

test('Quick Edit retains quantities and shared source-array priority', () => {
    const h = harness();
    h.buildInitialItems({
        serviceLineItems: [line({ quantity: 2, lineTotal: 330, durationAtBooking: 30 })],
        quickEditV4Items: [line({ durationAtBooking: 99 })]
    });
    assert.equal(h.items().length, 1);
    assert.equal(h.items()[0].qty, 2);
    assert.equal(h.items()[0].price, 165);
    assert.equal(h.elements.thQeV4Duration.value, 60);
    assert.equal(h.elements.thQeV4Amount.value, '330.00');
});

test('shared compatibility block and runtime outside duration initialization and hash-reviewed financial serialization remain unchanged', () => {
    const prior = execFileSync('git', ['show', issue1 + ':app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 16e6 }).replace(/\r\n/g, '\n');
    assert.equal(sharedBlock(source), sharedBlock(prior));
    const priorQuickEdit = section(prior, '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
    const reviewedSource = require('./scheduling-source-parity.cjs').baselineSource('app.js', source);
    const reviewedV4 = section(reviewedSource, '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
    const financial = section(reviewedV4, '    function quickEditV4FinancialContext(', '    function itemizedRowsFromServiceText(');
    const save = section(reviewedV4, '    async function saveEdit()', '    window.editAppointment =');
    assert.equal(require('node:crypto').createHash('sha256').update(financial + '\n' + save).digest('hex'),
        'd22a5956a1d89b66a0ebca441277661d8b1a7b3dce3a279258e9b4b4b5257bad');
    const withoutReviewedFinancials = reviewedSource
        .replace(financial, section(priorQuickEdit, '    function buildQuickEditV4CanonicalFinancials(', '    function itemizedRowsFromServiceText('))
        .replace(save, section(priorQuickEdit, '    async function saveEdit()', '    window.editAppointment ='));
    const currentQuickEdit = section(withoutReviewedFinancials, '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
    const strip = text => text.replace(section(text, '    function buildInitialItems(appt)', '    function addSelectedService()'), 'QUICK_EDIT_INITIALIZATION');
    assert.equal(strip(currentQuickEdit), strip(priorQuickEdit));
});
