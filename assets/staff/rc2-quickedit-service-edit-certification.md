# RC2 Quick Edit Service-Edit Local Certification

## Source and authorization
- Repository: G:\My Drive\Consultation\Thuraya-App.
- Branch: codex/rc2-quickedit-service-edit-guard-repair.
- Exact production parent: 31b4b8c1f9243e8a43aa4a4a50a4869b0d4df8bd.
- HEAD/main/origin/main/remote main matched that parent and the tracked worktree was clean before edits. Branch creation followed successful pre-fix reproduction.
- Production binding: https://thuraya-app.netlify.app; Firebase thuraya-client-telling. Read-only public asset comparison found index.html and all 29 referenced local runtime assets identical to the parent; index.html/app.js/firebase-config.js were rechecked before editing.
- Authorization is LOCAL Staff-only repair, not staging or production promotion.
- Exact historical screenshot record identified: NO. The regression fixture is synthetic and contains no customer PII.

## Reproduction and root cause
Classification: A, SERVICE EDIT INCORRECTLY COUPLED TO AMBIGUOUS PAYMENT METADATA.

The actual production-parent Quick Edit V4 IIFE was exercised in Edge/Playwright with the actual canonical financial helpers and in-memory Firestore/menu/schedule fixtures. External browser requests were blocked. The synthetic current-format Client Individual record was Scheduled, client-booking/myself/booker, with pending_or_paid_by_booker, no linked job, no settlement or adjustment evidence, and coherent canonical service/tax snapshots.

| Pre-fix operation | Draft duration | Draft gross | Save result |
| --- | ---: | ---: | --- |
| Remove third service | 90 min | 450.00 | Financial review required; zero writes |
| Add replacement service | 185 min | 770.00 | Same guard; zero writes |
| Replace polish service | 170 min | 670.00 | Same guard; zero writes |
| No-change save | 155 min | 650.00 | Same guard; zero writes |

Removal leaves exactly Gel Couture Polish Finish (Upgrade) and The Refinement Indulgence, matching the reported draft fingerprint. This is NOT proof of historical record identity. The fixture tax rate is explicitly synthetic, not a new business tax policy.

Guard timing: D, every Save, including no-change Save. Opening checks lifecycle but does not invoke the financial classifier. Add/remove/quantity handlers recalculate the draft; they do not create payment ambiguity. Save calls the financial context before canonical serialization. The parent's blanket pending_or_paid_by_booker rejection blocks the service-edit workflow irrespective of the coherent unpaid pre-treatment evidence. This label is not globally reclassified as unpaid.

## Exact runtime path
All runtime changes are inside app.js Quick Edit V4.
- openQuickEditV4 (line 26510): loads Appointment, applies existing open lifecycle guard and initializes items.
- buildInitialItems (26280): persisted service snapshot/compatibility fallback.
- addSelectedService (26345): canonical searchable menu selection.
- thQeV4RemoveItem (26374), thQeV4ChangeQty (26382): existing service mutation handlers.
- syncTotalsFromItems (26413): draft duration, amount and manual fallback text.
- saveEdit (26542): existing schedule gate, new fresh linked-job reads, fresh Appointment comparison, canonical builder and existing Appointment merge.
- quickEditV4BillingIdentity (25755): Individual versus canonical Group/member/allocation identity.
- quickEditV4FinancialContext (25782): eligibility, persisted financial evidence and tax context.
- quickEditV4PaymentEvidence (25905): separate paid/protected/lifecycle evidence inspection.
- quickEditV4ReadLinkedEvidence (25930): exact linked Active_Jobs reads, never writes.
- buildQuickEditV4CanonicalFinancials (25964): certified financial builder and payload serialization. Only its evidence parameter plumbing changed.

## Narrow eligibility contract
Existing explicit-unpaid paths and all original adjustment/tax restrictions remain. The Client legacy payer label is admitted only when ALL of the following hold:
- Canonical Individual identity; Scheduled editable lifecycle; no contradictory service lifecycle/cancellation/No Show evidence.
- Exact known Client provenance: source=client-booking, bookingFor=myself or someone_else, paymentResponsibility=booker.
- Fresh server reads prove no linked Active_Job through deterministic ID, explicit activeJobId/jobId/linkedJobId, or known sourceAppointmentId/appointmentId/appointmentDocId/appointmentRef/bookingId string aliases.
- Missing permissions, failed reads, cache-only evidence or malformed explicit references fail closed.
- No paid/closed/receipt/checkout evidence, payment method, split, Gift, complimentary, discount/deposit or other protected raw financial metadata. The existing recursive guard remains active.
- Persisted canonical line IDs, quantities, booking prices/durations, per-line tax/amounts and aliases are coherent under the existing canonical builder and persisted tax evidence.
- Required bookedPrice/serviceSubtotal/taxTotal/grandTotal/amountDue/payableShare/memberServiceTotal match the rebuilt persisted snapshot. Optional compatibility totals also agree when present. Original historical originalGrandTotal is not mistaken for the current edited total.
- A final fresh Appointment read equals the opened record. The proposed edited draft is NEVER used as evidence that the original booking was safe.

Outcomes remain distinct: PAID_CONFIRMED gives the payment/settlement reviewed-edit message; PAYMENT_REVIEW_REQUIRED protects incomplete/contradictory evidence; GROUP_OR_ALLOCATED protects canonical Group billing; LIFECYCLE_BLOCKED protects progressed/cancelled/No Show records. Complimentary-only evidence is not described as customer cash payment. Gift/split/complimentary workflows are not changed or implemented here.

## Post-fix functional results
- Remove, add, replace, quantity change and no-change Save persist and reopen successfully for the qualifying fixture.
- Remove produces the two screenshot-like services, 90 minutes and 450.00 gross.
- Sequential remove/save/reopen, add/save/reopen, replace/save/reopen yields refinement + replacement + third service, 170 minutes and 670.00 gross, with no stale removed item or duplicate line.
- Existing canonical builder recalculates price, quantity, durationAtBooking, tax, serviceSubtotal, taxableSubtotal, grandTotal, finalTotal and compatibility values. Manual fallback text is rebuilt by the unchanged service handler.
- No payment state, method, receipt or settlement field is written. No Active_Job is written.
- Paid, ambiguous, Group, allocated, Cancelled, No Show, Gift, settled/unsettled split and complimentary cases stay protected.

## Evidence and limits
- Focused browser/financial/protected-source run: 199/199 PASS, zero failures/skips/TODOs.
- Full Staff root regression: 1194/1194 PASS, 1123 retained + 71 added, zero failures/skips/TODOs. New coverage is 66 actual-browser service-edit cases + 5 strict source-parity tests.
- Existing Quick Edit: 147/147; scheduling: 51/51 (20 policy, 23 Staff bindings, 8 browser); protected scheduling/source boundaries: 6/6.
- Checkout security: 99/99; Gift: 173/173; No Show: 165/165; Commission: 406/406; Sales/reporting: 3/3. These named categories overlap where a boundary test covers multiple systems and must not be summed as additional tests.
- Issues 1-3 are covered by the retained 147 Quick Edit tests; Issue 4: 51/51; Issue 5: 85/85; Expected Today: 16/16; Attendance: 23/23.
- Root JavaScript syntax: 88/88 files (28 JS + 60 CJS) PASS. This repository has no root typecheck/lint/format task; no new toolchain was installed.
- git diff --check: PASS. Final remote main, local main and origin/main remained the exact production parent before the local commit.
- Additional backend entrypoints: 3/3 PASS; canonical financial parity 10/10; complimentary migration 8/8.
- Functional save/reopen flows exercised at widths 390/662/768/1280.
- Existing narrow-screen item rows overlap at 390px. Candidate and parent have identical geometry, including when local production styles are loaded. This is a pre-existing layout limitation, NOT a new visual-responsive certification or a change included in this guard repair.
- Exact source parity reconstructs the production parent by removing only a SHA-256-bound eligibility section and six explicit read/argument changes, then compares every remaining byte. Tests reject unauthorized helper, write and freshness alterations. Earlier milestone assertions remain intact through this reviewed compatibility layer.
- Persistence is simulated in memory, not live Firestore. Fresh read failures are tested; authenticated staging must confirm Active_Jobs query and server-read permissions.
- Existing read-before-write architecture remains non-atomic. Concurrent payment/job changes after the final reads remain an existing architectural risk; no distributed transaction or Rules/backend redesign is claimed.
- No claim is made that all historical Client records are repairable or that the screenshot's exact appointment is now eligible. Missing/incoherent history remains review-required.

## Local execution
Set NODE_PATH to an installed Playwright runtime and run node --test --test-reporter=tap against all root *.test.cjs files. The service-edit tests compare the certified parent through git show and use Edge by default. QUICK_EDIT_SCREENSHOTS may name a temporary artifact directory.

For an isolated manual preview: node quick-edit-service-edit-preview.cjs. It listens on 127.0.0.1:4332 (or an explicitly supplied PORT), exposes only synthetic fixture scripts, disables network connections with CSP, and has no Firebase SDK or credentials. Reload resets synthetic persistence. Remove/save/reopen was verified with zero external requests.

## Exact file scope
Runtime: app.js only.

Retained test harnesses: quick-edit-v4-financial.test.cjs, scheduling-protected-boundary.test.cjs, scheduling-source-parity.cjs.

Added: quick-edit-service-edit-fixture.cjs, quick-edit-service-edit.test.cjs, quick-edit-service-edit-parity.cjs, quick-edit-service-edit-parity.test.cjs, quick-edit-service-edit-preview.cjs, RC2-QUICKEDIT-SERVICE-EDIT-CERTIFICATION.md.

## Safety and release gate
Client changes 0; Store changes 0; Refund R0 changes 0; production writes 0; pushes 0; deployments 0. No protected runtime, canonical core, Functions or Rules changes. Store remains clean at f675d9ac1109f7f1200aba06cbde84986ec19635. Client tracked files remain clean; its existing untracked ZIP was not touched.

Quick Edit service-edit repair: PASS. Local functional certification: PASS. Ready for separately authorized staging verification, not production promotion.

No staging or production certification is implied by local results. Next permitted gate is separately authorized authenticated staging verification of the exact candidate, including fresh linked-job read permissions and add/remove/replace persistence. No payment guard may be bypassed if those reads fail.
