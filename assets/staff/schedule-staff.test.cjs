'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), vm = require('node:vm');
const { harness, withCore, withGroupAssignment, read, section } = require('./schedule-staff-fixture.cjs');
const row = (h, more = {}) => ({ techEmail: h.fixture.email, date: '2026-09-28', time: '15:00', duration: 60, ...more });
test('actual Staff resolver uses September OFF, never July Sunday', async () => {
    const h = harness(), result = await h.thurayaResolveStaffWorkingSchedulesForDate('2026-09-27', [h.fixture.email]);
    assert.equal(result[h.fixture.email].worksToday, false); assert.equal(result[h.fixture.email].effectiveFrom, '2026-09-27');
});
test('valid assignment uses fresh server reads and no writes', async () => {
    const h = harness(); assert.equal(await h.thurayaValidateStaffScheduleAssignments([row(h)]), true);
    assert.ok(h.fixture.reads.every(r => r.source === 'server')); assert.equal(h.fixture.writes.length, 0);
});
for (const [name, patch] of [['off day', { date: '2026-09-27' }], ['outside hours', { time: '20:30' }], ['unknown technician', { techEmail: 'nobody@example.test' }], ['invalid date', { date: '09/27/2026' }], ['invalid duration', { duration: NaN }]]) {
    test('Staff explicit assignment rejects ' + name, async () => {
        const h = harness(); await assert.rejects(h.thurayaValidateStaffScheduleAssignments([row(h, patch)])); assert.equal(h.fixture.writes.length, 0);
    });
}
for (const mode of ['new', 'edit']) {
    test('actual Staff ' + mode + ' confirmation blocks off-day before write', async () => {
        const h = withCore(harness(), mode); await h.confirm();
        assert.equal(h.fixture.writes.length, 0); assert.equal(h.state.bookingInProgress, false);
        assert.ok(h.fixture.messages.some(m => /off schedule/.test(m)));
    });
    test('actual Staff ' + mode + ' confirmation retains valid weekday path', async () => {
        const h = withCore(harness(), mode, '2026-09-28'); await h.confirm(); assert.equal(h.fixture.writes.length, 1);
    });
}
for (const failed of ['Staff_Schedules', 'history', 'Users']) {
    test('Staff save fails closed when ' + failed + ' read fails', async () => {
        const h = withCore(harness(), 'new', '2026-09-28'); h.fixture.fail = failed; await h.confirm(); assert.equal(h.fixture.writes.length, 0);
    });
}
test('inactive technician is rejected before save', async () => {
    const h = withCore(harness(), 'new', '2026-09-28'); h.fixture.tables.Users[0].active = false; await h.confirm(); assert.equal(h.fixture.writes.length, 0);
});
test('Any/group assignment excludes off-day technician', async () => {
    const h = withGroupAssignment(harness()); const assignments = await h.assignGroup('15:00', []);
    assert.equal(assignments.length, 1); assert.equal(assignments[0].techEmail, h.fixture.other);
});
test('group unavailable if no working technician can serve member', async () => {
    const h = withGroupAssignment(harness()); h.allTechs = [h.bk_techs[0]];
    assert.equal(await h.assignGroup('15:00', []), null);
});
test('group working-day assignment remains available', async () => {
    const h = withGroupAssignment(harness(), '2026-09-28'); assert.equal((await h.assignGroup('15:00', []))[0].techEmail, h.fixture.email);
});
test('overlapping group assignments are rejected without mutation', async () => {
    const h = harness(); await assert.rejects(h.thurayaValidateStaffScheduleAssignments([row(h), row(h)]), /overlap/);
});
test('Quick Edit real slot renderer excludes off days and retains working days', async () => {
    const h = harness();
    Object.assign(h, { activeAppointmentData: {}, OPEN: '08:00', CLOSE: '21:00', STEP: 15,
        q: id => h.elements[id], today: () => '2026-09-01', mins: h.ThurayaSchedulePolicy.minutes,
        fmtMins: n => String(Math.floor(n/60)).padStart(2,'0') + ':' + String(n%60).padStart(2,'0'),
        num: Number, busyMap: async () => new Map(), isFree: () => true, esc: v => v,
        clearSelectedTime() {}, fmt12: v => v
    });
    for (const [id, value] of Object.entries({ thQeV4Date: '2026-09-27', thQeV4Tech: h.fixture.email, thQeV4Duration: '60', thQeV4Time: '', thQeV4Slots: '' })) h.elements[id] = { value, innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
    const source = section(read('app.js'), '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
    vm.runInContext(section(source, '    async function renderSlots(){', '    async function openQuickEditV4(') + '\nglobalThis.renderQuickSlots = renderSlots;', h);
    await h.renderQuickSlots(); assert.doesNotMatch(h.elements.thQeV4Slots.innerHTML, /<button/);
    h.elements.thQeV4Date.value = '2026-09-28'; await h.renderQuickSlots(); assert.match(h.elements.thQeV4Slots.innerHTML, /<button/);
});
test('all current Staff save paths bind schedule validation before mutation', () => {
    for (const [file, start, end, write] of [
        ['app.js','    async function saveEdit()','    window.editAppointment =', ".set({"],
        ['booking-hf85f-core.js','  async function confirmBooking(){','  function resetHF84(){', '.update(payload)'],
        ['booking-hf87-group.js','  async function confirmGroup(){','  //', 'batch.set(']
    ]) {
        const source = file === 'app.js' ? section(read(file), '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF') : read(file);
        const text = section(source, start, end);
        assert.ok(text.includes('thurayaValidateStaffScheduleAssignments'));
        assert.ok(text.indexOf('thurayaValidateStaffScheduleAssignments') < text.indexOf(write), file);
    }
});
for (const problem of ['off day', 'schedule read failure']) {
    test('actual cached group confirmation blocks ' + problem + ' before batch creation', async () => {
        const h = withGroupAssignment(harness(), problem === 'off day' ? '2026-09-27' : '2026-09-28');
        h.state.assignments = [{ techEmail: h.fixture.email, time: '15:00' }];
        if (problem === 'schedule read failure') h.fixture.fail = 'Staff_Schedules';
        Object.assign(h, { validateAll: async () => true, dbRef: () => h.db, alert: message => h.fixture.messages.push(message) });
        vm.runInContext(section(read('booking-hf87-group.js'),'  async function confirmGroup(){','  async function validateAll(){') + '\nglobalThis.confirmGroupFixture = confirmGroup;',h);
        await h.confirmGroupFixture(); assert.equal(h.fixture.batches,0); assert.equal(h.fixture.writes.length,0); assert.equal(h.state.saving,false);
        assert.ok(h.fixture.messages.some(message => /Group booking failed/.test(message)));
    });
}
