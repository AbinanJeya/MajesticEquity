const mongoose = require('mongoose');

const UserSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        default: ''
    },
    phone: {
        type: String,
        default: ''
    },
    name: {
        type: String,
        default: ''
    },
    role: {
        type: String,
        enum: ['borrower', 'admin', 'agent'],
        default: 'borrower'
    },
    // Agent-specific professional data 🏦
    nmlsId: { type: String },
    brokerageName: { type: String },
    licenseState: { type: String },
    currentStep: { type: Number, default: 1 },
    status: { type: String, default: 'In Progress' },
    identityStatus: { type: String, default: 'Not Started' },
    personaInquiryId: { type: String },
    
    // Identity data needed for true credit pull
    ssn: { type: String },
    dob: { type: Date },
    addressLine1: { type: String },
    city: { type: String },
    state: { type: String },
    zip: { type: String },

    creditScore: { type: Number },
    creditReportId: { type: String },
    
    // MFA / Security Pillar 🔐
    mfaEnabled: { type: Boolean, default: false },
    mfaType: { 
        type: String, 
        enum: ['email', 'totp', 'none'], 
        default: 'none' 
    },
    mfaSecret: { type: String }, // For Google Authenticator (TOTP)
    mfaCode: { type: String },   // Hashed 6-digit code (For Email)
    mfaExpiresAt: { type: Date },

    // Registration Verification 🛡️
    isVerified: { type: Boolean, default: false },
    verificationCodes: {
        emailCode: String,
        phoneCode: String,
        expiresAt: Date
    },

    createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
