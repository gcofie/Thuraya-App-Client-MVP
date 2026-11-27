const test = require('node:test');
const assert = require('node:assert/strict');

const attendance = require('./attendance-aggregator.js');

const DAY = '2026-09-05';

function iso(time) {
    return `${DAY}T${time}:00.000Z`;
}

function doc(id, data, refId = id) {
    return {
        id,
        ref: { id: refId },
        data: () => data
    };
}

function snap(docs) {
    return {
        docs,
        empty: docs.length === 0,
        forEach: cb => docs.forEach(cb)
    };
}

function aggregate(docs) {
    return attendance.aggregateDocuments(docs, { date: DAY });
}

function one(docs) {
    const result = aggregate(docs);
    assert.equal(result.aggregates.length, 1);
    return result.aggregates[0];
}

function openDoc(email = 'tech@example.com', extra = {}) {
    return doc(`${email}_${DAY}`, {
        email,
        name: 'Tech One',
        roles: ['Tech'],
        date: DAY,
        clockIn: iso('08:00'),
        ...extra
    });
}

function closedDoc(email = 'tech@example.com', extra = {}) {
    return doc(`${email}_${DAY}`, {
        email,
        name: 'Tech One',
        roles: ['Tech'],
        date: DAY,
        clockIn: iso('08:00'),
        clockOut: iso('10:00'),
        ...extra
    });
}

function fakeDb({ dateDocs = [], dateStringDocs = [], directDocs = {}, listenerSink = null } = {}) {
    function makeQuery(filters) {
        return {
            filters,
            where(field, op, value) {
                return makeQuery([...filters, [field, op, value]]);
            },
            async get() {
                const first = filters[0] || [];
                if (first[0] === 'date') return snap(dateDocs);
                if (first[0] === 'dateString') return snap(dateStringDocs);
                return snap([]);
            },
            onSnapshot(cb) {
                if (!listenerSink) throw new Error('listenerSink not configured');
                listenerSink.push({ filters, cb });
                return () => {
                    const index = listenerSink.findIndex(row => row.cb === cb);
                    if (index >= 0) listenerSink.splice(index, 1);
                };
            }
        };
    }

    return {
        collection() {
            return {
                doc(id) {
                    return {
                        id,
                        async get() {
                            if (!directDocs[id]) return { id, exists: false };
                            return doc(id, directDocs[id]);
                        }
                    };
                },
                where(field, op, value) {
                    return makeQuery([[field, op, value]]);
                }
            };
        }
    };
}

test('1. no attendance documents returns no attendance state', () => {
    assert.equal(aggregate([]).aggregates.length, 0);
});

test('2. one open root-level shift is present / clocked in', () => {
    const result = one([openDoc()]);
    assert.equal(result.state, 'clocked_in');
    assert.equal(result.isPresent, true);
});

test('3. one closed root-level shift worked today / clocked out', () => {
    const result = one([closedDoc()]);
    assert.equal(result.state, 'clocked_out');
    assert.equal(result.workedToday, true);
    assert.equal(result.isPresent, false);
});

test('4. closed shift followed by new open shift is present', () => {
    const result = one([
        closedDoc(),
        doc(`tech@example.com_${DAY}_shift_1700000000000`, {
            email: 'tech@example.com',
            name: 'Tech One',
            roleString: 'Tech',
            dateString: DAY,
            clockIn: iso('12:30')
        })
    ]);
    assert.equal(result.state, 'clocked_in');
    assert.equal(result.sessionCount, 2);
    assert.equal(result.effectiveSession.sourceSchema, 'timestamp_doc_root');
});

test('5. two independent Attendance docs for same technician/day collapse to one aggregate', () => {
    const result = aggregate([
        closedDoc(),
        doc(`tech@example.com_${DAY}_shift_1700000000000`, {
            email: 'tech@example.com',
            roles: ['Tech'],
            dateString: DAY,
            clockIn: iso('11:00'),
            clockOut: iso('12:00')
        })
    ]);
    assert.equal(result.aggregates.length, 1);
    assert.equal(result.aggregates[0].sessionCount, 2);
});

test('6. multiple open documents retain one technician aggregate with diagnostics', () => {
    const result = one([
        openDoc('tech@example.com'),
        doc(`tech@example.com_${DAY}_shift_1700000000000`, {
            email: 'tech@example.com',
            roles: ['Tech'],
            dateString: DAY,
            clockIn: iso('10:00')
        })
    ]);
    assert.equal(result.state, 'clocked_in');
    assert.equal(result.openSessionCount, 2);
    assert.equal(result.multipleOpen, true);
});

test('7. closed root clockOut with an open shifts[] session is present', () => {
    const result = one([
        doc(`tech@example.com_${DAY}`, {
            email: 'tech@example.com',
            roles: ['Tech'],
            date: DAY,
            clockIn: iso('08:00'),
            clockOut: iso('09:00'),
            shifts: [
                { id: 'second', clockIn: iso('10:00') }
            ]
        })
    ]);
    assert.equal(result.state, 'clocked_in');
    assert.equal(result.effectiveSession.sessionId, 'second');
});

test('8. two completed sessions preserve full history and worked-today state', () => {
    const result = one([
        doc(`tech@example.com_${DAY}`, {
            email: 'tech@example.com',
            roles: ['Tech'],
            date: DAY,
            shifts: [
                { id: 'am', clockIn: iso('08:00'), clockOut: iso('09:00') },
                { id: 'pm', clockIn: iso('13:00'), clockOut: iso('14:30') }
            ]
        })
    ]);
    assert.equal(result.state, 'clocked_out');
    assert.equal(result.sessionCount, 2);
    assert.equal(result.totalMinutesWorked, 150);
});

test('9. date-only record is included', () => {
    const result = one([openDoc('dateonly@example.com', { dateString: undefined })]);
    assert.equal(result.day, DAY);
});

test('10. dateString-only record is included', () => {
    const result = one([
        doc(`datestring@example.com_${DAY}`, {
            email: 'datestring@example.com',
            roles: ['Tech'],
            dateString: DAY,
            clockIn: iso('08:00')
        })
    ]);
    assert.equal(result.day, DAY);
});

test('11. same document returned by date and dateString query paths is deduplicated', async () => {
    const same = openDoc('dedupe@example.com');
    const rows = await attendance.fetchDayDocs(fakeDb({ dateDocs: [same], dateStringDocs: [same] }), DAY);
    assert.equal(rows.length, 1);
});

test('12. archived Attendance is ignored for current attendance', () => {
    assert.equal(aggregate([openDoc('archived@example.com', { archived: true })]).aggregates.length, 0);
});

test('13. schedule exists with no attendance remains no attendance at aggregate layer', () => {
    const result = aggregate([]);
    assert.equal(result.aggregates.length, 0);
});

test('14. no schedule but valid open attendance is still present', () => {
    const result = one([openDoc('unscheduled@example.com')]);
    assert.equal(result.isPresent, true);
});

test('15. approved leave with no attendance leaves attendance empty', () => {
    const result = aggregate([]);
    assert.equal(result.byEmailDate['leave@example.com|' + DAY], undefined);
});

test('16. leave plus actual attendance exposes real attendance instead of discarding it', () => {
    const result = one([openDoc('leave-present@example.com')]);
    assert.equal(result.isPresent, true);
});

test('17. different technicians on the same date remain independent aggregates', () => {
    const result = aggregate([
        openDoc('one@example.com'),
        closedDoc('two@example.com')
    ]);
    assert.equal(result.aggregates.length, 2);
});

test('18. technician identity case variation aggregates together', () => {
    const result = one([
        openDoc('Tech@Example.com'),
        doc(`tech@example.com_${DAY}_shift_1700000000000`, {
            email: 'tech@example.com',
            roles: ['Tech'],
            dateString: DAY,
            clockIn: iso('11:00'),
            clockOut: iso('12:00')
        })
    ]);
    assert.equal(result.email, 'tech@example.com');
    assert.equal(result.sessionCount, 2);
});

test('19. page refresh / repeated aggregation is stable', () => {
    const docs = [closedDoc('stable@example.com')];
    const first = one(docs);
    const second = one(docs);
    assert.deepEqual(first.sourceDocIds, second.sourceDocIds);
    assert.equal(first.state, second.state);
});

test('20. listener update after new open shift changes roster state without duplicate row', () => {
    const listeners = [];
    const db = fakeDb({ listenerSink: listeners });
    const calls = [];
    const unsubscribe = attendance.listenDay(db, DAY, result => calls.push(result));

    listeners[0].cb(snap([]));
    listeners[1].cb(snap([]));
    assert.equal(calls.at(-1).aggregates.length, 0);

    listeners[0].cb(snap([openDoc('listener@example.com')]));
    const latest = calls.at(-1);
    assert.equal(latest.aggregates.length, 1);
    assert.equal(latest.aggregates[0].isPresent, true);

    unsubscribe();
    assert.equal(listeners.length, 0);
});
