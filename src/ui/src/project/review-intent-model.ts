import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type { EngineeringDecision } from "../../../domain/project/engineering-project.ts";
import {
  type ProjectReviewIntent,
  type ProjectReviewIntentAction,
  type ProjectReviewIntentRecord,
  validateProjectReviewIntent,
} from "../../../domain/project/project-review-intent.ts";
import type {
  ActivityReviewStatus,
  ProjectReviewRecord,
} from "./review-decision-model.ts";

export const REVIEW_INTENT_COMMENT_MAX_LENGTH = 2_000;

/**
 * Transport state for one exact proposal. None of these states is a project
 * decision: only a refreshed EngineeringProjectSnapshot can say Validated or
 * Revision requested.
 */
export type ReviewIntentTransmissionState =
  | { readonly kind: "idle" }
  | { readonly kind: "sending"; readonly intent: ProjectReviewIntent }
  | { readonly kind: "queued"; readonly record: ProjectReviewIntentRecord }
  | {
    readonly kind: "acknowledged";
    readonly record: ProjectReviewIntentRecord;
  }
  | {
    readonly kind: "error";
    readonly message: string;
    readonly retryIntent?: ProjectReviewIntent;
  }
  | {
    readonly kind: "stale";
    readonly message: string;
    readonly currentRevision?: number;
  };

/**
 * Visible feed status. Transport states temporarily replace only "To review";
 * a canonical human outcome always takes precedence after the project refresh.
 */
export type ActivityReviewDisplayStatus =
  | ActivityReviewStatus
  | "sending"
  | "sent"
  | "received";

export function effectiveActivityReviewStatus(
  canonicalStatus: ActivityReviewStatus | undefined,
  transmissionState: ReviewIntentTransmissionState,
): ActivityReviewDisplayStatus | undefined {
  if (canonicalStatus !== "to-review") return canonicalStatus;
  if (transmissionState.kind === "sending") return "sending";
  if (transmissionState.kind === "queued") return "sent";
  if (transmissionState.kind === "acknowledged") return "received";
  return canonicalStatus;
}

export function activityReviewDisplayStatusLabel(
  status: ActivityReviewDisplayStatus,
): string {
  if (status === "to-review") return "To review";
  if (status === "sending") return "Sending";
  if (status === "sent") return "Sent";
  if (status === "received") return "Received";
  if (status === "validated") return "Validated";
  return "Revision requested";
}

export interface BuildReviewIntentInput {
  readonly intentId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly decisionId: string;
  readonly approvalId: string;
  readonly inputFingerprint: ContentFingerprint;
  readonly action: ProjectReviewIntentAction;
  readonly comment?: string;
  readonly submittedAt: string;
}

export class ReviewIntentCommentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewIntentCommentError";
  }
}

/** Builds the exact POST body with a canonical lowercase SHA-256 digest. */
export function buildReviewIntent(
  input: BuildReviewIntentInput,
): ProjectReviewIntent {
  const comment = normalizeReviewIntentComment(input.action, input.comment);
  return validateProjectReviewIntent({
    intentId: input.intentId,
    projectId: input.projectId,
    expectedRevision: input.expectedRevision,
    decisionId: input.decisionId,
    approvalId: input.approvalId,
    inputFingerprint: {
      ...input.inputFingerprint,
      digest: input.inputFingerprint.digest.toLowerCase(),
    },
    action: input.action,
    ...(comment === undefined ? {} : { comment }),
    submittedAt: input.submittedAt,
  });
}

export function normalizeReviewIntentComment(
  action: ProjectReviewIntentAction,
  value: string | undefined,
): string | undefined {
  if (value === undefined || value.trim().length === 0) {
    if (action === "request-revision") {
      throw new ReviewIntentCommentError(
        "Describe what should change before requesting a revision.",
      );
    }
    return undefined;
  }
  if ([...value].length > REVIEW_INTENT_COMMENT_MAX_LENGTH) {
    throw new ReviewIntentCommentError(
      `Comments must not exceed ${REVIEW_INTENT_COMMENT_MAX_LENGTH} characters.`,
    );
  }
  // Keep the reviewer's exact text. The signed intent must not silently trim or
  // rewrite a non-blank comment between the UI and the paired agent.
  return value;
}

export function reviewIntentScopeKey(
  projectId: string,
  decisionId: string,
  inputFingerprint: ContentFingerprint,
  approvalId: string,
): string {
  return JSON.stringify([
    projectId,
    decisionId,
    inputFingerprint.algorithm,
    inputFingerprint.digest.toLowerCase(),
    approvalId,
  ]);
}

export function reviewIntentStateFromRecord(
  record: ProjectReviewIntentRecord,
): ReviewIntentTransmissionState {
  return record.acknowledgement
    ? { kind: "acknowledged", record }
    : { kind: "queued", record };
}

/**
 * Reattaches only intents bound to the exact project, decision, fingerprint,
 * and approval shown. Neither a predecessor nor another project can inherit it.
 */
export function reattachReviewIntent(
  records: readonly ProjectReviewIntentRecord[],
  projectId: string,
  decisionId: string,
  inputFingerprint: ContentFingerprint,
  approvalId: string,
): ReviewIntentTransmissionState {
  const exact = records.filter((record) =>
    record.intent.projectId === projectId &&
    record.intent.decisionId === decisionId &&
    record.intent.approvalId === approvalId &&
    fingerprintsEqual(record.intent.inputFingerprint, inputFingerprint)
  ).sort(compareReviewIntentRecords).at(-1);
  return exact ? reviewIntentStateFromRecord(exact) : { kind: "idle" };
}

/** Creates a transmission-state index used to restore pending sends on reload. */
export function indexReviewIntentRecords(
  records: readonly ProjectReviewIntentRecord[],
): ReadonlyMap<string, ReviewIntentTransmissionState> {
  const grouped = new Map<string, ProjectReviewIntentRecord[]>();
  for (const record of records) {
    const approvalId = record.intent.approvalId;
    // Legacy journal entries remain readable history, but their missing
    // approval attempt can never decorate or wake a current proposal.
    if (approvalId === undefined) continue;
    const key = reviewIntentScopeKey(
      record.intent.projectId,
      record.intent.decisionId,
      record.intent.inputFingerprint,
      approvalId,
    );
    grouped.set(key, [...(grouped.get(key) ?? []), record]);
  }
  return new Map(
    [...grouped].map(([key, candidates]) => [
      key,
      reviewIntentStateFromRecord(
        [...candidates].sort(compareReviewIntentRecords).at(-1)!,
      ),
    ]),
  );
}

/** Poll only while an exact still-proposed decision is awaiting agent receipt. */
export function shouldPollReviewIntentReceipts(
  states: ReadonlyMap<string, ReviewIntentTransmissionState>,
  projectId: string | undefined,
  reviews: readonly {
    readonly approvalId?: ProjectReviewRecord["approvalId"];
    readonly decision?: Pick<
      EngineeringDecision,
      "id" | "status" | "inputFingerprint"
    >;
  }[],
): boolean {
  if (!projectId) return false;
  const proposedScopes = new Set(
    reviews.flatMap(({ approvalId, decision }) =>
      approvalId && decision?.status === "proposed" &&
        decision.inputFingerprint
        ? [
          reviewIntentScopeKey(
            projectId,
            decision.id,
            decision.inputFingerprint,
            approvalId,
          ),
        ]
        : []
    ),
  );
  return [...states].some(([key, state]) =>
    state.kind === "queued" && proposedScopes.has(key)
  );
}

function compareReviewIntentRecords(
  left: ProjectReviewIntentRecord,
  right: ProjectReviewIntentRecord,
): number {
  return left.intent.submittedAt.localeCompare(right.intent.submittedAt) ||
    left.intent.intentId.localeCompare(right.intent.intentId);
}

function fingerprintsEqual(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm &&
    left.digest.toLowerCase() === right.digest.toLowerCase();
}
