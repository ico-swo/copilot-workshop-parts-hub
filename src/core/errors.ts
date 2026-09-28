/**
 * The single error shape used by every endpoint.
 *
 * Any new module must reuse AppError rather than inventing its own error
 * format. See .github/copilot-instructions.md.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, string> | undefined;

  constructor(status: number, code: string, message: string, details?: Record<string, string>) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.details = details;
  }

  static badRequest(message: string, details?: Record<string, string>): AppError {
    return new AppError(400, "bad_request", message, details);
  }

  static unauthorized(message = "A valid API key is required"): AppError {
    return new AppError(401, "unauthorized", message);
  }

  static forbidden(message: string): AppError {
    return new AppError(403, "forbidden", message);
  }

  static notFound(resource: string, id: string): AppError {
    return new AppError(404, "not_found", `${resource} '${id}' was not found`);
  }

  static conflict(code: string, message: string): AppError {
    return new AppError(409, code, message);
  }

  /** Optimistic concurrency failure: the caller's version is stale. */
  static versionConflict(resource: string, expected: number, actual: number): AppError {
    return new AppError(
      412,
      "version_conflict",
      `${resource} has been modified by another request`,
      { expectedVersion: String(expected), currentVersion: String(actual) },
    );
  }

  static tooManyRequests(retryAfterSeconds: number): AppError {
    return new AppError(429, "rate_limited", "Too many requests", {
      retryAfterSeconds: String(retryAfterSeconds),
    });
  }

  /** An invalid transition in a domain state machine. */
  static invalidTransition(entity: string, from: string, action: string): AppError {
    return new AppError(
      409,
      "invalid_transition",
      `${entity} in status '${from}' cannot be ${action}`,
    );
  }
}

export interface ErrorBody {
  error: { code: string; message: string; details?: Record<string, string>; requestId?: string };
}

export function toErrorBody(error: unknown, requestId?: string): { status: number; body: ErrorBody } {
  if (error instanceof AppError) {
    return {
      status: error.status,
      body: {
        error: {
          code: error.code,
          message: error.message,
          ...(error.details ? { details: error.details } : {}),
          ...(requestId ? { requestId } : {}),
        },
      },
    };
  }

  return {
    status: 500,
    body: {
      error: {
        code: "internal_error",
        message: "An unexpected error occurred",
        ...(requestId ? { requestId } : {}),
      },
    },
  };
}
