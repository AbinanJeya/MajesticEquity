/**
 * Authentication & Authorization Middlewares
 * Fix #3: Extracted from server.js monolith for modularity and testability.
 */
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const AgentProfile = require('../models/AgentProfile');
const { canAgentInviteBorrower } = require('../utils/agentNetwork');

const JWT_SECRET = process.env.JWT_SECRET || 'majesticequity_dev_secret_2026';

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

/**
 * Global error handler middleware.
 * Catches unhandled errors in route handlers and returns a clean JSON response.
 */
function errorHandler(err, req, res, _next) {
    const { logger } = require('../services/logger');
    logger.captureError(err, { path: req.path, method: req.method, userId: req.userId });

    const statusCode = err.statusCode || 500;
    res.status(statusCode).json({
        error: process.env.NODE_ENV === 'production'
            ? 'An unexpected error occurred.'
            : err.message
    });
}

module.exports = {
    authenticateToken,
    requireAdmin,
    getAgentProfileForUser,
    buildAccessUser,
    requireApprovedAgent,
    errorHandler,
    JWT_SECRET
};
