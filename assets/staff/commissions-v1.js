// ============================================================
// THURAYA COMMISSIONS — PHASE 4.1 RBAC STABILITY PATCH
// Version: commissions-phase4-1-rbac-stability-20260425
// Adds technician My Commissions dashboard.
// Keeps Admin/Manager rules + live dashboard.
// Does NOT change booking, billing, checkout, or reports logic.
// ============================================================
console.log("✅ Commissions Phase 4.1 loaded: RBAC stability patch");

// Firebase global bridge for commissions module
var db = window.db || firebase.firestore();
var auth = window.auth || firebase.auth();


(function () {
    let editingRuleId = null;
    let unsubscribeRules = null;
    let cachedRules = [];
    let lastCommissionRows = [];
    let lastCommissionReport = null;
    let commissionLoadToken = 0;
    const targetApi = window.ThurayaCommissionV2;
    let currentComUser = null;
    let currentComRoles = [];

    function normalizeRole(role) {
        return String(role || "").toLowerCase().trim();
    }

    function normalizeEmail(email) {
        return String(email || "").toLowerCase().trim();
    }

    function safe(v) {
        return String(v ?? "").replace(/[&<>"']/g, s => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[s]));
    }

    function isArchivedRecord(row) {
        return row?.archived === true;
    }

    function num(v) {
        const n = Number(parseFloat(v || 0));
        return Number.isFinite(n) ? n : 0;
    }

    function money(v) { return v === null || v === undefined ? "Unavailable" : num(v).toFixed(2); }

    function firstNumber(source, keys, fallback = null) {
        const row = source || {};
        for (const key of keys) {
            const value = row[key];
            if (value !== undefined && value !== null && value !== "") {
                const parsed = num(value);
                if (Number.isFinite(parsed)) return parsed;
            }
        }
        return fallback;
    }

    function todayStr() {
        return window.ThurayaCommissionEngine.today();
    }

    function addDays(dateStr, days) {
        const d = new Date(dateStr + "T12:00:00");
        d.setDate(d.getDate() + days);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }

    function monthStart(dateStr) {
        const d = new Date(dateStr + "T12:00:00");
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-01`;
    }

    function monthEnd(dateStr) {
        const d = new Date(dateStr + "T12:00:00");
        return new Date(d.getFullYear(), d.getMonth()+1, 0).toISOString().slice(0,10);
    }

    function normalizeDateValue(v) {
        if (!v) return "";
        if (typeof v.toDate === "function") {
            const d = v.toDate();
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }
        const raw = String(v).trim();
        if (!raw) return "";
        if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
        const md = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
        if (md) return `${md[3]}-${String(md[1]).padStart(2,"0")}-${String(md[2]).padStart(2,"0")}`;
        const d = new Date(raw);
        if (!Number.isNaN(d.getTime())) {
            return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }
        return raw.slice(0, 10);
    }

    function rowDateString(d) {
        return normalizeDateValue(
            d.dateString || d.date || d.bookingDate || d.appointmentDate ||
            d.selectedDate || d.serviceDate || d.closedDate || d.createdDate || ""
        );
    }

    function roleText(roleKey, customName) {
        if (roleKey === "tech") return "Technician";
        if (roleKey === "foh") return "Front of House";
        if (roleKey === "manager") return "Manager";
        return customName || "Custom Role";
    }

    function isAdminManager() {
        return canAccessCommissionAdmin(currentComUser);
    }

    function canAccessCommissionAdmin(user) {
        return targetApi?.canManage(user?.uid) === true;
    }

    function isTechUser() {
        return currentComRoles.some(r => {
            const role = normalizeRole(r);
            return role === "tech" || role === "technician" || role.includes("tech") || role.includes("technician");
        });
    }

    function isClosedJob(row) {
        return String(row.status || "").trim().toLowerCase() === "closed";
    }

    function isGroup(row) {
        return row?.isGroupBooking === true || !!row?.groupId;
    }

    function isLead(row) {
        return row?.isLeadBooker === true ||
               row?.groupRole === "lead" ||
               row?.payableBy === "lead_booker" ||
               row?.payableBy === "lead_booker_final_bill";
    }

    function billingMode(row) {
        return row.billingMode || row.groupCheckoutType || row.billingScenario || "";
    }

    function commissionOnComplimentaryServices() {
        return false;
    }

    function fallbackCommissionFinancials(row) {
        const netRevenue = firstNumber(row, [
            "groupCheckoutAmount",
            "amountDue",
            "totalGHC",
            "grandTotal",
            "finalTotal",
            "bookedPrice",
            "price"
        ], 0);

        return {
            grossServiceValue: netRevenue,
            complimentaryValue: 0,
            netRevenue,
            taxableSubtotal: firstNumber(row, ["taxableSubtotal", "bookedPrice", "price"], netRevenue),
            taxTotal: firstNumber(row, ["taxTotal", "totalTax", "taxAmount"], 0),
            paidAmount: firstNumber(row, ["paidAmount", "amountPaid", "paymentAmount", "totalPaid"], netRevenue),
            commissionableRevenue: netRevenue,
            hasComplimentaryAdjustment: false,
            isFullyComplimentary: false,
            isMixedComplimentary: false,
            commissionOnComplimentaryServices: commissionOnComplimentaryServices(),
            originalTotalsSource: "commissions-v1-fallback",
            warnings: ["normalizer-unavailable"]
        };
    }

    function commissionFinancials(job) {
        let out = null;
        if (typeof window.normalizeComplimentaryFinancials === "function") {
            try {
                out = window.normalizeComplimentaryFinancials(job || {}, {
                    commissionOnComplimentaryServices: commissionOnComplimentaryServices()
                });
            } catch(e) {
                console.warn("Commissions financial normalizer fallback", e);
            }
        }

        if (!out || typeof out !== "object") out = fallbackCommissionFinancials(job || {});
        const evidence = window.thFinancialEvidence.read(job || {});

        return {
            grossServiceValue: num(out.grossServiceValue),
            complimentaryValue: num(out.complimentaryValue),
            netRevenue: evidence.net,
            taxableSubtotal: evidence.net,
            adjustedGross: evidence.finalGross,
            taxTotal: evidence.tax.available ? evidence.tax.taxTotal : window.thFinancialEvidence.firstAmount(job, ["taxTotal"]),
            paidAmount: evidence.paid,
            // The versioned legacy compensation basis is independent of report tax-net fields.
            commissionableRevenue: num(out.commissionableRevenue),
            hasComplimentaryAdjustment: out.hasComplimentaryAdjustment === true,
            isFullyComplimentary: out.isFullyComplimentary === true,
            isMixedComplimentary: out.isMixedComplimentary === true,
            commissionOnComplimentaryServices: out.commissionOnComplimentaryServices === true,
            originalTotalsSource: out.originalTotalsSource || "",
            warnings: Array.isArray(out.warnings) ? out.warnings : []
        };
    }

    function revenue(row) {
        return commissionFinancials(row).commissionableRevenue;
    }

    function addonRevenue(row) {
        let total = num(row.upsellTotal || row.addOnTotal || row.addonsTotal || row.addOnsTotal || 0);
        if (total > 0) return total;
        const arr = row.pendingUpsells || row.upsells || row.addOns || row.addons || [];
        if (Array.isArray(arr)) return arr.reduce((sum, x) => sum + num(x.price || x.amount || x.total || 0), 0);
        return 0;
    }

    function revenueKey(row) {
        const mode = billingMode(row);
        const gid = row.groupId || "";
        const sg = row.subGroupIndex || 1;

        if (!isGroup(row)) return `solo:${row._source}:${row.id}`;

        if (
            mode === "lead_pays_all" ||
            mode === "lead_pays_all_after_last" ||
            mode === "group_lead_all" ||
            mode === "group_lead_final"
        ) return `group:${gid}:lead-final`;

        if (mode === "subgroup_pays_separately" || mode === "subgroup") {
            return `group:${gid}:subgroup:${sg}`;
        }

        return `group:${gid}:member:${row.id}`;
    }

    function shouldCountRevenue(row, seen) {
        if (!isGroup(row)) return true;

        const mode = billingMode(row);
        const key = revenueKey(row);

        if (
            mode === "lead_pays_all" ||
            mode === "lead_pays_all_after_last" ||
            mode === "group_lead_all" ||
            mode === "group_lead_final"
        ) {
            if (seen.has(key)) return false;
            if (!(isLead(row) || row.groupCheckoutAmount || row.groupCheckoutType)) return false;
            seen.add(key);
            return true;
        }

        if (mode === "subgroup_pays_separately" || mode === "subgroup") {
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }

        return true;
    }

    function valueForRule(job, rule) {
        const appliesTo = rule.appliesTo || "serviceRevenue";
        if (appliesTo === "upsells") return addonRevenue(job);
        if (appliesTo === "closedJobs") return 1;
        return commissionFinancials(job).commissionableRevenue;
    }

    function calculateCommission(value, rule) {
        const type = rule.commissionType || "percentage";
        const pct = num(rule.percentage);
        const fixed = num(rule.fixedAmount);

        if (type === "percentage") return value * (pct / 100);
        if (type === "fixed") return fixed;
        if (type === "hybrid") return (value * (pct / 100)) + fixed;
        return 0; // tiered handled later
    }

    function getStaffForRole(job, roleKey, roleName) {
        if (roleKey === "tech") {
            return {
                email: String(job.assignedTechEmail || job.techEmail || "unassigned-tech").toLowerCase(),
                name: job.assignedTechName || job.techName || job.technicianName || "Unassigned Technician"
            };
        }
        if (roleKey === "foh") {
            return {
                email: String(job.fohEmail || job.checkedInByEmail || job.createdByEmail || job.createdBy || job.staffEmail || "foh-pool").toLowerCase(),
                name: job.fohName || job.checkedInByName || job.createdByName || "FOH Pool"
            };
        }
        if (roleKey === "manager") {
            return {
                email: String(job.managerEmail || "manager-pool").toLowerCase(),
                name: job.managerName || "Manager Pool"
            };
        }
        return {
            email: `${String(roleName || "custom").toLowerCase().replace(/\s+/g, "-")}-pool`,
            name: roleName || "Custom Role Pool"
        };
    }

    function injectCommissionStyles() {
        if (document.getElementById("comPhase3Styles")) return;
        const st = document.createElement("style");
        st.id = "comPhase3Styles";
        st.textContent = `
            .com-shell { max-width:1200px; margin:24px auto; }
            .com-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
            .com-title-block h2 { margin:0; color:var(--primary); letter-spacing:.02em; }
            .com-title-block p { margin:6px 0 0; color:#666; font-size:.9rem; }
            .com-pill { display:inline-flex; align-items:center; gap:6px; border:1px solid var(--border); background:#fff; color:var(--primary); border-radius:999px; padding:8px 12px; font-size:.78rem; font-weight:800; letter-spacing:.04em; text-transform:uppercase; }
            .com-tabs { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0 16px; }
            .com-tab-btn { border:1px solid var(--border); background:#fff; color:var(--primary); border-radius:9px; padding:10px 14px; font-size:.78rem; font-weight:900; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; transition:all .16s ease; }
            .com-tab-btn.active { background:var(--primary); border-color:var(--primary); color:#fff; box-shadow:0 5px 14px rgba(47,59,79,.16); }
            .com-grid { display:grid; grid-template-columns:390px minmax(0,1fr); gap:16px; align-items:start; }
            .com-card { background:#fff; border:1px solid var(--border); border-radius:12px; padding:18px; box-shadow:0 2px 10px rgba(0,0,0,.04); }
            .com-card h3 { margin-top:0; color:var(--primary); border-bottom:1px solid var(--border); padding-bottom:10px; }
            .com-form-row { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
            .com-actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; padding-top:14px; border-top:1px solid var(--border); }
            .com-btn { width:auto; border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:.78rem; font-weight:900; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; background:#fff; color:var(--primary); transition:all .16s ease; }
            .com-btn:hover { transform:translateY(-1px); border-color:var(--accent); box-shadow:0 5px 14px rgba(0,0,0,.08); }
            .com-btn.primary { background:var(--primary); border-color:var(--primary); color:#fff; }
            .com-btn.muted { background:#f8f9fb; }
            .com-table-wrap { overflow-x:auto; }
            .com-table { width:100%; border-collapse:collapse; font-size:.84rem; background:#fff; }
            .com-table th { background:#f3f4f6; color:var(--primary); text-align:left; padding:10px; border:1px solid #ddd; white-space:nowrap; font-size:.76rem; text-transform:uppercase; letter-spacing:.05em; }
            .com-table td { padding:10px; border:1px solid #eee; vertical-align:top; }
            .com-badge { display:inline-flex; align-items:center; border-radius:999px; padding:4px 9px; font-size:.72rem; font-weight:800; background:#f3f4f6; color:var(--primary); white-space:nowrap; }
            .com-badge.active { background:rgba(30,130,76,.12); color:var(--success); }
            .com-badge.inactive { background:rgba(180,60,60,.10); color:var(--error); }
            .com-inline-actions { display:flex; gap:6px; flex-wrap:wrap; }
            .com-small-btn { border:1px solid var(--border); background:#fff; border-radius:7px; padding:6px 9px; cursor:pointer; font-size:.74rem; font-weight:800; color:var(--primary); }
            .com-small-btn:hover { border-color:var(--accent); }
            .com-note { color:#666; font-size:.82rem; line-height:1.45; background:#fafafa; border:1px solid var(--border); border-left:4px solid var(--accent); border-radius:8px; padding:12px; margin-bottom:14px; }
            .com-kpi-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:16px 0; }
            .com-kpi { background:#fff; border:1px solid var(--border); border-radius:12px; padding:14px; box-shadow:0 2px 10px rgba(0,0,0,.04); border-left:4px solid var(--primary); }
            .com-kpi span { display:block; font-size:.74rem; color:#666; text-transform:uppercase; font-weight:900; letter-spacing:.05em; }
            .com-kpi strong { display:block; margin-top:6px; color:var(--primary); font-size:1.35rem; }
            .com-filter-bar { display:grid; grid-template-columns:repeat(5,minmax(0,1fr)); gap:12px; align-items:end; background:#fff; border:1px solid var(--border); border-radius:12px; padding:14px; }
            .com-empty { text-align:center; color:#888; font-style:italic; padding:30px 10px; }
            .com-tech-card { margin:16px 0; background:#fff; border:1px solid var(--border); border-left:4px solid var(--accent); border-radius:12px; padding:14px; box-shadow:0 2px 10px rgba(0,0,0,.04); }
            .com-tech-card h3 { margin:0 0 8px; color:var(--primary); border-bottom:none; padding-bottom:0; }
            .com-tech-mini-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:10px; margin-top:10px; }
            .com-tech-mini { background:#fafafa; border:1px solid var(--border); border-radius:9px; padding:10px; }
            .com-tech-mini span { display:block; color:#666; font-size:.72rem; text-transform:uppercase; font-weight:900; }
            .com-tech-mini strong { display:block; color:var(--primary); margin-top:5px; font-size:1.05rem; }
            @media (max-width:1000px) { .com-grid,.com-filter-bar { grid-template-columns:1fr; } .com-kpi-grid { grid-template-columns:repeat(2,minmax(0,1fr)); } }
            @media (max-width:620px) { .com-form-row,.com-kpi-grid,.com-tech-mini-grid { grid-template-columns:1fr; } .com-actions { flex-direction:column; } .com-btn { width:100%; } }
        `;
        document.head.appendChild(st);
    }

    function ensureCommissionShell() {
        if (!window.ThurayaSessionResources.active()) return;
        injectCommissionStyles();

        const topNav = document.getElementById("topNavMenu");
        if (topNav && !document.getElementById("tabCommissions")) {
            const tab = document.createElement("div");
            tab.className = "nav-tab";
            tab.id = "tabCommissions";
            tab.style.display = "none";
            tab.innerHTML = `
                <input type="radio" name="main_nav" id="nav_commissions" value="commissionsView" onchange="switchModule(this.value)">
                <label for="nav_commissions">💰 Commissions</label>
            `;
            const reportsTab = document.getElementById("tabReports");
            if (reportsTab && reportsTab.parentNode) reportsTab.parentNode.insertBefore(tab, reportsTab);
            else topNav.appendChild(tab);
        }

        const dashboard = document.getElementById("appDashboard");
        if (dashboard && !document.getElementById("commissionsView")) {
            const view = document.createElement("div");
            view.id = "commissionsView";
            view.className = "app-module";
            view.style.display = "none";
            dashboard.appendChild(view);
        }
    }

    async function updateUserContext(user) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!user || firebase.auth().currentUser?.uid !== user.uid) return;
        currentComUser = user || null;
        currentComRoles = [];

        if (!user || !db) return;

        try {
            const doc = await db.collection("Users").doc(user.email.toLowerCase()).get();
            if (!isCurrent()) return;
            const d = doc.exists ? (doc.data() || {}) : {};
            const rawRoles = Array.isArray(d.roles) ? d.roles : (d.role ? [d.role] : []);
            currentComRoles = rawRoles.map(normalizeRole).filter(Boolean);
            console.log("✅ Commission roles loaded:", currentComRoles, "for", normalizeEmail(user.email));
        } catch(e) { if (!isCurrent()) return;
            console.warn("Could not load commission user roles from Firestore", e);
            try {
                if (typeof currentRoles !== "undefined" && Array.isArray(currentRoles)) {
                    currentComRoles = currentRoles.map(normalizeRole).filter(Boolean);
                    console.log("✅ Commission roles fallback:", currentComRoles);
                }
            } catch(_) { if (!isCurrent()) return;}
        }
        try { await targetApi.refresh();
        if (!isCurrent()) return; }
        catch (e) { if (!isCurrent()) return; console.warn('Commission operator authorization unavailable', e); }
    }

    async function updateCommissionsTabVisibility(user) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        ensureCommissionShell();
        await updateUserContext(user);
        if (!isCurrent()) return;

        const tab = document.getElementById("tabCommissions");
        if (!tab) return;

        const canAdmin = canAccessCommissionAdmin(user);
        const canTech = isTechUser();
        tab.style.display = (canAdmin || canTech) ? "flex" : "none";
        if (!canAdmin && canTech) tab.setAttribute("data-tech-only", "true");
        else tab.removeAttribute("data-tech-only");
        window.ThurayaSessionResources.timeout(injectTechCommissionCard, 500);
    }

    function renderShell(activeSubTab = "dashboard") {
        if (!window.ThurayaSessionResources.active()) return;
        const root = document.getElementById("commissionsView");
        if (!root) return;

        const canAdmin = canAccessCommissionAdmin(firebase.auth().currentUser);
        if (!canAdmin && activeSubTab !== "my") {
            if (isTechUser()) activeSubTab = "my";
            else {
                root.innerHTML = `<div class="com-shell"><div class="com-note" style="border-left-color:var(--error);">Commissions access is restricted. Ask an Admin/Manager to confirm your role in Users.</div></div>`;
                return;
            }
        }

        root.innerHTML = `
            <div class="com-shell">
                <div class="com-header">
                    <div class="com-title-block">
                        <h2>💰 Commissions</h2>
                        <p>Rule-based commission setup, live calculation, and technician self-reporting.</p>
                    </div>
                    <div class="com-pill">Commission Management</div>
                </div>

                <div class="com-tabs">
                    ${canAccessCommissionAdmin(firebase.auth().currentUser) ? `
                        <button class="com-tab-btn ${activeSubTab === "dashboard" ? "active" : ""}" onclick="com_showTab('dashboard')">Live Dashboard</button>
                        <button class="com-tab-btn ${activeSubTab === "rules" ? "active" : ""}" onclick="com_showTab('rules')">Rules Setup</button>
                        <button class="com-tab-btn ${activeSubTab === "breakdown" ? "active" : ""}" onclick="com_showTab('breakdown')">Staff Breakdown</button>
                        <button class="com-tab-btn ${activeSubTab === "locked" ? "active" : ""}" onclick="com_showTab('locked')">Locked Records</button>
                    ` : ""}
                    ${isTechUser() ? `<button class="com-tab-btn ${activeSubTab === "my" ? "active" : ""}" onclick="com_showTab('my')">My Commissions</button>` : ""}
                </div>

                <div id="com_content"></div>
            </div>
        `;

        if (activeSubTab === "rules") renderRulesSetup();
        else if (activeSubTab === "breakdown") renderBreakdown();
        else if (activeSubTab === "my") renderMyCommissions();
        else if (activeSubTab === "locked") renderLockedRecords();
        else renderDashboard();

        attachRulesListener();
    }

    function showTab(tab) { renderShell(tab); }

    // ---------- Shared calculation engine ----------
    function activeRules(roleFilter = "all") {
        return cachedRules.filter(r => {
            if (r.schemaVersion === 2 || r.active === false) return false;
            if (roleFilter !== "all" && r.roleKey !== roleFilter) return false;
            return true;
        });
    }

    async function fetchClosedJobs(start, end) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const rows = [];
        const sourceAppointmentIds = new Set();

        try {
            const snap = await db.collection("Active_Jobs")
                .where("dateString", ">=", start)
                .where("dateString", "<=", end)
                .get();
                if (!isCurrent()) return;

            snap.forEach(doc => {
                const d = doc.data() || {};
                const ds = rowDateString(d);
                if (!isArchivedRecord(d) && ds >= start && ds <= end && isClosedJob(d)) {
                    rows.push({ id: doc.id, _source: "Active_Jobs", ...d, dateString: ds });
                    const sourceAppointmentId = String(d.sourceAppointmentId || "").trim();
                    if (sourceAppointmentId) sourceAppointmentIds.add(sourceAppointmentId);
                }
            });
        } catch (e) { if (!isCurrent()) return;
            console.warn("Commission Active_Jobs query failed, using scan", e);
            const snap = await db.collection("Active_Jobs").get();
            if (!isCurrent()) return;
            snap.forEach(doc => {
                const d = doc.data() || {};
                const ds = rowDateString(d);
                if (!isArchivedRecord(d) && ds >= start && ds <= end && isClosedJob(d)) {
                    rows.push({ id: doc.id, _source: "Active_Jobs", ...d, dateString: ds });
                    const sourceAppointmentId = String(d.sourceAppointmentId || "").trim();
                    if (sourceAppointmentId) sourceAppointmentIds.add(sourceAppointmentId);
                }
            });
        }

        try {
            const snap = await db.collection("Appointments")
                .where("dateString", ">=", start)
                .where("dateString", "<=", end)
                .get();
                if (!isCurrent()) return;

            snap.forEach(doc => {
                const d = doc.data() || {};
                const ds = rowDateString(d);
                if (!isArchivedRecord(d) && !sourceAppointmentIds.has(doc.id) && ds >= start && ds <= end && isClosedJob(d)) {
                    rows.push({ id: doc.id, _source: "Appointments", ...d, dateString: ds });
                }
            });
        } catch(e) { if (!isCurrent()) return;
            console.warn("Commission Appointments fallback query failed", e);
        }

        rows.sort((a,b) => `${a.dateString || ""}${a.timeString || ""}`.localeCompare(`${b.dateString || ""}${b.timeString || ""}`));
        return rows;
    }

    function calculateRows(jobs, rules) {
        const out = [];
        const revenueSeen = new Set();

        jobs.forEach(job => {
            const fin = commissionFinancials(job);
            const countRevenue = shouldCountRevenue(job, revenueSeen);
            const baseRevenue = countRevenue ? fin.commissionableRevenue : 0;

            rules.forEach(rule => {
                const roleName = roleText(rule.roleKey, rule.customRoleName);
                const staff = getStaffForRole(job, rule.roleKey, roleName);

                let baseValue = valueForRule(job, rule);
                if ((rule.appliesTo === "serviceRevenue" || rule.appliesTo === "totalBill") && !countRevenue) {
                    baseValue = 0;
                }

                if (num(rule.minRevenue) > 0 && baseValue < num(rule.minRevenue)) return;

                const commissionAmount = calculateCommission(baseValue, rule);

                out.push({
                    dateString: job.dateString || "",
                    timeString: job.timeString || "",
                    jobId: job.id || "",
                    source: job._source || "",
                    clientName: job.clientName || job.name || "",
                    service: job.bookedService || job.serviceName || "",
                    roleKey: rule.roleKey || "",
                    roleName,
                    staffEmail: staff.email,
                    staffName: staff.name,
                    ruleId: rule.id || "",
                    commissionType: rule.commissionType || "",
                    appliesTo: rule.appliesTo || "",
                    baseRevenue,
                    baseValue,
                    grossServiceValue: countRevenue ? fin.grossServiceValue : 0,
                    complimentaryValue: countRevenue ? fin.complimentaryValue : 0,
                    netRevenue: countRevenue ? fin.netRevenue : 0,
                    commissionableRevenue: countRevenue ? fin.commissionableRevenue : 0,
                    commissionOnComplimentaryServices: fin.commissionOnComplimentaryServices === true,
                    commissionAmount,
                    status: "estimated"
                });
            });
        });

        return out;
    }

    async function ensureRulesLoaded() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const config = await targetApi.refresh();
        if (!isCurrent()) return;
        cachedRules = config.legacyRules;
        return cachedRules;
    }

    // ---------- Admin Dashboard ----------
    function renderDashboard() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const root = document.getElementById("com_content");
        if (!root) return;

        root.innerHTML = `
            <div class="com-note">
                <strong>Commission preview</strong> - incomplete days cannot be locked or paid.
            </div>

            <div class="com-filter-bar">
                <div class="form-group">
                    <label for="com_range">Quick Range</label>
                    <select id="com_range" onchange="com_setDashboardRange(this.value)">
                        <option value="today">Today</option>
                        <option value="week">Next 7 Days</option>
                        <option value="month">This Month</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div class="form-group"><label for="com_start">Start Date</label><input type="date" id="com_start"></div>
                <div class="form-group"><label for="com_end">End Date</label><input type="date" id="com_end"></div>
                <div class="form-group">
                    <label for="com_filterRole">Role</label>
                    <select id="com_filterRole">
                        <option value="all">All Roles</option>
                        <option value="tech">Technicians</option>
                        <option value="foh">FOH</option>
                        <option value="manager">Managers</option>
                        <option value="custom">Custom Roles</option>
                    </select>
                </div>
                <div class="form-group"><label for="com_person">Target Technician</label><select id="com_person"><option value="">All / Legacy</option></select></div>
                <div class="form-group"><label>&nbsp;</label><button class="com-btn primary" onclick="com_loadDashboard()">Load</button></div>
            </div>

            <div id="com_dashboardOutput" class="com-empty">Select filters and click Load.</div>
        `;

        setDashboardRange("today");
        for (const id of ["com_start", "com_end"]) document.getElementById(id).addEventListener("input", () => { document.getElementById("com_range").value = "custom"; });
        const selector = document.getElementById('com_person');
        targetApi.refresh().then(c => {
            if (!isCurrent() || !selector.isConnected) return;
            for (const p of c.persons) { const option = document.createElement('option'); option.value = p.personId; option.textContent = p.displayName; selector.append(option); }
        }).catch(e => {
            if (!isCurrent()) return;
            const out = document.getElementById('com_dashboardOutput');
            if (out) out.textContent = e.message;
        });
    }

    function setDashboardRange(type) {
        const today = todayStr();
        const start = document.getElementById("com_start");
        const end = document.getElementById("com_end");
        const range = document.getElementById("com_range");
        if (range) range.value = type;
        if (!start || !end) return;

        if (type === "today") { start.value = today; end.value = today; }
        else if (type === "week") { start.value = today; end.value = addDays(today, 6); }
        else if (type === "month") { start.value = monthStart(today); end.value = monthEnd(today); }
    }

    async function loadDashboard() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const out = document.getElementById("com_dashboardOutput");
        if (!out) return;
        const { start, end, roleFilter, personId } = currentDashboardDates();
        const token = ++commissionLoadToken;
        lastCommissionRows = []; lastCommissionReport = null;
        out.textContent = "Loading commissions...";
        try {
            const report = await targetApi.report(start, end, roleFilter, personId);
            if (!isCurrent()) return;
            if (token !== commissionLoadToken || !out.isConnected) return;
            lastCommissionReport = { ...report, start, end, roleFilter, personId };
            lastCommissionRows = [...report.rows, ...targetApi.dailyRows(report)];
            out.innerHTML = targetApi.summary(report.target.rows) + renderDashboardResults({ length: report.jobs }, { length: report.rules }, lastCommissionRows);
        } catch (e) { if (!isCurrent()) return; out.innerHTML = '<p role="alert">' + safe(e.message) + '</p>'; }
    }

    function renderDashboardResults(jobs, rules, rows) {
        const totalCommission = rows.reduce((s,r) => s + num(r.commissionAmount), 0);
        const staffCount = new Set(rows.map(r => r.personId || r.staffEmail)).size;
        const activeRulesUsed = countDisplayedRuleIds(rows);

        return `
            <div class="com-kpi-grid">
                <div class="com-kpi"><span>Closed Jobs</span><strong>${jobs.length}</strong></div>
                <div class="com-kpi"><span>Active Rules Used</span><strong>${activeRulesUsed}</strong></div>
                <div class="com-kpi"><span>Staff / Pools</span><strong>${staffCount}</strong></div>
                <div class="com-kpi"><span>Complete Awards Only</span><strong>${money(totalCommission)} GHC</strong>${rows.some(r => r.commissionAmount === null) ? '<div>Entitlement incomplete</div>' : ''}</div>
            </div>

            <div class="com-actions" style="border-top:none;padding-top:0;margin-top:0;margin-bottom:16px;">
                <button class="com-btn primary" onclick="com_lockCurrentCommissions()">🔒 Lock Commissions for This Period</button>
                <button class="com-btn" onclick="com_showTab('locked')">View Locked Records</button>
            </div>

            <div class="com-card" style="margin-bottom:16px;">
                <h3>Staff Summary</h3>
                ${renderStaffBreakdown(rows)}
            </div>

            <div class="com-card">
                <h3>Commission Detail</h3>
                ${renderCommissionTable(rows)}
            </div>
        `;
    }

    function countDisplayedRuleIds(rows) {
        return new Set((rows || []).map(r => String(r?.ruleId ?? "").trim()).filter(Boolean)).size;
    }

    function renderBreakdown() {
        const root = document.getElementById("com_content");
        if (!root) return;
        root.innerHTML = `
            <div class="com-note">Staff Breakdown uses the last loaded dashboard calculation.</div>
            <div class="com-actions" style="border-top:none;padding-top:0;margin-top:0;">
                <button class="com-btn primary" onclick="com_showTab('dashboard')">Go to Live Dashboard</button>
                <button class="com-btn" onclick="com_exportCommissionsCsv()">Export Last Calculation CSV</button>
            </div>
            <div id="com_breakdownOutput">${renderStaffBreakdown(lastCommissionRows)}</div>
        `;
    }

    // ---------- Tech My Commissions ----------
    function renderMyCommissions() {
        const root = document.getElementById("com_content");
        if (!root) return;

        root.innerHTML = `
            <div class="com-note">
                My Commissions shows the signed-in technician’s estimated commission from <strong>Closed</strong> jobs.
            </div>

            <div class="com-filter-bar">
                <div class="form-group">
                    <label for="mycom_range">Quick Range</label>
                    <select id="mycom_range" onchange="com_setMyRange(this.value)">
                        <option value="today">Today</option>
                        <option value="week">Next 7 Days</option>
                        <option value="month">This Month</option>
                        <option value="custom">Custom</option>
                    </select>
                </div>
                <div class="form-group"><label for="mycom_start">Start Date</label><input type="date" id="mycom_start"></div>
                <div class="form-group"><label for="mycom_end">End Date</label><input type="date" id="mycom_end"></div>
                <div class="form-group"><label>&nbsp;</label><button class="com-btn primary" onclick="com_loadMyCommissions()">Load My Report</button></div>
                <div class="form-group"><label>&nbsp;</label><button class="com-btn" onclick="com_exportMyCommissionsCsv()">Export My CSV</button></div>
            </div>

            <div id="mycom_output" class="com-empty">Click Load My Report.</div>
        `;
        setMyRange("today");
        for (const id of ["mycom_start", "mycom_end"]) document.getElementById(id).addEventListener("input", () => { document.getElementById("mycom_range").value = "custom"; });
    }

    function setMyRange(type) {
        const today = todayStr();
        const start = document.getElementById("mycom_start");
        const end = document.getElementById("mycom_end");
        const range = document.getElementById("mycom_range");
        if (range) range.value = type;
        if (!start || !end) return;

        if (type === "today") { start.value = today; end.value = today; }
        else if (type === "week") { start.value = today; end.value = addDays(today, 6); }
        else if (type === "month") { start.value = monthStart(today); end.value = monthEnd(today); }
    }

    async function loadMyCommissions() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const out = document.getElementById("mycom_output");
        if (!out) return;
        const start = document.getElementById("mycom_start")?.value || todayStr();
        const end = document.getElementById("mycom_end")?.value || start;
        window.__myCommissionRows = [];
        out.textContent = "Loading commissions...";
        try {
            const report = await targetApi.report(start, end, "tech");
            if (!isCurrent()) return;
            const rows = [...report.rows, ...targetApi.dailyRows(report)];
            window.__myCommissionRows = rows;
            out.innerHTML = targetApi.summary(report.target.rows) + renderMyResults(rows, start, end);
        } catch (e) { if (!isCurrent()) return; out.innerHTML = '<p role="alert">' + safe(e.message) + '</p>'; }
    }

    function renderMyResults(rows, start, end) {
        const jobs = targetApi.sourceJobCount(rows);
        const base = rows.reduce((s,r) => s + num(r.baseValue), 0);
        const commission = rows.reduce((s,r) => s + num(r.commissionAmount), 0);

        return `
            <div class="com-kpi-grid">
                <div class="com-kpi"><span>Period</span><strong>${safe(start)} → ${safe(end)}</strong></div>
                <div class="com-kpi"><span>Closed Jobs</span><strong>${jobs}</strong></div>
                <div class="com-kpi"><span>Commission Base</span><strong>${money(base)} GHC</strong></div>
                <div class="com-kpi"><span>My Complete Awards</span><strong>${money(commission)} GHC</strong>${rows.some(r => r.commissionAmount === null) ? '<div>Entitlement incomplete</div>' : ''}</div>
            </div>

            <div class="com-card">
                <h3>My Commission Detail</h3>
                ${renderCommissionTable(rows)}
            </div>
        `;
    }

    function exportMyCommissionsCsv() {
        const rows = window.__myCommissionRows || [];
        exportRowsCsv(rows, "thuraya-my-commissions");
    }

    async function loadMyTodayMini() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const out = document.getElementById("myComMiniContent");
        if (!out || !firebase.auth().currentUser) return;
        out.textContent = "Loading commissions...";
        try {
            const today = window.ThurayaCommissionEngine.today();
            const report = await targetApi.report(today, today, "tech");
            if (!isCurrent()) return;
            out.innerHTML = targetApi.summary(report.target.rows) + targetApi.renderDays(report.target.rows) + renderCommissionTable(report.rows);
        } catch (e) { if (!isCurrent()) return; out.innerHTML = '<p role="alert">' + safe(e.message) + '</p>'; }
    }

    function injectTechCommissionCard() {
        if (!window.ThurayaSessionResources.active()) return;
        if (!isTechUser()) return;
        const atelier = document.getElementById("atelierView");
        if (!atelier || document.getElementById("myComTechCard")) return;

        const card = document.createElement("div");
        card.id = "myComTechCard";
        card.className = "com-tech-card";
        card.innerHTML = `
            <h3>💰 My Commission Today</h3>
            <p style="margin:0;color:#666;font-size:.85rem;">Estimated from your closed jobs for today. Read-only.</p>
            <div id="myComMiniContent"><div class="com-empty" style="padding:10px;">Open/refresh to load.</div></div>
        `;

        atelier.insertBefore(card, atelier.firstChild);
        window.ThurayaSessionResources.timeout(loadMyTodayMini, 200);
    }

    function openMyCommissions() {
        let tab = document.getElementById("nav_commissions");
        const comTab = document.getElementById("tabCommissions");

        // Techs may not see the admin Commissions tab, so temporarily allow module opening.
        ensureCommissionShell();
        if (comTab && isTechUser() && !canAccessCommissionAdmin(firebase.auth().currentUser)) comTab.style.display = "flex";
        tab = document.getElementById("nav_commissions");
        if (tab) tab.checked = true;

        if (typeof switchModule === "function") switchModule("commissionsView");
        window.ThurayaSessionResources.timeout(() => renderShell("my"), 100);
    }

    // ---------- Rendering tables / CSV ----------
    function renderStaffBreakdown(rows) {
        const targetRows = rows.filter(r => r.model === 'DAILY_TARGET_MARGINAL');
        if (targetRows.length) return targetApi.renderPeople(targetRows) + (rows.some(r => !r.model) ? renderStaffBreakdown(rows.filter(r => !r.model)) : '');
        if (!rows || !rows.length) return `<div class="com-empty">No commission rows calculated yet.</div>`;

        const byStaff = {};
        rows.forEach(r => {
            const key = `${r.roleKey}:${r.staffEmail}`;
            if (!byStaff[key]) {
                byStaff[key] = { roleName:r.roleName, staffName:r.staffName, staffEmail:r.staffEmail, jobs:new Set(), baseValue:0, commissionAmount:0 };
            }
            byStaff[key].jobs.add(r.jobId);
            byStaff[key].baseValue += num(r.baseValue);
            byStaff[key].commissionAmount += num(r.commissionAmount);
        });

        const list = Object.values(byStaff).sort((a,b) => b.commissionAmount - a.commissionAmount);

        return `
            <div class="com-table-wrap">
                <table class="com-table">
                    <thead><tr><th>Role</th><th>Staff / Pool</th><th>Jobs</th><th>Base Value</th><th>Estimated Commission</th></tr></thead>
                    <tbody>
                        ${list.map(x => `
                            <tr>
                                <td>${safe(x.roleName)}</td>
                                <td><strong>${safe(x.staffName)}</strong><br><span style="color:#777;font-size:.76rem;">${safe(x.staffEmail)}</span></td>
                                <td>${x.jobs.size}</td>
                                <td>${money(x.baseValue)} GHC</td>
                                <td><strong>${money(x.commissionAmount)} GHC</strong></td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderCommissionTable(rows) {
        const targetRows = rows.filter(r => r.model === 'DAILY_TARGET_MARGINAL');
        if (targetRows.length) return targetApi.renderDays(targetRows) + (rows.some(r => !r.model) ? renderCommissionTable(rows.filter(r => !r.model)) : '');
        if (!rows.length) return `<div class="com-empty">No commission rows found. Confirm there are Closed jobs and active commission rules.</div>`;

        return `
            <div class="com-table-wrap">
                <table class="com-table">
                    <thead>
                        <tr><th>Date</th><th>Client</th><th>Service</th><th>Role</th><th>Staff</th><th>Applies To</th><th>Base</th><th>Commission</th></tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td>${safe(r.dateString)}<br><span style="color:#777;font-size:.76rem;">${safe(r.timeString)}</span></td>
                                <td>${safe(r.clientName)}</td>
                                <td>${safe(r.service)}</td>
                                <td>${safe(r.roleName)}</td>
                                <td><strong>${safe(r.staffName)}</strong><br><span style="color:#777;font-size:.76rem;">${safe(r.staffEmail)}</span></td>
                                <td>${safe(r.appliesTo)}</td>
                                <td>${money(r.baseValue)} GHC</td>
                                <td><strong>${money(r.commissionAmount)} GHC</strong></td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function exportRowsCsv(rows, prefix) {
        targetApi.exportRows(rows, prefix);
    }

    function csvEscape(v) {
        const s = String(v ?? "");
        return `"${s.replace(/"/g, '""')}"`;
    }

    function exportCommissionsCsv() {
        exportRowsCsv(lastCommissionRows, "thuraya-commissions");
    }

    // ---------- Phase 1 Rules Setup ----------
    function renderRulesSetup() {
        const root = document.getElementById("com_content");
        if (!root) return;

        root.innerHTML = `
            <details class="cv-legacy"><summary>Legacy Commission Rules</summary><div id="com_legacyWarning" class="com-note">Not used for Daily Target - Marginal commission. Legacy rule model. Minimum Revenue is not a daily target and does not calculate Daily Target - Marginal commission.</div>
            <div class="com-grid">
                <div class="com-card">
                    <h3 id="comFormTitle">Legacy Commission Rules</h3>
                    <input type="hidden" id="com_ruleId">
                    <div class="form-group">
                        <label>Role</label>
                        <select id="com_roleKey" onchange="com_onRoleChange()">
                            <option value="tech">Technician</option>
                            <option value="foh">Front of House</option>
                            <option value="manager">Manager</option>
                            <option value="custom">Custom / Future Role</option>
                        </select>
                    </div>
                    <div class="form-group" id="com_customRoleBox" style="display:none;">
                        <label>Custom Role Name</label>
                        <input type="text" id="com_customRoleName" placeholder="e.g. Senior Tech, Supervisor, Retail Lead">
                    </div>
                    <div class="com-form-row">
                        <div class="form-group">
                            <label>Commission Type</label>
                            <select id="com_commissionType" onchange="com_onTypeChange()">
                                <option value="percentage">Percentage</option>
                                <option value="fixed">Fixed Amount</option>
                                <option value="hybrid">Percentage + Fixed</option>
                                <option value="tiered">Tiered / Future</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Applies To</label>
                            <select id="com_appliesTo">
                                <option value="serviceRevenue">Service Revenue</option>
                                <option value="totalBill">Total Bill</option>
                                <option value="upsells">Upsells / Add-ons</option>
                                <option value="closedJobs">Closed Jobs Count</option>
                            </select>
                        </div>
                    </div>
                    <div class="com-form-row">
                        <div class="form-group"><label>Percentage (%)</label><input type="number" id="com_percentage" min="0" step="0.01" placeholder="e.g. 10"></div>
                        <div class="form-group"><label>Fixed Amount (GHC)</label><input type="number" id="com_fixedAmount" min="0" step="0.01" placeholder="e.g. 5"></div>
                    </div>
                    <div class="com-form-row">
                        <div class="form-group"><label>Minimum Revenue (optional)</label><input type="number" id="com_minRevenue" min="0" step="0.01" placeholder="0" aria-describedby="com_legacyWarning"></div>
                        <div class="form-group"><label>Priority</label><input type="number" id="com_priority" min="1" step="1" value="1"></div>
                    </div>
                    <div class="form-group" id="com_tierBox" style="display:none;">
                        <label>Tier Notes / Future Tier JSON</label>
                        <textarea id="com_tierNotes" rows="3" placeholder="Example: 0-1000 = 5%, 1001-3000 = 8%, 3000+ = 10%"></textarea>
                    </div>
                    <div class="form-group"><label>Notes</label><textarea id="com_notes" rows="3" placeholder="Internal note for this commission rule"></textarea></div>
                    <label style="display:flex;align-items:center;gap:8px;font-weight:700;color:var(--primary);margin-top:8px;">
                        <input type="checkbox" id="com_active" checked style="width:18px;height:18px;accent-color:var(--primary);"> Active rule
                    </label>
                    <div class="com-actions">
                        <button class="com-btn primary" onclick="com_saveRule()">Save Legacy Rule</button>
                        <button class="com-btn muted" onclick="com_resetForm()">Clear</button>
                        <button class="com-btn" onclick="com_seedStarterRules()">Create Starter Rules</button>
                    </div>
                </div>
                <div class="com-card">
                    <h3>Legacy Commission Rules Library</h3>
                    <div id="com_rulesList"><p style="color:#777;">Loading commission rules...</p></div>
                </div>
            </div>
            </details>
        `;

        renderRules(cachedRules);
        targetApi.mountRules(root);
        onRoleChange();
        onTypeChange();
    }

    function onRoleChange() {
        const role = document.getElementById("com_roleKey")?.value || "tech";
        const box = document.getElementById("com_customRoleBox");
        if (box) box.style.display = role === "custom" ? "block" : "none";
    }

    function onTypeChange() {
        const type = document.getElementById("com_commissionType")?.value || "percentage";
        const tierBox = document.getElementById("com_tierBox");
        const pct = document.getElementById("com_percentage");
        const fixed = document.getElementById("com_fixedAmount");
        if (tierBox) tierBox.style.display = type === "tiered" ? "block" : "none";
        if (pct) pct.disabled = type === "fixed";
        if (fixed) fixed.disabled = type === "percentage" || type === "tiered";
    }

    function resetForm() {
        editingRuleId = null;
        const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
        set("com_ruleId", ""); set("com_roleKey", "tech"); set("com_customRoleName", "");
        set("com_commissionType", "percentage"); set("com_appliesTo", "serviceRevenue");
        set("com_percentage", ""); set("com_fixedAmount", ""); set("com_minRevenue", "");
        set("com_priority", "1"); set("com_tierNotes", ""); set("com_notes", "");
        const active = document.getElementById("com_active"); if (active) active.checked = true;
        const title = document.getElementById("comFormTitle"); if (title) title.textContent = "Legacy Commission Rules";
        onRoleChange(); onTypeChange();
    }

    async function saveRule() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const user = firebase.auth().currentUser;
        if (!user) { alert("Please sign in again."); return; }

        const roleKey = document.getElementById("com_roleKey")?.value || "tech";
        const customRoleName = (document.getElementById("com_customRoleName")?.value || "").trim();
        const commissionType = document.getElementById("com_commissionType")?.value || "percentage";
        const appliesTo = document.getElementById("com_appliesTo")?.value || "serviceRevenue";

        if (roleKey === "custom" && !customRoleName) { alert("Please enter the custom role name."); return; }

        const percentage = num(document.getElementById("com_percentage")?.value);
        const fixedAmount = num(document.getElementById("com_fixedAmount")?.value);

        if ((commissionType === "percentage" || commissionType === "hybrid") && percentage <= 0) { alert("Please enter a percentage greater than 0."); return; }
        if ((commissionType === "fixed" || commissionType === "hybrid") && fixedAmount <= 0) { alert("Please enter a fixed amount greater than 0."); return; }

        const now = firebase.firestore.FieldValue.serverTimestamp();
        const payload = {
            roleKey, roleName: roleText(roleKey, customRoleName), customRoleName,
            commissionType, appliesTo, percentage, fixedAmount,
            minRevenue: num(document.getElementById("com_minRevenue")?.value),
            priority: Number(document.getElementById("com_priority")?.value || 1),
            tierNotes: document.getElementById("com_tierNotes")?.value || "",
            notes: document.getElementById("com_notes")?.value || "",
            active: document.getElementById("com_active")?.checked === true,
            updatedAt: now, updatedBy: user.email || ""
        };

        try {
            if (editingRuleId) {
                await targetApi.command({ action: "legacySaveRule", ruleId: editingRuleId, rule: payload });
                if (!isCurrent()) return;
                alert("Commission rule updated.");
            } else {
                payload.createdAt = now; payload.createdBy = user.email || "";
                await targetApi.command({ action: "legacySaveRule", rule: payload });
                if (!isCurrent()) return;
                alert("Commission rule created.");
            }
            resetForm();
            await ensureRulesLoaded();
            if (!isCurrent()) return; renderRules(cachedRules);
        } catch(e) { if (!isCurrent()) return;
            console.error("Commission rule save failed", e);
            alert("Could not save commission rule: " + e.message);
        }
    }

    async function editRule(id) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        try {
            await ensureRulesLoaded();
            if (!isCurrent()) return;
            const found = cachedRules.find(r => r.id === id);
            if (!found) { alert("Rule not found."); return; }
            const doc = { data: () => found };
            if (!document.getElementById("com_roleKey")) showTab("rules");

            const r = doc.data() || {};
            editingRuleId = id;
            const set = (field, val) => { const el = document.getElementById(field); if (el) el.value = val ?? ""; };
            set("com_ruleId", id); set("com_roleKey", r.roleKey || "tech"); set("com_customRoleName", r.customRoleName || "");
            set("com_commissionType", r.commissionType || "percentage"); set("com_appliesTo", r.appliesTo || "serviceRevenue");
            set("com_percentage", r.percentage || ""); set("com_fixedAmount", r.fixedAmount || "");
            set("com_minRevenue", r.minRevenue || ""); set("com_priority", r.priority || 1);
            set("com_tierNotes", r.tierNotes || ""); set("com_notes", r.notes || "");
            const active = document.getElementById("com_active"); if (active) active.checked = r.active !== false;
            const title = document.getElementById("comFormTitle"); if (title) title.textContent = "Edit Legacy Commission Rule";
            onRoleChange(); onTypeChange(); window.scrollTo({ top:0, behavior:"smooth" });
        } catch(e) { if (!isCurrent()) return;
            console.error("Commission edit failed", e);
            alert("Could not load rule: " + e.message);
        }
    }

    async function deleteRule(id) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!confirm("Delete this commission rule?")) return;
        try { await targetApi.command({ action: "legacyDeleteRule", ruleId: id });
        if (!isCurrent()) return; await ensureRulesLoaded();
        if (!isCurrent()) return; renderRules(cachedRules); }
        catch(e) { if (!isCurrent()) return; console.error("Commission delete failed", e); alert("Could not delete rule: " + e.message); }
    }

    async function toggleRule(id, active) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        try { await targetApi.command({ action: 'legacyToggleRule', ruleId: id, active });
        if (!isCurrent()) return; await ensureRulesLoaded();
        if (!isCurrent()) return; renderRules(cachedRules); }
        catch (e) { if (!isCurrent()) return; alert('Could not update rule: ' + e.message); }
    }

    async function seedStarterRules() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        alert('Enter explicit Commission Rules configuration. Automatic starter rates are not used.');
    }

    function attachRulesListener() {
        if (!window.ThurayaSessionResources.active()) return;
        if (unsubscribeRules) return;
        const refresh = async () => {
            const isCurrent = window.ThurayaSessionResources.capture();
            if (!isCurrent()) return;
            if (!document.getElementById('com_rulesList')) return;
            try { await ensureRulesLoaded();
            if (!isCurrent()) return; renderRules(cachedRules); }
            catch (e) { if (!isCurrent()) return; const list = document.getElementById('com_rulesList'); if (list) list.textContent = e.message; }
        };
        const timer = window.ThurayaSessionResources.interval("commissions.rules", refresh, 30000);
        unsubscribeRules = () => window.ThurayaSessionResources.clearTimer(timer);
        refresh();
    }

    function renderRules(rows) {
        rows = rows.filter(r => r.schemaVersion !== 2 && !r.deleted);
        const list = document.getElementById("com_rulesList");
        if (!list) return;

        if (!rows.length) {
            list.innerHTML = `<div class="com-note">No legacy commission rules configured.</div>`;
            return;
        }

        list.innerHTML = `
            <div class="com-table-wrap"><table class="com-table">
                <thead><tr><th>Status</th><th>Role</th><th>Type</th><th>Applies To</th><th>Rate</th><th>Priority</th><th>Actions</th></tr></thead>
                <tbody>
                    ${rows.map(r => {
                        const rateText = r.commissionType === "percentage" ? `${num(r.percentage)}%` :
                            r.commissionType === "fixed" ? `${num(r.fixedAmount).toFixed(2)} GHC` :
                            r.commissionType === "hybrid" ? `${num(r.percentage)}% + ${num(r.fixedAmount).toFixed(2)} GHC` : "Tiered";
                        return `
                            <tr>
                                <td><span class="com-badge ${r.active === false ? "inactive" : "active"}">${r.active === false ? "Inactive" : "Active"}</span></td>
                                <td><strong>${safe(r.roleName || roleText(r.roleKey, r.customRoleName))}</strong>${r.notes ? `<div style="font-size:.76rem;color:#777;margin-top:4px;">${safe(r.notes)}</div>` : ""}</td>
                                <td>${safe(r.commissionType || "")}</td>
                                <td>${safe(r.appliesTo || "")}</td>
                                <td><strong>${safe(rateText)}</strong></td>
                                <td>${safe(r.priority || 1)}</td>
                                <td><div class="com-inline-actions">
                                    <button class="com-small-btn" onclick="com_editRule('${r.id}')">Edit</button>
                                    <button class="com-small-btn" onclick="com_toggleRule('${r.id}', ${r.active === false ? "true" : "false"})">${r.active === false ? "Activate" : "Disable"}</button>
                                    <button class="com-small-btn" style="color:var(--error);" onclick="com_deleteRule('${r.id}')">Delete</button>
                                </div></td>
                            </tr>`;
                    }).join("")}
                </tbody>
            </table></div>`;
    }


    // ---------- Phase 4: Locking / Official Records ----------
    function currentDashboardDates() {
        return {
            start: document.getElementById("com_start")?.value || todayStr(),
            end: document.getElementById("com_end")?.value || (document.getElementById("com_start")?.value || todayStr()),
            roleFilter: document.getElementById("com_filterRole")?.value || "all",
            personId: document.getElementById('com_person')?.value || null
        };
    }

    function lockPeriodId(start, end, roleFilter) {
        return `${start}_${end}_${roleFilter || "all"}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    }

    function summarizeCommissionRows(rows) {
        const summary = {};
        rows.forEach(r => {
            const key = `${r.roleKey || "unknown"}:${r.staffEmail || "unknown"}`;
            if (!summary[key]) {
                summary[key] = {
                    roleKey: r.roleKey || "",
                    roleName: r.roleName || "",
                    staffEmail: r.staffEmail || "",
                    staffName: r.staffName || "",
                    jobIds: [],
                    jobCount: 0,
                    baseValue: 0,
                    commissionAmount: 0
                };
            }

            if (r.jobId && !summary[key].jobIds.includes(r.jobId)) {
                summary[key].jobIds.push(r.jobId);
            }

            summary[key].baseValue += num(r.baseValue);
            summary[key].commissionAmount += num(r.commissionAmount);
        });

        Object.values(summary).forEach(s => s.jobCount = s.jobIds.length);
        return Object.values(summary).sort((a,b) => b.commissionAmount - a.commissionAmount);
    }

    async function checkExistingLock(start, end, roleFilter) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const result = await targetApi.call({ action: 'records' });
        if (!isCurrent()) return;
        return result.locks.find(l => l.periodStart <= end && start <= l.periodEnd && (roleFilter === 'all' || l.roleFilter === 'all' || l.roleFilter === roleFilter)) || null;
    }

    async function lockCurrentCommissions() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const dates = currentDashboardDates();
        if (!lastCommissionReport || ['start', 'end', 'roleFilter', 'personId'].some(k => dates[k] !== lastCommissionReport[k])) return alert('Reload the report before locking.');
        if (!confirm('Lock the complete displayed commission days?')) return;
        try {
            await targetApi.lock(lastCommissionReport, dates.start, dates.end, dates.roleFilter, dates.personId);
            if (!isCurrent()) return;
            lastCommissionReport = null;
            showTab('locked');
        } catch (e) { if (!isCurrent()) return; alert(e.message); }
    }

    async function loadLockedRecords() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const out = document.getElementById("com_lockedOutput");
        if (!out) return;

        out.innerHTML = `<div class="com-empty">Loading locked commission records...</div>`;

        try {
            const { locks } = await targetApi.call({ action: "records" });
            if (!isCurrent()) return;

            locks.sort((a,b) => String(b.periodStart || "").localeCompare(String(a.periodStart || "")));

            if (!locks.length) {
                out.innerHTML = `<div class="com-empty">No locked commission periods yet.</div>`;
                return;
            }

            out.innerHTML = `
                <div class="com-table-wrap">
                    <table class="com-table">
                        <thead>
                            <tr>
                                <th>Period</th>
                                <th>Role Filter</th>
                                <th>Status</th>
                                <th>Rows</th>
                                <th>Staff/Pool</th>
                                <th>Total Commission</th>
                                <th>Locked By</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${locks.map(l => `
                                <tr>
                                    <td><strong>${safe(l.periodStart)} → ${safe(l.periodEnd)}</strong></td>
                                    <td>${safe(l.roleFilter || "all")}</td>
                                    <td><span class="com-badge active">${safe(l.status || "locked")}</span></td>
                                    <td>${safe(l.rowCount || 0)}</td>
                                    <td>${safe(l.staffCount || 0)}</td>
                                    <td><strong>${money(l.totalCommission)} GHC</strong></td>
                                    <td>${safe(l.lockedBy || "")}</td>
                                    <td>
                                        <div class="com-inline-actions">
                                            <button class="com-small-btn" onclick="com_viewLockedRecords('${l.id}')">View</button>
                                            <button class="com-small-btn" onclick="com_exportLockedCsv('${l.id}')">Export CSV</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        } catch(e) { if (!isCurrent()) return;
            console.error("Load locked records failed", e);
            out.innerHTML = `<div class="com-note" style="border-left-color:var(--error);">Could not load locked records.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    async function viewLockedRecords(lockId) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const out = document.getElementById("com_lockedDetail");
        if (!out) return;

        out.innerHTML = `<div class="com-empty">Loading details...</div>`;

        try {
            const { records } = await targetApi.call({ action: "records", lockId });
            if (!isCurrent()) return;

            records.sort((a,b) => num(b.commissionAmount) - num(a.commissionAmount));

            if (!records.length) {
                out.innerHTML = `<div class="com-empty">No detail records found for this lock.</div>`;
                return;
            }

            out.innerHTML = `
                <div class="com-card" style="margin-top:16px;">
                    <h3>Locked Record Detail</h3>
                    <div class="com-table-wrap">
                        <table class="com-table">
                            <thead>
                                <tr>
                                    <th>Role</th>
                                    <th>Staff / Pool</th>
                                    <th>Jobs</th>
                                    <th>Base Value</th>
                                    <th>Commission</th>
                                    <th>Payout Status</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${records.map(r => `
                                    <tr>
                                        <td>${safe(r.roleName || r.roleKey)}</td>
                                        <td><strong>${safe(r.staffName)}</strong><br><span style="color:#777;font-size:.76rem;">${safe(r.staffEmail)}</span></td>
                                        <td>${safe(r.jobCount || 0)}</td>
                                        <td>${money(r.baseValue)} GHC</td>
                                        <td><strong>${money(r.commissionAmount)} GHC</strong></td>
                                        <td><span class="com-badge ${r.payoutStatus === "paid" ? "active" : ""}">${safe(r.payoutStatus || "pending")}</span></td>
                                        <td>
                                            <div class="com-inline-actions">
                                                <button class="com-small-btn" onclick="com_markCommissionPaid('${r.id}')">Mark Paid</button>
                                            </div>
                                        </td>
                                    </tr>
                                `).join("")}
                            </tbody>
                        </table>
                    </div>
                </div>
            `;
            out.innerHTML += targetApi.renderDays(records.filter(r => r.schemaVersion === 2).map(r => ({ ...r.calculation, ...r.auditCurrent, locked: true })));
        } catch(e) { if (!isCurrent()) return;
            console.error("View locked records failed", e);
            out.innerHTML = `<div class="com-note" style="border-left-color:var(--error);">Could not load locked detail.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    async function markCommissionPaid(recordId) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!confirm('Mark this locked commission record as paid?')) return;
        try { await targetApi.refresh();
        if (!isCurrent()) return; await targetApi.command({ action: 'markPaid', recordId });
        if (!isCurrent()) return; alert('Commission marked as paid.'); }
        catch (e) { if (!isCurrent()) return; alert(e.message); }
    }

    async function exportLockedCsv(lockId) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        try {
            const result = await targetApi.call({ action: 'records', lockId });
            if (!isCurrent()) return;
            const rows = result.records.filter(r => !isArchivedRecord(r));
            if (rows.some(r => r.schemaVersion === 2)) {
                targetApi.exportRows(rows.flatMap(r => r.calculation ? [{ ...r.calculation, ...r.auditCurrent, model: 'DAILY_TARGET_MARGINAL' }] : r.rows || []), 'thuraya-locked-commissions');
                return;
            }

            if (!rows.length) {
                alert("No records found for this lock.");
                return;
            }

            const headers = ["Lock ID","Period Start","Period End","Role","Staff Name","Staff Email","Jobs","Base Value","Commission Amount","Payout Status"];
            const lines = [headers.map(csvEscape).join(",")];

            rows.forEach(r => {
                lines.push([
                    r.lockId, r.periodStart, r.periodEnd, r.roleName || r.roleKey,
                    r.staffName, r.staffEmail, r.jobCount,
                    money(r.baseValue), money(r.commissionAmount), r.payoutStatus || "pending"
                ].map(csvEscape).join(","));
            });

            const blob = new Blob([lines.join("\n")], { type:"text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `thuraya-locked-commissions-${lockId}.csv`;
            a.click();
            URL.revokeObjectURL(url);
        } catch(e) { if (!isCurrent()) return;
            console.error("Locked CSV export failed", e);
            alert("Could not export locked records: " + e.message);
        }
    }

    function renderLockedRecords() {
        const root = document.getElementById("com_content");
        if (!root) return;

        root.innerHTML = `
            <div class="com-note">
                Locked records are official payable commission snapshots. They remain stable even if commission rules are edited later.
            </div>

            <div class="com-actions" style="border-top:none;padding-top:0;margin-top:0;margin-bottom:14px;">
                <button class="com-btn primary" onclick="com_loadLockedRecords()">Refresh Locked Records</button>
            </div>

            <div class="com-card">
                <h3>Locked Commission Periods</h3>
                <div id="com_lockedOutput" class="com-empty">Click Refresh Locked Records.</div>
            </div>

            <div id="com_lockedDetail"></div>
        `;

        window.ThurayaSessionResources.timeout(loadLockedRecords, 100);
    }

    function init() {
        if (!window.ThurayaSessionResources.active()) return;
        ensureCommissionShell();
        renderShell("dashboard");
    }

    function patchSwitchModule() {
        if (window.__comSwitchPatched) return;
        if (typeof window.switchModule !== "function") return;

        const originalSwitchModule = window.switchModule;
        window.switchModule = function(moduleId) {
            originalSwitchModule(moduleId);
            if (moduleId === "commissionsView") window.ThurayaSessionResources.timeout(init, 50);
            if (moduleId === "atelierView") window.ThurayaSessionResources.timeout(injectTechCommissionCard, 350);
        };

        window.__comSwitchPatched = true;
    }

    function boot() {
        ensureCommissionShell();
        patchSwitchModule();

        window.ThurayaSessionResources.onStart("commissions", () => {
            window.ThurayaSessionResources.timeout(() => updateCommissionsTabVisibility(firebase.auth().currentUser), 900);
        });
    }


    window.ThurayaSessionResources.onStop("commissions", () => {
        if (unsubscribeRules) unsubscribeRules();
        unsubscribeRules = null;
        currentComUser = null;
        currentComRoles = [];
        cachedRules = [];
        lastCommissionRows = [];
        lastCommissionReport = null;
        editingRuleId = null;
        commissionLoadToken++;
        window.__myCommissionRows = [];
        document.getElementById("myComTechCard")?.remove();
        for (const id of ["commissionsView"]) {
            const node = document.getElementById(id);
            if (node) node.innerHTML = "";
        }
        const tab = document.getElementById("tabCommissions");
        if (tab) tab.style.display = "none";
    });

    window.com_lockCurrentCommissions = lockCurrentCommissions;
    window.com_loadLockedRecords = loadLockedRecords;
    window.com_viewLockedRecords = viewLockedRecords;
    window.com_markCommissionPaid = markCommissionPaid;
    window.com_exportLockedCsv = exportLockedCsv;

    window.com_init = init;
    window.com_showTab = showTab;
    window.com_setDashboardRange = setDashboardRange;
    window.com_loadDashboard = loadDashboard;
    window.com_exportCommissionsCsv = exportCommissionsCsv;
    window.com_setMyRange = setMyRange;
    window.com_loadMyCommissions = loadMyCommissions;
    window.com_exportMyCommissionsCsv = exportMyCommissionsCsv;
    window.com_loadMyTodayMini = loadMyTodayMini;
    window.com_openMyCommissions = openMyCommissions;

    window.com_onRoleChange = onRoleChange;
    window.com_onTypeChange = onTypeChange;
    window.com_saveRule = saveRule;
    window.com_resetForm = resetForm;
    window.com_editRule = editRule;
    window.com_deleteRule = deleteRule;
    window.com_toggleRule = toggleRule;
    window.com_seedStarterRules = seedStarterRules;

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();
