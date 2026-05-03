// UPDATED app.js (only sticky bar function modified)

function bk_updateStickyBarOptionA() {
    const bar = document.getElementById('bk_stickyBar');
    if (!bar) return;

    const full = document.getElementById('bk_stickyFull');
    const list = document.getElementById('bk_breakdownList');
    const tax = document.getElementById('bk_taxBreakdown');
    const durEl = document.getElementById('bk_totalDuration');
    const totalEl = document.getElementById('bk_totalCost');
    const continueBtn = document.getElementById('btnToTech');

    const selected = bk_selectedServices || [];
    const hasSelection = selected.length > 0;

    const empty = document.getElementById('bk_stickyEmpty');
    if (empty) empty.style.display = 'none';

    if (!hasSelection) {
        bar.style.display = 'none';
        if (continueBtn) continueBtn.disabled = true;
        return;
    }

    bar.style.display = 'block';

    const subtotal = selected.reduce((sum, item) => sum + (Number(item.price) || 0) * (item.qty || 1), 0);
    const totalMins = selected.reduce((sum, item) => sum + (Number(item.dur) || 0) * (item.qty || 1), 0);
    const taxes = applyTaxes(subtotal);

    if (full) full.style.display = 'block';

    if (list) {
        list.innerHTML = selected.map(item => `
            <div class="sticky-line-item">
                <span>${item.name}${item.qty > 1 ? ' × ' + item.qty : ''}</span>
                <strong>${((Number(item.price) || 0) * (item.qty || 1)).toFixed(2)} GHC</strong>
            </div>
        `).join('');
    }

    if (tax) {
        tax.innerHTML = taxes.taxLines?.length ? taxes.taxLines.map(t => `
            <div class="sticky-line-item tax">
                <span>${t.name} (${t.rate}%)</span>
                <strong>${t.amount.toFixed(2)} GHC</strong>
            </div>
        `).join('') : '';
    }

    if (durEl) durEl.textContent = totalMins;
    if (totalEl) totalEl.textContent = taxes.grandTotal.toFixed(2);

    if (continueBtn) {
        continueBtn.disabled = false;
        continueBtn.textContent = 'Continue →';
        continueBtn.onclick = function(){ goToStep('screen-technician'); };
    }
}
