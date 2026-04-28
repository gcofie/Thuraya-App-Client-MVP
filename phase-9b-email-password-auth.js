// ============================================================
// THURAYA CLIENT APP — Phase 9B Email/Password Login
// Load AFTER phase-9a-soft-login-gate.js
// Purpose:
// - Keep Google + Guest as primary options
// - Add email/password as a clean secondary option
// - Reuse existing Client_Users profile completion flow
// ============================================================

(function () {
  const P9B = {
    mountedWelcome: false,
    gateObserverStarted: false,
  };

  function p9bAuth() {
    return window.firebase && firebase.auth ? firebase.auth() : null;
  }

  function p9bDb() {
    return window.firebase && firebase.firestore ? firebase.firestore() : null;
  }

  function p9bToast(message, type = "info") {
    if (typeof window.toast === "function") window.toast(message, type);
    else alert(message);
  }

  function p9bGoTo(screenId) {
    if (typeof window.goToStep === "function") window.goToStep(screenId);
    else if (typeof window.showScreen === "function") window.showScreen(screenId);
    else {
      document.querySelectorAll(".screen").forEach((screen) => screen.classList.remove("active"));
      document.getElementById(screenId)?.classList.add("active");
    }
  }

  function p9bCleanPhone(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function p9bSetLoading(button, isLoading, label) {
    if (!button) return;
    if (!button.dataset.originalText) button.dataset.originalText = button.textContent.trim();
    button.disabled = !!isLoading;
    button.textContent = isLoading ? "Please wait..." : (label || button.dataset.originalText);
  }

  function p9bEmailValue(scope = document) {
    return String(scope.querySelector(".p9b-email-input")?.value || "").trim().toLowerCase();
  }

  function p9bPasswordValue(scope = document) {
    return String(scope.querySelector(".p9b-password-input")?.value || "");
  }

  function p9bValidate(email, password) {
    if (!email || !email.includes("@")) {
      p9bToast("Please enter a valid email address.", "warning");
      return false;
    }
    if (!password || password.length < 6) {
      p9bToast("Password must be at least 6 characters.", "warning");
      return false;
    }
    return true;
  }

  async function p9bEnsureClientProfile(user, provider = "password") {
    const db = p9bDb();
    if (!user || !user.email || !db) return;

    const email = user.email.toLowerCase();
    const ref = db.collection("Client_Users").doc(email);
    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() || {}) : {};

    await ref.set(
      {
        email,
        name: existing.name || user.displayName || "",
        phone: existing.phone || "",
        dob: existing.dob || existing.Date_Of_Birth || "",
        authProvider: existing.authProvider || provider,
        profileComplete: !!(existing.name && p9bCleanPhone(existing.phone).length === 10 && (existing.dob || existing.Date_Of_Birth)),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        createdAt: existing.createdAt || firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    const nameEl = document.getElementById("prof_name");
    const phoneEl = document.getElementById("prof_phone");
    const emailEl = document.getElementById("prof_email");
    const genderEl = document.getElementById("prof_gender");
    const dobEl = document.getElementById("prof_dob");

    if (nameEl && !nameEl.value) nameEl.value = existing.name || user.displayName || "";
    if (phoneEl && !phoneEl.value) phoneEl.value = existing.phone || existing.Tel_Number || "";
    if (emailEl) emailEl.value = email;
    if (genderEl && existing.gender && !genderEl.value) genderEl.value = existing.gender;
    if (dobEl && !dobEl.value) dobEl.value = existing.dob || existing.Date_Of_Birth || "";

    const profileComplete = !!((existing.name || user.displayName) && p9bCleanPhone(existing.phone).length === 10 && (existing.dob || existing.Date_Of_Birth));

    if (!profileComplete) {
      p9bGoTo("screen-profile");
      p9bToast("Please complete your profile before booking.", "info");
    }
  }

  async function p9bSignIn(scope = document, button = null) {
    const auth = p9bAuth();
    if (!auth) return p9bToast("Firebase Auth is not ready.", "error");

    const email = p9bEmailValue(scope);
    const password = p9bPasswordValue(scope);
    if (!p9bValidate(email, password)) return;

    p9bSetLoading(button, true);
    try {
      const result = await auth.signInWithEmailAndPassword(email, password);
      await p9bEnsureClientProfile(result.user, "password");
      document.getElementById("p9SoftGateModal")?.remove();
      p9bToast("Signed in successfully.", "success");
    } catch (e) {
      console.warn("Email sign-in failed:", e);
      p9bToast(p9bFriendlyAuthError(e), "error");
    } finally {
      p9bSetLoading(button, false);
    }
  }

  async function p9bCreateAccount(scope = document, button = null) {
    const auth = p9bAuth();
    if (!auth) return p9bToast("Firebase Auth is not ready.", "error");

    const email = p9bEmailValue(scope);
    const password = p9bPasswordValue(scope);
    if (!p9bValidate(email, password)) return;

    p9bSetLoading(button, true);
    try {
      const result = await auth.createUserWithEmailAndPassword(email, password);
      await p9bEnsureClientProfile(result.user, "password");
      document.getElementById("p9SoftGateModal")?.remove();
      p9bToast("Account created. Please complete your profile.", "success");
    } catch (e) {
      console.warn("Email account creation failed:", e);
      p9bToast(p9bFriendlyAuthError(e), "error");
    } finally {
      p9bSetLoading(button, false);
    }
  }

  async function p9bResetPassword(scope = document, button = null) {
    const auth = p9bAuth();
    if (!auth) return p9bToast("Firebase Auth is not ready.", "error");
    const email = p9bEmailValue(scope);
    if (!email || !email.includes("@")) return p9bToast("Enter your email first, then tap reset password.", "warning");

    p9bSetLoading(button, true);
    try {
      await auth.sendPasswordResetEmail(email);
      p9bToast("Password reset email sent.", "success");
    } catch (e) {
      p9bToast(p9bFriendlyAuthError(e), "error");
    } finally {
      p9bSetLoading(button, false);
    }
  }

  function p9bFriendlyAuthError(error) {
    const code = error?.code || "";
    if (code.includes("auth/user-not-found")) return "No account found for this email. Try Create Account.";
    if (code.includes("auth/wrong-password")) return "Incorrect password. Please try again or reset your password.";
    if (code.includes("auth/email-already-in-use")) return "This email already has an account. Please sign in instead.";
    if (code.includes("auth/weak-password")) return "Please use a stronger password of at least 6 characters.";
    if (code.includes("auth/invalid-email")) return "Please enter a valid email address.";
    if (code.includes("auth/operation-not-allowed")) return "Email/password login is not enabled in Firebase yet.";
    return error?.message || "Authentication failed. Please try again.";
  }

  function p9bEnsureStyles() {
    if (document.getElementById("p9bEmailAuthStyles")) return;
    const style = document.createElement("style");
    style.id = "p9bEmailAuthStyles";
    style.textContent = `
      .p9b-email-wrap{margin-top:12px;width:100%;}
      .p9b-email-toggle{width:100%;border:0;background:transparent;color:var(--gold-dark,#8c6239);font-weight:750;font-size:.82rem;text-decoration:underline;cursor:pointer;padding:8px 0;font-family:var(--font-sans,inherit);}
      .p9b-email-panel{display:none;margin-top:8px;padding:14px;border-radius:18px;background:rgba(255,250,245,.92);border:1px solid rgba(140,98,57,.16);box-shadow:0 10px 24px rgba(0,0,0,.045);}
      .p9b-email-panel.active{display:block;}
      .p9b-email-row{display:grid;gap:9px;margin-bottom:10px;}
      .p9b-email-input,.p9b-password-input{width:100%;box-sizing:border-box;border:1px solid rgba(80,60,45,.18);background:#fff;border-radius:14px;min-height:44px;padding:0 13px;color:#2b211b;font-family:var(--font-sans,inherit);font-size:.92rem;outline:none;}
      .p9b-email-input:focus,.p9b-password-input:focus{border-color:rgba(140,98,57,.5);box-shadow:0 0 0 3px rgba(140,98,57,.10);}
      .p9b-email-actions{display:grid;grid-template-columns:1fr 1fr;gap:8px;}
      .p9b-email-btn{min-height:42px;border-radius:999px;border:0;cursor:pointer;font-weight:800;font-size:.83rem;font-family:var(--font-sans,inherit);}
      .p9b-email-btn.primary{background:#111;color:#fff;}
      .p9b-email-btn.secondary{background:#8c6239;color:#fff;}
      .p9b-email-reset{margin-top:8px;width:100%;border:0;background:transparent;color:#6a5b50;text-decoration:underline;font-size:.78rem;cursor:pointer;font-family:var(--font-sans,inherit);}
      .p9b-email-note{font-size:.76rem;color:#7a6a5f;line-height:1.45;margin:8px 0 0;text-align:center;}
      .p9-softgate-card .p9b-email-panel{background:rgba(255,255,255,.62);}
    `;
    document.head.appendChild(style);
  }

  function p9bEmailBlock(idPrefix = "p9bWelcome") {
    return `
      <div class="p9b-email-wrap" id="${idPrefix}EmailWrap">
        <button type="button" class="p9b-email-toggle" data-p9b-toggle="${idPrefix}EmailPanel">or sign in with email</button>
        <div class="p9b-email-panel" id="${idPrefix}EmailPanel">
          <div class="p9b-email-row">
            <input class="p9b-email-input" type="email" placeholder="Email address" autocomplete="email">
            <input class="p9b-password-input" type="password" placeholder="Password" autocomplete="current-password">
          </div>
          <div class="p9b-email-actions">
            <button type="button" class="p9b-email-btn primary" data-p9b-action="signin">Sign In</button>
            <button type="button" class="p9b-email-btn secondary" data-p9b-action="signup">Create Account</button>
          </div>
          <button type="button" class="p9b-email-reset" data-p9b-action="reset">Forgot password?</button>
          <p class="p9b-email-note">You can still continue as guest. Sign in only if you want your details saved.</p>
        </div>
      </div>
    `;
  }

  function p9bWireEmailBlock(container) {
    if (!container || container.dataset.p9bWired === "true") return;
    container.dataset.p9bWired = "true";

    container.querySelectorAll("[data-p9b-toggle]").forEach((toggle) => {
      toggle.addEventListener("click", () => {
        const panel = document.getElementById(toggle.dataset.p9bToggle);
        if (panel) panel.classList.toggle("active");
      });
    });

    container.querySelectorAll("[data-p9b-action='signin']").forEach((btn) => {
      btn.addEventListener("click", () => p9bSignIn(container, btn));
    });
    container.querySelectorAll("[data-p9b-action='signup']").forEach((btn) => {
      btn.addEventListener("click", () => p9bCreateAccount(container, btn));
    });
    container.querySelectorAll("[data-p9b-action='reset']").forEach((btn) => {
      btn.addEventListener("click", () => p9bResetPassword(container, btn));
    });
  }

  function p9bMountWelcomeEmail() {
    if (P9B.mountedWelcome || document.getElementById("p9bWelcomeEmailWrap")) return;
    const welcomeActions = document.querySelector("#screen-welcome .welcome-actions");
    const anchor = document.getElementById("maisonEmailAnchor");
    const guestBtn = document.getElementById("btnGuestSignIn");
    if (!welcomeActions || !guestBtn) return;

    const holder = document.createElement("div");
    holder.innerHTML = p9bEmailBlock("p9bWelcome");
    const block = holder.firstElementChild;

    if (anchor) anchor.insertAdjacentElement("afterend", block);
    else guestBtn.insertAdjacentElement("beforebegin", block);

    const panel = block.querySelector(".p9b-email-panel");
    if (panel) panel.classList.add("active");

    const toggle = block.querySelector(".p9b-email-toggle");
    if (toggle) toggle.style.display = "none";

    p9bWireEmailBlock(block);

    const createBtn = document.getElementById("maisonCreateAccountBtn");
    if (createBtn) {
      createBtn.addEventListener("click", () => {
        const signup = block.querySelector("[data-p9b-action='signup']");
        if (signup) signup.click();
      });
    }

    P9B.mountedWelcome = true;
  }

  function p9bPatchSoftGateModal() {
    const modal = document.getElementById("p9SoftGateModal");
    if (!modal || document.getElementById("p9bGateEmailWrap")) return;

    const googleBtn = modal.querySelector("#p9GateGoogleBtn");
    if (!googleBtn) return;
    const holder = document.createElement("div");
    holder.innerHTML = p9bEmailBlock("p9bGate");
    const block = holder.firstElementChild;
    googleBtn.insertAdjacentElement("afterend", block);
    p9bWireEmailBlock(block);
  }

  function p9bStartGateObserver() {
    if (P9B.gateObserverStarted) return;
    P9B.gateObserverStarted = true;
    const observer = new MutationObserver(() => p9bPatchSoftGateModal());
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function p9bInit() {
    p9bEnsureStyles();
    p9bMountWelcomeEmail();
    p9bPatchSoftGateModal();
    p9bStartGateObserver();
  }

  window.thurayaEmailSignIn = p9bSignIn;
  window.thurayaEmailCreateAccount = p9bCreateAccount;
  window.thurayaEmailResetPassword = p9bResetPassword;

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(p9bInit, 250));
  } else {
    setTimeout(p9bInit, 250);
  }

  setTimeout(p9bInit, 1000);
  setTimeout(p9bInit, 2500);

  console.log("✅ Thuraya Client App Phase 9B email/password login loaded");
})();
