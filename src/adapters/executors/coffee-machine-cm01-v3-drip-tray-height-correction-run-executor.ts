import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../domain/engineering-project.ts";
import { deterministicJson } from "../../domain/deterministic-json.ts";
import {
  applyCm01DripTrayHeight28To30Correction,
} from "../../domain/cm01/cm01-drip-tray-height-correction.ts";
import type { ThreadSnapshot } from "../../domain/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread-snapshot-validation.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

/**
 * The one server-owned mutation admitted by the first CM-01 feedback loop.
 *
 * This is deliberately a local literal until the orchestration registry owns
 * the same reviewed ref. It contains no provider, tool or free-form geometry
 * parameter; the domain contract is closed over precisely 28 mm -> 30 mm.
 */
export const COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION = Object
  .freeze(
    {
      id: "design.correct-coffee-machine-cm01-drip-tray-height",
      version: "1",
    } as const,
  );

export const COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_PROJECT_ID =
  "coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_SUBJECT_ID =
  "project:coffee-machine-cm01-v3" as const;
export const COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_BASIS_REVISION =
  7 as const;

export interface CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface Materialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

/**
 * Applies the reviewed CM-01 correction to the canonical thread snapshot.
 *
 * It deliberately has no MCP client: it only records the design change,
 * invalidates its bounded downstream evidence, and schedules the later CAD
 * and CalculiX successors. A completed run therefore cannot be misread as
 * having generated a 30 mm model or solver verdict.
 */
export class CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #now: () => string;

  constructor(
    dependencies: CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorDependencies,
  ) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the reviewed CM-01 DripTray correction.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireCorrectionRunShape(project, requireRun(project, command.runId));
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let materialized: Materialization | undefined;
    try {
      const before = await this.requiredProject(command.projectId);
      const beforeRun = requireRun(before, command.runId);
      requireCorrectionRunShape(before, beforeRun);
      await this.requiredBasis(before, beforeRun);

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 DripTray 28 mm to 30 mm correction.",
      });
      claimed = true;

      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedCorrectionRun(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");

      const base = await this.requiredBasis(project, run);
      const appliedAt = requiredStart(run);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "running",
        appliedAt,
        "CM-01 DripTray correction running",
        "Recording the reviewed 28 mm to 30 mm geometry correction; no CAD or solver result is produced in this step.",
      );

      const result = await applyCm01DripTrayHeight28To30Correction(base, { appliedAt });
      materialized = {
        snapshot: result.snapshot,
        evidence: {
          snapshotId: result.snapshot.id,
          snapshotRevision: result.snapshot.revision,
          kind: "artifact",
          id: result.correctionArtifactId,
        },
      };
      await this.#snapshots.save(materialized.snapshot);
      await assertExactSnapshot(this.#snapshots, materialized.snapshot);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "fresh",
        materialized.snapshot.generatedAt,
        "CM-01 correction recorded",
        "Historic CAD and mechanical evidence is now stale; the successor CAD and CalculiX runs remain explicitly pending. Thermal and ERP evidence were retained unchanged.",
      );

      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the immutable CM-01 geometry-correction record.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: step(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary:
            "Recorded the CM-01 28 mm to 30 mm DripTray correction and its bounded recomputation obligations.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }
      const completed = await this.requiredProject(command.projectId);
      assertCompleted(completed, command);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      if (
        materialized &&
        (await persistedPresence(this.#snapshots, materialized.snapshot)) === "exact"
      ) {
        const completed = await this.completedProject(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The CM-01 correction snapshot is durable but its project attachment did not finish. Retry this exact command; no provider work will be repeated.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async requiredBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (
      basis.subjectId !== project.project.subjectId ||
      basis.revision !==
        COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_BASIS_REVISION
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 DripTray correction requires the exact CM-01 V3 ThreadSnapshot r7 basis.",
      );
    }
    const snapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The exact ThreadSnapshot r7 basis for this CM-01 correction is unavailable.",
      );
    }
    try {
      return validateThreadSnapshot(snapshot);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `The exact CM-01 correction basis is invalid: ${message(error)}`,
      );
    }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((item) => item.id === command.runId);
      if (
        !run || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId ||
        !["running", "publishing", "waiting-for-decision"].includes(run.status)
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: step(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 DripTray correction stopped before a durable snapshot was published.",
        code: "cm01-drip-tray-correction-not-published",
        message:
          "The bounded design correction could not be recorded as durable project evidence. No CAD or solver provider was called.",
      });
      await this.recordLive(
        project.project.subjectId,
        command.runId,
        requireBasis(run).revision,
        "failed",
        safeNow(this.#now),
        "CM-01 correction stopped",
        "The correction stopped before a durable change record was published; no CAD or solver result was generated.",
      );
    } catch {
      // The original execution failure remains authoritative.
    }
  }

  private async recordLive(
    subjectId: string,
    runId: string,
    baseRevision: number,
    state: "running" | "fresh" | "failed",
    recordedAt: string,
    label: string,
    summary: string,
  ): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.appendOnce({
        subjectId,
        runId,
        operationId: COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:drip-tray-height-correction`,
            ref: {
              kind: "change",
              id: "coffee-machine-cm01-v3-drip-tray-height-28-to-30:applied",
            },
            entityKind: "change",
            activityRole: "milestone",
            label,
            system: "Digital thread",
            freshness: state,
            summary,
            recordedAt,
          }],
          edges: [],
        },
      });
    } catch {
      // Browser projection state must never change canonical execution.
    }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    if (!this.#liveUpdates) return;
    try {
      await this.#liveUpdates.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch { /* canonical state is durable */ }
  }

  private async completedProject(
    command: CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      await this.reconcileLive(project.project.subjectId, command.runId);
      return project;
    } catch {
      return undefined;
    }
  }

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
}

function requireCorrectionRunShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const item = project.workItems.find((candidate) => candidate.id === run.workItemId);
  const operation = item?.operation;
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !==
      COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_PROJECT_ID ||
    project.project.subjectId !==
      COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    !item ||
    operation?.id !== COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION.id ||
    operation.version !==
      COFFEE_MACHINE_CM01_V3_DRIP_TRAY_HEIGHT_CORRECTION_OPERATION.version ||
    !hasOnlyApprovedBriefBinding(operation.bindings)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 DripTray height correction on its reviewed r7 basis.",
    );
  }
  return item;
}

function requireClaimedCorrectionRun(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
): EngineeringWorkItem {
  const item = requireCorrectionRunShape(project, run);
  if (run.claimedBy?.origin !== origin.kind || run.claimedBy.id !== origin.actorId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact CM-01 correction run it claimed.",
    );
  }
  return item;
}

function hasOnlyApprovedBriefBinding(
  bindings: EngineeringWorkItem["operation"] extends infer O
    ? O extends { bindings: infer B } ? B : never
    : never,
): boolean {
  return Array.isArray(bindings) && bindings.length === 1 &&
    bindings[0]?.name === "approvedBrief" &&
    bindings[0]?.source?.kind === "approved-brief";
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3DripTrayHeightCorrectionRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some((receipt) =>
      receipt.commandId === step(command.commandId, "complete")
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 correction run ${run.id} did not complete through this exact execution command.`,
    );
  }
}

async function assertExactSnapshot(
  snapshots: ThreadSnapshotStore,
  expected: ThreadSnapshot,
): Promise<void> {
  if ((await persistedPresence(snapshots, expected)) !== "exact") {
    throw new Error(
      `CM-01 correction ThreadSnapshot ${expected.id} was not durably readable after save.`,
    );
  }
}

async function persistedPresence(
  snapshots: ThreadSnapshotStore,
  expected: ThreadSnapshot,
): Promise<"exact" | "absent" | "unknown"> {
  try {
    const persisted = await snapshots.get(expected.id);
    if (!persisted) return "absent";
    return deterministicJson(persisted) === deterministicJson(expected)
      ? "exact"
      : "unknown";
  } catch {
    return "unknown";
  }
}

function step(commandId: string, name: string): string {
  return `${commandId}:cm01-drip-tray-height-correction:${name}`;
}

function safeNow(now: () => string): string {
  const value = now();
  return Number.isNaN(Date.parse(value)) ? new Date().toISOString() : value;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
