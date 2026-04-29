// ============================================================
// THURAYA — Phase 8E Conversion Psychology Layer
// Front-end urgency + confidence + premium decision nudges.
// Load AFTER app.js, availability.js, subgroup-upgrade.js, smart-recommendations.js.
// No Firebase structure changes. No Staff App changes.
// ============================================================

(function () {
    if (window.THURAYA_PHASE8E_LOADED) return;
    window.THURAYA_PHASE8E_LOADED = true;

    function q(id) { return document.getElementById(id); }

    function ensureStyles() {
        if (q('thuraya-phase8e-style')) return;
        const style = document.createElement('style');
        style.id = 'thuraya-phase8e-style';
        style.textContent = `
            .phase8e-trust-strip{display:flex;gap:8px;flex-wrap:wrap;margin:14px 0 10px;animation:phase8eIn .25s ease both}
            .phase8e-pill{display:inline-flex;align-items:center;gap:6px;padding:7px 10px;border-radius:999px;background:rgba(180,132,58,.10);border:1px solid rgba(180,132,58,.22);color:var(--primary,#3d3028);font-size:.72rem;font-weight:800;line-height:1}
            .phase8e-slot-note{grid-column:1/-1;margin:0 0 2px;padding:11px 12px;border-radius:14px;background:linear-gradient(135deg,rgba(180,132,58,.11),rgba(255,255,255,.72));border:1px solid rgba(180,132,58,.24);color:var(--primary,#3d3028);font-size:.78rem;line-height:1.35;font-weight:700;animation:phase8eIn .25s ease both}
            .slot-btn.phase8e-low-choice{border-color:rgba(192,57,43,.38)!important}
            .slot-btn .phase8e-mini{display:block;margin-top:4px;font-size:.58rem;line-height:1;color:#b04a3c;font-weight:900;letter-spacing:.02em}
            .phase8e-confirm-box{margin:14px 0;padding:14px;border-radius:18px;background:rgba(39,174,96,.08);border:1px solid rgba(39,174,96,.20);color:var(--primary,#3d3028);font-family:var(--font-sans,inherit);animation:phase8eIn .25s ease both}
            .phase8e-confirm-title{font-weight:900;font-size:.9rem;margin-bottom:5px}
            .phase8e-confirm-body{font-size:.76rem;color:var(--text-muted,#776f68);line-height:1.38}
            .phase8e-soft-warning{background:rgba(243,156,18,.10);border-color:rgba(243,156,18,.28)}
            @keyframes phase8eIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
        `;
        document.head.appendChild(style);
    }

    function insertTrustStrip() {
        const services = q('screen-services');
        const header = services?.querySelector('.step-header');
        if (!services || !header || q('phase8eTrustStrip')) return;
        const strip = document.createElement('div');
        strip.id = 'phase8eTrustStrip';
        strip.className = 'phase8e-trust-strip';
        strip.innerHTML = `
            <span class="phase8e-pill">✦ Curated luxury care</span>
            <span class="phase8e-pill">✓ Secure booking</span>
            <span class="phase8e-pill">↺ Free cancellation 24h before</span>
        `;
        header.insertAdjacentElement('afterend', strip);
    }

    function insertSlotNote(total) {
        const grid = q('bk_slots') || q('grp_slots');
        if (!grid || q('phase8eSlotNote')) return;
        const note = document.createElement('div');
        note.id = 'phase8eSlotNote';
        note.className = 'phase8e-slot-note';
        if (total <= 4) note.textContent = 'Today has limited availability. Choose a time now to secure your preferred visit.';
        else if (total <= 8) note.textContent = 'Good options are available, but premium times may fill quickly.';
        else note.textContent = 'Several times are available. Best Time and Earliest labels can help you decide faster.';
        grid.insertBefore(note, grid.firstChild);
    }

    function tagSlots() {
        const slots = Array.from(document.querySelectorAll('#bk_slots .slot-btn, #grp_slots .slot-btn'));
        if (!slots.length) return;
        const total = slots.length;

        slots.forEach((btn, idx) => {
            if (btn.dataset.phase8eTagged === '1') return;
            btn.dataset.phase8eTagged = '1';

            let techs = [];
            try { techs = JSON.parse(btn.getAttribute('data-techs') || '[]'); } catch(e) {}

            if (total <= 4 || techs.length <= 1) {
                btn.classList.add('phase8e-low-choice');
                if (!btn.querySelector('.phase8e-mini')) {
                    const mini = document.createElement('span');
                    mini.className = 'phase8e-mini';
                    mini.textContent = total <= 4 ? 'Limited slots' : 'Limited choice';
                    btn.appendChild(mini);
                }
            }

            if (idx === 0 && !btn.textContent.toLowerCase().includes('earliest')) {
                const mini = document.createElement('span');
                mini.className = 'phase8e-mini';
                mini.style.color = 'var(--gold-dark,#9a6a18)';
                mini.textContent = 'Earliest option';
                btn.appendChild(mini);
            }
        });

        insertSlotNote(total);
    }

    function clearSlotNoteBeforeReload() {
        const note = q('phase8eSlotNote');
        if (note) note.remove();
        document.querySelectorAll('.slot-btn').forEach(btn => { btn.dataset.phase8eTagged = ''; });
    }

    function insertConfirmConfidence() {
        const screen = q('screen-confirm');
        const card = screen?.querySelector('.confirm-card');
        if (!screen || !card || q('phase8eConfirmBox')) return;
        const tech = q('conf_tech')?.textContent || '';
        const time = q('conf_time')?.textContent || '';
        const box = document.createElement('div');
        box.id = 'phase8eConfirmBox';
        box.className = 'phase8e-confirm-box';
        box.innerHTML = `
            <div class="phase8e-confirm-title">✓ Your slot is ready to confirm</div>
            <div class="phase8e-confirm-body">
                This time has been selected for availability and service fit. Confirm now to reserve ${tech && tech !== '—' ? tech : 'your technician'}${time && time !== '—' ? ' at ' + time : ''}.
            </div>
        `;
        card.insertAdjacentElement('afterend', box);
    }

    function insertGroupConfidence() {
        const screen = q('screen-group-confirm');
        const card = screen?.querySelector('.confirm-card, .form-card');
        if (!screen || !card || q('phase8eGroupConfirmBox')) return;
        const box = document.createElement('div');
        box.id = 'phase8eGroupConfirmBox';
        box.className = 'phase8e-confirm-box phase8e-soft-warning';
        box.innerHTML = `
            <div class="phase8e-confirm-title">Group slot protected</div>
            <div class="phase8e-confirm-body">
                Group appointments need more technician capacity. Confirming early helps keep everyone together at the same time.
            </div>
        `;
        card.insertAdjacentElement('afterend', box);
    }

    function observeSlots() {
        const observer = new MutationObserver(() => setTimeout(tagSlots, 80));
        ['bk_slots', 'grp_slots'].forEach(id => {
            const el = q(id);
            if (el) observer.observe(el, { childList: true, subtree: true });
        });
    }

    function wrapGenerateSlots() {
        if (typeof window.bk_generateSlots === 'function' && !window.bk_generateSlots.__phase8eWrapped) {
            const original = window.bk_generateSlots;
            const wrapped = async function() {
                clearSlotNoteBeforeReload();
                const result = await original.apply(this, arguments);
                setTimeout(tagSlots, 250);
                return result;
            };
            wrapped.__phase8eWrapped = true;
            window.bk_generateSlots = wrapped;
        }

        if (typeof window.grp_generateSlots === 'function' && !window.grp_generateSlots.__phase8eWrapped) {
            const original = window.grp_generateSlots;
            const wrapped = async function() {
                clearSlotNoteBeforeReload();
                const result = await original.apply(this, arguments);
                setTimeout(tagSlots, 250);
                return result;
            };
            wrapped.__phase8eWrapped = true;
            window.grp_generateSlots = wrapped;
        }
    }

    function wrapGoToStep() {
        if (typeof window.goToStep !== 'function' || window.goToStep.__phase8eWrapped) return;
        const original = window.goToStep;
        const wrapped = function(id) {
            const result = original.apply(this, arguments);
            setTimeout(() => {
                insertTrustStrip();
                if (id === 'screen-confirm') insertConfirmConfidence();
                if (id === 'screen-group-confirm') insertGroupConfidence();
                if (id === 'screen-datetime' || id === 'screen-group-datetime') setTimeout(tagSlots, 200);
            }, 120);
            return result;
        };
        wrapped.__phase8eWrapped = true;
        window.goToStep = wrapped;
    }

    document.addEventListener('DOMContentLoaded', () => {
        ensureStyles();
        insertTrustStrip();
        setTimeout(() => {
            wrapGenerateSlots();
            wrapGoToStep();
            observeSlots();
            tagSlots();
        }, 600);
    });

    window.thurayaPhase8ERefresh = function() {
        ensureStyles();
        insertTrustStrip();
        wrapGenerateSlots();
        wrapGoToStep();
        tagSlots();
        insertConfirmConfidence();
        insertGroupConfidence();
    };

    console.log('Thuraya Phase 8E Conversion Psychology loaded.');
})();
