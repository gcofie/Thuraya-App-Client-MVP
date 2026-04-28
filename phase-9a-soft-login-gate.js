// ============================================================
// THURAYA CLIENT APP — Phase 9A Soft Login Gating (FULL LOGIC)
// Load AFTER app.js, group-booking.js and availability.js
// Purpose:
// - Let visitors browse and build bookings freely
// - At confirmation, gently encourage Google sign-in
// - Still allow guest booking
// - For signed-in users, require name + phone profile before booking
// ============================================================

(function () {
  const P9 = {
    soloGuestAccepted: false,
    groupGuestAccepted: false,
    initRuns: 0,
  };

  function p9Auth() {
    return window.firebase && firebase.auth ? firebase.auth() : null;
  }

  function p9Db() {
    return window.firebase && firebase.firestore ? firebase.firestore() : null;
  }

  function p9CurrentUser() {
    return p9Auth()?.currentUser || null;
  }

  function p9Toast(message, type = "info") {
    if (typeof window.toast === "function") window.toast(message, type);
    else alert(message);
  }

  function p9GoTo(screenId) {
    if (typeof window.goToStep === "function") window.goToStep(screenId);
    else {
      document.querySelectorAll(".screen").forEach((s) => {
        s.classList.remove("active");
        s.style.display = "none";
      });
      const target = document.getElementById(screenId);
      if (target) {
        target.style.display = "flex";
        target.classList.add("active");
      }
    }
  }

  function p9CleanPhone(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function p9ProfileComplete(profile) {
    if (!profile) return false;
    const name = String(profile.name || profile.fullName || profile.Forename || "").trim();
    const phone = p9CleanPhone(profile.phone || profile.Tel_Number || profile.tel || "");
    return !!name && phone.length === 10;
  }

  function p9FillProfileForm(user, profile = {}) {
    const nameEl = document.getElementById("prof_name");
    const emailEl = document.getElementById("prof_email");
    const phoneEl = document.getElementById("prof_phone");
    const genderEl = document.getElementById("prof_gender");

    if (nameEl && !nameEl.value) nameEl.value = profile.name || profile.fullName || user?.displayName || "";
    if (emailEl) emailEl.value = profile.email || user?.email || "";
    if (phoneEl && !phoneEl.value) phoneEl.value = profile.phone || profile.Tel_Number || "";
    if (genderEl && profile.gender && !genderEl.value) genderEl.value = profile.gender;
  }

  function p9EnsureStyles() {
    if (document.getElementById("p9SoftGateStyles")) return;
    const style = document.createElement("style");
    style.id = "p9SoftGateStyles";
    style.textContent = `
      .p9-softgate-backdrop{
        position:fixed; inset:0; z-index:999999; display:flex; align-items:center; justify-content:center;
        background:rgba(24,18,14,.56); padding:22px; backdrop-filter:blur(8px);
      }
      .p9-softgate-card{
        width:min(448px,100%); background:#fffaf5; color:#2b211b; border-radius:28px;
        box-shadow:0 24px 74px rgba(0,0,0,.30); padding:26px;
        font-family:var(--font-sans, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif);
        border:1px solid rgba(120,90,60,.18);
      }
      .p9-softgate-mark{
        width:46px; height:46px; border-radius:999px; display:flex; align-items:center; justify-content:center;
        background:#2b211b; color:#fff; font-size:22px; margin-bottom:14px;
      }
      .p9-softgate-card h3{margin:0 0 8px; font-size:1.28rem; letter-spacing:-.02em;}
      .p9-softgate-card p{margin:0 0 16px; line-height:1.5; color:#6a5b50; font-size:.95rem;}
      .p9-softgate-benefits{display:grid; gap:8px; margin:14px 0 20px; color:#3b3028; font-size:.92rem;}
      .p9-softgate-benefits div{padding:10px 12px; border-radius:14px; background:rgba(255,255,255,.72); border:1px solid rgba(120,90,60,.08);}
      .p9-softgate-actions{display:grid; gap:10px;}
      .p9-softgate-primary,.p9-softgate-secondary,.p9-softgate-link{
        min-height:46px; border-radius:999px; border:0; cursor:pointer; font-weight:750; font-size:.95rem;
      }
      .p9-softgate-primary{background:#111; color:#fff;}
      .p9-softgate-secondary{background:#8c6239; color:#fff;}
      .p9-softgate-link{background:transparent; color:#6a5b50; text-decoration:underline;}
      .p9-soft-nudge{
        margin:12px 0; padding:12px 14px; border-radius:16px; background:#fff8ef; color:#6a4b2f;
        font-size:.88rem; line-height:1.45; border:1px solid rgba(140,98,57,.12);
      }
    `;
    document.head.appendChild(style);
  }

  function p9CloseGate() {
    document.getElementById("p9SoftGateModal")?.remove();
  }

  function p9ShowGuestGate({ isGroup = false, onContinue }) {
    p9EnsureStyles();
    p9CloseGate();

    const modal = document.createElement("div");
    modal.id = "p9SoftGateModal";
    modal.className = "p9-softgate-backdrop";
    modal.innerHTML = `
      <div class="p9-softgate-card" role="dialog" aria-modal="true" aria-label="Sign in suggestion">
        <div class="p9-softgate-mark">✦</div>
        <h3>Save your booking experience?</h3>
        <p>You can continue as a guest, or sign in to make future THURAYA visits faster and more personal.</p>
        <div class="p9-softgate-benefits">
          <div>✨ Faster booking next time</div>
          <div>📅 View your appointment history</div>
          <div>🎁 Birthday and loyalty surprises</div>
        </div>
        <div class="p9-softgate-actions">
          <button type="button" class="p9-softgate-primary" id="p9GateGoogleBtn">Continue with Google</button>
          <button type="button" class="p9-softgate-secondary" id="p9GateGuestBtn">Continue as Guest</button>
          <button type="button" class="p9-softgate-link" id="p9GateBackBtn">Review booking first</button>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    document.getElementById("p9GateBackBtn").onclick = p9CloseGate;

    document.getElementById("p9GateGuestBtn").onclick = async function () {
      p9CloseGate();
      if (isGroup) P9.groupGuestAccepted = true;
      else P9.soloGuestAccepted = true;
      await onContinue();
    };

    document.getElementById("p9GateGoogleBtn").onclick = async function () {
      try {
        const auth = p9Auth();
        if (!auth) throw new Error("Firebase Auth is not ready.");
        const provider = new firebase.auth.GoogleAuthProvider();
        p9CloseGate();
        await auth.signInWithPopup(provider);
        p9Toast("Signed in successfully. Please confirm your profile before completing the booking.", "success");
      } catch (e) {
        console.warn("Phase 9A Google sign-in skipped:", e);
        p9Toast("Google sign-in was not completed. You can still continue as guest.", "warning");
      }
    };
  }

  async function p9SignedProfileReady() {
    const user = p9CurrentUser();
    const db = p9Db();
    if (!user || !user.email || !db) return false;

    const email = user.email.toLowerCase();
    const ref = db.collection("Client_Users").doc(email);
    const snap = await ref.get();

    if (!snap.exists) {
      await ref.set(
        {
          name: user.displayName || "",
          email,
          authProvider: "google",
          profileComplete: false,
          createdAt: firebase.firestore.FieldValue.serverTimestamp(),
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      p9FillProfileForm(user, { email, name: user.displayName || "" });
      p9GoTo("screen-profile");
      p9Toast("Please add your phone number before confirming your booking.", "info");
      return false;
    }

    const profile = snap.data() || {};
    if (!p9ProfileComplete(profile)) {
      await ref.set(
        {
          authProvider: "google",
          profileComplete: false,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      p9FillProfileForm(user, profile);
      p9GoTo("screen-profile");
      p9Toast("Please add your name and phone number before confirming your booking.", "info");
      return false;
    }

    await ref.set(
      {
        authProvider: "google",
        profileComplete: true,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
    return true;
  }

  function p9PatchSoloBooking() {
    if (window.__p9SoloBookingPatched || typeof window.bk_confirmBooking !== "function") return;
    window.__p9SoloBookingPatched = true;

    const originalConfirm = window.bk_confirmBooking;

    window.bk_confirmBooking = async function () {
      const user = p9CurrentUser();

      // Guest/visitor: only nudge once, then allow the normal booking logic to continue.
      if (!user && !P9.soloGuestAccepted) {
        return p9ShowGuestGate({
          isGroup: false,
          onContinue: () => originalConfirm.apply(this, arguments),
        });
      }

      // Signed-in client: require completed profile before final booking write.
      if (user) {
        const ready = await p9SignedProfileReady();
        if (!ready) return;
      }

      return originalConfirm.apply(this, arguments);
    };
  }

  function p9PatchGroupBooking() {
    if (window.__p9GroupBookingPatched || typeof window.grp_confirmBooking !== "function") return;
    window.__p9GroupBookingPatched = true;

    const originalGroupConfirm = window.grp_confirmBooking;

    window.grp_confirmBooking = async function () {
      const user = p9CurrentUser();

      if (!user && !P9.groupGuestAccepted) {
        return p9ShowGuestGate({
          isGroup: true,
          onContinue: () => originalGroupConfirm.apply(this, arguments),
        });
      }

      if (user) {
        const ready = await p9SignedProfileReady();
        if (!ready) return;
      }

      return originalGroupConfirm.apply(this, arguments);
    };
  }

  function p9PatchSaveProfileMetadata() {
    if (window.__p9SaveProfilePatched || typeof window.saveProfile !== "function") return;
    window.__p9SaveProfilePatched = true;

    const originalSaveProfile = window.saveProfile;

    window.saveProfile = async function () {
      const result = await originalSaveProfile.apply(this, arguments);

      try {
        const user = p9CurrentUser();
        const db = p9Db();
        if (user?.email && db) {
          const email = user.email.toLowerCase();
          const phone = p9CleanPhone(document.getElementById("prof_phone")?.value || "");
          const name = String(document.getElementById("prof_name")?.value || "").trim();
          await db.collection("Client_Users").doc(email).set(
            {
              name,
              phone,
              email,
              authProvider: "google",
              profileComplete: !!name && phone.length === 10,
              updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
            },
            { merge: true }
          );
        }
      } catch (e) {
        console.warn("Phase 9A profile metadata update skipped:", e);
      }

      return result;
    };
  }

  function p9AddSoftNudges() {
    p9EnsureStyles();

    const welcome = document.getElementById("screen-welcome");
    if (welcome && !document.getElementById("p9WelcomeNudge")) {
      const nudge = document.createElement("div");
      nudge.id = "p9WelcomeNudge";
      nudge.className = "p9-soft-nudge";
      nudge.style.maxWidth = "380px";
      nudge.style.margin = "14px auto 0";
      nudge.innerHTML = "✨ Sign in to save your details, view bookings and enjoy faster future visits. Guest booking is still available.";
      const anchor = document.getElementById("btnGoogleSignIn")?.parentElement || welcome.querySelector(".screen-inner") || welcome;
      anchor.insertAdjacentElement("afterend", nudge);
    }

    const confirmBtn = document.getElementById("btnConfirmBooking");
    if (confirmBtn && !document.getElementById("p9ConfirmNudge")) {
      const nudge = document.createElement("div");
      nudge.id = "p9ConfirmNudge";
      nudge.className = "p9-soft-nudge";
      nudge.innerHTML = "💡 Tip: sign in at confirmation to save your details and make your next booking faster.";
      confirmBtn.insertAdjacentElement("beforebegin", nudge);
    }

    const groupConfirmBtn = document.getElementById("grp_btnConfirm");
    if (groupConfirmBtn && !document.getElementById("p9GroupConfirmNudge")) {
      const nudge = document.createElement("div");
      nudge.id = "p9GroupConfirmNudge";
      nudge.className = "p9-soft-nudge";
      nudge.innerHTML = "💡 Sign in to save this group booking under your client profile, or continue as guest.";
      groupConfirmBtn.insertAdjacentElement("beforebegin", nudge);
    }
  }

  function p9Init() {
    P9.initRuns += 1;
    p9PatchSoloBooking();
    p9PatchGroupBooking();
    p9PatchSaveProfileMetadata();
    p9AddSoftNudges();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => setTimeout(p9Init, 250));
  } else {
    setTimeout(p9Init, 250);
  }

  // Retry because app/group scripts create some handlers after DOM load.
  setTimeout(p9Init, 1000);
  setTimeout(p9Init, 2500);

  console.log("✅ Thuraya Client App Phase 9A soft login gating FULL logic loaded");
})();
