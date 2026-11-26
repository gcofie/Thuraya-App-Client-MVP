'use strict';

const MANAGER_ROLES = new Set(['admin', 'manager', 'system admin']);
const normalizeRole = value => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const normalizeEmail = value => String(value || '').trim().toLowerCase();
function deny(code, message) { throw Object.assign(new Error(message), { code }); }

function approvedOperators(raw, projectId) {
    try {
        const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!config || config.projectId !== projectId || config.version !== 1 || !Array.isArray(config.operators)) return new Map();
        const operators = new Map();
        for (const entry of config.operators) {
            if (!entry || typeof entry.uid !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(entry.uid) || operators.has(entry.uid)) return new Map();
            const email = normalizeEmail(entry.email);
            const roles = Array.isArray(entry.roles) ? entry.roles.map(normalizeRole) : [];
            if (!email || email.includes('/') || !email.includes('@') || !roles.length || roles.some(role => !MANAGER_ROLES.has(role))) return new Map();
            operators.set(entry.uid, { email, roles, enabled: entry.enabled === true });
        }
        return operators;
    } catch (_) { return new Map(); }
}

function createCommissionAuthorization({ db, projectId, operatorConfig }) {
    return async function resolveActor(request, reader = { get: ref => ref.get() }) {
        if (!request.auth?.uid) deny('unauthenticated', 'Sign in is required');
        const uid = request.auth.uid;
        const email = normalizeEmail(request.auth.token?.email);
        if (!email || email.includes('/') || !email.includes('@')) deny('permission-denied', 'A Staff identity is required');
        const snapshot = await reader.get(db.collection('Users').doc(email));
        if (!snapshot.exists) deny('permission-denied', 'A Staff profile is required');
        const staff = snapshot.data() || {};
        if (staff.active === false || staff.disabled === true || ['disabled', 'inactive', 'terminated'].includes(normalizeRole(staff.status))) deny('permission-denied', 'Staff access is disabled');
        const roles = (Array.isArray(staff.roles) ? staff.roles : [staff.role]).filter(Boolean).map(normalizeRole);
        // Users roles are client-editable in the live baseline: a pinned Auth UID is also mandatory.
        const approved = approvedOperators(operatorConfig(), projectId).get(uid);
        const manager = !!(approved?.enabled && approved.email === email && roles.some(role => MANAGER_ROLES.has(role) && approved.roles.includes(role)));
        const admin = manager && roles.some(role => ['admin', 'system admin'].includes(role) && approved.roles.includes(role));
        return { uid, email, roles, manager, admin };
    };
}

module.exports = { createCommissionAuthorization, approvedOperators, normalizeRole };
