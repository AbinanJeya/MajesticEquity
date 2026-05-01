/**
 * Cloud File Upload Service (AWS S3)
 * Fix #1: Replaces ephemeral local disk storage with persistent cloud storage.
 * Falls back gracefully to local disk when S3 is not configured (dev mode).
 */
const { S3Client, DeleteObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const multerS3 = require('multer-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { logger } = require('./logger');

const ALLOWED_EXTENSIONS = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

let s3Client = null;
const S3_BUCKET = process.env.AWS_S3_BUCKET;

// Initialize S3 only if credentials are configured
if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY && S3_BUCKET) {
    s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }
    });
    logger.info('☁️  AWS S3 configured for file uploads');
} else {
    logger.warn('⚠️  AWS S3 not configured — using local disk storage (files will be lost on deploy)');
}

// File filter (shared between S3 and local)
function fileFilter(req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.includes(ext)) {
        cb(null, true);
    } else {
        cb(new Error('File type not allowed. Use PDF, JPG, PNG, DOC, or DOCX.'));
    }
}

// Create the appropriate multer instance
function createUploadMiddleware() {
    if (s3Client) {
        // ☁️ PRODUCTION: Stream directly to S3
        return multer({
            storage: multerS3({
                s3: s3Client,
                bucket: S3_BUCKET,
                key: (req, file, cb) => {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                    const key = `uploads/${uniqueSuffix}${path.extname(file.originalname)}`;
                    cb(null, key);
                },
                contentType: multerS3.AUTO_CONTENT_TYPE
            }),
            limits: { fileSize: MAX_FILE_SIZE },
            fileFilter
        });
    } else {
        // 💻 DEV: Local disk storage
        const uploadsDir = path.join(__dirname, '..', 'uploads');
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

        return multer({
            storage: multer.diskStorage({
                destination: (req, file, cb) => cb(null, uploadsDir),
                filename: (req, file, cb) => {
                    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
                    cb(null, uniqueSuffix + path.extname(file.originalname));
                }
            }),
            limits: { fileSize: MAX_FILE_SIZE },
            fileFilter
        });
    }
}

/**
 * Get a secure pre-signed URL for a file (S3) or return local path (dev).
 */
async function getFileUrl(fileKey) {
    if (s3Client && fileKey && fileKey.startsWith('uploads/')) {
        const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: fileKey });
        return getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
    }
    // Fallback: local file path
    return `/uploads/${path.basename(fileKey || '')}`;
}

/**
 * Delete a file from S3 or local disk.
 */
async function deleteFile(fileKey) {
    if (s3Client && fileKey && fileKey.startsWith('uploads/')) {
        await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: fileKey }));
        logger.info(`☁️  Deleted S3 object: ${fileKey}`);
    } else {
        const filePath = path.join(__dirname, '..', 'uploads', path.basename(fileKey || ''));
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            logger.info(`🗑️  Deleted local file: ${filePath}`);
        }
    }
}

/**
 * Extract the storage key from a multer file object (works for both S3 and local).
 */
function getStorageKey(file) {
    if (file.key) return file.key; // S3
    return file.filename; // Local
}

const upload = createUploadMiddleware();

module.exports = { upload, getFileUrl, deleteFile, getStorageKey, isS3Configured: !!s3Client };
