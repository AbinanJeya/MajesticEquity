/**
 * Input Validation Schemas (Joi)
 * Fix #6: Replaces fragile manual if-checks with strict schema validation.
 * Prevents NoSQL injection, dirty data, and edge-case crashes.
 */
const Joi = require('joi');

// =============================================
// AUTH SCHEMAS
// =============================================

const registerSchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required()
        .messages({ 'string.min': 'Name must be at least 2 characters.' }),
    email: Joi.string().email().trim().lowercase().required(),
    phone: Joi.string().trim().min(10).max(20).required()
        .messages({ 'string.min': 'Phone number must be at least 10 digits.' }),
    password: Joi.string().min(8).max(128).required()
        .messages({ 'string.min': 'Password must be at least 8 characters.' }),
    inviteToken: Joi.string().optional().allow('')
});

const loginSchema = Joi.object({
    email: Joi.string().email().trim().lowercase().required(),
    password: Joi.string().min(1).required()
});

const agentRegisterSchema = Joi.object({
    name: Joi.string().trim().min(2).max(100).required(),
    email: Joi.string().email().trim().lowercase().required(),
    phone: Joi.string().trim().min(10).max(20).required(),
    password: Joi.string().min(8).max(128).required(),
    licenseNumber: Joi.string().trim().min(3).max(50).required()
        .messages({ 'string.min': 'FSRA Licence # is required.' }),
    licenseClass: Joi.string().valid(
        'Mortgage Agent Level 1',
        'Mortgage Agent Level 2',
        'Mortgage Broker',
        'Principal Broker'
    ).required(),
    brokerageName: Joi.string().trim().min(2).max(200).required(),
    brokerageLicenseNumber: Joi.string().trim().min(1).max(50).required(),
    registryProfileUrl: Joi.string().uri({ scheme: ['https'] }).required()
        .messages({ 'string.uri': 'Registry URL must be a valid HTTPS URL.' })
});

const mfaVerifySchema = Joi.object({
    email: Joi.string().email().trim().lowercase().required(),
    code: Joi.string().min(4).max(8).required()
});

const verifyRegistrationSchema = Joi.object({
    email: Joi.string().email().trim().lowercase().required(),
    emailCode: Joi.string().length(6).required()
        .messages({ 'string.length': 'Email code must be 6 digits.' }),
    phoneCode: Joi.string().length(6).required()
        .messages({ 'string.length': 'Phone code must be 6 digits.' })
});

// =============================================
// APPLICATION SCHEMAS
// =============================================

const applicationSubmitSchema = Joi.object({
    loanAmount: Joi.number().min(0).max(50000000).optional(),
    propertyAddress: Joi.string().trim().max(500).optional().allow(''),
    loanType: Joi.string().valid('Purchase', 'Refinance', 'Renewal', 'Other').optional(),
    personalInfo: Joi.object().optional(),
    propertyDetails: Joi.object().optional(),
    employmentHistory: Joi.array().items(Joi.object()).optional(),
    residentialHistory: Joi.array().items(Joi.object()).optional(),
    reo: Joi.array().items(Joi.object()).optional(),
    declarations: Joi.object().optional(),
    demographics: Joi.object().optional()
}).options({ allowUnknown: false });

const creditPullSchema = Joi.object({
    ssn: Joi.string().trim().min(9).max(11).required(),
    dob: Joi.string().isoDate().required(),
    addressLine1: Joi.string().trim().min(5).max(200).required(),
    city: Joi.string().trim().min(2).max(100).required(),
    state: Joi.string().trim().min(2).max(50).required(),
    zip: Joi.string().trim().min(3).max(10).required()
});

const messageSchema = Joi.object({
    message: Joi.string().trim().min(1).max(5000).optional(),
    text: Joi.string().trim().min(1).max(5000).optional()
}).or('message', 'text');

// =============================================
// AGENT SCHEMAS
// =============================================

const agentInviteSchema = Joi.object({
    borrowerEmail: Joi.string().email().trim().lowercase().optional().allow(''),
    borrowerName: Joi.string().trim().max(100).optional().allow('')
});

const adminAgentStatusSchema = Joi.object({
    status: Joi.string().valid('approved', 'rejected', 'suspended').required(),
    reviewNotes: Joi.string().max(2000).optional().allow(''),
    rejectionReason: Joi.string().max(2000).optional().allow('')
});

// =============================================
// VALIDATION MIDDLEWARE FACTORY
// =============================================

/**
 * Express middleware that validates req.body against a Joi schema.
 * Returns 400 with a clean error message if validation fails.
 */
function validate(schema) {
    return (req, res, next) => {
        const { error, value } = schema.validate(req.body, {
            abortEarly: false,
            stripUnknown: true
        });

        if (error) {
            const messages = error.details.map(d => d.message).join('. ');
            return res.status(400).json({ error: messages });
        }

        req.body = value; // Replace with sanitized/validated data
        next();
    };
}

module.exports = {
    validate,
    registerSchema,
    loginSchema,
    agentRegisterSchema,
    mfaVerifySchema,
    verifyRegistrationSchema,
    applicationSubmitSchema,
    creditPullSchema,
    messageSchema,
    agentInviteSchema,
    adminAgentStatusSchema
};
