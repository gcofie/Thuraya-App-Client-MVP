'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { fixture, code } = require('./gift-test-fixtures.cjs');
const input = { code: 'THGC-AAAA-BBBB', amount: 250, totalAllowedUses: 3, purchaserName: 'Synthetic Sender', recipientName: 'Synthetic Recipient', expiryDate: '2026-09-30' };

for (const uid of [null, 'unknown', 'tech', 'unapproved', 'unapprovedAdmin']) {
    for (const command of ['lookup', 'registry', 'issue', 'edit', 'checkout', 'history']) test(`${uid || 'unauthenticated'} denied ${command}`, async () => {
        const f = fixture(); await assert.rejects(f.call(command, { code, card: input }, uid)); assert.equal(f.db.writes.length, 0);
    });
}
for (const uid of ['admin', 'manager']) test(`Approved ${uid} issue, edit, detail and registry`, async () => {
    const f = fixture();
    const issued = await f.call('issue', { card: input, requestId: 'issue' }, uid);
    const detail = await f.call('detail', { handle: issued.handle }, uid);
    assert.equal(detail.code, input.code); assert.equal(detail.amount, 250);
    const edited = await f.call('edit', { handle: issued.handle, version: detail.version, card: { ...input, message: 'New message' }, requestId: 'edit' }, uid);
    assert.equal((await f.call('detail', { handle: edited.handle }, uid)).message, 'New message');
    const registry = await f.call('registry', {}, uid);
    assert.equal(registry.cards.length, 2); assert.ok(!JSON.stringify(registry).includes(input.code));
    assert.ok(!registry.cards.some(c => c.recipientPhone || c.message || c.code));
});
for (const command of ['issue', 'edit', 'registry', 'detail', 'history']) test(`FOH cannot ${command}`, async () => {
    const f = fixture(); await assert.rejects(f.call(command, { card: input })); assert.equal(f.db.writes.length, 0);
});
for (const mutate of [c => { c.projectId = 'thuraya-client-telling'; }, c => { c.version = 2; }, c => { c.operators = []; }, c => { c.operators[2].enabled = false; }, c => { c.operators[2].capabilities.push('unknown'); }, c => { c.referenceKey = ''; }]) test('Malformed/revoked/wrong-environment configuration fails closed ' + mutate.toString(), async () => {
    const f = fixture(); mutate(f.config); await assert.rejects(f.call('lookup', { code })); assert.equal(f.db.writes.length, 0);
});
for (const change of [{ active: false }, { disabled: true }, { status: 'Terminated' }, { role: 'Tech' }, { uid: 'different' }]) test('Trusted Staff verification ' + JSON.stringify(change), async () => {
    const f = fixture(); f.db.set('Users/foh@example.test', { uid: 'foh', role: 'FOH', active: true, ...change }); await assert.rejects(f.call('lookup', { code }));
});
test('Users role self-escalation and spoofed payload do not grant Gift authority', async () => {
    const f = fixture(); f.db.set('Users/tech@example.test', { uid: 'tech', role: 'System Admin', active: true });
    await assert.rejects(f.call('issue', { card: input, uid: 'admin', email: 'admin@example.test' }, 'tech'));
    f.db.set('Users/foh@example.test', { uid: 'foh', role: 'Manager', active: true });
    await assert.rejects(f.call('issue', { card: input }));
});
test('Lookup is exact, masked, minimal, and read-only', async () => {
    const f = fixture(), result = await f.call('lookup', { code });
    assert.equal(result.valid, true); assert.equal(result.maskedCode, 'THGC-****-W26C');
    assert.equal(f.db.writes.length, 0); assert.ok(!JSON.stringify(result).includes('private'));
    assert.ok(!JSON.stringify(result).includes(code)); assert.ok(!('recipientName' in result));
    assert.equal((await f.call('lookup', { code: input.code })).state, 'NOT_FOUND');
    await assert.rejects(f.call('lookup', { code: 'THGC-ABCD' }));
});
for (const value of [code.toLowerCase(), ' ' + code + ' ', code.replaceAll('-', '\u2011'), code.replaceAll('-', ''), code.replace('THGC-', ''), 'THGC - ABCD - W26C']) test('Canonical code lookup ' + value.replace(/ABCD/g, '****'), async () => {
    assert.equal((await fixture().call('lookup', { code: value })).state, 'VALID');
});
for (const [name, card, state] of [
    ['expired', { expiryDate: '2026-09-08' }, 'EXPIRED'], ['today', { expiryDate: '2026-09-09' }, 'VALID'],
    ['tomorrow', { expiryDate: '2026-09-10' }, 'VALID'], ['partial', { remainingBalance: 75, usedCount: 1, remainingUses: 2 }, 'VALID'],
    ['zero', { remainingBalance: 0 }, 'NO_BALANCE'], ['inactive', { status: 'Inactive' }, 'INACTIVE'],
    ['redeemed', { status: 'Redeemed', remainingBalance: 0 }, 'REDEEMED'], ['use limit', { status: 'Redeemed', remainingBalance: 75, remainingUses: 0, usedCount: 3 }, 'USE_LIMIT_REACHED'],
    ['malformed', { expiryDate: '09/09/2026' }, 'MALFORMED_DATE'], ['legacy', { expiryDate: null, validUntil: '2026-09-10' }, 'VALID']
]) test('Server state: ' + name, async () => { assert.equal((await fixture({ card }).call('lookup', { code })).state, state); });
test('Expiry uses fresh server Accra date, ignores client clock', async () => {
    const f = fixture({ card: { expiryDate: '2026-09-09' } });
    f.setNow('2026-09-09T23:59:59Z'); assert.equal((await f.call('lookup', { code, today: '2000-01-01' })).state, 'VALID');
    f.setNow('2026-09-10T00:00:00Z'); assert.equal((await f.call('lookup', { code, today: '2000-01-01' })).state, 'EXPIRED');
});
test('Atomic Gift checkout creates linked receipt, closes exact jobs/appointments, masks new evidence', async () => {
    const f = fixture(), before = f.db.rows.get('Gift_Cards/' + code).data.amount;
    const result = await f.call('checkout', await f.checkoutInput());
    assert.equal(result.state, 'COMMITTED'); assert.equal(result.total, 100); assert.equal(result.receiptRef, 'THR-JOB');
    assert.equal(f.db.rows.get('Gift_Cards/' + code).data.remainingBalance, 150);
    assert.equal(f.db.rows.get('Gift_Cards/' + code).data.amount, before);
    for (const path of ['Active_Jobs/job', 'Appointments/appt']) {
        const row = f.db.rows.get(path).data; assert.equal(row.status, 'Closed'); assert.equal(row.giftCheckoutId, result.checkoutId);
        assert.ok(!JSON.stringify(row).includes(code));
    }
    assert.equal(f.db.rows.get('Active_Jobs/job').data.totalGHC, 100);
    assert.deepEqual([...new Set(f.db.writes.map(w => w.path.split('/')[0]))].sort(), ['Active_Jobs', 'Appointments', 'Gift_Card_Redemptions', 'Gift_Cards', 'Gift_Checkouts']);
});
test('Idempotent retry/status after lost response has one financial effect', async () => {
    const f = fixture(), payload = await f.checkoutInput();
    const first = await f.call('checkout', payload), count = f.db.writes.length;
    assert.deepEqual(await f.call('checkout', payload), first);
    assert.deepEqual(await f.call('checkoutStatus', { requestId: payload.requestId }), first);
    assert.equal(f.db.writes.length, count);
    await assert.rejects(f.call('checkout', { ...payload, quotedTotal: 1 }));
});
test('Concurrent duplicate submissions return identical receipt', async () => {
    const f = fixture(), payload = await f.checkoutInput();
    const [a,b] = await Promise.all([f.call('checkout', payload), f.call('checkout', payload)]);
    assert.deepEqual(a,b); assert.equal(f.db.rows.get('Gift_Cards/' + code).data.usedCount, 1);
});
test('Two FOH operators cannot debit the same checkout twice', async () => {
    const f = fixture(), payload = await f.checkoutInput();
    const results = await Promise.allSettled([f.call('checkout', payload), f.call('checkout', { ...payload, requestId: 'other' }, 'foh2')]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.db.rows.get('Gift_Cards/' + code).data.remainingBalance, 150);
});
test('Failure before transaction commit rolls back card, ledger, job and appointment', async () => {
    const f = fixture(), payload = await f.checkoutInput(), before = JSON.stringify([...f.db.rows]);
    f.db.failCommit = true; await assert.rejects(f.call('checkout', payload)); assert.equal(JSON.stringify([...f.db.rows]), before);
    assert.equal(f.db.writes.length, 0); f.db.failCommit = false; assert.equal((await f.call('checkout', payload)).state, 'COMMITTED');
});
for (const [name, change] of [
    ['over redemption', p => { p.cards[0].appliedAmount = 300; }], ['negative amount', p => { p.cards[0].appliedAmount = -1; }],
    ['duplicate card', p => { p.cards.push(p.cards[0]); }], ['missing card fingerprint', p => { delete p.cards[0].version; }],
    ['missing job fingerprint', p => { delete p.fingerprint; }], ['invented job', p => { p.primaryJobId = 'invented'; }],
    ['wrong job set', p => { p.jobIds = ['other']; }], ['client amount overwrite', p => { p.quotedTotal = 1; }],
    ['missing topup', p => { p.cards[0].appliedAmount = 50; }], ['unconfirmed topup method', p => { p.topUps = [{ method: 'Voucher', amount: 50 }]; p.cards[0].appliedAmount = 50; }]
]) test('Checkout rejects ' + name + ' without writes', async () => {
    const f = fixture(), payload = await f.checkoutInput(); change(payload); await assert.rejects(f.call('checkout', payload)); assert.equal(f.db.writes.length, 0);
});
for (const path of ['Active_Jobs/job', 'Appointments/appt', 'Gift_Cards/' + code]) test('Stale source evidence rejected: ' + path.split('/')[0], async () => {
    const f = fixture(), payload = await f.checkoutInput(); f.db.set(path, { ...f.db.rows.get(path).data, changed: true });
    await assert.rejects(f.call('checkout', payload)); assert.equal(f.db.writes.length, 0);
});
test('No debit on Apply, preview or cancellation', async () => {
    const f = fixture(); await f.call('lookup', { code }); await f.checkoutInput();
    const list = await f.call('registry', {}, 'admin'); await f.call('detail', { handle: list.cards[0].handle }, 'admin');
    assert.equal(f.db.writes.length, 0); assert.equal((await f.call('checkoutStatus', { requestId: 'cancelled' })).state, 'NOT_COMMITTED');
});
test('Multiple cards plus split payments are atomic and conserve value', async () => {
    const f = fixture(); f.db.set('Gift_Cards/' + input.code, { ...f.db.rows.get('Gift_Cards/' + code).data, code: input.code });
    const payload = await f.checkoutInput(); payload.cards[0].appliedAmount = 30;
    const other = await f.call('lookup', { code: input.code });
    payload.cards.push({ code: input.code, appliedAmount: 40, version: other.version }); payload.split = true;
    payload.topUps = [{ method: 'Cash', amount: 10 }, { method: 'Mobile Money', amount: 20 }];
    const result = await f.call('checkout', payload);
    assert.equal(result.gift.appliedAmount, 70); assert.equal(result.paymentMeta.paymentSplits.reduce((s,r)=>s+r.amount,0),100);
    assert.equal(f.db.rows.get('Gift_Cards/' + code).data.remainingBalance,220); assert.equal(f.db.rows.get('Gift_Cards/' + input.code).data.remainingBalance,210);
});
test('Issue duplicate-code race permits only one new card', async () => {
    const f = fixture(), result = await Promise.allSettled(['a','b'].map(requestId => f.call('issue', { card: input, requestId }, 'admin')));
    assert.equal(result.filter(r=>r.status==='fulfilled').length,1);
});
test('Admin stale edit after redemption cannot overwrite the balance', async () => {
    const f = fixture(), list = await f.call('registry', {}, 'admin'), old = await f.call('detail', { handle: list.cards[0].handle }, 'admin');
    await f.call('checkout', await f.checkoutInput());
    await assert.rejects(f.call('edit', { card: { ...input, code }, handle: old.handle, version: old.version, requestId: 'edit' }, 'admin'));
    const fresh = await f.call('detail', { handle: old.handle }, 'admin');
    await f.call('edit', { card: { ...input, code, amount: 300 }, handle: old.handle, version: fresh.version, requestId: 'fresh-edit' }, 'admin');
    assert.equal(f.db.rows.get('Gift_Cards/' + code).data.remainingBalance,200);
});
test('Loaded Staff modules contain no direct sensitive Gift collection access', () => {
    for (const file of ['app.js','sales-promo-v1.js','gift-card-api.js']) assert.doesNotMatch(fs.readFileSync(file,'utf8'), /\.collection\(['"]Gift_(?:Cards|Card_Redemptions)['"]\)/);
});
test('Cancellation prevents a delayed request from debiting and is idempotent', async () => {
    const f=fixture(), payload=await f.checkoutInput();
    const cancelled=await f.call('cancelCheckout',{requestId:payload.requestId});
    assert.equal(cancelled.state,'CANCELLED');const count=f.db.writes.length;
    assert.deepEqual(await f.call('cancelCheckout',{requestId:payload.requestId}),cancelled);
    assert.deepEqual(await f.call('checkoutStatus',{requestId:payload.requestId}),cancelled);
    await assert.rejects(f.call('checkout',payload),/cancelled/);
    assert.equal(f.db.writes.length,count);assert.equal(f.db.rows.get('Gift_Cards/'+code).data.remainingBalance,250);
    assert.ok(f.db.writes.every(w=>w.path.startsWith('Gift_Checkouts/')));
});
test('Cancellation after commit returns original receipt without reversing or debiting', async () => {
    const f=fixture(),payload=await f.checkoutInput(),paid=await f.call('checkout',payload),count=f.db.writes.length;
    assert.deepEqual(await f.call('cancelCheckout',{requestId:payload.requestId}),paid);assert.equal(f.db.writes.length,count);
});
test('Cancellation and checkout race has one terminal outcome', async () => {
    for(const cancelFirst of [true,false]){
        const f=fixture(),payload=await f.checkoutInput();const cancel=()=>f.call('cancelCheckout',{requestId:payload.requestId}),pay=()=>f.call('checkout',payload);
        await Promise.allSettled(cancelFirst?[cancel(),pay()]:[pay(),cancel()]);
        const status=await f.call('checkoutStatus',{requestId:payload.requestId});
        assert.ok(['COMMITTED','CANCELLED'].includes(status.state));
        assert.equal(f.db.rows.get('Gift_Cards/'+code).data.remainingBalance,status.state==='COMMITTED'?150:250);
    }
});
test('Unapproved user cannot cancel a Gift checkout', async () => {
    const f=fixture();await assert.rejects(f.call('cancelCheckout',{requestId:'cancel'},'tech'));assert.equal(f.db.writes.length,0);
});
for (const code of ['permission-denied','functions/permission-denied','unavailable','functions/internal']) test('Client callable error mapping '+code, async () => {
    const vm=require('node:vm'), context={window:{THURAYA_CONFIG:{projectId:'thuraya-staging'}},firebase:{auth:()=>({currentUser:{uid:'synthetic'}}),app:()=>({functions:()=>({httpsCallable:()=>async()=>{throw {code,message:code.includes('permission-denied')?'Your account is not approved.':'private transport detail'};}})})}};
    vm.runInNewContext(fs.readFileSync('gift-card-api.js','utf8'),context);
    await assert.rejects(context.window.ThurayaGiftAPI.call('registry'),code.includes('permission-denied')?/not approved/:/could not be completed/);
});
test('Late Gift response is discarded after account switch', async () => {
    const vm=require('node:vm');let uid='admin',finish;
    const context={window:{THURAYA_CONFIG:{projectId:'thuraya-staging'}},firebase:{auth:()=>({currentUser:{uid}}),app:()=>({functions:()=>({httpsCallable:()=>()=>new Promise(resolve=>{finish=resolve})})})}};
    vm.runInNewContext(fs.readFileSync('gift-card-api.js','utf8'),context);
    const pending=context.window.ThurayaGiftAPI.call('detail');uid='tech';finish({data:{code:'private'}});await assert.rejects(pending,/session changed/);
});
