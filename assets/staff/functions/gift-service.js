'use strict';

const crypto = require('node:crypto');
const model = require('./gift-card-model.generated');
const policy = require('./gift-checkout-policy.generated');
const { createGiftAuthorization, fail } = require('./gift-authorization');
const COLLECTIONS = { cards: 'Gift_Cards', redemptions: 'Gift_Card_Redemptions', commands: 'Gift_Checkouts' };
const CAPABILITY = { lookup: 'giftLookup', prepareCheckout: 'giftCheckout', checkout: 'giftCheckout', checkoutStatus: 'giftCheckout', registry: 'giftAdmin', detail: 'giftAdmin', history: 'giftAdmin', issue: 'giftAdmin', edit: 'giftAdmin' };
const TEXT_FIELDS = ['purchaserName', 'purchaserPhone', 'recipientName', 'recipientPhone', 'recipientEmail', 'message', 'paymentMethod'];
CAPABILITY.cancelCheckout = 'giftCheckout';
const money = value => Number(Number(value).toFixed(2));
const mask = code => `THGC-****-${String(code).slice(-4)}`;
const terminal = value => /^(closed|cancelled|canceled|no show|no-show|completed|paid|archived)$/i.test(String(value || '').trim());
const archived = doc => doc?.archived === true;
const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, v[k]])) : v);
function id(value) {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(value)) fail('invalid-argument', 'An exact document reference is required.');
    return value;
}
function positiveMoney(value) {
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 1e9 || Math.abs(value - money(value)) > 1e-8) fail('invalid-argument', 'Enter a positive amount in pesewas.');
    return value;
}
function codeOf(value) {
    const result = model.normalizeCode(value);
    if (!result.ok) throw model.error(model.outcome('INVALID_CODE_FORMAT'));
    return result.code;
}
function snapshotVersion(snapshot) { const time = snapshot.updateTime; return Number.isInteger(time?.seconds) ? `${time.seconds}:${time.nanoseconds}` : time?.toDate().toISOString() || time?.toString() || ''; }
function cleanCardInput(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) fail('invalid-argument', 'Gift Card details are required.');
    const allowed = ['code', 'amount', 'totalAllowedUses', 'expiryDate', ...TEXT_FIELDS];
    if (Object.keys(input).some(key => !allowed.includes(key))) fail('invalid-argument', 'Only permitted Gift Card details can be changed.');
    const card = { amount: positiveMoney(input.amount) };
    if (!Number.isInteger(input.totalAllowedUses) || input.totalAllowedUses < 1 || input.totalAllowedUses > 10000) fail('invalid-argument', 'Enter a valid allowed-use count.');
    card.totalAllowedUses = input.totalAllowedUses;
    const expiry = model.normalizeDate(input.expiryDate);
    if (!expiry.ok) throw model.error(model.outcome('MALFORMED_DATE'));
    card.expiryDate = expiry.date;
    for (const field of TEXT_FIELDS) {
        if (input[field] != null && typeof input[field] !== 'string') fail('invalid-argument', 'Gift Card text fields must contain text.');
        card[field] = String(input[field] || '').trim();
        if (card[field].length > (field === 'message' ? 4000 : 300)) fail('invalid-argument', 'A Gift Card field is too long.');
    }
    if (!card.purchaserName || !card.recipientName) fail('invalid-argument', 'Sender and recipient names are required.');
    return card;
}

function createGiftService({ db, projectId, fieldValue, securityConfig = () => process.env.GIFT_CARD_SECURITY_JSON, clock = () => new Date() }) {
    const authorize = createGiftAuthorization({ db, projectId, capabilityConfig: securityConfig });
    function key() {
        let config;
        try { config = typeof securityConfig() === 'string' ? JSON.parse(securityConfig()) : securityConfig(); } catch (_) {}
        if (config?.version !== 1 || config.projectId !== projectId || !/^[A-Za-z0-9+/]{43}=$/.test(config.referenceKey || '')) fail('failed-precondition', 'Gift Card service configuration is unavailable.');
        return Buffer.from(config.referenceKey, 'base64');
    }
    const digest = value => crypto.createHmac('sha256', key()).update(projectId + ':' + value).digest('hex');
    function seal(code) {
        const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
        cipher.setAAD(Buffer.from(projectId));
        const encrypted = Buffer.concat([cipher.update(code, 'utf8'), cipher.final()]);
        return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64url');
    }
    function unseal(handle, raw = false) {
        try {
            if (typeof handle !== 'string' || handle.length > 4096) throw Error();
            const bytes = Buffer.from(handle, 'base64url'), cipher = crypto.createDecipheriv('aes-256-gcm', key(), bytes.subarray(0, 12));
            cipher.setAAD(Buffer.from(projectId)); cipher.setAuthTag(bytes.subarray(12, 28));
            const value = Buffer.concat([cipher.update(bytes.subarray(28)), cipher.final()]).toString('utf8');
            return raw ? value : codeOf(value);
        } catch (_) { fail('invalid-argument', 'Gift Card reference is invalid. Reload the registry.'); }
    }
    function cardState(snapshot) {
        const card = snapshot.exists ? snapshot.data() : null;
        if (card && (!Number.isFinite(Number(card.remainingBalance ?? card.amount)) || Number(card.remainingBalance ?? card.amount) < 0)) fail('failed-precondition', 'Gift Card balance needs administrator review.');
        return model.classify(card, clock());
    }
    function summary(snapshot) {
        const card = snapshot.data(), state = cardState(snapshot);
        return { handle: seal(snapshot.id), maskedCode: mask(snapshot.id), amount: card.amount, remainingBalance: state.remaining,
            totalAllowedUses: state.maxUses, usedCount: state.usedCount, remainingUses: state.remainingUses,
            status: card.status, state: state.state, stateLabel: state.label, expiryDate: state.expiryDate,
            issuedAt: card.issuedAt?.toDate?.().toISOString() || card.issuedAt || null, recipientName: card.recipientName || '', version: snapshotVersion(snapshot) };
    }
    function fullCard(snapshot) {
        const card = snapshot.data();
        return { ...summary(snapshot), code: snapshot.id, ...Object.fromEntries(TEXT_FIELDS.map(f => [f, card[f] || ''])) };
    }
    function commandRef(actor, requestId) { return db.collection(COLLECTIONS.commands).doc('gc_' + digest(`${actor.uid}:${id(requestId)}`)); }
    function replay(snapshot, actor, hash) {
        if (!snapshot.exists) return null;
        const command = snapshot.data();
        if (command.actorUid === actor.uid && command.result?.state === 'CANCELLED') fail('failed-precondition', 'This checkout request was cancelled. Reopen checkout to start a new request.');
        if (command.actorUid !== actor.uid || command.requestHash !== hash) fail('already-exists', 'This request ID was already used for different details.');
        return command.result;
    }
    async function administration(request) {
        const data = request.data, input = cleanCardInput(data.card);
        const actor = await authorize(request, 'giftAdmin');
        const code = data.command === 'edit' ? unseal(data.handle) : codeOf(data.card.code);
        if (data.command === 'edit' && data.card.code && codeOf(data.card.code) !== code) fail('invalid-argument', 'A Gift Card code cannot be changed.');
        const ref = db.collection(COLLECTIONS.cards).doc(code), receipt = commandRef(actor, data.requestId), hash = digest(stable(data));
        return db.runTransaction(async tx => {
            await authorize(request, 'giftAdmin', tx);
            const previous = await tx.get(receipt), cached = replay(previous, actor, hash);
            if (cached) return cached;
            const snap = await tx.get(ref), old = snap.exists ? snap.data() : null;
            if (data.command === 'issue' && old) fail('already-exists', 'This Gift Card code already exists.');
            if (data.command === 'edit' && !old) fail('not-found', 'Gift Card not found.');
            if (old && data.version !== snapshotVersion(snap)) fail('aborted', 'This Gift Card changed. Reload it before editing.');
            const now = fieldValue.serverTimestamp();
            const usedCount = old ? model.budget(old).usedCount : 0;
            const spent = old ? Math.max(0, Number(old.amount || 0) - Number(old.remainingBalance ?? old.amount ?? 0)) : 0;
            const next = { ...input, code, remainingBalance: Math.max(0, input.amount - spent), currency: old?.currency || 'GHC',
                status: old?.status || 'Active', usedCount, remainingUses: Math.max(0, input.totalAllowedUses - usedCount),
                source: old?.source || 'staff_sales_promo', updatedAt: now, updatedBy: actor.email,
                issuedAt: old?.issuedAt || now, issuedBy: old?.issuedBy || actor.email,
                ...(old ? { originalAmount: input.amount, maxUses: input.totalAllowedUses } : {}),
                ...(old && Object.hasOwn(old, 'validUntil') ? { validUntil: input.expiryDate } : {}) };
            const result = { command: data.command, handle: seal(code), maskedCode: mask(code), requestId: data.requestId };
            tx.set(ref, next, { merge: !!old });
            tx.create(receipt, { version: 1, action: data.command, actorUid: actor.uid, actorEmail: actor.email, confirmedAt: now,
                requestHash: hash, cardRef: digest(code), previousValues: old ? Object.fromEntries(Object.keys(input).map(k => [k, old[k] ?? null])) : null,
                newValues: input, result });
            return result;
        });
    }
    async function checkoutContext(reader, data) {
        const primaryRef = db.collection('Active_Jobs').doc(id(data.primaryJobId));
        const first = await reader.get(primaryRef);
        if (!first.exists) fail('not-found', 'The Active Job no longer exists.');
        const primary = { ...first.data(), id: first.id };
        let groupSnapshots = [first];
        if (policy.isGroup(primary)) {
            const query = await reader.get(db.collection('Active_Jobs').where('groupId', '==', primary.groupId).limit(101));
            if (query.docs.length > 100) fail('resource-exhausted', 'This group requires a controlled checkout review.');
            groupSnapshots = query.docs.filter(s => !archived(s.data()));
        }
        const group = groupSnapshots.map(s => ({ ...s.data(), id: s.id })).sort((a, b) => `${a.subGroupIndex || 0}_${a.timeString || ''}_${a.clientName || ''}`.localeCompare(`${b.subGroupIndex || 0}_${b.timeString || ''}_${b.clientName || ''}`));
        const plan = policy.plan(primary, group);
        const jobs = plan.jobsToClose;
        if (!plan.canCheckout || !jobs.length || jobs.length > 50 || jobs.some(j => archived(j) || j.status !== 'Ready for Payment' || String(j.paymentStatus).toLowerCase() === 'paid' || j.giftCheckoutId)) fail('failed-precondition', 'The checkout jobs must be open and ready for payment.');
        if (!Array.isArray(data.jobIds) || new Set(data.jobIds).size !== jobs.length || data.jobIds.length !== jobs.length || jobs.some(j => !data.jobIds.includes(j.id))) fail('failed-precondition', 'The checkout job selection changed. Reopen checkout.');
        const appointments = [];
        for (const job of jobs) {
            const ref = db.collection('Appointments').doc(id(job.sourceAppointmentId));
            if (appointments.some(a => a.id === ref.id)) fail('failed-precondition', 'Duplicate source Appointment link.');
            const snapshot = await reader.get(ref);
            const appt = snapshot.exists ? snapshot.data() : null;
            if (!appt || archived(appt) || terminal(appt.status) || String(appt.paymentStatus).toLowerCase() === 'paid' || appt.giftCheckoutId) fail('failed-precondition', 'A linked Appointment is missing or already terminal.');
            if (appt.activeJobId && appt.activeJobId !== job.id) fail('failed-precondition', 'The Appointment belongs to a different checkout job.');
            appointments.push(snapshot);
        }
        const total = money(plan.amount);
        positiveMoney(total);
        if (typeof data.quotedTotal !== 'number' || Math.abs(total - data.quotedTotal) > 0.009) fail('aborted', 'The checkout amount changed. Reopen checkout.');
        const fingerprint = digest(stable({ jobs: groupSnapshots.map(s => [s.id, snapshotVersion(s), s.data()]), appointments: appointments.map(s => [s.id, snapshotVersion(s), s.data()]), primary: primary.id, total, type: plan.type }));
        return { jobs, appointments, total, plan, fingerprint };
    }
    async function checkout(request) {
        const data = request.data, actor = await authorize(request, 'giftCheckout');
        const receipt = commandRef(actor, data.requestId), hash = digest(stable(data));
        if (!Array.isArray(data.cards) || !data.cards.length || data.cards.length > 10) fail('invalid-argument', 'Apply between one and ten Gift Cards.');
        const cards = data.cards.map(card => ({ code: codeOf(card.code), amount: positiveMoney(card.appliedAmount), version: card.version }));
        if (new Set(cards.map(c => c.code)).size !== cards.length) fail('invalid-argument', 'The same Gift Card cannot be applied twice.');
        return db.runTransaction(async tx => {
            await authorize(request, 'giftCheckout', tx);
            const oldReceipt = await tx.get(receipt), cached = replay(oldReceipt, actor, hash);
            if (cached) return cached;
            const context = await checkoutContext(tx, data);
            if (!data.fingerprint || data.fingerprint !== context.fingerprint) fail('aborted', 'Checkout evidence changed. Review checkout again before confirming.');
            const reads = [];
            for (const card of cards) {
                const ref = db.collection(COLLECTIONS.cards).doc(card.code), snap = await tx.get(ref);
                const state = cardState(snap);
                if (!state.valid) throw model.error(state);
                if (!card.version || card.version !== snapshotVersion(snap)) fail('aborted', 'Gift Card balance or state changed. Clear and reapply it.');
                if (state.remaining + 0.009 < card.amount) fail('failed-precondition', 'Gift Card balance is insufficient.');
                reads.push({ ...card, ref, snap, state });
            }
            const applied = money(cards.reduce((s, c) => s + c.amount, 0));
            if (applied > context.total + 0.009) fail('invalid-argument', 'Gift Card credit exceeds the checkout total.');
            const due = money(context.total - applied);
            const topUps = data.topUps || [];
            if (typeof data.split !== 'boolean' || typeof data.planned !== 'boolean' || (data.split !== true && topUps.length > 1) || (policy.isGroup(context.jobs[0]) && data.planned !== true)) fail('invalid-argument', 'The checkout payment plan is invalid.');
            if (!Array.isArray(topUps) || topUps.length > 10 || topUps.some(r => !['Cash', 'Card / POS', 'Mobile Money'].includes(r.method))) fail('invalid-argument', 'Choose a supported top-up payment method.');
            const topUpTotal = money(topUps.reduce((s, r) => s + positiveMoney(r.amount), 0));
            if (Math.abs(topUpTotal - due) > 0.009) fail('invalid-argument', 'Top-up payment must equal the remaining balance.');
            const now = fieldValue.serverTimestamp(), results = [];
            const receiptRef = 'THR-' + String(data.jobIds[0]).replace(/[^a-z0-9]/gi, '').slice(-6).toUpperCase();
            for (const item of reads) {
                const remainingAfter = Math.max(0, item.state.remaining - item.amount), useNumber = item.state.usedCount + 1;
                const remainingUsesAfter = Math.max(0, item.state.maxUses - useNumber), statusAfter = remainingAfter <= 0 || remainingUsesAfter <= 0 ? 'Redeemed' : 'Active';
                const redemptionId = 'gr_' + digest(receipt.id + ':' + item.code);
                const safe = { code: mask(item.code), giftCardId: 'gf_' + digest(item.code), appliedAmount: item.amount, redemptionId,
                    balanceBefore: item.state.remaining, balanceAfterPayment: remainingAfter, remainingUsesAfter, statusAfter };
                tx.update(item.ref, { remainingBalance: remainingAfter, usedCount: useNumber, remainingUses: remainingUsesAfter, status: statusAfter,
                    lastRedeemedAt: now, lastRedeemedBy: actor.email, updatedAt: now });
                tx.create(db.collection(COLLECTIONS.redemptions).doc(redemptionId), { version: 2, code: item.code, giftCardId: item.code,
                    jobIds: data.jobIds, appointmentIds: context.appointments.map(s => s.id), checkoutId: receipt.id, receiptRef,
                    serviceTotal: context.total, appliedAmount: item.amount, remainingAfter, useNumber, totalAllowedUses: item.state.maxUses,
                    remainingUsesAfter, statusAfter, redeemedAt: now, redeemedBy: actor.email, actorUid: actor.uid, requestId: data.requestId, source: 'trusted_staff_checkout' });
                results.push(safe);
            }
            const methodNames = [...new Set(['Gift Card / Voucher', ...topUps.map(r => r.method)])];
            const method = data.split === true ? (methodNames.length > 1 ? `Split: ${methodNames.join(' + ')}` : methodNames[0]) : (topUps[0]?.method || methodNames[0]);
            const paymentMeta = data.split === true || results.length > 1 ? {
                hasSplitPayment: true, paymentSplitVersion: 'PAYMENT_SPLIT_V1', paymentSplitTotal: context.total, paymentSplitBalance: 0,
                topUpPaymentMethod: topUps.map(r => r.method).join(' + '),
                paymentSplits: [...results.map(r => ({ method: 'Gift Card / Voucher', amount: r.appliedAmount, code: r.code, giftCardCode: r.code, redemptionId: r.redemptionId, balanceAfterPayment: r.balanceAfterPayment })), ...topUps.map(r => ({ method: r.method, amount: r.amount }))]
            } : {};
            const gift = { code: results.map(r => r.code).join(' + '), codes: results.map(r => r.code), appliedAmount: applied,
                redemptionId: results.map(r => r.redemptionId).join('|'), redemptionIds: results.map(r => r.redemptionId), redemptions: results,
                balanceAfterPayment: results.reduce((s, r) => s + r.balanceAfterPayment, 0) };
            const giftMeta = { hasGiftCardApplied: true, giftCheckoutVersion: 1, giftCheckoutId: receipt.id, giftCardCode: gift.code, giftCardCodes: gift.codes,
                giftCardAppliedAmount: applied, giftCardBalanceAfterPayment: gift.balanceAfterPayment,
                giftCardRedemptionId: gift.redemptionId, giftCardRedemptionIds: gift.redemptionIds, giftCardRedemptions: results };
            const settlementScope = context.jobs.length > 1 ? 'group' : 'member';
            const settlementJobIds = context.jobs.map(job => job.id).sort();
            const financialReceiptScope = { type: settlementScope, jobIds: settlementJobIds };
            const settlement = policy.evidence.settlement(context.jobs, financialReceiptScope, data.primaryJobId, context.total,
                [...results.map(r => ({ method: 'Gift Card / Voucher', amount: r.appliedAmount,
                    code: r.code, redemptionId: r.redemptionId })), ...topUps.map(r => ({ method: r.method, amount: r.amount }))]);
            // Collection records tender responsibility, never a replacement service/tax calculation.
            for (const job of context.jobs) tx.update(db.collection('Active_Jobs').doc(job.id), { status: 'Closed', paymentStatus: 'Paid', paymentMethod: method,
                ...settlement, paidAmount: job.id === settlement.settlementPayerJobId ? context.total : 0,
                ...(!Object.hasOwn(job, 'totalGHC') ? { totalGHC: job.id === data.primaryJobId ? context.total : 0 } : {}),
                ...(data.planned === true ? { groupCheckoutAmount: context.total, groupCheckoutType: context.plan.type } : {}),
                closedAt: now, closedBy: actor.email, receiptRef, receiptGeneratedAt: now, receiptGeneratedBy: actor.email, receiptStatus: 'Generated', ...giftMeta, ...paymentMeta });
            const clear = { needsFOHAttention: false, rescheduleRequested: false };
            for (const name of ['fohAction', 'returnedToFOHAt', 'returnedToFOHBy', 'rescheduleRequestedAt', 'rescheduleRequestedBy', 'needsFohReview', 'requiresFohAction', 'requestReschedule', 'pendingReschedule', 'returnedToFOH', 'returnToFoh']) clear[name] = fieldValue.delete();
            for (const snapshot of context.appointments) tx.update(snapshot.ref, { status: 'Closed', paymentStatus: 'Paid', paymentMethod: method,
                ...settlement, paidAmount: context.jobs.find(job => job.sourceAppointmentId === snapshot.id)?.id === settlement.settlementPayerJobId ? context.total : 0,
                paidAt: now, paidBy: actor.email, closedAt: now, closedBy: actor.email, updatedAt: now, ...clear, ...paymentMeta,
                giftCheckoutVersion: 1, giftCheckoutId: receipt.id });
            const result = { state: 'COMMITTED', checkoutId: receipt.id, receiptRef, total: context.total, paymentMethod: method, paymentMeta, gift, ...settlement };
            tx.create(receipt, { version: 1, action: 'checkout', actorUid: actor.uid, actorEmail: actor.email, confirmedAt: now, requestId: data.requestId,
                requestHash: hash, impactFingerprint: context.fingerprint, jobIds: data.jobIds, appointmentIds: context.appointments.map(s => s.id), result });
            return result;
        });
    }
    async function handle(request) {
        key();
        const data = request.data || {}, command = data.command;
        if (command !== 'capabilities' && !Object.hasOwn(CAPABILITY, command)) fail('invalid-argument', 'Unknown Gift Card operation.');
        const actor = await authorize(request, CAPABILITY[command]);
        if (command === 'capabilities') return { version: 1, projectId, capabilities: actor.capabilities };
        if (command === 'issue' || command === 'edit') return administration(request);
        if (command === 'checkout') return checkout(request);
        if (command === 'cancelCheckout') {
            const receipt = commandRef(actor, data.requestId);
            return db.runTransaction(async tx => {
                await authorize(request, 'giftCheckout', tx);
                const existing = await tx.get(receipt);
                if (existing.exists) {
                    if (existing.data().actorUid !== actor.uid || existing.data().action !== 'checkout') fail('permission-denied', 'Checkout receipt is unavailable.');
                    return existing.data().result;
                }
                // This tombstone competes with checkout on the same transactional receipt.
                const result = { state: 'CANCELLED', checkoutId: receipt.id };
                tx.create(receipt, { version: 1, action: 'checkout', disposition: 'cancelled', actorUid: actor.uid,
                    actorEmail: actor.email, confirmedAt: fieldValue.serverTimestamp(), requestId: data.requestId,
                    requestHash: digest('cancelled'), result });
                return result;
            });
        }
        if (command === 'checkoutStatus') {
            const snap = await commandRef(actor, data.requestId).get();
            if (!snap.exists) return { state: 'NOT_COMMITTED' };
            if (snap.data().actorUid !== actor.uid || snap.data().action !== 'checkout') fail('permission-denied', 'Checkout receipt is unavailable.');
            return snap.data().result;
        }
        if (command === 'prepareCheckout') {
            const context = await checkoutContext({ get: ref => ref.get() }, data);
            return { fingerprint: context.fingerprint, total: context.total, jobIds: context.jobs.map(j => j.id) };
        }
        if (command === 'lookup') {
            const code = codeOf(data.code), snap = await db.collection(COLLECTIONS.cards).doc(code).get(), state = cardState(snap);
            if (!state.valid) return { state: state.state, message: state.message, valid: false };
            return { valid: true, state: state.state, maskedCode: mask(code), version: snapshotVersion(snap), remainingBalance: state.remaining,
                totalAllowedUses: state.maxUses, usedCount: state.usedCount, remainingUses: state.remainingUses, expiryDate: state.expiryDate };
        }
        if (command === 'detail') {
            const snap = await db.collection(COLLECTIONS.cards).doc(unseal(data.handle)).get();
            if (!snap.exists) fail('not-found', 'Gift Card not found.');
            return fullCard(snap);
        }
        if (command === 'registry') {
            const limit = 50;
            let query = db.collection(COLLECTIONS.cards).orderBy('__name__').limit(limit + 1);
            if (data.cursor) query = query.startAfter(unseal(data.cursor));
            const snap = await query.get(), page = snap.docs.slice(0, limit);
            return { cards: page.filter(s => !archived(s.data())).map(summary), cursor: snap.docs.length > limit ? seal(page.at(-1).id) : null };
        }
        if (command === 'history') {
            const code = unseal(data.handle);
            let query = db.collection(COLLECTIONS.redemptions).where('code', '==', code).orderBy('__name__').limit(51);
            if (data.cursor) query = query.startAfter(unseal(data.cursor, true));
            const snap = await query.get(), page = snap.docs.slice(0, 50);
            return { redemptions: page.map(s => { const row = s.data(); return { reference: 'gh_' + digest(s.id), maskedCode: mask(code),
                appliedAmount: row.appliedAmount, remainingAfter: row.remainingAfter, useNumber: row.useNumber, redeemedAt: row.redeemedAt?.toDate?.().toISOString() || null,
                redeemedBy: row.redeemedBy || '', receiptRef: row.receiptRef || '', jobIds: row.jobIds || [] }; }), cursor: snap.docs.length > 50 ? seal(page.at(-1).id) : null };
        }
    }
    return { handle };
}

module.exports = { createGiftService, COLLECTIONS, CAPABILITY, mask };
