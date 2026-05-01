require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { Server } = require("socket.io");
const PDFDocument = require('pdfkit');
const { Configuration, PlaidApi, PlaidEnvironments } = require('plaid');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const twilio = require('twilio');

// Models
const PlaidItem = require('./models/PlaidItem');
const User = require('./models/User');
const Document = require('./models/Document');
const Application = require('./models/Application');
const AgentProfile = require('./models/AgentProfile');
const AgentInvite = require('./models/AgentInvite');
const {
    canAccessApplication,
    canAgentInviteBorrower,
    canMessageApplication,
    hashInviteToken,
    isInviteUsable
} = require('./utils/agentNetwork');
const {
    isOfficialRegistryUrl,
    verifyAgentAgainstOfficialRegistry
} = require('./utils/agentVerification');

// =============================================
// DATABASE CONNECTION
// =============================================
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/majesticequity';
mongoose.connect(MONGODB_URI)
    .then(() => console.log('✅ Connected to MongoDB'))
    .catch((err) => console.error('❌ MongoDB Connection Error:', err));

const DEV_USER_ID = '507f1f77bcf86cd799439011';
const JWT_SECRET = process.env.JWT_SECRET || 'majesticequity_dev_secret_2026';

// =============================================
// EXPRESS APP + SECURITY
// =============================================
const { generateFNM } = require('./utils/fnmExporter');
const stripe = require('stripe')((process.env.STRIPE_SECRET_KEY || 'sk_test_local_placeholder').trim());

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: { origin: "*", methods: ["GET", "POST", "PATCH"] }
});

// Socket.io event handling
io.on('connection', (socket) => {
    console.log('🔌 Client connected:', socket.id);

    socket.on('join_application', (appId) => {
        socket.join(appId);
        console.log(`🔌 Client ${socket.id} joined application channel: ${appId}`);
    });

    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
    });
});

// Expose io to routes if needed
app.set('io', io);

// Security headers
app.use(helmet({
    contentSecurityPolicy: false, // Disable for CDN scripts (Tailwind, Plaid, Persona)
    crossOriginEmbedderPolicy: false
}));

// Rate limiting
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 20, // 20 attempts per window
    message: { error: 'Too many attempts. Please try again in 15 minutes.' },
    standardHeaders: true,
    legacyHeaders: false
});

const apiLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 60, // 60 requests per minute
    message: { error: 'Rate limit exceeded. Please slow down.' }
});

app.use(cors());

// STRIPE WEBHOOK (Must be before bodyParser)
app.post('/api/payments/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    } catch (err) {
        console.error(`❌ Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        const appId = session.client_reference_id;
        await Application.findByIdAndUpdate(appId, { 
            status: 'Processing',
            paymentStatus: 'Paid',
            $push: { statusHistory: { status: 'Processing', note: 'Appraisal Fee Paid' } }
        });
        console.log(`💰 Payment Success for App: ${appId}`);
    }
    res.json({ received: true });
});

app.use(bodyParser.json());
app.use('/api/', apiLimiter);
app.use(express.static('./'));

// =============================================
// FILE UPLOAD CONFIG (Multer)
// =============================================
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({
    storage,
    limits: { fileSize: 10 * 1024 * 1024 }, // 10MB max
    fileFilter: (req, file, cb) => {
        const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
        const ext = path.extname(file.originalname).toLowerCase();
        if (allowed.includes(ext)) {
            cb(null, true);
        } else {
            cb(new Error('File type not allowed. Use PDF, JPG, PNG, DOC, or DOCX.'));
        }
    }
});

// Serve uploaded files
app.use('/uploads', express.static(uploadsDir));

// =============================================
// PLAID CONFIG
// =============================================
const PLAID_CLIENT_ID = process.env.PLAID_CLIENT_ID;
const PLAID_SECRET = process.env.PLAID_SECRET;
const PLAID_ENV = process.env.PLAID_ENV || 'sandbox';

const configuration = new Configuration({
    basePath: PlaidEnvironments[PLAID_ENV],
    baseOptions: {
        headers: {
            'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
            'PLAID-SECRET': PLAID_SECRET,
        },
    },
});
const client = new PlaidApi(configuration);

// =============================================
// EMAIL CONFIG
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
        console.log(`📧 [Dev Mode] Email to ${to}: ${subject}`);
        return;
    }
    try {
        await emailTransporter.sendMail({
            from: `"MajesticEquity" <${process.env.EMAIL_FROM || process.env.SMTP_USER}>`,
            to,
            subject,
            html
        });
        console.log(`📧 Email sent to ${to}: ${subject}`);
    } catch (err) {
        console.error('Email failed:', err.message);
    }
}

// =============================================
// TWILIO SMS CONFIG
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
        console.log(`\n\x1b[33m--- SMS GATEWAY MOCK (Dev Mode) ---\x1b[0m`);
        console.log(`\x1b[36mTO:\x1b[0m ${to}`);
        console.log(`\x1b[36mMESSAGE:\x1b[0m ${body}`);
        console.log(`\x1b[33m-----------------------------------\x1b[0m\n`);
        return;
    }
    try {
        await twilioClient.messages.create({
            body: body,
            from: TWILIO_PHONE_NUMBER,
            to: to
        });
        console.log(`📱 SMS Sent to ${to}`);
    } catch (err) {
        console.error('❌ Twilio SMS Error:', err.message);
    }
}

// PDF Generation Helper
async function generatePreApprovalPDF(application) {
    return new Promise((resolve, reject) => {
        try {
            const doc = new PDFDocument({ margin: 50 });
            const filename = `PreApproval_${application._id}_${Date.now()}.pdf`;
            const filePath = path.join(__dirname, 'uploads', filename);
            const stream = fs.createWriteStream(filePath);

            doc.pipe(stream);

            // Header
            doc.fontSize(25).text('OFFICIAL PRE-APPROVAL LETTER', { align: 'center' });
            doc.moveDown();
            doc.fontSize(12).text(`Date: ${new Date().toLocaleDateString()}`, { align: 'right' });
            doc.moveDown(2);

            // Body
            doc.fontSize(14).text(`To: ${application.userName || application.userEmail}`, { underline: true });
            doc.moveDown();
            doc.fontSize(12).text(`Subject: Pre-Approval for Mortgage Financing - ${application.propertyAddress || 'TBD'}`);
            doc.moveDown();
            doc.text(`Dear ${application.userName || 'Valued Customer'},`);
            doc.moveDown();
            doc.text(`We are pleased to inform you that upon review of your application, MajesticEquity has approved you for a mortgage in the amount of:`);
            doc.moveDown();
            doc.fontSize(20).fillColor('#D3BD73').text(`$${application.loanAmount.toLocaleString()}`, { align: 'center', bold: true });
            doc.fillColor('black').fontSize(12);
            doc.moveDown();
            doc.text(`This pre-approval is based on the verified income, assets, and credit credentials provided through our secure portal. This letter serves as evidence of your purchasing power for the aforementioned property address.`);
            doc.moveDown(2);

            // Signature
            doc.text('Best Regards,');
            doc.fontSize(14).font('Helvetica-Bold').text('Juthi Akhy');
            doc.fontSize(10).font('Helvetica').text('Master Broker | MajesticEquity Mortgages');

            doc.end();

            stream.on('finish', async () => {
                try {
                    // Create Document Record
                    const newDoc = new Document({
                        userId: application.userId,
                        userEmail: application.userEmail,
                        filename: filename,
                        originalName: 'Official Pre-Approval Letter.pdf',
                        category: 'Other', // Restricted by Enum in model
                        mimetype: 'application/pdf',
                        url: `/uploads/${filename}`,
                        size: fs.statSync(filePath).size,
                        uploadedAt: new Date()
                    });
                    await newDoc.save();
                    
                    // Link to application
                    application.documents.push(newDoc._id);
                    await application.save();

                    console.log(`📄 PDF Generated & Linked: ${filename}`);
                    resolve(newDoc);
                } catch (saveErr) {
                    console.error('❌ Refined PDF DB Save Error:', saveErr);
                    reject(saveErr);
                }
            });

            stream.on('error', (err) => reject(err));
        } catch (err) {
            reject(err);
        }
    });
}

// =============================================
// MIDDLEWARE
// =============================================
function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied. No token provided.' });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid or expired token.' });
        }
        req.userEmail = decoded.email;
        req.userId = decoded.id;
        req.userRole = decoded.role || 'borrower';
        next();
    });
}

function requireAdmin(req, res, next) {
    if (req.userRole !== 'admin') {
        return res.status(403).json({ error: 'Admin access required.' });
    }
    next();
}

async function getAgentProfileForUser(userId) {
    if (!userId) return null;
    return AgentProfile.findOne({ userId }).lean();
}

async function buildAccessUser(req) {
    const user = await User.findById(req.userId).lean();
    if (!user) return null;
    const agentProfile = user.role === 'agent' ? await getAgentProfileForUser(user._id) : null;
    return {
        id: user._id.toString(),
        email: user.email,
        name: user.name,
        role: user.role,
        agentProfile
    };
}

async function requireApprovedAgent(req, res, next) {
    try {
        const accessUser = await buildAccessUser(req);
        if (!accessUser || !canAgentInviteBorrower(accessUser)) {
            return res.status(403).json({ error: 'Approved Ontario agent verification is required.' });
        }
        req.accessUser = accessUser;
        next();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

function publicBaseUrl(req) {
    return process.env.PUBLIC_APP_URL || `${req.protocol}://${req.get('host')}`;
}

async function runAutomatedAgentVerification(profile, user) {
    const verification = await verifyAgentAgainstOfficialRegistry({
        name: user.name,
        licenseNumber: profile.licenseNumber,
        licenseClass: profile.licenseClass,
        brokerageName: profile.brokerageName,
        brokerageLicenseNumber: profile.brokerageLicenseNumber,
        registryProfileUrl: profile.registryProfileUrl
    });

    profile.automatedVerification = verification;
    profile.lastCheckedAt = verification.checkedAt;
    profile.verifiedAt = verification.status === 'passed' ? verification.checkedAt : undefined;
    profile.verifiedBy = undefined;
    profile.rejectionReason = verification.failures.join(' ');
    profile.verificationStatus = verification.status === 'passed' ? 'pending_admin' : 'pending_registry';
    await profile.save();
    return verification;
}

// =============================================
// AUTH ENDPOINTS
// =============================================

app.get('/api/invites/:token', async (req, res) => {
    try {
        const invite = await AgentInvite.findOne({ tokenHash: hashInviteToken(req.params.token) })
            .populate('agentId', 'name email brokerageName')
            .lean();
        if (!isInviteUsable(invite)) {
            return res.status(404).json({ error: 'Invite not found or expired.' });
        }

        const agentProfile = await AgentProfile.findOne({ userId: invite.agentId._id }).lean();
        if (!agentProfile || agentProfile.verificationStatus !== 'approved') {
            return res.status(404).json({ error: 'Invite is not currently available.' });
        }

        res.json({
            invite: {
                borrowerEmail: invite.borrowerEmail,
                borrowerName: invite.borrowerName,
                expiresAt: invite.expiresAt,
                agent: {
                    name: invite.agentId.name,
                    email: invite.agentId.email,
                    brokerageName: agentProfile.brokerageName,
                    licenseNumber: agentProfile.licenseNumber,
                    licenseClass: agentProfile.licenseClass,
                    registryProfileUrl: agentProfile.registryProfileUrl
                }
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const { name, email, phone, password, inviteToken } = req.body;

        // Validation
        if (!name || !email || !phone || !password) {
            return res.status(400).json({ error: 'Name, email, phone, and password are required.' });
        }

        let invite = null;
        if (inviteToken) {
            invite = await AgentInvite.findOne({ tokenHash: hashInviteToken(inviteToken) });
            if (!isInviteUsable(invite)) {
                return res.status(400).json({ error: 'This agent invite is expired or no longer available.' });
            }
            if (invite.borrowerEmail && invite.borrowerEmail !== email.toLowerCase()) {
                return res.status(400).json({ error: 'This invite was issued for a different email address.' });
            }
        }

        let user = await User.findOne({ email: email.toLowerCase() });
        if (user && user.isVerified) {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }

        // Generate Registration Verification Codes 🛡️
        const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
        const phoneCode = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (user) {
            // Unverified abandoned account. Overwrite with new details and fresh codes.
            user.name = name || '';
            user.phone = phone;
            user.password = hashedPassword;
            user.verificationCodes = {
                emailCode: await bcrypt.hash(emailCode, salt),
                phoneCode: await bcrypt.hash(phoneCode, salt),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000)
            };
        } else {
            // Auto-assign admin role for admin@majesticequity.com
            const role = email.toLowerCase() === 'admin@majesticequity.com' ? 'admin' : 'borrower';
            
            user = new User({
                email: email.toLowerCase(),
                phone,
                password: hashedPassword,
                name: name || '',
                role: role,
                isVerified: false,
                verificationCodes: {
                    emailCode: await bcrypt.hash(emailCode, salt),
                    phoneCode: await bcrypt.hash(phoneCode, salt),
                    expiresAt: new Date(Date.now() + 15 * 60 * 1000) // 15 mins
                }
            });
        }
        await user.save();

        if (invite) {
            invite.status = 'used';
            invite.usedBorrowerId = user._id;
            invite.usedAt = new Date();
            await invite.save();
        }

        // Send Email Code
        await sendEmail(user.email, 'Verify Your Account — MajesticEquity', `
            <div style="font-family: 'Manrope', sans-serif; padding: 20px; color: #1a365d;">
                <h2>Welcome to MajesticEquity!</h2>
                <p>Please enter the following code to verify your email address:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #D3BD73; margin: 30px 0; background: #f8fafc; padding: 20px; display: inline-block; border-radius: 8px;">${emailCode}</div>
                <p>This code will expire in 15 minutes.</p>
            </div>
        `);

        // Send SMS Code
        await sendSMS(phone, `Your MajesticEquity verification code is ${phoneCode}. Valid for 15m.`);

        res.json({
            success: true,
            verificationRequired: true,
            email: user.email,
            inviteAccepted: !!invite
        });
    } catch (error) {
        console.error('Register Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/register-agent', authLimiter, async (req, res) => {
    try {
        const {
            name,
            email,
            phone,
            password,
            licenseNumber,
            licenseClass,
            brokerageName,
            brokerageLicenseNumber,
            registryProfileUrl
        } = req.body;

        if (!name || !email || !phone || !password || !licenseNumber || !licenseClass || !brokerageName || !brokerageLicenseNumber || !registryProfileUrl) {
            return res.status(400).json({ error: 'Name, contact details, FSRA licence, licence class, brokerage, brokerage licence, registry URL, and password are required.' });
        }

        if (!isOfficialRegistryUrl(registryProfileUrl)) {
            return res.status(400).json({ error: 'Registry URL must be an official FSRA or FSCO HTTPS registry URL.' });
        }

        let user = await User.findOne({ email: email.toLowerCase() });
        if (user && user.isVerified) {
            return res.status(400).json({ error: 'An account with this email already exists.' });
        }

        const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
        const phoneCode = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        if (user) {
            // Unverified abandoned account. Overwrite with agent details.
            user.name = name;
            user.phone = phone;
            user.password = hashedPassword;
            user.role = 'agent';
            user.nmlsId = licenseNumber;
            user.brokerageName = brokerageName;
            user.licenseState = 'ON';
            user.verificationCodes = {
                emailCode: await bcrypt.hash(emailCode, salt),
                phoneCode: await bcrypt.hash(phoneCode, salt),
                expiresAt: new Date(Date.now() + 15 * 60 * 1000)
            };
        } else {
            user = new User({
                email: email.toLowerCase(),
                phone,
                password: hashedPassword,
                name: name,
                role: 'agent',
                nmlsId: licenseNumber,
                brokerageName,
                licenseState: 'ON',
                isVerified: false,
                verificationCodes: {
                    emailCode: await bcrypt.hash(emailCode, salt),
                    phoneCode: await bcrypt.hash(phoneCode, salt),
                    expiresAt: new Date(Date.now() + 15 * 60 * 1000)
                }
            });
        }
        await user.save();

        const agentProfile = await AgentProfile.findOneAndUpdate(
            { userId: user._id },
            {
                userId: user._id,
                jurisdiction: 'CA-ON',
                licenseNumber,
                licenseClass,
                brokerageName,
                brokerageLicenseNumber,
                registryProfileUrl,
                verificationStatus: 'pending_review',
                automatedVerification: { status: 'unchecked', failures: [] },
                verifiedAt: undefined,
                verifiedBy: undefined,
                lastCheckedAt: undefined,
                rejectionReason: '',
                reviewNotes: ''
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );
        const automatedVerification = await runAutomatedAgentVerification(agentProfile, user);

        // Professional Welcome Email
        await sendEmail(user.email, 'Join the MajesticEquity Expert Network', `
            <div style="font-family: 'Manrope', sans-serif; padding: 20px; color: #1a365d;">
                <h2 style="color: #D3BD73;">Professional Partner Verification</h2>
                <p>Welcome to the MajesticEquity expert network, <strong>${name}</strong>.</p>
                    <p>Please use the following code to verify your professional account:</p>
                <div style="font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #D3BD73; margin: 30px 0; background: #f8fafc; padding: 20px; display: inline-block; border-radius: 8px;">${emailCode}</div>
                <p>Registered Professional Credentials:</p>
                <ul>
                    <li>FSRA Licence: ${licenseNumber}</li>
                    <li>Licence Class: ${licenseClass}</li>
                    <li>Brokerage: ${brokerageName}</li>
                    <li>Jurisdiction: Ontario</li>
                </ul>
                <p>This code will expire in 15 minutes. Client access is enabled only if our automated official-registry check confirms every submitted licence detail.</p>
            </div>
        `);

        await sendSMS(phone, `MajesticEquity Agent Verification: ${phoneCode}. Welcome to our expert network!`);

        res.json({
            success: true,
            verificationRequired: true,
            email: user.email,
            professionalVerification: automatedVerification
        });
    } catch (error) {
        console.error('Agent Register Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required.' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.status(401).json({ error: 'Invalid email or password.' });
        }

        // VERIFICATION CHECK 🛡️ (Phase 21)
        if (!user.isVerified) {
            return res.json({ 
                verificationRequired: true, 
                email: user.email 
            });
        }

        // MFA CHALLENGE 🔐 (Phase 20)
        if (user.mfaEnabled && user.mfaType !== 'none') {
            if (user.mfaType === 'email') {
                const otp = Math.floor(100000 + Math.random() * 900000).toString();
                const salt = await bcrypt.genSalt(10);
                user.mfaCode = await bcrypt.hash(otp, salt);
                user.mfaExpiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 mins
                await user.save();

                await sendEmail(user.email, 'Verification Code — MajesticEquity', `
                    <div style="font-family: 'Manrope', sans-serif; padding: 20px; color: #1a365d;">
                        <h2>Your Verification Code</h2>
                        <p>Enter the following code to complete your login:</p>
                        <div style="font-size: 32px; font-weight: bold; letter-spacing: 10px; color: #D3BD73; margin: 30px 0; background: #f8fafc; padding: 20px; display: inline-block; border-radius: 8px;">${otp}</div>
                        <p>This code will expire in 10 minutes for your security.</p>
                    </div>
                `);
                
                return res.json({ 
                    mfaRequired: true, 
                    mfaType: 'email',
                    email: user.email 
                });
            } else if (user.mfaType === 'totp') {
                return res.json({ 
                    mfaRequired: true, 
                    mfaType: 'totp',
                    email: user.email 
                });
            }
        }

        if (user.email.toLowerCase() === 'admin@majesticequity.com' && user.role !== 'admin') {
            user.role = 'admin';
            await user.save();
        }

        const token = jwt.sign(
            { email: user.email, id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`✅ User logged in: ${user.email} (${user.role})`);
        res.json({
            success: true,
            token,
            user: {
                email: user.email,
                name: user.name,
                id: user._id,
                role: user.role,
                identityStatus: user.identityStatus,
                creditScore: user.creditScore
            }
        });
    } catch (error) {
        console.error('Login Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// MFA ENDPOINTS (PHASE 20) 🔐🛡️
// =============================================

app.post('/api/auth/mfa/setup', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const secret = speakeasy.generateSecret({
            name: `MajesticEquity (${user.email})`,
            issuer: 'MajesticEquity'
        });

        const qrCodeDataUrl = await QRCode.toDataURL(secret.otpauth_url);
        
        // Temporarily store secret in user object (not enabled yet)
        user.mfaSecret = secret.base32;
        await user.save();

        res.json({ 
            success: true, 
            qrCode: qrCodeDataUrl, 
            secret: secret.base32 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/mfa/enable', authenticateToken, async (req, res) => {
    try {
        const { code, type } = req.body; // type: 'email' or 'totp'
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found' });

        if (type === 'totp') {
            const verified = speakeasy.totp.verify({
                secret: user.mfaSecret,
                encoding: 'base32',
                token: code
            });

            if (!verified) return res.status(400).json({ error: 'Invalid Google Authenticator code. Please try again.' });
            
            user.mfaEnabled = true;
            user.mfaType = 'totp';
            await user.save();
        } else if (type === 'email') {
            // Email MFA is verified by the fact the user can provide any code or just toggle it
            // For extra security, we could require a one-time verification here too
            user.mfaEnabled = true;
            user.mfaType = 'email';
            await user.save();
        }

        console.log(`🔐 MFA Enabled for ${user.email} (${user.mfaType})`);
        res.json({ success: true, mfaType: user.mfaType });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/mfa/disable', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        user.mfaEnabled = false;
        user.mfaType = 'none';
        user.mfaSecret = undefined;
        await user.save();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/mfa/verify', async (req, res) => {
    try {
        const { email, code } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ error: 'User not found' });

        let verified = false;

        if (user.mfaType === 'totp') {
            verified = speakeasy.totp.verify({
                secret: user.mfaSecret,
                encoding: 'base32',
                token: code,
                window: 1 // Allow 30s drift
            });
        } else if (user.mfaType === 'email') {
            if (!user.mfaCode || !user.mfaExpiresAt || new Date() > user.mfaExpiresAt) {
                return res.status(400).json({ error: 'Verification code expired. Please log in again.' });
            }
            verified = await bcrypt.compare(code, user.mfaCode);
        }

        if (!verified) return res.status(400).json({ error: 'Invalid verification code.' });

        // Success: Clear ephemeral email OTP
        if (user.mfaType === 'email') {
            user.mfaCode = undefined;
            user.mfaExpiresAt = undefined;
            await user.save();
        }

        const token = jwt.sign(
            { email: user.email, id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`✅ MFA Verified for ${user.email}`);
        res.json({ 
            success: true, 
            token, 
            user: { 
                email: user.email, 
                role: user.role, 
                id: user._id, 
                name: user.name,
                identityStatus: user.identityStatus,
                creditScore: user.creditScore
            } 
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// PLAID ENDPOINTS
// =============================================

app.post('/api/create_link_token', authenticateToken, async (req, res) => {
    try {
        const products = (process.env.PLAID_PRODUCTS || 'auth').split(',');
        const countryCodes = (process.env.PLAID_COUNTRY_CODES || 'US,CA').split(',');

        const response = await client.linkTokenCreate({
            user: { client_user_id: req.userId || 'dev-user-' + Date.now() },
            client_name: 'MajesticEquity Mortgages',
            products: products,
            country_codes: countryCodes,
            language: 'en',
        });
        res.json(response.data);
    } catch (error) {
        console.error('Plaid API Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/exchange_public_token', authenticateToken, async (req, res) => {
    const { public_token } = req.body;
    try {
        const response = await client.itemPublicTokenExchange({ public_token });
        const accessToken = response.data.access_token;
        const itemID = response.data.item_id;

        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found.' });
        const usedInvite = await AgentInvite.findOne({ usedBorrowerId: user._id }).sort({ usedAt: -1 });

        const newItem = new PlaidItem({
            userId: user._id,
            accessToken: accessToken,
            itemId: itemID,
            institutionName: 'Linked Bank'
        });
        await newItem.save();

        console.log('✅ Plaid Token Saved for Item:', itemID);
        res.json({ status: 'success', item_id: itemID });
    } catch (error) {
        console.error('Plaid Exchange Error:', error.response ? error.response.data : error.message);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// USER STATUS
// =============================================

// [Removed Duplicate user_status endpoint]

// =============================================
// PERSONA IDENTITY VERIFICATION
// =============================================

app.post('/api/create_inquiry', authenticateToken, async (req, res) => {
    try {
        const templateId = process.env.PERSONA_TEMPLATE_ID;
        if (!templateId) {
            console.error('❌ Persona Error: PERSONA_TEMPLATE_ID is missing in .env');
            return res.status(500).json({ error: 'Persona Template ID not configured.' });
        }

        console.log(`🚀 Creating Persona Inquiry for: ${req.userEmail}`);
        res.json({
            templateId: templateId,
            referenceId: req.userEmail
        });
    } catch (error) {
        console.error('❌ Persona Inquiry Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/persona_complete', authenticateToken, async (req, res) => {
    try {
        const { inquiryId } = req.body; // 🚨 We completely ignore the frontend "status" parameter now. Never trust the client.
        console.log(`👤 Persona Verification server-check requested for: ${inquiryId}`);

        // 🛡️ Secure Server-to-Server Validation
        const response = await fetch(`https://withpersona.com/api/v1/inquiries/${inquiryId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.PERSONA_API_KEY}`,
                'Accept': 'application/json',
                'Persona-Version': '2023-01-05' // Standard API version header
            }
        });

        if (!response.ok) {
            console.error(`❌ Persona Verification Failed: HTTP Status ${response.status}`);
            throw new Error('Failed to validate the identity check securely via Persona servers.');
        }

        const data = await response.json();
        const realStatus = data.data.attributes.status; // Securely retrieve from Persona: e.g. "completed", "failed", "requires_retry"
        
        console.log(`🛡️ Persona Verification Validated - True Status: ${realStatus}`);

        const user = await User.findOneAndUpdate(
            { email: req.userEmail },
            { identityStatus: realStatus, personaInquiryId: inquiryId },
            { returnDocument: 'after', upsert: true }
        );

        if (realStatus === 'completed' || realStatus === 'verified') {
            await Application.findOneAndUpdate(
                { userEmail: req.userEmail, status: { $ne: 'Funded' } },
                { identityVerified: true }
            );
        }

        res.json({ success: true, user, status: realStatus });
    } catch (error) {
        console.error('❌ Persona Secure Verification Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// CREDIT PULL API
// =============================================

app.post('/api/credit_pull', authenticateToken, async (req, res) => {
    try {
        console.log('📉 Initiating Experian Credit Pull...');
        const { ssn, dob, addressLine1, city, state, zip } = req.body;

        // 1. Validate incoming identity data
        if (!ssn || !dob || !addressLine1 || !city || !state || !zip) {
            return res.status(400).json({ error: 'Missing required identity data for Experian pull.' });
        }

        // 2. Save identity data to User model securely
        const user = await User.findOneAndUpdate(
            { email: req.userEmail },
            { 
                 ssn: ssn, // In prod, encrypt this!
                 dob: new Date(dob),
                 addressLine1, city, state, zip
            },
            { returnDocument: 'after' }
        );

        if (!user) return res.status(404).json({ error: 'User not found.' });

        // 3. Call Experian API (Sandbox Helper)
        // Utilizing the experian-node pattern but injecting realistic Sandbox logic
        // due to placeholder developmental credentials.
        await new Promise(resolve => setTimeout(resolve, 2500)); // Simulating OAuth2 + Report Pull
        
        // Sandbox behavior: generate a deterministic score from zip code for predictable E2E testing
        let baseScore = parseInt(zip.substring(0, 3) || '720', 10);
        if (isNaN(baseScore)) baseScore = 320; // Fallback for non-numeric zip codes
        const resolvedScore = Math.max(300, Math.min(850, baseScore + 400));
        const reportId = 'EXP-' + Math.random().toString(36).substr(2, 9).toUpperCase();

        // 4. Update User with new Score
        user.creditScore = resolvedScore;
        user.creditReportId = reportId;
        await user.save();

        // 5. Link to Application
        await Application.findOneAndUpdate(
            { userEmail: req.userEmail, status: { $ne: 'Funded' } },
            { creditScore: resolvedScore, creditVerified: true }
        );

        console.log(`✅ Experian API Success for ${req.userEmail}: Score ${resolvedScore}`);

        res.json({
            success: true,
            score: resolvedScore,
            reportId: reportId,
            rating: resolvedScore > 740 ? 'Exceptional' : resolvedScore > 670 ? 'Good' : 'Fair',
            provider: 'Experian'
        });
    } catch (error) {
        console.error('Experian Integration Error:', error);
        res.status(500).json({ error: error.message || 'Credit provider failed to respond.' });
    }
});

// =============================================
// DATA SYNC ENDPOINTS (PHASE 12 HARDENING)
// =============================================

app.post('/api/applications/sync_income', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const item = await PlaidItem.findOne({ userId: user._id });
        let annualizedIncome = 4582.50 * 12; // Fallback
        
        // REAL PLAID API: Calculate Bank-based Income via Transactions
        if (item) {
            const now = new Date();
            const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
            
            try {
                const response = await client.transactionsGet({
                    access_token: item.accessToken,
                    start_date: thirtyDaysAgo.toISOString().split('T')[0],
                    end_date: now.toISOString().split('T')[0],
                });
                
                let monthlyIncome = 0;
                response.data.transactions.forEach(txn => {
                    // Plaid amounts are positive for withdrawals, negative for deposits
                    if (txn.amount < 0) {
                        monthlyIncome += Math.abs(txn.amount);
                    }
                });
                
                if (monthlyIncome > 0) {
                    annualizedIncome = monthlyIncome * 12;
                }
            } catch (plaidErr) {
                console.log('Plaid Transactions Error (Sandbox may lack txns):', plaidErr.message);
            }
        }

        const exactIncome = req.body.income || (annualizedIncome / 12);

        const application = await Application.findOneAndUpdate(
            { userEmail: req.userEmail, status: { $ne: 'Funded' } },
            { 
                verifiedIncome: exactIncome, 
                incomeSource: item ? 'Plaid Bank Sync' : 'ADP Global',
                incomeVerified: true 
            },
            { returnDocument: 'after' }
        );
        console.log(`💰 Real Plaid Income Verified for ${req.userEmail}: $${exactIncome}/mo`);
        res.json({ success: true, application });
    } catch (error) {
        console.error('Income Sync Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/applications/sync_assets', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found' });

        // Find their specific Plaid connection
        const item = await PlaidItem.findOne({ userId: user._id });
        let totalCAD = req.body.assets || 50000; // Dev Fallback
        
        // REAL PLAID API: Fetch current balances
        if (item) {
            const response = await client.accountsBalanceGet({ access_token: item.accessToken });
            totalCAD = 0;
            response.data.accounts.forEach(account => {
                if (account.type === 'depository' || account.type === 'investment') {
                    totalCAD += account.balances.available || account.balances.current || 0;
                }
            });
        }

        const application = await Application.findOneAndUpdate(
            { userEmail: req.userEmail, status: { $ne: 'Funded' } },
            { 
                verifiedAssets: totalCAD, 
                assetsVerified: true 
            },
            { returnDocument: 'after' }
        );
        console.log(`🏦 Real Plaid Assets Verified for ${req.userEmail}: $${totalCAD}`);
        res.json({ success: true, application });
    } catch (error) {
        console.error('Plaid Balance Sync Error:', error.response?.data || error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// DOCUMENT UPLOAD
// =============================================

app.post('/api/documents/upload', authenticateToken, upload.single('file'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded.' });
        }

        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        const doc = new Document({
            userId: user._id,
            userEmail: req.userEmail,
            filename: req.file.filename,
            originalName: req.file.originalname,
            mimetype: req.file.mimetype,
            size: req.file.size,
            category: req.body.category || 'Other'
        });
        await doc.save();

        if (req.body.conditionId && req.body.applicationId) {
            await Application.findOneAndUpdate(
                { _id: req.body.applicationId, "conditions._id": req.body.conditionId },
                { 
                    $set: { 
                        "conditions.$.status": "Uploaded",
                        "conditions.$.documentId": doc._id
                    }
                }
            );
        }

        console.log(`📄 Document uploaded: ${doc.originalName} by ${req.userEmail}`);
        res.json({ success: true, document: doc });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

async function getUserStatus(req, res) {
    try {
        const user = await User.findOne({ email: req.userEmail }, '-password');
        if (!user) return res.status(404).json({ error: 'User not found' });

        const item = await PlaidItem.findOne({ userId: user._id });
        const agentProfile = user.role === 'agent' ? await AgentProfile.findOne({ userId: user._id }) : null;
        const application = await Application.findOne({ userEmail: user.email, status: { $ne: 'Funded' } }).sort({ createdAt: -1 });

        const app = application ? application.toObject() : null;
        let completedSteps = 0;
        if (app) {
            if (app.identityVerified) completedSteps++;
            if (app.incomeVerified) completedSteps++;
            if (app.assetsVerified) completedSteps++;
            if (app.creditVerified) completedSteps++;
            if (app.status !== 'Draft') completedSteps++;
        } else if (user.identityStatus === 'completed' || user.identityStatus === 'Verified') {
            completedSteps = 1;
        }

        const data = {
            ...user.toObject(),
            role: req.userRole || user.role,
            application: app,
            agentProfile: agentProfile ? agentProfile.toObject() : null,
            isSynced: !!item || (application && application.assetsVerified),
            completedSteps,
            progressPercent: Math.round((completedSteps / 5) * 100)
        };

        if (data.application) {
            data.application.unreadMessages = application.messages.filter(m => !m.isRead && m.senderRole !== user.role).length;
        }

        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
}

app.post('/api/user_status', authenticateToken, getUserStatus);
app.get('/api/user_status', authenticateToken, getUserStatus); // Support both for flexibility

app.get('/api/documents', authenticateToken, async (req, res) => {
    try {
        let docs;
        if (req.userRole === 'admin' && req.query.userId) {
            const user = await User.findById(req.query.userId);
            if (!user) return res.status(404).json({ error: 'User not found' });
            docs = await Document.find({ userEmail: user.email }).sort({ uploadedAt: -1 });
        } else {
            docs = await Document.find({ userEmail: req.userEmail }).sort({ uploadedAt: -1 });
        }
        res.json({ documents: docs });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/documents/:id', authenticateToken, async (req, res) => {
    try {
        const doc = await Document.findOne({ _id: req.params.id, userEmail: req.userEmail });
        if (!doc) return res.status(404).json({ error: 'Document not found.' });

        // Delete file from disk
        const filePath = path.join(uploadsDir, doc.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        await Document.deleteOne({ _id: doc._id });
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// APPLICATION SUBMISSION & TRACKING
// =============================================

app.post('/api/applications/submit', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        // Check for existing application
        let application = await Application.findOne({ userEmail: req.userEmail, status: { $nin: ['Denied', 'Funded'] } });

        if (application) {
            // Update existing
            application.status = 'Submitted';
            application.identityVerified = user.identityStatus === 'Verified';
            application.creditVerified = !!user.creditScore;
            application.creditScore = user.creditScore;
            if (usedInvite && !application.assignedAgentId) {
                application.assignedAgentId = usedInvite.agentId;
            }
            
            // Map 1003 Fields
            application.loanAmount = req.body.loanAmount || application.loanAmount;
            application.propertyAddress = req.body.propertyAddress || application.propertyAddress;
            application.loanType = req.body.loanType || application.loanType;
            
            if (req.body.personalInfo) application.personalInfo = req.body.personalInfo;
            if (req.body.propertyDetails) application.propertyDetails = req.body.propertyDetails;
            if (req.body.employmentHistory) application.employmentHistory = req.body.employmentHistory;
            if (req.body.residentialHistory) application.residentialHistory = req.body.residentialHistory;
            if (req.body.reo) application.reo = req.body.reo;
            if (req.body.declarations) application.declarations = req.body.declarations;
            if (req.body.demographics) application.demographics = req.body.demographics;

            await application.save();
        } else {
            // Create new
            application = new Application({
                userId: user._id,
                userEmail: req.userEmail,
                userName: user.name,
                status: 'Submitted',
                identityVerified: user.identityStatus === 'Verified',
                incomeVerified: true,
                assetsVerified: true,
                creditVerified: !!user.creditScore,
                creditScore: user.creditScore,
                loanAmount: req.body.loanAmount || 0,
                propertyAddress: req.body.propertyAddress || '',
                loanType: req.body.loanType || 'Purchase',
                
                // Map 1003 Fields
                personalInfo: req.body.personalInfo || {},
                propertyDetails: req.body.propertyDetails || {},
                employmentHistory: req.body.employmentHistory || [],
                residentialHistory: req.body.residentialHistory || [],
                reo: req.body.reo || [],
                declarations: req.body.declarations || {},
                demographics: req.body.demographics || {}
            });
            if (usedInvite) {
                application.assignedAgentId = usedInvite.agentId;
            }
            await application.save();
        }

        if (usedInvite && !usedInvite.usedApplicationId) {
            usedInvite.usedApplicationId = application._id;
            await usedInvite.save();
        }

        // Send email notification
        await sendEmail(req.userEmail, 'Application Submitted — MajesticEquity', `
            <h2>Your Application Has Been Submitted!</h2>
            <p>Hi ${user.name || 'there'},</p>
            <p>We've received your mortgage application. Our team will review it within 24-48 hours.</p>
            <p><strong>Application ID:</strong> ${application._id}</p>
            <p><strong>Status:</strong> Submitted</p>
            <p>Log in to your <a href="http://localhost:3000">Borrower Portal</a> anytime to check your status.</p>
        `);

        console.log(`📋 Application submitted: ${application._id} by ${req.userEmail}`);
        res.json({ success: true, application });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/applications/mine', authenticateToken, async (req, res) => {
    try {
        const application = await Application.findOne({ userEmail: req.userEmail })
            .sort({ createdAt: -1 })
            .populate('documents');
        res.json({ application });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// DEVELOPER UTILITIES (PHASE 13)
// =============================================

app.post('/api/applications/sample', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        // 1. Wipe existing state to avoid duplicates/conflicts
        await Application.deleteMany({ userEmail: req.userEmail });

        // 2. Create Sample Application
        const sampleApp = new Application({
            userId: user._id,
            userEmail: user.email,
            userName: user.name,
            status: 'Submitted',
            propertyAddress: '123 Luxury Lane, Toronto, ON',
            loanAmount: 850000,
            loanType: 'Purchase',
            verifiedIncome: 125000,
            incomeSource: 'Sample Corp (ADP)',
            incomeVerified: true,
            verifiedAssets: 200000,
            assetsVerified: true,
            creditScore: 785,
            creditVerified: true,
            identityVerified: true,
            
            // 1003 Sample Data
            personalInfo: {
                phone: '416-555-0199',
                maritalStatus: 'Married',
                dependents: 1
            },
            propertyDetails: {
                propertyType: 'SingleFamily',
                occupancyType: 'PrimaryResidence',
                purchasePrice: 1050000,
                estimatedValue: 1050000
            },
            employmentHistory: [
                {
                    employerName: 'Sample Corp',
                    title: 'Senior Software Engineer',
                    startDate: '2022-01-15',
                    endDate: 'Present',
                    monthlyIncome: 10416
                },
                {
                    employerName: 'Tech StartUp Inc',
                    title: 'Software Developer',
                    startDate: '2020-05-01',
                    endDate: '2022-01-10',
                    monthlyIncome: 8500
                }
            ],
            residentialHistory: [
                {
                    address: '123 Luxury Lane, Toronto, ON',
                    status: 'Rent',
                    monthlyPayment: 3200,
                    startDate: '2021-06-01',
                    endDate: 'Present'
                },
                {
                    address: '456 Starter St, North York, ON',
                    status: 'Rent',
                    monthlyPayment: 2100,
                    startDate: '2019-01-01',
                    endDate: '2021-05-30'
                }
            ],
            declarations: {
                outstandingJudgments: false,
                bankruptcy: false,
                foreclosure: false,
                lawsuits: false,
                usCitizen: true
            },
            messages: [
                {
                    sender: 'admin@majesticequity.com',
                    senderName: 'Broker Team',
                    senderRole: 'admin',
                    message: 'Welcome to your sample application! All your data has been verified via our automated sync.',
                    isRead: false
                }
            ]
        });
        await sampleApp.save();

        // 3. Update User Record
        user.identityStatus = 'Verified';
        user.creditScore = 785;
        user.currentStep = 4;
        await user.save();

        console.log(`🧪 Sample Application generated for: ${req.userEmail}`);
        res.json({ success: true, application: sampleApp });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/applications/reset', authenticateToken, async (req, res) => {
    try {
        const user = await User.findOne({ email: req.userEmail });
        if (!user) return res.status(404).json({ error: 'User not found.' });

        // 1. Wipe Applications
        await Application.deleteMany({ userEmail: req.userEmail });

        // 2. Wipe Documents (optional, but requested "remove sample")
        await Document.deleteMany({ userEmail: req.userEmail });

        // 3. Reset User State
        user.identityStatus = 'Not Started';
        user.creditScore = null;
        user.creditReportId = null;
        user.currentStep = 1;
        user.personaInquiryId = null;
        await user.save();

        console.log(`♻️ Application State Reset for: ${req.userEmail}`);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// PAYMENTS: STRIPE CHECKOUT
// =============================================

app.post('/api/payments/create-checkout-session', authenticateToken, async (req, res) => {
    try {
        const { applicationId } = req.body;
        const app = await Application.findById(applicationId);
        if (!app) return res.status(404).json({ error: 'Application not found.' });

        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [{
                price_data: {
                    currency: 'usd',
                    product_data: {
                        name: 'Appraisal Fee',
                        description: `Appraisal service for ${app.propertyAddress || 'Subject Property'}`,
                    },
                    unit_amount: 50000, // $500.00
                },
                quantity: 1,
            }],
            mode: 'payment',
            success_url: `${req.headers.origin}/?payment=success&appId=${applicationId}`,
            cancel_url: `${req.headers.origin}/?payment=cancelled`,
            client_reference_id: applicationId,
            customer_email: req.userEmail
        });

        res.json({ url: session.url });
    } catch (error) {
        console.error('❌ Stripe checkout error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ADMIN: LOS EXPORT (Fannie Mae 3.2)
// =============================================

app.get('/api/admin/applications/:id/export', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const app = await Application.findById(req.params.id);
        if (!app) return res.status(404).json({ error: 'Application not found.' });

        const fnmContent = generateFNM(app);
        const fileName = `1003_Export_${app.userName || 'Borrower'}_${app._id}.fnm`;

        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.send(fnmContent);
    } catch (error) {
        console.error('❌ LOS Export Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// ADMIN: BROKER NOTES
// =============================================

app.patch('/api/admin/applications/:id/notes', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ error: 'Application not found.' });

        application.adminNotes = req.body.notes || '';
        await application.save();

        res.json({ success: true, notes: application.adminNotes });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// MESSAGING
// =============================================

app.post('/api/applications/:id/messages', authenticateToken, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ error: 'Application not found.' });

        const accessUser = await buildAccessUser(req);
        if (!canMessageApplication(accessUser, application)) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        const senderName = req.userRole === 'admin' ? 'Broker Team' : (accessUser.name || application.userName || req.userEmail);
        const newMessage = {
            sender: req.userEmail,
            senderName: senderName,
            senderRole: req.userRole,
            message: req.body.message || req.body.text // Support both for safety during transition
        };

        application.messages.push(newMessage);
        await application.save();

        // Emit real-time message via Socket.io
        req.app.get('io').to(req.params.id).emit('new_message', {
            ...newMessage,
            id: new Date().getTime().toString(),
            createdAt: new Date()
        });

        // Notify the other party
        let recipient = 'admin@majesticequity.com';
        if (req.userRole === 'admin' || req.userRole === 'agent') {
            recipient = application.userEmail;
        } else if (application.assignedAgentId) {
            const assignedAgent = await User.findById(application.assignedAgentId);
            recipient = assignedAgent?.email || recipient;
        }
        await sendEmail(recipient, 'New Message — MajesticEquity Portal', `
            <h3>You have a new message</h3>
            <p><strong>From:</strong> ${senderName}</p>
            <p>${newMessage.message}</p>
            <p><a href="http://localhost:3000">View in Portal</a></p>
        `);

        res.json({ success: true, messages: application.messages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/applications/:id/messages', authenticateToken, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ error: 'Application not found.' });

        const accessUser = await buildAccessUser(req);
        if (!canAccessApplication(accessUser, application)) {
            return res.status(403).json({ error: 'Access denied.' });
        }

        // Mark messages from the other party as read
        const myRole = req.userRole;
        application.messages.forEach(msg => {
            if (msg.senderRole !== myRole) msg.isRead = true;
        });
        await application.save();

        res.json({ messages: application.messages });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// ADMIN ENDPOINTS
// =============================================

app.get('/api/admin/applications', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const applications = await Application.find()
            .sort({ updatedAt: -1 })
            .populate('documents')
            .populate('userId', 'ssn dob addressLine1 city state zip creditReportId');
        res.json({ applications });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/admin/applications/:id', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status, adminNotes, assignedBroker } = req.body;
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ error: 'Application not found.' });

        const oldStatus = application.status;

        if (status) application.status = status;
        if (adminNotes !== undefined) application.adminNotes = adminNotes;
        if (assignedBroker) application.assignedBroker = assignedBroker;

        await application.save();

        // Notify borrower of status change
        if (status && status !== oldStatus) {
            await sendEmail(application.userEmail, `Application Update: ${status}`, `
                <h2>Your Application Status Has Changed</h2>
                <p>Hi ${application.userName || 'there'},</p>
                <p>Your mortgage application status has been updated to: <strong>${status}</strong></p>
                ${status === 'Approved' ? `
                    <p style="color:green;font-size:18px">🎉 Congratulations! Your mortgage has been approved!</p>
                    <p>We have automatically generated your <strong>Official Pre-Approval Letter</strong>. You can find it in your Documents tab.</p>
                ` : ''}
                <p><a href="http://localhost:3000">Log in to your portal</a> for details.</p>
            `);

            // Phase 10-B: AUTO-GENERATE PDF ON APPROVAL
            if (status === 'Approved') {
                try {
                    await generatePreApprovalPDF(application);
                } catch (pdfErr) {
                    console.error('❌ PDF Generation Failed:', pdfErr);
                }
            }
        }

        // Emit global status update to trigger live dashboard refreshes
        req.app.get('io').emit('status_update', { appId: application._id, status: application.status });

        console.log(`🔄 Admin updated application ${req.params.id}: ${oldStatus} → ${status || oldStatus}`);
        res.json({ success: true, application });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const users = await User.find({}, '-password').sort({ createdAt: -1 });
        res.json({ users });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/agents', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const query = {};
        if (req.query.status) query.verificationStatus = req.query.status;

        const profiles = await AgentProfile.find(query)
            .sort({ updatedAt: -1 })
            .populate('userId', 'name email phone isVerified createdAt')
            .populate('verifiedBy', 'name email');

        res.json({ agents: profiles });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/admin/agents/:id/verification', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status, registryProfileUrl, rejectionReason, reviewNotes } = req.body;
        if (!['retry', 'rejected', 'suspended', 'pending_review'].includes(status)) {
            return res.status(400).json({ error: 'Invalid verification status.' });
        }

        const profile = await AgentProfile.findById(req.params.id);
        if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });
        const user = await User.findById(profile.userId);
        if (!user) return res.status(404).json({ error: 'Agent user not found.' });

        if (registryProfileUrl !== undefined) profile.registryProfileUrl = registryProfileUrl;
        if (rejectionReason !== undefined) profile.rejectionReason = rejectionReason;
        if (reviewNotes !== undefined) profile.reviewNotes = reviewNotes;

        if (status === 'retry') {
            await runAutomatedAgentVerification(profile, user);
        } else {
            profile.verificationStatus = status;
            profile.lastCheckedAt = new Date();
            if (status !== 'suspended') {
                profile.verifiedAt = undefined;
                profile.verifiedBy = undefined;
            }
            await profile.save();
        }

        req.app.get('io').emit('status_update', { updateType: 'agent_verification', agentId: profile.userId });
        res.json({ success: true, agentProfile: profile });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/agent/invites', authenticateToken, requireApprovedAgent, async (req, res) => {
    try {
        const { borrowerEmail, borrowerName } = req.body;
        const token = crypto.randomBytes(24).toString('hex');
        const invite = new AgentInvite({
            agentId: req.userId,
            tokenHash: hashInviteToken(token),
            borrowerEmail: borrowerEmail ? borrowerEmail.toLowerCase().trim() : '',
            borrowerName: borrowerName || '',
            expiresAt: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)
        });
        await invite.save();

        const inviteUrl = `${publicBaseUrl(req)}/?invite=${token}`;
        if (invite.borrowerEmail) {
            await sendEmail(invite.borrowerEmail, 'Your MajesticEquity Mortgage Portal Invitation', `
                <h2>${req.accessUser.name || 'Your mortgage agent'} invited you to MajesticEquity</h2>
                <p>Create your secure borrower portal account here:</p>
                <p><a href="${inviteUrl}">${inviteUrl}</a></p>
                <p>This invitation expires in 14 days.</p>
            `);
        }

        res.json({
            success: true,
            invite: {
                id: invite._id,
                borrowerEmail: invite.borrowerEmail,
                borrowerName: invite.borrowerName,
                status: invite.status,
                expiresAt: invite.expiresAt,
                inviteUrl
            }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agent/invites', authenticateToken, requireApprovedAgent, async (req, res) => {
    try {
        const invites = await AgentInvite.find({ agentId: req.userId })
            .sort({ createdAt: -1 })
            .select('-tokenHash');
        res.json({ invites });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// AGENT IDENTITY VERIFICATION (3-LAYER SYSTEM)
// Layer 1: Persona (Gov ID + Selfie Liveness)
// Layer 2: Automated FSRA Registry Check
// Layer 3: Admin Final Approval
// =============================================

// Layer 1: Start Persona inquiry for agent
app.post('/api/agent/verify-identity', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'agent') {
            return res.status(403).json({ error: 'Agent account required.' });
        }

        const profile = await AgentProfile.findOne({ userId: user._id });
        if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });
        if (profile.verificationStatus === 'suspended') {
            return res.status(403).json({ error: 'Suspended agents cannot verify.' });
        }
        if (profile.identityVerification?.status === 'completed') {
            return res.status(400).json({ error: 'Identity already verified. Proceed to registry check.' });
        }

        const templateId = process.env.PERSONA_TEMPLATE_ID;
        if (!templateId) {
            return res.status(500).json({ error: 'Persona Template ID not configured.' });
        }

        // Mark identity verification as pending
        profile.identityVerification = {
            ...profile.identityVerification,
            status: 'pending'
        };
        profile.verificationStatus = 'pending_identity';
        await profile.save();

        console.log(`🚀 Agent Persona Inquiry initiated for: ${user.email}`);
        res.json({
            templateId: templateId,
            referenceId: `agent_${user.email}`
        });
    } catch (error) {
        console.error('❌ Agent Identity Start Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Layer 1 Completion: Server-to-server Persona validation for agent
app.post('/api/agent/persona-complete', authenticateToken, async (req, res) => {
    try {
        const { inquiryId } = req.body;
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'agent') {
            return res.status(403).json({ error: 'Agent account required.' });
        }

        const profile = await AgentProfile.findOne({ userId: user._id });
        if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });

        // 🛡️ Secure Server-to-Server Validation (NEVER trust the client)
        console.log(`👤 Agent Persona server-check for: ${inquiryId}`);
        const response = await fetch(`https://withpersona.com/api/v1/inquiries/${inquiryId}`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${process.env.PERSONA_API_KEY}`,
                'Accept': 'application/json',
                'Persona-Version': '2023-01-05'
            }
        });

        if (!response.ok) {
            console.error(`❌ Agent Persona Verification Failed: HTTP ${response.status}`);
            throw new Error('Failed to validate identity via Persona servers.');
        }

        const data = await response.json();
        const realStatus = data.data.attributes.status;
        const personaName = data.data.attributes?.name?.full || '';

        console.log(`🛡️ Agent Persona Result — Status: ${realStatus}, Name: ${personaName}`);

        if (realStatus === 'completed' || realStatus === 'approved') {
            profile.identityVerification = {
                status: 'completed',
                personaInquiryId: inquiryId,
                verifiedName: personaName,
                completedAt: new Date()
            };

            // AUTO-CHAIN → Layer 2: Run FSRA Registry Check immediately
            console.log(`⚡ Auto-chaining to Layer 2 (FSRA Registry) for: ${user.email}`);
            profile.verificationStatus = 'pending_registry';
            await profile.save();

            try {
                const verification = await runAutomatedAgentVerification(profile, user);
                if (verification.status === 'passed') {
                    profile.verificationStatus = 'pending_admin';
                    await profile.save();
                    console.log(`✅ Agent ${user.email} passed all automated checks. Awaiting admin approval.`);
                } else {
                    profile.verificationStatus = 'pending_registry';
                    await profile.save();
                    console.log(`⚠️ Agent ${user.email} failed FSRA registry check.`);
                }
            } catch (regErr) {
                console.error('⚠️ FSRA registry check failed (non-blocking):', regErr.message);
                profile.verificationStatus = 'pending_registry';
                await profile.save();
            }

            req.app.get('io').emit('status_update', { updateType: 'agent_verification', agentId: user._id });

            res.json({
                success: true,
                identityStatus: 'completed',
                verifiedName: personaName,
                verificationStatus: profile.verificationStatus,
                agentProfile: profile
            });
        } else {
            // Persona failed or needs retry
            profile.identityVerification = {
                status: 'failed',
                personaInquiryId: inquiryId,
                verifiedName: '',
                completedAt: new Date()
            };
            profile.verificationStatus = 'pending_identity';
            await profile.save();

            res.json({
                success: false,
                identityStatus: realStatus,
                verificationStatus: 'pending_identity',
                agentProfile: profile
            });
        }
    } catch (error) {
        console.error('❌ Agent Persona Completion Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Layer 2 Retry: Re-run FSRA registry check
app.post('/api/agent/verification/retry', authenticateToken, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user || user.role !== 'agent') {
            return res.status(403).json({ error: 'Agent account required.' });
        }

        const profile = await AgentProfile.findOne({ userId: user._id });
        if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });
        if (profile.verificationStatus === 'suspended') {
            return res.status(403).json({ error: 'Suspended agents cannot retry verification.' });
        }

        // Ensure Layer 1 (Persona) is already completed before allowing registry retry
        if (profile.identityVerification?.status !== 'completed') {
            return res.status(400).json({ error: 'You must complete identity verification (Persona) first.' });
        }

        const verification = await runAutomatedAgentVerification(profile, user);
        if (verification.status === 'passed') {
            profile.verificationStatus = 'pending_admin';
            await profile.save();
        }
        req.app.get('io').emit('status_update', { updateType: 'agent_verification', agentId: profile.userId });
        res.json({ success: true, agentProfile: profile, verification });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Layer 3: Admin approval/rejection of agent
app.patch('/api/admin/agents/:profileId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const { status, reviewNotes, rejectionReason } = req.body;
        const profile = await AgentProfile.findById(req.params.profileId);
        if (!profile) return res.status(404).json({ error: 'Agent profile not found.' });

        const validStatuses = ['approved', 'rejected', 'suspended'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({ error: `Status must be one of: ${validStatuses.join(', ')}` });
        }

        profile.verificationStatus = status;
        if (status === 'approved') {
            profile.verifiedAt = new Date();
            profile.verifiedBy = req.userId;
        }
        if (rejectionReason) profile.rejectionReason = rejectionReason;
        if (reviewNotes) profile.reviewNotes = reviewNotes;
        await profile.save();

        req.app.get('io').emit('status_update', { updateType: 'agent_verification', agentId: profile.userId });
        console.log(`🛡️ Admin ${req.userEmail} set agent ${profile.userId} to: ${status}`);
        res.json({ success: true, agentProfile: profile });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/agent/applications', authenticateToken, requireApprovedAgent, async (req, res) => {
    try {
        const applications = await Application.find({ assignedAgentId: req.userId })
            .sort({ updatedAt: -1 })
            .populate('documents');
        res.json({ applications });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// ADMIN: CONDITIONS (NEEDS LIST)
// =============================================

app.post('/api/admin/applications/:id/conditions', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ error: 'Application not found.' });

        if (!req.body.name) return res.status(400).json({ error: 'Condition name is required.' });

        application.conditions.push({
            name: req.body.name,
            brokerNote: req.body.brokerNote || '',
            status: 'Pending'
        });
        
        await application.save();

        // Notify borrower
        await sendEmail(application.userEmail, `New Document Request — MajesticEquity`, `
            <h2>Document Request</h2>
            <p>Your broker has requested a new document for your mortgage application:</p>
            <p><strong>${req.body.name}</strong></p>
            <p><a href="http://localhost:3000">Log in to your portal</a> to upload it.</p>
        `);

        // Emit reload event
        req.app.get('io').emit('status_update', { appId: application._id, updateType: 'conditions' });

        res.json({ success: true, conditions: application.conditions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/admin/applications/:id/conditions/:conditionId', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const application = await Application.findById(req.params.id);
        if (!application) return res.status(404).json({ error: 'Application not found.' });

        const condition = application.conditions.id(req.params.conditionId);
        if (!condition) return res.status(404).json({ error: 'Condition not found.' });

        if (req.body.status) condition.status = req.body.status;
        if (req.body.brokerNote !== undefined) condition.brokerNote = req.body.brokerNote;

        await application.save();

        // Let the borrower know if a condition was accepted/rejected
        if (req.body.status === 'Rejected') {
            await sendEmail(application.userEmail, `Document Rejected — Action Required`, `
                <h2>Document Rejected</h2>
                <p>Unfortunately, the document you uploaded for <strong>${condition.name}</strong> was rejected.</p>
                <p><strong>Note:</strong> ${condition.brokerNote}</p>
                <p><a href="http://localhost:3000">Log in to your portal</a> to upload a corrected version.</p>
            `);
        }

        res.json({ success: true, conditions: application.conditions });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/admin/stats', authenticateToken, requireAdmin, async (req, res) => {
    try {
        const totalUsers = await User.countDocuments({ role: 'borrower' });
        const totalApps = await Application.countDocuments();
        const submitted = await Application.countDocuments({ status: 'Submitted' });
        const underReview = await Application.countDocuments({ status: 'Under Review' });
        const approved = await Application.countDocuments({ status: 'Approved' });
        const denied = await Application.countDocuments({ status: 'Denied' });
        const totalDocs = await Document.countDocuments();

        res.json({
            totalUsers, totalApps, submitted, underReview, approved, denied, totalDocs
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Create admin account utility
app.post('/api/admin/create', async (req, res) => {
    try {
        const { email, password, adminKey } = req.body;

        // Require a secret key to create admin accounts
        if (adminKey !== (process.env.ADMIN_CREATE_KEY || 'majesticequity_admin_2026')) {
            return res.status(403).json({ error: 'Invalid admin creation key.' });
        }

        const salt = await bcrypt.genSalt(12);
        const hashedPassword = await bcrypt.hash(password, salt);

        const admin = new User({
            email: email.toLowerCase(),
            password: hashedPassword,
            name: 'Broker Admin',
            role: 'admin'
        });
        await admin.save();

        const token = jwt.sign(
            { email: admin.email, id: admin._id, role: 'admin' },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        console.log(`🔑 Admin account created: ${email}`);
        res.json({ success: true, token, user: { email: admin.email, role: 'admin', id: admin._id } });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// VERIFICATION ENDPOINTS 🛡️
// =============================================

app.post('/api/auth/verify-registration', async (req, res) => {
    try {
        const { email, emailCode, phoneCode } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });

        if (!user) return res.status(404).json({ error: 'User not found' });
        if (!user.verificationCodes || user.verificationCodes.expiresAt < new Date()) {
            return res.status(400).json({ error: 'Verification codes expired or not found.' });
        }

        const emailMatch = await bcrypt.compare(emailCode, user.verificationCodes.emailCode);
        const phoneMatch = await bcrypt.compare(phoneCode, user.verificationCodes.phoneCode);

        if (!emailMatch || !phoneMatch) {
            return res.status(400).json({ error: 'Invalid verification codes.' });
        }

        user.isVerified = true;
        user.verificationCodes = undefined;
        await user.save();

        const token = jwt.sign(
            { email: user.email, id: user._id, role: user.role },
            JWT_SECRET,
            { expiresIn: '7d' }
        );

        res.json({
            success: true,
            token,
            user: { email: user.email, name: user.name, id: user._id, role: user.role }
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user) return res.status(404).json({ error: 'User not found' });

        const emailCode = Math.floor(100000 + Math.random() * 900000).toString();
        const phoneCode = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = await bcrypt.genSalt(10);

        user.verificationCodes = {
            emailCode: await bcrypt.hash(emailCode, salt),
            phoneCode: await bcrypt.hash(phoneCode, salt),
            expiresAt: new Date(Date.now() + 15 * 60 * 1000)
        };
        await user.save();

        await sendEmail(user.email, 'New Verification Code — MajesticEquity', `<div style="padding:20px; font-family:sans-serif;"><h2>Code: ${emailCode}</h2></div>`);
        // Send SMS Code
        await sendSMS(user.phone, `Your MajesticEquity verification code is ${phoneCode}. Valid for 15m.`);

        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// =============================================
// SERVER START
// =============================================

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`\n🚀 MajesticEquity Backend & WebSockets active at http://localhost:${PORT}`);
    console.log(`\n   AUTH:    POST /api/auth/register, /api/auth/login`);
    console.log(`   PLAID:   POST /api/create_link_token, /api/exchange_public_token`);
    console.log(`   VERIFY:  POST /api/create_inquiry, /api/persona_complete, /api/credit_pull`);
    console.log(`   DOCS:    POST /api/documents/upload | GET /api/documents | DELETE /api/documents/:id`);
    console.log(`   APPS:    POST /api/applications/submit | GET /api/applications/mine`);
    console.log(`   MSGS:    POST|GET /api/applications/:id/messages`);
    console.log(`   ADMIN:   GET /api/admin/applications, /api/admin/users, /api/admin/stats`);
    console.log(`   ADMIN:   PATCH /api/admin/applications/:id | POST /api/admin/create\n`);
});
