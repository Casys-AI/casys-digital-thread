import { fingerprintsEqual, sha256Fingerprint } from "./deterministic-json.ts";
import type {
  ProjectDiscoveryActor,
  ProjectDiscoveryActorOrigin,
  ProjectDiscoveryAnswerSource,
  ProjectDiscoveryBrief,
  ProjectDiscoveryCommandName,
  ProjectDiscoveryConfidence,
  ProjectDiscoveryQuestionOption,
  ProjectDiscoveryQuestionRisk,
  ProjectDiscoverySnapshot,
} from "./project-discovery.ts";
import { currentProjectDiscoveryAnswer } from "./project-discovery.ts";
import { validateProjectDiscoverySnapshot } from "./project-discovery-validation.ts";
import type { ContentFingerprint } from "./thread-snapshot.ts";

export interface ProjectDiscoveryRevisionStore {
  get(discoveryId: string): Promise<ProjectDiscoverySnapshot | undefined>;
  getRevision(
    discoveryId: string,
    revision: number,
  ): Promise<ProjectDiscoverySnapshot | undefined>;
  createInitial(
    snapshot: ProjectDiscoverySnapshot,
  ): Promise<ProjectDiscoverySnapshot>;
  commit(
    snapshot: ProjectDiscoverySnapshot,
    expectedRevision: number,
  ): Promise<ProjectDiscoverySnapshot>;
}

export class ProjectDiscoveryStoreConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectDiscoveryStoreConflictError";
  }
}

export type ProjectDiscoveryCommandErrorCode =
  | "discovery_not_found"
  | "discovery_exists"
  | "stale_revision"
  | "command_id_conflict"
  | "permission_denied"
  | "invalid_transition"
  | "invalid_input"
  | "review_scope_mismatch"
  | "entity_not_found";

export class ProjectDiscoveryCommandError extends Error {
  readonly httpStatus: 403 | 404 | 409 | 422;

  constructor(
    readonly code: ProjectDiscoveryCommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectDiscoveryCommandError";
    this.httpStatus = code === "permission_denied"
      ? 403
      : code === "discovery_not_found" || code === "entity_not_found"
      ? 404
      : code === "discovery_exists" || code === "stale_revision" ||
          code === "command_id_conflict"
      ? 409
      : 422;
  }
}

export interface ProjectDiscoveryCommandOrigin {
  readonly kind: ProjectDiscoveryActorOrigin;
  readonly actorId: string;
}

export interface StartProjectDiscoveryCommand {
  readonly commandId: string;
  readonly discoveryId: string;
  readonly issuedAt: string;
  readonly intent: string;
}

export interface ProjectDiscoveryMutationCommand {
  readonly commandId: string;
  readonly discoveryId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
}

export interface ProjectDiscoveryQuestionProposalInput {
  readonly id: string;
  readonly prompt: string;
  readonly whyItMatters: string;
  readonly recommendation: {
    readonly value: string;
    readonly rationale: string;
    readonly confidence: ProjectDiscoveryConfidence;
  };
  readonly options: readonly ProjectDiscoveryQuestionOption[];
  readonly allowUnknown: boolean;
  readonly risk: ProjectDiscoveryQuestionRisk;
  readonly evidenceNeeded: readonly string[];
}

export interface ProposeProjectDiscoveryQuestionCommand
  extends ProjectDiscoveryMutationCommand {
  readonly question: ProjectDiscoveryQuestionProposalInput;
}

export interface ProjectDiscoveryAnswerInput {
  readonly id: string;
  readonly questionId: string;
  readonly kind: "provided" | "unknown";
  readonly value?: string;
  readonly explanation?: string;
  readonly source: ProjectDiscoveryAnswerSource;
  readonly supersedesAnswerId?: string;
}

export interface RecordProjectDiscoveryAnswerCommand
  extends ProjectDiscoveryMutationCommand {
  readonly answer: ProjectDiscoveryAnswerInput;
}

export type ProjectDiscoveryBriefInput = Omit<
  ProjectDiscoveryBrief,
  "proposedAt" | "proposedBy"
>;

export interface ProposeProjectDiscoveryBriefCommand
  extends ProjectDiscoveryMutationCommand {
  readonly brief: ProjectDiscoveryBriefInput;
}

export interface ReviewProjectDiscoveryBriefCommand
  extends ProjectDiscoveryMutationCommand {
  readonly briefId: string;
  readonly rationale: string;
  readonly inputFingerprint: ContentFingerprint;
}

export const PROJECT_DISCOVERY_COMMAND_POLICY = {
  agent: [
    "discovery.start",
    "question.propose",
    "answer.record",
    "brief.propose",
  ],
  human: [
    "discovery.start",
    "answer.record",
    "brief.approve",
    "brief.reject",
  ],
} as const;

type Clock = () => string;

/**
 * Trusted command boundary for a pre-project discovery aggregate.
 *
 * Agents can prepare questions, record explicitly sourced answers and propose
 * a brief. Only a human origin can decide that exact brief scope.
 */
export class ProjectDiscoveryCommandService {
  constructor(
    private readonly store: ProjectDiscoveryRevisionStore,
    private readonly now: Clock = () => new Date().toISOString(),
  ) {}

  async start(
    origin: ProjectDiscoveryCommandOrigin,
    command: StartProjectDiscoveryCommand,
  ): Promise<ProjectDiscoverySnapshot> {
    validateOrigin(origin);
    assertAllowed(origin.kind, "discovery.start");
    nonEmpty(command.commandId, "commandId");
    safeId(command.discoveryId, "discoveryId");
    nonEmpty(command.intent, "intent");
    const issuedAt = requiredIsoDateTime(command.issuedAt, "issuedAt");
    const normalizedCommand = { ...command, intent: command.intent.trim(), issuedAt };
    const requestFingerprint = await sha256Fingerprint({
      type: "discovery.start",
      origin,
      command: normalizedCommand,
    });
    const existing = await this.store.get(command.discoveryId);
    if (existing) {
      const replay = await this.replay(
        existing,
        command.commandId,
        requestFingerprint,
      );
      if (replay) return replay;
      throw new ProjectDiscoveryCommandError(
        "discovery_exists",
        `Project discovery ${command.discoveryId} already exists.`,
      );
    }
    const appliedAt = requiredIsoDateTime(this.now(), "service clock");
    const snapshotId = snapshotIdFor(command.discoveryId, 1, requestFingerprint);
    const snapshot = validateProjectDiscoverySnapshot({
      schemaVersion: "1.0",
      id: snapshotId,
      discoveryId: command.discoveryId,
      revision: 1,
      generatedAt: appliedAt,
      status: "discovering",
      intent: {
        statement: command.intent.trim(),
        capturedAt: appliedAt,
        capturedBy: actor(origin),
      },
      questions: [],
      answers: [],
      commandReceipts: [{
        commandId: command.commandId,
        type: "discovery.start",
        actor: actor(origin),
        issuedAt,
        appliedAt,
        requestFingerprint,
        resultingSnapshot: { snapshotId, revision: 1 },
      }],
    });
    try {
      return await this.store.createInitial(snapshot);
    } catch (error) {
      if (!(error instanceof ProjectDiscoveryStoreConflictError)) throw error;
      const winner = await this.store.get(command.discoveryId);
      if (winner) {
        const replay = await this.replay(
          winner,
          command.commandId,
          requestFingerprint,
        );
        if (replay) return replay;
        throw new ProjectDiscoveryCommandError(
          "discovery_exists",
          `Project discovery ${command.discoveryId} was created concurrently.`,
        );
      }
      throw error;
    }
  }

  proposeQuestion(
    origin: ProjectDiscoveryCommandOrigin,
    command: ProposeProjectDiscoveryQuestionCommand,
  ): Promise<ProjectDiscoverySnapshot> {
    return this.apply(origin, "question.propose", command, (draft, appliedAt) => {
      assertDiscovering(draft);
      validateQuestionInput(command.question);
      if (draft.questions.some((item) => item.id === command.question.id)) {
        invalidInput(`Guided question ${command.question.id} already exists.`);
      }
      draft.questions.push({
        ...(structuredClone(command.question) as Mutable<
          ProjectDiscoveryQuestionProposalInput
        >),
        proposedAt: appliedAt,
        proposedBy: actor(origin),
      });
    });
  }

  recordAnswer(
    origin: ProjectDiscoveryCommandOrigin,
    command: RecordProjectDiscoveryAnswerCommand,
  ): Promise<ProjectDiscoverySnapshot> {
    return this.apply(origin, "answer.record", command, (draft, appliedAt) => {
      assertDiscovering(draft);
      validateAnswerInput(command.answer);
      if (origin.kind === "human" && command.answer.source.kind !== "human") {
        invalidInput(
          "A directly recorded human answer must declare source.kind=human.",
        );
      }
      if (draft.answers.some((item) => item.id === command.answer.id)) {
        invalidInput(`Reported answer ${command.answer.id} already exists.`);
      }
      const question = draft.questions.find((item) =>
        item.id === command.answer.questionId
      );
      if (!question) notFound("guided question", command.answer.questionId);
      if (
        command.answer.kind === "provided" &&
        !question.options.some((option) => option.value === command.answer.value)
      ) {
        invalidInput(
          `Answer ${command.answer.id} must use one of guided question ${question.id}'s bounded option values.`,
        );
      }
      if (command.answer.kind === "unknown" && !question.allowUnknown) {
        invalidInput(
          `Guided question ${question.id} does not allow an unknown answer.`,
        );
      }
      const current = currentProjectDiscoveryAnswer(draft, question.id);
      if (current?.id !== command.answer.supersedesAnswerId) {
        if (current) {
          invalidInput(
            `Answer ${command.answer.id} must explicitly supersede current answer ${current.id}.`,
          );
        }
        if (command.answer.supersedesAnswerId) {
          invalidInput(
            `Answer ${command.answer.id} cannot supersede a non-current answer.`,
          );
        }
      }
      draft.answers.push({
        ...structuredClone(command.answer),
        recordedAt: appliedAt,
        recordedBy: actor(origin),
      });
    });
  }

  proposeBrief(
    origin: ProjectDiscoveryCommandOrigin,
    command: ProposeProjectDiscoveryBriefCommand,
  ): Promise<ProjectDiscoverySnapshot> {
    return this.apply(origin, "brief.propose", command, async (draft, appliedAt) => {
      assertDiscovering(draft);
      validateBriefInput(command.brief);
      if (draft.brief?.id === command.brief.id) {
        invalidInput(
          `A revised brief needs a new id; ${command.brief.id} was already reviewed.`,
        );
      }
      const brief = {
        ...(structuredClone(command.brief) as Mutable<
          ProjectDiscoveryBriefInput
        >),
        proposedAt: appliedAt,
        proposedBy: actor(origin),
      };
      const inputFingerprint = await sha256Fingerprint({
        discoveryId: draft.discoveryId,
        baseRevision: draft.revision,
        intent: draft.intent,
        questions: draft.questions,
        answers: draft.answers,
        brief: command.brief,
      });
      draft.brief = brief;
      draft.review = {
        briefId: brief.id,
        status: "pending",
        inputFingerprint,
        requestedAt: appliedAt,
      };
      draft.status = "awaiting-review";
    });
  }

  approveBrief(
    origin: ProjectDiscoveryCommandOrigin,
    command: ReviewProjectDiscoveryBriefCommand,
  ): Promise<ProjectDiscoverySnapshot> {
    return this.decideBrief(origin, "brief.approve", command, "approved");
  }

  rejectBrief(
    origin: ProjectDiscoveryCommandOrigin,
    command: ReviewProjectDiscoveryBriefCommand,
  ): Promise<ProjectDiscoverySnapshot> {
    return this.decideBrief(origin, "brief.reject", command, "rejected");
  }

  private decideBrief(
    origin: ProjectDiscoveryCommandOrigin,
    type: "brief.approve" | "brief.reject",
    command: ReviewProjectDiscoveryBriefCommand,
    reviewStatus: "approved" | "rejected",
  ): Promise<ProjectDiscoverySnapshot> {
    return this.apply(origin, type, command, (draft, appliedAt) => {
      nonEmpty(command.rationale, "rationale");
      if (
        draft.status !== "awaiting-review" || !draft.brief || !draft.review ||
        draft.review.status !== "pending"
      ) {
        invalidTransition("The discovery brief is not awaiting human review.");
      }
      if (draft.brief.id !== command.briefId) {
        notFound("brief", command.briefId);
      }
      if (!fingerprintsEqual(draft.review.inputFingerprint, command.inputFingerprint)) {
        throw new ProjectDiscoveryCommandError(
          "review_scope_mismatch",
          `Brief ${command.briefId} no longer matches the reviewed discovery scope.`,
        );
      }
      draft.review.status = reviewStatus;
      draft.review.decidedAt = appliedAt;
      draft.review.decidedBy = actor(origin);
      draft.review.rationale = command.rationale.trim();
      draft.status = reviewStatus === "approved" ? "approved" : "revision-requested";
    });
  }

  private async apply<T extends ProjectDiscoveryMutationCommand>(
    origin: ProjectDiscoveryCommandOrigin,
    type: Exclude<ProjectDiscoveryCommandName, "discovery.start">,
    command: T,
    update: (
      draft: Mutable<ProjectDiscoverySnapshot>,
      appliedAt: string,
    ) => void | Promise<void>,
  ): Promise<ProjectDiscoverySnapshot> {
    validateOrigin(origin);
    assertAllowed(origin.kind, type);
    validateMutationContext(command);
    const issuedAt = requiredIsoDateTime(command.issuedAt, "issuedAt");
    const normalizedCommand = { ...command, issuedAt };
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command: normalizedCommand,
    });
    const current = await this.store.get(command.discoveryId);
    if (!current) {
      throw new ProjectDiscoveryCommandError(
        "discovery_not_found",
        `Project discovery ${command.discoveryId} does not exist.`,
      );
    }
    const replay = await this.replay(
      current,
      command.commandId,
      requestFingerprint,
    );
    if (replay) return replay;
    if (current.revision !== command.expectedRevision) {
      throw stale(command.discoveryId, command.expectedRevision, current.revision);
    }
    const appliedAt = requiredIsoDateTime(this.now(), "service clock");
    if (Date.parse(appliedAt) < Date.parse(current.generatedAt)) {
      invalidInput("The authoritative service clock moved backwards.");
    }
    const draft = structuredClone(current) as Mutable<ProjectDiscoverySnapshot>;
    await update(draft, appliedAt);
    const revision = current.revision + 1;
    const snapshotId = snapshotIdFor(
      current.discoveryId,
      revision,
      requestFingerprint,
    );
    draft.id = snapshotId;
    draft.revision = revision;
    draft.previous = { snapshotId: current.id, revision: current.revision };
    draft.generatedAt = appliedAt;
    draft.commandReceipts.push({
      commandId: command.commandId,
      type,
      actor: actor(origin),
      issuedAt,
      appliedAt,
      requestFingerprint,
      resultingSnapshot: { snapshotId, revision },
    });
    const next = validateProjectDiscoverySnapshot(draft);
    try {
      return await this.store.commit(next, current.revision);
    } catch (error) {
      if (!(error instanceof ProjectDiscoveryStoreConflictError)) throw error;
      const winner = await this.store.get(command.discoveryId);
      if (winner) {
        const concurrentReplay = await this.replay(
          winner,
          command.commandId,
          requestFingerprint,
        );
        if (concurrentReplay) return concurrentReplay;
        throw stale(command.discoveryId, command.expectedRevision, winner.revision);
      }
      throw error;
    }
  }

  private async replay(
    current: ProjectDiscoverySnapshot,
    commandId: string,
    fingerprint: ContentFingerprint,
  ): Promise<ProjectDiscoverySnapshot | undefined> {
    const receipt = current.commandReceipts.find((item) =>
      item.commandId === commandId
    );
    if (!receipt) return undefined;
    if (!fingerprintsEqual(receipt.requestFingerprint, fingerprint)) {
      throw new ProjectDiscoveryCommandError(
        "command_id_conflict",
        `Command id ${commandId} was already used for a different request.`,
      );
    }
    const result = await this.store.getRevision(
      current.discoveryId,
      receipt.resultingSnapshot.revision,
    );
    if (!result || result.id !== receipt.resultingSnapshot.snapshotId) {
      throw new ProjectDiscoveryCommandError(
        "command_id_conflict",
        `Command id ${commandId} has an invalid immutable result receipt.`,
      );
    }
    return result;
  }
}

function validateOrigin(origin: ProjectDiscoveryCommandOrigin): void {
  nonEmpty(origin.actorId, "origin.actorId");
}

function validateMutationContext(command: ProjectDiscoveryMutationCommand): void {
  nonEmpty(command.commandId, "commandId");
  safeId(command.discoveryId, "discoveryId");
  if (!Number.isSafeInteger(command.expectedRevision) || command.expectedRevision < 1) {
    invalidInput("expectedRevision must be a positive safe integer.");
  }
  requiredIsoDateTime(command.issuedAt, "issuedAt");
}

function validateQuestionInput(input: ProjectDiscoveryQuestionProposalInput): void {
  nonEmpty(input.id, "question.id");
  nonEmpty(input.prompt, "question.prompt");
  nonEmpty(input.whyItMatters, "question.whyItMatters");
  nonEmpty(input.recommendation.value, "question.recommendation.value");
  nonEmpty(input.recommendation.rationale, "question.recommendation.rationale");
  oneOf(
    input.recommendation.confidence,
    ["low", "medium", "high"],
    "question.recommendation.confidence",
  );
  if (!Array.isArray(input.options) || input.options.length === 0) {
    invalidInput("question.options must contain at least one bounded option.");
  }
  const values = new Set<string>();
  for (const [index, option] of input.options.entries()) {
    nonEmpty(option.value, `question.options[${index}].value`);
    nonEmpty(option.label, `question.options[${index}].label`);
    nonEmpty(option.consequences, `question.options[${index}].consequences`);
    if (values.has(option.value)) {
      invalidInput(`question option value ${option.value} is duplicated.`);
    }
    values.add(option.value);
  }
  if (!values.has(input.recommendation.value)) {
    invalidInput(
      "question.recommendation.value must match one bounded option value.",
    );
  }
  if (typeof input.allowUnknown !== "boolean") {
    invalidInput("question.allowUnknown must be boolean.");
  }
  oneOf(
    input.risk,
    ["reversible", "material", "safety-critical", "regulatory"],
    "question.risk",
  );
  stringArray(input.evidenceNeeded, "question.evidenceNeeded");
}

function validateAnswerInput(input: ProjectDiscoveryAnswerInput): void {
  nonEmpty(input.id, "answer.id");
  nonEmpty(input.questionId, "answer.questionId");
  oneOf(input.kind, ["provided", "unknown"], "answer.kind");
  if (input.kind === "provided") {
    nonEmpty(input.value, "answer.value");
  } else if (input.value !== undefined) {
    invalidInput("answer.value must be absent when answer.kind is unknown.");
  }
  if (input.explanation !== undefined) {
    nonEmpty(input.explanation, "answer.explanation");
  }
  if (input.supersedesAnswerId !== undefined) {
    nonEmpty(input.supersedesAnswerId, "answer.supersedesAnswerId");
  }
  oneOf(
    input.source.kind,
    ["human", "tool", "document", "expert"],
    "answer.source.kind",
  );
  nonEmpty(input.source.reference, "answer.source.reference");
}

function validateBriefInput(input: ProjectDiscoveryBriefInput): void {
  nonEmpty(input.id, "brief.id");
  nonEmpty(input.objective, "brief.objective");
  stringArray(input.missionScenarios, "brief.missionScenarios", true);
  stringArray(input.successCriteria, "brief.successCriteria", true);
  stringArray(input.constraints, "brief.constraints");
  stringArray(input.intendedMarkets, "brief.intendedMarkets");
  stringArray(
    input.manufacturingJurisdictions,
    "brief.manufacturingJurisdictions",
  );
  stringArray(input.operatingJurisdictions, "brief.operatingJurisdictions");
  stringArray(input.complianceTargets, "brief.complianceTargets");
  stringArray(input.verificationPlan, "brief.verificationPlan");
  stringArray(input.exclusions, "brief.exclusions");
  stringArray(input.assumptions, "brief.assumptions");
  stringArray(input.openQuestions, "brief.openQuestions");
}

function assertDiscovering(snapshot: ProjectDiscoverySnapshot): void {
  if (
    snapshot.status !== "discovering" &&
    snapshot.status !== "revision-requested"
  ) {
    invalidTransition(
      `Project discovery ${snapshot.discoveryId} cannot be edited from ${snapshot.status}.`,
    );
  }
}

function actor(origin: ProjectDiscoveryCommandOrigin): ProjectDiscoveryActor {
  return { id: origin.actorId, origin: origin.kind };
}

function assertAllowed(
  origin: ProjectDiscoveryActorOrigin,
  type: ProjectDiscoveryCommandName,
): void {
  const allowed: readonly string[] = PROJECT_DISCOVERY_COMMAND_POLICY[origin];
  if (!allowed.includes(type)) {
    throw new ProjectDiscoveryCommandError(
      "permission_denied",
      `${origin} origin cannot execute ${type}.`,
    );
  }
}

function snapshotIdFor(
  discoveryId: string,
  revision: number,
  fingerprint: ContentFingerprint,
): string {
  return `${discoveryId}:discovery:r${revision}:${fingerprint.digest.slice(0, 16)}`;
}

function requiredIsoDateTime(value: string, name: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/
      .test(value) ||
    !Number.isFinite(Date.parse(value))
  ) {
    invalidInput(`${name} must be an ISO date-time.`);
  }
  return new Date(Date.parse(value)).toISOString();
}

function safeId(value: string, name: string): void {
  nonEmpty(value, name);
  if (!/^[A-Za-z0-9]/.test(value) || value.toLowerCase() === "latest") {
    invalidInput(
      `${name} must begin with an ASCII alphanumeric character and cannot be latest.`,
    );
  }
}

function stringArray(
  values: readonly string[],
  name: string,
  requireNonEmpty = false,
): void {
  if (!Array.isArray(values) || (requireNonEmpty && values.length === 0)) {
    invalidInput(`${name} must ${requireNonEmpty ? "be a non-empty" : "be an"} array.`);
  }
  const unique = new Set<string>();
  for (const [index, value] of values.entries()) {
    nonEmpty(value, `${name}[${index}]`);
    if (unique.has(value)) invalidInput(`${name} contains a duplicated value.`);
    unique.add(value);
  }
}

function oneOf<const T extends readonly string[]>(
  value: string,
  choices: T,
  name: string,
): T[number] {
  if (!choices.includes(value)) {
    invalidInput(`${name} must be one of ${choices.join(", ")}.`);
  }
  return value as T[number];
}

function nonEmpty(value: string | undefined, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    invalidInput(`${name} cannot be empty.`);
  }
}

function invalidInput(message: string): never {
  throw new ProjectDiscoveryCommandError("invalid_input", message);
}

function invalidTransition(message: string): never {
  throw new ProjectDiscoveryCommandError("invalid_transition", message);
}

function notFound(kind: string, id: string): never {
  throw new ProjectDiscoveryCommandError(
    "entity_not_found",
    `Project discovery ${kind} ${id} does not exist.`,
  );
}

function stale(discoveryId: string, expected: number, actual: number) {
  return new ProjectDiscoveryCommandError(
    "stale_revision",
    `Project discovery ${discoveryId} expected revision ${expected}, current revision is ${actual}.`,
  );
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
