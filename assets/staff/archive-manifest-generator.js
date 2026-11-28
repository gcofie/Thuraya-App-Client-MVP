#!/usr/bin/env node
/*
 * THURAYA DA-2B Archive Manifest Generator
 *
 * Read-only staging analysis only.
 * - Uses Firestore REST GET requests.
 * - Does not PATCH, POST, DELETE, archive, move, or mutate records.
 * - Uses business dates for archive eligibility, not createdAt.
 */

const fs = require("fs");
const path = require("path");

const CUTOFF_DATE = "2026-05-08";
const ARCHIVE_REASON = "pre_go_live_test_data";
const PAGE_SIZE = 300;

const CANDIDATE_COLLECTIONS = ["Appointments", "Active_Jobs", "Attendance", "Clients"];

const DATE_FIELDS = {
    Appointments: ["dateString", "date", "bookingDate", "appointmentDate"],
    Active_Jobs: ["dateString", "date", "bookingDate", "appointmentDate"],
    Attendance: ["date", "dateString", "attendanceDate"],
    Clients: ["createdAt", "updatedAt"]
};

const TERMINAL_STATUSES = new Set([
    "closed",
    "completed",
    "cancelled",
    "canceled",
    "no show",
    "no-show",
    "noshow"
]);

function parseArgs(argv) {
    const args = {
        sampleLimit: 12,
        json: false,
        summaryOnly: false,
        out: ""
    };

    for (const arg of argv.slice(2)) {
        if (arg === "--json") args.json = true;
        else if (arg === "--summary-only") args.summaryOnly = true;
        else if (arg.startsWith("--sample-limit=")) args.sampleLimit = Math.max(0, Number(arg.split("=")[1]) || 0);
        else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
        else if (arg === "--help" || arg === "-h") {
            printHelp();
            process.exit(0);
        }
    }

    return args;
}

function printHelp() {
    console.log(`Usage: node archive-manifest-generator.js [--summary-only] [--json] [--sample-limit=12] [--out=path]

Read-only staging manifest generator for DA-2B.

Default output is a human-readable summary plus manifest samples.
--json prints the full manifest object to stdout.
--out writes the full manifest object to a local file. It never writes Firestore.`);
}

function extractStagingConfig() {
    const configPath = path.join(process.cwd(), "firebase-config.js");
    const text = fs.readFileSync(configPath, "utf8");
    const blockMatch = text.match(/const\s+STAGING_CONFIG\s*=\s*\{([\s\S]*?)\};/);
    if (!blockMatch) throw new Error("Could not find STAGING_CONFIG in firebase-config.js");

    const block = blockMatch[1];
    const get = (key) => {
        const match = block.match(new RegExp(`${key}\\s*:\\s*["']([^"']+)["']`));
        return match ? match[1] : "";
    };

    const config = {
        apiKey: get("apiKey"),
        projectId: get("projectId")
    };

    if (config.projectId !== "thuraya-staging") {
        throw new Error(`Refusing to run against non-staging project: ${config.projectId || "(missing)"}`);
    }
    if (!config.apiKey) throw new Error("Missing staging apiKey in firebase-config.js");

    return config;
}

function firestoreUrl(projectId, collection, pageToken = "") {
    const base = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${encodeURIComponent(collection)}`;
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE) });
    if (pageToken) params.set("pageToken", pageToken);
    return `${base}?${params.toString()}`;
}

async function fetchCollection(projectId, apiKey, collection) {
    const docs = [];
    let pageToken = "";

    do {
        const url = `${firestoreUrl(projectId, collection, pageToken)}&key=${encodeURIComponent(apiKey)}`;
        const res = await fetch(url, { method: "GET" });
        if (!res.ok) {
            const text = await res.text();
            throw new Error(`Read failed for ${collection}: ${res.status} ${text.slice(0, 220)}`);
        }
        const data = await res.json();
        for (const doc of data.documents || []) docs.push(decodeDocument(doc));
        pageToken = data.nextPageToken || "";
    } while (pageToken);

    return docs;
}

function decodeDocument(doc) {
    const parts = String(doc.name || "").split("/");
    return {
        __docPath: doc.name || "",
        __docId: parts[parts.length - 1] || "",
        __createTime: doc.createTime || "",
        __updateTime: doc.updateTime || "",
        ...decodeFields(doc.fields || {})
    };
}

function decodeFields(fields) {
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
        out[key] = decodeValue(value);
    }
    return out;
}

function decodeValue(value) {
    if (!value || typeof value !== "object") return null;
    if ("stringValue" in value) return value.stringValue;
    if ("integerValue" in value) return Number(value.integerValue);
    if ("doubleValue" in value) return Number(value.doubleValue);
    if ("booleanValue" in value) return Boolean(value.booleanValue);
    if ("timestampValue" in value) return value.timestampValue;
    if ("nullValue" in value) return null;
    if ("arrayValue" in value) return (value.arrayValue.values || []).map(decodeValue);
    if ("mapValue" in value) return decodeFields(value.mapValue.fields || {});
    if ("referenceValue" in value) return value.referenceValue;
    if ("geoPointValue" in value) return value.geoPointValue;
    return null;
}

function normalizeDate(value) {
    if (!value) return "";
    if (value instanceof Date && !Number.isNaN(value.valueOf())) return value.toISOString().slice(0, 10);
    const text = String(value).trim();
    if (!text) return "";

    const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

    const slash = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (slash) {
        return `${slash[3]}-${slash[1].padStart(2, "0")}-${slash[2].padStart(2, "0")}`;
    }

    const parsed = new Date(text);
    if (!Number.isNaN(parsed.valueOf())) return parsed.toISOString().slice(0, 10);
    return "";
}

function findBusinessDate(collection, row) {
    for (const field of DATE_FIELDS[collection] || []) {
        const normalized = normalizeDate(row[field]);
        if (normalized) return { field, value: normalized };
    }
    return { field: "", value: "" };
}

function text(row, keys) {
    for (const key of keys) {
        const value = row?.[key];
        if (value !== undefined && value !== null && String(value).trim() !== "") return String(value).trim();
    }
    return "";
}

function statusOf(row) {
    return text(row, ["status", "bookingStatus", "paymentStatus", "state"]);
}

function isBeforeCutoff(date) {
    return Boolean(date && date < CUTOFF_DATE);
}

function normalizeStatus(status) {
    return String(status || "").trim().toLowerCase();
}

function addIndex(index, key, value, collection, docId) {
    const normalized = String(value || "").trim();
    if (!normalized) return;
    if (!index[key]) index[key] = new Map();
    if (!index[key].has(normalized)) index[key].set(normalized, []);
    index[key].get(normalized).push({ collection, docId });
}

function buildIndex(collectionRows) {
    const index = {};
    for (const [collection, rows] of Object.entries(collectionRows)) {
        for (const row of rows) {
            const docId = row.__docId;
            addIndex(index, "appointmentId", row.appointmentId || row.bookingId, collection, docId);
            addIndex(index, "jobId", row.jobId || row.activeJobId || docId, collection, docId);
            addIndex(index, "clientId", row.clientId || row.clientEmail || row.clientPhone, collection, docId);
            addIndex(index, "groupId", row.groupId || row.groupBookingId, collection, docId);
            addIndex(index, "receiptRef", row.receiptRef || row.receiptId, collection, docId);
            addIndex(index, "giftCardCode", row.giftCardCode || row.appliedGiftCardCode || row.voucherCode, collection, docId);
        }
    }
    return index;
}

function lookup(index, key, value, selfCollection, selfDocId) {
    const normalized = String(value || "").trim();
    if (!normalized || !index[key]?.has(normalized)) return [];
    return index[key].get(normalized).filter(ref => !(ref.collection === selfCollection && ref.docId === selfDocId));
}

function collectLinkedRecords(row, collection, index) {
    const docId = row.__docId;
    const linked = [];
    const pushAll = (reason, refs) => {
        for (const ref of refs) linked.push({ ...ref, reason });
    };

    pushAll("appointmentId", lookup(index, "appointmentId", row.appointmentId || row.bookingId, collection, docId));
    pushAll("jobId", lookup(index, "jobId", row.jobId || row.activeJobId || docId, collection, docId));
    pushAll("clientId", lookup(index, "clientId", row.clientId || row.clientEmail || row.clientPhone, collection, docId));
    pushAll("groupId", lookup(index, "groupId", row.groupId || row.groupBookingId, collection, docId));
    pushAll("receiptRef", lookup(index, "receiptRef", row.receiptRef || row.receiptId, collection, docId));
    pushAll("giftCardCode", lookup(index, "giftCardCode", row.giftCardCode || row.appliedGiftCardCode || row.voucherCode, collection, docId));

    const seen = new Set();
    return linked.filter(ref => {
        const id = `${ref.reason}:${ref.collection}:${ref.docId}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
    });
}

function hasAny(row, keys) {
    return keys.some(key => row?.[key] !== undefined && row?.[key] !== null && String(row[key]).trim() !== "");
}

function classifyRecord(collection, row, linkedRecords) {
    const business = findBusinessDate(collection, row);
    const createdAt = normalizeDate(row.createdAt || row.__createTime);
    const status = normalizeStatus(statusOf(row));
    const isClient = collection === "Clients";
    const notes = [];

    const groupRisk = hasAny(row, ["groupId", "groupBookingId", "groupRole"]) || Number(row.groupSize || 0) > 1;
    const receiptRisk = hasAny(row, ["receiptRef", "receiptId"]);
    const giftCardRisk = hasAny(row, ["giftCardCode", "appliedGiftCardCode", "voucherCode", "giftCardRedemptionId"]);
    const packageRisk = hasAny(row, ["packageId", "packageCode", "walletId", "packageWalletId"]);
    const promoRisk = hasAny(row, ["promoCode", "discountCode", "discountAmount", "redemptionId"]);
    const hasLiveStatus = Boolean(status && !TERMINAL_STATUSES.has(status));
    const hasPostCutoffCreatedAt = Boolean(createdAt && createdAt >= CUTOFF_DATE);

    if (isClient) {
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

    if (!isBeforeCutoff(business.value)) {
        if (createdAt && createdAt < CUTOFF_DATE) notes.push("Old createdAt ignored because business date is not pre-go-live.");
        return {
            archiveDecision: "exclude",
            archiveReason: "business_date_not_before_cutoff",
            riskLevel: "low",
            reviewNotes: notes
        };
    }

    if (hasLiveStatus) notes.push(`Non-terminal status '${statusOf(row)}' requires review.`);
    if (hasPostCutoffCreatedAt) notes.push("Business date is pre-cutoff but createdAt is post-cutoff; verify real-data risk.");
    if (groupRisk) notes.push("Linked to group booking data.");
    if (receiptRisk) notes.push("Receipt reference present; reprint/report impact risk.");
    if (giftCardRisk) notes.push("Gift card/voucher fields present.");
    if (packageRisk) notes.push("Package/wallet fields present.");
    if (promoRisk) notes.push("Promo/discount/redemption fields present.");
    if (linkedRecords.length) notes.push(`Linked records found: ${linkedRecords.length}.`);

    const highRisk = giftCardRisk || packageRisk || promoRisk || hasLiveStatus || hasPostCutoffCreatedAt;
    const mediumRisk = groupRisk || receiptRisk || linkedRecords.length > 0;

    if (highRisk) {
        return {
            archiveDecision: "manual_review",
            archiveReason: "pre_cutoff_high_risk_links",
            riskLevel: "high",
            reviewNotes: notes
        };
    }

    if (mediumRisk) {
        return {
            archiveDecision: "manual_review",
            archiveReason: "pre_cutoff_linked_record_review",
            riskLevel: "medium",
            reviewNotes: notes
        };
    }

    return {
        archiveDecision: "candidate",
        archiveReason: ARCHIVE_REASON,
        riskLevel: "low",
        reviewNotes: notes
    };
}

function buildManifest(collectionRows, archiveBatchId) {
    const index = buildIndex(collectionRows);
    const manifest = [];

    for (const collection of CANDIDATE_COLLECTIONS) {
        for (const row of collectionRows[collection] || []) {
            const business = findBusinessDate(collection, row);
            const linkedRecords = collectLinkedRecords(row, collection, index);
            const classification = classifyRecord(collection, row, linkedRecords);
            manifest.push({
                archiveBatchId,
                collection,
                docId: row.__docId,
                dateField: business.field,
                businessDate: business.value,
                createdAt: row.createdAt || row.__createTime || "",
                status: statusOf(row),
                clientName: text(row, ["clientName", "name", "fullName", "leadName"]),
                clientPhone: text(row, ["clientPhone", "phone", "phoneNumber"]),
                clientId: text(row, ["clientId", "clientEmail", "clientPhone", "email"]),
                groupId: text(row, ["groupId", "groupBookingId"]),
                appointmentId: text(row, ["appointmentId", "bookingId"]),
                jobId: text(row, ["jobId", "activeJobId"]) || (collection === "Active_Jobs" ? row.__docId : ""),
                receiptRef: text(row, ["receiptRef", "receiptId"]),
                giftCardCode: text(row, ["giftCardCode", "appliedGiftCardCode", "voucherCode"]),
                linkedRecords,
                archiveDecision: classification.archiveDecision,
                archiveReason: classification.archiveReason,
                riskLevel: classification.riskLevel,
                reviewNotes: classification.reviewNotes
            });
        }
    }

    return manifest;
}

function summarize(manifest, collectionRows, errors) {
    const summary = {
        cutoffDate: CUTOFF_DATE,
        scannedCollections: {},
        candidateCounts: {},
        excludedCounts: {},
        manualReviewCounts: {},
        riskCounts: { low: 0, medium: 0, high: 0 },
        highRiskRecords: [],
        groupBookingRisks: [],
        receiptRisks: [],
        giftCardRisks: [],
        clientRisks: [],
        errors
    };

    for (const collection of CANDIDATE_COLLECTIONS) {
        summary.scannedCollections[collection] = (collectionRows[collection] || []).length;
        summary.candidateCounts[collection] = 0;
        summary.excludedCounts[collection] = 0;
        summary.manualReviewCounts[collection] = 0;
    }

    for (const entry of manifest) {
        if (entry.archiveDecision === "candidate") summary.candidateCounts[entry.collection]++;
        else if (entry.archiveDecision === "exclude") summary.excludedCounts[entry.collection]++;
        else if (entry.archiveDecision === "manual_review") summary.manualReviewCounts[entry.collection]++;

        if (summary.riskCounts[entry.riskLevel] !== undefined) summary.riskCounts[entry.riskLevel]++;
        if (entry.riskLevel === "high") summary.highRiskRecords.push(compactEntry(entry));
        if (entry.groupId || entry.reviewNotes.some(note => note.toLowerCase().includes("group"))) summary.groupBookingRisks.push(compactEntry(entry));
        if (entry.receiptRef || entry.reviewNotes.some(note => note.toLowerCase().includes("receipt"))) summary.receiptRisks.push(compactEntry(entry));
        if (entry.giftCardCode || entry.reviewNotes.some(note => /gift|voucher/i.test(note))) summary.giftCardRisks.push(compactEntry(entry));
        if (entry.collection === "Clients") summary.clientRisks.push(compactEntry(entry));
    }

    return summary;
}

function compactEntry(entry) {
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

function printHumanReport(result, sampleLimit) {
    const { summary, manifest } = result;
    console.log("PASS Summary");
    console.log("DA-2B read-only manifest generation completed.");
    console.log(`Project: ${result.projectId}`);
    console.log(`Archive batch id: ${result.archiveBatchId}`);
    console.log(`Cutoff: ${summary.cutoffDate}`);
    console.log("");

    console.log("Collections Scanned");
    for (const [collection, count] of Object.entries(summary.scannedCollections)) {
        console.log(`- ${collection}: ${count}`);
    }
    console.log("");

    console.log("Candidate Counts");
    printCounts(summary.candidateCounts);
    console.log("Excluded Counts");
    printCounts(summary.excludedCounts);
    console.log("Manual Review Counts");
    printCounts(summary.manualReviewCounts);
    console.log("Risk Counts");
    printCounts(summary.riskCounts);
    console.log("");

    console.log("High-Risk Records");
    printSamples(summary.highRiskRecords, sampleLimit);
    console.log("Group Booking Risks");
    printSamples(summary.groupBookingRisks, sampleLimit);
    console.log("Receipt Risks");
    printSamples(summary.receiptRisks, sampleLimit);
    console.log("Gift Card Risks");
    printSamples(summary.giftCardRisks, sampleLimit);
    console.log("Client Risks");
    printSamples(summary.clientRisks, sampleLimit);

    console.log("Manifest Structure Sample");
    printSamples(manifest.slice(0, sampleLimit), sampleLimit);

    console.log("Validation");
    console.log("- Firestore writes: none");
    console.log("- Archive flags added: none");
    console.log("- Records modified: none");
    console.log("- Deletes: none");
    console.log("- Production access: none");

    if (summary.errors.length) {
        console.log("");
        console.log("Read Errors");
        for (const error of summary.errors) console.log(`- ${error.collection}: ${error.message}`);
    }
}

function printCounts(counts) {
    for (const [key, value] of Object.entries(counts)) console.log(`- ${key}: ${value}`);
    console.log("");
}

function printSamples(items, sampleLimit) {
    if (!items.length) {
        console.log("- none");
        console.log("");
        return;
    }
    for (const item of items.slice(0, sampleLimit)) {
        console.log(`- ${JSON.stringify(item)}`);
    }
    if (items.length > sampleLimit) console.log(`- ... ${items.length - sampleLimit} more`);
    console.log("");
}

async function main() {
    const args = parseArgs(process.argv);
    const { projectId, apiKey } = extractStagingConfig();
    const archiveBatchId = `DA2B_PRE_GO_LIVE_${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`;
    const collectionRows = {};
    const errors = [];

    for (const collection of CANDIDATE_COLLECTIONS) {
        try {
            collectionRows[collection] = await fetchCollection(projectId, apiKey, collection);
        } catch (error) {
            collectionRows[collection] = [];
            errors.push({ collection, message: error.message });
        }
    }

    const manifest = buildManifest(collectionRows, archiveBatchId);
    const summary = summarize(manifest, collectionRows, errors);
    const result = {
        generatedAt: new Date().toISOString(),
        projectId,
        archiveBatchId,
        cutoffDate: CUTOFF_DATE,
        readOnly: true,
        firestoreWrites: 0,
        firestoreDeletes: 0,
        manifest,
        summary
    };

    if (args.out) {
        const outPath = path.resolve(process.cwd(), args.out);
        fs.writeFileSync(outPath, JSON.stringify(result, null, 2));
    }

    if (args.json) {
        console.log(JSON.stringify(args.summaryOnly ? { ...result, manifest: [] } : result, null, 2));
    } else {
        printHumanReport(args.summaryOnly ? { ...result, manifest: [] } : result, args.sampleLimit);
    }
}

main().catch(error => {
    console.error("FAIL Summary");
    console.error(error.stack || error.message);
    process.exitCode = 1;
});
