/**
 * Provider-free executor for `industrialize.seal-print-estimate-case@1`.
 *
 * Seals a reviewed print-estimate-case/1.0 into the Thread. The catalog is
 * server-owned and empty until a reviewed case is committed. No slicer call
 * is made and no price is derived.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type PrintEstimateCase,
  validatePrintEstimateCase,
} from "../../../domain/make/print-estimate/print-estimate-case.ts";
import {
  canonicalPrintEstimateCaseText,
  INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
  parsePrintEstimateDecisionParameters,
  type PrintEstimateDecisionParameters,
  verifyPrintEstimateParametersMatchCase,
} from "../../../domain/make/print-estimate/print-estimate-proposal.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadEntityKind,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
  PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX,
  type PrintEstimateCaseCapture,
  validatePrintEstimateCaseCapture,
} from "./print-estimate-case-capture.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
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

export { INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION };
export { PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA, PRINT_ESTIMATE_CASE_CAPTURE_URI_PREFIX };

/** Production catalog stays empty until a reviewed case is committed. */
export const PRINT_ESTIMATE_CASE_SOURCES: ReadonlyMap<string, string> = new Map();

export const PRINT_ESTIMATE_SEAL_THREAD_WRITE_OUTCOME_UNKNOWN =
  "industrialize-seal-print-estimate-case-thread-write-outcome-unknown";

export interface PrintEstimateSealThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface IndustrializeSealPrintEstimateCaseRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: PrintEstimateSealThreadSnapshotStore;
  readonly captures: FileCaptureStore<"print-estimate-case">;
  readonly lease: EngineeringProjectRunLease;
  readonly caseSources?: ReadonlyMap<string, string>;
  readonly readTextFile?: (path: string) => Promise<string>;
}

export class IndustrializeSealPrintEstimateCaseRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands:
    IndustrializeSealPrintEstimateCaseRunExecutorDependencies["commands"];
  readonly #snapshots: PrintEstimateSealThreadSnapshotStore;
  readonly #captures: FileCaptureStore<"print-estimate-case">;
  readonly #lease: EngineeringProjectRunLease;
  readonly #caseSources: ReadonlyMap<string, string>;
  readonly #readTextFile: (path: string) => Promise<string>;

  constructor(deps: IndustrializeSealPrintEstimateCaseRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#caseSources = deps.caseSources ?? PRINT_ESTIMATE_CASE_SOURCES;
    this.#readTextFile = deps.readTextFile ?? Deno.readTextFile.bind(Deno);
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the industrialize-seal-print-estimate-case run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const { decision, proposal } = await requireMrtrApproval(project, run);
    let decisionParams: PrintEstimateDecisionParameters;
    try {
      decisionParams = parsePrintEstimateDecisionParameters(proposal.parameters);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate decision parameters are invalid: ${errorMessage(error)}`,
      );
    }
    const { printEstimateCase, caseDigest } = await this.#loadAndVerifyCase(
      decisionParams,
    );
    const basis = requireBasis(run);
    if (printEstimateCase.project.id !== command.projectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate case project.id "${printEstimateCase.project.id}" does not match ` +
          `command projectId "${command.projectId}".`,
      );
    }
    if (printEstimateCase.project.subjectId !== basis.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate case project.subjectId "${printEstimateCase.project.subjectId}" ` +
          `does not match run basis subjectId "${basis.subjectId}".`,
      );
    }
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () =>
        this.#executeLeased(
          origin,
          command,
          decision,
          decisionParams,
          printEstimateCase,
          caseDigest,
        ),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: {
      readonly commandId: string;
      readonly projectId: string;
      readonly expectedRevision: number;
      readonly issuedAt: string;
      readonly runId: string;
    },
    approvedDecision: EngineeringDecision,
    decisionParams: PrintEstimateDecisionParameters,
    printEstimateCase: PrintEstimateCase,
    caseDigest: string,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotSaveMayHaveBeenDispatched = false;
    let claimed = false;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;
      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );
      const preClaimRun = requireRun(preClaim, command.runId);
      if (
        preClaimRun.status === "queued" ||
        preClaimRun.status === "running" ||
        preClaimRun.status === "publishing"
      ) {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the provider-free print-estimate-case seal.",
        });
        claimed = true;
      } else {
        throw unexpectedStatus(
          preClaimRun,
          "queued or this agent's running/publishing",
        );
      }

      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }
      const currentApproval = await requireMrtrApproval(project, run);
      if (currentApproval.decision.id !== approvedDecision.id) {
        throw invalidTransition(
          "The human-approved print-estimate-case decision changed after the run was claimed.",
        );
      }
      const currentParams = parsePrintEstimateDecisionParameters(
        currentApproval.proposal.parameters,
      );
      if (deterministicJson(currentParams) !== deterministicJson(decisionParams)) {
        throw invalidTransition(
          "The human-reviewed print-estimate parameters changed after the run was claimed.",
        );
      }
      const currentBasis = requireBasis(run);
      const currentBasisSnapshot = await exactBasisSnapshot(
        this.#snapshots,
        currentBasis,
      );
      await assertThreadSnapshotLineageIntact(currentBasisSnapshot, this.#snapshots);
      const sealedAt = requiredStart(run);
      const capture: PrintEstimateCaseCapture = {
        schemaVersion: PRINT_ESTIMATE_CASE_CAPTURE_SCHEMA,
        operation: INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION,
        trustedRunId: run.id,
        caseDigest,
        canonicalCaseText: canonicalPrintEstimateCaseText(printEstimateCase),
        printEstimateCase,
        sealedAt,
      };
      const validatedCapture = await validatePrintEstimateCaseCapture(capture);
      const captureText = deterministicJson(validatedCapture);
      const captureFingerprint = await sha256Fingerprint(validatedCapture);
      await this.#captures.save(captureFingerprint, captureText);
      const readBack = await this.#captures.read(captureFingerprint);
      if (readBack !== captureText) {
        throw new Error(
          "Print-estimate case capture was not durably readable after save.",
        );
      }
      const successor = buildPrintEstimateCaseSuccessor({
        basisSnapshot: currentBasisSnapshot,
        basis: currentBasis,
        run,
        capture: validatedCapture,
        captureFingerprint,
        captureUri: this.#captures.uriFor(captureFingerprint),
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(successor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error(
          "Print-estimate case ThreadSnapshot was not durably readable after save.",
        );
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed print-estimate case.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            `Sealed print-estimate case ${printEstimateCase.id} r${printEstimateCase.revision} into the evidence thread.`,
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact" as ThreadEntityKind,
            id: successor.artifact.id,
          }],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Print-estimate case evidence may be durable but project attachment " +
            `did not finish (${PRINT_ESTIMATE_SEAL_THREAD_WRITE_OUTCOME_UNKNOWN}). ` +
            `Cause: ${errorMessage(error)}`,
        );
      }
      if (claimed) {
        try {
          await this.#commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary: "Print-estimate case seal failed before a durable Thread write.",
            code: "industrialize-seal-print-estimate-case-failed",
            message: errorMessage(error),
          });
        } catch {
          // The original error is the one to surface.
        }
      }
      throw error;
    }
  }

  async #loadAndVerifyCase(
    decisionParams: PrintEstimateDecisionParameters,
  ): Promise<{
    readonly printEstimateCase: PrintEstimateCase;
    readonly caseDigest: string;
  }> {
    const casePath = this.#caseSources.get(decisionParams.id);
    if (!casePath) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate case "${decisionParams.id}" is not in the server-side catalog.`,
      );
    }
    let raw: string;
    try {
      raw = await this.#readTextFile(casePath);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate case file "${casePath}" is not readable: ${
          errorMessage(error)
        }`,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate case file "${casePath}" is not valid JSON.`,
      );
    }
    let printEstimateCase: PrintEstimateCase;
    try {
      printEstimateCase = validatePrintEstimateCase(parsed);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate case failed validation: ${errorMessage(error)}`,
      );
    }
    const caseDigest = (await sha256Fingerprint(printEstimateCase)).digest;
    if (decisionParams.caseDigest !== caseDigest) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Print-estimate case digest divergence: the MRTR signed digest does not match the catalog case.",
      );
    }
    try {
      verifyPrintEstimateParametersMatchCase(decisionParams, printEstimateCase);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Print-estimate MRTR parameters diverge from the catalog case: ${
          errorMessage(error)
        }`,
      );
    }
    return { printEstimateCase, caseDigest };
  }

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  async #completedFor(
    command: { readonly projectId: string; readonly runId: string },
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = project.agentRuns.find((item) => item.id === command.runId);
    if (run?.status === "completed") {
      assertCompleted(project, command);
      return project;
    }
    return undefined;
  }
}

function buildPrintEstimateCaseSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly capture: PrintEstimateCaseCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const sealedAt = requiredStart(input.run);
  const artifact: ThreadArtifact = {
    id: `print-estimate-case-${input.capture.caseDigest}`,
    name: `Print-estimate case ${input.capture.printEstimateCase.id}`,
    kind: "document",
    version: input.capture.caseDigest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool:
        `${INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.id}@${INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.version}`,
      runId: input.run.id,
    },
    inputArtifactIds: [],
    freshness: {
      status: "fresh",
      changedAt: sealedAt,
      invalidatedByChangeIds: [],
    },
  };
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    {
      id: `industrialize-seal-print-estimate-case-${input.run.id}`,
      name: "Seal the reviewed FFF print-estimate case",
      subjectId: input.basis.subjectId,
      capturedAt: sealedAt,
      artifacts: [artifact],
      consumptions: [],
      observations: [],
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [],
      proposedActions: [],
    } satisfies ThreadSnapshotExtension,
    { appliedAt: sealedAt },
  );
  if (!applied.applied) {
    throw invalidTransition(
      "This exact print-estimate case document is already present in the basis snapshot.",
    );
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const approvedBriefBinding = operation?.bindings.find(
    (binding) =>
      binding.name === "approvedBrief" && binding.source.kind === "approved-brief",
  );
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.id ||
    operation.version !== INDUSTRIALIZE_SEAL_PRINT_ESTIMATE_CASE_OPERATION.version ||
    !approvedBriefBinding ||
    operation.bindings.length !== 1
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to industrialize.seal-print-estimate-case@1.`,
    );
  }
}

function requireClaimedShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact print-estimate-case seal run it claimed.",
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
      `Work item for run ${run.id} not found.`,
    );
  }
  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) continue;
    const exactHumanApprovals = project.approvals.filter((
      approval: EngineeringApproval,
    ) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human" &&
      sameSnapshotBasis(approval.baseSnapshot, basis) &&
      fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
    );
    if (
      exactHumanApprovals.length === 1 &&
      sameSnapshotBasis(decision.baseSnapshot, basis) &&
      decision.inputFingerprint
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      candidates.length === 0
        ? "No exact human-approved print-estimate-case MRTR decision is bound to this run basis."
        : "Ambiguous print-estimate-case MRTR: exactly one human-approved decision must be bound.",
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
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The queued Thread basis snapshot is not the exact declared snapshot.",
    );
  }
  return snapshot;
}

function sameSnapshotBasis(
  left: { readonly snapshotId: string; readonly revision: number } | undefined,
  right: EngineeringThreadSnapshotBasis,
): boolean {
  return left?.snapshotId === right.snapshotId && left.revision === right.revision;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: { readonly runId: string },
): void {
  const run = requireRun(project, command.runId);
  if (run.status !== "completed") throw unexpectedStatus(run, "completed");
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
