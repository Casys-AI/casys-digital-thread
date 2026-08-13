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
  EngineeringOperationInputBinding,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import { deterministicJson } from "../../domain/kernel/deterministic-json.ts";
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
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

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
export const ARCHIVE_LINEAGE_OPERATION = {
  id: "record.archive-lineage",
  version: "1",
} as const;

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
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly now?: () => string;
}

// ---------------------------------------------------------------------------
// Public: executor
// ---------------------------------------------------------------------------

export class ArchiveLineageRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
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
    requireShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotPersisted = false;
    let resultSnapshotRef: ReturnType<typeof snapshotRef> | undefined;
    let evidenceEntityRefs: EngineeringThreadEntityRef[] = [];
    try {
      const preClaim = await this.requiredProject(command.projectId);
      const preClaimRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preClaimRun);

      // Idempotent replay.
      if (preClaimRun.status === "completed") {
        assertCompleted(preClaim, command);
        return preClaim;
      }

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the archive-lineage retirement run.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);
      const base = await exactSnapshot(this.#snapshots, basis);

      // Resolve target entity refs from the work item's thread-entity bindings.
      const workItem = project.workItems.find((item) => item.id === run.workItemId);
      const targetRefs: EngineeringThreadEntityRef[] =
        (workItem?.operation?.bindings ?? [])
          .filter((b) => b.source.kind === "thread-entity")
          .map((b) => {
            const ref = (b.source as {
              kind: "thread-entity";
              reference: EngineeringThreadEntityRef;
            })
              .reference;
            return ref;
          });

      if (targetRefs.length === 0) {
        throw new EngineeringProjectCommandError(
          "invalid_input",
          "The archive-lineage run requires at least one thread-entity binding as a target.",
        );
      }
      assertExactTargetBindings(workItem?.operation?.bindings ?? [], basis);
      requireArchiveMrtrApproval(
        project,
        workItem?.decisionIds ?? [],
        basis,
        targetRefs,
      );
      const targets: ThreadEntityRef[] = targetRefs.map((ref) => ({
        kind: ref.kind,
        id: ref.id,
      }));

      // Compute the transitive cascade (fail-closed on missing targets).
      // Default filtering keeps only the NOT-yet-archived closure: a partial
      // overlap archives the new entries without duplicating the old ones,
      // and a fully redundant run is refused below — the record states a
      // fact exactly once. Same-run replays returned earlier already.
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

      // FAIL-CLOSED: when the whole closure is already archived, there is no
      // new fact to record. Refuse instead of minting duplicate archived
      // changes — append-only means the record states a fact once, not once
      // per run. The refusal lands as a first-class failed run for review.
      if (cascade.length === 0) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Every entity in the archive cascade is already archived in the " +
            "basis snapshot; nothing new would be recorded. Refusing instead " +
            "of duplicating archived changes.",
        );
      }

      // Build the extension: each NOT-yet-archived cascade entry becomes one
      // archived entry, guaranteeing evidenceRefs.length > 0 and
      // result.revision > base.revision.
      const archiveSummary = renderArchiveCascadeSummary(cascade);
      const extensionId = `archive-lineage-${command.runId}`;
      const extension = {
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
          summary: `Retired via archive-lineage run ${command.runId}. ` +
            `Because: ${entry.because}. Full cascade:\n${archiveSummary}`,
        })),
      };

      const successor = applyThreadSnapshotExtension(base, extension, {
        appliedAt: capturedAt,
      });

      // CAS readback.
      await this.#snapshots.save(successor);
      const savedSnapshot = await this.#snapshots.get(successor.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(successor)
      ) {
        throw new Error(
          "Archive-lineage snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;
      resultSnapshotRef = snapshotRef(successor);
      // The archived entities themselves are unchanged; use the "archived"
      // change records (new in the successor, absent in the base) as evidence.
      // Their ids follow the pattern set by applyThreadSnapshotExtension:
      //   `${extension.id}:archived:${target.kind}:${target.id}`
      evidenceEntityRefs = cascade.map((entry) => ({
        snapshotId: successor.id,
        snapshotRevision: successor.revision,
        kind: "change" as const,
        id: `${extensionId}:archived:${entry.ref.kind}:${entry.ref.id}`,
      }));

      // Publish run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            `Publishing the archive-lineage retirement of ${cascade.length} entity/entities.`,
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      // Complete run.
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: `Recorded the retirement of ${cascade.length} entity/entities ` +
            `and their production closure.`,
          resultSnapshot: resultSnapshotRef!,
          evidenceRefs: evidenceEntityRefs,
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      if (snapshotPersisted) {
        const complete = await this.completedFor(command);
        if (complete) return complete;
        const cause = error instanceof Error ? ` Cause: ${error.message}` : "";
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Archive-lineage retirement is durable but project attachment did not finish. " +
            `Retry this exact command; it will re-use the persisted retirement revision.${cause}`,
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
    command: ArchiveLineageRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
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
    project.schemaVersion !== "3.0" ||
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

function requireArchiveMrtrApproval(
  project: EngineeringProjectSnapshot,
  decisionIds: readonly string[],
  basis: EngineeringThreadSnapshotBasis,
  targetRefs: readonly EngineeringThreadEntityRef[],
): void {
  const approved = decisionIds.some((id) => {
    const decision = project.decisions.find((item) => item.id === id);
    if (
      decision?.status !== "approved" ||
      decision.baseSnapshot?.snapshotId !== basis.snapshotId ||
      decision.baseSnapshot.revision !== basis.revision ||
      decision.baseSnapshot.subjectId !== basis.subjectId ||
      !sameEvidenceRefs(decision.inputEvidenceRefs, targetRefs) ||
      !isArchiveProposal(decision.proposal, targetRefs.length) ||
      !decision.inputFingerprint
    ) return false;
    return decision.approvalIds.some((approvalId) => {
      const approval = project.approvals.find((item) => item.id === approvalId);
      return approval?.status === "approved" && approval.decidedByOrigin === "human" &&
        approval.baseSnapshot?.snapshotId === basis.snapshotId &&
        approval.baseSnapshot.revision === basis.revision &&
        approval.baseSnapshot.subjectId === basis.subjectId &&
        sameEvidenceRefs(approval.inputEvidenceRefs, targetRefs);
    });
  });
  if (!approved) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "archive-lineage requires a human-approved archive MRTR decision bound to the exact target entity references and run basis.",
    );
  }
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
  store: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await store.get(basis.snapshotId);
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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
