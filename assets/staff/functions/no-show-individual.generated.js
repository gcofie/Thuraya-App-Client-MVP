'use strict';
// Generated from the certified individual No Show evaluator.
function isArchivedRecord(row) { return row?.archived === true; }
    const APPOINTMENT_ALLOWED = new Set(['scheduled', 'arrived', 'action required', 'foh review']);
    const ACTIVE_JOB_ALLOWED = new Set(['waiting', 'arrived', 'action required', 'foh review']);
    const ALREADY_TERMINAL = new Set(['cancelled', 'canceled', 'no show', 'noshow']);
    const FINANCIALLY_PROTECTED = new Set(['ready for payment', 'closed', 'paid', 'completed', 'complete']);
    const noShowPending = new Set();

    function normalize(value){
        return String(value || '').trim().toLowerCase();
    }

    function hasValue(value){
        return value !== undefined && value !== null && value !== false && value !== '';
    }

    function hasCompletedReceipt(record){
        const row = record || {};
        const receiptStatus = normalize(row.receiptStatus || row.receiptState);
        return (
            ['generated', 'completed', 'complete', 'issued', 'final'].includes(receiptStatus) ||
            row.receiptCompleted === true ||
            row.receiptIssued === true ||
            row.receiptGenerated === true ||
            hasValue(row.receiptGeneratedAt) ||
            hasValue(row.receiptCompletedAt) ||
            hasValue(row.receiptIssuedAt) ||
            hasValue(row.receiptRef)
        );
    }

    function financialProtectionReason(record, label){
        const row = record || {};
        const name = label || 'Record';
        const status = normalize(row.status);
        const serviceStatus = normalize(row.serviceStatus);
        const paymentStatus = normalize(row.paymentStatus);
        if (FINANCIALLY_PROTECTED.has(status)) return `${name} status is ${row.status || 'financially protected'}.`;
        if (FINANCIALLY_PROTECTED.has(serviceStatus)) return `${name} service status is ${row.serviceStatus}.`;
        if (paymentStatus === 'paid') return `${name} payment status is Paid.`;
        if (hasValue(row.paidAt)) return `${name} has a paidAt marker.`;
        if (hasValue(row.closedAt)) return `${name} has a closedAt marker.`;
        if (hasCompletedReceipt(row)) return `${name} has a completed/generated receipt marker.`;
        return '';
    }

    function linkageReason(appointmentId, job){
        const id = String(job?.id || '').trim();
        const sourceAppointmentId = String(job?.data?.sourceAppointmentId || '').trim();
        if (id === appointmentId) {
            return sourceAppointmentId && sourceAppointmentId !== appointmentId
                ? 'Deterministic Active Job points to a different Appointment.'
                : '';
        }
        return sourceAppointmentId === appointmentId
            ? ''
            : 'Legacy Active Job does not have an exact sourceAppointmentId link.';
    }

    function evaluateNoShow(appointmentId, appointment, linkedJobs){
        const appt = appointment || {};
        const jobs = Array.isArray(linkedJobs) ? linkedJobs : [];
        if (!appointmentId) return { allowed:false, code:'INVALID_APPOINTMENT', message:'Appointment ID is required.' };
        if (typeof isArchivedRecord === 'function' && isArchivedRecord(appt)) {
            return { allowed:false, code:'ARCHIVED_APPOINTMENT', message:'No Show blocked: the Appointment is archived.' };
        }
        if (appt.isGroupBooking === true || String(appt.groupId || '').trim()) {
            return { allowed:false, code:'GROUP_POLICY_REQUIRED', message:'GROUP NO SHOW REQUIRES SEPARATE POLICY' };
        }
        if (jobs.length > 1) {
            return { allowed:false, code:'MULTIPLE_ACTIVE_JOBS', message:'MULTIPLE ACTIVE JOBS FOUND - MANUAL REVIEW REQUIRED' };
        }

        const appointmentFinancialReason = financialProtectionReason(appt, 'Appointment');
        if (appointmentFinancialReason) {
            return { allowed:false, code:'FINANCIALLY_PROTECTED', message:`No Show blocked: ${appointmentFinancialReason}` };
        }
        const appointmentStatus = normalize(appt.status);
        if (appointmentStatus === 'in progress') {
            return { allowed:false, code:'IN_PROGRESS', message:'No Show blocked: the service is In Progress.' };
        }
        if (ALREADY_TERMINAL.has(appointmentStatus)) {
            return { allowed:false, code:'ALREADY_TERMINAL', message:`No Show blocked: Appointment status is ${appt.status || 'terminal'}.` };
        }
        if (!APPOINTMENT_ALLOWED.has(appointmentStatus)) {
            return { allowed:false, code:'APPOINTMENT_STATUS', message:`No Show blocked from Appointment status ${appt.status || 'Unknown'}.` };
        }
        if (!jobs.length) {
            return appointmentStatus === 'scheduled'
                ? { allowed:true, code:'APPOINTMENT_ONLY', mode:'appointment-only' }
                : { allowed:false, code:'MISSING_ACTIVE_JOB', message:'No Show blocked: this non-Scheduled Appointment has no exact linked Active Job. Manual review is required.' };
        }

        const job = jobs[0];
        const badLink = linkageReason(appointmentId, job);
        if (badLink) return { allowed:false, code:'LINKAGE_CONFLICT', message:`No Show blocked: ${badLink}` };
        if (typeof isArchivedRecord === 'function' && isArchivedRecord(job.data || {})) {
            return { allowed:false, code:'ARCHIVED_ACTIVE_JOB', message:'No Show blocked: the linked Active Job is archived.' };
        }
        const jobFinancialReason = financialProtectionReason(job.data, 'Linked Active Job');
        if (jobFinancialReason) {
            return { allowed:false, code:'FINANCIALLY_PROTECTED', message:`No Show blocked: ${jobFinancialReason}` };
        }
        const jobStatus = normalize(job.data?.status);
        const serviceStatus = normalize(job.data?.serviceStatus);
        if (jobStatus === 'in progress' || serviceStatus === 'in progress') {
            return { allowed:false, code:'IN_PROGRESS', message:'No Show blocked: the linked service is In Progress.' };
        }
        if (ALREADY_TERMINAL.has(jobStatus) || ALREADY_TERMINAL.has(serviceStatus)) {
            return { allowed:false, code:'ALREADY_TERMINAL', message:'No Show blocked: the linked Active Job is already terminal.' };
        }
        if (!ACTIVE_JOB_ALLOWED.has(jobStatus)) {
            return { allowed:false, code:'ACTIVE_JOB_STATUS', message:`No Show blocked from linked Active Job status ${job.data?.status || 'Unknown'}.` };
        }
        return { allowed:true, code:'LINKED_ACTIVE_JOB', mode:'linked', job };
    }


module.exports = { evaluateNoShow };
