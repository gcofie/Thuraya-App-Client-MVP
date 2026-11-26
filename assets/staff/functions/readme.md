# THURAYA Staff Backend Functions

Backend-only Firebase Cloud Functions for Staff App operational controls.

## Approval PIN Scaffold

Exports:

- `setApprovalPin`
- `verifyApprovalPin`
- `resetApprovalPin`
- `markComplimentaryService`
- `applyComplimentaryServiceAdjustment`
- `approveComplimentaryServices`

The feature is disabled unless `APPROVAL_PIN_ENABLED=true` and `APPROVAL_PIN_PEPPER` is configured in the Functions environment. Do not store PIN hashes in `Users/{email}`.

`markComplimentaryService` is Phase 5 marker-only. It verifies the Manager/Admin PIN and writes complimentary metadata to the selected `Active_Jobs/{jobId}.serviceLineItems[n]` plus job-level summary fields. It does not change totals, tax, payment, receipt, gift card, split payment, or checkout-close behavior.

`applyComplimentaryServiceAdjustment` is Phase 6A backend-only recalculation. It requires one approved Phase 5 service marker, rejects group/closed/cancelled/no-show jobs, snapshots original totals/items, sets the selected marked service payable value to zero, and recalculates `Active_Jobs` totals/tax only. It does not change receipts, checkout close behavior, payment methods, gift cards, split payments, reports, commissions, Hubtel, or Client App behavior.

`approveComplimentaryServices` is Phase 6D-A backend-only multi-service approval. It verifies one Manager/Admin PIN, rejects group/closed/completed/cancelled/no-show jobs, snapshots original totals/items once, financially applies all eligible selected `serviceLineItems`, skips invalid/already-applied/pending-marker/true zero-value lines, and recalculates `Active_Jobs` totals/tax once. It keeps the existing single-service callables unchanged for rollback and compatibility. It does not change frontend UI, receipts, checkout close behavior, payment methods, gift cards, split payments, reports, commissions, Hubtel, or Client App behavior.

Callable payload:

```js
{
  jobId: "Active_Jobs document id",
  serviceItemIndexes: [0, 2],
  approverEmail: "manager@example.com",
  pin: "123456",
  reason: "Service Recovery"
}
```

Successful responses include `appliedIndexes`, `skippedIndexes`, recalculated `totals`, and `refreshJob: true` for the future frontend refresh step.

## Staging Setup

```powershell
firebase use staging
firebase functions:config:get
```

For sandbox testing only, configure environment values through the approved Firebase mechanism before deploying to staging. Keep production unset until rollout approval.

Required values:

```text
APPROVAL_PIN_ENABLED=true
APPROVAL_PIN_PEPPER=<long random secret>
APPROVAL_PIN_PEPPER_VERSION=v1
APPROVAL_PIN_MAX_FAILED_ATTEMPTS=5
APPROVAL_PIN_LOCKOUT_MINUTES=15
```

## Staging Deploy

```powershell
firebase deploy --only functions:setApprovalPin,functions:verifyApprovalPin,functions:resetApprovalPin,functions:markComplimentaryService,functions:applyComplimentaryServiceAdjustment,functions:approveComplimentaryServices --project thuraya-staging
```

## Rollback

```powershell
firebase functions:delete approveComplimentaryServices --project thuraya-staging
firebase functions:delete applyComplimentaryServiceAdjustment --project thuraya-staging
```

Delete `markComplimentaryService`, `setApprovalPin`, `verifyApprovalPin`, and `resetApprovalPin` only if rolling back the full approval PIN scaffold.
