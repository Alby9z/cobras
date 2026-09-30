/** Erreurs métier classifiées. Le message est destiné à l'utilisateur ; aucun détail interne. */
export type ErrorCode =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "RESOURCE_NOT_FOUND"
  | "CONFLICT"
  | "PAYMENT_ERROR"
  | "COMPLIANCE_ERROR"
  | "DOCUMENT_ERROR"
  | "RATE_LIMIT_ERROR"
  | "EXTERNAL_SERVICE_ERROR"
  | "INVALID_TRANSITION"
  | "OUT_OF_STOCK"
  | "CONFIGURATION_ERROR"
  | "INTERNAL_ERROR";

const HTTP: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 422,
  AUTHENTICATION_ERROR: 401,
  AUTHORIZATION_ERROR: 403,
  RESOURCE_NOT_FOUND: 404,
  CONFLICT: 409,
  PAYMENT_ERROR: 402,
  COMPLIANCE_ERROR: 422,
  DOCUMENT_ERROR: 422,
  RATE_LIMIT_ERROR: 429,
  EXTERNAL_SERVICE_ERROR: 503,
  INVALID_TRANSITION: 409,
  OUT_OF_STOCK: 409,
  CONFIGURATION_ERROR: 503,
  INTERNAL_ERROR: 500,
};

export class AppError extends Error {
  readonly status: number;
  constructor(readonly code: ErrorCode, message: string, readonly details: Record<string, unknown> = {}) {
    super(message);
    this.name = "AppError";
    this.status = HTTP[code];
  }
}

export const isAppError = (e: unknown): e is AppError => e instanceof AppError;

/** Corps de réponse standardisé (API). */
export function errorBody(e: unknown, requestId: string | null) {
  if (isAppError(e)) return { code: e.code, message: e.message, details: e.details, request_id: requestId };
  return { code: "INTERNAL_ERROR" as const, message: "Une erreur interne est survenue.", details: {}, request_id: requestId };
}
