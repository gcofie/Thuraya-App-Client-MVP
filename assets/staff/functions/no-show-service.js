'use strict';
const crypto = require('node:crypto');
const model = require('./no-show-model.generated');
const individual = require('./no-show-individual.generated');
const { createAuthorization, fail } = require('./no-show-authorization');
const stable = v => JSON.stringify(v, (_, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const digest = v => crypto.createHash('sha256').update(stable(v)).digest('hex');
const version = s => s.exists ? (Number.isInteger(s.updateTime?.seconds) ? `${s.updateTime.seconds}:${s.updateTime.nanoseconds}` : s.updateTime?.toDate?.().toISOString() || '') : 'absent';
function exactId(v) { if (typeof v !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(v)) fail('invalid-argument', 'An exact booking reference is required.'); return v; }
function createNoShowService({ db, projectId, fieldValue, config = () => process.env.NO_SHOW_AUTHORIZATION_JSON, clock = () => new Date() }) {
    const authorize = createAuthorization({ db, projectId, config }), reader = { get: ref => ref.get() };
    const commandRef = (actor, requestId) => db.collection('No_Show_Commands').doc('ns_' + digest([actor.uid, exactId(requestId)]));
    function selection(data) {
        if (!['member', 'group-date'].includes(data.scope)) fail('invalid-argument', 'Choose member or entire-group booking-date scope.');
        return { appointmentId: exactId(data.appointmentId), scope: data.scope };
    }
    async function inspect(read, request, actor) {
        const scope = selection(request.data), selected = await read.get(db.collection('Appointments').doc(scope.appointmentId));
        if (!selected.exists) fail('not-found', 'This booking no longer exists.');
        const first = selected.data(), grouped = model.isGroup(first), today = model.businessDate(clock());
        if (first.archived === true && scope.scope === 'group-date') fail('failed-precondition', 'The selected booking is archived. Select a current group member.');
        if (!grouped && scope.scope !== 'member') fail('invalid-argument', 'This booking is not a group member.');
        if (grouped && !String(first.groupId || '').trim()) fail('failed-precondition', 'The group identifier needs review before No Show can be applied.');
        let appointments = [selected], groupJobs = [];
        if (grouped) {
            const query = await read.get(db.collection('Appointments').where('groupId', '==', first.groupId).limit(51));
            if (query.docs.length > 50) fail('resource-exhausted', 'This group requires a controlled lifecycle review.');
            appointments = query.docs;
            if (!appointments.some(s => s.id === selected.id)) fail('aborted', 'Booking state changed. Refresh and try again.');
            const jobs = await read.get(db.collection('Active_Jobs').where('groupId', '==', first.groupId).limit(101));
            if (jobs.docs.length > 100) fail('resource-exhausted', 'This group has too many job records for a safe No Show action.');
            groupJobs = jobs.docs;
        }
        appointments.sort((a, b) => a.id.localeCompare(b.id));
        const allJobs = new Map(groupJobs.map(s => [s.id, s])), links = new Map();
        for (const snap of appointments) {
            const direct = await read.get(db.collection('Active_Jobs').doc(snap.id));
            const matches = await read.get(db.collection('Active_Jobs').where('sourceAppointmentId', '==', snap.id).limit(3));
            const found = new Map(matches.docs.map(s => [s.id, s]));
            if (direct.exists) found.set(direct.id, direct);
            const explicit = snap.data().activeJobId;
            if (explicit && explicit !== snap.id) {
                const linked = await read.get(db.collection('Active_Jobs').doc(exactId(explicit)));
                if (linked.exists) found.set(linked.id, linked);
            }
            links.set(snap.id, [...found.values()]);
            for (const s of found.values()) allJobs.set(s.id, s);
        }
        const unlinked = groupJobs.some(j => !appointments.some(p => j.id === p.id || j.data().sourceAppointmentId === p.id));
        const decisions = [], eligible = [];
        for (const snap of appointments) {
            const row = snap.data(), jobs = links.get(snap.id).map(s => ({ id: s.id, ref: s.ref, data: s.data() }));
            let state;
            if (row.archived === true) state = { eligible: false, code: 'ARCHIVED', reason: 'This booking is archived.' };
            else if (scope.scope === 'member' && snap.id !== selected.id) state = { eligible: false, code: 'OTHER_MEMBER', reason: 'Another member; unchanged.' };
            else if (scope.scope === 'group-date' && row.dateString !== first.dateString) state = { eligible: false, code: 'OTHER_DATE', reason: 'A different booking date; unchanged.' };
            else if (grouped) {
                state = model.classifyMember(row, jobs, today);
                if (state.eligible && unlinked) state = { eligible: false, code: 'LINKAGE_REVIEW', reason: 'Group job evidence cannot be linked safely. Manual review is required.' };
            } else {
                const d = individual.evaluateNoShow(snap.id, row, jobs);
                state = { eligible: d.allowed, code: d.code, reason: d.message || 'This booking will be marked No Show.', linkedJob: d.job };
                if (!model.validDate(row.dateString) || row.dateString > today) state = { eligible: false, code: 'NOT_DUE', reason: 'The booking date is not yet eligible or needs review.' };
            }
            if (state.eligible) eligible.push({ snap, linkedJob: grouped ? null : state.linkedJob });
            decisions.push({ appointmentId: snap.id, client: String(row.clientName || 'Group member'), date: row.dateString || '', time: row.timeString || '',
                service: String(row.bookedService || ''), subgroup: row.subGroupIndex ?? null, status: row.status || 'Unknown', eligible: state.eligible, code: state.code, reason: state.reason });
        }
        // Transactional query reads protect both the member set and legacy job-link population.
        const fingerprint = digest({ projectId, actor: actor.uid, scope, today, selectedDate: first.dateString,
            appointments: appointments.map(s => [s.id, version(s)]), jobs: [...allJobs.values()].sort((a, b) => a.id.localeCompare(b.id)).map(s => [s.id, version(s)]) });
        const summaryRows = appointments.map(s => ({ ...s.data(), linkedFinancial: links.get(s.id).some(j => model.protection(j.data())?.code === 'FINANCIAL') }));
        return { fingerprint, eligible, appointments, summaryRows, public: { version: 1, projectId, scope: scope.scope, appointmentId: selected.id,
            groupId: grouped ? first.groupId : null, scopeDate: first.dateString || '', today,
            scopeLabel: scope.scope === 'group-date' ? `Entire group on ${first.dateString}; all subgroups. Other dates stay unchanged.` : 'Only the selected member or individual booking.',
            eligibleCount: eligible.length, skippedCount: decisions.length - eligible.length, members: decisions,
            groupSummary: model.groupSummary(summaryRows), fingerprint } };
    }
    function lifecycle(actor) {
        const p = { status: 'No Show', noShowAt: fieldValue.serverTimestamp(), noShowBy: actor.email,
            availabilityReleasedAt: fieldValue.serverTimestamp(), updatedAt: fieldValue.serverTimestamp(), needsFOHAttention: false, rescheduleRequested: false };
        for (const k of ['fohAction', 'returnedToFOHAt', 'returnedToFOHBy', 'rescheduleRequestedAt', 'rescheduleRequestedBy', 'needsFohReview', 'requiresFohAction', 'requestReschedule', 'pendingReschedule', 'returnedToFOH', 'returnToFoh']) p[k] = fieldValue.delete();
        return p;
    }
    async function commit(request, actor) {
        selection(request.data);
        if (!/^[a-f0-9]{64}$/.test(request.data.fingerprint || '')) fail('invalid-argument', 'Review the No Show impact before confirming.');
        const receipt = commandRef(actor, request.data.requestId), inputHash = digest({ ...selection(request.data), fingerprint: request.data.fingerprint });
        return db.runTransaction(async tx => {
            await authorize(request, tx);
            const old = await tx.get(receipt);
            if (old.exists) {
                if (old.data().actorUid !== actor.uid || old.data().inputHash !== inputHash) fail('already-exists', 'This request was used for a different No Show action. Refresh and try again.');
                return { ...old.data().result, replayed: true };
            }
            const plan = await inspect(tx, request, actor);
            if (plan.fingerprint !== request.data.fingerprint) fail('aborted', 'Booking state changed. Refresh the impact preview and try again.');
            if (!plan.eligible.length) return { state: 'NO_CHANGE', changedIds: [], skipped: plan.public.members, groupSummary: plan.public.groupSummary };
            for (const item of plan.eligible) {
                tx.update(item.snap.ref, lifecycle(actor));
                if (item.linkedJob) {
                    const p = lifecycle(actor), j = item.linkedJob.data;
                    if (j.serviceStatus || ['waiting', 'arrived', 'action required', 'foh review'].includes(model.normalize(j.status))) p.serviceStatus = 'No Show';
                    tx.update(item.linkedJob.ref, p);
                }
            }
            const changedIds = plan.eligible.map(s => s.snap.id);
            const result = { state: 'COMMITTED', changedIds, skipped: plan.public.members.filter(m => !m.eligible).map(m => ({ appointmentId: m.appointmentId, code: m.code, reason: m.reason })),
                groupSummary: model.groupSummary(plan.summaryRows.map((row, i) => ({ ...row, ...(changedIds.includes(plan.appointments[i].id) ? { status: 'No Show' } : {}) }))) };
            tx.create(receipt, { version: 1, actorUid: actor.uid, actorEmail: actor.email, inputHash, requestId: request.data.requestId,
                confirmedAt: fieldValue.serverTimestamp(), scope: request.data.scope, appointmentId: request.data.appointmentId, result });
            return result;
        });
    }
    async function restore(request, actor) {
        const id = exactId(request.data.appointmentId);
        if (!['reinstate', 'reschedule'].includes(request.data.mode)) fail('invalid-argument', 'Choose a valid No Show follow-up action.');
        return db.runTransaction(async tx => {
            await authorize(request, tx);
            const ref = db.collection('Appointments').doc(id), snap = await tx.get(ref);
            if (!snap.exists || snap.data().archived || !model.isNoShow(snap.data().status)) fail('failed-precondition', 'Only a current, non-archived No Show booking can be reopened.');
            const row = snap.data(), direct = await tx.get(db.collection('Active_Jobs').doc(id));
            const jobs = await tx.get(db.collection('Active_Jobs').where('sourceAppointmentId', '==', id).limit(1));
            if (model.protection(row) || direct.exists || jobs.docs.length || row.activeJobId) fail('failed-precondition', 'This booking has service or financial evidence. Review its linked records before reopening.');
            const now = fieldValue.serverTimestamp();
            tx.update(ref, { status: request.data.mode === 'reinstate' ? 'Scheduled' : 'Action Required', autoNoShow: false,
                reinstatedAt: now, reinstatedBy: actor.email, updatedAt: now });
            return { state: 'REOPENED', appointmentId: id };
        });
    }
    async function handle(request) {
        const actor = await authorize(request), command = request.data?.command;
        if (command === 'capabilities') return { version: 1, projectId, noShow: true };
        if (command === 'preview') return (await inspect(reader, request, actor)).public;
        if (command === 'commit') return commit(request, actor);
        if (command === 'restore') return restore(request, actor);
        if (command === 'status') { const s = await reader.get(commandRef(actor, request.data.requestId)); return s.exists && s.data().actorUid === actor.uid ? s.data().result : { state: 'NOT_COMMITTED' }; }
        fail('invalid-argument', 'Unknown No Show operation.');
    }
    return { handle };
}
module.exports = { createNoShowService };
