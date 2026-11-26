// ============================================================
// THURAYA SALES & PROMO — PHASE 1 RESTORE
// Version: sales-promo-phase4-package-engine-20260425
// Restores Sales & Promo tab as a growth module.
// Does NOT change booking, billing, reports, commissions, or attendance.
// ============================================================
console.log("✅ Sales & Promo Gift Card Priority Cleanup loaded: no max-use caption, clean CTAs");

(function () {
    function safe(v) {
        return String(v ?? "").replace(/[&<>"']/g, s => ({
            "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
        }[s]));
    }

    function isArchivedRecord(row) {
        return row?.archived === true;
    }

    function todayStr() {
        if (typeof todayDateStr !== "undefined" && todayDateStr) return todayDateStr;
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
    }

    function injectSalesStyles() {
        if (document.getElementById("salesPromoStyles")) return;
        const st = document.createElement("style");
        st.id = "salesPromoStyles";
        st.textContent = `
            .sales-shell { max-width:1200px; margin:24px auto; }
            .sales-header { display:flex; justify-content:space-between; align-items:flex-start; gap:16px; flex-wrap:wrap; margin-bottom:16px; }
            .sales-header h2 { margin:0; color:var(--primary); letter-spacing:.02em; }
            .sales-header p { margin:6px 0 0; color:#666; font-size:.9rem; }
            .sales-pill { display:inline-flex; border:1px solid var(--border); border-radius:999px; padding:8px 12px; background:#fff; color:var(--primary); font-size:.78rem; font-weight:900; text-transform:uppercase; letter-spacing:.05em; }
            .sales-grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; margin:16px 0; }
            .sales-card { background:#fff; border:1px solid var(--border); border-radius:12px; padding:16px; box-shadow:0 2px 10px rgba(0,0,0,.04); }
            .sales-card h3 { margin:0 0 10px; color:var(--primary); border-bottom:1px solid var(--border); padding-bottom:10px; }
            .sales-kpi { border-left:4px solid var(--accent); }
            .sales-kpi span { display:block; color:#666; font-size:.74rem; text-transform:uppercase; font-weight:900; letter-spacing:.05em; }
            .sales-kpi strong { display:block; color:var(--primary); margin-top:6px; font-size:1.35rem; }
            .sales-tabs { display:flex; gap:8px; flex-wrap:wrap; margin:14px 0 16px; }
            .sales-tab-btn { border:1px solid var(--border); background:#fff; color:var(--primary); border-radius:9px; padding:10px 14px; font-size:.78rem; font-weight:900; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; transition:all .16s ease; }
            .sales-tab-btn.active { background:var(--primary); border-color:var(--primary); color:#fff; box-shadow:0 5px 14px rgba(47,59,79,.16); }
            .sales-note { color:#666; font-size:.85rem; line-height:1.45; background:#fafafa; border:1px solid var(--border); border-left:4px solid var(--accent); border-radius:8px; padding:12px; margin-bottom:14px; }
            .sales-table-wrap { overflow-x:auto; }
            .sales-table { width:100%; border-collapse:collapse; font-size:.84rem; background:#fff; }
            .sales-table th { background:#f3f4f6; color:var(--primary); text-align:left; padding:10px; border:1px solid #ddd; white-space:nowrap; font-size:.76rem; text-transform:uppercase; letter-spacing:.05em; }
            .sales-table td { padding:10px; border:1px solid #eee; vertical-align:top; }
            .sales-actions { display:flex; gap:10px; flex-wrap:wrap; margin-top:14px; padding-top:14px; border-top:1px solid var(--border); }
            .sales-btn { width:auto; border:1px solid var(--border); border-radius:8px; padding:10px 14px; font-size:.78rem; font-weight:900; letter-spacing:.06em; text-transform:uppercase; cursor:pointer; background:#fff; color:var(--primary); transition:all .16s ease; }
            .sales-btn.primary { background:var(--primary); border-color:var(--primary); color:#fff; }
            .sales-btn:hover { transform:translateY(-1px); border-color:var(--accent); box-shadow:0 5px 14px rgba(0,0,0,.08); }
            .sales-form-grid { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; align-items:end; }
            .sales-badge { display:inline-flex; border-radius:999px; padding:4px 9px; font-size:.72rem; font-weight:800; background:#f3f4f6; color:var(--primary); }
            .sales-badge.active { background:rgba(30,130,76,.12); color:var(--success); }
            .sales-badge.paused { background:rgba(180,60,60,.10); color:var(--error); }
            .thuraya-gift-preview-final { width:100%;max-width:1180px;margin:0 auto;background:#030303;color:#fff;border:1px solid #b3a78a;border-radius:32px;font-family:Inter,Arial,sans-serif;letter-spacing:0;text-align:left;container-type:inline-size; }
            .thuraya-gift-preview-final * { box-sizing:border-box;letter-spacing:0;min-width:0; }
            .thuraya-gift-card-stage { position:relative;isolation:isolate;min-height:616px;margin:16px;border:1px solid #766542;border-radius:24px;padding:16px 30px 34px;display:grid;grid-template-columns:minmax(0,56fr) minmax(0,44fr);grid-template-rows:auto minmax(150px,1fr) auto auto auto;column-gap:44px;row-gap:12px; }
            .thuraya-gift-card-stage > :not(.th-gift-watermark) { position:relative;z-index:1; }
            .th-gift-watermark { position:absolute;z-index:0;top:0;left:32%;font:italic 300px/.98 Georgia,serif;color:#252525;pointer-events:none;user-select:none;white-space:nowrap; }
            .th-gift-heading { grid-column:1/-1;display:flex;align-items:flex-start;justify-content:space-between;gap:24px;font-size:14px;line-height:1.5;text-transform:uppercase; }
            .th-gift-purchased { flex:1;margin:0;overflow-wrap:anywhere;color:#fff; }
            .th-gift-parties { flex:1;text-align:right;overflow-wrap:anywhere; }
            .th-gift-recipient { margin:0;font:600 14px/1.5 Inter,Arial,sans-serif;color:#fff; }
            .th-gift-sender { display:block;font-size:12px;margin-top:4px;text-transform:none;color:#dedbd3; }
            .th-gift-value { grid-column:1;align-self:start; }
            .th-gift-amount { display:block;font:500 80px/1.2 Inter,Arial,sans-serif;color:#fff;overflow-wrap:anywhere; }
            .th-gift-brand-area { grid-column:1;align-self:end;padding-top:16px; }
            .th-gift-label { display:block;color:#fff;font-size:11px;line-height:1.5;text-transform:uppercase; }
            .th-gift-brand { font:400 50px/1.2 Georgia,serif;color:#fff;overflow-wrap:anywhere;margin:8px 0 12px; }
            .th-gift-subtitle { display:block;color:#fff;font-size:13px;line-height:1.5;text-transform:uppercase; }
            .thuraya-gift-code-box { grid-column:1;border:1px solid #a6a39b;border-radius:14px;padding:14px 18px;max-width:450px; }
            .th-gift-code { display:block;margin-top:12px;font:700 20px/1.5 ui-monospace,monospace;overflow-wrap:anywhere;white-space:normal;color:#fff; }
            .th-gift-message { grid-column:1;margin:8px 0 0;color:#fff;font-size:17px;line-height:1.6;white-space:pre-wrap;overflow-wrap:anywhere; }
            .th-gift-signature { grid-column:2;grid-row:3/6;align-self:end;padding:0 0 12px; }
            .th-gift-wordmark { display:block;font:400 62px/1.1 Georgia,serif;overflow-wrap:anywhere; }
            .th-gift-tagline { margin:18px 0 0;font-size:15px;line-height:1.5;color:#fff;overflow-wrap:anywhere; }
            .th-gift-dates { grid-column:1;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px;border-top:1px solid #41403b;padding-top:22px;margin-top:16px;font-size:13px;line-height:1.5;text-transform:uppercase;overflow-wrap:anywhere; }
            .th-gift-terms { grid-column:2;align-self:end;margin:16px 0 0;font-size:11px;line-height:1.5;color:#dedbd3;overflow-wrap:anywhere; }
            .th-gift-state { font-weight:600;color:#fff; }
            #thurayaGiftPreviewModal { position:fixed;inset:0;z-index:999999;background:rgba(0,0,0,.72);padding:20px;overflow:auto;display:flex;align-items:flex-start;justify-content:center; }
            .th-gift-modal-panel { width:100%;max-width:1220px;margin:auto;background:#fff;border-radius:8px;padding:20px;box-sizing:border-box; }
            .th-gift-modal-heading { display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:16px; }
            .th-gift-modal-heading h3 { margin:0;font-size:18px;color:var(--primary); }
            #thurayaGiftPreviewCardWrap { min-width:0; }
            #thurayaGiftPreviewModal .sales-btn { min-height:40px;white-space:normal;overflow-wrap:anywhere; }
            #thurayaGiftPreviewModal .sales-actions { justify-content:flex-end; }
            #thurayaGiftPreviewModal :focus-visible { outline:3px solid #278172;outline-offset:3px; }
            .th-gift-registry td { overflow-wrap:anywhere; }
            @container (max-width:1000px) {
                .thuraya-gift-card-stage { min-height:510px;padding:16px 24px 24px;column-gap:28px;grid-template-rows:auto minmax(100px,1fr) auto auto auto; }
                .th-gift-amount { font-size:62px; }.th-gift-brand { font-size:38px; }.th-gift-wordmark { font-size:44px; }.th-gift-watermark { font-size:270px; }
            }
            @container (max-width:700px) {
                .thuraya-gift-card-stage { min-height:350px;margin:10px;padding:12px 16px 18px;column-gap:20px;row-gap:8px;grid-template-rows:auto minmax(56px,1fr) auto auto auto; }
                .th-gift-heading,.th-gift-recipient { font-size:11px; }.th-gift-sender { font-size:11px; }.th-gift-heading { gap:16px; }
                .th-gift-amount { font-size:40px; }.th-gift-brand { font-size:30px;margin:6px 0; }.th-gift-wordmark { font-size:32px; }.th-gift-watermark { font-size:210px; }
                .th-gift-label,.th-gift-subtitle { font-size:10px; }.th-gift-code { font-size:16px;margin-top:6px; }.thuraya-gift-code-box { padding:10px; }
                .th-gift-message { font-size:13px;margin-top:4px; }.th-gift-tagline { font-size:12px;margin-top:10px; }.th-gift-dates { font-size:11px;padding-top:12px;margin-top:6px; }.th-gift-terms { font-size:10px;margin-top:6px; }
            }
            @container (max-width:430px) {
                .thuraya-gift-card-stage { min-height:280px;margin:7px;padding:10px 10px 14px;column-gap:12px;row-gap:8px;grid-template-rows:auto minmax(40px,1fr) auto auto auto;grid-template-columns:minmax(0,58fr) minmax(0,42fr);border-radius:18px; }
                .th-gift-amount { font-size:30px; }.th-gift-brand { font-size:24px; }.th-gift-wordmark { font-size:20px; }.th-gift-watermark { font-size:100px;top:25px;left:33%; }
                .th-gift-heading { gap:12px; }.th-gift-recipient,.th-gift-purchased { font-size:10px; }.th-gift-sender { font-size:10px; }.th-gift-brand-area { padding-top:4px; }
                .th-gift-code { font-size:14px; }.thuraya-gift-code-box { padding:8px;border-radius:8px; }.th-gift-message { font-size:12px; }.th-gift-tagline { font-size:11px; }.th-gift-dates { gap:8px;font-size:10px; }.th-gift-signature { padding-bottom:6px; }
            }
            @media(max-width:600px) {
                #thurayaGiftPreviewModal { padding:8px; }
                .th-gift-modal-panel { padding:8px; }
                .th-gift-modal-heading .sales-btn { width:auto;flex:none; }
            }
            .th-gift-export-host { position:fixed;left:-10000px;top:0;width:1196px;padding:8px;box-sizing:border-box; }

            @media (max-width:1000px){ .sales-grid{grid-template-columns:repeat(2,minmax(0,1fr));} .sales-form-grid{grid-template-columns:1fr;} }
            @media (max-width:620px){ .sales-grid{grid-template-columns:1fr;} .sales-actions{flex-direction:column;} .sales-btn{width:100%;} }
        `;
        document.head.appendChild(st);
    }

    function ensureSalesShell() {
        if (!window.ThurayaSessionResources.active()) return;
        injectSalesStyles();

        const topNav = document.getElementById("topNavMenu");
        if (!topNav) {
            window.ThurayaSessionResources.timeout(ensureSalesShell, 300);
            return;
        }

        let tab = document.getElementById("tabSales");
        if (!tab) {
            tab = document.createElement("div");
            tab.className = "nav-tab";
            tab.id = "tabSales";
            tab.innerHTML = `
                <input type="radio" name="main_nav" id="nav_sales" value="salesView" onchange="switchModule(this.value)">
                <label for="nav_sales">🏷️ Sales & Promo</label>
            `;

            const reportsTab = document.getElementById("tabReports");
            if (reportsTab && reportsTab.parentNode) reportsTab.parentNode.insertBefore(tab, reportsTab);
            else topNav.appendChild(tab);
        }

        const dashboard = document.getElementById("appDashboard");
        if (dashboard && !document.getElementById("salesView")) {
            const view = document.createElement("div");
            view.id = "salesView";
            view.className = "app-module";
            view.style.display = "none";
            dashboard.appendChild(view);
        }
    }

    function canSeeSales() {
        if (!window.ThurayaSessionResources.active()) return false;
        try {
            const roles = typeof currentRoles !== "undefined" && Array.isArray(currentRoles) ? currentRoles : [];
            const roleText = roles.map(x => String(x || "").toLowerCase().trim()).join(" ");
            const email = String(typeof currentUserEmail !== "undefined" ? currentUserEmail : "").toLowerCase();

            const isAdminOrManager =
                roleText.includes("admin") ||
                roleText.includes("manager") ||
                roleText.includes("owner") ||
                email.includes("admin");

            const isFohOnly =
                (
                    roleText.includes("foh") ||
                    roleText.includes("front of house") ||
                    roleText.includes("front-desk") ||
                    roleText.includes("front desk")
                ) && !isAdminOrManager;

            if (isFohOnly) return false;
            if (isAdminOrManager) return true;

            // If roles are not loaded yet, return null so the guard waits instead of hiding Manager/Admin tabs.
            if (!roleText && !email) return null;

            return false;
        } catch(e) {
            return null;
        }
    }

    function forceSalesTabVisible() {
        if (!window.ThurayaSessionResources.active()) return;
        ensureSalesShell();
        const tab = document.getElementById("tabSales");
        if (!tab) return;

        const allowed = canSeeSales();

        // null means role/user state is not ready yet. Do not prematurely hide Admin tabs.
        if (allowed === null) {
            tab.setAttribute("data-rbac-pending", "true");
            console.log("⏳ Sales & Promo RBAC pending role load");
            return;
        }

        tab.style.display = allowed ? "flex" : "none";
        tab.setAttribute("aria-hidden", allowed ? "false" : "true");
        tab.removeAttribute("data-rbac-pending");

        if (!allowed) {
            tab.classList.add("th-rbac-hidden");
            tab.onclick = null;
        } else {
            tab.classList.remove("th-rbac-hidden");
        }

        console.log("✅ Sales & Promo tab checked:", allowed ? "visible" : "hidden");
    }

    function renderShell(activeTab = "giftcards") {
        if (!window.ThurayaSessionResources.active()) return;
        if (!canSeeSales()) {
            forceSalesTabVisible();
            const root = document.getElementById("salesView");
            if (root) root.innerHTML = `<div class="th-rbac-denied"><strong>Access restricted</strong><span>Sales & Promo is available to Manager/Admin only.</span></div>`;
            return;
        }

        const root = document.getElementById("salesView");
        if (!root) return;

        root.innerHTML = `
            <div class="sales-shell">
                <div class="sales-header">
                    <div>
                        <h2>🏷️ Sales & Promo</h2>
                        <p>Growth tools for promotions, discounts, campaigns, and client spend segmentation.</p>
                    </div>
                    <div class="sales-pill">Phase 1 · Restored</div>
                </div>

                <div class="sales-tabs">
                    <button class="sales-tab-btn ${activeTab === "giftcards" ? "active" : ""}" onclick="sales_showTab('giftcards')">Gift Cards</button>
                    <button class="sales-tab-btn ${activeTab === "promotions" ? "active" : ""}" onclick="sales_showTab('promotions')">Coupons & Packages</button>
                    <button class="sales-tab-btn ${activeTab === "discounts" ? "active" : ""}" onclick="sales_showTab('discounts')">Discounts</button>
                    <button class="sales-tab-btn ${activeTab === "campaigns" ? "active" : ""}" onclick="sales_showTab('campaigns')">Campaigns</button>
                    <button class="sales-tab-btn ${activeTab === "segments" ? "active" : ""}" onclick="sales_showTab('segments')">Client Segments</button>
                    <button class="sales-tab-btn ${activeTab === "redemptions" ? "active" : ""}" onclick="sales_showTab('redemptions')">Redemptions</button>
                    <button class="sales-tab-btn ${activeTab === "wallets" ? "active" : ""}" onclick="sales_showTab('wallets')">Package Wallets</button>
                </div>

                <div id="salesContent"></div>
            </div>
        `;

        if (activeTab === "discounts") renderDiscounts();
        else if (activeTab === "campaigns") renderCampaigns();
        else if (activeTab === "segments") renderSegments();
        else if (activeTab === "redemptions") renderRedemptions();
        else if (activeTab === "wallets") renderPackageWallets();
        else if (activeTab === "giftcards") renderGiftCards();
        else renderPromotions();
    }

    function showTab(tab) {
        if (!canSeeSales()) {
            forceSalesTabVisible();
            return;
        }
        renderShell(tab);
    }

    function renderPromotions() {
        const el = document.getElementById("salesContent");
        if (!el) return;
        el.innerHTML = `
            <div class="sales-note">
                Promotions will let you define special offers and track usage. Phase 1 restores the module safely without changing billing.
            </div>
            <div class="sales-grid">
                <div class="sales-card sales-kpi"><span>Active Promos</span><strong id="salesActivePromos">0</strong></div>
                <div class="sales-card sales-kpi"><span>Promo Revenue</span><strong>0.00 GHC</strong></div>
                <div class="sales-card sales-kpi"><span>Redemptions</span><strong>0</strong></div>
                <div class="sales-card sales-kpi"><span>New Clients</span><strong>0</strong></div>
            </div>
            <div class="sales-card">
                <h3>Create Promotion</h3>
                <div class="sales-form-grid">
                    <div class="form-group"><label>Promo Name</label><input type="text" id="promo_name" placeholder="e.g. May Glow Offer"></div>
                    <div class="form-group">
                        <label>Promo Code</label>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="text" id="promo_code" placeholder="e.g. MAYGLOW10" style="flex:1;">
                            <button type="button" class="sales-btn" style="padding:9px 10px; white-space:nowrap;" onclick="sales_generatePromoCode()">Auto</button>
                        </div>
                    </div>
                    <div class="form-group"><label>Discount %</label><input type="number" id="promo_discount" min="0" max="100" step="0.01" placeholder="10"></div>
                    <div class="form-group"><label>Start Date</label><input type="date" id="promo_start"></div>
                    <div class="form-group"><label>End Date</label><input type="date" id="promo_end"></div>
                    <div class="form-group"><label>Status</label><select id="promo_status"><option value="Active">Active</option><option value="Paused">Paused</option></select></div>
                    <div class="form-group"><label>Offer Type</label><select id="promo_type"><option value="coupon_percent">Coupon % Discount</option><option value="package_fixed_price">Package Fixed Price</option><option value="package_wallet">Prepaid Package Wallet</option></select></div>
                    <div class="form-group"><label>Package Price (GHC)</label><input type="number" id="promo_packagePrice" min="0" step="0.01" placeholder="Package price / pay-now price"></div>
                    <div class="form-group"><label>Total Sessions</label><input type="number" id="promo_totalSessions" min="0" step="1" placeholder="For prepaid package wallets"></div>
                    <div class="form-group"><label>Validity Days</label><input type="number" id="promo_validityDays" min="0" step="1" placeholder="e.g. 90"></div>
                    <div class="form-group"><label>Auto Apply Rule</label><select id="promo_autoRule"><option value="manual">Manual Code Only</option><option value="first_time_client">First-Time Client</option><option value="birthday_month">Birthday Month</option><option value="weekday">Specific Weekday</option></select></div>
                    <div class="form-group"><label>Weekday</label><select id="promo_weekday"><option value="">Only if weekday rule</option><option value="0">Sunday</option><option value="1">Monday</option><option value="2">Tuesday</option><option value="3">Wednesday</option><option value="4">Thursday</option><option value="5">Friday</option><option value="6">Saturday</option></select></div>
                    <div class="form-group"><label>Max Total Uses</label><input type="number" id="promo_maxUses" min="0" step="1" placeholder="0 = unlimited"></div>
                    <div class="form-group"><label>Max Uses Per Client</label><input type="number" id="promo_maxPerClient" min="0" step="1" placeholder="0 = unlimited"></div>
                </div>
                <div class="sales-actions">
                    <button class="sales-btn primary" onclick="sales_savePromo()">Save Promotion</button>
                    <button class="sales-btn" onclick="sales_loadPromos()">Refresh</button>
                </div>
            </div>
            <div class="sales-card" style="margin-top:16px;">
                <h3>Promotion Library</h3>
                <div id="salesPromoList"><p style="color:#999;font-style:italic;">Loading promotions...</p></div>
            </div>
        `;
        sales_loadPromos();
    }



    // ============================================================
    // HF92H — Gift Cards with Controlled Use Limit
    // Manager/Admin issuance. FOH redemption is handled at checkout in app.js.
    // ============================================================
    function salesGiftRoleAllowed() {
        if (!window.ThurayaSessionResources.active()) return false;
        try {
            const roles = typeof currentRoles !== "undefined" && Array.isArray(currentRoles) ? currentRoles : [];
            const r = roles.map(x => String(x || "").toLowerCase().trim());
            return r.some(x => x.includes("admin") || x.includes("manager"));
        } catch(e) { return false; }
    }

    function generateGiftCardCode() {
        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let body = "";
        if (window.crypto && crypto.getRandomValues) {
            const arr = new Uint8Array(8);
            crypto.getRandomValues(arr);
            body = Array.from(arr, b => chars[b % chars.length]).join("");
        } else {
            body = Math.random().toString(36).substring(2, 10).toUpperCase().replace(/[^A-Z0-9]/g, "").padEnd(8, "X");
        }
        const code = `THGC-${body.slice(0,4)}-${body.slice(4,8)}`;
        const el = document.getElementById("gift_code");
        if (el) el.value = code;
        return code;
    }

    function defaultGiftExpiry() {
        return ThurayaGiftCard.defaultExpiry();
    }

    function cleanupGiftMaxUsesCaption() {
        const input = document.getElementById("gift_max_uses");
        if (!input || !input.parentElement) return;
        input.parentElement.querySelectorAll("small,.help-text,.field-help,.caption").forEach(node => node.remove());
    }
    function focusGiftCardEditForm() {
        const formCard = document.getElementById("salesGiftCardFormCard") || document.querySelector("#salesContent .sales-card");
        if (!formCard) return;
        if (formCard.scrollIntoView) formCard.scrollIntoView({ behavior: "smooth", block: "start" });
        formCard.style.boxShadow = "0 0 0 3px rgba(174, 145, 55, .26), 0 14px 34px rgba(0,0,0,.10)";
        formCard.style.borderColor = "var(--accent)";
        window.ThurayaSessionResources.timeout(() => {
            formCard.style.boxShadow = "";
            formCard.style.borderColor = "";
        }, 1800);
        const firstInput = document.getElementById("gift_amount_select") || document.getElementById("gift_amount");
        if (firstInput && firstInput.focus) {
            window.ThurayaSessionResources.timeout(() => {
                try { firstInput.focus({ preventScroll: true }); }
                catch(e) { firstInput.focus(); }
            }, 320);
        }
    }
    function renderGiftCards() {
        const el = document.getElementById("salesContent");
        if (!el) return;
        const canSell = salesGiftRoleAllowed();
        el.innerHTML = `
            <div class="sales-note">
                <strong>Manager/Admin controlled.</strong> Gift cards are issued as stored value. <strong>Max Uses</strong> controls how many checkout redemptions are allowed before the card closes, even if balance remains.
            </div>
            ${!canSell ? `<div class="th-rbac-denied"><strong>Access restricted</strong><span>Gift card issuance is available to Manager/Admin only.</span></div>` : `
            <div class="sales-card" id="salesGiftCardFormCard">
                <h3>Sell Digital Gift Card</h3>
                <div class="sales-form-grid">
                    <div class="form-group"><label>Gift Card Value</label><select id="gift_amount_select" onchange="sales_onGiftAmountPreset()"><option value="550">GH₵550</option><option value="750">GH₵750</option><option value="1150">GH₵1150</option><option value="1500">GH₵1500</option><option value="2000">GH₵2000</option><option value="custom">Custom Amount</option></select></div>
                    <div class="form-group"><label>Custom Amount (GHC)</label><input type="number" id="gift_amount" min="1" step="0.01" value="550" readonly style="background:#f7f7f7;"></div>
                    <div class="form-group"><label>Max Uses</label><input type="number" id="gift_max_uses" min="1" step="1" value="1"></div>
                    <div class="form-group"><label>Payment Method</label><select id="gift_payment"><option value="Cash">Cash</option><option value="Card / POS">Card / POS</option><option value="Mobile Money">Mobile Money</option><option value="Bank Transfer">Bank Transfer</option></select></div>
                    <div class="form-group"><label>Purchaser Name</label><input type="text" id="gift_purchaser" placeholder="Name of buyer"></div>
                    <div class="form-group"><label>Purchaser Phone</label><input type="text" id="gift_purchaser_phone" placeholder="Phone"></div>
                    <div class="form-group"><label>Recipient Name</label><input type="text" id="gift_recipient" placeholder="Recipient name"></div>
                    <div class="form-group"><label>Recipient WhatsApp</label><input type="text" id="gift_recipient_phone" placeholder="WhatsApp number"></div>
                    <div class="form-group"><label>Recipient Email</label><input type="email" id="gift_recipient_email" placeholder="Optional email"></div>
                    <div class="form-group"><label>Expiry Date</label><input type="date" id="gift_expiry" value="${defaultGiftExpiry()}"></div>
                    <div class="form-group"><label>Gift Card Code</label><div style="display:flex;gap:8px;"><input type="text" id="gift_code" placeholder="Auto-generated" style="flex:1;"><button type="button" class="sales-btn" onclick="sales_generateGiftCardCode()">Auto</button></div></div>
                    <div class="form-group" style="grid-column:1/-1;"><label>Gift Message</label><textarea id="gift_message" rows="3" placeholder="Optional message shown on the digital card"></textarea></div>
                </div>
                <div class="sales-actions">
                    <button class="sales-btn primary" onclick="sales_sellGiftCard()">Sell & Issue Gift Card</button>
                    <button class="sales-btn" onclick="sales_loadGiftCards()">Refresh Gift Cards</button>
                </div>
                <div id="giftIssueResult" style="margin-top:14px;"></div>
            </div>`}
            <div class="sales-card" style="margin-top:16px;">
                <h3>Gift Card Registry</h3>
                <div id="salesGiftCardList"><p style="color:#999;font-style:italic;">Loading gift cards...</p></div>
            </div>
        `;
        cleanupGiftMaxUsesCaption();
        if (canSell) generateGiftCardCode();
        window.ThurayaSessionResources.timeout(cleanupGiftMaxUsesCaption, 0);
        window.ThurayaSessionResources.timeout(cleanupGiftMaxUsesCaption, 300);
        sales_loadGiftCards();
    }

    function onGiftAmountPreset() {
        const preset = document.getElementById("gift_amount_select")?.value || "";
        const amount = document.getElementById("gift_amount");
        if (!amount) return;
        if (preset !== "custom") amount.value = preset;
        amount.readOnly = preset !== "custom";
        amount.style.background = preset !== "custom" ? "#f7f7f7" : "";
    }


    function giftCardDigitalHtml(card) {
        const state = ThurayaGiftCard.classify(card);
        const amount = Number(card.amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const issued = ThurayaGiftCard.displayDate(card.issuedAt || card.createdAt || card.purchasedAt || card.soldAt);
        const expiry = ThurayaGiftCard.expiry(card);
        const expiryText = expiry.ok ? ThurayaGiftCard.displayDate(expiry.date, 'No expiry') : 'Date needs review';
        const sender = card.purchaserName || card.buyerName;
        return '<article class="thuraya-gift-preview-final" aria-label="THURAYA Gift Card" data-gift-card-code="' + safe(card.code || card.id || '') + '">' +
            '<div class="thuraya-gift-card-stage"><span class="th-gift-watermark" aria-hidden="true">gift</span>' +
            '<header class="th-gift-heading"><p class="th-gift-purchased">Purchased: ' + safe(issued) + '</p><div class="th-gift-parties"><p class="th-gift-recipient">' + safe(card.recipientName || 'For you') + '</p>' + (sender ? '<span class="th-gift-sender">From: ' + safe(sender) + '</span>' : '') + '</div></header>' +
            '<div class="th-gift-value"><strong class="th-gift-amount">GHC ' + safe(amount) + '</strong></div>' +
            '<div class="th-gift-brand-area"><span class="th-gift-label">Only for use at</span><div class="th-gift-brand">THURAYA</div><span class="th-gift-subtitle">Nail Bar - Accra</span></div>' +
            '<div class="thuraya-gift-code-box"><span class="th-gift-label">Redemption code</span><strong class="th-gift-code">' + safe(card.code || card.id || '') + '</strong></div>' +
            '<p class="th-gift-message">' + safe(card.message || '') + '</p>' +
            '<div class="th-gift-signature"><strong class="th-gift-wordmark">THURAYA</strong><p class="th-gift-tagline">The HAUTE Address for Cosmopolitan Nails</p></div>' +
            '<div class="th-gift-dates"><span>Valid until: ' + safe(expiryText) + '</span><span aria-label="Allowed uses: ' + safe(state.maxUses) + '">Max ' + safe(state.maxUses) + ' uses</span></div>' +
            '<p class="th-gift-terms"><span class="th-gift-state">' + safe(state.label) + '</span> &middot; Uses remaining: ' + safe(state.remainingUses) + (state.valid ? '' : '<br>' + safe(state.message)) + '</p>' +
            '</div></article>';
    }

    function buildGiftShareText(card) {
        const state = ThurayaGiftCard.classify(card), expiry = ThurayaGiftCard.expiry(card);
        return ['THURAYA Digital Gift Card', 'Amount: GHS ' + Number(card.amount || 0).toFixed(2),
            'To: ' + (card.recipientName || 'For you'), 'From: ' + (card.purchaserName || card.buyerName || 'Not recorded'),
            'Code: ' + (card.code || card.id || ''), 'Purchased: ' + ThurayaGiftCard.displayDate(card.issuedAt || card.createdAt || card.purchasedAt || card.soldAt),
            'Valid through: ' + (expiry.ok ? ThurayaGiftCard.displayDate(expiry.date, 'No expiry') : 'Date needs review'),
            'Allowed uses: ' + state.maxUses, 'Uses remaining: ' + state.remainingUses, 'Status: ' + state.label,
            card.message || '', 'Present this code at THURAYA checkout. Validity follows the Accra business date.'].filter(Boolean).join('\n');
    }

    async function trustedGiftDetails(key) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const cached = getCachedGiftCard(key);
        if (!cached || cached.code) return cached;
        try {
            const card = await ThurayaGiftAPI.call('detail', { handle: cached.handle });
            if (!isCurrent()) return;
            cacheGiftCard(card);
            window.THURAYA_GIFT_CARD_CACHE[key] = card;
            return card;
        } catch (error) { if (!isCurrent()) return; alert(error.message); return null; }
    }

    function clearGiftSessionData() {
        for (const key of ['THURAYA_GIFT_CARD_CACHE', 'THURAYA_GIFT_CARDS_CACHE', 'salesGiftCardsCache', 'giftCardsCache']) window[key] = {};
        window.THURAYA_EDITING_GIFT_CARD_CODE = '';
        window.THURAYA_EDITING_GIFT_CARD_ID = '';
        window.THURAYA_GIFT_PREVIEW_FOCUS = null;
        window.THURAYA_EDITING_GIFT_CARD_ORIGINAL = null;
        window.THURAYA_GIFT_ADMIN_REQUEST = null;
        window.THURAYA_GIFT_CACHE_UID = null;
        const issueButton = document.querySelector('button[onclick="sales_sellGiftCard()"]');
        if (issueButton) { issueButton.textContent = 'Sell & Issue Gift Card'; delete issueButton.dataset.editingGiftCardCode; issueButton.classList.remove('is-editing-gift-card'); }
        document.getElementById('thurayaGiftPreviewModal')?.remove();
        document.querySelectorAll('.th-gift-export-host').forEach(el => el.remove());
        document.querySelectorAll('[aria-label="Gift Card redemption history"]').forEach(el => el.remove());
        for (const id of ['salesGiftCardList', 'giftIssueResult']) { const el = document.getElementById(id); if (el) el.textContent = ''; }
        document.querySelectorAll('[id^="gift_"]').forEach(el => { if ('value' in el) el.value = ''; });
        if (typeof window.thGiftResetCheckout === 'function') window.thGiftResetCheckout();
    }
    window.ThurayaSessionResources.onStop("sales.gift-cache", clearGiftSessionData);

    function cacheGiftCard(card) {
        if (!window.ThurayaSessionResources.active()) return;
        if (window.firebase?.apps?.length) window.THURAYA_GIFT_CACHE_UID = firebase.auth().currentUser?.uid || null;
        window.THURAYA_GIFT_CARD_CACHE = window.THURAYA_GIFT_CARD_CACHE || {};
        const key = String(card.code || card.id || '').trim();
        if (key) window.THURAYA_GIFT_CARD_CACHE[key] = card;
        return key;
    }

    function getCachedGiftCard(code) {
        if (!window.ThurayaSessionResources.active()) return null;
        if (window.firebase?.apps?.length && window.THURAYA_GIFT_CACHE_UID !== (firebase.auth().currentUser?.uid || null)) return null;
        const key = String(code || '').trim();
        return (window.THURAYA_GIFT_CARD_CACHE || {})[key] || null;
    }

    function closeGiftCardPreview() {
        const existing = document.getElementById('thurayaGiftPreviewModal');
        if (existing) {
            existing.remove();
            window.THURAYA_GIFT_PREVIEW_FOCUS?.focus?.();
        }
    }

    async function previewGiftCardByCode(code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const card = await trustedGiftDetails(code);
        if (!isCurrent()) return;
        if (!card) { alert('Gift card details are not loaded yet. Refresh Gift Cards and try again.'); return; }
        openGiftCardPreview(card);
    }

    function openGiftCardPreview(card) {
        if (!window.ThurayaSessionResources.active()) return;
        cacheGiftCard(card);
        closeGiftCardPreview();
        const modal = document.createElement('div');
        modal.id = 'thurayaGiftPreviewModal';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        modal.setAttribute('aria-labelledby', 'thGiftPreviewHeading');
        modal.innerHTML = '<div class="th-gift-modal-panel"><header class="th-gift-modal-heading"><h3 id="thGiftPreviewHeading">Gift Card Preview</h3>' +
            '<button type="button" class="sales-btn" onclick="sales_closeGiftCardPreview()">Close</button></header>' +
            '<div id="thurayaGiftPreviewCardWrap">' + giftCardDigitalHtml(card) + '</div>' +
            '<div class="sales-actions"><button class="sales-btn" data-gift-image>Save Card Image</button><button class="sales-btn" data-gift-share>Share Card</button>' +
            '<button class="sales-btn primary" onclick="sales_closeGiftCardPreview()">Done</button></div></div>';
        const code = card.code || card.id || '';
        modal.querySelector('[data-gift-image]').onclick = () => saveGiftCardImage(code);
        modal.querySelector('[data-gift-share]').onclick = () => shareGiftCard(code);
        modal.addEventListener('keydown', event => {
            if (event.key === 'Escape') closeGiftCardPreview();
            if (event.key === 'Tab') {
                const buttons = Array.from(modal.querySelectorAll('button'));
                if (event.shiftKey && document.activeElement === buttons[0]) { event.preventDefault(); buttons.at(-1).focus(); }
                else if (!event.shiftKey && document.activeElement === buttons.at(-1)) { event.preventDefault(); buttons[0].focus(); }
            }
        });
        window.THURAYA_GIFT_PREVIEW_FOCUS = document.activeElement;
        document.body.appendChild(modal);
        modal.querySelector('button').focus();
    }


    function thGiftLoadScriptOnce(src, globalName) {
        return new Promise((resolve, reject) => {
            if (globalName && window[globalName]) {
                resolve(window[globalName]);
                return;
            }

            const existing = Array.from(document.scripts).find(s => s.src && s.src.includes(src));
            if (existing) {
                existing.addEventListener('load', () => resolve(globalName ? window[globalName] : true), { once:true });
                existing.addEventListener('error', reject, { once:true });
                return;
            }

            const script = document.createElement('script');
            script.src = src;
            script.async = true;
            script.onload = () => resolve(globalName ? window[globalName] : true);
            script.onerror = () => reject(new Error('Could not load export library.'));
            document.head.appendChild(script);
        });
    }

    async function thGiftEnsureHtml2Canvas() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (window.html2canvas) return window.html2canvas;
        await thGiftLoadScriptOnce('https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js', 'html2canvas');
        if (!isCurrent()) return;
        if (!window.html2canvas) throw new Error('Image export library unavailable.');
        return window.html2canvas;
    }

    async function thGiftCapturePreviewCanvas(card) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const html2canvasLib = await thGiftEnsureHtml2Canvas();
        if (!isCurrent()) return;
        const host = document.createElement('div');
        host.className = 'th-gift-export-host';
        host.setAttribute('aria-hidden', 'true');
        host.innerHTML = giftCardDigitalHtml(card);
        document.body.appendChild(host);
        try {
            if (document.fonts?.ready) await document.fonts.ready;
            if (!isCurrent()) return;
            return await html2canvasLib(host.firstElementChild, {
                backgroundColor: '#080808', scale: 2, useCORS: true, allowTaint: false,
                logging: false, scrollX: 0, scrollY: 0, windowWidth: 1000,
                windowHeight: Math.max(1000, host.scrollHeight)
            });
        } finally { host.remove(); }
    }

    function thGiftDownloadBlob(blob, filename) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.rel = 'noopener';
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1800);
    }


    function thGiftGetCardByCode(code) {
        if (window.firebase?.apps?.length && window.THURAYA_GIFT_CACHE_UID !== (firebase.auth().currentUser?.uid || null)) return null;
        const safeCode = String(code || '').trim();
        if (!safeCode) return null;

        if (typeof getCachedGiftCard === 'function') {
            const cached = getCachedGiftCard(safeCode);
            if (cached) return cached;
        }

        const stores = [
            window.THURAYA_GIFT_CARD_CACHE,
            window.THURAYA_GIFT_CARDS_CACHE,
            window.salesGiftCardsCache,
            window.giftCardsCache
        ];

        for (const store of stores) {
            if (!store) continue;
            if (Array.isArray(store)) {
                const found = store.find(c => String(c.code || c.id || '').trim() === safeCode);
                if (found) return found;
            } else if (typeof store === 'object') {
                if (store[safeCode]) return store[safeCode];
                const found = Object.values(store).find(c => c && String(c.code || c.id || '').trim() === safeCode);
                if (found) return found;
            }
        }

        if (Array.isArray(window.__THURAYA_LAST_GIFT_CARDS)) {
            return window.__THURAYA_LAST_GIFT_CARDS.find(c => String(c.code || c.id || '').trim() === safeCode) || null;
        }

        return null;
    }

    function thGiftSetField(id, value) {
        const el = document.getElementById(id);
        if (!el) return false;
        el.value = value == null ? '' : String(value);
        try { el.dispatchEvent(new Event('input', { bubbles:true })); } catch(e) {}
        try { el.dispatchEvent(new Event('change', { bubbles:true })); } catch(e) {}
        return true;
    }

    function thGiftNormalizeExpiryForInput(value) {
        const result = ThurayaGiftCard.normalizeDate(value);
        return result.ok ? (result.date || '') : '';
    }

    function thGiftHydrateFormForEdit(card) {
        if (!card) {
            alert('Gift card record could not be loaded. Please refresh Gift Cards and try again.');
            return false;
        }

        const amount = card.amount ?? card.originalAmount ?? card.value ?? '';
        const amountSelect = document.getElementById('gift_amount_select');
        const amountValue = String(Number(amount || 0));
        if (amountSelect) amountSelect.value = ['550','750','1150','1500','2000'].includes(amountValue) ? amountValue : 'custom';
        if (typeof onGiftAmountPreset === 'function') onGiftAmountPreset();
        thGiftSetField('gift_amount', amount);
        thGiftSetField('gift_custom_amount', amount);
        thGiftSetField('gift_payment', card.paymentMethod || card.payment || 'Cash');
        thGiftSetField('gift_payment_method', card.paymentMethod || card.payment || '');
        thGiftSetField('gift_purchaser', card.purchaserName || card.buyerName || '');
        thGiftSetField('gift_purchaser_name', card.purchaserName || card.buyerName || '');
        thGiftSetField('gift_purchaser_phone', card.purchaserPhone || card.buyerPhone || '');
        thGiftSetField('gift_recipient', card.recipientName || '');
        thGiftSetField('gift_recipient_name', card.recipientName || '');
        thGiftSetField('gift_recipient_phone', card.recipientPhone || card.recipientWhatsapp || card.recipientWhatsApp || card.whatsapp || '');
        thGiftSetField('gift_recipient_whatsapp', card.recipientWhatsapp || card.recipientWhatsApp || card.whatsapp || '');
        thGiftSetField('gift_recipient_email', card.recipientEmail || card.email || '');
        thGiftSetField('gift_expiry', thGiftNormalizeExpiryForInput(card.expiryDate || card.validUntil || ''));
        thGiftSetField('gift_expiry_date', thGiftNormalizeExpiryForInput(card.expiryDate || card.validUntil || ''));
        thGiftSetField('gift_code', card.code || card.id || '');
        thGiftSetField('gift_message', card.message || card.giftMessage || '');
        thGiftSetField('gift_max_uses', card.totalAllowedUses || card.maxUses || card.remainingUses || 1);

        window.THURAYA_EDITING_GIFT_CARD_CODE = card.code || card.id || '';
        window.THURAYA_EDITING_GIFT_CARD_ID = card.id || card.docId || card.code || '';
        window.THURAYA_EDITING_GIFT_CARD_ORIGINAL = {
            handle: card.handle,
            version: card.version,
            amount: Number(card.amount || 0),
            remainingBalance: Number(card.remainingBalance || 0),
            usedCount: Number(card.usedCount || 0)
        };

        const issueBtn =
            document.getElementById('btnIssueGiftCard') ||
            document.getElementById('gift_issue_btn') ||
            document.querySelector('[onclick*="issueGiftCard"]') ||
            document.querySelector('[onclick*="sellGiftCard"]');

        if (issueBtn) {
            issueBtn.textContent = 'Update Gift Card';
            issueBtn.dataset.editingGiftCardCode = window.THURAYA_EDITING_GIFT_CARD_CODE;
            issueBtn.dataset.editingGiftCardId = window.THURAYA_EDITING_GIFT_CARD_ID;
            issueBtn.classList.add('is-editing-gift-card');
        }

        const status = document.getElementById('giftCardFormStatus') || document.getElementById('gift_msg') || document.getElementById('giftCardMsg');
        if (status) {
            status.textContent = `Editing gift card ${window.THURAYA_EDITING_GIFT_CARD_CODE}`;
            status.style.color = 'var(--success)';
        }

        focusGiftCardEditForm();

        return true;
    }

    function thGiftOpenEditFlow(card, code) {
        if (!card) {
            alert('Gift card details are not loaded yet. Refresh Gift Cards and try again.');
            return false;
        }

        try { closeGiftCardPreview(); } catch(e) {}
        try {
            if (typeof window.switchModule === 'function') window.switchModule('salesView');
        } catch(e) {}

        renderShell('giftcards');

        const hydrateAndFocus = () => {
            thGiftHydrateFormForEdit(card);
            focusGiftCardEditForm();
        };

        window.ThurayaSessionResources.timeout(hydrateAndFocus, 90);
        window.ThurayaSessionResources.timeout(hydrateAndFocus, 320);
        window.ThurayaSessionResources.timeout(hydrateAndFocus, 750);
        return true;
    }

    window.editGiftCard = async function(code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const card = await trustedGiftDetails(code);
        if (!isCurrent()) return;
        return thGiftOpenEditFlow(card, code);
    };

    async function thGiftUpdateExistingCardIfNeeded() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const editingCode = String(window.THURAYA_EDITING_GIFT_CARD_CODE || '').trim();
        if (!editingCode) return false;

        if (!salesGiftRoleAllowed()) {
            alert("Gift card updates are restricted to Manager/Admin.");
            return true;
        }

        const amount = Number(parseFloat(document.getElementById("gift_amount")?.value || "0"));
        const totalAllowedUses = Math.max(1, Number(parseInt(document.getElementById("gift_max_uses")?.value || "1", 10)) || 1);
        const purchaserName = (document.getElementById("gift_purchaser")?.value || "").trim();
        const purchaserPhone = (document.getElementById("gift_purchaser_phone")?.value || "").trim();
        const recipientName = (document.getElementById("gift_recipient")?.value || "").trim();
        const recipientPhone = (document.getElementById("gift_recipient_phone")?.value || "").trim();
        const recipientEmail = (document.getElementById("gift_recipient_email")?.value || "").trim();
        const expiryDate = document.getElementById("gift_expiry")?.value || "";
        const paymentMethod = document.getElementById("gift_payment")?.value || "";
        const message = (document.getElementById("gift_message")?.value || "").trim();

        if (!amount || amount <= 0) { alert("Enter a valid gift card value."); return true; }
        if (!purchaserName || !recipientName) { alert("Enter purchaser and recipient names."); return true; }
        if (!recipientPhone && !recipientEmail) { alert("Enter recipient WhatsApp or email."); return true; }
        if (!expiryDate) { alert("Select an expiry date."); return true; }

        try {
            const old = window.THURAYA_EDITING_GIFT_CARD_ORIGINAL;
            if (!old?.handle || !old.version) throw new Error('Reload the Gift Card before editing.');
            const cardInput = { code: editingCode, amount, totalAllowedUses, purchaserName, purchaserPhone, recipientName, recipientPhone, recipientEmail, paymentMethod, expiryDate, message };
            const requestId = thGiftAdminRequestId('edit', cardInput);
            const saved = await ThurayaGiftAPI.call('edit', { handle: old.handle, version: old.version, card: cardInput, requestId });
            if (!isCurrent()) return;
            const updatedCard = await ThurayaGiftAPI.call('detail', { handle: saved.handle });
            if (!isCurrent()) return;
            window.THURAYA_GIFT_ADMIN_REQUEST = null;

            cacheGiftCard(updatedCard);

            window.THURAYA_EDITING_GIFT_CARD_CODE = "";
            window.THURAYA_EDITING_GIFT_CARD_ORIGINAL = null;

            const sellBtn = document.querySelector('button[onclick="sales_sellGiftCard()"]');
            if (sellBtn) {
                sellBtn.textContent = 'Sell & Issue Gift Card';
                delete sellBtn.dataset.editingGiftCardCode;
                sellBtn.classList.remove('is-editing-gift-card');
            }

            const result = document.getElementById("giftIssueResult");
            if (result) {
                result.innerHTML = `<div class="sales-note" style="border-left-color:var(--success);"><strong>Gift card updated.</strong> Code: ${safe(editingCode)} · Max uses: ${totalAllowedUses}</div>`;
            }

            sales_loadGiftCards();
        } catch(e) { if (!isCurrent()) return;
            console.warn("Gift card update failed");
            alert("Could not update gift card: " + e.message);
        }

        return true;
    }

    async function saveGiftCardImage(code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const card = getCachedGiftCard(code);
        if (!card) return;

        const filename = `${String(card.code || 'thuraya-gift-card').replace(/[^a-z0-9_-]/gi, '-')}.png`;

        try {
            const canvas = await thGiftCapturePreviewCanvas(card);
            if (!isCurrent()) return;
            const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png', 1));
            if (!isCurrent()) return;
            if (!blob) throw new Error('Could not create image file.');
            thGiftDownloadBlob(blob, filename);
        } catch(e) { if (!isCurrent()) return;
            console.warn('Gift card image download failed', e);
            alert('Could not download the card image on this device/browser. Please try from Chrome desktop or use your phone screenshot tool.');
        }
    }

    async function printGiftCard(code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const card = getCachedGiftCard(code);
        if (!card) return;

        try {
            const canvas = await thGiftCapturePreviewCanvas(card);
            if (!isCurrent()) return;
            const imgData = canvas.toDataURL('image/png', 1);

            const w = window.open('', '_blank');
            if (!w) {
                alert('Popup was blocked. Please allow popups to open the PDF-ready gift card.');
                return;
            }

            w.document.open();
            w.document.write(`<!doctype html>
<html>
<head>
<title>${safe(card.code || 'THURAYA Gift Card')} - PDF</title>
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1">
<style>
    @page { size: A4 landscape; margin: 10mm; }
    html,body{margin:0;padding:0;background:#f6f4f0;font-family:Inter,Arial,sans-serif;color:#111;}
    body{min-height:100vh;box-sizing:border-box;padding:16px;display:flex;flex-direction:column;align-items:center;gap:14px;overflow-x:hidden;}
    .pdf-toolbar{
        width:min(980px,100%);
        background:#fff;
        border:1px solid #ddd;
        border-radius:14px;
        padding:12px 14px;
        box-shadow:0 8px 22px rgba(0,0,0,.06);
        box-sizing:border-box;
    }
    .pdf-toolbar strong{display:block;font-size:15px;margin-bottom:5px;color:#111;}
    .pdf-toolbar span{display:block;font-size:13px;line-height:1.45;color:#555;}
    .pdf-actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px;}
    .pdf-actions button{
        border:1px solid #111;
        background:#111;
        color:#fff;
        border-radius:10px;
        padding:10px 14px;
        font-weight:800;
        letter-spacing:.04em;
        text-transform:uppercase;
        cursor:pointer;
    }
    .pdf-actions button.secondary{background:#fff;color:#111;}
    .pdf-image-page{
        width:min(980px,100%);
        display:flex;
        justify-content:center;
        align-items:center;
    }
    .pdf-card-image{
        display:block;
        width:min(980px,100%);
        max-width:100%;
        height:auto;
        border-radius:24px;
        box-shadow:0 18px 46px rgba(0,0,0,.16);
    }
    *{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important;box-sizing:border-box!important;}
    @media print{
        html,body{
            width:297mm;
            height:210mm;
            overflow:hidden;
            background:#fff!important;
        }
        body{
            padding:0!important;
            display:flex!important;
            align-items:center!important;
            justify-content:center!important;
        }
        .pdf-toolbar{display:none!important;}
        .pdf-image-page{
            width:277mm!important;
            min-height:190mm!important;
            overflow:visible!important;
            page-break-after:avoid!important;
            break-after:avoid!important;
        }
        .pdf-card-image{
            width:auto!important;
            max-width:260mm!important;
            max-height:190mm!important;
            height:auto!important;
            object-fit:contain!important;
            box-shadow:none!important;
            border-radius:18px!important;
        }
    }
</style>
</head>
<body>
    <div class="pdf-toolbar">
        <strong></strong>
        <span>The PDF page uses a captured image of the exact preview card, so the layout will not reflow. Tap “Share / Save PDF” below.</span>
        <div class="pdf-actions">
            <button type="button" onclick="window.print()">Share / Save PDF</button>
            <button type="button" class="secondary" onclick="window.close()">Close</button>
        </div>
    </div>
    <div class="pdf-image-page"><img class="pdf-card-image" src="${imgData}" alt="THURAYA Gift Card"></div>
</body>
</html>`);
            w.document.close();
        } catch(e) { if (!isCurrent()) return;
            console.warn('Gift card PDF preparation failed', e);
            alert('Could not prepare the PDF image on this device/browser. Please try again or use Save Card Image.');
        }
    }

    async function shareGiftCard(code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const card = await trustedGiftDetails(code);
        if (!isCurrent()) return;
        if (!card) return;
        const text = buildGiftShareText(card);
        try {
            if (navigator.share) {
                await navigator.share({ title: 'THURAYA Digital Gift Card', text });
                if (!isCurrent()) return;
                return;
            }
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(text);
                if (!isCurrent()) return;
                alert('Gift card text copied for sharing.');
                return;
            }
        } catch(e) { if (!isCurrent()) return; console.warn('Gift card share failed', e); }
        alert(text);
    }

    async function editGiftCardByCode(code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const card = await trustedGiftDetails(code);
        if (!isCurrent()) return;
        thGiftOpenEditFlow(card, code);
    }

    function thGiftAdminRequestId(action, input) {
        const signature = JSON.stringify([action, input]);
        const previous = window.THURAYA_GIFT_ADMIN_REQUEST;
        if (previous?.signature === signature) return previous.id;
        const request = { signature, id: crypto.randomUUID() };
        window.THURAYA_GIFT_ADMIN_REQUEST = request;
        return request.id;
    }

    async function sellGiftCard() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (await thGiftUpdateExistingCardIfNeeded()) return;
        if (!isCurrent()) return;
        if (!salesGiftRoleAllowed()) { alert("Gift card sales are restricted to Manager/Admin."); return; }
        const amount = Number(parseFloat(document.getElementById("gift_amount")?.value || "0"));
        const totalAllowedUses = Math.max(1, Number(parseInt(document.getElementById("gift_max_uses")?.value || "1", 10)) || 1);
        const normalized = ThurayaGiftCard.normalizeCode(document.getElementById("gift_code")?.value || generateGiftCardCode());
        if (!normalized.ok) { alert(ThurayaGiftCard.outcome('INVALID_CODE_FORMAT').message); return; }
        const code = normalized.code;
        const purchaserName = (document.getElementById("gift_purchaser")?.value || "").trim();
        const purchaserPhone = (document.getElementById("gift_purchaser_phone")?.value || "").trim();
        const recipientName = (document.getElementById("gift_recipient")?.value || "").trim();
        const recipientPhone = (document.getElementById("gift_recipient_phone")?.value || "").trim();
        const recipientEmail = (document.getElementById("gift_recipient_email")?.value || "").trim();
        const expiryDate = document.getElementById("gift_expiry")?.value || "";
        const paymentMethod = document.getElementById("gift_payment")?.value || "";
        const message = (document.getElementById("gift_message")?.value || "").trim();
        if (!amount || amount <= 0) { alert("Enter a valid gift card value."); return; }
        if (!purchaserName || !recipientName) { alert("Enter purchaser and recipient names."); return; }
        if (!recipientPhone && !recipientEmail) { alert("Enter recipient WhatsApp or email."); return; }
        if (!expiryDate) { alert("Select an expiry date."); return; }
        try {
            const cardInput = { code, amount, totalAllowedUses, purchaserName, purchaserPhone, recipientName, recipientPhone, recipientEmail, paymentMethod, expiryDate, message };
            const requestId = thGiftAdminRequestId('issue', cardInput);
            const saved = await ThurayaGiftAPI.call('issue', { card: cardInput, requestId });
            if (!isCurrent()) return;
            const previewCard = await ThurayaGiftAPI.call('detail', { handle: saved.handle });
            if (!isCurrent()) return;
            window.THURAYA_GIFT_ADMIN_REQUEST = null;

            cacheGiftCard(previewCard);
            const result = document.getElementById("giftIssueResult");
            if (result) result.innerHTML = `
                <div class="sales-note" style="border-left-color:var(--success);"><strong>Gift card issued.</strong> Code: ${safe(code)} · Max uses: ${totalAllowedUses}</div>`;
            openGiftCardPreview(previewCard);
            sales_loadGiftCards();
        } catch(e) { if (!isCurrent()) return;
            console.warn("Gift card sale failed");
            alert("Could not issue gift card: " + e.message);
        }
    }


    function thGiftAddMissingEditButtonsToRegistry() {
        const list = document.getElementById("salesGiftCardList");
        if (!list) return;
        list.querySelectorAll("tbody tr").forEach(row => {
            const actionCell = row.querySelector("td:last-child");
            if (!actionCell) return;
            const hasPreview = /preview/i.test(actionCell.textContent || "");
            const hasShare = /share/i.test(actionCell.textContent || "");
            const hasEdit = /edit/i.test(actionCell.textContent || "");
            if (!hasPreview || !hasShare || hasEdit) return;

            const previewBtn = Array.from(actionCell.querySelectorAll("button")).find(b => /preview/i.test(b.textContent || ""));
            const shareBtn = Array.from(actionCell.querySelectorAll("button")).find(b => /share/i.test(b.textContent || ""));
            if (!previewBtn || !shareBtn) return;

            let code = "";
            const onclick = previewBtn.getAttribute("onclick") || "";
            const m = onclick.match(/sales_previewGiftCardByCode\('([^']+)'\)/);
            if (m) code = m[1];

            if (!code) {
                const codeCell = row.children && row.children[1];
                code = (codeCell?.textContent || "").trim();
            }
            if (!code) return;

            const btn = document.createElement("button");
            btn.className = shareBtn.className || "sales-btn";
            btn.style.cssText = shareBtn.getAttribute("style") || "padding:6px 9px;font-size:.70rem;";
            btn.textContent = "Edit";
            btn.onclick = function(){ sales_editGiftCardByCode(code); };
            actionCell.insertBefore(btn, shareBtn);
            actionCell.insertBefore(document.createTextNode(" "), shareBtn);
        });
    }

    async function showGiftHistory(handle) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const dialog = document.createElement('dialog');
        dialog.setAttribute('aria-label', 'Gift Card redemption history');
        dialog.style.cssText = 'max-width:900px;width:calc(100% - 32px);max-height:85vh;border:1px solid #ddd;border-radius:8px;padding:20px;';
        dialog.innerHTML = '<h3>Gift Card Redemption History</h3><div data-history></div><button type="button" class="sales-btn" data-more>More</button> <button type="button" class="sales-btn" data-close>Close</button>';
        const previousFocus = document.activeElement;
        document.body.appendChild(dialog);
        dialog.querySelector('[data-close]').onclick = () => dialog.close();
        dialog.onclose = () => { dialog.remove(); if (isCurrent()) previousFocus?.focus?.(); };
        dialog.showModal();
        let cursor = null, rows = [];
        async function load() {
            if (!isCurrent()) return;
            const more = dialog.querySelector('[data-more]'); more.disabled = true;
            try {
                const page = await ThurayaGiftAPI.call('history', { handle, cursor });
                if (!isCurrent()) return;
                rows.push(...page.redemptions); cursor = page.cursor;
                dialog.querySelector('[data-history]').innerHTML = rows.length ? '<div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Date</th><th>Applied</th><th>Remaining</th><th>Receipt</th><th>Operator</th></tr></thead><tbody>' + rows.map(row => `<tr><td>${safe(ThurayaGiftCard.displayDate(row.redeemedAt))}</td><td>${Number(row.appliedAmount || 0).toFixed(2)} GHC</td><td>${Number(row.remainingAfter || 0).toFixed(2)} GHC</td><td>${safe(row.receiptRef || 'Legacy receipt')}</td><td style="overflow-wrap:anywhere;">${safe(row.redeemedBy)}</td></tr>`).join('') + '</tbody></table></div>' : '<p>No redemptions recorded.</p>';
                more.hidden = !cursor;
            } catch (error) { if (!isCurrent()) return; dialog.querySelector('[data-history]').textContent = error.message; }
            more.disabled = false;
        }
        dialog.querySelector('[data-more]').onclick = load;
        await load();
        if (!isCurrent()) return;
    }

    async function loadGiftCards() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const list = document.getElementById("salesGiftCardList");
        if (!list) return;
        list.innerHTML = `<p style="color:#777;">Loading gift cards...</p>`;
        try {
            const capabilities = await ThurayaGiftAPI.call('capabilities');
            if (!isCurrent()) return;
            if (!capabilities.capabilities.includes('giftAdmin')) throw new Error('Gift Card administration is not approved for this account.');
            const rows = [];
            let cursor = null;
            do {
                const page = await ThurayaGiftAPI.call('registry', { cursor });
                if (!isCurrent()) return;
                rows.push(...page.cards.map(card => ({ ...card, id: card.handle })));
                cursor = page.cursor;
            } while (cursor);
            rows.sort((a,b) => String(b.issuedAt || '').localeCompare(String(a.issuedAt || '')));

            if (!rows.length) { list.innerHTML = `<p style="color:#999;font-style:italic;">No gift cards issued yet.</p>`; return; }
            const states = new Map(rows.map(r => [r.id, { ...ThurayaGiftCard.classify(r), state: r.state, label: r.stateLabel, valid: r.state === 'VALID' }]));
            const active = rows.filter(r => states.get(r.id).valid).length;
            const outstanding = rows.reduce((sum,r) => sum + Number(r.remainingBalance || 0), 0);
            list.innerHTML = `
                <div class="sales-grid" style="margin-top:0;"><div class="sales-card sales-kpi"><span>Issued Cards</span><strong>${rows.length}</strong></div><div class="sales-card sales-kpi"><span>Available Cards</span><strong>${active}</strong></div><div class="sales-card sales-kpi"><span>Outstanding Value</span><strong>${outstanding.toFixed(2)} GHC</strong></div><div class="sales-card sales-kpi"><span>Redeemed/Closed</span><strong>${rows.filter(r => ['REDEEMED','USE_LIMIT_REACHED','NO_BALANCE','INACTIVE'].includes(states.get(r.id).state)).length}</strong></div></div>
                <div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Status</th><th>Code</th><th>Value</th><th>Remaining</th><th>Uses</th><th>Recipient</th><th>Purchaser</th><th>Expiry</th><th>Actions</th></tr></thead><tbody>
                ${rows.map(r => {
                    const cacheKey = cacheGiftCard(r);
                    const state = states.get(r.id);
                    const maxUses = state.maxUses, used = state.usedCount, remainingUses = state.remainingUses;
                    const expiry = ThurayaGiftCard.expiry(r);
                    const expiryText = expiry.ok ? ThurayaGiftCard.displayDate(expiry.date, 'No expiry') : 'Date needs review';
                    return `<tr><td><span class="sales-badge ${state.valid?'active':'paused'}" title="${safe(state.message)}">${safe(state.label)}</span></td><td><strong>${safe(r.maskedCode)}</strong></td><td>${Number(r.amount||0).toFixed(2)} GHC</td><td>${Number(r.remainingBalance||0).toFixed(2)} GHC</td><td><strong>${remainingUses}</strong> / ${maxUses}<br><small>${used} used</small></td><td>${safe(r.recipientName||'')}<br><small>${safe(r.recipientPhone||r.recipientEmail||'')}</small></td><td>${safe(r.purchaserName||'')}</td><td>${safe(expiryText)}</td><td><button class="sales-btn" style="padding:6px 9px;font-size:.70rem;" onclick="sales_previewGiftCardByCode('${safe(cacheKey)}')">Preview</button> <button class="sales-btn" style="padding:6px 9px;font-size:.70rem;" onclick="sales_editGiftCardByCode('${safe(cacheKey)}')">Edit</button> <button class="sales-btn" style="padding:6px 9px;font-size:.70rem;" onclick="sales_shareGiftCard('${safe(cacheKey)}')">Share</button></td></tr>`;
                }).join('')}</tbody></table></div>`;
            thGiftAddMissingEditButtonsToRegistry();
            list.querySelectorAll('tbody tr').forEach((row, index) => {
                const button = document.createElement('button');
                button.type = 'button'; button.className = 'sales-btn'; button.textContent = 'History';
                button.style.cssText = 'padding:6px 9px;font-size:.70rem;';
                button.onclick = () => showGiftHistory(rows[index].handle);
                row.querySelector('td:last-child').append(button);
            });
        } catch(e) { if (!isCurrent()) return;
            console.warn("Gift Card registry request failed");
            list.innerHTML = `<div class="sales-note" style="border-left-color:var(--error);">Could not load gift cards.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    function renderDiscounts() {
        document.getElementById("salesContent").innerHTML = `
            <div class="sales-note">
                Discount application to checkout is intentionally not enabled yet. This keeps billing stable while rules are defined.
            </div>
            <div class="sales-card">
                <h3>Discount Strategy</h3>
                <p style="color:#666;">Recommended next step: add a controlled discount selector inside Billing & Checkout that records discount reason, approver, and promo code.</p>
            </div>
        `;
    }

    function renderCampaigns() {
        document.getElementById("salesContent").innerHTML = `
            <div class="sales-card">
                <h3>Campaign Tracking</h3>
                <p style="color:#666;">Track campaigns such as Instagram, WhatsApp, referral, birthday, and seasonal promos.</p>
                <div class="sales-note">Phase 2 can connect campaign source to bookings using <strong>sourceCampaign</strong> and <strong>promoCode</strong> fields.</div>
            </div>
        `;
    }

    function renderSegments() {
        document.getElementById("salesContent").innerHTML = `
            <div class="sales-card">
                <h3>Client Spend Segmentation</h3>
                <p style="color:#666;">Future segments: VIP clients, dormant clients, new clients, high spenders, promo-sensitive clients, and repeat visitors.</p>
                <div class="sales-note">This will read from closed jobs and client history. It will not affect billing.</div>
            </div>
        `;
    }


    function generatePromoCode() {
        const name = (document.getElementById("promo_name")?.value || "THURAYA").trim();
        const discount = document.getElementById("promo_discount")?.value || "";
        const prefix = name
            .replace(/[^a-zA-Z0-9 ]/g, "")
            .split(/\s+/)
            .filter(Boolean)
            .slice(0, 2)
            .map(w => w.substring(0, 4).toUpperCase())
            .join("");

        const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
        let suffix = "";
        if (window.crypto && crypto.getRandomValues) {
            const arr = new Uint8Array(4);
            crypto.getRandomValues(arr);
            suffix = Array.from(arr, b => chars[b % chars.length]).join("");
        } else {
            suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
        }

        const discountPart = discount ? String(parseInt(discount, 10) || "").replace(/\D/g, "") : "";
        const code = `${prefix || "THURAYA"}${discountPart ? discountPart : ""}-${suffix}`;

        const codeInput = document.getElementById("promo_code");
        if (codeInput) codeInput.value = code;
    }


    async function savePromo() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const name = document.getElementById("promo_name")?.value.trim() || "";
        const code = document.getElementById("promo_code")?.value.trim().toUpperCase() || "";
        const discount = Number(parseFloat(document.getElementById("promo_discount")?.value || "0"));
        const start = document.getElementById("promo_start")?.value || "";
        const end = document.getElementById("promo_end")?.value || "";
        const status = document.getElementById("promo_status")?.value || "Active";
        const promoType = document.getElementById("promo_type")?.value || "coupon_percent";
        const packagePrice = Number(parseFloat(document.getElementById("promo_packagePrice")?.value || "0"));
        const totalSessions = Number(parseInt(document.getElementById("promo_totalSessions")?.value || "0", 10));
        const validityDays = Number(parseInt(document.getElementById("promo_validityDays")?.value || "0", 10));
        const autoRule = document.getElementById("promo_autoRule")?.value || "manual";
        const weekday = document.getElementById("promo_weekday")?.value || "";
        const maxUses = Number(parseInt(document.getElementById("promo_maxUses")?.value || "0", 10));
        const maxUsesPerClient = Number(parseInt(document.getElementById("promo_maxPerClient")?.value || "0", 10));

        if (!name || !code || !start || !end) {
            alert("Please complete promo/package name, code, start date, and end date.");
            return;
        }

        if (promoType === "coupon_percent" && !discount) {
            alert("Enter discount percentage for coupon codes.");
            return;
        }

        if ((promoType === "package_fixed_price" || promoType === "package_wallet") && !packagePrice) {
            alert("Enter package price for package codes.");
            return;
        }

        if (promoType === "package_wallet" && !totalSessions) {
            alert("Enter total sessions for prepaid package wallet.");
            return;
        }
        if (end < start) {
            alert("End date cannot be before start date.");
            return;
        }

        try {
            await db.collection("Sales_Promotions").doc(code).set({
                name, code, promoType, offerType: promoType, discountPercent: discount, packagePrice,
                totalSessions, validityDays,
                autoRule, weekday, maxUses, maxUsesPerClient,
                startDate: start, endDate: end, status,
                createdAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                createdBy: typeof currentUserEmail !== "undefined" ? currentUserEmail : ""
            }, { merge: true });
            if (!isCurrent()) return;
            alert("Promotion saved.");
            sales_loadPromos();
        } catch(e) { if (!isCurrent()) return;
            console.error("Save promo failed", e);
            alert("Could not save promotion: " + e.message);
        }
    }

    async function loadPromos() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const list = document.getElementById("salesPromoList");
        if (!list) return;
        list.innerHTML = `<p style="color:#777;">Loading...</p>`;

        try {
            const snap = await db.collection("Sales_Promotions").get();
            if (!isCurrent()) return;
            const rows = [];
            snap.forEach(doc => {
                const row = { id: doc.id, ...doc.data() };
                if (!isArchivedRecord(row)) rows.push(row);
            });

            rows.sort((a,b) => String(b.startDate || "").localeCompare(String(a.startDate || "")));

            const activeCount = rows.filter(r => String(r.status || "").toLowerCase() === "active").length;
            const k = document.getElementById("salesActivePromos");
            if (k) k.textContent = activeCount;

            if (!rows.length) {
                list.innerHTML = `<p style="color:#999;font-style:italic;">No promotions created yet.</p>`;
                return;
            }

            list.innerHTML = `
                <div class="sales-table-wrap">
                    <table class="sales-table">
                        <thead>
                            <tr><th>Status</th><th>Offer</th><th>Code</th><th>Type</th><th>Value</th><th>Auto</th><th>Limits</th><th>Period</th><th>Actions</th></tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => `
                                <tr>
                                    <td><span class="sales-badge ${String(r.status || "").toLowerCase() === "active" ? "active" : "paused"}">${safe(r.status || "")}</span></td>
                                    <td><strong>${safe(r.name)}</strong></td>
                                    <td><strong>${safe(r.code || r.id)}</strong></td>
                                    <td>${safe((r.promoType || r.offerType || "coupon_percent") === "package_fixed_price" ? "Package" : "Coupon")}</td>
                                    <td>${safe((r.promoType || r.offerType) === "package_wallet" ? (r.packagePrice || 0) + " GHC · " + (r.totalSessions || 0) + " sessions" : ((r.promoType || r.offerType) === "package_fixed_price" ? (r.packagePrice || 0) + " GHC" : (r.discountPercent || 0) + "%"))}</td>
                                    <td>${safe(r.autoRule || "manual")}${r.weekday !== undefined && r.weekday !== "" ? " · Day " + safe(r.weekday) : ""}</td>
                                    <td>${safe(r.maxUses || 0) || "∞"} total / ${safe(r.maxUsesPerClient || 0) || "∞"} per client</td>
                                    <td>${safe(r.startDate)} → ${safe(r.endDate)}</td>
                                    <td>
                                        <button class="sales-btn" style="padding:6px 9px;font-size:.72rem;" onclick="sales_pausePromo('${safe(r.id)}', '${String(r.status || "").toLowerCase() === "active" ? "Paused" : "Active"}')">
                                            ${String(r.status || "").toLowerCase() === "active" ? "Pause" : "Activate"}
                                        </button>
                                    </td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        } catch(e) { if (!isCurrent()) return;
            console.error("Load promos failed", e);
            list.innerHTML = `<div class="sales-note" style="border-left-color:var(--error);">Could not load promotions.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    async function pausePromo(id, status) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        try {
            await db.collection("Sales_Promotions").doc(id).set({
                status,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: typeof currentUserEmail !== "undefined" ? currentUserEmail : ""
            }, { merge: true });
            if (!isCurrent()) return;
            sales_loadPromos();
        } catch(e) { if (!isCurrent()) return;
            alert("Could not update promotion: " + e.message);
        }
    }




    async function findClientPackageWallet(clientPhone, code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!clientPhone || !code) return null;
        try {
            const snap = await db.collection("Client_Packages")
                .where("clientPhone", "==", clientPhone)
                .where("packageCode", "==", code)
                .where("status", "==", "Active")
                .get();
                if (!isCurrent()) return;

            let wallets = [];
            snap.forEach(doc => wallets.push({ id: doc.id, ...doc.data() }));
            wallets = wallets.filter(w => {
                const remaining = Number(parseInt(w.remainingSessions || 0, 10));
                const expiry = w.expiryDate || "";
                return remaining > 0 && (!expiry || expiry >= todayStr());
            });
            wallets.sort((a,b) => String(a.expiryDate || "9999-12-31").localeCompare(String(b.expiryDate || "9999-12-31")));
            return wallets[0] || null;
        } catch(e) { if (!isCurrent()) return;
            console.warn("Could not find client package wallet", e);
            return null;
        }
    }

    async function createClientPackageWalletFromCode(clientPhone, clientName, code) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!clientPhone || !code) {
            alert("Select a client and package code first.");
            return;
        }

        const promoDoc = await db.collection("Sales_Promotions").doc(code).get();
        if (!isCurrent()) return;
        if (!promoDoc.exists) {
            alert("Package code not found.");
            return;
        }

        const p = promoDoc.data() || {};
        const type = p.promoType || p.offerType || p.type || "";
        if (type !== "package_wallet") {
            alert("This code is not a prepaid package wallet.");
            return;
        }

        const totalSessions = Number(parseInt(p.totalSessions || 0, 10));
        if (!totalSessions) {
            alert("Package has no total sessions configured.");
            return;
        }

        const today = todayStr();
        let expiryDate = "";
        const validityDays = Number(parseInt(p.validityDays || 0, 10));
        if (validityDays > 0) {
            const d = new Date(today + "T12:00:00");
            d.setDate(d.getDate() + validityDays);
            expiryDate = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }

        const id = `${clientPhone}_${code}_${Date.now()}`;
        await db.collection("Client_Packages").doc(id).set({
            clientPhone,
            clientName: clientName || "",
            packageCode: code,
            packageName: p.name || code,
            packagePrice: Number(parseFloat(p.packagePrice || 0)),
            totalSessions,
            usedSessions: 0,
            remainingSessions: totalSessions,
            purchaseDate: today,
            expiryDate,
            status: "Active",
            createdAt: firebase.firestore.FieldValue.serverTimestamp(),
            createdBy: typeof currentUserEmail !== "undefined" ? currentUserEmail : ""
        });
        if (!isCurrent()) return;

        alert("Client package wallet created.");
        return id;
    }


    async function countClientRedemptions(code, clientPhone) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!code || !clientPhone) return 0;
        try {
            const snap = await db.collection("Sales_Redemptions")
                .where("code", "==", code)
                .where("clientPhone", "==", clientPhone)
                .get();
                if (!isCurrent()) return;
            return snap.size;
        } catch(e) { if (!isCurrent()) return;
            console.warn("Could not count client redemptions", e);
            return 0;
        }
    }

    async function clientHasPriorClosedJobs(clientPhone) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!clientPhone) return false;
        try {
            const snap = await db.collection("Active_Jobs")
                .where("clientPhone", "==", clientPhone)
                .where("status", "==", "Closed")
                .get();
                if (!isCurrent()) return;
            let hasActivePriorJob = false;
            snap.forEach(doc => {
                if (hasActivePriorJob) return;
                const row = doc.data() || {};
                if (!isArchivedRecord(row)) hasActivePriorJob = true;
            });
            return hasActivePriorJob;
        } catch(e) { if (!isCurrent()) return;
            console.warn("Could not check prior client jobs", e);
            return false;
        }
    }

    async function getClientDobMonth(clientPhone) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!clientPhone) return "";
        try {
            const doc = await db.collection("Clients").doc(clientPhone).get();
            if (!isCurrent()) return;
            if (!doc.exists) return "";
            const dob = String((doc.data() || {}).DOB || "");
            if (/^\d{4}-\d{2}-\d{2}/.test(dob)) return dob.slice(5,7);
            return "";
        } catch(e) { if (!isCurrent()) return;
            console.warn("Could not check client DOB", e);
            return "";
        }
    }

    async function promoPassesUsageLimits(promo, code, clientPhone) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const maxUses = Number(parseInt(promo.maxUses || 0, 10));
        const maxPerClient = Number(parseInt(promo.maxUsesPerClient || 0, 10));
        const redemptionCount = Number(parseInt(promo.redemptionCount || 0, 10));

        if (maxUses > 0 && redemptionCount >= maxUses) {
            return { ok: false, reason: "This code has reached its total usage limit." };
        }

        if (maxPerClient > 0 && clientPhone) {
            const usedByClient = await countClientRedemptions(code, clientPhone);
            if (!isCurrent()) return;
            if (usedByClient >= maxPerClient) {
                return { ok: false, reason: "This client has already reached the usage limit for this code." };
            }
        }

        return { ok: true };
    }

    async function promoPassesAutoRule(promo, clientPhone, bookingDate) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const rule = promo.autoRule || "manual";
        if (rule === "manual") return { ok: false, reason: "Manual code only." };

        if (rule === "weekday") {
            const weekday = String(promo.weekday ?? "");
            if (!weekday) return { ok: false, reason: "No weekday configured." };
            const d = new Date((bookingDate || todayStr()) + "T12:00:00");
            return String(d.getDay()) === weekday
                ? { ok: true }
                : { ok: false, reason: "Not valid for this booking weekday." };
        }

        if (rule === "first_time_client") {
            const hasPrior = await clientHasPriorClosedJobs(clientPhone);
            if (!isCurrent()) return;
            return !hasPrior ? { ok: true } : { ok: false, reason: "Client is not first-time." };
        }

        if (rule === "birthday_month") {
            const dobMonth = await getClientDobMonth(clientPhone);
            if (!isCurrent()) return;
            const bookingMonth = String(bookingDate || todayStr()).slice(5,7);
            return dobMonth && dobMonth === bookingMonth
                ? { ok: true }
                : { ok: false, reason: "Not client's birthday month." };
        }

        return { ok: false, reason: "Unknown auto rule." };
    }

    function applyPromoToBookingState(code, p, autoApplied = false) {
        const type = p.promoType || p.offerType || p.type || "coupon_percent";
        const discountPercent = parseFloat(p.discountPercent || 0);
        const packagePrice = parseFloat(p.packagePrice || 0);

        window.THURAYA_ACTIVE_PROMO = {
            code,
            name: p.name || code,
            type,
            discountPercent,
            packagePrice,
            payNowAmount: type === "package_wallet" ? 0 : packagePrice,
            walletId: p.__wallet?.id || "",
            totalSessions: p.totalSessions || 0,
            remainingSessions: p.__wallet?.remainingSessions || "",
            remainingAfter: p.__wallet ? Math.max(0, Number(parseInt(p.__wallet.remainingSessions || 0, 10)) - 1) : "",
            startDate: p.startDate || "",
            endDate: p.endDate || "",
            autoApplied: !!autoApplied
        };

        const set = (id, val) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        };

        set("sched_promoCode", code);
        set("sched_promoName", p.name || code);
        set("sched_promoType", type);
        set("sched_discountPercent", discountPercent || 0);
        set("sched_packageWalletId", p.__wallet?.id || "");
        set("sched_packageSessionsUsed", type === "package_wallet" ? 1 : 0);
        set("sched_packageRemainingAfter", p.__wallet ? Math.max(0, Number(parseInt(p.__wallet.remainingSessions || 0, 10)) - 1) : "");

        if (typeof window.calculateScheduleTotals !== "function") throw new Error("FINANCIAL_CALCULATOR_UNAVAILABLE");
        window.calculateScheduleTotals();
        if (window.THURAYA_FINANCIAL_ERROR) throw new Error(window.THURAYA_FINANCIAL_ERROR);
    }

    async function validatePromoCodeCommon(code, autoApplied = false) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const msg = document.getElementById("sched_promoMsg");
        const clientPhone = document.getElementById("sched_phone")?.value || "";
        const bookingDate = document.getElementById("sched_date")?.value || todayStr();

        const doc = await db.collection("Sales_Promotions").doc(code).get();
        if (!isCurrent()) return;
        if (!doc.exists) return { ok: false, reason: "Invalid code. No active coupon/package found." };

        const p = doc.data() || {};
        const today = todayStr();
        const status = String(p.status || "").toLowerCase();
        const start = p.startDate || "";
        const end = p.endDate || "";

        if (status !== "active") return { ok: false, reason: "This code is not active." };
        if ((start && today < start) || (end && today > end)) return { ok: false, reason: `This code is outside its valid period (${start} to ${end}).` };

        const type = p.promoType || p.offerType || p.type || "coupon_percent";
        if (type === "coupon_percent" && !(parseFloat(p.discountPercent || 0) > 0)) return { ok: false, reason: "This coupon has no valid discount percentage." };
        if (type === "package_fixed_price" && !(parseFloat(p.packagePrice || 0) > 0)) return { ok: false, reason: "This package has no valid package price." };

        const limitCheck = await promoPassesUsageLimits(p, code, clientPhone);
        if (!isCurrent()) return;
        if (!limitCheck.ok) return limitCheck;

        if (type === "package_wallet") {
            const wallet = await findClientPackageWallet(clientPhone, code);
            if (!isCurrent()) return;
            if (!wallet) {
                return { ok: false, reason: "No active package wallet found for this client/code. Create or sell the package wallet first." };
            }
            p.__wallet = wallet;
        }

        applyPromoToBookingState(code, p, autoApplied);

        if (msg) {
            msg.innerHTML = `✅ ${autoApplied ? "Auto-applied" : "Applied"} <strong>${code}</strong>. Discount will sync into booking and billing totals.`;
            msg.style.color = "var(--success)";
        }

        return { ok: true, promo: p };
    }

    async function autoApplyBestPromo() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const msg = document.getElementById("sched_promoMsg");
        const clientPhone = document.getElementById("sched_phone")?.value || "";
        const bookingDate = document.getElementById("sched_date")?.value || todayStr();

        if (!clientPhone || !bookingDate) {
            if (msg) {
                msg.innerText = "Select a client and date before auto-applying promos.";
                msg.style.color = "var(--error)";
            }
            return;
        }

        if (msg) {
            msg.innerText = "Checking eligible auto promotions...";
            msg.style.color = "#777";
        }

        try {
            const snap = await db.collection("Sales_Promotions").where("status", "==", "Active").get();
            if (!isCurrent()) return;
            const candidates = [];

            for (const doc of snap.docs) {
                const p = doc.data() || {};
                const code = p.code || doc.id;
                if (!p.autoRule || p.autoRule === "manual") continue;

                const today = todayStr();
                if ((p.startDate && today < p.startDate) || (p.endDate && today > p.endDate)) continue;

                const ruleCheck = await promoPassesAutoRule(p, clientPhone, bookingDate);
                if (!isCurrent()) return;
                if (!ruleCheck.ok) continue;

                const limitCheck = await promoPassesUsageLimits(p, code, clientPhone);
                if (!isCurrent()) return;
                if (!limitCheck.ok) continue;

                const score = (p.promoType || p.offerType) === "package_fixed_price"
                    ? 1000
                    : parseFloat(p.discountPercent || 0);

                candidates.push({ code, promo: p, score });
            }

            candidates.sort((a,b) => b.score - a.score);

            if (!candidates.length) {
                clearBookingPromo(false);
                if (msg) {
                    msg.innerText = "No eligible auto promotion found for this client/date.";
                    msg.style.color = "#777";
                }
                return;
            }

            const best = candidates[0];
            applyPromoToBookingState(best.code, best.promo, true);

            const input = document.getElementById("sched_promoInput");
            if (input) input.value = best.code;

            if (msg) {
                msg.innerHTML = `✅ Auto-applied best promotion: <strong>${best.code}</strong>`;
                msg.style.color = "var(--success)";
            }
        } catch(e) { if (!isCurrent()) return;
            console.error("Auto promo failed", e);
            if (msg) {
                msg.innerText = "Could not auto-apply promo: " + e.message;
                msg.style.color = "var(--error)";
            }
        }
    }


    async function validateBookingPromo() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const input = document.getElementById("sched_promoInput");
        const msg = document.getElementById("sched_promoMsg");
        const code = (input?.value || "").trim().toUpperCase();

        if (!code) {
            if (msg) {
                msg.innerText = "Enter a coupon or package code.";
                msg.style.color = "var(--error)";
            }
            return;
        }

        if (msg) {
            msg.innerText = "Checking code...";
            msg.style.color = "#777";
        }

        try {
            const result = await validatePromoCodeCommon(code, false);
            if (!isCurrent()) return;
            if (!result.ok) {
                clearBookingPromo(false);
                if (msg) {
                    msg.innerText = result.reason;
                    msg.style.color = "var(--error)";
                }
            }
        } catch(e) { if (!isCurrent()) return;
            console.error("Promo validation failed", e);
            if (msg) {
                msg.innerText = "Could not validate code: " + e.message;
                msg.style.color = "var(--error)";
            }
        }
    }

    function clearBookingPromo(showMessage = true) {
        window.THURAYA_ACTIVE_PROMO = null;

        const ids = {
            sched_promoCode: "",
            sched_promoName: "",
            sched_promoType: "",
            sched_discountPercent: "0",
            sched_discountAmount: "0",
            sched_originalTotal: "0",
            sched_finalTotal: "0",
            sched_packageWalletId: "",
            sched_packageSessionsUsed: "0",
            sched_packageRemainingAfter: ""
        };

        Object.entries(ids).forEach(([id, val]) => {
            const el = document.getElementById(id);
            if (el) el.value = val;
        });

        const input = document.getElementById("sched_promoInput");
        if (input && showMessage) input.value = "";

        const msg = document.getElementById("sched_promoMsg");
        if (msg && showMessage) {
            msg.innerText = "Optional: apply an active coupon/package code before booking.";
            msg.style.color = "#777";
        }

        if (typeof window.calculateScheduleTotals !== "function") throw new Error("FINANCIAL_CALCULATOR_UNAVAILABLE");
        window.calculateScheduleTotals();
        if (window.THURAYA_FINANCIAL_ERROR) throw new Error(window.THURAYA_FINANCIAL_ERROR);
    }



    function renderRedemptions() {
        const el = document.getElementById("salesContent");
        if (!el) return;
        el.innerHTML = `
            <div class="sales-note">
                Redemption tracking is created automatically when checkout is completed for bookings with promo/package codes.
            </div>
            <div class="sales-card">
                <h3>Redemption Report</h3>
                <div class="sales-form-grid">
                    <div class="form-group"><label>Start Date</label><input type="date" id="red_start"></div>
                    <div class="form-group"><label>End Date</label><input type="date" id="red_end"></div>
                    <div class="form-group"><label>Code Filter</label><input type="text" id="red_code" placeholder="Optional promo code"></div>
                </div>
                <div class="sales-actions">
                    <button class="sales-btn primary" onclick="sales_loadRedemptions()">Load Redemptions</button>
                    <button class="sales-btn" onclick="sales_exportRedemptionsCsv()">Export CSV</button>
                </div>
            </div>
            <div class="sales-grid">
                <div class="sales-card sales-kpi"><span>Redemptions</span><strong id="red_kpi_count">0</strong></div>
                <div class="sales-card sales-kpi"><span>Gross Service Value</span><strong id="red_kpi_original">0.00 GHC</strong></div>
                <div class="sales-card sales-kpi"><span>Promo Discount</span><strong id="red_kpi_discount">0.00 GHC</strong></div>
                <div class="sales-card sales-kpi"><span>Complimentary Waived</span><strong id="red_kpi_complimentary">0.00 GHC</strong></div>
                <div class="sales-card sales-kpi"><span>Taxable Net</span><strong id="red_kpi_final">0.00 GHC</strong></div>
                <div class="sales-card sales-kpi"><span>Gift Card Redeemed</span><strong id="red_kpi_gift">0.00 GHC</strong></div>
                <div class="sales-card sales-kpi"><span>Voucher Discount</span><strong id="red_kpi_voucher">0.00 GHC</strong></div>
            </div>
            <div class="sales-card">
                <h3>Redemption Details</h3>
                <div id="salesRedemptionList"><p style="color:#999;font-style:italic;">Load redemptions to view details.</p></div>
            </div>
        `;

        const today = todayStr();
        const start = document.getElementById("red_start");
        const end = document.getElementById("red_end");
        if (start) start.value = today;
        if (end) end.value = today;
    }

    let lastRedemptionRows = [];

    function salesPromoNumber(value, fallback = 0) {
        if (value === null || value === undefined || value === "") return fallback;
        const n = Number(value);
        return Number.isFinite(n) ? n : fallback;
    }

    function salesPromoFirstNumber(source, keys, fallback = 0) {
        if (!source) return fallback;
        for (const key of keys) {
            if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
            const value = source[key];
            if (value === null || value === undefined || value === "") continue;
            const n = Number(value);
            if (Number.isFinite(n)) return n;
        }
        return fallback;
    }

    function salesPromoGiftCardRedeemed(redemptionRow, jobRow) {
        const rowValue = salesPromoFirstNumber(redemptionRow, [
            "giftCardRedeemed",
            "giftCardAppliedAmount",
            "giftCardAmount",
            "giftCardCredit"
        ], null);
        if (rowValue !== null) return Math.max(0, rowValue);

        const jobValue = salesPromoFirstNumber(jobRow, [
            "giftCardRedeemed",
            "giftCardAppliedAmount",
            "giftCardAmount",
            "giftCardCredit"
        ], null);
        if (jobValue !== null) return Math.max(0, jobValue);

        const redemptionRows = Array.isArray(jobRow?.giftCardRedemptions)
            ? jobRow.giftCardRedemptions
            : [];
        return redemptionRows.reduce((sum, item) => {
            return sum + Math.max(0, salesPromoFirstNumber(item, ["appliedAmount", "amount", "credit"], 0));
        }, 0);
    }

    function salesPromoFinancials(redemptionRow, jobRow) {
        const promoDiscount = Math.max(0, salesPromoNumber(redemptionRow?.discountAmount, 0));
        const voucherDiscount = Math.max(0, salesPromoFirstNumber(redemptionRow, [
            "voucherDiscount",
            "voucherDiscountAmount",
            "voucherAmount",
            "packageDiscount",
            "packageDiscountAmount"
        ], salesPromoFirstNumber(jobRow, [
            "voucherDiscount",
            "voucherDiscountAmount",
            "voucherAmount",
            "packageDiscount",
            "packageDiscountAmount"
        ], 0)));
        const giftCardRedeemed = salesPromoGiftCardRedeemed(redemptionRow, jobRow);

        let normalized = null;
        if (jobRow && typeof window.normalizeComplimentaryFinancials === "function") {
            try {
                normalized = window.normalizeComplimentaryFinancials(jobRow);
            } catch(e) {
                console.warn("Sales/Promo financial normalization failed", e);
            }
        }

        const evidence = window.thFinancialEvidence.read(jobRow || redemptionRow || {});
        const gross = evidence.gross ?? window.thFinancialEvidence.firstAmount(redemptionRow, ["grossServiceValue", "originalTotal"]);
        const complimentary = normalized ? Math.max(0, salesPromoNumber(normalized.complimentaryValue, 0)) : Math.max(0, salesPromoFirstNumber(redemptionRow, [
            "complimentaryValue",
            "complimentaryWaived",
            "complimentaryAmount"
        ], 0));
        return {
            grossServiceValue: gross,
            complimentaryValue: complimentary,
            netRevenue: evidence.net,
            adjustedGross: evidence.finalGross,
            giftCardRedeemed,
            promoDiscount,
            voucherDiscount
        };
    }

    function salesEvidenceMoney(value) {
        return value === null || value === undefined ? "Unavailable" : Number(value).toFixed(2);
    }

    function salesEvidenceTotal(rows, key) {
        const values = rows.map(row => row.__financials[key]);
        return values.some(value => value === null) ? null : window.thFinancialEvidence.sumMoney(values);
    }

    async function loadJobsForRedemptionRows(rows) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const jobsById = new Map();
        const ids = Array.from(new Set((rows || []).map(row => String(row.jobId || row.bookingId || "").trim()).filter(Boolean)));
        for (let i = 0; i < ids.length; i += 10) {
            const batch = ids.slice(i, i + 10);
            await Promise.all(batch.map(async id => {
                if (!isCurrent()) return;
                try {
                    const doc = await db.collection("Active_Jobs").doc(id).get();
                    if (!isCurrent()) return;
                    if (doc.exists) {
                        const job = { id: doc.id, ...doc.data() };
                        if (!isArchivedRecord(job)) jobsById.set(id, job);
                    }
                } catch(e) { if (!isCurrent()) return;
                    console.warn("Could not load redemption job context", id, e);
                }
            }));
            if (!isCurrent()) return;
        }
        return jobsById;
    }

    async function loadRedemptions() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const list = document.getElementById("salesRedemptionList");
        if (!list) return;

        const start = document.getElementById("red_start")?.value || "";
        const end = document.getElementById("red_end")?.value || "";
        const codeFilter = (document.getElementById("red_code")?.value || "").trim().toUpperCase();

        if (!start || !end) {
            alert("Select start and end date.");
            return;
        }

        list.innerHTML = `<p style="color:#777;">Loading redemptions...</p>`;

        try {
            const snap = await db.collection("Sales_Redemptions")
                .where("dateString", ">=", start)
                .where("dateString", "<=", end)
                .get();
                if (!isCurrent()) return;

            let rows = [];
            snap.forEach(doc => {
                const row = { id: doc.id, ...doc.data() };
                if (!isArchivedRecord(row)) rows.push(row);
            });

            if (codeFilter) rows = rows.filter(r => String(r.code || r.promoCode || "").toUpperCase() === codeFilter);

            rows.sort((a,b) => `${b.dateString || ""}${b.timeString || ""}`.localeCompare(`${a.dateString || ""}${a.timeString || ""}`));
            const jobsById = await loadJobsForRedemptionRows(rows);
            if (!isCurrent()) return;
            rows = rows.map(row => {
                const jobKey = String(row.jobId || row.bookingId || "").trim();
                const jobRow = jobsById.get(jobKey) || null;
                return { ...row, __jobRow: jobRow, __financials: salesPromoFinancials(row, jobRow) };
            });
            lastRedemptionRows = rows;

            const count = rows.length;
            const original = salesEvidenceTotal(rows, "grossServiceValue");
            const discount = rows.reduce((s,r) => s + salesPromoNumber(r.__financials?.promoDiscount, 0), 0);
            const complimentary = rows.reduce((s,r) => s + salesPromoNumber(r.__financials?.complimentaryValue, 0), 0);
            const finalRev = salesEvidenceTotal(rows, "netRevenue");
            const giftRedeemed = rows.reduce((s,r) => s + salesPromoNumber(r.__financials?.giftCardRedeemed, 0), 0);
            const voucherDiscount = rows.reduce((s,r) => s + salesPromoNumber(r.__financials?.voucherDiscount, 0), 0);

            const setText = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
            setText("red_kpi_count", count);
            setText("red_kpi_original", salesEvidenceMoney(original) + " GHC");
            setText("red_kpi_discount", discount.toFixed(2) + " GHC");
            setText("red_kpi_complimentary", complimentary.toFixed(2) + " GHC");
            setText("red_kpi_final", salesEvidenceMoney(finalRev) + " GHC");
            setText("red_kpi_gift", giftRedeemed.toFixed(2) + " GHC");
            setText("red_kpi_voucher", voucherDiscount.toFixed(2) + " GHC");

            if (!rows.length) {
                list.innerHTML = `<p style="color:#999;font-style:italic;">No redemptions found for this range.</p>`;
                return;
            }

            list.innerHTML = `
                <div class="sales-table-wrap">
                    <table class="sales-table">
                        <thead>
                            <tr>
                                <th>Date</th>
                                <th>Code</th>
                                <th>Client</th>
                                <th>Gross</th>
                                <th>Promo Discount</th>
                                <th>Complimentary</th>
                                <th>Taxable Net</th>
                                <th>Adjusted Gross</th>
                                <th>Gift Card</th>
                                <th>Voucher</th>
                                <th>Payment</th>
                                <th>Redeemed By</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => {
                                const fin = r.__financials || salesPromoFinancials(r, r.__jobRow || null);
                                return `
                                <tr>
                                    <td>${safe(r.dateString || "")}<br><span style="color:#777;font-size:.76rem;">${safe(r.timeString || "")}</span></td>
                                    <td><strong>${safe(r.code || r.promoCode || "")}</strong><br><span style="color:#777;font-size:.76rem;">${safe(r.promoName || "")}</span></td>
                                    <td>${safe(r.clientName || "")}<br><span style="color:#777;font-size:.76rem;">${safe(r.clientPhone || "")}</span></td>
                                    <td>${salesEvidenceMoney(fin.grossServiceValue)} GHC</td>
                                    <td>${salesPromoNumber(fin.promoDiscount, 0).toFixed(2)} GHC</td>
                                    <td>${salesPromoNumber(fin.complimentaryValue, 0).toFixed(2)} GHC</td>
                                    <td><strong>${salesEvidenceMoney(fin.netRevenue)} GHC</strong></td>
                                    <td>${salesEvidenceMoney(fin.adjustedGross)} GHC</td>
                                    <td>${salesPromoNumber(fin.giftCardRedeemed, 0).toFixed(2)} GHC</td>
                                    <td>${salesPromoNumber(fin.voucherDiscount, 0).toFixed(2)} GHC</td>
                                    <td>${safe(r.paymentMethod || "")}</td>
                                    <td>${safe(r.redeemedBy || "")}</td>
                                </tr>
                            `; }).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        } catch(e) { if (!isCurrent()) return;
            console.error("Load redemptions failed", e);
            list.innerHTML = `<div class="sales-note" style="border-left-color:var(--error);">Could not load redemptions.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    function salesCsvEscape(v) {
        const s = String(v ?? "");
        return `"${s.replace(/"/g, '""')}"`;
    }

    function exportRedemptionsCsv() {
        if (!lastRedemptionRows.length) {
            alert("Load redemptions first.");
            return;
        }

        const headers = [
            "Date","Time","Code","Promo Name","Client","Phone","Original Total","Discount Amount","Final Total","Payment Method","Redeemed By","Booking ID",
            "Gross Service Value","Complimentary Waived","Taxable Net","Gift Card Redeemed","Promo Discount","Voucher Discount"
        ];
        const lines = [headers.map(salesCsvEscape).join(",")];

        lastRedemptionRows.forEach(r => {
            const fin = r.__financials || salesPromoFinancials(r, r.__jobRow || null);
            lines.push([
                r.dateString, r.timeString, r.code || r.promoCode, r.promoName,
                r.clientName, r.clientPhone,
                salesEvidenceMoney(fin.grossServiceValue),
                salesPromoNumber(fin.promoDiscount, 0).toFixed(2),
                salesEvidenceMoney(fin.adjustedGross),
                r.paymentMethod, r.redeemedBy, r.bookingId || r.jobId,
                salesEvidenceMoney(fin.grossServiceValue),
                salesPromoNumber(fin.complimentaryValue, 0).toFixed(2),
                salesEvidenceMoney(fin.netRevenue),
                salesPromoNumber(fin.giftCardRedeemed, 0).toFixed(2),
                salesPromoNumber(fin.promoDiscount, 0).toFixed(2),
                salesPromoNumber(fin.voucherDiscount, 0).toFixed(2)
            ].map(salesCsvEscape).join(","));
        });

        const blob = new Blob([lines.join("\\n")], { type: "text/csv;charset=utf-8;" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `thuraya-sales-redemptions-${new Date().toISOString().slice(0,10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }



    function renderPackageWallets() {
        const el = document.getElementById("salesContent");
        if (!el) return;
        el.innerHTML = `
            <div class="sales-note">
                Package Wallets track prepaid package balances per client. Create the package code first with offer type <strong>Prepaid Package Wallet</strong>.
            </div>
            <div class="sales-card">
                <h3>Create Client Package Wallet</h3>
                <div class="sales-form-grid">
                    <div class="form-group"><label>Client Phone</label><input type="text" id="wallet_phone" placeholder="Client phone"></div>
                    <div class="form-group"><label>Client Name</label><input type="text" id="wallet_name" placeholder="Client name"></div>
                    <div class="form-group"><label>Package Code</label><input type="text" id="wallet_code" placeholder="e.g. MANI5"></div>
                </div>
                <div class="sales-actions">
                    <button class="sales-btn primary" onclick="sales_createWallet()">Create Wallet</button>
                    <button class="sales-btn" onclick="sales_loadWallets()">Load Wallets</button>
                </div>
            </div>
            <div class="sales-card" style="margin-top:16px;">
                <h3>Client Package Wallets</h3>
                <div id="salesWalletList"><p style="color:#999;font-style:italic;">Click Load Wallets.</p></div>
            </div>
        `;
    }

    async function createWallet() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const phone = (document.getElementById("wallet_phone")?.value || "").trim();
        const name = (document.getElementById("wallet_name")?.value || "").trim();
        const code = (document.getElementById("wallet_code")?.value || "").trim().toUpperCase();
        if (!phone || !code) {
            alert("Enter client phone and package code.");
            return;
        }
        try {
            await createClientPackageWalletFromCode(phone, name, code);
            if (!isCurrent()) return;
            sales_loadWallets();
        } catch(e) { if (!isCurrent()) return;
            console.error("Create wallet failed", e);
            alert("Could not create wallet: " + e.message);
        }
    }

    async function loadWallets() {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        const list = document.getElementById("salesWalletList");
        if (!list) return;
        list.innerHTML = `<p style="color:#777;">Loading package wallets...</p>`;
        try {
            const snap = await db.collection("Client_Packages").get();
            if (!isCurrent()) return;
            const rows = [];
            snap.forEach(doc => {
                const row = { id: doc.id, ...doc.data() };
                if (!isArchivedRecord(row)) rows.push(row);
            });
            rows.sort((a,b) => String(b.purchaseDate || "").localeCompare(String(a.purchaseDate || "")));

            if (!rows.length) {
                list.innerHTML = `<p style="color:#999;font-style:italic;">No package wallets found.</p>`;
                return;
            }

            list.innerHTML = `
                <div class="sales-table-wrap">
                    <table class="sales-table">
                        <thead>
                            <tr>
                                <th>Status</th>
                                <th>Client</th>
                                <th>Package</th>
                                <th>Sessions</th>
                                <th>Purchase</th>
                                <th>Expiry</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${rows.map(r => `
                                <tr>
                                    <td><span class="sales-badge ${r.status === "Active" ? "active" : "paused"}">${safe(r.status || "")}</span></td>
                                    <td><strong>${safe(r.clientName || "")}</strong><br><span style="color:#777;font-size:.76rem;">${safe(r.clientPhone || "")}</span></td>
                                    <td><strong>${safe(r.packageCode || "")}</strong><br>${safe(r.packageName || "")}</td>
                                    <td><strong>${safe(r.remainingSessions || 0)}</strong> remaining / ${safe(r.totalSessions || 0)} total</td>
                                    <td>${safe(r.purchaseDate || "")}</td>
                                    <td>${safe(r.expiryDate || "No expiry")}</td>
                                    <td>
                                        <button class="sales-btn" style="padding:6px 9px;font-size:.72rem;" onclick="sales_deactivateWallet('${r.id}')">Deactivate</button>
                                    </td>
                                </tr>
                            `).join("")}
                        </tbody>
                    </table>
                </div>
            `;
        } catch(e) { if (!isCurrent()) return;
            console.error("Load wallets failed", e);
            list.innerHTML = `<div class="sales-note" style="border-left-color:var(--error);">Could not load wallets.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    async function deactivateWallet(id) {
        const isCurrent = window.ThurayaSessionResources.capture();
        if (!isCurrent()) return;
        if (!confirm("Deactivate this package wallet?")) return;
        try {
            await db.collection("Client_Packages").doc(id).set({
                status: "Inactive",
                updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
                updatedBy: typeof currentUserEmail !== "undefined" ? currentUserEmail : ""
            }, { merge: true });
            if (!isCurrent()) return;
            sales_loadWallets();
        } catch(e) { if (!isCurrent()) return;
            alert("Could not deactivate wallet: " + e.message);
        }
    }


    function patchSwitchModule() {
        if (window.__salesSwitchPatched) return;
        if (typeof window.switchModule !== "function") {
            window.ThurayaSessionResources.timeout(patchSwitchModule, 300);
            return;
        }

        const originalSwitchModule = window.switchModule;
        window.switchModule = function(moduleId) {
            originalSwitchModule(moduleId);
            if (moduleId === "salesView") {
                window.ThurayaSessionResources.timeout(() => renderShell("giftcards"), 50);
            }
        };
        window.__salesSwitchPatched = true;
    }

    function startVisibilityLoop() {
        forceSalesTabVisible();
        window.ThurayaSessionResources.timeout(forceSalesTabVisible, 800);
        window.ThurayaSessionResources.timeout(forceSalesTabVisible, 1600);
        window.ThurayaSessionResources.timeout(forceSalesTabVisible, 3000);
    }

    function boot() {
        window.ThurayaSessionResources.onStart("sales", () => {
            clearGiftSessionData();
            patchSwitchModule();
            startVisibilityLoop();
        });
    }

    window.ThurayaSessionResources.onStop("sales", () => {
        lastRedemptionRows = [];
        window.THURAYA_ACTIVE_PROMO = null;
        const view = document.getElementById("salesView");
        if (view) view.innerHTML = "";
        const tab = document.getElementById("tabSales");
        if (tab) tab.style.display = "none";
    });

    window.sales_init = () => renderShell("giftcards");
    window.sales_showTab = showTab;
    window.sales_autoApplyBestPromo = autoApplyBestPromo;
    window.sales_validateBookingPromo = validateBookingPromo;
    window.sales_clearBookingPromo = clearBookingPromo;
    window.sales_generatePromoCode = generatePromoCode;
    window.sales_savePromo = savePromo;
    window.sales_loadPromos = loadPromos;
    window.sales_pausePromo = pausePromo;
    window.sales_loadRedemptions = loadRedemptions;
    window.sales_exportRedemptionsCsv = exportRedemptionsCsv;
    window.sales_createWallet = createWallet;
    window.sales_loadWallets = loadWallets;
    window.sales_deactivateWallet = deactivateWallet;
    window.sales_generateGiftCardCode = generateGiftCardCode;
    window.sales_onGiftAmountPreset = onGiftAmountPreset;
    window.sales_sellGiftCard = sellGiftCard;
    window.sales_loadGiftCards = loadGiftCards;
    window.sales_previewGiftCardByCode = previewGiftCardByCode;
    window.sales_openGiftCardPreview = openGiftCardPreview;
    window.sales_closeGiftCardPreview = closeGiftCardPreview;
    window.sales_saveGiftCardImage = saveGiftCardImage;
    window.sales_printGiftCard = printGiftCard;
    window.sales_shareGiftCard = shareGiftCard;
    window.sales_editGiftCardByCode = editGiftCardByCode;

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
    else boot();
})();


    document.addEventListener('click', function(e) {
        const editBtn = e.target && e.target.closest ? e.target.closest('[data-gift-edit]') : null;
        if (!editBtn) return;
        e.preventDefault();
        const code = editBtn.getAttribute('data-gift-edit');
        if (code && typeof editGiftCard === 'function') editGiftCard(code);
    });


// THURAYA RBAC HARDENING — Sales & Promo Manager/Admin only. FOH has no access.
// Timing-safe: does not hide Admin/Manager tab before roles finish loading.
(function(){
    if (window.__TH_SALES_PROMO_RBAC_GUARD_V2__) return;
    window.__TH_SALES_PROMO_RBAC_GUARD_V2__ = true;

    function thSalesPromoIsAllowed(){
        if (!window.ThurayaSessionResources.active()) return false;
        try {
            if (typeof canSeeSales === 'function') return canSeeSales();
        } catch(e) {}
        return null;
    }

    function thSalesPromoHideIfDenied(){
        const tab = document.getElementById('tabSales');
        const allowed = thSalesPromoIsAllowed();

        // Role data not ready yet — do not hide.
        if (allowed === null) {
            if (tab) tab.setAttribute('data-rbac-pending', 'true');
            return;
        }

        if (tab) {
            tab.style.display = allowed ? 'flex' : 'none';
            tab.setAttribute('aria-hidden', allowed ? 'false' : 'true');
            tab.removeAttribute('data-rbac-pending');
            if (!allowed) tab.classList.add('th-rbac-hidden');
            else tab.classList.remove('th-rbac-hidden');
        }

        const salesView = document.getElementById('salesView');
        if (!allowed && salesView && salesView.style.display !== 'none') {
            salesView.innerHTML = '<div class="th-rbac-denied"><strong>Access restricted</strong><span>Sales & Promo is available to Manager/Admin only.</span></div>';
        }
    }

    document.addEventListener('click', function(e){
        const tab = e.target && e.target.closest ? e.target.closest('#tabSales') : null;
        if (!tab) return;

        const allowed = thSalesPromoIsAllowed();

        // Pending: allow natural app handling; next guard pass will decide.
        if (allowed === null) return;

        if (!allowed) {
            e.preventDefault();
            e.stopPropagation();
            thSalesPromoHideIfDenied();
            alert('Sales & Promo is restricted to Manager/Admin only.');
        }
    }, true);

    window.ThurayaSessionResources.onStart("sales.rbac", () => {
        window.ThurayaSessionResources.timeout(thSalesPromoHideIfDenied, 500);
        window.ThurayaSessionResources.timeout(thSalesPromoHideIfDenied, 1600);
        window.ThurayaSessionResources.timeout(thSalesPromoHideIfDenied, 3200);
        window.ThurayaSessionResources.interval("sales.rbac", thSalesPromoHideIfDenied, 3500);
    });
})();
