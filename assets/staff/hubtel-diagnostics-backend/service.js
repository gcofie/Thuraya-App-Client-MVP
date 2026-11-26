'use strict';
const { randomUUID } = require('node:crypto');
const { probeTarget, category } = require('./network-engine');
const { PROFILES } = require('./profiles');
const { normalizeTarget } = require('./target-policy');
const CAPABILITY = 'integrations.hubtelDiagnostics.view';
const VIEW = 'integrations.networkDiagnostics.view';
const RUN = 'integrations.networkDiagnostics.run';
const CAPABILITIES = Object.freeze([CAPABILITY, VIEW, RUN]);
const PROJECTS = Object.freeze({ 'thuraya-staging': 'STAGING', 'thuraya-client-telling': 'PRODUCTION' });
class DiagnosticError extends Error {
    constructor(code) { super('Hubtel diagnostics unavailable'); this.code = code; }
}
async function authorize(request, projectId, readStaff) {
    const auth = request.auth;
    if (!auth?.uid) throw new DiagnosticError('unauthenticated');
    const token = auth.token || {};
    const email = token.email;
    if (!PROJECTS[projectId] || token.aud !== projectId || token.iss !== 'https://securetoken.google.com/' + projectId ||
        typeof email !== 'string' || email.length > 254 || /[\/\x00-\x1f]/.test(email)) throw new DiagnosticError('permission-denied');
    const profile = await readStaff(email);
    if (!profile || profile.active === false || profile.disabled === true ||
        ['inactive', 'disabled', 'terminated'].includes(String(profile.status || '').toLowerCase()) ||
        (profile.uid && profile.uid !== auth.uid)) throw new DiagnosticError('permission-denied');
    const roles = (Array.isArray(profile.roles) ? profile.roles : [profile.role || profile.roles])
        .filter(role => typeof role === 'string').map(role => role.trim().toLowerCase());
    // Roles resolve capabilities at the existing Staff identity boundary, not in probe logic.
    const capabilities = roles.some(role => ['admin', 'system admin', 'manager'].includes(role)) ? [...CAPABILITIES] : [];
    if (!capabilities.includes(VIEW)) throw new DiagnosticError('permission-denied');
    return { uid: auth.uid, capabilities };
}
function createService({ projectId, readStaff, transport, audit, now = () => Date.now(), uuid = randomUUID }) {
    const running = new Set(), lastRun = new Map();
    let lastGlobalRun = -Infinity;
    return async function handle(request) {
        const actor = await authorize(request, projectId, readStaff);
        const data = request.data;
        if (!data || typeof data !== 'object' || Array.isArray(data) ||
            Object.keys(data).some(key => !['command', 'projectId', 'target', 'confirmEmptyPost'].includes(key)) ||
            data.projectId !== projectId || !['capabilities', 'run', 'runTarget', 'runAll', 'compare'].includes(data.command)) throw new DiagnosticError('invalid-argument');
        if (data.command === 'capabilities') {
            if (data.target !== undefined || data.confirmEmptyPost !== undefined) throw new DiagnosticError('invalid-argument');
            return { capabilities: actor.capabilities, environment: PROJECTS[projectId], profiles: PROFILES };
        }
        if (!actor.capabilities.includes(RUN)) throw new DiagnosticError('permission-denied');
        let targets;
        try {
            const presets = () => PROFILES.map(profile => normalizeTarget({ mode: 'PREDEFINED', profile: profile.id }));
            if (['run', 'runAll'].includes(data.command)) {
                if (data.target !== undefined || data.confirmEmptyPost !== undefined) throw Error();
                targets = presets();
            } else {
                const target = normalizeTarget(data.target);
                if (data.command === 'compare' && target.targetType !== 'URL') throw Error();
                if (target.method === 'EMPTY_POST' ? data.confirmEmptyPost !== true : data.confirmEmptyPost !== undefined) throw Error();
                targets = data.command === 'compare' ? [...presets(), target] : [target];
            }
        } catch { throw new DiagnosticError('invalid-argument'); }
        if (running.size || running.has(actor.uid) || now() - (lastRun.get(actor.uid) ?? -Infinity) < 10000 ||
            now() - lastGlobalRun < 1000) throw new DiagnosticError('resource-exhausted');
        for (const [key, time] of lastRun) if (now() - time > 60000) lastRun.delete(key);
        running.add(actor.uid); lastRun.set(actor.uid, now()); lastGlobalRun = now();
        const correlationId = uuid(), checkedAt = new Date(now()).toISOString(), deadline = now() + 24000;
        try {
            const egress = await transport.egress({ timeoutMs: 2500 }).then(ip => ({ ip }), error => ({ ip: null, errorCategory: category(error) }));
            const services = [];
            for (const target of targets) services.push(await probeTarget(target, transport, now, deadline));
            const result = { environment: PROJECTS[projectId], projectId,
                executionPath: `Firebase Functions v2 / ${projectId} / us-central1 / hubtelNetworkDiagnostics`,
                egressIp: egress.ip, expectedHubtelSourceIp: egress.ip, egressErrorCategory: egress.errorCategory || null,
                checkedAt, correlationId, hubtelNetworkEnabled: false, mode: data.command,
                egressObservationScope: 'ONE_NEUTRAL_ECHO_PER_RUN', providerConfirmation: 'AWAITING PROVIDER CONFIRMATION',
                networkStatusScope: 'THIS_DIAGNOSTIC_BACKEND_ONLY', allowlistConfirmation: 'NOT_CONFIRMED',
                services: services.map(service => ({ ...service, expectedHubtelSourceIp: egress.ip, egressIp: egress.ip,
                    environment: PROJECTS[projectId], executionPath: `Firebase Functions v2 / ${projectId} / us-central1 / hubtelNetworkDiagnostics`, correlationId })) };
            await audit({ event: 'NETWORK_DIAGNOSTIC_RUN', actor: actor.uid, environment: result.environment,
                timestamp: checkedAt, correlationId, summary: { egressResolved: !!egress.ip,
                    services: services.map(({ name, targetType, safeTarget, method, dnsStatus, tcp443Status, tlsStatus, httpsStatus, httpStatus, errorCategory }) =>
                        ({ name, targetType, safeTarget, method, dnsStatus, tcp443Status, tlsStatus, httpsStatus, httpStatus: httpStatus || null, errorCategory: errorCategory || null })) } });
            for (const service of services.filter(item => item.method === 'EMPTY_POST' && item.requestSent)) await audit({
                event: 'NETWORK_EGRESS_CONFIRMATION_POST_SENT', actor: actor.uid, environment: result.environment,
                targetType: service.targetType, safeTarget: service.safeTarget, method: 'EMPTY_POST', timestamp: service.sentAt,
                resultCategory: service.httpsStatus, correlationId, providerConfirmation: 'AWAITING PROVIDER CONFIRMATION'
            });
            return result;
        } finally { running.delete(actor.uid); }
    };
}
module.exports = { CAPABILITY, CAPABILITIES, VIEW, RUN, PROJECTS, DiagnosticError, authorize, createService };
