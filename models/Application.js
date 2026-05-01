const mongoose = require('mongoose');

const MessageSchema = new mongoose.Schema({
    sender: { type: String, required: true }, // email of sender
    senderName: { type: String, default: '' },
    senderRole: { type: String, enum: ['borrower', 'admin', 'agent'], default: 'borrower' },
    message: { type: String, required: true },
    isRead: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now }
});

const ApplicationSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    userEmail: {
        type: String,
        required: true
    },
    userName: {
        type: String,
        default: ''
    },
    status: {
        type: String,
        enum: ['Draft', 'Submitted', 'Under Review', 'Approved', 'Denied', 'Funded'],
        default: 'Draft'
    },
    loanAmount: { type: Number, default: 0 },
    propertyAddress: { type: String, default: '' },
    loanType: {
        type: String,
        enum: ['Purchase', 'Refinance', 'Renewal', 'Other'],
        default: 'Purchase'
    },
    // Verification milestones
    identityVerified: { type: Boolean, default: false },
    incomeVerified: { type: Boolean, default: false },
    verifiedIncome: { type: Number, default: 0 },
    incomeSource: { type: String, default: '' },
    assetsVerified: { type: Boolean, default: false },
    verifiedAssets: { type: Number, default: 0 },
    creditVerified: { type: Boolean, default: false },
    creditScore: { type: Number },

    // --- FULL 1003 FIELDS ---
    // Personal Info
    personalInfo: {
        phone: { type: String, default: '' },
        maritalStatus: { type: String, enum: ['Unmarried', 'Married', 'Separated', ''], default: '' },
        dependents: { type: Number, default: 0 }
    },
    // Subject Property
    propertyDetails: {
        propertyType: { type: String, enum: ['SingleFamily', 'Townhouse', 'Condo', 'MultiFamily', ''], default: '' },
        occupancyType: { type: String, enum: ['PrimaryResidence', 'SecondHome', 'Investment', ''], default: '' },
        purchasePrice: { type: Number, default: 0 },
        estimatedValue: { type: Number, default: 0 }
    },
    // Employment History (2 Years Required)
    employmentHistory: [{
        employerName: { type: String, required: true },
        title: { type: String, required: true },
        startDate: { type: String, required: true },
        endDate: { type: String, default: 'Present' }, // 'Present' if current
        monthlyIncome: { type: Number, required: true }
    }],
    // Residential History (2 Years Required)
    residentialHistory: [{
        address: { type: String, required: true },
        status: { type: String, enum: ['Rent', 'Own', 'LivingRentFree'] },
        monthlyPayment: { type: Number, default: 0 },
        startDate: { type: String, required: true },
        endDate: { type: String, default: 'Present' }
    }],
    // Assets & Liabilities (Manually collected)
    reo: [{
        address: { type: String },
        propertyValue: { type: Number },
        mortgageBalance: { type: Number },
        monthlyPayment: { type: Number },
        rentalIncome: { type: Number }
    }],
    // Legal Declarations
    declarations: {
        outstandingJudgments: { type: Boolean, default: false },
        bankruptcy: { type: Boolean, default: false },
        foreclosure: { type: Boolean, default: false },
        lawsuits: { type: Boolean, default: false },
        usCitizen: { type: Boolean, default: true }
    },
    // Demographics (HMDA)
    demographics: {
        ethnicity: { type: String, default: 'DoNotWishToProvide' },
        race: { type: String, default: 'DoNotWishToProvide' },
        sex: { type: String, default: 'DoNotWishToProvide' }
    },

    // Dynamic Conditions (Needs List)
    conditions: [{
        name: { type: String, required: true },
        status: { type: String, enum: ['Pending', 'Uploaded', 'Accepted', 'Rejected'], default: 'Pending' },
        documentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Document' },
        brokerNote: { type: String, default: '' },
        createdAt: { type: Date, default: Date.now }
    }],

    // Documents linked
    documents: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Document' }],

    // Messaging
    messages: [MessageSchema],

    // Admin
    assignedAgentId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    assignedBroker: { type: String, default: '' },
    adminNotes: { type: String, default: '' },

    // Payment & Processing Status
    paymentStatus: { type: String, enum: ['Pending', 'Paid', 'Refunded'], default: 'Pending' },
    statusHistory: [{
        status: { type: String },
        note: { type: String },
        updatedAt: { type: Date, default: Date.now }
    }],

    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
});

ApplicationSchema.pre('save', function() {
    this.updatedAt = Date.now();
});

module.exports = mongoose.model('Application', ApplicationSchema);
