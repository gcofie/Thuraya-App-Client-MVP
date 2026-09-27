'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const policy = require('./schedule-policy.js');
const vectors = require('./schedule-test-vectors.json');
for (const row of vectors.cases) {
    test(`shared schedule vector: ${row.name}`, () => {
        const records = vectors.history.map(data => policy.record(data));
        const before = JSON.stringify(records);
        const resolved = policy.resolve(records, row.date);
        assert.equal(policy.check(resolved, row.date, row.time, row.duration).ok, row.available);
        assert.equal(resolved.effectiveFrom, row.effective);
        assert.equal(JSON.stringify(records), before, 'resolution never rewrites history');
    });
}
test('Accra calendar Sunday is independent of process timezone', () => {
    for (const zone of ['Africa/Accra','America/Los_Angeles','Asia/Tokyo','Pacific/Kiritimati']) {
        const { execFileSync } = require('node:child_process');
        const result = execFileSync(process.execPath, ['-e', "process.stdout.write(require('./schedule-policy.js').weekday('2026-09-27'))"], {cwd:__dirname,env:{...process.env,TZ:zone},encoding:'utf8'});
        assert.equal(result, 'Sun');
    }
});
test('all-off schedule is retained, not discarded in favour of old working days', () => {
    const records = policy.records({scheduleSegments:[...vectors.history.slice(0,2),{effectiveFrom:'2026-09-27',workingDays:[],startTime:'10:00',endTime:'21:00'}]});
    assert.equal(policy.resolve(records,'2026-09-28').worksToday,false);
    assert.equal(records.length,3);
});
test('same effective date uses newest saved revision before evaluating weekday', () => {
    const data = vectors.history[2];
    const rows = [policy.record({...data,workingDays:['Sun'],savedAtMs:1}),policy.record({...data,savedAtMs:2})];
    assert.equal(policy.resolve(rows,'2026-09-27').worksToday,false);
});
test('missing, malformed and unknown weekday schedules fail closed', () => {
    for (const rows of [[],[policy.record({})],[policy.record({...vectors.history[2],workingDays:['Sunday']})],[policy.record({...vectors.history[2],startTime:'bad'})]]) {
        assert.equal(policy.resolve(rows,'2026-09-27').worksToday,false);
    }
});
test('calendar parser rejects ambiguous strings and rollover dates', () => {
    for (const date of ['09/27/2026','2026-9-27','2026-09-31','2026-09-27T00:00:00-05:00','',null]) assert.equal(policy.calendarDate(date),'');
    assert.equal(policy.calendarDate('27/09/2026'),'2026-09-27');
    assert.equal(policy.calendarDate('2028-02-29'),'2028-02-29');
});
