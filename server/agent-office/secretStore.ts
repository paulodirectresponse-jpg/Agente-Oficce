import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export interface SecretStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

interface EncryptedEnvelope {
  version: 1;
  iv: string;
  tag: string;
  ciphertext: string;
}

async function ensurePrivateFile(filePath: string): Promise<void> {
  try {
    await fs.chmod(filePath, 0o600);
  } catch {
    // Windows ACLs are managed by the user profile; chmod is best-effort there.
  }
}

export class EncryptedFileSecretStore implements SecretStore {
  private readonly filePath: string;
  private readonly keyPath: string;
  private readonly legacyPath: string;
  private loaded = false;
  private key: Buffer | null = null;
  private values = new Map<string, string>();

  constructor(dataDir: string) {
    const root = path.resolve(dataDir);
    this.filePath = path.join(root, 'secrets.enc.json');
    this.keyPath = path.join(root, 'secrets.master.key');
    this.legacyPath = path.join(root, 'development-secrets.json');
  }

  private async loadKey(): Promise<Buffer> {
    if (this.key) return this.key;
    await fs.mkdir(path.dirname(this.keyPath), { recursive: true });
    try {
      const raw = (await fs.readFile(this.keyPath, 'utf8')).trim();
      const key = Buffer.from(raw, 'base64');
      if (key.length !== 32) throw new Error('SECRET_KEY_INVALID');
      this.key = key;
      return key;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }

    const key = crypto.randomBytes(32);
    const temp = `${this.keyPath}.tmp-${process.pid}`;
    await fs.writeFile(temp, `${key.toString('base64')}\n`, { mode: 0o600 });
    await ensurePrivateFile(temp);
    await fs.rename(temp, this.keyPath);
    await ensurePrivateFile(this.keyPath);
    this.key = key;
    return key;
  }

  private decrypt(envelope: EncryptedEnvelope, key: Buffer): Record<string, string> {
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    const parsed = JSON.parse(plaintext) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
    );
  }

  private encrypt(values: Record<string, string>, key: Buffer): EncryptedEnvelope {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(values), 'utf8'),
      cipher.final(),
    ]);
    return {
      version: 1,
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      ciphertext: ciphertext.toString('base64'),
    };
  }

  private async migrateLegacyIfPresent(): Promise<boolean> {
    try {
      const raw = await fs.readFile(this.legacyPath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') this.values.set(key, value);
      }
      await this.persist();
      await fs.rename(this.legacyPath, `${this.legacyPath}.migrated`).catch(() => fs.rm(this.legacyPath, { force: true }));
      return true;
    } catch (error: any) {
      if (error?.code === 'ENOENT') return false;
      throw error;
    }
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    const key = await this.loadKey();
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const envelope = JSON.parse(raw) as EncryptedEnvelope;
      if (envelope.version !== 1) throw new Error('SECRET_ENVELOPE_VERSION_UNSUPPORTED');
      const values = this.decrypt(envelope, key);
      this.values = new Map(Object.entries(values));
      this.loaded = true;
      return;
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }

    this.loaded = true;
    await this.migrateLegacyIfPresent();
  }

  private async persist(): Promise<void> {
    const key = await this.loadKey();
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    const envelope = this.encrypt(Object.fromEntries(this.values), key);
    await fs.writeFile(temporaryPath, `${JSON.stringify(envelope)}\n`, { mode: 0o600 });
    await ensurePrivateFile(temporaryPath);
    await fs.rename(temporaryPath, this.filePath);
    await ensurePrivateFile(this.filePath);
  }

  async get(reference: string): Promise<string | null> {
    await this.load();
    return this.values.get(reference) ?? null;
  }

  async set(reference: string, value: string): Promise<void> {
    if (!reference.trim()) throw new Error('SECRET_REFERENCE_REQUIRED');
    if (!value) throw new Error('SECRET_VALUE_REQUIRED');
    await this.load();
    this.values.set(reference, value);
    await this.persist();
  }

  async delete(reference: string): Promise<void> {
    await this.load();
    this.values.delete(reference);
    await this.persist();
  }
}

// Backwards-compatible name. New writes are encrypted and old plaintext files are migrated.
export class DevelopmentSecretStore extends EncryptedFileSecretStore {}

export class SystemSecretStore implements SecretStore {
  private unavailable(): never {
    throw new Error('SYSTEM_SECRET_STORE_UNAVAILABLE');
  }

  async get(_reference: string): Promise<string | null> { return this.unavailable(); }
  async set(_reference: string, _value: string): Promise<void> { this.unavailable(); }
  async delete(_reference: string): Promise<void> { this.unavailable(); }
}

export function maskSecret(value: string | null | undefined): string | null {
  if (!value) return value ?? null;
  if (value.length <= 8) return '********';
  return `${value.slice(0, 4)}********${value.slice(-4)}`;
}
