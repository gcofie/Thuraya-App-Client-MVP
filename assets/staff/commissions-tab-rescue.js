// ============================================================
// THURAYA COMMISSIONS — TAB RESCUE PATCH
// Version: commissions-tab-rescue-20260425
// Purpose: make the Commissions tab visible even if role detection delays/fails.
// Does NOT change booking, billing, reports, or commission calculations.
// ============================================================
console.log("✅ Commissions Tab Rescue loaded");

(function () {
    function ensureCommissionsTabVisible() {
        if (!window.ThurayaSessionResources.active()) return;
        const topNav = document.getElementById("topNavMenu");
        if (!topNav) {
            window.ThurayaSessionResources.timeout(ensureCommissionsTabVisible, 300);
            return;
        }

        let tab = document.getElementById("tabCommissions");

        if (!tab) {
            tab = document.createElement("div");
            tab.className = "nav-tab";
            tab.id = "tabCommissions";
            tab.innerHTML = `
                <input type="radio" name="main_nav" id="nav_commissions" value="commissionsView" onchange="switchModule(this.value)">
                <label for="nav_commissions">💰 Commissions</label>
            `;

            const reportsTab = document.getElementById("tabReports");
            if (reportsTab && reportsTab.parentNode) {
                reportsTab.parentNode.insertBefore(tab, reportsTab);
            } else {
                topNav.appendChild(tab);
            }
        }

        // Force visible. Access inside the module is still handled by commissions-v1.js.
        tab.style.display = "flex";
        tab.removeAttribute("data-tech-only");

        const dashboard = document.getElementById("appDashboard");
        if (dashboard && !document.getElementById("commissionsView")) {
            const view = document.createElement("div");
            view.id = "commissionsView";
            view.className = "app-module";
            view.style.display = "none";
            dashboard.appendChild(view);
        }

        console.log("✅ Commissions tab forced visible");

        // If user clicks tab and the module is available, initialize it.
        const input = document.getElementById("nav_commissions");
        if (input && !input.__comRescueBound) {
            input.__comRescueBound = true;
            input.addEventListener("change", function () {
                if (this.checked && typeof window.com_init === "function") {
                    window.ThurayaSessionResources.timeout(() => window.com_init(), 80);
                }
            });
        }
    }

    // Run repeatedly because app.js may hide/show tabs after login.
    function startRescueLoop() {
        if (!window.ThurayaSessionResources.active()) return;
        ensureCommissionsTabVisible();
        window.ThurayaSessionResources.timeout(ensureCommissionsTabVisible, 800);
        window.ThurayaSessionResources.timeout(ensureCommissionsTabVisible, 1600);
        window.ThurayaSessionResources.timeout(ensureCommissionsTabVisible, 3000);
    }

    function registerSession() {
        window.ThurayaSessionResources.onStart("commissions-tab-rescue", startRescueLoop);
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", registerSession, { once: true });
    } else {
        registerSession();
    }
    window.ThurayaSessionResources.onStop("commissions-tab-rescue", () => {
        const tab = document.getElementById("tabCommissions");
        if (tab) tab.style.display = "none";
    });
})();
