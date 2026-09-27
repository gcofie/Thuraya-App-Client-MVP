# RC2 Client Effective-Schedule Precedence Certification

## Scope and verified parent
- Branch: codex/rc2-client-effective-schedule-precedence.
- Exact parent: 0ce2f4822fa9a74d22140a989340d8859a8bb99a.
- Repository: G:/My Drive/Consultation/Thuraya-App Client Booking/Thuraya-App Client Booking.
- Original branch: codex/client-phone-prod-prep; tracked source clean before edits.
- origin/main and remote main matched the parent and remain unchanged.
- Local main was older (e5a1564f7fb2c00d002ce7cdf7dc503e32ea915b) and was deliberately NOT moved.
- Existing untracked "Clinet Stage Repo before Codex.zip" is not part of this candidate and remains untouched.
- Netlify project: youbookingthuraya.
- Deployed URL: https://book.thurayanailbar.com.
- Published deploy: 6a94e668dae58f0008e194b9.
- Published source: 0ce2f4822fa9a74d22140a989340d8859a8bb99a, main.
- Public deployed app.js, availability.js, group-booking.js and firebase-config.js matched exact Git bytes (4/4).
- This host binds Firebase thuraya-client-telling. No Firebase or hosting configuration was edited.

## Proven defect
Appointment AFK6sbf4gcs74jf68lvb, 2026-09-27 15:00, Matilda.HT, came from client-booking. The newest applicable September schedule marks Sunday OFF; a retained July schedule allowed Sunday 08:00-23:00.
The old resolver searched older effective schedules for a weekday match. This revived obsolete Sunday availability.
September 27 is Sunday in Africa/Accra. The September 23 schedule already excluded Sunday before the booking; the later September 27 save is not needed to explain the failure.

## Narrow repair
- Pure schedule-policy.js chooses newest effectiveFrom <= booking date before weekday evaluation.
- ISO and DD/MM/YYYY calendar dates are validated; no local/UTC weekday shift.
- Explicit all-off schedules, missing/invalid schedule evidence and failed reads cannot create availability.
- Explicit and Any Technician use the same resolver; older Sunday records cannot be revived.
- Before ordinary or group booking creation, server-source reads revalidate technician identity, schedule, hours, calendar blocks, approved leave, Appointments and Active_Jobs conflicts.
- A stale selection or unavailable authoritative read blocks before batch creation/commit.
- The late HF28 override previously returned no conflict unconditionally. It now invokes the same fail-closed validation.
- Internal group technician/time overlap is rejected.
- Existing financial calculations, payer metadata, service snapshots, booking payload fields and payment behavior are unchanged.
- No Client off-day override was added.

## Local certification
- 56/56 tests, zero skips.
- Shared schedule policy: 20.
- Client actual-binding resolver/validation/confirmation tests: 27.
- Protected-source/payload checks: 5.
- Browser actual slot UI: 4 (390/662/768/1280), both explicit and Any Technician, plus working-day positive control.
- Valid synthetic single/group booking paths retained; off-day/stale/read-failed/conflicting paths create zero synthetic writes.
- Browser runs use synthetic authority and block external requests. They do not open a production booking flow.
- All retained JavaScript syntax checks: 9/9, plus 5/5 CJS checks. git diff --check PASS.
- This deployed Client parent had no tracked executable automated test suite. These 56 tests are new; retained runtime/configuration parity and syntax cover the pre-existing source.
- schedule-policy.js and schedule-test-vectors.json are byte-identical after newline normalization to the independently committed Staff copies. No filesystem imports connect repositories.

## Limits and staging requirements
The existing app uses browser Firestore writes. Fresh validation is not a server transaction spanning all schedule/conflict queries, so a concurrent change after validation remains a future backend hardening concern.
Staging must verify the authenticated/guest permissions for fresh Users, schedule history, Appointments and Active_Jobs reads. Read failures intentionally stop booking; do not reintroduce a permissive fallback.
No production incident was repaired. No backend/Rules/auth/payment redesign is included.

## Exact file scope
Modified:
- app.js
- availability.js
- group-booking.js
- index.html

Created:
- schedule-policy.js
- schedule-policy.test.cjs
- schedule-test-vectors.json
- schedule-client-fixture.cjs
- schedule-client.test.cjs
- schedule-client-browser.test.cjs
- schedule-client-protected.test.cjs
- RC2-CLIENT-SCHEDULE-CERTIFICATION.md

## Safety
Production writes 0; pushes 0; deployments 0.
No Store or Refund R0 changes. No credentials, full customer contacts or tokens in fixtures.
One local candidate only; ready for separately authorized staging certification, not production publication.
