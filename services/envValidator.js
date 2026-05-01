/**
 * Startup Environment Validation
 * Fix #4: Prevents silent failures from missing environment variables.
 * The server will REFUSE to start in production if critical secrets are missing.
 */
const { logger } = require('./logger');

const REQUIRED_IN_PRODUCTION = [
    'MONGODB_URI',
    'JWT_SECRET',
    'STRIPE_SECRET_KEY',
    'STRIPE_WEBHOOK_SECRET',
    'PERSONA_API_KEY',
    'PERSONA_TEMPLATE_ID'
];

const OPTIONAL_BUT_WARNED = [
    'PLAID_CLIENT_ID',
    'PLAID_SECRET',
    'TWILIO_ACCOUNT_SID',
    'TWILIO_AUTH_TOKEN',
    'TWILIO_PHONE_NUMBER',
    'SMTP_HOST',
    'SMTP_USER',
    'SMTP_PASS',
    'SENTRY_DSN',
    'AWS_ACCESS_KEY_ID',
    'AWS_SECRET_ACCESS_KEY',
    'AWS_S3_BUCKET'
];

function validateEnvironment() {
    const isProduction = process.env.NODE_ENV === 'production';
    const missing = [];
    const warned = [];

    for (const key of REQUIRED_IN_PRODUCTION) {
        if (!process.env[key]) {
            if (isProduction) {
                missing.push(key);
            } else {
                warned.push(key);
            }
        }
    }

    for (const key of OPTIONAL_BUT_WARNED) {
        if (!process.env[key]) {
            warned.push(key);
        }
    }

    if (warned.length > 0) {
        logger.warn(`⚠️  Missing optional env vars (features may be degraded): ${warned.join(', ')}`);
    }

    if (missing.length > 0) {
        logger.error(`❌ FATAL: Missing REQUIRED environment variables: ${missing.join(', ')}`);
        logger.error('The server cannot start in production without these. Exiting.');
        process.exit(1);
    }

    logger.info('✅ Environment validation passed');
}

module.exports = { validateEnvironment };
