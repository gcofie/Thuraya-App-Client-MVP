# No Show Lifecycle

## Scope

Group members are linked Appointments, not a writable parent booking. `member`
changes only the selected Appointment. `group-date` includes every subgroup on
the selected Appointment's exact `dateString`; all other dates are displayed
but skipped, even when already in the past. A missing groupId is not inferred
from names or IDs. Groups above 50 members require controlled review.

Eligible group members must be nonarchived, due by the fresh Africa/Accra date,
Scheduled and genuinely unserved. Arrival, start, terminal, receipt, payment,
Gift, voucher, deposit and other financial evidence block No Show. Any existing
linked Active Job blocks the group-member path pending review. Ambiguous
same-group job linkage fails closed. No group action creates or alters a job.

The existing individual evaluator is generated directly from app.js. Its
certified exact unstarted-job reconciliation remains available through the
trusted service. No financial calculations are copied or changed.

## Authority And Atomicity

`noShowService` requires Firebase authentication plus an independent
`NO_SHOW_AUTHORIZATION_JSON` roster plus a current matching active Users record.
The version-1 configuration has projectId and operators containing uid, email,
enabled and roles. Supported roles are FOH, Manager and System Admin. A mutable
Users role alone cannot authorize an account; Gift/Commission capabilities and
Auth custom claims are not used. Missing or malformed configuration fails closed.
No production roster is supplied or authorized by this implementation.

Preview performs only reads and returns a fingerprint bound to actor, project,
scope, fresh business date and exact Appointment/job update versions. Commit
re-reads authorization, the complete group and job queries inside a Firestore
transaction. Any changed version or membership aborts the stale preview. The
transaction changes only eligible lifecycle fields and writes one private
No_Show_Commands idempotency record. It cannot silently overwrite a concurrent
check-in or payment. The browser retains the confirmed request ID for recovery
after a timeout or reload. A retry returns the original result, not a new effect.

The existing Reinstate/Reschedule buttons use a trusted follow-up command because
rules also protect leaving No Show. Only an Appointment-only, nonfinancial No
Show may reopen; linked service evidence requires review. No job is erased.

## Presentation And Reporting

The impact dialog identifies each member, date, subgroup, service, status and
skip reason. There is no stored parent status. Derived summaries preserve mixed
and partial-completion states, including stronger linked paid-job evidence.
No Shows remain visible in operational history, are omitted from Expected Today,
and are appended to operational reports only when no job already represents the
Appointment. Intelligence No Show counts deduplicate exact sourceAppointmentId
and exclude quoted No Show amounts from its display-only revenue totals.
Upcoming group KPI counts distinct group identifiers, not members.

## Rules And Rollout

`no-show-rules-build.cjs` generates dedicated profiles from the existing Gift
profiles. No Show entry/exit, audit markers and private command receipts become
server-owned. Other lifecycle writes retain the baseline rules. This is not a
general repair of permissive historical Staff/booking access.

Staging uses firebase.staging-noshow.json. Deploy only functions:noShowService,
configure synthetic staging operators, certify actual Staff App compatibility,
then deploy only the staging No Show rules profile and repeat denial/workflow
checks. The production profile retains the production Approval baseline.

Future production promotion requires separate owner authorization: approve the
exact operator roster, deploy the callable and configure its project bootstrap,
certify readiness, publish Staff App, verify trusted paths, then apply the
Gift-preserving No Show rules LAST. No migration is required. Never deploy the
staging profile to production. No production deployment is part of this task.

## Verification

Run no-show-build.cjs --check and no-show-rules-build.cjs --check. Focused local
tests cover eligibility, stale-state aborts, retries, authorization, financial
invariants, source parity and reporting. no-show-security-cases.cjs extends the
existing Gift security simulations. Authenticated staging certification uses
manifest-tracked synthetic records and removes all fixtures/configuration after
testing, retaining legitimate staging data.
