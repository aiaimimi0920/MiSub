const ENVELOPE_FORMAT = 'misub-encrypted-backup';
const ENVELOPE_VERSION = 1;
const PBKDF2_ITERATIONS = 310000;
const AAD = new TextEncoder().encode('MiSub encrypted backup v1');

function encodeBase64(bytes) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

function decodeBase64(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt, usage, cryptoImpl) {
    if (!String(passphrase || '').trim()) throw new Error('Backup passphrase is required');
    const material = await cryptoImpl.subtle.importKey(
        'raw',
        new TextEncoder().encode(passphrase),
        'PBKDF2',
        false,
        ['deriveKey']
    );
    return cryptoImpl.subtle.deriveKey(
        { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
        material,
        { name: 'AES-GCM', length: 256 },
        false,
        [usage]
    );
}

export async function encryptBackupPayload(payload, passphrase, cryptoImpl = globalThis.crypto) {
    const salt = cryptoImpl.getRandomValues(new Uint8Array(16));
    const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
    const key = await deriveKey(passphrase, salt, 'encrypt', cryptoImpl);
    const plaintext = new TextEncoder().encode(JSON.stringify(payload));
    const ciphertext = await cryptoImpl.subtle.encrypt(
        { name: 'AES-GCM', iv, additionalData: AAD },
        key,
        plaintext
    );
    return {
        format: ENVELOPE_FORMAT,
        version: ENVELOPE_VERSION,
        kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: PBKDF2_ITERATIONS, salt: encodeBase64(salt) },
        cipher: { name: 'AES-GCM', iv: encodeBase64(iv) },
        ciphertext: encodeBase64(new Uint8Array(ciphertext))
    };
}

export async function decryptBackupPayload(envelope, passphrase, cryptoImpl = globalThis.crypto) {
    if (envelope?.format !== ENVELOPE_FORMAT || envelope?.version !== ENVELOPE_VERSION) {
        throw new Error('Unsupported encrypted backup format');
    }
    if (envelope.kdf?.iterations !== PBKDF2_ITERATIONS || envelope.kdf?.hash !== 'SHA-256') {
        throw new Error('Unsupported backup key derivation settings');
    }
    const salt = decodeBase64(envelope.kdf.salt);
    const iv = decodeBase64(envelope.cipher?.iv || '');
    if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encrypted backup parameters');
    const key = await deriveKey(passphrase, salt, 'decrypt', cryptoImpl);
    const plaintext = await cryptoImpl.subtle.decrypt(
        { name: 'AES-GCM', iv, additionalData: AAD },
        key,
        decodeBase64(envelope.ciphertext || '')
    );
    return JSON.parse(new TextDecoder().decode(plaintext));
}
