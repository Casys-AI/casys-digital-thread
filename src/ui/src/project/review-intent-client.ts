import {
  type ProjectReviewIntent,
  type ProjectReviewIntentRecord,
  validateProjectReviewIntent,
  validateProjectReviewIntentAcknowledgement,
} from "../../../domain/project/project-review-intent.ts";

export interface ProjectReviewIntentListResponse {
  readonly projectId: string;
  readonly projectRevision: number;
  readonly intents: readonly ProjectReviewIntentRecord[];
}

export interface ProjectReviewIntentClient {
  list(signal?: AbortSignal): Promise<ProjectReviewIntentListResponse>;
  submit(
    intent: ProjectReviewIntent,
    signal?: AbortSignal,
  ): Promise<ProjectReviewIntentRecord>;
}

export type ReviewIntentFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export class ReviewIntentHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ReviewIntentHttpError";
  }
}

export class ReviewIntentConflictError extends ReviewIntentHttpError {
  constructor(
    readonly code: string,
    readonly currentRevision?: number,
    message = "The project changed while this review intent was being sent.",
  ) {
    super(409, message);
    this.name = "ReviewIntentConflictError";
  }
}

export class ReviewIntentStaleError extends ReviewIntentConflictError {
  constructor(code: string, currentRevision?: number) {
    super(
      code,
      currentRevision,
      "This proposal changed. Review the latest exact preview before sending again.",
    );
    this.name = "ReviewIntentStaleError";
  }
}

export class HttpProjectReviewIntentClient
  implements ProjectReviewIntentClient {
  constructor(
    private readonly endpoint = "/api/review-intents",
    private readonly fetcher: ReviewIntentFetch = globalThis.fetch.bind(
      globalThis,
    ),
  ) {}

  async list(signal?: AbortSignal): Promise<ProjectReviewIntentListResponse> {
    const response = await this.fetcher(this.endpoint, {
      method: "GET",
      cache: "no-store",
      headers: { Accept: "application/json" },
      signal,
    });
    if (!response.ok) {
      throw new ReviewIntentHttpError(
        response.status,
        `Review intent outbox HTTP ${response.status}.`,
      );
    }
    return parseListResponse(await response.json());
  }

  async submit(
    intent: ProjectReviewIntent,
    signal?: AbortSignal,
  ): Promise<ProjectReviewIntentRecord> {
    // Revalidate immediately before serializing so the browser cannot add
    // fields to the bounded intent protocol by accident.
    const body = validateProjectReviewIntent(intent);
    const response = await this.fetcher(this.endpoint, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });
    const payload: unknown = await response.json().catch(() => undefined);
    if (response.status === 409) {
      const conflict = objectRecord(payload);
      const code = typeof conflict?.error === "string"
        ? conflict.error
        : "review_intent_conflict";
      const currentRevision = positiveIntegerOrUndefined(
        conflict?.currentRevision,
      );
      if (reviewIntentConflictChangesScope(code)) {
        throw new ReviewIntentStaleError(code, currentRevision);
      }
      throw new ReviewIntentConflictError(code, currentRevision);
    }
    if (response.status !== 202) {
      const error = objectRecord(payload);
      throw new ReviewIntentHttpError(
        response.status,
        typeof error?.message === "string"
          ? error.message
          : `Review intent outbox HTTP ${response.status}.`,
      );
    }
    const accepted = objectRecord(payload);
    if (accepted?.status !== "accepted") {
      throw new TypeError("The review intent response is not an acceptance.");
    }
    return parseRecord(accepted.record, "ReviewIntentAcceptance.record");
  }
}

function reviewIntentConflictChangesScope(code: string): boolean {
  return code === "review_intent_project_mismatch" ||
    code === "review_intent_decision_not_proposed" ||
    code === "review_intent_fingerprint_mismatch";
}

function parseListResponse(value: unknown): ProjectReviewIntentListResponse {
  const input = objectRecord(value);
  if (
    !input || typeof input.projectId !== "string" ||
    input.projectId.trim().length === 0 ||
    !Number.isSafeInteger(input.projectRevision) ||
    Number(input.projectRevision) < 1 || !Array.isArray(input.intents)
  ) {
    throw new TypeError("The review intent list has an unsupported contract.");
  }
  return {
    projectId: input.projectId,
    projectRevision: Number(input.projectRevision),
    intents: input.intents.map((record, index) =>
      parseRecord(record, `ReviewIntentList.intents[${index}]`)
    ),
  };
}

function parseRecord(value: unknown, path: string): ProjectReviewIntentRecord {
  const input = objectRecord(value);
  if (!input || !Object.hasOwn(input, "intent")) {
    throw new TypeError(`${path} has an unsupported contract.`);
  }
  const allowed = input.acknowledgement === undefined
    ? ["intent"]
    : ["intent", "acknowledgement"];
  if (
    Object.keys(input).some((key) => !allowed.includes(key)) ||
    (allowed.length === 2 && !Object.hasOwn(input, "acknowledgement"))
  ) {
    throw new TypeError(`${path} has an unsupported contract.`);
  }
  const intent = validateProjectReviewIntent(input.intent);
  const acknowledgement = input.acknowledgement === undefined
    ? undefined
    : validateProjectReviewIntentAcknowledgement(input.acknowledgement);
  if (
    acknowledgement &&
    (acknowledgement.intentId !== intent.intentId ||
      acknowledgement.projectId !== intent.projectId)
  ) {
    throw new TypeError(`${path} acknowledgement does not match its intent.`);
  }
  return acknowledgement ? { intent, acknowledgement } : { intent };
}

function objectRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function positiveIntegerOrUndefined(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) > 0
    ? Number(value)
    : undefined;
}
