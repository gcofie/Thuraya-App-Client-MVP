'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const cp = require('node:child_process');
const { buildCanonicalFinancialShape } = require('./functions/canonical-financial-core');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const parent = cp.execFileSync('git', ['show', 'cbac9925ed66660e85c8a1a898095bb824bac0d6:app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 20e6 }).replace(/\r\n/g, '\n');
function helper(text) {
    const at = text.indexOf('// THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS');
    const start = text.indexOf('(function () {', at), end = text.indexOf('\n})();', start);
    assert.ok(at >= 0 && start > at && end > start);
    const context = { window: {}, console };
    vm.runInNewContext(text.slice(start, end + 7), context);
    return context.window.ThurayaIntelligenceCanonical;
}
const C = helper(source), prior = helper(parent);
const plain = value => JSON.parse(JSON.stringify(value));
function line(id = 'canonical-a', gross = 120, extra = {}) {
    return { menuItemId: id, name: 'Service A', qty: 1, price: gross, lineTotal: gross, lineSubtotal: gross / 1.2, taxAmount: gross - gross / 1.2, priceMode: 'inclusive', durationAtBooking: 25, ...extra };
}
function job(id = 'booking-a', lines = [line()], extra = {}) {
    const total = lines.reduce((sum, row) => sum + row.lineTotal, 0);
    return { id, sourceAppointmentId: id, _collection: 'Active_Jobs', status: 'Closed', finalTotal: total, taxTotal: total / 6, serviceLineItems: lines, assignedTechName: 'Test Tech', dateString: '2030-04-10', ...extra };
}
test('missing IDs at the same position never merge as a service', () => {
    const result = C.serviceAttribution([job('a', [line('', 120)]), job('b', [line('', 60, { name: 'Unrelated' })])]);
    assert.equal(result.services.length, 0);
    assert.equal(result.unattributedRevenue, 180);
    assert.equal(result.reasons['missing-canonical-id'], 180);
});
for (const id of ['', 'line-0', 'line-1', 'item-0', 'service-0', 'unknown', 'legacy:service a']) {
    test('noncanonical identity is unattributed: ' + (id || 'ABSENT'), () => {
        assert.equal(C.aggregateServices([job('a', [line(id)])]).length, 0);
        assert.equal(C.serviceLineEntries(job('a', [line(id)]))[0].id, '');
    });
}
test('one ID with different labels aggregates with stable presentation', () => {
    const rows = [job('a', [line('same', 120, { name: 'Z label' })]), job('b', [line('same', 60, { name: 'A label' })])];
    const ranking = C.aggregateServices(rows);
    assert.equal(ranking.length, 1);
    assert.equal(ranking[0].revenue, 180);
    assert.equal(ranking[0].name, 'A label');
    assert.deepEqual(plain(ranking), plain(C.aggregateServices([...rows].reverse())));
});
test('same labels with different canonical IDs stay separate', () => {
    const rows = [job('a', [line('first')]), job('b', [line('second')])];
    assert.deepEqual(C.aggregateServices(rows).map(row => row.id).join(','), 'first,second');
});
test('no service lines stays in revenue but only in unattributed service coverage', () => {
    const row = job('legacy', [], { finalTotal: 72, bookedService: 'Service A' });
    assert.equal(C.recognizedRevenue(row), 72);
    const result = C.serviceAttribution([row]);
    assert.equal(result.services.length, 0);
    assert.equal(result.unattributedRevenue, 72);
    assert.equal(result.reasons['missing-service-lines'], 72);
});
test('display names and alternate legacy arrays cannot manufacture identity', () => {
    const row = job('a', [], { finalTotal: 120, bookedService: 'canonical-a', quickEditV4Items: [line('canonical-a')] });
    assert.equal(C.serviceAttribution([row]).unattributedRevenue, 120);
});
test('canonical builder inclusive and exclusive outputs both rank GROSS', () => {
    for (const pricingMode of ['inclusive', 'exclusive']) {
        const shape = buildCanonicalFinancialShape({ pricingMode, serviceLineItems: [line('one', pricingMode === 'inclusive' ? 120 : 100)], taxRates: [{ name: 'Tax', rate: 20 }] });
        const row = job('a', shape.serviceLineItems, shape);
        assert.equal(C.aggregateServices([row])[0].revenue, 120);
        assert.equal(C.serviceAttribution([row]).coveragePercent, 100);
    }
});
test('exclusive persisted allocations are added, never treated as inclusive', () => {
    const row = job('a', [line('a', 100, { lineSubtotal: 100, taxAmount: 20, priceMode: 'exclusive' })], { finalTotal: 120 });
    assert.equal(C.aggregateServices([row])[0].revenue, 120);
});
test('missing exclusive tax allocation is not invented from job tax', () => {
    const row = job('a', [line('a', 100, { lineSubtotal: undefined, taxAmount: undefined, priceMode: 'exclusive' })], { finalTotal: 120, taxTotal: 20 });
    assert.equal(C.serviceAttribution([row]).unattributedRevenue, 120);
});
test('a job-total mismatch cannot be allocated to a named service', () => {
    const row = job('a', [line()], { finalTotal: 140 });
    const result = C.serviceAttribution([row]);
    assert.equal(result.services.length, 0);
    assert.equal(result.reasons['line-job-total-mismatch'], 140);
});
test('ambiguous discount is unattributed even when stale line amounts happen to match', () => {
    const row = job('a', [line()], { discountAmount: 5 });
    assert.equal(C.serviceAttribution([row]).reasons['ambiguous-adjustment'], 120);
    assert.equal(C.recognizedRevenue(row), 120);
});
test('adjustments are not inferred from financial alias differences', () => {
    const row = job('a', [line()], { bookedPrice: 75, originalTotal: 75, amountDue: 0 });
    assert.equal(C.aggregateServices([row])[0].revenue, 120);
});
test('quantity multiplies neither persisted line totals nor recognized gross twice', () => {
    const row = job('a', [line('a', 120, { qty: 3, price: 40 })]);
    assert.equal(C.aggregateServices([row])[0].revenue, 120);
    assert.equal(C.aggregateServices([row])[0].qty, 3);
    assert.equal(C.aggregateServices([row])[0].duration, 75);
});
test('partial identity coverage plus legacy remainder exactly reconciles in cents', () => {
    const rows = [job('a', [line('known', 120), line('', 60)]), job('b', [], { finalTotal: 10.01 })];
    const result = C.serviceAttribution(rows);
    assert.equal(result.recognizedRevenue, 190.01);
    assert.equal(result.attributedRevenue, 120);
    assert.equal(result.unattributedRevenue, 70.01);
    assert.equal(Math.round((result.attributedRevenue + result.unattributedRevenue) * 100), 19001);
    assert.equal(Math.round(Object.values(result.reasons).reduce((a, b) => a + b, 0) * 100), 7001);
});
test('duplicate booking identities remain counted once in attribution', () => {
    const rows = [job(), job()];
    assert.equal(C.serviceAttribution(rows).recognizedRevenue, 120);
    assert.equal(C.aggregateServices(rows)[0].records, 1);
});
test('repeated same-ID lines retain quantity but count one contributing job', () => {
    const result = C.aggregateServices([job('a', [line(), line()])]);
    assert.equal(result[0].qty, 2);
    assert.equal(result[0].records, 1);
    assert.equal(result[0].revenue, 240);
});
test('negative or contradictory line evidence cannot be ranked', () => {
    for (const extra of [{ taxAmount: -1 }, { lineTotal: 110 }, { priceMode: 'exclusive' }]) {
        const row = job('a', [line('a', 120, extra)], { finalTotal: 120 });
        assert.equal(C.serviceAttribution([row]).unattributedRevenue, 120);
    }
});
test('zero tax explicitly persisted supports a tax-free line', () => {
    const row = job('a', [{ menuItemId: 'a', lineTotal: 33.33 }], { taxTotal: 0 });
    assert.equal(C.aggregateServices([row])[0].revenue, 33.33);
});
test('unattributed coverage is never a named service, including empty data', () => {
    assert.equal(C.serviceAttribution([]).coveragePercent, 0);
    const result = C.serviceAttribution([job('a', [], { finalTotal: 50 })]);
    assert.equal(result.services.length, 0);
    assert.match(C.serviceCoverageHtml(result), /Unattributed \/ Legacy Revenue/);
});
test('certified revenue, bookings, historical population and technicians remain identical to parent', () => {
    const rows = [job(), job('legacy', [], { finalTotal: 60 }), job('pending', [line()], { status: 'Ready for Payment' }),
        { ...job(), _collection: 'Appointments', status: 'Scheduled' }];
    for (const name of ['canonicalRevenueRows', 'uniqueBookingCount', 'aggregateTechnicians']) {
        assert.deepEqual(plain(C[name](rows)), plain(prior[name](rows)), name);
    }
    for (const row of rows) assert.deepEqual(plain(C.financials(row)), plain(prior.financials(row)));
    for (const name of ['recognizedRevenue', 'canonicalRevenueRows', 'uniqueBookingCount', 'financials', 'dateKey', 'isTerminalLifecycle', 'readCollection']) {
        assert.equal(C[name].toString(), prior[name].toString(), name + ' source unchanged');
    }
});
test('standalone daily engine uses the shared helper instead of a competing fallback', () => {
    const engine = fs.readFileSync(__dirname + '/intelligence-engine-v1.js', 'utf8');
    assert.ok(engine.includes('const IC = window.ThurayaIntelligenceCanonical;'));
    assert.ok(engine.includes('IC.aggregateServices(revenueDocs)'));
    assert.equal(engine.includes('`line-${index}`'), false);
    assert.equal(engine.includes('legacy:${'), false);
});
test('all app source outside exact reviewed Intelligence and scheduling sections remains byte-identical',()=>require('./scheduling-source-parity.cjs').legacyParity('intelligence-global-source-parity.cjs').check());
