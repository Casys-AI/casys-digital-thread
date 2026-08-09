import type { ContentFingerprint } from "../kernel/types.ts";
import { deepFreeze, exactRecord } from "../kernel/case-validation.ts";

export type ProjectReviewIntentAction = "validate" | "request-revision";

/**
 * A browser-originated request for the paired agent to run the existing
 * human-decision flow. It is deliberately not an EngineeringApproval and
 * carries no authority to mutate an EngineeringProjectSnapshot.
 */
export interface ProjectReviewIntent {
  readonly intentId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly decisionId: string;
  readonly inputFingerprint: ContentFingerprint;
  readonly action: ProjectReviewIntentAction;
  readonly comment?: string;
  readonly submittedAt: string;
}

/** Agent receipt only: acknowledgement does not mean the decision was applied. */
export interface ProjectReviewIntentAcknowledgement {
  readonly intentId: string;
  readonly projectId: string;
  readonly acknowledgedAt: string;
  readonly acknowledgedBy: string;
}

export interface ProjectReviewIntentRecord {
  readonly intent: ProjectReviewIntent;
  readonly acknowledgement?: ProjectReviewIntentAcknowledgement;
}

export function validateProjectReviewIntent(
  value: unknown,
): ProjectReviewIntent {
  const candidate = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const keys = candidate && Object.hasOwn(candidate, "comment")
    ? [
      "intentId",
      "projectId",
      "expectedRevision",
      "decisionId",
      "inputFingerprint",
      "action",
      "comment",
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
  const input = exactRecord(value, keys, "ProjectReviewIntent");
  const intentId = identity(input.intentId, "ProjectReviewIntent.intentId");
  const projectId = identity(input.projectId, "ProjectReviewIntent.projectId");
  const expectedRevision = positiveInteger(
    input.expectedRevision,
    "ProjectReviewIntent.expectedRevision",
  );
  const decisionId = identity(input.decisionId, "ProjectReviewIntent.decisionId");
  const inputFingerprint = fingerprint(
    input.inputFingerprint,
    "ProjectReviewIntent.inputFingerprint",
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

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  if (input.algorithm !== "sha256") {
    throw new TypeError(`${path}.algorithm must equal \"sha256\".`);
  }
  if (typeof input.digest !== "string" || !/^[a-f0-9]{64}$/i.test(input.digest)) {
    throw new TypeError(`${path}.digest must be 64 hexadecimal characters.`);
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
