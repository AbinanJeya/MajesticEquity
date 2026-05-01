const crypto = require('crypto');

const OFFICIAL_REGISTRY_HOSTS = new Set([
    'fsrao.ca',
    'www.fsrao.ca',
    'www2.fsco.gov.on.ca',
    'mbsweblist.fsco.gov.on.ca'
]);

const ACTIVE_SIGNALS = [
    'active',
    'licensed',
    'licenced',
    'authorized',
    'authorised',
    'good standing'
];

const RISK_SIGNALS = [
    'suspended',
    'revoked',
    'terminated',
    'expired',
    'inactive',
    'refused',
    'cancelled',
    'not licensed',
    'not licenced',
    'discipline',
    'enforcement'
];

function normalizeText(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&nbsp;/g, ' ')
        .replace(/<script[\s\S]*?<\/script>/gi, ' ')
        .replace(/<style[\s\S]*?<\/style>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/[^a-z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function compact(value) {
    return normalizeText(value).replace(/\s+/g, '');
}

function containsLoose(haystack, needle) {
    if (!needle) return true;
    return compact(haystack).includes(compact(needle));
}

function evidenceHash(sourceText) {
    return crypto.createHash('sha256').update(String(sourceText || '')).digest('hex');
}

function isOfficialRegistryUrl(value) {
    try {
        const url = new URL(value);
        return url.protocol === 'https:' && OFFICIAL_REGISTRY_HOSTS.has(url.hostname.toLowerCase());
    } catch (error) {
        return false;
    }
}

function buildAutomatedVerification(profile, registryText, now = new Date()) {
    const text = normalizeText(registryText);
    const failures = [];
    const statusSignals = [];

    if (!isOfficialRegistryUrl(profile.registryProfileUrl)) {
        failures.push('Registry URL must be an official FSRA or FSCO HTTPS URL.');
    }

    const matchedName = containsLoose(text, profile.name);
    const matchedLicenseNumber = containsLoose(text, profile.licenseNumber);
    const matchedLicenseClass = containsLoose(text, profile.licenseClass);
    const matchedBrokerageName = containsLoose(text, profile.brokerageName);
    const matchedBrokerageLicenseNumber = containsLoose(text, profile.brokerageLicenseNumber);

    if (!matchedName) failures.push('Agent legal name was not found on the registry page.');
    if (!matchedLicenseNumber) failures.push('FSRA licence number was not found on the registry page.');
    if (!matchedLicenseClass) failures.push('Licence class was not found on the registry page.');
    if (!matchedBrokerageName) failures.push('Brokerage name was not found on the registry page.');
    if (profile.brokerageLicenseNumber && !matchedBrokerageLicenseNumber) {
        failures.push('Brokerage licence number was not found on the registry page.');
    }

    const activeSignal = ACTIVE_SIGNALS.find(signal => text.includes(signal));
    if (activeSignal) statusSignals.push(activeSignal);
    if (!activeSignal) {
        failures.push('Registry page does not clearly show an active/licensed status.');
    }

    RISK_SIGNALS.forEach(signal => {
        if (text.includes(signal)) {
            statusSignals.push(signal);
            failures.push(`Registry page contains risk status signal: ${signal}.`);
        }
    });

    return {
        status: failures.length === 0 ? 'passed' : 'failed',
        checkedAt: now,
        sourceUrl: profile.registryProfileUrl || '',
        sourceHost: profile.registryProfileUrl ? new URL(profile.registryProfileUrl).hostname.toLowerCase() : '',
        evidenceHash: evidenceHash(registryText),
        matchedName,
        matchedLicenseNumber,
        matchedLicenseClass,
        matchedBrokerageName,
        matchedBrokerageLicenseNumber,
        statusSignals,
        failures
    };
}

async function fetchOfficialRegistryText(registryProfileUrl, fetchImpl = fetch) {
    if (!isOfficialRegistryUrl(registryProfileUrl)) {
        throw new Error('Registry URL must be an official FSRA or FSCO HTTPS URL.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
        const response = await fetchImpl(registryProfileUrl, {
            headers: {
                'User-Agent': 'MajesticEquity-AgentVerification/1.0',
                'Accept': 'text/html,text/plain'
            },
            signal: controller.signal
        });
        if (!response.ok) {
            throw new Error(`Registry returned HTTP ${response.status}.`);
        }
        return response.text();
    } finally {
        clearTimeout(timeout);
    }
}

async function verifyAgentAgainstOfficialRegistry(profile, fetchImpl = fetch) {
    try {
        const registryText = await fetchOfficialRegistryText(profile.registryProfileUrl, fetchImpl);
        return buildAutomatedVerification(profile, registryText);
    } catch (error) {
        return {
            status: 'unavailable',
            checkedAt: new Date(),
            sourceUrl: profile.registryProfileUrl || '',
            sourceHost: '',
            evidenceHash: '',
            matchedName: false,
            matchedLicenseNumber: false,
            matchedLicenseClass: false,
            matchedBrokerageName: false,
            matchedBrokerageLicenseNumber: false,
            statusSignals: [],
            failures: [error.message]
        };
    }
}

module.exports = {
    buildAutomatedVerification,
    fetchOfficialRegistryText,
    isOfficialRegistryUrl,
    verifyAgentAgainstOfficialRegistry
};
