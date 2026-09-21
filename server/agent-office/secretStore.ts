import fs from 'node:fs/promises';
import path from 'node:path';

export interface SecretStore {
  get(reference: string): Promise<string | null>;
  set(reference: string, value: string): Promise<void>;
  delete(reference: string): Promise<void>;
}

export class DevelopmentSecretStore implements SecretStore {
  private readonly filePath: string;
  private loaded = false;
  private values = new Map<string, string>();

  constructor(dataDir: string) {
    this.filePath = path.join(path.resolve(dataDir), 'development-secrets.json');
  }

  private async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        if (typeof value === 'string') this.values.set(key, value);
      }
    } catch (error: any) {
      if (error?.code !== 'ENOENT') throw error;
    }
    this.loaded = true;
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp-${process.pid}`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(Object.fromEntries(this.values), null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(temporaryPath, 0o600);
    await fs.rename(temporaryPath, this.filePath);
    await fs.chmod(this.filePath, 0o600);
  }

  async get(reference: string): Promise<string | null> {
    await this.load();
    return this.values.get(reference) ?? null;
  }

  async set(reference: string, value: string): Promise<void> {
    if (!reference.trim()) throw new Error('SECRET_REFERENCE_REQUIRED');
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
  return `${value.slice(0, 4)}${'********'}${value.slice(-4)}`;
}
