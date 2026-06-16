export class AppError extends Error {
  constructor(
    public code: string,
    public message: string,
    public statusCode: number,
    public details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message = 'Bad request', details?: Record<string, unknown>): AppError {
    return new AppError('BAD_REQUEST', message, 400, details);
  }

  static notFound(message = 'Resource not found'): AppError {
    return new AppError('NOT_FOUND', message, 404);
  }

  static upstream(code: string, message: string, status: number): AppError {
    return new AppError(code, message, status);
  }

  /**
   * The shed control token is missing/expired and could not be (re)minted.
   * Message is fixed and generic on purpose: these factories take no caller
   * string so a token or SSH output can never be spliced into a serialized
   * error. Diagnostic detail belongs in (redacted) server logs, not the wire.
   */
  static authExpired(): AppError {
    return new AppError('SHED_AUTH_EXPIRED', 'shed control token expired or unavailable', 502);
  }

  /**
   * The server's TLS cert did not match the pinned `tls_cert_fingerprint`
   * (a possible MITM). Fixed message — never echo either fingerprint.
   */
  static tlsPinMismatch(): AppError {
    return new AppError('SHED_TLS_PIN_MISMATCH', 'shed TLS certificate fingerprint mismatch', 502);
  }

  /** A secure (https) server has no pinned fingerprint configured. */
  static tlsPinMissing(): AppError {
    return new AppError(
      'SHED_TLS_PIN_MISSING',
      'secure shed has no tls_cert_fingerprint configured',
      502,
    );
  }
}
