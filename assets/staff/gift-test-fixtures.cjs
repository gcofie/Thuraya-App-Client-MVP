'use strict';
const assert = require('node:assert/strict');
const { createGiftService } = require('./functions/gift-service');
const clone = value => structuredClone(value);
const DELETE = { __delete: true };
function memoryDb(seed = {}) {
    let revision = 1, queue = Promise.resolve();
    const rows = new Map(Object.entries(seed).map(([path, data]) => [path, { data: clone(data), revision: revision++ }]));
    const writes = [];
    const db = {
        writes, rows, failCommit: false,
        collection(name) { return query(name); },
        doc(path) { const parts = path.split('/'); return this.collection(parts[0]).doc(parts[1]); },
        set(path, data) { rows.set(path, { data: clone(data), revision: revision++ }); },
        async runTransaction(callback) {
            let release;
            const prior = queue; queue = new Promise(resolve => { release = resolve; });
            await prior;
            try {
                const pending = [];
                const tx = { get: async ref => { assert.equal(pending.length, 0, 'all transaction reads precede writes'); return ref.get(); },
                    update: (ref, data) => pending.push({ method: 'update', ref, data }),
                    set: (ref, data, options) => pending.push({ method: options?.merge ? 'update' : 'set', ref, data }),
                    create: (ref, data) => pending.push({ method: 'create', ref, data }) };
                const result = await callback(tx);
                if (db.failCommit) throw Error('synthetic failure before commit');
                for (const p of pending) {
                    if (p.method === 'create') assert.ok(!rows.has(p.ref.path));
                    if (p.method === 'update') assert.ok(rows.has(p.ref.path));
                }
                for (const p of pending) {
                    const data = p.method === 'update' ? { ...rows.get(p.ref.path).data } : {};
                    for (const [k, v] of Object.entries(p.data)) { if (v?.__delete) delete data[k]; else data[k] = clone(v); }
                    db.set(p.ref.path, data); writes.push({ path: p.ref.path, method: p.method });
                }
                return result;
            } finally { release(); }
        }
    };
    function snapshot(ref) {
        const row = rows.get(ref.path);
        return { exists: !!row, id: ref.id, ref, data: () => clone(row?.data), updateTime: { toDate: () => new Date((row?.revision || 0) * 1000) } };
    }
    function query(name, filters = [], limit = Infinity, cursor = '') {
        return { doc: id => { const ref = { path: name + '/' + id, id, get: async () => snapshot(ref) }; return ref; },
            where: (field, op, value) => { assert.equal(op, '=='); return query(name, [...filters, [field, value]], limit, cursor); },
            orderBy: () => query(name, filters, limit, cursor), limit: n => query(name, filters, n, cursor), startAfter: value => query(name, filters, limit, value),
            get: async () => ({ docs: [...rows.keys()].filter(path => path.split('/')[0] === name && path.split('/')[1] > cursor)
                .sort().map(path => snapshot(db.doc(path))).filter(s => filters.every(([field, value]) => s.data()[field] === value)).slice(0, limit) }) };
    }
    return db;
}
const code = 'THGC-ABCD-W26C';
function fixture(options = {}) {
    const staff = { admin: 'System Admin', manager: 'Manager', foh: 'FOH', foh2: 'FOH', tech: 'Tech', unapproved: 'Manager', unapprovedAdmin: 'System Admin' };
    const seed = Object.fromEntries(Object.entries(staff).map(([uid, role]) => ['Users/' + uid + '@example.test', { uid, email: uid + '@example.test', role, active: true }]));
    seed['Gift_Cards/' + code] = { code, amount: 250, remainingBalance: 250, totalAllowedUses: 3, usedCount: 0, remainingUses: 3, status: 'Active', expiryDate: '2026-09-30', recipientName: 'Synthetic Recipient', purchaserName: 'Synthetic Sender', recipientPhone: 'private', message: 'private message', ...options.card };
    seed['Active_Jobs/job'] = { status: 'Ready for Payment', paymentStatus: 'Unpaid', amountDue: 100, sourceAppointmentId: 'appt', ...options.job };
    seed['Appointments/appt'] = { status: 'In Progress', activeJobId: 'job', ...options.appointment };
    const db = memoryDb(seed);
    let now = new Date('2026-09-09T12:00:00Z');
    const config = { version: 1, projectId: 'thuraya-staging', referenceKey: Buffer.alloc(32, 7).toString('base64'), operators: ['admin', 'manager', 'foh', 'foh2'].map(uid => ({ uid, email: uid + '@example.test', roles: [staff[uid]], enabled: true,
        capabilities: uid.startsWith('foh') ? ['giftLookup', 'giftCheckout'] : ['giftAdmin', 'giftLookup', 'giftCheckout'] })) };
    const service = createGiftService({ db, projectId: 'thuraya-staging', securityConfig: () => config,
        fieldValue: { serverTimestamp: () => now.toISOString(), delete: () => DELETE }, clock: () => now });
    const request = (command, data = {}, uid = 'foh') => ({ auth: uid ? { uid, token: { email: uid + '@example.test' } } : null, data: { projectId: 'thuraya-staging', command, ...data } });
    const call = (command, data, uid) => service.handle(request(command, data, uid));
    async function checkoutInput(overrides = {}) {
        const context = { primaryJobId: 'job', jobIds: ['job'], quotedTotal: 100, planned: true, split: false, topUps: [] };
        const quote = await call('prepareCheckout', context);
        const card = await call('lookup', { code });
        return { ...context, requestId: 'request-one', fingerprint: quote.fingerprint, cards: [{ code, appliedAmount: 100, version: card.version }], ...overrides };
    }
    return { db, config, service, call, request, checkoutInput, setNow: value => { now = new Date(value); } };
}
module.exports = { fixture, memoryDb, code };
