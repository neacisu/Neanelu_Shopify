export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogEntry = Readonly<{
  id: string;
  timestamp: string;
  level: LogLevel;
  message: string;
  traceId?: string;
  stepName?: string;
  metadata?: Record<string, unknown>;
}>;
