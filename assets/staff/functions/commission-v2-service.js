'use strict';

const crypto = require('node:crypto');
const engine = require('./commission-engine');
const legacyEngine = require('./commission-legacy');
const { normalizeLegacyMenu } = require('./commission-legacy-menu');
const { createCommissionAuthorization } = require('./commission-authorization');
const enrollment = require('./commission-enrollment');
const materiality = require('./commission-materiality-policy');
const { evidence } = require('./gift-checkout-policy.generated');

const COLLECTIONS = ['Commission_Settings', 'Commission_Rules', 'Commission_Locks', 'Commission_Records'];
const GUARD = 'v2_control';
const LEGACY_ACTIONS = new Set(['legacySaveRule', 'legacyToggleRule', 'legacyDeleteRule', 'legacyLock']);
const hash = value => crypto.createHash('sha256').update(engine.stable(value)).digest('hex');
const plain = value => {
    if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map(plain);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).map(([k, v]) => [k, plain(v)]));
    return value;
};
function error(code, message) { const e = new Error(message || code); e.code = code; throw e; }
function id(value) { if (typeof value !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value)) error('invalid-argument', 'Invalid identifier'); return value; }
function requireManager(user) { if (!user.manager) error('permission-denied', 'An approved Commission operator with an Admin/Manager Staff role is required'); }
function requireOwner(user) { if (!user.admin) error('permission-denied', 'An approved Admin or System Admin is required for audit exceptions'); }
function reportFinancialProjection(rows, sources) {
    const jobs = new Map();
    rows.forEach((row, index) => {
        const key = row.source + ':' + row.jobId;
        if (!jobs.has(key)) {
            const financial = evidence.storedRead(sources.get(key));
            jobs.set(key, { source: row.source, jobId: row.jobId, compensationRowIndexes: [],
                grossServiceValue: financial.gross, taxableSubtotal: financial.net,
                taxTotal: financial.tax.available ? financial.tax.taxTotal : null,
                finalServiceGross: financial.finalGross, amountDue: financial.due, paidAmount: financial.paid,
                pricingMode: financial.mode || null, taxEvidence: financial.tax, lineEvidence: financial.lines,
                settlementEvidenceAvailable: financial.available, contradictions: financial.contradictions });
        }
        jobs.get(key).compensationRowIndexes.push(index);
    });
    // Financial reporting is independent of the frozen rows used for remuneration and locking.
    return { schemaVersion: 1, readOnly: true, scope: 'legacy-report-jobs', compensationContract: 'frozen-legacy', jobs: [...jobs.values()] };
}
function createCommissionService({ db, projectId, now = () => new Date(), legacy = null, resolveLoginUid = null, operatorConfig = () => process.env.COMMISSION_OPERATORS_JSON || '', targetConfigurationEnabled = () => process.env.COMMISSION_V2_ENABLED === 'true' }) {
    if (!projectId) throw new Error('Explicit Firebase project required');
    const resolveActor = createCommissionAuthorization({ db, projectId, operatorConfig });
    const ref = (collection, key) => db.collection(collection).doc(key);
    const read = async (reader, collection) => {
        const snap = await reader.get(db.collection(collection));
        if (snap.size > 5000) error('resource-exhausted', 'Commission scan limit exceeded');
        return snap.docs.map(d => ({ ...plain(d.data()), id: d.id, _updateTime: d.updateTime ? plain(d.updateTime) : null }));
    };
    async function state(reader) {
        const data = {};
        for (const c of COLLECTIONS) data[c] = await read(reader, c);
        const settings = data.Commission_Settings;
        const allPersons = settings.filter(s => s.recordType === 'commission_person');
        const persons = allPersons.filter(p => p.status !== 'VOIDED');
        const bindingIds = new Set(persons.flatMap(p => Object.values(p.bindingHeads || {})));
        const bindings = settings.filter(s => s.recordType === 'commission_identity_binding' && bindingIds.has(s.id));
        return { data, persons, allPersons, bindings, guard: settings.find(s => s.id === GUARD), rules: engine.ruleHeads(data.Commission_Rules, persons), records: data.Commission_Records, locks: data.Commission_Locks };
    }
    const reader = { get: query => query.get() };
    const allowedPeople = (s, user) => s.persons.filter(p => user.manager || (p.accessUids || []).includes(user.uid));
    function assertEnabled(s) {
        if (!s.guard || s.guard.enabled !== true) error('failed-precondition', 'Commission target rules are not enabled');
        if (!targetConfigurationEnabled()) error('failed-precondition', 'Target rules require separate configuration authorization');
    }
    function protectLocks(s, personId, range) {
        const p = s.persons.find(x => x.personId === personId);
        const emails = new Set(s.bindings.filter(b => b.personId === personId).map(b => b.stationEmail));
        for (const record of s.records) {
            if (!['locked', 'approved'].includes(record.approvalStatus) && record.payoutStatus !== 'paid') continue;
            const personMatches = record.personId === personId || (!record.personId && (emails.has(record.staffEmail) || !record.staffEmail));
            const recordRange = { effectiveFrom: record.businessDate || record.periodStart, effectiveUntil: record.businessDate ? nextDay(record.businessDate) : (record.periodEnd ? nextDay(record.periodEnd) : null) };
            if (personMatches && (!engine.date(recordRange.effectiveFrom) || engine.overlaps(range, recordRange))) error('failed-precondition', 'Locked commission coverage cannot change');
        }
        for (const lock of s.locks.filter(l => l.schemaVersion !== 2)) {
            if (['all', 'tech', undefined].includes(lock.roleFilter) && (!engine.date(lock.periodStart) || engine.overlaps(range, { effectiveFrom: lock.periodStart, effectiveUntil: lock.periodEnd ? nextDay(lock.periodEnd) : null }))) error('failed-precondition', 'Legacy lock overlap requires review');
        }
        return p;
    }
    function nextDay(day) { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); }
    function backdate(data, range, stamp) {
        if (range.effectiveFrom < engine.today(new Date(stamp)) && (!data.backdateConfirmed || !String(data.approvalReason || data.notes || '').trim())) error('failed-precondition', 'Backdating requires explicit owner-approved confirmation and reason');
    }
    async function validateLogins(reader, s, personId, uids, staffRef, previous = []) {
        if (uids.some(uid => s.persons.some(p => p.personId !== personId && (p.accessUids || []).includes(uid)))) error('failed-precondition', 'Login already belongs to another person');
        if (hash(uids) === hash(previous) || !uids.length) return;
        if (!resolveLoginUid || !staffRef || staffRef.includes('/')) error('failed-precondition', 'A trusted Staff profile and Firebase Auth lookup are required for a changed login');
        const snap = await reader.get(ref('Users', staffRef));
        if (!snap.exists) error('failed-precondition', 'Confirmed login Staff profile not found');
        const staff = snap.data(), email = String(staff.email || staffRef).trim().toLowerCase();
        if (staff.active === false || staff.disabled === true || ['disabled', 'inactive', 'terminated'].includes(String(staff.status || '').trim().toLowerCase())) error('failed-precondition', 'Confirmed login Staff profile is inactive');
        for (const uid of uids) {
            id(uid);
            let auth;
            try { auth = await resolveLoginUid(uid); } catch (_) { error('failed-precondition', 'Confirmed login UID does not resolve to an active Firebase Auth account'); }
            if (!auth || auth.uid !== uid || auth.disabled || String(auth.email || '').trim().toLowerCase() !== email) error('failed-precondition', 'Confirmed login UID must match the selected Staff profile Auth account');
        }
    }
    async function correctionImpact(reader, s, proposal, user, stamp) {
        const plan = enrollment.planCorrection(s, proposal, engine.today(new Date(stamp)));
        await validateLogins(reader, s, plan.person.personId, plan.nextPerson.accessUids, plan.nextPerson.staffRef, plan.person.staffRef === plan.nextPerson.staffRef ? plan.person.accessUids || [] : []);
        const jobs = await read(reader, 'Active_Jobs');
        const coverage = enrollment.protectedCoverage(s, proposal.personId, plan.ranges, [plan.binding]);
        const emails = new Set([plan.old.stationEmail, plan.binding.stationEmail].filter(Boolean).map(v => v.toLowerCase()));
        const candidates = jobs.filter(j => (!engine.date(j.dateString) || plan.ranges.some(r => engine.contains(r, j.dateString))) &&
            (j.personId === proposal.personId || j.technicianPersonId === proposal.personId || [j.assignedTechEmail, j.techEmail].some(email => emails.has(String(email || '').trim().toLowerCase())) || [plan.old.staffId, plan.binding.staffId].filter(Boolean).some(id => [j.technicianStaffId, j.assignedTechId, j.techId].includes(id))));
        const canonical = Object.fromEntries(Object.entries(proposal).filter(([key]) => !['requestId', 'expectedRevision', 'impactFingerprint', 'correctionConfirmed'].includes(key)));
        return { required: true, classification: plan.classification, material: plan.material, backdated: plan.backdated,
            start: plan.ranges.map(r => r.effectiveFrom).sort()[0] || null,
            until: !plan.ranges.length || plan.ranges.some(r => !r.effectiveUntil) ? null : plan.ranges.map(r => r.effectiveUntil).sort().at(-1),
            affectedRanges: plan.ranges, personId: proposal.personId, currentValues: plan.before, proposedValues: plan.after,
            changes: plan.changes, removedExclusions: plan.removedExclusions, previousRevision: plan.previousRevision, newRevision: plan.newRevision,
            candidateJobCount: candidates.length, candidateJobs: candidates.map(j => ({ id: j.id, businessDate: j.dateString || null, aliases: [j.assignedTechName, j.techName, j.technicianName].filter(Boolean) })),
            effectiveRules: s.rules.filter(r => r.technicianPersonId === proposal.personId), currentDays: [],
            lockedDays: coverage.records.length, lockedPeriods: coverage.locks.map(l => ({ id: l.id, from: l.periodStart, until: l.periodEnd })),
            snapshots: coverage.records.map(r => ({ id: r.id, businessDate: r.businessDate || null, from: r.periodStart || null, until: r.periodEnd || null })),
            blocked: coverage.blocked, blockReason: coverage.blocked ? 'LOCKED PERIOD CORRECTION REQUIRES SEPARATE CONTROLLED CORRECTION WORKFLOW' : null,
            interpretation: 'Only unlocked identity attribution may change. No Commission payout is recalculated or written by this preview.',
            fingerprint: hash({ canonical, jobs, state: s.data, revision: s.guard?.revision || 0, actorUid: user.uid }) };
    }
    async function impact(reader, s, proposal, user, stamp) {
        requireManager(user);
        if (proposal.action === 'voidEnrollment') {
            if (!user.admin) error('permission-denied', 'An approved Admin or System Admin is required to void enrollment');
            const jobs = await read(reader, 'Active_Jobs'), plan = enrollment.voidPlan(s, proposal, jobs);
            const canonical = Object.fromEntries(Object.entries(proposal).filter(([key]) => !['requestId', 'expectedRevision', 'impactFingerprint', 'voidConfirmed'].includes(key)));
            return { required: true, action: 'voidEnrollment', personId: plan.person.personId, displayName: plan.person.displayName,
                start: plan.person.enrollmentFrom, until: null, blocked: plan.blocked,
                blockReason: plan.blocked ? 'Enrollment has source activity, rules or protected Commission evidence. Void requires a separate controlled workflow.' : null,
                candidateJobCount: plan.candidates.length, ruleCount: plan.rules.length, snapshotCount: plan.records.length, lockedDays: plan.locks.length,
                dependencies: { jobs: plan.candidates.map(j => j.id), rules: plan.rules.map(r => r.id), records: plan.records.map(r => r.id), locks: plan.locks.map(l => l.id) },
                currentDays: [], fingerprint: hash({ canonical, jobs, state: s.data, actor: user.uid }) };
        }
        if (proposal.action === 'correctEnrollment') return correctionImpact(reader, s, proposal, user, stamp);
        const start = proposal.action === 'enrollPerson' ? proposal.enrollmentFrom : proposal.action === 'saveBinding' ? proposal.binding?.effectiveFrom : ['closeRule', 'closeBinding'].includes(proposal.action) ? proposal.effectiveUntil : ['saveRule', 'successor'].includes(proposal.action) ? proposal.rule?.effectiveFrom : null;
        const today = engine.today(new Date(stamp));
        if (!start || start >= today) return { required: false };
        backdate(proposal, { effectiveFrom: start }, stamp);
        const dates = engine.days(start, today);
        const jobs = await read(reader, 'Active_Jobs');
        const affected = jobs.filter(j => !engine.date(j.dateString) || (j.dateString >= start && j.dateString < today));
        const knownPerson = s.persons.find(p => p.personId === proposal.personId);
        const current = knownPerson ? await preview(reader, s, { personId: proposal.personId, start, end: dates[dates.length - 2] || start }, user) : null;
        const canonical = Object.fromEntries(Object.entries(proposal).filter(([key]) => !['requestId', 'expectedRevision', 'impactFingerprint'].includes(key)));
        return { required: true, start, until: today, personId: proposal.personId, candidateJobCount: affected.length, currentDays: current?.rows || [], lockedDays: (current?.rows || []).filter(r => r.locked).length, fingerprint: hash({ canonical, jobs, state: s.data, revision: s.guard?.revision || 0 }) };
    }
    async function materialityContext(reader, s, jobs, diagnostics = []) {
        const evidence = {};
        for (const collection of materiality.EVIDENCE_COLLECTIONS) evidence[collection] = await read(reader, collection);
        return { jobs, persons: s.persons, bindings: s.bindings, rules: s.rules, evidence, complete: true, diagnostics };
    }
    async function auditPreview(reader, s, data, user) {
        requireOwner(user); assertEnabled(s);
        if (!engine.date(data.businessDate) || data.businessDate >= engine.today(now())) error('failed-precondition', 'A completed business date is required');
        if (!s.persons.some(p => p.personId === data.personId)) error('not-found', 'Commission person not found');
        const jobs = (await read(reader, 'Active_Jobs')).map(j => ({ ...j, _source: 'Active_Jobs' }));
        const evaluated = engine.buildCommissionDays({ jobs, persons: s.persons, bindings: s.bindings, rules: s.rules, start: data.businessDate, end: data.businessDate, complete: true });
        const row = evaluated.rows.find(r => r.personId === data.personId);
        if (!row) error('failed-precondition', 'Configured Commission day required');
        const context = await materialityContext(reader, s, jobs, evaluated.diagnostics);
        const proof = materiality.evaluate(row, context);
        const events = s.data.Commission_Settings.filter(e => e.schemaVersion === 2 && e.id.startsWith('v2_materiality_event_') && e.recordType === materiality.EVENT && e.personId === data.personId && e.businessDate === data.businessDate);
        const locked = s.records.some(r => r.personId === data.personId && r.businessDate === data.businessDate && ['locked', 'approved'].includes(r.approvalStatus));
        return { row: { ...row, locked }, proof, disposition: materiality.disposition(proof, materiality.latest(events, data.personId, data.businessDate)), events, revision: s.guard.revision };
    }
    async function preview(reader, s, data, user) {
        engine.days(data.start, data.end);
        const persons = allowedPeople(s, user).filter(p => !data.personId || p.personId === data.personId);
        if (data.personId && !persons.length) error('permission-denied', 'Person access is not authorized');
        const jobs = (await read(reader, 'Active_Jobs')).map(j => ({ ...j, _source: 'Active_Jobs' }));
        const all = engine.buildCommissionDays({ jobs, persons: s.persons, bindings: s.bindings, rules: s.rules, start: data.start, end: data.end, complete: true });
        const permitted = new Set(persons.map(p => p.personId));
        const rows = all.rows.filter(r => permitted.has(r.personId));
        const snapshots = s.records.filter(r => r.schemaVersion === 2 && r.recordType === 'commission_daily_snapshot' && permitted.has(r.personId) && r.businessDate >= data.start && r.businessDate <= data.end);
        const context = rows.some(r => r.pending.length) || snapshots.some(r => r.auditException) ? await materialityContext(reader, s, jobs, all.diagnostics) : null;
        const roots = new Map();
        const audit = new Map();
        for (const row of rows) {
            if (!context || (!row.pending.length && !snapshots.some(snap => snap.personId === row.personId && snap.businessDate === row.businessDate && snap.auditException))) continue;
            if (!roots.has(row.businessDate)) roots.set(row.businessDate, materiality.fingerprints(context, row.businessDate));
            const proof = materiality.evaluate(row, context, roots.get(row.businessDate)), event = materiality.latest(s.data.Commission_Settings, row.personId, row.businessDate);
            audit.set(row.personId + ':' + row.businessDate, { proof, disposition: materiality.disposition(proof, event), event });
        }
        const live = rows.map(row => {
            const locked = snapshots.find(r => r.personId === row.personId && r.businessDate === row.businessDate);
            const state = audit.get(row.personId + ':' + row.businessDate);
            let disposition = state?.disposition || null;
            if (locked?.auditException && (locked.auditException.id !== disposition?.approvalId || locked.auditException.certificate.proofFingerprint !== state?.proof.proofFingerprint)) disposition = { ...disposition, state: 'STALE', valid: false };
            const extra = { auditDisposition: disposition, finalizationEligible: row.dailyPayable !== null || disposition?.valid === true };
            if (!locked) return { ...row, ...extra };
            return { ...locked.calculation, ...extra, locked: true, lockId: locked.lockId, recordId: locked.id, sourceChanged: hash(row) !== locked.calculationHash || (locked.auditException && !disposition?.valid) };
        });
        const fingerprint = hash({ engine: engine.VERSION, start: data.start, end: data.end, personId: data.personId || null, rows, jobs, persons: s.persons, rules: s.rules, bindings: s.bindings, revision: s.guard.revision });
        return { rows: live, unlockedRows: rows, snapshots, diagnostics: user.manager ? all.diagnostics : [], summary: engine.summarizeCommissionPeriod(live), fingerprint, revision: s.guard.revision, start: data.start, end: data.end, engineVersion: engine.VERSION };
    }
    async function legacyReport(reader, s, data, user, includeFinancialProjection = false) {
        engine.days(data.start, data.end);
        const active = (await read(reader, 'Active_Jobs')).map(j => ({ ...j, _source: 'Active_Jobs' }));
        const closed = row => row.archived !== true && String(row.status || '').trim().toLowerCase() === 'closed' && row.dateString >= data.start && row.dateString <= data.end;
        const jobs = active.filter(closed);
        const sources = new Set(jobs.map(j => j.sourceAppointmentId).filter(Boolean));
        const appointments = await read(reader, 'Appointments');
        jobs.push(...appointments.filter(j => closed(j) && !sources.has(j.id)).map(j => ({ ...j, _source: 'Appointments' })));
        jobs.sort((a, b) => `${a.dateString || ''}${a.timeString || ''}`.localeCompare(`${b.dateString || ''}${b.timeString || ''}`));
        const rules = s.data.Commission_Rules.filter(r => r.schemaVersion !== 2 && r.active !== false && (!data.roleFilter || data.roleFilter === 'all' || r.roleKey === data.roleFilter));
        const byId = new Map(jobs.map(j => [j._source + ':' + j.id, j]));
        const menu = normalizeLegacyMenu(await read(reader, 'Menu_Settings_V2'));
        const rows = legacyEngine.calculateWithMenu(jobs, rules, menu).filter(row => {
            if (!user.manager && (row.roleKey !== 'tech' || row.staffEmail !== user.email)) return false;
            if (row.roleKey !== 'tech') return true;
            const source = byId.get(row.source + ':' + row.jobId);
            return engine.resolveCommissionIdentity(source, source.dateString, s.persons, s.bindings).status === 'LEGACY';
        });
        return { rows, rowsHash: hash(rows), jobs: user.manager ? jobs.length : new Set(rows.map(r => r.jobId)).size, rules: rules.length,
            ...(includeFinancialProjection ? { financialProjection: reportFinancialProjection(rows, byId) } : {}) };
    }
    async function handle(request) {
        const user = await resolveActor(request), data = request.data || {}, action = data.action;
        if (['config', 'preview', 'report', 'records', 'legacySettings', 'staffOptions', 'impact', 'materialityPreview'].includes(action)) {
            const s = await state(reader);
            if (action === 'materialityPreview') return auditPreview(reader, s, data, user);
            if (action === 'impact') { assertEnabled(s); return impact(reader, s, data.proposal || {}, user, now().toISOString()); }
            if (action === 'config') {
                const persons = allowedPeople(s, user).map(p => ({ ...p, ...enrollment.coverage(p, s.bindings) })), ids = new Set((user.manager ? s.allPersons : persons).map(p => p.personId));
                const enabled = s.guard?.enabled === true;
                const revisions = user.manager ? s.data.Commission_Settings.filter(r => r.schemaVersion === 2 && r.id.startsWith('v2_enrollment_') && r.recordType === 'commission_enrollment_revision' && ids.has(r.personId)) : [];
                const allBindings = user.manager ? s.data.Commission_Settings.filter(b => b.recordType === 'commission_identity_binding' && ids.has(b.personId)) : [];
                const bindingHistory = allBindings.map(b => ({ ...b, authoritative: s.bindings.some(head => head.id === b.id), supersededBy: allBindings.find(next => next.supersedesRevisionId === b.id)?.id || null }));
                const enrollmentHistory = revisions.map(r => ({ ...r, authoritative: persons.some(p => p.enrollmentRevisionId === r.id && Object.values(p.bindingHeads || {}).includes(r.bindingId)), supersededBy: revisions.find(next => next.supersedesEnrollmentRevisionId === r.id)?.id || bindingHistory.find(b => b.id === r.bindingId)?.supersededBy || null }));
                const staff = user.manager ? await read(reader, 'Users') : [];
                const actorNames = Object.fromEntries(staff.filter(p => p.uid).map(p => [p.uid, p.name || p.displayName || p.email || p.id]));
                const actor = staff.find(p => p.id.toLowerCase() === user.email);
                if (actor) actorNames[user.uid] = actor.name || actor.displayName || user.email;
                return { enabled, manager: user.manager, actorUid: user.uid, actorNames, archivedPersons: user.manager ? s.allPersons.filter(p => p.status === 'VOIDED') : [], capabilities: { auditExceptions: user.admin && enabled && targetConfigurationEnabled(), readOwn: true, readManager: user.manager, legacyAdmin: user.manager, targetAdmin: user.manager && enabled && targetConfigurationEnabled(), correctEnrollment: user.manager && enabled && targetConfigurationEnabled(), voidEnrollment: user.admin && enabled && targetConfigurationEnabled(), enableTarget: user.manager && !enabled && targetConfigurationEnabled() }, revision: s.guard ? s.guard.revision : 0, persons, bindings: s.bindings.filter(b => ids.has(b.personId)), enrollmentHistory, bindingHistory, rules: s.data.Commission_Rules.filter(r => r.schemaVersion !== 2 || ids.has(r.technicianPersonId)), legacyRules: s.data.Commission_Rules.filter(r => r.schemaVersion !== 2), projectId };
            }
            if (action === 'legacySettings') return { settings: s.data.Commission_Settings.filter(r => r.schemaVersion !== 2 && !r.id.startsWith('v2_')) };
            if (action === 'staffOptions') { requireManager(user); return { staff: (await read(reader, 'Users')).filter(p => p.active !== false).map(p => ({ id: p.id, name: p.name || p.displayName || p.id, email: p.email || p.id, uid: p.uid || null, staffId: p.staffId || null })) }; }
            if (action === 'records') {
                const people = new Set(allowedPeople(s, user).map(p => p.personId));
                const records = s.records.filter(r => (user.manager || (r.schemaVersion === 2 ? people.has(r.personId) : r.staffEmail === user.email)) && (!data.lockId || r.lockId === data.lockId) && (!data.start || r.periodStart >= data.start) && (!data.end || r.periodEnd <= data.end));
                const audits = records.filter(r => r.auditException);
                const current = new Map();
                for (const day of [...new Set(audits.map(r => r.businessDate))]) {
                    const report = await preview(reader, s, { start: day, end: day }, user);
                    for (const row of report.rows) current.set(row.personId + ':' + row.businessDate, row);
                }
                return { records: records.map(record => {
                    const row = current.get(record.personId + ':' + record.businessDate);
                    return record.auditException ? { ...record, auditCurrent: row ? { auditDisposition: row.auditDisposition, finalizationEligible: row.finalizationEligible, sourceChanged: row.sourceChanged } : { auditDisposition: { state: 'STALE', valid: false }, finalizationEligible: false, sourceChanged: true } } : record;
                }), locks: s.locks.filter(l => user.manager || records.some(r => r.lockId === l.id)) };
            }
            if (action === 'report') {
                if (s.guard && s.guard.enabled) assertEnabled(s);
                const legacyResult = data.personId ? { rows: [], rowsHash: hash([]), jobs: 0, rules: 0, financialProjection: reportFinancialProjection([], new Map()) } : await legacyReport(reader, s, data, user, true);
                const target = s.guard && s.guard.enabled && (!data.roleFilter || ['all', 'tech'].includes(data.roleFilter)) ? await preview(reader, s, data, user) : { status: 'NOT_CONFIGURED', rows: [], diagnostics: [], summary: { completeCommission: '0.00', complete: true }, fingerprint: null, revision: s.guard ? s.guard.revision : 0 };
                if (data.personId) { legacyResult.jobs = new Set(target.rows.flatMap(r => r.contributions.map(c => c.jobId))).size; legacyResult.rules = new Set(target.rows.map(r => r.rule?.id).filter(Boolean)).size; }
                return { ...legacyResult, target, projectId };
            }
            if (!s.guard?.enabled) {
                if (data.personId && !allowedPeople(s, user).some(p => p.personId === data.personId)) error('permission-denied', 'Person access is not authorized');
                engine.days(data.start, data.end);
                return { status: 'NOT_CONFIGURED', rows: [], diagnostics: [], summary: { completeCommission: '0.00', complete: true }, fingerprint: null, revision: s.guard?.revision || 0 };
            }
            assertEnabled(s);
            return preview(reader, s, data, user);
        }
        requireManager(user);
        id(data.requestId);
        const stamp = now().toISOString(), payloadHash = hash(data);
        return db.runTransaction(async tx => {
            const currentActor = await resolveActor(request, tx);
            requireManager(currentActor);
            if (['approveImmaterialException', 'revokeImmaterialException', 'reviewImmaterialException'].includes(action)) requireOwner(currentActor);
            const s = await state(tx);
            const replay = s.data.Commission_Settings.find(x => x.id === `v2_request_${data.requestId}`);
            if (replay) { if (replay.payloadHash !== payloadHash || replay.actorUid !== user.uid) error('already-exists', 'Request ID has a different payload'); return replay.result; }
            if (action !== 'enable' && !LEGACY_ACTIONS.has(action) && action !== 'markPaid') assertEnabled(s);
            if (action === 'enable' && (!targetConfigurationEnabled() || data.activationConfirmed !== true || !String(data.notes || '').trim())) error('failed-precondition', 'Target configuration requires separate authorization and explicit confirmation');
            if (action === 'markPaid' && s.records.find(r => r.id === data.recordId)?.schemaVersion === 2) assertEnabled(s);
            const revision = s.guard ? s.guard.revision : 0;
            if (data.expectedRevision !== revision) error('aborted', 'Configuration changed. Reload before saving.');
            const reviewed = await impact(tx, s, data, user, stamp);
            if (reviewed.required && data.impactFingerprint !== reviewed.fingerprint) error('aborted', 'Backdating impact preview is missing or stale');
            if (['closeRule', 'successor', 'closeBinding'].includes(action) && !String(data.notes || '').trim()) error('invalid-argument', 'Closing actions require an approval note');
            let result = { revision: revision + 1 }, writes = [], identityAudit = null;
            const put = (collection, key, value) => writes.push({ collection, key, value: plain(value) });
            const audit = { createdAt: stamp, createdBy: user.uid, updatedAt: stamp, updatedBy: user.uid };
            if (['approveImmaterialException', 'revokeImmaterialException', 'reviewImmaterialException'].includes(action)) {
                requireOwner(currentActor);
                if (data.confirmed !== true || !String(data.approvalReason || '').trim() || String(data.approvalReason).length > 2000) error('invalid-argument', 'Explicit confirmation and approval reason are required');
                const review = await auditPreview(tx, s, data, currentActor);
                if (data.ruleId && data.ruleId !== review.proof.ruleId) error('failed-precondition', 'Selected rule does not match the proof');
                if (review.proof.proofFingerprint !== data.proofFingerprint) error('aborted', 'Materiality preview is stale');
                const previous = materiality.latest(review.events, data.personId, data.businessDate);
                const approving = action === 'approveImmaterialException';
                if (approving && !review.proof.eligible) error('failed-precondition', 'Zero Commission delta is not proven: ' + review.proof.reason);
                if (approving && review.disposition.valid) error('already-exists', 'An approved audit exception already exists');
                if (!approving && !previous) error('failed-precondition', 'Audit approval history required');
                if (approving) protectLocks(s, data.personId, { effectiveFrom: data.businessDate, effectiveUntil: nextDay(data.businessDate) });
                const eventId = `v2_materiality_event_${data.requestId}`;
                const event = { id: eventId, schemaVersion: 2, recordType: materiality.EVENT, personId: data.personId, businessDate: data.businessDate, sequence: revision + 1, state: approving ? 'APPROVED' : action === 'revokeImmaterialException' ? 'REVOKED' : review.disposition.valid ? 'REVIEWED' : 'INVALIDATED', action: approving && previous ? 'REAPPROVE' : action, reason: String(data.approvalReason).trim(), actorUid: currentActor.uid, createdAt: stamp, previousEventId: previous?.id || null, previousEventHash: previous ? materiality.hash(previous) : null, certificate: review.proof };
                put('Commission_Settings', eventId, event);
                result.approvalId = eventId; result.state = event.state;
            } else if (action === 'enable') {
                if (s.guard && s.guard.enabled) error('already-exists', 'Already enabled');
            } else if (action === 'enrollPerson') {
                enrollment.reason(data);
                id(data.personId); engine.validateRange({ effectiveFrom: data.enrollmentFrom, effectiveUntil: null });
                if (!String(data.displayName || '').trim()) error('invalid-argument', 'Technician name is required');
                if (s.allPersons.some(p => p.personId === data.personId)) error('already-exists', 'Person already exists');
                backdate(data, { effectiveFrom: data.enrollmentFrom }, stamp);
                protectLocks(s, data.personId, { effectiveFrom: data.enrollmentFrom, effectiveUntil: null });
                const binding = makeBinding(data, data.personId, `${data.requestId}_binding`, audit);
                if (binding.effectiveFrom !== data.enrollmentFrom) error('invalid-argument', 'Initial binding start must match person enrollment start');
                const coverage = enrollment.protectedCoverage(s, data.personId, [binding], [binding]);
                if (coverage.blocked) error('failed-precondition', 'LOCKED PERIOD CORRECTION REQUIRES SEPARATE CONTROLLED CORRECTION WORKFLOW');
                engine.assertBindings([...s.bindings, binding]);
                const accessUids = data.accessUid ? [id(data.accessUid)] : [];
                await validateLogins(tx, s, data.personId, accessUids, data.staffRef);
                const revisionId = `v2_enrollment_${data.requestId}`;
                const person = { schemaVersion: 2, recordType: 'commission_person', personId: data.personId, displayName: data.displayName.trim(), enrollmentFrom: data.enrollmentFrom, staffRef: data.staffRef || null, accessUids, ruleHeads: {}, bindingHeads: { [binding.bindingFamilyId]: binding.id }, enrollmentRevision: 1, enrollmentRevisionId: revisionId, ...audit };
                identityAudit = { action, personId: data.personId, previousRevision: null, newRevision: 1, previousValues: null, newValues: enrollment.snapshot(person, binding), ...enrollment.approval(data, user, stamp, reviewed) };
                put('Commission_Settings', revisionId, { schemaVersion: 2, recordType: 'commission_enrollment_revision', ...identityAudit, bindingId: binding.id, supersedesEnrollmentRevisionId: null, ...audit });
                put('Commission_Settings', `v2_person_${data.personId}`, person);
                put('Commission_Settings', binding.id, binding);
                result.personId = data.personId;
            } else if (action === 'voidEnrollment') {
                if (!currentActor.admin) error('permission-denied', 'An approved Admin or System Admin is required to void enrollment');
                if (data.voidConfirmed !== true) error('failed-precondition', 'Explicit final Void confirmation is required');
                if (reviewed.blocked) error('failed-precondition', reviewed.blockReason);
                const person = s.persons.find(p => p.personId === data.personId);
                const revisionId = `v2_enrollment_${data.requestId}`;
                const next = { ...person, status: 'VOIDED', bindingHeads: {}, enrollmentRevision: enrollment.revision(person) + 1, enrollmentRevisionId: revisionId, voidedAt: stamp, voidedBy: user.uid, updatedAt: stamp, updatedBy: user.uid };
                identityAudit = { action, personId: person.personId, previousRevision: enrollment.revision(person), newRevision: next.enrollmentRevision,
                    previousValues: { ...person, bindings: s.bindings.filter(b => b.personId === person.personId) }, newValues: next,
                    ...enrollment.approval(data, user, stamp, reviewed), voidConfirmed: true, dependencyCheck: reviewed.dependencies };
                put('Commission_Settings', revisionId, { schemaVersion: 2, recordType: 'commission_enrollment_revision', ...identityAudit, supersedesEnrollmentRevisionId: person.enrollmentRevisionId || null, ...audit });
                put('Commission_Settings', person.id, next);
                result = { ...result, personId: person.personId, status: 'VOIDED', enrollmentRevisionId: revisionId };
            } else if (action === 'correctEnrollment') {
                const plan = enrollment.planCorrection(s, data, engine.today(new Date(stamp)));
                if (data.correctionConfirmed !== true) error('failed-precondition', 'Explicit final enrollment correction confirmation is required');
                if (reviewed.blocked) error('failed-precondition', reviewed.blockReason);
                const { person, old } = plan;
                const revisionId = `v2_enrollment_${data.requestId}`;
                const previousRevisionId = person.enrollmentRevisionId || `v2_enrollment_baseline_${person.personId}`;
                if (!person.enrollmentRevisionId) {
                    if (s.data.Commission_Settings.some(r => r.id === previousRevisionId)) error('failed-precondition', 'Enrollment baseline revision needs review');
                    put('Commission_Settings', previousRevisionId, { schemaVersion: 2, recordType: 'commission_enrollment_revision', action: 'LEGACY_ENROLLMENT_BASELINE_CAPTURE', personId: person.personId, previousRevision: null, newRevision: plan.previousRevision, previousValues: null, newValues: plan.before, bindingId: old.id, approvalReason: 'Original persisted enrollment captured unchanged before first audited correction', createdAt: person.createdAt || stamp, createdBy: person.createdBy || null, capturedAt: stamp, capturedBy: user.uid, supersedesEnrollmentRevisionId: null });
                }
                const approval = enrollment.approval(data, user, stamp, reviewed);
                const next = { ...plan.binding, id: `v2_binding_${data.requestId}`, revision: (old.revision || 1) + 1, supersedesRevisionId: old.id, notes: plan.approvalReason, ...audit, ...approval };
                const nextPerson = { ...plan.nextPerson, bindingHeads: { ...person.bindingHeads, [old.bindingFamilyId]: next.id }, enrollmentRevision: plan.newRevision, enrollmentRevisionId: revisionId, updatedAt: stamp, updatedBy: user.uid };
                identityAudit = { action, personId: person.personId, previousRevision: plan.previousRevision, newRevision: plan.newRevision, previousValues: plan.before, newValues: enrollment.snapshot(nextPerson, next), classification: plan.classification, changes: plan.changes, supersedes: old.id, bindingId: next.id, ...approval };
                put('Commission_Settings', next.id, next);
                put('Commission_Settings', revisionId, { schemaVersion: 2, recordType: 'commission_enrollment_revision', ...identityAudit, supersedesEnrollmentRevisionId: previousRevisionId, ...audit });
                put('Commission_Settings', person.id, nextPerson);
                result = { ...result, personId: person.personId, bindingId: next.id, enrollmentRevisionId: revisionId, enrollmentRevision: plan.newRevision };
            } else if (action === 'closeBinding') {
                const person = s.persons.find(p => p.personId === data.personId);
                const old = s.bindings.find(b => b.id === data.bindingId && b.personId === data.personId);
                if (!person || !old) error('not-found', 'Current identity binding not found');
                engine.validateRange({ effectiveFrom: old.effectiveFrom, effectiveUntil: data.effectiveUntil });
                if (old.effectiveUntil && data.effectiveUntil > old.effectiveUntil) error('failed-precondition', 'Closing cannot extend a binding');
                backdate(data, { effectiveFrom: data.effectiveUntil }, stamp);
                protectLocks(s, person.personId, { effectiveFrom: data.effectiveUntil, effectiveUntil: old.effectiveUntil });
                const next = { ...old, id: `v2_binding_${data.requestId}`, revision: (old.revision || 1) + 1, effectiveUntil: data.effectiveUntil, supersedesRevisionId: old.id, notes: String(data.notes), ...audit, ...enrollment.approval(data, user, stamp, reviewed) };
                identityAudit = { action, personId: person.personId, previousRevision: old.revision || 1, newRevision: next.revision, previousValues: enrollment.snapshot(person, old), newValues: enrollment.snapshot(person, next), supersedes: old.id, bindingId: next.id, ...enrollment.approval(data, user, stamp, reviewed) };
                put('Commission_Settings', next.id, next);
                put('Commission_Settings', person.id, { ...person, bindingHeads: { ...person.bindingHeads, [old.bindingFamilyId]: next.id }, updatedAt: stamp, updatedBy: user.uid });
            } else if (action === 'saveBinding') {
                enrollment.reason(data);
                const person = s.persons.find(p => p.personId === data.personId); if (!person) error('not-found', 'Person not found');
                const binding = makeBinding(data, person.personId, `${data.requestId}_binding`, audit);
                backdate(data, binding, stamp); protectLocks(s, person.personId, binding);
                engine.assertBindings([...s.bindings, binding]);
                if (binding.effectiveFrom < person.enrollmentFrom) error('failed-precondition', 'Use Correct Enrollment to change the enrollment start; Add Binding cannot move enrollment earlier');
                identityAudit = { action, personId: person.personId, previousRevision: null, newRevision: 1, previousValues: null, newValues: enrollment.snapshot(person, binding), bindingId: binding.id, ...enrollment.approval(data, user, stamp, reviewed) };
                put('Commission_Settings', binding.id, binding);
                put('Commission_Settings', person.id, { ...person, bindingHeads: { ...person.bindingHeads, [binding.bindingFamilyId]: binding.id }, updatedAt: stamp, updatedBy: user.uid });
            } else if (['saveRule', 'successor', 'closeRule'].includes(action)) {
                const person = s.persons.find(p => p.personId === data.personId); if (!person) error('not-found', 'Person not found');
                const old = data.ruleId ? s.data.Commission_Rules.find(r => r.id === data.ruleId && r.technicianPersonId === person.personId) : null;
                if (data.ruleId && !old) error('not-found', 'Rule not found');
                const heads = { ...person.ruleHeads };
                let existing = s.rules.slice();
                if (action !== 'saveRule') {
                    if (!old || old.status !== 'PUBLISHED' || heads[old.ruleFamilyId] !== old.id) error('failed-precondition', 'Select the current published rule revision');
                    const end = action === 'closeRule' ? data.effectiveUntil : data.rule.effectiveFrom;
                    engine.validateRange({ effectiveFrom: old.effectiveFrom, effectiveUntil: end });
                    if (old.effectiveUntil && end > old.effectiveUntil) error('failed-precondition', 'A close cannot extend existing coverage');
                    backdate(data, { effectiveFrom: end }, stamp);
                    protectLocks(s, person.personId, { effectiveFrom: end, effectiveUntil: old.effectiveUntil });
                    const closed = { ...old, id: `v2_rule_${data.requestId}_closed`, revision: old.revision + 1, effectiveUntil: end, supersedesRevisionId: old.id, notes: String(data.notes), ...audit };
                    put('Commission_Rules', closed.id, closed); heads[old.ruleFamilyId] = closed.id;
                    existing = existing.filter(r => r.id !== old.id).concat(closed);
                } else if (old && old.status !== 'DRAFT') error('failed-precondition', 'Published rule terms cannot be edited');
                if (action !== 'closeRule') {
                    const input = data.rule || {};
                    const rule = { schemaVersion: 2, recordType: 'commission_rule', id: old && old.status === 'DRAFT' ? old.id : `v2_rule_${data.requestId}`, ruleFamilyId: old && old.status === 'DRAFT' ? old.ruleFamilyId : data.requestId, revision: old && old.status === 'DRAFT' ? old.revision + 1 : 1, technicianPersonId: person.personId, technicianDisplayName: person.displayName, roleKey: 'tech', ruleType: input.ruleType, dailyTarget: engine.money(input.dailyTarget).toString(), commissionRate: engine.money(input.commissionRate).toString(), effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil || null, currency: 'GHS', taxTreatment: 'EXCLUDE_TAX', eligibleRevenuePolicy: engine.POLICY, status: input.status, active: false, notes: String(data.notes || ''), ...audit };
                    engine.validateRule(rule);
                    if (rule.effectiveFrom && rule.effectiveFrom < person.enrollmentFrom) error('failed-precondition', 'Rule starts before enrollment');
                    const coverage = enrollment.ruleCoverage(person, s.bindings, rule);
                    const priorPublished = s.data.Commission_Rules.some(r => r.technicianPersonId === person.personId && r.status === 'PUBLISHED');
                    if (!priorPublished && coverage.gap && data.coverageGapConfirmed !== true) error('failed-precondition', 'The initial rule leaves enrollment without Commission coverage. Explicit coverage-gap confirmation is required.');
                    if (!priorPublished && coverage.gap) enrollment.reason(data);
                    rule.coverageGapConfirmed = !priorPublished && coverage.gap && data.coverageGapConfirmed === true;
                    if (rule.effectiveFrom) { backdate(data, rule, stamp); protectLocks(s, person.personId, rule); }
                    if (rule.status === 'PUBLISHED') {
                        if (!s.bindings.some(b => b.personId === person.personId && engine.contains(b, rule.effectiveFrom))) error('failed-precondition', 'Confirmed identity must cover rule start');
                        heads[rule.ruleFamilyId] = rule.id;
                        existing = existing.filter(r => r.ruleFamilyId !== rule.ruleFamilyId).concat(rule);
                    }
                    put('Commission_Rules', rule.id, rule); result.ruleId = rule.id;
                }
                engine.assertNoOverlap(existing);
                if (action === 'saveRule' && data.rule?.status === 'PUBLISHED' && s.rules.some(r => r.technicianPersonId === person.personId)) error('failed-precondition', 'Use Create Successor to change a published Commission rule');
                put('Commission_Settings', person.id, { ...person, ruleHeads: heads, updatedAt: stamp, updatedBy: user.uid });
            } else if (action === 'cancelRule') {
                const person = s.persons.find(p => p.personId === data.personId);
                const rule = s.rules.find(r => r.id === data.ruleId && r.technicianPersonId === data.personId);
                if (!person || !rule || rule.effectiveFrom <= engine.today(new Date(stamp))) error('failed-precondition', 'Only a not-yet-effective rule can be cancelled');
                if (!String(data.notes || '').trim()) error('invalid-argument', 'Cancellation requires an approval note');
                protectLocks(s, data.personId, rule);
                const cancelled = { ...rule, id: `v2_rule_${data.requestId}_cancelled`, revision: rule.revision + 1, status: 'CANCELLED', supersedesRevisionId: rule.id, notes: String(data.notes), ...audit };
                put('Commission_Rules', cancelled.id, cancelled);
                put('Commission_Settings', person.id, { ...person, ruleHeads: { ...person.ruleHeads, [rule.ruleFamilyId]: cancelled.id }, updatedAt: stamp, updatedBy: user.uid });
            } else if (action === 'cancelDraft') {
                const rule = s.data.Commission_Rules.find(r => r.id === data.ruleId);
                if (!rule || rule.status !== 'DRAFT') error('failed-precondition', 'Only drafts can be cancelled');
                put('Commission_Rules', rule.id, { ...rule, status: 'CANCELLED', updatedAt: stamp, updatedBy: user.uid });
            } else if (action === 'lock') {
                const report = await preview(tx, s, data, user);
                if (report.fingerprint !== data.fingerprint) error('aborted', 'Preview is stale. Reload the report.');
                const rows = report.unlockedRows;
                if (!rows.length || rows.length > 120 || report.rows.some(r => !r.finalizationEligible) || report.diagnostics.length) error('failed-precondition', 'Only complete configured days or valid approved zero-impact exceptions may be locked; maximum 120 days');
                for (const row of rows) protectLocks(s, row.personId, { effectiveFrom: row.businessDate, effectiveUntil: nextDay(row.businessDate) });
                const lockId = `v2_lock_${data.requestId}`, recordIds = [];
                for (const row of rows) {
                    const key = `v2_day_${hash([row.personId, row.businessDate, 'tech']).slice(0, 40)}`;
                    if (s.records.some(r => r.id === key)) error('already-exists', 'This technician/day is already locked');
                    recordIds.push(key);
                    const snapshot = { schemaVersion: 2, recordType: 'commission_daily_snapshot', personId: row.personId, businessDate: row.businessDate, periodStart: row.businessDate, periodEnd: row.businessDate, roleKey: 'tech', roleName: 'Technician', staffName: row.technician, staffEmail: '', lockId, calculation: row, calculationHash: hash(row), ruleSnapshot: row.rule, bindingsSnapshot: s.bindings.filter(b => b.personId === row.personId), commissionAmount: row.dailyPayable, payablePesewas: row.payablePesewas, baseValue: row.eligibleRevenue, jobIds: row.contributions.map(c => c.jobId), jobCount: row.contributions.length, rows: [row], inputFingerprint: report.fingerprint, approvalStatus: 'locked', payoutStatus: 'pending', lockedAt: stamp, lockedBy: user.uid, ...audit };
                    if (row.dailyPayable === null) {
                        snapshot.auditException = materiality.latest(s.data.Commission_Settings, row.personId, row.businessDate);
                        snapshot.commissionAmount = '0.00'; snapshot.payablePesewas = '0'; snapshot.certifiedFinalizationAmount = '0.00';
                        snapshot.jobIds = [...new Set([...snapshot.jobIds, ...row.pending.map(p => p.jobId)])];
                        snapshot.jobCount = snapshot.jobIds.length;
                    }
                    if (Buffer.byteLength(JSON.stringify(snapshot)) > 700000) error('resource-exhausted', 'Snapshot is too large');
                    put('Commission_Records', key, { ...snapshot, snapshotHash: hash(snapshot) });
                }
                put('Commission_Locks', lockId, { schemaVersion: 2, recordType: 'commission_lock', periodStart: data.start, periodEnd: data.end, roleFilter: 'tech', recordIds, auditExceptionCount: rows.filter(r => r.dailyPayable === null).length, status: 'locked', totalCommission: report.summary.completeCommission, totalBaseValue: rows.reduce((n, r) => n.plus(r.eligibleRevenue), engine.money('0')).toString(), rowCount: rows.length, staffCount: new Set(rows.map(r => r.personId)).size, lockedAt: stamp, lockedBy: user.uid, ...audit });
                result.lockId = lockId;
            } else if (action === 'markPaid') {
                const record = s.records.find(r => r.id === data.recordId);
                if (!record || record.approvalStatus !== 'locked') error('failed-precondition', 'Locked record required');
                const lock = s.locks.find(l => l.id === record.lockId);
                const periodRecords = s.records.filter(r => r.lockId === record.lockId);
                if (lock?.auditExceptionCount || periodRecords.some(r => r.auditException)) {
                    if (lock?.auditExceptionCount !== periodRecords.filter(r => r.auditException).length) error('failed-precondition', 'Exception snapshot count changed');
                    if (!lock || !Array.isArray(lock.recordIds) || lock.recordIds.length !== periodRecords.length || lock.recordIds.some(id => !periodRecords.some(r => r.id === id))) error('failed-precondition', 'Complete exception snapshot membership required');
                    const live = await preview(tx, s, { start: lock.periodStart, end: lock.periodEnd }, currentActor);
                    if (live.diagnostics.length) error('failed-precondition', 'Payment blocked by source diagnostics');
                    for (const snapshot of periodRecords.filter(r => r.auditException)) {
                        const row = live.rows.find(r => r.personId === snapshot.personId && r.businessDate === snapshot.businessDate);
                        if (!row?.auditDisposition?.valid || row.auditDisposition.approvalId !== snapshot.auditException.id || row.sourceChanged) error('failed-precondition', 'Payment blocked: audit approval stale or invalid');
                    }
                }
                if (record.payoutStatus !== 'paid') put('Commission_Records', record.id, { ...record, payoutStatus: 'paid', paidAt: stamp, paidBy: user.uid, updatedAt: stamp, updatedBy: user.uid });
            } else if (['legacySaveRule', 'legacyToggleRule', 'legacyDeleteRule'].includes(action)) {
                const old = data.ruleId ? s.data.Commission_Rules.find(r => r.id === data.ruleId) : null;
                if (old && old.schemaVersion === 2) error('failed-precondition', 'Target rules require versioned commands');
                if (data.ruleId && !old) error('not-found', 'Legacy rule not found');
                if (s.records.length || s.locks.length) error('failed-precondition', 'Legacy rule changes with locked history require separate review');
                const input = data.rule || old || {};
                const key = old ? old.id : `legacy_${data.requestId}`;
                const fields = ['roleKey', 'roleName', 'customRoleName', 'commissionType', 'appliesTo', 'percentage', 'fixedAmount', 'minRevenue', 'priority', 'tierNotes', 'notes', 'active'];
                const next = Object.fromEntries(fields.filter(k => input[k] !== undefined).map(k => [k, input[k]]));
                if (action === 'legacySaveRule') {
                    if (!['tech', 'foh', 'manager', 'custom'].includes(next.roleKey) || !['percentage', 'fixed', 'hybrid', 'tiered'].includes(next.commissionType) || !['serviceRevenue', 'totalBill', 'upsells', 'closedJobs'].includes(next.appliesTo)) error('invalid-argument', 'Invalid legacy rule');
                    for (const k of ['percentage', 'fixedAmount', 'minRevenue']) if (!Number.isFinite(Number(next[k] || 0)) || Number(next[k] || 0) < 0) error('invalid-argument', 'Invalid legacy value');
                }
                if (action === 'legacyToggleRule') next.active = data.active === true;
                if (action === 'legacyDeleteRule') { next.active = false; next.deleted = true; }
                put('Commission_Rules', key, { ...old, ...next, ...audit, createdAt: old ? old.createdAt : stamp, createdBy: old ? old.createdBy : user.uid }); result.ruleId = key;
            } else if (action === 'legacyLock') {
                const report = await legacyReport(tx, s, data, user);
                if (report.rowsHash !== data.rowsHash) error('aborted', 'Legacy preview is stale');
                if (!report.rows.length) error('failed-precondition', 'No legacy rows to lock');
                if (s.locks.some(l => (!l.roleFilter || l.roleFilter === 'all' || data.roleFilter === 'all' || l.roleFilter === data.roleFilter) && l.periodStart <= data.end && data.start <= l.periodEnd)) error('already-exists', 'This period overlaps a commission lock');
                const groups = new Map();
                report.rows.forEach(r => { const key = r.roleKey + ':' + r.staffEmail; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); });
                const lockId = `legacy_lock_${data.requestId}`;
                for (const [key, rows] of groups) {
                    const r = rows[0];
                    put('Commission_Records', `${lockId}_${hash(key).slice(0, 24)}`, { lockId, periodStart: data.start, periodEnd: data.end, roleFilter: data.roleFilter || 'all', roleKey: r.roleKey, roleName: r.roleName, staffName: r.staffName, staffEmail: r.staffEmail, jobIds: [...new Set(rows.map(x => x.jobId))], jobCount: new Set(rows.map(x => x.jobId)).size, baseValue: rows.reduce((n, x) => n + x.baseValue, 0), commissionAmount: rows.reduce((n, x) => n + x.commissionAmount, 0), rows, approvalStatus: 'locked', payoutStatus: 'pending', lockedAt: stamp, lockedBy: user.uid, ...audit });
                }
                put('Commission_Locks', lockId, { periodStart: data.start, periodEnd: data.end, roleFilter: data.roleFilter || 'all', status: 'locked', rowCount: report.rows.length, staffCount: groups.size, totalCommission: report.rows.reduce((n, r) => n + r.commissionAmount, 0), totalBaseValue: report.rows.reduce((n, r) => n + r.baseValue, 0), lockedAt: stamp, lockedBy: user.uid, ...audit }); result.lockId = lockId;
            } else if (legacy && action.startsWith('legacy')) {
                const changes = await legacy({ tx, state: s, data, user, stamp, read, protectLocks });
                changes.writes.forEach(w => put(w.collection, w.key, w.value)); result = { ...result, ...changes.result };
            } else error('invalid-argument', 'Unsupported commission action');
            put('Commission_Settings', GUARD, { schemaVersion: 2, recordType: 'commission_control', enabled: action === 'enable' || s.guard?.enabled === true, revision: revision + 1, updatedAt: stamp, updatedBy: user.uid });
            put('Commission_Settings', `v2_request_${data.requestId}`, { schemaVersion: 2, recordType: 'commission_command_receipt', payloadHash, actorUid: user.uid, action, result, createdAt: stamp, ...(identityAudit ? { identityAudit } : {}) });
            for (const w of writes) tx.set(ref(w.collection, w.key), w.value);
            return result;
        });
    }
    function makeBinding(data, personId, suffix, audit) {
        const b = data.binding || {};
        const binding = { schemaVersion: 2, recordType: 'commission_identity_binding', id: `v2_binding_${suffix}`, bindingFamilyId: suffix, revision: 1, personId, ...enrollment.normalizeBinding({ ...b, effectiveFrom: b.effectiveFrom || data.enrollmentFrom }), approvalReason: String(data.approvalReason || data.notes || '').trim(), backdateConfirmed: data.backdateConfirmed === true, impactFingerprint: data.impactFingerprint || null, confirmedBy: audit.createdBy, confirmedAt: audit.createdAt, ...audit };
        if (data.identityConfirmed !== true) error('failed-precondition', 'Explicit identity confirmation is required');
        engine.validateBinding(binding);
        return binding;
    }
    return { handle };
}
module.exports = { createCommissionService, hash, plain };
