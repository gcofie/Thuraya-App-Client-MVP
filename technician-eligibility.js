'use strict';
(function(root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.ThurayaTechnicianEligibility = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
    const normalize = value => String(value || '').trim().toLowerCase();
    const fields = ['schemaVersion', 'status', 'effectiveAt', 'revision', 'auditRef'];
    const roles = profile => Array.isArray(profile?.roles) ? profile.roles : profile?.role ? [profile.role] : [];
    function technician(profile) {
        return roles(profile).some(role => ['tech', 'technician', 'test tech'].includes(normalize(role)));
    }
    function accountEligible(profile) {
        return !!profile && profile.active !== false && profile.disabled !== true &&
            !['inactive', 'disabled', 'archived', 'terminated'].includes(normalize(profile.status));
    }
    function millis(value) {
        if (value instanceof Date) return value.getTime();
        if (typeof value?.toMillis === 'function') return value.toMillis();
        if (Number.isInteger(value?.seconds) && Number.isInteger(value?.nanoseconds) &&
            value.seconds >= -62135596800 && value.seconds <= 253402300799 &&
            value.nanoseconds >= 0 && value.nanoseconds < 1000000000)
            return value.seconds * 1000 + value.nanoseconds / 1000000;
        return NaN;
    }
    function state(profile, now = Date.now()) {
        if (!profile) return { valid:false, status:null, revision:null, reason:'MISSING_PROFILE' };
        if (!Object.prototype.hasOwnProperty.call(profile, 'technicianOperational'))
            return { valid:true, status:'ACTIVE', revision:0, legacy:true };
        const value = profile.technicianOperational;
        if (!value || typeof value !== 'object' || Array.isArray(value) ||
            Object.keys(value).length !== fields.length || !fields.every(key => Object.prototype.hasOwnProperty.call(value, key)) ||
            value.schemaVersion !== 1 || !['ACTIVE', 'INACTIVE'].includes(value.status) ||
            !Number.isSafeInteger(value.revision) || value.revision < 1 ||
            !Number.isFinite(millis(value.effectiveAt)) || millis(value.effectiveAt) > now ||
            typeof value.auditRef !== 'string' || !/^Technician_Status_Audit\/[a-f0-9]{64}$/.test(value.auditRef))
            return { valid:false, status:null, revision:null, reason:'INVALID_OPERATIONAL_STATE' };
        return { valid:true, status:value.status, revision:value.revision, legacy:false, effectiveAt:value.effectiveAt, auditRef:value.auditRef };
    }
    function eligible(profile, options = {}) {
        const current = state(profile, options.now);
        return technician(profile) && accountEligible(profile) && current.valid && current.status === 'ACTIVE' &&
            (!options.client || profile.visibleToClients !== false);
    }
    function assertEligible(profile, options) {
        if (!eligible(profile, options)) throw new Error('This technician is no longer available for a new assignment.');
    }
    const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
        ? Object.fromEntries(Object.keys(item).sort().map(key => [key,item[key]])) : item);
    function sameAllocation(before, after) {
        return !!before && ['assignedTechEmail','dateString','timeString','bookedDuration','duration',
            'totalDuration','startTime','bookingDate','members','groupMembers'].every(key =>
                            stable(before[key]) === stable(after[key]));
    }
    function futureBookings(rows, email, now = new Date()) {
        const date = now.toISOString().slice(0, 10);
        return rows.filter(row => normalize(row.assignedTechEmail) === normalize(email) &&
            !row.archived && !row.isArchived && !['cancelled','canceled','closed','completed','no show','no-show'].includes(normalize(row.status)) &&
            (!/^\d{4}-\d{2}-\d{2}$/.test(row.dateString || '') || row.dateString >= date));
    }
    // Capture writes explicitly, then revalidate the assigned profiles in the same
    // transaction. This does not patch the SDK or alter financial payloads.
    function bookingBatch(database, options = {}) {
        const writes = [];
        let committed = false;
        const batch = {
            set(ref, value, setOptions) { writes.push({ method:'set', ref, value, options:setOptions }); return batch; },
            update(ref, value) { writes.push({ method:'update', ref, value }); return batch; },
            async commit() {
                if (committed || !writes.length) throw new Error('Invalid or duplicate booking commit.');
                committed = true;
                return database.runTransaction(async transaction => {
                    if (options.isCurrent && !options.isCurrent()) throw new Error('Session ended.');
                    const existing = new Map();
                    for (const write of writes) {
                        if (/^(Appointments|Active_Jobs|Bookings)\/[^/]+$/.test(write.ref.path)) {
                            const snap = await transaction.get(write.ref);
                            existing.set(write.ref.path, snap.exists ? snap.data() : null);
                        }
                    }
                    const required = new Set();
                    for (const write of writes) {
                        if (!existing.has(write.ref.path)) continue;
                        const before = existing.get(write.ref.path);
                        const after = write.method === 'update' || write.options?.merge ? { ...before, ...write.value } : write.value;
                        const grandfathered = before && sameAllocation(before, after) &&
                            !(['no show','no-show','cancelled','canceled','closed','completed'].includes(normalize(before.status)) &&
                              !['no show','no-show','cancelled','canceled','closed','completed'].includes(normalize(after.status)));
                        if (!grandfathered) {
                            const email = normalize(after.assignedTechEmail);
                            if (!email || email !== after.assignedTechEmail || email.includes('/')) throw new Error('A valid Technician is required.');
                            required.add(email);
                        }
                        if (options.expected && options.expected.path === write.ref.path) {
                            if (!before || stable(before) !== stable(options.expected.value))
                                throw new Error('The appointment changed. Reload it before saving.');
                        }
                    }
                    for (const email of required) {
                        const snap = await transaction.get(database.collection('Users').doc(email));
                        assertEligible(snap.exists ? snap.data() : null, { client:options.client });
                    }
                    if (options.isCurrent && !options.isCurrent()) throw new Error('Session ended.');
                    for (const write of writes) {
                        if (write.method === 'update') transaction.update(write.ref, write.value);
                        else if (write.options) transaction.set(write.ref, write.value, write.options);
                        else transaction.set(write.ref, write.value);
                    }
                    return { committed:true };
                });
            }
        };
        return batch;
    }
    async function availableParents(database, emails, options) {
        const result = [];
        for (const email of [...new Set(emails)]) {
            const snap = await database.collection('Users').doc(email).get({ source:'server' });
            if (eligible(snap.exists ? snap.data() : null, options)) result.push(email);
        }
        return result;
    }
    async function temporaryWindows(database, date, emails) {
        const [leave, blocks] = await Promise.all([
            database.collection('Staff_Leave').where('status', '==', 'Approved').get({ source:'server' }),
            database.collection('Calendar_Blocks').get({ source:'server' })
        ]);
        const result = new Map(emails.map(email => [normalize(email), []]));
        const add = (email, start, end) => {
            if (!Number.isFinite(start) || !Number.isFinite(end) || start >= end) throw new Error('Invalid temporary availability block.');
            const targets = email ? [normalize(email)] : [...result.keys()];
            targets.forEach(key => { if (result.has(key)) result.get(key).push([start,end]); });
        };
        const minutes = value => /^([01]\d|2[0-3]):[0-5]\d$/.test(value || '') ? Number(value.slice(0,2))*60+Number(value.slice(3)) : NaN;
        leave.forEach(doc => { const row=doc.data(); if (row.techEmail && row.startDate <= date && row.endDate >= date) add(row.techEmail,0,1440); });
        blocks.forEach(doc => {
            const row=doc.data();
            if (row.dateString !== date && !(row.rangeStart && row.rangeEnd && row.rangeStart <= date && row.rangeEnd >= date)) return;
            if (row.type === 'full_day' || ['tech_specific','date_range'].includes(row.type) && row.techEmail) add(row.techEmail,0,1440);
            else if (row.type === 'time_range') add(row.techEmail,minutes(row.startTime),minutes(row.endTime));
        });
        return result;
    }
    return Object.freeze({ normalize, roles, technician, accountEligible, millis, state, eligible,
        assertEligible, sameAllocation, futureBookings, bookingBatch, availableParents, temporaryWindows });
});
