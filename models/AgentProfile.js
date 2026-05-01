const mongoose = require('mongoose');

const AgentProfileSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    jurisdiction: {
        type: String,
        enum: ['CA-ON'],
        default: 'CA-ON'
    },
    licenseNumber: { type: String, required: true, trim: true },
    licenseClass: {
        type: String,
        enum: ['Mortgage Agent Level 1', 'Mortgage Agent Level 2', 'Mortgage Broker', 'Principal Broker'],
        required: true
    },
    brokerageName: { type: String, required: true, trim: true },
    brokerageLicenseNumber: { type: String, default: '', trim: true },
    registryProfileUrl: { type: String, default: '', trim: true },
    verificationStatus: {
        type: String,
        enum: ['pending_review', 'approved', 'rejected', 'suspended'],
        default: 'pending_review'
    },
    automatedVerification: {
        status: {
            type: String,
            enum: ['unchecked', 'passed', 'failed', 'unavailable'],
            default: 'unchecked'
        },
        checkedAt: { type: Date },
        sourceUrl: { type: String, default: '' },
        sourceHost: { type: String, default: '' },
        evidenceHash: { type: String, default: '' },
        matchedName: { type: Boolean, default: false },
        matchedLicenseNumber: { type: Boolean, default: false },
        matchedLicenseClass: { type: Boolean, default: false },
        matchedBrokerageName: { type: Boolean, default: false },
        matchedBrokerageLicenseNumber: { type: Boolean, default: false },
        statusSignals: [{ type: String }],
        failures: [{ type: String }]
    },
    verifiedAt: { type: Date },
    verifiedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    lastCheckedAt: { type: Date },
    rejectionReason: { type: String, default: '' },
    reviewNotes: { type: String, default: '' }
}, { timestamps: true });

module.exports = mongoose.model('AgentProfile', AgentProfileSchema);
