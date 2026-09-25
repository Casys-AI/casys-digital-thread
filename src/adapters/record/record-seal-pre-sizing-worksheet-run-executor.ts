/** Provider-free sealing of one reviewed pre-sizing worksheet. */
import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import type { AgentResourceExactReopener } from "../../application/ports/out/resource/agent-resource-exact-reopener.ts";
import type { EngineeringProjectRevisionStore } from "../../application/ports/out/engineering-project-revision-store.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import { sameSnapshotRef } from "../../domain/project/validation/engineering-project-invariant-values.ts";
import {
  parsePreSizingWorksheetCapture,
  preSizingWorksheetArtifactId,
  type PreSizingWorksheetCapture,
  type PreSizingWorksheetProposal,
  preSizingWorksheetUri,
  RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
} from "../../domain/record/pre-sizing-worksheet.ts";
import { applyThreadSnapshotExtension } from "../../domain/thread/thread-snapshot-extension.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import { requirePreSizingWorksheetApproval } from "./pre-sizing-worksheet-approval.ts";
import { resolvePreSizingWorksheetInputs } from "./pre-sizing-worksheet-inputs.ts";
import type { EngineeringProjectRunLease } from "../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../shared/stores/thread-snapshot-lineage.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../shared/executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "../shared/thread-write-basis-guard.ts";

export { RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION };

export interface RecordSealPreSizingWorksheetRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface RecordSealPreSizingWorksheetRunExecutorDependencies {
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(id: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly projects: Pick<EngineeringProjectRevisionStore, "get" | "getRevision">;
  readonly resources: AgentResourceExactReopener;
  readonly lease: EngineeringProjectRunLease;
  readonly captures: {
    save(
      fingerprint: ContentFingerprint,
      canonicalText: string,
    ): Promise<unknown>;
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
}

interface Materialization {
  readonly capture: PreSizingWorksheetCapture;
  readonly text: string;
  readonly fingerprint: ContentFingerprint;
  readonly artifact: ThreadArtifact;
  readonly successor: ThreadSnapshot;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
}

export class RecordSealPreSizingWorksheetRunExecutor {
  readonly #d: RecordSealPreSizingWorksheetRunExecutorDependencies;

  constructor(
    dependencies: RecordSealPreSizingWorksheetRunExecutorDependencies,
  ) {
    this.#d = dependencies;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealPreSizingWorksheetRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can seal a pre-sizing worksheet.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    await requirePreSizingWorksheetApproval(project, run);
    return await this.#d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealPreSizingWorksheetRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let exactClaimVerified = false;
    let durableWriteMayExist = false;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireThreadBasis(run);
      durableWriteMayExist = run.status === "running" || run.status === "publishing";

      const completed = await this.completedFor(origin, command);
      if (completed) return completed;

      const approval = await requirePreSizingWorksheetApproval(project, run);
      const basis = requireBasis(run);
      await assertThreadWriteBasisAvailable(project, run);
      const base = await exactSnapshot(this.#d.snapshots, basis);
      await this.assertReviewedInputs(
        project.project.id,
        base,
        approval.proposal,
      );

      if (run.status === "queued") {
        await this.#d.commands.claimRun(origin, claimCommand(command));
        claimed = true;
        exactClaimVerified = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(run, origin);
        await this.#d.commands.claimRun(origin, claimCommand(command));
        claimed = true;
        exactClaimVerified = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(run, origin);
      if (run.status === "completed") {
        const replay = await this.completedFor(origin, command);
        if (replay) return replay;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running or publishing");
      }

      const currentApproval = await requirePreSizingWorksheetApproval(
        project,
        run,
      );
      await assertThreadWriteBasisAvailable(project, run);
      const currentBase = await exactSnapshot(this.#d.snapshots, requireBasis(run));
      const inputs = await this.assertReviewedInputs(
        project.project.id,
        currentBase,
        currentApproval.proposal,
      );
      const material = await buildMaterialization(
        project,
        run,
        currentBase,
        currentApproval.decision,
        currentApproval.proposal,
        inputs,
      );

      durableWriteMayExist = true;
      await this.#d.captures.save(material.fingerprint, material.text);
      const text = await this.#d.captures.read(material.fingerprint);
      if (text !== material.text) {
        throw new Error(
          "Pre-sizing worksheet CAS was not exactly readable after save.",
        );
      }
      const parsed = parsePreSizingWorksheetCapture(JSON.parse(text));
      if (deterministicJson(parsed) !== material.text) {
        throw new Error("Pre-sizing worksheet CAS readback is not canonical.");
      }

      await this.#d.snapshots.save(material.successor);
      const saved = await this.#d.snapshots.getFresh(material.successor.id);
      if (
        !saved || deterministicJson(saved) !== deterministicJson(material.successor)
      ) {
        throw new Error(
          "Pre-sizing worksheet successor was not exactly readable after save.",
        );
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#d.commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing one pre-sizing worksheet record.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#d.commands.completeRun(
          origin,
          completionCommand(command, project.revision, material),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const complete = await this.requiredProject(command.projectId);
      await this.assertCompletedEvidence(origin, complete, command);
      return complete;
    } catch (error) {
      if (durableWriteMayExist) {
        if (!exactClaimVerified) throw error;
        const complete = await this.completedFor(origin, command);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `Pre-sizing worksheet may be durable but attachment did not finish. Retry this exact command. Cause: ${
            errorMessage(error)
          }`,
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async assertReviewedInputs(
    projectId: string,
    base: ThreadSnapshot,
    proposal: PreSizingWorksheetProposal,
  ) {
    return await resolvePreSizingWorksheetInputs({
      projectId,
      base,
      proposal,
      dependencies: this.#d,
    });
  }

  private async completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealPreSizingWorksheetRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    await this.#d.commands.claimRun(origin, claimCommand(command));
    const replayed = await this.requiredProject(command.projectId);
    await this.assertCompletedEvidence(origin, replayed, command);
    return replayed;
  }

  private async assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: RecordSealPreSizingWorksheetRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    assertCompleted(project, command);
    requireClaimedShape(run, origin);
    const receipt = exactCompletionReceipt(project, command, origin, run);
    const completedProject = await this.#d.projects.getRevision(
      project.project.id,
      receipt.resultingSnapshot.revision,
    );
    const completedRun = completedProject?.agentRuns.find((item) => item.id === run.id);
    const persistedReceipts =
      completedProject?.commandReceipts?.filter((item) =>
        item.commandId === receipt.commandId
      ) ?? [];
    if (
      !completedProject || completedProject.project.id !== project.project.id ||
      completedProject.id !== receipt.resultingSnapshot.snapshotId ||
      completedProject.revision !== receipt.resultingSnapshot.revision ||
      persistedReceipts.length !== 1 ||
      deterministicJson(persistedReceipts[0]) !== deterministicJson(receipt) ||
      !completedRun || completedRun.status !== "completed" ||
      completedRun.completedAt !== run.completedAt ||
      !completedRun.resultSnapshot || !run.resultSnapshot ||
      !sameSnapshotRef(completedRun.resultSnapshot, run.resultSnapshot)
    ) {
      throw invalidTransition(
        `Pre-sizing worksheet run ${command.runId} has no unique exact completion receipt bound to its immutable project revision and Thread result.`,
      );
    }
    const basis = requireBasis(completedRun);
    const result = completedRun.resultSnapshot;
    if (!result) {
      throw invalidTransition(
        "The completed worksheet run has no exact Thread result snapshot.",
      );
    }
    const snapshot = await this.#d.snapshots.getFresh(result.snapshotId);
    if (
      !snapshot ||
      !sameSnapshotRef(snapshotRef(snapshot), result) ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed worksheet run does not reopen its exact direct Thread successor.",
      );
    }
    const base = await exactSnapshot(this.#d.snapshots, basis);
    const approval = await requirePreSizingWorksheetApproval(
      completedProject,
      completedRun,
    );
    const inputs = await this.assertReviewedInputs(
      completedProject.project.id,
      base,
      approval.proposal,
    );
    const expected = await buildMaterialization(
      completedProject,
      completedRun,
      base,
      approval.decision,
      approval.proposal,
      inputs,
    );
    if (
      deterministicJson(snapshot) !== deterministicJson(expected.successor) ||
      !sameSnapshotRef(result, snapshotRef(expected.successor)) ||
      deterministicJson(completedRun.evidenceRefs) !==
        deterministicJson(expected.evidenceRefs)
    ) {
      throw invalidTransition(
        "The completed worksheet run no longer equals its exact reconstructed documentary successor.",
      );
    }
    const persisted = await this.#d.captures.read(expected.fingerprint);
    if (persisted !== expected.text) {
      throw invalidTransition(
        "The completed worksheet run's canonical CAS record is unavailable or changed.",
      );
    }
    assertExactCompletedAttachment(completedProject, completedRun, snapshot, expected);
    await this.#d.commands.completeRun(
      origin,
      completionCommand(command, completedProject.revision - 1, expected),
    );
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealPreSizingWorksheetRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#d.commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "Pre-sizing worksheet stopped before its documentary successor was saved.",
        code: "pre-sizing-worksheet-not-published",
        message: "The pre-sizing worksheet was not published.",
      });
    } catch { /* retain original error */ }
  }

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#d.projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }
}

async function buildMaterialization(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  base: ThreadSnapshot,
  decision: EngineeringDecision,
  proposal: PreSizingWorksheetProposal,
  inputs: Awaited<ReturnType<typeof resolvePreSizingWorksheetInputs>>,
): Promise<Materialization> {
  const basis = requireBasis(run);
  const claim = inputs.claim;
  const capture: PreSizingWorksheetCapture = {
    schemaVersion: "pre-sizing-worksheet/1.0",
    operation: RECORD_SEAL_PRE_SIZING_WORKSHEET_OPERATION,
    mode: "documentary-evidence",
    recording: { status: "recorded", authorKind: "agent" },
    projectId: project.project.id,
    trustedRunId: run.id,
    linkedAt: requiredStart(run),
    basis,
    claim,
    title: proposal.title,
    quantities: proposal.quantities,
    sources: proposal.sources,
    decision: {
      decisionId: decision.id,
      inputFingerprint: decision.inputFingerprint!,
    },
    parameters: decision.proposal!.parameters,
  };
  parsePreSizingWorksheetCapture(capture);
  const text = deterministicJson(capture);
  const fingerprint = await sha256Fingerprint(capture);
  const inputArtifactIds = requireUniqueWorksheetInputArtifactIds(
    inputs.threadSourceArtifacts.map((artifact) => artifact.id),
    claim.predecessor?.artifactId,
  );
  const artifact: ThreadArtifact = {
    id: preSizingWorksheetArtifactId(fingerprint.digest),
    name: `Pre-sizing worksheet ${proposal.worksheetId} r${proposal.revision}`,
    kind: "document",
    version: fingerprint.digest,
    fingerprint,
    uri: preSizingWorksheetUri(fingerprint.digest),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "record.seal-pre-sizing-worksheet@1",
      runId: run.id,
    },
    inputArtifactIds,
    freshness: {
      status: "fresh",
      changedAt: requiredStart(run),
      invalidatedByChangeIds: [],
    },
  };
  const successor = applyPreSizingWorksheetDocumentExtension({
    base,
    artifact,
    capturedAt: requiredStart(run),
  });
  return {
    capture,
    text,
    fingerprint,
    artifact,
    successor,
    evidenceRefs: [{
      snapshotId: successor.id,
      snapshotRevision: successor.revision,
      kind: "artifact",
      id: artifact.id,
    }],
  };
}

export function applyPreSizingWorksheetDocumentExtension(input: {
  readonly base: ThreadSnapshot;
  readonly artifact: ThreadArtifact;
  readonly capturedAt: string;
}): ThreadSnapshot {
  const inputs = input.artifact.inputArtifactIds.map((id) => {
    const matches = input.base.artifacts.filter((artifact) => artifact.id === id);
    if (matches.length !== 1) {
      throw invalidTransition(
        `Pre-sizing worksheet input artifact ${id} is absent or ambiguous in its exact Thread basis.`,
      );
    }
    return matches[0]!;
  });
  return applyThreadSnapshotExtension(input.base, {
    id: input.artifact.id,
    name: "Seal one pre-sizing worksheet record",
    subjectId: input.base.subject.id,
    capturedAt: input.capturedAt,
    artifacts: [input.artifact],
    consumptions: inputs.map((source) => ({
      id: `consume-${source.id}-by-${input.artifact.id}`,
      artifactId: source.id,
      consumer: input.artifact.producer,
      observedFingerprint: source.fingerprint,
      verifiedAt: input.capturedAt,
      status: "verified" as const,
    })),
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: inputs.flatMap((source) => [{
      id: `uses-${source.id}-by-${input.artifact.id}`,
      relation: "uses" as const,
      from: {
        kind: "consumption" as const,
        id: `consume-${source.id}-by-${input.artifact.id}`,
      },
      to: { kind: "artifact" as const, id: source.id },
      rationale:
        "The pre-sizing worksheet verified and consumed this exact immutable input artifact.",
    }, {
      id: `derived-from-${source.id}-by-${input.artifact.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: input.artifact.id },
      to: { kind: "artifact" as const, id: source.id },
      rationale:
        "This worksheet record reopens the exact immutable input artifact; it asserts neither satisfaction nor physical proof.",
    }]),
    proposedActions: [],
  }, { appliedAt: input.capturedAt });
}

function requireUniqueWorksheetInputArtifactIds(
  sourceIds: readonly string[],
  predecessorArtifactId?: string,
): readonly string[] {
  const ids = [
    ...sourceIds,
    ...(predecessorArtifactId ? [predecessorArtifactId] : []),
  ];
  if (new Set(ids).size !== ids.length) {
    throw invalidTransition(
      "Pre-sizing worksheet input artifacts must be unique.",
    );
  }
  return ids;
}

function requireThreadBasis(run: EngineeringAgentRun): void {
  if (run.basis?.kind !== "thread-snapshot") {
    throw invalidTransition(
      "Pre-sizing worksheet runs require an exact ThreadSnapshot basis.",
    );
  }
}

function requireClaimedShape(
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): void {
  requireThreadBasis(run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw invalidTransition(
      "This executor may continue only the exact worksheet run it claimed.",
    );
  }
}

async function exactSnapshot(
  store: RecordSealPreSizingWorksheetRunExecutorDependencies["snapshots"],
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact worksheet run basis ThreadSnapshot is not readable.",
    );
  }
  const valid = validateThreadSnapshot(snapshot);
  await assertThreadSnapshotLineageIntact(valid, store);
  return valid;
}

function completionCommand(
  command: RecordSealPreSizingWorksheetRunExecutorCommand,
  expectedRevision: number,
  material: Materialization,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary: "Sealed one pre-sizing worksheet record.",
    resultSnapshot: snapshotRef(material.successor),
    evidenceRefs: material.evidenceRefs,
  };
}

function claimCommand(
  command: RecordSealPreSizingWorksheetRunExecutorCommand,
) {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    summary: "Started the pre-sizing worksheet seal run.",
  };
}

function commandStep(id: string, step: string): string {
  return `${id}:record-seal-pre-sizing-worksheet:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: RecordSealPreSizingWorksheetRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Pre-sizing worksheet run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: RecordSealPreSizingWorksheetRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    ) ?? [];
  const receipt = matches[0];
  const result = run.resultSnapshot;
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== new Date(command.issuedAt).toISOString() ||
    receipt.appliedAt !== run.completedAt ||
    !result ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 1
  ) {
    throw invalidTransition(
      `Pre-sizing worksheet run ${command.runId} has no unique exact completion receipt for this execution command and actor.`,
    );
  }
  return receipt;
}

function assertExactCompletedAttachment(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  expected: Materialization,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !run.resultSnapshot || !workItem || declared.length !== 1 ||
    deterministicJson(run.resultSnapshot) !==
      deterministicJson(snapshotRef(snapshot)) ||
    deterministicJson(run.evidenceRefs) !== deterministicJson(expected.evidenceRefs) ||
    deterministicJson(workItem.evidenceRefs) !==
      deterministicJson(expected.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed worksheet run is not attached to exactly one declared successor and its exact documentary artifact evidence.",
    );
  }
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
