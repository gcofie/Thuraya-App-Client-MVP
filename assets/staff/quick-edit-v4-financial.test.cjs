'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const source = fs.readFileSync(__dirname + '/app.js', 'utf8').replace(/\r\n/g, '\n');
const parent = '387d421ec4e846f07d1591eb3e5413d61b4caf80';
const plain = value => JSON.parse(JSON.stringify(value));
function section(text, from, to) {
    const a = text.indexOf(from), b = text.indexOf(to, a + from.length);
    assert.ok(a >= 0 && b > a, `Missing section: ${from}`);
    return text.slice(a, b);
}
const quickEdit = section(source, '   Expected Today Quick Edit V4', '/* === END THURAYA STAFF');
const part = (from, to) => section(quickEdit, from, to);
function helper(marker) {
    const at = source.indexOf(marker);
    assert.ok(at >= 0);
    return source.slice(source.lastIndexOf('(function(){', at), source.indexOf('})();', at) + 5);
}
const ids = [
    'hand__hand_therapies__hand_therapies__main_therapy__silken_restore_hand_balance',
    'hand__polish_and_finish__polish_and_finish__finish__gel_polish_upgrade'
];
function fixture(extra = {}) {
    return {
        status: 'Scheduled', dateString: '2099-09-21', timeString: '09:00',
        assignedTechEmail: 'tech@example.test', assignedTechName: 'Test technician',
        isGroupBooking: false, groupId: '', groupSize: 1, groupRole: '', groupMemberIndex: 0,
        hasPromoApplied: false, discountAmount: 0, discountPercent: 0,
        promoCode: '', promoName: '', promoType: '', isPackageRedemption: false,
        packageWalletId: '', packageSessionsUsed: 0, packageRemainingAfter: null,
        taxPricingMode: 'inclusive', pricingMode: 'inclusive',
        taxBreakdown: JSON.stringify([
            { name: 'VAT', rate: 15, amount: 20.63, pricingMode: 'inclusive' },
            { name: 'Getfund', rate: 2.5, amount: 3.44, pricingMode: 'inclusive' },
            { name: 'Covid', rate: 2.5, amount: 3.43, pricingMode: 'inclusive' }
        ]),
        bookedPrice: 225, grandTotal: 225, finalTotal: 165, totalGHC: 165, originalTotal: 165,
        amountDue: 165, payableShare: 165, groupTotal: 165, memberServiceTotal: 165,
        serviceSubtotal: 137.5, taxableSubtotal: 137.5, taxTotal: 27.5, bookedDuration: '15',
        serviceLineItems: [
            { id: ids[0], serviceId: ids[0], menuItemId: ids[0], name: 'Silken Restore',
                qty: 1, quantity: 1, price: 165, unitPrice: 165, unitPriceAtBooking: 165,
                lineTotal: 165, lineSubtotal: 165, taxAmount: 0, priceMode: 'inclusive', durationAtBooking: 30 },
            { id: ids[1], serviceId: ids[1], menuItemId: ids[1], name: 'Gel Polish Upgrade',
                qty: 1, quantity: 1, price: 60, unitPrice: 60, unitPriceAtBooking: 60,
                lineTotal: 60, lineSubtotal: 60, taxAmount: 0, priceMode: 'inclusive', duration: 15, durationAtBooking: 15 }
        ], ...extra
    };
}
function harness(record = fixture()) {
    const state = { record: plain(record), latest: plain(record), exists: true, writes: [], reads: [], messages: [] };
    const elements = Object.fromEntries(['Date','Time','Tech','ServicesText','Duration','Amount','Note','Save'].map(key => ['thQeV4' + key, { value: '' }]));
    Object.assign(elements.thQeV4Date, { value: record.dateString });
    Object.assign(elements.thQeV4Time, { value: record.timeString });
    Object.assign(elements.thQeV4Tech, { value: record.assignedTechEmail });
    const context = {
        window: { async thurayaValidateStaffScheduleAssignments(rows) { state.scheduleChecks = plain(rows); } }, state, elements, console: { error() {}, warn() {} }, setTimeout() {},
        firebase: { firestore: { FieldValue: { serverTimestamp: () => 'TEST_TIMESTAMP', delete: () => 'TEST_DELETE' } } },
        db: { collection(name) {
            if (name === 'Active_Jobs') return {
                doc: id => ({ async get(options) { assert.equal(options.source, 'server'); return { id, exists: false }; } }),
                where: () => ({ async get(options) { assert.equal(options.source, 'server'); return { forEach() {} }; } })
            };
            assert.equal(name, 'Appointments');
            return { doc(id) {
                assert.equal(id, 'synthetic-financial-fixture');
                return {
                    async get() { state.reads.push(id); if (state.readError) throw Error('read failed'); return { exists: state.exists, data: () => plain(state.latest) }; },
                    async set(payload, options) { state.writes.push({ payload: plain(payload), options: plain(options) }); }
                };
            } };
        } }
    };
    vm.createContext(context);
    vm.runInContext(helper('window.__TH_SERVICE_SNAPSHOT_HELPERS_PHASE_1A__'), context);
    vm.runInContext(helper('window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__'), context);
    const builder = context.window.thBuildCanonicalFinancialShape;
    context.window.thBuildCanonicalFinancialShape = options => {
        state.builderInput = plain(options);
        return builder(options);
    };
    vm.runInContext(`
        const MENU_COLLECTION = 'Menu_Settings_V2';
        let activeAppointmentId = 'synthetic-financial-fixture';
        let activeAppointmentData = { id: activeAppointmentId, ...state.record };
        let selectedItems = [], saving = false;
        const currentUserEmail = 'manager@example.test';
        function q(id) { return elements[id]; }
        function num(value, fallback = 0) { const n = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : fallback; }
        function renderItems() {}
        function closeModal() {}
        function today() { return '2099-09-20'; }
        function selectedTechName() { return 'Test technician'; }
        function setMsg(message, type) { state.messages.push({ message, type }); }
        ${part('    function normalizeQuickEditItem(', '    function itemLineTotal(')}
        ${part('    function cleanQuickEditRow(', '    function itemizedRowsFromServiceText(')}
        ${part('    function buildInitialItems(appt)', '    function addSelectedService()')}
        ${part('    function syncTotalsFromItems(', '    function clearSelectedTime(')}
        ${part('    async function saveEdit()', '    window.editAppointment =')}
        buildInitialItems(activeAppointmentData);
        globalThis.api = {
            build: () => buildQuickEditV4CanonicalFinancials(q('thQeV4ServicesText').value, Number(q('thQeV4Duration').value), Number(q('thQeV4Amount').value)),
            save: saveEdit, items: () => selectedItems, recordState: quickEditV4RecordState,
            identity: () => quickEditV4BillingIdentity(activeAppointmentData)
        };
    `, context);
    return { ...context.api, state, elements, window: context.window };
}

test('inclusive no-adjustment serialization uses booking rates and complete canonical individual totals', () => {
    const record = fixture(), before = JSON.stringify(record), h = harness(record);
    const result = plain(h.build());
    for (const field of ['bookedPrice','serviceSubtotal','taxableSubtotal']) assert.equal(result[field], 187.5, field);
    for (const field of ['grandTotal','finalTotal','totalGHC','amountDue','payableShare','groupTotal','memberServiceTotal','originalTotal']) assert.equal(result[field], 225, field);
    assert.equal(result.taxTotal, 37.5);
    assert.equal(result.bookedDuration, '45');
    assert.equal(result.pricingMode, 'inclusive');
    assert.equal(result.taxPricingMode, 'inclusive');
    assert.deepEqual(JSON.parse(result.taxBreakdown), [
        { name: 'VAT', rate: 15, amount: 28.13, pricingMode: 'inclusive' },
        { name: 'Getfund', rate: 2.5, amount: 4.69, pricingMode: 'inclusive' },
        { name: 'Covid', rate: 2.5, amount: 4.68, pricingMode: 'inclusive' }
    ]);
    assert.deepEqual(result.serviceLineItems.map(row => [row.menuItemId, row.serviceId, row.qty, row.quantity, row.unitPriceAtBooking, row.durationAtBooking, row.lineSubtotal, row.taxAmount, row.lineTotal]), [
        [ids[0], ids[0], 1, 1, 165, 30, 137.5, 27.5, 165], [ids[1], ids[1], 1, 1, 60, 15, 50, 10, 60]
    ]);
    assert.equal(new Set(result.serviceLineItems.map(row => row.menuItemId)).size, 2);
    assert.deepEqual(result.quickEditV4Items.map(row => [row.id, row.price, row.qty, row.duration]), [[ids[0],165,1,30], [ids[1],60,1,15]]);
    assert.deepEqual(h.state.builderInput.adjustments, []);
    assert.deepEqual(h.state.builderInput.compatibility, { includeMemberTotals: true, includePayableShare: true });
    assert.equal(result.adjustmentTotal, undefined, 'stale 225 - 165 never becomes a discount');
    assert.equal(JSON.stringify(record), before);
});

test('canonical serialization survives simulated save/reopen without duplicate lines or drift', () => {
    const first = plain(harness().build());
    assert.deepEqual(plain(harness({ ...fixture(), ...first }).build()), first);
});

test('normal save writes the whole canonical payload using only the existing Appointment merge', async () => {
    const h = harness(), expected = plain(h.build());
    await h.save();
    assert.equal(h.state.reads.length, 1);
    assert.equal(h.state.writes.length, 1);
    const { payload, options } = h.state.writes[0];
    assert.deepEqual(options, { merge: true });
    for (const key of Object.keys(expected)) assert.deepEqual(payload[key], expected[key], key);
    assert.equal(payload.status, 'Scheduled');
    assert.equal(payload.assignedTechEmail, 'tech@example.test');
    assert.equal(payload.canonical, undefined);
    for (const key of ['amountPaid','paidAmount','paymentStatus','paymentSplits','depositAmount','redemptions','settlement','discountAmount','promoCode','packageWalletId']) assert.equal(Object.hasOwn(payload, key), false, key);
});

for (const [field, value] of [
    ['hasPromoApplied', true], ['promoCode','TEST'], ['promoName','Offer'], ['discountAmount',60], ['discountPercent',10],
    ['adjustments',[{type:'discount',amount:60}]], ['adjustmentTotal',60], ['adjustments','[]'],
    ['isPackageRedemption',true], ['packageWalletId','wallet'], ['packageSessionsUsed',1],
    ['isComplimentary',true], ['complimentaryValue',165], ['complimentaryStatus','approved'],
    ['voucherId','voucher'], ['giftCardRedemptions',[{amount:25}]], ['prepaidValue',20], ['redeemedValue',20],
    ['amountPaid',10], ['paidAmount',10], ['paid',true], ['paymentStatus','Paid'], ['paymentStatus','pending'],
    ['depositAmount',10], ['deposit',{amount:10}], ['splitPayments',[{amount:10}]], ['paymentAllocations',[{amount:10}]],
    ['balanceDue',10], ['settlementId','settlement'], ['checkoutCompleted',true], ['receiptId','receipt'],
    ['amountDueOverride',100], ['refundAmount',1], ['financialContext',{promotion:{code:'nested'}}],
    ['isGroupBooking',true], ['isGroupBooking','false'], ['groupId','group'], ['groupId','0'], ['groupSize',2], ['groupSize',true], ['groupSize','unknown'],
    ['groupRole','lead'], ['subGroupIndex',1], ['groupMemberIndex',1], ['billingMode','lead_pays_all'], ['amountDueByMember',{first:100}],
    ['status','Closed'], ['status','Paid'], ['status','No Show'], ['status','Arrived']
]) {
    test(`blocks non-simple financial context ${field}=${JSON.stringify(value)} before any write`, async () => {
        const record = fixture({ [field]: value }), before = JSON.stringify(record), h = harness(record);
        assert.throws(() => h.build(), /financial review required/);
        await h.save();
        assert.equal(h.state.writes.length, 0);
        assert.equal(JSON.stringify(record), before);
        assert.equal(h.state.record.originalTotal, 165, 'blocked promo/payment/group state is not rewritten');
    });
}

for (const [field, value] of [['discountAmount', 5], ['isComplimentary', true], ['originalUnitPrice', 200], ['payableLineTotal', 100], ['adjustments', [{amount:10}]]]) {
    test(`raw service-line ${field} cannot disappear through normalization and bypass the guard`, async () => {
        const record = fixture(); record.serviceLineItems[0][field] = value;
        const h = harness(record);
        await h.save();
        assert.equal(h.state.writes.length, 0);
        assert.match(h.state.messages.at(-1).message, /financial review required/);
    });
}

for (const [label, change] of [
    ['missing breakdown', r => { delete r.taxBreakdown; }], ['invalid JSON', r => { r.taxBreakdown = '{'; }],
    ['non-array breakdown', r => { r.taxBreakdown = '{}'; }], ['null breakdown', r => { r.taxBreakdown = null; }],
    ['missing rate', r => { r.taxBreakdown = [{name:'VAT',amount:27.5}]; }],
    ['negative rate', r => { r.taxBreakdown = [{name:'VAT',rate:-15}]; }],
    ['boolean rate', r => { r.taxBreakdown = [{name:'VAT',rate:true}]; }],
    ['malformed rate', r => { r.taxBreakdown = [{name:'VAT',rate:'15%'}]; }],
    ['infinite rate', r => { r.taxBreakdown = [{name:'VAT',rate:'Infinity'}]; }],
    ['unnamed tax', r => { r.taxBreakdown = [{rate:15}]; }],
    ['duplicate component', r => { r.taxBreakdown = [{name:'VAT',rate:15},{name:'VAT',rate:15}]; }],
    ['invalid amount', r => { r.taxBreakdown = [{name:'VAT',rate:15,amount:'bad'}]; }],
    ['zero rate positive tax', r => { r.taxBreakdown = [{name:'VAT',rate:0,amount:27.5}]; }],
    ['empty rates positive tax', r => { r.taxBreakdown = []; }],
    ['empty rates missing explicit zero', r => { r.taxBreakdown = []; delete r.taxTotal; }],
    ['conflicting top-level mode', r => { r.pricingMode = 'exclusive'; }],
    ['unknown mode', r => { r.taxPricingMode = 'unknown'; }],
    ['conflicting row mode', r => { r.serviceLineItems[0].priceMode = 'exclusive'; }],
    ['conflicting row tax alias', r => { r.serviceLineItems[0].taxPricingMode = 'exclusive'; }],
    ['conflicting row inclusive flag', r => { r.serviceLineItems[0].taxInclusive = false; }],
    ['additional row rate evidence', r => { r.serviceLineItems[0].taxRate = 10; }],
    ['conflicting tax mode', r => { const rows=JSON.parse(r.taxBreakdown); rows[0].pricingMode='exclusive'; r.taxBreakdown=rows; }],
    ['conflicting inclusive flag', r => { r.taxInclusive = false; }],
    ['non-boolean inclusive flag', r => { r.taxInclusive = 'true'; }],
    ['additional rate evidence', r => { r.taxRates = [{name:'VAT',rate:10}]; }],
    ['no persisted mode', r => { delete r.taxPricingMode; delete r.pricingMode; r.serviceLineItems.forEach(row=>delete row.priceMode); r.taxBreakdown=[{name:'VAT',rate:20}]; }]
]) {
    test(`blocks ambiguous tax evidence: ${label}`, async () => {
        const record = fixture(); change(record); const h = harness(record);
        h.window.THURAYA_TAX_PRICING_MODE = 'inclusive';
        await h.save();
        assert.equal(h.state.writes.length, 0);
        assert.match(h.state.messages.at(-1).message, /financial review required/);
    });
}

test('array tax evidence, numeric string rates and explicit unpaid/zero evidence are accepted', () => {
    const record = fixture({ paymentStatus: 'Unpaid', amountPaid: 0, discountAmount: '0.00', adjustments: [] });
    record.taxBreakdown = JSON.parse(record.taxBreakdown).map(row => ({ ...row, rate: String(row.rate) }));
    const h = harness(record); h.window.THURAYA_TAX_PRICING_MODE = 'exclusive';
    assert.equal(h.build().taxTotal, 37.5, 'ambient tax policy cannot replace booking evidence');
});
test('explicit persisted zero-tax evidence remains zero, not an inferred exemption', () => {
    const result = harness(fixture({ taxBreakdown: [], taxTotal: 0 })).build();
    assert.equal(result.taxTotal, 0); assert.equal(result.bookedPrice, 225);
});
test('exclusive booking uses the same builder, not duplicated Quick Edit tax arithmetic', () => {
    const record = fixture({ pricingMode:'exclusive', taxPricingMode:'exclusive' });
    record.taxBreakdown = JSON.parse(record.taxBreakdown).map(row => ({ ...row, pricingMode:'exclusive' }));
    record.serviceLineItems.forEach(row => { row.priceMode = 'exclusive'; });
    const result = harness(record).build();
    assert.equal(result.bookedPrice, 225); assert.equal(result.taxTotal, 45); assert.equal(result.amountDue, 270);
});
test('manual amount mismatch cannot override canonical service prices', async () => {
    const h = harness(); h.elements.thQeV4Amount.value = '165'; await h.save();
    assert.equal(h.state.writes.length, 0); assert.match(h.state.messages.at(-1).message, /amount must match/);
});
for (const [label, change] of [
    ['payment appeared', h => { h.state.latest.amountPaid=10; }],
    ['status changed', h => { h.state.latest.status='Closed'; }],
    ['service changed', h => { h.state.latest.serviceLineItems[0].price=200; }],
    ['tax evidence changed', h => { h.state.latest.taxBreakdown='[]'; }],
    ['record deleted', h => { h.state.exists=false; }],
    ['read failed', h => { h.state.readError=true; }]
]) {
    test(`fresh read prevents stale modal overwrite: ${label}`, async () => {
        const h=harness(); change(h); await h.save(); assert.equal(h.state.writes.length,0);
    });
}
test('record comparison is independent of object key order', async () => {
    const h=harness(); h.state.latest=Object.fromEntries(Object.entries(h.state.latest).reverse());
    await h.save(); assert.equal(h.state.writes.length,1);
});

for (const responsibility of ['booker', 'recipient', 'self']) {
    test('individual payer metadata is not group billing: ' + responsibility, async () => {
        const h = harness(fixture({ paymentResponsibility: responsibility, paymentStatus: 'unpaid' }));
        assert.equal(h.identity(), 'INDIVIDUAL'); await h.save();
        assert.equal(h.state.writes.length, 1); assert.equal(h.state.writes[0].payload.grandTotal, 225);
    });
}
test('Individual pending_or_paid_by_booker is payment review, not group', async () => {
    const h = harness(fixture({ paymentResponsibility: 'booker', paymentStatus: 'pending_or_paid_by_booker' }));
    assert.equal(h.identity(), 'INDIVIDUAL'); await h.save(); assert.equal(h.state.writes.length, 0);
    assert.match(h.state.messages.at(-1).message, /Payment status cannot be safely determined/);
    assert.doesNotMatch(h.state.messages.at(-1).message, /group or allocated/i);
});
for (const evidence of [{ groupId: 'synthetic-group' }, { groupBookingId: 'synthetic-group' }, { groupLeadId: 'synthetic-lead' }, { groupMemberId: 'synthetic-member' }, { Group_ID: 'synthetic-group' }, { 'Group ID': 'synthetic-group' }, { isGroup: true }, { groupCount: 2 }, { groupRole: 'member' }, { groupSize: 2 }, { groupMemberIndex: 1 }, { groupMemberCount: 2 }, { billingMode: 'split_own' }, { groupPaymentMode: 'lead', billingMode: 'legacy' }, { amountDueByMember: { member: 100 } }, { source: 'client-group-booking' }, { bookingSource: 'staff_hf88d_group_module', source: 'legacy' }]) {
    test('canonical group evidence retains reviewed guard: ' + JSON.stringify(evidence), async () => {
        const h = harness(fixture({ ...evidence, paymentResponsibility: 'booker' }));
        assert.equal(h.identity(), 'GROUP_OR_ALLOCATED'); await h.save(); assert.equal(h.state.writes.length, 0);
        assert.match(h.state.messages.at(-1).message, /Reviewed edit required.*group or allocated/);
    });
}
test('unknown historical billing identity remains review-required', async () => {
    const h = harness(fixture({ groupRole: 'legacy-unknown', paymentResponsibility: 'booker' }));
    assert.equal(h.identity(), 'REVIEW_REQUIRED'); await h.save(); assert.equal(h.state.writes.length, 0);
    assert.match(h.state.messages.at(-1).message, /historical billing evidence is incomplete/);
});
test('malformed historical group alias cannot be interpreted as Individual', async () => {
    const h = harness(fixture({ isGroup: 'unknown', paymentResponsibility: 'booker' }));
    assert.equal(h.identity(), 'REVIEW_REQUIRED'); await h.save(); assert.equal(h.state.writes.length, 0);
});
test('cancelled Individual with booker metadata retains lifecycle protection', async () => {
    const h = harness(fixture({ status: 'Cancelled', paymentResponsibility: 'booker' }));
    assert.equal(h.identity(), 'INDIVIDUAL'); await h.save(); assert.equal(h.state.writes.length, 0);
    assert.match(h.state.messages.at(-1).message, /not pre-check-in/);
});
test('fresh persisted group evidence cannot be bypassed by modal metadata removal', async () => {
    const h = harness(fixture({ paymentResponsibility: 'booker' })); h.state.latest.groupId = 'synthetic-group';
    await h.save(); assert.equal(h.state.writes.length, 0);
});
test('Quick Edit off-day save rejection occurs before any Appointment write', async () => {
    const h = harness(); h.window.thurayaValidateStaffScheduleAssignments = async () => { throw Error('Off schedule'); };
    await h.save(); assert.equal(h.state.writes.length, 0); assert.equal(h.state.reads.length, 0);
});
test('Quick Edit runtime outside reviewed financial context/build/save stays byte-identical to Issue 2', () => {
    const previous=execFileSync('git',['show',parent+':app.js'],{cwd:__dirname,encoding:'utf8',maxBuffer:16e6}).replace(/\r\n/g,'\n');
    const erase=(text,isNew)=>{
        const v4=section(text,'   Expected Today Quick Edit V4','/* === END THURAYA STAFF');
        return v4.replace(section(v4,isNew?'    function quickEditV4FinancialContext(':'    function buildQuickEditV4CanonicalFinancials(','    function itemizedRowsFromServiceText('),'REVIEWED_FINANCIAL_BUILDER')
            .replace(section(v4,'    async function saveEdit()','    window.editAppointment ='),'REVIEWED_SAVE');
    };
    assert.equal(erase(require('./scheduling-source-parity.cjs').baselineSource('app.js',source),true),erase(previous,false));
});
