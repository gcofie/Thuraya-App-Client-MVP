# RC2 Scheduling and Quick Edit Local Certification

## Authorization and source binding
- Scope: local Staff appointment scheduling and Quick Edit repair only.
- Branch: codex/rc2-staff-offday-quickedit-integrity.
- Exact parent: aa918c5f2ea2aaec93515f3e8af5e90b3d2317cd.
- Staff local main, origin/main and remote main verified at that parent before edits; remote main reverified unchanged.
- Production Staff URL: https://thuraya-app.netlify.app; Firebase: thuraya-client-telling.
- Refund R0 is not in this parent. Its 98 tests explain the difference between the cited 1138 family total and this parent's 1040 root tests. R0 was not imported or modified.
- Commission RC1, Issues 4/5 and No Show CTA remain CLOSED.

## Read-only incident findings
Appointment AFK6sbf4gcs74jf68lvb was created by client-booking at 10:16:03 UTC for 2026-09-27 15:00, Matilda.HT, customer K.B. It was later cancelled by FOH at 12:56:06. No exact linked Active_Job was found by deterministic ID or sourceAppointmentId. A separate later Staff-created job for the same customer is not treated as this Appointment's linked job.

Authority: Staff_Schedules/stationchristiandior@gmail.com and its scheduleSegments/history.
- Effective 2026-09-27: Monday-Saturday, 10:00-21:00, Sunday OFF. Saved 10:52:11 UTC, after the incident creation.
- Effective 2026-09-23: also Monday-Saturday, 10:00-21:00, Sunday OFF; already applicable before creation.
- Retained 2026-07-12 Sunday-working segment: 08:00-23:00 (another retained Sunday segment has 08:00-09:00).
- 2026-09-27 resolves to Sunday in Africa/Accra. No timezone/day-shift explains the incident.
- The Client resolver incorrectly looked for a weekday match among historical effective schedules. The September OFF state could revive July's Sunday.
- Staff ordinary slot resolution already respected newest precedence, but group assignment and Quick Edit slots did not consult that same authority. Final appointment saves had no shared fresh schedule gate.

## Independent Quick Edit screenshot search
Exact screenshot record identified: NO. AFK6sbf4gcs74jf68lvb is NOT treated as the screenshot record: it has different services, 120 minutes and 588 gross, not the screenshot's 95 minutes / 370.

Read-only exact bookedService searches for "BIAB Overlay Removal and New Set" returned:
| Appointment | Customer initials | Date | Duration | Amount evidence |
| --- | --- | --- | --- | --- |
| AdEqysw52dO59smpRjjd | H.F. | 2026-06-23 | 95 | booked/gross 370; final/due 230 |
| FWCIokskO82r1lSmBuFl | S.C. | 2026-08-08 | 95 | gross/final 370; booked 308.33 |
| JMZIH9GCVmGe5uh6VsCi | E.B. | 2026-08-14 | 95 | gross/final 370; booked 308.33 |
| Q0Y0maCSnOiy1KD6xajQ | E.C. | 2026-06-16 | 95 | gross/final 370; booked 308.33 |
| ZuEfVqC9L2uEwCCiRseU | A.U. | 2026-08-12 | 95 | gross/final 370; booked 308.33 |
| dXCWZ5chwVSNfrXx5ElF | R.H.A. | 2026-06-13 | 120 | booked 370; gross 444; duration does not match |
| n4UD91auVJrnQnJ6G8Ti | H.F. | 2026-07-17 | 95 | gross/final 370; terminal lifecycle markers |
| oIczqUF4MQCaTg0lHo2G | H.A. | 2026-09-17 | 95 | booked/gross/final 370; complimentary/paid evidence |

These Appointment query rows carry individual compatibility identity (false group flag, empty group identity/role, size 1/index 0). Financially settled or terminal candidates are not deemed editable.

Active_Jobs exact-service candidates: G1eS2HcKs1wNKxVdwS2a, NLSO24DYxUgRWDkzabEj, PvHfWMHtazgQyq1tmrvz, WcysVuS3Kp0lOKsT52t8, oIczqUF4MQCaTg0lHo2G, vHfDNMSPfpH8jf9uUV8I. Exact links were not inferred from name/date alone. Some have zero duration or different amount aliases, so service-name overlap is not an exact screenshot match.

Exact sameDayEditNote = "Pretherapy soak off" returned no match in either collection. A failed save may not persist the note; absence is not proof that no relevant booking ever existed. The query results are not a full historical export. No unique candidate Appointment/Active_Job pair can be certified for the screenshot.

Independent generic evidence: the Client Individual payload carries paymentResponsibility=booker and paymentStatus=pending_or_paid_by_booker. The old quickEditV4FinancialContext treated any nonempty paymentResponsibility as group/allocated. This source condition is independently reproduced by fixtures; it does not require guessing which screenshot record to repair.

## Repair contract
- schedule-policy.js is a pure calendar contract, duplicated identically in Client, with identical local vectors and no cross-repository imports.
- Strict ISO or DD/MM/YYYY date parsing; weekday resolved with UTC calendar arithmetic appropriate to Accra.
- Select newest applicable effectiveFrom inclusively, then latest saved/source precedence. Evaluate that one schedule's weekday and complete duration window only.
- Explicit all-off schedules remain authoritative. Missing/malformed schedules and failed reads fail closed.
- Staff group/Any assignment and Quick Edit slots use the shared authority.
- Individual new booking, reschedule, both current group save paths and Quick Edit validate selected technician identity, fresh schedule, weekday, hours and duration before an Appointment write/batch.
- No silent off-day override added. No approved appointment off-day override was found.
- Quick Edit classifies booking identity separately from payer metadata. Booker/recipient/self alone are not group identity.
- Canonical group/member/allocation evidence remains blocked with a reviewed-edit message.
- Individual pending_or_paid_by_booker stays blocked with PAYMENT_REVIEW_REQUIRED, not a false group message.
- Unknown historical billing identity remains REVIEW_REQUIRED. Cancelled/terminal lifecycle protection is unchanged.
- Canonical financial builder, tax/quantity/price/duration serialization and stale-record comparison are preserved.
- No safe reviewed group financial editor was established. The message does not promise or route into a nonexistent editor.

## Scope limitations and staging gate
These are fresh pre-write checks in the existing browser/Firestore architecture, not a new server-side atomic reservation system. A schedule/conflict can theoretically change after the last read and before commit. No Rules/backend/payment redesign is included.
Protected Consultation/Attendance Active_Job reassignment commands (reassignTech / aa_reassign) are unchanged. This candidate covers appointment booking/rescheduling/Quick Edit, not a separately authorized live-job reassignment policy.
Offline fixtures prove read failure blocks, but authenticated staging must confirm Users, schedule history and conflict reads are permitted. An unavailable read must not be bypassed to restore booking.
The incident remains cancelled; no historical record or staff schedule was repaired. Exact screenshot-record diagnosis remains unresolved.

## Local test evidence
- Full Staff root regression: 1123/1123, zero skips (1040 retained + 83 added).
- Shared schedule vectors/parser: 20/20.
- Staff actual scheduling/save-boundary fixtures: 23/23.
- Staff browser actual bindings: 8/8, 390/662/768/1280; synthetic fixtures, external requests blocked.
- Quick Edit retained and new suites: 147/147 (Issue 1: 4; Issue 2: 21; Issue 3 financial suite: 122, including 26 new identity/safety cases).
- Checkout security: 99/99; Gift: 173/173; No Show: 165/165; Commission: 406/406; Sales/reporting: 3/3.
- Issue 4 retained suites: 51/51; Issue 5 retained suites: 85/85; Expected Today: 16/16.
- New explicit protected-boundary checks: 6/6. Existing No Show/Intelligence parity helper files remain unchanged.
- Historical whole-file parity assertions subtract only the exact SHA-256-bound reviewed host integration. Runtime outside the explicit sections and all protected backend/financial files are separately compared to the parent.
- Backend canonical/complimentary script suites: 3/3 entrypoints; canonical financial parity: 10/10 scenarios. Syntax: 49 JavaScript files and 55 root CJS modules. git diff --check PASS.
- Client independent local regression: 56/56, zero skips; shared policy and vector bytes match Staff.
- Browser evidence is local actual-binding component certification, not authenticated production/staging operation.

## Exact file scope
Runtime modified:
- app.js
- booking-hf85f-core.js
- booking-hf87-group.js
- index.html

Retained tests modified:
- expected-today-actions.test.cjs
- intelligence-client-period-label.test.cjs
- intelligence-client-value-responsive.test.cjs
- intelligence-ranking.test.cjs
- intelligence-refresh.test.cjs
- no-show-parity.test.cjs
- quick-edit-v4-duration.test.cjs
- quick-edit-v4-financial.test.cjs

Created:
- schedule-policy.js
- schedule-policy.test.cjs
- schedule-staff-browser.test.cjs
- schedule-staff-fixture.cjs
- schedule-staff.test.cjs
- schedule-test-vectors.json
- scheduling-protected-boundary.test.cjs
- scheduling-source-parity.cjs
- RC2-SCHEDULING-QUICKEDIT-CERTIFICATION.md

## Safety
Production writes 0; pushes 0; deployments 0.
Store files changed 0. Refund R0 files changed 0.
No Gift, Commission, Sales, Attendance, No Show, canonical-core, Functions or Rules runtime changes.
Ready for separately authorized staging certification only. No production promotion is implied.
