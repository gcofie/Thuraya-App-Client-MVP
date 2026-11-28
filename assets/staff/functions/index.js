"use strict";

const crypto = require("node:crypto");
const admin = require("firebase-admin");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { logger } = require("firebase-functions");
const { buildCanonicalFinancialShape } = require("./canonical-financial-core");
const { evidence: financialEvidence, resolveMode, allocateShares, transactionPolicy } = require("./gift-checkout-policy.generated");
const { createCommissionService } = require("./commission-v2-service");
const { createGiftService } = require("./gift-service");
const { createNoShowService } = require("./no-show-service");

admin.initializeApp();

const db = admin.firestore();
const noShowService = createNoShowService({ db, fieldValue: admin.firestore.FieldValue,
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId || "unconfigured" });
exports.noShowService = onCall({ region: "us-central1", timeoutSeconds: 120, maxInstances: 10 }, async request => {
  try { return await noShowService.handle(request); }
  catch (error) {
    const expected = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted", "resource-exhausted"]);
    if (expected.has(error.code)) throw new HttpsError(error.code, error.message);
    logger.error("No Show operation failed", { category: "internal" });
    throw new HttpsError("internal", "No Show could not be completed. Check the result and retry using the same request.");
  }
});
const giftService = createGiftService({ db, fieldValue: admin.firestore.FieldValue,
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId || "unconfigured" });
exports.giftCardService = onCall({ region: "us-central1", timeoutSeconds: 120, maxInstances: 10 }, async request => {
  try {
    return await giftService.handle(request);
  } catch (error) {
    if (error.giftCardState) throw new HttpsError("failed-precondition", error.message, { giftCardState: error.giftCardState });
    const expected = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted", "resource-exhausted"]);
    if (expected.has(error.code)) throw new HttpsError(error.code, error.message);
    // SDK errors can contain document paths (bearer codes). Never log error objects here.
    logger.error("Gift Card request failed", { category: "internal" });
    throw new HttpsError("internal", "Gift Card operation could not be completed. Retry using the same request.");
  }
});
const commissionService = createCommissionService({
  db,
  resolveLoginUid: uid => admin.auth().getUser(uid),
  projectId: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId || "unconfigured"
});
exports.commissionV2 = onCall({ region: "us-central1", timeoutSeconds: 120 }, async request => {
  try {
    return await commissionService.handle(request);
  } catch (error) {
    const codes = new Set(["unauthenticated", "permission-denied", "invalid-argument", "failed-precondition", "not-found", "already-exists", "aborted", "resource-exhausted"]);
    if (codes.has(error.code)) throw new HttpsError(error.code, error.message);
    if (error.code && /^[A-Z_]+$/.test(error.code)) throw new HttpsError("failed-precondition", error.message);
    logger.error("Commission V2 request failed", { code: error.code || "internal", message: error.message });
    throw new HttpsError("internal", "Commission request failed without applying a partial result.");
  }
});
const REGION = "us-central1";
const USERS_COLLECTION = "Users";
const PIN_SECRETS_COLLECTION = "Approval_Pin_Secrets";
const AUDIT_COLLECTION = "Approval_Audit";
const ACTIVE_JOBS_COLLECTION = "Active_Jobs";
const ARCHIVE_PREVIEW_ALLOWED_COLLECTIONS = ["Appointments", "Active_Jobs", "Attendance", "Clients"];
const ARCHIVE_PREVIEW_DATE_FIELDS = {
  Appointments: ["dateString", "date", "bookingDate", "appointmentDate"],
  Active_Jobs: ["dateString", "date", "bookingDate", "appointmentDate"],
  Attendance: ["date", "dateString", "attendanceDate"],
  Clients: ["createdAt", "updatedAt"]
};
const ARCHIVE_PREVIEW_ALLOWED_REASONS = new Set([
  "pre_go_live_test_data",
  "training_data",
  "duplicate_test_data",
  "bad_import",
  "other"
]);
const ARCHIVE_PREVIEW_DEFAULT_PAGE_SIZE = 100;
const ARCHIVE_PREVIEW_MAX_PAGE_SIZE = 250;
const ARCHIVE_PREVIEW_MAX_SCAN_PER_COLLECTION = 1000;
const ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT = 25;
const ARCHIVE_BATCHES_COLLECTION = "Archive_Batches";
const ARCHIVE_EXECUTION_APPROVALS_COLLECTION = "Archive_Execution_Approvals";
const ARCHIVE_PRE_GO_LIVE_POLICY_ID = "pre_go_live_test_data";
const ARCHIVE_PRE_GO_LIVE_POLICY_LABEL = "Pre-Go-Live Cleanup";
const ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE = "owner_approved_pre_go_live_cutoff";
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_PREVIEW_SCOPE = "production_pre_go_live_read_only_preview";
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE = "production_pre_go_live_archive";
const ARCHIVE_PRODUCTION_PROJECT_ID = "thuraya-client-telling";
const ARCHIVE_STAGING_PROJECT_ID = "thuraya-staging";
const ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS = ["Active_Jobs", "Appointments", "Attendance"];
const ARCHIVE_PRE_GO_LIVE_POLICY_SAMPLE_LIMIT = 20;
const ARCHIVE_PRE_GO_LIVE_COMMISSION_RATE = 0.10;
const ARCHIVE_PRE_GO_LIVE_MAX_TARGETS = 225;
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_MAX_TARGETS = 350;
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_CHUNK_SIZE = 100;
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_ROLLBACK_CONFIRMATION = "ROLLBACK PRODUCTION PRE-GO-LIVE ARCHIVE";
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVAL_PHRASE =
  "I APPROVE PRODUCTION PRE-GO-LIVE SOFT ARCHIVE EXECUTION FOR 290 RECORDS USING MANIFEST HASH fda7389d349440a12bb076fde70f935b1dc7bea0d03089ff5ea381c2b16fc2c6 GENERATED AT 2026-06-10T01:19:38.541Z. I ACCEPT THE NET REVENUE IMPACT OF GHC 25,702.00, PAID AMOUNT IMPACT OF GHC 29,367.80, COMMISSION IMPACT OF GHC 2,570.20, TAX ESTIMATE OF GHC 4,310.80, RECEIPT HISTORY IMPACT, CLIENT HISTORY IMPACT, AND LINKED APPOINTMENT FALLBACK IMPACT. SOFT ARCHIVE ONLY. DO NOT DELETE RECORDS.";
const ARCHIVE_PRE_GO_LIVE_POLICY_DECISION = "business_owner_confirmed_all_pre_go_live_operational_records_are_test_data";
const ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION = "Archive_Validation_Synthetic";
const ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE = "staging_synthetic_archive_validation";
const ARCHIVE_STAGING_SYNTHETIC_ARCHIVE_CONFIRMATION = "STAGING SYNTHETIC ARCHIVE VALIDATION";
const ARCHIVE_STAGING_SYNTHETIC_ROLLBACK_CONFIRMATION = "ROLLBACK STAGING SYNTHETIC ARCHIVE VALIDATION";
const ARCHIVE_ATTENDANCE_COLLECTION = "Attendance";
const ARCHIVE_ATTENDANCE_MAX_PILOT_RECORDS = 25;
const ARCHIVE_ATTENDANCE_PILOT_SCOPE = "attendance_only";
const ARCHIVE_ACTIVE_JOBS_PILOT_SOURCE = "archive_revenue_pilot";
const ARCHIVE_ACTIVE_JOBS_MAX_PILOT_RECORDS = 5;
const ARCHIVE_ACTIVE_JOBS_PILOT_SCOPE = "active_jobs_revenue_pilot";
const ARCHIVE_APPOINTMENTS_COLLECTION = "Appointments";
const ARCHIVE_REVIEW_APPROVALS_COLLECTION = "Archive_Review_Approvals";
const ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE = "real_active_job_paired_appointment_pilot";
const ARCHIVE_REAL_PAIR_ACTIVE_JOB_ID = "qxtBel2wXlLpgBcCPMr2";
const ARCHIVE_REAL_PAIR_APPOINTMENT_ID = "1eE5fOCPyONWgJgz1Zgo";
const ARCHIVE_REAL_PAIR_CLIENT_ID = "0308152018";
const ARCHIVE_REAL_PAIR_CONFIRMATION = "ARCHIVE 1 REAL ACTIVE JOB";
const ARCHIVE_REAL_PAIR_EXPECTED_DELTAS = {
  net: -180,
  tax: -36,
  paid: -216,
  commission: -18,
  completedJobs: -1
};
const ARCHIVE_GO_LIVE_CUTOFF_DATE = "2026-05-08";
const ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVED_PREVIEW = {
  environment: "production",
  projectId: ARCHIVE_PRODUCTION_PROJECT_ID,
  scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
  dateFrom: "2026-01-01",
  dateTo: "2026-05-07",
  manifestHash: "fda7389d349440a12bb076fde70f935b1dc7bea0d03089ff5ea381c2b16fc2c6",
  generatedAt: "2026-06-10T01:19:38.541Z",
  targetCount: 290,
  protectedPostGoLiveCount: 467,
  collectionCounts: {
    Active_Jobs: 56,
    Appointments: 148,
    Attendance: 86
  }
};
const ARCHIVE_STAGING_PRE_GO_LIVE_CERTIFIED_PREVIEW = {
  environment: "staging",
  projectId: ARCHIVE_STAGING_PROJECT_ID,
  scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
  dateFrom: "2026-01-01",
  dateTo: "2026-05-07",
  manifestHash: "48122a1a34d99a66cac2f3e907a92b4d5534fb6770e6438d8687214570602098",
  generatedAt: "",
  targetCount: 0,
  alreadyArchivedPreGoLiveCount: 208,
  protectedPostGoLiveCount: 287,
  collectionCounts: {
    Active_Jobs: 0,
    Appointments: 0,
    Attendance: 0
  },
  stagingArchiveBatchId: "ARCHIVE_20260609203725_f260b5a0",
  harnessMode: "post_archive_certification"
};
const ARCHIVE_PREVIEW_TERMINAL_STATUSES = new Set([
  "closed",
  "completed",
  "cancelled",
  "canceled",
  "no show",
  "no-show",
  "noshow"
]);
const HASH_VERSION = 1;
const HASH_ALGORITHM = "scrypt-sha256";

function envFlag(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  return ["1", "true", "yes", "on"].includes(String(raw).trim().toLowerCase());
}

function envNumber(name, fallback) {
  const n = Number.parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function approvalConfig() {
  return {
    enabled: envFlag("APPROVAL_PIN_ENABLED", false),
    pepper: String(process.env.APPROVAL_PIN_PEPPER || ""),
    pepperVersion: String(process.env.APPROVAL_PIN_PEPPER_VERSION || "v1"),
    maxFailedAttempts: envNumber("APPROVAL_PIN_MAX_FAILED_ATTEMPTS", 5),
    lockoutMinutes: envNumber("APPROVAL_PIN_LOCKOUT_MINUTES", 15)
  };
}

function normalizeEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function requireAuth(request) {
  const email = normalizeEmail(request.auth && request.auth.token && request.auth.token.email);
  if (!request.auth || !email) {
    throw new HttpsError("unauthenticated", "Sign in is required.");
  }
  return {
    uid: request.auth.uid || "",
    email,
    claims: request.auth.token || {}
  };
}

function normalizeRoles(userData, claims) {
  const firestoreRoles = Array.isArray(userData && userData.roles)
    ? userData.roles
    : (userData && userData.role ? [userData.role] : []);
  const claimRoles = Array.isArray(claims && claims.roles)
    ? claims.roles
    : (claims && claims.role ? [claims.role] : []);
  return [...firestoreRoles, ...claimRoles]
    .map(role => String(role || "").trim().toLowerCase())
    .filter(Boolean);
}

function hasManagerApprovalRole(roles) {
  return roles.some(role => role.includes("manager") || role.includes("admin"));
}

function hasSystemAdminRole(roles) {
  return roles.some(role => String(role || "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ") === "system admin");
}

async function loadStaffUser(email) {
  const snap = await db.collection(USERS_COLLECTION).doc(email).get();
  if (!snap.exists) return null;
  return {
    email,
    ref: snap.ref,
    data: snap.data() || {}
  };
}

async function requireStaffCaller(authInfo) {
  const staff = await loadStaffUser(authInfo.email);
  if (!staff) {
    throw new HttpsError("permission-denied", "Staff profile is required.");
  }
  const roles = normalizeRoles(staff.data, authInfo.claims);
  return { ...staff, roles };
}

async function requireManagerOrAdminCaller(authInfo) {
  const staff = await requireStaffCaller(authInfo);
  if (!hasManagerApprovalRole(staff.roles)) {
    throw new HttpsError("permission-denied", "Manager/Admin role is required.");
  }
  return staff;
}

async function requireSystemAdminCaller(authInfo) {
  const staff = await requireStaffCaller(authInfo);
  if (!hasSystemAdminRole(staff.roles)) {
    throw new HttpsError("permission-denied", "System Admin role is required.");
  }
  return staff;
}

function pinSecretRef(email) {
  return db.collection(PIN_SECRETS_COLLECTION).doc(email);
}

function assertFeatureEnabled() {
  const config = approvalConfig();
  if (!config.enabled) {
    throw new HttpsError("failed-precondition", "Approval PIN functions are disabled.");
  }
  if (!config.pepper || config.pepper.length < 32) {
    throw new HttpsError("failed-precondition", "Approval PIN pepper is not configured.");
  }
  return config;
}

function assertValidPin(pin) {
  const value = String(pin || "").trim();
  if (!/^\d{4,12}$/.test(value)) {
    throw new HttpsError("invalid-argument", "PIN must be 4 to 12 digits.");
  }
  return value;
}

function hashPin(pin, salt, pepper) {
  return crypto.scryptSync(`${pin}:${pepper}`, salt, 64, {
    N: 16384,
    r: 8,
    p: 1,
    maxmem: 64 * 1024 * 1024
  }).toString("hex");
}

function createPinHash(pin, pepper) {
  const salt = crypto.randomBytes(24).toString("hex");
  return {
    salt,
    hash: hashPin(pin, salt, pepper)
  };
}

function verifyPinHash(pin, secret, pepper) {
  const salt = String(secret && secret.pinSalt || "");
  const storedHash = String(secret && secret.pinHash || "");
  if (!salt || !storedHash) return false;
  const calculatedHash = hashPin(pin, salt, pepper);
  const stored = Buffer.from(storedHash, "hex");
  const calculated = Buffer.from(calculatedHash, "hex");
  if (stored.length !== calculated.length) return false;
  return crypto.timingSafeEqual(stored, calculated);
}

function lockUntilDate(secret) {
  const lockUntil = secret && secret.lockUntil;
  if (!lockUntil) return null;
  if (typeof lockUntil.toDate === "function") return lockUntil.toDate();
  const date = new Date(lockUntil);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isLocked(secret) {
  const until = lockUntilDate(secret);
  return !!until && until.getTime() > Date.now();
}

function auditPayload(data, authInfo, overrides) {
  return {
    approvalType: String(data.approvalType || "approval_pin").slice(0, 80),
    requestedBy: normalizeEmail(data.requestedBy) || authInfo.email,
    approvedBy: normalizeEmail(data.approverEmail || data.targetEmail || data.email),
    bookingId: String(data.bookingId || "").slice(0, 160),
    jobId: String(data.jobId || "").slice(0, 160),
    serviceId: String(data.serviceId || "").slice(0, 160),
    originalValue: data.originalValue ?? null,
    approvedValue: data.approvedValue ?? null,
    reason: String(data.reason || "").slice(0, 500),
    method: "manager_pin",
    status: "denied",
    attemptedAt: admin.firestore.FieldValue.serverTimestamp(),
    callerUid: authInfo.uid,
    callerEmail: authInfo.email,
    sessionId: String(data.sessionId || "").slice(0, 160),
    deviceId: String(data.deviceId || "").slice(0, 160),
    ...overrides
  };
}

async function writeAudit(data, authInfo, overrides) {
  const ref = db.collection(AUDIT_COLLECTION).doc();
  await ref.set(auditPayload(data || {}, authInfo, overrides || {}));
  return ref.id;
}

async function resolveTargetUser(targetEmail, caller, allowSelfManager) {
  const email = normalizeEmail(targetEmail) || caller.email;
  if (!email) {
    throw new HttpsError("invalid-argument", "Target email is required.");
  }
  if (email !== caller.email && !hasSystemAdminRole(caller.roles)) {
    throw new HttpsError("permission-denied", "Only System Admin can manage another staff member's approval PIN.");
  }
  if (email === caller.email && !allowSelfManager && !hasSystemAdminRole(caller.roles)) {
    throw new HttpsError("permission-denied", "System Admin role is required.");
  }
  const target = await loadStaffUser(email);
  if (!target) {
    throw new HttpsError("not-found", "Target staff profile was not found.");
  }
  const targetRoles = normalizeRoles(target.data, {});
  if (!hasManagerApprovalRole(targetRoles)) {
    throw new HttpsError("permission-denied", "Target staff member must be Manager/Admin.");
  }
  return { ...target, roles: targetRoles };
}

async function getAuthUserByEmail(email) {
  try {
    return await admin.auth().getUserByEmail(email);
  } catch (error) {
    logger.warn("Approval PIN auth lookup skipped", { email, code: error && error.code });
    return null;
  }
}

async function verifyApprovalPinAttempt(data, authInfo, config) {
  const approverEmail = normalizeEmail(data.approverEmail || data.email || data.targetEmail);
  const pin = assertValidPin(data.pin);

  if (!approverEmail) {
    throw new HttpsError("invalid-argument", "Approver email is required.");
  }

  const approver = await loadStaffUser(approverEmail);
  if (!approver) {
    const auditId = await writeAudit(data, authInfo, {
      approvedBy: approverEmail,
      status: "denied",
      failureReason: "approver_not_found"
    });
    return { approved: false, status: "denied", auditId };
  }

  const approverRoles = normalizeRoles(approver.data, {});
  const isApprover = hasManagerApprovalRole(approverRoles);
  const requestedType = String(data.approvalType || "complimentary").toLowerCase();
  const canApproveDiscount = requestedType.includes("discount") && approver.data.canApproveDiscounts === true;
  const canApproveComp = !requestedType.includes("discount") && approver.data.canApproveComplimentary === true;

  if (!isApprover || approver.data.approvalPinEnabled !== true || (!canApproveComp && !canApproveDiscount)) {
    const auditId = await writeAudit(data, authInfo, {
      approvedBy: approverEmail,
      status: "unauthorized",
      failureReason: "missing_role_or_permission"
    });
    return { approved: false, status: "unauthorized", auditId };
  }

  const secretRef = pinSecretRef(approverEmail);
  const secretSnap = await secretRef.get();
  if (!secretSnap.exists) {
    const auditId = await writeAudit(data, authInfo, {
      approvedBy: approverEmail,
      status: "denied",
      failureReason: "pin_not_set"
    });
    return { approved: false, status: "denied", auditId };
  }

  const secret = secretSnap.data() || {};
  if (secret.approvalPinEnabled !== true || isLocked(secret)) {
    const auditId = await writeAudit(data, authInfo, {
      approvedBy: approverEmail,
      status: "locked",
      failureReason: "locked_or_disabled",
      lockUntil: secret.lockUntil || null
    });
    return { approved: false, status: "locked", auditId };
  }

  const matched = verifyPinHash(pin, secret, config.pepper);
  const now = admin.firestore.FieldValue.serverTimestamp();

  if (!matched) {
    const failedCount = Number.parseInt(secret.failedAttemptCount || 0, 10) + 1;
    const locked = failedCount >= config.maxFailedAttempts;
    const lockUntil = locked
      ? admin.firestore.Timestamp.fromDate(new Date(Date.now() + config.lockoutMinutes * 60 * 1000))
      : null;

    await secretRef.set({
      failedAttemptCount: failedCount,
      lastFailedAt: now,
      lockUntil
    }, { merge: true });

    const auditId = await writeAudit(data, authInfo, {
      approvedBy: approverEmail,
      status: locked ? "locked" : "denied",
      failureReason: "pin_mismatch",
      lockUntil
    });

    return { approved: false, status: locked ? "locked" : "denied", auditId };
  }

  await secretRef.set({
    failedAttemptCount: 0,
    lockUntil: null,
    lastSuccessAt: now
  }, { merge: true });

  const auditId = await writeAudit(data, authInfo, {
    approvedBy: approverEmail,
    status: "approved",
    approvedAt: now
  });

  return {
    approved: true,
    status: "approved",
    approvedBy: approverEmail,
    approvalType: String(data.approvalType || "complimentary"),
    auditId
  };
}

function safeNumber(value, fallback = 0) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : fallback;
}

function serviceQty(item) {
  const q = Number.parseInt(item && (item.qty || item.quantity) || "1", 10);
  return Number.isFinite(q) && q > 0 ? q : 1;
}

function serviceName(item) {
  return String(item && (item.name || item.serviceName || item.label) || "Service").trim();
}

function serviceUnitPrice(item) {
  const explicit = item && (item.price ?? item.unitPrice ?? item.amount);
  if (explicit !== undefined && explicit !== null && explicit !== "") return safeNumber(explicit, 0);
  const qty = serviceQty(item);
  return safeNumber(item && item.lineTotal, 0) / qty;
}

function serviceLineTotal(item) {
  const qty = serviceQty(item);
  return safeNumber(item && item.lineTotal, serviceUnitPrice(item) * qty);
}

function isClosedJobStatus(status) {
  return ["closed", "cancelled", "canceled", "no show", "noshow"].includes(String(status || "").trim().toLowerCase());
}

function isComplimentaryBlockedJobStatus(status) {
  return ["completed", "closed", "cancelled", "canceled", "no show", "noshow"]
    .includes(String(status || "").trim().toLowerCase());
}

function isGroupJob(job) {
  return !!(
    job &&
    (
      job.groupId ||
      job.groupBookingId ||
      job.groupLeadId ||
      job.groupMemberId ||
      job.billingMode ||
      job.isGroupBooking === true ||
      job.isGroup === true ||
      String(job.bookingType || "").toLowerCase().includes("group")
    )
  );
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined && value !== null && value !== "");
}

function firstDefinedOrEmpty(...values) {
  const value = firstDefined(...values);
  return value === undefined ? "" : value;
}

function isPlainComplimentaryObject(value) {
  if (!value || typeof value !== "object") return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function firestoreSafeComplimentaryValue(value) {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map((entry) => {
      const safe = firestoreSafeComplimentaryValue(entry);
      return safe === undefined ? null : safe;
    });
  }
  if (isPlainComplimentaryObject(value)) {
    const safe = {};
    Object.keys(value).forEach((key) => {
      const nested = firestoreSafeComplimentaryValue(value[key]);
      if (nested !== undefined) safe[key] = nested;
    });
    return safe;
  }
  return value;
}

function firestoreSafeComplimentaryServiceLine(row) {
  const safe = firestoreSafeComplimentaryValue(row || {});
  return safe && typeof safe === "object" && !Array.isArray(safe) ? safe : {};
}

function cleanServiceLineRow(row) {
  const clean = {};
  Object.keys(row || {}).forEach((key) => {
    if (row[key] !== undefined) clean[key] = row[key];
  });
  return clean;
}

function normalizeComplimentaryServiceLine(row, sourceName, job) {
  if (!row || typeof row !== "object" || Array.isArray(row)) {
    throw new HttpsError("failed-precondition", "Stored service financial evidence is invalid.");
  }
  const clean = cleanServiceLineRow(row);
  const moneyKeys = ["lineTotal", "payableLineTotal", "total", "totalGHC", "amount",
    "unitPriceAtBooking", "originalUnitPrice", "unitPrice", "price", "lineSubtotal", "taxAmount",
    "originalLineTotal", "originalTaxAmount", "complimentaryValue", "waivedAmount"];
  if (moneyKeys.some((key) => clean[key] !== undefined && clean[key] !== null && clean[key] !== "" &&
      (financialEvidence.amount(clean[key]) === null || !Number.isSafeInteger(Math.round(Number(clean[key]) * 100))))) {
    throw new HttpsError("failed-precondition", "Stored service financial evidence is invalid.");
  }
  const quantities = [clean.qty, clean.quantity].filter((value) => value !== undefined && value !== null && value !== "");
  const qty = quantities.length ? financialEvidence.amount(quantities[0]) : 1;
  if (!Number.isSafeInteger(qty) || qty < 1 || quantities.some((value) => financialEvidence.amount(value) !== qty)) {
    throw new HttpsError("failed-precondition", "Stored service quantity is invalid.");
  }
  const name = String(firstDefined(
    clean.serviceName,
    clean.name,
    clean.label,
    clean.bookedService,
    clean.type,
    "Service"
  )).trim() || "Service";
  const rawLineTotal = firstDefined(
    clean.lineTotal,
    clean.payableLineTotal,
    clean.total,
    clean.totalGHC,
    clean.amount
  );
  const rawUnitPrice = firstDefined(
    clean.unitPriceAtBooking,
    clean.originalUnitPrice,
    clean.unitPrice,
    clean.price,
    clean.amount
  );
  if (rawUnitPrice === undefined && rawLineTotal === undefined) {
    throw new HttpsError("failed-precondition", "Stored service amount is unavailable.");
  }
  const unitPrice = rawUnitPrice !== undefined
    ? financialEvidence.amount(rawUnitPrice)
    : financialEvidence.amount(rawLineTotal) / qty;
  const lineTotal = rawLineTotal !== undefined
    ? financialEvidence.amount(rawLineTotal)
    : unitPrice * qty;
  if (!Number.isSafeInteger(Math.round(lineTotal * 100))) {
    throw new HttpsError("failed-precondition", "Stored service amount is invalid.");
  }
  const duration = Number.parseInt(firstDefined(
    clean.durationAtBooking,
    clean.duration,
    clean.dur,
    clean.bookedDuration,
    0
  ), 10) || 0;
  const department = firstDefinedOrEmpty(clean.department, clean.dept, clean.therapyType, clean.category);
  const priceMode = String(firstDefinedOrEmpty(clean.priceMode, clean.pricingMode, job && job.taxPricingMode, job && job.pricingMode)).trim();

  return firestoreSafeComplimentaryServiceLine({
    ...clean,
    serviceId: firstDefinedOrEmpty(clean.serviceId, clean.menuItemId, clean.id),
    menuItemId: firstDefinedOrEmpty(clean.menuItemId, clean.serviceId, clean.id),
    serviceName: name,
    name: firstDefined(clean.name, name),
    department,
    durationAtBooking: firstDefined(clean.durationAtBooking, duration),
    duration: firstDefined(clean.duration, duration),
    quantity: qty,
    qty,
    unitPriceAtBooking: financialEvidence.amount(clean.unitPriceAtBooking) ?? unitPrice,
    unitPrice: financialEvidence.amount(clean.unitPrice) ?? unitPrice,
    price: financialEvidence.amount(clean.price) ?? unitPrice,
    lineSubtotal: clean.lineSubtotal ?? null,
    taxAmount: clean.taxAmount ?? null,
    lineTotal,
    priceMode,
    snapshotSource: firstDefined(clean.snapshotSource, sourceName)
  });
}

function resolveComplimentaryServiceLines(job, options = {}) {
  const allowSyntheticLegacyLine = options.allowSyntheticLegacyLine !== false;
  const candidates = [
    ["serviceLineItems", job && job.serviceLineItems],
    ["checkoutReviewItems", job && job.checkoutReviewItems],
    ["quickEditV4Items", job && job.quickEditV4Items]
  ];

  for (const [sourceName, raw] of candidates) {
    if (Array.isArray(raw) && raw.length) {
      return raw.map((row) => normalizeComplimentaryServiceLine(row, sourceName, job));
    }
  }

  if (!allowSyntheticLegacyLine || isGroupJob(job)) return [];
  const legacyName = String(job && job.bookedService || "").trim();
  if (!legacyName) return [];
  const evidence = financialEvidence.read(job);
  const legacyPrice = evidence.mode === "inclusive" ? evidence.gross : evidence.mode === "exclusive" ? evidence.net : null;
  if (legacyPrice === null) return [];
  const legacyDuration = Number.parseInt(firstDefined(job && job.bookedDuration, job && job.duration, 0), 10) || 0;
  if (legacyPrice <= 0.005 && legacyDuration <= 0) return [];

  return [normalizeComplimentaryServiceLine({
    serviceName: legacyName,
    name: legacyName,
    quantity: 1,
    qty: 1,
    unitPriceAtBooking: legacyPrice,
    unitPrice: legacyPrice,
    price: legacyPrice,
    lineSubtotal: evidence.net,
    taxAmount: evidence.tax.available ? evidence.tax.taxTotal : null,
    lineTotal: legacyPrice,
    durationAtBooking: legacyDuration,
    duration: legacyDuration,
    priceMode: evidence.mode,
    snapshotSource: "legacy_booked_fields",
    legacySyntheticComplimentaryLine: true
  }, "legacy_booked_fields", job)];
}

function parseTaxRows(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function inferTaxPricingMode(job, serviceLineItems) {
  const rows = [...(Array.isArray(job && job.serviceLineItems) ? job.serviceLineItems : []),
    ...(Array.isArray(serviceLineItems) ? serviceLineItems : [])];
  const mode = resolveMode(job || {}, rows);
  if (!mode) throw new HttpsError("failed-precondition", "Transaction tax mode is missing or conflicting.");
  return mode;
}

function complimentaryTransactionPolicy(job, serviceLineItems) {
  const pricingMode = inferTaxPricingMode(job, serviceLineItems);
  try {
    return transactionPolicy({ ...job, pricingMode, serviceLineItems });
  } catch (error) {
    throw new HttpsError("failed-precondition", "Immutable transaction tax policy is unavailable.");
  }
}

function calculateComplimentaryTotals(job, serviceLineItems) {
  const policy = complimentaryTransactionPolicy(job, serviceLineItems);
  const canonical = buildCanonicalFinancialShape({
    serviceLineItems: Array.isArray(serviceLineItems) ? serviceLineItems : [],
    pricingMode: policy.pricingMode,
    taxRates: policy.rates,
    compatibility: { includeMemberTotals: true }
  });
  const payableMenuTotal = canonical.serviceLineItems
    .reduce((sum, item) => sum + serviceLineTotal(item || {}), 0);

  return {
    serviceLineItems: canonical.serviceLineItems,
    payableMenuTotal,
    taxableSubtotal: canonical.taxableSubtotal,
    taxRows: canonical.taxBreakdown,
    taxTotal: canonical.taxTotal,
    grandTotal: canonical.grandTotal,
    pricingMode: canonical.pricingMode,
    memberServiceTotal: canonical.memberServiceTotal ?? canonical.grandTotal
  };
}

function originalTotalsSnapshot(job) {
  return {
    bookedPrice: job.bookedPrice ?? null,
    serviceSubtotal: job.serviceSubtotal ?? null,
    taxableSubtotal: job.taxableSubtotal ?? null,
    taxBreakdown: job.taxBreakdown ?? null,
    taxTotal: job.taxTotal ?? null,
    taxPricingMode: job.taxPricingMode ?? job.pricingMode ?? null,
    grandTotal: job.grandTotal ?? null,
    finalTotal: job.finalTotal ?? null,
    amountDue: job.amountDue ?? null,
    payableShare: job.payableShare ?? null,
    amountDueByMember: job.amountDueByMember ?? null,
    totalGHC: job.totalGHC ?? null,
    memberServiceTotal: job.memberServiceTotal ?? null,
    bookedService: job.bookedService ?? null
  };
}

function normalizeServiceItemIndexes(value) {
  const source = Array.isArray(value) ? value : [];
  const seen = new Set();
  const indexes = [];

  source.forEach((raw) => {
    const index = Number(raw);
    if (Number.isInteger(index) && index >= 0 && !seen.has(index)) {
      seen.add(index);
      indexes.push(index);
    }
  });

  return indexes;
}

function serviceLineStatus(item) {
  return String(item && item.complimentaryStatus || "").trim().toLowerCase();
}

function isFinancialAppliedComplimentaryLine(item) {
  return !!(
    item &&
    serviceLineStatus(item) === "financial_applied" &&
    (
      item.isComplimentary === true ||
      item.complimentaryTotalsApplied === true ||
      item.complimentaryValue !== undefined ||
      item.approvalAuditId ||
      item.complimentaryApprovalAuditId
    )
  );
}

function isPendingComplimentaryMarkerLine(item) {
  return !!(
    item &&
    item.isComplimentary === true &&
    serviceLineStatus(item) === "approved_marker_only"
  );
}

function isTrueZeroNonComplimentaryLine(item) {
  if (!item) return true;
  if (item.isComplimentary === true || serviceLineStatus(item)) return false;
  if (item.approvalAuditId || item.complimentaryApprovalAuditId || item.complimentaryApprovedBy) return false;
  const lineTotal = serviceLineTotal(item);
  const originalLineTotal = safeNumber(item.originalLineTotal, 0);
  const complimentaryValue = safeNumber(item.complimentaryValue, 0);
  return lineTotal <= 0.005 && originalLineTotal <= 0.005 && complimentaryValue <= 0.005;
}

function skippedComplimentaryService(index, reason, item) {
  return {
    index,
    reason,
    name: item ? serviceName(item) : "",
    lineTotal: item ? serviceLineTotal(item) : 0
  };
}

function lineComplimentaryValue(item) {
  if (!isFinancialAppliedComplimentaryLine(item)) return 0;
  const fallback = safeNumber(item.originalLineTotal, serviceLineTotal(item));
  if (item.complimentaryValue === undefined || item.complimentaryValue === null || item.complimentaryValue === "") {
    return fallback;
  }
  return safeNumber(item.complimentaryValue, fallback);
}

function finiteMoneyValue(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(String(value).replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function serviceOriginalProjectionValue(item, job = {}, index) {
  if (!item) return null;
  const saved = job.complimentaryOriginalServiceLineItems?.[index];
  if (saved) return financialEvidence.line(saved, { ...job, ...job.complimentaryOriginalTotals }).gross;
  const original = financialEvidence.amount(item.originalLineTotal);
  if (original !== null && original !== financialEvidence.amount(item.lineTotal)) {
    return financialEvidence.line({ ...item, lineTotal: original,
      taxAmount: item.originalTaxAmount ?? null, lineSubtotal: item.originalLineSubtotal ?? null }, job).gross;
  }
  return financialEvidence.line(item, job).gross;
}

function sumKnownMoney(values) {
  return values.some(value => value === null || value === undefined) ? null : financialEvidence.sumMoney(values);
}

function jobCurrentAmountDue(job) {
  return financialEvidence.read(job || {}).due;
}

function normalizeGroupProjectionTargets(rawTargets) {
  if (!Array.isArray(rawTargets) || !rawTargets.length) {
    throw new HttpsError("invalid-argument", "At least one group complimentary target is required.");
  }

  const targetsByJob = new Map();
  rawTargets.forEach((raw) => {
    const jobId = String(raw && raw.jobId || "").trim();
    if (!jobId) {
      throw new HttpsError("invalid-argument", "Each target must include a jobId.");
    }
    const indexes = normalizeServiceItemIndexes(raw && raw.serviceItemIndexes);
    if (!indexes.length) {
      throw new HttpsError("invalid-argument", `Target ${jobId} must include at least one valid service item index.`);
    }

    const existing = targetsByJob.get(jobId) || new Set();
    indexes.forEach((index) => existing.add(index));
    targetsByJob.set(jobId, existing);
  });

  return [...targetsByJob.entries()].map(([jobId, indexSet]) => ({
    jobId,
    serviceItemIndexes: [...indexSet].sort((a, b) => a - b)
  }));
}

function groupPaymentModeValues(job) {
  if (!job) return [];
  return [
    job.billingMode,
    job.groupPaymentMode,
    job.paymentResponsibility,
    job.paymentMode,
    job.groupCheckoutType,
    job.groupBillingMode,
    job.payableBy,
    job.billingType
  ]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
}

function groupPaymentModeValue(job) {
  return groupPaymentModeValues(job)[0] || "";
}

function normalizeGroupPaymentModeToken(value) {
  const token = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (!token || token === "unknown_legacy") return "";
  if (
    token === "lead" ||
    token === "lead_pays" ||
    token === "covered_by_lead" ||
    token === "lead_pays_all" ||
    token === "lead_all" ||
    token === "lead_final" ||
    token === "group_lead" ||
    token === "group_lead_all" ||
    token === "group_lead_final"
  ) {
    return "lead_pays_all";
  }
  if (
    token === "split_own" ||
    token === "own_services" ||
    token === "each_pays_own" ||
    token === "each_member_pays_own" ||
    token === "member_own" ||
    token === "own_bill"
  ) {
    return "each_pays_own";
  }
  if (
    token === "split_equal" ||
    token === "split_equally" ||
    token === "equal_split"
  ) {
    return "split_equally";
  }
  if (token.includes("subgroup")) return "subgroup_pays_separately";
  return "";
}

function detectGroupPaymentMode(groupJobs) {
  const rawValues = groupJobs
    .flatMap(groupPaymentModeValues)
    .filter(Boolean);
  const normalizedValues = rawValues
    .map(normalizeGroupPaymentModeToken)
    .filter(Boolean);

  if (normalizedValues.includes("lead_pays_all")) {
    return {
      mode: "lead_pays_all",
      rawValues,
      notes: ["Lead-pays-all projection reduces the aggregate group balance, normally collected on the lead checkout."]
    };
  }
  if (normalizedValues.includes("each_pays_own")) {
    return {
      mode: "each_pays_own",
      rawValues,
      notes: ["Each-member projection reduces only the selected member job balance."]
    };
  }
  if (normalizedValues.includes("split_equally")) {
    return {
      mode: "split_equally",
      rawValues,
      notes: ["Split-equally projection recalculates an informational equal share after waivers."]
    };
  }
  if (normalizedValues.includes("subgroup_pays_separately")) {
    return {
      mode: "subgroup_pays_separately",
      rawValues,
      notes: ["Subgroup projection keeps waived value grouped by subgroup index."]
    };
  }

  return {
    mode: "unknown",
    rawValues,
    notes: ["Unknown group payment mode; projection reports service value only and does not infer checkout allocation."]
  };
}

function isGroupLeadJob(job) {
  const role = String(job && job.groupRole || "").toLowerCase();
  const payableBy = String(job && job.payableBy || "").toLowerCase();
  return role.includes("lead") || payableBy.includes("lead");
}

function groupSubgroupKey(job) {
  const raw = job && (job.subGroupIndex ?? job.subgroupIndex ?? job.subGroupId ?? job.subgroupId);
  return raw === undefined || raw === null || raw === "" ? "unassigned" : String(raw);
}

function projectGroupAmountDueImpact(members, paymentMode) {
  const groupOriginalTotal = sumKnownMoney(members.map(member => member.originalTotal));
  const groupWaivedTotal = sumKnownMoney(members.map(member => member.waivedTotal));
  const groupProjectedNetTotal = groupOriginalTotal === null || groupWaivedTotal === null ? null
    : Math.max(0, financialEvidence.sumMoney([groupOriginalTotal, -groupWaivedTotal]));

  if (paymentMode.mode === "lead_pays_all") {
    const lead = members.find((member) => member.isLead) || members[0] || null;
    return {
      mode: paymentMode.mode,
      leadJobId: lead ? lead.jobId : "",
      currentCollectableTotal: groupOriginalTotal,
      projectedCollectableTotal: groupProjectedNetTotal,
      projectedReduction: groupWaivedTotal,
      memberImpacts: members.map((member) => ({
        jobId: member.jobId,
        currentAmountDue: member.currentAmountDue,
        projectedAmountDue: member.jobId === (lead && lead.jobId) ? groupProjectedNetTotal : member.currentAmountDue,
        note: member.jobId === (lead && lead.jobId)
          ? "Lead checkout would carry the projected group balance."
          : "Member balance is informational under lead-pays-all."
      }))
    };
  }

  if (paymentMode.mode === "split_equally") {
    const participantCount = Math.max(1, members.length);
    const ordered = [...members].sort((a, b) => String(a.jobId).localeCompare(String(b.jobId)));
    const currentShares = groupOriginalTotal === null ? ordered.map(() => null) : allocateShares(groupOriginalTotal, participantCount);
    const projectedShares = groupProjectedNetTotal === null ? ordered.map(() => null) : allocateShares(groupProjectedNetTotal, participantCount);
    const uniform = values => values.every(value => value === values[0]) ? values[0] : null;
    const reductions = currentShares.map((value, index) => value === null || projectedShares[index] === null ? null
      : financialEvidence.sumMoney([value, -projectedShares[index]]));
    return {
      mode: paymentMode.mode,
      participantCount,
      currentEqualShare: uniform(currentShares),
      projectedEqualShare: uniform(projectedShares),
      projectedReductionPerMember: uniform(reductions),
      memberImpacts: ordered.map((member, index) => ({
        jobId: member.jobId,
        currentAmountDue: member.currentAmountDue,
        currentAllocatedShare: currentShares[index],
        projectedAmountDue: projectedShares[index],
        projectedReduction: reductions[index],
        note: "Informational equal-share projection only."
      }))
    };
  }

  if (paymentMode.mode === "subgroup_pays_separately") {
    const subgroups = {};
    members.forEach((member) => {
      const key = member.subgroupKey;
      if (!subgroups[key]) {
        subgroups[key] = {
          subgroupKey: key,
          originalTotal: 0,
          waivedTotal: 0,
          projectedNetTotal: 0,
          jobIds: []
        };
      }
      subgroups[key].originalTotal = sumKnownMoney([subgroups[key].originalTotal, member.originalTotal]);
      subgroups[key].waivedTotal = sumKnownMoney([subgroups[key].waivedTotal, member.waivedTotal]);
      subgroups[key].projectedNetTotal = sumKnownMoney([subgroups[key].projectedNetTotal, member.projectedNetTotal]);
      subgroups[key].jobIds.push(member.jobId);
    });

    return {
      mode: paymentMode.mode,
      subgroups: Object.values(subgroups),
      memberImpacts: members.map((member) => ({
        jobId: member.jobId,
        subgroupKey: member.subgroupKey,
        currentAmountDue: member.currentAmountDue,
        projectedAmountDue: member.projectedNetTotal,
        projectedReduction: member.waivedTotal
      }))
    };
  }

  if (paymentMode.mode === "each_pays_own" || paymentMode.mode === "each_member_pays_own") {
    return {
      mode: paymentMode.mode,
      memberImpacts: members.map((member) => ({
        jobId: member.jobId,
        currentAmountDue: member.currentAmountDue,
        projectedAmountDue: member.projectedNetTotal,
        projectedReduction: member.waivedTotal
      }))
    };
  }

  return {
    mode: paymentMode.mode,
    memberImpacts: members.map((member) => ({
      jobId: member.jobId,
      currentAmountDue: member.currentAmountDue,
      projectedAmountDue: null,
      projectedReduction: member.waivedTotal,
      note: "Payment mode unknown; no amountDue allocation inferred."
    }))
  };
}

async function mapGroupComplimentaryFinancialProjection(groupId, selectedTargets) {
  const normalizedGroupId = String(groupId || "").trim();
  if (!normalizedGroupId) {
    throw new HttpsError("invalid-argument", "groupId is required.");
  }

  const targets = normalizeGroupProjectionTargets(selectedTargets);
  const targetMap = new Map(targets.map((target) => [target.jobId, target.serviceItemIndexes]));
  const groupSnap = await db.collection(ACTIVE_JOBS_COLLECTION)
    .where("groupId", "==", normalizedGroupId)
    .get();

  if (groupSnap.empty) {
    throw new HttpsError("not-found", "No Active_Jobs records were found for this groupId.");
  }

  const groupJobs = groupSnap.docs.map((doc) => ({
    id: doc.id,
    ...(doc.data() || {})
  }));
  const maxGroupSize = groupJobs.reduce((max, job) => Math.max(max, safeNumber(job.groupSize, 0)), 0);
  if (groupJobs.length < 2 && maxGroupSize < 2) {
    throw new HttpsError("failed-precondition", "Group projection requires at least two group jobs or a valid groupSize.");
  }

  groupJobs.forEach((job) => {
    if (isComplimentaryBlockedJobStatus(job.status)) {
      throw new HttpsError("failed-precondition", `Job ${job.id} is closed, completed, cancelled, or no-show.`);
    }
    if (!Array.isArray(job.serviceLineItems) || !job.serviceLineItems.length) {
      throw new HttpsError("failed-precondition", `Job ${job.id} does not have serviceLineItems for group projection.`);
    }
  });

  const groupJobIds = new Set(groupJobs.map((job) => job.id));
  targets.forEach((target) => {
    if (!groupJobIds.has(target.jobId)) {
      throw new HttpsError("invalid-argument", `Selected job ${target.jobId} does not belong to group ${normalizedGroupId}.`);
    }
  });

  const paymentMode = detectGroupPaymentMode(groupJobs);
  const warnings = [];
  const members = groupJobs.map((job) => {
    const items = Array.isArray(job.serviceLineItems) ? job.serviceLineItems : [];
    if (!items.length) {
      warnings.push({
        jobId: job.id,
        code: "missing_serviceLineItems",
        message: "Member job has no serviceLineItems; totals fall back to current amount due."
      });
    }

    const selectedIndexes = targetMap.get(job.id) || [];
    const selectedServices = [];
    const skippedServices = [];
    const originalTotal = items.length
      ? sumKnownMoney(items.map((item, index) => serviceOriginalProjectionValue(item, job, index)))
      : jobCurrentAmountDue(job);

    selectedIndexes.forEach((index) => {
      const item = items[index];
      if (!item) {
        skippedServices.push({ index, reason: "invalid_index" });
        return;
      }
      if (isFinancialAppliedComplimentaryLine(item)) {
        skippedServices.push({ index, reason: "already_applied", name: serviceName(item) });
        return;
      }
      if (isPendingComplimentaryMarkerLine(item)) {
        skippedServices.push({ index, reason: "pending_marker", name: serviceName(item) });
        return;
      }
      if (isTrueZeroNonComplimentaryLine(item)) {
        skippedServices.push({ index, reason: "zero_value", name: serviceName(item) });
        return;
      }

      const value = serviceOriginalProjectionValue(item, job, index);
      if (value === null || value <= 0.005) {
        skippedServices.push({ index, reason: "missing_numeric_value", name: serviceName(item) });
        return;
      }

      selectedServices.push({
        index,
        name: serviceName(item),
        qty: serviceQty(item),
        originalValue: value,
        projectedWaivedValue: value,
        projectedNetValue: 0
      });
    });

    const waivedTotal = sumKnownMoney(selectedServices.map(item => item.projectedWaivedValue));
    const projectedNetTotal = originalTotal === null ? null : Math.max(0, financialEvidence.sumMoney([originalTotal, -waivedTotal]));

    return {
      jobId: job.id,
      clientName: String(job.clientName || job.client || job.customerName || "").trim(),
      technicianName: String(job.technicianName || job.technician || job.staffName || "").trim(),
      status: String(job.status || "").trim(),
      groupRole: String(job.groupRole || "").trim(),
      billingMode: groupPaymentModeValue(job),
      subgroupKey: groupSubgroupKey(job),
      isLead: isGroupLeadJob(job),
      currentAmountDue: jobCurrentAmountDue(job),
      originalTotal,
      waivedTotal,
      projectedNetTotal,
      selectedServices,
      skippedServices
    };
  });

  const invalidSelections = members.flatMap((member) => member.skippedServices
    .filter((entry) => entry.reason === "invalid_index" || entry.reason === "missing_numeric_value")
    .map((entry) => ({ jobId: member.jobId, ...entry })));
  if (invalidSelections.length) {
    throw new HttpsError("invalid-argument", "One or more selected group service lines are invalid or missing a numeric value.", {
      invalidSelections
    });
  }

  const groupOriginalTotal = sumKnownMoney(members.map(member => member.originalTotal));
  const groupWaivedTotal = sumKnownMoney(members.map(member => member.waivedTotal));
  const groupProjectedNetTotal = groupOriginalTotal === null ? null : Math.max(0, financialEvidence.sumMoney([groupOriginalTotal, -groupWaivedTotal]));
  const amountDueImpact = projectGroupAmountDueImpact(members, paymentMode);

  return {
    ok: true,
    readOnly: true,
    phase: "group_complimentary_projection_v1",
    groupId: normalizedGroupId,
    groupJobCount: groupJobs.length,
    groupSize: maxGroupSize || groupJobs.length,
    paymentMode,
    selectedTargets: targets,
    members,
    groupTotals: {
      originalTotal: groupOriginalTotal,
      waivedTotal: groupWaivedTotal,
      projectedNetTotal: groupProjectedNetTotal
    },
    amountDueImpact,
    notes: [
      "Projection only. No Firestore data was written.",
      "Existing group complimentary rejection remains unchanged.",
      ...paymentMode.notes
    ],
    warnings
  };
}

function archivePreviewDateString(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value.toDate === "function") {
    return value.toDate().toISOString().slice(0, 10);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  }
  if (typeof value === "object" && value.seconds !== undefined) {
    const date = new Date(Number(value.seconds) * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
  }

  const raw = String(value || "").trim();
  if (!raw) return "";
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const slash = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (slash) {
    const first = Number(slash[1]);
    const second = Number(slash[2]);
    const year = slash[3];
    const month = String(first).padStart(2, "0");
    const day = String(second).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString().slice(0, 10);
}

function archivePreviewText(row, keys) {
  for (const key of keys) {
    const value = row && row[key];
    if (value !== undefined && value !== null && String(value).trim() !== "") {
      return String(value).trim();
    }
  }
  return "";
}

function archivePreviewStatus(row) {
  return archivePreviewText(row, ["status", "bookingStatus", "jobStatus", "state"]);
}

function archivePreviewNormalizeStatus(value) {
  return String(value || "").trim().toLowerCase();
}

function archivePreviewHasAny(row, keys) {
  return keys.some((key) => row && row[key] !== undefined && row[key] !== null && String(row[key]).trim() !== "");
}

function archivePreviewNumber(value, fallback = 0) {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

function archiveIsPostGoLiveBusinessDate(value) {
  return !!value && String(value) >= ARCHIVE_GO_LIVE_CUTOFF_DATE;
}

function archiveIsSyntheticActiveJobPilot(row) {
  return String(row && row.source || "").trim() === ARCHIVE_ACTIVE_JOBS_PILOT_SOURCE;
}

function archivePreviewBusinessDate(collection, row) {
  const fields = ARCHIVE_PREVIEW_DATE_FIELDS[collection] || [];
  for (const field of fields) {
    const value = archivePreviewDateString(row && row[field]);
    if (value) {
      return { field, value };
    }
  }
  return { field: "", value: "" };
}

function archivePreviewIsInRange(value, dateFrom, dateTo) {
  return !!value && value >= dateFrom && value <= dateTo;
}

function archivePreviewLinkKey(value) {
  return String(value || "").trim().toLowerCase();
}

function archivePreviewIndexRows(collectionRows) {
  const indexes = {
    docId: new Map(),
    appointmentId: new Map(),
    jobId: new Map(),
    clientId: new Map(),
    groupId: new Map(),
    receiptRef: new Map(),
    giftCardCode: new Map()
  };

  const add = (mapName, value, ref) => {
    const key = archivePreviewLinkKey(value);
    if (!key) return;
    if (!indexes[mapName].has(key)) indexes[mapName].set(key, []);
    indexes[mapName].get(key).push(ref);
  };

  Object.entries(collectionRows).forEach(([collection, rows]) => {
    (rows || []).forEach((row) => {
      const ref = {
        collection,
        docId: row.__docId,
        businessDate: archivePreviewBusinessDate(collection, row).value,
        status: archivePreviewStatus(row)
      };
      add("docId", row.__docId, ref);
      add("appointmentId", row.appointmentId || row.bookingId, ref);
      add("jobId", row.jobId || row.activeJobId || (collection === "Active_Jobs" ? row.__docId : ""), ref);
      add("clientId", row.clientId || row.clientEmail || row.clientPhone || row.email, ref);
      add("groupId", row.groupId || row.groupBookingId, ref);
      add("receiptRef", row.receiptRef || row.receiptId, ref);
      add("giftCardCode", row.giftCardCode || row.appliedGiftCardCode || row.voucherCode, ref);
    });
  });

  return indexes;
}

function archivePreviewCollectLinkedRecords(row, collection, indexes) {
  const docId = row.__docId;
  const linked = [];
  const pushMatches = (reason, mapName, ...values) => {
    values.forEach((value) => {
      const matches = indexes[mapName].get(archivePreviewLinkKey(value)) || [];
      matches.forEach((match) => {
        if (match.collection === collection && match.docId === docId) return;
        linked.push({ reason, ...match });
      });
    });
  };

  pushMatches("appointmentId", "appointmentId", row.appointmentId, row.bookingId);
  pushMatches("jobId", "jobId", row.jobId, row.activeJobId, collection === "Active_Jobs" ? row.__docId : "");
  pushMatches("clientId", "clientId", row.clientId, row.clientEmail, row.clientPhone, row.email);
  pushMatches("groupId", "groupId", row.groupId, row.groupBookingId);
  pushMatches("receiptRef", "receiptRef", row.receiptRef, row.receiptId);
  pushMatches("giftCardCode", "giftCardCode", row.giftCardCode, row.appliedGiftCardCode, row.voucherCode);

  const seen = new Set();
  return linked.filter((entry) => {
    const key = `${entry.reason}:${entry.collection}:${entry.docId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function archivePreviewClassifyRecord(collection, row, linkedRecords, options) {
  const business = archivePreviewBusinessDate(collection, row);
  const status = archivePreviewNormalizeStatus(archivePreviewStatus(row));
  const createdAt = archivePreviewDateString(row.createdAt || row.__createTime);
  const notes = [];
  const inRange = archivePreviewIsInRange(business.value, options.dateFrom, options.dateTo);
  const groupRisk = archivePreviewHasAny(row, ["groupId", "groupBookingId", "groupRole"]) || Number(row.groupSize || 0) > 1;
  const receiptRisk = archivePreviewHasAny(row, ["receiptRef", "receiptId"]);
  const giftCardRisk = archivePreviewHasAny(row, ["giftCardCode", "appliedGiftCardCode", "voucherCode", "giftCardRedemptionId"]);
  const packageRisk = archivePreviewHasAny(row, ["packageId", "packageCode", "walletId", "packageWalletId"]);
  const promoRisk = archivePreviewHasAny(row, ["promoCode", "discountCode", "redemptionId"])
    || archiveActiveJobHasNonZeroAmount(row, ["discountAmount", "promoDiscount", "voucherDiscount"]);
  const activeJobPilotLinkRisk = collection === ACTIVE_JOBS_COLLECTION && archivePreviewHasAny(row, [
    "appointmentId",
    "bookingId",
    "sourceAppointmentId",
    "clientId",
    "clientPhone",
    "clientEmail",
    "email",
    "phone",
    "phoneNumber"
  ]);
  const activeJobPilotPaymentRisk = collection === ACTIVE_JOBS_COLLECTION && (
    row.hasSplitPayment === true
    || row.isSplitPayment === true
    || archiveActiveJobHasArrayEntries(row, ["splitPayments", "paymentSplits", "payments"])
    || archiveActiveJobTextMatches(row, ["paymentMethod", "paymentType", "tenderType"], /split|gift|voucher|package|wallet|promo/i)
  );
  const hasLiveStatus = Boolean(status && !ARCHIVE_PREVIEW_TERMINAL_STATUSES.has(status));

  if (row.archived === true) {
    return {
      archiveDecision: "exclude",
      archiveReason: "already_archived",
      riskLevel: "low",
      reviewNotes: ["Record is already soft-archived."]
    };
  }

  if (collection === "Clients") {
    if (!business.value) {
      notes.push("Client record has no reliable review date.");
      return {
        archiveDecision: "manual_review",
        archiveReason: "client_record_manual_review_only",
        riskLevel: "high",
        reviewNotes: notes
      };
    }
    if (!inRange) {
      return {
        archiveDecision: "exclude",
        archiveReason: "business_date_outside_preview_range",
        riskLevel: "low",
        reviewNotes: ["Client review date is outside the selected preview range."]
      };
    }
    notes.push("Clients are manual-review only; do not archive client records from date alone.");
    return {
      archiveDecision: "manual_review",
      archiveReason: "client_record_manual_review_only",
      riskLevel: "high",
      reviewNotes: notes
    };
  }

  if (!business.value) {
    notes.push("No reliable business date found.");
    return {
      archiveDecision: "manual_review",
      archiveReason: "missing_business_date",
      riskLevel: "high",
      reviewNotes: notes
    };
  }

  if (archiveIsPostGoLiveBusinessDate(business.value)) {
    return {
      archiveDecision: "exclude",
      archiveReason: "protected_post_go_live",
      riskLevel: "low",
      reviewNotes: ["Business date is on or after go-live; protected from archive candidate status."]
    };
  }

  if (!inRange) {
    if (createdAt && archivePreviewIsInRange(createdAt, options.dateFrom, options.dateTo)) {
      notes.push("createdAt is inside range but business date is not; business date controls archive eligibility.");
    }
    return {
      archiveDecision: "exclude",
      archiveReason: "business_date_outside_preview_range",
      riskLevel: "low",
      reviewNotes: notes
    };
  }

  if (collection === ACTIVE_JOBS_COLLECTION) {
    if (!archiveIsSyntheticActiveJobPilot(row)) {
      notes.push("Real Active_Jobs are protected; only source archive_revenue_pilot can be a DA-3B candidate.");
      return {
        archiveDecision: "manual_review",
        archiveReason: "active_jobs_real_record_protected",
        riskLevel: "high",
        reviewNotes: notes
      };
    }
    notes.push("Synthetic Active_Jobs revenue pilot row.");
  }

  if (hasLiveStatus) notes.push(`Non-terminal status '${archivePreviewStatus(row)}' requires review.`);
  if (groupRisk) notes.push("Linked to group booking data.");
  if (receiptRisk) notes.push("Receipt reference present; reprint/report impact risk.");
  if (giftCardRisk) notes.push("Gift card/voucher fields present.");
  if (packageRisk) notes.push("Package/wallet fields present.");
  if (promoRisk) notes.push("Promo/discount/redemption fields present.");
  if (activeJobPilotLinkRisk) notes.push("Synthetic Active_Jobs pilot row has client or appointment link fields.");
  if (activeJobPilotPaymentRisk) notes.push("Synthetic Active_Jobs pilot row has split/gift/package/promo payment fields.");
  if (linkedRecords.length) notes.push(`Linked records found: ${linkedRecords.length}.`);

  const highRisk = giftCardRisk || packageRisk || promoRisk || activeJobPilotLinkRisk || activeJobPilotPaymentRisk || hasLiveStatus;
  const mediumRisk = groupRisk || receiptRisk || linkedRecords.length > 0;

  if (highRisk) {
    return {
      archiveDecision: "manual_review",
      archiveReason: "preview_high_risk_links",
      riskLevel: "high",
      reviewNotes: notes
    };
  }
  if (mediumRisk) {
    return {
      archiveDecision: "manual_review",
      archiveReason: "preview_linked_record_review",
      riskLevel: "medium",
      reviewNotes: notes
    };
  }
  return {
    archiveDecision: "candidate",
    archiveReason: options.reason,
    riskLevel: "low",
    reviewNotes: notes
  };
}

function archivePreviewManifestRow(collection, row, archiveBatchId, linkedRecords, classification) {
  const business = archivePreviewBusinessDate(collection, row);
  return {
    archiveBatchId,
    collection,
    docId: row.__docId,
    dateField: business.field,
    businessDate: business.value,
    createdAt: row.createdAt || row.__createTime || "",
    status: archivePreviewStatus(row),
    clientName: archivePreviewText(row, ["clientName", "name", "fullName", "leadName"]),
    clientPhone: archivePreviewText(row, ["clientPhone", "phone", "phoneNumber"]),
    clientId: archivePreviewText(row, ["clientId", "clientEmail", "clientPhone", "email"]),
    groupId: archivePreviewText(row, ["groupId", "groupBookingId"]),
    appointmentId: archivePreviewText(row, ["appointmentId", "bookingId"]),
    jobId: archivePreviewText(row, ["jobId", "activeJobId"]) || (collection === "Active_Jobs" ? row.__docId : ""),
    receiptRef: archivePreviewText(row, ["receiptRef", "receiptId"]),
    giftCardCode: archivePreviewText(row, ["giftCardCode", "appliedGiftCardCode", "voucherCode"]),
    linkedRecords,
    archiveDecision: classification.archiveDecision,
    archiveReason: classification.archiveReason,
    riskLevel: classification.riskLevel,
    reviewNotes: classification.reviewNotes
  };
}

function archivePreviewCompactEntry(entry) {
  return {
    collection: entry.collection,
    docId: entry.docId,
    businessDate: entry.businessDate,
    status: entry.status,
    clientName: entry.clientName,
    groupId: entry.groupId,
    receiptRef: entry.receiptRef,
    archiveDecision: entry.archiveDecision,
    riskLevel: entry.riskLevel,
    archiveReason: entry.archiveReason
  };
}

function archivePreviewSummarize(manifestRows, scannedCollections, warnings) {
  const collectionsSummary = {};
  ARCHIVE_PREVIEW_ALLOWED_COLLECTIONS.forEach((collection) => {
    collectionsSummary[collection] = {
      scanned: scannedCollections[collection] || 0,
      candidate: 0,
      excluded: 0,
      manualReview: 0,
      highRisk: 0
    };
  });

  const riskBuckets = {
    highRiskRecords: [],
    groupBookingRisks: [],
    receiptRisks: [],
    giftCardRisks: [],
    clientRisks: []
  };

  let candidateCount = 0;
  let excludedCount = 0;
  let manualReviewCount = 0;
  let highRiskCount = 0;

  manifestRows.forEach((entry) => {
    const summary = collectionsSummary[entry.collection] || {
      scanned: 0,
      candidate: 0,
      excluded: 0,
      manualReview: 0,
      highRisk: 0
    };
    collectionsSummary[entry.collection] = summary;

    if (entry.archiveDecision === "candidate") {
      candidateCount++;
      summary.candidate++;
    } else if (entry.archiveDecision === "exclude") {
      excludedCount++;
      summary.excluded++;
    } else if (entry.archiveDecision === "manual_review") {
      manualReviewCount++;
      summary.manualReview++;
    }

    if (entry.riskLevel === "high") {
      highRiskCount++;
      summary.highRisk++;
      if (riskBuckets.highRiskRecords.length < ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT) {
        riskBuckets.highRiskRecords.push(archivePreviewCompactEntry(entry));
      }
    }
    if ((entry.groupId || entry.reviewNotes.some((note) => /group/i.test(note))) && riskBuckets.groupBookingRisks.length < ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT) {
      riskBuckets.groupBookingRisks.push(archivePreviewCompactEntry(entry));
    }
    if ((entry.receiptRef || entry.reviewNotes.some((note) => /receipt/i.test(note))) && riskBuckets.receiptRisks.length < ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT) {
      riskBuckets.receiptRisks.push(archivePreviewCompactEntry(entry));
    }
    if ((entry.giftCardCode || entry.reviewNotes.some((note) => /gift|voucher/i.test(note))) && riskBuckets.giftCardRisks.length < ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT) {
      riskBuckets.giftCardRisks.push(archivePreviewCompactEntry(entry));
    }
    if (entry.collection === "Clients" && riskBuckets.clientRisks.length < ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT) {
      riskBuckets.clientRisks.push(archivePreviewCompactEntry(entry));
    }
  });

  return {
    candidateCount,
    excludedCount,
    manualReviewCount,
    highRiskCount,
    collectionsSummary,
    riskBuckets,
    warnings
  };
}

function archivePreviewEncodePageToken(offset) {
  if (!offset) return "";
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64");
}

function archiveStableValue(value) {
  if (Array.isArray(value)) {
    return value.map(item => archiveStableValue(item));
  }
  if (value && typeof value === "object") {
    return Object.keys(value)
      .sort()
      .reduce((out, key) => {
        out[key] = archiveStableValue(value[key]);
        return out;
      }, {});
  }
  return value;
}

function archiveManifestHash(manifestRows) {
  const stable = archiveStableValue(Array.isArray(manifestRows) ? manifestRows : []);
  return crypto.createHash("sha256")
    .update(JSON.stringify(stable), "utf8")
    .digest("hex");
}

function archivePreviewDecodePageToken(token) {
  if (!token) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(String(token), "base64").toString("utf8"));
    const offset = Number(parsed && parsed.offset);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error("Invalid offset");
    }
    return offset;
  } catch (error) {
    throw new HttpsError("invalid-argument", "Invalid pageToken.");
  }
}

function archivePreviewValidateRequest(raw) {
  const data = raw || {};
  if (data.previewOnly !== true) {
    throw new HttpsError("failed-precondition", "previewOnly must be true.");
  }

  const dateFrom = archivePreviewDateString(data.dateFrom);
  const dateTo = archivePreviewDateString(data.dateTo);
  if (!dateFrom || !dateTo) {
    throw new HttpsError("invalid-argument", "dateFrom and dateTo are required.");
  }
  if (dateFrom > dateTo) {
    throw new HttpsError("invalid-argument", "dateFrom must be before or equal to dateTo.");
  }

  const rawCollections = Array.isArray(data.collections) && data.collections.length
    ? data.collections
    : ARCHIVE_PREVIEW_ALLOWED_COLLECTIONS;
  const seen = new Set();
  const collections = rawCollections.map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((collection) => {
      if (seen.has(collection)) return false;
      seen.add(collection);
      return true;
    });
  const invalid = collections.filter((collection) => !ARCHIVE_PREVIEW_ALLOWED_COLLECTIONS.includes(collection));
  if (invalid.length) {
    throw new HttpsError("invalid-argument", `Unsupported archive preview collection: ${invalid.join(", ")}`);
  }
  if (!collections.length) {
    throw new HttpsError("invalid-argument", "At least one collection is required.");
  }

  const reason = String(data.reason || "pre_go_live_test_data").trim();
  if (!ARCHIVE_PREVIEW_ALLOWED_REASONS.has(reason)) {
    throw new HttpsError("invalid-argument", "Unsupported archive reason.");
  }

  const pageSizeRaw = Number.parseInt(String(data.pageSize || ARCHIVE_PREVIEW_DEFAULT_PAGE_SIZE), 10);
  const pageSize = Math.min(
    ARCHIVE_PREVIEW_MAX_PAGE_SIZE,
    Math.max(1, Number.isFinite(pageSizeRaw) ? pageSizeRaw : ARCHIVE_PREVIEW_DEFAULT_PAGE_SIZE)
  );

  return {
    dateFrom,
    dateTo,
    collections,
    reason,
    pageSize,
    pageOffset: archivePreviewDecodePageToken(data.pageToken),
    summaryOnly: data.summaryOnly === true
  };
}

async function archivePreviewReadCollections(collections, warnings) {
  const collectionRows = {};
  const scannedCollections = {};

  for (const collection of collections) {
    const snap = await db.collection(collection)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(ARCHIVE_PREVIEW_MAX_SCAN_PER_COLLECTION + 1)
      .get();

    const docs = snap.docs.slice(0, ARCHIVE_PREVIEW_MAX_SCAN_PER_COLLECTION);
    collectionRows[collection] = docs.map((doc) => ({
      __docId: doc.id,
      __createTime: doc.createTime ? doc.createTime.toDate().toISOString() : "",
      __updateTime: doc.updateTime ? doc.updateTime.toDate().toISOString() : "",
      ...(doc.data() || {})
    }));
    scannedCollections[collection] = collectionRows[collection].length;

    if (snap.docs.length > ARCHIVE_PREVIEW_MAX_SCAN_PER_COLLECTION) {
      warnings.push({
        collection,
        code: "scan_limit_reached",
        message: `Preview scanned the first ${ARCHIVE_PREVIEW_MAX_SCAN_PER_COLLECTION} records only. Narrow the date range for a fuller preview.`
      });
    }
  }

  return { collectionRows, scannedCollections };
}

async function buildArchivePreviewManifest(data, callerEmail) {
  const options = archivePreviewValidateRequest(data);
  const warnings = [];
  const archiveBatchId = `PREVIEW_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
  const { collectionRows, scannedCollections } = await archivePreviewReadCollections(options.collections, warnings);
  const indexes = archivePreviewIndexRows(collectionRows);
  const manifest = [];

  for (const collection of options.collections) {
    for (const row of collectionRows[collection] || []) {
      const linkedRecords = archivePreviewCollectLinkedRecords(row, collection, indexes);
      const classification = archivePreviewClassifyRecord(collection, row, linkedRecords, options);
      manifest.push(archivePreviewManifestRow(collection, row, archiveBatchId, linkedRecords, classification));
    }
  }

  const summary = archivePreviewSummarize(manifest, scannedCollections, warnings);
  const manifestHash = archiveManifestHash(manifest);
  const offset = Math.min(options.pageOffset, manifest.length);
  const end = Math.min(offset + options.pageSize, manifest.length);
  const pageRows = options.summaryOnly ? [] : manifest.slice(offset, end);
  const nextPageToken = (!options.summaryOnly && end < manifest.length)
    ? archivePreviewEncodePageToken(end)
    : "";

  logger.info("Archive manifest preview generated", {
    readOnly: true,
    callerEmail,
    collections: options.collections,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    reason: options.reason,
    manifestRows: manifest.length,
    returnedRows: pageRows.length,
    summaryOnly: options.summaryOnly
  });

  return {
    readOnly: true,
    previewOnly: true,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    archiveBatchId,
    generatedAt: new Date().toISOString(),
    manifestHash,
    recordCount: manifest.length,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    reason: options.reason,
    collections: options.collections,
    candidateCount: summary.candidateCount,
    excludedCount: summary.excludedCount,
    manualReviewCount: summary.manualReviewCount,
    highRiskCount: summary.highRiskCount,
    collectionsSummary: summary.collectionsSummary,
    riskBuckets: summary.riskBuckets,
    manifestRows: pageRows,
    nextPageToken,
    warnings
  };
}

function archivePreGoLiveRound(value) {
  const num = Number(value);
  return Number.isFinite(num) ? Math.round(num * 100) / 100 : 0;
}

function archivePreGoLiveValidateRequest(raw) {
  const data = raw || {};
  if (data.previewOnly !== true) {
    throw new HttpsError("failed-precondition", "previewOnly must be true.");
  }

  const policyId = String(data.policyId || ARCHIVE_PRE_GO_LIVE_POLICY_ID).trim();
  if (policyId !== ARCHIVE_PRE_GO_LIVE_POLICY_ID) {
    throw new HttpsError("invalid-argument", "Unsupported archive policy.");
  }

  const cutoffDate = archivePreviewDateString(data.cutoffDate || ARCHIVE_GO_LIVE_CUTOFF_DATE);
  if (cutoffDate !== ARCHIVE_GO_LIVE_CUTOFF_DATE) {
    throw new HttpsError("invalid-argument", `cutoffDate must be ${ARCHIVE_GO_LIVE_CUTOFF_DATE}.`);
  }

  const dateFrom = archivePreviewDateString(data.dateFrom);
  const dateTo = archivePreviewDateString(data.dateTo);
  if (!dateFrom || !dateTo) {
    throw new HttpsError("invalid-argument", "dateFrom and dateTo are required.");
  }
  if (dateFrom > dateTo) {
    throw new HttpsError("invalid-argument", "dateFrom must be before or equal to dateTo.");
  }

  const rawCollections = Array.isArray(data.collections) && data.collections.length
    ? data.collections
    : ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS;
  const seen = new Set();
  const collections = rawCollections.map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((collection) => {
      if (seen.has(collection)) return false;
      seen.add(collection);
      return true;
    });
  const invalid = collections.filter((collection) => !ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.includes(collection));
  if (invalid.length) {
    throw new HttpsError("invalid-argument", `Pre-go-live policy cannot preview collection(s): ${invalid.join(", ")}`);
  }
  if (!collections.length) {
    throw new HttpsError("invalid-argument", "At least one policy-allowed collection is required.");
  }

  return {
    dateFrom,
    dateTo,
    cutoffDate,
    policyId,
    collections
  };
}

function archivePreGoLiveTimestampIso(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  if (typeof value === "object" && value.seconds !== undefined) {
    const date = new Date(Number(value.seconds) * 1000);
    return Number.isNaN(date.getTime()) ? "" : date.toISOString();
  }
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString();
}

function archivePreGoLiveEnsureCollectionSummary(collectionsSummary, collection) {
  if (!collectionsSummary[collection]) {
    collectionsSummary[collection] = {
      scannedCount: 0,
      unarchivedTargetCount: 0,
      alreadyArchivedCount: 0,
      protectedPostGoLiveCount: 0,
      alreadyArchivedPostGoLiveCount: 0,
      skippedInvalidDateCount: 0,
      outsideRequestedRangeCount: 0,
      sampleRows: []
    };
  }
  return collectionsSummary[collection];
}

function archivePreGoLiveServiceNames(row) {
  const names = [];
  const add = (value) => {
    const text = String(value || "").trim();
    if (text && !names.includes(text)) names.push(text);
  };

  if (Array.isArray(row && row.serviceLineItems)) {
    row.serviceLineItems.forEach((item) => add(serviceName(item)));
  }
  if (Array.isArray(row && row.services)) {
    row.services.forEach((item) => {
      if (typeof item === "string") {
        add(item);
      } else {
        add(serviceName(item));
      }
    });
  } else {
    add(row && row.services);
  }

  [
    "serviceName",
    "bookedService",
    "service",
    "selectedService",
    "appointmentService"
  ].forEach((key) => add(row && row[key]));

  return names;
}

function archivePreGoLiveGrossServiceValue(row) {
  const original = row?.complimentaryOriginalTotals;
  return financialEvidence.read(original ? { ...original,
    serviceLineItems: row.complimentaryOriginalServiceLineItems || [] } : row || {}).gross;
}

function archivePreGoLiveComplimentaryWaived(row) {
  if (row?.complimentaryOriginalTotals) {
    const original = archivePreGoLiveGrossServiceValue(row);
    const adjusted = financialEvidence.read(row).finalGross;
    if (original !== null && adjusted !== null) return financialEvidence.sumMoney([original, -adjusted]);
  }
  let lineWaived = 0;
  if (Array.isArray(row && row.serviceLineItems)) {
    lineWaived = sumKnownMoney(row.serviceLineItems.map((item) => {
      if (!item) return 0;
      if (item.complimentaryTotalsApplied === true || item.complimentaryStatus === "financial_applied") {
        const evidence = financialEvidence.line(item, row);
        if (evidence.originalGross === null || evidence.adjustedGross === null) return null;
        return financialEvidence.sumMoney([evidence.originalGross, -evidence.adjustedGross]);
      }
      return 0;
    }));
  }
  if (lineWaived === null) return null;
  if (lineWaived > 0.005) return archivePreGoLiveRound(lineWaived);
  const fallback = archiveFirstFinite(row, [
    "complimentaryWaived",
    "complimentaryValue",
    "totalComplimentaryValue",
    "complimentaryAdjustmentAmount"
  ]);
  return archivePreGoLiveRound(fallback || 0);
}

function archivePreGoLiveTaxBreakdownTotal(row) {
  const tax = financialEvidence.tax(row || {});
  return tax.available && tax.consistent !== false ? tax.taxTotal : null;
}

function archivePreGoLiveFinancialSummary(row) {
  const evidence = financialEvidence.read(row || {});
  const grossServiceValue = archivePreGoLiveGrossServiceValue(row);
  const netRevenue = evidence.net;
  const paidAmount = evidence.paid;
  const taxFromTaxTotal = financialEvidence.firstAmount(row, ["taxTotal", "totalTax"]);
  const normalizedTaxFromTaxBreakdown = archivePreGoLiveTaxBreakdownTotal(row);
  const status = archivePreviewNormalizeStatus(archivePreviewStatus(row));
  const completedJobsImpact = status === "closed" || status === "completed" ? 1 : 0;

  return {
    netRevenue,
    paidAmount,
    financialContradictions: evidence.contradictions.slice(),
    taxEvidence: {
      available: evidence.tax.available,
      consistent: evidence.tax.consistent ?? null,
      rows: evidence.tax.rows,
      storedTaxTotal: row?.taxTotal ?? null,
      reason: evidence.tax.reason || null
    },
    completedJobsImpact,
    commissionEstimate: financialEvidence.firstAmount(row, ["commissionEstimate", "commissionAmount"])
      ?? (netRevenue === null ? null : archivePreGoLiveRound(netRevenue * ARCHIVE_PRE_GO_LIVE_COMMISSION_RATE)),
    taxFromTaxTotal,
    normalizedTaxFromTaxBreakdown,
    normalizedTaxEstimate: normalizedTaxFromTaxBreakdown,
    grossServiceValue,
    originalGross: grossServiceValue,
    adjustedGross: evidence.finalGross,
    amountDue: evidence.due,
    adjustmentAmount: grossServiceValue === null || evidence.finalGross === null ? null
      : financialEvidence.sumMoney([grossServiceValue, -evidence.finalGross]),
    refundAmount: financialEvidence.firstAmount(row, ["refundAmount", "refundedAmount", "totalRefunded"]),
    discountAmount: financialEvidence.firstAmount(row, ["discountAmount", "promoDiscount", "voucherDiscount"]),
    complimentaryWaived: archivePreGoLiveComplimentaryWaived(row)
  };
}

function archivePreGoLiveHasGiftPackagePromoSplitRisk(row) {
  return archivePreviewHasAny(row, [
    "giftCardCode",
    "appliedGiftCardCode",
    "voucherCode",
    "giftCardRedemptionId",
    "packageId",
    "packageCode",
    "walletId",
    "packageWalletId",
    "promoCode",
    "discountCode",
    "redemptionId"
  ])
    || archiveActiveJobHasNonZeroAmount(row, ["discountAmount", "promoDiscount", "voucherDiscount"])
    || row.hasSplitPayment === true
    || row.isSplitPayment === true
    || archiveActiveJobHasArrayEntries(row, ["splitPayments", "paymentSplits", "payments", "giftCardRedemptions"])
    || archiveActiveJobTextMatches(row, ["paymentMethod", "paymentType", "tenderType"], /split|gift|voucher|package|wallet|promo/i);
}

function archivePreGoLiveRiskReasons(collection, row, business) {
  const reasons = [
    `Business date ${business.value} is before go-live cutoff ${ARCHIVE_GO_LIVE_CUTOFF_DATE}.`,
    "Owner-approved pre-go-live cutoff policy target."
  ];
  if (collection === ACTIVE_JOBS_COLLECTION) {
    reasons.push("Revenue-impacting Active_Jobs record.");
  }
  if (row.isGroupBooking === true
      || row.isGroup === true
      || archivePreviewHasAny(row, ["groupId", "groupBookingId", "groupRole", "groupLeadId", "groupMemberId"])
      || Number(row.groupSize || 0) > 1) {
    reasons.push("Group booking fields present; archived under owner-approved cutoff policy.");
  }
  if (archivePreviewHasAny(row, ["receiptRef", "receiptId", "receiptNumber", "receiptUrl"])) {
    reasons.push("Receipt reference present; archived under owner-approved cutoff policy.");
  }
  if (archivePreGoLiveHasGiftPackagePromoSplitRisk(row)) {
    reasons.push("Gift/package/promo/voucher/split fields present; archived under owner-approved cutoff policy.");
  }
  const status = archivePreviewStatus(row);
  if (status) reasons.push(`Status: ${status}.`);
  return reasons;
}

function archivePreGoLiveRecordBase(collection, row, business) {
  return {
    collection,
    docId: row.__docId,
    dateField: business.field,
    businessDate: business.value,
    createdAt: archivePreGoLiveTimestampIso(row.createdAt || row.__createTime),
    status: archivePreviewStatus(row),
    paymentStatus: archivePreviewText(row, ["paymentStatus", "paymentState"]),
    clientName: archivePreviewText(row, ["clientName", "name", "fullName", "leadName"]),
    clientPhone: archivePreviewText(row, ["clientPhone", "phone", "phoneNumber"]),
    clientId: archivePreviewText(row, ["clientId", "clientEmail", "clientPhone", "email"]),
    assignedTechName: archivePreviewText(row, ["assignedTechName", "techName", "technicianName", "staffName"]),
    serviceNames: archivePreGoLiveServiceNames(row),
    groupId: archivePreviewText(row, ["groupId", "groupBookingId"]),
    appointmentId: archivePreviewText(row, ["sourceAppointmentId", "appointmentId", "bookingId"]),
    jobId: archivePreviewText(row, ["jobId", "activeJobId"]) || (collection === ACTIVE_JOBS_COLLECTION ? row.__docId : ""),
    receiptRef: archivePreviewText(row, ["receiptRef", "receiptId", "receiptNumber"]),
    giftCardCode: archivePreviewText(row, ["giftCardCode", "appliedGiftCardCode", "voucherCode"])
  };
}

function archivePreGoLiveTargetRecord(collection, row, business) {
  return {
    ...archivePreGoLiveRecordBase(collection, row, business),
    financialSummary: collection === ACTIVE_JOBS_COLLECTION ? archivePreGoLiveFinancialSummary(row) : null,
    archiveDecision: "owner_approved_pre_go_live_target",
    riskLevel: "policy_approved",
    riskReasons: archivePreGoLiveRiskReasons(collection, row, business)
  };
}

function archivePreGoLiveAlreadyArchivedRecord(collection, row, business) {
  return {
    ...archivePreGoLiveRecordBase(collection, row, business),
    archiveBatchId: archivePreviewText(row, ["archiveBatchId"]),
    archivedAt: archivePreGoLiveTimestampIso(row.archivedAt),
    archivedBy: archivePreviewText(row, ["archivedBy"]),
    archivedReason: archivePreviewText(row, ["archivedReason"])
  };
}

function archivePreGoLiveProtectionRecord(collection, row, business) {
  return {
    collection,
    docId: row.__docId,
    businessDate: business.value,
    status: archivePreviewStatus(row),
    archived: row.archived === true,
    archiveBatchId: archivePreviewText(row, ["archiveBatchId"]),
    archivedAt: archivePreGoLiveTimestampIso(row.archivedAt),
    archivedReason: archivePreviewText(row, ["archivedReason"])
  };
}

function archivePreGoLiveCompactRow(row) {
  return {
    collection: row.collection,
    docId: row.docId,
    businessDate: row.businessDate,
    status: row.status,
    clientName: row.clientName,
    archiveDecision: row.archiveDecision,
    riskLevel: row.riskLevel
  };
}

function archivePreGoLiveClientIdentifiers(row) {
  return Array.from(new Set([
    archivePreviewText(row, ["clientId", "clientPhone", "clientEmail", "email"]),
    archivePreviewText(row, ["clientPhone", "phone", "phoneNumber"]),
    archivePreviewText(row, ["clientEmail", "email"]),
    archivePreviewText(row, ["clientName", "name", "fullName"])
  ].map(value => archivePreviewLinkKey(value)).filter(Boolean)));
}

function archivePreGoLiveRowMatchesClient(row, identifiers) {
  if (!identifiers.length) return false;
  const rowValues = archivePreGoLiveClientIdentifiers(row);
  return rowValues.some(value => identifiers.includes(value));
}

function archivePreGoLivePostGoLiveClientMatches(activeJobRows, collectionRows, cutoffDate) {
  const postRows = [];
  [ACTIVE_JOBS_COLLECTION, ARCHIVE_APPOINTMENTS_COLLECTION].forEach((collection) => {
    (collectionRows[collection] || []).forEach((row) => {
      if (row.archived === true) return;
      const business = archivePreviewBusinessDate(collection, row);
      if (!business.value || business.value < cutoffDate) return;
      postRows.push({ collection, row, business });
    });
  });

  const matches = [];
  const activeJobsWithMatches = new Set();
  activeJobRows.forEach((activeJob) => {
    const identifiers = archivePreGoLiveClientIdentifiers(activeJob);
    if (!identifiers.length) return;
    postRows.forEach((entry) => {
      if (entry.collection === ACTIVE_JOBS_COLLECTION && entry.row.__docId === activeJob.__docId) return;
      if (!archivePreGoLiveRowMatchesClient(entry.row, identifiers)) return;
      activeJobsWithMatches.add(activeJob.__docId);
      matches.push({
        targetActiveJobId: activeJob.__docId,
        collection: entry.collection,
        docId: entry.row.__docId,
        businessDate: entry.business.value,
        status: archivePreviewStatus(entry.row),
        clientName: archivePreviewText(entry.row, ["clientName", "name", "fullName"])
      });
    });
  });

  const seen = new Set();
  const uniqueMatches = matches.filter((entry) => {
    const key = `${entry.targetActiveJobId}:${entry.collection}:${entry.docId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    activeJobsWithMatches: activeJobsWithMatches.size,
    matches: uniqueMatches
  };
}

function archivePreGoLiveLinkedRecordSummary(activeJobRows, collectionRows, cutoffDate) {
  const appointmentById = new Map();
  (collectionRows[ARCHIVE_APPOINTMENTS_COLLECTION] || []).forEach((row) => {
    appointmentById.set(archivePreviewLinkKey(row.__docId), row);
  });

  let linkedAppointmentCount = 0;
  let linkedAppointmentPreGoLiveCount = 0;
  let linkedAppointmentAlreadyArchivedCount = 0;
  let groupLinkedCount = 0;
  let receiptLinkedCount = 0;
  let giftPackagePromoSplitRiskCount = 0;
  const linkedAppointmentSamples = [];

  activeJobRows.forEach((row) => {
    const appointmentId = archivePreviewText(row, ["sourceAppointmentId", "appointmentId", "bookingId"]);
    const appointment = appointmentById.get(archivePreviewLinkKey(appointmentId));
    if (appointment) {
      linkedAppointmentCount++;
      const business = archivePreviewBusinessDate(ARCHIVE_APPOINTMENTS_COLLECTION, appointment);
      if (business.value && business.value < cutoffDate) linkedAppointmentPreGoLiveCount++;
      if (appointment.archived === true) linkedAppointmentAlreadyArchivedCount++;
      if (linkedAppointmentSamples.length < ARCHIVE_PRE_GO_LIVE_POLICY_SAMPLE_LIMIT) {
        linkedAppointmentSamples.push({
          activeJobId: row.__docId,
          appointmentId,
          appointmentBusinessDate: business.value,
          appointmentArchived: appointment.archived === true
        });
      }
    }
    if (row.isGroupBooking === true
        || row.isGroup === true
        || archivePreviewHasAny(row, ["groupId", "groupBookingId", "groupRole", "groupLeadId", "groupMemberId"])
        || Number(row.groupSize || 0) > 1) {
      groupLinkedCount++;
    }
    if (archivePreviewHasAny(row, ["receiptRef", "receiptId", "receiptNumber", "receiptUrl"])) {
      receiptLinkedCount++;
    }
    if (archivePreGoLiveHasGiftPackagePromoSplitRisk(row)) {
      giftPackagePromoSplitRiskCount++;
    }
  });

  const postGoLiveMatches = archivePreGoLivePostGoLiveClientMatches(activeJobRows, collectionRows, cutoffDate);

  return {
    linkedAppointmentCount,
    linkedAppointmentPreGoLiveCount,
    linkedAppointmentAlreadyArchivedCount,
    groupLinkedCount,
    receiptLinkedCount,
    giftPackagePromoSplitRiskCount,
    clientPostGoLiveActivityCount: postGoLiveMatches.matches.length,
    activeJobTargetsWithPostGoLiveClientActivity: postGoLiveMatches.activeJobsWithMatches,
    linkedAppointmentSamples,
    clientPostGoLiveActivitySamples: postGoLiveMatches.matches.slice(0, ARCHIVE_PRE_GO_LIVE_POLICY_SAMPLE_LIMIT)
  };
}

function archivePreGoLiveAddFinancialImpact(impact, row) {
  const financial = archivePreGoLiveFinancialSummary(row);
  for (const key of ["netRevenue", "paidAmount", "commissionEstimate", "taxFromTaxTotal",
    "normalizedTaxFromTaxBreakdown", "grossServiceValue", "complimentaryWaived", "originalGross",
    "adjustedGross", "amountDue", "adjustmentAmount", "refundAmount", "discountAmount"]) {
    impact[key] = sumKnownMoney([impact[key] === undefined ? 0 : impact[key], financial[key]]);
  }
  impact.completedJobsCount += financial.completedJobsImpact;
  impact.normalizedTaxEstimate = impact.normalizedTaxFromTaxBreakdown;
  impact.unavailableFields = Object.keys(financial).filter(key => financial[key] === null || impact[key] === null);
  impact.financialContradictions = [...new Set([...(impact.financialContradictions || []), ...financial.financialContradictions])];
  impact.inconsistentRecordCount = (impact.inconsistentRecordCount || 0) + (financial.financialContradictions.length ? 1 : 0);
  impact.partial = impact.unavailableFields.length > 0 || impact.inconsistentRecordCount > 0;
}

async function buildPreGoLivePolicyArchivePreview(data, callerEmail) {
  const options = archivePreGoLiveValidateRequest(data);
  const warnings = [];
  if (options.dateTo >= options.cutoffDate) {
    warnings.push({
      code: "date_range_crosses_go_live",
      message: "Rows on or after the cutoff are protected and will not be returned as archive targets."
    });
  }

  const { collectionRows, scannedCollections } = await archivePreviewReadCollections(options.collections, warnings);
  const generatedAt = new Date().toISOString();
  const collectionsSummary = {};
  const targetRecords = [];
  const alreadyArchivedRecords = [];
  const postGoLiveProtectionSummary = [];
  const activeJobTargetRows = [];
  const financialImpact = {
    activeJobTargetCount: 0,
    netRevenue: 0,
    paidAmount: 0,
    completedJobsCount: 0,
    commissionRate: ARCHIVE_PRE_GO_LIVE_COMMISSION_RATE,
    commissionEstimate: 0,
    taxFromTaxTotal: 0,
    normalizedTaxFromTaxBreakdown: 0,
    normalizedTaxEstimate: 0,
    grossServiceValue: 0,
    complimentaryWaived: 0
  };

  options.collections.forEach((collection) => {
    const summary = archivePreGoLiveEnsureCollectionSummary(collectionsSummary, collection);
    summary.scannedCount = scannedCollections[collection] || 0;

    const protectedRows = [];
    const archivedPostGoLiveRows = [];

    (collectionRows[collection] || []).forEach((row) => {
      const business = archivePreviewBusinessDate(collection, row);
      if (!business.value) {
        summary.skippedInvalidDateCount++;
        return;
      }

      if (business.value >= options.cutoffDate) {
        summary.protectedPostGoLiveCount++;
        const protectedRow = archivePreGoLiveProtectionRecord(collection, row, business);
        protectedRows.push(protectedRow);
        if (row.archived === true) {
          summary.alreadyArchivedPostGoLiveCount++;
          archivedPostGoLiveRows.push(protectedRow);
        }
        return;
      }

      if (!archivePreviewIsInRange(business.value, options.dateFrom, options.dateTo)) {
        summary.outsideRequestedRangeCount++;
        return;
      }

      if (row.archived === true) {
        summary.alreadyArchivedCount++;
        alreadyArchivedRecords.push(archivePreGoLiveAlreadyArchivedRecord(collection, row, business));
        return;
      }

      const target = archivePreGoLiveTargetRecord(collection, row, business);
      summary.unarchivedTargetCount++;
      if (summary.sampleRows.length < ARCHIVE_PRE_GO_LIVE_POLICY_SAMPLE_LIMIT) {
        summary.sampleRows.push(archivePreGoLiveCompactRow(target));
      }
      targetRecords.push(target);

      if (collection === ACTIVE_JOBS_COLLECTION) {
        activeJobTargetRows.push(row);
        financialImpact.activeJobTargetCount++;
        archivePreGoLiveAddFinancialImpact(financialImpact, row);
      }
    });

    if (archivedPostGoLiveRows.length) {
      warnings.push({
        collection,
        code: "post_go_live_archived_record_present",
        message: `${archivedPostGoLiveRows.length} post-go-live ${collection} record(s) are already archived and remain protected from this policy.`
      });
    }

    postGoLiveProtectionSummary.push({
      collection,
      protectedCount: protectedRows.length,
      alreadyArchivedPostGoLiveCount: archivedPostGoLiveRows.length,
      sampleProtectedRows: protectedRows.slice(0, ARCHIVE_PRE_GO_LIVE_POLICY_SAMPLE_LIMIT),
      sampleArchivedPostGoLiveRows: archivedPostGoLiveRows.slice(0, ARCHIVE_PRE_GO_LIVE_POLICY_SAMPLE_LIMIT),
      warning: archivedPostGoLiveRows.length
        ? "Post-go-live archived records exist in staging; this policy preview does not target or change them."
        : ""
    });
  });

  const linkedRecordSummary = archivePreGoLiveLinkedRecordSummary(
    activeJobTargetRows,
    collectionRows,
    options.cutoffDate
  );
  const totalUnarchivedTargets = Object.values(collectionsSummary)
    .reduce((sum, summary) => sum + summary.unarchivedTargetCount, 0);
  const totalAlreadyArchived = Object.values(collectionsSummary)
    .reduce((sum, summary) => sum + summary.alreadyArchivedCount, 0);
  const totalProtectedPostGoLive = Object.values(collectionsSummary)
    .reduce((sum, summary) => sum + summary.protectedPostGoLiveCount, 0);

  logger.info("Pre-go-live policy archive preview generated", {
    readOnly: true,
    callerEmail,
    policyId: options.policyId,
    scope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    collections: options.collections,
    targetCount: totalUnarchivedTargets,
    alreadyArchivedCount: totalAlreadyArchived,
    protectedPostGoLiveCount: totalProtectedPostGoLive
  });

  return {
    ok: true,
    readOnly: true,
    previewOnly: true,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    policyLabel: ARCHIVE_PRE_GO_LIVE_POLICY_LABEL,
    scope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    cutoffDate: options.cutoffDate,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    generatedAt,
    collections: options.collections,
    counts: {
      unarchivedTargetCount: totalUnarchivedTargets,
      alreadyArchivedCount: totalAlreadyArchived,
      protectedPostGoLiveCount: totalProtectedPostGoLive
    },
    collectionsSummary,
    targetRecords,
    alreadyArchivedRecords,
    financialImpact,
    linkedRecordSummary,
    postGoLiveProtectionSummary,
    rollbackReadiness: {
      rollbackAvailable: true,
      rollbackScope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
      deleteCount: 0,
      sourceRecordsDeleted: false
    },
    warnings
  };
}

function archiveProductionPreGoLiveManifestBaseRows(preview) {
  const rows = Array.isArray(preview && preview.targetRecords) ? preview.targetRecords : [];
  return rows
    .map((row) => ({
      collection: String(row.collection || "").trim(),
      docId: String(row.docId || "").trim(),
      businessDate: String(row.businessDate || "").trim(),
      archiveDecision: String(row.archiveDecision || "").trim(),
      riskLevel: String(row.riskLevel || "").trim()
    }))
    .sort((a, b) => `${a.collection}:${a.docId}`.localeCompare(`${b.collection}:${b.docId}`));
}

function archiveProductionPreGoLiveManifestHash(preview, manifestRows) {
  const hashInput = archiveStableValue({
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_PREVIEW_SCOPE,
    cutoffDate: preview && preview.cutoffDate,
    dateFrom: preview && preview.dateFrom,
    dateTo: preview && preview.dateTo,
    collections: Array.isArray(preview && preview.collections) ? preview.collections.slice().sort() : [],
    manifestRows: Array.isArray(manifestRows) ? manifestRows : []
  });
  return crypto.createHash("sha256")
    .update(JSON.stringify(hashInput), "utf8")
    .digest("hex");
}

function archiveProductionPreGoLiveManifestMetadata(manifestHash, recordCount) {
  return {
    manifestHash,
    recordCount,
    hashAlgorithm: "sha256",
    hashVersion: 1,
    hashExcludes: ["generatedAt"],
    canonicalSort: "collection + docId",
    csvFields: [
      "manifestHash",
      "collection",
      "docId",
      "businessDate",
      "archiveDecision",
      "riskLevel"
    ],
    jsonFields: [
      "metadata",
      "summary",
      "manifestRows",
      "warnings"
    ]
  };
}

function archiveProductionPreGoLiveReceiptHistoryImpact(linkedRecordSummary) {
  const receiptLinkedCount = Number(linkedRecordSummary && linkedRecordSummary.receiptLinkedCount) || 0;
  return {
    receiptLinkedCount,
    normalReceiptHistoryHideCount: receiptLinkedCount,
    directReprintMutation: false,
    note: "Future execution would hide archived records from normal Completed Jobs / Receipt History views through Archive Shield."
  };
}

function archiveProductionPreGoLiveClientHistoryImpact(linkedRecordSummary) {
  return {
    clientPostGoLiveActivityCount: Number(linkedRecordSummary && linkedRecordSummary.clientPostGoLiveActivityCount) || 0,
    activeJobTargetsWithPostGoLiveClientActivity:
      Number(linkedRecordSummary && linkedRecordSummary.activeJobTargetsWithPostGoLiveClientActivity) || 0,
    linkedAppointmentCount: Number(linkedRecordSummary && linkedRecordSummary.linkedAppointmentCount) || 0,
    linkedAppointmentPreGoLiveCount: Number(linkedRecordSummary && linkedRecordSummary.linkedAppointmentPreGoLiveCount) || 0,
    linkedAppointmentAlreadyArchivedCount:
      Number(linkedRecordSummary && linkedRecordSummary.linkedAppointmentAlreadyArchivedCount) || 0,
    note: "Post-go-live client activity is protected and reported for owner review; preview does not mutate client history."
  };
}

function archiveProductionPreGoLiveCommissionImpact(financialImpact) {
  const commissionEstimate = financialEvidence.amount(financialImpact && financialImpact.commissionEstimate);
  return {
    commissionRate: ARCHIVE_PRE_GO_LIVE_COMMISSION_RATE,
    activeJobTargetCount: Number(financialImpact && financialImpact.activeJobTargetCount) || 0,
    estimatedCommissionReduction: commissionEstimate === null ? null : archivePreGoLiveRound(-commissionEstimate),
    commissionEstimate,
    note: "Commission impact is an estimate from the pre-go-live preview financial summary."
  };
}

async function buildProductionPreGoLiveArchivePreview(data, callerEmail) {
  const preview = await buildPreGoLivePolicyArchivePreview(data || {}, callerEmail);
  const manifestBaseRows = archiveProductionPreGoLiveManifestBaseRows(preview);
  const manifestHash = archiveProductionPreGoLiveManifestHash(preview, manifestBaseRows);
  const manifestRows = manifestBaseRows.map(row => ({ manifestHash, ...row }));
  const recordCount = manifestRows.length;
  const linkedRecordSummary = preview.linkedRecordSummary || {};
  const financialImpact = preview.financialImpact || {};

  return {
    ok: true,
    readOnly: true,
    previewOnly: true,
    executionEnabled: false,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    policyLabel: ARCHIVE_PRE_GO_LIVE_POLICY_LABEL,
    scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_PREVIEW_SCOPE,
    cutoffDate: preview.cutoffDate,
    dateFrom: preview.dateFrom,
    dateTo: preview.dateTo,
    generatedAt: preview.generatedAt,
    manifestHash,
    recordCount,
    counts: preview.counts || {},
    collections: preview.collections || [],
    collectionsSummary: preview.collectionsSummary || {},
    financialImpact,
    linkedRecordSummary,
    receiptHistoryImpact: archiveProductionPreGoLiveReceiptHistoryImpact(linkedRecordSummary),
    clientHistoryImpact: archiveProductionPreGoLiveClientHistoryImpact(linkedRecordSummary),
    commissionImpact: archiveProductionPreGoLiveCommissionImpact(financialImpact),
    postGoLiveProtectionSummary: preview.postGoLiveProtectionSummary || [],
    rollbackReadiness: {
      rollbackAvailableAfterFutureExecution: true,
      rollbackScope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
      snapshotRequired: true,
      deleteCount: 0,
      sourceRecordsDeleted: false,
      note: "Rollback is not executed by this preview. Future execution must create Archive_Batches snapshots before rollback can be used."
    },
    manifestMetadata: archiveProductionPreGoLiveManifestMetadata(manifestHash, recordCount),
    manifestRows,
    targetRecords: preview.targetRecords || [],
    alreadyArchivedRecords: preview.alreadyArchivedRecords || [],
    warnings: preview.warnings || []
  };
}

function archiveProductionPreGoLiveReason(code, message, expected, actual) {
  const reason = { code, message };
  if (expected !== undefined) reason.expected = expected;
  if (actual !== undefined) reason.actual = actual;
  return reason;
}

function archiveProductionPreGoLiveFailure(mode, errorCode, reasons, checks, approval, currentPreview, warnings) {
  return {
    ok: false,
    mode: mode || "preflight",
    readOnly: true,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    executionEnabled: false,
    executable: false,
    errorCode,
    reasons: Array.isArray(reasons) ? reasons : [],
    warnings: Array.isArray(warnings) ? warnings : [],
    checks: checks || {},
    approval: approval || {},
    currentPreview: currentPreview || {}
  };
}

function archiveProductionPreGoLiveProtectedCountDriftWarning(label, approvedCount, currentCount) {
  const approvedProtectedPostGoLiveCount = Number(approvedCount) || 0;
  const currentProtectedPostGoLiveCount = Number(currentCount) || 0;
  return {
    code: "PROTECTED_COUNT_DRIFT_INFORMATIONAL",
    message: `${label} changed while archive target manifest/counts remained stable.`,
    approvedProtectedPostGoLiveCount,
    currentProtectedPostGoLiveCount,
    protectedPostGoLiveDrift: currentProtectedPostGoLiveCount - approvedProtectedPostGoLiveCount
  };
}

function archiveProductionPreGoLiveApprovalSummary(approvalId, approval) {
  if (!approval) return {};
  return {
    approvalId,
    status: String(approval.status || ""),
    scope: String(approval.scope || ""),
    policyId: String(approval.policyId || ""),
    cutoffDate: archivePreviewDateString(approval.cutoffDate),
    executionEnvironment: String(approval.executionEnvironment || ""),
    projectId: String(approval.projectId || ""),
    manifestHash: String(approval.manifestHash || ""),
    manifestGeneratedAt: String(approval.manifestGeneratedAt || approval.generatedAt || ""),
    targetCount: Number(approval.targetCount || 0),
    activeJobsTargetCount: Number(approval.activeJobsTargetCount || 0),
    appointmentsTargetCount: Number(approval.appointmentsTargetCount || 0),
    attendanceTargetCount: Number(approval.attendanceTargetCount || 0),
    protectedPostGoLiveCount: Number(approval.protectedPostGoLiveCount || 0),
    approverEmail: normalizeEmail(approval.approverEmail),
    approvedAt: archivePreGoLiveTimestampIso(approval.approvedAt)
  };
}

function archiveProductionPreGoLivePreviewSummary(preview) {
  if (!preview) return {};
  const collectionCounts = {};
  ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.forEach((collection) => {
    collectionCounts[collection] = archiveProductionPreGoLiveCollectionTargetCount(preview, collection);
  });
  return {
    manifestHash: String(preview.manifestHash || ""),
    generatedAt: String(preview.generatedAt || ""),
    targetCount: Number(preview.recordCount || 0),
    collectionCounts,
    protectedPostGoLiveCount: archiveProductionPreGoLiveProtectedPostGoLiveCount(preview),
    postGoLiveTargetCount: archiveProductionPreGoLivePostGoLiveTargetCount(preview),
    warningsCount: Array.isArray(preview.warnings) ? preview.warnings.length : 0
  };
}

function archiveProductionPreGoLiveCollectionTargetCount(preview, collection) {
  const summary = preview && preview.collectionsSummary && preview.collectionsSummary[collection];
  return Number(summary && summary.unarchivedTargetCount) || 0;
}

function archiveProductionPreGoLiveProtectedPostGoLiveCount(preview) {
  if (preview && preview.counts && Number.isFinite(Number(preview.counts.protectedPostGoLiveCount))) {
    return Number(preview.counts.protectedPostGoLiveCount);
  }
  return ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.reduce((sum, collection) => {
    const summary = preview && preview.collectionsSummary && preview.collectionsSummary[collection];
    return sum + (Number(summary && summary.protectedPostGoLiveCount) || 0);
  }, 0);
}

function archiveProductionPreGoLivePostGoLiveTargetCount(preview) {
  const rows = Array.isArray(preview && preview.targetRecords) ? preview.targetRecords : [];
  return rows.filter((row) => String(row && row.businessDate || "") >= ARCHIVE_GO_LIVE_CUTOFF_DATE).length;
}

function archiveProductionPreGoLiveAddEqualityReason(reasons, code, label, expected, actual) {
  if (actual !== expected) {
    reasons.push(archiveProductionPreGoLiveReason(
      code,
      `${label} mismatch.`,
      expected,
      actual
    ));
    return false;
  }
  return true;
}

function archiveProductionPreGoLiveRequiredAcceptanceFields() {
  return [
    "rollbackConfirmed",
    "csvManifestRetained",
    "jsonManifestRetained",
    "receiptImpactAccepted",
    "clientHistoryImpactAccepted",
    "commissionImpactAccepted",
    "linkedAppointmentFallbackAccepted"
  ];
}

function archiveProductionPreGoLiveResolveApprovedPreview(projectId, mode) {
  if (mode !== "preflight") return null;
  if (projectId === ARCHIVE_PRODUCTION_PROJECT_ID) return ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVED_PREVIEW;
  if (projectId === ARCHIVE_STAGING_PROJECT_ID) return ARCHIVE_STAGING_PRE_GO_LIVE_CERTIFIED_PREVIEW;
  return null;
}

function archiveProductionPreGoLiveManifestMatchesRequired(approved) {
  return Boolean(approved && approved.manifestHash && approved.generatedAt);
}

function archiveProductionPreGoLiveValidateOptionalManifestField(
  reasons,
  code,
  label,
  expected,
  actual,
  required
) {
  if (!required && !expected && !actual) return true;
  return archiveProductionPreGoLiveAddEqualityReason(reasons, code, label, expected, actual);
}

function archiveProductionPreGoLiveValidateApproval(approvalId, approval, requestData, checks, reasons, warnings, approved) {
  const approvalSummary = archiveProductionPreGoLiveApprovalSummary(approvalId, approval);
  const manifestRequired = archiveProductionPreGoLiveManifestMatchesRequired(approved);

  checks.approvalRecordValid = true;
  checks.approvalApproved = approvalSummary.status === "approved";
  if (!checks.approvalApproved) {
    reasons.push(archiveProductionPreGoLiveReason(
      "APPROVAL_NOT_APPROVED",
      "Approval record must have status approved.",
      "approved",
      approvalSummary.status
    ));
  }

  checks.scopeMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "POLICY_MISMATCH",
    "Approval scope",
    approved.scope,
    approvalSummary.scope
  );
  checks.approvalProjectMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "PROJECT_MISMATCH",
    "Approval project",
    approved.projectId,
    approvalSummary.projectId
  );
  checks.executionEnvironmentMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "PROJECT_MISMATCH",
    "Approval execution environment",
    approved.environment,
    approvalSummary.executionEnvironment
  );
  checks.policyMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "POLICY_MISMATCH",
    "Policy id",
    ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    String(requestData.policyId || "")
  ) && archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "POLICY_MISMATCH",
    "Approval policy id",
    ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    approvalSummary.policyId
  );
  checks.cutoffMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "CUTOFF_MISMATCH",
    "Cutoff date",
    ARCHIVE_GO_LIVE_CUTOFF_DATE,
    archivePreviewDateString(requestData.cutoffDate)
  ) && archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "CUTOFF_MISMATCH",
    "Approval cutoff date",
    ARCHIVE_GO_LIVE_CUTOFF_DATE,
    approvalSummary.cutoffDate
  );
  checks.manifestHashMatches = archiveProductionPreGoLiveValidateOptionalManifestField(
    reasons,
    "MANIFEST_HASH_MISMATCH",
    "Manifest hash",
    approved.manifestHash,
    String(requestData.manifestHash || ""),
    manifestRequired
  ) && archiveProductionPreGoLiveValidateOptionalManifestField(
    reasons,
    "MANIFEST_HASH_MISMATCH",
    "Approval manifest hash",
    approved.manifestHash,
    approvalSummary.manifestHash,
    manifestRequired
  );
  checks.generatedAtMatches = archiveProductionPreGoLiveValidateOptionalManifestField(
    reasons,
    "GENERATED_AT_MISMATCH",
    "Manifest generatedAt",
    approved.generatedAt,
    String(requestData.generatedAt || ""),
    manifestRequired
  ) && archiveProductionPreGoLiveValidateOptionalManifestField(
    reasons,
    "GENERATED_AT_MISMATCH",
    "Approval manifest generatedAt",
    approved.generatedAt,
    approvalSummary.manifestGeneratedAt,
    manifestRequired
  );
  checks.targetCountMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "TARGET_COUNT_MISMATCH",
    "Expected target count",
    approved.targetCount,
    Number(requestData.expectedCount || 0)
  ) && archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "TARGET_COUNT_MISMATCH",
    "Approval target count",
    approved.targetCount,
    approvalSummary.targetCount
  );
  checks.collectionCountsMatch = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "COLLECTION_COUNT_MISMATCH",
    "Approval Active_Jobs target count",
    approved.collectionCounts.Active_Jobs,
    approvalSummary.activeJobsTargetCount
  ) && archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "COLLECTION_COUNT_MISMATCH",
    "Approval Appointments target count",
    approved.collectionCounts.Appointments,
    approvalSummary.appointmentsTargetCount
  ) && archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "COLLECTION_COUNT_MISMATCH",
    "Approval Attendance target count",
    approved.collectionCounts.Attendance,
    approvalSummary.attendanceTargetCount
  );
  checks.protectedCountMatches = approved.protectedPostGoLiveCount === approvalSummary.protectedPostGoLiveCount;
  checks.approvedProtectedPostGoLiveCount = approved.protectedPostGoLiveCount;
  checks.approvalProtectedPostGoLiveCount = approvalSummary.protectedPostGoLiveCount;
  checks.approvalProtectedPostGoLiveDrift =
    approvalSummary.protectedPostGoLiveCount - approved.protectedPostGoLiveCount;
  if (!checks.protectedCountMatches) {
    warnings.push(archiveProductionPreGoLiveProtectedCountDriftWarning(
      "Approval protected post-go-live count",
      approved.protectedPostGoLiveCount,
      approvalSummary.protectedPostGoLiveCount
    ));
  }
  if (Number.isFinite(Number(approved.alreadyArchivedPreGoLiveCount))) {
    checks.alreadyArchivedPreGoLiveCountMatches = archiveProductionPreGoLiveAddEqualityReason(
      reasons,
      "TARGET_COUNT_MISMATCH",
      "Approval already archived pre-go-live count",
      Number(approved.alreadyArchivedPreGoLiveCount),
      Number(approval.alreadyArchivedPreGoLiveCount || 0)
    );
  }
  checks.stagingHarnessMode = approved.harnessMode || "";

  const missingAcceptance = archiveProductionPreGoLiveRequiredAcceptanceFields()
    .filter((field) => approval[field] !== true);
  if (!String(approval.approvalPhrase || "").trim()) {
    missingAcceptance.push("approvalPhrase");
  }
  checks.acceptanceComplete = missingAcceptance.length === 0;
  if (missingAcceptance.length) {
    reasons.push(archiveProductionPreGoLiveReason(
      "ACCEPTANCE_MISSING",
      "Approval record is missing required owner acceptance fields.",
      "all required acceptance fields true and approvalPhrase present",
      missingAcceptance
    ));
  }

  return approvalSummary;
}

function archiveProductionPreGoLiveValidateCurrentPreview(preview, checks, reasons, warnings, approved) {
  const currentPreview = archiveProductionPreGoLivePreviewSummary(preview);
  const manifestRequired = archiveProductionPreGoLiveManifestMatchesRequired(approved);

  checks.currentManifestHashMatches = archiveProductionPreGoLiveValidateOptionalManifestField(
    reasons,
    "MANIFEST_HASH_MISMATCH",
    "Current preview manifest hash",
    approved.manifestHash,
    currentPreview.manifestHash,
    manifestRequired
  );
  checks.currentTargetCountMatches = archiveProductionPreGoLiveAddEqualityReason(
    reasons,
    "TARGET_COUNT_MISMATCH",
    "Current preview target count",
    approved.targetCount,
    currentPreview.targetCount
  );
  checks.currentCollectionCountsMatch = ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.every((collection) => {
    return archiveProductionPreGoLiveAddEqualityReason(
      reasons,
      "COLLECTION_COUNT_MISMATCH",
      `Current preview ${collection} target count`,
      approved.collectionCounts[collection],
      currentPreview.collectionCounts[collection]
    );
  });
  checks.currentProtectedCountMatches = approved.protectedPostGoLiveCount === currentPreview.protectedPostGoLiveCount;
  checks.currentProtectedPostGoLiveCount = currentPreview.protectedPostGoLiveCount;
  checks.protectedPostGoLiveDrift =
    currentPreview.protectedPostGoLiveCount - approved.protectedPostGoLiveCount;
  if (!checks.currentProtectedCountMatches) {
    warnings.push(archiveProductionPreGoLiveProtectedCountDriftWarning(
      "Current preview protected post-go-live count",
      approved.protectedPostGoLiveCount,
      currentPreview.protectedPostGoLiveCount
    ));
  }
  checks.postGoLiveTargetsZero = currentPreview.postGoLiveTargetCount === 0;
  if (!checks.postGoLiveTargetsZero) {
    reasons.push(archiveProductionPreGoLiveReason(
      "POST_GO_LIVE_TARGETS_FOUND",
      "Current preview returned post-go-live target records.",
      0,
      currentPreview.postGoLiveTargetCount
    ));
  }

  return currentPreview;
}

async function executeProductionPreGoLiveArchivePreflight(data, authInfo) {
  const mode = String(data && data.mode || "").trim();
  const projectId = currentFirebaseProjectId();
  const checks = {
    systemAdmin: true,
    project: projectId,
    executionEnabled: false
  };

  if (mode !== "preflight") {
    return archiveProductionPreGoLiveFailure(
      mode || "execute",
      "EXECUTION_DISABLED",
      [archiveProductionPreGoLiveReason(
        "EXECUTION_DISABLED",
        "Production pre-go-live archive execution is disabled. Only preflight mode is implemented."
      )],
      checks
    );
  }

  const approved = archiveProductionPreGoLiveResolveApprovedPreview(projectId, mode);
  if (!approved) {
    return archiveProductionPreGoLiveFailure(
      "preflight",
      "PROJECT_MISMATCH",
      [archiveProductionPreGoLiveReason(
        "PROJECT_MISMATCH",
        "Pre-go-live preflight is only available on the approved production project or staging preflight harness.",
        [ARCHIVE_PRODUCTION_PROJECT_ID, ARCHIVE_STAGING_PROJECT_ID],
        projectId
      )],
      checks
    );
  }
  checks.environment = approved.environment;
  checks.stagingHarnessMode = approved.harnessMode || "";

  const approvalId = String(data && data.approvalId || "").trim();
  if (!approvalId || approvalId.includes("/")) {
    return archiveProductionPreGoLiveFailure(
      "preflight",
      "APPROVAL_NOT_FOUND",
      [archiveProductionPreGoLiveReason(
        "APPROVAL_NOT_FOUND",
        "A valid Archive_Execution_Approvals approvalId is required."
      )],
      checks
    );
  }

  const approvalSnap = await db.collection(ARCHIVE_EXECUTION_APPROVALS_COLLECTION).doc(approvalId).get();
  if (!approvalSnap.exists) {
    return archiveProductionPreGoLiveFailure(
      "preflight",
      "APPROVAL_NOT_FOUND",
      [archiveProductionPreGoLiveReason(
        "APPROVAL_NOT_FOUND",
        "Archive execution approval record was not found.",
        `${ARCHIVE_EXECUTION_APPROVALS_COLLECTION}/${approvalId}`,
        "missing"
      )],
      checks
    );
  }

  const approval = approvalSnap.data() || {};
  const reasons = [];
  const warnings = [];
  const approvalSummary = archiveProductionPreGoLiveValidateApproval(
    approvalId,
    approval,
    data || {},
    checks,
    reasons,
    warnings,
    approved
  );

  let currentPreview = {};
  try {
    const preview = await buildProductionPreGoLiveArchivePreview({
      dateFrom: approved.dateFrom,
      dateTo: approved.dateTo,
      cutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
      policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
      collections: ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS,
      previewOnly: true
    }, authInfo.email);
    currentPreview = archiveProductionPreGoLiveValidateCurrentPreview(preview, checks, reasons, warnings, approved);
  } catch (error) {
    checks.previewRerunSucceeded = false;
    reasons.push(archiveProductionPreGoLiveReason(
      "PREVIEW_RERUN_FAILED",
      "Production preview rerun failed during preflight.",
      "preview rerun succeeds",
      error && error.message ? error.message : String(error || "")
    ));
  }

  checks.rollbackConfirmedByApproval = approval.rollbackConfirmed === true;
  checks.archiveBatchSnapshotModelReady = true;
  checks.deletePreventionReady = true;
  checks.firestoreWrites = 0;
  checks.firestoreDeletes = 0;

  if (reasons.length) {
    return archiveProductionPreGoLiveFailure(
      "preflight",
      reasons[0].code,
      reasons,
      checks,
      approvalSummary,
      currentPreview,
      warnings
    );
  }

  return {
    ok: true,
    mode: "preflight",
    readOnly: true,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    executionEnabled: false,
    executable: true,
    reasons: [],
    warnings,
    checks,
    approval: approvalSummary,
    currentPreview
  };
}

function archiveProductionPreGoLiveAssertProductionProject() {
  const projectId = currentFirebaseProjectId();
  if (projectId !== ARCHIVE_PRODUCTION_PROJECT_ID) {
    throw new HttpsError("failed-precondition", "Production pre-go-live archive execution is available on the production project only.");
  }
  return projectId;
}

function archiveProductionPreGoLiveValidateApprovalId(value) {
  const approvalId = String(value || "").trim();
  if (!approvalId || approvalId.includes("/")) {
    throw new HttpsError("invalid-argument", "A valid approvalId is required.");
  }
  return approvalId;
}

async function archiveProductionPreGoLiveLoadApproval(approvalId) {
  const snap = await db.collection(ARCHIVE_EXECUTION_APPROVALS_COLLECTION).doc(approvalId).get();
  if (!snap.exists) {
    throw new HttpsError("failed-precondition", "Archive execution approval record was not found.");
  }
  return snap.data() || {};
}

function archiveProductionPreGoLiveValidateExecutePayload(data, approval, approved) {
  if (String(data && data.mode || "").trim() !== "execute") {
    throw new HttpsError("invalid-argument", "mode must be execute.");
  }
  const approvalPhrase = String(approval && approval.approvalPhrase || "").trim();
  const confirmationText = String(data && data.confirmationText || "").trim();
  if (approvalPhrase !== ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVAL_PHRASE) {
    throw new HttpsError("failed-precondition", "Approval phrase does not match the required production approval language.");
  }
  if (confirmationText !== ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVAL_PHRASE) {
    throw new HttpsError("failed-precondition", "confirmationText must exactly match the approved production approval phrase.");
  }
  if (String(data && data.policyId || "").trim() !== ARCHIVE_PRE_GO_LIVE_POLICY_ID) {
    throw new HttpsError("invalid-argument", "Unsupported archive policy.");
  }
  if (archivePreviewDateString(data && data.cutoffDate) !== ARCHIVE_GO_LIVE_CUTOFF_DATE) {
    throw new HttpsError("invalid-argument", `cutoffDate must be ${ARCHIVE_GO_LIVE_CUTOFF_DATE}.`);
  }
  if (String(data && data.manifestHash || "").trim() !== approved.manifestHash) {
    throw new HttpsError("failed-precondition", "manifestHash does not match the approved manifest.");
  }
  if (String(data && data.generatedAt || "").trim() !== approved.generatedAt) {
    throw new HttpsError("failed-precondition", "generatedAt does not match the approved manifest timestamp.");
  }
  const expectedCount = archiveValidateExpectedCount(data && data.expectedCount);
  if (expectedCount !== approved.targetCount) {
    throw new HttpsError("failed-precondition", "expectedCount does not match the approved target count.");
  }
  if (expectedCount > ARCHIVE_PRODUCTION_PRE_GO_LIVE_MAX_TARGETS) {
    throw new HttpsError("failed-precondition", `Production pre-go-live archive is limited to ${ARCHIVE_PRODUCTION_PRE_GO_LIVE_MAX_TARGETS} records per execution.`);
  }
  return {
    approvalId: archiveProductionPreGoLiveValidateApprovalId(data && data.approvalId),
    expectedCount,
    confirmationText
  };
}

function archiveProductionPreGoLiveAssertPreviewMatchesApproved(preview, approved) {
  const currentPreview = archiveProductionPreGoLivePreviewSummary(preview);
  if (String(preview && preview.manifestHash || "") !== approved.manifestHash) {
    throw new HttpsError("failed-precondition", "Current preview manifest hash does not match the approved manifest.");
  }
  if (currentPreview.targetCount !== approved.targetCount) {
    throw new HttpsError("failed-precondition", "Current preview target count does not match the approved target count.");
  }
  ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.forEach((collection) => {
    if (currentPreview.collectionCounts[collection] !== approved.collectionCounts[collection]) {
      throw new HttpsError("failed-precondition", `Current preview ${collection} target count does not match the approved target count.`);
    }
  });
  if (currentPreview.postGoLiveTargetCount !== 0) {
    throw new HttpsError("failed-precondition", "Current preview returned post-go-live targets.");
  }
  return currentPreview;
}

async function executeProductionPreGoLiveArchiveBatch(data, authInfo) {
  archiveProductionPreGoLiveAssertProductionProject();
  const approved = ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVED_PREVIEW;
  const approvalId = archiveProductionPreGoLiveValidateApprovalId(data && data.approvalId);
  const approval = await archiveProductionPreGoLiveLoadApproval(approvalId);
  const options = archiveProductionPreGoLiveValidateExecutePayload(data || {}, approval, approved);

  const preflight = await executeProductionPreGoLiveArchivePreflight({
    mode: "preflight",
    approvalId,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    cutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    manifestHash: approved.manifestHash,
    generatedAt: approved.generatedAt,
    expectedCount: approved.targetCount
  }, authInfo);
  if (preflight.ok !== true || preflight.executable !== true) {
    throw new HttpsError("failed-precondition", "Production pre-go-live preflight is not executable.");
  }

  const preview = await buildProductionPreGoLiveArchivePreview({
    dateFrom: approved.dateFrom,
    dateTo: approved.dateTo,
    cutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    collections: ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS,
    previewOnly: true
  }, authInfo.email);
  const currentPreview = archiveProductionPreGoLiveAssertPreviewMatchesApproved(preview, approved);
  const targets = Array.isArray(preview.targetRecords) ? preview.targetRecords : [];
  if (targets.length !== options.expectedCount) {
    throw new HttpsError("failed-precondition", "Current target list does not match expectedCount.");
  }
  targets.forEach((target) => archivePreGoLiveAssertTargetRecord(target, {
    collections: ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS,
    cutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    dateFrom: approved.dateFrom,
    dateTo: approved.dateTo
  }));

  const batchId = archiveBatchId();
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(batchId);
  const recordKeys = targets.map((target) => archivePreGoLivePolicyRecordKey(target.collection, target.docId));
  const uniqueRecordKeys = new Set(recordKeys);
  if (uniqueRecordKeys.size !== recordKeys.length) {
    throw new HttpsError("failed-precondition", "Production target list contains duplicate records.");
  }

  const createdAt = admin.firestore.FieldValue.serverTimestamp();
  await batchRef.set(archiveProductionPreGoLiveBatchSummaryFields({
    batchId,
    approvalId,
    approval,
    approved,
    preview,
    callerEmail: authInfo.email,
    now: createdAt,
    recordKeys
  }));

  let archivedCount = 0;
  const chunks = archiveProductionChunk(targets, ARCHIVE_PRODUCTION_PRE_GO_LIVE_CHUNK_SIZE);
  try {
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const now = admin.firestore.FieldValue.serverTimestamp();
      await db.runTransaction(async (tx) => {
        const reads = [];
        for (const target of chunk) {
          const collection = String(target.collection || "").trim();
          const docId = String(target.docId || "").trim();
          const ref = db.collection(collection).doc(docId);
          const snap = await tx.get(ref);
          if (!snap.exists) {
            throw new HttpsError("failed-precondition", `Production target no longer exists: ${collection}/${docId}`);
          }
          const recordData = snap.data() || {};
          if (recordData.archived === true) {
            throw new HttpsError("failed-precondition", `Production target became archived before execution: ${collection}/${docId}`);
          }
          const business = archivePreGoLivePolicyBusinessDate(collection, recordData);
          if (!business.value) {
            throw new HttpsError("failed-precondition", `Production target has no reliable ${collection}.${business.field || "business date"}: ${collection}/${docId}`);
          }
          if (business.value >= ARCHIVE_GO_LIVE_CUTOFF_DATE) {
            throw new HttpsError("failed-precondition", `Post-go-live source record detected and protected: ${collection}/${docId}`);
          }
          if (!archivePreviewIsInRange(business.value, approved.dateFrom, approved.dateTo)) {
            throw new HttpsError("failed-precondition", `Source record is outside the approved date range: ${collection}/${docId}`);
          }
          if (business.value !== target.businessDate) {
            throw new HttpsError("failed-precondition", `Business date changed for target: ${collection}/${docId}`);
          }
          reads.push({ target, collection, docId, ref, recordData, business });
        }

        for (const item of reads) {
          const recordKey = archivePreGoLivePolicyRecordKey(item.collection, item.docId);
          tx.set(batchRef.collection("Records").doc(recordKey), archiveProductionPreGoLivePolicyRecordSnapshot({
            batchId,
            collection: item.collection,
            docId: item.docId,
            recordData: item.recordData,
            business: item.business,
            target: item.target,
            callerEmail: authInfo.email,
            now,
            approvalId,
            manifestHash: approved.manifestHash,
            manifestGeneratedAt: approved.generatedAt
          }));
          tx.set(item.ref, archiveProductionPreGoLivePolicyMarkerFields({
            batchId,
            callerEmail: authInfo.email,
            now
          }), { merge: true });
        }

        tx.set(batchRef, {
          archivedCount: admin.firestore.FieldValue.increment(reads.length),
          recordCount: admin.firestore.FieldValue.increment(reads.length),
          updatedAt: now,
          lastChunkIndex: chunkIndex,
          firestoreDeletes: 0,
          deleteCount: 0,
          sourceRecordsDeleted: false
        }, { merge: true });
      });
      archivedCount += chunk.length;
    }

    await batchRef.set({
      status: "archived",
      archivedCount,
      recordCount: archivedCount,
      completedAt: admin.firestore.FieldValue.serverTimestamp(),
      failedCount: 0,
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    }, { merge: true });
  } catch (error) {
    await batchRef.set({
      status: "partial_failed",
      archivedCount,
      recordCount: archivedCount,
      failedCount: Math.max(0, targets.length - archivedCount),
      failedAt: admin.firestore.FieldValue.serverTimestamp(),
      failureMessage: error && error.message ? error.message : String(error || ""),
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    }, { merge: true });
    throw error;
  }

  logger.info("Production pre-go-live archive completed", {
    archiveBatchId: batchId,
    callerEmail: authInfo.email,
    archivedCount,
    firestoreDeletes: 0
  });

  return {
    ok: true,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    archiveBatchId: batchId,
    archivedCount,
    failedCount: 0,
    recordCount: archivedCount,
    targetCount: targets.length,
    firestoreWrites: 1 + (archivedCount * 2) + chunks.length + 1,
    firestoreDeletes: 0,
    deleteCount: 0,
    sourceRecordsDeleted: false,
    manifestHash: approved.manifestHash,
    currentPreview,
    warnings: preflight.warnings || [],
    rollbackAvailable: true
  };
}

function archivePreGoLiveExpectedConfirmation(count) {
  return `ARCHIVE PRE-GO-LIVE ${count} RECORDS`;
}

function archivePreGoLiveNormalizeCollections(rawCollections) {
  const raw = Array.isArray(rawCollections) && rawCollections.length
    ? rawCollections
    : ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS;
  const seen = new Set();
  const collections = raw.map((value) => String(value || "").trim())
    .filter(Boolean)
    .filter((collection) => {
      if (seen.has(collection)) return false;
      seen.add(collection);
      return true;
    });
  const invalid = collections.filter((collection) => !ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.includes(collection));
  if (invalid.length) {
    throw new HttpsError("invalid-argument", `Pre-go-live policy cannot archive collection(s): ${invalid.join(", ")}`);
  }
  if (!collections.length) {
    throw new HttpsError("invalid-argument", "At least one policy-allowed collection is required.");
  }
  return collections;
}

function archivePreGoLivePolicyDateField(collection) {
  if (collection === ACTIVE_JOBS_COLLECTION) return "dateString";
  if (collection === ARCHIVE_APPOINTMENTS_COLLECTION) return "dateString";
  if (collection === ARCHIVE_ATTENDANCE_COLLECTION) return "date";
  return "";
}

function archivePreGoLivePolicyBusinessDate(collection, row) {
  const field = archivePreGoLivePolicyDateField(collection);
  const value = field ? archivePreviewDateString(row && row[field]) : "";
  return { field, value };
}

function archivePreGoLiveValidateExecutionRequest(data) {
  const policyId = String(data && data.policyId || "").trim();
  if (policyId !== ARCHIVE_PRE_GO_LIVE_POLICY_ID) {
    throw new HttpsError("invalid-argument", "Unsupported archive policy.");
  }

  const cutoffDate = archivePreviewDateString(data && data.cutoffDate);
  if (cutoffDate !== ARCHIVE_GO_LIVE_CUTOFF_DATE) {
    throw new HttpsError("invalid-argument", `cutoffDate must be ${ARCHIVE_GO_LIVE_CUTOFF_DATE}.`);
  }

  const { dateFrom, dateTo } = archiveValidateDateRange(data || {});
  if (dateTo >= cutoffDate) {
    throw new HttpsError("failed-precondition", "dateTo must be before the go-live cutoff for execution.");
  }

  const collections = archivePreGoLiveNormalizeCollections(data && data.collections);
  const expectedCount = archiveValidateExpectedCount(data && data.expectedCount);
  const expectedAlreadyArchivedCount = Number.parseInt(String(data && data.expectedAlreadyArchivedCount), 10);
  if (!Number.isInteger(expectedAlreadyArchivedCount) || expectedAlreadyArchivedCount < 0) {
    throw new HttpsError("invalid-argument", "expectedAlreadyArchivedCount must be a non-negative integer.");
  }

  const expectedConfirmation = archivePreGoLiveExpectedConfirmation(expectedCount);
  if (String(data && data.confirmationText || "").trim() !== expectedConfirmation) {
    throw new HttpsError("failed-precondition", `Confirmation text must be exactly: ${expectedConfirmation}`);
  }

  return {
    policyId,
    cutoffDate,
    dateFrom,
    dateTo,
    collections,
    expectedCount,
    expectedAlreadyArchivedCount,
    confirmationText: expectedConfirmation
  };
}

function archivePreGoLiveAssertTargetRecord(target, options) {
  const collection = String(target && target.collection || "").trim();
  const docId = String(target && target.docId || "").trim();
  if (!collection || !docId) {
    throw new HttpsError("failed-precondition", "Pre-go-live target is missing collection or docId.");
  }
  if (!options.collections.includes(collection)) {
    throw new HttpsError("failed-precondition", `Pre-go-live target collection is outside the approved request: ${collection}`);
  }
  if (!ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.includes(collection)) {
    throw new HttpsError("failed-precondition", `Pre-go-live target collection is not allowed: ${collection}`);
  }
  const businessDate = String(target.businessDate || "").trim();
  const expectedDateField = archivePreGoLivePolicyDateField(collection);
  if (String(target.dateField || "") !== expectedDateField) {
    throw new HttpsError("failed-precondition", `Pre-go-live target must use ${collection}.${expectedDateField} as its business date: ${collection}/${docId}`);
  }
  if (!businessDate) {
    throw new HttpsError("failed-precondition", `Pre-go-live target has no business date: ${collection}/${docId}`);
  }
  if (businessDate >= options.cutoffDate) {
    throw new HttpsError("failed-precondition", `Post-go-live target detected and protected: ${collection}/${docId}`);
  }
  if (!archivePreviewIsInRange(businessDate, options.dateFrom, options.dateTo)) {
    throw new HttpsError("failed-precondition", `Pre-go-live target is outside the approved date range: ${collection}/${docId}`);
  }
}

function archivePreGoLivePolicyRecordKey(collection, docId) {
  return `${String(collection || "").replace(/\//g, "_")}__${String(docId || "").replace(/\//g, "_")}`;
}

function archivePreGoLivePolicyMarkerFields({ batchId, callerEmail, now }) {
  return {
    archived: true,
    archivedReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    archivedAt: now,
    archivedBy: callerEmail,
    archiveBatchId: batchId,
    archiveCutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    archivePolicy: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE
  };
}

function archiveProductionPreGoLivePolicyMarkerFields({ batchId, callerEmail, now }) {
  return {
    archived: true,
    archivedReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    archiveReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    archivedAt: now,
    archivedBy: callerEmail,
    archiveBatchId: batchId,
    archiveCutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    archiveScope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    archivePolicy: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE
  };
}

function archiveProductionChunk(items, size) {
  const chunks = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function archivePreGoLivePolicyBatchSummaryFields({ batchId, options, preview, callerEmail, now, recordKeys }) {
  return {
    archiveBatchId: batchId,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    policyLabel: ARCHIVE_PRE_GO_LIVE_POLICY_LABEL,
    scope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    pilotScope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    cutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    collections: options.collections,
    createdBy: callerEmail,
    createdAt: now,
    completedAt: now,
    status: "archived",
    recordCount: options.expectedCount,
    archivedCount: options.expectedCount,
    alreadyArchivedCount: options.expectedAlreadyArchivedCount,
    failedCount: 0,
    rollbackCount: 0,
    deleteCount: 0,
    firestoreDeletes: 0,
    sourceRecordsDeleted: false,
    recordKeys,
    financialImpact: preview.financialImpact || {},
    linkedRecordSummary: preview.linkedRecordSummary || {},
    postGoLiveProtectionSummary: preview.postGoLiveProtectionSummary || [],
    policyDecision: ARCHIVE_PRE_GO_LIVE_POLICY_DECISION,
    confirmationTextUsed: options.confirmationText,
    readOnly: false
  };
}

function archiveProductionPreGoLiveBatchSummaryFields({
  batchId,
  approvalId,
  approval,
  approved,
  preview,
  callerEmail,
  now,
  recordKeys
}) {
  return {
    archiveBatchId: batchId,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    policyLabel: ARCHIVE_PRE_GO_LIVE_POLICY_LABEL,
    scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    pilotScope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    policyScope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    approvalId,
    cutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    dateFrom: approved.dateFrom,
    dateTo: approved.dateTo,
    collections: ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS,
    projectId: approved.projectId,
    executionEnvironment: approved.environment,
    manifestHash: approved.manifestHash,
    manifestGeneratedAt: approved.generatedAt,
    approvedAt: archivePreGoLiveTimestampIso(approval && approval.approvedAt),
    approvedBy: normalizeEmail(approval && (approval.approvedBy || approval.approverEmail)),
    createdBy: callerEmail,
    createdAt: now,
    updatedAt: now,
    status: "archiving",
    targetCount: approved.targetCount,
    recordCount: 0,
    archivedCount: 0,
    alreadyArchivedCount: Array.isArray(preview && preview.alreadyArchivedRecords)
      ? preview.alreadyArchivedRecords.length
      : 0,
    failedCount: 0,
    rollbackCount: 0,
    deleteCount: 0,
    firestoreDeletes: 0,
    sourceRecordsDeleted: false,
    chunkSize: ARCHIVE_PRODUCTION_PRE_GO_LIVE_CHUNK_SIZE,
    chunkCount: Math.ceil(recordKeys.length / ARCHIVE_PRODUCTION_PRE_GO_LIVE_CHUNK_SIZE),
    recordKeys,
    financialImpact: preview.financialImpact || {},
    linkedRecordSummary: preview.linkedRecordSummary || {},
    postGoLiveProtectionSummary: preview.postGoLiveProtectionSummary || [],
    policyDecision: ARCHIVE_PRE_GO_LIVE_POLICY_DECISION,
    confirmationTextUsed: ARCHIVE_PRODUCTION_PRE_GO_LIVE_APPROVAL_PHRASE,
    protectedPostGoLiveDriftWarnings: Array.isArray(preview && preview.warnings) ? preview.warnings : [],
    readOnly: false
  };
}

function archivePreGoLivePolicyRecordSnapshot({ batchId, collection, docId, recordData, business, target, callerEmail, now }) {
  const snapshot = {
    archiveBatchId: batchId,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    scope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    collection,
    docId,
    dateField: business.field,
    businessDate: business.value,
    status: archivePreviewStatus(recordData),
    clientName: archivePreviewText(recordData, ["clientName", "name", "fullName", "staffName"]),
    clientId: archivePreviewText(recordData, ["clientId", "clientEmail", "email"]),
    clientPhone: archivePreviewText(recordData, ["clientPhone", "phone", "phoneNumber"]),
    groupId: archivePreviewText(recordData, ["groupId", "groupBookingId"]),
    appointmentId: archivePreviewText(recordData, ["sourceAppointmentId", "appointmentId", "bookingId"]),
    jobId: archivePreviewText(recordData, ["jobId", "activeJobId"]) || (collection === ACTIVE_JOBS_COLLECTION ? docId : ""),
    receiptRef: archivePreviewText(recordData, ["receiptRef", "receiptId", "receiptNumber"]),
    giftCardCode: archivePreviewText(recordData, ["giftCardCode", "appliedGiftCardCode", "voucherCode"]),
    originalDataSnapshot: recordData,
    archiveResult: "archived",
    archivedAt: now,
    archivedBy: callerEmail,
    archiveReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    rollbackStatus: "not_rolled_back"
  };
  if (collection === ACTIVE_JOBS_COLLECTION) {
    snapshot.financialSummary = target && target.financialSummary
      ? target.financialSummary
      : archivePreGoLiveFinancialSummary(recordData);
  }
  return snapshot;
}

function archiveProductionPreGoLivePolicyRecordSnapshot(args) {
  const snapshot = archivePreGoLivePolicyRecordSnapshot(args);
  return {
    ...snapshot,
    scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    archiveScope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    archivePolicyScope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    approvalId: args.approvalId || "",
    manifestHash: args.manifestHash || "",
    manifestGeneratedAt: args.manifestGeneratedAt || ""
  };
}

async function executePreGoLivePolicyArchiveBatch(data, callerEmail) {
  const options = archivePreGoLiveValidateExecutionRequest(data || {});
  const preview = await buildPreGoLivePolicyArchivePreview({
    policyId: options.policyId,
    cutoffDate: options.cutoffDate,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    collections: options.collections,
    previewOnly: true
  }, callerEmail);

  const targets = Array.isArray(preview.targetRecords) ? preview.targetRecords : [];
  const alreadyArchived = Array.isArray(preview.alreadyArchivedRecords) ? preview.alreadyArchivedRecords : [];
  if (targets.length !== options.expectedCount) {
    throw new HttpsError("failed-precondition", `Pre-go-live target count changed. Expected ${options.expectedCount}, rebuilt ${targets.length}.`);
  }
  if (alreadyArchived.length !== options.expectedAlreadyArchivedCount) {
    throw new HttpsError("failed-precondition", `Already archived count changed. Expected ${options.expectedAlreadyArchivedCount}, rebuilt ${alreadyArchived.length}.`);
  }
  if (targets.length > ARCHIVE_PRE_GO_LIVE_MAX_TARGETS) {
    throw new HttpsError("failed-precondition", `Pre-go-live policy archive is limited to ${ARCHIVE_PRE_GO_LIVE_MAX_TARGETS} targets per batch.`);
  }
  targets.forEach((target) => archivePreGoLiveAssertTargetRecord(target, options));

  const batchId = archiveBatchId();
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(batchId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  const recordKeys = targets.map((target) => archivePreGoLivePolicyRecordKey(target.collection, target.docId));
  const uniqueRecordKeys = new Set(recordKeys);
  if (uniqueRecordKeys.size !== recordKeys.length) {
    throw new HttpsError("failed-precondition", "Pre-go-live target list contains duplicate records.");
  }

  await db.runTransaction(async (tx) => {
    const reads = [];
    for (const target of targets) {
      const collection = String(target.collection || "").trim();
      const docId = String(target.docId || "").trim();
      const ref = db.collection(collection).doc(docId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError("failed-precondition", `Pre-go-live target no longer exists: ${collection}/${docId}`);
      }
      const recordData = snap.data() || {};
      if (recordData.archived === true) {
        throw new HttpsError("failed-precondition", `Pre-go-live target became archived before execution: ${collection}/${docId}`);
      }
      const business = archivePreGoLivePolicyBusinessDate(collection, recordData);
      if (!business.value) {
        throw new HttpsError("failed-precondition", `Pre-go-live target has no reliable ${collection}.${business.field || "business date"}: ${collection}/${docId}`);
      }
      if (business.value >= options.cutoffDate) {
        throw new HttpsError("failed-precondition", `Post-go-live source record detected and protected: ${collection}/${docId}`);
      }
      if (!archivePreviewIsInRange(business.value, options.dateFrom, options.dateTo)) {
        throw new HttpsError("failed-precondition", `Source record is outside the approved date range: ${collection}/${docId}`);
      }
      if (business.value !== target.businessDate) {
        throw new HttpsError("failed-precondition", `Business date changed for target: ${collection}/${docId}`);
      }
      reads.push({ target, collection, docId, ref, recordData, business });
    }

    tx.set(batchRef, archivePreGoLivePolicyBatchSummaryFields({
      batchId,
      options,
      preview,
      callerEmail,
      now,
      recordKeys
    }));

    for (const item of reads) {
      const recordKey = archivePreGoLivePolicyRecordKey(item.collection, item.docId);
      tx.set(batchRef.collection("Records").doc(recordKey), archivePreGoLivePolicyRecordSnapshot({
        batchId,
        collection: item.collection,
        docId: item.docId,
        recordData: item.recordData,
        business: item.business,
        target: item.target,
        callerEmail,
        now
      }));
      tx.set(item.ref, archivePreGoLivePolicyMarkerFields({
        batchId,
        callerEmail,
        now
      }), { merge: true });
    }
  });

  logger.info("Pre-go-live policy archive completed", {
    archiveBatchId: batchId,
    callerEmail,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    scope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    archivedCount: targets.length,
    alreadyArchivedCount: alreadyArchived.length,
    firestoreDeletes: 0
  });

  return {
    ok: true,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    scope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    archiveBatchId: batchId,
    archivedCount: targets.length,
    alreadyArchivedCount: alreadyArchived.length,
    failedCount: 0,
    recordCount: targets.length,
    firestoreDeletes: 0,
    deleteCount: 0,
    sourceRecordsDeleted: false,
    financialImpact: preview.financialImpact || {},
    postGoLiveProtectionSummary: preview.postGoLiveProtectionSummary || [],
    rollbackAvailable: true
  };
}

function archiveBatchId() {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  return `ARCHIVE_${stamp}_${crypto.randomBytes(4).toString("hex")}`;
}

function archiveValidateExecutionCollection(value) {
  const collection = String(value || "").trim();
  if (collection !== ARCHIVE_ATTENDANCE_COLLECTION && collection !== ACTIVE_JOBS_COLLECTION) {
    throw new HttpsError("failed-precondition", "Only Attendance and synthetic Active_Jobs revenue pilot records can be archived in staging.");
  }
  return collection;
}

function archiveExecutionPilotScope(collection) {
  return collection === ACTIVE_JOBS_COLLECTION
    ? ARCHIVE_ACTIVE_JOBS_PILOT_SCOPE
    : ARCHIVE_ATTENDANCE_PILOT_SCOPE;
}

function archiveExecutionMaxRecords(collection) {
  return collection === ACTIVE_JOBS_COLLECTION
    ? ARCHIVE_ACTIVE_JOBS_MAX_PILOT_RECORDS
    : ARCHIVE_ATTENDANCE_MAX_PILOT_RECORDS;
}

function archiveExecutionLabel(collection) {
  return collection === ACTIVE_JOBS_COLLECTION
    ? "synthetic Active_Jobs revenue pilot"
    : "Attendance";
}

function archiveValidateExpectedCount(value) {
  const expected = Number.parseInt(String(value || ""), 10);
  if (!Number.isInteger(expected) || expected < 1) {
    throw new HttpsError("invalid-argument", "expectedCount must be a positive integer.");
  }
  return expected;
}

function archiveValidateRecordIds(rawIds, expectedCount, collection) {
  if (!Array.isArray(rawIds)) {
    throw new HttpsError("invalid-argument", "recordIds must be an array.");
  }
  const ids = rawIds.map((id) => String(id || "").trim()).filter(Boolean);
  if (!ids.length) {
    throw new HttpsError("invalid-argument", `At least one ${archiveExecutionLabel(collection)} record id is required.`);
  }
  if (ids.length !== rawIds.length) {
    throw new HttpsError("invalid-argument", "recordIds cannot contain blank values.");
  }
  if (ids.length !== expectedCount) {
    throw new HttpsError("invalid-argument", "expectedCount must match recordIds length.");
  }
  const maxRecords = archiveExecutionMaxRecords(collection);
  if (ids.length > maxRecords) {
    throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} archive pilot is limited to ${maxRecords} records.`);
  }
  const unique = new Set(ids);
  if (unique.size !== ids.length) {
    throw new HttpsError("invalid-argument", "recordIds cannot contain duplicates.");
  }
  return ids;
}

function archiveValidateReason(value) {
  const reason = String(value || "pre_go_live_test_data").trim();
  if (!ARCHIVE_PREVIEW_ALLOWED_REASONS.has(reason)) {
    throw new HttpsError("invalid-argument", "Unsupported archive reason.");
  }
  return reason;
}

function archiveValidateDateRange(data) {
  const dateFrom = archivePreviewDateString(data && data.dateFrom);
  const dateTo = archivePreviewDateString(data && data.dateTo);
  if (!dateFrom || !dateTo) {
    throw new HttpsError("invalid-argument", "dateFrom and dateTo are required.");
  }
  if (dateFrom > dateTo) {
    throw new HttpsError("invalid-argument", "dateFrom must be before or equal to dateTo.");
  }
  return { dateFrom, dateTo };
}

function archiveSoftConfirmationText(collection, count) {
  return collection === ACTIVE_JOBS_COLLECTION
    ? `ARCHIVE ${count} ACTIVE JOBS`
    : `ARCHIVE ${count} RECORDS`;
}

function archiveValidateSoftConfirmation(value, count, collection) {
  const expected = archiveSoftConfirmationText(collection, count);
  if (String(value || "").trim() !== expected) {
    throw new HttpsError("failed-precondition", `Confirmation text must be exactly: ${expected}`);
  }
}

function archiveValidateRollbackConfirmation(value) {
  if (String(value || "").trim() !== "ROLLBACK") {
    throw new HttpsError("failed-precondition", "Confirmation text must be exactly: ROLLBACK");
  }
}

function archiveValidateSoftArchiveRequest(data) {
  const collection = archiveValidateExecutionCollection(data && data.collection);
  const { dateFrom, dateTo } = archiveValidateDateRange(data);
  const expectedCount = archiveValidateExpectedCount(data && data.expectedCount);
  const recordIds = archiveValidateRecordIds(data && data.recordIds, expectedCount, collection);
  const reason = archiveValidateReason(data && data.reason);
  archiveValidateSoftConfirmation(data && data.confirmationText, expectedCount, collection);
  return { collection, dateFrom, dateTo, expectedCount, recordIds, reason };
}

function archiveValidateRollbackRequest(data) {
  const archiveBatchId = String(data && data.archiveBatchId || "").trim();
  if (!/^ARCHIVE_\d{14}_[a-f0-9]{8}$/.test(archiveBatchId)) {
    throw new HttpsError("invalid-argument", "A valid archiveBatchId is required.");
  }
  const expectedCount = archiveValidateExpectedCount(data && data.expectedCount);
  archiveValidateRollbackConfirmation(data && data.confirmationText);
  return { archiveBatchId, expectedCount };
}

function archiveValidateProductionRollbackRequest(data) {
  const archiveBatchId = String(data && data.archiveBatchId || "").trim();
  if (!/^ARCHIVE_\d{14}_[a-f0-9]{8}$/.test(archiveBatchId)) {
    throw new HttpsError("invalid-argument", "A valid archiveBatchId is required.");
  }
  const expectedCount = archiveValidateExpectedCount(data && data.expectedCount);
  if (String(data && data.confirmationText || "").trim() !== ARCHIVE_PRODUCTION_PRE_GO_LIVE_ROLLBACK_CONFIRMATION) {
    throw new HttpsError("failed-precondition", `Confirmation text must be exactly: ${ARCHIVE_PRODUCTION_PRE_GO_LIVE_ROLLBACK_CONFIRMATION}`);
  }
  return { archiveBatchId, expectedCount };
}

function archiveRecordMarkerFields({ batchId, reason, dateTo, callerEmail, now }) {
  return {
    archived: true,
    archivedReason: reason,
    archivedAt: now,
    archivedBy: callerEmail,
    archiveBatchId: batchId,
    archiveCutoffDate: dateTo
  };
}

function archiveBatchSummaryFields({ batchId, options, callerEmail, now }) {
  return {
    archiveBatchId: batchId,
    collection: options.collection,
    pilotScope: archiveExecutionPilotScope(options.collection),
    reason: options.reason,
    dateFrom: options.dateFrom,
    dateTo: options.dateTo,
    status: "archived",
    requestedCount: options.expectedCount,
    archivedCount: options.expectedCount,
    failedCount: 0,
    rollbackCount: 0,
    recordIds: options.recordIds,
    createdAt: now,
    createdBy: callerEmail,
    completedAt: now,
    confirmationTextUsed: archiveSoftConfirmationText(options.collection, options.expectedCount),
    readOnly: false,
    firestoreDeletes: 0,
    deleteCount: 0,
    sourceRecordsDeleted: false
  };
}

function archiveActiveJobPilotFinancialSnapshot(recordData) {
  return {
    bookedPrice: archivePreviewNumber(recordData.bookedPrice, null),
    taxableSubtotal: archivePreviewNumber(recordData.taxableSubtotal, null),
    taxTotal: archivePreviewNumber(recordData.taxTotal, null),
    grandTotal: archivePreviewNumber(recordData.grandTotal, null),
    finalTotal: archivePreviewNumber(recordData.finalTotal, null),
    amountDue: archivePreviewNumber(recordData.amountDue, null),
    totalGHC: archivePreviewNumber(recordData.totalGHC, null),
    paidAmount: archivePreviewNumber(recordData.paidAmount, null),
    netRevenue: archivePreviewNumber(recordData.netRevenue, null),
    paymentMethod: archivePreviewText(recordData, ["paymentMethod", "paymentType", "tenderType"])
  };
}

function archiveBatchRecordFields({ batchId, collection, recordId, recordData, business, reason, callerEmail, now }) {
  const record = {
    archiveBatchId: batchId,
    collection,
    docId: recordId,
    dateField: business.field,
    businessDate: business.value,
    createdAt: recordData.createdAt || "",
    status: archivePreviewStatus(recordData),
    clientName: archivePreviewText(recordData, ["clientName", "name", "fullName", "staffName"]),
    clientPhone: archivePreviewText(recordData, ["clientPhone", "phone", "phoneNumber"]),
    clientId: archivePreviewText(recordData, ["clientId", "clientEmail", "clientPhone", "email"]),
    groupId: archivePreviewText(recordData, ["groupId", "groupBookingId"]),
    appointmentId: archivePreviewText(recordData, ["appointmentId", "bookingId"]),
    jobId: archivePreviewText(recordData, ["jobId", "activeJobId"]) || (collection === ACTIVE_JOBS_COLLECTION ? recordId : ""),
    receiptRef: archivePreviewText(recordData, ["receiptRef", "receiptId"]),
    giftCardCode: archivePreviewText(recordData, ["giftCardCode", "appliedGiftCardCode", "voucherCode"]),
    originalDataSnapshot: recordData,
    archivedAt: now,
    archivedBy: callerEmail,
    archiveReason: reason,
    rollbackStatus: "not_rolled_back"
  };
  if (collection === ACTIVE_JOBS_COLLECTION) {
    record.financialSnapshot = archiveActiveJobPilotFinancialSnapshot(recordData);
  }
  return record;
}

function archiveFirstFinite(row, keys) {
  for (const key of keys) {
    if (!row || row[key] === undefined || row[key] === null || row[key] === "") continue;
    const num = Number(row[key]);
    if (Number.isFinite(num)) return num;
  }
  return null;
}

function archiveActiveJobHasNonZeroAmount(row, keys) {
  return keys.some((key) => {
    if (!row || row[key] === undefined || row[key] === null || row[key] === "") return false;
    const num = Number(row[key]);
    return Number.isFinite(num) && Math.abs(num) > 0.005;
  });
}

function archiveActiveJobHasArrayEntries(row, keys) {
  return keys.some((key) => Array.isArray(row && row[key]) && row[key].length > 0);
}

function archiveActiveJobTextMatches(row, keys, pattern) {
  return keys.some((key) => pattern.test(String(row && row[key] || "")));
}

function archiveActiveJobPilotRejection(recordId, recordData, business) {
  const status = archivePreviewNormalizeStatus(archivePreviewStatus(recordData));
  if (!archiveIsSyntheticActiveJobPilot(recordData)) {
    return `Active_Jobs record is not a DA-3B synthetic pilot row: ${recordId}`;
  }
  if (archiveIsPostGoLiveBusinessDate(business.value)) {
    return `Active_Jobs pilot record is on or after go-live and is protected: ${recordId}`;
  }
  if (status !== "closed" && status !== "completed") {
    return `Active_Jobs revenue pilot record must be closed/completed: ${recordId}`;
  }
  if (recordData.isGroupBooking === true
      || archivePreviewHasAny(recordData, ["groupId", "groupBookingId", "groupRole", "groupLeadId", "groupMemberId"])
      || Number(recordData.groupSize || 0) > 1) {
    return `Active_Jobs revenue pilot record cannot contain group booking fields: ${recordId}`;
  }
  if (archivePreviewHasAny(recordData, ["receiptRef", "receiptId", "receiptNumber", "receiptUrl"])) {
    return `Active_Jobs revenue pilot record cannot contain receipt links: ${recordId}`;
  }
  if (archivePreviewHasAny(recordData, ["appointmentId", "bookingId", "sourceAppointmentId"])) {
    return `Active_Jobs revenue pilot record cannot link to Appointments: ${recordId}`;
  }
  if (archivePreviewHasAny(recordData, ["clientId", "clientPhone", "clientEmail", "email", "phone", "phoneNumber"])) {
    return `Active_Jobs revenue pilot record cannot link to real client identity fields: ${recordId}`;
  }
  if (archivePreviewHasAny(recordData, ["giftCardCode", "appliedGiftCardCode", "voucherCode", "giftCardRedemptionId"])) {
    return `Active_Jobs revenue pilot record cannot contain gift card or voucher fields: ${recordId}`;
  }
  if (archivePreviewHasAny(recordData, ["packageId", "packageCode", "walletId", "packageWalletId"])) {
    return `Active_Jobs revenue pilot record cannot contain package fields: ${recordId}`;
  }
  if (archivePreviewHasAny(recordData, ["promoCode", "discountCode", "redemptionId"])
      || archiveActiveJobHasNonZeroAmount(recordData, ["discountAmount", "promoDiscount", "voucherDiscount"])) {
    return `Active_Jobs revenue pilot record cannot contain promo or discount fields: ${recordId}`;
  }
  if (recordData.hasSplitPayment === true
      || recordData.isSplitPayment === true
      || archiveActiveJobHasArrayEntries(recordData, ["splitPayments", "paymentSplits", "payments"])
      || archiveActiveJobTextMatches(recordData, ["paymentMethod", "paymentType", "tenderType"], /split|gift|voucher|package|wallet|promo/i)) {
    return `Active_Jobs revenue pilot record cannot contain split, gift, package, or promo payment fields: ${recordId}`;
  }

  const paidTotal = archiveFirstFinite(recordData, ["paidAmount", "amountPaid", "totalPaid", "amountDue", "finalTotal", "grandTotal", "totalGHC"]);
  const netRevenue = archiveFirstFinite(recordData, ["netRevenue", "taxableSubtotal", "bookedPrice"]);
  const taxTotal = archiveFirstFinite(recordData, ["taxTotal"]);
  if (paidTotal === null || paidTotal <= 0) {
    return `Active_Jobs revenue pilot record needs a positive paid/total value: ${recordId}`;
  }
  if (netRevenue === null || netRevenue < 0) {
    return `Active_Jobs revenue pilot record needs numeric net revenue/taxable subtotal: ${recordId}`;
  }
  if (taxTotal === null || taxTotal < 0) {
    return `Active_Jobs revenue pilot record needs numeric taxTotal: ${recordId}`;
  }
  return "";
}

function archiveValidateSourceRecordForSoftArchive({ collection, recordId, recordData, business, options }) {
  if (recordData.archived === true) {
    throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record is already archived: ${recordId}`);
  }
  if (!business.value) {
    throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record has no reliable business date: ${recordId}`);
  }
  if (archiveIsPostGoLiveBusinessDate(business.value)) {
    throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record is on or after go-live and is protected: ${recordId}`);
  }
  if (!archivePreviewIsInRange(business.value, options.dateFrom, options.dateTo)) {
    throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record is outside the approved date range: ${recordId}`);
  }
  if (collection === ACTIVE_JOBS_COLLECTION) {
    const rejection = archiveActiveJobPilotRejection(recordId, recordData, business);
    if (rejection) throw new HttpsError("failed-precondition", rejection);
  }
}

function archiveRealPairAssertTargetIds(activeJobId, appointmentId) {
  const jobId = String(activeJobId || "").trim();
  const apptId = String(appointmentId || "").trim();
  if (jobId !== ARCHIVE_REAL_PAIR_ACTIVE_JOB_ID || apptId !== ARCHIVE_REAL_PAIR_APPOINTMENT_ID) {
    throw new HttpsError("failed-precondition", "Only the approved DA-3H real Active_Job pair is supported.");
  }
  return { activeJobId: jobId, appointmentId: apptId };
}

function archiveRealPairAssertLinkedClientId(value) {
  const linkedClientId = String(value || "").trim();
  if (linkedClientId !== ARCHIVE_REAL_PAIR_CLIENT_ID) {
    throw new HttpsError("failed-precondition", "Linked client id does not match the approved DA-3H pilot.");
  }
  return linkedClientId;
}

function archiveRealPairDate(row, collection, label) {
  const business = archivePreviewBusinessDate(collection, row || {});
  if (!business.value) {
    throw new HttpsError("failed-precondition", `${label} has no reliable business date.`);
  }
  if (archiveIsPostGoLiveBusinessDate(business.value)) {
    throw new HttpsError("failed-precondition", `${label} is on or after go-live and is protected.`);
  }
  return business;
}

function archiveRealPairHasPaymentRisk(row) {
  return row && (
    row.hasSplitPayment === true
    || row.isSplitPayment === true
    || archiveActiveJobHasArrayEntries(row, ["splitPayments", "paymentSplits", "payments", "giftCardRedemptions"])
    || archiveActiveJobTextMatches(row, ["paymentMethod", "paymentType", "tenderType"], /split|gift|voucher|package|wallet|promo/i)
  );
}

function archiveRealPairRiskReasons(row, label) {
  const reasons = [];
  if (!row) {
    reasons.push(`${label} is missing.`);
    return reasons;
  }
  if (row.archived === true) reasons.push(`${label} is already archived.`);
  if (row.isGroupBooking === true
      || archivePreviewHasAny(row, ["groupId", "groupBookingId", "groupRole", "groupLeadId", "groupMemberId"])
      || Number(row.groupSize || 0) > 1) {
    reasons.push(`${label} contains group booking fields.`);
  }
  if (archivePreviewHasAny(row, ["receiptRef", "receiptId", "receiptNumber", "receiptUrl"])) {
    reasons.push(`${label} contains receipt links.`);
  }
  if (archivePreviewHasAny(row, ["giftCardCode", "appliedGiftCardCode", "giftCardRedemptionId"])) {
    reasons.push(`${label} contains gift card fields.`);
  }
  if (archivePreviewHasAny(row, ["packageId", "packageCode", "walletId", "packageWalletId"])) {
    reasons.push(`${label} contains package fields.`);
  }
  if (archivePreviewHasAny(row, ["promoCode", "discountCode", "redemptionId", "voucherCode"])
      || archiveActiveJobHasNonZeroAmount(row, ["discountAmount", "promoDiscount", "voucherDiscount"])) {
    reasons.push(`${label} contains promo, voucher, or discount fields.`);
  }
  if (archiveRealPairHasPaymentRisk(row)) {
    reasons.push(`${label} contains split, gift, package, promo, or wallet payment fields.`);
  }
  return reasons;
}

function archiveRealPairRecordSummary(collection, id, data, business) {
  return {
    collection,
    docId: id,
    businessDate: business && business.value || "",
    status: archivePreviewStatus(data),
    paymentStatus: archivePreviewText(data, ["paymentStatus"]),
    clientName: archivePreviewText(data, ["clientName", "name", "fullName"]),
    clientPhone: archivePreviewText(data, ["clientPhone", "phone", "phoneNumber"]),
    clientEmail: archivePreviewText(data, ["clientEmail", "email"]),
    assignedTechName: archivePreviewText(data, ["assignedTechName", "techName", "technicianName"]),
    assignedTechEmail: archivePreviewText(data, ["assignedTechEmail", "techEmail", "technicianEmail"]),
    service: archivePreviewText(data, ["bookedService", "serviceName", "services"]),
    bookedPrice: archivePreviewNumber(data && data.bookedPrice, null),
    grandTotal: archivePreviewNumber(data && data.grandTotal, null),
    totalGHC: archivePreviewNumber(data && data.totalGHC, null),
    paidAmount: archivePreviewNumber(data && data.paidAmount, null),
    amountDue: archivePreviewNumber(data && data.amountDue, null),
    receiptRef: archivePreviewText(data, ["receiptRef", "receiptId"]),
    groupId: archivePreviewText(data, ["groupId", "groupBookingId"]),
    archived: data && data.archived === true,
    sourceAppointmentId: archivePreviewText(data, ["sourceAppointmentId", "appointmentId", "bookingId"])
  };
}

function archiveRealPairClientSummary(id, data) {
  if (!data) return null;
  return {
    collection: "Clients",
    docId: id,
    name: `${archivePreviewText(data, ["Forename", "firstName"])} ${archivePreviewText(data, ["Surname", "lastName"])}`.trim()
      || archivePreviewText(data, ["clientName", "name", "fullName"]),
    phone: archivePreviewText(data, ["Tel_Number", "clientPhone", "phone", "phoneNumber"]),
    email: archivePreviewText(data, ["Email", "clientEmail", "email"]),
    lastUpdated: data.Last_Updated || data.updatedAt || data.createdAt || ""
  };
}

function archiveRealPairClientIdentifiers(jobData, appointmentData, clientId, clientData) {
  const raw = [
    clientId,
    archivePreviewText(jobData, ["clientId", "clientPhone", "clientEmail", "email"]),
    archivePreviewText(jobData, ["clientPhone", "phone", "phoneNumber"]),
    archivePreviewText(jobData, ["clientEmail", "email"]),
    archivePreviewText(jobData, ["clientName", "name", "fullName"]),
    archivePreviewText(appointmentData, ["clientId", "clientPhone", "clientEmail", "email"]),
    archivePreviewText(appointmentData, ["clientPhone", "phone", "phoneNumber"]),
    archivePreviewText(appointmentData, ["clientEmail", "email"]),
    archivePreviewText(appointmentData, ["clientName", "name", "fullName"]),
    archivePreviewText(clientData || {}, ["Tel_Number", "clientPhone", "phone", "phoneNumber"]),
    archivePreviewText(clientData || {}, ["Email", "clientEmail", "email"]),
    `${archivePreviewText(clientData || {}, ["Forename", "firstName"])} ${archivePreviewText(clientData || {}, ["Surname", "lastName"])}`.trim()
  ];
  return Array.from(new Set(raw.map(value => archivePreviewLinkKey(value)).filter(Boolean)));
}

function archiveRealPairRowMatchesClient(row, identifiers) {
  const values = [
    archivePreviewText(row, ["clientId", "clientPhone", "clientEmail", "email"]),
    archivePreviewText(row, ["clientPhone", "phone", "phoneNumber"]),
    archivePreviewText(row, ["clientEmail", "email"]),
    archivePreviewText(row, ["clientName", "name", "fullName"])
  ].map(value => archivePreviewLinkKey(value)).filter(Boolean);
  return values.some(value => identifiers.includes(value));
}

async function archiveRealPairPostGoLiveActivity({ identifiers, activeJobId, appointmentId }) {
  const activity = [];
  if (!identifiers.length) return activity;
  for (const collection of [ACTIVE_JOBS_COLLECTION, ARCHIVE_APPOINTMENTS_COLLECTION]) {
    const snap = await db.collection(collection)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(ARCHIVE_PREVIEW_MAX_SCAN_PER_COLLECTION)
      .get();
    snap.forEach((doc) => {
      if ((collection === ACTIVE_JOBS_COLLECTION && doc.id === activeJobId)
          || (collection === ARCHIVE_APPOINTMENTS_COLLECTION && doc.id === appointmentId)) {
        return;
      }
      const data = doc.data() || {};
      if (data.archived === true) return;
      const business = archivePreviewBusinessDate(collection, data);
      if (!archiveIsPostGoLiveBusinessDate(business.value)) return;
      if (!archiveRealPairRowMatchesClient(data, identifiers)) return;
      activity.push({
        collection,
        docId: doc.id,
        businessDate: business.value,
        status: archivePreviewStatus(data),
        clientName: archivePreviewText(data, ["clientName", "name", "fullName"]),
        service: archivePreviewText(data, ["bookedService", "serviceName", "services"])
      });
    });
  }
  return activity;
}

function archiveRealPairExpectedDeltas(data) {
  const deltas = {
    expectedNetDelta: Number(data && data.expectedNetDelta),
    expectedTaxDelta: Number(data && data.expectedTaxDelta),
    expectedPaidDelta: Number(data && data.expectedPaidDelta),
    expectedCommissionDelta: Number(data && data.expectedCommissionDelta),
    expectedCompletedJobsDelta: Number(data && data.expectedCompletedJobsDelta)
  };
  const expected = {
    expectedNetDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.net,
    expectedTaxDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.tax,
    expectedPaidDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.paid,
    expectedCommissionDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.commission,
    expectedCompletedJobsDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.completedJobs
  };
  Object.entries(expected).forEach(([key, value]) => {
    if (!Number.isFinite(deltas[key]) || Math.abs(deltas[key] - value) > 0.005) {
      throw new HttpsError("failed-precondition", `${key} must equal ${value}.`);
    }
  });
  return deltas;
}

async function buildRealActiveJobPairReview(activeJobId, appointmentId) {
  const ids = archiveRealPairAssertTargetIds(activeJobId, appointmentId);
  const activeJobRef = db.collection(ACTIVE_JOBS_COLLECTION).doc(ids.activeJobId);
  const appointmentRef = db.collection(ARCHIVE_APPOINTMENTS_COLLECTION).doc(ids.appointmentId);
  const [activeJobSnap, appointmentSnap] = await Promise.all([
    activeJobRef.get(),
    appointmentRef.get()
  ]);

  const warnings = [];
  const eligibilityErrors = [];
  if (!activeJobSnap.exists) eligibilityErrors.push("Active_Job was not found.");
  if (!appointmentSnap.exists) eligibilityErrors.push("Linked Appointment was not found.");

  const activeJob = activeJobSnap.exists ? activeJobSnap.data() || {} : null;
  const appointment = appointmentSnap.exists ? appointmentSnap.data() || {} : null;
  const activeJobBusiness = activeJob ? archiveRealPairDate(activeJob, ACTIVE_JOBS_COLLECTION, "Active_Job") : { field: "", value: "" };
  const appointmentBusiness = appointment ? archiveRealPairDate(appointment, ARCHIVE_APPOINTMENTS_COLLECTION, "Appointment") : { field: "", value: "" };

  if (activeJob && archivePreviewText(activeJob, ["sourceAppointmentId", "appointmentId", "bookingId"]) !== ids.appointmentId) {
    eligibilityErrors.push("Active_Job source appointment does not match the linked Appointment.");
  }
  archiveRealPairRiskReasons(activeJob, "Active_Job").forEach(reason => eligibilityErrors.push(reason));
  archiveRealPairRiskReasons(appointment, "Appointment").forEach(reason => eligibilityErrors.push(reason));

  const linkedClientId = archiveRealPairAssertLinkedClientId(
    archivePreviewText(activeJob || {}, ["clientId", "clientPhone"])
      || archivePreviewText(appointment || {}, ["clientId", "clientPhone"])
      || ARCHIVE_REAL_PAIR_CLIENT_ID
  );
  const clientSnap = await db.collection("Clients").doc(linkedClientId).get();
  const clientData = clientSnap.exists ? clientSnap.data() || {} : null;
  if (!clientSnap.exists) warnings.push("Linked Client record was not found.");

  const identifiers = archiveRealPairClientIdentifiers(activeJob, appointment, linkedClientId, clientData);
  const postGoLiveActivity = await archiveRealPairPostGoLiveActivity({
    identifiers,
    activeJobId: ids.activeJobId,
    appointmentId: ids.appointmentId
  });
  if (postGoLiveActivity.length) {
    eligibilityErrors.push("Post-go-live linked client activity exists.");
  }

  return {
    readOnly: true,
    firestoreWrites: 0,
    firestoreDeletes: 0,
    scope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
    activeJob: activeJob ? archiveRealPairRecordSummary(ACTIVE_JOBS_COLLECTION, ids.activeJobId, activeJob, activeJobBusiness) : null,
    appointment: appointment ? archiveRealPairRecordSummary(ARCHIVE_APPOINTMENTS_COLLECTION, ids.appointmentId, appointment, appointmentBusiness) : null,
    linkedClient: archiveRealPairClientSummary(linkedClientId, clientData),
    postGoLiveClientActivity: {
      count: postGoLiveActivity.length,
      records: postGoLiveActivity.slice(0, ARCHIVE_PREVIEW_RISK_SAMPLE_LIMIT)
    },
    fallbackRiskSummary: [
      "Reports V2 can fall back from Active_Jobs to Appointments.",
      "Client history and technician intelligence read both Active_Jobs and Appointments.",
      "The linked Appointment must be archived with the Active_Job to prevent fallback reintroduction."
    ],
    expectedDeltas: {
      netRevenue: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.net,
      tax: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.tax,
      paidAmount: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.paid,
      commission: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.commission,
      completedJobs: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.completedJobs
    },
    eligibility: {
      eligible: eligibilityErrors.length === 0,
      errors: eligibilityErrors
    },
    warnings
  };
}

async function approveRealActiveJobPairReviewRecord(data, callerEmail) {
  const ids = archiveRealPairAssertTargetIds(data && data.activeJobId, data && data.appointmentId);
  const linkedClientId = archiveRealPairAssertLinkedClientId(data && data.linkedClientId);
  const reviewNotes = String(data && data.reviewNotes || "").trim();
  if (!reviewNotes) {
    throw new HttpsError("invalid-argument", "Review notes are required.");
  }
  [
    "linkedAppointmentReviewed",
    "linkedClientReviewed",
    "postGoLiveImpactReviewed",
    "fallbackRiskAccepted",
    "riskAccepted"
  ].forEach((field) => {
    if (data && data[field] !== true) {
      throw new HttpsError("failed-precondition", `${field} must be true.`);
    }
  });
  const deltas = archiveRealPairExpectedDeltas(data || {});
  const review = await buildRealActiveJobPairReview(ids.activeJobId, ids.appointmentId);
  if (!review.eligibility.eligible) {
    throw new HttpsError("failed-precondition", `Pair is not eligible: ${review.eligibility.errors.join("; ")}`);
  }

  const approvalRef = db.collection(ARCHIVE_REVIEW_APPROVALS_COLLECTION).doc();
  const now = admin.firestore.FieldValue.serverTimestamp();
  await approvalRef.set({
    approvalId: approvalRef.id,
    targetCollection: ACTIVE_JOBS_COLLECTION,
    targetDocId: ids.activeJobId,
    linkedAppointmentId: ids.appointmentId,
    linkedClientId,
    approvedBy: callerEmail,
    approvedAt: now,
    reviewNotes,
    riskAccepted: true,
    ...deltas,
    linkedAppointmentReviewed: true,
    linkedClientReviewed: true,
    postGoLiveImpactReviewed: true,
    fallbackRiskAccepted: true,
    status: "approved",
    scope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
    readOnly: false,
    firestoreDeletes: 0,
    deleteCount: 0
  });

  return {
    ok: true,
    approvalId: approvalRef.id,
    scope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
    firestoreWrites: 1,
    firestoreDeletes: 0,
    archiveExecuted: false
  };
}

function archiveRealPairValidateArchiveRequest(data) {
  const ids = archiveRealPairAssertTargetIds(data && data.activeJobId, data && data.appointmentId);
  const approvalId = String(data && data.approvalId || "").trim();
  if (!approvalId) {
    throw new HttpsError("invalid-argument", "approvalId is required.");
  }
  if (String(data && data.confirmationText || "").trim() !== ARCHIVE_REAL_PAIR_CONFIRMATION) {
    throw new HttpsError("failed-precondition", `Confirmation text must be exactly: ${ARCHIVE_REAL_PAIR_CONFIRMATION}`);
  }
  return { ...ids, approvalId };
}

function archiveRealPairBatchRecordFields({ batchId, collection, recordId, recordData, business, callerEmail, now, approvalId }) {
  return {
    ...archiveBatchRecordFields({
      batchId,
      collection,
      recordId,
      recordData,
      business,
      reason: "pre_go_live_test_data",
      callerEmail,
      now
    }),
    scope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
    approvalId
  };
}

async function softArchiveRealActiveJobPairBatch(data, callerEmail) {
  const options = archiveRealPairValidateArchiveRequest(data || {});
  const review = await buildRealActiveJobPairReview(options.activeJobId, options.appointmentId);
  if (!review.eligibility.eligible) {
    throw new HttpsError("failed-precondition", `Pair is not eligible: ${review.eligibility.errors.join("; ")}`);
  }

  const batchId = archiveBatchId();
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(batchId);
  const approvalRef = db.collection(ARCHIVE_REVIEW_APPROVALS_COLLECTION).doc(options.approvalId);
  const activeJobRef = db.collection(ACTIVE_JOBS_COLLECTION).doc(options.activeJobId);
  const appointmentRef = db.collection(ARCHIVE_APPOINTMENTS_COLLECTION).doc(options.appointmentId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const [approvalSnap, activeJobSnap, appointmentSnap] = await Promise.all([
      tx.get(approvalRef),
      tx.get(activeJobRef),
      tx.get(appointmentRef)
    ]);
    if (!approvalSnap.exists) {
      throw new HttpsError("failed-precondition", "Archive review approval was not found.");
    }
    const approval = approvalSnap.data() || {};
    if (approval.status !== "approved" || approval.scope !== ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE) {
      throw new HttpsError("failed-precondition", "Archive review approval is not approved for this scope.");
    }
    if (approval.targetCollection !== ACTIVE_JOBS_COLLECTION
        || approval.targetDocId !== options.activeJobId
        || approval.linkedAppointmentId !== options.appointmentId
        || approval.linkedClientId !== ARCHIVE_REAL_PAIR_CLIENT_ID) {
      throw new HttpsError("failed-precondition", "Archive review approval does not match this pair.");
    }
    if (!activeJobSnap.exists || !appointmentSnap.exists) {
      throw new HttpsError("failed-precondition", "The approved Active_Job pair records must both exist.");
    }
    const activeJob = activeJobSnap.data() || {};
    const appointment = appointmentSnap.data() || {};
    const activeJobBusiness = archiveRealPairDate(activeJob, ACTIVE_JOBS_COLLECTION, "Active_Job");
    const appointmentBusiness = archiveRealPairDate(appointment, ARCHIVE_APPOINTMENTS_COLLECTION, "Appointment");
    if (archivePreviewText(activeJob, ["sourceAppointmentId", "appointmentId", "bookingId"]) !== options.appointmentId) {
      throw new HttpsError("failed-precondition", "Active_Job source appointment does not match the linked Appointment.");
    }
    const riskReasons = [
      ...archiveRealPairRiskReasons(activeJob, "Active_Job"),
      ...archiveRealPairRiskReasons(appointment, "Appointment")
    ];
    if (riskReasons.length) {
      throw new HttpsError("failed-precondition", `Pair failed archive guard: ${riskReasons.join("; ")}`);
    }

    tx.set(batchRef, {
      archiveBatchId: batchId,
      collection: ACTIVE_JOBS_COLLECTION,
      scope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
      pilotScope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
      primaryCollection: ACTIVE_JOBS_COLLECTION,
      linkedCollections: [ARCHIVE_APPOINTMENTS_COLLECTION],
      activeJobId: options.activeJobId,
      appointmentId: options.appointmentId,
      linkedClientId: ARCHIVE_REAL_PAIR_CLIENT_ID,
      approvalId: options.approvalId,
      expectedNetDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.net,
      expectedTaxDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.tax,
      expectedPaidDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.paid,
      expectedCommissionDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.commission,
      expectedCompletedJobsDelta: ARCHIVE_REAL_PAIR_EXPECTED_DELTAS.completedJobs,
      status: "archived",
      reason: "pre_go_live_test_data",
      dateFrom: activeJobBusiness.value,
      dateTo: ARCHIVE_GO_LIVE_CUTOFF_DATE,
      requestedCount: 2,
      archivedCount: 2,
      failedCount: 0,
      rollbackCount: 0,
      recordCount: 2,
      recordIds: [options.activeJobId, options.appointmentId],
      pairedRecords: [
        { collection: ACTIVE_JOBS_COLLECTION, docId: options.activeJobId },
        { collection: ARCHIVE_APPOINTMENTS_COLLECTION, docId: options.appointmentId }
      ],
      createdAt: now,
      createdBy: callerEmail,
      completedAt: now,
      confirmationTextUsed: ARCHIVE_REAL_PAIR_CONFIRMATION,
      readOnly: false,
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    });

    tx.set(batchRef.collection("Records").doc(options.activeJobId), archiveRealPairBatchRecordFields({
      batchId,
      collection: ACTIVE_JOBS_COLLECTION,
      recordId: options.activeJobId,
      recordData: activeJob,
      business: activeJobBusiness,
      callerEmail,
      now,
      approvalId: options.approvalId
    }));
    tx.set(batchRef.collection("Records").doc(options.appointmentId), archiveRealPairBatchRecordFields({
      batchId,
      collection: ARCHIVE_APPOINTMENTS_COLLECTION,
      recordId: options.appointmentId,
      recordData: appointment,
      business: appointmentBusiness,
      callerEmail,
      now,
      approvalId: options.approvalId
    }));
    const marker = archiveRecordMarkerFields({
      batchId,
      reason: "pre_go_live_test_data",
      dateTo: ARCHIVE_GO_LIVE_CUTOFF_DATE,
      callerEmail,
      now
    });
    tx.set(activeJobRef, marker, { merge: true });
    tx.set(appointmentRef, marker, { merge: true });
  });

  logger.info("Real Active_Job paired archive completed", {
    archiveBatchId: batchId,
    callerEmail,
    activeJobId: options.activeJobId,
    appointmentId: options.appointmentId,
    firestoreDeletes: 0
  });

  return {
    ok: true,
    collection: ACTIVE_JOBS_COLLECTION,
    scope: ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE,
    archiveBatchId: batchId,
    archivedCount: 2,
    failedCount: 0,
    firestoreDeletes: 0,
    sourceRecordsDeleted: false
  };
}

async function softArchiveAttendanceBatch(data, callerEmail) {
  const options = archiveValidateSoftArchiveRequest(data || {});
  const batchId = archiveBatchId();
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(batchId);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    const reads = [];
    for (const recordId of options.recordIds) {
      const ref = db.collection(options.collection).doc(recordId);
      const snap = await tx.get(ref);
      if (!snap.exists) {
        throw new HttpsError("failed-precondition", `${archiveExecutionLabel(options.collection)} record not found: ${recordId}`);
      }
      const recordData = snap.data() || {};
      const business = archivePreviewBusinessDate(options.collection, recordData);
      archiveValidateSourceRecordForSoftArchive({
        collection: options.collection,
        recordId,
        recordData,
        business,
        options
      });
      reads.push({ recordId, ref, recordData, business });
    }

    tx.set(batchRef, archiveBatchSummaryFields({
      batchId,
      options,
      callerEmail,
      now
    }));

    for (const item of reads) {
      const recordRef = batchRef.collection("Records").doc(item.recordId);
      tx.set(recordRef, archiveBatchRecordFields({
        batchId,
        collection: options.collection,
        recordId: item.recordId,
        recordData: item.recordData,
        business: item.business,
        reason: options.reason,
        callerEmail,
        now
      }));
      tx.set(item.ref, archiveRecordMarkerFields({
        batchId,
        reason: options.reason,
        dateTo: options.dateTo,
        callerEmail,
        now
      }), { merge: true });
    }
  });

  logger.info("Soft archive pilot batch completed", {
    archiveBatchId: batchId,
    callerEmail,
    recordCount: options.expectedCount,
    collection: options.collection,
    pilotScope: archiveExecutionPilotScope(options.collection),
    firestoreDeletes: 0
  });

  return {
    ok: true,
    collection: options.collection,
    archiveBatchId: batchId,
    archivedCount: options.expectedCount,
    failedCount: 0,
    firestoreDeletes: 0,
    sourceRecordsDeleted: false
  };
}

async function rollbackAttendanceArchiveBatch(data, callerEmail) {
  const options = archiveValidateRollbackRequest(data || {});
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(options.archiveBatchId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  let rollbackCount = 0;
  let collection = "";

  await db.runTransaction(async (tx) => {
    const batchSnap = await tx.get(batchRef);
    if (!batchSnap.exists) {
      throw new HttpsError("not-found", "Archive batch not found.");
    }
    const batchData = batchSnap.data() || {};
    if (batchData.status === "rolled_back") {
      throw new HttpsError("failed-precondition", "Archive batch has already been rolled back.");
    }
    if (batchData.pilotScope === ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE || batchData.scope === ARCHIVE_REAL_ACTIVE_JOB_PAIR_SCOPE) {
      const pairedRecords = Array.isArray(batchData.pairedRecords)
        ? batchData.pairedRecords.map((item) => ({
          collection: String(item && item.collection || "").trim(),
          docId: String(item && item.docId || "").trim()
        })).filter(item => item.collection && item.docId)
        : [
          { collection: ACTIVE_JOBS_COLLECTION, docId: String(batchData.activeJobId || "").trim() },
          { collection: ARCHIVE_APPOINTMENTS_COLLECTION, docId: String(batchData.appointmentId || "").trim() }
        ].filter(item => item.docId);
      if (pairedRecords.length !== 2) {
        throw new HttpsError("failed-precondition", "Real Active_Job pair batch must contain exactly two paired records.");
      }
      if (pairedRecords.length !== options.expectedCount) {
        throw new HttpsError("failed-precondition", "expectedCount must match paired archive batch record count.");
      }
      const allowed = new Set([
        `${ACTIVE_JOBS_COLLECTION}:${ARCHIVE_REAL_PAIR_ACTIVE_JOB_ID}`,
        `${ARCHIVE_APPOINTMENTS_COLLECTION}:${ARCHIVE_REAL_PAIR_APPOINTMENT_ID}`
      ]);
      pairedRecords.forEach((item) => {
        if (!allowed.has(`${item.collection}:${item.docId}`)) {
          throw new HttpsError("failed-precondition", "Archive batch contains an unsupported real paired pilot record.");
        }
      });

      const reads = [];
      for (const item of pairedRecords) {
        const recordRef = batchRef.collection("Records").doc(item.docId);
        const archiveRecordSnap = await tx.get(recordRef);
        if (!archiveRecordSnap.exists) {
          throw new HttpsError("failed-precondition", `Archive batch record is missing: ${item.docId}`);
        }
        const archiveRecordData = archiveRecordSnap.data() || {};
        if (archiveRecordData.rollbackStatus === "rolled_back") {
          throw new HttpsError("failed-precondition", `Archive batch record is already rolled back: ${item.docId}`);
        }
        if (archiveRecordData.collection !== item.collection) {
          throw new HttpsError("failed-precondition", `Archive batch record collection mismatch: ${item.docId}`);
        }

        const sourceRef = db.collection(item.collection).doc(item.docId);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists) {
          throw new HttpsError("failed-precondition", `Paired archive source record no longer exists: ${item.collection}/${item.docId}`);
        }
        const sourceData = sourceSnap.data() || {};
        if (sourceData.archived !== true) {
          throw new HttpsError("failed-precondition", `Paired archive source record is not currently archived: ${item.collection}/${item.docId}`);
        }
        if (sourceData.archiveBatchId !== options.archiveBatchId) {
          throw new HttpsError("failed-precondition", `Paired archive source record has a newer or conflicting archive batch: ${item.collection}/${item.docId}`);
        }
        reads.push({ ...item, recordRef, sourceRef });
      }

      rollbackCount = reads.length;
      collection = ACTIVE_JOBS_COLLECTION;
      for (const item of reads) {
        tx.set(item.sourceRef, {
          archived: false,
          archiveRollbackAt: now,
          archiveRollbackBy: callerEmail,
          archiveRollbackBatchId: options.archiveBatchId,
          archiveRollbackStatus: "rolled_back"
        }, { merge: true });
        tx.set(item.recordRef, {
          rollbackStatus: "rolled_back",
          rollbackAt: now,
          rollbackBy: callerEmail
        }, { merge: true });
      }
      tx.set(batchRef, {
        status: "rolled_back",
        rollbackCount,
        rollbackAt: now,
        rollbackBy: callerEmail,
        rollbackConfirmationTextUsed: "ROLLBACK",
        firestoreDeletes: 0,
        deleteCount: 0
      }, { merge: true });
      return;
    }
    if (batchData.scope === ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE || batchData.pilotScope === ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE) {
      const status = String(batchData.status || "").toLowerCase();
      if (status !== "archived" && status !== "partial_failed") {
        throw new HttpsError("failed-precondition", "Pre-go-live policy batch is not in a rollbackable status.");
      }
      const recordCount = Number.parseInt(String(batchData.recordCount || batchData.archivedCount || ""), 10);
      if (!Number.isInteger(recordCount) || recordCount < 1) {
        throw new HttpsError("failed-precondition", "Pre-go-live policy batch is missing recordCount.");
      }
      if (recordCount !== options.expectedCount) {
        throw new HttpsError("failed-precondition", "expectedCount must match pre-go-live policy batch record count.");
      }
      if (recordCount > ARCHIVE_PRE_GO_LIVE_MAX_TARGETS) {
        throw new HttpsError("failed-precondition", "Pre-go-live policy batch exceeds rollback size guard.");
      }

      const recordsSnap = await tx.get(batchRef.collection("Records"));
      const archiveRecords = recordsSnap.docs.map((doc) => ({
        recordRef: doc.ref,
        recordKey: doc.id,
        data: doc.data() || {}
      }));
      if (archiveRecords.length !== recordCount) {
        throw new HttpsError("failed-precondition", "Pre-go-live policy batch snapshot count does not match recordCount.");
      }

      const reads = [];
      for (const item of archiveRecords) {
        const archiveRecordData = item.data || {};
        const collectionName = String(archiveRecordData.collection || "").trim();
        const docId = String(archiveRecordData.docId || "").trim();
        if (!ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.includes(collectionName) || !docId) {
          throw new HttpsError("failed-precondition", `Pre-go-live policy batch contains unsupported record: ${item.recordKey}`);
        }
        if (archiveRecordData.scope !== ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE) {
          throw new HttpsError("failed-precondition", `Pre-go-live policy batch record scope mismatch: ${item.recordKey}`);
        }
        if (archiveRecordData.rollbackStatus === "rolled_back") {
          throw new HttpsError("failed-precondition", `Pre-go-live policy batch record is already rolled back: ${item.recordKey}`);
        }
        if (archiveRecordData.archiveResult !== "archived") {
          throw new HttpsError("failed-precondition", `Pre-go-live policy batch record was not archived: ${item.recordKey}`);
        }

        const sourceRef = db.collection(collectionName).doc(docId);
        const sourceSnap = await tx.get(sourceRef);
        if (!sourceSnap.exists) {
          throw new HttpsError("failed-precondition", `Pre-go-live policy source record no longer exists: ${collectionName}/${docId}`);
        }
        const sourceData = sourceSnap.data() || {};
        if (sourceData.archived !== true) {
          throw new HttpsError("failed-precondition", `Pre-go-live policy source record is not currently archived: ${collectionName}/${docId}`);
        }
        if (sourceData.archiveBatchId !== options.archiveBatchId) {
          throw new HttpsError("failed-precondition", `Pre-go-live policy source record has a newer or conflicting archive batch: ${collectionName}/${docId}`);
        }
        reads.push({
          collection: collectionName,
          docId,
          recordRef: item.recordRef,
          sourceRef
        });
      }

      rollbackCount = reads.length;
      collection = ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE;
      for (const item of reads) {
        tx.set(item.sourceRef, {
          archived: false,
          archiveRollbackAt: now,
          archiveRollbackBy: callerEmail,
          archiveRollbackBatchId: options.archiveBatchId,
          archiveRollbackStatus: "rolled_back"
        }, { merge: true });
        tx.set(item.recordRef, {
          rollbackStatus: "rolled_back",
          rollbackAt: now,
          rollbackBy: callerEmail
        }, { merge: true });
      }
      tx.set(batchRef, {
        status: "rolled_back",
        rollbackCount,
        rollbackAt: now,
        rollbackBy: callerEmail,
        rollbackConfirmationTextUsed: "ROLLBACK",
        firestoreDeletes: 0,
        deleteCount: 0,
        sourceRecordsDeleted: false
      }, { merge: true });
      return;
    }
    collection = archiveValidateExecutionCollection(batchData.collection);
    if (batchData.pilotScope !== archiveExecutionPilotScope(collection)) {
      throw new HttpsError("failed-precondition", "Archive batch pilot scope is not supported for rollback.");
    }
    const recordIds = Array.isArray(batchData.recordIds)
      ? batchData.recordIds.map((id) => String(id || "").trim()).filter(Boolean)
      : [];
    if (!recordIds.length) {
      throw new HttpsError("failed-precondition", `Archive batch has no recorded ${archiveExecutionLabel(collection)} ids.`);
    }
    if (recordIds.length !== options.expectedCount) {
      throw new HttpsError("failed-precondition", "expectedCount must match archive batch record count.");
    }
    if (recordIds.length > archiveExecutionMaxRecords(collection)) {
      throw new HttpsError("failed-precondition", "Archive batch exceeds pilot rollback size.");
    }

    const reads = [];
    for (const recordId of recordIds) {
      const recordRef = batchRef.collection("Records").doc(recordId);
      const archiveRecordSnap = await tx.get(recordRef);
      if (!archiveRecordSnap.exists) {
        throw new HttpsError("failed-precondition", `Archive batch record is missing: ${recordId}`);
      }
      const archiveRecordData = archiveRecordSnap.data() || {};
      if (archiveRecordData.rollbackStatus === "rolled_back") {
        throw new HttpsError("failed-precondition", `Archive batch record is already rolled back: ${recordId}`);
      }

      const sourceRef = db.collection(collection).doc(recordId);
      const sourceSnap = await tx.get(sourceRef);
      if (!sourceSnap.exists) {
        throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record no longer exists: ${recordId}`);
      }
      const sourceData = sourceSnap.data() || {};
      if (sourceData.archived !== true) {
        throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record is not currently archived: ${recordId}`);
      }
      if (sourceData.archiveBatchId !== options.archiveBatchId) {
        throw new HttpsError("failed-precondition", `${archiveExecutionLabel(collection)} record has a newer or conflicting archive batch: ${recordId}`);
      }
      reads.push({ recordId, recordRef, sourceRef });
    }

    rollbackCount = reads.length;
    for (const item of reads) {
      tx.set(item.sourceRef, {
        archived: false,
        archiveRollbackAt: now,
        archiveRollbackBy: callerEmail,
        archiveRollbackBatchId: options.archiveBatchId,
        archiveRollbackStatus: "rolled_back"
      }, { merge: true });
      tx.set(item.recordRef, {
        rollbackStatus: "rolled_back",
        rollbackAt: now,
        rollbackBy: callerEmail
      }, { merge: true });
    }

    tx.set(batchRef, {
      status: "rolled_back",
      rollbackCount,
      rollbackAt: now,
      rollbackBy: callerEmail,
      rollbackConfirmationTextUsed: "ROLLBACK",
      firestoreDeletes: 0,
      deleteCount: 0
    }, { merge: true });
  });

  logger.info("Archive pilot rollback completed", {
    archiveBatchId: options.archiveBatchId,
    callerEmail,
    rollbackCount,
    collection,
    firestoreDeletes: 0
  });

  return {
    ok: true,
    collection,
    archiveBatchId: options.archiveBatchId,
    rollbackCount,
    firestoreDeletes: 0,
    sourceRecordsDeleted: false
  };
}

async function rollbackProductionPreGoLiveArchiveBatch(data, authInfo) {
  archiveProductionPreGoLiveAssertProductionProject();
  const options = archiveValidateProductionRollbackRequest(data || {});
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(options.archiveBatchId);
  const batchSnap = await batchRef.get();
  if (!batchSnap.exists) {
    throw new HttpsError("not-found", "Archive batch not found.");
  }
  const batchData = batchSnap.data() || {};
  if (batchData.scope !== ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE &&
      batchData.pilotScope !== ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE) {
    throw new HttpsError("failed-precondition", "Archive batch is not a production pre-go-live archive batch.");
  }
  const status = String(batchData.status || "").toLowerCase();
  if (status !== "archived" && status !== "partial_failed") {
    throw new HttpsError("failed-precondition", "Archive batch is not in a rollbackable status.");
  }
  const archivedCount = Number.parseInt(String(batchData.archivedCount || batchData.recordCount || ""), 10);
  if (!Number.isInteger(archivedCount) || archivedCount < 1) {
    throw new HttpsError("failed-precondition", "Archive batch is missing archivedCount.");
  }
  if (archivedCount !== options.expectedCount) {
    throw new HttpsError("failed-precondition", "expectedCount must match archive batch archivedCount.");
  }
  if (archivedCount > ARCHIVE_PRODUCTION_PRE_GO_LIVE_MAX_TARGETS) {
    throw new HttpsError("failed-precondition", "Archive batch exceeds production rollback size guard.");
  }

  const recordsSnap = await batchRef.collection("Records").get();
  const archiveRecords = recordsSnap.docs.map((doc) => ({
    recordRef: doc.ref,
    recordKey: doc.id,
    data: doc.data() || {}
  }));
  if (archiveRecords.length !== archivedCount) {
    throw new HttpsError("failed-precondition", "Archive batch snapshot count does not match archivedCount.");
  }

  let rollbackCount = 0;
  const chunks = archiveProductionChunk(archiveRecords, ARCHIVE_PRODUCTION_PRE_GO_LIVE_CHUNK_SIZE);
  try {
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex];
      const now = admin.firestore.FieldValue.serverTimestamp();
      await db.runTransaction(async (tx) => {
        const reads = [];
        for (const item of chunk) {
          const archiveRecordData = item.data || {};
          const collectionName = String(archiveRecordData.collection || "").trim();
          const docId = String(archiveRecordData.docId || "").trim();
          if (!ARCHIVE_PRE_GO_LIVE_POLICY_ALLOWED_COLLECTIONS.includes(collectionName) || !docId) {
            throw new HttpsError("failed-precondition", `Production batch contains unsupported record: ${item.recordKey}`);
          }
          if (archiveRecordData.scope !== ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE) {
            throw new HttpsError("failed-precondition", `Production batch record scope mismatch: ${item.recordKey}`);
          }
          if (archiveRecordData.rollbackStatus === "rolled_back") {
            throw new HttpsError("failed-precondition", `Production batch record is already rolled back: ${item.recordKey}`);
          }
          if (archiveRecordData.archiveResult !== "archived") {
            throw new HttpsError("failed-precondition", `Production batch record was not archived: ${item.recordKey}`);
          }

          const sourceRef = db.collection(collectionName).doc(docId);
          const sourceSnap = await tx.get(sourceRef);
          if (!sourceSnap.exists) {
            throw new HttpsError("failed-precondition", `Production source record no longer exists: ${collectionName}/${docId}`);
          }
          const sourceData = sourceSnap.data() || {};
          if (sourceData.archived !== true) {
            throw new HttpsError("failed-precondition", `Production source record is not currently archived: ${collectionName}/${docId}`);
          }
          if (sourceData.archiveBatchId !== options.archiveBatchId) {
            throw new HttpsError("failed-precondition", `Production source record has a newer or conflicting archive batch: ${collectionName}/${docId}`);
          }
          reads.push({
            collection: collectionName,
            docId,
            recordRef: item.recordRef,
            sourceRef
          });
        }

        for (const item of reads) {
          tx.set(item.sourceRef, {
            archived: false,
            archiveBatchId: "",
            archivedReason: "",
            archiveReason: "",
            archiveScope: "",
            archivePolicy: "",
            archiveRollbackAt: now,
            archiveRollbackBy: authInfo.email,
            archiveRollbackBatchId: options.archiveBatchId,
            archiveRollbackStatus: "rolled_back",
            archiveRollbackScope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE
          }, { merge: true });
          tx.set(item.recordRef, {
            rollbackStatus: "rolled_back",
            rollbackAt: now,
            rollbackBy: authInfo.email
          }, { merge: true });
        }

        tx.set(batchRef, {
          rollbackCount: admin.firestore.FieldValue.increment(reads.length),
          updatedAt: now,
          lastRollbackChunkIndex: chunkIndex,
          firestoreDeletes: 0,
          deleteCount: 0,
          sourceRecordsDeleted: false
        }, { merge: true });
      });
      rollbackCount += chunk.length;
    }

    await batchRef.set({
      status: "rolled_back",
      rollbackCount,
      rollbackAt: admin.firestore.FieldValue.serverTimestamp(),
      rollbackBy: authInfo.email,
      rollbackConfirmationTextUsed: ARCHIVE_PRODUCTION_PRE_GO_LIVE_ROLLBACK_CONFIRMATION,
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    }, { merge: true });
  } catch (error) {
    await batchRef.set({
      status: "rollback_partial_failed",
      rollbackCount,
      rollbackFailedAt: admin.firestore.FieldValue.serverTimestamp(),
      rollbackFailureMessage: error && error.message ? error.message : String(error || ""),
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    }, { merge: true });
    throw error;
  }

  logger.info("Production pre-go-live archive rollback completed", {
    archiveBatchId: options.archiveBatchId,
    callerEmail: authInfo.email,
    rollbackCount,
    firestoreDeletes: 0
  });

  return {
    ok: true,
    scope: ARCHIVE_PRODUCTION_PRE_GO_LIVE_EXECUTION_SCOPE,
    archiveBatchId: options.archiveBatchId,
    rollbackCount,
    firestoreDeletes: 0,
    deleteCount: 0,
    sourceRecordsDeleted: false
  };
}

function archiveStagingSyntheticValidationRecords() {
  return [
    {
      docId: "DA5E1_SYNTHETIC_ACTIVE_JOB_2026_04_02",
      collectionType: ACTIVE_JOBS_COLLECTION,
      dateString: "2026-04-02",
      status: "Closed",
      clientName: "DA-5E-1 Synthetic Active Job",
      serviceName: "Synthetic Archive Validation",
      netRevenue: 10,
      paidAmount: 12,
      taxTotal: 2
    },
    {
      docId: "DA5E1_SYNTHETIC_APPOINTMENT_2026_04_03",
      collectionType: ARCHIVE_APPOINTMENTS_COLLECTION,
      dateString: "2026-04-03",
      status: "Completed",
      clientName: "DA-5E-1 Synthetic Appointment",
      serviceName: "Synthetic Archive Validation"
    },
    {
      docId: "DA5E1_SYNTHETIC_ATTENDANCE_2026_04_04",
      collectionType: ARCHIVE_ATTENDANCE_COLLECTION,
      date: "2026-04-04",
      status: "Clocked Out",
      staffName: "DA-5E-1 Synthetic Attendance"
    }
  ];
}

function archiveStagingSyntheticBusinessDate(row) {
  const field = row.collectionType === ARCHIVE_ATTENDANCE_COLLECTION ? "date" : "dateString";
  return { field, value: archivePreviewDateString(row && row[field]) };
}

function archiveStagingSyntheticMarkerFields({ batchId, callerEmail, now }) {
  return {
    archived: true,
    archivedReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    archiveReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    archivedAt: now,
    archivedBy: callerEmail,
    archiveBatchId: batchId,
    archiveCutoffDate: ARCHIVE_GO_LIVE_CUTOFF_DATE,
    archiveScope: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE,
    archivePolicy: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE
  };
}

function archiveStagingSyntheticSnapshot({ batchId, docId, recordData, callerEmail, now }) {
  const business = archiveStagingSyntheticBusinessDate(recordData);
  return {
    archiveBatchId: batchId,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    scope: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE,
    archivePolicyScope: ARCHIVE_PRE_GO_LIVE_POLICY_SCOPE,
    sourceCollection: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION,
    collection: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION,
    sourceCollectionType: recordData.collectionType || "",
    docId,
    dateField: business.field,
    businessDate: business.value,
    status: archivePreviewStatus(recordData),
    clientName: archivePreviewText(recordData, ["clientName", "staffName"]),
    originalDataSnapshot: recordData,
    archiveResult: "archived",
    archivedAt: now,
    archivedBy: callerEmail,
    archiveReason: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    rollbackStatus: "not_rolled_back"
  };
}

function archiveStagingSyntheticAssertProject() {
  const projectId = currentFirebaseProjectId();
  if (projectId !== ARCHIVE_STAGING_PROJECT_ID) {
    throw new HttpsError("failed-precondition", "Synthetic archive validation is available on staging only.");
  }
}

function archiveStagingSyntheticValidateRequest(data) {
  const expectedCount = archiveValidateExpectedCount(data && data.expectedCount);
  if (expectedCount !== archiveStagingSyntheticValidationRecords().length) {
    throw new HttpsError("invalid-argument", "expectedCount must match the staging synthetic validation record count.");
  }
  if (String(data && data.confirmationText || "").trim() !== ARCHIVE_STAGING_SYNTHETIC_ARCHIVE_CONFIRMATION) {
    throw new HttpsError("failed-precondition", `confirmationText must be exactly: ${ARCHIVE_STAGING_SYNTHETIC_ARCHIVE_CONFIRMATION}`);
  }
  if (String(data && data.rollbackConfirmationText || "").trim() !== ARCHIVE_STAGING_SYNTHETIC_ROLLBACK_CONFIRMATION) {
    throw new HttpsError("failed-precondition", `rollbackConfirmationText must be exactly: ${ARCHIVE_STAGING_SYNTHETIC_ROLLBACK_CONFIRMATION}`);
  }
  return { expectedCount };
}

async function validateStagingSyntheticArchiveRollback(data, authInfo) {
  archiveStagingSyntheticAssertProject();
  const options = archiveStagingSyntheticValidateRequest(data || {});
  const sourceCollectionRef = db.collection(ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION);
  const retainedBatchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc("ARCHIVE_20260609203725_f260b5a0");
  const retainedBefore = await retainedBatchRef.get();
  const syntheticRows = archiveStagingSyntheticValidationRecords();
  const batchId = archiveBatchId();
  const batchRef = db.collection(ARCHIVE_BATCHES_COLLECTION).doc(batchId);
  const recordKeys = syntheticRows.map((row) => archivePreGoLivePolicyRecordKey(
    ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION,
    row.docId
  ));
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    syntheticRows.forEach((row) => {
      tx.set(sourceCollectionRef.doc(row.docId), {
        ...row,
        source: "DA-5E-1 staging synthetic validation",
        testRecord: true,
        archived: false,
        archiveBatchId: "",
        createdFor: "DA-5E-1 archive execution rollback validation",
        updatedAt: now,
        updatedBy: authInfo.email
      }, { merge: true });
    });
  });

  await batchRef.set({
    archiveBatchId: batchId,
    policyId: ARCHIVE_PRE_GO_LIVE_POLICY_ID,
    policyLabel: ARCHIVE_PRE_GO_LIVE_POLICY_LABEL,
    scope: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE,
    pilotScope: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE,
    sourceCollection: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION,
    createdBy: authInfo.email,
    createdAt: now,
    updatedAt: now,
    status: "archiving",
    targetCount: options.expectedCount,
    recordCount: 0,
    archivedCount: 0,
    failedCount: 0,
    rollbackCount: 0,
    deleteCount: 0,
    firestoreDeletes: 0,
    sourceRecordsDeleted: false,
    recordKeys,
    confirmationTextUsed: ARCHIVE_STAGING_SYNTHETIC_ARCHIVE_CONFIRMATION,
    readOnly: false
  });

  await db.runTransaction(async (tx) => {
    const reads = [];
    for (const row of syntheticRows) {
      const sourceRef = sourceCollectionRef.doc(row.docId);
      const sourceSnap = await tx.get(sourceRef);
      if (!sourceSnap.exists) {
        throw new HttpsError("failed-precondition", `Synthetic source record missing: ${row.docId}`);
      }
      const recordData = sourceSnap.data() || {};
      const business = archiveStagingSyntheticBusinessDate(recordData);
      if (!business.value || business.value >= ARCHIVE_GO_LIVE_CUTOFF_DATE) {
        throw new HttpsError("failed-precondition", `Synthetic source record does not have a protected pre-go-live business date: ${row.docId}`);
      }
      if (recordData.archived === true) {
        throw new HttpsError("failed-precondition", `Synthetic source record is unexpectedly archived before validation: ${row.docId}`);
      }
      reads.push({ row, sourceRef, recordData });
    }

    for (const item of reads) {
      const recordKey = archivePreGoLivePolicyRecordKey(ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION, item.row.docId);
      tx.set(batchRef.collection("Records").doc(recordKey), archiveStagingSyntheticSnapshot({
        batchId,
        docId: item.row.docId,
        recordData: item.recordData,
        callerEmail: authInfo.email,
        now
      }));
      tx.set(item.sourceRef, archiveStagingSyntheticMarkerFields({
        batchId,
        callerEmail: authInfo.email,
        now
      }), { merge: true });
    }

    tx.set(batchRef, {
      status: "archived",
      recordCount: reads.length,
      archivedCount: reads.length,
      completedAt: now,
      failedCount: 0,
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    }, { merge: true });
  });

  const archiveBatchSnap = await batchRef.get();
  const archiveRecordsSnap = await batchRef.collection("Records").get();
  const archivedSourceSnaps = await Promise.all(syntheticRows.map(row => sourceCollectionRef.doc(row.docId).get()));
  const archiveMarkersValid = archivedSourceSnaps.every((snap) => {
    const row = snap.data() || {};
    return row.archived === true &&
      row.archiveBatchId === batchId &&
      row.archiveReason === ARCHIVE_PRE_GO_LIVE_POLICY_ID &&
      row.archiveScope === ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE;
  });
  const snapshotsValid = archiveRecordsSnap.size === syntheticRows.length &&
    archiveRecordsSnap.docs.every((doc) => {
      const row = doc.data() || {};
      return row.archiveBatchId === batchId &&
        row.scope === ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE &&
        row.archiveResult === "archived" &&
        row.rollbackStatus === "not_rolled_back";
    });

  await db.runTransaction(async (tx) => {
    const reads = [];
    for (const row of syntheticRows) {
      const recordKey = archivePreGoLivePolicyRecordKey(ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION, row.docId);
      const recordRef = batchRef.collection("Records").doc(recordKey);
      const recordSnap = await tx.get(recordRef);
      if (!recordSnap.exists) {
        throw new HttpsError("failed-precondition", `Synthetic archive snapshot missing: ${row.docId}`);
      }
      const sourceRef = sourceCollectionRef.doc(row.docId);
      const sourceSnap = await tx.get(sourceRef);
      if (!sourceSnap.exists) {
        throw new HttpsError("failed-precondition", `Synthetic source record missing before rollback: ${row.docId}`);
      }
      const sourceData = sourceSnap.data() || {};
      if (sourceData.archived !== true || sourceData.archiveBatchId !== batchId) {
        throw new HttpsError("failed-precondition", `Synthetic source record is not archived by this batch: ${row.docId}`);
      }
      reads.push({ sourceRef, recordRef });
    }

    for (const item of reads) {
      tx.set(item.sourceRef, {
        archived: false,
        archiveBatchId: "",
        archivedReason: "",
        archiveReason: "",
        archiveScope: "",
        archivePolicy: "",
        archiveRollbackAt: now,
        archiveRollbackBy: authInfo.email,
        archiveRollbackBatchId: batchId,
        archiveRollbackStatus: "rolled_back",
        archiveRollbackScope: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_SCOPE
      }, { merge: true });
      tx.set(item.recordRef, {
        rollbackStatus: "rolled_back",
        rollbackAt: now,
        rollbackBy: authInfo.email
      }, { merge: true });
    }
    tx.set(batchRef, {
      status: "rolled_back",
      rollbackCount: reads.length,
      rollbackAt: now,
      rollbackBy: authInfo.email,
      rollbackConfirmationTextUsed: ARCHIVE_STAGING_SYNTHETIC_ROLLBACK_CONFIRMATION,
      firestoreDeletes: 0,
      deleteCount: 0,
      sourceRecordsDeleted: false
    }, { merge: true });
  });

  const rolledBackBatchSnap = await batchRef.get();
  const rolledBackRecordsSnap = await batchRef.collection("Records").get();
  const rolledBackSourceSnaps = await Promise.all(syntheticRows.map(row => sourceCollectionRef.doc(row.docId).get()));
  const rollbackValid = rolledBackSourceSnaps.every((snap) => {
    const row = snap.data() || {};
    return row.archived === false &&
      !row.archiveBatchId &&
      !row.archiveReason &&
      !row.archiveScope &&
      row.archiveRollbackBatchId === batchId &&
      row.archiveRollbackStatus === "rolled_back";
  });
  const rollbackSnapshotsRetained = rolledBackRecordsSnap.size === syntheticRows.length &&
    rolledBackRecordsSnap.docs.every((doc) => (doc.data() || {}).rollbackStatus === "rolled_back");
  const retainedAfter = await retainedBatchRef.get();
  const retainedBatchUntouched = retainedBefore.exists === retainedAfter.exists &&
    JSON.stringify(retainedBefore.exists ? retainedBefore.data() || {} : {}) ===
    JSON.stringify(retainedAfter.exists ? retainedAfter.data() || {} : {});

  return {
    ok: true,
    harness: "DA-5E-1 staging synthetic archive rollback validation",
    projectId: currentFirebaseProjectId(),
    sourceCollection: ARCHIVE_STAGING_SYNTHETIC_VALIDATION_COLLECTION,
    syntheticRecordIds: syntheticRows.map(row => row.docId),
    archiveBatchId: batchId,
    archiveResult: {
      status: (archiveBatchSnap.data() || {}).status,
      archivedCount: (archiveBatchSnap.data() || {}).archivedCount,
      firestoreDeletes: (archiveBatchSnap.data() || {}).firestoreDeletes || 0,
      sourceRecordsDeleted: (archiveBatchSnap.data() || {}).sourceRecordsDeleted === true,
      archiveMarkersValid,
      snapshotsValid,
      snapshotCount: archiveRecordsSnap.size
    },
    rollbackResult: {
      status: (rolledBackBatchSnap.data() || {}).status,
      rollbackCount: (rolledBackBatchSnap.data() || {}).rollbackCount,
      firestoreDeletes: (rolledBackBatchSnap.data() || {}).firestoreDeletes || 0,
      sourceRecordsDeleted: (rolledBackBatchSnap.data() || {}).sourceRecordsDeleted === true,
      rollbackValid,
      snapshotsRetained: rollbackSnapshotsRetained,
      snapshotCount: rolledBackRecordsSnap.size
    },
    retainedStagingBatch: {
      archiveBatchId: "ARCHIVE_20260609203725_f260b5a0",
      exists: retainedAfter.exists,
      untouched: retainedBatchUntouched
    },
    firestoreDeletes: 0,
    sourceRecordsDeleted: false,
    productionTouched: false
  };
}

function currentFirebaseProjectId() {
  if (process.env.GCLOUD_PROJECT) return String(process.env.GCLOUD_PROJECT);
  if (process.env.GCP_PROJECT) return String(process.env.GCP_PROJECT);
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
    return String(config.projectId || "");
  } catch (error) {
    return "";
  }
}

function assertStagingOnlyPreview() {
  const projectId = currentFirebaseProjectId();
  if (projectId !== "thuraya-staging") {
    throw new HttpsError("failed-precondition", "Group complimentary projection preview is available on staging only.");
  }
}

function assertStagingOnlyArchivePreview() {
  const projectId = currentFirebaseProjectId();
  if (projectId !== "thuraya-staging") {
    throw new HttpsError("failed-precondition", "Archive manifest preview is available on staging only.");
  }
}

function assertStagingOnlyArchiveExecution() {
  const projectId = currentFirebaseProjectId();
  if (projectId !== "thuraya-staging") {
    throw new HttpsError("failed-precondition", "Archive execution is available on staging only.");
  }
}

exports.setApprovalPin = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  const config = assertFeatureEnabled();
  const caller = await requireManagerOrAdminCaller(authInfo);
  const data = request.data || {};
  const target = await resolveTargetUser(data.targetEmail || data.email, caller, true);
  const pin = assertValidPin(data.pin);
  const canApproveComplimentary = data.canApproveComplimentary !== false;
  const canApproveDiscounts = data.canApproveDiscounts === true;
  const now = admin.firestore.FieldValue.serverTimestamp();
  const { salt, hash } = createPinHash(pin, config.pepper);
  const authUser = await getAuthUserByEmail(target.email);

  await db.runTransaction(async (tx) => {
    tx.set(pinSecretRef(target.email), {
      targetEmail: target.email,
      targetUid: authUser && authUser.uid ? authUser.uid : "",
      pinHash: hash,
      pinSalt: salt,
      hashAlgorithm: HASH_ALGORITHM,
      hashVersion: HASH_VERSION,
      pinPepperVersion: config.pepperVersion,
      approvalPinEnabled: true,
      failedAttemptCount: 0,
      lockUntil: null,
      lastFailedAt: null,
      lastSuccessAt: null,
      updatedAt: now,
      updatedBy: authInfo.email
    }, { merge: true });

    tx.set(target.ref, {
      approvalPinEnabled: true,
      canApproveComplimentary,
      canApproveDiscounts,
      approvalPinUpdatedAt: now,
      approvalPinUpdatedBy: authInfo.email
    }, { merge: true });
  });

  const auditId = await writeAudit(data, authInfo, {
    approvalType: "set_approval_pin",
    approvedBy: target.email,
    status: "approved",
    approvedAt: now
  });

  return {
    ok: true,
    targetEmail: target.email,
    approvalPinEnabled: true,
    canApproveComplimentary,
    canApproveDiscounts,
    auditId
  };
});

exports.verifyApprovalPin = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  const config = assertFeatureEnabled();
  await requireStaffCaller(authInfo);
  return verifyApprovalPinAttempt(request.data || {}, authInfo, config);
});

exports.markComplimentaryService = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  const config = assertFeatureEnabled();
  await requireStaffCaller(authInfo);
  const data = request.data || {};
  const jobId = String(data.jobId || "").trim();
  const serviceItemIndex = Number.parseInt(data.serviceItemIndex, 10);
  const reason = String(data.reason || "").trim();

  if (!jobId) {
    throw new HttpsError("invalid-argument", "Active job id is required.");
  }
  if (!Number.isInteger(serviceItemIndex) || serviceItemIndex < 0) {
    throw new HttpsError("invalid-argument", "A valid service item index is required.");
  }
  if (!reason) {
    throw new HttpsError("invalid-argument", "Complimentary reason is required.");
  }

  const jobRef = db.collection(ACTIVE_JOBS_COLLECTION).doc(jobId);
  const preflightSnap = await jobRef.get();
  if (!preflightSnap.exists) {
    throw new HttpsError("not-found", "Active job was not found.");
  }
  const preflightJob = preflightSnap.data() || {};
  if (isClosedJobStatus(preflightJob.status)) {
    throw new HttpsError("failed-precondition", "Closed, cancelled, or no-show jobs cannot be marked complimentary.");
  }
  if (isGroupJob(preflightJob)) {
    throw new HttpsError("failed-precondition", "Group complimentary approvals are not enabled in this phase.");
  }
  const preflightItems = resolveComplimentaryServiceLines(preflightJob);
  if (!preflightItems.length) {
    throw new HttpsError("failed-precondition", "This job does not have itemized serviceLineItems to mark.");
  }
  if (serviceItemIndex >= preflightItems.length) {
    throw new HttpsError("invalid-argument", "Selected service item was not found.");
  }

  const verification = await verifyApprovalPinAttempt({
    ...data,
    approvalType: "complimentary_service_marker",
    reason,
    requestedBy: normalizeEmail(data.requestedBy) || authInfo.email,
    jobId,
    serviceId: String(data.serviceId || (data.serviceItemIndex !== undefined ? data.serviceItemIndex : ""))
  }, authInfo, config);

  if (verification.approved !== true) {
    return {
      ok: false,
      marked: false,
      ...verification
    };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const markerAt = admin.firestore.Timestamp.now();
  let markedService = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Active job was not found.");
    }

    const job = snap.data() || {};
    if (isClosedJobStatus(job.status)) {
      throw new HttpsError("failed-precondition", "Closed, cancelled, or no-show jobs cannot be marked complimentary.");
    }
    if (isGroupJob(job)) {
      throw new HttpsError("failed-precondition", "Group complimentary approvals are not enabled in this phase.");
    }

    const items = resolveComplimentaryServiceLines(job);
    if (!items.length) {
      throw new HttpsError("failed-precondition", "This job does not have itemized serviceLineItems to mark.");
    }
    if (serviceItemIndex >= items.length) {
      throw new HttpsError("invalid-argument", "Selected service item was not found.");
    }

    const current = items[serviceItemIndex] || {};
    const qty = serviceQty(current);
    const unitPrice = serviceUnitPrice(current);
    const lineTotal = serviceLineTotal(current);
    const name = serviceName(current);
    const marked = {
      ...current,
      isComplimentary: true,
      complimentaryStatus: "approved_marker_only",
      complimentaryReason: reason,
      complimentaryApprovedBy: verification.approvedBy,
      complimentaryApprovedAt: markerAt,
      complimentaryRequestedBy: normalizeEmail(data.requestedBy) || authInfo.email,
      approvalAuditId: verification.auditId,
      originalUnitPrice: current.originalUnitPrice ?? unitPrice,
      originalLineTotal: current.originalLineTotal ?? lineTotal,
      originalQty: current.originalQty ?? qty,
      originalName: current.originalName || name,
      complimentaryValue: lineTotal,
      complimentaryMarkerVersion: "SERVICE_COMP_MARKER_V1",
      complimentaryTotalsApplied: false
    };
    const updatedItems = items.map((item, index) => index === serviceItemIndex ? marked : item);

    tx.set(jobRef, {
      serviceLineItems: updatedItems,
      hasComplimentaryAdjustment: true,
      complimentaryAdjustmentPhase: "marker_only_v1",
      complimentaryScope: "service",
      complimentaryStatus: "approved_marker_only",
      complimentaryReason: reason,
      complimentaryRequestedBy: normalizeEmail(data.requestedBy) || authInfo.email,
      complimentaryApprovedBy: verification.approvedBy,
      complimentaryApprovedAt: now,
      complimentaryApprovalAuditId: verification.auditId,
      complimentaryServiceIndex: serviceItemIndex,
      complimentaryServiceName: name,
      complimentaryValue: lineTotal,
      complimentaryTotalsApplied: false,
      complimentaryUpdatedAt: now,
      complimentaryUpdatedBy: authInfo.email
    }, { merge: true });

    markedService = {
      index: serviceItemIndex,
      name,
      qty,
      originalUnitPrice: unitPrice,
      originalLineTotal: lineTotal
    };
  });

  return {
    ok: true,
    marked: true,
    status: "marked",
    phase: "marker_only_v1",
    approvedBy: verification.approvedBy,
    auditId: verification.auditId,
    jobId,
    serviceItemIndex,
    service: markedService
  };
});

exports.applyComplimentaryServiceAdjustment = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  assertFeatureEnabled();
  await requireStaffCaller(authInfo);
  const data = request.data || {};
  const jobId = String(data.jobId || "").trim();
  const serviceItemIndex = Number.parseInt(data.serviceItemIndex, 10);

  if (!jobId) {
    throw new HttpsError("invalid-argument", "Active job id is required.");
  }
  if (!Number.isInteger(serviceItemIndex) || serviceItemIndex < 0) {
    throw new HttpsError("invalid-argument", "A valid service item index is required.");
  }

  const jobRef = db.collection(ACTIVE_JOBS_COLLECTION).doc(jobId);
  const now = admin.firestore.FieldValue.serverTimestamp();
  let result = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Active job was not found.");
    }

    const job = snap.data() || {};
    if (isClosedJobStatus(job.status)) {
      throw new HttpsError("failed-precondition", "Closed, cancelled, or no-show jobs cannot receive complimentary recalculation.");
    }
    if (isGroupJob(job)) {
      throw new HttpsError("failed-precondition", "Group complimentary recalculation is not enabled in this phase.");
    }

    const items = resolveComplimentaryServiceLines(job);
    if (!items.length) {
      throw new HttpsError("failed-precondition", "This job does not have itemized serviceLineItems to recalculate.");
    }
    if (serviceItemIndex >= items.length) {
      throw new HttpsError("invalid-argument", "Selected service item was not found.");
    }

    const approvedMarkers = items
      .map((item, index) => ({ item: item || {}, index }))
      .filter(({ item }) => item.isComplimentary === true && item.complimentaryStatus === "approved_marker_only");
    if (approvedMarkers.length !== 1 || approvedMarkers[0].index !== serviceItemIndex) {
      throw new HttpsError("failed-precondition", "Phase 6A requires exactly one approved service-level complimentary marker.");
    }

    const current = items[serviceItemIndex] || {};
    if (!current.approvalAuditId || !current.complimentaryApprovedBy) {
      throw new HttpsError("failed-precondition", "Selected service is missing complimentary approval audit metadata.");
    }

    const originalUnitPrice = safeNumber(current.originalUnitPrice ?? current.unitPrice ?? current.price ?? current.amount, 0);
    const originalLineTotal = safeNumber(current.originalLineTotal ?? current.lineTotal, serviceLineTotal(current));
    const originalQty = serviceQty(current);
    const marked = {
      ...current,
      unitPrice: 0,
      price: 0,
      amount: 0,
      lineTotal: 0,
      payableLineTotal: 0,
      complimentaryStatus: "financial_applied",
      complimentaryTotalsApplied: true,
      complimentaryAppliedAt: admin.firestore.Timestamp.now(),
      complimentaryAppliedBy: authInfo.email,
      originalUnitPrice: current.originalUnitPrice ?? originalUnitPrice,
      originalLineTotal: current.originalLineTotal ?? originalLineTotal,
      originalQty: current.originalQty ?? originalQty,
      complimentaryValue: current.complimentaryValue ?? originalLineTotal,
      complimentaryAdjustmentVersion: "SERVICE_COMP_FINANCIAL_V1"
    };

    const updatedItems = items.map((item, index) => index === serviceItemIndex ? marked : item);
    const totals = calculateComplimentaryTotals(job, updatedItems);
    const updatedServiceLineItems = totals.serviceLineItems;
    const originalTotals = job.complimentaryOriginalTotals || originalTotalsSnapshot(job);
    const originalServiceLineItems = Array.isArray(job.complimentaryOriginalServiceLineItems)
      ? job.complimentaryOriginalServiceLineItems
      : (Array.isArray(job.serviceLineItems) ? job.serviceLineItems : items);
    const taxBreakdown = JSON.stringify(totals.taxRows);

    tx.set(jobRef, {
      serviceLineItems: updatedServiceLineItems,
      complimentaryOriginalTotals: originalTotals,
      complimentaryOriginalServiceLineItems: originalServiceLineItems,
      complimentaryAdjustmentPhase: "financial_applied_v1",
      complimentaryStatus: "financial_applied",
      complimentaryTotalsApplied: true,
      complimentaryAppliedAt: now,
      complimentaryAppliedBy: authInfo.email,
      complimentaryNetMenuTotal: totals.payableMenuTotal,
      complimentaryNetTaxableSubtotal: totals.taxableSubtotal,
      complimentaryNetTaxTotal: totals.taxTotal,
      complimentaryNetTotal: totals.grandTotal,
      complimentaryTaxPricingMode: totals.pricingMode,
      complimentaryFinancialAdjustmentVersion: "SERVICE_COMP_FINANCIAL_V1",
      bookedPrice: totals.taxableSubtotal,
      serviceSubtotal: totals.taxableSubtotal,
      taxableSubtotal: totals.taxableSubtotal,
      taxBreakdown,
      taxTotal: totals.taxTotal,
      taxPricingMode: totals.pricingMode,
      pricingMode: totals.pricingMode,
      grandTotal: totals.grandTotal,
      finalTotal: totals.grandTotal,
      amountDue: totals.grandTotal,
      payableShare: totals.grandTotal,
      amountDueByMember: totals.grandTotal,
      totalGHC: totals.grandTotal,
      memberServiceTotal: totals.memberServiceTotal,
      updatedAt: now,
      updatedBy: authInfo.email
    }, { merge: true });

    result = {
      ok: true,
      applied: true,
      phase: "financial_applied_v1",
      jobId,
      serviceItemIndex,
      service: {
        name: serviceName(current),
        originalQty,
        originalUnitPrice,
        originalLineTotal,
        complimentaryValue: safeNumber(marked.complimentaryValue, originalLineTotal)
      },
      totals: {
        bookedPrice: totals.taxableSubtotal,
        serviceSubtotal: totals.taxableSubtotal,
        taxableSubtotal: totals.taxableSubtotal,
        taxBreakdown: totals.taxRows,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        finalTotal: totals.grandTotal,
        amountDue: totals.grandTotal,
        payableShare: totals.grandTotal,
        amountDueByMember: totals.grandTotal,
        totalGHC: totals.grandTotal,
        memberServiceTotal: totals.memberServiceTotal,
        taxPricingMode: totals.pricingMode
      }
    };
  });

  return result;
});

exports.approveComplimentaryServices = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  const config = assertFeatureEnabled();
  await requireStaffCaller(authInfo);
  const data = request.data || {};
  const jobId = String(data.jobId || "").trim();
  const serviceItemIndexes = normalizeServiceItemIndexes(data.serviceItemIndexes);
  const approverEmail = normalizeEmail(data.approverEmail);
  const reason = String(data.reason || "").trim();
  const requestedBy = normalizeEmail(data.requestedBy) || authInfo.email;

  if (!jobId) {
    throw new HttpsError("invalid-argument", "Active job id is required.");
  }
  if (!Array.isArray(data.serviceItemIndexes) || !serviceItemIndexes.length) {
    throw new HttpsError("invalid-argument", "At least one valid service item index is required.");
  }
  if (!approverEmail) {
    throw new HttpsError("invalid-argument", "Approver email is required.");
  }
  if (!reason) {
    throw new HttpsError("invalid-argument", "Complimentary reason is required.");
  }
  assertValidPin(data.pin);

  const jobRef = db.collection(ACTIVE_JOBS_COLLECTION).doc(jobId);
  const preflightSnap = await jobRef.get();
  if (!preflightSnap.exists) {
    throw new HttpsError("not-found", "Active job was not found.");
  }
  const preflightJob = preflightSnap.data() || {};
  if (isComplimentaryBlockedJobStatus(preflightJob.status)) {
    throw new HttpsError("failed-precondition", "Closed, completed, cancelled, or no-show jobs cannot receive complimentary approval.");
  }
  if (isGroupJob(preflightJob)) {
    throw new HttpsError("failed-precondition", "Group complimentary approvals are not enabled in this phase.");
  }
  const preflightItems = resolveComplimentaryServiceLines(preflightJob);
  if (!preflightItems.length) {
    throw new HttpsError("failed-precondition", "This job does not have itemized serviceLineItems to approve.");
  }
  complimentaryTransactionPolicy(preflightJob, preflightItems);

  const verification = await verifyApprovalPinAttempt({
    ...data,
    approverEmail,
    approvalType: "complimentary_service_multi",
    reason,
    requestedBy,
    jobId,
    serviceId: serviceItemIndexes.join(","),
    serviceItemIndexes
  }, authInfo, config);

  if (verification.approved !== true) {
    return {
      ok: false,
      applied: false,
      appliedIndexes: [],
      skippedIndexes: [],
      refreshJob: false,
      ...verification,
      message: "Manager/Admin approval was not verified."
    };
  }

  const now = admin.firestore.FieldValue.serverTimestamp();
  const appliedAt = admin.firestore.Timestamp.now();
  let result = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(jobRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", "Active job was not found.");
    }

    const job = snap.data() || {};
    if (isComplimentaryBlockedJobStatus(job.status)) {
      throw new HttpsError("failed-precondition", "Closed, completed, cancelled, or no-show jobs cannot receive complimentary approval.");
    }
    if (isGroupJob(job)) {
      throw new HttpsError("failed-precondition", "Group complimentary approvals are not enabled in this phase.");
    }

    const items = resolveComplimentaryServiceLines(job);
    if (!items.length) {
      throw new HttpsError("failed-precondition", "This job does not have itemized serviceLineItems to approve.");
    }

    const appliedIndexes = [];
    const skippedIndexes = [];
    const updatedItems = items.map((item) => ({ ...(item || {}) }));

    serviceItemIndexes.forEach((index) => {
      const current = updatedItems[index];
      if (!current) {
        skippedIndexes.push(skippedComplimentaryService(index, "invalid_index", null));
        return;
      }
      if (isFinancialAppliedComplimentaryLine(current)) {
        skippedIndexes.push(skippedComplimentaryService(index, "already_applied", current));
        return;
      }
      if (isPendingComplimentaryMarkerLine(current)) {
        skippedIndexes.push(skippedComplimentaryService(index, "pending_marker", current));
        return;
      }
      if (isTrueZeroNonComplimentaryLine(current)) {
        skippedIndexes.push(skippedComplimentaryService(index, "zero_value", current));
        return;
      }

      const qty = serviceQty(current);
      const unitPrice = serviceUnitPrice(current);
      const currentLineTotal = serviceLineTotal(current);
      const originalUnitPrice = safeNumber(current.originalUnitPrice ?? current.unitPrice ?? current.price ?? current.amount, unitPrice);
      const originalLineTotal = safeNumber(current.originalLineTotal ?? current.lineTotal, currentLineTotal);
      const complimentaryFallback = originalLineTotal > 0 ? originalLineTotal : currentLineTotal;
      const complimentaryValue = current.complimentaryValue === undefined || current.complimentaryValue === null || current.complimentaryValue === ""
        ? complimentaryFallback
        : safeNumber(current.complimentaryValue, complimentaryFallback);
      const name = serviceName(current);

      updatedItems[index] = {
        ...current,
        isComplimentary: true,
        complimentaryStatus: "financial_applied",
        complimentaryReason: reason,
        complimentaryApprovedBy: verification.approvedBy,
        complimentaryApprovedAt: appliedAt,
        complimentaryRequestedBy: requestedBy,
        approvalAuditId: verification.auditId,
        complimentaryApprovalAuditId: verification.auditId,
        originalUnitPrice: current.originalUnitPrice ?? originalUnitPrice,
        originalLineTotal: current.originalLineTotal ?? originalLineTotal,
        originalQty: current.originalQty ?? qty,
        originalName: current.originalName || name,
        complimentaryValue,
        complimentaryTotalsApplied: true,
        complimentaryAppliedAt: appliedAt,
        complimentaryAppliedBy: authInfo.email,
        complimentaryMarkerVersion: "SERVICE_COMP_MARKER_V2",
        complimentaryAdjustmentVersion: "SERVICE_COMP_FINANCIAL_V2",
        unitPrice: 0,
        price: 0,
        amount: 0,
        lineTotal: 0,
        payableLineTotal: 0
      };
      appliedIndexes.push(index);
    });

    if (!appliedIndexes.length) {
      result = {
        ok: true,
        applied: false,
        appliedIndexes: [],
        skippedIndexes,
        totals: null,
        refreshJob: true,
        message: "No eligible service lines were applied."
      };
      return;
    }

    const totals = calculateComplimentaryTotals(job, updatedItems);
    const updatedServiceLineItems = totals.serviceLineItems;
    const taxBreakdown = JSON.stringify(totals.taxRows);
    const originalTotals = job.complimentaryOriginalTotals || originalTotalsSnapshot(job);
    const originalServiceLineItems = Array.isArray(job.complimentaryOriginalServiceLineItems)
      ? job.complimentaryOriginalServiceLineItems
      : (Array.isArray(job.serviceLineItems) ? job.serviceLineItems : items);
    const allComplimentaryIndexes = updatedServiceLineItems
      .map((item, index) => isFinancialAppliedComplimentaryLine(item) ? index : null)
      .filter((index) => index !== null);
    const totalComplimentaryValue = updatedServiceLineItems
      .reduce((sum, item) => sum + lineComplimentaryValue(item || {}), 0);

    tx.set(jobRef, {
      serviceLineItems: updatedServiceLineItems,
      hasComplimentaryAdjustment: true,
      complimentaryAdjustmentPhase: "financial_applied_v2",
      complimentaryStatus: "financial_applied",
      complimentaryScope: "service_multi",
      complimentaryReason: reason,
      complimentaryApprovedBy: verification.approvedBy,
      complimentaryApprovedAt: now,
      complimentaryApprovalAuditId: verification.auditId,
      complimentaryServiceIndexes: allComplimentaryIndexes,
      complimentaryAppliedIndexes: appliedIndexes,
      complimentarySkippedIndexes: skippedIndexes.map((entry) => entry.index),
      complimentarySkippedDetails: skippedIndexes,
      complimentaryValue: totalComplimentaryValue,
      complimentaryTotalsApplied: true,
      complimentaryAppliedAt: now,
      complimentaryAppliedBy: authInfo.email,
      complimentaryOriginalTotals: originalTotals,
      complimentaryOriginalServiceLineItems: originalServiceLineItems,
      complimentaryNetMenuTotal: totals.payableMenuTotal,
      complimentaryNetTaxableSubtotal: totals.taxableSubtotal,
      complimentaryNetTaxTotal: totals.taxTotal,
      complimentaryNetTotal: totals.grandTotal,
      complimentaryTaxPricingMode: totals.pricingMode,
      complimentaryFinancialAdjustmentVersion: "SERVICE_COMP_FINANCIAL_V2",
      bookedPrice: totals.taxableSubtotal,
      serviceSubtotal: totals.taxableSubtotal,
      taxableSubtotal: totals.taxableSubtotal,
      taxBreakdown,
      taxTotal: totals.taxTotal,
      taxPricingMode: totals.pricingMode,
      pricingMode: totals.pricingMode,
      grandTotal: totals.grandTotal,
      finalTotal: totals.grandTotal,
      amountDue: totals.grandTotal,
      payableShare: totals.grandTotal,
      amountDueByMember: totals.grandTotal,
      totalGHC: totals.grandTotal,
      memberServiceTotal: totals.memberServiceTotal,
      updatedAt: now,
      updatedBy: authInfo.email
    }, { merge: true });

    result = {
      ok: true,
      applied: true,
      appliedIndexes,
      skippedIndexes,
      totals: {
        bookedPrice: totals.taxableSubtotal,
        serviceSubtotal: totals.taxableSubtotal,
        taxableSubtotal: totals.taxableSubtotal,
        taxBreakdown: totals.taxRows,
        taxTotal: totals.taxTotal,
        grandTotal: totals.grandTotal,
        finalTotal: totals.grandTotal,
        amountDue: totals.grandTotal,
        payableShare: totals.grandTotal,
        amountDueByMember: totals.grandTotal,
        totalGHC: totals.grandTotal,
        memberServiceTotal: totals.memberServiceTotal,
        taxPricingMode: totals.pricingMode,
        complimentaryValue: totalComplimentaryValue
      },
      refreshJob: true,
      message: "Complimentary services applied."
    };
  });

  return result;
});

exports.previewGroupComplimentaryProjection = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyPreview();
  const authInfo = requireAuth(request);
  await requireStaffCaller(authInfo);
  const data = request.data || {};

  return mapGroupComplimentaryFinancialProjection(data.groupId, data.targets || data.selectedTargets);
});

exports.previewArchiveManifest = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchivePreview();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return buildArchivePreviewManifest(request.data || {}, authInfo.email);
});

exports.previewPreGoLivePolicyArchive = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchivePreview();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return buildPreGoLivePolicyArchivePreview(request.data || {}, authInfo.email);
});

exports.previewProductionPreGoLiveArchive = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return buildProductionPreGoLiveArchivePreview(request.data || {}, authInfo.email);
});

exports.executeProductionPreGoLiveArchive = onCall({ region: REGION, timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  const data = request.data || {};
  if (String(data.mode || "").trim() === "execute") {
    return executeProductionPreGoLiveArchiveBatch(data, authInfo);
  }
  return executeProductionPreGoLiveArchivePreflight(data, authInfo);
});

exports.rollbackProductionPreGoLiveArchive = onCall({ region: REGION, timeoutSeconds: 540, memory: "512MiB" }, async (request) => {
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return rollbackProductionPreGoLiveArchiveBatch(request.data || {}, authInfo);
});

exports.validateStagingSyntheticArchiveRollback = onCall({ region: REGION, timeoutSeconds: 300, memory: "512MiB" }, async (request) => {
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return validateStagingSyntheticArchiveRollback(request.data || {}, authInfo);
});

exports.executePreGoLivePolicyArchive = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchiveExecution();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return executePreGoLivePolicyArchiveBatch(request.data || {}, authInfo.email);
});

exports.previewRealActiveJobPairReview = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchivePreview();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  const data = request.data || {};
  return buildRealActiveJobPairReview(data.activeJobId, data.appointmentId);
});

exports.approveRealActiveJobPairReview = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchiveExecution();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return approveRealActiveJobPairReviewRecord(request.data || {}, authInfo.email);
});

exports.softArchiveBatch = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchiveExecution();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return softArchiveAttendanceBatch(request.data || {}, authInfo.email);
});

exports.softArchiveRealActiveJobPair = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchiveExecution();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return softArchiveRealActiveJobPairBatch(request.data || {}, authInfo.email);
});

exports.rollbackArchiveBatch = onCall({ region: REGION }, async (request) => {
  assertStagingOnlyArchiveExecution();
  const authInfo = requireAuth(request);
  await requireSystemAdminCaller(authInfo);
  return rollbackAttendanceArchiveBatch(request.data || {}, authInfo.email);
});

exports.resetApprovalPin = onCall({ region: REGION }, async (request) => {
  const authInfo = requireAuth(request);
  assertFeatureEnabled();
  const caller = await requireManagerOrAdminCaller(authInfo);
  const data = request.data || {};
  const target = await resolveTargetUser(data.targetEmail || data.email, caller, true);
  const now = admin.firestore.FieldValue.serverTimestamp();

  await db.runTransaction(async (tx) => {
    tx.delete(pinSecretRef(target.email));
    tx.set(target.ref, {
      approvalPinEnabled: false,
      canApproveComplimentary: false,
      canApproveDiscounts: false,
      approvalPinUpdatedAt: now,
      approvalPinUpdatedBy: authInfo.email
    }, { merge: true });
  });

  const auditId = await writeAudit(data, authInfo, {
    approvalType: "reset_approval_pin",
    approvedBy: target.email,
    status: "approved",
    approvedAt: now
  });

  return {
    ok: true,
    targetEmail: target.email,
    approvalPinEnabled: false,
    auditId
  };
});
