const mongoose = require('mongoose');

const AgentInviteSchema = new mongoose.Schema({
    agentId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    tokenHash: {
        type: String,
        required: true,
        unique: true
    },
    borrowerEmail: { type: String, default: '', trim: true, lowercase: true },
    borrowerName: { type: String, default: '', trim: true },
    status: {
        type: String,
        enum: ['active', 'used', 'expired', 'revoked'],
        default: 'active'
    },
    expiresAt: {
        type: Date,
        required: true
    },
    usedBorrowerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    usedApplicationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Application' },
    usedAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('AgentInvite', AgentInviteSchema);
