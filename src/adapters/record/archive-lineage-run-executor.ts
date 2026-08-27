/**
 * Trusted executor for the generic `record.archive-lineage@1` operation.
 *
 * WHY GENERIC — no constant in this module names a specific product. Project
 * identity is derived from the basis ThreadSnapshot (base.subject.id); no
 * project.id guard is hard-coded. Any project whose reviewed plan includes
 * `record.archive-lineage@1` can queue a run here.
 *
 * The archive contract is identical across projects:
 *  1. Agent-only origin gate — no human may claim this run.
 *  2. requireShape: checks operation id/version and binding shape only.
 *     No project.id or subjectId constant is compared.
 *  3. requireArchiveMrtrApproval: finds an approved decision whose
 *     `decidedByOrigin === "human"` and whose inputEvidenceRefs match the
 *     exact thread-entity targets and run basis — the MRTR cliquet.
 *  4. computeArchiveCascade: domain-pure transitive closure; excludes already
 *     archived entities; refuses when the whole closure is redundant.
 *  5. applyThreadSnapshotExtension + CAS readback.
 *  6. publishRun + completeRun.
 *
 * No WAL, no provider, no SysON call. A completed run replays idempotently
 * through the early-return short-circuit on "completed" status.
 */

import {
  type CompleteRunCommand,
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../application/ports/out/engineering-project-revision-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringOperationInputBinding,
  EngineeringProjectCommandReceipt,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type {
  ThreadEntityRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtension,
} from "../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  computeArchiveCascade,
  renderArchiveCascadeSummary,
  UnknownArchiveTargetError,
} from "../../domain/thread/thread-retirement.ts";
import { ARCHIVE_LINEAGE_OPERATION } from "../../domain/thread/thread-retirement.ts";
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

// ---------------------------------------------------------------------------
// Public constants — operation identity, exported so server.ts can wire it
// ---------------------------------------------------------------------------

/**
 * The exact reviewed operation this executor is bound to.
 *
 * WHY EXPORTED FROM HERE — server.ts must register the same identity object
 * in the `additional` array of `RegisteredProjectRunExecutor`. Deriving the
 * key from the code that owns the check eliminates any possibility of mismatch
 * between registry key and executor guard.
 */
export { ARCHIVE_LINEAGE_OPERATION };

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ArchiveLineageRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface ArchiveLineageRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: ArchiveLineageThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

/** A retirement sealing readback must bypass any convenience cache. */
export interface ArchiveLineageThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class ArchiveLineageRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly #snapshots: ArchiveLineageThreadSnapshotStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #now: () => string;

  constructor(dependencies: ArchiveLineageRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#lease = dependencies.lease;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the archive-lineage run.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let exactClaimVerified = false;
    let snapshotSaveMayHaveBeenDispatched = false;
    let snapshotReadbackVerified = false;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      // There is no separate pre-save WAL. A resumed claimed run may have
      // persisted its deterministic successor before the previous process
      // disappeared, so it must remain retry-only until exact attachment.
      snapshotSaveMayHaveBeenDispatched = run.status === "running" ||
        run.status === "publishing";

      const completed = await this.completedFor(origin, command);
      if (completed) return completed;

      await assertThreadWriteBasisAvailable(project, run);
      const basis = requireBasis(run);
      const base = await exactSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(base, this.#snapshots);

      if (run.status === "queued") {
        await this.#commands.claimRun(origin, claimCommand(command));
        claimed = true;
        exactClaimVerified = true;
      } else if (run.status === "running" || run.status === "publishing") {
        requireClaimedShape(project, run, origin);
        // Replaying the immutable claim receipt proves that command id, actor,
        // issued time and original expected revision are exact. Same-agent
        // ownership alone must not let a changed command adopt an active run.
        await this.#commands.claimRun(origin, claimCommand(command));
        claimed = true;
        exactClaimVerified = true;
      } else {
        throw unexpectedStatus(run, "queued or this agent's running/publishing");
      }

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        const completedAfterClaim = await this.completedFor(origin, command);
        if (completedAfterClaim) return completedAfterClaim;
        throw unexpectedStatus(run, "completed");
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const currentBasis = requireBasis(run);
      const currentBase = await exactSnapshot(this.#snapshots, currentBasis);
      await assertThreadSnapshotLineageIntact(currentBase, this.#snapshots);
      const materialization = await buildArchiveLineageMaterialization(
        project,
        run,
        currentBase,
      );

      // CAS readback.
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(materialization.successor);
      const savedSnapshot = await this.#snapshots.getFresh(
        materialization.successor.id,
      );
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !==
          deterministicJson(materialization.successor)
      ) {
        throw new Error(
          "Archive-lineage snapshot was not durably readable after save.",
        );
      }
      snapshotReadbackVerified = true;

      // Publish run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            `Publishing the archive-lineage retirement of ${materialization.cascadeLength} entity/entities.`,
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      // Complete run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(
          origin,
          completionCommand(command, project.revision, materialization),
        );
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.requiredProject(command.projectId);
      await this.assertCompletedEvidence(origin, complete, command);
      return complete;
    } catch (error) {
      if (snapshotSaveMayHaveBeenDispatched) {
        // A resumed run first has to prove the immutable claim receipt. A
        // changed command is an authority conflict, not an attachment outage,
        // and must remain visible as such while the original run stays active.
        if (!exactClaimVerified) throw error;
        const complete = await this.completedFor(origin, command);
        if (complete) return complete;
        const cause = error instanceof Error ? ` Cause: ${error.message}` : "";
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Archive-lineage retirement may be durable but project attachment did not finish. " +
            `Retry this exact command; it will reconstruct and re-use the same deterministic retirement revision${
              snapshotReadbackVerified ? " that was exactly read back" : ""
            }.${cause}`,
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  // ── Private: project lifecycle helpers ───────────────────────────────────

  private async requiredProject(
    projectId: string,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${projectId} does not exist.`,
      );
    }
    return project;
  }

  private async completedFor(
    origin: EngineeringProjectCommandOrigin,
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    // The command service owns the immutable claim receipt. Replaying it on a
    // completed run rejects any changed execution command before evidence is
    // accepted as an idempotent result.
    await this.#commands.claimRun(origin, claimCommand(command));
    const replayed = await this.requiredProject(command.projectId);
    await this.assertCompletedEvidence(origin, replayed, command);
    return replayed;
  }

  private async assertCompletedEvidence(
    origin: EngineeringProjectCommandOrigin,
    project: EngineeringProjectSnapshot,
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<void> {
    assertCompleted(project, command);
    const run = requireRun(project, command.runId);
    requireClaimedShape(project, run, origin);
    const basis = requireBasis(run);
    const result = run.resultSnapshot!;
    const snapshot = await this.#snapshots.getFresh(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      result.subjectId !== basis.subjectId ||
      result.revision !== basis.revision + 1 ||
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision
    ) {
      throw invalidTransition(
        "The completed archive-lineage run does not reopen its exact direct Thread successor.",
      );
    }
    const validatedSnapshot = validateThreadSnapshot(snapshot);
    await assertThreadSnapshotLineageIntact(validatedSnapshot, this.#snapshots);
    const base = await exactSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(base, this.#snapshots);
    const expected = await buildArchiveLineageMaterialization(project, run, base);
    assertExactCompletedEvidence(project, run, validatedSnapshot, expected);
    if (
      deterministicJson(validatedSnapshot) !==
        deterministicJson(expected.successor)
    ) {
      throw invalidTransition(
        "The completed archive-lineage Thread successor no longer equals the exact deterministic snapshot reconstructed from its reviewed basis.",
      );
    }
    const receipt = exactCompletionReceipt(project, command, origin, run);
    await this.#commands.completeRun(
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
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = requireRun(project, command.runId);
      if (
        run.status !== "running" ||
        run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary: "Archive-lineage stopped before the retirement revision was saved.",
        code: "archive-lineage-not-published",
        message: "The archive-lineage run stopped before the retirement was published.",
      });
    } catch {
      // Preserve the original cause.
    }
  }
}

interface ArchiveLineageMaterialization {
  readonly successor: ThreadSnapshot;
  readonly evidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly cascadeLength: number;
}

/** Reconstruct the only successor and evidence vector authorized by the run. */
async function buildArchiveLineageMaterialization(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  base: ThreadSnapshot,
): Promise<ArchiveLineageMaterialization> {
  const capturedAt = requiredStart(run);
  const basis = requireBasis(run);
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const targetRefs: EngineeringThreadEntityRef[] = (workItem?.operation?.bindings ?? [])
    .filter((binding) => binding.source.kind === "thread-entity")
    .map((binding) => {
      const source = binding.source as {
        readonly kind: "thread-entity";
        readonly reference: EngineeringThreadEntityRef;
      };
      return source.reference;
    });

  if (targetRefs.length === 0) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The archive-lineage run requires at least one thread-entity binding as a target.",
    );
  }
  assertExactTargetBindings(workItem?.operation?.bindings ?? [], basis);
  await requireArchiveMrtrApproval(project, run, targetRefs);
  const targets: ThreadEntityRef[] = targetRefs.map((reference) => ({
    kind: reference.kind,
    id: reference.id,
  }));

  let cascade: ReturnType<typeof computeArchiveCascade>;
  try {
    cascade = computeArchiveCascade(base, targets);
  } catch (error) {
    if (error instanceof UnknownArchiveTargetError) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Archive target ${error.targetRef.kind}:${error.targetRef.id} does not exist ` +
          `in the basis snapshot ${base.id}. Check the thread-entity binding references.`,
      );
    }
    throw error;
  }

  if (cascade.length === 0) {
    throw invalidTransition(
      "Every entity in the archive cascade is already archived in the " +
        "basis snapshot; nothing new would be recorded. Refusing instead " +
        "of duplicating archived changes.",
    );
  }

  const archiveSummary = renderArchiveCascadeSummary(cascade);
  const extensionId = `archive-lineage-${run.id}`;
  const successor = applyThreadSnapshotExtension(base, {
    id: extensionId,
    name:
      `Record retirement of ${cascade.length} entity/entities and their production closure`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [],
    consumptions: [],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [],
    proposedActions: [],
    archived: cascade.map((entry) => ({
      target: entry.ref,
      summary: `Retired via archive-lineage run ${run.id}. ` +
        `Because: ${entry.because}. Full cascade:\n${archiveSummary}`,
    })),
  }, { appliedAt: capturedAt });
  const evidenceRefs = cascade.map((entry) => ({
    snapshotId: successor.id,
    snapshotRevision: successor.revision,
    kind: "change" as const,
    id: `${extensionId}:archived:${entry.ref.kind}:${entry.ref.id}`,
  }));
  return { successor, evidenceRefs, cascadeLength: cascade.length };
}

// ---------------------------------------------------------------------------
// Private: shape validation helpers
// ---------------------------------------------------------------------------

const ARCHIVE_LINEAGE_OP = ARCHIVE_LINEAGE_OPERATION;

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const hasApprovedBrief = operation?.bindings.some(
    (b) => b.name === "approvedBrief" && b.source.kind === "approved-brief",
  ) ?? false;
  const hasThreadEntity = operation?.bindings.some(
    (b) => b.source.kind === "thread-entity",
  ) ?? false;
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    !workItem ||
    operation?.id !== ARCHIVE_LINEAGE_OP.id ||
    operation.version !== ARCHIVE_LINEAGE_OP.version ||
    !hasApprovedBrief ||
    !hasThreadEntity
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the canonical record.archive-lineage@1 operation.",
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
      "This executor may run only the exact archive-lineage run it claimed.",
    );
  }
}

function assertExactTargetBindings(
  bindings: readonly EngineeringOperationInputBinding[],
  basis: EngineeringThreadSnapshotBasis,
): void {
  for (const binding of bindings) {
    if (binding.source.kind !== "thread-entity") continue;
    const reference = binding.source.reference;
    if (
      reference.snapshotId !== basis.snapshotId ||
      reference.snapshotRevision !== basis.revision
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Every archive target binding must name the exact run basis ThreadSnapshot revision.",
      );
    }
    if (
      reference.kind !== "artifact" && reference.kind !== "requirement" &&
      reference.kind !== "observation" && reference.kind !== "evaluation" &&
      reference.kind !== "violation"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "Archive targets must be artifact, requirement, observation, evaluation or violation entities.",
      );
    }
  }
}

async function requireArchiveMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  targetRefs: readonly EngineeringThreadEntityRef[],
): Promise<{
  readonly decision: EngineeringDecision;
  readonly approval: EngineeringApproval;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw invalidTransition(`Work item for run ${run.id} is absent.`);
  }
  const basis = requireBasis(run);
  const decisions = workItem.decisionIds.map((id) =>
    project.decisions.find((item) => item.id === id)
  );
  const approvedDecisions = decisions.filter((decision) =>
    decision?.status === "approved"
  );
  if (
    workItem.decisionIds.length !== 1 || decisions.some((decision) => !decision) ||
    approvedDecisions.length !== 1
  ) {
    throw invalidTransition(
      "archive-lineage requires exactly one approved MRTR decision on its work item.",
    );
  }
  const decision = approvedDecisions[0]!;
  if (
    !decision.proposal || !decision.inputFingerprint ||
    !sameSnapshotBasis(decision.baseSnapshot, basis) ||
    !sameEvidenceRefs(decision.inputEvidenceRefs, targetRefs) ||
    !isArchiveProposal(decision.proposal, targetRefs.length)
  ) {
    throw invalidTransition(
      "archive-lineage requires one exact human-reviewed proposal bound to its run basis and exact target entity references.",
    );
  }

  const currentApprovals = project.approvals.filter((approval) =>
    approval.decisionId === decision.id && approval.status === "approved"
  );
  const approval = currentApprovals[0];
  if (
    currentApprovals.length !== 1 || !approval ||
    !decision.approvalIds.includes(approval.id) ||
    approval.decidedByOrigin !== "human" ||
    typeof approval.decidedBy !== "string" ||
    approval.decidedBy.trim().length === 0 ||
    typeof approval.decidedAt !== "string" ||
    Number.isNaN(Date.parse(approval.decidedAt)) ||
    !sameSnapshotBasis(approval.baseSnapshot, basis) ||
    deterministicJson(approval.baseSnapshot) !==
      deterministicJson(decision.baseSnapshot) ||
    !sameEvidenceRefs(approval.inputEvidenceRefs, decision.inputEvidenceRefs) ||
    !fingerprintsEqual(approval.inputFingerprint, decision.inputFingerprint)
  ) {
    throw invalidTransition(
      "archive-lineage requires exactly one current human approval equal to the decision basis, evidence, and input fingerprint.",
    );
  }

  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: decision.baseSnapshot,
    inputEvidenceRefs: decision.inputEvidenceRefs,
    proposal: {
      summary: decision.proposal.summary,
      parameters: decision.proposal.parameters,
    },
  });
  if (!fingerprintsEqual(expectedDecisionFingerprint, decision.inputFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The archive-lineage decision fingerprint no longer seals its exact basis, evidence, summary, and parameters.",
    );
  }

  const approvedDecisionBindings = workItem.decisionIds.map((id) => {
    const item = project.decisions.find((candidate) => candidate.id === id);
    if (item?.status !== "approved" || !item.inputFingerprint) {
      throw invalidTransition(`Work-item decision ${id} is not exactly approved.`);
    }
    return { id, inputFingerprint: item.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation?.id,
      version: workItem.operation?.version,
      bindings: workItem.operation?.bindings,
    },
    approvedDecisions: approvedDecisionBindings,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The archive-lineage run fingerprint no longer seals its exact MRTR decision, operation, bindings, and basis.",
    );
  }
  return { decision, approval };
}

function isArchiveProposal(
  proposal: EngineeringProjectSnapshot["decisions"][number]["proposal"],
  targetCount: number,
): boolean {
  if (!proposal) return false;
  const parameters = new Map(proposal.parameters.map((item) => [item.key, item.value]));
  return parameters.get("archiveAction") === "retire-lineage" &&
    parameters.get("archiveOperation") ===
      `${ARCHIVE_LINEAGE_OP.id}@${ARCHIVE_LINEAGE_OP.version}` &&
    parameters.get("archiveTargetCount") === targetCount;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return !!value && "snapshotId" in value && value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision && value.subjectId === basis.subjectId;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  if (left.length !== right.length) return false;
  const keys = (refs: readonly EngineeringThreadEntityRef[]) =>
    refs.map((ref) =>
      `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`
    ).sort();
  const leftKeys = keys(left);
  const rightKeys = keys(right);
  return leftKeys.every((key, index) => key === rightKeys[index]);
}

// ---------------------------------------------------------------------------
// Private: miscellaneous helpers
// ---------------------------------------------------------------------------

async function exactSnapshot(
  store: ArchiveLineageThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.getFresh(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "The exact basis ThreadSnapshot required by the archive-lineage run is not readable.",
    );
  }
  try {
    return validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      `The basis ThreadSnapshot is invalid: ${errorMessage(error)}`,
    );
  }
}

function claimCommand(command: ArchiveLineageRunExecutorCommand) {
  return {
    ...command,
    commandId: commandStep(command.commandId, "claim"),
    summary: "Started the archive-lineage retirement run.",
  };
}

function completionCommand(
  command: ArchiveLineageRunExecutorCommand,
  expectedRevision: number,
  materialization: ArchiveLineageMaterialization,
): CompleteRunCommand {
  return {
    ...command,
    commandId: commandStep(command.commandId, "complete"),
    expectedRevision,
    summary:
      `Recorded the retirement of ${materialization.cascadeLength} entity/entities ` +
      "and their production closure.",
    resultSnapshot: snapshotRef(materialization.successor),
    evidenceRefs: materialization.evidenceRefs,
  };
}

function exactCompletionReceipt(
  project: EngineeringProjectSnapshot,
  command: ArchiveLineageRunExecutorCommand,
  origin: EngineeringProjectCommandOrigin,
  run: EngineeringAgentRun,
): EngineeringProjectCommandReceipt {
  const completeCommandId = commandStep(command.commandId, "complete");
  const matches =
    project.commandReceipts?.filter((receipt) =>
      receipt.commandId === completeCommandId
    ) ?? [];
  const receipt = matches[0];
  const normalizedIssuedAt = new Date(command.issuedAt).toISOString();
  if (
    matches.length !== 1 || !receipt || receipt.type !== "agent-run.complete" ||
    receipt.actor.origin !== origin.kind || receipt.actor.id !== origin.actorId ||
    receipt.issuedAt !== normalizedIssuedAt ||
    receipt.appliedAt !== run.completedAt ||
    !Number.isSafeInteger(receipt.resultingSnapshot.revision) ||
    receipt.resultingSnapshot.revision < 1
  ) {
    throw invalidTransition(
      `Archive-lineage run ${command.runId} has no unique exact completion receipt for this execution command and actor.`,
    );
  }
  return receipt;
}

function assertExactCompletedEvidence(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  expected: ArchiveLineageMaterialization,
): void {
  const result = run.resultSnapshot;
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const declared = project.threadSnapshots.filter((reference) =>
    reference.snapshotId === snapshot.id &&
    reference.revision === snapshot.revision &&
    reference.subjectId === snapshot.subject.id
  );
  if (
    !result || !workItem || declared.length !== 1 ||
    deterministicJson(result) !== deterministicJson(snapshotRef(snapshot)) ||
    deterministicJson(run.evidenceRefs) !==
      deterministicJson(expected.evidenceRefs) ||
    deterministicJson(workItem.evidenceRefs) !==
      deterministicJson(expected.evidenceRefs)
  ) {
    throw invalidTransition(
      "The completed archive-lineage run is not attached to exactly one declared successor and its exact reconstructed evidence vector.",
    );
  }
  for (const evidence of expected.evidenceRefs) {
    if (
      evidence.kind !== "change" ||
      snapshot.changeSet.changes.filter((change) =>
          change.id === evidence.id && change.kind === "archived"
        ).length !== 1
    ) {
      throw invalidTransition(
        "The completed archive-lineage evidence does not name each exact archived change in its result snapshot.",
      );
    }
  }
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: ArchiveLineageRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" ||
    !run.resultSnapshot ||
    !project.commandReceipts?.some(
      (receipt) => receipt.commandId === commandStep(command.commandId, "complete"),
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Archive-lineage run ${command.runId} did not complete through this exact command.`,
    );
  }
}

function commandStep(commandId: string, step: string): string {
  return `${commandId}:record-archive-lineage:${step}`;
}

function invalidTransition(message: string): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError("invalid_transition", message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
