// ===============================
// THURAYA — Subgroup UX Upgrade (Phase 8C)
// Drop-in enhancement for app.js
// ===============================

// Enhance subgroup rendering with smart labels + UX polish

function enhanceSubgroupsUI() {
    const labels = document.querySelectorAll('.menu-subgroup-label');

    labels.forEach(label => {
        const text = label.innerText.toLowerCase();

        if (text.includes('ritual')) {
            label.innerHTML = '✨ Choose your ritual <span style="color:#bbb;font-size:0.68rem;">(pick one)</span>';
        }

        if (text.includes('enhancements')) {
            label.innerHTML = '🌿 Enhance your experience <span style="color:#bbb;font-size:0.68rem;">(optional)</span>';
        }
    });

    // Highlight popular services (basic rule-based)
    document.querySelectorAll('.service-card').forEach(card => {
        const name = card.innerText.toLowerCase();

        if (name.includes('deluxe') || name.includes('signature')) {
            const badge = document.createElement('div');
            badge.innerText = 'POPULAR';
            badge.style.cssText = `
                position:absolute;
                top:6px;
                right:8px;
                background:#b4843a;
                color:white;
                font-size:0.6rem;
                padding:2px 6px;
                border-radius:4px;
                font-weight:700;
            `;
            card.style.position = 'relative';
            card.appendChild(badge);
        }
    });
}

// Hook into menu render
const originalRenderMenu = window.renderMenuForDept;

window.renderMenuForDept = function(dept) {
    originalRenderMenu(dept);
    setTimeout(enhanceSubgroupsUI, 50);
};

console.log('Phase 8C Subgroup UX upgrade loaded');
