export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    options: {
      status: number;
      retryable?: boolean;
      code?: string;
      details?: Record<string, unknown>;
    }
  ) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.retryable = options.retryable ?? false;
    if (options.code !== undefined) {
      this.code = options.code;
    }
    if (options.details !== undefined) {
      this.details = options.details;
    }
  }
}
