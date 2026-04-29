// =============================
// THURAYA CLIENT APP (STABLE FINAL)
// =============================

let bk_selectedServices = [];

// -----------------------------
// NAVIGATION
// -----------------------------
function goToStep(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById(screenId).classList.add('active');
}

// -----------------------------
// SERVICE RENDER
// -----------------------------
function renderMenuForDept(services) {
    const container = document.getElementById('bk_serviceMenu');
    let html = '';

    services.forEach((svc, i) => {
        html += `
        <div class="service-card">
            <label>
                <input type="checkbox" class="svc-checkbox" data-index="${i}">
                <strong>${svc.name}</strong><br>
                ${svc.desc || ''}
                <br>${svc.duration} mins | ${svc.price} GHC
            </label>
        </div>`;
    });

    container.innerHTML = html;

    // Attach listeners
    document.querySelectorAll('.svc-checkbox').forEach(cb => {
        cb.addEventListener('change', () => {
            updateSelection();
        });
    });

    ensureContinueButton();
}

// -----------------------------
// CONTINUE BUTTON (INLINE)
// -----------------------------
function ensureContinueButton() {
    const container = document.getElementById('bk_serviceMenu');

    let wrap = document.getElementById('bk_continueWrap');
    if (!wrap) {
        wrap = document.createElement('div');
        wrap.id = 'bk_continueWrap';
        wrap.style.margin = '30px 0 120px';

        const btn = document.createElement('button');
        btn.id = 'btnToTech';
        btn.className = 'btn-primary full';
        btn.textContent = 'Continue →';
        btn.disabled = true;

        btn.onclick = () => goToStep('screen-technician');

        wrap.appendChild(btn);
        container.after(wrap);
    }
}

// -----------------------------
// SELECTION LOGIC (FIXED)
// -----------------------------
function updateSelection() {
    const checkboxes = document.querySelectorAll('#bk_serviceMenu input[type="checkbox"]');

    bk_selectedServices = [];

    checkboxes.forEach((cb, i) => {
        if (cb.checked) {
            bk_selectedServices.push(i);
        }
    });

    updateBreakdown();
}

// -----------------------------
// BREAKDOWN + CTA STATE (FINAL FIX)
// -----------------------------
function updateBreakdown() {
    const nextBtn = document.getElementById('btnToTech');

    const hasCheckboxSelection =
        document.querySelector('#bk_serviceMenu input[type="checkbox"]:checked');

    const hasQuantitySelection = Array.from(
        document.querySelectorAll('.qty')
    ).some(q => parseInt(q.textContent || "0") > 0);

    const isValidSelection = hasCheckboxSelection || hasQuantitySelection;

    if (nextBtn) {
        nextBtn.disabled = !isValidSelection;
        nextBtn.style.opacity = isValidSelection ? '1' : '.45';
        nextBtn.style.cursor = isValidSelection ? 'pointer' : 'not-allowed';
    }
}

// -----------------------------
// MOCK DATA (SAFE)
// -----------------------------
document.addEventListener('DOMContentLoaded', () => {
    renderMenuForDept([
        {
            name: "Full Custom Design Consultation",
            desc: "Highly detailed custom nail creation.",
            duration: 90,
            price: 0
        },
        {
            name: "Classic Manicure",
            desc: "Basic nail care and polish.",
            duration: 45,
            price: 50
        }
    ]);
});