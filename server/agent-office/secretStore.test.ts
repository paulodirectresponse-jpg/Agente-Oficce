import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DevelopmentSecretStore } from './secretStore.js';

describe('EncryptedFileSecretStore', () => {
  it('stores secrets encrypted at rest and reads them back', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-secrets-'));
    try {
      const store = new DevelopmentSecretStore(dataDir);
      await store.set('provider-key', 'super-secret-value');
      expect(await store.get('provider-key')).toBe('super-secret-value');

      const encrypted = await fsp.readFile(path.join(dataDir, 'secrets.enc.json'), 'utf8');
      expect(encrypted).not.toContain('super-secret-value');
      expect(encrypted).toContain('ciphertext');

      const key = (await fsp.readFile(path.join(dataDir, 'secrets.master.key'), 'utf8')).trim();
      expect(Buffer.from(key, 'base64')).toHaveLength(32);

      await store.delete('provider-key');
      expect(await store.get('provider-key')).toBeNull();
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });

  it('migrates the legacy plaintext secret file once', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-office-secrets-migrate-'));
    try {
      await fsp.writeFile(
        path.join(dataDir, 'development-secrets.json'),
        JSON.stringify({ legacy: 'legacy-secret' }),
      );
      const store = new DevelopmentSecretStore(dataDir);
      expect(await store.get('legacy')).toBe('legacy-secret');
      expect(fs.existsSync(path.join(dataDir, 'secrets.enc.json'))).toBe(true);
      expect(fs.existsSync(path.join(dataDir, 'development-secrets.json'))).toBe(false);
      const encrypted = await fsp.readFile(path.join(dataDir, 'secrets.enc.json'), 'utf8');
      expect(encrypted).not.toContain('legacy-secret');
    } finally {
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
