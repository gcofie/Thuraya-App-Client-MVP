'use strict';
const fs = require('node:fs');
const cp = require('node:child_process');
const assert = require('node:assert/strict');
const parent = '31b4b8c1f9243e8a43aa4a4a50a4869b0d4df8bd';
const source = fs.readFileSync(__dirname + '/app.js', 'utf8');
function section(text, from, to) {
    const a = text.indexOf(from), b = text.indexOf(to, a + from.length);
    assert.ok(a >= 0 && b > a, from);
    return text.slice(a, b);
}
function scripts(text = source) {
    function helper(marker) {
        const at = text.indexOf(marker);
        assert.ok(at >= 0);
        return text.slice(text.lastIndexOf('(function(){', at), text.indexOf('})();', at) + 5);
    }
    const block = section(text, '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
    return [helper('window.__TH_SERVICE_SNAPSHOT_HELPERS_PHASE_1A__'),
        helper('window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__'),
        '(' + setup.toString() + ')();', block.slice(block.indexOf('(function(){'))];
}
function setup() {
    const clone = value => JSON.parse(JSON.stringify(value));
    window.todayDateStr = '2099-09-21';
    window.currentUserEmail = 'manager@example.test';
    window.allTechs = [{ email: 'tech@example.test', name: 'Synthetic technician' }];
    const menu = [
        { id: 'polish', name: 'Gel Couture Polish Finish (Upgrade)', price: 100, duration: 15 },
        { id: 'refinement', name: 'The Refinement Indulgence', price: 350, duration: 75 },
        { id: 'youth', name: 'Synthetic Third Service', price: 200, duration: 65 },
        { id: 'replacement', name: 'Synthetic Replacement', price: 120, duration: 30 }
    ];
    const financial = window.thBuildCanonicalFinancialShape({
        serviceLineItems: menu.slice(0, 3).map(s => ({ ...s, serviceId: s.id, menuItemId: s.id,
            serviceName: s.name, unitPriceAtBooking: s.price, durationAtBooking: s.duration,
            quantity: 1, priceMode: 'inclusive' })),
        pricingMode: 'inclusive', taxRates: [{ name: 'SYNTHETIC', rate: 20 }], adjustments: [],
        compatibility: { includeMemberTotals: true, includePayableShare: true }
    });
    const state = window.__qeFixture = {
        record: { ...financial, taxBreakdown: JSON.stringify(financial.taxBreakdown),
            source: 'client-booking', bookingFor: 'myself', paymentResponsibility: 'booker',
            paymentStatus: 'pending_or_paid_by_booker', status: 'Scheduled',
            dateString: '2099-09-21', timeString: '09:00', assignedTechEmail: 'tech@example.test',
            assignedTechName: 'Synthetic technician', clientName: 'Synthetic client',
            bookedDuration: '155', bookedService: menu.slice(0, 3).map(s => s.name).join(', ') },
        jobs: [], writes: [], reads: [], alerts: [], network: [], failJobs: false, cachedJobs: false,
        cachedAppointment: false, changedAppointment: false, failSchedule: false
    };
    window.alert = message => state.alerts.push(message);
    function snapshot(rows) {
        return { metadata: { fromCache: state.cachedJobs }, forEach(fn) {
            rows.forEach(row => fn({ id: row.id, exists: true, data: () => clone(row), metadata: { fromCache: state.cachedJobs } }));
        } };
    }
    function readJob(options) {
        if (options?.source !== 'server') throw Error('Job evidence must be server fresh');
        if (state.failJobs) throw Error('Synthetic denied job read');
        if (state.changedAppointment) state.record.paidAt = 'SYNTHETIC_PAID_TIME';
    }
    window.db = { collection(name) {
        if (name === 'Menu_Settings_V2') return { get: async () => snapshot(menu) };
        if (name === 'Appointments') return { doc: id => ({
            async get(options) { state.reads.push({ name, id, source: options?.source });
                return { exists: true, id, data: () => clone(state.record), metadata: { fromCache: state.cachedAppointment } }; },
            async set(data, options) {
                if (options?.merge !== true) throw Error('Unexpected write contract');
                state.writes.push(clone(data));
                Object.entries(clone(data)).forEach(([key, value]) => {
                    if (value === 'SYNTHETIC_DELETE') delete state.record[key]; else state.record[key] = value;
                });
            }
        }) };
        if (name === 'Active_Jobs') return {
            doc: id => ({ async get(options) {
                readJob(options); state.reads.push({ name, id, source: options.source });
                const row = state.jobs.find(j => j.id === id);
                return { id, exists: !!row, data: () => clone(row), metadata: { fromCache: state.cachedJobs } };
            } }),
            where: (field, operator, value) => ({ async get(options) {
                readJob(options); state.reads.push({ name, field, operator, value, source: options.source });
                return snapshot(state.jobs.filter(j => j[field] === value));
            } })
        };
        throw Error('Unexpected collection: ' + name);
    } };
    window.firebase = { firestore: { FieldValue: {
        serverTimestamp: () => 'SYNTHETIC_TIMESTAMP', delete: () => 'SYNTHETIC_DELETE'
    } } };
    window.thurayaBuildAvailabilityBusyMap = async () => new Map();
    window.thurayaResolveStaffWorkingSchedulesForDate = async () => ({ 'tech@example.test': {} });
    window.ThurayaSchedulePolicy = { check: () => ({ ok: true }) };
    window.thurayaValidateStaffScheduleAssignments = async () => {
        if (state.failSchedule) throw Error('Synthetic off-day');
    };
}
function parentSource() { return cp.execFileSync('git', ['show', parent + ':app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 30e6 }); }
module.exports = { source, scripts, section, parentSource, parent };
