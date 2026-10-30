import { HttpException, HttpStatus } from '@nestjs/common';

export type ModerationErrorCode =
  | 'MOD_AUTH_REQUIRED'
  | 'MOD_AUTH_INVALID'
  | 'MOD_FORBIDDEN'
  | 'MOD_INVALID_REQUEST'
  | 'MOD_IDEMPOTENCY_REQUIRED'
  | 'MOD_IDEMPOTENCY_CONFLICT'
  | 'MOD_NOT_FOUND'
  | 'MOD_TASK_CONFLICT'
  | 'MOD_PROPOSAL_CONFLICT'
  | 'MOD_STALE_CONTEXT'
  | 'MOD_SEMANTIC_PROMOTION_PERMISSION_DENIED'
  | 'MOD_SEMANTIC_PROMOTION_CONSTRAINT_REJECTED'
  | 'MOD_SEMANTIC_PROMOTION_DATABASE_FAILURE';

export type ModerationDiagnostic = {
  failureStage: 'transaction' | 'audit_context' | 'promotion_function';
  sqlState?: string;
};

export class ModerationHttpError extends HttpException {
  public constructor(
    status: HttpStatus,
    public readonly code: ModerationErrorCode,
    diagnostic?: ModerationDiagnostic,
  ) {
    super(diagnostic ? { code, diagnostic } : { code }, status);
    this.name = 'ModerationHttpError';
  }
}

export function invalidModerationRequest(
  code: ModerationErrorCode = 'MOD_INVALID_REQUEST',
): ModerationHttpError {
  return new ModerationHttpError(HttpStatus.BAD_REQUEST, code);
}

export function moderationConflict(code: ModerationErrorCode): ModerationHttpError {
  return new ModerationHttpError(HttpStatus.CONFLICT, code);
}
