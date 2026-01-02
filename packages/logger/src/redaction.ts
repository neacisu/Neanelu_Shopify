type JsonValue = null | boolean | number | string | JsonObject | JsonValue[];
interface JsonObject {
  [key: string]: JsonValue;
}

export type RedactionMode = 'development' | 'staging' | 'production' | 'test';

const SENSITIVE_KEY_REGEX =
  /(password|secret|token|authorization|cookie|api[_-]?key|api[_-]?secret|access[_-]?token|refresh[_-]?token)/i;

export function redactDeep(value: unknown, mode: RedactionMode): unknown {
  return redactDeepInternal(value, mode, undefined);
}

function redactDeepInternal(value: unknown, mode: RedactionMode, key: string | undefined): unknown {
  if (value == null) return value;
  if (typeof value === 'string') {
    if (key && SENSITIVE_KEY_REGEX.test(key)) {
      return '[REDACTED_TOKEN]';
    }
    return redactStringValue(value, mode);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (value instanceof Error) {
    const stack = typeof value.stack === 'string' ? value.stack : undefined;
    const out: JsonObject = {
      code: 'ERROR',
      message: value.message,
    };
    if (stack) {
      out['stack'] = truncateStack(stack, mode);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactDeepInternal(item, mode, key));
  }
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (SENSITIVE_KEY_REGEX.test(k)) {
        out[k] = '[REDACTED_TOKEN]';
        continue;
      }
      if (k === 'stack' && typeof v === 'string') {
        out[k] = truncateStack(v, mode);
        continue;
      }
      out[k] = redactDeepInternal(v, mode, k);
    }
    return out;
  }
  return value;
}

function truncateStack(stack: string, mode: RedactionMode): string {
  if (mode !== 'production') return stack;
  const lines = stack.split('\n');
  return lines.slice(0, 3).join('\n');
}

function redactStringValue(input: string, _mode: RedactionMode): string {
  const value = input.trim();
  if (!value) return input;

  // Email
  const emailMatch = /^([^@\s]+)@([^@\s]+)$/.exec(value);
  if (emailMatch) {
    const local = emailMatch[1] ?? '';
    const domain = emailMatch[2] ?? '';
    const tld = domain.split('.').pop() ?? 'com';
    const firstChar = local.slice(0, 1) || 'x';
    return `${firstChar}***@***.${tld}`;
  }

  // Phone-ish (very lenient): +digits or digits with separators
  const digits = value.replace(/\D/g, '');
  if ((value.startsWith('+') || digits.length >= 10) && digits.length >= 10) {
    const prefix = value.startsWith('+') ? `+${digits.slice(0, 2)}` : digits.slice(0, 2);
    const last2 = digits.slice(-2);
    return `${prefix}***...${last2}`;
  }

  // API key-ish: long opaque strings
  if (/^[A-Za-z0-9_-]{16,}$/.test(value)) {
    const first4 = value.slice(0, 4);
    const last4 = value.slice(-4);
    return `${first4}***${last4}`;
  }

  return input;
}
