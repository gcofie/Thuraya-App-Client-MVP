// ==============================
// THURAYA FINAL STABLE BUILD
// ==============================

console.log("Thuraya FINAL build loaded");

// ==============================
// GUEST FIX (safe)
// ==============================
window.continueAsGuest = window.continueAsGuest || function () {
    bk_isGuest = true;
    _screenHistory.push('screen-guest');
    showScreen('screen-guest');
    window.scrollTo({ top: 0, behavior: 'smooth' });
};

// ==============================
// CTA STYLE
// ==============================
function bk_finalStyleCTA(btn, active) {
    if (!btn) return;

    btn.className = 'btn-primary full';
    btn.style.display = 'flex';
    btn.style.alignItems = 'center';
    btn.style.justifyContent = 'center';
    btn.style.width = '100%';
    btn.style.minHeight = '56px';
    btn.style.borderRadius = '22px';
    btn.style.fontWeight = '900';
    btn.style.letterSpacing = '.14em';
    btn.style.textTransform = 'uppercase';

    if (active) {
        btn.style.background = 'linear-gradient(180deg,#151515 0%,#050505 100%)';
        btn.style.color = '#fff';
        btn.style.cursor = 'pointer';
    } else {
        btn.style.background = '#CEC8BE';
        btn.style.color = '#756F66';
        btn.style.cursor = 'not-allowed';
    }
}

// ==============================
// USE EXISTING BUTTON ONLY (FIXED)
// ==============================
function bk_finalSyncCTAs() {

    // hide sticky bar always
    const stickyBar = document.getElementById('bk_stickyBar');
    if (stickyBar) stickyBar.style.display = 'none';

    // ===== SERVICE STEP =====
    const serviceBtn = document.getElementById('btnToTech');
    if (serviceBtn) {
        const active = Array.isArray(bk_selectedServices) && bk_selectedServices.length > 0;

        serviceBtn.textContent = "Continue →";
        serviceBtn.disabled = !active;

        serviceBtn.onclick = function () {
            if (!active) return;
            goToStep('screen-technician');
        };

        bk_finalStyleCTA(serviceBtn, active);
    }

    // ===== TIME STEP =====
    const timeBtn = document.getElementById('btnToConfirm');
    if (timeBtn) {
        const hasTime = !!(document.getElementById('bk_time')?.value);

        timeBtn.textContent = "Continue →";
        timeBtn.disabled = !hasTime;

        timeBtn.onclick = function () {
            if (!hasTime) return;
            goToStep('screen-confirm');
        };

        bk_finalStyleCTA(timeBtn, hasTime);
    }
}

// ==============================
// UPDATE BREAKDOWN (SAFE)
// ==============================
function updateBreakdown() {
    let total = 0;

    bk_selectedServices.forEach(s => {
        total += (Number(s.price) || 0) * (s.qty || 1);
    });

    bk_finalSyncCTAs();
}

// ==============================
// SCREEN SWITCH PATCH
// ==============================
const originalShowScreen = window.showScreen;

window.showScreen = function (id) {
    originalShowScreen(id);

    setTimeout(() => {
        bk_finalSyncCTAs();
    }, 100);
};

// ==============================
// SLOT SELECTION PATCH
// ==============================
document.addEventListener('click', function (e) {
    if (e.target.closest('#bk_slots button')) {

        const btn = document.getElementById('btnToConfirm');

        if (btn) {
            btn.disabled = false;
            bk_finalStyleCTA(btn, true);
        }
    }
});

// ==============================
// INITIAL LOAD
// ==============================
document.addEventListener('DOMContentLoaded', function () {
    setTimeout(() => {
        bk_finalSyncCTAs();
    }, 500);
});