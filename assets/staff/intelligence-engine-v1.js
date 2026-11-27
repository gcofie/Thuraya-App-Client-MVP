console.log("🧠 Intelligence Engine v1 loaded: Phase 5.4B Full Intelligence");

// ======================================================
// THURAYA APP — PHASE 5.4B FULL INTELLIGENCE ENGINE
// Safe standalone module.
// Does NOT change booking, billing, attendance, login, or app.js.
// Reads Firestore only and renders into #intelligencePanel.
// ======================================================

(function () {
    if (window.thurayaBindIntelligenceRefresh) return;
    let refreshInFlight = null;
    const STATE = {
        loadedAt: null,
        today: "",
        yesterday: "",
        revenueToday: 0,
        revenueYesterday: 0,
        revenueSummary: null,
        financialPartial: false,
        serviceCoverage: null,
        bookingsToday: 0,
        bookingsYesterday: 0,
        closedJobsToday: 0,
        pendingJobsToday: 0,
        noShowsToday: 0,
        activeJobsToday: 0,
        topTech: null,
        topClient: null,
        topService: null,
        staff: [],
        clients: [],
        services: [],
        alerts: [],
        actions: [],
        targetToday: 0,
        commissionEstimate: 0,
        dataSources: {
            activeJobs: 0,
            appointments: 0,
            targets: 0,
            commissionSettings: 0
        }
    };
    const initialState = JSON.stringify(STATE);
    const IC = window.ThurayaIntelligenceCanonical;
    if (!IC) {
        console.warn('Canonical Intelligence helpers are unavailable.');
        return;
    }

    function money(n) {
        return IC.formatMoney(n);
    }

    function pct(n) {
        if (!Number.isFinite(n)) return "Unavailable";
        return `${Math.round(n)}%`;
    }

    function todayString(offsetDays = 0) {
        const d = new Date();
        d.setDate(d.getDate() + offsetDays);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        const day = String(d.getDate()).padStart(2, "0");
        return `${y}-${m}-${day}`;
    }

    function safeNumber(...values) {
        for (const v of values) {
            const n = Number(v);
            if (!isNaN(n) && isFinite(n) && n > 0) return n;
        }
        return 0;
    }

    function normalizeStatus(v) {
        return String(v || "").trim().toLowerCase();
    }

    function revenueFromDoc(d) {
        return IC.recognizedRevenue(d);
    }

    function serviceFromDoc(d) {
        return IC.serviceLineEntries(d)[0]?.name || d.bookedService || d.service || d.serviceName || d.menuService || "Service";
    }

    function techKeyFromDoc(d) {
        return IC.techKey(d);
    }

    function techNameFromDoc(d) {
        return IC.techName(d);
    }

    function clientKeyFromDoc(d) {
        return IC.clientKey(d);
    }

    function clientNameFromDoc(d) {
        return IC.clientName(d);
    }

    function isClosedRevenueStatus(status) {
        return [
            "paid",
            "closed",
            "completed",
            "complete",
            "checkout complete",
            "payment complete",
            "done"
        ].some(x => status.includes(x));
    }

    function isPendingStatus(status) {
        return [
            "pending",
            "waiting",
            "arrived",
            "checked in",
            "in progress",
            "active"
        ].some(x => status.includes(x));
    }

    function isNoShowStatus(status) {
        return status.includes("no show") || status.includes("no-show") || status.includes("noshow");
    }

    async function getDocsForDate(collectionName, dateString) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!window.db) throw new Error('Intelligence data connection is unavailable.');

        const results = [];
        const tried = new Set();

        async function tryQuery(field) {
            if (!isCurrent()) return;
            const key = `${collectionName}:${field}:${dateString}`;
            if (tried.has(key)) return;
            tried.add(key);

            try {
                const snap = await db.collection(collectionName).where(field, "==", dateString).get();
                if (!isCurrent()) return;
                snap.forEach(doc => results.push({ id: doc.id, collection: collectionName, ...doc.data() }));
            } catch (e) { if (!isCurrent()) return;
                // A partial population must not be reported as a fresh successful read.
                console.warn(`⚠️ Intelligence query failed: ${collectionName}.${field}`, e.message || e);
                throw e;
            }
        }

        await tryQuery("dateString");
        if (!isCurrent()) return;
        await tryQuery("date");
        if (!isCurrent()) return;
        await tryQuery("bookingDate");
        if (!isCurrent()) return;
        await tryQuery("scheduledDate");
        if (!isCurrent()) return;

        // De-duplicate by collection + id
        const map = new Map();
        results.forEach(r => map.set(`${r.collection}:${r.id}`, r));
        return Array.from(map.values());
    }

    async function loadTargets() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!window.db) return 0;

        let total = 0;
        try {
            const snap = await db.collection("Staff_Targets").get();
            if (!isCurrent()) return;
            STATE.dataSources.targets = snap.size;

            snap.forEach(doc => {
                const d = doc.data() || {};
                total += safeNumber(
                    d.dailyTarget,
                    d.targetToday,
                    d.revenueTarget,
                    d.targetAmount,
                    d.monthlyTarget ? Number(d.monthlyTarget) / 26 : 0
                );
            });
        } catch (e) { if (!isCurrent()) return;
            console.warn("⚠️ Staff_Targets skipped:", e.message || e);
        }

        return total;
    }

    async function loadCommissionSettings() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!window.db) return null;

        let commissionRate = null;
        try {
            const result = await window.ThurayaCommissionV2.call({ action: 'legacySettings' });
            if (!isCurrent()) return;
            const config = await window.ThurayaCommissionV2.refresh();
            if (!isCurrent()) return;
            if (config.persons.length) return null;
            STATE.dataSources.commissionSettings = result.settings.length;

            for (const setting of result.settings) {
                const key = ['rate', 'defaultRate', 'commissionRate', 'percent', 'percentage']
                    .find(name => setting[name] !== undefined && setting[name] !== null);
                if (key === undefined) continue;
                const rate = window.thFinancialEvidence.amount(setting[key]);
                if (rate === null) return null;
                if (commissionRate === null || rate > commissionRate) commissionRate = rate;
            }
        } catch (e) { if (!isCurrent()) return;
            console.warn("⚠️ Commission_Settings skipped:", e.message || e);
            return null;
        }

        // If no setting exists yet, use conservative dashboard-only estimate.
        return commissionRate ?? 10;
    }

    function aggregateDay(docs, isToday, revenueDocs = docs) {
        const amounts = [];
        let bookings = IC.uniqueBookingCount(docs);
        let closed = 0;
        let pending = 0;
        let noshow = 0;
        let active = 0;

        const staffMap = new Map();
        const clientMap = new Map();
        const noShowBookings = new Set();

        docs.forEach(d => {
            const status = normalizeStatus(d.status || d.jobStatus || d.paymentStatus || d.bookingStatus);

            if (isPendingStatus(status)) pending += 1;
            if (isNoShowStatus(status)) {
                const bookingKey = IC.bookingKey(d) || d.sourceAppointmentId || d.id;
                if (!bookingKey || !noShowBookings.has(bookingKey)) noshow += 1;
                if (bookingKey) noShowBookings.add(bookingKey);
            }
            if (status.includes("active") || status.includes("progress") || status.includes("arrived")) active += 1;
        });

        IC.canonicalRevenueRows(revenueDocs).forEach(d => {
            const amount = revenueFromDoc(d);
            const techKey = techKeyFromDoc(d);
            const techName = techNameFromDoc(d);
            const clientKey = clientKeyFromDoc(d);
            const clientName = clientNameFromDoc(d);

            amounts.push(amount);
            closed += 1;

            if (!staffMap.has(techKey)) {
                staffMap.set(techKey, { key: techKey, name: techName, revenue: 0, bookings: 0, closed: 0 });
            }
            const s = staffMap.get(techKey);
            s.revenue = IC.sumAmounts([s.revenue, amount]);
            s.partial = s.revenue === null;
            s.bookings += 1;
            s.closed += 1;

            if (!clientMap.has(clientKey)) {
                clientMap.set(clientKey, { key: clientKey, name: clientName, spend: 0, bookings: 0 });
            }
            const c = clientMap.get(clientKey);
            c.spend = IC.sumAmounts([c.spend, amount]);
            c.partial = c.spend === null;
            c.bookings += 1;

        });

        const revenueSummary = IC.revenueSummary(amounts);
        const revenue = revenueSummary.total;
        const staff = Array.from(staffMap.values()).sort((a, b) => revenueSummary.partial
            ? a.name.localeCompare(b.name) : b.revenue - a.revenue);
        const clients = Array.from(clientMap.values()).sort((a, b) => revenueSummary.partial
            ? a.name.localeCompare(b.name) : b.spend - a.spend);
        const serviceCoverage = IC.serviceAttribution(revenueDocs);
        const services = serviceCoverage.services.map(line => ({ ...line, count: line.qty }));

        if (isToday) {
            STATE.revenueToday = revenue;
            STATE.revenueSummary = revenueSummary;
            STATE.financialPartial = revenueSummary.partial;
            STATE.serviceCoverage = serviceCoverage;
            STATE.bookingsToday = bookings;
            STATE.closedJobsToday = closed;
            STATE.pendingJobsToday = pending;
            STATE.noShowsToday = noshow;
            STATE.activeJobsToday = active;
            STATE.staff = staff;
            STATE.clients = clients;
            STATE.services = services;
            STATE.topTech = revenueSummary.partial ? null : staff[0] || null;
            STATE.topClient = revenueSummary.partial ? null : clients[0] || null;
            STATE.topService = serviceCoverage.partial ? null : services[0] || null;
        } else {
            STATE.revenueYesterday = revenue;
            STATE.bookingsYesterday = bookings;
        }
    }

    function generateAlertsAndActions() {
        STATE.alerts = [];
        STATE.actions = [];

        const target = STATE.targetToday || 0;
        const revenue = STATE.revenueToday;
        const bookings = STATE.bookingsToday;
        const yesterdayRevenue = STATE.revenueYesterday;
        const yesterdayBookings = STATE.bookingsYesterday;
        const targetProgress = Number.isFinite(revenue) && target > 0 ? (revenue / target) * 100 : null;

        if (STATE.financialPartial) {
            STATE.alerts.push('Revenue evidence is partial. ' + IC.summaryText(STATE.revenueSummary) + '.');
            STATE.actions.push('Review missing or contradictory transaction evidence before comparing revenue.');
        }

        if (targetProgress !== null && targetProgress < 60) {
            STATE.alerts.push(`📉 Revenue is below target pace (${pct(targetProgress)} of target).`);
            STATE.actions.push("Manager action: push high-value services, packages, and same-day upsells.");
        } else if (targetProgress !== null && targetProgress >= 100) {
            STATE.alerts.push("✅ Daily revenue target achieved.");
            STATE.actions.push("Manager action: protect service quality and maintain upsell discipline.");
        }

        if (Number.isFinite(revenue) && yesterdayRevenue > 0 && revenue < yesterdayRevenue * 0.8) {
            STATE.alerts.push("⚠️ Revenue is down more than 20% versus yesterday.");
            STATE.actions.push("Manager action: review booking gaps and activate promo follow-ups.");
        }

        if (yesterdayBookings > 0 && bookings < yesterdayBookings) {
            STATE.alerts.push("📉 Bookings are lower than yesterday.");
            STATE.actions.push("Manager action: check expected clients and contact warm leads.");
        }

        if (STATE.pendingJobsToday > 0) {
            STATE.alerts.push(`🧾 ${STATE.pendingJobsToday} job(s) may need checkout or follow-up.`);
            STATE.actions.push("FOH action: clear pending checkout queue before end of day.");
        }

        if (STATE.noShowsToday > 0) {
            STATE.alerts.push(`🚨 ${STATE.noShowsToday} no-show(s) in selected period.`);
            STATE.actions.push("FOH action: contact no-shows and offer reschedule window.");
        }

        if (STATE.topTech) {
            STATE.alerts.push(`🔥 Top technician in selected period: ${STATE.topTech.name} (${money(STATE.topTech.revenue)}).`);
        }

        if (STATE.topClient && STATE.topClient.spend > 0) {
            STATE.alerts.push(`💎 Top client spend in selected period: ${STATE.topClient.name} (${money(STATE.topClient.spend)}).`);
            STATE.actions.push("Client action: consider VIP retention note or package offer.");
        }

        if (STATE.topService && STATE.topService.count >= 2) {
            STATE.alerts.push(`📌 Trending service: ${STATE.topService.name} (${STATE.topService.count} booking(s)).`);
            STATE.actions.push("Sales action: promote the trending service while demand is active.");
        }

        const lowStaff = STATE.staff.filter(s => s.bookings > 0 && s.revenue === 0);
        if (lowStaff.length) {
            STATE.alerts.push(`👀 ${lowStaff.length} staff member(s) have activity but no revenue recorded yet.`);
            STATE.actions.push("Manager action: check if jobs are still active or not checked out.");
        }

        if (!STATE.alerts.length) {
            STATE.alerts.push("✅ No critical alerts detected. Operations appear stable.");
        }
    }

    function render() {
        const panel = document.getElementById("intelligencePanel");
        if (!panel) return;

        const period = window.ThurayaIntelligencePeriod.get();
        const label = window.ThurayaIntelligencePeriod.label();
        panel.dataset.periodStart = period.startDate;
        panel.dataset.periodEnd = period.endDate;
        const targetProgress = Number.isFinite(STATE.revenueToday) && STATE.targetToday > 0 ? (STATE.revenueToday / STATE.targetToday) * 100 : null;
        const revenueDelta = Number.isFinite(STATE.revenueToday) && STATE.revenueYesterday > 0 ? ((STATE.revenueToday - STATE.revenueYesterday) / STATE.revenueYesterday) * 100 : null;
        const bookingDelta = STATE.bookingsYesterday > 0 ? ((STATE.bookingsToday - STATE.bookingsYesterday) / STATE.bookingsYesterday) * 100 : 0;

        const staffRows = STATE.staff.slice(0, 5).map((s, i) => `
            <tr>
                <td>${STATE.financialPartial ? 'Unavailable' : '#' + (i + 1)}</td>
                <td>${s.name}</td>
                <td>${s.bookings}</td>
                <td>${money(s.revenue)}</td>
            </tr>
        `).join("");

        panel.innerHTML = `
            <div style="background:#fff; border:1px solid #ddd; border-radius:14px; padding:20px; box-shadow:0 8px 22px rgba(47,59,79,.06); margin-bottom:20px;">
                <div style="display:flex; justify-content:space-between; gap:12px; flex-wrap:wrap; align-items:flex-start;">
                    <div>
                        <h2 style="margin:0 0 6px; color:#2f3b4f;">🧠 Intelligence Overview</h2>
                        <p style="margin:0; color:#666; font-size:.9rem;">Full business, staff, client, revenue and commission intelligence.</p>
                    </div>
                    <button type="button" data-intelligence-refresh style="border:1px solid #2f3b4f; background:#fff; color:#2f3b4f; padding:9px 14px; border-radius:8px; font-weight:800; cursor:pointer;">Refresh Intelligence</button>
                </div>

                <div style="display:grid; grid-template-columns:repeat(auto-fit,minmax(min(100%,180px),1fr)); gap:14px; margin-top:18px;">
                    <div style="border-left:4px solid #2f3b4f; background:#fafafa; padding:14px; border-radius:10px;">
                        <div style="font-size:.72rem; color:#666; font-weight:900; text-transform:uppercase;">Revenue - ${label}</div>
                        <div style="font-size:1.35rem; font-weight:900; color:#2f3b4f;">${STATE.revenueSummary ? IC.summaryText(STATE.revenueSummary) : 'Unavailable'}</div>
                        <div style="font-size:.78rem; color:${revenueDelta === null ? '#666' : revenueDelta >= 0 ? '#147a3d' : '#b42318'};">${period.displayLabel}</div>
                    </div>
                    <div style="border-left:4px solid #b69b45; background:#fafafa; padding:14px; border-radius:10px;">
                        <div style="font-size:.72rem; color:#666; font-weight:900; text-transform:uppercase;">Bookings - ${label}</div>
                        <div style="font-size:1.35rem; font-weight:900; color:#2f3b4f;">${STATE.bookingsToday}</div>
                        <div style="font-size:.78rem; color:${bookingDelta >= 0 ? '#147a3d' : '#b42318'};">Unique booking identities in selected period</div>
                    </div>
                    <div style="border-left:4px solid #147a3d; background:#fafafa; padding:14px; border-radius:10px;">
                        <div style="font-size:.72rem; color:#666; font-weight:900; text-transform:uppercase;">Target Progress</div>
                        <div style="font-size:1.35rem; font-weight:900; color:#2f3b4f;">${STATE.targetToday ? pct(targetProgress) : "N/A"}</div>
                        <div style="font-size:.78rem; color:#666;">${period.mode === 'daily' ? 'Target: '+(STATE.targetToday ? money(STATE.targetToday) : 'Not configured') : 'Daily targets are not extrapolated across periods'}</div>
                    </div>
                    <div style="border-left:4px solid #6b46c1; background:#fafafa; padding:14px; border-radius:10px;">
                        <div style="font-size:.72rem; color:#666; font-weight:900; text-transform:uppercase;">Commission Forecast</div>
                        <div style="font-size:1.35rem; font-weight:900; color:#2f3b4f;">${STATE.financialPartial ? 'Unavailable' : STATE.commissionEstimate === null ? 'View Commissions' : money(STATE.commissionEstimate)}</div>
                        <div style="font-size:.78rem; color:#666;">Dashboard estimate</div>
                    </div>
                </div>

                <div style="display:grid; grid-template-columns:1fr 1fr; gap:16px; margin-top:18px;">
                    <div style="background:#fff8e1; border:1px solid #ead28b; border-radius:12px; padding:15px;">
                        <h3 style="margin:0 0 10px; color:#2f3b4f;">🚨 Smart Alerts</h3>
                        ${STATE.alerts.map(a => `<div style="margin:7px 0; color:#2f3b4f;">${a}</div>`).join("")}
                    </div>
                    <div style="background:#eef5f9; border:1px solid #c9d8e5; border-radius:12px; padding:15px;">
                        <h3 style="margin:0 0 10px; color:#2f3b4f;">✅ Suggested Actions</h3>
                        ${STATE.actions.length ? STATE.actions.map(a => `<div style="margin:7px 0; color:#2f3b4f;">${a}</div>`).join("") : `<div style="color:#666;">No urgent actions required.</div>`}
                    </div>
                </div>

                <div style="margin-top:18px; background:#fff; border:1px solid #eee; border-radius:12px; padding:15px;">
                    <h3 style="margin:0 0 10px; color:#2f3b4f;">🏆 Staff Performance Snapshot</h3>
                    ${STATE.financialPartial ? '<p>Revenue ranking unavailable: partial evidence.</p>' : ''}
                    <div style="overflow-x:auto;">
                        <table style="width:100%; border-collapse:collapse; font-size:.86rem;">
                            <thead>
                                <tr style="background:#f3f4f6;">
                                    <th style="text-align:left; padding:9px; border:1px solid #e5e7eb;">Rank</th>
                                    <th style="text-align:left; padding:9px; border:1px solid #e5e7eb;">Technician</th>
                                    <th style="text-align:left; padding:9px; border:1px solid #e5e7eb;">Bookings</th>
                                    <th style="text-align:left; padding:9px; border:1px solid #e5e7eb;">Revenue</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${staffRows || `<tr><td colspan="4" style="padding:12px; color:#777; text-align:center;">No technician revenue for this period.</td></tr>`}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div style="margin-top:10px; color:#888; font-size:.75rem;">
                    Last updated: <time id="intelligenceFreshness" datetime="${STATE.loadedAt || ''}">${STATE.loadedAt ? new Date(STATE.loadedAt).toLocaleString() : "—"}</time> · Sources: Active_Jobs ${STATE.dataSources.activeJobs}, Appointments ${STATE.dataSources.appointments}
                </div>
            </div>
        `;
        bindRefresh();
    }

    function bindRefresh() {
        const panel = document.getElementById('intelligencePanel');
        if (!panel) return;
        const button = panel.querySelector('[data-intelligence-refresh]') ||
            Array.from(panel.querySelectorAll('button')).find(b => b.textContent.trim() === 'Refresh Intelligence');
        if (!button) return;
        button.setAttribute('data-intelligence-refresh', '');
        button.removeAttribute('onclick');
        button.onclick = handleRefreshClick;
        const busy = !!refreshInFlight;
        button.disabled = busy;
        button.setAttribute('aria-busy', String(busy));
        const label = busy ? 'Refreshing…' : 'Refresh Intelligence';
        if (button.textContent !== label) button.textContent = label;
    }

    function handleRefreshClick(event) {
        event.preventDefault();
        return run();
    }

    async function refreshCurrentPanels(options = {}) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const previous = { ...STATE, dataSources: { ...STATE.dataSources } };
        const controller = window.ThurayaIntelligencePeriod;
        const checkpoint = controller.checkpoint();
        const previousDom = ['intelligencePanel','phase62PredictiveOverview','phase64AiActionLayer'].map(id => [id,document.getElementById(id)?.innerHTML]);
        try {
            if (!document.getElementById('intelligencePeriodBar')) controller.mount();
            const data = await controller.load({fresh:true,period:options.period || controller.resolve(controller.get())});
            if (!isCurrent()) return;
            STATE.today = data.period.endDate;
            STATE.yesterday = '';

            const todayActive = data.jobs;
            const todayAppointments = data.appointments;

            STATE.dataSources.activeJobs = todayActive.length;
            STATE.dataSources.appointments = todayAppointments.length;

            aggregateDay([...todayActive, ...todayAppointments], true, data.revenueRows);
            aggregateDay([], false);

            const targetToday = data.period.mode === 'daily' ? await loadTargets() : 0;
            if (!isCurrent()) return;
            STATE.targetToday = targetToday;
            const commissionRate = await loadCommissionSettings();
            if (!isCurrent()) return;
            STATE.commissionEstimate = commissionRate === null || STATE.revenueToday === null ? null : STATE.revenueToday * (commissionRate / 100);

            generateAlertsAndActions();
            // The existing renderers own their calculations; await their fresh reads
            // before the single visible completion timestamp is advanced.
            if (typeof window.thurayaPhase62Render === 'function') await window.thurayaPhase62Render({ strict: true });
            if (!isCurrent()) return;
            if (typeof window.thurayaPhase64Render === 'function') await window.thurayaPhase64Render({ strict: true });
            if (!isCurrent()) return;
            STATE.loadedAt = new Date().toISOString();
            render();
            controller.commit();
            return true;
        } catch (e) { if (!isCurrent()) return;
            Object.assign(STATE, previous);
            controller.restore(checkpoint);
            previousDom.forEach(([id,html]) => { const node=document.getElementById(id); if (node && html !== undefined) node.innerHTML=html; });
            console.warn("⚠️ Intelligence Engine run failed:", e);
            const panel = document.getElementById("intelligencePanel");
            if (panel) {
                let error = document.getElementById('intelligenceRefreshError');
                if (!error) {
                    error = document.createElement('div');
                    error.id = 'intelligenceRefreshError';
                    error.setAttribute('role', 'alert');
                    error.style.cssText = 'color:#b42318;padding:12px 0;';
                    panel.appendChild(error);
                }
                error.textContent = `Intelligence refresh failed: ${e.message || e}. Please retry.`;
            }
            return false;
        }
    }

    function run(options = {}) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return Promise.resolve(false);
        if (refreshInFlight) return options.period ? refreshInFlight.then(() => isCurrent() ? run(options) : false) : refreshInFlight;
        const request = Promise.resolve().then(() => isCurrent() ? refreshCurrentPanels(options) : false).finally(() => {
            if (!isCurrent() || refreshInFlight !== request) return;
            refreshInFlight = null;
            bindRefresh();
        });
        refreshInFlight = request;
        bindRefresh();
        return request;
    }

    window.thurayaBindIntelligenceRefresh = bindRefresh;
    window.thurayaRunIntelligenceEngine = run;

    function scheduleRun() {
        if (!window.ThurayaSessionResources.active()) return;
        bindRefresh();
        window.ThurayaSessionResources.timeout(run, 1200);
        window.ThurayaSessionResources.timeout(run, 3500);
    }

    function registerSession() {
        window.ThurayaSessionResources.onStart("intelligence", scheduleRun);
    }
    window.ThurayaSessionResources.onStop("intelligence", () => {
        refreshInFlight = null;
        Object.assign(STATE, JSON.parse(initialState));
        for (const id of ["intelligencePanel", "phase62PredictiveOverview", "phase64AiActionLayer"]) {
            const node = document.getElementById(id);
            if (node) node.innerHTML = "";
        }
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", registerSession, { once: true });
    else registerSession();

    const oldSwitchModule = window.switchModule;
    window.switchModule = function(moduleId) {
        if (typeof oldSwitchModule === "function") oldSwitchModule(moduleId);
        if (moduleId === "reportsView" || moduleId === "clientsView" || moduleId === "staffPerformanceView") {
            window.ThurayaSessionResources.timeout(run, 600);
        }
    };

    window.ThurayaSessionResources.startupTimeout("intelligence.fallback", run, 2500);
})();
