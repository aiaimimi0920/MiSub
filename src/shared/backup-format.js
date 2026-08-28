export const BACKUP_FORMAT = 'misub-logical-backup';
export const BACKUP_FORMAT_VERSION = 1;
export const DATABASE_SCHEMA_VERSION = 2;

function sortForCanonicalJSON(value) {
    if (Array.isArray(value)) return value.map(sortForCanonicalJSON);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, sortForCanonicalJSON(value[key])])
    );
}

export function canonicalJSONStringify(value) {
    return JSON.stringify(sortForCanonicalJSON(value));
}

export async function sha256Hex(value, cryptoImpl = globalThis.crypto) {
    const bytes = new TextEncoder().encode(value);
    const digest = await cryptoImpl.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function verifyLogicalBackup(backup, cryptoImpl = globalThis.crypto) {
    if (backup?.format !== BACKUP_FORMAT || backup?.formatVersion !== BACKUP_FORMAT_VERSION) {
        throw new Error('Unsupported MiSub backup format');
    }
    if (!backup.data || !Array.isArray(backup.data.sources) || !Array.isArray(backup.data.profiles)) {
        throw new Error('MiSub backup is missing required data');
    }
    const expected = await sha256Hex(canonicalJSONStringify(backup.data), cryptoImpl);
    if (backup.integrity?.canonicalDataSha256 !== expected) {
        throw new Error('MiSub backup checksum mismatch');
    }
    return true;
}
