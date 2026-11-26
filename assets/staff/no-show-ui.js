(function (root) {
    'use strict';
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const key = () => `thuraya.noshow.${root.THURAYA_CONFIG?.projectId}.${firebase.auth().currentUser?.uid}`;
    let dialog, busy = false, active;
    async function call(command, input = {}) {
        const projectId = root.THURAYA_CONFIG?.projectId, uid = firebase.auth().currentUser?.uid;
        if (!uid || !['thuraya-staging', 'thuraya-client-telling'].includes(projectId)) throw new Error('Sign in to the correct Staff App environment.');
        try {
            const response = await firebase.app().functions('us-central1').httpsCallable('noShowService')({ ...input, command, projectId });
            if (firebase.auth().currentUser?.uid !== uid) throw new Error('Your session changed. Sign in and retry.');
            return response.data;
        } catch (error) {
            const code = String(error.code || '').replace(/^functions\//, '');
            const known = ['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'not-found', 'aborted', 'already-exists', 'resource-exhausted'];
            throw Object.assign(new Error(known.includes(code) ? error.message : 'No Show could not be confirmed. Check the result or retry the same request.'), { code });
        }
    }
    function pending() { try { return JSON.parse(sessionStorage.getItem(key()) || 'null'); } catch (_) { return null; } }
    function clear() { sessionStorage.removeItem(key()); }
    function mount() {
        if (dialog) return dialog;
        const css = document.createElement('style');
        css.textContent = '#thNoShowDialog{width:min(760px,calc(100vw - 28px));max-height:90vh;box-sizing:border-box;border:1px solid #b8b3a6;border-radius:8px;padding:20px;color:var(--primary,#222);background:#fff}#thNoShowDialog::backdrop{background:#0008}#thNoShowDialog h3{font-size:20px;margin:0 0 12px}#thNoShowDialog p{overflow-wrap:anywhere}#thNoShowMembers{display:grid;gap:0;margin:16px 0;max-height:52vh;overflow:auto}#thNoShowMembers article{display:grid;grid-template-columns:minmax(0,1fr) minmax(100px,1fr);gap:8px;padding:12px 0;border-bottom:1px solid #ddd;overflow-wrap:anywhere}#thNoShowMembers small{display:block}#thNoShowDialog footer{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end}#thNoShowDialog button{width:auto;white-space:normal;max-width:100%}.th-noshow-action{white-space:normal!important;overflow-wrap:anywhere;padding:6px!important;font-size:12px!important;width:100%!important}@media(max-width:480px){#thNoShowMembers article{grid-template-columns:1fr}#thNoShowDialog{padding:14px}}';
        document.head.append(css);
        dialog = document.createElement('dialog'); dialog.id = 'thNoShowDialog'; dialog.setAttribute('aria-labelledby', 'thNoShowTitle');
        document.body.append(dialog); dialog.addEventListener('cancel', e => { if (busy) e.preventDefault(); });
        return dialog;
    }
    function shell(title, body, footer) {
        mount().innerHTML = `<h3 id="thNoShowTitle">${esc(title)}</h3>${body}<p id="thNoShowError" role="alert" style="color:var(--error,#a22)"></p><footer>${footer}<button type="button" class="btn btn-secondary" id="thNoShowClose">Close</button></footer>`;
        dialog.querySelector('#thNoShowClose').onclick = () => { if (!busy) dialog.close(); };
        if (!dialog.open) dialog.showModal();
    }
    function refreshViews() {
        try { root.thNoShowLoadToday?.(false); root.thLoadUpcomingEnterpriseCalendar?.(); root.generateTimeSlots?.(); } catch (_) {}
        root.dispatchEvent(new CustomEvent('thuraya:no-show-changed'));
    }
    function done(result) {
        clear(); refreshViews();
        shell('No Show result', `<p>${result.changedIds?.length || 0} member(s) marked No Show.</p><p>${esc(result.groupSummary || '')}</p>`, '');
    }
    async function confirm(input) {
        if (busy) return; busy = true;
        const button = dialog.querySelector('#thNoShowConfirm'); if (button) button.disabled = true;
        sessionStorage.setItem(key(), JSON.stringify(input));
        try { done(await call('commit', input)); }
        catch (error) {
            dialog.querySelector('#thNoShowError').textContent = error.message;
            if (['aborted', 'invalid-argument', 'permission-denied', 'failed-precondition', 'already-exists', 'not-found', 'resource-exhausted', 'unauthenticated'].includes(error.code)) { clear(); if (button) button.hidden = true; }
            else if (button) { button.textContent = 'Retry confirmed request'; button.disabled = false; }
        } finally { busy = false; }
    }
    function showPreview(plan) {
        active = { appointmentId: plan.appointmentId, scope: plan.scope };
        const title = plan.scope === 'group-date' ? 'Mark Entire Group No Show' : plan.groupId ? 'Mark Member No Show' : 'Mark No Show';
        const input = { ...active, fingerprint: plan.fingerprint, requestId: crypto.randomUUID() };
        shell(title, `<p>${esc(plan.scopeLabel)}</p><p><strong>${plan.eligibleCount} eligible member(s) will be marked No Show.</strong> ${plan.skippedCount} will remain unchanged.</p><p>${esc(plan.groupSummary)}</p><div id="thNoShowMembers">${plan.members.map(m => `<article><div><strong>${esc(m.client)}</strong><small>${esc(m.date)} ${esc(m.time)}${m.subgroup == null ? '' : ` / Subgroup ${esc(m.subgroup)}`}</small><small>${esc(m.service)}</small></div><div><strong>${m.eligible ? 'Eligible' : 'Unchanged'} / ${esc(m.status)}</strong><small>${esc(m.reason)}</small></div></article>`).join('')}</div>`, `<button type="button" class="btn btn-secondary" id="thNoShowRefresh">Refresh preview</button><button type="button" class="btn" id="thNoShowConfirm" ${plan.eligibleCount ? '' : 'disabled'}>Confirm ${plan.eligibleCount} No Show${plan.eligibleCount === 1 ? '' : 's'}</button>`);
        dialog.querySelector('#thNoShowConfirm').onclick = () => confirm(input);
        dialog.querySelector('#thNoShowRefresh').onclick = () => { if (!busy) request(active.appointmentId, active.scope); };
    }
    async function request(appointmentId, scope = 'member') {
        if (busy) return;
        try {
            const old = pending();
            if (old) {
                const result = await call('status', { requestId: old.requestId });
                if (result.state === 'COMMITTED') { done(result); return; }
                shell('Check previous No Show request', '<p>A previously confirmed request has no recorded completion yet. Retry it before starting another action.</p>', '<button type="button" class="btn" id="thNoShowConfirm">Retry confirmed request</button>');
                dialog.querySelector('#thNoShowConfirm').onclick = () => confirm(old); return;
            }
            showPreview(await call('preview', { appointmentId, scope }));
        } catch (error) { shell('No Show unavailable', `<p>${esc(error.message)}</p>`, ''); }
    }
    function buttons(row) {
        if (!/^[A-Za-z0-9_-]{1,128}$/.test(row.id || '')) return '';
        const group = root.ThurayaNoShowModel.isGroup(row);
        return `<button type="button" class="btn btn-secondary th-noshow-action" onclick="thNoShowRequest('${row.id}','member')">${group ? 'Member No-Show' : 'No Show'}</button>${group && row.groupId ? `<button type="button" class="btn btn-secondary th-noshow-action" onclick="thNoShowRequest('${row.id}','group-date')">Entire Group No-Show</button>` : ''}`;
    }
    async function restore(id, mode) {
        if (!root.confirm(mode === 'reinstate' ? 'Reinstate only this No Show booking as Scheduled?' : 'Reopen only this No Show booking for rescheduling?')) return;
        try { await call('restore', { appointmentId: id, mode }); refreshViews(); if (mode === 'reschedule') root.editAppointment?.(id); }
        catch (error) { root.alert(error.message); }
    }
    root.ThurayaNoShow = Object.freeze({ call, request, buttons });
    root.thNoShowRequest = request;
    root.markNoShow = id => request(id, 'member');
    root.thNoShowReinstate = id => restore(id, 'reinstate');
    root.thNoShowReschedule = id => restore(id, 'reschedule');
})(window);
