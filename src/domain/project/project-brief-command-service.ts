import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectRevisionStore,
  EngineeringProjectStoreConflictError,
} from "./engineering-project-command-service.ts";
import type {
  EngineeringApprovedBriefBasis,
  EngineeringProjectCommandName,
  EngineeringProjectSnapshot,
} from "./engineering-project.ts";
import { validateEngineeringProjectSnapshot } from "./engineering-project-validation.ts";
import { fingerprintsEqual, sha256Fingerprint } from "../kernel/deterministic-json.ts";
import {
  currentProjectAnswer,
  type ProjectAnswerSource,
  type ProjectBriefItem,
  projectBriefObjective,
  type ProjectBriefRevision,
  type ProjectBriefSourceRef,
  type ProjectQuestionConfidence,
  type ProjectQuestionOption,
  type ProjectQuestionRisk,
} from "./project-brief.ts";
import type { ContentFingerprint } from "../thread/thread-snapshot.ts";

export interface StartEngineeringProjectCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly issuedAt: string;
  readonly intent: string;
  readonly intentSource: {
    readonly kind: "human" | "document";
    readonly reference: string;
  };
}

export interface ProjectBriefMutationCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
}

export interface ProjectQuestionProposalInput {
  readonly id: string;
  readonly prompt: string;
  readonly whyItMatters: string;
  readonly recommendation: {
    readonly value: string;
    readonly rationale: string;
    readonly confidence: ProjectQuestionConfidence;
  };
  readonly options: readonly ProjectQuestionOption[];
  readonly allowUnknown: boolean;
  readonly risk: ProjectQuestionRisk;
  readonly evidenceNeeded: readonly string[];
}

export interface ProposeProjectQuestionCommand extends ProjectBriefMutationCommand {
  readonly question: ProjectQuestionProposalInput;
}

export interface ProjectAnswerInput {
  readonly id: string;
  readonly questionId: string;
  readonly kind: "provided" | "unknown";
  readonly value?: string;
  readonly explanation?: string;
  readonly source: ProjectAnswerSource;
  readonly supersedesAnswerId?: string;
}

export interface RecordProjectAnswerCommand extends ProjectBriefMutationCommand {
  readonly answer: ProjectAnswerInput;
}

export interface ProposeProjectBriefCommand extends ProjectBriefMutationCommand {
  readonly items: readonly ProjectBriefItem[];
}

export interface ReviewProjectBriefCommand extends ProjectBriefMutationCommand {
  readonly briefSnapshotId: string;
  readonly briefRevision: number;
  readonly rationale: string;
  readonly inputFingerprint: ContentFingerprint;
}

export const PROJECT_BRIEF_COMMAND_POLICY = {
  agent: [
    "project.start",
    "project.question-propose",
    "project.answer-record",
    "project.brief-propose",
  ],
  human: [
    "project.start",
    "project.answer-record",
    "project.brief-approve",
    "project.brief-reject",
  ],
} as const;

type ProjectBriefCommandName =
  | "project.start"
  | "project.question-propose"
  | "project.answer-record"
  | "project.brief-propose"
  | "project.brief-approve"
  | "project.brief-reject";

type Clock = () => string;

/**
 * Command boundary for the living brief inside one EngineeringProject.
 *
 * A project exists from the first intent. Agent proposals never replace the
 * current canonical brief; only an exact human review promotes a proposal.
 */
export class ProjectBriefCommandService {
  constructor(
    private readonly store: EngineeringProjectRevisionStore,
    private readonly now: Clock = () => new Date().toISOString(),
  ) {}

  async startProject(
    origin: EngineeringProjectCommandOrigin,
    command: StartEngineeringProjectCommand,
  ): Promise<EngineeringProjectSnapshot> {
    validateOrigin(origin);
    assertAllowed(origin.kind, "project.start");
    const normalized = normalizeStartCommand(command);
    const requestFingerprint = await sha256Fingerprint({
      type: "project.start",
      origin,
      command: normalized,
    });
    const existing = await this.store.get(normalized.projectId);
    if (existing) {
      const replay = await this.replay(
        existing,
        normalized.commandId,
        requestFingerprint,
      );
      if (replay) return replay;
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Engineering project ${normalized.projectId} already exists.`,
      );
    }
    const appliedAt = authoritativeTime(this.now());
    if (Date.parse(normalized.issuedAt) > Date.parse(appliedAt)) {
      invalidInput("issuedAt cannot be later than the authoritative service clock.");
    }
    const snapshotId = projectSnapshotId(
      normalized.projectId,
      1,
      requestFingerprint,
    );
    const initial = validateEngineeringProjectSnapshot({
      schemaVersion: "3.0",
      id: snapshotId,
      revision: 1,
      generatedAt: appliedAt,
      project: {
        id: normalized.projectId,
        name: normalized.projectName,
        subjectId: `project:${normalized.projectId}`,
        objective: {
          title: normalized.intent,
          statement: normalized.intent,
        },
      },
      framing: {
        intent: {
          statement: normalized.intent,
          source: structuredClone(normalized.intentSource),
          capturedAt: appliedAt,
          capturedBy: actor(origin),
        },
        questions: [],
        answers: [],
      },
      threadSnapshots: [],
      phases: [],
      workItems: [],
      agentRuns: [],
      decisions: [],
      approvals: [],
      blockers: [],
      commandReceipts: [{
        commandId: normalized.commandId,
        type: "project.start",
        actor: actor(origin),
        issuedAt: normalized.issuedAt,
        appliedAt,
        requestFingerprint,
        resultingSnapshot: { snapshotId, revision: 1 },
      }],
    });
    try {
      return await this.store.createInitial(initial);
    } catch (error) {
      if (!(error instanceof EngineeringProjectStoreConflictError)) throw error;
      const winner = await this.store.get(normalized.projectId);
      if (winner) {
        const replay = await this.replay(
          winner,
          normalized.commandId,
          requestFingerprint,
        );
        if (replay) return replay;
      }
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Engineering project ${normalized.projectId} was created concurrently.`,
      );
    }
  }

  proposeQuestion(
    origin: EngineeringProjectCommandOrigin,
    command: ProposeProjectQuestionCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.question-propose",
      command,
      (draft, appliedAt) => {
        const framing = requireV3Framing(draft);
        validateQuestion(command.question);
        if (framing.questions.some((item) => item.id === command.question.id)) {
          invalidInput(`Project question ${command.question.id} already exists.`);
        }
        framing.questions.push({
          id: command.question.id,
          prompt: command.question.prompt,
          whyItMatters: command.question.whyItMatters,
          recommendation: { ...command.question.recommendation },
          options: command.question.options.map((option) => ({ ...option })),
          allowUnknown: command.question.allowUnknown,
          risk: command.question.risk,
          evidenceNeeded: [...command.question.evidenceNeeded],
          proposedAt: appliedAt,
          proposedBy: actor(origin),
        });
      },
    );
  }

  recordAnswer(
    origin: EngineeringProjectCommandOrigin,
    command: RecordProjectAnswerCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.answer-record",
      command,
      (draft, appliedAt) => {
        const framing = requireV3Framing(draft);
        validateAnswer(command.answer);
        if (origin.kind === "human" && command.answer.source.kind !== "human") {
          invalidInput(
            "A directly recorded human answer must declare source.kind=human.",
          );
        }
        if (framing.answers.some((item) => item.id === command.answer.id)) {
          invalidInput(`Project answer ${command.answer.id} already exists.`);
        }
        const question = framing.questions.find((item) =>
          item.id === command.answer.questionId
        );
        if (!question) notFound("question", command.answer.questionId);
        if (
          command.answer.kind === "provided" &&
          !question.options.some((option) => option.value === command.answer.value)
        ) {
          invalidInput(
            `Answer ${command.answer.id} must use one bounded option from question ${question.id}.`,
          );
        }
        if (command.answer.kind === "unknown" && !question.allowUnknown) {
          invalidInput(`Project question ${question.id} does not allow unknown.`);
        }
        const current = currentProjectAnswer(framing, question.id);
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
        framing.answers.push({
          ...structuredClone(command.answer),
          recordedAt: appliedAt,
          recordedBy: actor(origin),
        });
      },
    );
  }

  proposeBrief(
    origin: EngineeringProjectCommandOrigin,
    command: ProposeProjectBriefCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(
      origin,
      "project.brief-propose",
      command,
      async (draft, appliedAt) => {
        const framing = requireV3Framing(draft);
        validateBriefItems(command.items);
        const prior = framing.proposedBrief ?? framing.currentBrief;
        const revision = (prior?.revision ?? 0) + 1;
        const briefId = `${draft.project.id}:brief`;
        const contentFingerprint = await sha256Fingerprint({
          briefId,
          revision,
          previous: prior
            ? { snapshotId: prior.id, revision: prior.revision }
            : undefined,
          items: command.items,
          proposedAt: appliedAt,
          proposedBy: actor(origin),
        });
        const proposal: Mutable<ProjectBriefRevision> = {
          briefId,
          id: `${briefId}:r${revision}:${contentFingerprint.digest.slice(0, 16)}`,
          revision,
          items: command.items.map((item) => ({
            ...item,
            sourceRefs: item.sourceRefs.map((source) => ({ ...source })),
          })),
          proposedAt: appliedAt,
          proposedBy: actor(origin),
        };
        if (prior) {
          proposal.previous = {
            snapshotId: prior.id,
            revision: prior.revision,
          };
        }
        const inputFingerprint = await briefReviewFingerprint(
          draft,
          proposal,
        );
        framing.proposedBrief = proposal;
        framing.proposalReview = {
          briefSnapshotId: proposal.id,
          briefRevision: proposal.revision,
          status: "pending",
          inputFingerprint,
          requestedAt: appliedAt,
        };
      },
    );
  }

  approveBrief(
    origin: EngineeringProjectCommandOrigin,
    command: ReviewProjectBriefCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.decideBrief(
      origin,
      "project.brief-approve",
      command,
      "approved",
    );
  }

  rejectBrief(
    origin: EngineeringProjectCommandOrigin,
    command: ReviewProjectBriefCommand,
  ): Promise<EngineeringProjectSnapshot> {
    return this.decideBrief(
      origin,
      "project.brief-reject",
      command,
      "rejected",
    );
  }

  private decideBrief(
    origin: EngineeringProjectCommandOrigin,
    type: "project.brief-approve" | "project.brief-reject",
    command: ReviewProjectBriefCommand,
    status: "approved" | "rejected",
  ): Promise<EngineeringProjectSnapshot> {
    return this.apply(origin, type, command, (draft, appliedAt) => {
      nonEmpty(command.rationale, "rationale");
      const framing = requireV3Framing(draft);
      const proposal = framing.proposedBrief;
      const review = framing.proposalReview;
      if (!proposal || !review || review.status !== "pending") {
        invalidTransition("The project brief is not awaiting human review.");
      }
      if (
        proposal.id !== command.briefSnapshotId ||
        proposal.revision !== command.briefRevision
      ) {
        notFound("brief revision", command.briefSnapshotId);
      }
      if (!fingerprintsEqual(review.inputFingerprint, command.inputFingerprint)) {
        throw new EngineeringProjectCommandError(
          "approval_scope_mismatch",
          `Brief ${proposal.id} no longer matches the reviewed input.`,
        );
      }
      const proposalReceipt = draft.commandReceipts?.find((receipt) =>
        receipt.type === "project.brief-propose" &&
        receipt.resultingSnapshot.revision === draft.revision
      );
      if (!proposalReceipt) {
        invalidTransition(
          "The project changed after this brief was proposed; publish a fresh brief revision before review.",
        );
      }
      if (status === "approved") {
        framing.currentBrief = structuredClone(proposal);
        framing.currentBriefApproval = {
          ...structuredClone(review),
          status: "approved",
          decidedAt: appliedAt,
          decidedBy: actor(origin),
          rationale: command.rationale.trim(),
        };
        delete framing.proposedBrief;
        delete framing.proposalReview;
        const objective = projectBriefObjective(proposal);
        draft.project.objective = { title: objective, statement: objective };
      } else {
        framing.proposalReview = {
          ...structuredClone(review),
          status: "rejected",
          decidedAt: appliedAt,
          decidedBy: actor(origin),
          rationale: command.rationale.trim(),
        };
      }
    });
  }

  private async apply<T extends ProjectBriefMutationCommand>(
    origin: EngineeringProjectCommandOrigin,
    type: Exclude<ProjectBriefCommandName, "project.start">,
    command: T,
    update: (
      draft: Mutable<EngineeringProjectSnapshot>,
      appliedAt: string,
    ) => void | Promise<void>,
  ): Promise<EngineeringProjectSnapshot> {
    validateOrigin(origin);
    assertAllowed(origin.kind, type);
    const normalized = normalizeMutationCommand(command);
    const requestFingerprint = await sha256Fingerprint({
      type,
      origin,
      command: normalized,
    });
    const current = await this.store.get(normalized.projectId);
    if (!current) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${normalized.projectId} does not exist.`,
      );
    }
    const replay = await this.replay(
      current,
      normalized.commandId,
      requestFingerprint,
    );
    if (replay) return replay;
    if (current.revision !== normalized.expectedRevision) {
      throw stale(
        normalized.projectId,
        normalized.expectedRevision,
        current.revision,
      );
    }
    const appliedAt = authoritativeTime(this.now());
    if (Date.parse(appliedAt) < Date.parse(current.generatedAt)) {
      invalidInput("The authoritative service clock moved backwards.");
    }
    if (Date.parse(normalized.issuedAt) > Date.parse(appliedAt)) {
      invalidInput("issuedAt cannot be later than the authoritative service clock.");
    }
    const draft = structuredClone(current) as Mutable<EngineeringProjectSnapshot>;
    await update(draft, appliedAt);
    const revision = current.revision + 1;
    const snapshotId = projectSnapshotId(
      current.project.id,
      revision,
      requestFingerprint,
    );
    draft.id = snapshotId;
    draft.revision = revision;
    draft.previous = { snapshotId: current.id, revision: current.revision };
    draft.generatedAt = appliedAt;
    draft.commandReceipts ??= [];
    const approvedBriefBasis = type === "project.brief-approve"
      ? approvedBriefBasisForReceipt(draft, snapshotId, revision)
      : undefined;
    draft.commandReceipts.push({
      commandId: normalized.commandId,
      type: type as EngineeringProjectCommandName,
      actor: actor(origin),
      issuedAt: normalized.issuedAt,
      appliedAt,
      requestFingerprint,
      resultingSnapshot: { snapshotId, revision },
      ...(approvedBriefBasis ? { approvedBriefBasis } : {}),
    });
    const next = validateEngineeringProjectSnapshot(draft);
    try {
      return await this.store.commit(next, current.revision);
    } catch (error) {
      if (!(error instanceof EngineeringProjectStoreConflictError)) throw error;
      const winner = await this.store.get(normalized.projectId);
      if (winner) {
        const concurrentReplay = await this.replay(
          winner,
          normalized.commandId,
          requestFingerprint,
        );
        if (concurrentReplay) return concurrentReplay;
        throw stale(
          normalized.projectId,
          normalized.expectedRevision,
          winner.revision,
        );
      }
      throw error;
    }
  }

  private async replay(
    current: EngineeringProjectSnapshot,
    commandId: string,
    fingerprint: ContentFingerprint,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const receipt = current.commandReceipts?.find((item) =>
      item.commandId === commandId
    );
    if (!receipt) return undefined;
    if (!fingerprintsEqual(receipt.requestFingerprint, fingerprint)) {
      throw new EngineeringProjectCommandError(
        "command_id_conflict",
        `Command id ${commandId} was already used for a different request.`,
      );
    }
    const result = await this.store.getRevision(
      current.project.id,
      receipt.resultingSnapshot.revision,
    );
    if (!result || result.id !== receipt.resultingSnapshot.snapshotId) {
      throw new EngineeringProjectCommandError(
        "command_id_conflict",
        `Command id ${commandId} has an invalid immutable result receipt.`,
      );
    }
    return result;
  }
}

function approvedBriefBasisForReceipt(
  project: EngineeringProjectSnapshot,
  projectSnapshotId: string,
  projectRevision: number,
): EngineeringApprovedBriefBasis {
  const framing = project.framing;
  const brief = framing?.currentBrief;
  const approval = framing?.currentBriefApproval;
  if (
    project.schemaVersion !== "3.0" || !brief || !approval ||
    approval.status !== "approved"
  ) {
    invalidTransition(
      "A project.brief-approve receipt requires the exact approved canonical brief.",
    );
  }
  return {
    kind: "approved-brief",
    projectId: project.project.id,
    projectSnapshotId,
    projectRevision,
    briefId: brief.briefId,
    briefSnapshotId: brief.id,
    briefRevision: brief.revision,
    approvedBriefFingerprint: structuredClone(approval.inputFingerprint),
  };
}

async function briefReviewFingerprint(
  project: EngineeringProjectSnapshot,
  proposal: ProjectBriefRevision,
): Promise<ContentFingerprint> {
  const framing = requireV3Framing(project);
  return await sha256Fingerprint({
    projectId: project.project.id,
    baseProjectRevision: project.revision,
    intent: framing.intent,
    questions: framing.questions,
    answers: framing.answers,
    currentBrief: framing.currentBrief,
    proposedBrief: proposal,
  });
}

function requireV3Framing(
  project: EngineeringProjectSnapshot,
): Mutable<NonNullable<EngineeringProjectSnapshot["framing"]>> {
  if (project.schemaVersion !== "3.0" || !project.framing) {
    invalidTransition(
      "Living project-brief commands require a V3 project created from intent.",
    );
  }
  return project.framing as Mutable<NonNullable<EngineeringProjectSnapshot["framing"]>>;
}

function normalizeStartCommand(
  command: StartEngineeringProjectCommand,
): StartEngineeringProjectCommand {
  nonEmpty(command.commandId, "commandId");
  safeId(command.projectId, "projectId");
  nonEmpty(command.projectName, "projectName");
  nonEmpty(command.intent, "intent");
  if (
    command.intentSource.kind !== "human" &&
    command.intentSource.kind !== "document"
  ) {
    invalidInput("intentSource.kind must be human or document.");
  }
  nonEmpty(command.intentSource.reference, "intentSource.reference");
  return {
    ...command,
    commandId: command.commandId.trim(),
    projectId: command.projectId.trim(),
    projectName: command.projectName.trim(),
    intent: command.intent.trim(),
    issuedAt: requiredIsoDateTime(command.issuedAt, "issuedAt"),
    intentSource: {
      kind: command.intentSource.kind,
      reference: command.intentSource.reference.trim(),
    },
  };
}

function normalizeMutationCommand<T extends ProjectBriefMutationCommand>(
  command: T,
): T {
  nonEmpty(command.commandId, "commandId");
  safeId(command.projectId, "projectId");
  if (
    !Number.isSafeInteger(command.expectedRevision) ||
    command.expectedRevision < 1
  ) {
    invalidInput("expectedRevision must be a positive safe integer.");
  }
  return {
    ...command,
    commandId: command.commandId.trim(),
    projectId: command.projectId.trim(),
    issuedAt: requiredIsoDateTime(command.issuedAt, "issuedAt"),
  };
}

function validateQuestion(input: ProjectQuestionProposalInput): void {
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
  const optionValues = new Set<string>();
  for (const [index, option] of input.options.entries()) {
    nonEmpty(option.value, `question.options[${index}].value`);
    nonEmpty(option.label, `question.options[${index}].label`);
    nonEmpty(option.consequences, `question.options[${index}].consequences`);
    if (optionValues.has(option.value)) {
      invalidInput(`question option ${option.value} is duplicated.`);
    }
    optionValues.add(option.value);
  }
  if (!optionValues.has(input.recommendation.value)) {
    invalidInput("question recommendation must match one bounded option.");
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

function validateAnswer(input: ProjectAnswerInput): void {
  nonEmpty(input.id, "answer.id");
  nonEmpty(input.questionId, "answer.questionId");
  oneOf(input.kind, ["provided", "unknown"], "answer.kind");
  if (input.kind === "provided") nonEmpty(input.value, "answer.value");
  if (input.kind === "unknown" && input.value !== undefined) {
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

function validateBriefItems(items: readonly ProjectBriefItem[]): void {
  if (!Array.isArray(items) || items.length === 0) {
    invalidInput("items must contain a structured project brief.");
  }
  const ids = new Set<string>();
  let objectives = 0;
  let missions = 0;
  let successCriteria = 0;
  for (const [index, item] of items.entries()) {
    nonEmpty(item.id, `items[${index}].id`);
    if (ids.has(item.id)) invalidInput(`Brief item id ${item.id} is duplicated.`);
    ids.add(item.id);
    oneOf(
      item.kind,
      [
        "objective",
        "primary-user",
        "mission-scenario",
        "operating-environment",
        "success-criterion",
        "constraint",
        "exclusion",
        "intended-market",
        "manufacturing-jurisdiction",
        "operating-jurisdiction",
        "compliance-target",
        "verification-activity",
        "manufacturing-evidence",
        "observed-fact",
        "assumption",
        "open-question",
        "proposed-decision",
      ],
      `items[${index}].kind`,
    );
    nonEmpty(item.statement, `items[${index}].statement`);
    if (!Array.isArray(item.sourceRefs) || item.sourceRefs.length === 0) {
      invalidInput(`items[${index}].sourceRefs must contain at least one source.`);
    }
    for (const [sourceIndex, source] of item.sourceRefs.entries()) {
      oneOf(
        source.kind,
        ["intent", "answer", "tool", "document", "expert"],
        `items[${index}].sourceRefs[${sourceIndex}].kind`,
      );
      nonEmpty(
        source.reference,
        `items[${index}].sourceRefs[${sourceIndex}].reference`,
      );
    }
    if (item.kind === "objective") objectives++;
    if (item.kind === "mission-scenario") missions++;
    if (item.kind === "success-criterion") successCriteria++;
    if (item.kind === "assumption") {
      nonEmpty(item.owner, `items[${index}].owner`);
      nonEmpty(item.reviewTrigger, `items[${index}].reviewTrigger`);
    }
    if (
      item.kind === "observed-fact" &&
      !item.sourceRefs.some((source: ProjectBriefSourceRef) =>
        source.kind === "tool" || source.kind === "document" ||
        source.kind === "expert"
      )
    ) {
      invalidInput(
        `Observed fact ${item.id} requires a tool, document or expert source.`,
      );
    }
  }
  if (objectives !== 1) invalidInput("A project brief needs exactly one objective.");
  if (missions === 0) invalidInput("A project brief needs a mission scenario.");
  if (successCriteria === 0) {
    invalidInput("A project brief needs a measurable success criterion.");
  }
}

function actor(origin: EngineeringProjectCommandOrigin) {
  return { id: origin.actorId, origin: origin.kind };
}

function validateOrigin(origin: EngineeringProjectCommandOrigin): void {
  nonEmpty(origin.actorId, "origin.actorId");
}

function assertAllowed(
  origin: "human" | "agent",
  type: ProjectBriefCommandName,
): void {
  const allowed: readonly string[] = PROJECT_BRIEF_COMMAND_POLICY[origin];
  if (!allowed.includes(type)) {
    throw new EngineeringProjectCommandError(
      "permission_denied",
      `${origin} origin cannot execute ${type}.`,
    );
  }
}

function projectSnapshotId(
  projectId: string,
  revision: number,
  fingerprint: ContentFingerprint,
): string {
  return `${projectId}:project:r${revision}:${fingerprint.digest.slice(0, 16)}`;
}

function authoritativeTime(value: string): string {
  return requiredIsoDateTime(value, "service clock");
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
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value.trim()) ||
    value.trim().toLowerCase() === "latest"
  ) {
    invalidInput(
      `${name} must be a stable ASCII identifier and cannot be latest.`,
    );
  }
}

function stringArray(value: readonly string[], name: string): void {
  if (!Array.isArray(value)) invalidInput(`${name} must be an array.`);
  value.forEach((item, index) => nonEmpty(item, `${name}[${index}]`));
}

function oneOf<T extends string>(
  value: unknown,
  allowed: readonly T[],
  name: string,
): asserts value is T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    invalidInput(`${name} must be one of ${allowed.join(", ")}.`);
  }
}

function nonEmpty(value: string | undefined, name: string): void {
  if (typeof value !== "string" || !value.trim()) {
    invalidInput(`${name} cannot be empty.`);
  }
}

function invalidInput(message: string): never {
  throw new EngineeringProjectCommandError("invalid_input", message);
}

function invalidTransition(message: string): never {
  throw new EngineeringProjectCommandError("invalid_transition", message);
}

function notFound(kind: string, id: string): never {
  throw new EngineeringProjectCommandError(
    "entity_not_found",
    `Engineering ${kind} ${id} does not exist.`,
  );
}

function stale(projectId: string, expected: number, actual: number) {
  return new EngineeringProjectCommandError(
    "stale_revision",
    `Engineering project ${projectId} expected revision ${expected}, current revision is ${actual}.`,
  );
}

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> }
  : T;
