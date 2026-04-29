// ============================================================
// THURAYA — Phase 8D Smart Recommendations
// Add-on intelligence layer for client-facing service selection.
// Load AFTER app.js and AFTER subgroup-upgrade.js if present.
// ============================================================

(function () {
    if (window.THURAYA_PHASE8D_LOADED) return;
    window.THURAYA_PHASE8D_LOADED = true;

    const RULES = [
        {
            key: 'signature-care',
            match: ['signature', 'deluxe', 'luxury'],
            suggest: ['paraffin', 'scrub', 'massage', 'mask'],
            title: 'Complete the ritual',
            body: 'Clients often pair this with a nourishing enhancement for a more polished finish.',
            badge: 'Recommended'
        },
        {
            key: 'express-boost',
            match: ['express', 'quick', 'classic'],
            suggest: ['polish', 'gel', 'massage'],
            title: 'Upgrade your finish',
            body: 'Add a small enhancement to make this quick visit feel more complete.',
            badge: 'Smart Add-on'
        },
        {
            key: 'foot-care',
            match: ['foot', 'pedicure', 'heel'],
            suggest: ['scrub', 'paraffin', 'massage', 'callus'],
            title: 'Best with foot care',
            body: 'A foot ritual works beautifully with exfoliation or massage add-ons.',
            badge: 'Popular Pairing'
        },
        {
            key: 'hand-care',
            match: ['hand', 'manicure'],
            suggest: ['paraffin', 'scrub', 'massage', 'gel'],
            title: 'Best with hand care',
            body: 'Add extra care for hydration, shine, and a more premium finish.',
            badge: 'Recommended'
        }
    ];

    function q(id) { return document.getElementById(id); }

    function ensureStyles() {
        if (q('thuraya-phase8d-style')) return;
        const style = document.createElement('style');
        style.id = 'thuraya-phase8d-style';
        style.textContent = `
            .smart-reco-panel {
                margin: 16px 0 18px;
                padding: 14px;
                border: 1px solid rgba(180,132,58,.28);
                border-radius: 18px;
                background: linear-gradient(135deg, rgba(180,132,58,.10), rgba(255,255,255,.72));
                box-shadow: 0 10px 28px rgba(0,0,0,.055);
                font-family: var(--font-sans, inherit);
                animation: thurayaRecoIn .25s ease both;
            }
            .smart-reco-top {
                display: flex;
                align-items: flex-start;
                gap: 10px;
            }
            .smart-reco-icon {
                width: 34px;
                height: 34px;
                border-radius: 999px;
                display:flex;
                align-items:center;
                justify-content:center;
                background: rgba(180,132,58,.16);
                color: var(--gold-dark,#9a6a18);
                flex: 0 0 auto;
            }
            .smart-reco-title {
                font-weight: 800;
                color: var(--primary,#3d3028);
                font-size: .92rem;
                margin-bottom: 3px;
            }
            .smart-reco-body {
                color: var(--text-muted,#776f68);
                font-size: .78rem;
                line-height: 1.35;
            }
            .smart-reco-badge {
                margin-left:auto;
                font-size:.61rem;
                font-weight:900;
                letter-spacing:.06em;
                text-transform:uppercase;
                color:white;
                background: var(--gold,#b4843a);
                padding:5px 7px;
                border-radius:999px;
                white-space:nowrap;
            }
            .smart-reco-actions {
                display:flex;
                flex-wrap:wrap;
                gap:8px;
                margin-top:12px;
            }
            .smart-reco-chip {
                border:1px solid rgba(180,132,58,.35);
                background: rgba(255,255,255,.78);
                color: var(--primary,#3d3028);
                border-radius:999px;
                padding:8px 10px;
                font-size:.75rem;
                font-weight:700;
                cursor:pointer;
                transition:.18s ease;
            }
            .smart-reco-chip:hover {
                transform: translateY(-1px);
                box-shadow: 0 6px 16px rgba(180,132,58,.13);
            }
            .smart-reco-chip small {
                color: var(--gold-dark,#9a6a18);
                font-weight:800;
                margin-left:4px;
            }
            .smart-reco-note {
                margin-top:9px;
                color: var(--text-muted,#776f68);
                font-size:.70rem;
            }
            .service-card.smart-suggested {
                border-color: rgba(180,132,58,.72) !important;
                box-shadow: 0 9px 24px rgba(180,132,58,.12);
            }
            .smart-card-ribbon {
                position:absolute;
                top:6px;
                right:8px;
                background:rgba(180,132,58,.95);
                color:#fff;
                font-size:.56rem;
                padding:3px 6px;
                border-radius:999px;
                font-weight:900;
                letter-spacing:.04em;
                text-transform:uppercase;
                pointer-events:none;
            }
            @keyframes thurayaRecoIn {
                from { opacity:0; transform:translateY(6px); }
                to { opacity:1; transform:translateY(0); }
            }
        `;
        document.head.appendChild(style);
    }

    function selectedNames() {
        return (window.bk_selectedServices || []).map(s => (s.name || '').toLowerCase()).join(' ');
    }

    function selectedIds() {
        return new Set((window.bk_selectedServices || []).map(s => s.id));
    }

    function getCards() {
        return Array.from(document.querySelectorAll('#bk_serviceMenu .service-card'));
    }

    function getCardName(card) {
        const nameEl = card.querySelector('.service-card-name');
        return (nameEl ? nameEl.textContent : card.textContent || '').trim();
    }

    function getServiceIdFromCard(card) {
        const input = card.querySelector('input[id^="bk_cb_"], input[id^="bk_qty_"]');
        if (!input || !input.id) return '';
        return input.id.replace(/^bk_cb_/, '').replace(/^bk_qty_/, '');
    }

    function inferPrice(card) {
        const txt = card.textContent || '';
        const m = txt.match(/([0-9]+(?:\.[0-9]+)?)\s*GHC/i);
        return m ? Number(m[1]) : null;
    }

    function findRule() {
        const names = selectedNames();
        if (!names.trim()) return null;
        return RULES.find(rule => rule.match.some(w => names.includes(w))) || {
            key: 'general',
            match: [],
            suggest: ['massage', 'scrub', 'paraffin', 'gel', 'polish'],
            title: 'Make it special',
            body: 'Add one carefully selected enhancement to complete your visit.',
            badge: 'Smart Pick'
        };
    }

    function findSuggestionCards(rule) {
        const already = selectedIds();
        const cards = getCards();

        return cards
            .map(card => {
                const id = getServiceIdFromCard(card);
                const name = getCardName(card);
                const lower = name.toLowerCase();
                const hit = rule.suggest.some(w => lower.includes(w));
                const selected = already.has(id) || card.classList.contains('selected');
                const input = card.querySelector('input');
                const isRadio = input && input.type === 'radio';
                return { card, id, name, price: inferPrice(card), hit, selected, isRadio };
            })
            .filter(x => x.hit && !x.selected && !x.isRadio)
            .slice(0, 4);
    }

    function clearSmartMarks() {
        document.querySelectorAll('.smart-card-ribbon').forEach(x => x.remove());
        document.querySelectorAll('.service-card.smart-suggested').forEach(card => {
            card.classList.remove('smart-suggested');
        });
    }

    function markSuggested(suggestions) {
        clearSmartMarks();
        suggestions.forEach(s => {
            s.card.classList.add('smart-suggested');
            if (!s.card.querySelector('.smart-card-ribbon')) {
                const ribbon = document.createElement('div');
                ribbon.className = 'smart-card-ribbon';
                ribbon.textContent = 'Suggested';
                s.card.style.position = 'relative';
                s.card.appendChild(ribbon);
            }
        });
    }

    function clickCard(card) {
        card.scrollIntoView({ behavior:'smooth', block:'center' });
        setTimeout(() => card.click(), 150);
        setTimeout(refreshRecommendations, 260);
    }

    function renderPanel(rule, suggestions) {
        let panel = q('smartRecoPanel');
        const menu = q('bk_serviceMenu');
        if (!menu) return;

        if (!rule || !suggestions.length) {
            if (panel) panel.remove();
            clearSmartMarks();
            return;
        }

        if (!panel) {
            panel = document.createElement('div');
            panel.id = 'smartRecoPanel';
            panel.className = 'smart-reco-panel';
            menu.parentNode.insertBefore(panel, menu);
        }

        const chips = suggestions.map((s, i) => {
            const price = s.price !== null ? `<small>+${s.price} GHC</small>` : '';
            return `<button type="button" class="smart-reco-chip" data-reco-index="${i}">${s.name}${price}</button>`;
        }).join('');

        panel.innerHTML = `
            <div class="smart-reco-top">
                <div class="smart-reco-icon">✦</div>
                <div>
                    <div class="smart-reco-title">${rule.title}</div>
                    <div class="smart-reco-body">${rule.body}</div>
                </div>
                <div class="smart-reco-badge">${rule.badge}</div>
            </div>
            <div class="smart-reco-actions">${chips}</div>
            <div class="smart-reco-note">Tap a suggestion to add it instantly. You can remove it anytime.</div>
        `;

        panel.querySelectorAll('.smart-reco-chip').forEach(btn => {
            btn.addEventListener('click', () => {
                const idx = Number(btn.getAttribute('data-reco-index'));
                const s = suggestions[idx];
                if (s && s.card) clickCard(s.card);
            });
        });

        markSuggested(suggestions);
    }

    function refreshRecommendations() {
        try {
            ensureStyles();
            const rule = findRule();
            const suggestions = rule ? findSuggestionCards(rule) : [];
            renderPanel(rule, suggestions);
        } catch (e) {
            console.warn('Phase 8D recommendations skipped:', e);
        }
    }

    function hookSelectionEvents() {
        document.addEventListener('click', function (e) {
            if (e.target.closest('#bk_serviceMenu .service-card') || e.target.closest('.counter-btn')) {
                setTimeout(refreshRecommendations, 120);
            }
        }, true);
    }

    function hookRenderMenu() {
        const existing = window.renderMenuForDept;
        if (typeof existing === 'function' && !existing.__phase8dWrapped) {
            const wrapped = function(dept) {
                const result = existing.apply(this, arguments);
                setTimeout(refreshRecommendations, 160);
                return result;
            };
            wrapped.__phase8dWrapped = true;
            window.renderMenuForDept = wrapped;
        }
    }

    document.addEventListener('DOMContentLoaded', () => {
        ensureStyles();
        hookRenderMenu();
        hookSelectionEvents();
        setTimeout(refreshRecommendations, 500);
    });

    window.thurayaRefreshSmartRecommendations = refreshRecommendations;
    console.log('Thuraya Phase 8D Smart Recommendations loaded.');
})();
