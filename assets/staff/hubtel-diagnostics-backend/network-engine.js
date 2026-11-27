'use strict';
const dns = require('node:dns').promises;
const net = require('node:net');
const tls = require('node:tls');
const https = require('node:https');
const { fault, publicAddress, checkedAddress, canonicalIp, checkHost, normalizeTarget, targetUrl, safeIdentifier } = require('./target-policy');
const ECHO = 'api.ipify.org', TIMEOUT_MS = 3500;
function category(error) {
    const code = String(error?.code || '');
    if (['TIMEOUT', 'ETIMEDOUT', 'ETIMEOUT'].includes(code)) return 'TIMEOUT';
    if (code === 'ECONNREFUSED') return 'CONNECTION_REFUSED';
    if (['ENOTFOUND', 'ENODATA', 'EAI_AGAIN', 'ESERVFAIL'].includes(code)) return 'DNS_FAILURE';
    if (code === 'ERR_TLS_CERT_ALTNAME_INVALID') return 'TLS_HOSTNAME_MISMATCH';
    if (/CERT|SELF_SIGNED|ISSUER|TLS_UNAUTHORIZED/.test(code)) return 'TLS_CERTIFICATE_INVALID';
    if (['UNSAFE_ADDRESS', 'DESTINATION_MISMATCH', 'PAYLOAD_LIMIT', 'INVALID_ECHO', 'HOST_NOT_ALLOWED', 'DNS_REBINDING_BLOCKED'].includes(code)) return code;
    return 'NETWORK_ERROR';
}
function parseEgress(value) {
    const ip = String(value).trim();
    if (ip.length > 45 || !publicAddress(ip)) throw fault('INVALID_ECHO');
    return ip;
}
function destination(socket, address) {
    const actual = socket?.remoteAddress;
    if (!actual) throw fault('DESTINATION_MISMATCH');
    checkedAddress(actual);
    if (canonicalIp(actual) !== canonicalIp(address)) throw fault('DESTINATION_MISMATCH');
    return actual;
}
function certificateInfo(socket, hostname) {
    if (!socket.authorized) throw fault('TLS_UNAUTHORIZED');
    const certificate = socket.getPeerCertificate();
    const mismatch = tls.checkServerIdentity(hostname, certificate);
    if (mismatch) throw mismatch;
    const expiry = Date.parse(certificate.valid_to);
    if (!Number.isFinite(expiry) || expiry <= Date.now()) throw fault('CERT_HAS_EXPIRED');
    return { certificateValid: true, hostnameMatches: true, certificateExpiry: new Date(expiry).toISOString(), tlsVersion: socket.getProtocol() };
}
function createTransport(deps = {}) {
    const Resolver = deps.Resolver || dns.Resolver, connect = deps.connect || net.connect,
        secureConnect = deps.secureConnect || tls.connect, request = deps.request || https.request;
    const timeoutMs = deps.timeoutMs || TIMEOUT_MS;
    const timeout = options => Math.max(1, Math.min(timeoutMs, options?.timeoutMs || timeoutMs));
    async function resolve(hostname, options = {}) {
        checkHost(hostname);
        if (net.isIP(hostname)) return { ipv4: net.isIP(hostname) === 4 ? [checkedAddress(hostname)] : [], ipv6: net.isIP(hostname) === 6 ? [checkedAddress(hostname)] : [] };
        const resolver = new Resolver(); let timer;
        try {
            const answers = await Promise.race([
                Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]),
                new Promise((_, reject) => { timer = setTimeout(() => { reject(fault('TIMEOUT')); resolver.cancel(); }, timeout(options)); })
            ]);
            for (const answer of answers) if (answer.status === 'rejected' && !['ENODATA', 'ENOTFOUND'].includes(answer.reason?.code)) throw answer.reason;
            const addresses = answers.map(answer => answer.status === 'fulfilled' ? answer.value : []);
            if (!addresses.flat().length) throw fault('ENOTFOUND');
            if (addresses.flat().length > 64) throw fault('PAYLOAD_LIMIT');
            addresses.flat().forEach(checkedAddress);
            return { ipv4: [...new Set(addresses[0])], ipv6: [...new Set(addresses[1])] };
        } finally { clearTimeout(timer); }
    }
    function socketProbe(hostname, address, secure, options = {}) {
        checkHost(hostname); checkedAddress(address);
        return new Promise((resolve, reject) => {
            let socket, done = false;
            const finish = (error, value) => { if (done) return; done = true; clearTimeout(timer); socket?.destroy(); error ? reject(error) : resolve(value); };
            const timer = setTimeout(() => finish(fault('TIMEOUT')), timeout(options));
            try {
                const config = { host: address, port: 443, family: net.isIP(address) };
                if (secure) Object.assign(config, { servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: true, minVersion: 'TLSv1.2', checkServerIdentity: (_name, cert) => tls.checkServerIdentity(hostname, cert) });
                socket = (secure ? secureConnect : connect)(config);
                socket.once('error', error => finish(error)); socket.once('close', () => finish(fault('ECONNRESET')));
                socket.once(secure ? 'secureConnect' : 'connect', () => {
                    try { finish(null, { connectedIp: destination(socket, address), ...(secure ? certificateInfo(socket, hostname) : {}) }); }
                    catch (error) { finish(error); }
                });
            } catch (error) { finish(error); }
        });
    }
    function httpProbe(hostname, address, options = {}, echo = false) {
        checkHost(hostname); checkedAddress(address);
        const target = normalizeTarget({ mode: 'URL', value: 'https://' + (net.isIP(hostname) === 6 ? '[' + hostname + ']' : hostname) + (options.path || '/'), method: echo ? 'GET' : options.method || 'HEAD' });
        if (echo && (hostname !== ECHO || target.path !== '/')) throw fault('HOST_NOT_ALLOWED');
        return new Promise((resolve, reject) => {
            let req, response, done = false, bytes = 0, body = '', sent = false, sentAt = null;
            const finish = (error, value) => {
                if (done) return; done = true; clearTimeout(timer); response?.destroy(); req?.destroy();
                if (error) { error.requestSent = sent; error.sentAt = sentAt; reject(error); } else resolve({ ...value, requestSent: sent, sentAt });
            };
            const timer = setTimeout(() => finish(fault('TIMEOUT')), timeout(options));
            try {
                const method = target.method === 'EMPTY_POST' ? 'POST' : target.method;
                req = request({ hostname, port: 443, path: target.path, method,
                    servername: net.isIP(hostname) ? undefined : hostname, rejectUnauthorized: true, minVersion: 'TLSv1.2',
                    checkServerIdentity: (_name, cert) => tls.checkServerIdentity(hostname, cert),
                    agent: false, maxHeaderSize: 8192,
                    lookup: (_host, lookupOptions, callback) => lookupOptions?.all ? callback(null, [{ address, family: net.isIP(address) }]) : callback(null, address, net.isIP(address)),
                    headers: { Accept: 'text/plain', 'User-Agent': 'THURAYA-Network-Diagnostics/2.0', ...(method === 'POST' ? { 'Content-Length': '0' } : {}) }
                }, res => {
                    response = res;
                    let connectedIp;
                    try { connectedIp = destination(res.socket, address); certificateInfo(res.socket, hostname); }
                    catch (error) { return finish(error); }
                    const status = res.statusCode;
                    if (!Number.isInteger(status) || status < 100 || status > 599) return finish(fault('NETWORK_ERROR'));
                    // No redirect following or arbitrary response-body consumption.
                    if (!echo) return finish(null, { httpStatus: status, connectedIp, redirectLocation: [301,302,303,307,308].includes(status) ? res.headers?.location || null : null });
                    if (status !== 200) return finish(fault('INVALID_ECHO'));
                    res.on('data', chunk => { bytes += chunk.length; if (bytes > 1024) return finish(fault('PAYLOAD_LIMIT')); body += chunk.toString('utf8'); });
                    res.once('error', error => finish(error)); res.once('aborted', () => finish(fault('ECONNRESET')));
                    res.once('end', () => { try { finish(null, { ip: parseEgress(body) }); } catch (error) { finish(error); } });
                });
                req.once('finish', () => { sent = true; sentAt = new Date().toISOString(); });
                req.once('socket', socket => socket.once('secureConnect', () => {
                    try { destination(socket, address); certificateInfo(socket, hostname); } catch (error) { finish(error); }
                }));
                req.once('error', error => finish(error)); req.end();
            } catch (error) { finish(error); }
        });
    }
    return { resolve, tcp: (host, ip, options) => socketProbe(host, ip, false, options),
        tls: (host, ip, options) => socketProbe(host, ip, true, options), https: (host, ip, options) => httpProbe(host, ip, options),
        async egress(options = {}) {
            const answers = await resolve(ECHO, options), fresh = await resolve(ECHO, options);
            const ip = fresh.ipv4[0] || fresh.ipv6[0];
            if (![...answers.ipv4, ...answers.ipv6].includes(ip)) throw fault('DNS_REBINDING_BLOCKED');
            return (await httpProbe(ECHO, ip, options, true)).ip;
        }
    };
}
async function probeTarget(target, transport, now = () => Date.now(), deadline = Infinity) {
    const started = now(), budget = () => { if (now() >= deadline) throw fault('TIMEOUT'); return { timeoutMs: Math.min(TIMEOUT_MS, deadline - now()) }; };
    const { path, ...safe } = target;
    const result = { ...safe, resolvedIpv4: [], resolvedIpv6: [], dnsStatus: 'NOT_RUN', tcp443Status: 'NOT_RUN', tcpStatus: 'NOT_RUN', tlsStatus: 'NOT_RUN', hostnameMatches: null,
        httpsReachable: false, httpsStatus: 'NOT_RUN', checkedAt: new Date(started).toISOString(), requestSent: false };
    let phase = 'dnsStatus';
    try {
        const answers = await transport.resolve(target.hostname, budget());
        [...answers.ipv4, ...answers.ipv6].forEach(checkedAddress);
        result.resolvedIpv4 = answers.ipv4; result.resolvedIpv6 = answers.ipv6; result.dnsStatus = 'PASS';
        const ip = answers.ipv4[0] || answers.ipv6[0]; checkedAddress(ip); result.probedDestinationIp = ip;
        async function fresh() {
            const next = await transport.resolve(target.hostname, budget());
            [...next.ipv4, ...next.ipv6].forEach(checkedAddress);
            if (![...next.ipv4, ...next.ipv6].map(canonicalIp).includes(canonicalIp(ip))) throw fault('DNS_REBINDING_BLOCKED');
        }
        phase = 'tcp443Status'; await fresh(); Object.assign(result, await transport.tcp(target.hostname, ip, budget())); result[phase] = 'PASS'; result.tcpStatus = 'PASS';
        phase = 'tlsStatus'; await fresh(); Object.assign(result, await transport.tls(target.hostname, ip, budget())); result[phase] = 'PASS';
        phase = 'httpsStatus'; await fresh();
        const http = await transport.https(target.hostname, ip, { ...budget(), path, method: target.method });
        const { redirectLocation, ...technical } = http; Object.assign(result, technical); result[phase] = 'NETWORK_REACHABLE'; result.httpsReachable = true;
        if (redirectLocation) {
            result.redirectStatus = 'BLOCKED';
            try {
                const redirect = targetUrl(new URL(redirectLocation, 'https://' + (net.isIP(target.hostname) === 6 ? '[' + target.hostname + ']' : target.hostname) + path).href);
                const validated = normalizeTarget({ mode: 'URL', value: 'https://' + (net.isIP(redirect.hostname) === 6 ? '[' + redirect.hostname + ']' : redirect.hostname) + redirect.path, method: target.method });
                const resolved = await transport.resolve(validated.hostname, budget());
                if (![...resolved.ipv4, ...resolved.ipv6].length) throw fault('ENOTFOUND');
                [...resolved.ipv4, ...resolved.ipv6].forEach(checkedAddress);
                result.redirectTarget = safeIdentifier(validated.hostname, validated.path); result.redirectStatus = 'VALIDATED_NOT_FOLLOWED';
            } catch { result.redirectStatus = 'BLOCKED'; }
        } else result.redirectStatus = 'NONE';
    } catch (error) {
        result.errorCategory = category(error); result[phase] = result.errorCategory === 'TIMEOUT' ? 'TIMEOUT' : 'FAIL';
        if (phase === 'tcp443Status') result.tcpStatus = result[phase];
        result.requestSent = !!error.requestSent;
        result.sentAt = error.sentAt || null;
        if (result.errorCategory === 'TLS_HOSTNAME_MISMATCH') result.hostnameMatches = false;
    }
    result.latencyMs = Math.max(0, now() - started); return result;
}
module.exports = { ECHO, TIMEOUT_MS, category, publicAddress, parseEgress, createTransport, probeTarget };
