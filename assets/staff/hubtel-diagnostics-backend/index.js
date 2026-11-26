'use strict';
const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');
const { createTransport } = require('./network');
const { createService, DiagnosticError } = require('./service');
admin.initializeApp();
const projectId = process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || admin.app().options.projectId;
const handle = createService({ projectId, transport: createTransport(),
    async readStaff(email) {
        const result = await admin.firestore().collection('Users')
            .where(admin.firestore.FieldPath.documentId(), '==', email)
            .select('roles', 'role', 'active', 'disabled', 'status', 'uid').limit(1).get();
        return result.empty ? null : result.docs[0].data();
    },
    audit: event => logger.info(event.event, event)
});
exports.hubtelNetworkDiagnostics = onCall({ region: 'us-central1', timeoutSeconds: 30,
    memory: '256MiB', maxInstances: 1, concurrency: 10,
    cors: [/^https:\/\/(?:[a-z0-9-]+--)?thuraya-app-staging\.netlify\.app$/, 'https://thuraya-app.netlify.app']
}, async request => {
    try { return await handle(request); }
    catch (error) {
        const code = error instanceof DiagnosticError ? error.code : 'internal';
        throw new HttpsError(code, code === 'resource-exhausted'
            ? 'Diagnostics busy. Wait ten seconds before retrying.' : 'Network diagnostics unavailable, target rejected or not authorized.');
    }
});
