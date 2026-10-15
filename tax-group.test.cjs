'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { taxHarness, rates } = require('./tax-client-fixture.cjs');
for (const mode of ['lead_pays_all', 'each_pays_own', 'split_equally', 'lead_pays_all_after_last', 'subgroup_pays_separately']) {
    test('group preserves service gross and reconciles payer balances: ' + mode, async () => {
        const h = taxHarness(undefined, true);
        h.document.querySelector = () => ({ value: mode });
        await h.grp_confirmBooking(); assert.equal(h.fixture.commits, 1, h.fixture.messages.join('; '));
        const rows = h.fixture.writes.map(row => row.data);
        assert.equal(rows.length, 2); assert.equal(rows.reduce((sum, row) => sum + row.amountDue, 0), 450);
        for (const row of rows) {
            assert.equal(row.grandTotal, 225); assert.equal(row.memberServiceTotal, 225); assert.equal(row.groupTotal, 450);
            assert.equal(row.pricingMode, 'inclusive'); assert.equal(row.bookedPrice, 187.49); assert.equal(row.taxTotal, 37.51);
            assert.equal(row.serviceLineItems[0].lineTotal, 225); assert.equal(row.payableShare, row.amountDue);
            assert.equal(row.status, 'Scheduled'); assert.equal(row.paidAmount, undefined);
        }
        if (mode.startsWith('lead_')) { assert.equal(rows[1].amountDue, 0); assert.equal(rows[1].grandTotal, 225); }
    });
}
test('uneven equal allocation conserves exact group cents in persisted records', async () => {
    const h = taxHarness(undefined, true); h.bk_menuServices = [];
    h.grp_members[0].selectedServices[0].price = 225.01;
    h.document.querySelector = () => ({ value: 'split_equally' });
    await h.grp_confirmBooking(); assert.equal(h.fixture.commits, 1);
    const rows = h.fixture.writes.map(row => row.data);
    assert.deepEqual(Array.from(rows, row => row.amountDue), [225.01, 225]);
    assert.equal(h.ThurayaClientTax.sum(rows.map(row => row.amountDue)), 450.01);
    assert.equal(h.ThurayaClientTax.sum(rows.map(row => row.grandTotal)), 450.01);
});
test('group respects explicitly exclusive policy rather than forcing either mode', async () => {
    const h = taxHarness({ pricingMode: 'exclusive', rates }, true); await h.grp_confirmBooking();
    assert.equal(h.fixture.commits, 1); assert.ok(h.fixture.writes.every(row => row.data.grandTotal === 270 && row.data.pricingMode === 'exclusive'));
});
test('group configuration absence and read failure block with no uncaught rejection', async () => {
    for (const fail of [h => { h.bk_taxPolicy = null; }, h => h.taxError(Error('failure'))]) {
        const h = taxHarness(undefined, true); fail(h);
        await assert.doesNotReject(h.grp_confirmBooking()); assert.equal(h.fixture.batches, 0);
    }
});
test('group configuration changes while validating cannot commit stale financial evidence', async () => {
    const h = taxHarness(undefined, true), validate = h.av_validateBookingAssignments;
    h.av_validateBookingAssignments = async args => { await validate(args); h.taxError(Error('failure')); };
    await h.grp_confirmBooking(); assert.equal(h.fixture.batches, 0);
});
test('unknown group payment responsibility blocks before committing', async () => {
    const h = taxHarness(undefined, true); h.document.querySelector = () => ({ value: 'unknown' });
    await h.grp_confirmBooking(); assert.equal(h.fixture.commits, 0); assert.equal(h.fixture.writes.length, 0);
});

for (const change of ['menu price', 'selection', 'membership']) {
    test('group ' + change + ' changing during validation blocks stale amounts', async () => {
        const h = taxHarness(undefined, true), validate = h.av_validateBookingAssignments;
        h.av_validateBookingAssignments = async args => {
            await validate(args);
            if (change === 'menu price') h.bk_menuServices[0].price = 250;
            if (change === 'selection') h.grp_members[0].selectedServices[0].qty = 2;
            if (change === 'membership') h.grp_members.pop();
        };
        await assert.doesNotReject(h.grp_confirmBooking());
        assert.equal(h.fixture.batches, 0); assert.equal(h.fixture.commits, 0);
    });
}

test('group scheduling duration stays available without financial authority', async () => {
    const h = taxHarness(undefined, true);
    h.taxError(Error('unavailable'));
    assert.equal(h.grp_memberDuration(h.grp_members[0]), 60);
    assert.equal(h.grp_groupDuration(), 60);
    h.grp_members[0].selectedServices[0].qty = 2;
    assert.equal(h.grp_groupDuration(), 120);
    await assert.doesNotReject(h.grp_confirmBooking()); assert.equal(h.fixture.commits, 0);
});
