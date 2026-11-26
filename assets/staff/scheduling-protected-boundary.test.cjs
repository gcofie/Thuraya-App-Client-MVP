'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process');
const { read: readRaw, section } = require('./schedule-staff-fixture.cjs');
const serviceEditParity = require('./quick-edit-service-edit-parity.cjs');
const read = file => serviceEditParity.baselineSource(file, readRaw(file));
const { original, baselineSource } = require('./scheduling-source-parity.cjs');
function erase(text, start, end) { return text.replace(section(text,start,end), '<reviewed-section>\n'); }
test('Staff app has no source changes outside the precise authorized scheduling and Quick Edit sections', () => {
    const strip = text => {
        if (text.includes('    function quickEditV4BillingIdentity(')) text = text.replace(section(text,'    function quickEditV4BillingIdentity(','    function quickEditV4FinancialContext('), '');
        for (const [start,end] of [
            ['    function quickEditV4FinancialContext(','    function quickEditV4RecordState('],
            ['    async function renderSlots(){','    async function openQuickEditV4('],
            ['    async function saveEdit()','    window.editAppointment =']
        ]) {
            const head = text.indexOf('   Expected Today Quick Edit V4'), tail = text.indexOf('/* === END THURAYA STAFF',head);
            text = text.slice(0,head) + erase(text.slice(head,tail),start,end) + text.slice(tail);
        }
        return erase(text, '   THURAYA STAFF - SCHEDULE-AWARE BOOKING AVAILABILITY', '   THURAYA STAFF - NO SHOW LINKED ACTIVE_JOB RECONCILIATION');
    };
    assert.equal(strip(read('app.js')), strip(original('app.js')));
    baselineSource('app.js',read('app.js'));
});
test('canonical serialization and persisted financial evidence checks remain byte-exact', () => {
    const current = read('app.js'), before = original('app.js');
    const markers = [
        ['    function buildQuickEditV4CanonicalFinancials(','    function itemizedRowsFromServiceText('],
        ["        const guarded = /promo|discount|adjust", '    function quickEditV4RecordState(']
    ];
    for (const [start,end] of markers) {
        const allowed = "                if (record === appt && key === 'paymentResponsibility' && ['booker','recipient','self'].includes(String(value).trim().toLowerCase())) continue;\n";
        assert.equal(section(current,start,end).replace(allowed,''), section(before,start,end));
    }
});
test('Quick Edit save changes only the pre-write schedule gate and classified message', () => {
    const slice = text => section(section(text,'   Expected Today Quick Edit V4','/* === END THURAYA STAFF'),'    async function saveEdit()','    window.editAppointment =');
    const current = slice(read('app.js'))
        .replace("            if (typeof window.thurayaValidateStaffScheduleAssignments !== 'function') throw new Error('Working schedule could not be verified. Please retry.');\n            await window.thurayaValidateStaffScheduleAssignments([{ techEmail, date, time, duration }]);\n",'')
        .replace("setMsg(e.reviewMessage || ('Save failed: ' + e.message), 'error');", "setMsg('Save failed: ' + e.message, 'error');");
    assert.equal(current,slice(original('app.js')));
});
test('all backend, Gift, No Show, Commission, Sales, Attendance, Intelligence and Rules files are unchanged', () => {
    const files = cp.execFileSync('git',['ls-files'],{cwd:__dirname,encoding:'utf8'}).trim().split('\n');
    const protectedFiles = files.filter(file => /^(functions\/|gift-|no-show-(?:ui|model)\.js|commission.*\.js|sales.*\.js|attendance\.js|intelligence-engine-v1\.js|firebase-config\.js|firestore.*\.rules)/.test(file));
    assert.ok(protectedFiles.length > 20);
    for (const file of protectedFiles) assert.equal(read(file), original(file),file);
});
test('navigation integration is one prerequisite script only', () => {
    assert.equal(read('index.html').replace('<script src="schedule-policy.js?v=rc2-effective-schedule-1"></script>\n',''),original('index.html'));
});
test('individual financial payload builder and group financial calculations are unchanged', () => {
    for (const [file,start,end] of [
        ['booking-hf85f-core.js','  function basePayload(','  async function confirmBooking(){'],
        ['booking-hf87-group.js','  function groupFinancialsForMember(','  function ']
    ]) assert.equal(section(read(file),start,end),section(original(file),start,end));
});
