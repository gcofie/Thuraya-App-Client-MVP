
// FULL app.js PATCH — removes "SERVICES" section from Foot menu safely

function renderMenuForDept(dept) {
    if (dept === 'Hand') return renderThurayaReferenceMenuForDept(dept);
    if (dept === 'Foot') return renderFootMenuCustom(dept);
    return renderMenuForDeptLegacy(dept);
}

function renderFootMenuCustom(dept) {
    const container = document.getElementById('bk_serviceMenu');
    if (!container) return;

    const ORDER = [
        'Foundation Rituals',
        'Urban Express Rituals',
        'Medi-Cleanse Series',
        'The Finishing Indulgences',
        'Polish & Finish'
        // "Services" intentionally removed
    ];

    let grouped = {};

    (bk_menuServices || []).forEach(s => {
        if ((s.department || '').toLowerCase().includes('foot')) {
            let cat = (s.category || 'Other')
                .replace(/^[A-Z]\./, '')
                .replace(/^SERVICES$/i, '') // remove SERVICES grouping
                .trim();

            if (!cat) return;

            if (!grouped[cat]) grouped[cat] = [];
            grouped[cat].push(s);
        }
    });

    let html = '';

    ORDER.forEach(cat => {
        const items = grouped[cat];
        if (!items) return;

        html += `
        <div class="thuraya-accordion-section">
            <button class="thuraya-accordion-head" onclick="bk_toggleMenuSection(this)">
                <span class="thuraya-accordion-title">${cat}</span>
                <span class="thuraya-accordion-chevron">›</span>
            </button>
            <div class="thuraya-accordion-body">
                <div class="thuraya-accordion-inner">
                    ${items.map(s => _buildCard(s, dept)).join('')}
                </div>
            </div>
        </div>`;
    });

    container.innerHTML = html;
}
