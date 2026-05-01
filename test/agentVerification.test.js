const assert = require('node:assert/strict');
const test = require('node:test');

const {
    buildAutomatedVerification,
    isOfficialRegistryUrl
} = require('../utils/agentVerification');

const profile = {
    name: 'Jane Smith',
    licenseNumber: 'M08001234',
    licenseClass: 'Mortgage Agent Level 2',
    brokerageName: 'Majestic Equity Partners',
    brokerageLicenseNumber: '13001',
    registryProfileUrl: 'https://www2.fsco.gov.on.ca/mbslist/Agents.mbl?id=M08001234'
};

test('accepts only official FSRA or FSCO registry URLs', () => {
    assert.equal(isOfficialRegistryUrl('https://www.fsrao.ca/licensed-mortgage-brokerages-administrators-mortgage-agents-and-mortgage-brokers'), true);
    assert.equal(isOfficialRegistryUrl('https://www2.fsco.gov.on.ca/mbslist/Agents.mbl?id=M08001234'), true);
    assert.equal(isOfficialRegistryUrl('https://example.com/fake-fsra-profile'), false);
    assert.equal(isOfficialRegistryUrl('javascript:alert(1)'), false);
});

test('passes when official registry text contains all required active licence facts', () => {
    const result = buildAutomatedVerification(profile, `
        Jane Smith
        Licence Number M08001234
        Mortgage Agent Level 2
        Majestic Equity Partners
        Brokerage Licence 13001
        Status Active
        Licensed to conduct mortgage business in Ontario
    `);

    assert.equal(result.status, 'passed');
    assert.deepEqual(result.failures, []);
    assert.equal(result.matchedName, true);
    assert.equal(result.matchedLicenseNumber, true);
    assert.equal(result.matchedLicenseClass, true);
    assert.equal(result.matchedBrokerageName, true);
    assert.equal(result.matchedBrokerageLicenseNumber, true);
});

test('fails closed when status signals are missing', () => {
    const result = buildAutomatedVerification(profile, `
        Jane Smith
        Licence Number M08001234
        Mortgage Agent Level 2
        Majestic Equity Partners
        Brokerage Licence 13001
    `);

    assert.equal(result.status, 'failed');
    assert.ok(result.failures.includes('Registry page does not clearly show an active/licensed status.'));
});

test('fails closed when registry page contains risk status words', () => {
    const result = buildAutomatedVerification(profile, `
        Jane Smith
        Licence Number M08001234
        Mortgage Agent Level 2
        Majestic Equity Partners
        Brokerage Licence 13001
        Status Suspended
    `);

    assert.equal(result.status, 'failed');
    assert.ok(result.failures.some(failure => failure.includes('suspended')));
});

test('fails when submitted brokerage does not match registry text', () => {
    const result = buildAutomatedVerification(profile, `
        Jane Smith
        Licence Number M08001234
        Mortgage Agent Level 2
        Other Brokerage Inc.
        Brokerage Licence 13001
        Status Active
    `);

    assert.equal(result.status, 'failed');
    assert.ok(result.failures.includes('Brokerage name was not found on the registry page.'));
});
