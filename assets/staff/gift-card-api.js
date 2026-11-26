(function (root) {
    'use strict';
    const mask = code => /^THGC-\*{4}-/.test(String(code)) ? String(code) : `THGC-****-${String(code || '').slice(-4)}`;
    async function call(command, input = {}) {
        const projectId = root.THURAYA_CONFIG?.projectId;
        if (!['thuraya-staging', 'thuraya-client-telling'].includes(projectId) || !firebase.auth().currentUser) throw new Error('Sign in to use Gift Cards.');
        const actorUid = firebase.auth().currentUser.uid;
        try {
            const response = await firebase.app().functions('us-central1').httpsCallable('giftCardService')({ ...input, command, projectId });
            if (firebase.auth().currentUser?.uid !== actorUid) throw Object.assign(new Error('Gift Card session changed. Sign in and retry.'), { code: 'permission-denied' });
            return response.data;
        } catch (error) {
            if (error.details?.giftCardState) throw Object.assign(new Error(error.message), { giftCardState: error.details.giftCardState });
            const known = ['permission-denied', 'unauthenticated', 'invalid-argument', 'failed-precondition', 'not-found', 'already-exists', 'aborted', 'resource-exhausted'];
            const code = String(error.code || '').replace(/^functions\//, '');
            throw Object.assign(new Error(known.includes(code) ? error.message : 'Gift Card request could not be completed. Retry or check the previous checkout result.'), { giftServiceError: true });
        }
    }
    const storageKey = () => 'thuraya.gift.pending.' + root.THURAYA_CONFIG?.projectId + '.' + firebase.auth().currentUser?.uid;
    function pending() { try { return JSON.parse(sessionStorage.getItem(storageKey()) || 'null'); } catch (_) { return null; } }
    async function checkout(input) {
        const previous = pending();
        if (previous) {
            const status = await call('checkoutStatus', { requestId: previous.requestId });
            if (status.state === 'CANCELLED') { acknowledge(); throw new Error('The previous Gift checkout was cancelled. Review this checkout and confirm again.'); }
            if (previous.primaryJobId !== input.primaryJobId) throw new Error('Resolve the previous Gift checkout before starting another checkout.');
            if (status.state === 'COMMITTED') {
                return status;
            }
        }
        const requestId = previous?.primaryJobId === input.primaryJobId ? previous.requestId : crypto.randomUUID();
        const quote = await call('prepareCheckout', input);
        // Keep only non-secret recovery evidence in browser storage, never bearer codes.
        sessionStorage.setItem(storageKey(), JSON.stringify({ requestId, primaryJobId: input.primaryJobId }));
        return call('checkout', { ...input, requestId, fingerprint: quote.fingerprint });
    }
    async function recover() {
        const previous = pending();
        return previous ? call('checkoutStatus', { requestId: previous.requestId }) : { state: 'NOT_COMMITTED' };
    }
    function acknowledge() { sessionStorage.removeItem(storageKey()); }
    async function cancelPending() {
        const previous = pending();
        if (!previous) return { state: 'NOT_PENDING' };
        const result = await call('cancelCheckout', { requestId: previous.requestId });
        if (['CANCELLED', 'COMMITTED'].includes(result.state)) acknowledge();
        return result;
    }
    root.ThurayaGiftAPI = Object.freeze({ call, mask, checkout, recover, acknowledge, cancelPending });
})(window);
