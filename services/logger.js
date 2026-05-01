/**
 * Production-Ready Structured Logging (Winston) + Error Tracking (Sentry)
 * Fix #5: Replaces console.log with structured JSON logging for observability.
 */
const winston = require('winston');
const Sentry = require('@sentry/node');

// Initialize Sentry (only if DSN is configured)
if (process.env.SENTRY_DSN) {
    Sentry.init({
        dsn: process.env.SENTRY_DSN,
        environment: process.env.NODE_ENV || 'development',
        tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0
    });
}

const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        winston.format.errors({ stack: true }),
        process.env.NODE_ENV === 'production'
            ? winston.format.json()
            : winston.format.combine(
                winston.format.colorize(),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
                    return `${timestamp} [${level}]: ${message}${metaStr}`;
                })
            )
    ),
    defaultMeta: { service: 'majesticequity' },
    transports: [
        new winston.transports.Console()
    ]
});

// In production, also write errors to a file for persistence
if (process.env.NODE_ENV === 'production') {
    logger.add(new winston.transports.File({ filename: 'logs/error.log', level: 'error' }));
    logger.add(new winston.transports.File({ filename: 'logs/combined.log' }));
}

// Sentry-aware error helper
logger.captureError = function(error, context = {}) {
    logger.error(error.message, { stack: error.stack, ...context });
    if (process.env.SENTRY_DSN) {
        Sentry.captureException(error, { extra: context });
    }
};

module.exports = { logger, Sentry };
