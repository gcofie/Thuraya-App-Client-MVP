# Commission V2 Production Compatibility

This is a source/staging candidate, not production deployment authorization.
No migration, historical recalculation, operator enrollment, or technician rule
is performed at startup, deployment, config read, or report read.

## Operator Authorization

The callable uses a validated Firebase Auth UID and token email, then reads
`Users/{normalizedEmail}`. Staff roles alone are not trusted: the current live
rules permit clients to edit Users. Administrative access also requires an
enabled UID entry in server-only `COMMISSION_OPERATORS_JSON`.

The JSON has this schema (synthetic placeholders, not production identities):

```json
{
  "version": 1,
  "projectId": "thuraya-staging",
  "operators": [
    {
      "uid": "<independently-approved-staging-auth-uid>",
      "email": "<matching-synthetic-email>",
      "roles": ["Manager"],
      "enabled": true
    }
  ]
}
```

Only exact normalized Admin, Manager and System Admin roles are recognized.
The UID, pinned email, configured role and current Users role must agree.
Disabled/inactive Staff are denied. Custom role claims, payload roles, display
names and mutable Users.uid/email fields cannot grant authority. The Staff
check is repeated within mutation transactions. Missing, malformed,
wrong-project or duplicate-UID configuration grants no operator capability.

Configure staging through the ignored `functions/.env.thuraya-staging`, and
production only under separate owner approval through the ignored
`functions/.env.thuraya-client-telling`. Preserve all unrelated existing
environment variables. Use a single-quoted JSON value on the environment line.
Never commit real UIDs or copy the staging list into production.

Removing/disabling an entry and redeploying only commissionV2 revokes authority
after the new revision receives traffic. No role-claim migration or client
token refresh is needed. In-flight calls may finish. Users demotion is read
on each call, but definitive revocation must remove the server-approved UID
because Users remains client-editable. Firebase refresh-token revocation
alone is not immediate validation of already-issued tokens in this helper.

## Command Matrix

| Operation | Required authority |
| --- | --- |
| Own config/report/snapshot read | Authenticated existing, non-disabled Staff; target person accessUids or legacy personal scope |
| Manager report/config/staff/snapshot read | Staff Admin/Manager role AND approved pinned Auth UID |
| Legacy rule administration / legacy lock / legacy payout metadata | Same approved operator; existing legacy validation and snapshot protections; no target activation required |
| Enable target configuration | Approved operator, runtime configuration flag, explicit confirmation and note |
| Draft/publish/close/cancel/successor rule | Approved operator AND enabled target configuration |
| Enroll/close/manage identity binding | Approved operator AND enabled target configuration; explicit identity confirmation |
| Target lock / payout metadata | Approved operator AND enabled target configuration; existing concurrency/lock checks |
| Rewrite snapshot calculation or rule history | No client command; prohibited. Backend creates immutable snapshots and only permitted payout metadata changes |
| Direct protected Firestore writes | Denied to every client, including managers; trusted callable only |

All managerial UI controls use callable capabilities. Global Staff App roles
and non-Commission callable authorization are unchanged.

## Activation and Legacy Compatibility

`COMMISSION_V2_ENABLED` defaults to false when absent. Setting this deployment
flag permits a separately authorized operator to explicitly enable target
configuration; the flag alone creates nothing. The UI confirmation calls
`enable` with `activationConfirmed: true` and an audit note. No project-name
exception is required for a future approved production setup.

Before activation, legacy read/admin/lock/payout operations remain available
to approved operators. A real legacy mutation may create revision/idempotency
metadata, but its control remains `enabled: false`; it never activates the
target model. Reads remain side-effect-free. Unconfigured target preview/report
returns NOT_CONFIGURED, distinct from a configured zero award.

No initial technician, target, rate, binding or date is hardcoded or seeded.
Future production setup/enrollment is a separate authorization after promotion.

## Rules Sources and Deployment Boundary

- `firestore.rules`: existing broader candidate, including repository Approval
  protections; unchanged by this remediation. The default firebase.json
  predeploy hook restricts this rules profile to thuraya-staging.
- `firestore.production-commission.rules`: captured live production source plus
  only the certified four-collection Commission overlay.
- `firebase.production-commission.json`: rules-only production profile. Its
  hook requires the exact production project and an independently approved
  `THURAYA_COMMISSION_PRODUCTION_RULES_SHA256`.
- `commission-deployment-check.cjs`: local checks only; no cloud mutation.

Captured live release:
`projects/thuraya-client-telling/rulesets/18be146d-4cb2-4151-8df6-745ebb58214d`

Captured live SHA-256:
`AFE4B845D53F25065759F0BE6A9AEA0FA5F8919D1863063CE212EECD3DABAC46`

Live rules last changed on 2026-05-13. The Approval hardening commit
`878c2695ab1260eb9cfbc87f5e01c3e74d15e4b4` is later (2026-05-25), and those
protections are absent live. This remains a separate security/governance task.
Do not delete the committed protections or silently publish them with Commission.

The production overlay preserves unrelated live access, including the
pre-existing broad Users/Approval fallback. It does NOT certify that baseline
as secure. Official simulations compare unrelated root/nested access before
and after. Before any future production deploy, fetch live rules again and
abort/reconcile if the baseline hash has changed.

## Future Scoped Procedure (Not Authorized Here)

1. Obtain owner approval for the newly staging-certified commit, exact operator
   UID configuration, complete reviewed rules hash, and service-level IAM.
2. Deploy only `functions:commissionV2` from that exact source to the explicitly
   named production project. Keep target configuration disabled and empty.
3. Verify backend readiness before main/Netlify frontend publication.
4. Promote the exact certified source using normal git operations, verify assets
   and arrange refresh of stale clients before enforcing new Commission rules.
5. Use only `firebase.production-commission.json` with
   `--only firestore:rules`, after the fresh live-baseline check and hash approval.
6. Certify GET-only and stop. No production technician rules are created.

Function command shape:
```text
firebase deploy --project thuraya-client-telling --only functions:commissionV2
```

Rules command shape (requires separate hash approval in the environment):
```text
firebase deploy --project thuraya-client-telling --config firebase.production-commission.json --only firestore:rules
```

No blanket deployment, Firebase Hosting deployment, or existing function update
is required. The callable is Gen2/us-central1. Its future new-service transport
needs separately approved allUsers -> roles/run.invoker on that service ONLY;
business authorization remains inside the callable. No IAM changes are part
of staging remediation. The existing staging service already has its binding.

Firebase CLI also performs generic Gen2 event-service preparation. For this
HTTPS-only callable, Pub/Sub/Eventarc service-identity creation is not required.
The staging certification guard omitted that unrelated setup only after a
GET verified the existing ACTIVE callable had no event trigger, and blocked
all IAM/API-enablement mutations. Future production tooling must similarly
abort any IAM change beyond the separately authorized new-service invoker
binding; a functions-only filter alone is not an IAM boundary.

Node.js 20 and all financial/calculation modules remain unchanged. Runtime
maintenance is separate and required before the published 2026-10-30
decommission deadline; recheck provider policy before a future deployment.
