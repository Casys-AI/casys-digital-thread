export type EngineeringProjectCommandErrorCode =
  | "project_not_found"
  | "stale_revision"
  | "command_id_conflict"
  | "permission_denied"
  | "invalid_transition"
  | "invalid_input"
  | "approval_scope_mismatch"
  | "entity_not_found";

export type ErrorCode = EngineeringProjectCommandErrorCode;

export class EngineeringProjectCommandError extends Error {
  readonly httpStatus: 403 | 404 | 409 | 422;

  constructor(
    readonly code: EngineeringProjectCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "EngineeringProjectCommandError";
    this.httpStatus = code === "permission_denied"
      ? 403
      : code === "project_not_found" || code === "entity_not_found"
      ? 404
      : code === "stale_revision" || code === "command_id_conflict"
      ? 409
      : 422;
  }
}
