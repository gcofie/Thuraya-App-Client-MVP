'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { scripts, parentSource } = require('./quick-edit-service-edit-fixture.cjs');
let browser;
before(async () => { browser = await chromium.launch({ channel: 'msedge', headless: true }); });
after(async () => { await browser?.close(); });
async function fixture(fn, options = {}) {
    const page = await browser.newPage({ viewport: { width: options.width || 1280, height: 1000 } });
    const requests = [];
    await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    try {
        await page.setContent('<!doctype html><body style="margin:0;font-family:Arial,sans-serif"></body>');
        for (const script of scripts(options.parent ? parentSource() : undefined)) await page.addScriptTag({ content: script });
        await fn(page);
        assert.deepEqual(requests, [], 'Synthetic fixture must not make any network request');
    } finally { await page.close(); }
}
async function open(page) { await page.evaluate(() => thOpenExpectedTodayQuickEditV4('synthetic')); }
async function remove(page, index = 2) { await page.locator('#thQeV4Items button[title="Remove"]').nth(index).click(); }
async function add(page, qty = 1, id = 'replacement') {
    await page.locator('#thQeV4ServiceSearch').fill(id === 'youth' ? 'Synthetic Third' : 'Synthetic Replacement');
    await page.locator('[data-service-id="' + id + '"]').click();
    await page.locator('#thQeV4Qty').fill(String(qty));
    await page.locator('#thQeV4Add').click();
}
async function save(page, allowed) {
    await page.locator('.th-qe-v4-slot[data-time="09:00"]').click();
    await page.locator('#thQeV4Save').click();
    await page.waitForFunction(() => !document.getElementById('thQeV4Save').disabled);
    const message = await page.locator('#thQeV4Msg').textContent();
    if (allowed) {
        assert.equal(message, 'Appointment updated successfully.');
        await page.locator('#thExpectedQuickEditModalV4').waitFor({ state: 'hidden' });
    } else assert.notEqual(message, 'Appointment updated successfully.');
    return message;
}
async function result(page) { return page.evaluate(() => ({ record: __qeFixture.record, writes: __qeFixture.writes, jobs: __qeFixture.jobs, reads: __qeFixture.reads })); }
for (const op of ['remove','add','replace','no-change']) {
    test('pre-fix actual service Save is blocked: ' + op, () => fixture(async page => {
        await open(page);
        if (op === 'remove' || op === 'replace') await remove(page, op === 'remove' ? 2 : 0);
        if (op === 'add' || op === 'replace') await add(page);
        if (op === 'remove') {
            assert.equal(await page.locator('#thQeV4Duration').inputValue(), '90');
            assert.equal(await page.locator('#thQeV4Amount').inputValue(), '450.00');
        }
        assert.match(await save(page, false), /Payment status cannot be safely determined/);
        assert.equal((await result(page)).writes.length, 0);
    }, { parent: true }));
}
for (const [op, ids, duration, gross] of [
    ['remove',['polish','refinement'],90,450], ['add',['polish','refinement','youth','replacement'],185,770],
    ['replace',['refinement','youth','replacement'],170,670], ['quantity',['polish','refinement','youth'],170,750],
    ['no-change',['polish','refinement','youth'],155,650]
]) {
    test('repaired canonical service Save/reopen: ' + op, () => fixture(async page => {
        await open(page);
        assert.equal(await page.locator('#thQeV4Msg').textContent(), '');
        if (op === 'remove' || op === 'replace') await remove(page, op === 'remove' ? 2 : 0);
        if (op === 'add' || op === 'replace') await add(page);
        if (op === 'quantity') { await page.locator('#thQeV4Items input').first().fill('2'); await page.locator('#thQeV4Items input').first().press('Tab'); }
        assert.equal(await page.locator('#thQeV4Duration').inputValue(), String(duration));
        assert.equal(await page.locator('#thQeV4Amount').inputValue(), gross.toFixed(2));
        await save(page, true);
        const r = await result(page);
        assert.equal(r.writes.length, 1);
        assert.deepEqual(r.record.serviceLineItems.map(x => x.menuItemId), ids);
        assert.equal(Number(r.record.bookedDuration), duration);
        for (const k of ['grandTotal','finalTotal','amountDue','payableShare','memberServiceTotal']) assert.equal(r.record[k], gross, k);
        assert.equal(r.record.serviceSubtotal + r.record.taxTotal, gross);
        assert.equal(r.record.bookedPrice, r.record.serviceSubtotal);
        assert.equal(r.record.paymentStatus, 'pending_or_paid_by_booker', 'Do not rewrite payment history');
        assert.equal(r.record.serviceLineItems.reduce((sum, row) => sum + row.durationAtBooking * row.quantity, 0), duration);
        for (const key of ['paymentStatus','paymentMethod','paidAt','paymentSplits','giftCardRedemptions']) assert.equal(Object.hasOwn(r.writes[0], key), false);
        assert.deepEqual(r.jobs, []);
        assert.ok(r.reads.filter(x => x.name === 'Active_Jobs').every(x => x.source === 'server'));
        await open(page);
        assert.equal(await page.locator('#thQeV4Items button[title="Remove"]').count(), ids.length);
        assert.equal(await page.locator('#thQeV4Amount').inputValue(), gross.toFixed(2));
    }));
}
const protectedCases = [
    ['paid status',{paymentStatus:'Paid'},/payment\/settlement/], ['paid timestamp',{paidAt:'SYNTHETIC'},/payment\/settlement/],
    ['closed evidence',{closedAt:'SYNTHETIC'},/payment\/settlement/], ['receipt',{receiptStatus:'Generated',receiptRef:'SYNTHETIC'},/payment\/settlement/],
    ['checkout',{checkoutCompleted:true},/payment\/settlement/], ['unconfirmed payment method',{paymentMethod:'Cash'},/Payment status/],
    ['unknown historical status',{paymentStatus:'pending'},/Payment status/], ['unknown payer source',{source:'legacy-import'},/Payment status/],
    ['missing booking provenance',{bookingFor:null},/Payment status/], ['wrong legacy payer',{paymentResponsibility:'recipient'},/Payment status/],
    ['contradictory totals',{amountDue:999},/Payment status/], ['missing total',{serviceSubtotal:null},/Payment status/],
    ['group',{groupId:'synthetic-group'},/group or allocated/], ['allocated',{amountDueByMember:{member:650}},/group or allocated/],
    ['Gift-funded',{giftCardRedemptions:[{redemptionId:'synthetic',appliedAmount:100}]},/financial review required/i],
    ['settled split',{paymentStatus:'Paid',paymentSplitVersion:'PAYMENT_SPLIT_V1',paymentSplitTotal:650,paymentSplitBalance:0,paymentSplits:[{method:'Cash',amount:650}]},/payment\/settlement/],
    ['unsettled split metadata',{paymentSplitVersion:'PAYMENT_SPLIT_V1',paymentSplits:[{method:'Cash',amount:650}]},/Payment status/],
    ['complimentary only',{isComplimentary:true,complimentaryValue:650,paymentMethod:'Complimentary'},/financial review required/i],
    ['complimentary settled',{isComplimentary:true,complimentaryValue:100,paymentStatus:'Paid'},/financial review required/i],
    ['promotion',{discountAmount:10},/financial review required/i], ['deposit',{depositAmount:10},/Payment status/],
    ['cancellation marker',{cancelledAt:'SYNTHETIC'},/beyond pre-check-in/], ['No Show marker',{noShowAt:'SYNTHETIC'},/beyond pre-check-in/],
    ['contradictory service lifecycle',{serviceStatus:'Completed'},/beyond pre-check-in/]
];
for (const [label, extra, message] of protectedCases) {
    test('service removal remains protected: ' + label, () => fixture(async page => {
        await page.evaluate(extra => Object.assign(__qeFixture.record, extra), extra);
        const before = (await result(page)).record;
        await open(page); await remove(page);
        assert.match(await save(page, false), message);
        const after = await result(page);
        assert.equal(after.writes.length, 0);
        assert.deepEqual(after.record, before);
    }));
}
for (const status of ['Cancelled','No Show','Closed','Arrived','Completed']) {
    test('protected lifecycle cannot open service editor: ' + status, () => fixture(async page => {
        await page.evaluate(status => { __qeFixture.record.status = status; }, status);
        await open(page);
        assert.equal(await page.locator('#thExpectedQuickEditModalV4').count(), 0);
        assert.match(await page.evaluate(() => __qeFixture.alerts[0]), /beyond pre-check-in/);
        assert.equal((await result(page)).writes.length, 0);
    }));
}
for (const [label, change] of [
    ['job read failed', s => { s.failJobs = true; }], ['cached job evidence', s => { s.cachedJobs = true; }],
    ['cached Appointment', s => { s.cachedAppointment = true; }], ['schedule failed', s => { s.failSchedule = true; }],
    ['Appointment changed during job reads', s => { s.changedAppointment = true; }],
    ['bad reference', s => { s.record.activeJobId = { reference:'unknown' }; }],
    ['missing line snapshot', s => { delete s.record.serviceLineItems; }],
    ['conflicting line amount', s => { s.record.serviceLineItems[0].lineTotal = 999; }],
    ['conflicting quantity alias', s => { s.record.serviceLineItems[0].qty = 2; }],
    ['conflicting price alias', s => { s.record.serviceLineItems[0].price = 999; }],
    ['missing canonical ID', s => { delete s.record.serviceLineItems[0].menuItemId; }],
    ['conflicting duration', s => { s.record.bookedDuration = '90'; }],
    ['nested settlement', s => { s.record.financialContext = { receiptCompleted:true }; }]
]) {
    test('fresh complete evidence required: ' + label, () => fixture(async page => {
        await page.evaluate('(' + change.toString() + ')(__qeFixture)');
        await open(page); await add(page); await save(page, false);
        assert.equal((await result(page)).writes.length, 0);
    }));
}
for (const field of ['same-id','sourceAppointmentId','appointmentId','appointmentDocId','appointmentRef','bookingId','activeJobId','jobId','linkedJobId']) {
    test('fresh linked paid job blocks removal through ' + field, () => fixture(async page => {
        await page.evaluate(field => {
            const job = { id:field === 'same-id' ? 'synthetic' : 'job', status:'Closed', paymentStatus:'Paid' };
            if (['activeJobId','jobId','linkedJobId'].includes(field)) __qeFixture.record[field] = 'job';
            else if (field !== 'same-id') job[field] = 'synthetic';
            __qeFixture.jobs = [job];
        }, field);
        await open(page); await remove(page);
        assert.match(await save(page, false), /payment\/settlement/);
        const r = await result(page); assert.equal(r.writes.length, 0); assert.equal(r.jobs[0].status, 'Closed');
    }));
}
test('explicit unpaid Appointment conflicting with paid job stays review-required', () => fixture(async page => {
    await page.evaluate(() => { __qeFixture.record.paymentStatus='Unpaid'; __qeFixture.jobs=[{id:'synthetic',status:'Closed',paymentStatus:'Paid'}]; });
    await open(page); await remove(page); assert.match(await save(page, false), /Payment status/);
    assert.equal((await result(page)).writes.length, 0);
}));
test('known Staff unpaid/booker service removal remains allowed', () => fixture(async page => {
    await page.evaluate(() => { __qeFixture.record.source='staff_hf84_booking_core'; __qeFixture.record.paymentStatus='Unpaid'; });
    await open(page); await remove(page); await save(page, true);
}));
for (const width of [390,662,768,1280]) {
    test('browser remove/reopen/add/reopen/replace persistence at ' + width, () => fixture(async page => {
        await open(page); await remove(page); await save(page, true);
        await open(page); assert.equal(await page.locator('#thQeV4Amount').inputValue(), '450.00');
        await add(page); await save(page, true);
        await open(page); await remove(page, 0); await add(page, 1, 'youth'); await save(page, true);
        const r = await result(page);
        assert.equal(r.writes.length, 3);
        assert.equal(r.record.grandTotal, 670);
        assert.equal(Number(r.record.bookedDuration), 170);
        assert.deepEqual(r.record.serviceLineItems.map(x => [x.menuItemId,x.quantity]), [['refinement',1],['replacement',1],['youth',1]]);
        assert.equal(r.record.bookedService, 'The Refinement Indulgence, Synthetic Replacement, Synthetic Third Service');
        assert.equal(r.record.serviceSubtotal + r.record.taxTotal, 670);
        await open(page);
        if (process.env.QUICK_EDIT_SCREENSHOTS) await page.screenshot({path:require('node:path').join(process.env.QUICK_EDIT_SCREENSHOTS,'service-edit-'+width+'.png'),fullPage:true});
    }, { width }));
}
