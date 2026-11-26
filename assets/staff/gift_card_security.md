# Gift Card Trusted Authority

This feature is staged, not production-authorized. No migration is required.

## Authority

`giftCardService` is a Gen2 callable in `us-central1`. Every request pins the
Firebase project, authenticates a Firebase UID, checks a server-controlled Gift
capability entry, and verifies the corresponding active `Users` record server-side.
Client-editable roles, email alone and custom claims cannot grant a capability.
Gift authorization is independent of Commission operator configuration.

`GIFT_CARD_SECURITY_JSON` has this schema (illustrative values, not credentials):

```json
{
  "version": 1,
  "projectId": "thuraya-staging",
  "referenceKey": "BASE64_ENCODED_32_RANDOM_BYTES",
  "operators": [
    {
      "uid": "EXPLICITLY_APPROVED_FIREBASE_UID",
      "email": "approved-staff@example.test",
      "roles": ["FOH"],
      "capabilities": ["giftLookup", "giftCheckout"],
      "enabled": true
    }
  ]
}
```

Approved Admin/System Admin/Manager entries may have `giftAdmin`. FOH cannot have
that capability. Missing, malformed, revoked or wrong-project configuration fails
closed. No automatic Staff enrollment or capability assignment occurs.

The reference key protects opaque registry handles and stable non-bearer ledger
references. Keep it restricted and stable. Rotation needs a separately designed
key-retention/recovery procedure; replacing it would invalidate existing handles
and request-ID derivation. Never expose the configuration to browser clients.

## Commands

| Capability | Commands | Boundary |
| --- | --- | --- |
| Any approved capability | capabilities | Own capabilities only |
| giftLookup | lookup | Exact code; masked minimal result; no enumeration |
| giftAdmin | registry, detail, history | Paginated, masked lists; full recipient card only on detail |
| giftAdmin | issue, edit | Whitelisted existing metadata/commercial fields; version-checked; audited |
| giftCheckout | prepareCheckout, checkoutStatus | Read-only quote and recovery |
| giftCheckout | checkout | Atomic debit, ledger, job/Appointment closure and receipt evidence |
| giftCheckout | cancelCheckout | Atomic cancellation tombstone; never reverses a committed payment |

No hard delete or new deactivation business policy is introduced. Existing inactive,
expired, redeemed, exhausted-use and zero-balance states continue to be enforced.
Normalization and Africa/Accra inclusive expiry use the certified shared model.

## Financial Consistency And Recovery

Checkout re-reads Staff authority, exact jobs, group members, linked Appointments,
Gift cards, fingerprints, balances and use limits in the transaction. Amounts and
job membership are derived with the existing checkout policy. Client balance,
receipt or job-selection overrides cannot establish financial authority.

The private `Gift_Checkouts` request record is keyed by operator UID and request ID.
Same-payload retries return the original result; changed payloads cannot reuse it.
`Gift_Card_Redemptions`, balance/use updates and both closure records commit together.
Receipt image generation remains a post-commit presentation step; the linked receipt
reference and generation evidence are durable in the transaction.

The browser stores only the pending request ID and primary job ID, scoped to project
and UID. A lost response is recovered using `checkoutStatus`. An explicit cancellation
competes on the same request document: either it records `CANCELLED` and prevents a
late debit, or returns the already committed receipt without reversing payment.
Cancellation itself does not change a card, job, Appointment or financial amount.

New job and Appointment evidence has masked codes and non-bearer references. Full
codes remain only in authorized card detail/delivery and server-private ledger data.
Normal browser/server error logs must not contain full codes or card document paths.

## Rules Profiles

`gift-rules-build.cjs` overlays ONLY the Gift hardening onto two captured baselines:

- Staging: `firestore.rules` -> `firestore.staging-gift.rules`.
- Future production: `firestore.production-commission.rules` -> `firestore.production-gift.rules`.

Private Gift collections are excluded from the additive permissive wildcard, not
merely matched by an ineffective explicit deny. Direct reads/writes are denied for
`Gift_Cards`, `Gift_Card_Redemptions`, and `Gift_Checkouts`, including descendants.
Client forging of Gift settlement evidence is denied. Settled Gift root job and
Appointment records permit only notes/internalNotes/updatedAt edits; financial
changes and deletes are denied. Unrelated root and nested access is preserved.
Existing staging Approval rules and production Approval behavior stay distinct.

`firebase.staging-gift.json` is an explicitly staging-only deployment profile.
The default repository rules/config remain unchanged. Generated shared backend
modules are checked against original Gift model and financial helper source with
`node gift-backend-build.cjs --check`; do not edit generated modules independently.

## Remaining Boundaries

- Historical production Active_Jobs already containing full Gift codes are NOT
  rewritten. Their pre-existing public disclosure remains a separate controlled
  historical privacy task. This feature prevents NEW checkout code disclosure.
- Broad pre-existing unrelated Users/non-Gift financial access is not redesigned.
- No Client App, Commission formula, tax policy, Sales logic or financial builder change.
- Node 20 maintenance is separate; deployment runtime is not upgraded here.
- Staging synthetic capability entries are removed after certification; the service
  remains fail-closed until explicitly configured for legitimate approved operators.

## Future Production Sequence (Not Executed)

1. Obtain separate owner approval; verify certified commit, artifact hash, clean main
   and fresh live rules against the captured production baseline. Stop on drift.
2. Deploy ONLY `giftCardService`, preserving established runtime/region and unrelated
   Functions. Any required service-scoped callable transport IAM needs explicit owner
   authorization; no project-wide grant. Configure only explicitly approved Gift UIDs.
3. Verify authenticated minimal lookup and readiness without a business-data mutation.
4. Promote the exact certified Staff App source and byte-verify published assets.
   Arrange an operational checkout pause/reload window for older browser sessions.
5. Verify the Staff App uses trusted paths. Deploy `firestore.production-gift.rules`
   LAST via a reviewed Gift-only config; never substitute broader repository rules.
6. Immediately verify legitimate access and denied direct client Gift access, then
   financial fingerprints and existing data preservation. No production test card,
   redemption, rule or migration without separate explicit authorization.
7. Roll back only on an owner-authorized critical regression. Do not blindly reopen
   permissive Gift rules or rewrite financial data as an operational workaround.
