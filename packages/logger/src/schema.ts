import { trace } from '@opentelemetry/api';
import pino, { type Logger as PinoLogger } from 'pino';

import { redactDeep, type RedactionMode } from './redaction.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export type Logger = Readonly<{
  debug: (context: Record<string, unknown>, message: string) => void;
  info: (context: Record<string, unknown>, message: string) => void;
  warn: (context: Record<string, unknown>, message: string) => void;
  error: (context: Record<string, unknown>, message: string) => void;
  fatal: (context: Record<string, unknown>, message: string) => void;
  child: (baseContext: Record<string, unknown>) => Logger;
}>;

export type CreateLoggerOptions = Readonly<{
  service: string;
  env: RedactionMode;
  level: LogLevel;
  version?: string;
}>;

export function createLogger(options: CreateLoggerOptions): Logger {
  const pinoLogger = createPinoLogger(options);
  return createLoggerWrapper(pinoLogger, options.env, {});
}

function createPinoLogger(options: CreateLoggerOptions): PinoLogger {
  return pino({
    level: options.level,
    messageKey: 'message',
    timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
    base: {
      service: options.service,
      env: options.env,
      version: options.version ?? process.env['npm_package_version'] ?? '0.0.0',
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        '*.password',
        '*.secret',
        '*.token',
        '*.access_token',
        '*.refresh_token',
        '*.api_key',
        '*.api_secret',
      ],
      censor: '[REDACTED]'.toString(),
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
  });
}

function createLoggerWrapper(
  pinoLogger: PinoLogger,
  mode: RedactionMode,
  baseContext: Record<string, unknown>
): Logger {
  const log = (level: LogLevel, context: Record<string, unknown>, message: string): void => {
    const merged = {
      ...baseContext,
      ...context,
      ...getTraceContext(),
    };

    const snake = toSnakeCaseDeep(merged);
    const redacted = redactDeep(snake, mode) as Record<string, unknown>;

    switch (level) {
      case 'debug':
        pinoLogger.debug(redacted, message);
        return;
      case 'info':
        pinoLogger.info(redacted, message);
        return;
      case 'warn':
        pinoLogger.warn(redacted, message);
        return;
      case 'error':
        pinoLogger.error(redacted, message);
        return;
      case 'fatal':
        pinoLogger.fatal(redacted, message);
        return;
    }
  };

  return {
    debug: (context, message) => log('debug', context, message),
    info: (context, message) => log('info', context, message),
    warn: (context, message) => log('warn', context, message),
    error: (context, message) => log('error', context, message),
    fatal: (context, message) => log('fatal', context, message),
    child: (ctx) => createLoggerWrapper(pinoLogger, mode, { ...baseContext, ...ctx }),
  };
}

function getTraceContext(): Record<string, unknown> {
  const activeSpan = trace.getActiveSpan();
  const spanContext = activeSpan?.spanContext();
  if (!spanContext) return {};
  return {
    trace_id: spanContext.traceId,
    span_id: spanContext.spanId,
  };
}

function toSnakeCaseDeep(value: unknown): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) return value.map(toSnakeCaseDeep);
  if (value instanceof Error) return value;
  if (typeof value !== 'object') return value;

  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    out[toSnakeKey(key)] = toSnakeCaseDeep(val);
  }
  return out;
}

function toSnakeKey(key: string): string {
  // Preserve existing snake_case.
  if (key.includes('_')) return key.toLowerCase();

  // camelCase / PascalCase -> snake_case
  const withUnderscore = key
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z0-9]+)/g, '$1_$2');
  return withUnderscore.toLowerCase();
}
