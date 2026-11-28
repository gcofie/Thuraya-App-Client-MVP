# Hubtel Network Diagnostics

## Boundary

Production-capable feature based on `303cb9011df29665e4eaa74c25b4f62550c998dd`.
No Quick Edit, financial core, default Functions, Rules, Client or Store changes.
Refund R0 is excluded from the feature branch and retained only by the separate
staging integration. Certification results and candidate SHAs accompany this commit.

## Execution and authorization

The additive Integrations tab is separate from System Admin because Managers must
not acquire the unrelated System Admin controls. It uses existing Staff navigation
without changing `app.js`. Visibility requires the backend capability response.
Every run independently rechecks `integrations.hubtelDiagnostics.view` against the
active Staff `Users` profile. Exact Admin, System Admin and Manager roles resolve
that capability at the identity boundary; no other capability is granted.
Firebase verifies the callable token. The handler additionally binds issuer,
audience, project and optional profile UID. Claims alone cannot override the Staff
profile. Only role/active-status/UID metadata is projected; no business collection
or customer profile is accessed. Client-supplied targets and configuration fail.

`hubtelNetworkDiagnostics` is a dedicated Firebase v2 callable, us-central1,
Node 22, codebase `hubtel-diagnostics`. Deploy only with
`firebase.hubtel-diagnostics.json` and an explicit staging project/function filter.
Existing default-codebase functions, including Refund R0, must not be deployed.
The separate codebase follows [Firebase's isolation contract](https://firebase.google.com/docs/functions/organize-functions).
Pinned dependencies and lockfile use [Google's pnpm buildpack support](https://docs.cloud.google.com/docs/buildpacks/nodejs).

## Network policy

Only three Hubtel destinations are accepted: `payproxyapi.hubtel.com`,
`api-txnstatus.hubtel.com`, `refund-api.hubtel.com`. HTTPS probes are `HEAD /`,
no credentials, cookies, query parameters, transaction references or redirects.
Any valid HTTP response proves HTTPS reachability, including 401/403/404/405;
its application status remains separate. This never validates API entitlement.

DNS A/AAAA results are fresh, bounded and filtered against private/reserved
addresses. Each service probes its first public IPv4 (or IPv6 fallback), displayed
as the probed destination. Other DNS answers are informational, not independently
certified. Socket and HTTPS connections use that pinned address, the original SNI
hostname, trusted CA verification and TLS 1.2 minimum. Certificate hostname and
expiry checks are never bypassed. Only expiry/protocol/validity are exposed.
See [Node TLS validation](https://nodejs.org/api/tls.html).

The neutral [ipify](https://www.ipify.org/) IPv4 echo request is `GET /` to
`api.ipify.org`, from the same diagnostic function and transport. Echo is limited
to 1024 bytes, HTTPS headers to 8192 bytes, DNS answers to 64. Every probe stage
has a 3500ms absolute timeout and closes/cancels resources, with zero retries.
Three services execute concurrently, with a maximum 30-second callable lifetime.
One run at a time per instance, ten-second per-user cooldown, one maximum
instance. This is bounded operational access, not a durable global rate limiter.

## Truth labels

The echo IP is the expected source for this diagnostic backend, NOT proof of the
source Hubtel observes, a permanently static IP or the egress of any other payment
function. Hubtel must confirm its observed source and allowlisting. No UI action
can change `NOT_CONFIRMED`. The dedicated backend has no payment transport and
reports `hubtelNetworkEnabled=false`, explicitly scoped to this backend. It does
not attest the deployment configuration of unrelated legacy functions.

Three equal successful observations mean `OBSERVED_STABLE_ACROSS_TEST_RUNS`;
different observations mean `DYNAMIC_EGRESS`; fewer than three successful echoes
mean `INSUFFICIENT_OBSERVATIONS`. No static outbound infrastructure is created.
An echo failure produces no expected IP; it does not fabricate a successful result.

## Audit and safety

Cloud Logging receives `HUBTEL_DIAGNOSTIC_RUN`, actor UID, environment, server
timestamp, correlation ID and status-only summary. No raw response, certificates,
email, secrets or business data. No Firestore write occurs. A failed audit prevents
a successful callable response. The frontend uses text nodes, not HTML interpolation,
clears results on sign-out and discards responses belonging to stale auth sessions.

Local tests mock all network operations. Browser certification uses real layout at
390/662/768/1280 with all outbound routes denied. Full historic Staff tests remain
required. The only legacy parity adaptation removes exactly two known, positioned
HTML asset includes before the existing complete source-fingerprint assertions.
Unknown mutations remain rejected; Quick Edit `app.js` stays byte-exact.

## Staging certification gates

Feature tests and full Staff regression must pass before committing. Integration
must preserve exact Quick Edit and Refund R0 assets, pass all additional R0 tests,
and be deployed only to an isolated staging preview. Record the backend source
hash, preview source/asset comparison, MGR10 capability verification, three diagnostic
runs and unchanged existing function source hashes. No normal-staging publication,
production deployment, real payment, status lookup or refund is authorized.
