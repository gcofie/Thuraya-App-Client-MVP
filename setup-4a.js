// ============================================================
//  THURAYA — 4a  Firestore Structure Setup
//  Run this ONCE from your browser console or as a one-off
//  script to seed the Staff_Schedules collection for all
//  existing techs.
//
//  Staff_Schedules/{techEmail}
//    workingDays : string[]   e.g. ['Mon','Tue','Wed','Thu','Fri','Sat']
//    startTime   : string     e.g. "08:00"
//    endTime     : string     e.g. "20:00"
//    effectiveFrom: string    YYYY-MM-DD — changes only apply from this date
//    updatedAt   : timestamp
//
//  Staff_Leave/{autoId}
//    techEmail   : string
//    type        : "Annual Leave" | "Day Off" | "Wellness Day" |
//                  "Leave Without Pay" | "Sick Leave" | "Public Holiday"
//    startDate   : string     YYYY-MM-DD
//    endDate     : string     YYYY-MM-DD
//    status      : "Approved" | "Pending" | "Rejected"
//    note        : string
//    createdAt   : timestamp
//    approvedBy  : string     (manager email)
// ============================================================

// ── Default schedule applied to all techs on first run ───────
const DEFAULT_SCHEDULE = {
    workingDays:   ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
    startTime:     '08:00',
    endTime:       '20:00',
    effectiveFrom: '2025-01-01',
};

// ── Seed function — call from console: seedStaffSchedules() ──
window.seedStaffSchedules = async function() {
    try {
        const snap = await db.collection('Users').get();
        const batch = db.batch();
        let count = 0;

        snap.forEach(doc => {
            const d     = doc.data();
            const roles = (Array.isArray(d.roles) ? d.roles : [d.role || '']).map(r => (r||'').toLowerCase());
            if (!roles.some(r => r.includes('tech'))) return;

            const ref = db.collection('Staff_Schedules').doc(doc.id);
            batch.set(ref, {
                ...DEFAULT_SCHEDULE,
                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
            }, { merge: true }); // merge:true so existing custom schedules are preserved
            count++;
        });

        await batch.commit();
        console.log(`✅ Seeded Staff_Schedules for ${count} technician(s).`);
        alert(`✅ Done — seeded schedules for ${count} technician(s).`);
    } catch (e) {
        console.error('❌ seedStaffSchedules failed:', e);
        alert('❌ Error: ' + e.message);
    }
};

console.log('Thuraya 4a loaded. Run seedStaffSchedules() to initialise Staff_Schedules.');
