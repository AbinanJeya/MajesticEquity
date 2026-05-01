const assert = require('node:assert/strict');
const test = require('node:test');

const {
    canAgentInviteBorrower,
    canAccessApplication,
    canMessageApplication,
    hashInviteToken,
    isInviteUsable
} = require('../utils/agentNetwork');

test('only approved Ontario agents can create borrower invites', () => {
    assert.equal(canAgentInviteBorrower({
        role: 'agent',
        agentProfile: { jurisdiction: 'CA-ON', verificationStatus: 'approved' }
    }), true);

    assert.equal(canAgentInviteBorrower({
        role: 'agent',
        agentProfile: { jurisdiction: 'CA-ON', verificationStatus: 'pending_review' }
    }), false);

    assert.equal(canAgentInviteBorrower({
        role: 'admin',
        agentProfile: { jurisdiction: 'CA-ON', verificationStatus: 'approved' }
    }), false);
});

test('invite tokens are stored as deterministic hashes, not raw tokens', () => {
    const token = 'plain-invite-token';
    const hash = hashInviteToken(token);

    assert.notEqual(hash, token);
    assert.equal(hashInviteToken(token), hash);
});

test('invite is usable only when active and unexpired', () => {
    const future = new Date(Date.now() + 60_000);
    const past = new Date(Date.now() - 60_000);

    assert.equal(isInviteUsable({ status: 'active', expiresAt: future }), true);
    assert.equal(isInviteUsable({ status: 'used', expiresAt: future }), false);
    assert.equal(isInviteUsable({ status: 'active', expiresAt: past }), false);
});

test('application access is limited to admin, borrower owner, and assigned approved agent', () => {
    const application = {
        userEmail: 'borrower@example.com',
        assignedAgentId: 'agent-1'
    };

    assert.equal(canAccessApplication({ role: 'admin', email: 'admin@example.com' }, application), true);
    assert.equal(canAccessApplication({ role: 'borrower', email: 'borrower@example.com' }, application), true);
    assert.equal(canAccessApplication({
        role: 'agent',
        id: 'agent-1',
        agentProfile: { verificationStatus: 'approved' }
    }, application), true);
    assert.equal(canAccessApplication({
        role: 'agent',
        id: 'agent-2',
        agentProfile: { verificationStatus: 'approved' }
    }, application), false);
    assert.equal(canAccessApplication({
        role: 'agent',
        id: 'agent-1',
        agentProfile: { verificationStatus: 'pending_review' }
    }, application), false);
});

test('message permission follows application access rules', () => {
    const application = {
        userEmail: 'borrower@example.com',
        assignedAgentId: 'agent-1'
    };

    assert.equal(canMessageApplication({
        role: 'agent',
        id: 'agent-1',
        agentProfile: { verificationStatus: 'approved' }
    }, application), true);
    assert.equal(canMessageApplication({
        role: 'agent',
        id: 'agent-1',
        agentProfile: { verificationStatus: 'suspended' }
    }, application), false);
});
