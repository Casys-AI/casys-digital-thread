/** Provider-free sealing of one reviewed documentary requirement/brief claim. */
import type { EngineeringProjectCommandOrigin } from "../../application/ports/in/engineering-project-command-origin.ts";
import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import { assertTracedRequirementsProposalAtProjectBoundary } from "../../application/use-cases/project/commands/requirements-brief-source-guard.ts";
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
import {
  parseRequirementsBriefTraceCapture,
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  requirementsBriefTraceArtifactId,
  type RequirementsBriefTraceCapture,
  type RequirementsBriefTraceProposal,
  requirementsBriefTraceUri,
} from "../../domain/record/requirements-brief-trace.ts";
import {
  applyThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  type RequirementsBriefTraceInputDependencies,
  resolveRequirementsBriefTraceInputs,
} from "./requirements-brief-trace-inputs.ts";
import { requireRequirementsBriefTraceApproval } from "./requirements-brief-trace-approval.ts";
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

export { RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION };

export interface RecordSealRequirementsBriefTraceRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface RecordSealRequirementsBriefTraceRunExecutorDependencies
  extends RequirementsBriefTraceInputDependencies {
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ThreadSnapshotStore & {
    getFresh(id: string): Promise<ThreadSnapshot | undefined>;
  };
  readonly lease: EngineeringProjectRunLease;
  readonly traces: {
    save(fingerprint: ContentFingerprint, canonicalText: string): Promise<unknown>;
    read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  };
}

interface Materialization {
  readonly capture: RequirementsBriefTraceCapture;
  readonly text: string;
  readonly fingerprint: ContentFingerprint;
  readonly artifact: ThreadArtifact;
  readonly successor: ThreadSnapshot;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
}

/** An append-only document only: it creates no satisfaction or native-model assertion. */
export class RecordSealRequirementsBriefTraceRunExecutor {
  readonly #d: RecordSealRequirementsBriefTraceRunExecutorDependencies;

  constructor(dependencies: RecordSealRequirementsBriefTraceRunExecutorDependencies) {
    this.#d = dependencies;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealRequirementsBriefTraceRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can seal a requirements brief trace.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    await requireRequirementsBriefTraceApproval(project, run);
    return await this.#d.lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealRequirementsBriefTraceRunExecutorCommand,
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

      const approval = await requireRequirementsBriefTraceApproval(project, run);
      const proposal = approval.proposal;
      const basis = requireBasis(run);
      await assertThreadWriteBasisAvailable(project, run);
      const base = await exactSnapshot(this.#d.snapshots, basis);
      await this.assertReviewedInputs(
        project,
        run,
        base,
        approval.decision,
        proposal,
        "current",
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

      const currentApproval = await requireRequirementsBriefTraceApproval(project, run);
      const currentProposal = currentApproval.proposal;
      await assertThreadWriteBasisAvailable(project, run);
      const currentBase = await exactSnapshot(this.#d.snapshots, requireBasis(run));
      // Claiming is not a validation shortcut: source, plan ownership, target
      // and decision are all re-opened before the first possible CAS write.
      const inputs = await this.assertReviewedInputs(
        project,
        run,
        currentBase,
        currentApproval.decision,
        currentProposal,
        "current",
      );
      const material = await buildMaterialization(
        project,
        run,
        currentBase,
        currentApproval.decision,
        currentProposal,
        inputs,
      );

      durableWriteMayExist = true;
      await this.#d.traces.save(material.fingerprint, material.text);
      const text = await this.#d.traces.read(material.fingerprint);
      if (text !== material.text) {
        throw new Error(
          "Requirements brief trace CAS was not exactly readable after save.",
        );
      }
      const parsed = parseRequirementsBriefTraceCapture(JSON.parse(text));
      if (deterministicJson(parsed) !== material.text) {
        throw new Error("Requirements brief trace CAS readback is not canonical.");
      }

      await this.#d.snapshots.save(material.successor);
      const saved = await this.#d.snapshots.getFresh(material.successor.id);
      if (
        !saved || deterministicJson(saved) !== deterministicJson(material.successor)
      ) {
        throw new Error(
          "Requirements brief trace successor was not exactly readable after save.",
        );
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#d.commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing one retrospective documentary requirement-to-brief correspondence.",
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
          `Requirements brief trace may be durable but attachment did not finish. Retry this exact command. Cause: ${
            errorMessage(error)
          }`,
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async assertReviewedInputs(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    base: ThreadSnapshot,
    decision: EngineeringDecision,
    proposal: RequirementsBriefTraceProposal,
    mode: "current" | "historical",
  ) {
    await assertTracedRequirementsProposalAtProjectBoundary({
      projects: this.#d.projects,
      project,
      workItemId: run.workItemId,
      decisionId: decision.id,
      proposal: decision.proposal!,
      mode,
    });
    return await resolveRequirementsBriefTraceInputs({
      project,
      base,
      proposal,
      dependencies: this.#d,
      mode,
    });
  }

  private async completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealRequirementsBriefTraceRunExecutorCommand,
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
    command: RecordSealRequirementsBriefTraceRunExecutorCommand,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    assertCompleted(project, command);
    requireClaimedShape(run, origin);
    const receipt = exactCompletionReceipt(project, command, origin, run);
    const basis = requireBasis(run);
    const result = run.resultSnapshot!;
    const snapshot = await this.#d.snapshots.getFresh(result.snapshotId);
    if (
      !snapshot ||
      deterministicJson(snapshotRef(snapshot)) !== deterministicJson(result) ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed trace run does not reopen its exact direct Thread successor.",
      );
    }
    const base = await exactSnapshot(this.#d.snapshots, basis);
    const approval = await requireRequirementsBriefTraceApproval(project, run);
    const proposal = approval.proposal;
    const inputs = await this.assertReviewedInputs(
      project,
      run,
      base,
      approval.decision,
      proposal,
      "historical",
    );
    const expected = await buildMaterialization(
      project,
      run,
      base,
      approval.decision,
      proposal,
      inputs,
    );
    if (
      deterministicJson(snapshot) !== deterministicJson(expected.successor) ||
      deterministicJson(run.evidenceRefs) !== deterministicJson(expected.evidenceRefs)
    ) {
      throw invalidTransition(
        "The completed trace run no longer equals its exact reconstructed documentary successor.",
      );
    }
    const persisted = await this.#d.traces.read(expected.fingerprint);
    if (persisted !== expected.text) {
      throw invalidTransition(
        "The completed trace run's canonical CAS record is unavailable or changed.",
      );
    }
    assertExactCompletedAttachment(project, run, snapshot, expected);
    await this.#d.commands.completeRun(
      origin,
      completionCommand(
        command,
        receipt.resultingSnapshot.revision - 1,
        expected,
      ),
    );
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: RecordSealRequirementsBriefTraceRunExecutorCommand,
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
          "Requirements brief trace stopped before its documentary successor was saved.",
        code: "requirements-brief-trace-not-published",
        message: "The documentary requirement-to-brief trace was not published.",
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
  proposal: RequirementsBriefTraceProposal,
  inputs: Awaited<ReturnType<typeof resolveRequirementsBriefTraceInputs>>,
): Promise<Materialization> {
  const basis = requireBasis(run);
  const claim = inputs.claim;
  const capture: RequirementsBriefTraceCapture = {
    schemaVersion: "requirements-brief-trace/1.0",
    operation: RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
    mode: "retrospective-documentary",
    projectId: project.project.id,
    trustedRunId: run.id,
    linkedAt: requiredStart(run),
    basis,
    requirementsCapture: proposal.requirementsCapture,
    claim,
    decision: { decisionId: decision.id, inputFingerprint: decision.inputFingerprint! },
    parameters: decision.proposal!.parameters,
    briefProvenance: inputs.briefProvenance,
  };
  parseRequirementsBriefTraceCapture(capture);
  const text = deterministicJson(capture);
  const fingerprint = await sha256Fingerprint(capture);
  const artifact: ThreadArtifact = {
    id: requirementsBriefTraceArtifactId(fingerprint),
    name: `Retrospective documentary brief trace for ${claim.requirementId}`,
    kind: "document",
    version: fingerprint.digest,
    fingerprint,
    uri: requirementsBriefTraceUri(fingerprint),
    mediaType: "application/json",
    producer: {
      serverId: "digital-thread",
      tool: "record.seal-requirements-brief-trace@1",
      runId: run.id,
    },
    inputArtifactIds: [
      inputs.artifact.id,
      ...(claim.predecessor ? [claim.predecessor.artifactId] : []),
    ],
    freshness: {
      status: "fresh",
      changedAt: requiredStart(run),
      invalidatedByChangeIds: [],
    },
  };
  const successor = applyRequirementsBriefTraceDocumentExtension({
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

/**
 * Pure Thread construction for a reopened documentary claim.  The caller has
 * already validated CAS and source lineage; this function nevertheless makes
 * every consumed input explicit so Thread does not mistake an ID-only edge for
 * observed evidence.
 */
export function applyRequirementsBriefTraceDocumentExtension(input: {
  readonly base: ThreadSnapshot;
  readonly artifact: ThreadArtifact;
  readonly capturedAt: string;
}): ThreadSnapshot {
  const inputs = input.artifact.inputArtifactIds.map((id) => {
    const matches = input.base.artifacts.filter((artifact) => artifact.id === id);
    if (matches.length !== 1) {
      throw invalidTransition(
        `Requirements brief trace input artifact ${id} is absent or ambiguous in its exact Thread basis.`,
      );
    }
    return matches[0]!;
  });
  const successor = applyThreadSnapshotExtension(input.base, {
    id: input.artifact.id,
    name: "Seal one retrospective documentary requirement-to-brief correspondence",
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
        "The documentary record verified and consumed this exact immutable input artifact.",
    }, {
      id: `derived-from-${source.id}-by-${input.artifact.id}`,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: input.artifact.id },
      to: { kind: "artifact" as const, id: source.id },
      rationale:
        "This retrospective documentary record reopens the exact immutable input artifact; it asserts neither satisfaction nor physical proof.",
    }]),
    proposedActions: [],
  }, { appliedAt: input.capturedAt });
  return successor;
}

function requireThreadBasis(run: EngineeringAgentRun): void {
  if (run.basis?.kind !== "thread-snapshot") {
    throw invalidTransition(
      "Requirements brief trace runs require an exact ThreadSnapshot basis.",
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
      "This executor may continue only the exact trace run it claimed.",
    );
  }
}

async function exactSnapshot(
  store: RecordSealRequirementsBriefTraceRunExecutorDependencies["snapshots"],
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
  ) {
    throw invalidTransition(
      "The exact trace run basis ThreadSnapshot is not readable.",
    );
  }
  const valid = validateThreadSnapshot(snapshot);
  await assertThreadSnapshotLineageIntact(valid, store);
  return valid;
}

function completionCommand(
  command: RecordSealRequirementsBriefTraceRunExecutorCommand,
  expectedRevision: number,
  material: Materialization,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary:
      "Sealed one retrospective documentary requirement-to-brief correspondence.",
    resultSnapshot: snapshotRef(material.successor),
    evidenceRefs: material.evidenceRefs,
  };
}
function claimCommand(command: RecordSealRequirementsBriefTraceRunExecutorCommand) {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    summary: "Started the requirements brief trace seal run.",
  };
}
function commandStep(id: string, step: string): string {
  return `${id}:record-seal-requirements-brief-trace:${step}`;
}
function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: RecordSealRequirementsBriefTraceRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    )
  ) {
    throw invalidTransition(
      `Requirements brief trace run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: RecordSealRequirementsBriefTraceRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === commandStep(command.commandId, "complete")
    ) ?? [];
  const receipt = matches[0];
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== new Date(command.issuedAt).toISOString() ||
    receipt.appliedAt !== run.completedAt ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 1
  ) {
    throw invalidTransition(
      `Requirements brief trace run ${command.runId} has no unique exact completion receipt for this execution command and actor.`,
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
    reference.snapshotId === snapshot.id && reference.revision === snapshot.revision &&
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
      "The completed trace run is not attached to exactly one declared successor and its exact documentary artifact evidence.",
    );
  }
}
function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}
function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
