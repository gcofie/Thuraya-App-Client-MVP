/* ============================================================
   THURAYA STAFF APP — HF92B Gift Card Sales Visibility Fix
   Staff App only. Manager/Admin issuance inside Sales & Promo.
   This module safely injects the Gift Cards tab even when an older
   sales-promo-v1.js renderer is still active/cached.
   ============================================================ */
(function(){
    if (window.THURAYA_HF92B_GIFT_CARD_SALES_LOADED) return;
    window.THURAYA_HF92B_GIFT_CARD_SALES_LOADED = true;

    function safe(v){
        return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
    }
    function money(v){
        const n = Number(parseFloat(v || 0));
        return Number.isFinite(n) ? n : 0;
    }
    function todayStr(){
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function defaultGiftExpiry(){
        const d = new Date();
        d.setMonth(d.getMonth() + 6);
        return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    }
    function roles(){
        try { return (Array.isArray(window.currentRoles) ? window.currentRoles : currentRoles || []).map(r => String(r||'').toLowerCase()); }
        catch(e){ return []; }
    }
    function canIssueGiftCards(){
        const r = roles();
        return r.some(x => x.includes('admin') || x.includes('manager'));
    }
    function canSeeSales(){
        const r = roles();
        return r.some(x => x.includes('admin') || x.includes('manager'));
    }
    function getDb(){
        if (window.db) return window.db;
        if (window.firebase && firebase.firestore) return firebase.firestore();
        return null;
    }
    function serverTimestamp(){
        try { return firebase.firestore.FieldValue.serverTimestamp(); } catch(e){ return new Date().toISOString(); }
    }
    function currentEmail(){
        try { return window.currentUserEmail || currentUserEmail || ''; } catch(e){ return ''; }
    }
    function currentName(){
        try { return window.currentUserName || currentUserName || ''; } catch(e){ return ''; }
    }

    function generateGiftCode(){
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let suffix = '';
        if (window.crypto && crypto.getRandomValues) {
            const arr = new Uint8Array(8);
            crypto.getRandomValues(arr);
            suffix = Array.from(arr, b => chars[b % chars.length]).join('');
        } else {
            suffix = Math.random().toString(36).slice(2,10).toUpperCase();
        }
        const code = `THG-${suffix.slice(0,4)}-${suffix.slice(4,8)}`;
        const el = document.getElementById('gift_code');
        if (el) el.value = code;
        return code;
    }

    function buildShareText(card){
        return `THURAYA Digital Gift Card\n\nAmount: GH₵${money(card.amount).toFixed(2)}\nRecipient: ${card.recipientName || ''}\nCode: ${card.code}\nValid until: ${card.expiryDate || ''}\n\nPresent this code at THURAYA checkout to redeem.`;
    }

    function giftCardPreview(card){
        return `
            <div style="max-width:420px;background:#050505;color:#fff;border-radius:22px;padding:26px 24px;box-shadow:0 18px 48px rgba(0,0,0,.18);border:1px solid rgba(255,255,255,.12);">
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;color:#cfcfcf;font-size:11px;letter-spacing:.14em;text-transform:uppercase;">
                    <span>Valid for 6 months</span><span>For you</span>
                </div>
                <div style="font-family:Georgia,serif;font-size:74px;font-style:italic;line-height:1;margin:22px 0 14px;color:#f5f5f5;">gift</div>
                <div style="height:1px;background:rgba(255,255,255,.16);margin:18px 0;"></div>
                <div style="font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#bfbfbf;">Gift Card</div>
                <div style="font-size:34px;font-weight:900;margin:8px 0 14px;">GH₵ ${money(card.amount).toFixed(2)}</div>
                <div style="font-size:12px;color:#ccc;line-height:1.55;">
                    <strong>Recipient:</strong> ${safe(card.recipientName || 'Recipient')}<br>
                    <strong>Code:</strong> <span style="letter-spacing:.12em;color:#fff;">${safe(card.code || '')}</span><br>
                    <strong>Expires:</strong> ${safe(card.expiryDate || '')}
                </div>
                ${card.message ? `<div style="margin-top:16px;padding:12px;border:1px solid rgba(255,255,255,.16);border-radius:14px;color:#e7e7e7;font-size:13px;line-height:1.5;">${safe(card.message)}</div>` : ''}
                <div style="display:flex;justify-content:space-between;gap:12px;align-items:flex-end;margin-top:24px;color:#aaa;font-size:10px;letter-spacing:.08em;text-transform:uppercase;">
                    <span>Only for use at THURAYA</span><span style="font-family:Georgia,serif;font-size:24px;color:#eee;">THURAYA</span>
                </div>
            </div>`;
    }

    function markActiveGiftTab(){
        document.querySelectorAll('.sales-tab-btn').forEach(btn => btn.classList.remove('active'));
        const giftBtn = document.getElementById('salesGiftCardsTabBtn');
        if (giftBtn) giftBtn.classList.add('active');
    }

    function injectGiftTab(){
        const tabs = document.querySelector('.sales-tabs');
        if (!tabs) return;
        if (document.getElementById('salesGiftCardsTabBtn')) return;
        const btn = document.createElement('button');
        btn.id = 'salesGiftCardsTabBtn';
        btn.className = 'sales-tab-btn';
        btn.type = 'button';
        btn.textContent = 'Gift Cards';
        btn.onclick = function(){ window.sales_showTab && window.sales_showTab('giftcards'); };
        tabs.appendChild(btn);
    }

    function renderGiftCards(){
        const content = document.getElementById('salesContent');
        if (!content) return;
        injectGiftTab();
        markActiveGiftTab();
        const canSell = canIssueGiftCards();
        content.innerHTML = `
            <div class="sales-note">
                <strong>Manager/Admin controlled.</strong> Sell THURAYA digital gift cards, generate a secure code, then share by WhatsApp or email. FOH redeems approved active cards during checkout only.
            </div>
            ${!canSell ? `<div class="th-rbac-denied"><strong>Access restricted</strong><span>Gift card issuance is available to Manager/Admin only.</span></div>` : `
            <div class="sales-card">
                <h3>Sell Digital Gift Card</h3>
                <div class="sales-form-grid">
                    <div class="form-group"><label>Gift Card Value</label><select id="gift_amount_select" onchange="sales_onGiftAmountPreset()"><option value="550">GH₵550</option><option value="750">GH₵750</option><option value="1150">GH₵1150</option><option value="1500">GH₵1500</option><option value="2000">GH₵2000</option><option value="custom">Custom Amount</option></select></div>
                    <div class="form-group"><label>Custom Amount</label><input type="number" id="gift_amount_custom" min="1" step="0.01" placeholder="Only if custom" disabled></div>
                    <div class="form-group"><label>Payment Method</label><select id="gift_payment_method"><option value="Card / POS">💳 Card / POS</option><option value="Mobile Money">📱 Mobile Money</option><option value="Cash">💵 Cash</option><option value="Bank Transfer">🏦 Bank Transfer</option></select></div>
                    <div class="form-group"><label>Purchaser Name</label><input type="text" id="gift_purchaser_name" placeholder="Buyer name"></div>
                    <div class="form-group"><label>Purchaser Phone</label><input type="tel" id="gift_purchaser_phone" placeholder="Buyer phone"></div>
                    <div class="form-group"><label>Recipient Name</label><input type="text" id="gift_recipient_name" placeholder="Gift recipient"></div>
                    <div class="form-group"><label>Recipient WhatsApp</label><input type="tel" id="gift_recipient_whatsapp" placeholder="233..."></div>
                    <div class="form-group"><label>Recipient Email</label><input type="email" id="gift_recipient_email" placeholder="optional@email.com"></div>
                    <div class="form-group"><label>Expiry Date</label><input type="date" id="gift_expiry" value="${defaultGiftExpiry()}"></div>
                    <div class="form-group"><label>Gift Card Code</label><div style="display:flex;gap:8px;"><input type="text" id="gift_code" placeholder="Auto-generated" style="flex:1;text-transform:uppercase;"><button type="button" class="sales-btn" onclick="sales_generateGiftCardCode()">Auto</button></div></div>
                    <div class="form-group" style="grid-column:1/-1;"><label>Gift Message</label><textarea id="gift_message" rows="3" placeholder="Optional message shown on the digital card"></textarea></div>
                </div>
                <div class="sales-actions">
                    <button class="sales-btn primary" onclick="sales_sellGiftCard()">Sell & Issue Gift Card</button>
                    <button class="sales-btn" onclick="sales_loadGiftCards()">Refresh Gift Cards</button>
                </div>
                <div id="giftSaleResult" style="margin-top:16px;"></div>
            </div>`}
            <div class="sales-card" style="margin-top:16px;">
                <h3>Gift Card Registry</h3>
                <div id="salesGiftCardList"><p style="color:#999;font-style:italic;">Loading gift cards...</p></div>
            </div>`;
        if (canSell) generateGiftCode();
        loadGiftCards();
    }

    function onGiftAmountPreset(){
        const sel = document.getElementById('gift_amount_select');
        const custom = document.getElementById('gift_amount_custom');
        if (!sel || !custom) return;
        custom.disabled = sel.value !== 'custom';
        if (sel.value !== 'custom') custom.value = '';
    }

    async function sellGiftCard(){
        if (!canIssueGiftCards()) { alert('Gift card sales are restricted to Manager/Admin.'); return; }
        const db = getDb();
        if (!db) { alert('Database is not ready.'); return; }
        const preset = document.getElementById('gift_amount_select')?.value || '550';
        const amount = preset === 'custom' ? money(document.getElementById('gift_amount_custom')?.value) : money(preset);
        const code = (document.getElementById('gift_code')?.value || '').trim().toUpperCase() || generateGiftCode();
        const purchaserName = (document.getElementById('gift_purchaser_name')?.value || '').trim();
        const purchaserPhone = (document.getElementById('gift_purchaser_phone')?.value || '').trim();
        const recipientName = (document.getElementById('gift_recipient_name')?.value || '').trim();
        const recipientWhatsApp = (document.getElementById('gift_recipient_whatsapp')?.value || '').trim();
        const recipientEmail = (document.getElementById('gift_recipient_email')?.value || '').trim();
        const expiryDate = document.getElementById('gift_expiry')?.value || defaultGiftExpiry();
        const paymentMethod = document.getElementById('gift_payment_method')?.value || 'Card / POS';
        const message = (document.getElementById('gift_message')?.value || '').trim();
        if (!amount || amount <= 0) { alert('Enter a valid gift card amount.'); return; }
        if (!purchaserName || !recipientName) { alert('Enter purchaser and recipient name.'); return; }
        if (!recipientWhatsApp && !recipientEmail) { alert('Enter recipient WhatsApp or email so the gift card can be shared.'); return; }
        try {
            const ref = db.collection('Gift_Cards').doc(code);
            const existing = await ref.get();
            if (existing.exists) { alert('This gift card code already exists. Generate another code.'); return; }
            const card = {
                code, amount, originalAmount: amount, remainingBalance: amount,
                purchaserName, purchaserPhone, recipientName, recipientWhatsApp, recipientEmail,
                expiryDate, paymentMethod, message,
                status: 'Active', source: 'staff_sales_promo', saleType: 'digital_gift_card',
                createdAt: serverTimestamp(), issuedAt: serverTimestamp(), updatedAt: serverTimestamp(),
                issuedBy: currentEmail(), issuedByName: currentName()
            };
            await ref.set(card, { merge:false });
            const share = buildShareText(card);
            const wa = recipientWhatsApp ? `https://wa.me/${recipientWhatsApp.replace(/[^0-9]/g,'')}?text=${encodeURIComponent(share)}` : '';
            const mail = recipientEmail ? `mailto:${encodeURIComponent(recipientEmail)}?subject=${encodeURIComponent('Your THURAYA Digital Gift Card')}&body=${encodeURIComponent(share)}` : '';
            const result = document.getElementById('giftSaleResult');
            if (result) result.innerHTML = `
                <div class="sales-note" style="border-left-color:var(--success);"><strong>Gift card issued.</strong> Code: ${safe(code)}</div>
                <div style="display:grid;grid-template-columns:minmax(260px,420px) 1fr;gap:16px;align-items:start;">
                    ${giftCardPreview(card)}
                    <div class="sales-card" style="margin:0;">
                        <h3>Share Digital Card</h3>
                        <p style="color:#666;font-size:.9rem;">Send this gift card to the recipient using WhatsApp or email.</p>
                        <div class="sales-actions">${wa ? `<a class="sales-btn primary" href="${wa}" target="_blank" rel="noopener">Share WhatsApp</a>` : ''}${mail ? `<a class="sales-btn" href="${mail}">Send Email</a>` : ''}<button class="sales-btn" onclick="navigator.clipboard && navigator.clipboard.writeText(${JSON.stringify(share)}); alert('Gift card message copied.');">Copy Message</button></div>
                    </div>
                </div>`;
            loadGiftCards();
        } catch(e) {
            console.error('Gift card sale failed', e);
            alert('Could not issue gift card: ' + e.message);
        }
    }

    async function loadGiftCards(){
        const list = document.getElementById('salesGiftCardList');
        if (!list) return;
        const db = getDb();
        if (!db) { list.innerHTML = '<p style="color:#999;font-style:italic;">Database is not ready.</p>'; return; }
        list.innerHTML = '<p style="color:#777;">Loading...</p>';
        try {
            const snap = await db.collection('Gift_Cards').get();
            const rows = [];
            snap.forEach(doc => rows.push({ id:doc.id, ...(doc.data()||{}) }));
            rows.sort((a,b) => String(b.issuedAt?.seconds || b.createdAt?.seconds || b.id || '').localeCompare(String(a.issuedAt?.seconds || a.createdAt?.seconds || a.id || '')));
            if (!rows.length) { list.innerHTML = '<p style="color:#999;font-style:italic;">No gift cards issued yet.</p>'; return; }
            list.innerHTML = `<div class="sales-table-wrap"><table class="sales-table"><thead><tr><th>Status</th><th>Code</th><th>Amount</th><th>Balance</th><th>Purchaser</th><th>Recipient</th><th>Expiry</th><th>Share</th></tr></thead><tbody>${rows.map(r => {
                const share = buildShareText(r);
                const wa = r.recipientWhatsApp ? `https://wa.me/${String(r.recipientWhatsApp).replace(/[^0-9]/g,'')}?text=${encodeURIComponent(share)}` : '';
                const mail = r.recipientEmail ? `mailto:${encodeURIComponent(r.recipientEmail)}?subject=${encodeURIComponent('Your THURAYA Digital Gift Card')}&body=${encodeURIComponent(share)}` : '';
                const statusClass = String(r.status || '').toLowerCase() === 'active' ? 'active' : 'paused';
                return `<tr><td><span class="sales-badge ${statusClass}">${safe(r.status || '')}</span></td><td><strong>${safe(r.code || r.id)}</strong></td><td>GH₵${money(r.amount).toFixed(2)}</td><td>GH₵${money(r.remainingBalance ?? r.amount).toFixed(2)}</td><td>${safe(r.purchaserName || '')}<br><small>${safe(r.purchaserPhone || '')}</small></td><td>${safe(r.recipientName || '')}<br><small>${safe(r.recipientWhatsApp || r.recipientEmail || '')}</small></td><td>${safe(r.expiryDate || '')}</td><td><div style="display:flex;gap:6px;flex-wrap:wrap;">${wa ? `<a class="sales-btn" style="padding:6px 8px;font-size:.7rem;" href="${wa}" target="_blank" rel="noopener">WA</a>` : ''}${mail ? `<a class="sales-btn" style="padding:6px 8px;font-size:.7rem;" href="${mail}">Email</a>` : ''}</div></td></tr>`;
            }).join('')}</tbody></table></div>`;
        } catch(e) {
            console.error('Load gift cards failed', e);
            list.innerHTML = `<div class="sales-note" style="border-left-color:var(--error);">Could not load gift cards.<br><strong>${safe(e.message)}</strong></div>`;
        }
    }

    function patchSalesShowTab(){
        if (window.THURAYA_HF92B_SALES_SHOW_PATCHED) return true;
        if (typeof window.sales_showTab !== 'function') return false;
        const original = window.sales_showTab;
        window.sales_showTab = function(tab){
            if (tab === 'giftcards') return renderGiftCards();
            const result = original.apply(this, arguments);
            setTimeout(injectGiftTab, 60);
            setTimeout(injectGiftTab, 250);
            return result;
        };
        window.THURAYA_HF92B_SALES_SHOW_PATCHED = true;
        return true;
    }

    function patchSwitchModule(){
        if (window.THURAYA_HF92B_SWITCH_PATCHED) return true;
        if (typeof window.switchModule !== 'function') return false;
        const original = window.switchModule;
        window.switchModule = function(moduleId){
            const result = original.apply(this, arguments);
            if (moduleId === 'salesView') {
                setTimeout(() => { patchSalesShowTab(); injectGiftTab(); }, 120);
                setTimeout(() => { patchSalesShowTab(); injectGiftTab(); }, 600);
            }
            return result;
        };
        window.THURAYA_HF92B_SWITCH_PATCHED = true;
        return true;
    }

    function enforceSalesRbac(){
        const tab = document.getElementById('tabSales');
        if (tab) tab.style.display = canSeeSales() ? 'flex' : 'none';
    }

    function boot(){
        patchSalesShowTab();
        patchSwitchModule();
        enforceSalesRbac();
        injectGiftTab();
        setTimeout(() => { patchSalesShowTab(); patchSwitchModule(); enforceSalesRbac(); injectGiftTab(); }, 500);
        setTimeout(() => { patchSalesShowTab(); patchSwitchModule(); enforceSalesRbac(); injectGiftTab(); }, 1500);
        const mo = new MutationObserver(() => {
            if (document.getElementById('salesView') && document.getElementById('salesView').style.display !== 'none') {
                patchSalesShowTab(); injectGiftTab(); enforceSalesRbac();
            }
        });
        mo.observe(document.documentElement, { childList:true, subtree:true });
        if (window.firebase && firebase.auth) firebase.auth().onAuthStateChanged(() => setTimeout(() => { enforceSalesRbac(); injectGiftTab(); }, 1000));
    }

    window.sales_generateGiftCardCode = generateGiftCode;
    window.sales_onGiftAmountPreset = onGiftAmountPreset;
    window.sales_sellGiftCard = sellGiftCard;
    window.sales_loadGiftCards = loadGiftCards;
    window.sales_renderGiftCards = renderGiftCards;

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
})();
