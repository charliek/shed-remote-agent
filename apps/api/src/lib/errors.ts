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
}
