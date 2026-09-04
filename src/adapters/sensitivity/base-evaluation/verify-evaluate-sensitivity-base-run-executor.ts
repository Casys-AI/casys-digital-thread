/**
 * Trusted executor for `verify.evaluate-sensitivity-base@1`.
 *
 * Reopens one sensitivity-study capture, joins each declared metric to the
 * unique Thread requirement of the same id and to the study-base observation,
 * then asks SysON to evaluate. It never solves, never maps proof-run
 * observations, and never publishes a partial set.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { buildConstraintAst } from "../../../domain/kernel/proof-case.ts";
import {
  resolveSensitivityBaseJoin,
  VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
} from "../../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import {
  type SensitivityStudyResult,
  validateSensitivityStudyResult,
} from "../../../domain/sensitivity/study/sensitivity-study-result.ts";
import { sha256Fingerprint } from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { requirementEvaluationIdentity } from "../../../domain/thread/requirement-evaluation-identity.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadSnapshot,
  ThreadViolation,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import { parseOracleOutcome } from "../../shared/syson-constraint-oracle-outcome.ts";
import {
  canonicalSensitivityBaseEvaluationCaptureText,
  SENSITIVITY_BASE_EVALUATION_CAPTURE_SCHEMA,
  SENSITIVITY_BASE_EVALUATION_CAPTURE_URI_PREFIX,
  type SensitivityBaseEvaluationCapture,
  validateSensitivityBaseEvaluationCapture,
} from "./sensitivity-base-evaluation-capture.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../../shared/thread-write-basis-guard.ts";

export { VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION };

export interface SensitivityStudyCaptureStore {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

export interface SensitivityBaseEvaluationCaptureStore {
  save(fingerprint: ContentFingerprint, canonicalText: string): Promise<unknown>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

export interface VerifyEvaluateSensitivityBaseRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface VerifyEvaluateSensitivityBaseRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ThreadSnapshotStore;
  readonly studyCaptures: SensitivityStudyCaptureStore;
  readonly captures: SensitivityBaseEvaluationCaptureStore;
  readonly syson: McpToolClient;
  readonly lease: EngineeringProjectRunLease;
  /** Cold server-owned authorization recheck for the fixed SysON binding. */
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** Starts the sealed JIT group before run/WAL/SysON mutation. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
}

export class VerifyEvaluateSensitivityBaseRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: VerifyEvaluateSensitivityBaseRunExecutorDependencies["commands"];
  readonly #snapshots: ThreadSnapshotStore;
  readonly #studyCaptures: SensitivityStudyCaptureStore;
  readonly #captures: SensitivityBaseEvaluationCaptureStore;
  readonly #syson: McpToolClient;
  readonly #lease: EngineeringProjectRunLease;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;

  constructor(dependencies: VerifyEvaluateSensitivityBaseRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#studyCaptures = dependencies.studyCaptures;
    this.#captures = dependencies.captures;
    this.#syson = dependencies.syson;
    this.#lease = dependencies.lease;
    this.#capabilityRuntime = dependencies.capabilityRuntime;
    this.#capabilityRuntimeSession = dependencies.capabilityRuntimeSession;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateSensitivityBaseRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the verify-evaluate-sensitivity-base run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    requireMrtrApproval(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateSensitivityBaseRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      const preRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preRun);
      if (preRun.status === "completed") return preClaim;
      await assertThreadWriteBasisAvailable(preClaim, preRun);
      const operationalCapability = await this.#requireOperationalCapability(
        preClaim,
        preRun,
      );
      // JIT activation is deliberately pre-claim: a denied or unavailable
      // host must not alter the work item, run, WAL, or SysON state.
      capabilitySession = await beginConfiguredCapabilityRuntimeSession({
        session: this.#capabilityRuntimeSession!,
        project: preClaim,
        runId: command.runId,
        operationalCapability,
        recheck: async () => {
          const fresh = await this.#requiredProject(command.projectId);
          const run = requireRun(fresh, command.runId);
          requireShape(fresh, run);
          return await this.#requireOperationalCapability(fresh, run);
        },
      });
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: `${command.commandId}:claim`,
        summary: "Started the study-base requirement evaluation.",
      });
      claimed = true;
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      const studyArtifact = requireBoundArtifact(
        project,
        run,
        basisSnapshot,
        "studyCapture",
      );
      const captureText = await this.#studyCaptures.read(studyArtifact.fingerprint);
      if (!captureText) {
        throw invalidTransition("The sensitivity-study capture is not readable.");
      }
      const studyCapture = await validateSensitivityStudyResult(
        JSON.parse(captureText),
      );
      const digest = studyArtifact.fingerprint.digest;
      const join = resolveSensitivityBaseJoin({
        capture: studyCapture,
        digest,
        observations: basisSnapshot.observations,
        requirements: basisSnapshot.requirements,
      });
      if (join.status !== "resolved") {
        throw invalidTransition(join.detail);
      }

      const request = prepareOracleRequest(join.pairs);
      const result = await this.#syson.callTool({
        name: request.name,
        arguments: request.arguments,
      });
      const envelope: SensitivityBaseEvaluationCapture = {
        schemaVersion: SENSITIVITY_BASE_EVALUATION_CAPTURE_SCHEMA,
        operation: VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION,
        studyDigest: digest,
        request,
        response: { structuredContent: result.structuredContent },
      };
      const canonical = canonicalSensitivityBaseEvaluationCaptureText(envelope);
      const fingerprint = await sha256Fingerprint(
        validateSensitivityBaseEvaluationCapture(JSON.parse(canonical)),
      );
      await this.#captures.save(fingerprint, canonical);
      const reread = await this.#captures.read(fingerprint);
      if (reread !== canonical) {
        throw invalidTransition(
          "The sensitivity-base evaluation capture could not be reread bit-identically.",
        );
      }
      const outcomes = parseOracleOutcome(
        validateSensitivityBaseEvaluationCapture(JSON.parse(reread)).response
          .structuredContent,
        join.pairs.map((pair) => ({
          id: pair.requirement.id,
          name: pair.requirement.name,
          metric: pair.requirement.criterion.metric,
          operator: pair.requirement.criterion.operator as "<=" | ">=",
          limit: pair.requirement.criterion.limit,
        })),
      );
      if ([...outcomes.values()].some((item) => item.status === "error")) {
        throw invalidTransition(
          "SysON returned an error status; error never becomes pass or fail.",
        );
      }

      const successor = buildSuccessor({
        basisSnapshot,
        basis,
        run,
        studyArtifact,
        studyCapture,
        pairs: join.pairs,
        outcomes,
        fingerprint,
        uri: this.#captures.uriFor(fingerprint),
      });
      await this.#snapshots.save(successor.snapshot);
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "completed") {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return project;
      }
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: `${command.commandId}:publish`,
          expectedRevision: project.revision,
          summary: "Publishing study-base evaluations.",
        });
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        const completed = await this.#commands.completeRun(origin, {
          ...command,
          commandId: `${command.commandId}:complete`,
          expectedRevision: project.revision,
          summary: "Published study-base evaluations.",
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact",
            id: successor.artifact.id,
          }],
        });
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return completed;
      }
      if (run.status === "completed") {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return project;
      }
      throw unexpectedStatus(run, "completed");
    } catch (error) {
      if (claimed) {
        await this.#recordFailure(origin, command, error);
      }
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: {
          kind: "release-if-terminal",
          run: await this.#currentRun(command.projectId, command.runId),
        },
      });
      throw error;
    }
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "entity_not_found",
        `Project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: VerifyEvaluateSensitivityBaseRunExecutorCommand,
    error: unknown,
  ): Promise<void> {
    try {
      const project = await this.#requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (run.status !== "running" && run.status !== "publishing") return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: `${command.commandId}:fail`,
        expectedRevision: project.revision,
        summary: "Study-base evaluation stopped before a Thread write completed.",
        code: error instanceof EngineeringProjectCommandError
          ? error.code
          : "internal_error",
        message: error instanceof Error ? error.message : String(error),
      });
    } catch {
      // Preserve the original failure.
    }
  }

  async #requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ) {
    requireShape(project, run);
    const workItem = project.workItems.find((item) => item.id === run.workItemId);
    if (!workItem) {
      throw invalidTransition("Study-base evaluation work item is not present.");
    }
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.#capabilityRuntime,
        session: this.#capabilityRuntimeSession,
        project,
        run,
        workItem,
        unavailableMessage:
          "Study-base evaluation requires the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Study-base evaluation requires the sealed model.evaluate-requirement@1 operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw invalidTransition(error.message);
      }
      throw error;
    }
  }

  async #currentRun(projectId: string, runId: string) {
    try {
      return requireRun(await this.#requiredProject(projectId), runId);
    } catch {
      return undefined;
    }
  }
}

function prepareOracleRequest(
  pairs: readonly {
    readonly requirement: {
      readonly id: string;
      readonly name: string;
      readonly criterion: {
        readonly metric: string;
        readonly operator: string;
        readonly limit: { readonly value: number; readonly unit: string };
      };
    };
    readonly observation: {
      readonly quantity: { readonly value: number; readonly unit: string };
    };
  }[],
): SensitivityBaseEvaluationCapture["request"] {
  const constraints = pairs.map((pair) =>
    buildConstraintAst({
      id: pair.requirement.id,
      name: pair.requirement.name,
      metric: pair.requirement.criterion.metric,
      operator: pair.requirement.criterion.operator as "<=" | ">=",
      limit: pair.requirement.criterion.limit,
    })
  );
  const values: Record<string, { readonly value: number; readonly unit: string }> = {};
  for (const pair of pairs) {
    values[pair.requirement.criterion.metric] = pair.observation.quantity;
  }
  return {
    name: "syson_constraint_evaluate",
    arguments: { constraints, values },
  };
}

function buildSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly studyArtifact: ThreadArtifact;
  readonly studyCapture: SensitivityStudyResult;
  readonly pairs: readonly {
    readonly metricId: string;
    readonly requirement: ThreadSnapshot["requirements"][number];
    readonly observation: ThreadSnapshot["observations"][number];
  }[];
  readonly outcomes: ReturnType<typeof parseOracleOutcome>;
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const capturedAt = requiredStart(input.run);
  const artifactId = `sensitivity-base-evaluation-${input.fingerprint.digest}`;
  const operationRef = {
    serverId: "syson",
    tool:
      `${VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id}@${VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: artifactId,
    name: `Study-base evaluation ${input.studyCapture.studyCase.id}`,
    kind: "evidence",
    version: input.fingerprint.digest,
    fingerprint: input.fingerprint,
    uri: input.uri.startsWith(SENSITIVITY_BASE_EVALUATION_CAPTURE_URI_PREFIX)
      ? input.uri
      : `${SENSITIVITY_BASE_EVALUATION_CAPTURE_URI_PREFIX}${input.fingerprint.digest}`,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.studyArtifact.id],
    freshness: {
      status: "fresh",
      changedAt: capturedAt,
      invalidatedByChangeIds: [],
    },
  };
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [] as const,
  };
  const evaluations: RequirementEvaluation[] = input.pairs.map((pair) => {
    const outcome = input.outcomes.get(pair.requirement.id);
    if (!outcome) {
      throw invalidTransition(
        `SysON returned no outcome for requirement "${pair.requirement.id}".`,
      );
    }
    const id = requirementEvaluationIdentity({
      requirementId: pair.requirement.id,
      evidenceFingerprint: input.fingerprint,
    }).id;
    const base: RequirementEvaluation = {
      id,
      name: `${pair.requirement.name} study-base evaluation`,
      requirementId: pair.requirement.id,
      observationIds: [pair.observation.id],
      status: outcome.status,
      evaluatedAt: capturedAt,
      evaluator: {
        serverId: "syson",
        tool: "syson_constraint_evaluate",
        runId: input.run.id,
      },
      evidenceArtifactIds: [artifactId],
      message: evaluationMessage(outcome.status),
      freshness,
    };
    if (outcome.status === "pass" || outcome.status === "fail") {
      return {
        ...base,
        comparison: {
          observationId: pair.observation.id,
          actual: { value: outcome.computedValue, unit: outcome.unit },
          operator: pair.requirement.criterion.operator,
          limit: { value: outcome.threshold, unit: outcome.unit },
          normalizedUnit: outcome.unit,
          margin: { value: outcome.margin, unit: outcome.unit },
        },
      };
    }
    return base;
  });
  const violations: ThreadViolation[] = evaluations.flatMap((evaluation) => {
    if (evaluation.status !== "fail") return [];
    return [{
      id: `${evaluation.id}-violation`,
      name: `${evaluation.name} failed`,
      requirementId: evaluation.requirementId,
      evaluationId: evaluation.id,
      severity: "error" as const,
      status: "open" as const,
      detectedAt: capturedAt,
      observationIds: evaluation.observationIds,
      evidenceArtifactIds: [artifactId],
      summary: evaluation.message ??
        "The study-base observation exceeds the reviewed limit.",
      freshness,
    }];
  });
  const consumeId = `consume-${input.studyArtifact.id}-by-${artifact.id}`;
  const proposedActions = violations.map((violation) => ({
    id: `${violation.id}-action`,
    name: `Review the study-base violation: ${violation.name}`,
    kind: "review" as const,
    readiness: "ready" as const,
    rationale:
      "A study-base observation failed a named requirement; correction review is possible.",
    targets: [{ kind: "artifact" as const, id: artifact.id }],
    addressesViolationIds: [violation.id],
    dependsOnActionIds: [],
  }));
  const applied = applyThreadSnapshotExtensionIfNew(input.basisSnapshot, {
    id: `verify-evaluate-sensitivity-base-${input.run.id}`,
    name: "Evaluate study-base observations",
    subjectId: input.basis.subjectId,
    capturedAt,
    artifacts: [artifact],
    consumptions: [{
      id: consumeId,
      artifactId: input.studyArtifact.id,
      consumer: operationRef,
      observedFingerprint: input.studyArtifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    }],
    observations: [],
    requirements: [],
    evaluations,
    violations,
    provenance: [
      {
        id: `derived-from-${input.studyArtifact.id}-by-${artifact.id}`,
        relation: "derived_from",
        from: { kind: "artifact", id: artifact.id },
        to: { kind: "artifact", id: input.studyArtifact.id },
        rationale:
          "The study-base evaluation reopens the exact sensitivity-study capture.",
      },
      {
        id: `uses-${consumeId}`,
        relation: "uses",
        from: { kind: "consumption", id: consumeId },
        to: { kind: "artifact", id: input.studyArtifact.id },
        rationale:
          "The executor verified the exact study-capture fingerprint before evaluating.",
      },
      ...evaluations.flatMap((item) => [
        {
          id: `evaluates-${item.id}`,
          relation: "evaluates" as const,
          from: { kind: "evaluation" as const, id: item.id },
          to: { kind: "requirement" as const, id: item.requirementId },
          rationale:
            "The study-base evaluation evaluates the named Thread requirement.",
        },
        {
          id: `uses-obs-${item.id}`,
          relation: "uses" as const,
          from: { kind: "evaluation" as const, id: item.id },
          to: { kind: "observation" as const, id: item.observationIds[0]! },
          rationale: "The evaluation cites the exact study-base observation.",
        },
        {
          id: `evidences-${item.id}`,
          relation: "evidences" as const,
          from: { kind: "evaluation" as const, id: item.id },
          to: { kind: "artifact" as const, id: artifact.id },
          rationale: "The evaluation is evidenced by the reread oracle capture.",
        },
      ]),
      ...violations.flatMap((item) => [
        {
          id: `caused-by-${item.id}`,
          relation: "caused_by" as const,
          from: { kind: "violation" as const, id: item.id },
          to: { kind: "evaluation" as const, id: item.evaluationId },
          rationale:
            "The named violation is caused by the failing study-base evaluation.",
        },
        {
          id: `evidences-${item.id}`,
          relation: "evidences" as const,
          from: { kind: "violation" as const, id: item.id },
          to: { kind: "artifact" as const, id: artifact.id },
          rationale: "The violation is evidenced by the reread oracle capture.",
        },
      ]),
      ...proposedActions.map((item) => ({
        id: `addresses-${item.id}`,
        relation: "addresses" as const,
        from: { kind: "action" as const, id: item.id },
        to: { kind: "violation" as const, id: item.addressesViolationIds[0]! },
        rationale: "The proposed review addresses the named study-base violation.",
      })),
    ],
    proposedActions,
  }, { appliedAt: capturedAt });
  if (!applied.applied) {
    throw invalidTransition(
      "This exact study-base evaluation is already present in the basis snapshot.",
    );
  }
  return {
    snapshot: validateThreadSnapshot(applied.snapshot),
    artifact,
  };
}

function requireBoundArtifact(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  name: string,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) => item.name === name);
  if (binding?.source.kind !== "thread-entity") {
    throw invalidTransition(`Run is not bound to a Thread ${name} artifact.`);
  }
  const reference = binding.source.reference as EngineeringThreadEntityRef;
  const artifact = snapshot.artifacts.find((item) => item.id === reference.id);
  if (!artifact || artifact.freshness.status !== "fresh") {
    throw invalidTransition(
      `Bound ${name} artifact is absent or not fresh on the execution basis.`,
    );
  }
  return artifact;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const binding = operation?.bindings.find((item) => item.name === "studyCapture");
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.id ||
    operation.version !== VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION.version ||
    binding?.source.kind !== "thread-entity" ||
    operation.bindings.length !== 1
  ) {
    throw invalidTransition(
      `Run ${run.id} is not bound to verify.evaluate-sensitivity-base@1 with a studyCapture artifact.`,
    );
  }
}

function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): {
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
} {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      "Work item not found.",
    );
  }
  const basis = requireBasis(run);
  const candidates = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human"
    );
    if (approvals.length === 1 && sameSnapshotBasis(decision.baseSnapshot, basis)) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw invalidTransition(
      "No exact human-approved study-base evaluation decision is bound to this run basis.",
    );
  }
  return candidates[0]!;
}

async function exactBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot ||
    snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The queued Thread basis snapshot is not the exact declared snapshot.",
    );
  }
  return validateThreadSnapshot(snapshot);
}

function sameSnapshotBasis(
  left: { readonly snapshotId: string; readonly revision: number } | undefined,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return left?.snapshotId === basis.snapshotId && left.revision === basis.revision;
}

function evaluationMessage(status: string): string {
  switch (status) {
    case "pass":
      return "The study-base observation is within the reviewed concept limit.";
    case "fail":
      return "The study-base observation exceeds the reviewed concept limit.";
    case "unresolved":
      return "The oracle could not resolve this study-base evaluation.";
    default:
      return "The oracle returned an error evaluating this study-base limit.";
  }
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
