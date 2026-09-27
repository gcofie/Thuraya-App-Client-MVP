'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { harness, withConfirmation, withGroup, read, section } = require('./schedule-client-fixture.cjs');
const assignment = (h, extra = {}) => ({ techEmail: h.fixture.email, date: '2026-09-28', time: '15:00', duration: 60, ...extra });

test('actual Client resolver does not resurrect July Sunday', async () => {
    const h = harness();
    assert.equal(Object.keys(await h.av_getSlotMap('2026-09-27', [h.fixture.email], 60)).length, 0);
});
test('Any Technician excludes off-day Matilda but retains a working technician', async () => {
    const h = harness(), slots = await h.av_getSlotMap('2026-09-27', [h.fixture.email, h.fixture.other], 60);
    assert.ok(Object.keys(slots).length);
    for (const emails of Object.values(slots)) assert.deepEqual([...emails], [h.fixture.other]);
});
test('newest Sunday ON permits working hours', async () => {
    const h = harness(); h.fixture.tables.Staff_Schedules[0].scheduleSegments.at(-1).workingDays = ['Sun'];
    assert.ok((await h.av_getSlotMap('2026-09-27', [h.fixture.email], 60))[900]);
});
test('ordinary valid weekday passes read-only validation', async () => {
    const h = harness(); assert.equal(await h.av_validateBookingAssignments([assignment(h)]), true);
    assert.equal(h.fixture.writes.length, 0);
    assert.ok(h.fixture.reads.every(row => row.source === 'server'));
});
for (const [name, extra] of [['Sunday', { date: '2026-09-27' }], ['outside hours', { time: '20:30' }], ['malformed date', { date: '27-09-2026' }], ['fractional duration', { duration: 0.5 }], ['unknown technician', { techEmail: 'unknown@example.test' }]]) {
    test('final assignment rejects ' + name, async () => {
        const h = harness(); await assert.rejects(h.av_validateBookingAssignments([assignment(h, extra)]));
        assert.equal(h.fixture.writes.length, 0);
    });
}
for (const collection of ['Staff_Schedules', 'history', 'Users', 'Calendar_Blocks', 'Staff_Leave', 'Settings', 'Appointments', 'Active_Jobs']) {
    test('read failure blocks confirmation before a batch: ' + collection, async () => {
        const h = withConfirmation(harness()); h.fixture.fail = collection;
        await h.bk_confirmBooking(); assert.equal(h.fixture.batches, 0); assert.equal(h.fixture.writes.length, 0);
        assert.ok(h.fixture.messages.some(value => /failed/i.test(value)));
    });
}
test('schedule changing after selection blocks real final confirmation with zero writes', async () => {
    const h = withConfirmation(harness());
    assert.ok((await h.av_getSlotMap('2026-09-28', [h.fixture.email], 60))[900]);
    h.fixture.tables.Staff_Schedules[0].scheduleSegments.push({ effectiveFrom: '2026-09-28', workingDays: [], startTime: '10:00', endTime: '21:00' });
    await h.bk_confirmBooking(); assert.equal(h.fixture.batches, 0); assert.equal(h.fixture.writes.length, 0);
});
test('valid final confirmation retains the existing payload path in a synthetic DB', async () => {
    const h = withConfirmation(harness()); await h.bk_confirmBooking();
    assert.equal(h.fixture.commits, 1); assert.equal(h.fixture.writes.length, 1);
    assert.equal(h.fixture.writes[0].data.assignedTechEmail, h.fixture.email);
    assert.equal(h.fixture.writes[0].data.grandTotal, 100);
});
for (const collection of ['Appointments', 'Active_Jobs']) {
    test('fresh ' + collection + ' conflict blocks confirmation', async () => {
        const h = withConfirmation(harness());
        h.fixture.tables[collection].push({ id: 'synthetic-conflict', dateString: '2026-09-28', timeString: '15:00', bookedDuration: 60, assignedTechEmail: h.fixture.email, status: 'In Progress' });
        await h.bk_confirmBooking(); assert.equal(h.fixture.writes.length, 0); assert.equal(h.fixture.batches, 0);
    });
}
test('group member overlap cannot pass assignment validation', async () => {
    const h = harness(); await assert.rejects(h.av_validateBookingAssignments([assignment(h), assignment(h)]), /Group members/);
});
test('inactive or hidden technician cannot be saved', async () => {
    for (const flag of ['active', 'visibleToClients']) {
        const h = harness(); h.fixture.tables.Users[0][flag] = false;
        await assert.rejects(h.av_validateBookingAssignments([assignment(h)]), /no longer available/);
    }
});
test('single and group confirmation bind the same guard before batch creation', () => {
    const app = section(read('app.js'), 'window.bk_confirmBooking = async function()', 'function populateSuccessScreen(');
    const group = section(read('group-booking.js'), 'window.grp_confirmBooking = async function()', '//');
    for (const body of [app, group]) {
        assert.ok(body.includes('await window.av_validateBookingAssignments('));
        assert.ok(body.indexOf('await window.av_validateBookingAssignments(') < body.indexOf('db.batch()'));
    }
    assert.doesNotMatch(read('app.js'), /bk_hasSlotConflict\s*=\s*async\s*function\(\)\s*\{\s*return false/);
    assert.ok(read('index.html').indexOf('schedule-policy.js') < read('index.html').indexOf('src="app.js'));
});
test('actual group confirmation rejects one off-day member before batch creation', async () => {
    const h = withGroup(harness()); await h.grp_confirmBooking();
    assert.equal(h.fixture.batches, 0); assert.equal(h.fixture.writes.length, 0);
});
test('actual group confirmation preserves valid synthetic group payload', async () => {
    const h = withGroup(harness(), '2026-09-28'); await h.grp_confirmBooking();
    assert.equal(h.fixture.commits, 1); assert.equal(h.fixture.writes.length, 2);
    assert.ok(h.fixture.writes.every(row => row.data.isGroupBooking && row.data.groupTotal === 200));
});
test('late HF28 conflict override now invokes the real fail-closed validator', async () => {
    const h = harness(), app = read('app.js'), start = app.lastIndexOf('    window.bk_hasSlotConflict =');
    const recovery = app.slice(app.indexOf('(function thurayaClientEmergencyBookingRecoveryHF28'));
    require('node:vm').runInContext(section(recovery,'    function selectedDuration(){','    function safeTechs(){') + app.slice(start, app.indexOf('\n    };', start) + 7), h);
    assert.equal(await h.bk_hasSlotConflict(h.fixture.email, '2026-09-27', '15:00'), true);
    assert.equal(await h.bk_hasSlotConflict(h.fixture.email, '2026-09-28', '15:00'), false);
});
