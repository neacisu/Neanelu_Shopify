interface UiErrorContext {
  source: 'route' | 'component' | 'unknown';
  route?: string;
  status?: number;
}

export function reportUiError(error: unknown, context: UiErrorContext) {
  try {
    // Avoid noisy network attempts in tests.
    if (typeof process !== 'undefined' && process.env['NODE_ENV'] === 'test') return;

    const payload = {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : { message: String(error) },
      context,
      timestamp: new Date().toISOString(),
    };

    // Best-effort: no hard dependency on backend endpoint in PR-018.
    // If an endpoint exists later (e.g. /api/ui-errors), this will start working automatically.
    const url =
      typeof window !== 'undefined'
        ? new URL('/api/ui-errors', window.location.href).toString()
        : '/api/ui-errors';

    if (typeof navigator !== 'undefined' && 'sendBeacon' in navigator) {
      const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
      navigator.sendBeacon(url, blob);
      return;
    }

    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // never throw from reporting
  }
}
