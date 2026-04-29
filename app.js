// ==============================
// 🔥 FORCE TIME CTA (FINAL FIX)
// ==============================

// 1. Create CTA
function forceTimeCTA() {
    const slots = document.getElementById('bk_slots');
    if (!slots) return;

    let wrap = document.getElementById('bk_timeContinueWrap');

    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'bk_timeContinueWrap';
        wrap.style.margin = '30px 0 120px';

        const btn = document.createElement('button');
        btn.id = 'btnToConfirm';
        btn.className = 'btn-primary full';
        btn.textContent = 'Continue →';
        btn.disabled = true;

        btn.onclick = () => goToStep('screen-confirm');

        wrap.appendChild(btn);

        // attach BELOW time slots
        slots.parentElement.appendChild(wrap);
    }
}


// 2. Inject CTA AFTER slots render (IMPORTANT)
(function watchSlotsRender() {
    const observer = new MutationObserver(() => {
        const slots = document.getElementById('bk_slots');

        if (slots && slots.children.length > 0) {
            forceTimeCTA();
        }
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
})();


// 3. Activate CTA when user selects time
document.addEventListener('click', function(e) {
    if (e.target.closest('#bk_slots button')) {
        const btn = document.getElementById('btnToConfirm');
        if (btn) {
            btn.disabled = false;
            btn.style.opacity = '1';
            btn.style.cursor = 'pointer';
        }
    }
});