'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { taxHarness, policy, rates, read } = require('./tax-client-fixture.cjs');
const plain = value => JSON.parse(JSON.stringify(value));
for (const fields of [{ pricingMode: 'inclusive' }, { taxPricingMode: 'inclusive' }, { inclusive: true }]) {
    test('real loader, summary, payment-preparation and booking parity: ' + JSON.stringify(fields), async () => {
        const h = taxHarness(null);
        h.taxNext({ exists: true, data: () => ({ ...fields, rates }) });
        h.populateConfirmScreen();
        assert.equal(h.elements.conf_total.textContent, '225.00 GHC');
        assert.match(h.elements.conf_priceBreakdown.innerHTML, /187.49/);
        assert.match(h.elements.conf_priceBreakdown.innerHTML, /28.13/);
        assert.equal(h.bk_selectedServices[0].price, 225);
        assert.equal(h.elements.btnConfirmBooking.disabled, false);
        await h.bk_confirmBooking();
        assert.equal(h.fixture.commits, 1, h.fixture.messages.join('; '));
        const a = h.fixture.writes[0].data;
        for (const key of ['grossServiceValue', 'grandTotal', 'finalTotal', 'finalServiceGross', 'amountDue', 'memberServiceTotal', 'payableShare', 'totalGHC']) assert.equal(a[key], 225, key);
        assert.equal(a.bookedPrice, 187.49); assert.equal(a.taxableSubtotal, 187.49); assert.equal(a.taxTotal, 37.51);
        assert.deepEqual(JSON.parse(a.taxBreakdown).map(row => row.amount), [28.13, 4.69, 4.69]);
        assert.equal(a.pricingMode, 'inclusive'); assert.equal(a.taxPricingMode, 'inclusive');
        assert.equal(a.financialPolicySnapshot.source, 'Tax_Settings/current_taxes');
        assert.equal(a.serviceLineItems[0].lineTotal, 225); assert.equal(a.serviceLineItems[0].lineSubtotal, 187.49);
        assert.equal(a.serviceLineItems[0].taxAmount, 37.51); assert.equal(a.serviceLineItems[0].serviceId, 'cert-base');
        assert.equal(a.serviceLineItems[0].durationAtBooking, 60); assert.equal(a.serviceLineItems[0].snapshotSource, 'client_booking');
        assert.equal(a.paymentStatus, 'unpaid'); assert.equal(a.status, 'Scheduled');
        assert.equal(h.elements.suc_total.textContent, '225.00 GHC');
    });
}
for (const config of [null, {}, { inclusive: 'true', rates }, { pricingMode: 'bad', rates },
    { pricingMode: 'inclusive', taxPricingMode: 'exclusive', rates }, { pricingMode: 'inclusive' }]) {
    test('actual financial commit blocks unavailable/invalid config: ' + JSON.stringify(config), async () => {
        const h = taxHarness(); h.taxNext({ exists: !!config, data: () => config });
        assert.doesNotThrow(() => h.populateConfirmScreen());
        assert.equal(h.elements.conf_total.textContent, 'Unavailable'); assert.equal(h.elements.btnConfirmBooking.disabled, true);
        await assert.doesNotReject(h.bk_confirmBooking());
        assert.equal(h.fixture.batches, 0); assert.equal(h.fixture.commits, 0);
    });
}
test('tax read failure invalidates previously valid authority before commit', async () => {
    const h = taxHarness(); h.populateConfirmScreen(); h.taxError(Error('unavailable'));
    await assert.doesNotReject(h.bk_confirmBooking()); assert.equal(h.fixture.batches, 0);
    h.taxNext({ exists: true, data: () => policy }); await h.bk_confirmBooking(); assert.equal(h.fixture.commits, 1);
});

test('synchronous tax subscription failure clears stale authority and blocks commit', async () => {
    const h = taxHarness(), collection = h.db.collection;
    h.db.collection = name => name === 'Tax_Settings' ? { doc: () => ({ onSnapshot() { throw Error('registration failed'); } }) } : collection(name);
    assert.doesNotThrow(() => h.loadTaxConfig());
    assert.equal(h.bk_taxPolicy, null); h.populateConfirmScreen();
    assert.equal(h.elements.conf_total.textContent, 'Unavailable');
    await assert.doesNotReject(h.bk_confirmBooking()); assert.equal(h.fixture.commits, 0);
});
test('configuration change during schedule await blocks a stale quote', async () => {
    const h = taxHarness(), validate = h.av_validateBookingAssignments;
    h.av_validateBookingAssignments = async args => { await validate(args); h.taxNext({ exists: true, data: () => ({ pricingMode: 'exclusive', rates }) }); };
    await h.bk_confirmBooking(); assert.equal(h.fixture.batches, 0);
    assert.match(h.fixture.messages.join(' '), /settings changed/);
});
test('configuration failure during schedule await blocks commit', async () => {
    const h = taxHarness(), validate = h.av_validateBookingAssignments;
    h.av_validateBookingAssignments = async args => { await validate(args); h.taxError(Error('read failure')); };
    await h.bk_confirmBooking(); assert.equal(h.fixture.batches, 0);
});
test('multi-service snapshots reconcile to aggregate per-component cents', async () => {
    const h = taxHarness(); h.bk_menuServices = [];
    h.bk_selectedServices = [{ id: 'a', name: 'A', price: 100, dur: 30 }, { id: 'b', name: 'B', price: 125, dur: 30 }];
    await h.bk_confirmBooking(); assert.equal(h.fixture.commits, 1);
    const a = h.fixture.writes[0].data, totals = h.thClientServiceSnapshotTotals(a.serviceLineItems);
    assert.equal(totals.grandTotal, 225); assert.equal(totals.serviceSubtotal, 187.49); assert.equal(totals.taxTotal, 37.51);
    assert.deepEqual(plain(a.serviceLineItems.map(row => row.lineTotal)), [100, 125]);
});
test('explicit exclusive summary and persistence agree without losing mode', async () => {
    const h = taxHarness({ pricingMode: 'exclusive', rates }); h.populateConfirmScreen(); await h.bk_confirmBooking();
    const a = h.fixture.writes[0].data;
    assert.equal(h.elements.conf_total.textContent, '270.00 GHC'); assert.equal(a.grandTotal, 270);
    assert.equal(a.bookedPrice, 225); assert.equal(a.taxTotal, 45); assert.equal(a.amountDue, 270);
    assert.equal(a.serviceLineItems[0].lineTotal, 270); assert.equal(a.pricingMode, 'exclusive');
});
test('zero remains zero without fabricating payment or settlement', async () => {
    const h = taxHarness(); h.bk_selectedServices[0].price = 0; h.bk_menuServices[0].price = 0;
    h.populateConfirmScreen(); await h.bk_confirmBooking();
    const a = h.fixture.writes[0].data; assert.equal(a.grandTotal, 0); assert.equal(a.amountDue, 0); assert.equal(a.taxTotal, 0);
    assert.equal(a.status, 'Scheduled'); assert.equal(a.paymentStatus, 'unpaid'); assert.equal(a.paidAmount, undefined);
    assert.equal(h.elements.suc_total.textContent, '0.00 GHC');
});
for (const promo of [{ type: 'percent', value: 10, code: 'SYNTHETIC' }, { type: 'fixed', value: 22.5, code: 'SYNTHETIC' }]) {
    test('promotion retains original gross/evidence and exact adjusted payable: ' + promo.type, async () => {
        const h = taxHarness(); h.bk_activePromo = promo; h.populateConfirmScreen();
        h.elements.bk_discountAmount.value = '225';
        await h.bk_confirmBooking(); const a = h.fixture.writes[0].data;
        assert.equal(a.grandTotal, 225); assert.equal(a.originalGrandTotal, 225); assert.equal(a.finalTotal, 202.5);
        assert.equal(a.discountAmount, 22.5); assert.equal(a.amountDue, 202.5); assert.equal(a.taxTotal, 37.51);
        assert.equal(h.elements.suc_total.textContent, '202.50 GHC');
    });
}

test('configured promotion percentage retains precision without changing tax evidence', async () => {
    const h = taxHarness(); h.bk_activePromo = { type: 'percent', value: 1.005, code: 'SYNTHETIC' };
    h.populateConfirmScreen(); await h.bk_confirmBooking();
    const a = h.fixture.writes[0].data;
    assert.equal(a.discountAmount, 2.26); assert.equal(a.amountDue, 222.74);
    assert.equal(a.grandTotal, 225); assert.equal(a.taxTotal, 37.51);
});
test('live tax changes do not reconstruct an existing confirmation', async () => {
    const h = taxHarness(); await h.bk_confirmBooking(); const a = h.fixture.writes[0].data;
    h.taxNext({ exists: true, data: () => ({ pricingMode: 'exclusive', rates: [{ name: 'New', rate: 50 }] }) });
    h.populateSuccessScreen(a); assert.equal(h.elements.suc_total.textContent, '225.00 GHC');
    assert.equal(a.taxTotal, 37.51); assert.equal(a.financialPolicySnapshot.pricingMode, 'inclusive');
});
test('menu price drift cannot make summary and snapshot disagree', async () => {
    const h = taxHarness(); h.bk_menuServices[0].price = 250; h.populateConfirmScreen();
    assert.equal(h.elements.conf_total.textContent, 'Unavailable'); await h.bk_confirmBooking(); assert.equal(h.fixture.batches, 0);
});

for (const change of ['menu price', 'selection', 'promotion']) {
    test(change + ' changing during availability validation blocks stale booking amounts', async () => {
        const h = taxHarness(), validate = h.av_validateBookingAssignments;
        h.av_validateBookingAssignments = async args => {
            await validate(args);
            if (change === 'menu price') h.bk_menuServices[0].price = 250;
            if (change === 'selection') h.bk_selectedServices[0].qty = 2;
            if (change === 'promotion') h.bk_activePromo = { type: 'fixed', value: 10, code: 'CHANGED' };
        };
        await assert.doesNotReject(h.bk_confirmBooking());
        assert.equal(h.fixture.batches, 0); assert.equal(h.fixture.commits, 0);
    });
}
test('historical zero uses nullish authority, not truthiness fallback', () => {
    assert.match(read('app.js'), /a\.finalTotal \?\? a\.grandTotal \?\? a\.bookedPrice \?\? 0/);
});
