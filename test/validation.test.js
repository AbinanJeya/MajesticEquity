/**
 * Validation Middleware Unit Tests
 * Fix #8: Proper automated testing for input validation schemas.
 */
const { validate, registerSchema, loginSchema, agentRegisterSchema, creditPullSchema } = require('../middlewares/validation');

// Mock Express req/res/next
function mockReq(body) {
    return { body };
}

function mockRes() {
    const res = {};
    res.status = jest.fn().mockReturnValue(res);
    res.json = jest.fn().mockReturnValue(res);
    return res;
}

function mockNext() {
    return jest.fn();
}

describe('Validation Middleware', () => {
    describe('registerSchema', () => {
        it('should pass with valid registration data', () => {
            const req = mockReq({
                name: 'John Smith',
                email: 'john@test.com',
                phone: '4165551234',
                password: 'SecurePass123'
            });
            const res = mockRes();
            const next = mockNext();

            validate(registerSchema)(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
        });

        it('should reject missing email', () => {
            const req = mockReq({
                name: 'John Smith',
                phone: '4165551234',
                password: 'SecurePass123'
            });
            const res = mockRes();
            const next = mockNext();

            validate(registerSchema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should reject short password', () => {
            const req = mockReq({
                name: 'John Smith',
                email: 'john@test.com',
                phone: '4165551234',
                password: '123'
            });
            const res = mockRes();
            const next = mockNext();

            validate(registerSchema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should reject invalid email format', () => {
            const req = mockReq({
                name: 'John Smith',
                email: 'not-an-email',
                phone: '4165551234',
                password: 'SecurePass123'
            });
            const res = mockRes();
            const next = mockNext();

            validate(registerSchema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should strip unknown fields (NoSQL injection protection)', () => {
            const req = mockReq({
                name: 'John Smith',
                email: 'john@test.com',
                phone: '4165551234',
                password: 'SecurePass123',
                role: 'admin', // Injection attempt
                $gt: '' // NoSQL injection attempt
            });
            const res = mockRes();
            const next = mockNext();

            validate(registerSchema)(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(req.body.role).toBeUndefined();
            expect(req.body.$gt).toBeUndefined();
        });
    });

    describe('loginSchema', () => {
        it('should pass with valid login data', () => {
            const req = mockReq({ email: 'john@test.com', password: 'test1234' });
            const res = mockRes();
            const next = mockNext();

            validate(loginSchema)(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should normalize email to lowercase', () => {
            const req = mockReq({ email: 'JOHN@TEST.COM', password: 'test1234' });
            const res = mockRes();
            const next = mockNext();

            validate(loginSchema)(req, res, next);
            expect(next).toHaveBeenCalled();
            expect(req.body.email).toBe('john@test.com');
        });
    });

    describe('agentRegisterSchema', () => {
        const validAgent = {
            name: 'Jane Agent',
            email: 'jane@brokerage.com',
            phone: '4165559999',
            password: 'SecureAgent1',
            licenseNumber: 'M08001234',
            licenseClass: 'Mortgage Broker',
            brokerageName: 'Majestic Equity Partners',
            brokerageLicenseNumber: 'B12345',
            registryProfileUrl: 'https://www2.fsco.gov.on.ca/agent/12345'
        };

        it('should pass with valid agent data', () => {
            const req = mockReq(validAgent);
            const res = mockRes();
            const next = mockNext();

            validate(agentRegisterSchema)(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should reject invalid licence class', () => {
            const req = mockReq({ ...validAgent, licenseClass: 'Fake Class' });
            const res = mockRes();
            const next = mockNext();

            validate(agentRegisterSchema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('should reject non-HTTPS registry URL', () => {
            const req = mockReq({ ...validAgent, registryProfileUrl: 'http://fsco.gov.on.ca/agent' });
            const res = mockRes();
            const next = mockNext();

            validate(agentRegisterSchema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
        });
    });

    describe('creditPullSchema', () => {
        it('should pass with valid credit pull data', () => {
            const req = mockReq({
                ssn: '123456789',
                dob: '1990-05-15',
                addressLine1: '123 Main St',
                city: 'Toronto',
                state: 'ON',
                zip: 'M5V 2A1'
            });
            const res = mockRes();
            const next = mockNext();

            validate(creditPullSchema)(req, res, next);
            expect(next).toHaveBeenCalled();
        });

        it('should reject missing SSN', () => {
            const req = mockReq({
                dob: '1990-05-15',
                addressLine1: '123 Main St',
                city: 'Toronto',
                state: 'ON',
                zip: 'M5V'
            });
            const res = mockRes();
            const next = mockNext();

            validate(creditPullSchema)(req, res, next);
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });
});
