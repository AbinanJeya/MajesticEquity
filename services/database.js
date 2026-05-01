/**
 * Database Connection with Pooling & Index Management
 * Fix #7: Configures connection pools and ensures indexes exist on hot query paths.
 */
const mongoose = require('mongoose');
const { logger } = require('./logger');

async function connectDatabase() {
    const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/majesticequity';

    try {
        await mongoose.connect(MONGODB_URI, {
            // Connection pool sizing for production concurrency
            maxPoolSize: parseInt(process.env.MONGO_POOL_SIZE || '10'),
            minPoolSize: 2,
            // Socket/connection timeouts
            serverSelectionTimeoutMS: 5000,
            socketTimeoutMS: 45000,
            // Auto-create indexes in development (disable in prod for faster startups)
            autoIndex: process.env.NODE_ENV !== 'production'
        });

        logger.info('✅ Connected to MongoDB');

        // Ensure critical indexes exist (idempotent in MongoDB)
        await ensureIndexes();

    } catch (err) {
        logger.error(`❌ MongoDB Connection Error: ${err.message}`);
        process.exit(1);
    }

    mongoose.connection.on('error', (err) => {
        logger.captureError(err, { context: 'mongoose_connection' });
    });

    mongoose.connection.on('disconnected', () => {
        logger.warn('⚠️  MongoDB disconnected — attempting reconnection...');
    });
}

/**
 * Create indexes on frequently queried fields to prevent full-collection scans.
 */
async function ensureIndexes() {
    const db = mongoose.connection.db;
    if (!db) return;

    try {
        // Users: query by email constantly
        await db.collection('users').createIndex({ email: 1 }, { unique: true, background: true });

        // Applications: query by userEmail, status, assignedAgentId
        await db.collection('applications').createIndex({ userEmail: 1, status: 1 }, { background: true });
        await db.collection('applications').createIndex({ assignedAgentId: 1 }, { background: true });
        await db.collection('applications').createIndex({ updatedAt: -1 }, { background: true });

        // Documents: query by userEmail
        await db.collection('documents').createIndex({ userEmail: 1, uploadedAt: -1 }, { background: true });

        // AgentProfiles: query by userId and verificationStatus
        await db.collection('agentprofiles').createIndex({ userId: 1 }, { unique: true, background: true });
        await db.collection('agentprofiles').createIndex({ verificationStatus: 1 }, { background: true });

        // AgentInvites: query by agentId and tokenHash
        await db.collection('agentinvites').createIndex({ agentId: 1 }, { background: true });
        await db.collection('agentinvites').createIndex({ tokenHash: 1 }, { unique: true, background: true });

        // PlaidItems: query by userId
        await db.collection('plaiditems').createIndex({ userId: 1 }, { background: true });

        logger.info('✅ Database indexes verified');
    } catch (err) {
        logger.warn(`⚠️  Index creation warning (non-fatal): ${err.message}`);
    }
}

module.exports = { connectDatabase };
