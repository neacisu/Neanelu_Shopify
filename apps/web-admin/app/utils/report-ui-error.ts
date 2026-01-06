interface UiErrorContext {
  source: 'route' | 'component' | 'unknown';
  route?: string;
  status?: number;
}

let uiErrorsEndpointMissingUntilMs = 0;

export function reportUiError(error: unknown, context: UiErrorContext) {
  try {
    // Avoid noisy network attempts in tests.
    if (typeof process !== 'undefined' && process.env['NODE_ENV'] === 'test') return;

    // Avoid repeated 404 spam when the backend endpoint is not deployed.
    if (uiErrorsEndpointMissingUntilMs > 0 && Date.now() < uiErrorsEndpointMissingUntilMs) {
      return;
    }

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
    }).then(
      (res) => {
        if (res.status === 404) {
          uiErrorsEndpointMissingUntilMs = Date.now() + 5 * 60_000;
        }
      },
      () => {
        // ignore
      }
    );
  } catch {
    // never throw from reporting
  }
}
