import type { ContentFingerprint } from "../kernel/types.ts";
import { deepFreeze, exactRecord } from "../kernel/case-validation.ts";

export type ProjectReviewIntentAction = "validate" | "request-revision";

interface ProjectReviewIntentFields {
  readonly intentId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly decisionId: string;
  readonly inputFingerprint: ContentFingerprint;
  readonly action: ProjectReviewIntentAction;
  readonly comment?: string;
  readonly submittedAt: string;
}

/**
 * A browser-originated request for the paired agent to run the existing
 * human-decision flow. It is deliberately not an EngineeringApproval and
 * carries no authority to mutate an EngineeringProjectSnapshot.
 */
export interface ProjectReviewIntent extends ProjectReviewIntentFields {
  /** Exact pending approval attempt shown when the reviewer submitted this relay. */
  readonly approvalId: string;
}

/**
 * Historical 1.0 journal payload. It remains readable, but its missing approval
 * attempt means it can never be acknowledged or relayed as actionable work.
 */
export interface LegacyProjectReviewIntent extends ProjectReviewIntentFields {
  readonly approvalId?: never;
}

export type StoredProjectReviewIntent =
  | ProjectReviewIntent
  | LegacyProjectReviewIntent;

/** Agent receipt only: acknowledgement does not mean the decision was applied. */
export interface ProjectReviewIntentAcknowledgement {
  readonly intentId: string;
  readonly projectId: string;
  readonly acknowledgedAt: string;
  readonly acknowledgedBy: string;
}

export interface ProjectReviewIntentRecord {
  readonly intent: StoredProjectReviewIntent;
  readonly acknowledgement?: ProjectReviewIntentAcknowledgement;
}

export function validateProjectReviewIntent(
  value: unknown,
): ProjectReviewIntent {
  return validateProjectReviewIntentShape(value, true);
}

/** Decode only an already-persisted 1.0 payload; never use this for new POSTs. */
export function validateLegacyProjectReviewIntent(
  value: unknown,
): LegacyProjectReviewIntent {
  return validateProjectReviewIntentShape(value, false);
}

export function isApprovalBoundProjectReviewIntent(
  intent: StoredProjectReviewIntent,
): intent is ProjectReviewIntent {
  return intent.approvalId !== undefined;
}

function validateProjectReviewIntentShape(
  value: unknown,
  approvalBound: true,
): ProjectReviewIntent;
function validateProjectReviewIntentShape(
  value: unknown,
  approvalBound: false,
): LegacyProjectReviewIntent;
function validateProjectReviewIntentShape(
  value: unknown,
  approvalBound: boolean,
): StoredProjectReviewIntent {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const requiredKeys = approvalBound
    ? [
      "intentId",
      "projectId",
      "expectedRevision",
      "decisionId",
      "approvalId",
      "inputFingerprint",
      "action",
      "submittedAt",
    ]
    : [
      "intentId",
      "projectId",
      "expectedRevision",
      "decisionId",
      "inputFingerprint",
      "action",
      "submittedAt",
    ];
  const keys = candidate && Object.hasOwn(candidate, "comment")
    ? [...requiredKeys, "comment"]
    : requiredKeys;
  const input = exactRecord(value, keys, "ProjectReviewIntent");
  const intentId = identity(input.intentId, "ProjectReviewIntent.intentId");
  const projectId = identity(input.projectId, "ProjectReviewIntent.projectId");
  const expectedRevision = positiveInteger(
    input.expectedRevision,
    "ProjectReviewIntent.expectedRevision",
  );
  const decisionId = identity(input.decisionId, "ProjectReviewIntent.decisionId");
  const approvalId = approvalBound
    ? identity(input.approvalId, "ProjectReviewIntent.approvalId")
    : undefined;
  const inputFingerprint = fingerprint(
    input.inputFingerprint,
    "ProjectReviewIntent.inputFingerprint",
    approvalBound,
  );
  const action = reviewAction(input.action, "ProjectReviewIntent.action");
  const submittedAt = isoDateTime(
    input.submittedAt,
    "ProjectReviewIntent.submittedAt",
  );
  const comment = Object.hasOwn(input, "comment")
    ? reviewComment(input.comment, action, "ProjectReviewIntent.comment")
    : undefined;
  if (action === "request-revision" && comment === undefined) {
    throw new TypeError(
      "ProjectReviewIntent.comment is required when requesting a revision.",
    );
  }
  return deepFreeze({
    intentId,
    projectId,
    expectedRevision,
    decisionId,
    ...(approvalId === undefined ? {} : { approvalId }),
    inputFingerprint,
    action,
    ...(comment === undefined ? {} : { comment }),
    submittedAt,
  });
}

export function validateProjectReviewIntentAcknowledgement(
  value: unknown,
): ProjectReviewIntentAcknowledgement {
  const input = exactRecord(
    value,
    ["intentId", "projectId", "acknowledgedAt", "acknowledgedBy"],
    "ProjectReviewIntentAcknowledgement",
  );
  return deepFreeze({
    intentId: identity(
      input.intentId,
      "ProjectReviewIntentAcknowledgement.intentId",
    ),
    projectId: identity(
      input.projectId,
      "ProjectReviewIntentAcknowledgement.projectId",
    ),
    acknowledgedAt: isoDateTime(
      input.acknowledgedAt,
      "ProjectReviewIntentAcknowledgement.acknowledgedAt",
    ),
    acknowledgedBy: identity(
      input.acknowledgedBy,
      "ProjectReviewIntentAcknowledgement.acknowledgedBy",
    ),
  });
}

/** Shared by file adapters before a caller-controlled id becomes a path key. */
export function validateProjectReviewIntentProjectId(value: unknown): string {
  return identity(value, "projectId");
}

function identity(value: unknown, path: string): string {
  if (
    typeof value !== "string" || value.length === 0 || value !== value.trim() ||
    value.length > 256
  ) {
    throw new TypeError(
      `${path} must be a non-empty identity without edge whitespace (maximum 256 characters).`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive safe integer.`);
  }
  return Number(value);
}

function fingerprint(
  value: unknown,
  path: string,
  lowercaseOnly: boolean,
): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  if (input.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must equal \"sha256\".`);
  }
  const pattern = lowercaseOnly ? /^[a-f0-9]{64}$/ : /^[a-f0-9]{64}$/i;
  if (typeof input.digest !== "string" || !pattern.test(input.digest)) {
    throw new TypeError(
      `${path}.digest must be 64 ${
        lowercaseOnly ? "lowercase " : ""
      }hexadecimal characters.`,
    );
  }
  return deepFreeze({ algorithm: "sha256", digest: input.digest });
}

function reviewAction(value: unknown, path: string): ProjectReviewIntentAction {
  if (value !== "validate" && value !== "request-revision") {
    throw new TypeError(`${path} must be validate or request-revision.`);
  }
  return value;
}

function reviewComment(
  value: unknown,
  action: ProjectReviewIntentAction,
  path: string,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new TypeError(
      `${path} must be non-blank${action === "validate" ? " when supplied" : ""}.`,
    );
  }
  if ([...value].length > 2_000) {
    throw new TypeError(`${path} must not exceed 2000 characters.`);
  }
  // Deliberately return the original bytes-as-text: comments are never trimmed
  // or rewritten between the reviewer and the paired agent.
  return value;
}

function isoDateTime(value: unknown, path: string): string {
  const canonical = typeof value === "string" && !value.includes(".")
    ? value.replace(/Z$/, ".000Z")
    : value;
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString() !== canonical
  ) {
    throw new TypeError(`${path} must be an ISO 8601 UTC timestamp.`);
  }
  return value;
}
