'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const engine = require('./functions/commission-engine');

const source = file => fs.readFileSync(__dirname + '/' + file, 'utf8');
const presentation = require('./commission-presentation');
const person = { enrollmentFrom: '2027-01-01', enrollmentUntil: null, personId: 'synthetic-person', displayName: 'Synthetic Technician', ruleHeads: {}, bindingHeads: {} };

function harness(persons = [], targetAdmin = true) {
    const nodes = new Map(), calls = [];
    const node = id => {
        if (!nodes.has(id)) nodes.set(id, { innerHTML: '', textContent: '', value: '', checked: false, style: {}, listeners: {},
            addEventListener(event, callback) { this.listeners[event] = callback; },
            append() {}, prepend() {}, reset() {}, querySelectorAll() { return []; }, querySelector() { return null; } });
        return nodes.get(id);
    };
    const config = { enabled: true, manager: true, actorUid: 'synthetic-operator', revision: 1,
        capabilities: { targetAdmin, legacyAdmin: true, correctEnrollment: targetAdmin }, persons, rules: [], bindings: [],
        legacyRules: [{ id: 'legacy-one', commissionType: 'percentage', roleKey: 'tech', active: false }] };
    const c = vm.createContext({
        ThurayaCommissionEngine: engine, ThurayaCommissionPresentation: presentation, confirm: () => true, console: { log() {}, warn() {}, error() {} },
        crypto: { randomUUID: () => 'synthetic-request' }, setTimeout() {}, setInterval() {},
        document: { readyState: 'loading', addEventListener() {}, getElementById: node, createElement: () => node('style') },
        firebase: { firestore: () => ({}), auth: () => ({ currentUser: { uid: config.actorUid } }),
            app: () => ({ functions: () => ({ httpsCallable: () => async data => {
                calls.push(JSON.parse(JSON.stringify(data)));
                if (data.action === 'config') return { data: config };
                if (data.action === 'staffOptions') return { data: { staff: [{ id: 'station@example.test', name: 'Synthetic Technician', email: 'station@example.test', uid: null }] } };
                if (data.action === 'saveRule') { if (config.waitSave) await config.waitSave; return { data: { ruleId: 'synthetic-rule' } }; }
                if (data.action === 'impact') return { data: config.testImpact };
                if (data.action === 'correctEnrollment') return { data: { personId: 'synthetic-person' } };
                throw new Error('Unexpected command: ' + data.action);
            } }) }) }
    });
    c.window = c;
    vm.runInContext(source('commission-target-ui.js').replace('    root.ThurayaCommissionV2 =', '    root.testOpenCorrection = openEnrollmentCorrection;\n    root.ThurayaCommissionV2 ='), c);
    return { c, node, calls, config, mount: () => c.ThurayaCommissionV2.mountRules(node('root')) };
}

test('daily-target rules have an explicit heading, financial policy and enrolled-person label', async () => {
    const h = harness([person]); await h.mount();
    const html = h.node('cv_rules').innerHTML;
    assert.match(html, /Technician Daily Target Commission Rules/);
    assert.match(html, /eligible daily revenue above the configured daily target/);
    assert.match(html, /for="cv_person">Enrolled Technician/);
    assert.match(html, /aria-describedby="cv_targetPolicy"/);
    assert.match(html, /Effective Until \(optional, exclusive\)/);
});

test('zero persons automatically exposes enrollment without creating or inferring configuration', async () => {
    const h = harness(); await h.mount();
    assert.match(h.node('cv_rules').innerHTML, /<details id="cv_enrollment" open>/);
    assert.match(h.node('cv_rules').innerHTML, /Synthetic Technician \(station@example.test\)/);
    assert.deepEqual(h.calls.map(c => c.action), ['config', 'staffOptions']);
    assert.equal(h.config.persons.length, 0);
});

test('enrolled technician appears once and enrollment remains collapsible', async () => {
    const h = harness([person]); await h.mount();
    const html = h.node('cv_rules').innerHTML;
    assert.doesNotMatch(html, /<details id="cv_enrollment" open>/);
    const select = html.slice(html.indexOf('<select id="cv_person">')).split('</select>')[0];
    assert.equal((select.match(/value="synthetic-person"/g) || []).length, 1);
    assert.match(select, /Synthetic Technician/);
    assert.deepEqual(h.calls.map(c => c.action), ['config', 'staffOptions']);
});

test('target authorization still disables the fieldset', async () => {
    const h = harness([], false); await h.mount();
    assert.match(h.node('cv_rules').innerHTML, /<fieldset id="cv_targetFields" disabled/);
    assert.deepEqual(h.calls.map(c => c.action), ['config', 'staffOptions']);
});

test('Staff selection prefills only the current display alias, not historical aliases or dates', async () => {
    const h = harness(); await h.mount();
    h.node('cv_staff').value = 'station@example.test';
    h.node('cv_staff').listeners.change();
    assert.equal(h.node('cv_name').value, 'Synthetic Technician');
    assert.equal(h.node('cv_email').value, 'station@example.test');
    assert.equal(h.node('cv_aliases').value, 'Synthetic Technician');
    for (const id of ['cv_excluded', 'cv_identityFrom', 'cv_uid']) assert.equal(h.node(id).value, '');
    assert.deepEqual(h.calls.map(c => c.action), ['config', 'staffOptions']);
});

for (const publication of ['DRAFT', 'PUBLISHED']) test(publication + ' rule request retains the certified model, values and dates', async () => {
    const h = harness([person]); await h.mount();
    const fields = { cv_person: person.personId, cv_type: 'DAILY_TARGET_MARGINAL', cv_target: '1200.05',
        cv_rate: '12', cv_from: '2027-01-01', cv_until: '', cv_status: publication, cv_notes: 'Synthetic approval' };
    for (const [id, value] of Object.entries(fields)) h.node(id).value = value;
    h.node('cv_form').listeners.submit({ preventDefault() {} });
    await new Promise(resolve => setImmediate(resolve));
    const request = h.calls.find(c => c.action === 'saveRule');
    assert.deepEqual(request.rule, { ruleType: 'DAILY_TARGET_MARGINAL', dailyTarget: '1200.05', commissionRate: '0.12',
        effectiveFrom: '2027-01-01', effectiveUntil: null, status: publication });
    assert.equal(request.personId, person.personId);
    assert.equal(request.expectedRevision, 1);
    assert.equal(request.backdateConfirmed, false);
    assert.equal(h.calls.filter(c => !['config', 'staffOptions'].includes(c.action)).length, 1);
});

test('legacy create, edit, clear and empty library retain explicit legacy labels', async () => {
    const h = harness();
    const legacy = source('commissions-v1.js').replace('    if (document.readyState === "loading")',
        '    window.testRenderRulesSetup = renderRulesSetup;\n    window.testRenderRules = renderRules;\n    if (document.readyState === "loading")');
    vm.runInContext(legacy, h.c);
    h.c.testRenderRulesSetup();
    assert.match(h.node('com_content').innerHTML, /Legacy Commission Rules Library/);
    assert.match(h.node('com_content').innerHTML, /Minimum Revenue is not a daily target/);
    assert.match(h.node('com_content').innerHTML, /Save Legacy Rule/);
    assert.match(h.node('com_content').innerHTML, /aria-describedby="com_legacyWarning"/);
    h.c.scrollTo = () => {};
    await h.c.com_editRule('legacy-one');
    assert.equal(h.node('comFormTitle').textContent, 'Edit Legacy Commission Rule');
    h.c.com_resetForm();
    assert.equal(h.node('comFormTitle').textContent, 'Legacy Commission Rules');
    h.c.testRenderRules([]);
    assert.match(h.node('com_rulesList').innerHTML, /No legacy commission rules configured/);
});

test('legacy minimum remains per-job eligibility, not daily marginal subtraction', () => {
    const legacy = require('./functions/commission-legacy');
    const { job, build } = require('./commission-test-fixtures.cjs');
    const rules = [{ id: 'legacy', roleKey: 'tech', appliesTo: 'serviceRevenue', commissionType: 'percentage', percentage: 10, minRevenue: 1200 }];
    assert.equal(legacy.calculateRows([job('1500')], rules)[0].commissionAmount, 150);
    assert.equal(build([job('1500')]).rows[0].dailyPayable, '30.00');
    assert.equal(legacy.calculateRows([job('700'), job('600')], rules).length, 0);
    assert.equal(build([job('700', { id: 'one' }), job('600', { id: 'two' })]).rows[0].dailyPayable, '10.00');
});

function editorHarness(authorized = true) {
    const p = { ...person, enrollmentFrom: '2026-09-06', staffRef: 'station@example.test', accessUids: [], enrollmentRevision: 1 };
    const b = { id: 'binding-one', personId: p.personId, stationEmail: p.staffRef, aliases: ['Synthetic.Tech'], excludedAliases: ['Previous.Tech'], effectiveFrom: p.enrollmentFrom, effectiveUntil: null, revision: 1 };
    const h = harness([p], authorized); h.config.bindings = [b];
    h.open = async () => { await h.mount(); h.c.testOpenCorrection(h.node('root'), p, b); };
    h.fill = () => {
        const values = { name: p.displayName, staff: p.staffRef, email: b.stationEmail, aliases: 'Synthetic.Tech', excluded: 'Previous.Tech', from: '2026-08-01', reason: 'Owner confirmation REF-1' };
        for (const [key, value] of Object.entries(values)) h.node('cv_edit_' + key).value = value;
        h.node('cv_edit_identity').checked = true; h.node('cv_edit_backdate').checked = true;
    };
    h.config.testImpact = { fingerprint: 'fresh-fingerprint', classification: 'BACKDATED_CORRECTION', start: '2026-08-01', until: '2026-09-06', candidateJobCount: 2,
        effectiveRules: [], lockedPeriods: [], snapshots: [], changes: ['binding.effectiveFrom'], candidateJobs: [], blocked: false,
        proposedValues: { enrollmentFrom: '2026-08-01', binding: b }, interpretation: 'No payout writes' };
    return h;
}

test('authorized current binding exposes Correct Enrollment without saving on open', async () => {
    const h = editorHarness(); await h.open();
    assert.match(h.node('cv_bindings').innerHTML, /Correct Enrollment/);
    assert.match(h.node('cv_correction').innerHTML, /Current Value.*Proposed Value/s);
    assert.match(h.node('cv_correction').innerHTML, /Previous.Tech/);
    assert.match(h.node('cv_correction').innerHTML, /Owner-approved backdating/);
    assert.match(h.node('cv_correction').innerHTML, /id="cv_edit_save" disabled/);
    assert.deepEqual(h.calls.map(c => c.action), ['config', 'staffOptions']);
});

test('unauthorized user has no correction action or editor', async () => {
    const h = editorHarness(false); await h.open(); assert.doesNotMatch(h.node('cv_bindings').innerHTML, /Correct Enrollment/); assert.equal(h.node('cv_correction').innerHTML, '');
});

test('correction preview sends reason and backdate confirmation but no mutation', async () => {
    const h = editorHarness(); await h.open(); h.fill(); await h.node('cv_edit_preview').listeners.click();
    const request = h.calls.find(c => c.action === 'impact').proposal;
    assert.equal(request.action, 'correctEnrollment'); assert.equal(request.approvalReason, 'Owner confirmation REF-1');
    assert.equal(request.backdateConfirmed, true); assert.equal(request.proposed.binding.effectiveUntil, null);
    assert.deepEqual(request.proposed.binding.excludedAliases, ['Previous.Tech']); assert.equal(request.expectedBindingRevision, 1);
    assert.equal(h.calls.filter(c => !['config', 'staffOptions', 'impact'].includes(c.action)).length, 0);
});

test('changing proposed values invalidates preview and final approval', async () => {
    const h = editorHarness(); await h.open(); h.fill(); await h.node('cv_edit_preview').listeners.click();
    h.node('cv_edit_final').checked = true; h.node('cv_edit_form').listeners.change({ target: { id: 'cv_edit_final' } });
    assert.equal(h.node('cv_edit_save').disabled, false);
    h.node('cv_edit_form').listeners.input({ target: { id: 'cv_edit_from' } });
    assert.equal(h.node('cv_edit_save').disabled, true); assert.equal(h.node('cv_edit_final').checked, false);
    assert.match(h.node('cv_edit_warning').textContent, /BACKDATED CORRECTION.*2026-09-06.*2026-08-01/);
});

test('Save Correction uses revision command and reviewed fingerprint, never Add Binding', async () => {
    const h = editorHarness(); await h.open(); h.fill(); await h.node('cv_edit_preview').listeners.click();
    h.node('cv_edit_final').checked = true;
    h.node('cv_edit_form').listeners.submit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
    const saved = h.calls.find(c => c.action === 'correctEnrollment'); assert.ok(saved);
    assert.equal(saved.impactFingerprint, 'fresh-fingerprint'); assert.equal(saved.correctionConfirmed, true);
    assert.equal(h.calls.some(c => c.action === 'saveBinding' || c.action === 'enrollPerson'), false);
});

test('locked correction preview cannot enable final confirmation or save', async () => {
    const h = editorHarness(); h.config.testImpact.blocked = true; h.config.testImpact.blockReason = 'LOCKED PERIOD CORRECTION REQUIRES SEPARATE CONTROLLED CORRECTION WORKFLOW';
    await h.open(); h.fill(); await h.node('cv_edit_preview').listeners.click();
    assert.equal(h.node('cv_edit_final').disabled, true);
    assert.match(h.node('cv_edit_impact').innerHTML, /LOCKED PERIOD CORRECTION/);
    h.node('cv_edit_final').checked = true; h.node('cv_edit_form').listeners.submit({ preventDefault() {} }); await new Promise(resolve => setImmediate(resolve));
    assert.equal(h.calls.some(c => c.action === 'correctEnrollment'), false);
});

test('revision history displays reason actor current and superseded binding chain', async () => {
    const h = editorHarness();
    h.config.enrollmentHistory = [{ personId: person.personId, newRevision: 2, authoritative: true, action: 'correctEnrollment', approvalReason: 'Owner REF-2', confirmedBy: 'operator', newValues: { displayName: person.displayName, binding: { effectiveFrom: '2026-08-01' } } }];
    h.config.bindingHistory = [{ ...h.config.bindings[0], authoritative: false, supersededBy: 'binding-two' }, { ...h.config.bindings[0], id: 'binding-two', revision: 2, authoritative: true }];
    await h.mount(); const html = h.node('cv_enrollmentHistory').innerHTML;
    for (const marker of ['Owner REF-2', 'operator', 'Superseded', 'Current', 'binding-two', 'Previous.Tech']) assert.ok(html.includes(marker));
});

test('first rule defaults to full open-ended enrollment', async()=>{
 const p={...person,enrollmentFrom:'2026-05-08',enrollmentUntil:null};const h=harness([p]);await h.mount();h.node('cv_person').value=p.personId;h.node('cv_person').listeners.change();
 assert.equal(h.node('cv_from').value,'2026-05-08');assert.equal(h.node('cv_until').value,'');assert.equal(h.node('cv_full_period').checked,true);assert.equal(h.node('cv_gapWarning').hidden,true);
});
test('first rule defaults to finite enrollment and warns on narrowing', async()=>{
 const p={...person,enrollmentFrom:'2026-05-08',enrollmentUntil:'2027-05-08'};const h=harness([p]);await h.mount();h.node('cv_person').value=p.personId;h.node('cv_person').listeners.change();assert.equal(h.node('cv_until').value,'2027-05-08');
 h.node('cv_from').value='2026-05-09';h.node('cv_form').listeners.input({target:{id:'cv_from'}});assert.equal(h.node('cv_gapWarning').hidden,false);assert.equal(h.node('cv_full_period').checked,false);
});
test('enrollment missing aliases fails friendly preflight without any callable mutation',async()=>{
 const h=harness();await h.mount();h.node('cv_staff').value='station@example.test';h.node('cv_staff').listeners.change();h.node('cv_aliases').value='';await h.node('cv_enroll_preview').listeners.click();
 assert.match(h.node('cv_message').innerHTML,/Confirmed Alias is required/);assert.deepEqual(h.calls.map(c=>c.action),['config','staffOptions']);
});
test('current enrollment and history use business terms and retained audit details',async()=>{
 const h=editorHarness();h.config.bindingHistory=[...h.config.bindings];await h.mount();assert.match(h.node('cv_bindings').innerHTML,/Current Enrollments/);assert.match(h.node('cv_bindings').innerHTML,/Station and aliases/);assert.match(h.node('cv_enrollmentHistory').innerHTML,/Enrollment Change History/);assert.match(h.node('cv_enrollmentHistory').innerHTML,/View audit details/);
});

test('saving a rule replaces stale feedback and rejects duplicate submission',async()=>{
 const h=harness([person]);await h.mount();let finish;h.config.waitSave=new Promise(resolve=>{finish=resolve;});
 for(const[id,value]of Object.entries({cv_person:person.personId,cv_type:'DAILY_TARGET_MARGINAL',cv_target:'1200',cv_rate:'10',cv_from:'2027-01-01',cv_until:'',cv_status:'DRAFT',cv_notes:'Synthetic approval'}))h.node(id).value=value;
 h.node('cv_message').textContent='Rule saved.';h.node('cv_form').listeners.submit({preventDefault(){}});await new Promise(resolve=>setImmediate(resolve));
 assert.equal(h.node('cv_message').textContent,'Working...');assert.equal(h.node('cv_save').disabled,true);h.node('cv_form').listeners.submit({preventDefault(){}});assert.equal(h.calls.filter(c=>c.action==='saveRule').length,1);
 finish();await new Promise(resolve=>setImmediate(resolve));assert.equal(h.node('cv_message').textContent,'Rule saved.');assert.equal(h.node('cv_save').disabled,false);
});
