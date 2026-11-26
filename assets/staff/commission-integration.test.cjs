'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const engine = require('./functions/commission-engine');
const legacy = require('./functions/commission-legacy');
const { job, build } = require('./commission-test-fixtures.cjs');
const baseline = file => execFileSync('git', ['show', '64e5968d00b013253e9965851e09696fa828173f:' + file], { cwd: __dirname, encoding: 'utf8', maxBuffer: 12 * 1024 * 1024 }).replace(/\r\n/g, '\n');
function original() {
 const context = vm.createContext({ console: { log() {}, warn() {} }, setTimeout() {}, setInterval() {}, document: { readyState: 'loading', addEventListener() {} }, firebase: { firestore: () => ({}), auth: () => ({}) }, allMenuServicesCache: [] });
 context.window = context;
 const app = baseline('app.js');
 for (const marker of ['window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__', 'window.__TH_COMP_FINANCIAL_NORMALIZER_20260601__']) {
  const p = app.indexOf(marker), from = app.lastIndexOf('(function', p), until = app.indexOf('\n})();', p) + 7;
  vm.runInContext(app.slice(from, until), context);
 }
 const code = baseline('commissions-v1.js').replace('    if (document.readyState === "loading")', '    window.legacyCalculateRows = calculateRows;\n    if (document.readyState === "loading")');
 vm.runInContext(code, context);
 return context;
}
const models = ['percentage', 'fixed', 'hybrid', 'tiered'];
for (const roleKey of ['tech', 'foh', 'manager']) for (const commissionType of models) test(`legacy ${roleKey} / ${commissionType} equals certified evaluator`, () => {
 const c = original();
 const jobs = [job('700', { id: 'a', bookedService: 'Test service', assignedFohEmail: 'foh@example.test', managerEmail: 'manager@example.test' }), job('600', { id: 'b', bookedService: 'Test service' })];
 const rules = [{ id: 'legacy', roleKey, appliesTo: 'serviceRevenue', commissionType, percentage: 10, fixedAmount: 5, minRevenue: 50, active: true }];
 assert.deepEqual(JSON.parse(JSON.stringify(legacy.calculateRows(jobs, rules))), JSON.parse(JSON.stringify(c.legacyCalculateRows(jobs, rules))));
});
test('legacy group, complimentary and Appointment source parity', () => {
 const c = original();
 const jobs = [job('0', { id:'waived', complimentaryStatus:'financial_applied', complimentaryValue:100 }), job('100', { id:'group', groupId:'group', billingMode:'lead_pays_all', groupCheckoutAmount:300 }), job('80', { id:'fallback', _source:'Appointments' })];
 const rules = [{ id:'legacy', roleKey:'tech', appliesTo:'totalBill', commissionType:'percentage', percentage:10 }];
 assert.deepEqual(JSON.parse(JSON.stringify(legacy.calculateRows(jobs, rules))), JSON.parse(JSON.stringify(c.legacyCalculateRows(jobs, rules))));
});
test('Commission UI renders null, zero, pending and locked states distinctly', () => {
 const c = vm.createContext({ ThurayaCommissionEngine:engine, ThurayaCommissionPresentation:require('./commission-presentation'), document:{getElementById:()=>true} }); c.window=c;
 vm.runInContext(fs.readFileSync(__dirname+'/commission-target-ui.js','utf8'),c);
 const absent=build([job('100')],{rules:[]}).rows;
 const zero=build([job('100')]).rows;
 const pending=build([job('1500',{refundStatus:'pending'})]).rows;
 assert.match(c.ThurayaCommissionV2.renderDays(absent), /NOT CONFIGURED/);
 assert.match(c.ThurayaCommissionV2.renderDays(zero), /BELOW TARGET/);
 assert.match(c.ThurayaCommissionV2.renderDays(pending), /Not payable/);
 assert.match(c.ThurayaCommissionV2.summary(pending), /Incomplete entitlement/);
 assert.match(c.ThurayaCommissionV2.renderDays([{...zero[0],locked:true,sourceChanged:true}]), /LOCKED/);
 const csv=c.ThurayaCommissionV2.csvRows(c.ThurayaCommissionV2.dailyRows({target:{rows:pending}}));
 assert.match(csv,/PENDING/); assert.match(csv,/Unknown Pending Amount/);
});
test('published assets use the same decimal/engine before commission consumers', () => {
 const html=fs.readFileSync(__dirname+'/index.html','utf8');
 assert.ok(html.indexOf('functions/vendor/decimal.js')<html.indexOf('functions/commission-engine.js'));
 assert.ok(html.indexOf('functions/commission-engine.js')<html.indexOf('commission-target-ui.js'));
 assert.ok(html.indexOf('commission-presentation.js')<html.indexOf('commission-target-ui.js'));
 assert.ok(html.indexOf('commission-target-ui.js')<html.indexOf('commissions-v1.js'));
});

function capabilityHarness() {
 const auth = { currentUser: { uid: 'operator' } }, pending = [];
 const c = vm.createContext({ ThurayaCommissionEngine: engine, firebase: { auth: () => auth, app: () => ({ functions: () => ({ httpsCallable: () => () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }) }) } });
 c.window = c;
 vm.runInContext(fs.readFileSync(__dirname + '/commission-target-ui.js', 'utf8'), c);
 return { auth, pending, api: c.ThurayaCommissionV2, response: uid => ({ data: { actorUid: uid, capabilities: { legacyAdmin: true } } }) };
}
test('same-user capability refresh is coalesced and does not transiently hide operator UI', async () => {
 const h = capabilityHarness(), first = h.api.refresh(); h.pending.shift().resolve(h.response('operator')); await first;
 const one = h.api.refresh(), two = h.api.refresh();
 assert.equal(h.pending.length, 1); assert.equal(h.api.canManage('operator'), true);
 h.pending.shift().resolve(h.response('operator')); await Promise.all([one, two]);
 assert.equal(h.api.canManage('operator'), true);
});
test('capability refresh fails closed on denial and cannot cross an Auth UID change', async () => {
 const h = capabilityHarness(), first = h.api.refresh(); h.pending.shift().resolve(h.response('operator')); await first;
 const failed = h.api.refresh(); h.pending.shift().reject(new Error('Revoked')); await assert.rejects(failed, /Revoked/);
 assert.equal(h.api.canManage('operator'), false);
 const old = h.api.refresh(), oldRequest = h.pending.shift(); h.auth.currentUser = { uid: 'other' };
 const next = h.api.refresh(); h.pending.shift().resolve(h.response('other')); await next;
 oldRequest.resolve(h.response('operator')); await assert.rejects(old, /identity changed/);
 assert.equal(h.api.canManage('operator'), false); assert.equal(h.api.canManage('other'), true);
});

test('legacy current-menu context preserves certified evaluator behavior', () => {
 const c = original();
 const menu = [{ id:'menu-service', name:'Test service', serviceName:'Test service', price:300 }];
 c.allMenuServicesCache = menu;
 const jobs = [job('100', { bookedService:'Test service', serviceLineItems:undefined, bookedPrice:100 })];
 const rules = [{ id:'legacy',roleKey:'tech',appliesTo:'serviceRevenue',commissionType:'percentage',percentage:10 }];
 assert.deepEqual(JSON.parse(JSON.stringify(legacy.calculateWithMenu(jobs,rules,menu))),JSON.parse(JSON.stringify(c.legacyCalculateRows(jobs,rules))));
});

test('target staff summary shows one person, while daily detail preserves dates', () => {
 const c = vm.createContext({ ThurayaCommissionEngine:engine }); c.window=c;
 vm.runInContext(fs.readFileSync(__dirname+'/commission-target-ui.js','utf8'),c);
 const rows=build([job('100')]).rows;
 const html=c.ThurayaCommissionV2.renderPeople([...rows,...rows]);
 assert.equal((html.match(/<tbody><tr>/g)||[]).length,1);
 assert.doesNotMatch(html,/Business Date/);
});

test('personal source-job count does not collapse multiple jobs into one daily row',()=>{
 const c=vm.createContext({ThurayaCommissionEngine:engine});c.window=c;
 vm.runInContext(fs.readFileSync(__dirname+'/commission-target-ui.js','utf8'),c);
 const rows=c.ThurayaCommissionV2.dailyRows({target:build([job('700',{id:'first'}),job('600',{id:'second'})])});
 assert.equal(rows.length,1);assert.equal(c.ThurayaCommissionV2.sourceJobCount(rows),2);
 assert.equal(c.ThurayaCommissionV2.sourceJobCount([...rows,...rows]),2);
 assert.equal(c.ThurayaCommissionV2.sourceJobCount([{model:engine.TYPE,contributions:[]}]),0);
});

test('both Commission CSV paths escape formula-prefixed person labels', () => {
 const c=vm.createContext({ThurayaCommissionEngine:engine});c.window=c;
 vm.runInContext(fs.readFileSync(__dirname+'/commission-target-ui.js','utf8'),c);
 for(const name of ['=FORMULA()', '+FORMULA()', '-FORMULA()', '@FORMULA()']) {
  const rows=build([job('100')]).rows.map(r=>({...r,technician:name}));
  assert.ok(engine.csv(rows).includes("'"+name));
  assert.ok(c.ThurayaCommissionV2.csvRows(rows).includes("'"+name));
 }
});
function dashboardRenderer() {
 const targetApi = {
  canManage() { return false; },
  renderPeople() { return '<section data-render-people></section>'; },
  renderDays() { return '<section data-render-days></section>'; }
 };
 const context = vm.createContext({
  console: { log() {}, warn() {}, error() {} },
  setTimeout() {},
  setInterval() {},
  document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; } },
  firebase: { firestore: () => ({}), auth: () => ({ onAuthStateChanged() {} }) },
  ThurayaCommissionEngine: { today: () => '2026-09-12' },
  ThurayaCommissionV2: targetApi,
  allMenuServicesCache: []
 });
 context.window = context;
 const code = fs.readFileSync(__dirname + '/commissions-v1.js', 'utf8').replace(
  '    window.com_lockCurrentCommissions = lockCurrentCommissions;',
  '    window.__renderDashboardResults = renderDashboardResults;\n    window.com_lockCurrentCommissions = lockCurrentCommissions;'
 );
 vm.runInContext(code, context);
 return (rows, rulesLength = 999) => context.__renderDashboardResults({ length: 0 }, { length: rulesLength }, rows);
}

function targetRow(ruleId, patch = {}) {
 return {
  model: 'DAILY_TARGET_MARGINAL',
  dateString: '2026-09-12',
  personId: 'person-' + String(ruleId || 'none'),
  technician: 'Technician',
  staffName: 'Technician',
  staffEmail: 'tech@example.test',
  baseValue: '0',
  commissionAmount: '0',
  eligibleRevenue: '0',
  contributions: [],
  ruleId,
  ...patch
 };
}

function legacyRow(ruleId, patch = {}) {
 return {
  dateString: '2026-09-12',
  roleKey: 'tech',
  roleName: 'Technician',
  staffName: 'Legacy Tech',
  staffEmail: 'legacy@example.test',
  clientName: 'Client',
  service: 'Service',
  appliesTo: 'serviceRevenue',
  baseValue: '100',
  commissionAmount: '10',
  jobId: 'job-' + String(ruleId || 'none'),
  ruleId,
  ...patch
 };
}

function activeRulesUsed(html) {
 const match = html.match(/<span>Active Rules Used<\/span><strong>(\d+)<\/strong>/);
 assert.ok(match, 'Active Rules Used KPI should render');
 return Number(match[1]);
}

for (const [name, rows, expected] of [
 ['repeated same ruleId across many rows counts once', [targetRow('v2-a'), targetRow('v2-a'), targetRow('v2-a')], 1],
 ['three distinct V2 ruleIds across all-technician rows counts three', [targetRow('v2-gifty'), targetRow('v2-matilda'), targetRow('v2-salam')], 3],
 ['no effective rule and empty ruleIds counts zero', [targetRow(''), targetRow(null), targetRow(undefined), targetRow('   ')], 0],
 ['single-technician V2 result counts one selected rule', [targetRow('v2-gifty', { personId: 'gifty' })], 1],
 ['draft rule not selected does not count', [], 0],
 ['cancelled rule not selected does not count', [targetRow('published-revision')], 1],
 ['successor revisions selected across historical dates each count once', [targetRow('revision-1', { dateString: '2026-08-31' }), targetRow('revision-2', { dateString: '2026-09-01' })], 2],
 ['superseded non-selected rule is not counted', [targetRow('successor-revision')], 1],
 ['closed historical effective-date row counts when selected', [targetRow('closed-historical-revision', { dateString: '2026-08-15' })], 1],
 ['legacy-only emitted legacy ruleId counts once', [legacyRow('legacy-rule')], 1],
 ['mixed legacy and V2 emitted ruleIds count together', [legacyRow('legacy-rule'), targetRow('v2-a'), targetRow('v2-b')], 3],
 ['pending technician-day with selected ruleId still counts', [targetRow('v2-pending', { commissionAmount: null, status: 'PENDING' })], 1],
 ['zero-activity day with selected ruleId still counts', [targetRow('v2-zero', { baseValue: '0', eligibleRevenue: '0', commissionAmount: '0', contributions: [] })], 1],
 ['locked snapshot row uses displayed stored rule identity', [targetRow('locked-revision', { locked: true })], 1],
 ['duplicate legacy and V2 IDs do not inflate count', [legacyRow('legacy-rule'), legacyRow('legacy-rule'), targetRow('v2-a'), targetRow('v2-a')], 2],
 ['blank null undefined and whitespace-only IDs never count', [legacyRow(''), legacyRow(null), targetRow(undefined), targetRow('   ')], 0]
]) test('Active Rules Used KPI: ' + name, () => {
 const render = dashboardRenderer();
 assert.equal(activeRulesUsed(render(rows)), expected);
});

test('Active Rules Used KPI preserves manager/all-technician and detail parity', () => {
 const render = dashboardRenderer();
 assert.equal(activeRulesUsed(render([targetRow('v2-gifty'), targetRow('v2-matilda'), targetRow('v2-salam')])), 3);
 assert.equal(activeRulesUsed(render([targetRow('v2-matilda', { personId: 'matilda' })])), 1);
});

test('Active Rules Used KPI stays in the responsive dashboard grid without changing awards', () => {
 const render = dashboardRenderer();
 const html = render([targetRow('v2-a', { commissionAmount: '18.75' }), targetRow('v2-a', { commissionAmount: null, status: 'PENDING' })], 0);
 assert.match(html, /class="com-kpi-grid"/);
 assert.match(html, /<span>Complete Awards Only<\/span><strong>18.75 GHC<\/strong><div>Entitlement incomplete<\/div>/);
 assert.equal(activeRulesUsed(html), 1);
});

test('Sales/canonical financial helpers and Client App are unchanged', () => {
 const app=fs.readFileSync(__dirname+'/app.js','utf8').replace(/\r\n/g,'\n'), prior=baseline('app.js');
 for(const marker of ['window.__TH_SERVICE_LINE_ITEMS_COMPAT_20260522__','window.__TH_COMP_FINANCIAL_NORMALIZER_20260601__']) {
  const block=s=>{const p=s.indexOf(marker);return s.slice(s.lastIndexOf('(function',p),s.indexOf('\n})();',p)+7);};
  assert.equal(block(app),block(prior));
 }
 const changed=execFileSync('git',['diff','--name-only','64e5968d00b013253e9965851e09696fa828173f'],{cwd:__dirname,encoding:'utf8'}).trim().split(/\r?\n/);
 // Gift Card presentation shares this file; unrelated sales/promotion logic remains byte-protected.
 assert.equal(changed.some(p=>p!=='sales-promo-v1.js'&&/^client|sales|canonical-financial-core/i.test(p)),false);
 const promo=fs.readFileSync(__dirname+'/sales-promo-v1.js','utf8').replace(/\r\n/g,'\n'), oldPromo=baseline('sales-promo-v1.js');
 const business=s=>s.slice(s.indexOf('    function renderDiscounts()'));
 assert.equal(business(promo),business(oldPromo));
 for(const name of ['functions/canonical-financial-core.js','firebase-config.js','attendance.js']) assert.equal(fs.readFileSync(__dirname+'/'+name,'utf8').replace(/\r\n/g,'\n'),baseline(name));
 assert.equal(require('./no-show-source-parity.cjs').strip('reports-v2.js',fs.readFileSync(__dirname+'/reports-v2.js','utf8').replace(/\r\n/g,'\n')),baseline('reports-v2.js'));
});
