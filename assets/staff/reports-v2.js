
// ============================================================
// THURAYA REPORTS V2 — CLEAN REWRITE
// Version: reports-v2-rewrite-20260425
// Separate module. Does not modify booking/billing/attendance logic.
// Uses simple date-range queries to avoid Firestore composite indexes.
// ============================================================
console.log("✅ Reports V2 loaded: full-upgrade-audit-visible-20260503");

(function () {
    const RPT = {
        activeTab: "upcoming",
        rows: [],
        techsLoaded: false
    };

    function todayStr() {
        if (typeof todayDateStr !== "undefined" && todayDateStr) return todayDateStr;
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
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

    function num(v) {
        const n = Number(parseFloat(v || 0));
        return Number.isFinite(n) ? n : 0;
    }

    function money(v) {
        if (v === null || v === undefined) return "Unavailable";
        return num(v).toFixed(2);
    }

    function sumFinancial(a, b) {
        return a === null || b === null ? null : window.thFinancialEvidence.sumMoney([a, b]);
    }

    function safe(v) {
        return String(v ?? "").replace(/[&<>"']/g, s => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[s]));
    }

    function isArchivedRecord(row) {
        return row?.archived === true;
    }

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

    function isGroup(row) {
        return row?.isGroupBooking === true || !!row?.groupId;
    }

    function isLead(row) {
        return row?.isLeadBooker === true ||
               row?.groupRole === "lead" ||
               row?.payableBy === "lead_booker" ||
               row?.payableBy === "lead_booker_final_bill";
    }

    function normalizedReportStatus(value) {
        return String(value || "").trim().toLowerCase();
    }

    function isRealizedSale(row) {
        const status = normalizedReportStatus(row?.status);
        const paymentStatus = normalizedReportStatus(row?.paymentStatus);

        if (status === "cancelled" || status === "canceled" || status === "no show") return false;
        if (status === "closed" || status === "paid") return true;
        if (paymentStatus === "paid") return true;

        return false;
    }

    function fallbackFinancials(row) {
        const evidence = window.thFinancialEvidence.read(row || {});

        return {
            grossServiceValue: evidence.gross,
            complimentaryValue: 0,
            netRevenue: evidence.net,
            taxableSubtotal: evidence.net,
            taxTotal: evidence.tax.available ? evidence.tax.taxTotal : null,
            paidAmount: evidence.paid,
            commissionableRevenue: null,
            hasComplimentaryAdjustment: false,
            isFullyComplimentary: false,
            isMixedComplimentary: false,
            commissionOnComplimentaryServices: false,
            originalTotalsSource: "reports-v2-fallback",
            warnings: ["normalizer-unavailable"]
        };
    }

    function financials(row) {
        let out = null;
        if (typeof window.normalizeComplimentaryFinancials === "function") {
            try {
                out = window.normalizeComplimentaryFinancials(row || {});
            } catch(e) {
                console.warn("Reports V2 financial normalizer fallback", e);
            }
        }

        if (!out || typeof out !== "object") out = fallbackFinancials(row || {});

        const evidence = window.thFinancialEvidence.read(row || {});
        const original = row?.complimentaryOriginalTotals
            ? window.thFinancialEvidence.read({ ...row.complimentaryOriginalTotals,
                serviceLineItems: row.complimentaryOriginalServiceLineItems || [] }) : evidence;

        return {
            grossServiceValue: original.gross,
            complimentaryValue: num(out.complimentaryValue),
            netRevenue: evidence.net,
            taxableSubtotal: evidence.net,
            adjustedGross: evidence.finalGross,
            amountDue: evidence.due,
            taxTotal: evidence.tax.available ? evidence.tax.taxTotal : window.thFinancialEvidence.firstAmount(row, ["taxTotal"]),
            paidAmount: reportPaidAmount(row, evidence.paid),
            commissionableRevenue: num(out.commissionableRevenue),
            hasComplimentaryAdjustment: out.hasComplimentaryAdjustment === true,
            isFullyComplimentary: out.isFullyComplimentary === true,
            isMixedComplimentary: out.isMixedComplimentary === true,
            originalTotalsSource: out.originalTotalsSource || "",
            warnings: Array.isArray(out.warnings) ? out.warnings : []
        };
    }

    function revenue(row) {
        return realizedFinancials(row).netRevenue;
    }

    function reportPaidAmount(row, paid) {
        if (!isGroup(row)) return paid;
        const api = window.thFinancialEvidence;
        for (const key of ["paidAmount", "amountPaid"]) {
            if (row[key] !== undefined && row[key] !== null) return paid;
        }
        const scope = row.financialReceiptScope;
        const id = String(String(row._source || "").startsWith("Appointments") ? row.activeJobId || "" : row.id || "");
        if (!id || !Array.isArray(scope?.jobIds)) return null;
        if (scope.type === "member" && scope.jobIds.length === 1 && scope.jobIds[0] === id) return paid;
        if (scope.type === "group" && row.settlementFinancialSnapshot && scope.jobIds.includes(id)) {
            const collected = api.receiptPaid(row);
            if (collected !== null) return row.settlementPayerJobId === id ? collected : 0;
        }
        // Legacy group totalGHC/splits can be copied to every member; unknown collection scope is not zero.
        return null;
    }

    function billingMode(row) {
        return row.billingMode || row.groupCheckoutType || row.billingScenario || "";
    }

    function revenueKey(row) {
        return row.id ? JSON.stringify([row._source || "", row.id]) : row;
    }

    function shouldCountRevenue(row, seen) {
        const key = revenueKey(row);
        // Service evidence belongs to each source record, not its payer group or subgroup.
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }

    function zeroFinancials(row) {
        const f = financials(row);
        return {
            ...f,
            grossServiceValue: 0,
            complimentaryValue: 0,
            netRevenue: 0,
            taxableSubtotal: 0,
            adjustedGross: 0,
            amountDue: 0,
            taxTotal: 0,
            paidAmount: 0,
            commissionableRevenue: 0
        };
    }

    function realizedFinancials(row) {
        if (!isRealizedSale(row)) return zeroFinancials(row);
        return financials(row);
    }

    function shouldCountRealizedRevenue(row, seen) {
        return isRealizedSale(row) && shouldCountRevenue(row, seen);
    }

    function computedRevenue(rows) {
        return computedFinancials(rows).netRevenue;
    }

    function computedFinancials(rows) {
        const seen = new Set();
        const totals = (rows || []).reduce((sum, r) => {
            if (!shouldCountRealizedRevenue(r, seen)) return sum;
            const f = realizedFinancials(r);
            sum.grossServiceValue = sumFinancial(sum.grossServiceValue, f.grossServiceValue);
            sum.complimentaryValue += f.complimentaryValue;
            sum.netRevenue = sumFinancial(sum.netRevenue, f.netRevenue);
            sum.adjustedGross = sumFinancial(sum.adjustedGross, f.adjustedGross);
            sum.amountDue = sumFinancial(sum.amountDue, f.amountDue);
            sum.taxTotal = sumFinancial(sum.taxTotal, f.taxTotal);
            sum.paidAmount = sumFinancial(sum.paidAmount, f.paidAmount);
            sum.commissionableRevenue += f.commissionableRevenue;
            sum.realizedSaleCount += 1;
            return sum;
        }, {
            grossServiceValue: 0,
            complimentaryValue: 0,
            netRevenue: 0,
            adjustedGross: 0,
            amountDue: 0,
            taxTotal: 0,
            paidAmount: 0,
            commissionableRevenue: 0,
            realizedSaleCount: 0
        });
        totals.unavailableFields = Object.keys(totals).filter(key => totals[key] === null);
        totals.partial = totals.unavailableFields.length > 0;
        return totals;
    }

    function avgSpend(rows) {
        const totals = computedFinancials(rows);
        return totals.netRevenue === null ? null : totals.netRevenue / Math.max(1, totals.realizedSaleCount);
    }

    function statusCounts(rows) {
        const out = {};
        rows.forEach(r => {
            const s = r.status || "Unknown";
            out[s] = (out[s] || 0) + 1;
        });
        return out;
    }

    async function fetchDateRange(collection, start, end) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        // Reports V2 remains service-date based; realized-sales gating happens during aggregation.
        const snap = await db.collection(collection)
            .where("dateString", ">=", start)
            .where("dateString", "<=", end)
            .get();
            if (!isCurrent()) return;

        const rows = [];
        snap.forEach(doc => {
            const row = { id: doc.id, _source: collection, ...doc.data() };
            if (!isArchivedRecord(row)) rows.push(row);
        });
        return rows;
    }

    function filterRows(rows) {
        const tech = document.getElementById("rptv2_tech")?.value || "all";
        const status = document.getElementById("rptv2_status")?.value || "all";
        const group = document.getElementById("rptv2_group")?.value || "all";

        return rows.filter(r => {
            if (tech !== "all" && r.assignedTechEmail !== tech) return false;
            if (status !== "all" && (r.status || "") !== status) return false;
            if (group === "groups" && !isGroup(r)) return false;
            if (group === "solo" && isGroup(r)) return false;
            return true;
        });
    }

    function currentRange() {
        const start = document.getElementById("rptv2_start")?.value || todayStr();
        const end = document.getElementById("rptv2_end")?.value || start;
        return { start, end };
    }

    function setRange(type) {
        const today = todayStr();
        const start = document.getElementById("rptv2_start");
        const end = document.getElementById("rptv2_end");
        if (!start || !end) return;

        if (type === "today") {
            start.value = today;
            end.value = today;
        } else if (type === "week") {
            start.value = today;
            end.value = addDays(today, 6);
        } else if (type === "month") {
            start.value = monthStart(today);
            end.value = monthEnd(today);
        }
    }


    function setRangeUI(type) {
        setRange(type);
        document.querySelectorAll(".rptv2-range-btn").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.range === type);
        });
    }

    function setDefaultFiltersForTab() {
        const status = document.getElementById("rptv2_status");
        const group = document.getElementById("rptv2_group");

        if (status) {
            // Upcoming is the only tab where Scheduled makes sense by default.
            // Audit defaults to Closed because audit reports should be financial/completed records.
            if (RPT.activeTab === "upcoming") status.value = "Scheduled";
            else if (RPT.activeTab === "audit") status.value = "Closed";
            else status.value = "all";
        }

        if (group) group.value = "all";
    }

    async function ensureTechOptions() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const sel = document.getElementById("rptv2_tech");
        if (!sel) return;

        const current = sel.value || "all";
        let techs = Array.isArray(window.allTechs || allTechs) ? (window.allTechs || allTechs) : [];

        if (!techs.length) {
            try {
                const snap = await db.collection("Users").get();
                if (!isCurrent()) return;
                techs = [];
                snap.forEach(doc => {
                    const d = doc.data() || {};
                    const roles = (Array.isArray(d.roles) ? d.roles : [d.role || ""]).map(r => String(r).toLowerCase());
                    if (roles.some(r => r.includes("tech"))) {
                        techs.push({ email: doc.id, name: d.name || doc.id });
                    }
                });
            } catch(e) { if (!isCurrent()) return;
                console.warn("Could not load techs for reports", e);
            }
        }

        sel.innerHTML = `<option value="all">All Technicians</option>` +
            techs.map(t => `<option value="${safe(t.email)}">${safe(t.name || t.email)}</option>`).join("");

        sel.value = current;
    }


    function injectReportStyles() {
        if (document.getElementById("rptv2MenuStyles")) return;
        const st = document.createElement("style");
        st.id = "rptv2MenuStyles";
        st.textContent = `
            .rptv2-menu-grid {
                display: grid;
                grid-template-columns: repeat(3, minmax(0, 1fr));
                gap: 14px;
                margin: 20px 0;
            }

            .rptv2-menu-card {
                display: flex;
                align-items: flex-start;
                gap: 12px;
                width: 100%;
                text-align: left;
                background: #fff;
                border: 1px solid var(--border);
                border-radius: 10px;
                padding: 16px;
                cursor: pointer;
                transition: all 0.18s ease;
                box-shadow: 0 2px 8px rgba(0,0,0,0.04);
                color: var(--primary);
            }

            .rptv2-menu-card:hover {
                transform: translateY(-1px);
                border-color: var(--accent);
                box-shadow: 0 6px 18px rgba(0,0,0,0.08);
            }

            .rptv2-menu-card.active {
                background: var(--primary);
                border-color: var(--primary);
                color: #fff;
                box-shadow: 0 8px 22px rgba(47, 59, 79, 0.22);
            }

            .rptv2-menu-icon {
                width: 42px;
                height: 42px;
                border-radius: 12px;
                background: rgba(201,168,76,0.12);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.35rem;
                flex-shrink: 0;
            }

            .rptv2-menu-card.active .rptv2-menu-icon {
                background: rgba(255,255,255,0.16);
            }

            .rptv2-menu-copy {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }

            .rptv2-menu-copy strong {
                font-size: 0.95rem;
                letter-spacing: 0.02em;
            }

            .rptv2-menu-copy span {
                font-size: 0.78rem;
                color: #666;
                line-height: 1.35;
            }

            .rptv2-menu-card.active .rptv2-menu-copy span {
                color: rgba(255,255,255,0.82);
            }


            .rptv2-action-bar {
                display: flex;
                gap: 12px;
                flex-wrap: wrap;
                align-items: center;
                justify-content: flex-start;
                margin-top: 18px;
                padding-top: 14px;
                border-top: 1px solid var(--border);
            }

            .rptv2-action-btn {
                width: auto;
                min-width: 150px;
                border-radius: 8px;
                padding: 11px 18px;
                font-size: 0.82rem;
                font-weight: 800;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                cursor: pointer;
                transition: all 0.18s ease;
            }

            .rptv2-action-btn.primary {
                background: var(--primary);
                color: #fff;
                border: 1px solid var(--primary);
                box-shadow: 0 5px 14px rgba(47,59,79,0.16);
            }

            .rptv2-action-btn.primary:hover {
                transform: translateY(-1px);
                box-shadow: 0 8px 20px rgba(47,59,79,0.22);
            }

            .rptv2-action-btn.secondary {
                background: #fff;
                color: var(--primary);
                border: 1px solid var(--border);
            }

            .rptv2-action-btn.secondary:hover {
                border-color: var(--accent);
                color: var(--accent);
                background: #fffaf0;
            }


            /* ===== Quick Range refined segmented control - UI only ===== */
            .rptv2-range-group {
                display: inline-flex;
                width: 100%;
                min-height: 42px;
                border: 1px solid var(--border);
                border-radius: 10px;
                overflow: hidden;
                background: #fff;
                box-shadow: 0 1px 3px rgba(0,0,0,0.03);
            }

            .rptv2-range-btn {
                flex: 1;
                border: 0;
                border-right: 1px solid var(--border);
                background: #fff;
                color: var(--primary);
                font-size: 0.78rem;
                font-weight: 900;
                letter-spacing: 0.08em;
                text-transform: uppercase;
                cursor: pointer;
                transition: all 0.16s ease;
            }

            .rptv2-range-btn:last-child {
                border-right: 0;
            }

            .rptv2-range-btn:hover {
                background: #f8f9fb;
            }

            .rptv2-range-btn.active {
                background: var(--primary);
                color: #fff;
                box-shadow: inset 0 0 0 1px rgba(255,255,255,0.08);
            }

            @media (max-width: 620px) {
                .rptv2-action-bar {
                    flex-direction: column;
                    align-items: stretch;
                }

                .rptv2-action-btn {
                    width: 100%;
                }
            }




            .rptv2-audit-hero {
                background:#fff;
                border:1px solid var(--border);
                border-left:5px solid var(--accent);
                border-radius:14px;
                padding:18px;
                margin:16px 0;
                box-shadow:0 8px 22px rgba(47,59,79,0.06);
            }
            .rptv2-audit-hero h2 {
                margin:0 0 6px;
                color:var(--primary);
                letter-spacing:0.04em;
            }
            .rptv2-audit-hero p {
                margin:0 0 14px;
                color:#666;
                font-size:0.88rem;
            }
            .rptv2-audit-grid {
                display:grid;
                grid-template-columns:repeat(auto-fit,minmax(160px,1fr));
                gap:12px;
                margin-top:12px;
            }
            .rptv2-audit-section {
                background:#fff;
                border:1px solid var(--border);
                border-radius:12px;
                padding:15px;
                margin-top:14px;
            }
            .rptv2-audit-section h3 {
                margin-top:0;
                color:var(--primary);
                border-bottom:1px solid var(--border);
                padding-bottom:8px;
            }
            @media print {
                #topNavMenu, #properClockPanel, .dashboard-header, .rptv2-menu-grid, .rptv2-action-bar, .rptv2-range-group button, .form-group select, .form-group input { }
                .rptv2-menu-grid, .rptv2-action-bar { display:none !important; }
                #reportsView { display:block !important; }
            }
            @media (max-width: 760px) {
                .rptv2-audit-grid { grid-template-columns:1fr; }
            }

            @media (max-width: 980px) {
                .rptv2-menu-grid {
                    grid-template-columns: repeat(2, minmax(0, 1fr));
                }
            }

            @media (max-width: 620px) {
                .rptv2-menu-grid {
                    grid-template-columns: 1fr;
                }
            }
        `;
        document.head.appendChild(st);
    }

    function renderShell() {
        if (!window.ThurayaSessionResources.active()) return;
        const reportsView = document.getElementById("reportsView");
        if (!reportsView) return;

        reportsView.innerHTML = `
            <div class="module-box" style="max-width:1200px;margin:24px auto;">
                <div class="rptv2-menu-grid">
                    ${tabButton("upcoming", "📅", "Upcoming Bookings", "Scheduled appointments and group bookings")}
                    ${tabButton("daily", "📋", "Daily Operations", "Closed jobs, pending jobs, revenue and status")}
                    ${tabButton("monthly", "📈", "Weekly / Monthly Revenue", "Revenue, group billing and trend review")}
                    ${tabButton("audit", "🧾", "Audit Report", "Date range audit, revenue control and print summary")}
                    ${tabButton("tech", "👷", "Tech Performance", "Jobs, minutes and revenue by technician")}
                    ${tabButton("client", "👥", "Client Intelligence", "Client visits, spend and repeat activity")}
                    ${tabButton("attendance", "🌿", "Leave & Attendance", "Attendance and lunch break records")}
                </div>

                <div class="module-box" style="background:#fafafa;border:1px solid var(--border);">
                    <div class="grid-3">
                        <div class="form-group">
                            <label>Start Date</label>
                            <input type="date" id="rptv2_start">
                        </div>
                        <div class="form-group">
                            <label>End Date</label>
                            <input type="date" id="rptv2_end">
                        </div>
                        <div class="form-group">
                            <label>Technician</label>
                            <select id="rptv2_tech"><option value="all">All Technicians</option></select>
                        </div>
                        <div class="form-group">
                            <label>Status</label>
                            <select id="rptv2_status">
                                <option value="all" selected>All Statuses</option>
                                <option value="Scheduled">Scheduled</option>
                                <option value="Arrived">Arrived</option>
                                <option value="Waiting">Waiting</option>
                                <option value="In Progress">In Progress</option>
                                <option value="Ready for Payment">Ready for Payment</option>
                                <option value="Closed">Closed</option>
                                <option value="Cancelled">Cancelled</option>
                                <option value="No Show">No Show</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Booking Type</label>
                            <select id="rptv2_group">
                                <option value="all">All</option>
                                <option value="groups">Groups Only</option>
                                <option value="solo">Solo Only</option>
                            </select>
                        </div>
                        <div class="form-group">
                            <label>Quick Range</label>
                            <div class="rptv2-range-group">
                                <button type="button" class="rptv2-range-btn" data-range="today" onclick="rptv2_setRangeUI('today')">Today</button>
                                <button type="button" class="rptv2-range-btn" data-range="week" onclick="rptv2_setRangeUI('week')">Week</button>
                                <button type="button" class="rptv2-range-btn" data-range="month" onclick="rptv2_setRangeUI('month')">Month</button>
                            </div>
                        </div>
                    </div>

                    <div class="rptv2-action-bar">
                        <button class="rptv2-action-btn primary" onclick="rptv2_load()">Load Report</button>
                        <button class="rptv2-action-btn secondary" onclick="rptv2_exportCsv()">⬇ Export CSV</button>
                        <button class="rptv2-action-btn secondary" onclick="window.print()">🖨 Print</button>
                    </div>
                </div>

                <div id="rptv2_output" style="margin-top:18px;"></div>
            </div>
        `;

        setRangeUI(RPT.activeTab === "monthly" ? "month" : RPT.activeTab === "daily" ? "today" : "week");
        setDefaultFiltersForTab();
        ensureTechOptions();
        markActiveTab();
    }

    function tabButton(key, icon, title, desc) {
        return `
            <button type="button" class="rptv2-menu-card" data-tab="${key}" onclick="rptv2_switch('${key}')">
                <div class="rptv2-menu-icon">${icon}</div>
                <div class="rptv2-menu-copy">
                    <strong>${safe(title)}</strong>
                    <span>${safe(desc)}</span>
                </div>
            </button>
        `;
    }

    function markActiveTab() {
        document.querySelectorAll(".rptv2-menu-card").forEach(btn => {
            btn.classList.toggle("active", btn.dataset.tab === RPT.activeTab);
        });
    }

    function kpiCard(label, value, color = "var(--primary)") {
        return `
            <div class="module-box" style="padding:14px;border-left:4px solid ${color};">
                <div style="font-size:0.78rem;color:#666;text-transform:uppercase;font-weight:bold;">${safe(label)}</div>
                <div style="font-size:1.45rem;font-weight:bold;color:${color};">${safe(value)}</div>
            </div>
        `;
    }

    function renderKpis(rows) {
        const groups = rows.filter(isGroup).length;
        const totals = computedFinancials(rows);
        const closed = rows.filter(r => r.status === "Closed").length;
        const avg = avgSpend(rows);

        return `
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:16px 0;">
                ${kpiCard("Records", rows.length)}
                ${totals.partial ? kpiCard("Financial Evidence", "Partial") : ""}
                ${kpiCard("Gross Service Value", `${money(totals.grossServiceValue)} GHC`, "var(--primary)")}
                ${kpiCard("Complimentary Waived", `${money(totals.complimentaryValue)} GHC`, "var(--accent)")}
                ${kpiCard("Taxable Net", `${money(totals.netRevenue)} GHC`, "var(--success)")}
                ${kpiCard("Adjusted Gross", `${money(totals.adjustedGross)} GHC`, "var(--primary)")}
                ${kpiCard("Tax", `${money(totals.taxTotal)} GHC`, "var(--manager)")}
                ${kpiCard("Paid Amount", `${money(totals.paidAmount)} GHC`, "var(--success)")}
            </div>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin:0 0 16px;">
                ${kpiCard("Group Records", groups, "var(--accent)")}
                ${kpiCard("Closed Jobs", closed, "var(--manager)")}
                ${kpiCard("Avg Taxable Net", `${money(avg)} GHC`)}
                ${kpiCard("Solo Records", rows.length - groups)}
                ${kpiCard("Cancelled", rows.filter(r => r.status === "Cancelled").length, "var(--error)")}
                ${kpiCard("No Shows", rows.filter(r => r.status === "No Show").length, "var(--error)")}
            </div>
        `;
    }

    function renderTable(rows) {
        const tableRevenueSeen = new Set();
        if (!rows.length) {
            return `<div class="module-box" style="border-left:4px solid var(--accent);">
                <h3 style="margin-top:0;color:var(--accent);">No records found</h3>
                <p style="color:#666;margin-bottom:0;">
                    Try changing Status to <strong>All Statuses</strong>, checking another date range, or confirming that today's bookings have been checked in/closed.
                </p>
            </div>`;
        }

        return `
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.82rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            ${["Date","Time","Client","Phone","Tech","Status","Service","Gross","Waived","Taxable Net","Adjusted Gross","Amount Due","Tax","Paid","Group ID","Size","Subgroup","Billing","Lead"].map(h =>
                                `<th style="padding:8px;border:1px solid #ddd;text-align:left;">${h}</th>`
                            ).join("")}
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => {
                            const f = shouldCountRealizedRevenue(r, tableRevenueSeen) ? realizedFinancials(r) : zeroFinancials(r);
                            return `
                                <tr>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.dateString || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.timeString || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.clientName || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.clientPhone || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.assignedTechName || r.assignedTechEmail || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.status || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.bookedService || "")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.grossServiceValue)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.complimentaryValue)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.netRevenue)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.adjustedGross)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.amountDue)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.taxTotal)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(f.paidAmount)}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.groupId || "-")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.groupSize || "-")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(r.subGroupIndex || "-")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${safe(billingMode(r) || "-")}</td>
                                    <td style="padding:8px;border:1px solid #ddd;">${isLead(r) ? "Yes" : ""}</td>
                                </tr>
                            `;
                        }).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderStatusBreakdown(rows) {
        const counts = statusCounts(rows);
        const parts = Object.keys(counts).sort().map(k => `
            <div style="display:flex;justify-content:space-between;border-bottom:1px solid #eee;padding:6px 0;">
                <span>${safe(k)}</span><strong>${counts[k]}</strong>
            </div>
        `).join("");

        return `
            <div class="module-box" style="margin-top:16px;">
                <h3>Status Breakdown</h3>
                ${parts || "<p>No statuses.</p>"}
            </div>
        `;
    }

    function renderTechPerformance(rows) {
        const byTech = {};
        rows.forEach(r => {
            const key = r.assignedTechEmail || "Unassigned";
            if (!byTech[key]) byTech[key] = { name: r.assignedTechName || key, rows: [] };
            byTech[key].rows.push(r);
        });

        const techRows = Object.values(byTech).map(t => {
            const totals = computedFinancials(t.rows);
            const mins = t.rows.reduce((s,r) => s + num(r.bookedDuration || 0), 0);
            return { ...t, totals, revenue: totals.netRevenue, jobs: t.rows.length, mins };
        }).sort((a,b) => b.revenue - a.revenue);

        return `
            ${renderKpis(rows)}
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Technician</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Jobs</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Service Minutes</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Gross</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Waived</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Taxable Net</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Paid</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Net / Job</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${techRows.map(t => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(t.name)}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${t.jobs}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${t.mins}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.totals.grossServiceValue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.totals.complimentaryValue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.revenue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.totals.paidAmount)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(t.revenue === null ? null : t.revenue / Math.max(1,t.jobs))} GHC</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    function renderClientIntelligence(rows) {
        const byClient = {};
        rows.forEach(r => {
            const key = r.clientPhone || r.clientName || r.id;
            if (!byClient[key]) byClient[key] = { name: r.clientName || "Unknown", phone: r.clientPhone || "", rows: [] };
            byClient[key].rows.push(r);
        });

        const clients = Object.values(byClient).map(c => {
            const totals = computedFinancials(c.rows);
            return {
                ...c,
                visits: c.rows.length,
                totals,
                revenue: totals.netRevenue,
                lastVisit: c.rows.map(r => r.dateString || "").sort().pop() || ""
            };
        }).sort((a,b) => b.revenue - a.revenue);

        return `
            ${renderKpis(rows)}
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Client</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Phone</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Visits</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Gross</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Waived</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Taxable Net</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:right;">Paid</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Last Visit</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${clients.map(c => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(c.name)}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(c.phone)}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${c.visits}</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(c.totals.grossServiceValue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(c.totals.complimentaryValue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(c.revenue)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;text-align:right;">${money(c.totals.paidAmount)} GHC</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(c.lastVisit)}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }



    function renderMiniBreakdown(title, items, emptyText) {
        const rows = items.slice(0, 12).map(item => `
            <div style="display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #eee;padding:7px 0;font-size:0.84rem;">
                <span>${safe(item.label)}</span>
                <strong>${safe(item.value)}</strong>
            </div>
        `).join("");

        return `
            <div class="rptv2-audit-section">
                <h3>${safe(title)}</h3>
                ${rows || `<p style="color:#999;font-style:italic;margin:0;">${safe(emptyText || "No data found.")}</p>`}
            </div>
        `;
    }

    function renderAuditReport(rows, start, end) {
        const closedRows = rows.filter(r => (r.status || "") === "Closed");
        const auditRows = closedRows.length ? closedRows : rows;
        const totals = computedFinancials(auditRows);
        const totalRevenue = totals.netRevenue;
        const groups = auditRows.filter(isGroup).length;
        const avg = totalRevenue === null ? null : totalRevenue / Math.max(1, totals.realizedSaleCount);

        const byPayment = {};
        const byTech = {};
        const byService = {};
        const auditSeen = new Set();
        auditRows.forEach(r => {
            if (!shouldCountRealizedRevenue(r, auditSeen)) return;
            const f = realizedFinancials(r);
            const payment = r.paymentMethod || r.paymentType || r.paymentStatus || "Not recorded";
            byPayment[payment] = sumFinancial(byPayment[payment] === undefined ? 0 : byPayment[payment], f.netRevenue);

            const tech = r.assignedTechName || r.assignedTechEmail || "Unassigned";
            if (!byTech[tech]) byTech[tech] = { count:0, revenue:0 };
            byTech[tech].count += 1;
            byTech[tech].revenue = sumFinancial(byTech[tech].revenue, f.netRevenue);

            const service = r.bookedService || "Service not recorded";
            const primary = String(service).split(",")[0].trim() || "Service not recorded";
            if (!byService[primary]) byService[primary] = { count:0, revenue:0 };
            byService[primary].count += 1;
            byService[primary].revenue = sumFinancial(byService[primary].revenue, f.netRevenue);
        });

        const paymentItems = Object.entries(byPayment)
            .map(([label, val]) => ({ label, value: `${money(val)} GHC` }))
            .sort((a,b) => parseFloat(b.value) - parseFloat(a.value));

        const techItems = Object.entries(byTech)
            .map(([label, val]) => ({ label, value: `${val.count} job(s) · ${money(val.revenue)} GHC` }))
            .sort((a,b) => parseFloat(b.value.split('·')[1]) - parseFloat(a.value.split('·')[1]));

        const serviceItems = Object.entries(byService)
            .map(([label, val]) => ({ label, value: `${val.count} · ${money(val.revenue)} GHC` }))
            .sort((a,b) => parseFloat(b.value.split('·')[1]) - parseFloat(a.value.split('·')[1]));

        return `
            <div class="rptv2-audit-hero">
                <h2>🧾 Audit Report</h2>
                <p>Period: <strong>${safe(start)}</strong> to <strong>${safe(end)}</strong>. Financial audit summary uses Closed jobs where available, with member service values and payer collections recorded separately.</p>
                <div class="rptv2-audit-grid">
                    ${kpiCard("Audit Records", auditRows.length)}
                    ${totals.partial ? kpiCard("Financial Evidence", "Partial") : ""}
                    ${kpiCard("Closed Jobs", closedRows.length, "var(--manager)")}
                    ${kpiCard("Gross Service Value", `${money(totals.grossServiceValue)} GHC`, "var(--primary)")}
                    ${kpiCard("Complimentary Waived", `${money(totals.complimentaryValue)} GHC`, "var(--accent)")}
                    ${kpiCard("Taxable Net", `${money(totalRevenue)} GHC`, "var(--success)")}
                    ${kpiCard("Tax", `${money(totals.taxTotal)} GHC`, "var(--manager)")}
                    ${kpiCard("Paid Amount", `${money(totals.paidAmount)} GHC`, "var(--success)")}
                    ${kpiCard("Avg Taxable Net", `${money(avg)} GHC`, "var(--accent)")}
                </div>
                <div class="rptv2-audit-grid">
                    ${kpiCard("Group Records", groups, "var(--accent)")}
                    ${kpiCard("Solo Records", auditRows.length - groups)}
                    ${kpiCard("No Shows", rows.filter(r => r.status === "No Show").length, "var(--error)")}
                    ${kpiCard("Cancelled", rows.filter(r => r.status === "Cancelled").length, "var(--error)")}
                </div>
            </div>
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:16px;">
                ${renderMiniBreakdown("Payment Taxable Net", paymentItems, "No payment methods recorded.")}
                ${renderMiniBreakdown("Technician Taxable Net", techItems, "No technician revenue found.")}
                ${renderMiniBreakdown("Service Taxable Net", serviceItems, "No services found.")}
            </div>
            ${renderTable(auditRows)}
            ${renderStatusBreakdown(rows)}
        `;
    }

    async function loadAttendanceReport(start, end) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (window.thurayaAttendance?.fetchRangeAggregates) {
            try {
                const result = await window.thurayaAttendance.fetchRangeAggregates(db, start, end);
                if (!isCurrent()) return;
                return result.aggregates.map(aggregate => {
                    const session = aggregate.effectiveSession || aggregate.sessions[aggregate.sessions.length - 1] || {};
                    const raw = session.raw || {};
                    return {
                        id: `${aggregate.technicianKey}_${aggregate.day}`,
                        _source: "Attendance",
                        email: aggregate.email || "",
                        name: aggregate.name || aggregate.email || "",
                        date: aggregate.day,
                        dateString: aggregate.day,
                        clockIn: session.clockIn || aggregate.firstClockIn || null,
                        clockOut: aggregate.isPresent ? null : (aggregate.lastClockOut || session.clockOut || null),
                        status: aggregate.displayStatus,
                        lunchStartString: raw.lunchStartString || (raw.lunchStart ? window.thurayaAttendance.formatTime(raw.lunchStart) : ""),
                        lunchEndString: raw.lunchEndString || (raw.lunchEnd ? window.thurayaAttendance.formatTime(raw.lunchEnd) : ""),
                        lunchBreakActive: aggregate.onLunch,
                        sessionCount: aggregate.sessionCount,
                        sourceDocIds: aggregate.sourceDocIds.join(", "),
                        sourceSchemas: aggregate.sourceSchemas.join(", ")
                    };
                });
            } catch(e) { if (!isCurrent()) return;
                console.warn("Aggregated attendance report query failed; using legacy fallback", e);
            }
        }

        const byId = new Map();
        async function pull(field) {
            if (!isCurrent()) return;
            const snap = await db.collection("Attendance")
                .where(field, ">=", start)
                .where(field, "<=", end)
                .get();
                if (!isCurrent()) return;

            snap.forEach(doc => {
                const row = { id: doc.id, _source: "Attendance", ...doc.data() };
                if (!isArchivedRecord(row)) byId.set(doc.id, row);
            });
        }

        try { await pull("date");
        if (!isCurrent()) return; } catch(e) { if (!isCurrent()) return;}
        try { await pull("dateString");
        if (!isCurrent()) return; } catch(e) { if (!isCurrent()) return;}
        return Array.from(byId.values());
    }

    function renderAttendance(rows) {
        if (!rows.length) return `<p style="color:#999;font-style:italic;">No attendance records found.</p>`;

        return `
            <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0;">
                ${kpiCard("Attendance Records", rows.length)}
                ${kpiCard("Lunch Breaks", rows.filter(r => r.lunchStartString).length, "var(--accent)")}
                ${kpiCard("Active Lunch", rows.filter(r => r.lunchBreakActive === true).length, "var(--error)")}
            </div>
            <div style="overflow-x:auto;">
                <table style="width:100%;border-collapse:collapse;font-size:0.84rem;background:white;">
                    <thead>
                        <tr style="background:#f3f4f6;">
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Date</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Name</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Email</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Lunch Start</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Lunch End</th>
                            <th style="padding:8px;border:1px solid #ddd;text-align:left;">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows.map(r => `
                            <tr>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.date || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.name || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.email || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.lunchStartString || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${safe(r.lunchEndString || "")}</td>
                                <td style="padding:8px;border:1px solid #ddd;">${r.lunchBreakActive ? "Lunch active" : "Available / ended"}</td>
                            </tr>
                        `).join("")}
                    </tbody>
                </table>
            </div>
        `;
    }

    async function load() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        async function includeAppointmentNoShows(rows, start, end) {
            if (!isCurrent()) return;
            const appointments = filterRows(await fetchDateRange("Appointments", start, end));
            if (!isCurrent()) return;
            return window.ThurayaNoShowModel.appendNoShows(rows, appointments);
        }
        const out = document.getElementById("rptv2_output");
        if (!out) return;

        const { start, end } = currentRange();
        if (end < start) {
            out.innerHTML = `<p style="color:var(--error);">End date cannot be before start date.</p>`;
            return;
        }

        out.innerHTML = `<p style="color:#666;">Loading ${safe(RPT.activeTab)} report...</p>`;

        try {
            let rows = [];
            let html = "";

            if (RPT.activeTab === "upcoming") {
                rows = filterRows(await fetchDateRange("Appointments", start, end));
                if (!isCurrent()) return;
                rows.sort((a,b) => `${a.dateString || ""}${a.timeString || ""}`.localeCompare(`${b.dateString || ""}${b.timeString || ""}`));
                html = renderKpis(rows) + renderTable(rows) + renderStatusBreakdown(rows);
            } else if (RPT.activeTab === "daily" || RPT.activeTab === "monthly") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));
                if (!isCurrent()) return;
                if (rows.length) rows = await includeAppointmentNoShows(rows, start, end);
                if (!isCurrent()) return;

                // If no operational jobs exist yet, fall back to Appointments so the report does not look broken.
                // This is useful early in the day before check-in/checkout creates Active_Jobs.
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    if (!isCurrent()) return;
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }

                rows.sort((a,b) => `${a.dateString || ""}${a.timeString || ""}`.localeCompare(`${b.dateString || ""}${b.timeString || ""}`));
                html = renderKpis(rows) + renderTable(rows) + renderStatusBreakdown(rows);
            } else if (RPT.activeTab === "audit") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));
                if (!isCurrent()) return;
                if (rows.length) rows = await includeAppointmentNoShows(rows, start, end);
                if (!isCurrent()) return;
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    if (!isCurrent()) return;
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }
                rows.sort((a,b) => `${a.dateString || ""}${a.timeString || ""}`.localeCompare(`${b.dateString || ""}${b.timeString || ""}`));
                html = renderAuditReport(rows, start, end);
            } else if (RPT.activeTab === "tech") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));
                if (!isCurrent()) return;
                if (rows.length) rows = await includeAppointmentNoShows(rows, start, end);
                if (!isCurrent()) return;
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    if (!isCurrent()) return;
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }
                html = renderTechPerformance(rows);
            } else if (RPT.activeTab === "client") {
                rows = filterRows(await fetchDateRange("Active_Jobs", start, end));
                if (!isCurrent()) return;
                if (rows.length) rows = await includeAppointmentNoShows(rows, start, end);
                if (!isCurrent()) return;
                if (!rows.length) {
                    rows = filterRows(await fetchDateRange("Appointments", start, end));
                    if (!isCurrent()) return;
                    rows.forEach(r => r._source = "Appointments (fallback)");
                }
                html = renderClientIntelligence(rows);
            } else if (RPT.activeTab === "attendance") {
                rows = await loadAttendanceReport(start, end);
                if (!isCurrent()) return;
                html = renderAttendance(rows);
            }

            RPT.rows = rows;
            out.innerHTML = html;
        } catch(e) { if (!isCurrent()) return;
            console.error("Reports V2 error:", e);
            out.innerHTML = `
                <div class="module-box" style="border-left:4px solid var(--error);">
                    <h3 style="color:var(--error);">Report Error</h3>
                    <p>${safe(e.message)}</p>
                    <p style="color:#666;font-size:0.85rem;">
                        Reports V2 uses simple date-range queries. If this still fails, check collection security rules or missing date fields.
                    </p>
                </div>
            `;
        }
    }

    function csvEscape(v) {
        const s = String(v ?? "");
        return `"${s.replace(/"/g, '""')}"`;
    }

    function exportCsv() {
        const rows = RPT.rows || [];
        if (!rows.length) {
            alert("Load a report first.");
            return;
        }

        const headers = [
            "Source","Date","Time","Client","Phone","Technician","Status","Service","Revenue",
            "Gross Service Value","Complimentary Waived","Taxable Net","Adjusted Gross","Amount Due","Tax","Paid Amount",
            "Group ID","Group Size","Subgroup","Billing Mode","Payable By","Lead Booker"
        ];

        const lines = [headers.map(csvEscape).join(",")];
        const csvRevenueSeen = new Set();

        rows.forEach(r => {
            const f = shouldCountRealizedRevenue(r, csvRevenueSeen) ? realizedFinancials(r) : zeroFinancials(r);
            lines.push([
                r._source || "",
                r.dateString || r.date || "",
                r.timeString || "",
                r.clientName || r.name || "",
                r.clientPhone || "",
                r.assignedTechName || r.assignedTechEmail || r.email || "",
                r.status || (r.lunchBreakActive ? "Lunch active" : ""),
                r.bookedService || "",
                money(f.netRevenue),
                money(f.grossServiceValue),
                money(f.complimentaryValue),
                money(f.netRevenue),
                money(f.adjustedGross),
                money(f.amountDue),
                money(f.taxTotal),
                money(f.paidAmount),
                r.groupId || "",
                r.groupSize || "",
                r.subGroupIndex || "",
                billingMode(r),
                r.payableBy || "",
                isLead(r) ? "Yes" : ""
            ].map(csvEscape).join(","));
        });

        const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `thuraya-reports-v2-${RPT.activeTab}-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function switchTab(key) {
        RPT.activeTab = key;
        markActiveTab();
        if (key === "daily") setRangeUI("today");
        if (key === "monthly") setRangeUI("month");
        if (key === "upcoming") setRangeUI("week");
        if (key === "tech" || key === "client" || key === "attendance" || key === "audit") setRangeUI("today");
        setDefaultFiltersForTab();
        document.getElementById("rptv2_output").innerHTML = "";
    }

    function init() {
        if (!window.ThurayaSessionResources.active()) return;
        injectReportStyles();
        renderShell();
    }

    window.rptv2_setRange = setRange;
    window.rptv2_setRangeUI = setRangeUI;
    window.rptv2_load = load;
    window.rptv2_exportCsv = exportCsv;
    window.rptv2_switch = switchTab;

    // Replace old Reports initializer.
    window.rpt_init = init;

    // If user is already on reports when this loads.
    document.addEventListener("click", function(e) {
        const target = e.target;
        if (!target) return;
        const txt = (target.textContent || "").toLowerCase();
        if (txt.includes("reports")) {
            window.ThurayaSessionResources.timeout(() => {
                const rv = document.getElementById("reportsView");
                if (rv && rv.style.display !== "none") init();
            }, 250);
        }
    });


    function forceReportsV2Visible() {
        if (!window.ThurayaSessionResources.active()) return;
        const rv = document.getElementById("reportsView");
        if (!rv) return;
        const isVisible = rv.style.display !== "none" && rv.offsetParent !== null;
        const missingShell = !document.getElementById("rptv2_output");
        if (isVisible && missingShell) init();
    }

    const previousSwitchModule = window.switchModule;
    window.switchModule = function(moduleId) {
        if (typeof previousSwitchModule === "function") previousSwitchModule(moduleId);
        if (moduleId === "reportsView") {
            window.ThurayaSessionResources.timeout(init, 0);
            window.ThurayaSessionResources.timeout(init, 250);
        }
    };

    document.addEventListener("change", function(e) {
        if (e.target && e.target.id === "nav_reports") {
            window.ThurayaSessionResources.timeout(init, 0);
            window.ThurayaSessionResources.timeout(init, 250);
        }
    });

    document.addEventListener("click", function(e) {
        const target = e.target;
        if (!target) return;
        const txt = (target.textContent || "").toLowerCase();
        if (txt.includes("reports")) {
            window.ThurayaSessionResources.timeout(init, 0);
            window.ThurayaSessionResources.timeout(init, 250);
        }
    }, true);

    function registerSession() {
        window.ThurayaSessionResources.onStart("reports", () => {
            window.ThurayaSessionResources.timeout(forceReportsV2Visible, 500);
            window.ThurayaSessionResources.timeout(forceReportsV2Visible, 1500);
            window.ThurayaSessionResources.interval("reports.visibility", forceReportsV2Visible, 2000);
        });
    }
    window.ThurayaSessionResources.onStop("reports", () => {
        RPT.rows = [];
        RPT.techsLoaded = false;
        const view = document.getElementById("reportsView");
        if (view) view.innerHTML = "";
    });
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", registerSession, { once: true });
    else registerSession();
})();
