(function (root) {
    'use strict';
    const engine = root.ThurayaCommissionEngine;
    const view = root.ThurayaCommissionPresentation;
    let config = null;
    let refreshRequest = null;
    let staff = [];
    let editRuleId = null;
    let action = 'saveRule';
    let mutationBusy = null;
    let sessionRegistry = null;
    let rulesRequest = null;
    let auditRequest = null;
    function requireCurrent(current) {
        if (!current?.()) throw new Error('Commission session changed. Reload the view.');
    }
    function captureSession() {
        const session = root.ThurayaSessionResources;
        // This asset loads before app.js, so register its private cleanup on first use.
        if (session && sessionRegistry !== session) {
            sessionRegistry = session;
            session.onStop('commission-target-ui', () => {
                config = null; refreshRequest = null; staff = [];
                editRuleId = null; action = 'saveRule'; mutationBusy = null;
                rulesRequest = null; auditRequest = null;
                document.getElementById('cv_rules')?.remove();
                document.getElementById('cv_audit_dialog')?.remove();
            });
        }
        const current = session?.capture();
        requireCurrent(current);
        return current;
    }
    const safe = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const input = id => document.getElementById(id)?.value || '';
    const checked = id => document.getElementById(id)?.checked === true;
    const amount = value => value == null ? 'Not payable' : `${safe(value)} GHS`;
    async function call(data, current = captureSession()) {
        requireCurrent(current);
        if (!firebase.auth().currentUser) throw new Error('Sign in is required');
        const response = await firebase.app().functions('us-central1').httpsCallable('commissionV2')(data);
        requireCurrent(current);
        return response.data;
    }
    async function refresh() {
        const current = captureSession();
        const uid = firebase.auth().currentUser?.uid;
        if (config?.actorUid !== uid) config = null;
        if (refreshRequest?.uid === uid && refreshRequest.current()) return refreshRequest.promise;
        const request = { uid, current };
        refreshRequest = request;
        request.promise = (async () => {
            try {
                const next = await call({ action: 'config' }, current);
                requireCurrent(current);
                if (!uid || firebase.auth().currentUser?.uid !== uid || next.actorUid !== uid || refreshRequest !== request) throw new Error('Commission identity changed. Reload the view.');
                config = next;
                return config;
            } catch (error) {
                if (current() && refreshRequest === request) config = null;
                if (firebase.auth().currentUser?.uid !== uid) throw new Error('Commission identity changed. Reload the view.');
                throw error;
            } finally {
                if (current() && refreshRequest === request) refreshRequest = null;
            }
        })();
        return request.promise;
    }
    function canManage(uid) { return root.ThurayaSessionResources?.active() === true && !!uid && config?.actorUid === uid && firebase.auth().currentUser?.uid === uid && config?.capabilities?.legacyAdmin === true; }
    async function allowLegacyEstimate() { try { const current = captureSession(); const result = await refresh(); requireCurrent(current); return !result.persons.length; } catch (_) { return false; } }
    async function legacySetting(key) {
        const current = captureSession();
        const result = await call({ action: 'legacySettings' }, current);
        requireCurrent(current);
        const setting = result.settings.find(s => s.id === key);
        return { exists: !!setting, data: () => setting };
    }
    async function command(payload) {
        const current = captureSession();
        const requireCurrent = () => { if (!current?.()) throw new Error('Commission session changed. Reload the view.'); };
        requireCurrent();
        if (mutationBusy?.()) throw new Error('A commission request is already in progress');
        mutationBusy = current;
        try {
            const c = config?.actorUid === firebase.auth().currentUser?.uid ? config : await refresh();
            requireCurrent();
            const data = { ...payload, expectedRevision: payload.expectedRevision ?? c.revision, requestId: payload.requestId || crypto.randomUUID() };
            if (data.backdateConfirmed && !['correctEnrollment', 'voidEnrollment'].includes(data.action) && !data.impactFingerprint) {
                const impact = await call({ action: 'impact', proposal: data });
                requireCurrent();
                if (impact.required) {
                    if (!confirm(`Historical commission review: ${impact.start} through ${impact.until} (exclusive). ${impact.candidateJobCount} source jobs in the bounded review; ${impact.currentDays.length} existing person/day results; ${impact.lockedDays} locked days remain protected. Unlocked reporting may change. Confirm owner approval?`)) throw new Error('Historical change cancelled');
                    data.impactFingerprint = impact.fingerprint;
                }
            }
            requireCurrent();
            const result = await call(data);
            requireCurrent();
            await refresh(); requireCurrent(); return result;
        } finally { if (mutationBusy === current) mutationBusy = null; }
    }
    async function report(start, end, roleFilter = 'all', personId = null) {
        const current = captureSession();
        const result = await call({ action: 'report', start, end, roleFilter: personId ? 'tech' : roleFilter, personId }, current);
        requireCurrent(current);
        return result;
    }
    function dailyRows(report) {
        return report.target.rows.map(r => ({ ...r, model: engine.TYPE, dateString: r.businessDate, roleKey: 'tech', roleName: 'Technician', staffName: r.technician, staffEmail: '', baseValue: r.eligibleRevenue, commissionAmount: r.dailyPayable, ruleId: r.rule?.id || '', source: 'Active_Jobs', jobId: r.contributions.map(c => c.jobId).join(';'), appliesTo: engine.TYPE }));
    }
    function sourceJobCount(rows) {
        return new Set(rows.flatMap(r => r.model === engine.TYPE || r.businessDate ? (r.contributions || []).map(c => `Active_Jobs:${c.jobId}`) : r.jobId ? [`${r.source}:${r.jobId}`] : [])).size;
    }
    let auditListeners = false;
    function renderDays(rows) {
        view.installStyles(document);
        if (!auditListeners && document.addEventListener) {
            auditListeners = true;
            document.addEventListener('click', event => {
                const button = event.target.closest?.('[data-audit-review]');
                if (button && root.ThurayaSessionResources?.active()) {
                    const current = captureSession();
                    openAuditReview(button.dataset.personId, button.dataset.businessDate).catch(error => { if (current()) alert(view.friendly(error)); });
                }
            });
            document.addEventListener('change', event => {
                if (!event.target.matches?.('.cv-audit-filter')) return;
                const section = event.target.closest('.cv-daily');
                section.querySelectorAll('.cv-day').forEach(day => { day.hidden = event.target.value !== 'all' && day.dataset.auditState !== event.target.value; });
            });
        }
        return view.renderDays(rows, { canReview: config?.capabilities?.auditExceptions === true && config.actorUid === firebase.auth().currentUser?.uid });
    }
    async function openAuditReview(personId, businessDate) {
        const session = captureSession(), request = {};
        auditRequest = request;
        const current = () => session() && auditRequest === request;
        try {
        await refresh();
        if (!current()) return;
        if (!config.capabilities.auditExceptions) throw new Error('Owner approval access is required.');
        document.getElementById('cv_audit_dialog')?.remove();
        const review = await call({ action: 'materialityPreview', personId, businessDate }, current);
        if (!current()) return;
        const p = review.proof, a = review.disposition;
        const dialog = document.createElement('dialog'); dialog.id = 'cv_audit_dialog'; dialog.setAttribute('aria-labelledby', 'cv_audit_title');
        dialog.innerHTML = `<form><h3 id="cv_audit_title">Commission Audit Review</h3><p><strong>${safe(review.row.technician)}</strong> | ${safe(view.date(businessDate))}</p><p>Historical evidence remains unresolved. This approval certifies only zero Commission impact.</p><dl><dt>Accepted revenue</dt><dd>${amount(p.acceptedRevenue)}</dd><dt>Blocked revenue ceiling</dt><dd>${p.blockedRevenueCeiling == null ? 'Not proven' : amount(p.blockedRevenueCeiling)}</dd><dt>Daily target</dt><dd>${amount(p.target)}</dd><dt>Maximum Commission change</dt><dd>${p.eligible ? '0.00 GHS' : 'Not proven to be zero'}</dd></dl><p>${p.eligible ? 'Zero-impact proof passes. Separate owner approval is required.' : 'Approval is not permitted: ' + safe(p.reason)}</p><details><summary>Original audit reasons</summary>${review.row.pending.map(r => `<p>${safe(r.reason)} | ${safe(r.jobId)}</p>`).join('')}</details><details><summary>Approval history (${review.events.length})</summary>${review.events.map(e => `<p>${safe(e.createdAt)} | ${safe(e.state)} | ${safe(e.reason)}</p>`).join('')}</details><label for="cv_audit_action">Decision</label><select id="cv_audit_action"><option value="approveImmaterialException" ${!p.eligible || a.valid || review.row.locked ? 'disabled' : ''}>Approve zero-impact audit exception</option>${review.events.length ? '<option value="revokeImmaterialException">Revoke approval</option><option value="reviewImmaterialException">Record evidence review</option>' : ''}</select><label for="cv_audit_reason">Owner reason / evidence reference</label><textarea id="cv_audit_reason" required maxlength="2000" rows="3"></textarea><label><input id="cv_audit_confirm" type="checkbox" required> I confirm this decision; the financial audit remains open.</label><p role="status" id="cv_audit_message"></p><div class="com-actions"><button type="button" class="com-btn" id="cv_audit_cancel">Cancel</button><button type="submit" class="com-btn primary" id="cv_audit_save" ${!p.eligible && !review.events.length ? 'disabled' : ''}>Save Decision</button></div></form>`;
        document.body.append(dialog); dialog.showModal();
        const select = dialog.querySelector('select'); if (select.selectedOptions[0]?.disabled) select.value = review.events.length ? 'reviewImmaterialException' : '';
        const close = () => { if (auditRequest === request) auditRequest = null; dialog.remove(); };
        dialog.querySelector('#cv_audit_cancel').onclick = () => { dialog.close(); close(); };
        dialog.addEventListener('close', close);
        dialog.querySelector('form').onsubmit = async event => {
            event.preventDefault(); if (!current()) return; const button = dialog.querySelector('#cv_audit_save'); button.disabled = true;
            try {
                await command({ action: select.value, personId, businessDate, expectedRevision: review.revision, proofFingerprint: p.proofFingerprint, ruleId: p.ruleId, approvalReason: dialog.querySelector('textarea').value, confirmed: dialog.querySelector('#cv_audit_confirm').checked });
                if (!current()) return;
                dialog.close(); dialog.remove();
                if (root.com_loadDashboard) await root.com_loadDashboard();
            } catch (error) { if (current()) dialog.querySelector('#cv_audit_message').textContent = view.friendly(error); }
        };
        } catch (error) { if (current()) throw error; }
    }
    function summary(rows) {
        const s = engine.summarizeCommissionPeriod(rows);
        const approved = rows.filter(r => r.auditDisposition?.valid).length;
        const stale = rows.filter(r => ['STALE', 'INVALIDATED'].includes(r.auditDisposition?.state)).length;
        return `<div class="com-note"><strong>Complete daily awards: ${amount(s.completeCommission)}</strong> | Pending days: ${s.pendingDays} | Not configured: ${s.notConfiguredDays}${s.complete ? '' : ' | Incomplete entitlement'}${approved ? ` | Audit open, zero impact approved: ${approved}` : ''}${stale ? ` | Audit approvals stale: ${stale}` : ''}</div>`;
    }
    function renderPeople(rows) {
        const people = new Map();
        for (const row of rows) { if (!people.has(row.personId)) people.set(row.personId, []); people.get(row.personId).push(row); }
        return `<div class="com-table-wrap cv-people"><table class="com-table"><thead><tr><th>Technician</th><th>Days</th><th>Eligible Revenue</th><th>Complete Awards</th><th>Status</th></tr></thead><tbody>${[...people.values()].map(days => {
            const total = engine.summarizeCommissionPeriod(days);
            const revenue = days.reduce((n, r) => n.plus(r.eligibleRevenue), engine.money('0'));
            const approved = days.filter(r => r.auditDisposition?.valid).length, stale = days.filter(r => ['STALE', 'INVALIDATED'].includes(r.auditDisposition?.state)).length;
            return `<tr><td data-label="Technician">${safe(days[0].technician)}</td><td data-label="Days">${days.length}</td><td data-label="Eligible Revenue">${amount(revenue.toString())}</td><td data-label="Complete Awards">${amount(total.completeCommission)}</td><td data-label="Status">${total.complete ? 'Complete' : `${total.pendingDays} pending; ${total.notConfiguredDays} not configured`}${approved ? `<br>${approved} audit open, zero impact approved` : ''}${stale ? `<br>${stale} audit approvals stale` : ''}</td></tr>`;
        }).join('')}</tbody></table></div>`;
    }
    function csvRows(rows) {
        const fields = ['Business Date', 'Person ID', 'Staff', 'Source', 'Job IDs', 'Model', 'Status', 'Eligible Revenue', 'Pending Revenue', 'Unknown Pending Amount', 'Daily Target', 'Excess', 'Rate', 'Commission', 'Rule ID', 'Effective From', 'Exclusive Until', 'Audit Disposition', 'Approval Valid', 'Maximum Commission Delta', 'Commission Finalization Eligible'];
        const escape = v => '"' + String(v == null ? '' : v).replace(/^[=+@\-\t\r]/, "'$&").replace(/"/g, '""') + '"';
        const data = rows.map(r => [r.businessDate || r.dateString, r.personId, r.technician || r.staffName, r.source, r.jobId || r.contributions?.map(c => c.jobId).join(';'), r.model || r.commissionType, r.status, r.eligibleRevenue ?? r.baseValue, r.pendingRevenueKnown, r.pendingAmountUnknown, r.dailyTarget, r.excess, r.commissionRate, r.dailyPayable !== undefined ? r.dailyPayable : r.commissionAmount, r.rule?.id || r.ruleId, r.rule?.effectiveFrom, r.rule?.effectiveUntil]);
        data.forEach((values, i) => values.push(rows[i].auditDisposition ? view.auditStatus(rows[i]) : '', rows[i].auditDisposition?.valid ?? '', rows[i].auditDisposition?.maximumCommissionDelta ?? '', rows[i].finalizationEligible ?? ''));
        return [fields, ...data].map(row => row.map(escape).join(',')).join('\r\n');
    }
    function exportRows(rows, name = 'thuraya-commissions') {
        if (!rows.length) return alert('Load a commission report first.');
        const url = URL.createObjectURL(new Blob([csvRows(rows)], { type: 'text/csv;charset=utf-8;' }));
        const a = document.createElement('a'); a.href = url; a.download = `${name}-${engine.today()}.csv`; a.click(); URL.revokeObjectURL(url);
    }
    async function mountRules(container) {
        const session = captureSession(), request = {};
        rulesRequest = request;
        const current = () => session() && rulesRequest === request;
        const run = fn => runOwned(fn, current);
        const preview = previewRunner(current);
        view.installStyles(document);
        let panel = document.getElementById('cv_rules');
        if (!panel) { panel = document.createElement('section'); panel.id = 'cv_rules'; container.prepend(panel); }
        panel.innerHTML = '<p>Loading technician rules...</p>';
        try {
            await refresh();
            if (!current()) return;
            if (!config.manager) { panel.innerHTML = '<p>Verified Admin/Manager role required.</p>'; return; }
            const options = await call({ action: 'staffOptions' }, current);
            if (!current()) return;
            staff = options.staff;
            panel.innerHTML = `<h3>Technician Daily Target Commission Rules</h3>
                <p id="cv_targetPolicy" class="com-note">Commission is calculated only on eligible daily revenue above the configured daily target.</p>
                <div id="cv_message" role="status" aria-live="polite"></div>
                ${!config.enabled ? `<button class="com-btn" id="cv_enable" ${config.capabilities.enableTarget ? '' : 'disabled'}>Enable Target Configuration</button>` : ''}
                <fieldset id="cv_targetFields" ${config.capabilities.targetAdmin ? '' : 'disabled'} style="border:0;padding:0;min-width:0">
                <details id="cv_enrollment" ${config.persons.length ? '' : 'open'}><summary>Enroll Technician / Identity Binding</summary><ol class="cv-steps"><li>Select Staff</li><li>Confirm Identity</li><li>Set Effective Date</li><li>Review Impact</li><li>Confirm</li><li>Enroll</li></ol><div class="com-filter-bar">
                <div class="form-group"><label for="cv_bindingPerson">Identity Action</label><select id="cv_bindingPerson"><option value="">Enroll New Person</option>${config.persons.map(p => `<option value="${safe(p.personId)}">Add Binding: ${safe(p.displayName)}</option>`).join('')}</select></div>
                <div class="form-group"><label for="cv_staff">Staff Profile</label><select id="cv_staff"><option value="">Select staff</option>${staff.map(s => `<option value="${safe(s.id)}">${safe(s.name)} (${safe(s.email)})</option>`).join('')}</select></div>
                <div class="form-group"><label for="cv_name">Person Display Name</label><input id="cv_name"></div>
                <div class="form-group"><label for="cv_email">Station Email</label><input id="cv_email" type="email"></div>
                <div class="form-group"><label for="cv_aliases">Confirmed Aliases (comma-separated)</label><input id="cv_aliases"></div>
                <div class="form-group"><label for="cv_excluded">Excluded Aliases</label><input id="cv_excluded"></div>
                <div class="form-group"><label for="cv_identityFrom">Identity / Enrollment From</label><input id="cv_identityFrom" type="date"></div>
                <div class="form-group"><label for="cv_identityUntil">Identity Until (exclusive)</label><input id="cv_identityUntil" type="date"></div>
                <div class="form-group"><label for="cv_uid">Confirmed Login UID</label><input id="cv_uid"></div></div>
                <label><input id="cv_confirmIdentity" type="checkbox"> Owner-confirmed person, station, aliases and login</label><br>
                <div class="form-group"><label for="cv_identityNotes">Enrollment Approval Reason / Reference</label><textarea id="cv_identityNotes" rows="2"></textarea></div>
                <label><input id="cv_identityBackdate" type="checkbox"> Owner-approved enrollment backdating</label><br>
                <div class="com-actions"><button type="button" id="cv_enroll_preview" class="com-btn">Review Enrollment Impact</button></div><div id="cv_enroll_review" aria-live="polite"></div><label><input id="cv_enroll_final" type="checkbox" disabled> I approve the reviewed enrollment and historical impact</label><button type="button" id="cv_enroll" class="com-btn primary" disabled>Enroll Technician</button></details>
                <form id="cv_form"><label id="cv_full_period_label"><input id="cv_full_period" type="checkbox" checked> Apply to full enrollment period</label><div class="com-filter-bar">
                <div class="form-group"><label for="cv_person">Enrolled Technician</label><select id="cv_person"><option value="">Select enrolled technician</option>${config.persons.map(p => `<option value="${safe(p.personId)}">${safe(p.displayName)}</option>`).join('')}</select></div>
                <div class="form-group"><label for="cv_type">Rule Type</label><select id="cv_type"><option value="DAILY_TARGET_MARGINAL">Daily Target - Marginal</option></select></div>
                <div class="form-group"><label for="cv_target">Daily Target (GHS)</label><input id="cv_target" type="number" min="0" step="0.01" aria-describedby="cv_targetPolicy" required></div>
                <div class="form-group"><label for="cv_rate">Rate (%)</label><input id="cv_rate" type="number" min="0" max="100" step="0.01" required></div>
                <div class="form-group"><label for="cv_from">Effective From (inclusive)</label><input id="cv_from" type="date"></div>
                <div class="form-group"><label for="cv_until">Effective Until (optional, exclusive)</label><input id="cv_until" type="date"></div>
                <div class="form-group"><label for="cv_status">Publication</label><select id="cv_status"><option value="DRAFT">Draft</option><option value="PUBLISHED">Published</option></select></div>
                <div class="form-group"><label for="cv_tax">Tax Policy</label><input id="cv_tax" readonly value="Exclude tax"></div></div>
                <div class="form-group"><label for="cv_notes">Notes / Approval Reference</label><textarea id="cv_notes" rows="2"></textarea></div>
                <label><input id="cv_backdate" type="checkbox"> Owner-approved backdating of unlocked periods</label>
                <div id="cv_ruleReview" class="cv-review" aria-live="polite"></div><div id="cv_gapWarning" class="cv-warning" hidden><p>The initial rule leaves part of enrollment without Commission coverage.</p><label><input type="checkbox" id="cv_gap_confirm"> I intentionally approve the uncovered enrollment period</label></div><div class="com-actions"><button type="submit" id="cv_save" class="com-btn primary">Save Rule</button><button type="button" id="cv_clear" class="com-btn">Clear</button></div></form>
                <div id="cv_history"></div><div id="cv_bindings"></div><section id="cv_correction" hidden></section><section id="cv_void" hidden></section><div id="cv_enrollmentHistory"></div></fieldset><hr>`;
            const style = document.createElement('style'); style.textContent = '#cv_rules{margin-bottom:24px}#cv_rules input,#cv_rules select,#cv_rules textarea{max-width:100%;box-sizing:border-box}#cv_rules .form-group{min-width:170px;flex:1}#cv_rules details{margin:12px 0}#cv_message{min-height:24px;color:var(--error)}#cv_rules .com-actions{flex-wrap:wrap}'; panel.append(style);
            document.getElementById('cv_enable')?.addEventListener('click', () => run(async () => {
                if (!confirm('Enable target-rule configuration under separate owner authorization? No technician rules will be created.')) return;
                await command({ action: 'enable', activationConfirmed: true, notes: 'Operator-confirmed owner authorization for target configuration' });
                await reloadRules(container, current);
            }));
            let enrollmentProposal = null, enrollmentImpact = null, enrollmentEpoch = 0;
            const invalidateEnrollment = event => {
                if (!current()) return;
                if (event?.target?.id === 'cv_enroll_final') { document.getElementById('cv_enroll').disabled = !enrollmentProposal || !checked('cv_enroll_final'); return; }
                enrollmentEpoch++; enrollmentProposal = null; enrollmentImpact = null;
                document.getElementById('cv_enroll').disabled = true;
                document.getElementById('cv_enroll_final').disabled = true;
                document.getElementById('cv_enroll_final').checked = false;
                document.getElementById('cv_enroll_review').textContent = '';
            };
            document.getElementById('cv_enrollment').addEventListener('input', invalidateEnrollment);
            document.getElementById('cv_enrollment').addEventListener('change', invalidateEnrollment);
            document.getElementById('cv_staff').addEventListener('change', () => {
                if (!current()) return;
                const s = staff.find(x => x.id === input('cv_staff')); if (!s) return;
                set('cv_name', s.name); set('cv_email', s.email); set('cv_uid', s.uid || ''); set('cv_aliases', s.name);
                set('cv_excluded', ''); document.getElementById('cv_confirmIdentity').checked = false; invalidateEnrollment();
            });
            document.getElementById('cv_enroll_preview').addEventListener('click', () => preview(async current => {
                if (!input('cv_staff')) throw new Error('Select a Staff profile.');
                if (!input('cv_email').trim()) throw new Error('Station Email is required for this technician.');
                if (!list('cv_aliases').length) throw new Error('Confirmed Alias is required for this technician.');
                if (!checked('cv_confirmIdentity')) throw new Error('Confirm the current technician, station and aliases before reviewing.');
                if (!engine.date(input('cv_identityFrom'))) throw new Error('Enter the identity effective date.');
                if (!input('cv_identityNotes').trim()) throw new Error('Enter an enrollment approval reason/reference.');
                const proposal = { action: input('cv_bindingPerson') ? 'saveBinding' : 'enrollPerson', requestId: crypto.randomUUID(), expectedRevision: config.revision,
                    personId: input('cv_bindingPerson') || crypto.randomUUID(), displayName: input('cv_name'), staffRef: input('cv_staff'), enrollmentFrom: input('cv_identityFrom'), accessUid: input('cv_uid'), identityConfirmed: checked('cv_confirmIdentity'),
                    binding: { stationEmail: input('cv_email'), aliases: list('cv_aliases'), excludedAliases: list('cv_excluded'), effectiveFrom: input('cv_identityFrom'), effectiveUntil: input('cv_identityUntil') || null },
                    notes: input('cv_identityNotes'), backdateConfirmed: checked('cv_identityBackdate') };
                const epoch = enrollmentEpoch, reviewed = await call({ action: 'impact', proposal }, current);
                if (!current() || epoch !== enrollmentEpoch) return;
                enrollmentProposal = proposal; enrollmentImpact = reviewed;
                document.getElementById('cv_enroll_review').innerHTML = `<h4>Enrollment Review</h4><p><strong>${safe(proposal.displayName)}</strong><br>${safe(view.date(proposal.enrollmentFrom))} to ${safe(view.date(proposal.binding.effectiveUntil))} (end exclusive)</p><p>Confirmed: ${safe(proposal.binding.aliases.join(', '))}<br>Excluded: ${safe(proposal.binding.excludedAliases.join(', ') || 'None')}</p><p>Historical source jobs: ${safe(reviewed.candidateJobCount || 0)}. Unlocked reporting may be reinterpreted. No payout is recalculated by enrollment.</p>`;
                document.getElementById('cv_enroll_final').disabled = false;
            }));
            document.getElementById('cv_enroll').addEventListener('click', () => run(async () => {
                if (!enrollmentProposal || !checked('cv_enroll_final')) throw new Error('Review enrollment impact and confirm before enrolling.');
                document.getElementById('cv_enroll').disabled = true;
                try { await command({ ...enrollmentProposal, ...(enrollmentImpact.required ? { impactFingerprint: enrollmentImpact.fingerprint } : {}) }); await reloadRules(container, current); }
                catch (error) { invalidateEnrollment(); throw error; }
            }));

            document.getElementById('cv_bindingPerson').addEventListener('change', () => { if (!current()) return; document.getElementById('cv_enroll').textContent = input('cv_bindingPerson') ? 'Add Identity Binding' : 'Enroll Technician'; });
            let ruleSaving = false;
            document.getElementById('cv_form').addEventListener('submit', event => { event.preventDefault(); if (!current() || ruleSaving) return; run(async () => {
                const selected = config.persons.find(p => p.personId === input('cv_person'));
                if (!selected) throw new Error('Select an enrolled technician.');
                const gap = ruleReview();
                if (gap && !checked('cv_gap_confirm')) throw new Error('Confirm the uncovered enrollment period or apply the full enrollment period.');
                if (input('cv_status') === 'PUBLISHED' && !confirm(document.getElementById('cv_ruleReview').textContent + '\nPublish this effective-dated rule?')) return;
                ruleSaving = true; document.getElementById('cv_save').disabled = true;
                let completion = current;
                try { await command({ action, personId: input('cv_person'), ruleId: editRuleId, coverageGapConfirmed: gap && checked('cv_gap_confirm'), rule: { ruleType: input('cv_type'), dailyTarget: input('cv_target'), commissionRate: engine.money(input('cv_rate')).div(100).toString(), effectiveFrom: input('cv_from'), effectiveUntil: input('cv_until') || null, status: input('cv_status') }, notes: input('cv_notes'), backdateConfirmed: checked('cv_backdate') });
                if (!current()) return;
                editRuleId = null; action = 'saveRule'; completion = await reloadRules(container, current, 'Rule saved.');
                } finally { ruleSaving = false; if (completion?.()) { const button = document.getElementById('cv_save'); if (button) button.disabled = false; } }
            }); });
            document.getElementById('cv_person').addEventListener('change', () => { if (current() && !editRuleId) applyEnrollmentPeriod(); });
            document.getElementById('cv_full_period').addEventListener('change', () => { if (current() && checked('cv_full_period')) applyEnrollmentPeriod(); });
            document.getElementById('cv_form').addEventListener('input', event => { if (!current()) return; if (['cv_from', 'cv_until'].includes(event.target.id)) document.getElementById('cv_full_period').checked = false; if (event.target.id !== 'cv_gap_confirm') document.getElementById('cv_gap_confirm').checked = false; ruleReview(); });
            document.getElementById('cv_clear').addEventListener('click', () => { if (!current()) return; editRuleId = null; action = 'saveRule'; document.getElementById('cv_form').reset(); document.getElementById('cv_person').disabled = false; document.getElementById('cv_save').textContent = 'Save Rule'; ruleReview(); });
            renderHistory(container, current);
            const bindings = document.getElementById('cv_bindings');
            bindings.innerHTML = `<h4>Current Enrollments</h4>${config.persons.map(p => {
                const all = config.bindings.filter(b => b.personId === p.personId).sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom));
                const b = all.find(b => engine.contains(b, engine.today())) || all[0], period = view.initialPeriod(p, all);
                const status = period.effectiveFrom > engine.today() ? 'SCHEDULED' : period.effectiveUntil && period.effectiveUntil <= engine.today() ? 'CLOSED' : 'ACTIVE';
                return `<article class="cv-enrollment-row" data-enrolled-person="${safe(p.personId)}"><div><strong>${safe(p.displayName)}</strong><details><summary>Station and aliases</summary>${all.map(b => `<p>${safe(b.stationEmail)}<br>Confirmed: ${safe(b.aliases.join(', '))}<br>Excluded: ${safe((b.excludedAliases || []).join(', ') || 'None')}</p>`).join('')}</details></div><div>${safe(view.date(period.effectiveFrom))}<br>to ${safe(view.date(period.effectiveUntil))} (end exclusive)</div><strong>${status}</strong><div class="com-actions">${b && config.capabilities.correctEnrollment ? `<button type="button" class="com-small-btn" data-correct="${safe(b.id)}">Correct Enrollment</button><button type="button" class="com-small-btn" data-binding="${safe(b.id)}">Close Enrollment</button>` : ''}${config.capabilities.voidEnrollment ? `<button type="button" class="com-small-btn" data-void="${safe(p.personId)}">Void Enrollment</button>` : ''}</div></article>`;
            }).join('') || '<p>No current enrollments.</p>'}`;

            bindings.querySelectorAll('[data-correct]').forEach(button => button.addEventListener('click', () => {
                if (!current()) return;
                const binding = config.bindings.find(b => b.id === button.dataset.correct);
                openEnrollmentCorrection(container, config.persons.find(p => p.personId === binding.personId), binding, current);
            }));
            renderEnrollmentHistory();
            bindings.querySelectorAll('[data-void]').forEach(button => button.addEventListener('click', () => { if (current()) openVoid(container, config.persons.find(p => p.personId === button.dataset.void), current); }));
            bindings.querySelectorAll('[data-binding]').forEach(button => button.addEventListener('click', () => run(async () => {
                const b = config.bindings.find(x => x.id === button.dataset.binding);
                const until = prompt('Identity exclusive end date (YYYY-MM-DD):', b.effectiveUntil || ''); if (!until) return;
                await command({ action: 'closeBinding', personId: b.personId, bindingId: b.id, effectiveUntil: until, notes: input('cv_notes'), backdateConfirmed: checked('cv_backdate') });
                await reloadRules(container, current);
            })));
            return current;
        } catch (e) { if (current()) panel.innerHTML = `<p role="alert">${safe(view.friendly(e))}</p>`; }
    }
    const list = key => input(key).split(',').map(s => s.trim()).filter(Boolean);
    const set = (key, value) => { const el = document.getElementById(key); if (el) el.value = value; };
    const message = text => { const el = document.getElementById('cv_message'); if (el) el.textContent = text; };
    async function runOwned(fn, current) { if (!current()) return; message('Working...'); try { await fn(); if (current() && document.getElementById('cv_message')?.textContent === 'Working...') message(''); } catch (e) { if (!current()) return; const el = document.getElementById('cv_message'); if (el) el.innerHTML = `<p>${safe(view.friendly(e))}</p><details><summary>Diagnostic details</summary><code>${safe(e.message)}</code></details>`; } }
    function previewRunner(current) {
        let latest = null;
        return fn => {
            const request = {}; latest = request;
            const owned = () => current() && latest === request;
            return runOwned(() => fn(owned), owned);
        };
    }
    async function reloadRules(container, current, notice) {
        if (!current()) return;
        const rendered = await mountRules(container);
        if (notice && rendered?.()) message(notice);
        return rendered;
    }
    function applyEnrollmentPeriod() {
        const p = config.persons.find(p => p.personId === input('cv_person'));
        if (!p) return;
        const published = config.rules.some(r => r.technicianPersonId === p.personId && r.status === 'PUBLISHED');
        document.getElementById('cv_full_period_label').hidden = published || action === 'successor';
        if (!published && action !== 'successor') {
            const range = view.initialPeriod(p, config.bindings);
            set('cv_from', range.effectiveFrom); set('cv_until', range.effectiveUntil || '');
            document.getElementById('cv_full_period').checked = true;
        }
        ruleReview();
    }
    function ruleReview() {
        const p = config.persons.find(p => p.personId === input('cv_person'));
        const out = document.getElementById('cv_ruleReview'), warning = document.getElementById('cv_gapWarning');
        if (!p) { out.textContent = ''; warning.hidden = true; return false; }
        const period = view.initialPeriod(p, config.bindings);
        const first = !config.rules.some(r => r.technicianPersonId === p.personId && r.status === 'PUBLISHED');
        const gap = first && !!input('cv_from') && (input('cv_from') !== period.effectiveFrom || (input('cv_until') || null) !== period.effectiveUntil);
        warning.hidden = !gap;
        document.getElementById('cv_full_period_label').hidden = !first || action === 'successor';
        const fmt = value => value && engine.date(value) ? view.date(value) : value ? 'Invalid date' : 'Open-ended';
        out.innerHTML = `<h4>Rule Review</h4><p><strong>${safe(p.displayName)}</strong><br>Effective: ${safe(fmt(input('cv_from')))} to ${safe(fmt(input('cv_until')))} (end exclusive)<br>Daily Target: ${safe(input('cv_target') || '-')} GHS<br>Commission: ${safe(input('cv_rate') || '-')}% of eligible daily revenue above the daily target<br>Tax: Excluded<br>Status: ${safe(input('cv_status'))}</p>${action === 'successor' ? '<p>Publishing closes the predecessor at this start date and preserves its history.</p>' : ''}`;
        return gap;
    }
    function renderEnrollmentHistory() {
        const out = document.getElementById('cv_enrollmentHistory'); if (!out) return;
        const people = config.persons.concat(config.archivedPersons || []);
        const rows = (config.enrollmentHistory || []).slice().sort((a, b) => String(b.confirmedAt || b.createdAt).localeCompare(String(a.confirmedAt || a.createdAt)));
        const actor = uid => config.actorNames?.[uid] || 'Staff member (see audit details)';
        out.innerHTML = `<h4>Enrollment Change History</h4>${rows.length ? rows.map(r => {
            const p = people.find(p => p.personId === r.personId), values = r.newValues || {}, binding = values.binding || {};
            const label = r.action === 'voidEnrollment' ? 'VOIDED' : r.authoritative ? 'Current' : 'Superseded';
            return `<article class="cv-history-row"><div><strong>${safe(values.displayName || p?.displayName)}</strong><p>${safe(view.actions[r.action] || 'Enrollment updated')}</p></div><div>${safe(view.date(binding.effectiveFrom || values.enrollmentFrom))}<br>to ${safe(view.date(binding.effectiveUntil))}<p>${label}</p></div><div>${safe(r.confirmedAt || r.createdAt ? view.date(r.confirmedAt || r.createdAt) : 'Not recorded')}<br>${safe(actor(r.confirmedBy || r.createdBy))}</div><div>${safe(r.approvalReason || 'Not recorded in original revision')}<details><summary>View audit details</summary><pre>${safe(JSON.stringify(r, null, 2))}</pre></details></div></article>`;
        }).join('') : '<p>No enrollment changes recorded.</p>'}`;
        const history = config.bindingHistory || [];
        if (history.length) out.innerHTML += `<details><summary>All identity binding revisions</summary>${history.map(b => `<p>${safe(people.find(p => p.personId === b.personId)?.displayName)}: ${safe(view.date(b.effectiveFrom))} to ${safe(view.date(b.effectiveUntil))}, ${b.authoritative ? 'Current' : 'Superseded'}<br>Excluded: ${safe((b.excludedAliases || []).join(', '))}</p><details><summary>View audit details</summary><pre>${safe(JSON.stringify(b, null, 2))}</pre></details>`).join('')}</details>`;
    }
    function openVoid(container, person, owner = captureSession()) {
        if (!owner()) return;
        if (!person || !config.capabilities.voidEnrollment) return;
        const out = document.getElementById('cv_void'); out.hidden = false;
        out.innerHTML = `<h4>Void Enrollment: ${safe(person.displayName)}</h4><p class="cv-warning">Void means this enrollment should never have existed. Audit history is retained. Source activity, rules or protected evidence block this action.</p><form id="cv_void_form"><label for="cv_void_reason">Approval Reason / Reference</label><textarea id="cv_void_reason" rows="3" required maxlength="2000"></textarea><div class="com-actions"><button type="button" id="cv_void_preview" class="com-btn">Preview Void Impact</button><button type="button" id="cv_void_cancel" class="com-btn">Cancel</button></div><div id="cv_void_impact" aria-live="polite"></div><label><input id="cv_void_confirm" type="checkbox" disabled> I confirm this enrollment should never have existed</label><button type="submit" id="cv_void_save" class="com-btn" disabled>Confirm Void Enrollment</button></form>`;
        const form = document.getElementById('cv_void_form');
        let closed = false;
        const current = () => owner() && !closed && document.getElementById('cv_void_form') === form;
        const run = fn => runOwned(fn, current);
        const preview = previewRunner(current);
        let proposal = null, review = null, epoch = 0, busy = false;
        const invalidate = event => {
            if (!current()) return;
            if (event?.target?.id === 'cv_void_confirm') { document.getElementById('cv_void_save').disabled = !review || review.blocked || !checked('cv_void_confirm') || busy; return; }
            epoch++; proposal = null; review = null; document.getElementById('cv_void_confirm').checked = false; document.getElementById('cv_void_confirm').disabled = true; document.getElementById('cv_void_save').disabled = true; document.getElementById('cv_void_impact').textContent = '';
        };
        document.getElementById('cv_void_form').addEventListener('input', invalidate);
        document.getElementById('cv_void_form').addEventListener('change', invalidate);
        document.getElementById('cv_void_cancel').addEventListener('click', () => { if (!current()) return; closed = true; epoch++; out.hidden = true; out.innerHTML = ''; });
        document.getElementById('cv_void_preview').addEventListener('click', () => preview(async current => {
            const version = epoch, data = { action: 'voidEnrollment', personId: person.personId, requestId: crypto.randomUUID(), expectedRevision: config.revision, expectedEnrollmentRevision: person.enrollmentRevision || 1, approvalReason: input('cv_void_reason') };
            const result = await call({ action: 'impact', proposal: data }, current); if (!current() || version !== epoch) return;
            proposal = data; review = result;
            document.getElementById('cv_void_impact').innerHTML = `<p>${result.blocked ? safe(result.blockReason) : 'No consequential dependencies found. This enrollment can be voided with audit history retained.'}</p><p>Source jobs: ${result.candidateJobCount}; rules: ${result.ruleCount}; snapshots: ${result.snapshotCount}; locks: ${result.lockedDays}</p>`;
            document.getElementById('cv_void_confirm').disabled = result.blocked;
        }));
        document.getElementById('cv_void_form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
            if (busy || !proposal || !review || review.blocked || !checked('cv_void_confirm')) throw new Error('A fresh unblocked impact review and explicit Void confirmation are required.');
            busy = true; document.getElementById('cv_void_save').disabled = true;
            try { await command({ ...proposal, impactFingerprint: review.fingerprint, voidConfirmed: true }); await reloadRules(container, current, 'Enrollment voided. Audit history retained.'); }
            catch (error) { busy = false; invalidate(); throw error; }
        }); });
        out.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }

    function openEnrollmentCorrection(container, person, binding, owner = captureSession()) {
        if (!owner()) return;
        if (!person || !binding || !config.capabilities.correctEnrollment) return;
        const out = document.getElementById('cv_correction');
        out.hidden = false;
        const row = (label, current, control) => `<tr><th scope="row">${safe(label)}</th><td style="overflow-wrap:anywhere">${safe(current || 'Not set')}</td><td>${control}</td></tr>`;
        const field = (key, value, type = 'text') => `<input id="cv_edit_${key}" aria-label="Proposed ${safe(key)}" type="${type}" value="${safe(value || '')}" style="width:100%;min-width:150px">`;
        out.innerHTML = `<h4>Correct Enrollment: ${safe(person.displayName)}</h4><details><summary>View audit details</summary><p>Person ID: ${safe(person.personId)} | Enrollment revision ${safe(person.enrollmentRevision || 1)} | Binding revision ${safe(binding.revision || 1)}</p></details>
            <form id="cv_edit_form"><div class="com-table-wrap"><table class="com-table"><thead><tr><th>Field</th><th>Current Value</th><th>Proposed Value</th></tr></thead><tbody>
            ${row('Person Display Name', person.displayName, field('name', person.displayName))}
            ${row('Staff Profile', person.staffRef, `<select id="cv_edit_staff" aria-label="Proposed Staff Profile"><option value="">No Staff profile</option>${staff.map(s => `<option value="${safe(s.id)}" ${s.id === person.staffRef ? 'selected' : ''}>${safe(s.name)} (${safe(s.email)})</option>`).join('')}${person.staffRef && !staff.some(s => s.id === person.staffRef) ? `<option selected value="${safe(person.staffRef)}">${safe(person.staffRef)} (current)</option>` : ''}</select>`)}
            ${row('Station Email', binding.stationEmail, field('email', binding.stationEmail, 'email'))}
            ${row('Staff Identity ID', binding.staffId, field('staffId', binding.staffId))}
            ${row('Confirmed Aliases', (binding.aliases || []).join(', '), field('aliases', (binding.aliases || []).join(', ')))}
            ${row('Excluded Aliases', (binding.excludedAliases || []).join(', '), field('excluded', (binding.excludedAliases || []).join(', ')))}
            ${row('Confirmed Login UIDs', (person.accessUids || []).join(', '), field('uids', (person.accessUids || []).join(', ')))}
            ${row('Identity From (inclusive)', binding.effectiveFrom, field('from', binding.effectiveFrom, 'date'))}
            ${row('Identity Until (optional, exclusive)', binding.effectiveUntil || 'Open-ended', field('until', binding.effectiveUntil, 'date'))}
            ${row('Person Enrollment From', person.enrollmentFrom, '<span id="cv_edit_enrollmentFrom">Determined by authoritative identity coverage</span>')}
            </tbody></table></div><p id="cv_edit_warning" role="status"></p>
            <div class="form-group"><label for="cv_edit_reason">Approval Reason / Reference</label><textarea id="cv_edit_reason" maxlength="2000" rows="3" required></textarea></div>
            <label><input type="checkbox" id="cv_edit_identity"> Owner-confirmed proposed person, station, aliases and login</label><br>
            <label><input type="checkbox" id="cv_edit_backdate"> Owner-approved backdating of unlocked periods</label><br>
            <label><input type="checkbox" id="cv_edit_removeExclusion"> Explicitly approve any removed exclusion</label>
            <div class="com-actions"><button type="button" class="com-btn" id="cv_edit_preview">Preview Impact</button><button type="button" class="com-btn muted" id="cv_edit_cancel">Cancel</button></div>
            <div id="cv_edit_impact" aria-live="polite"></div>
            <label><input type="checkbox" id="cv_edit_final" disabled> I approve the reviewed correction and its impact</label>
            <div class="com-actions"><button type="submit" class="com-btn primary" id="cv_edit_save" disabled>Save Correction</button></div></form>`;
        const form = document.getElementById('cv_edit_form');
        let closed = false;
        const current = () => owner() && !closed && document.getElementById('cv_edit_form') === form;
        const run = fn => runOwned(fn, current);
        const preview = previewRunner(current);
        let proposal = null, review = null, epoch = 0, saving = false;
        const invalidate = event => {
            if (!current()) return;
            if (event?.target?.id === 'cv_edit_final') { document.getElementById('cv_edit_save').disabled = !review || review.blocked || !checked('cv_edit_final') || saving; return; }
            epoch++; proposal = null; review = null;
            document.getElementById('cv_edit_save').disabled = true;
            document.getElementById('cv_edit_final').checked = false;
            document.getElementById('cv_edit_final').disabled = true;
            document.getElementById('cv_edit_impact').textContent = '';
            const from = input('cv_edit_from');
            document.getElementById('cv_edit_warning').textContent = from && from < binding.effectiveFrom ? `BACKDATED CORRECTION: identity start moves from ${binding.effectiveFrom} to ${from}. Unlocked Commission reporting in the newly covered period may be reinterpreted. Locked Commission periods will not be changed.` : '';
        };
        document.getElementById('cv_edit_form').addEventListener('input', invalidate);
        document.getElementById('cv_edit_form').addEventListener('change', invalidate);
        document.getElementById('cv_edit_cancel').addEventListener('click', () => { if (!current()) return; closed = true; epoch++; out.hidden = true; out.innerHTML = ''; });
        document.getElementById('cv_edit_preview').addEventListener('click', () => preview(async current => {
            invalidate(); const version = epoch;
            const data = { action: 'correctEnrollment', requestId: crypto.randomUUID(), expectedRevision: config.revision, personId: person.personId, bindingId: binding.id, expectedBindingRevision: binding.revision || 1, expectedEnrollmentRevision: person.enrollmentRevision || 1,
                proposed: { displayName: input('cv_edit_name'), staffRef: input('cv_edit_staff') || null, accessUids: list('cv_edit_uids'), binding: { stationEmail: input('cv_edit_email'), staffId: input('cv_edit_staffId') || null, aliases: list('cv_edit_aliases'), excludedAliases: list('cv_edit_excluded'), effectiveFrom: input('cv_edit_from'), effectiveUntil: input('cv_edit_until') || null } },
                approvalReason: input('cv_edit_reason'), identityConfirmed: checked('cv_edit_identity'), backdateConfirmed: checked('cv_edit_backdate'), exclusionRemovalConfirmed: checked('cv_edit_removeExclusion') };
            const result = await call({ action: 'impact', proposal: data }, current);
            if (!current() || epoch !== version || !document.getElementById('cv_edit_impact')) return;
            proposal = data; review = result;
            document.getElementById('cv_edit_enrollmentFrom').textContent = result.proposedValues.enrollmentFrom;
            document.getElementById('cv_edit_impact').innerHTML = `<h4>Impact Preview</h4><p><strong>${safe(result.classification)}</strong> | ${safe(result.start || 'No attribution change')} to ${safe(result.until || 'Open-ended')} (end exclusive)</p><p>Candidate Active_Jobs: ${safe(result.candidateJobCount)} | Effective Rules: ${safe(result.effectiveRules.length)} | Locked Periods: ${safe(result.lockedPeriods.length)} | Snapshots: ${safe(result.snapshots.length)}</p><p>Changed: ${safe(result.changes.join(', '))}</p><p>Confirmed aliases: ${safe(result.proposedValues.binding.aliases.join(', '))}<br>Excluded aliases: ${safe(result.proposedValues.binding.excludedAliases.join(', '))}</p><p>${safe(result.interpretation)}</p>${result.blocked ? `<p role="alert">${safe(result.blockReason)}</p>` : ''}<details><summary>Candidate Jobs / Rules / Protected Coverage</summary><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${safe(JSON.stringify({ jobs: result.candidateJobs, rules: result.effectiveRules, locks: result.lockedPeriods, snapshots: result.snapshots }, null, 2))}</pre></details>`;
            document.getElementById('cv_edit_final').disabled = result.blocked;
        }));
        document.getElementById('cv_edit_form').addEventListener('submit', event => { event.preventDefault(); run(async () => {
            if (saving || !proposal || !review || review.blocked || !checked('cv_edit_final')) throw new Error('A fresh impact preview and final confirmation are required');
            saving = true; document.getElementById('cv_edit_save').disabled = true;
            try {
                await command({ ...proposal, impactFingerprint: review.fingerprint, correctionConfirmed: true });
                await reloadRules(container, current, 'Enrollment corrected; prior revision retained.');
            } catch (error) { saving = false; invalidate(); throw error; }
        }); });
        out.scrollIntoView?.({ block: 'start', behavior: 'smooth' });
    }
    function renderHistory(container, current) {
        const run = fn => runOwned(fn, current);
        const rows = config.rules.filter(r => r.schemaVersion === 2);
        const heads = new Set(config.persons.flatMap(p => Object.values(p.ruleHeads || {})).filter(id => rows.some(r => r.id === id && r.status === 'PUBLISHED')));
        const out = document.getElementById('cv_history');
        out.innerHTML = `<h4>Rule History</h4><div class="com-table-wrap"><table class="com-table"><thead><tr><th>Technician</th><th>Target</th><th>Rate</th><th>From</th><th>Until (exclusive)</th><th>Status / Revision</th><th>Actions</th></tr></thead><tbody>${rows.map(r => `<tr><td>${safe(r.technicianDisplayName)}</td><td>${amount(r.dailyTarget)}</td><td>${safe(engine.money(r.commissionRate).times(100).toString())}%</td><td>${safe(r.effectiveFrom)}</td><td>${safe(r.effectiveUntil || 'Open-ended')}</td><td>${safe(r.status)} / ${safe(r.revision)}${r.status === 'PUBLISHED' && !heads.has(r.id) ? ' / Prior revision' : ''}</td><td>${r.status === 'DRAFT' ? `<button class="com-small-btn" data-rule="${safe(r.id)}" data-action="edit">Edit Draft</button>` : ''}${heads.has(r.id) ? `<button class="com-small-btn" data-rule="${safe(r.id)}" data-action="successor">Create Successor</button><button class="com-small-btn" data-rule="${safe(r.id)}" data-action="close">Close Rule</button>` : ''}</td></tr>`).join('')}</tbody></table></div>`;
        for (const r of rows.filter(r => r.status === 'DRAFT' || (heads.has(r.id) && r.status === 'PUBLISHED' && r.effectiveFrom > engine.today()))) {
            const cell = out.querySelector(`[data-rule="${r.id}"]`)?.parentElement; if (!cell) continue;
            const button = document.createElement('button'); button.type = 'button'; button.className = 'com-small-btn'; button.dataset.rule = r.id; button.dataset.action = r.status === 'DRAFT' ? 'cancelDraft' : 'cancelRule'; button.textContent = 'Cancel'; cell.append(button);
        }
        out.querySelectorAll('button[data-rule]').forEach(button => button.addEventListener('click', () => run(async () => {
            const r = rows.find(x => x.id === button.dataset.rule);
            if (['cancelDraft', 'cancelRule'].includes(button.dataset.action)) {
                if (!confirm('Cancel this rule while retaining its history?')) return;
                await command({ action: button.dataset.action, personId: r.technicianPersonId, ruleId: r.id, notes: input('cv_notes') }); await reloadRules(container, current); return;
            }
            if (button.dataset.action === 'close') {
                const until = prompt('Exclusive end date (YYYY-MM-DD):', r.effectiveUntil || ''); if (!until) return;
                await command({ action: 'closeRule', personId: r.technicianPersonId, ruleId: r.id, effectiveUntil: until, notes: input('cv_notes'), backdateConfirmed: checked('cv_backdate') });
                await reloadRules(container, current); return;
            }
            action = button.dataset.action === 'successor' ? 'successor' : 'saveRule'; editRuleId = r.id;
            set('cv_person', r.technicianPersonId); set('cv_target', r.dailyTarget); set('cv_rate', engine.money(r.commissionRate).times(100).toString()); set('cv_from', action === 'successor' ? (r.effectiveUntil || '') : r.effectiveFrom); set('cv_until', action === 'successor' ? '' : r.effectiveUntil || ''); set('cv_status', action === 'successor' ? 'PUBLISHED' : r.status);
            document.getElementById('cv_person').disabled = true;
            ruleReview();
            document.getElementById('cv_save').textContent = action === 'successor' ? 'Close and Publish Successor' : 'Save Rule';
        })));
    }
    async function lock(report, start, end, roleFilter, personId = null) {
        const target = report.target.rows;
        if (target.length && report.rows.length) throw new Error('Select a target technician or a legacy role separately before locking. Mixed models cannot be locked together.');
        if (target.length) return command({ action: 'lock', start, end, personId, fingerprint: report.target.fingerprint, expectedRevision: report.target.revision });
        return command({ action: 'legacyLock', start, end, roleFilter, rowsHash: report.rowsHash });
    }
    root.ThurayaCommissionV2 = Object.freeze({ call, command, refresh, canManage, legacySetting, allowLegacyEstimate, report, dailyRows, sourceJobCount, renderDays, renderPeople, summary, csvRows, exportRows, mountRules, lock });
})(window);
