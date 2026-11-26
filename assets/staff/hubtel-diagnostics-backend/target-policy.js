'use strict';
const net = require('node:net');
const { createHash } = require('node:crypto');
const { PROFILES } = require('./profiles');
function fault(code) { return Object.assign(new Error('Diagnostic target rejected'), { code }); }
function canonicalIp(ip) {
    if (!net.isIP(ip)) throw fault('UNSAFE_ADDRESS');
    return net.isIP(ip) === 6 ? new URL('https://[' + ip + ']/').hostname.slice(1, -1) : ip;
}
function publicAddress(ip) {
    if (net.isIP(ip) === 4) {
        const [a, b, c] = ip.split('.').map(Number);
        return !(ip === '168.63.129.16' || a === 0 || a === 10 || a === 127 || a >= 224 ||
            (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) ||
            (a === 172 && b >= 16 && b <= 31) ||
            (a === 192 && (b === 168 || b === 0 || (b === 88 && c === 99))) ||
            (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
            (a === 203 && b === 0 && c === 113));
    }
    if (net.isIP(ip) !== 6) return false;
    const normalized = canonicalIp(ip);
    // Conservative global unicast; no mapped/translation or transition ranges.
    return /^[23]/.test(normalized) && !/^(?:2001:|2002:|3ffe:|3fff:)/.test(normalized);
}
function checkedAddress(ip) { if (!publicAddress(ip)) throw fault('UNSAFE_ADDRESS'); return canonicalIp(ip); }
function checkHost(value) {
    if (typeof value !== 'string' || value.length > 253 || value !== value.trim() || /[^\x21-\x7e]|[\\/%?#@:]/.test(value) && !net.isIP(value)) throw fault('HOST_NOT_ALLOWED');
    if (net.isIP(value)) return checkedAddress(value);
    const host = value.toLowerCase();
    if (!host.includes('.') || host.endsWith('.') || host.split('.').some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        !/^[a-z][a-z0-9-]*$/.test(host.split('.').at(-1)) ||
        /(?:^|\.)(?:localhost|localdomain|local|internal|intranet|lan|home|corp|private|svc|cluster|consul|arpa|invalid|test|example|onion)$/.test(host) ||
        /(?:^|\.)(?:metadata|metadata-goog|instance-data)(?:\.|$)/.test(host)) throw fault('HOST_NOT_ALLOWED');
    return host;
}
function strictKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw fault('INVALID_TARGET');
}
function targetUrl(value) {
    if (typeof value !== 'string' || value.length > 2048 || value !== value.trim() || /[\s\\\x00-\x1f\x7f]/.test(value) || /%0[0-9a-f]|%7f/i.test(value) || /[?#]/.test(value)) throw fault('INVALID_TARGET');
    let url;
    try { url = new URL(value); } catch { throw fault('INVALID_TARGET'); }
    if (url.protocol !== 'https:') throw fault('UNSAFE_SCHEME');
    if (url.username || url.password || /^https:\/\/[^/]*@/i.test(value)) throw fault('URL_CREDENTIALS_FORBIDDEN');
    if (url.port && url.port !== '443') throw fault('UNSAFE_PORT');
    return { hostname: checkHost(url.hostname.replace(/^\[|\]$/g, '')), path: url.pathname || '/' };
}
function safeIdentifier(hostname, path = '/') {
    return hostname + (path === '/' ? '/' : '/[path-' + createHash('sha256').update(path).digest('hex').slice(0, 12) + ']');
}
function normalizeTarget(input) {
    strictKeys(input, ['mode', 'profile', 'value', 'method']);
    let hostname, path = '/', name, method = input.method || 'HEAD', targetType = input.mode;
    if (!['HEAD', 'GET', 'EMPTY_POST'].includes(method)) throw fault('UNSAFE_METHOD');
    if (input.mode === 'PREDEFINED') {
        const profile = PROFILES.find(item => item.id === input.profile);
        if (!profile || input.value !== undefined || method !== 'HEAD') throw fault('INVALID_TARGET');
        ({ hostname, name } = profile);
    } else {
        if (input.profile !== undefined) throw fault('INVALID_TARGET');
        if (input.mode === 'URL') ({ hostname, path } = targetUrl(input.value));
        else if (input.mode === 'IP') {
            if (!net.isIP(input.value)) throw fault('INVALID_TARGET');
            hostname = checkedAddress(input.value);
        } else if (input.mode === 'HOSTNAME') {
            hostname = checkHost(input.value);
            if (net.isIP(hostname)) throw fault('INVALID_TARGET');
        } else throw fault('INVALID_TARGET');
        if (method === 'EMPTY_POST' && input.mode !== 'URL') throw fault('UNSAFE_METHOD');
        name = 'Custom ' + (input.mode === 'IP' ? 'public IP' : input.mode === 'URL' ? 'HTTPS URL' : 'hostname');
    }
    // Known financial hosts remain root-only even through the custom interface.
    if (hostname === 'hubtel.com' || hostname.endsWith('.hubtel.com')) {
        if (!PROFILES.some(item => item.hostname === hostname) || path !== '/' || method !== 'HEAD') throw fault('PROFILE_ROOT_ONLY');
    }
    return Object.freeze({ name, targetType, hostname, path, port: 443, method,
        safeTarget: safeIdentifier(hostname, path), profile: input.profile || null });
}
module.exports = { fault, canonicalIp, publicAddress, checkedAddress, checkHost, strictKeys, targetUrl, safeIdentifier, normalizeTarget };
