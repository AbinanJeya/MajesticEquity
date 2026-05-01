const crypto = require('crypto');

function normalizeId(value) {
    if (!value) return '';
    return value.toString();
}

function isApprovedAgentProfile(agentProfile) {
    return !!agentProfile && agentProfile.verificationStatus === 'approved';
}

function canAgentInviteBorrower(user) {
    return !!user &&
        user.role === 'agent' &&
        user.agentProfile?.jurisdiction === 'CA-ON' &&
        isApprovedAgentProfile(user.agentProfile);
}

function hashInviteToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function isInviteUsable(invite, now = new Date()) {
    return !!invite &&
        invite.status === 'active' &&
        invite.expiresAt &&
        new Date(invite.expiresAt) > now;
}

function isAssignedApprovedAgent(user, application) {
    return !!user &&
        !!application &&
        user.role === 'agent' &&
        isApprovedAgentProfile(user.agentProfile) &&
        normalizeId(application.assignedAgentId) === normalizeId(user.id);
}

function canAccessApplication(user, application) {
    if (!user || !application) return false;
    if (user.role === 'admin') return true;
    if (application.userEmail && user.email && application.userEmail.toLowerCase() === user.email.toLowerCase()) {
        return true;
    }
    return isAssignedApprovedAgent(user, application);
}

function canMessageApplication(user, application) {
    return canAccessApplication(user, application);
}

module.exports = {
    canAccessApplication,
    canAgentInviteBorrower,
    canMessageApplication,
    hashInviteToken,
    isApprovedAgentProfile,
    isInviteUsable
};
