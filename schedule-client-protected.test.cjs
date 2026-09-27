'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process');
const { read, section } = require('./schedule-client-fixture.cjs');
const baseline = '0ce2f4822fa9a74d22140a989340d8859a8bb99a';
const prior = file => cp.execFileSync('git',['show',baseline+':'+file],{cwd:__dirname,encoding:'utf8',maxBuffer:16e6}).replace(/\r\n/g,'\n');
test('Client app source outside the three reviewed availability/save functions is unchanged', () => {
    function strip(text) {
        for (const [start,end] of [
            ['async function bk_buildBusyByTechForDate(', 'window.bk_generateSlots ='],
            ['window.bk_confirmBooking = async function()', 'function populateSuccessScreen('],
            ['    window.bk_hasSlotConflict = async function(', '    // Re-check slots when returning']
        ]) text = text.replace(section(text,start,end),'<reviewed-scheduling>\n');
        return text;
    }
    assert.equal(strip(read('app.js')),strip(prior('app.js')));
});
test('Client individual financial, payer, service snapshots and payment payload remain byte-identical', () => {
    assert.equal(section(read('app.js'),'        const apptData = {','        await batch.commit();'),section(prior('app.js'),'        const apptData = {','        await batch.commit();'));
    assert.equal(section(read('app.js'),'    const services  = bk_selectedServices.map','    setBtnLoading(btn, true, \'Confirm Booking\');'),section(prior('app.js'),'    const services  = bk_selectedServices.map','    setBtnLoading(btn, true, \'Confirm Booking\');'));
});
test('Client group financial payload is unchanged', () => {
    assert.equal(section(read('group-booking.js'),'            batch.set(ref, {','        await batch.commit();'),section(prior('group-booking.js'),'            batch.set(ref, {','        await batch.commit();'));
    const strip = text => text.replace(section(text,'window.grp_confirmBooking = async function()','function grp_populateSuccess()'),'<reviewed-group-save>');
    assert.equal(strip(read('group-booking.js')),strip(prior('group-booking.js')));
});
test('Client configuration, authentication and other retained scripts are untouched', () => {
    const files = cp.execFileSync('git',['ls-tree','-r','--name-only',baseline],{cwd:__dirname,encoding:'utf8'}).trim().split('\n').filter(file => file.endsWith('.js') && !['app.js','availability.js','group-booking.js'].includes(file));
    assert.ok(files.includes('firebase-config.js'));
    for (const file of files) assert.equal(read(file),prior(file),file);
});
test('Client HTML adds only schedule policy prerequisite; no configuration or script order change', () => {
    assert.equal(read('index.html').replace('<script src="schedule-policy.js?v=rc2-effective-schedule-1"></script>\n',''),prior('index.html'));
});
