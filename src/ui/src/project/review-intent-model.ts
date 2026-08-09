import type { ContentFingerprint } from "../../../domain/kernel/types.ts";
import type { EngineeringDecision } from "../../../domain/project/engineering-project.ts";
import {
  type ProjectReviewIntent,
  type ProjectReviewIntentAction,
  type ProjectReviewIntentRecord,
  validateProjectReviewIntent,
} from "../../../domain/project/project-review-intent.ts";

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

export interface BuildReviewIntentInput {
  readonly intentId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly decisionId: string;
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

/** Builds the exact POST body, omitting an optional blank validation comment. */
export function buildReviewIntent(
  input: BuildReviewIntentInput,
): ProjectReviewIntent {
  const comment = normalizeReviewIntentComment(input.action, input.comment);
  return validateProjectReviewIntent({
    intentId: input.intentId,
    projectId: input.projectId,
    expectedRevision: input.expectedRevision,
    decisionId: input.decisionId,
    inputFingerprint: input.inputFingerprint,
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
  decisionId: string,
  inputFingerprint: ContentFingerprint,
): string {
  return JSON.stringify([
    decisionId,
    inputFingerprint.algorithm,
    inputFingerprint.digest.toLowerCase(),
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
 * Reattaches only intents bound to the exact decision and fingerprint shown in
 * the preview. An intent for a predecessor can never decorate its successor.
 */
export function reattachReviewIntent(
  records: readonly ProjectReviewIntentRecord[],
  decisionId: string,
  inputFingerprint: ContentFingerprint,
): ReviewIntentTransmissionState {
  const exact = records.filter((record) =>
    record.intent.decisionId === decisionId &&
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
    const key = reviewIntentScopeKey(
      record.intent.decisionId,
      record.intent.inputFingerprint,
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
  decisions: readonly Pick<
    EngineeringDecision,
    "id" | "status" | "inputFingerprint"
  >[],
): boolean {
  const proposedScopes = new Set(
    decisions.flatMap((decision) =>
      decision.status === "proposed" && decision.inputFingerprint
        ? [reviewIntentScopeKey(decision.id, decision.inputFingerprint)]
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
