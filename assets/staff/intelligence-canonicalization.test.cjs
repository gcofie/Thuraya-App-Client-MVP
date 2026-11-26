'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const appSource = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const engineSource = fs.readFileSync(__dirname + '/intelligence-engine-v1.js', 'utf8').replace(/\r\n/g, '\n');

function issue4HelperBlock() {
    const marker = 'THURAYA RC2 ISSUE 4 - CANONICAL INTELLIGENCE POPULATION HELPERS';
    const at = appSource.indexOf(marker);
    assert.ok(at >= 0, 'Issue 4 helper marker must exist');
    const start = appSource.indexOf('(function () {', at);
    const end = appSource.indexOf('\n})();', start);
    assert.ok(start >= 0 && end > start, 'Issue 4 helper block must be extractable');
    return appSource.slice(start, end + '\n})();'.length);
}

function helperHarness() {
    const context = { console: { log() {}, warn() {}, error() {} }, window: {} };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(issue4HelperBlock(), context);
    return context.window.ThurayaIntelligenceCanonical;
}

const C = helperHarness();
const apptId = 'booking-1';
const silken = 'hand__hand_therapies__hand_therapies__main_therapy__silken_restore_hand_balance';
const gel = 'hand__polish_and_finish__polish_and_finish__finish__gel_polish_upgrade';

function activeJob(extra = {}) {
    return {
        id: 'job-1', _collection: 'Active_Jobs', sourceAppointmentId: apptId,
        status: 'Closed', dateString: '2026-09-24', assignedTechName: 'Matilda.HT', assignedTechEmail: 'matilda@example.test',
        clientName: 'Test Client', clientPhone: '0550000000',
        serviceSubtotal: 187.5, bookedPrice: 187.5, taxTotal: 37.5, grandTotal: 225, finalTotal: 225, totalGHC: 225,
        serviceLineItems: [
            { menuItemId: silken, serviceId: silken, id: silken, name: 'Silken Restore', qty: 1, price: 165, lineSubtotal: 137.5, taxAmount: 27.5, lineTotal: 165, durationAtBooking: 30 },
            { menuItemId: gel, serviceId: gel, id: gel, name: 'Gel Polish Upgrade', qty: 1, price: 60, lineSubtotal: 50, taxAmount: 10, lineTotal: 60, durationAtBooking: 15 }
        ],
        ...extra
    };
}

function appointment(extra = {}) {
    return { id: apptId, _collection: 'Appointments', status: 'Scheduled', grandTotal: 225, finalTotal: 225, sourceAppointmentId: apptId, ...extra };
}

test('scheduled, arrived, and ready-for-payment positive records are not recognized revenue', () => {
    assert.equal(C.recognizedRevenue(appointment({ status: 'Scheduled', grandTotal: 500 })), 0);
    assert.equal(C.recognizedRevenue(appointment({ status: 'Arrived', grandTotal: 500 })), 0);
    assert.equal(C.recognizedRevenue(activeJob({ status: 'Ready for Payment', grandTotal: 500, finalTotal: 500 })), 0);
});

test('terminal Active_Jobs are recognized according to canonical lifecycle semantics', () => {
    assert.equal(C.recognizedRevenue(activeJob({ status: 'Closed' })), 225);
    assert.equal(C.recognizedRevenue(activeJob({ status: 'Paid' })), 225);
    assert.equal(C.recognizedRevenue(activeJob({ status: 'Completed' })), 225);
    assert.equal(C.recognizedRevenue(activeJob({ status: 'No Show' })), 0);
});

test('Appointment plus linked Active_Job is counted once for revenue and once for bookings', () => {
    const rows = [appointment({ status: 'Closed', grandTotal: 225 }), activeJob()];
    const revenueRows = C.canonicalRevenueRows(rows);
    assert.equal(revenueRows.length, 1);
    assert.equal(revenueRows.reduce((sum, row) => sum + C.recognizedRevenue(row), 0), 225);
    assert.equal(C.uniqueBookingCount(rows), 1);
});

test('duplicate source identities dedupe deterministically', () => {
    const rows = [activeJob({ id: 'a' }), activeJob({ id: 'b' })];
    assert.equal(C.canonicalRevenueRows(rows).length, 1);
});

test('canonical financial semantics preserve gross, net/bookedPrice, inclusive and exclusive tax', () => {
    const inclusive = C.financials(activeJob());
    assert.equal(inclusive.gross, 225);
    assert.equal(inclusive.net, 187.5);
    assert.equal(inclusive.tax, 37.5);

    const exclusive = C.financials(activeJob({ serviceSubtotal: 225, bookedPrice: 225, taxTotal: 45, grandTotal: 270, finalTotal: 270, totalGHC: 270 }));
    assert.equal(exclusive.gross, 270);
    assert.equal(exclusive.net, 225);
    assert.equal(exclusive.tax, 45);
});

test('amountDue cannot suppress realized paid revenue', () => {
    const row = activeJob({ amountDue: 0, finalTotal: 225, grandTotal: 225, status: 'Paid' });
    assert.equal(C.recognizedRevenue(row), 225);
});

test('complimentary normalized service does not create recognized revenue', () => {
    const comp = activeJob({ finalTotal: 0, grandTotal: 0, totalGHC: 0, serviceSubtotal: 0, bookedPrice: 0, taxTotal: 0, serviceLineItems: [
        { menuItemId: 'comp', serviceId: 'comp', id: 'comp', name: 'Complimentary Care', qty: 1, price: 100, lineTotal: 0, lineSubtotal: 0, taxAmount: 0, durationAtBooking: 20, isComplimentary: true }
    ]});
    assert.equal(C.recognizedRevenue(comp), 0);
});

test('quantity and booking-time duration are read from serviceLineItems', () => {
    const row = activeJob({ serviceLineItems: [
        { menuItemId: 'q2', serviceId: 'q2', id: 'q2', name: 'Quantity Service', qty: 2, price: 50, lineTotal: 100, lineSubtotal: 83.33, taxAmount: 16.67, durationAtBooking: 25 }
    ]});
    const [line] = C.serviceLineEntries(row);
    assert.equal(line.qty, 2);
    assert.equal(line.gross, 100);
    assert.equal(line.duration, 50);
});

test('service aggregation keys by canonical service ID, not display string', () => {
    const rows = [
        activeJob({ id: 'a', sourceAppointmentId: 'a', grandTotal: 100, finalTotal: 100, serviceLineItems: [{ menuItemId: 'same-name-a', serviceId: 'same-name-a', id: 'same-name-a', name: 'Same Label', qty: 1, price: 100, priceMode: 'inclusive', lineTotal: 100, durationAtBooking: 10 }] }),
        activeJob({ id: 'b', sourceAppointmentId: 'b', grandTotal: 200, finalTotal: 200, serviceLineItems: [{ menuItemId: 'same-name-b', serviceId: 'same-name-b', id: 'same-name-b', name: 'Same Label', qty: 1, price: 200, priceMode: 'inclusive', lineTotal: 200, durationAtBooking: 10 }] }),
        activeJob({ id: 'c', sourceAppointmentId: 'c', grandTotal: 25, finalTotal: 25, serviceLineItems: [{ menuItemId: 'same-name-a', serviceId: 'same-name-a', id: 'same-name-a', name: 'Renamed Label', qty: 1, price: 25, priceMode: 'inclusive', lineTotal: 25, durationAtBooking: 5 }] })
    ];
    const services = C.aggregateServices(rows);
    const byId = Object.fromEntries(services.map(s => [s.id, s]));
    assert.equal(Object.keys(byId).length, 2);
    assert.equal(byId['same-name-a'].revenue, 125);
    assert.equal(byId['same-name-b'].revenue, 200);
});

test('technician revenue uses only canonical terminal Active_Jobs', () => {
    const rows = [
        activeJob({ id: 't1', sourceAppointmentId: 't1', assignedTechName: 'Matilda.HT', grandTotal: 100, finalTotal: 100 }),
        activeJob({ id: 't2', sourceAppointmentId: 't2', assignedTechName: 'Matilda.HT', status: 'Ready for Payment', grandTotal: 999, finalTotal: 999 }),
        appointment({ id: 't3', sourceAppointmentId: 't3', status: 'Closed', grandTotal: 888 })
    ];
    const techs = C.aggregateTechnicians(rows);
    assert.equal(techs.length, 1);
    assert.equal(techs[0].name, 'Matilda.HT');
    assert.equal(techs[0].revenue, 100);
});

test('history reads use deterministic ordering instead of bare limit in Issue 4 Intelligence loaders', () => {
    for (const marker of ['function p55_getCollection', 'function gci_getCollection', 'function p6_getCollection', 'function p62_get', 'function p64_get']) {
        const start = appSource.indexOf(marker);
        assert.ok(start >= 0, marker);
        const end = appSource.indexOf('\n    async function', start + marker.length) > 0 ? appSource.indexOf('\n    async function', start + marker.length) : appSource.indexOf('\n    function', start + marker.length);
        const block = appSource.slice(start, end > start ? end : start + 800);
        assert.equal(block.includes('.limit('), false, marker + ' must not use bare limit');
        assert.equal(block.includes('readCollection(name)') || block.includes('ThurayaIntelligencePeriod.read(name)'), true, marker + ' should use canonical ordered reader directly or through shared period snapshot');
    }
});

function engineHarness() {
    const context = { console: { log() {}, warn() {} }, document: { addEventListener() {} }, setTimeout() {}, Date, Map, Set };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(issue4HelperBlock(), context);
    vm.runInContext(engineSource.replace('    window.thurayaRunIntelligenceEngine = run;', '    window.__test = { aggregateDay, STATE };\n    window.thurayaRunIntelligenceEngine = run;'), context);
    return context.__test;
}

test('legacy Intelligence engine aggregateDay uses canonical terminal revenue and booking dedupe', () => {
    const e = engineHarness();
    e.aggregateDay([
        appointment({ id: 'old-a', sourceAppointmentId: 'x', status: 'Arrived', grandTotal: 900 }),
        activeJob({ id: 'old-j', sourceAppointmentId: 'x', status: 'Closed', grandTotal: 225, finalTotal: 225 }),
        activeJob({ id: 'pending', sourceAppointmentId: 'pending', status: 'Ready for Payment', grandTotal: 400, finalTotal: 400 })
    ], true);
    assert.equal(e.STATE.revenueToday, 225);
    assert.equal(e.STATE.closedJobsToday, 1);
    assert.equal(e.STATE.bookingsToday, 2);
    assert.equal(e.STATE.topService.name, 'Silken Restore');
});
