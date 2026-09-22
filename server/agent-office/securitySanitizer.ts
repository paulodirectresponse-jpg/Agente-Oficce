const SENSITIVE_KEY = /(authorization|api[-_]?key|token|secret|password|cookie|credential)/i;
const SENSITIVE_VALUE_PATTERNS: RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+\/-]{8,}/gi,
  /\bsk-[A-Za-z0-9_-]{8,}/gi,
  /\bAIza[A-Za-z0-9_-]{20,}/g,
];

function redactString(value: string): string {
  let result = value;
  for (const pattern of SENSITIVE_VALUE_PATTERNS) {
    result = result.replace(pattern, '[REDACTED]');
  }
  return result;
}

export function redactSecrets(value: unknown, keyHint = ''): unknown {
  if (SENSITIVE_KEY.test(keyHint)) return '[REDACTED]';
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(item => redactSecrets(item));
  if (value && typeof value === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      output[key] = redactSecrets(child, key);
    }
    return output;
  }
  return value;
}

export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(item => stableJson(item)).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}
