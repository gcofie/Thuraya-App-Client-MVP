'use strict';
const role = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const roles = new Set(['foh', 'manager', 'system admin']);
function fail(code, message) { throw Object.assign(new Error(message), { code }); }
function parseConfig(raw, projectId) {
    try {
        const c = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!['thuraya-staging', 'thuraya-client-telling'].includes(projectId) || c?.version !== 1 || c.projectId !== projectId || !Array.isArray(c.operators)) return null;
        const map = new Map();
        for (const o of c.operators) {
            if (!o || !/^[A-Za-z0-9_-]{1,128}$/.test(o.uid || '') || map.has(o.uid) ||
                !/^[^\s/@]+@[^\s/@]+$/.test(o.email || '') || o.email !== o.email.toLowerCase() ||
                typeof o.enabled !== 'boolean' || !Array.isArray(o.roles) || !o.roles.length || o.roles.some(r => !roles.has(role(r)))) return null;
            map.set(o.uid, { ...o, roles: o.roles.map(role) });
        }
        return map;
    } catch (_) { return null; }
}
function createAuthorization({ db, projectId, config }) {
    return async (request, reader = { get: ref => ref.get() }) => {
        if (!request.auth?.uid) fail('unauthenticated', 'Sign in to manage No Shows.');
        if (request.data?.projectId !== projectId) fail('permission-denied', 'The booking environment does not match.');
        const roster = parseConfig(config(), projectId);
        if (!roster) fail('failed-precondition', 'No Show authorization is unavailable.');
        const entry = roster.get(request.auth.uid), email = String(request.auth.token?.email || '').toLowerCase();
        if (!entry?.enabled || entry.email !== email) fail('permission-denied', 'Your account is not approved to manage No Shows.');
        const snap = await reader.get(db.collection('Users').doc(email)), staff = snap.exists ? snap.data() : null;
        const currentRoles = (Array.isArray(staff?.roles) ? staff.roles : [staff?.role]).map(role);
        if (!staff || staff.active !== true || staff.disabled === true || ['inactive', 'disabled', 'terminated'].includes(role(staff.status)) ||
            staff.uid && staff.uid !== request.auth.uid || !currentRoles.some(r => entry.roles.includes(r))) fail('permission-denied', 'An active, approved FOH, Manager or System Admin identity is required.');
        return { uid: request.auth.uid, email };
    };
}
module.exports = { createAuthorization, parseConfig, fail };
