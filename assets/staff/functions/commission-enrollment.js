'use strict';

const engine = require('./commission-engine');
const reject = (code, message) => { throw Object.assign(new Error(message), { code }); };
const norm = value => String(value || '').trim().toLowerCase();
const clean = value => String(value || '').trim();
const equal = (a, b) => engine.stable(a) === engine.stable(b);
const revision = value => value.enrollmentRevision || value.revision || 1;
const snapshot = (person, binding) => ({
    displayName: person.displayName, staffRef: person.staffRef || null,
    enrollmentFrom: person.enrollmentFrom, accessUids: [...(person.accessUids || [])],
    binding: { stationEmail: binding.stationEmail || '', staffId: binding.staffId || null,
        aliases: [...(binding.aliases || [])], excludedAliases: [...(binding.excludedAliases || [])],
        effectiveFrom: binding.effectiveFrom, effectiveUntil: binding.effectiveUntil || null }
});
function list(value) {
    if (!Array.isArray(value) || value.length > 50 || value.some(x => typeof x !== 'string' || x.length > 150)) reject('invalid-argument', 'Invalid identity alias list');
    const unique = new Map();
    for (const item of value.map(clean).filter(Boolean)) if (!unique.has(norm(item))) unique.set(norm(item), item);
    return [...unique.values()].sort((a, b) => norm(a).localeCompare(norm(b)));
}
function normalizeBinding(input) {
    if (!input || typeof input !== 'object') reject('invalid-argument', 'Proposed identity binding required');
    const binding = { stationEmail: norm(input.stationEmail), staffId: clean(input.staffId) || null,
        aliases: list(input.aliases || []), excludedAliases: list(input.excludedAliases || []),
        effectiveFrom: input.effectiveFrom, effectiveUntil: input.effectiveUntil || null };
    engine.validateRange(binding);
    if (binding.stationEmail && (!/^[^\s/@]+@[^\s/@]+\.[^\s/@]+$/.test(binding.stationEmail) || binding.stationEmail.length > 254)) reject('invalid-argument', 'Valid station email required');
    if (binding.staffId && binding.staffId.length > 128) reject('invalid-argument', 'Invalid Staff ID');
    return binding;
}
function reason(data) {
    const value = clean(data.approvalReason || data.notes);
    if (!value || value.length > 2000) reject('failed-precondition', 'An approval reason/reference is required (maximum 2000 characters)');
    return value;
}
function rangeUnion(a, b) {
    return { effectiveFrom: a.effectiveFrom < b.effectiveFrom ? a.effectiveFrom : b.effectiveFrom,
        effectiveUntil: !a.effectiveUntil || !b.effectiveUntil ? null : (a.effectiveUntil > b.effectiveUntil ? a.effectiveUntil : b.effectiveUntil) };
}
function changedCoverage(a, b) {
    const boundaries = [...new Set([a.effectiveFrom, a.effectiveUntil, b.effectiveFrom, b.effectiveUntil].filter(Boolean))].sort();
    return boundaries.map((from, i) => ({ effectiveFrom: from, effectiveUntil: boundaries[i + 1] || null }))
        .filter(range => engine.contains(a, range.effectiveFrom) !== engine.contains(b, range.effectiveFrom));
}
function planCorrection(state, data, today) {
    const person = state.persons.find(p => p.personId === data.personId);
    const old = state.bindings.find(b => b.id === data.bindingId && b.personId === data.personId);
    if (!person || !old) reject('not-found', 'Current enrollment binding not found. Reload before correcting.');
    if (data.expectedBindingRevision !== (old.revision || 1) || data.expectedEnrollmentRevision !== revision(person)) reject('aborted', 'Enrollment revision changed. Reload before correcting.');
    const proposed = data.proposed || {};
    if (Object.hasOwn(proposed, 'personId') || Object.hasOwn(proposed, 'bindingHeads') || Object.hasOwn(proposed, 'enrollmentFrom')) reject('invalid-argument', 'Person ID and authoritative enrollment pointers are not editable');
    if (data.identityConfirmed !== true) reject('failed-precondition', 'Explicit identity confirmation is required');
    const approvalReason = reason(data);
    const displayName = clean(proposed.displayName);
    if (!displayName || displayName.length > 150) reject('invalid-argument', 'Person display name is required');
    const binding = { ...old, ...normalizeBinding(proposed.binding) };
    engine.validateBinding(binding);
    if (proposed.accessUids !== undefined && !Array.isArray(proposed.accessUids)) reject('invalid-argument', 'Invalid confirmed login UID list');
    const accessUids = [...new Set(proposed.accessUids === undefined ? person.accessUids || [] : proposed.accessUids)].sort();
    if (accessUids.length > 5 || accessUids.some(uid => typeof uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(uid))) reject('invalid-argument', 'Invalid confirmed login UID');
    const staffRef = clean(proposed.staffRef) || null;
    if (staffRef && (staffRef.includes('/') || staffRef.length > 254)) reject('invalid-argument', 'Invalid Staff profile');
    const heads = state.bindings.filter(b => b.id !== old.id).concat(binding);
    engine.assertBindings(heads);
    const enrollmentFrom = heads.filter(b => b.personId === person.personId).map(b => b.effectiveFrom).sort()[0];
    const nextPerson = { ...person, displayName, staffRef, accessUids, enrollmentFrom };
    const before = snapshot(person, old), after = snapshot(nextPerson, binding);
    const changes = [];
    for (const key of ['displayName', 'staffRef', 'enrollmentFrom', 'accessUids']) if (!equal(before[key], after[key])) changes.push(key);
    for (const key of Object.keys(after.binding)) if (!equal(before.binding[key], after.binding[key])) changes.push('binding.' + key);
    if (!changes.length) reject('failed-precondition', 'No enrollment values changed');
    const removedExclusions = (old.excludedAliases || []).filter(alias => !binding.excludedAliases.map(norm).includes(norm(alias)));
    if (removedExclusions.length && data.exclusionRemovalConfirmed !== true) reject('failed-precondition', 'Removing an excluded alias requires explicit confirmation');
    const displayOnly = changes.every(key => key === 'displayName');
    const attributionChanged = changes.some(key => ['accessUids', 'staffRef', 'binding.stationEmail', 'binding.staffId', 'binding.aliases', 'binding.excludedAliases'].includes(key));
    let ranges = displayOnly ? [] : attributionChanged ? [rangeUnion(old, binding)] : changedCoverage(old, binding);
    if (changes.includes('accessUids')) ranges = [rangeUnion({ effectiveFrom: person.enrollmentFrom, effectiveUntil: null }, { effectiveFrom: enrollmentFrom, effectiveUntil: null })];
    const backdated = binding.effectiveFrom < old.effectiveFrom || enrollmentFrom < person.enrollmentFrom || ranges.some(range => range.effectiveFrom < today);
    if (backdated && data.backdateConfirmed !== true) reject('failed-precondition', 'Backdated correction requires owner-approved backdating confirmation');
    for (const rule of state.rules.filter(r => r.technicianPersonId === person.personId)) {
        const relevant = heads.filter(b => b.personId === person.personId);
        if (rule.effectiveFrom < enrollmentFrom || !relevant.some(b => engine.contains(b, rule.effectiveFrom))) reject('failed-precondition', 'Correction would invalidate an existing effective Commission Rule');
    }
    return { person, old, binding, nextPerson, before, after, changes, ranges, backdated, removedExclusions,
        classification: displayOnly ? 'DISPLAY_CORRECTION' : backdated ? 'BACKDATED_CORRECTION' : 'IDENTITY_CORRECTION',
        material: !displayOnly, approvalReason, previousRevision: revision(person), newRevision: revision(person) + 1 };
}
function protectedCoverage(state, personId, ranges, bindings = []) {
    const emails = new Set(state.bindings.filter(b => b.personId === personId).concat(bindings).map(b => norm(b.stationEmail)).filter(Boolean));
    const nextDay = day => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); };
    const intersects = r => ranges.some(range => !engine.date(r.effectiveFrom) || engine.overlaps(range, r));
    const records = state.records.filter(r => (r.schemaVersion === 2 || ['locked', 'approved'].includes(r.approvalStatus) || r.payoutStatus === 'paid') &&
        (r.personId === personId || (!r.personId && (!r.staffEmail || emails.has(norm(r.staffEmail))))) &&
        intersects({ effectiveFrom: r.businessDate || r.periodStart, effectiveUntil: r.businessDate ? nextDay(r.businessDate) : r.periodEnd ? nextDay(r.periodEnd) : null }));
    const locks = state.locks.filter(l => {
        if (!['all', 'tech', undefined].includes(l.roleFilter)) return false;
        if (l.schemaVersion === 2 && Array.isArray(l.recordIds) && l.recordIds.length) {
            const linked = l.recordIds.map(id => state.records.find(r => r.id === id));
            if (linked.every(Boolean) && linked.every(r => r.personId && r.personId !== personId)) return false;
        }
        return intersects({ effectiveFrom: l.periodStart, effectiveUntil: l.periodEnd ? nextDay(l.periodEnd) : null });
    });
    return { records, locks, blocked: records.length > 0 || locks.length > 0 };
}
function approval(data, user, stamp, reviewed) {
    return { approvalReason: clean(data.approvalReason || data.notes), backdateConfirmed: data.backdateConfirmed === true,
        identityConfirmed: data.identityConfirmed === true, finalConfirmed: data.correctionConfirmed === true,
        exclusionRemovalConfirmed: data.exclusionRemovalConfirmed === true,
        impactFingerprint: data.impactFingerprint || null, confirmedBy: user.uid, confirmedAt: stamp,
        impactSummary: reviewed?.required ? { start: reviewed.start, until: reviewed.until, candidateJobCount: reviewed.candidateJobCount,
            classification: reviewed.classification || 'BACKDATED_CONFIGURATION', lockedDays: reviewed.lockedDays } : null };
}
function coverage(person, bindings) {
    const ranges = bindings.filter(b => b.personId === person.personId).map(b => ({ effectiveFrom: b.effectiveFrom, effectiveUntil: b.effectiveUntil || null })).sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
    return { enrollmentFrom: person.enrollmentFrom, enrollmentUntil: ranges.some(r => !r.effectiveUntil) ? null : ranges.at(-1)?.effectiveUntil || null, enrollmentRanges: ranges };
}
function ruleCoverage(person, bindings, rule) {
    const c = coverage(person, bindings);
    if (!rule.effectiveFrom) return { ...c, gap: false };
    let cursor = rule.effectiveFrom;
    for (const range of c.enrollmentRanges) {
        if (range.effectiveUntil && range.effectiveUntil <= cursor) continue;
        if (range.effectiveFrom > cursor) break;
        if (!range.effectiveUntil || (rule.effectiveUntil && range.effectiveUntil >= rule.effectiveUntil)) return { ...c, gap: rule.effectiveFrom !== c.enrollmentFrom || (rule.effectiveUntil || null) !== c.enrollmentUntil };
        cursor = range.effectiveUntil;
    }
    reject('failed-precondition', 'Confirmed identity must cover the entire rule period');
}
function voidPlan(state, data, jobs) {
    const person = state.persons.find(p => p.personId === data.personId);
    if (!person) reject('not-found', 'Current enrollment not found');
    if (data.expectedEnrollmentRevision !== revision(person)) reject('aborted', 'Enrollment revision changed. Reload before voiding.');
    const approvalReason = reason(data), bindings = state.bindings.filter(b => b.personId === person.personId);
    const emails = new Set(bindings.map(b => norm(b.stationEmail)).filter(Boolean));
    const staffIds = new Set(bindings.map(b => b.staffId).filter(Boolean));
    // Any attributable source activity blocks normal Void, including non-final jobs.
    const candidates = jobs.filter(j => j.personId === person.personId || j.technicianPersonId === person.personId ||
        [j.assignedTechEmail, j.techEmail].some(email => emails.has(norm(email))) ||
        [j.technicianStaffId, j.assignedTechId, j.techId].some(id => staffIds.has(id)));
    const rules = state.data.Commission_Rules.filter(r => r.technicianPersonId === person.personId);
    const protectedState = protectedCoverage(state, person.personId, [{ effectiveFrom: person.enrollmentFrom, effectiveUntil: null }]);
    const records = state.records.filter(r => r.personId === person.personId || emails.has(norm(r.staffEmail)));
    return { person, bindings, approvalReason, candidates, rules, records, locks: protectedState.locks,
        blocked: !!(candidates.length || rules.length || records.length || protectedState.blocked) };
}
module.exports = { snapshot, normalizeBinding, reason, planCorrection, protectedCoverage, approval, revision, coverage, ruleCoverage, voidPlan };
