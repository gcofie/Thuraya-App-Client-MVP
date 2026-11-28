(function () {
    "use strict";

    if (window.__TH_COMPLIMENTARY_APPROVAL_UI_SCAFFOLD__) return;
    window.__TH_COMPLIMENTARY_APPROVAL_UI_SCAFFOLD__ = true;

    const FLAG_NAME = "THURAYA_COMPLIMENTARY_APPROVAL_UI_ENABLED";
    const MODAL_ID = "thComplimentaryApprovalModal";
    const CHECKOUT_SLOT_ID = "thComplimentaryCheckoutSlot";
    const REVIEW_SLOT_ID = "thComplimentaryReviewSlot";
    const FUNCTIONS_REGION = "us-central1";
    const FUNCTIONS_SDK_SRC = "https://www.gstatic.com/firebasejs/8.10.1/firebase-functions.js";

    let activeContext = {};
    let activeServiceItems = [];
    let activeServiceRecord = {};
    let activeApprovers = [];
    let activeGroupJobBlocked = false;
    let verifying = false;
    let observerStarted = false;
    let functionsSdkPromise = null;

    if (typeof window[FLAG_NAME] === "undefined") {
        window[FLAG_NAME] = false;
    }

    function enabled() {
        return window[FLAG_NAME] === true;
    }

    function esc(value) {
        return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
            return {
                "&": "&amp;",
                "<": "&lt;",
                ">": "&gt;",
                "\"": "&quot;",
                "'": "&#39;"
            }[ch];
        });
    }

    function text(id) {
        const el = document.getElementById(id);
        return el ? String(el.textContent || el.value || "").trim() : "";
    }

    function currentUserEmail() {
        try {
            const user = window.firebase && firebase.auth && firebase.auth().currentUser;
            if (user && user.email) return String(user.email).trim().toLowerCase();
        } catch (e) {}
        try {
            if (window.currentUserEmail) return String(window.currentUserEmail).trim().toLowerCase();
        } catch (e) {}
        return "";
    }

    function checkoutContext(scope) {
        return {
            scope: scope || "checkout",
            jobId: document.getElementById("checkoutJobId")?.value || "",
            clientName: text("checkoutClientName"),
            services: text("checkoutServices"),
            originalValue: text("checkoutTotal") || text("checkoutGrandTotalVal"),
            requestedBy: currentUserEmail()
        };
    }

    function reviewContext(scope) {
        const reviewModal = document.getElementById("thFohCheckoutReviewModal");
        return {
            scope: scope || "foh_checkout_review",
            jobId: reviewModal?.dataset?.jobId || document.getElementById("checkoutJobId")?.value || "",
            clientName: document.getElementById("thFohCheckoutReviewContext")?.innerText || "",
            services: document.getElementById("thFohCheckoutReviewServicesText")?.value || "",
            originalValue: document.getElementById("thFohCheckoutReviewAmount")?.value || text("checkoutTotal"),
            requestedBy: currentUserEmail()
        };
    }

    function contextForScope(scope) {
        return scope === "foh_checkout_review" ? reviewContext(scope) : checkoutContext(scope);
    }

    function setStatus(message, status) {
        const box = document.getElementById("thComplimentaryApprovalStatus");
        if (!box) return;
        if (!message) {
            box.style.display = "none";
            box.textContent = "";
            return;
        }
        const palette = {
            approved: ["#effaf0", "#bee3c2", "#1f5f2b"],
            locked: ["#fff8e8", "#eadab6", "#6f4a00"],
            denied: ["#fff0f0", "#f0c1c1", "#8a1f1f"],
            info: ["#f7f7f7", "#dedede", "#333"]
        }[status || "info"];
        box.textContent = message;
        box.style.display = "block";
        box.style.background = palette[0];
        box.style.border = "1px solid " + palette[1];
        box.style.color = palette[2];
    }

    function setBusy(isBusy) {
        verifying = isBusy;
        const btn = document.getElementById("thComplimentaryApprovalVerify");
        const modal = document.getElementById(MODAL_ID);
        const inputs = [
            "thComplimentaryReason",
            "thComplimentaryOtherReason",
            "thComplimentaryApproverEmail",
            "thComplimentaryApprovalPin"
        ].map(id => document.getElementById(id)).filter(Boolean);
        if (modal) {
            Array.from(modal.querySelectorAll("[data-th-comp-service-index]")).forEach(function (input) {
                inputs.push(input);
            });
        }
        inputs.forEach(function (input) {
            if (isBusy) {
                input.dataset.thCompWasDisabled = input.disabled ? "1" : "0";
                input.disabled = true;
                return;
            }
            if (input.dataset.thCompWasDisabled === "0") {
                input.disabled = false;
            }
            delete input.dataset.thCompWasDisabled;
        });
        if (btn) {
            btn.textContent = isBusy ? "Approving..." : "Approve Complimentary Services";
            updateVerifyButtonState();
        }
    }

    function showOtherReasonIfNeeded() {
        const reason = document.getElementById("thComplimentaryReason")?.value || "";
        const other = document.getElementById("thComplimentaryOtherReason");
        if (!other) return;
        other.style.display = reason === "Other" ? "block" : "none";
    }

    function reasonValue() {
        const reason = document.getElementById("thComplimentaryReason")?.value || "";
        if (reason !== "Other") return reason;
        return (document.getElementById("thComplimentaryOtherReason")?.value || "").trim();
    }

    function normalizeEmail(value) {
        return String(value == null ? "" : value).trim().toLowerCase();
    }

    function normalizeRoles(value) {
        if (Array.isArray(value)) {
            return value.map(role => String(role || "").trim()).filter(Boolean);
        }
        if (typeof value === "string") {
            return value.split(/[,\|/]+/).map(role => role.trim()).filter(Boolean);
        }
        return [];
    }

    function hasApprovalRole(roles) {
        return roles.some(function (role) {
            const normalized = String(role || "").trim().toLowerCase();
            return normalized === "system admin" || normalized === "admin" || normalized === "manager";
        });
    }

    function firstApprovalRole(roles) {
        const preferred = roles.find(function (role) {
            return String(role || "").trim().toLowerCase() === "system admin";
        }) || roles.find(function (role) {
            return String(role || "").trim().toLowerCase() === "admin";
        }) || roles.find(function (role) {
            return String(role || "").trim().toLowerCase() === "manager";
        });
        return preferred ? String(preferred).trim() : "Manager/Admin";
    }

    function approvalFlag(value) {
        if (value === true) return true;
        if (value === false || value === null || value === undefined) return false;
        return String(value).trim().toLowerCase() === "true";
    }

    function approverDisplayName(user, email) {
        return String(user?.name || user?.displayName || user?.fullName || user?.staffName || email || "Manager/Admin").trim();
    }

    function approverSelectReady() {
        const select = document.getElementById("thComplimentaryApproverEmail");
        return !!(select && !select.disabled && select.value);
    }

    function selectedServiceIndexes() {
        return Array.from(document.querySelectorAll("[data-th-comp-service-index]:checked"))
            .map(function (input) { return parseInt(input.value, 10); })
            .filter(function (index) {
                return Number.isInteger(index) && index >= 0 && index < activeServiceItems.length;
            });
    }

    function serviceSelectReady() {
        const indexes = selectedServiceIndexes();
        return indexes.length > 0 && indexes.every(index => serviceLineEligibility(activeServiceItems[index]).selectable)
            && selectedComplimentaryTotal() !== null;
    }

    function isTruthyFlag(value) {
        if (value === true) return true;
        if (value === false || value === null || value === undefined) return false;
        return ["true", "yes", "1"].includes(String(value).trim().toLowerCase());
    }

    function isGroupJobRecord(job) {
        if (!job) return false;
        const groupSize = parseInt(job.groupSize || job.groupCount || "0", 10);
        return (
            isTruthyFlag(job.isGroupBooking) ||
            isTruthyFlag(job.isGroup) ||
            !!String(job.groupId || job.groupBookingId || job.groupLeadId || job.groupMemberId || "").trim() ||
            (Number.isFinite(groupSize) && groupSize > 1) ||
            !!String(job.groupRole || "").trim()
        );
    }

    function groupUnsupportedMessage() {
        return "Group complimentary approval is not enabled yet.";
    }

    function setGroupControlsBlocked(blocked) {
        activeGroupJobBlocked = !!blocked;
        const approver = document.getElementById("thComplimentaryApproverEmail");
        const pin = document.getElementById("thComplimentaryApprovalPin");
        if (activeGroupJobBlocked) {
            if (approver) approver.disabled = true;
            if (pin) pin.disabled = true;
        } else if (pin) {
            pin.disabled = false;
        }
        updateVerifyButtonState();
    }

    function updateVerifyButtonState() {
        const btn = document.getElementById("thComplimentaryApprovalVerify");
        if (!btn) return;
        btn.disabled = activeGroupJobBlocked || verifying || !approverSelectReady() || !serviceSelectReady();
        if (!verifying) btn.textContent = "Approve Complimentary Services";
    }

    function renderApproverOptions(state, approvers) {
        const select = document.getElementById("thComplimentaryApproverEmail");
        const help = document.getElementById("thComplimentaryApproverStatus");
        if (!select) return;
        const message = {
            loading: "Loading Manager/Admin approvers...",
            empty: "No Manager/Admin approval PIN enabled",
            error: "Could not load Manager/Admin approvers. Please refresh and try again."
        }[state || ""];

        if (state === "ready" && Array.isArray(approvers) && approvers.length) {
            select.disabled = activeGroupJobBlocked;
            select.innerHTML = '<option value="">Select Manager/Admin approver...</option>' + approvers.map(function (approver) {
                const label = approver.name + " - " + approver.role + " - " + approver.email;
                return '<option value="' + esc(approver.email) + '">' + esc(label) + '</option>';
            }).join("");
            if (help) {
                help.style.display = activeGroupJobBlocked ? "block" : "none";
                help.textContent = activeGroupJobBlocked ? groupUnsupportedMessage() : "";
            }
            updateVerifyButtonState();
            return;
        }

        select.disabled = true;
        select.innerHTML = '<option value="">' + esc(message || "Load Manager/Admin approvers...") + '</option>';
        if (help) {
            help.style.display = "block";
            help.textContent = activeGroupJobBlocked ? groupUnsupportedMessage() : (message || "");
        }
        updateVerifyButtonState();
    }

    async function loadComplimentaryApprovers() {
        if (!window.firebase || !firebase.firestore) {
            throw new Error("Firestore unavailable");
        }
        const seen = {};
        const approvers = [];

        function addApproverFromDoc(doc) {
            if (!doc || !doc.exists) return;
            const user = doc.data() || {};
            const email = normalizeEmail(user.email || doc.id);
            if (!email || !email.includes("@") || seen[email]) return;

            const roles = normalizeRoles(user.roles || user.role || user.userRole);
            if (!hasApprovalRole(roles)) return;
            if (!approvalFlag(user.approvalPinEnabled)) return;
            if (!approvalFlag(user.canApproveComplimentary)) return;

            seen[email] = true;
            approvers.push({
                email,
                name: approverDisplayName(user, email),
                role: firstApprovalRole(roles)
            });
        }

        try {
            const snap = await firebase.firestore().collection("Users").get();
            snap.forEach(addApproverFromDoc);
        } catch (error) {
            // Some production rule sets allow reading the current user but not listing Users.
        }

        const ownEmail = currentUserEmail();
        if (ownEmail && !seen[ownEmail]) {
            try {
                const ownDoc = await firebase.firestore().collection("Users").doc(ownEmail).get();
                addApproverFromDoc(ownDoc);
            } catch (error) {}
        }

        approvers.sort(function (a, b) {
            return (a.name || a.email).localeCompare(b.name || b.email);
        });
        return approvers;
    }

    async function loadApproverOptions() {
        activeApprovers = [];
        renderApproverOptions("loading", []);
        try {
            activeApprovers = await loadComplimentaryApprovers();
            renderApproverOptions(activeApprovers.length ? "ready" : "empty", activeApprovers);
        } catch (error) {
            activeApprovers = [];
            renderApproverOptions("error", []);
        }
    }

    function ensureModal() {
        let modal = document.getElementById(MODAL_ID);
        if (modal) return modal;

        modal = document.createElement("div");
        modal.id = MODAL_ID;
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        modal.style.cssText = "display:none;position:fixed;inset:0;z-index:1000004;background:rgba(0,0,0,.62);align-items:center;justify-content:center;padding:18px;";
        modal.innerHTML = [
            '<div role="dialog" aria-modal="true" aria-labelledby="thComplimentaryApprovalTitle" style="width:min(560px,94vw);background:#fff;border:1px solid #ded8cc;border-radius:22px;box-shadow:0 30px 90px rgba(0,0,0,.34);overflow:hidden;">',
            '<div style="background:#111;color:#fff;padding:20px 24px;">',
            '<div id="thComplimentaryApprovalTitle" style="letter-spacing:.16em;text-transform:uppercase;font-weight:900;font-size:.9rem;">Complimentary Approval</div>',
            '<p style="margin:10px 0 0;color:#ddd;font-size:.9rem;line-height:1.45;">Manager/Admin approval is verified before the selected service is marked complimentary and recalculated.</p>',
            '</div>',
            '<div style="padding:22px 24px;">',
            '<div id="thComplimentaryApprovalContext" style="margin-bottom:14px;padding:12px 14px;border:1px solid #e8e0d1;border-radius:12px;background:#fffdf8;color:#555;font-size:.86rem;line-height:1.45;"></div>',
            '<div style="margin-bottom:12px;">',
            '<div style="font-weight:900;color:#111;margin-bottom:8px;">Services to Mark <span style="color:#b3261e;">*</span></div>',
            '<div id="thComplimentaryServiceStatus" style="display:block;margin-bottom:8px;color:#777;font-weight:800;font-size:.78rem;line-height:1.35;">Load a checkout job to select services...</div>',
            '<div id="thComplimentaryServiceList" style="display:grid;gap:8px;max-height:220px;overflow:auto;padding-right:2px;"></div>',
            '<div id="thComplimentarySelectedTotal" style="margin-top:10px;padding:10px 12px;border-radius:10px;background:#f7f4ec;border:1px solid #e2d8c4;color:#333;font-weight:900;">Selected Complimentary Total: 0.00 GHC</div>',
            '</div>',
            '<label style="display:block;font-weight:900;color:#111;margin-bottom:12px;">Reason <span style="color:#b3261e;">*</span>',
            '<select id="thComplimentaryReason" style="display:block;width:100%;margin-top:8px;padding:12px 14px;border:1px solid #d9d9d9;border-radius:10px;background:#fff;">',
            '<option value="">Select reason...</option>',
            '<option>VIP Courtesy</option>',
            '<option>Service Recovery</option>',
            '<option>Influencer / Media</option>',
            '<option>Staff Courtesy</option>',
            '<option>Training / Demo</option>',
            '<option>Promotion</option>',
            '<option>Management Approval</option>',
            '<option>Other</option>',
            '</select>',
            '</label>',
            '<input id="thComplimentaryOtherReason" type="text" placeholder="Enter reason" style="display:none;width:100%;margin:-2px 0 12px;padding:12px 14px;border:1px solid #d9d9d9;border-radius:10px;background:#fff;">',
            '<label style="display:block;font-weight:900;color:#111;margin-bottom:12px;">Manager/Admin Approver <span style="color:#b3261e;">*</span>',
            '<select id="thComplimentaryApproverEmail" style="display:block;width:100%;margin-top:8px;padding:12px 14px;border:1px solid #d9d9d9;border-radius:10px;background:#fff;">',
            '<option value="">Loading Manager/Admin approvers...</option>',
            '</select>',
            '<div id="thComplimentaryApproverStatus" style="display:none;margin-top:6px;color:#777;font-weight:800;font-size:.78rem;line-height:1.35;"></div>',
            '</label>',
            '<label style="display:block;font-weight:900;color:#111;margin-bottom:14px;">Approval PIN <span style="color:#b3261e;">*</span>',
            '<input id="thComplimentaryApprovalPin" type="password" inputmode="numeric" autocomplete="current-password" placeholder="Enter Manager/Admin PIN" style="display:block;width:100%;margin-top:8px;padding:12px 14px;border:1px solid #d9d9d9;border-radius:10px;background:#fff;">',
            '</label>',
            '<div style="padding:10px 12px;border-radius:10px;background:#fff8e8;border:1px solid #eadab6;color:#6f5a18;font-weight:800;font-size:.82rem;line-height:1.45;">Service-level complimentary approval only. Group bookings, gift cards, split payments, and payment methods are not changed by this approval.</div>',
            '<div id="thComplimentaryApprovalStatus" style="display:none;margin-top:12px;padding:11px 12px;border-radius:10px;font-weight:900;font-size:.84rem;line-height:1.45;"></div>',
            '<div style="display:flex;justify-content:flex-end;gap:10px;margin-top:18px;flex-wrap:wrap;">',
            '<button type="button" data-th-comp-close style="border:1px solid #d9d2c3;background:#fff;color:#111;border-radius:999px;padding:10px 18px;font-weight:900;cursor:pointer;">Close</button>',
            '<button type="button" id="thComplimentaryApprovalVerify" style="border:0;background:#111;color:#fff;border-radius:999px;padding:10px 18px;font-weight:900;cursor:pointer;">Approve Complimentary Services</button>',
            '</div>',
            '</div>',
            '</div>'
        ].join("");
        document.body.appendChild(modal);

        modal.addEventListener("click", function (event) {
            if (event.target === modal || event.target.closest("[data-th-comp-close]")) {
                window.thComplimentaryApprovalClose();
            }
        });
        document.getElementById("thComplimentaryReason")?.addEventListener("change", showOtherReasonIfNeeded);
        document.getElementById("thComplimentaryApproverEmail")?.addEventListener("change", updateVerifyButtonState);
        document.getElementById("thComplimentaryServiceList")?.addEventListener("change", function (event) {
            if (event.target && event.target.matches("[data-th-comp-service-index]")) {
                updateSelectedTotal();
            }
        });
        document.getElementById("thComplimentaryApprovalVerify")?.addEventListener("click", verifyApproval);
        document.getElementById("thComplimentaryApprovalPin")?.addEventListener("keydown", function (event) {
            if (event.key === "Enter") verifyApproval();
        });
        return modal;
    }

    function money(value) {
        const amount = window.thFinancialEvidence?.amount(value);
        return amount === null || amount === undefined ? "Unavailable" : amount.toFixed(2);
    }

    function itemQty(item) {
        const q = parseInt(item?.qty || item?.quantity || "1", 10);
        return Number.isFinite(q) && q > 0 ? q : 1;
    }

    function itemFinancials(item) {
        return window.thFinancialEvidence?.line(item, activeServiceRecord) || {};
    }

    function itemLineTotal(item) {
        return itemFinancials(item).adjustedGross ?? null;
    }

    function itemName(item) {
        return String(item?.name || item?.serviceName || item?.label || "Service").trim();
    }

    function itemOriginalLineTotal(item) {
        return itemFinancials(item).originalGross ?? null;
    }

    function lower(value) {
        return String(value == null ? "" : value).trim().toLowerCase();
    }

    function hasComplimentaryMetadata(item) {
        return !!(
            item?.approvalAuditId ||
            item?.complimentaryApprovalAuditId ||
            item?.complimentaryApprovedBy ||
            item?.complimentaryAppliedBy ||
            item?.complimentaryValue !== undefined
        );
    }

    function isAppliedComplimentaryLine(item) {
        const status = lower(item?.complimentaryStatus);
        return (
            status === "financial_applied" ||
            item?.complimentaryTotalsApplied === true
        );
    }

    function isPendingComplimentaryLine(item) {
        const status = lower(item?.complimentaryStatus);
        return (
            status === "approved_marker_only" ||
            status === "pending_marker" ||
            (item?.isComplimentary === true && !isAppliedComplimentaryLine(item) && hasComplimentaryMetadata(item))
        );
    }

    function isTrueZeroNonComplimentaryLine(item) {
        if (isAppliedComplimentaryLine(item) || isPendingComplimentaryLine(item)) return false;
        const payable = itemLineTotal(item), original = itemOriginalLineTotal(item);
        return payable !== null && original !== null && payable <= 0.005 && original <= 0.005;
    }

    function serviceLineEligibility(item) {
        const payableAmount = itemLineTotal(item);
        if (isAppliedComplimentaryLine(item)) {
            return { selectable: false, reason: "Already complimentary", amount: payableAmount };
        }
        if (isPendingComplimentaryLine(item)) {
            return { selectable: false, reason: "Pending approval", amount: payableAmount };
        }
        if (payableAmount === null) {
            return { selectable: false, reason: "Financial details unavailable", amount: null };
        }
        if (isTrueZeroNonComplimentaryLine(item)) {
            return { selectable: false, reason: "Zero-value service", amount: 0 };
        }
        if (payableAmount <= 0.005) {
            return { selectable: false, reason: "No payable amount", amount: 0 };
        }
        return { selectable: true, reason: "", amount: payableAmount };
    }

    function selectedComplimentaryTotal() {
        const amounts = selectedServiceIndexes().map(index => serviceLineEligibility(activeServiceItems[index]).amount);
        if (!amounts.length) return 0;
        if (amounts.some(amount => amount === null)) return null;
        return window.thFinancialEvidence?.sumMoney(amounts) ?? null;
    }

    function updateSelectedTotal() {
        const total = document.getElementById("thComplimentarySelectedTotal");
        if (total) total.textContent = "Selected Complimentary Total: " + money(selectedComplimentaryTotal()) + " GHC";
        updateVerifyButtonState();
    }

    function renderServiceCheckboxes(message) {
        const list = document.getElementById("thComplimentaryServiceList");
        const status = document.getElementById("thComplimentaryServiceStatus");
        if (!list) return;
        function setMessage(text) {
            list.innerHTML = "";
            if (status) {
                status.style.display = "block";
                status.textContent = text || "";
            }
            updateSelectedTotal();
        }
        if (message) {
            setMessage(message);
            return;
        }
        if (!activeServiceItems.length) {
            setMessage("No itemized service lines found.");
            return;
        }
        if (status) {
            status.style.display = "block";
            status.textContent = activeGroupJobBlocked ? groupUnsupportedMessage() : "Select one or more eligible service lines.";
        }
        list.innerHTML = activeServiceItems.map(function (item, index) {
            const eligibility = serviceLineEligibility(item);
            const blockedReason = activeGroupJobBlocked ? groupUnsupportedMessage() : eligibility.reason;
            const disabled = (activeGroupJobBlocked || !eligibility.selectable) ? " disabled" : "";
            const reason = blockedReason ? '<span style="display:inline-block;margin-left:6px;color:#9a5a00;font-weight:800;">' + esc(blockedReason) + '</span>' : "";
            const opacity = activeGroupJobBlocked || !eligibility.selectable ? ".62" : "1";
            const amount = eligibility.amount;
            return [
                '<label style="display:grid;grid-template-columns:auto 1fr auto;gap:10px;align-items:center;padding:10px 12px;border:1px solid #e3dccf;border-radius:12px;background:#fff;opacity:' + opacity + ';">',
                '<input type="checkbox" value="' + esc(index) + '" data-th-comp-service-index="' + esc(index) + '"' + disabled + ' style="width:18px;height:18px;">',
                '<span style="min-width:0;">',
                '<strong style="display:block;color:#111;line-height:1.25;">' + esc(itemName(item)) + '</strong>',
                '<span style="display:block;color:#666;font-size:.78rem;font-weight:800;line-height:1.35;">Qty ' + esc(itemQty(item)) + reason + '</span>',
                '</span>',
                '<strong style="white-space:nowrap;color:#1f2c3d;">' + esc(money(amount)) + ' GHC</strong>',
                '</label>'
            ].join("");
        }).join("");
        updateSelectedTotal();
    }

    function renderServiceOptions(message) {
        renderServiceCheckboxes(message);
    }

    async function loadServiceItems() {
        activeServiceItems = [];
        activeServiceRecord = {};
        renderServiceOptions("Loading itemized services...");
        if (!activeContext.jobId) {
            renderServiceOptions("Open a checkout job first.");
            return;
        }
        if (!window.firebase || !firebase.firestore) {
            renderServiceOptions("Firestore is not available.");
            return;
        }
        try {
            const snap = await firebase.firestore().collection("Active_Jobs").doc(activeContext.jobId).get();
            if (!snap.exists) {
                renderServiceOptions("Active job was not found.");
                return;
            }
            const job = snap.data() || {};
            activeServiceRecord = job;
            setGroupControlsBlocked(isGroupJobRecord(job));
            // Keep stored financial fields intact; normalization is only needed for an aggregate legacy row.
            const stored = [job.serviceLineItems, job.checkoutReviewItems, job.quickEditV4Items]
                .find(rows => Array.isArray(rows) && rows.length);
            activeServiceItems = stored || (typeof window.thResolveComplimentaryServiceLines === "function"
                ? window.thResolveComplimentaryServiceLines(job)
                : []);
            renderServiceOptions("");
        } catch (error) {
            renderServiceOptions("Could not load service lines.");
            setStatus("Could not load itemized services: " + (error && error.message ? error.message : String(error)), "denied");
        }
    }

    function renderContext() {
        const box = document.getElementById("thComplimentaryApprovalContext");
        if (!box) return;
        const pieces = [];
        if (activeContext.scope) pieces.push("Scope: " + activeContext.scope.replace(/_/g, " "));
        if (activeContext.jobId) pieces.push("Job: " + activeContext.jobId);
        if (activeContext.clientName) pieces.push("Client: " + activeContext.clientName);
        if (activeContext.originalValue) pieces.push("Current total: " + activeContext.originalValue);
        box.innerHTML = esc(pieces.join(" | ") || "Complimentary request context will be verified for audit only.");
    }

    function resetForm() {
        activeServiceItems = [];
        activeApprovers = [];
        activeGroupJobBlocked = false;
        const reason = document.getElementById("thComplimentaryReason");
        const other = document.getElementById("thComplimentaryOtherReason");
        const email = document.getElementById("thComplimentaryApproverEmail");
        const pin = document.getElementById("thComplimentaryApprovalPin");
        renderServiceOptions("Load a checkout job to select services...");
        if (reason) reason.value = "";
        if (other) {
            other.value = "";
            other.style.display = "none";
        }
        if (email) {
            email.innerHTML = '<option value="">Loading Manager/Admin approvers...</option>';
            email.value = "";
            email.disabled = true;
        }
        if (pin) {
            pin.value = "";
            pin.disabled = false;
        }
        setStatus("", "");
        setBusy(false);
        renderApproverOptions("loading", []);
    }

    function openModal(context) {
        if (!enabled()) return;
        activeContext = context || checkoutContext("checkout");
        const modal = ensureModal();
        resetForm();
        renderContext();
        modal.hidden = false;
        modal.setAttribute("aria-hidden", "false");
        modal.style.display = "flex";
        loadApproverOptions();
        loadServiceItems();
        setTimeout(function () {
            document.querySelector("[data-th-comp-service-index]:not(:disabled)")?.focus();
        }, 0);
    }

    function closeModal() {
        const modal = document.getElementById(MODAL_ID);
        if (!modal) return;
        modal.hidden = true;
        modal.setAttribute("aria-hidden", "true");
        modal.style.display = "none";
        activeContext = {};
        verifying = false;
    }

    function loadFunctionsSdk() {
        if (window.firebase && firebase.functions) return Promise.resolve();
        if (functionsSdkPromise) return functionsSdkPromise;

        functionsSdkPromise = new Promise(function (resolve, reject) {
            const existing = document.querySelector('script[data-th-firebase-functions-sdk="true"]');
            if (existing) {
                existing.addEventListener("load", function () { resolve(); }, { once: true });
                existing.addEventListener("error", function () { reject(new Error("Firebase Functions SDK failed to load.")); }, { once: true });
                return;
            }
            const script = document.createElement("script");
            script.src = FUNCTIONS_SDK_SRC;
            script.async = true;
            script.dataset.thFirebaseFunctionsSdk = "true";
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error("Firebase Functions SDK failed to load.")); };
            document.head.appendChild(script);
        }).then(function () {
            if (!window.firebase || !firebase.functions) {
                throw new Error("Firebase Functions SDK is unavailable.");
            }
        });

        return functionsSdkPromise;
    }

    async function callMarkComplimentaryService(payload) {
        await loadFunctionsSdk();
        const user = firebase.auth && firebase.auth().currentUser;
        if (!user) throw new Error("Sign in is required before approval can be verified.");
        const functionsService = firebase.app && firebase.app().functions
            ? firebase.app().functions(FUNCTIONS_REGION)
            : firebase.functions(FUNCTIONS_REGION);
        const fn = functionsService.httpsCallable("markComplimentaryService");
        const result = await fn(payload);
        return result && result.data ? result.data : {};
    }

    async function callApplyComplimentaryServiceAdjustment(payload) {
        await loadFunctionsSdk();
        const user = firebase.auth && firebase.auth().currentUser;
        if (!user) throw new Error("Sign in is required before complimentary adjustment can be applied.");
        const functionsService = firebase.app && firebase.app().functions
            ? firebase.app().functions(FUNCTIONS_REGION)
            : firebase.functions(FUNCTIONS_REGION);
        const fn = functionsService.httpsCallable("applyComplimentaryServiceAdjustment");
        const result = await fn(payload);
        return result && result.data ? result.data : {};
    }

    async function callApproveComplimentaryServices(payload) {
        await loadFunctionsSdk();
        const user = firebase.auth && firebase.auth().currentUser;
        if (!user) throw new Error("Sign in is required before complimentary services can be approved.");
        const functionsService = firebase.app && firebase.app().functions
            ? firebase.app().functions(FUNCTIONS_REGION)
            : firebase.functions(FUNCTIONS_REGION);
        const fn = functionsService.httpsCallable("approveComplimentaryServices");
        const result = await fn(payload);
        return result && result.data ? result.data : {};
    }

    function logComplimentaryFlow(stage, payload) {
        try {
            console.info("[THURAYA complimentary flow diagnostics]", {
                stage,
                jobId: activeContext.jobId || "",
                serviceItemIndexes: selectedServiceIndexes(),
                ...payload
            });
        } catch (e) {}
    }

    function skippedReasonLabel(reason) {
        const normalized = lower(reason);
        return {
            already_applied: "already complimentary",
            pending_marker: "pending approval",
            zero_value: "zero-value service",
            invalid_index: "invalid service"
        }[normalized] || normalized.replace(/_/g, " ") || "skipped";
    }

    function appliedSkippedSummary(response) {
        const applied = Array.isArray(response?.appliedIndexes) ? response.appliedIndexes : [];
        const skipped = Array.isArray(response?.skippedIndexes) ? response.skippedIndexes : [];
        const parts = [];
        if (applied.length) {
            parts.push("Applied " + applied.length + " service" + (applied.length === 1 ? "" : "s") + ".");
        }
        if (skipped.length) {
            const detail = skipped.slice(0, 3).map(function (entry) {
                const name = entry?.name || itemName(activeServiceItems[entry?.index] || {});
                return name + " (" + skippedReasonLabel(entry?.reason) + ")";
            }).join("; ");
            parts.push("Skipped " + skipped.length + ": " + detail + (skipped.length > 3 ? "; ..." : "") + ".");
        }
        if (response?.totals && response.totals.amountDue !== undefined) {
            parts.push("New amount due: " + money(response.totals.amountDue) + " GHC.");
        }
        return parts.join(" ") || response?.message || "No eligible service lines were applied.";
    }

    async function verifyApproval() {
        if (!enabled() || verifying) return;

        const serviceItemIndexes = selectedServiceIndexes();
        const reason = reasonValue();
        const approverEmail = (document.getElementById("thComplimentaryApproverEmail")?.value || "").trim().toLowerCase();
        const pin = document.getElementById("thComplimentaryApprovalPin")?.value || "";

        if (!activeContext.jobId) {
            setStatus("Open a checkout job before marking a service complimentary.", "denied");
            return;
        }
        if (activeGroupJobBlocked) {
            setStatus(groupUnsupportedMessage(), "denied");
            return;
        }
        if (!serviceItemIndexes.length) {
            setStatus("Select at least one eligible service line before verifying.", "denied");
            return;
        }
        if (!reason) {
            setStatus("Select or enter a complimentary reason before verifying.", "denied");
            return;
        }
        if (!approverEmail) {
            setStatus("Select the Manager/Admin approver before verifying.", "denied");
            return;
        }
        if (!pin) {
            setStatus("Enter the Manager/Admin PIN before verifying.", "denied");
            return;
        }

        setBusy(true);
        setStatus("Verifying Manager/Admin PIN and approving selected complimentary services...", "info");

        try {
            const payload = {
                reason,
                approverEmail,
                pin,
                requestedBy: activeContext.requestedBy || currentUserEmail(),
                jobId: activeContext.jobId || "",
                serviceItemIndexes
            };
            logComplimentaryFlow("multi_service_request", {
                selectedTotal: selectedComplimentaryTotal(),
                selectedNames: serviceItemIndexes.map(function (index) {
                    return itemName(activeServiceItems[index] || {});
                })
            });
            const response = await callApproveComplimentaryServices(payload);
            const status = String(response.status || (response.approved ? "approved" : "denied")).toLowerCase();
            if (response.applied === true || (response.ok === true && Array.isArray(response.appliedIndexes) && response.appliedIndexes.length)) {
                logComplimentaryFlow("multi_service_financial_adjustment_applied", response);
                setStatus(appliedSkippedSummary(response) + " Refreshing checkout preview...", "approved");
                if (response.refreshJob !== false && typeof window.thCompRefreshCheckoutFromJob === "function") {
                    await window.thCompRefreshCheckoutFromJob(activeContext.jobId, {
                        source: "complimentary_modal_after_phase6d_multi_apply",
                        reopenCheckout: true
                    });
                }
                await loadServiceItems();
                return;
            }
            if (response.ok === true && response.applied === false) {
                logComplimentaryFlow("multi_service_no_eligible_lines", response);
                setStatus(appliedSkippedSummary(response), "info");
                if (response.refreshJob !== false && typeof window.thCompRefreshCheckoutFromJob === "function") {
                    await window.thCompRefreshCheckoutFromJob(activeContext.jobId, {
                        source: "complimentary_modal_after_phase6d_noop",
                        reopenCheckout: true
                    });
                }
                await loadServiceItems();
                return;
            }
            if (status === "locked") {
                setStatus("Locked. Too many failed attempts or approval PIN is locked. No complimentary services were applied.", "locked");
                return;
            }
            if (status === "unauthorized") {
                setStatus("Denied. This Manager/Admin is not authorized for complimentary approval or PIN is not enabled.", "denied");
                return;
            }
            setStatus("Denied. Approval PIN verification failed. No complimentary services were applied.", "denied");
        } catch (error) {
            setStatus("Complimentary approval failed: " + (error && error.message ? error.message : String(error)), "denied");
        } finally {
            setBusy(false);
        }
    }

    function createSlot(id, scope, label) {
        const slot = document.createElement("div");
        slot.id = id;
        slot.style.cssText = "display:none;border:1px dashed #d8c99f;border-radius:12px;background:#fffdf6;padding:12px;margin:0 0 14px;color:#6f5a18;font-size:.82rem;line-height:1.45;";
        slot.innerHTML = [
            '<div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;">',
            '<div><strong style="display:block;color:#111;letter-spacing:.12em;text-transform:uppercase;font-size:.72rem;">Complimentary Approval</strong>',
            '<span>Service-level complimentary approval with Manager/Admin PIN.</span></div>',
            '<button type="button" data-th-comp-open style="border:1px solid #d9d2c3;background:#111;color:#fff;border-radius:999px;padding:8px 14px;font-weight:900;cursor:pointer;">' + esc(label || "Mark Complimentary") + '</button>',
            '</div>'
        ].join("");
        slot.addEventListener("click", function (event) {
            if (event.target.closest("[data-th-comp-open]")) openModal(contextForScope(scope));
        });
        return slot;
    }

    function mountCheckoutSlot() {
        if (!enabled()) return;
        const panel = document.getElementById("checkoutPanel");
        if (!panel || document.getElementById(CHECKOUT_SLOT_ID)) return;
        const slot = createSlot(CHECKOUT_SLOT_ID, "checkout", "Mark Complimentary");
        slot.style.display = "block";
        const method = document.getElementById("checkoutPaymentMethod");
        const methodGroup = method && method.closest ? method.closest(".form-group") : null;
        if (methodGroup && methodGroup.parentNode) {
            methodGroup.parentNode.insertBefore(slot, methodGroup);
        } else {
            panel.insertBefore(slot, panel.firstChild);
        }
    }

    function mountReviewSlot() {
        if (!enabled()) return;
        const modal = document.getElementById("thFohCheckoutReviewModal");
        if (!modal || document.getElementById(REVIEW_SLOT_ID)) return;
        const target = document.getElementById("thFohCheckoutReviewItems");
        if (!target || !target.parentNode) return;
        const slot = createSlot(REVIEW_SLOT_ID, "foh_checkout_review", "Request Complimentary");
        slot.style.display = "block";
        target.parentNode.insertBefore(slot, target.nextSibling);
    }

    function startObserver() {
        if (observerStarted || !enabled() || !document.body) return;
        observerStarted = true;
        const observer = new MutationObserver(mount);
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function mount() {
        if (!enabled()) return;
        ensureModal();
        mountCheckoutSlot();
        mountReviewSlot();
        startObserver();
    }

    window.thComplimentaryApprovalFeatureEnabled = enabled;
    window.thComplimentaryApprovalMount = mount;
    window.thComplimentaryApprovalOpen = openModal;
    window.thComplimentaryApprovalClose = closeModal;

    document.addEventListener("DOMContentLoaded", function () {
        if (!enabled()) return;
        mount();
    });
})();
