export class ApiError extends Error {
  readonly status: number;
  readonly retryable: boolean;

  constructor(message: string, options: { status: number; retryable?: boolean }) {
    super(message);
    this.name = 'ApiError';
    this.status = options.status;
    this.retryable = options.retryable ?? false;
  }
}
