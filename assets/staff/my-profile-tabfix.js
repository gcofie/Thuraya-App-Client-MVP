// ============================================================
// THURAYA STAFF PROFILE — PHASE 4.1 MY PROFILE TAB FIX
// Version: staff-profile-phase4-1-my-profile-tabfix-20260425
// Forces My Profile tab visible for all logged-in staff.
// Does NOT change attendance, billing, reports, commissions, or booking.
// ============================================================
console.log("✅ Staff Profile Phase 4.1 loaded: My Profile tab fix");

(function () {
    function ensureMyProfileShell() {
        if (!window.ThurayaSessionResources.active()) return;
        const topNav = document.getElementById("topNavMenu");
        if (!topNav) {
            window.ThurayaSessionResources.timeout(ensureMyProfileShell, 300);
            return;
        }

        let tab = document.getElementById("tabMyProfile");
        if (!tab) {
            tab = document.createElement("div");
            tab.className = "nav-tab";
            tab.id = "tabMyProfile";
            tab.innerHTML = `
                <input type="radio" name="main_nav" id="nav_my_profile" value="myProfileView" onchange="switchModule(this.value)">
                <label for="nav_my_profile">👤 My Profile</label>
            `;

            const attendanceTab = document.getElementById("tabMyAttendance") || document.getElementById("tabAttendance");
            if (attendanceTab && attendanceTab.parentNode) {
                attendanceTab.parentNode.insertBefore(tab, attendanceTab.nextSibling);
            } else {
                topNav.appendChild(tab);
            }
        }

        // Every logged-in staff should see My Profile.
        tab.style.display = "flex";

        const dashboard = document.getElementById("appDashboard");
        if (dashboard && !document.getElementById("myProfileView")) {
            const view = document.createElement("div");
            view.id = "myProfileView";
            view.className = "app-module";
            view.style.display = "none";
            view.innerHTML = `
                <div class="module-box" style="border-top:4px solid var(--accent);">
                    <h3 style="color:var(--accent);">My Profile</h3>
                    <p style="color:#666;">Profile module shell was restored. Refresh after deployment if details do not load.</p>
                    <button class="btn" style="width:auto; padding:10px 18px;" onclick="if(typeof myProfile_load==='function') myProfile_load()">Load My Profile</button>
                </div>
            `;
            dashboard.appendChild(view);
        }

        const input = document.getElementById("nav_my_profile");
        if (input && !input.__myProfileFixBound) {
            input.__myProfileFixBound = true;
            input.addEventListener("change", function () {
                if (this.checked && typeof window.myProfile_load === "function") {
                    window.ThurayaSessionResources.timeout(() => window.myProfile_load(), 100);
                }
                if (this.checked && typeof window.sp4_loadMyAttendanceIdentity === "function") {
                    window.ThurayaSessionResources.timeout(() => window.sp4_loadMyAttendanceIdentity(), 200);
                }
            });
        }

        console.log("✅ My Profile tab forced visible");
    }

    function patchSwitchModuleForMyProfile() {
        if (window.__myProfileTabfixSwitchPatched) return;
        if (typeof window.switchModule !== "function") {
            window.ThurayaSessionResources.timeout(patchSwitchModuleForMyProfile, 300);
            return;
        }

        const original = window.switchModule;
        window.switchModule = function(moduleId) {
            original(moduleId);
            if (moduleId === "myProfileView") {
                window.ThurayaSessionResources.timeout(() => {
                    if (typeof window.myProfile_load === "function") window.myProfile_load();
                    if (typeof window.sp4_loadMyAttendanceIdentity === "function") window.sp4_loadMyAttendanceIdentity();
                }, 120);
            }
        };

        window.__myProfileTabfixSwitchPatched = true;
    }

    function run() {
        if (!window.ThurayaSessionResources.active()) return;
        ensureMyProfileShell();
        patchSwitchModuleForMyProfile();

        // app.js may hide tabs after login, so run several times.
        window.ThurayaSessionResources.timeout(ensureMyProfileShell, 800);
        window.ThurayaSessionResources.timeout(ensureMyProfileShell, 1600);
        window.ThurayaSessionResources.timeout(ensureMyProfileShell, 3000);
    }

    function registerSession() {
        window.ThurayaSessionResources.onStart("my-profile-tabfix", run);
    }
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", registerSession, { once: true });
    } else {
        registerSession();
    }
    window.ThurayaSessionResources.onStop("my-profile-tabfix", () => {
        const tab = document.getElementById("tabMyProfile");
        if (tab) tab.style.display = "none";
    });
})();
