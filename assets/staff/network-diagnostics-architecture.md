# Network Diagnostics Architecture

Production source parent: `48a614bd370956420a145792f57da2f6a7d6bced`.
This candidate is staging-first; production and normal staging publication are not authorized.

## Boundaries

The provider-neutral `network-engine.js` uses server-side DNS, TCP 443, strict TLS and bounded HTTPS. `profiles.js` contains the three unchanged Hubtel hostnames. `network.js` preserves the certified legacy adapter/export. The existing Firebase v2 callable/service remains `hubtelNetworkDiagnostics`; no new service or IAM role is required. No application financial source, business collection or Store/Client code is changed.

Firebase Authentication and the existing projected Staff Users identity lookup precede all operations. The existing exact Manager/Admin/System Admin role mapping now resolves `integrations.networkDiagnostics.view` and `.run`, plus the compatibility `integrations.hubtelDiagnostics.view`. Probe logic checks capabilities. No manageTargets, payment, refund or configuration grant exists. Client-supplied roles/capabilities are never authority.

## Commands

`capabilities` returns read/run grants and presets without network activity. `runTarget` requires one explicit PREDEFINED, HOSTNAME, IP or URL target. `runAll` (and legacy `run`) runs exactly the three Hubtel presets sequentially. `compare` requires an explicit URL target and runs the presets followed by that one target, sequentially. Custom input never joins Run All implicitly.

HEAD and GET discard response bodies. EMPTY_POST is available only for a custom HTTPS URL, requires explicit one-use UI consent and server `confirmEmptyPost=true`, sends Content-Length 0 and calls `end()` without data. The tool does not accept headers, cookies, certificates, credentials or arbitrary bodies. No redirect is followed. Known Hubtel hosts are restricted to preset root HEAD requests even in custom mode; transactional Hubtel paths/methods are rejected.

## SSRF Policy

HTTPS 443 only; no arbitrary ports or scanning. URLs reject credentials, queries, fragments, controls and unsafe schemes. Local/internal/metadata names and non-public/special-use address ranges are denied. IPv6 permits a deliberately conservative public-unicast subset, excluding special-use 2001/2002 prefixes as well as mapped, NAT64, private, loopback and link-local ranges. Some legitimate public targets may therefore be rejected safely.

All A and AAAA results must be public, including unselected answers. Partial DNS failure fails closed. Each connection is preceded by re-resolution; the selected address must remain in the answer set. Connections pin that address and validate the actual socket destination. TLS validates the CA chain, logical hostname and expiry; no ignore-TLS option exists. Redirect locations are sanitized and DNS-validated for reporting but never followed, so no redirected request can reach a private destination.

These choices follow the [OWASP SSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html) on validating all DNS answers and disabling redirect following, using [Node HTTPS](https://nodejs.org/api/https.html) and [TLS](https://nodejs.org/api/tls.html) validation controls.

## Evidence and Bounds

One neutral public-IP echo per command represents the backend observation for all its sequential targets. It is not proof of the source address seen by any remote provider, nor static egress. Results distinguish DNS, TCP, TLS and HTTPS network reachability from HTTP application status. HTTP 4xx/5xx can prove network reachability, not application authorization. Results include selected/connected destination, UTC, latency, environment, backend path and correlation ID.

One run per process at a time, ten-second actor cooldown, bounded DNS/socket timeouts and a 24-second overall probe budget constrain load within the existing 30-second callable. No automatic request retries. An uncertain POST outcome must not be repeated without owner review.

General results/audits replace URL paths with a truncated SHA-256 identifier and reject query/fragment secrets. Raw response bodies are not logged. `NETWORK_DIAGNOSTIC_RUN` and, only when a POST is handed to the transport, `NETWORK_EGRESS_CONFIRMATION_POST_SENT` contain safe technical evidence. `sentAt` records the request finish UTC event, not remote-provider receipt acknowledgement. Audits use Cloud Logging, not business writes.

## Provider Confirmation and Future Profiles

For this certification, the owner-provided Webhook.site destination is entered only in the authorized custom URL control. The comparison's fourth leg is the ONE authorized empty POST. Do not separately repeat it, retrieve its response body or read the inbox. Record sent UTC, HTTP status, latency, correlation and neutral echo IP; provider confirmation remains PENDING HUBTEL.

Future GRA profiles can be added as reviewed preset data after the separate M4.4A authorization. No GRA target, credential, fiscal request or speculative transaction support is implemented here.
