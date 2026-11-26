# Network Diagnostics Certification

Status: LOCAL CERTIFICATION IN PROGRESS. No live certification or production readiness claimed by this source document.

Parent: `48a614bd370956420a145792f57da2f6a7d6bced`.
Branch: `codex/rc2-generic-network-diagnostics`.
Deployment scope: one isolated Staff staging preview and the existing staging diagnostic callable only. Production and normal staging remain protected. Refund R0 remains staging-only.

Retained baseline: 1348 production regression cases. New suites cover provider-neutral target modes, method/body restrictions, sequential batch selection, strict SSRF/DNS rebinding/destination checks, TLS, safe HTTP classification, capabilities, redaction and responsive UI interaction. Exact file manifest and diagnostic runtime hashes protect scope. Packaging dependency pins and protobufjs-only script approval remain unchanged.

The final local regression report, source candidate SHA, artifact hashes, staging inventories, live results and mutation ledger are recorded in the external certification evidence beside the worktrees. This avoids changing the certified commit after deployment. No PASS claim is valid without those completed records.

## Live Gate

After local PASS: deploy exact source to thuraya-staging, compare pre/post function inventory and uploaded source, create one isolated frontend preview preserving the certified staging-only features, verify anonymous denial, and request MGR10 sign-in. Run All once, then Compare with the owner-specified URL using EMPTY POST once. Do not repeat the POST or inspect the provider inbox. Record pending provider confirmation, never inferred allowlisting or static egress.

## Safety

No checkout initiation, transactional status lookup, refund, payment, GRA call, business-data write, production publication or unrelated IAM/source mutation is authorized. Synthetic local tests mock network transports; packaging smoke denies outbound networking. Staff Users projected authentication reads and technical diagnostic log events are the only data access paths added/retained.
