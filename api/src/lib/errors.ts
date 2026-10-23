/** Errors that map to a public HTTP response. Messages must never contain internals. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** A D1 call failed. The original error is kept for server-side logging only. */
export class DatabaseError extends Error {
  constructor(override readonly cause: unknown) {
    super("Database query failed");
    this.name = "DatabaseError";
  }
}

export const invalidParameter = (name: string, message: string, details?: Record<string, unknown>) =>
  new ApiError(400, "invalid_parameter", message, { parameter: name, ...details });
