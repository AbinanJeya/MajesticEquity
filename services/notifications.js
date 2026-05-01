/**
 * Notification Services (Email + SMS)
 * Fix #3: Extracted from server.js monolith for reusability and testability.
 */
const nodemailer = require('nodemailer');
const twilio = require('twilio');
const { logger } = require('./logger');

// =============================================
// EMAIL SERVICE
// =============================================
let emailTransporter = null;
if (process.env.SMTP_HOST && process.env.SMTP_USER) {
    emailTransporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: false,
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASS
        }
    });
}

async function sendEmail(to, subject, html) {
    if (!emailTransporter) {
        logger.info(`📧 [Dev Mode] Email to ${to}: ${subject}`);
        return;
    }
    try {
        await emailTransporter.sendMail({
            from: `"MajesticEquity" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
            to,
            subject,
            html
        });
        logger.info(`📧 Email sent to ${to}: ${subject}`);
    } catch (err) {
        logger.captureError(err, { context: 'sendEmail', to, subject });
    }
}

// =============================================
// SMS SERVICE (Twilio)
// =============================================
const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_PHONE_NUMBER = process.env.TWILIO_PHONE_NUMBER;

let twilioClient = null;
if (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) {
    twilioClient = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
}

async function sendSMS(to, body) {
    if (!twilioClient || !TWILIO_PHONE_NUMBER) {
        logger.info(`📱 [Dev Mode] SMS to ${to}: ${body}`);
        return;
    }
    try {
        await twilioClient.messages.create({
            body: body,
            from: TWILIO_PHONE_NUMBER,
            to: to
        });
        logger.info(`📱 SMS Sent to ${to}`);
    } catch (err) {
        logger.captureError(err, { context: 'sendSMS', to });
    }
}

module.exports = { sendEmail, sendSMS };
