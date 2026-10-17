'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const read = file => fs.readFileSync(__dirname + '/' + file, 'utf8').replace(/\r\n/g, '\n');
function section(text, start, end) {
    const a = text.indexOf(start), b = text.indexOf(end, a + start.length);
    assert.ok(a >= 0 && b > a, start);
    return text.slice(a, b);
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
            id: path.split('/').at(-1), path,
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
        async runTransaction(callback) {
            state.batches++;
            if(state.beforeTransaction)state.beforeTransaction();
            const pending = [];
            const result = await callback({
                get: ref => ref.get({ source:'server' }),
                set: (ref, data) => pending.push({ path:ref.id, data }),
                update: (ref, data) => pending.push({ path:ref.id, data })
            });
            state.commits++; state.writes.push(...pending);
            return result;
        },
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
const source = [
    '(' + fixtureRuntime.toString() + ')();',
    read('schedule-policy.js'),
    read('technician-eligibility.js'),
    section(app, 'function bk_normAvailKey(', 'window.bk_generateSlots ='),
    read('availability.js'),
    "av_todayStr = () => '2026-09-01';"
].join('\n');
function harness() {
    const elements = {};
    const context = { console: { log() {}, warn() {}, error() {} }, setTimeout() {},
        document: { addEventListener() {}, getElementById: id => elements[id] || null } };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(source, context);
    context.elements = elements;
    return context;
}
const confirm = section(app, 'window.bk_confirmBooking = async function()', 'function populateSuccessScreen(');
function confirmSetup() {
    globalThis.bk_clientProfile = { name: 'Synthetic client', phone: '0000000000' };
    globalThis.bk_isGuest = true;
    globalThis.bk_currentUser = null;
    globalThis.bk_isPastOrTooSoonSlot = () => false;
    globalThis.bk_validateBookForDetails = () => ({ bookingFor: 'myself', paymentResponsibility: 'booker', paymentStatus: 'unpaid' });
    globalThis.bk_activePromo = null;
    globalThis.setBtnLoading = () => {};
    globalThis.bk_hasSlotConflict = async () => false;
    globalThis.firebase = { firestore: { FieldValue: { serverTimestamp: () => 'SYNTHETIC' } } };
    globalThis.bk_createClientNotificationForBooking = async () => {};
    globalThis.bk_loadUpcomingAppointmentPreview = () => {};
    globalThis.populateSuccessScreen = () => {};
    globalThis.goToStep = () => {};
    globalThis._screenHistory = [];
}
function withConfirmation(context, date = '2026-09-28') {
    const values = { btnConfirmBooking: '', bk_techEmail: context.fixture.email, bk_techName: 'Matilda.HT', bk_date: date, bk_time: '15:00', bk_discountAmount: '0', bk_promoCodeVal: '', bk_promoId: '' };
    for (const [id, value] of Object.entries(values)) context.elements[id] = { value };
    context.document.querySelector = () => null;
    vm.runInContext('(' + confirmSetup.toString() + ')();\n' + read('tax-policy.js') + '\n' +
        "globalThis.bk_taxPolicy = ThurayaClientTax.read({ inclusive: false, rates: [] });\n" +
        section(app, 'function applyTaxes(', "document.addEventListener('DOMContentLoaded'") + '\n' + confirm, context);
    return context;
}
function withGroup(context, date = '2026-09-27') {
    withConfirmation(context, date);
    context.elements.grp_btnConfirm = {};
    context.elements.grp_date = { value: date };
    context.elements.grp_time = { value: '15:00' };
    context.document.querySelector = () => ({ value: 'lead_pays_all' });
    Object.assign(context, {
        grp_members: [{ name: 'Synthetic lead', assignedTechEmail: context.fixture.email, selectedServices: [{ id: 'service-a', name: 'Synthetic service', price: 100, dur: 60 }] },
            { name: 'Synthetic member', assignedTechEmail: context.fixture.other, selectedServices: [{ id: 'service-a', name: 'Synthetic service', price: 100, dur: 60 }] }],
        grp_selectedPlan: { type: 'same', timeStr: '15:00' },
        grp_preAssignSameTimeIfNeeded: async () => {},
        grp_populateSuccess() {}, grp_baseGoToStep() {}
    });
    vm.runInContext(section(read('group-booking.js'), 'function grp_memberTotals(', 'async function grp_ensureTechs(') + '\n' +
        section(read('group-booking.js'), 'function grp_computeBillingForMember(', 'function grp_populateSuccess()'), context);
    return context;
}
module.exports = { read, section, source, harness, withConfirmation, withGroup, confirm, confirmSetup };
