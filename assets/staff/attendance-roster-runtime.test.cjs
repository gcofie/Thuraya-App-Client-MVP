const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const attendance = require('./attendance-aggregator.js');

const DAY = '2026-09-05';
const EMAIL = 'roster-test@example.com';
const NAME = 'Roster Test Technician';

function section(file, start, end) {
    const source = fs.readFileSync(path.join(__dirname, file), 'utf8');
    const first = source.indexOf(start);
    const last = source.indexOf(end, first);
    assert(first >= 0 && last > first, 'Production roster section is available');
    return source.slice(first, last);
}

function aggregate(open = true, secondOpen = false) {
    const docs = [{
        id: EMAIL + '_' + DAY,
        data: () => ({
            email: EMAIL, name: NAME, roles: ['Tech'], date: DAY,
            clockIn: DAY + 'T08:00:00Z',
            clockOut: open ? null : DAY + 'T09:00:00Z'
        })
    }];
    if (secondOpen) docs.push({
        id: EMAIL + '_' + DAY + '_shift_2',
        data: () => ({ email: EMAIL, name: NAME, roles: ['Tech'], dateString: DAY, clockIn: DAY + 'T10:00:00Z' })
    });
    return attendance.aggregateDocuments(docs, { date: DAY });
}

function emptySnapshot() {
    return { docs: [], forEach() {} };
}

function queryDb(snapshot = emptySnapshot()) {
    return {
        collection() {
            const query = { where() { return query; }, async get() { return snapshot; } };
            return query;
        }
    };
}

function dailyHarness() {
    const list = { innerHTML: '' };
    const date = { value: DAY };
    const listeners = [];
    let unsubscribed = 0;
    const state = { fetch: async () => attendance.aggregateDocuments([], { date: DAY }), leave: false };
    const db = queryDb({
        forEach(callback) {
            if (state.leave) callback({ data: () => ({ startDate: DAY, endDate: DAY, techEmail: EMAIL, type: 'Annual Leave' }) });
        }
    });
    const context = vm.createContext({
        console, document: { getElementById: id => id === 'att_rosterDate' ? date : id === 'att_rosterList' ? list : null },
        db, allTechs: [{ email: EMAIL, name: NAME }],
        att_dayAbbr: () => 'Sat',
        att_fmt12: value => value,
        att_defaultSchedule: () => ({ workingDays: ['Sat'], startTime: '08:00', endTime: '20:00' }),
        att_buildScheduleMapForDate: async () => ({}),
        thurayaAttendance: {
            ...attendance,
            fetchDayAggregates: (...args) => state.fetch(...args),
            listenDay(database, day, onChange) {
                listeners.push({ day, onChange });
                return () => { unsubscribed++; };
            }
        }
    });
    context.window = context;
    const rosterSource = section('attendance.js', 'let att_rosterAttendanceUnsubscribe', '//  WORKING HOURS');
    vm.runInContext(rosterSource, context);
    return { context, list, date, listeners, state, unsubscribeCount: () => unsubscribed };
}

test('FOH listener initializes, renders one multi-shift technician and unsubscribes on restart', async () => {
    const list = { innerHTML: '' };
    const callbacks = [];
    const errors = [];
    let unsubscribed = 0;
    const context = vm.createContext({
        document: { getElementById: () => list }, db: queryDb(), todayDateStr: DAY,
        console: { error: error => errors.push(error), warn: error => errors.push(error) },
        allTechs: [{ email: EMAIL, name: NAME, roles: ['Tech'] }],
        isArchivedRecord: () => false,
        thFohRosterNormalizeEmail: attendance.normalizeEmail,
        thFohRosterIsTechLike: record => (record?.roles || []).includes('Tech'),
        timeToMins: () => 0,
        thurayaAttendance: {
            ...attendance,
            listenDay(database, day, onChange) {
                callbacks.push(onChange);
                return () => { unsubscribed++; };
            }
        }
    });
    context.window = context;
    vm.runInContext(
        section('app.js', 'let expectedTodayListener =', 'function setStaffPhotoPreview') +
        section('app.js', 'function startFohRosterListener()', 'function normalizeTherapyTypes'),
        context
    );
    context.startFohRosterListener();
    assert.equal(errors.length, 0);
    assert.equal(callbacks.length, 1);
    await callbacks[0](aggregate(true, true));
    assert.equal((list.innerHTML.match(/class="roster-item"/g) || []).length, 1);
    assert.match(list.innerHTML, /Multiple open attendance sessions/);
    assert.match(list.innerHTML, /AVAILABLE/);
    await callbacks[0](aggregate(false));
    assert.match(list.innerHTML, /No Technicians currently on the floor/);
    context.startFohRosterListener();
    assert.equal(unsubscribed, 1);
    assert.equal(callbacks.length, 2);
    assert.equal(errors.length, 0);
});

test('Daily Roster follows live attendance while retaining schedule and approved leave', async () => {
    const h = dailyHarness();
    await h.context.att_loadRoster();
    assert.match(h.list.innerHTML, /Scheduled/);
    assert.match(h.list.innerHTML, /Not clocked in/);
    assert.equal(h.listeners.length, 1);
    await h.listeners[0].onChange(aggregate(true, true));
    assert.match(h.list.innerHTML, /Clocked In/);
    assert.match(h.list.innerHTML, /Scheduled 08:00 - 20:00/);
    assert.equal(h.list.innerHTML.split(NAME).length - 1, 1);
    assert.equal(h.listeners.length, 1);
    const clockOutUpdate = h.listeners[0].onChange(aggregate(false));
    assert.match(h.list.innerHTML, /Clocked In/, 'Keep current rows visible while refreshing');
    await clockOutUpdate;
    assert.match(h.list.innerHTML, /Worked Today/);
    h.state.leave = true;
    await h.listeners[0].onChange(aggregate(true));
    assert.match(h.list.innerHTML, /Clocked In/);
    assert.match(h.list.innerHTML, /Approved Annual Leave/);
    await h.listeners[0].onChange(attendance.aggregateDocuments([], { date: DAY }));
    assert.match(h.list.innerHTML, /On approved leave/);
});

test('Daily Roster rejects stale reads and emissions after selected-day changes', async () => {
    const h = dailyHarness();
    let resolveRead;
    h.state.fetch = () => new Promise(resolve => { resolveRead = resolve; });
    const initial = h.context.att_loadRoster();
    await h.listeners[0].onChange(aggregate(true));
    resolveRead(attendance.aggregateDocuments([], { date: DAY }));
    await initial;
    assert.match(h.list.innerHTML, /Clocked In/);
    h.state.fetch = async () => attendance.aggregateDocuments([], { date: '2026-09-06' });
    h.date.value = '2026-09-06';
    await h.context.att_loadRoster();
    assert.equal(h.unsubscribeCount(), 1);
    assert.equal(h.listeners.length, 2);
    await h.listeners[0].onChange(aggregate(true));
    assert.match(h.list.innerHTML, /Not clocked in/);
    assert.doesNotMatch(h.list.innerHTML, />Clocked In</);
});
