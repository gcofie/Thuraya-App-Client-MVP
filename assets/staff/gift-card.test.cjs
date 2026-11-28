'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const gift = require('./gift-card-model');
const now = new Date('2026-09-09T12:00:00Z');
const card = changes => ({ code: 'THGC-AB23-CD45', amount: 550, remainingBalance: 550, status: 'Active', totalAllowedUses: 2, usedCount: 0, remainingUses: 2, expiryDate: '2026-09-09', ...changes });
for (const input of ['THGC-AB23-CD45', 'thgc-ab23-cd45', '  THGC-AB23-CD45\n', 'THGCAB23CD45', 'AB23CD45', 'AB23-CD45', 'THGC - AB23 - CD45', 'THGC\u2011AB23\u2011CD45', 'THGC\u2212AB23\u2212CD45']) test('exact code normalization: ' + input, () => assert.deepEqual(gift.normalizeCode(input), { ok: true, code: 'THGC-AB23-CD45' }));
for (const input of ['', 'THGC-AB23', 'THGCAB23', 'THGC-AB23-CD4', 'THGC-AB23...', 'THGC-AB23-CD456', 'THGC-AB?3-CD45', 'ZZGC-AB23-CD45', 'THGC-AB23/CD45']) test('incomplete/unsupported code rejected: ' + input, () => assert.equal(gift.normalizeCode(input).ok, false));
for (const [name, changes, state] of [
    ['valid', {}, 'VALID'], ['yesterday', { expiryDate: '2026-09-08' }, 'EXPIRED'], ['today', {}, 'VALID'], ['tomorrow', { expiryDate: '2026-09-10' }, 'VALID'],
    ['partial', { remainingBalance: 32, usedCount: 1, remainingUses: 1 }, 'VALID'], ['limit with residual', { status: 'Redeemed', usedCount: 2, remainingUses: 0, remainingBalance: 32 }, 'USE_LIMIT_REACHED'],
    ['active limit', { usedCount: 2, remainingUses: 0 }, 'USE_LIMIT_REACHED'], ['redeemed', { status: 'Redeemed', remainingBalance: 0 }, 'REDEEMED'], ['inactive', { status: 'Inactive' }, 'INACTIVE'],
    ['zero', { remainingBalance: 0 }, 'NO_BALANCE'], ['archived', { archived: true }, 'INACTIVE'], ['voided', { voided: true }, 'INACTIVE'], ['missing status', { status: null }, 'INACTIVE'],
    ['malformed', { expiryDate: '09/10/2026' }, 'MALFORMED_DATE'], ['impossible day', { expiryDate: '2026-02-30' }, 'MALFORMED_DATE'],
    ['no expiry existing policy', { expiryDate: null }, 'VALID'], ['legacy validUntil', { expiryDate: null, validUntil: '2026-09-08' }, 'EXPIRED'],
    ['conflicting expiry', { validUntil: '2026-09-10' }, 'MALFORMED_DATE'], ['status whitespace', { status: ' Active ' }, 'VALID']
]) test('classification ' + name, () => assert.equal(gift.classify(card(changes), now).state, state));
test('a code body beginning THGC requires its explicit prefix to avoid incomplete-code ambiguity', () => {
    assert.deepEqual(gift.normalizeCode('THGC-THGC-AB23'), { ok: true, code: 'THGC-THGC-AB23' });
    assert.equal(gift.normalizeCode('THGC-AB23').ok, false);
});
test('missing record', () => assert.equal(gift.classify(null, now).state, 'NOT_FOUND'));
test('fresh Accra midnight on every event', () => {
    assert.equal(gift.classify(card(), new Date('2026-09-09T23:59:59.999Z')).state, 'VALID');
    assert.equal(gift.classify(card(), new Date('2026-09-10T00:00:00Z')).state, 'EXPIRED');
});
test('browser west/east of UTC cannot shift business date', () => {
    assert.equal(gift.businessDate('2026-09-09T17:30:00-07:00'), '2026-09-10');
    assert.equal(gift.businessDate('2026-09-10T08:30:00+09:00'), '2026-09-09');
});
test('explicit supported date representations agree', () => {
    for (const value of ['2026-09-09', '2026-09-09T00:00:00Z', '2026-09-09T01:00:00+01:00', new Date('2026-09-09T12:00:00Z'), { seconds: 1788912000, nanoseconds: 0 }, { _seconds: 1788912000 }, { toDate: () => new Date('2026-09-09T12:00:00Z') }]) assert.deepEqual(gift.normalizeDate(value), { ok: true, date: '2026-09-09' });
});
test('unsupported dates fail closed', () => {
    for (const value of ['09/09/2026', '2026-09-09T24:00:00Z', '2026-09-09T00:00:00', '2026-09-09T00:00:00+99:00', '2026-02-29', '2026-13-01', ' ', 1788912000, {}, { seconds: '1788912000' }, new Date('invalid')]) assert.equal(gift.normalizeDate(value).ok, false);
});
test('leap dates and existing twelve-month rollover preserved', () => {
    assert.equal(gift.normalizeDate('2028-02-29').ok, true);
    assert.equal(gift.defaultExpiry(new Date('2028-02-29T12:00:00Z')), '2029-03-01');
    assert.equal(gift.defaultExpiry(now), '2027-09-09');
});
test('missing purchase date is not silently today', () => assert.equal(gift.displayDate(null), 'Not recorded'));
test('friendly errors do not expose backend details', () => {
    assert.equal(gift.friendlyError(new Error('PERMISSION_DENIED secret document')), 'Gift Card validation could not be completed. Please try again.');
    assert.match(gift.friendlyError(gift.error(gift.classify(card({ expiryDate: '2026-09-08' }), now))), /expired on 08 Sep 2026/);
});
test('budget arithmetic matches original for partial and legacy edge shapes', () => {
    for (const balance of [undefined, null, '', 0, 0.001, 32, 550, '30', 'invalid']) for (const max of [undefined, 0, 1, 2, '3']) for (const used of [0, 1, 2]) for (const stored of [undefined, '', null, 0, 1, 2]) {
        const c = card({ remainingBalance: balance, totalAllowedUses: max, usedCount: used, remainingUses: stored });
        const n = Number((c.remainingBalance ?? c.amount ?? 0) || 0), remaining = Number.isFinite(n) ? n : 0;
        const maxUses = Math.max(1, Number(parseInt(c.totalAllowedUses || 1, 10)) || 1), usedCount = Math.max(0, Number(parseInt(c.usedCount || 0, 10)) || 0);
        const calculated = Math.max(0, maxUses - usedCount), saved = stored === undefined || stored === null || stored === '' ? null : Math.max(0, Number(parseInt(stored, 10)) || 0);
        assert.deepEqual(gift.budget(c), { remaining, maxUses, usedCount, remainingUses: saved === null ? calculated : Math.min(saved, calculated) });
    }
});
const app = fs.readFileSync(__dirname + '/app.js', 'utf8');
function slice(a, b) { const start = app.indexOf(a), end = app.indexOf(b, start + a.length); assert.ok(start >= 0 && end > start); return app.slice(start, end); }
async function apply(input, record = card(), failure) {
    let reads = 0, result;
    const controls = { checkoutGiftCardCode: { value: input }, checkoutGiftCardStatus: { style: {} } };
    const c = { window: {}, document: { getElementById: id => controls[id] }, console: { warn() {} }, ThurayaGiftCard: gift,
        ThurayaGiftAPI: { mask: () => 'THGC-****-CD45', async call(command, data) { assert.equal(command, 'lookup'); assert.equal(data.code, 'THGC-AB23-CD45'); reads++; if(failure)throw failure; const state=gift.classify(record,now); return {...state, remainingBalance:state.remaining,totalAllowedUses:state.maxUses,version:'synthetic'}; } },
        thGiftCheckoutRedemptions: () => [], thGiftCurrentCheckoutTotal: () => 200, thGiftAppliedTotal: () => 0, thGiftSyncAggregate() {},
        thGiftRenderCheckoutPanel: (message, type) => { result = { message, type }; }, thGiftRefreshCheckoutTotals() {}, thGiftSyncCheckoutPaymentState() {} };
    vm.createContext(c); vm.runInContext(slice('function thGiftSafe(value)', 'function thGiftCurrentCheckoutTotal()') + slice('window.thGiftApplyCheckoutCode = async function()', 'window.thGiftClearCheckoutCode'), c);
    await c.window.thGiftApplyCheckoutCode(); return { reads, result, applied: c.window.THURAYA_GIFT_CARD_REDEMPTIONS };
}
test('actual Apply exact/normalization remains read-only and preserves credit', async () => {
    for (const input of ['THGC-AB23-CD45', 'ab23cd45', 'THGC \u2011 AB23 \u2011 CD45']) {
        const r = await apply(input); assert.equal(r.reads, 1); assert.equal(r.result.type, 'success'); assert.equal(r.applied[0].appliedAmount, 200); assert.equal(r.applied[0].balanceAfterPayment, 350);
    }
});
test('Apply invalid code does not query', async () => { const r = await apply('THGC-AB23...'); assert.equal(r.reads, 0); assert.equal(r.result.type, 'error'); });
test('Apply not found and network failures are friendly', async () => {
    assert.match((await apply('THGC-AB23-CD45', null)).result.message, /code not found/);
    assert.equal((await apply('THGC-AB23-CD45', card(), new Error('permission denied'))).result.message, gift.outcome('NETWORK_ERROR').message);
});
test('Apply expiry and limit failures cause no writes', async () => {
    for (const c of [card({ expiryDate: '2026-09-08' }), card({ remainingUses: 0 }), card({ status: 'Redeemed' })]) assert.equal((await apply(c.code, c)).applied, undefined);
});
async function redeem(record, time = now) {
    const {fixture,code:fixtureCode}=require('./gift-test-fixtures.cjs');
    const f=fixture({card:{...record,code:fixtureCode},job:{amountDue:200}}); f.setNow(time);
    const context={primaryJobId:'job',jobIds:['job'],quotedTotal:200,planned:true,split:false,topUps:[]};
    const quote=await f.call('prepareCheckout',context);
    const snapshot=await f.db.doc('Gift_Cards/'+fixtureCode).get();
    try { const r=await f.call('checkout',{...context,fingerprint:quote.fingerprint,requestId:'gift-model-test',cards:[{code:fixtureCode,appliedAmount:200,version:snapshot.updateTime.toDate().toISOString()}]}); return {result:r.gift,writes:f.db.writes,card:f.db.rows.get('Gift_Cards/'+fixtureCode).data}; }
    catch(error){ return {error,writes:f.db.writes}; }
}
test('confirmed redemption accounting unchanged and checkout evidence commits atomically', async () => {
    const r=await redeem(card()); assert.equal(r.result.appliedAmount,200); assert.equal(r.result.balanceAfterPayment,350);
    assert.equal(r.card.remainingBalance,350); assert.equal(r.card.usedCount,1); assert.equal(r.card.remainingUses,1);
    assert.deepEqual([...new Set(r.writes.map(w=>w.path.split('/')[0]))].sort(),['Active_Jobs','Appointments','Gift_Card_Redemptions','Gift_Cards','Gift_Checkouts']);
});
test('Apply before midnight cannot bypass fresh commit expiry check', async () => {
    assert.equal((await apply(card().code)).result.type, 'success');
    const r = await redeem(card(), new Date('2026-09-10T00:00:00Z')); assert.equal(r.error.giftCardState, 'EXPIRED'); assert.equal(r.writes.length, 0);
});
test('financial builders, tax/discount policy, receipt arithmetic and non-Gift core remain byte-identical', () => {
    const prior = require('node:child_process').execFileSync('git', ['show', '4c94453a33ee78633a384f8e033c8f48463d2663:app.js'], { cwd: __dirname, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).replace(/\r\n/g, '\n');
    const current = app.replace(/\r\n/g, '\n');
    const section=(source,from,until)=>{const a=source.indexOf(from),b=source.indexOf(until,a+from.length);assert.ok(a>=0&&b>a);return source.slice(a,b);};
    for(const [from,until] of [
        ['// Phase 1A: forward-only Staff booking service snapshots.', '// Client Experience upload reliability tuning'],
        ['function gb_money(v)', 'function gb_taxHtmlForPlan('],
        ['function thGiftMultiVoucherPaymentMeta(', 'function thCompNumber('],
        ['function thCompNumber(', 'window.confirmPayment = async function()'],
        ['function thGiftResolveReceiptPaymentMethod(', 'function th_receiptDigits(']
    ]) assert.equal(section(current,from,until),section(prior,from,until),from);
    const originalModel=require('node:child_process').execFileSync('git',['show','4c94453a33ee78633a384f8e033c8f48463d2663:gift-card-model.js'],{cwd:__dirname,encoding:'utf8'}).replace(/\r\n/g,'\n');
    assert.equal(fs.readFileSync(__dirname+'/gift-card-model.js','utf8').replace(/\r\n/g,'\n'),originalModel);
});
test('commit rejects depleted/archived/invalid date without writes', async () => {
    for (const changes of [{ remainingUses: 0 }, { remainingBalance: 0 }, { archived: true }, { expiryDate: 'tomorrow' }]) { const r = await redeem(card(changes)); assert.ok(r.error); assert.equal(r.writes.length, 0); }
});
