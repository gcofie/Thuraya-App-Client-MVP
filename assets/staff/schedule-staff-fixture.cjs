'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const read = file => fs.readFileSync(__dirname + '/' + file, 'utf8').replace(/\r\n/g, '\n');
function section(text, start, end) {
    const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start); return text.slice(a, b);
}
function fixtureRuntime() {
    const email = 'matilda@example.test', other = 'other@example.test';
    const history = [
        { effectiveFrom: '2026-07-12', workingDays: ['Sun'], startTime: '08:00', endTime: '23:00' },
        { effectiveFrom: '2026-09-23', workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], startTime: '10:00', endTime: '21:00' },
        { effectiveFrom: '2026-09-27', workingDays: ['Mon','Tue','Wed','Thu','Fri','Sat'], startTime: '10:00', endTime: '21:00' }
    ];
    const state = globalThis.fixture = {
        email, other, reads: [], writes: [], batches: 0, commits: 0, fail: '',
        tables: {
            Staff_Schedules: [{ id: email, scheduleSegments: history }, { id: other, effectiveFrom: '2026-07-01', workingDays: ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'], startTime: '10:00', endTime: '21:00' }],
            Users: [{ id: email, roles: ['Tech'], active: true }, { id: other, roles: ['Technician'], active: true }],
            Calendar_Blocks: [], Staff_Leave: [], Appointments: [], Active_Jobs: [], Settings: []
        },
        messages: []
    };
    function reference(path, filters = [], single = false) {
        return {
            id: path.split('/').at(-1),
            doc(id = 'synthetic-booking') { return reference(path + '/' + id, [], true); },
            collection(name) { return reference(path + '/' + name); },
            where(key, operator, value) { return reference(path, [...filters, { key, operator, value }]); },
            orderBy() { return this; }, limit() { return this; },
            async get(options) {
                state.reads.push({ path, source: options?.source });
                if (state.fail && path.includes(state.fail)) throw Error('Synthetic unavailable read');
                if (single) {
                    const at = path.lastIndexOf('/'), row = (state.tables[path.slice(0, at)] || []).find(r => r.id === path.slice(at + 1));
                    return { exists: !!row, data: () => row };
                }
                const rows = (state.tables[path] || []).filter(row => filters.every(f => f.operator === 'in' ? f.value.includes(row[f.key]) : row[f.key] === f.value));
                const docs = rows.map(row => ({ id: row.id, data: () => row }));
                return { docs, empty: !docs.length, size: docs.length, forEach: fn => docs.forEach(fn) };
            },
            async add(data) { state.writes.push({ path, data }); return { id: 'synthetic-booking' }; },
            async set(data) { state.writes.push({ path, data }); },
            async update(data) { state.writes.push({ path, data }); }
        };
    }
    globalThis.db = {
        collection: name => reference(name),
        batch() {
            state.batches++;
            const pending = [];
            return {
                set(ref, data) { pending.push({ path: ref.id, data }); },
                update(ref, data) { pending.push({ path: ref.id, data }); },
                async commit() { state.commits++; state.writes.push(...pending); }
            };
        }
    };
    globalThis.bk_techs = [{ email, name: 'Matilda.HT' }, { email: other, name: 'Other technician' }];
    globalThis.bk_selectedServices = [{ name: 'Synthetic service', dur: 60, qty: 1, price: 100 }];
    globalThis.timeToMins = time => { const [h,m] = time.split(':').map(Number); return h * 60 + m; };
    globalThis.toast = message => state.messages.push(message);
}
const app = read('app.js');
const marker = app.indexOf('  if (window.__THURAYA_STAFF_SCHEDULE_AVAILABILITY_RULES__)');
const scheduleSource = app.slice(app.lastIndexOf('(function(){', marker), app.indexOf('\n})();', marker) + 6);
const source = [
    '(' + fixtureRuntime.toString() + ')();',
    read('schedule-policy.js'),
    "globalThis.allTechs = bk_techs; globalThis.getLocalDateString = () => '2026-09-01';",
    "globalThis.thurayaOpsSettings = { applyPrepTimeToAvailability: false };",
    "globalThis.thurayaBuildAvailabilityBusyMap = async () => new Map();",
    scheduleSource
].join('\n');
function harness() {
    const elements = {};
    const context = { console: { log() {}, warn() {}, error() {} }, setTimeout() {},
        document: { addEventListener() {}, getElementById: id => elements[id] || null, querySelectorAll: () => [] } };
    context.window = context; vm.createContext(context); vm.runInContext(source, context);
    context.elements = elements; return context;
}
function withCore(h, mode = 'new', date = '2026-09-27') {
    Object.assign(h, {
        state: { mode: 'individual', bookingInProgress: false },
        syncMembersFromDom() {}, validateClient: () => true, validateServices: () => true, validateTime: () => true,
        q: () => ({ value: date }), getLeadName: () => 'Synthetic client',
        basePayload: () => ({ assignedTechEmail: h.fixture.email, dateString: date, timeString: '15:00', bookedDuration: '60' }),
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'SYNTHETIC' } } },
        alert: message => h.fixture.messages.push(message), resetHF84() {}, refresh() {},
        editingApptId: mode === 'edit' ? 'synthetic-existing' : ''
    });
    vm.runInContext(section(read('booking-hf85f-core.js'), '  async function confirmBooking(){', '  function resetHF84(){') + '\nglobalThis.confirm = confirmBooking;', h);
    return h;
}
function withGroupAssignment(h, date = '2026-09-27') {
    Object.assign(h, {
        state: { date, members: [{ name: 'Synthetic member' }] },
        techs: () => h.allTechs, memberDuration: () => 60, selectedServices: () => [{ name: 'Synthetic service', qty: 1 }],
        toMins: time => h.ThurayaSchedulePolicy.minutes(time), isFree: () => true
    });
    vm.runInContext(section(read('booking-hf87-group.js'), '  async function assignmentsForMembersAt(', '  async function buildSmartSlots(') + '\nglobalThis.assignGroup = assignmentsForMembersAt;', h);
    return h;
}
module.exports = { read, section, source, harness, withCore, withGroupAssignment };
