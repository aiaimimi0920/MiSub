import { webcrypto } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { decryptBackupPayload, encryptBackupPayload } from '../../src/shared/backup-crypto.js';

describe('encrypted backup envelope', () => {
    it('round-trips without exposing the plaintext secret', async () => {
        const payload = { data: { settings: { cronSecret: 'test-secret-value' } } };
        const envelope = await encryptBackupPayload(payload, 'correct horse battery staple', webcrypto);

        expect(JSON.stringify(envelope)).not.toContain('test-secret-value');
        await expect(decryptBackupPayload(envelope, 'correct horse battery staple', webcrypto)).resolves.toEqual(payload);
    });

    it('rejects the wrong passphrase and modified ciphertext', async () => {
        const envelope = await encryptBackupPayload({ value: 1 }, 'right-passphrase', webcrypto);
        await expect(decryptBackupPayload(envelope, 'wrong-passphrase', webcrypto)).rejects.toThrow();

        const tampered = structuredClone(envelope);
        tampered.ciphertext = tampered.ciphertext.slice(0, -2) + 'AA';
        await expect(decryptBackupPayload(tampered, 'right-passphrase', webcrypto)).rejects.toThrow();
    });
});
