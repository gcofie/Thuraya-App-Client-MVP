'use strict';

const CAPABILITIES = new Set(['giftAdmin', 'giftLookup', 'giftCheckout']);
const ROLES = new Set(['system admin', 'admin', 'manager', 'foh']);
const role = value => String(value || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
const email = value => String(value || '').trim().toLowerCase();
function fail(code, message) { throw Object.assign(new Error(message), { code }); }

function parseCapabilities(raw, projectId) {
    try {
        const config = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (!['thuraya-staging', 'thuraya-client-telling'].includes(projectId) ||
            config?.version !== 1 || config.projectId !== projectId || !Array.isArray(config.operators)) return new Map();
        const result = new Map();
        for (const item of config.operators) {
            if (!item || typeof item.uid !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(item.uid) || result.has(item.uid) ||
                !/^[^\s/@]+@[^\s/@]+$/.test(email(item.email)) || typeof item.enabled !== 'boolean' ||
                !Array.isArray(item.roles) || !item.roles.length || item.roles.some(r => !ROLES.has(role(r))) ||
                !Array.isArray(item.capabilities) || !item.capabilities.length || item.capabilities.some(c => !CAPABILITIES.has(c)) ||
                (item.capabilities.includes('giftAdmin') && item.roles.some(r => role(r) === 'foh'))) return new Map();
            result.set(item.uid, { email: email(item.email), roles: item.roles.map(role), capabilities: item.capabilities, enabled: item.enabled });
        }
        return result;
    } catch (_) { return new Map(); }
}

function createGiftAuthorization({ db, projectId, capabilityConfig }) {
    return async (request, capability, reader = { get: ref => ref.get() }) => {
        if (!request.auth?.uid) fail('unauthenticated', 'Sign in to use Gift Cards.');
        if (request.data?.projectId !== projectId) fail('permission-denied', 'Gift Card environment does not match.');
        const uid = request.auth.uid;
        const approved = parseCapabilities(capabilityConfig(), projectId).get(uid);
        const accountEmail = email(request.auth.token?.email);
        if (!approved?.enabled || approved.email !== accountEmail || (capability && !approved.capabilities.includes(capability))) {
            fail('permission-denied', 'Your account is not approved for this Gift Card operation.');
        }
        const snap = await reader.get(db.collection('Users').doc(approved.email));
        const staff = snap.exists ? snap.data() : null;
        const roles = (Array.isArray(staff?.roles) ? staff.roles : [staff?.role]).map(role);
        if (!staff || staff.active === false || staff.disabled === true || ['inactive', 'disabled', 'terminated'].includes(role(staff.status)) ||
            (staff.uid && staff.uid !== uid) || !roles.some(r => approved.roles.includes(r))) {
            fail('permission-denied', 'An active approved Staff identity is required.');
        }
        // The server-controlled UID capabilities, not a client-editable role, establish authority.
        return { uid, email: approved.email, capabilities: approved.capabilities.slice() };
    };
}

module.exports = { createGiftAuthorization, parseCapabilities, fail };
