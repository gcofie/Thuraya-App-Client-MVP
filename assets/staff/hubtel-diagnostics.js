(function (root) {
    'use strict';
    const CAPABILITY = 'integrations.networkDiagnostics.view';
    const RUN_CAPABILITY = 'integrations.networkDiagnostics.run';
    const CAUTION = 'AWAITING PROVIDER CONFIRMATION';
    function stability(runs) {
        const ips = runs.map(run => run.egressIp).filter(Boolean);
        if (new Set(ips).size > 1) return 'DYNAMIC_EGRESS';
        return ips.length >= 3 ? 'OBSERVED_STABLE_ACROSS_TEST_RUNS' : 'INSUFFICIENT_OBSERVATIONS';
    }
    function summary(result, runs) {
        return [
            'Environment: ' + result.environment, 'Backend path: ' + result.executionPath,
            'THURAYA backend egress IP: ' + (result.egressIp || 'UNAVAILABLE'),
            'Provider-confirmed source IP: PENDING',
            'Hubtel allowlist confirmation: NOT CONFIRMED', CAUTION,
            'Payment network enabled (diagnostic backend): FALSE',
            'Egress observations: ' + stability(runs), 'Checked at: ' + result.checkedAt,
            'Correlation ID: ' + result.correlationId,
            ...result.services.map(service => `${service.name}: ${service.safeTarget || service.hostname}; ${service.targetType}; ${service.method}; IPv4 ${service.resolvedIpv4.join(', ') || 'none'}; IPv6 ${service.resolvedIpv6.join(', ') || 'none'}; connected ${service.connectedIp || 'unavailable'}; DNS ${service.dnsStatus}; TCP443 ${service.tcp443Status}; TLS ${service.tlsStatus}; hostname ${service.hostnameMatches}; HTTPS ${service.httpsStatus}; HTTP ${service.httpStatus || 'none'}; ${service.latencyMs} ms; UTC ${service.checkedAt}`)
        ].join('\n');
    }
    function mount(document, auth, call, clipboard) {
        const nav = document.getElementById('topNavMenu');
        if (!nav || document.getElementById('hubtelDiagnosticsView')) return;
        const element = (tag, text, className) => {
            const node = document.createElement(tag);
            if (text !== undefined) node.textContent = text;
            if (className) node.className = className;
            return node;
        };
        const tab = element('div', undefined, 'nav-tab'); tab.id = 'tabHubtelDiagnostics'; tab.style.display = 'none';
        const radio = element('input'); radio.type = 'radio'; radio.name = 'main_nav'; radio.id = 'nav_hubtel_diagnostics'; radio.value = 'hubtelDiagnosticsView';
        const label = element('label', 'Integrations'); label.htmlFor = radio.id;
        tab.append(radio, label); nav.append(tab);
        const view = element('section', undefined, 'app-module hubtel-diagnostics'); view.id = radio.value; view.style.display = 'none';
        const heading = element('h2', 'Network Diagnostics');
        const targets = element('div', undefined, 'hd-targets');
        const select = (id, options) => {
            const node = element('select'); node.id = id;
            for (const [value, text] of options) { const option = element('option', text); option.value = value; node.append(option); }
            return node;
        };
        const field = (text, input) => { const box = element('div', undefined, 'hd-field'); const label = element('label', text); label.htmlFor = input.id; box.append(label, input); targets.append(box); return box; };
        const mode = select('hd-target-mode', [['PREDEFINED', 'Predefined profile'], ['HOSTNAME', 'Custom hostname'], ['IP', 'Custom public IP'], ['URL', 'Custom HTTPS URL']]);
        field('Target mode', mode);
        const profile = select('hd-profile', [['HUBTEL_CHECKOUT', 'Hubtel Checkout'], ['HUBTEL_STATUS', 'Hubtel Transaction Status'], ['HUBTEL_REFUND', 'Hubtel Refund']]);
        const profileField = field('Profile', profile);
        const target = element('input'); target.id = 'hd-custom-target'; target.type = 'text'; target.maxLength = 2048; target.autocomplete = 'off'; target.spellcheck = false;
        const targetField = field('Public target', target);
        const method = select('hd-method', [['HEAD', 'HEAD'], ['GET', 'GET'], ['EMPTY_POST', 'EMPTY POST']]); field('Method', method);
        const consent = element('input'); consent.id = 'hd-empty-post-consent'; consent.type = 'checkbox';
        const consentLabel = element('label', undefined, 'hd-consent'); consentLabel.htmlFor = consent.id; consentLabel.append(consent, element('span', 'Authorize one empty POST'));
        targets.append(consentLabel);
        const actions = element('div', undefined, 'hd-actions');
        const button = text => { const node = element('button', text); node.type = 'button'; return node; };
        const run = button('Run diagnostics'), runAll = button('Run all Hubtel presets'), compare = button('Compare Hubtel presets with custom URL'), copyIp = button('Copy egress IP'), copySummary = button('Copy diagnostic summary');
        copyIp.disabled = copySummary.disabled = run.disabled = runAll.disabled = compare.disabled = true; actions.append(run, runAll, compare, copyIp, copySummary);
        const message = element('p', 'Authorization required.', 'hd-message'); message.setAttribute('role', 'status');
        const caveat = element('p', CAUTION, 'hd-caution');
        const scope = element('p', 'Read only / No financial operations', 'hd-scope');
        const output = element('div', undefined, 'hd-output');
        view.append(heading, scope, targets, actions, message, caveat, output); nav.parentElement.append(view);
        let allowed = false, canRun = false, revision = 0, current = null, busy = false, runs = [];
        function visibility() {
            const desired = allowed ? 'flex' : 'none';
            if (tab.style.display !== desired) tab.style.display = desired;
            if (!allowed) view.style.display = 'none';
        }
        new root.MutationObserver(visibility).observe(tab, { attributes: true, attributeFilter: ['style'] });
        function controls() {
            const ready = allowed && canRun && !busy;
            const valid = mode.value === 'PREDEFINED' || !!target.value.trim();
            const postReady = method.value !== 'EMPTY_POST' || (mode.value === 'URL' && consent.checked);
            run.disabled = !ready || !valid || !postReady; runAll.disabled = !ready;
            compare.disabled = !ready || mode.value !== 'URL' || !valid || !postReady;
            copyIp.disabled = !allowed || busy || !current?.egressIp; copySummary.disabled = !allowed || busy || !current;
            mode.disabled = profile.disabled = target.disabled = consent.disabled = !ready;
            method.disabled = !ready || mode.value === 'PREDEFINED';
            profileField.hidden = mode.value !== 'PREDEFINED'; targetField.hidden = mode.value === 'PREDEFINED';
            consentLabel.hidden = mode.value !== 'URL' || method.value !== 'EMPTY_POST';
            method.querySelector('option[value="EMPTY_POST"]').disabled = mode.value !== 'URL';
        }
        for (const input of [mode, profile, target, method]) input.addEventListener(input === target ? 'input' : 'change', () => {
            consent.checked = false;
            if (mode.value === 'PREDEFINED' || mode.value !== 'URL' && method.value === 'EMPTY_POST') method.value = 'HEAD';
            controls();
        });
        consent.addEventListener('change', controls);
        function render(result) {
            output.replaceChildren();
            const metadata = element('dl', undefined, 'hd-metadata');
            for (const [name, value] of [
                ['Environment', result.environment], ['Backend path', result.executionPath],
                ['THURAYA backend egress IP', result.egressIp || 'UNAVAILABLE'],
                ['Provider-confirmed source IP', 'PENDING'],
                ['Hubtel allowlist confirmation', 'NOT CONFIRMED'], ['Payment network enabled', 'FALSE (diagnostic backend only)'],
                ['Last checked UTC', result.checkedAt], ['Egress observations', stability(runs)], ['Runs in this session', runs.length],
                ['Correlation ID', result.correlationId], ['Comparison egress', result.egressIp ? 'SAME OBSERVATION / SAME BACKEND PATH' : 'UNAVAILABLE']
            ]) { const pair = element('div'); pair.append(element('dt', name), element('dd', String(value))); metadata.append(pair); }
            output.append(metadata);
            if (result.egressErrorCategory) output.append(element('p', 'Egress: ' + result.egressErrorCategory, 'hd-message'));
            const table = element('table'); const caption = element('caption', 'Backend network reachability'); table.append(caption);
            const headings = ['Target / method', 'Resolved destinations', 'DNS / port', 'TCP', 'TLS / identity', 'HTTPS / application response', 'Execution / egress / UTC'];
            const head = element('thead'), row = element('tr');
            headings.forEach(text => { const th = element('th', text); th.scope = 'col'; row.append(th); }); head.append(row); table.append(head);
            const body = element('tbody');
            for (const service of result.services) {
                const tr = element('tr');
                const cells = [service.name + '\n' + (service.safeTarget || service.hostname) + '\n' + service.targetType + ' / ' + service.method,
                    'IPv4: ' + (service.resolvedIpv4.join(', ') || 'none returned') + '\nIPv6: ' + (service.resolvedIpv6.join(', ') || 'none returned') + '\nConnected: ' + (service.connectedIp || 'unavailable') + '\nSelected: ' + (service.probedDestinationIp || 'none'),
                    service.dnsStatus + '\n443', service.tcp443Status,
                    service.tlsStatus + '\nHostname: ' + (service.hostnameMatches === true ? 'PASS' : service.hostnameMatches === false ? 'FAIL' : 'NOT VERIFIED') + (service.certificateExpiry ? '\nExpiry: ' + service.certificateExpiry : '') + (service.tlsVersion ? '\n' + service.tlsVersion : ''),
                    service.httpsStatus + (service.httpStatus ? '\nHTTP ' + service.httpStatus : '') + '\n' + service.latencyMs + ' ms' + (service.errorCategory ? '\n' + service.errorCategory : '') + (service.redirectStatus ? '\nRedirect: ' + service.redirectStatus : ''),
                    result.environment + '\n' + result.executionPath + '\n' + (service.egressIp || result.egressIp || 'UNAVAILABLE') + '\n' + service.checkedAt + (service.sentAt ? '\nSent UTC: ' + service.sentAt : '') + '\n' + result.correlationId];
                cells.forEach((text, index) => { const cell = element('td', text); cell.dataset.label = headings[index]; tr.append(cell); }); body.append(tr);
            }
            table.append(body); output.append(table);
        }
        radio.addEventListener('change', () => { if (allowed) root.switchModule?.(view.id); });
        async function execute(command) {
            if (!allowed || !canRun || busy) return;
            let data = { command };
            if (command !== 'runAll') {
                if (run.disabled || command === 'compare' && compare.disabled) return;
                data.target = mode.value === 'PREDEFINED' ? { mode: 'PREDEFINED', profile: profile.value } : { mode: mode.value, value: target.value.trim(), method: method.value };
                if (method.value === 'EMPTY_POST') { if (!consent.checked) return; data.confirmEmptyPost = true; consent.checked = false; }
            }
            const stamp = revision; busy = true; controls(); message.textContent = 'Running backend diagnostics...';
            try {
                const result = await call(data);
                if (revision !== stamp || !allowed) return;
                current = result; runs.push(result); runs = runs.slice(-20); render(result);
                message.textContent = 'Diagnostic run complete. Payment networking remains disabled.';
            } catch (error) {
                if (revision === stamp) {
                    if (['functions/permission-denied', 'functions/unauthenticated'].includes(error?.code)) { allowed = false; canRun = false; current = null; target.value = ''; runs = []; output.replaceChildren(); visibility(); }
                    message.textContent = error?.code === 'functions/resource-exhausted' ? 'Diagnostics busy. Wait ten seconds before retrying.' : error?.code === 'functions/invalid-argument' ? 'Target or method rejected.' : 'Diagnostic outcome unavailable. No automatic retry.';
                }
            } finally { if (revision === stamp) { busy = false; controls(); } }
        }
        run.addEventListener('click', () => execute('runTarget'));
        runAll.addEventListener('click', () => execute('runAll'));
        compare.addEventListener('click', () => execute('compare'));
        async function copy(value) {
            const stamp = revision;
            try { await clipboard.writeText(value); if (revision === stamp) message.textContent = 'Copied.'; }
            catch { if (revision === stamp) message.textContent = 'Clipboard unavailable.'; }
        }
        copyIp.addEventListener('click', () => { if (allowed && current?.egressIp) void copy(current.egressIp); });
        copySummary.addEventListener('click', () => { if (allowed && current) void copy(summary(current, runs)); });
        auth.onAuthStateChanged(async user => {
            const stamp = ++revision; allowed = false; canRun = false; current = null; target.value = ''; consent.checked = false; runs = []; busy = false; output.replaceChildren(); visibility(); controls();
            message.textContent = user ? 'Checking access...' : 'Authorization required.';
            if (!user) return;
            try {
                const result = await call({ command: 'capabilities' });
                if (revision !== stamp) return;
                allowed = Array.isArray(result.capabilities) && result.capabilities.includes(CAPABILITY);
                canRun = allowed && result.capabilities.includes(RUN_CAPABILITY);
                message.textContent = allowed ? 'No diagnostics run in this session.' : 'Access denied.';
            } catch { if (revision === stamp) message.textContent = 'Diagnostics access unavailable.'; }
            if (revision === stamp) { visibility(); controls(); }
        });
        return { view, tab };
    }
    root.ThurayaHubtelDiagnostics = Object.freeze({ mount, stability, summary });
    function start() {
        if (!root.firebase?.apps?.length) return;
        const call = async data => (await root.firebase.app().functions('us-central1').httpsCallable('hubtelNetworkDiagnostics')({
            ...data, projectId: root.THURAYA_CONFIG?.projectId
        })).data;
        mount(root.document, root.firebase.auth(), call, root.navigator.clipboard);
    }
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', start);
    else start();
})(window);
