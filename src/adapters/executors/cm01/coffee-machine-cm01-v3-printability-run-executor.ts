/**
 * Executor for the CM-01 DripTray FDM printability observation.
 *
 * Sequence: export the server-fixed DripTray STEP via build123d, then run both
 * dfm_check_min_thickness and dfm_check_overhangs with caller-supplied thresholds
 * from the reviewed case. Produces observations with units; no verdict, no
 * evaluation, no requirement.
 *
 * Why this boundary exists: the printability case is a reviewed configuration
 * file; the agent never supplies provider names, thresholds, geometry, or STEP
 * paths. The executor owns the three-provider sequence and the snapshot shape.
 *
 * Cross-attestation: the STEP SHA-256 is passed as expected_step_sha256 to
 * both dfm_check_* calls; the parser verifies input_artifact.sha256 matches
 * the export digest before accepting any result. This mirrors the pattern used
 * by the CalculiX mechanical executor.
 *
 * DFM violations are preserved verbatim in the capture record and surfaced as
 * a count observation. They are NEVER promoted to thread evaluations,
 * requirements, or proposed actions — this is an observational run only.
 *
 * The not_checked labels from mcp-dfm are preserved verbatim in the capture
 * record and reported as an additional observation if any items were omitted.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { renderDripTrayPrintabilityScript } from "../../../domain/cm01/cm01-drip-tray-analysis-scripts.ts";
import {
  type PrintabilityCheckCase,
  validatePrintabilityCheckCase,
} from "../../../domain/analysis/printability-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { FileCaptureStore } from "../../captures/file-capture-store.ts";
import {
  type CompletePrintabilityRunAttempt,
  FileCm01DripTrayPrintabilityAttemptStore,
  type RecordPrintabilityCaptureAttempt,
} from "../../wal/file-cm01-drip-tray-printability-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../stores/live-thread-update-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "../executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.printabilityDripTray;

const PROJECT_ID = "coffee-machine-cm01-v3" as const;
const SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;
const STEP_EXPORT_NAME = "coffee-machine-cm01-v3-drip-tray-printability";

export const PRINTABILITY_CAPTURE_SCHEMA = "printability-check-capture/2.2" as const;
const LEGACY_PRINTABILITY_CAPTURE_SCHEMAS = [
  "printability-check-capture/2.0",
  "printability-check-capture/2.1",
] as const;

export interface PrintabilityCaptureRecord {
  readonly schemaVersion:
    | typeof PRINTABILITY_CAPTURE_SCHEMA
    | typeof LEGACY_PRINTABILITY_CAPTURE_SCHEMAS[number];
  readonly caseId: string;
  readonly caseRevision: number;
  readonly caseDigest: string;
  /** Server-owned run occurrence that dispatched the provider sequence. */
  readonly trustedRunId?: string;
  /** Immutable run start pinned in the WAL before provider dispatch. */
  readonly dispatchedAt?: string;
  readonly capturedAt: string;
  /** STEP export — source geometry for both DFM checks. */
  readonly step: {
    readonly exportName: string;
    readonly stepPath: string;
    readonly stepSha256: string;
    readonly stepBytes: number;
  };
  /** Exact arguments dispatched to one or both DFM providers. */
  readonly providerCallParams?: {
    readonly meshSizeMm: number;
    readonly buildDirection: readonly [number, number, number];
    readonly minWallThicknessMm?: number;
    readonly maxOverhangAngleDeg?: number;
  };
  /** Reviewed case context; maxUnsupportedAreaMm2 is not dispatched to DFM. */
  readonly reviewedCaseThresholds?: {
    readonly maxUnsupportedAreaMm2?: number;
  };
  /** Legacy 2.0/2.1 spelling, read-only. */
  readonly callParams?: {
    readonly meshSizeMm: number;
    readonly buildDirection: readonly [number, number, number];
  };
  readonly thickness: {
    readonly tool: "dfm_check_min_thickness";
    readonly measured: {
      readonly minThicknessMm: number;
      readonly minPositionMm: readonly [number, number, number];
      readonly sampleCount: number;
      readonly validRayCount: number;
    };
    /** Verbatim violation labels from the DFM provider. */
    readonly violations: readonly DfmViolationZone[];
    readonly notChecked: readonly string[];
    /** Verified cross-attestation: equals step.stepSha256. */
    readonly inputArtifactSha256: string;
  };
  readonly overhang: {
    readonly tool: "dfm_check_overhangs";
    readonly measured: {
      readonly totalSurfaceAreaMm2: number;
      readonly overhangAreaMm2: number;
      readonly overhangTriangleCount: number;
      readonly totalTriangleCount: number;
    };
    /** Verbatim violation labels from the DFM provider. */
    readonly violations: readonly DfmViolationZone[];
    readonly notChecked: readonly string[];
    /** Verified cross-attestation: equals step.stepSha256. */
    readonly inputArtifactSha256: string;
  };
  readonly limitations: readonly string[];
}

export interface CoffeeMachineCm01V3PrintabilityRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3PrintabilityRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly printabilityCase: PrintabilityCheckCase;
  readonly build123d: McpToolClient;
  readonly dfm: McpToolClient;
  readonly attempts: FileCm01DripTrayPrintabilityAttemptStore;
  readonly captures: FileCaptureStore<"cm01-drip-tray-printability">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface PrintabilityMaterialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

interface PersistedCapture {
  readonly record: PrintabilityCaptureRecord;
  readonly captureFingerprint: ContentFingerprint;
}

class PrintabilityCaptureRecoveryRequiredError extends Error {
  constructor() {
    super("Printability capture is durable and must be recovered without providers.");
    this.name = "PrintabilityCaptureRecoveryRequiredError";
  }
}

export class CoffeeMachineCm01V3PrintabilityRunExecutor {
  readonly #projects;
  readonly #commands;
  readonly #snapshots;
  readonly #printabilityCase;
  readonly #build123d;
  readonly #dfm;
  readonly #attempts;
  readonly #captures;
  readonly #lease;
  readonly #live;
  readonly #now;

  constructor(deps: CoffeeMachineCm01V3PrintabilityRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#printabilityCase = validatePrintabilityCheckCase(deps.printabilityCase);
    this.#build123d = deps.build123d;
    this.#dfm = deps.dfm;
    this.#attempts = deps.attempts;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#live = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3PrintabilityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 DripTray FDM printability observation.",
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
    command: CoffeeMachineCm01V3PrintabilityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let materialized: PrintabilityMaterialization | undefined;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      await this.requiredBasis(project, run);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 DripTray FDM printability observation.",
      });
      claimed = true;
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      requireClaimed(project, run, origin);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running") throw unexpectedStatus(run, "running");
      const base = await this.requiredBasis(project, run);
      const startedAt = requiredStart(run);
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "running",
        startedAt,
        "DripTray printability observation running",
        "Exporting the reviewed DripTray STL and running FDM printability checks.",
      );
      const caseDigest = (await sha256Fingerprint(
        JSON.parse(deterministicJson(this.#printabilityCase)),
      )).digest;
      const persisted = await this.captureOnce(
        project,
        run,
        startedAt,
        caseDigest,
      );
      capturePersisted = true;
      const uri = this.#captures.uriFor(persisted.captureFingerprint);
      materialized = await materializePrintabilitySnapshot(
        base,
        run.id,
        this.#printabilityCase,
        persisted.captureFingerprint,
        uri,
        persisted.record,
      );
      await this.#snapshots.save(materialized.snapshot);
      if ((await this.presence(materialized.snapshot)) !== "exact") {
        throw new Error(
          "CM-01 printability snapshot persistence could not be verified.",
        );
      }
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "fresh",
        persisted.record.capturedAt,
        "DripTray printability evidence captured",
        "STL exported and DFM thickness + overhang checks completed and attested.",
      );
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the attested CM-01 DripTray FDM printability evidence.",
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
          summary: "Recorded the CM-01 DripTray FDM printability observation.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") throw unexpectedStatus(run, "completed");
      const completed = await this.requiredProject(command.projectId);
      assertCompleted(completed, command);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      if (error instanceof PrintabilityCaptureRecoveryRequiredError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 printability capture is durable but WAL completion needs an exact CAS-only retry. Providers will not run again.",
        );
      }
      if (materialized && (await this.presence(materialized.snapshot)) === "exact") {
        const completed = await this.completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 printability evidence is durable but project attachment did not finish. Retry this exact command; providers will not run again.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 printability capture is durable but its snapshot was not published. Retry this exact command without repeating providers.",
        );
      }
      if (claimed) await this.recordFailure(origin, command);
      throw error;
    }
  }

  private async captureOnce(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
    dispatchedAt: string,
    caseDigest: string,
  ): Promise<PersistedCapture> {
    const attempt = await this.#attempts.begin({
      projectId: project.project.id,
      runId: run.id,
      caseDigest,
      dispatchedAt,
    });
    if (attempt.action !== "dispatch") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) {
        throw new Error(
          "Completed printability attempt has no readable capture in the CAS.",
        );
      }
      const record = parseCaptureRecord(JSON.parse(text));
      await assertCaptureReadback(
        text,
        attempt.captureFingerprint,
        "Completed printability attempt",
      );
      if (
        attempt.canonicalCaptureText !== undefined &&
        text !== attempt.canonicalCaptureText
      ) {
        throw new Error("Printability WAL capture text differs from CAS readback.");
      }
      assertCurrentCaptureEnvelope(
        record,
        this.#printabilityCase,
        caseDigest,
        run.id,
        dispatchedAt,
      );
      if (
        attempt.recordedAt !== undefined &&
        record.capturedAt !== attempt.recordedAt
      ) {
        throw new Error("Printability capture occurrence timestamp is not exact.");
      }
      if (attempt.action === "capture-recorded") {
        await this.completeCapturedAttempt({
          projectId: project.project.id,
          runId: run.id,
          caseDigest,
          dispatchedAt,
          completedAt: this.#now(),
          captureFingerprint: attempt.captureFingerprint,
        });
      }
      return { record, captureFingerprint: attempt.captureFingerprint };
    }
    // Run providers.
    const sc = this.#printabilityCase;
    const stepExport = await callBuild123dStepExport(
      this.#build123d,
      renderDripTrayPrintabilityScript(),
      STEP_EXPORT_NAME,
    );
    const thicknessResult = await callDfmThicknessCheck(
      this.#dfm,
      stepExport.path,
      stepExport.sha256,
      sc.thresholds.minWallThicknessMm.value,
      sc.meshSizeMm.value,
    );
    const overhangResult = await callDfmOverhangCheck(
      this.#dfm,
      stepExport.path,
      stepExport.sha256,
      sc.buildDirection,
      sc.thresholds.maxOverhangAngleDeg.value,
      sc.meshSizeMm.value,
    );
    const capturedAt = this.#now();
    const record = buildCaptureRecord(
      sc,
      caseDigest,
      capturedAt,
      run.id,
      dispatchedAt,
      stepExport,
      thicknessResult,
      overhangResult,
    );
    const captureText = deterministicJson(record);
    const captureFingerprint = await sha256Fingerprint(record);
    await this.#captures.save(captureFingerprint, captureText);
    const persistedText = await this.#captures.read(captureFingerprint);
    if (!persistedText) {
      throw new Error("Printability capture disappeared after it was saved.");
    }
    await assertCaptureReadback(
      persistedText,
      captureFingerprint,
      "Saved printability capture",
    );
    const persistedRecord = parseCaptureRecord(JSON.parse(persistedText));
    assertCurrentCaptureEnvelope(
      persistedRecord,
      sc,
      caseDigest,
      run.id,
      dispatchedAt,
    );
    const recordInput: RecordPrintabilityCaptureAttempt = {
      projectId: project.project.id,
      runId: run.id,
      caseDigest,
      dispatchedAt,
      recordedAt: capturedAt,
      captureFingerprint,
      canonicalCaptureText: persistedText,
    };
    const completeInput: CompletePrintabilityRunAttempt = {
      projectId: project.project.id,
      runId: run.id,
      caseDigest,
      dispatchedAt,
      completedAt: capturedAt,
      captureFingerprint,
    };
    await this.recordAndCompleteCapturedAttempt(recordInput, completeInput);
    return { record: persistedRecord, captureFingerprint };
  }

  private async recordAndCompleteCapturedAttempt(
    record: RecordPrintabilityCaptureAttempt,
    complete: CompletePrintabilityRunAttempt,
  ): Promise<void> {
    let captureRecorded = false;
    try {
      await this.#attempts.recordCapture(record);
      captureRecorded = true;
      await this.#attempts.complete(complete);
    } catch (error) {
      if (captureRecorded) throw new PrintabilityCaptureRecoveryRequiredError();
      await this.requireCaptureOnlyRecoveryOrThrow(complete, error);
    }
  }

  private async completeCapturedAttempt(
    input: CompletePrintabilityRunAttempt,
  ): Promise<void> {
    try {
      await this.#attempts.complete(input);
    } catch {
      // This method is called only after begin() admitted capture-recorded.
      // Its exact capture is already durable, even if confirmation I/O fails.
      throw new PrintabilityCaptureRecoveryRequiredError();
    }
  }

  private async requireCaptureOnlyRecoveryOrThrow(
    input: Pick<
      CompletePrintabilityRunAttempt,
      "projectId" | "runId" | "caseDigest" | "dispatchedAt"
    >,
    original: unknown,
  ): Promise<never> {
    try {
      const recovery = await this.#attempts.begin(input);
      if (recovery.action === "capture-recorded" || recovery.action === "completed") {
        throw new PrintabilityCaptureRecoveryRequiredError();
      }
    } catch (error) {
      if (error instanceof PrintabilityCaptureRecoveryRequiredError) throw error;
    }
    throw original;
  }

  private async requiredBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ThreadSnapshot> {
    const basis = requireBasis(run);
    if (basis.subjectId !== project.project.subjectId) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        "The CM-01 printability basis belongs to another subject.",
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
        "The exact ThreadSnapshot basis for this CM-01 printability run is unavailable.",
      );
    }
    return snapshot;
  }

  private async presence(
    snapshot: ThreadSnapshot,
  ): Promise<"exact" | "absent" | "unknown"> {
    try {
      const persisted = await this.#snapshots.get(snapshot.id);
      return !persisted
        ? "absent"
        : deterministicJson(persisted) === deterministicJson(snapshot)
        ? "exact"
        : "unknown";
    } catch {
      return "unknown";
    }
  }

  private async recordFailure(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3PrintabilityRunExecutorCommand,
  ): Promise<void> {
    try {
      const project = await this.requiredProject(command.projectId);
      const run = project.agentRuns.find((item) => item.id === command.runId);
      if (
        !run || run.claimedBy?.origin !== origin.kind ||
        run.claimedBy.id !== origin.actorId ||
        !["running", "publishing"].includes(run.status)
      ) return;
      await this.#commands.failRun(origin, {
        ...command,
        commandId: step(command.commandId, "fail"),
        expectedRevision: project.revision,
        summary:
          "CM-01 DripTray printability observation stopped before durable evidence was published.",
        code: "cm01-drip-tray-printability-not-published",
        message:
          "The printability observation did not produce durable evidence. No automatic provider retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        requireBasis(run).revision,
        "failed",
        safeNow(this.#now),
        "DripTray printability observation stopped",
        "The observation stopped before durable evidence was published.",
      );
    } catch { /* preserve original failure */ }
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
    if (!this.#live) return;
    try {
      await this.#live.appendOnce({
        subjectId,
        runId,
        operationId: COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:drip-tray-printability`,
            ref: { kind: "artifact", id: `${runId}:drip-tray-printability` },
            entityKind: "artifact",
            artifactKind: "document",
            activityRole: "milestone",
            label,
            system: "digital-thread",
            freshness: state,
            summary,
            recordedAt,
          }],
          edges: [],
        },
      });
    } catch { /* presentation must not alter evidence */ }
  }

  private async reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#live?.reconcileRunOnce(subjectId, runId, safeNow(this.#now));
    } catch { /* durable result wins */ }
  }

  private async completedFor(
    command: CoffeeMachineCm01V3PrintabilityRunExecutorCommand,
  ) {
    try {
      const project = await this.requiredProject(command.projectId);
      assertCompleted(project, command);
      return project;
    } catch {
      return undefined;
    }
  }

  private async requiredProject(id: string) {
    const project = await this.#projects.get(id);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${id} does not exist.`,
      );
    }
    return project;
  }
}

/**
 * Materialize the ThreadSnapshot extension from the printability capture.
 *
 * No requirements, evaluations, violations, or proposed actions — this is an
 * observational run only. Every observation carries an explicit unit from the
 * reviewed case or the DFM contract. All observations source their artifactIds
 * on the capture document artifact, which contains the complete verified
 * record including not_checked and violation items.
 *
 * Cross-attestation: DFM reports input_artifact.sha256 in its response; the
 * parser verifies it against the STEP export SHA-256 before producing any
 * DfmThicknessResult or DfmOverhangResult. The verified SHA-256 is stored in
 * the exact persisted capture; it is not promoted to a STEP artifact because
 * this executor never persists or rereads STEP bytes.
 *
 * DFM violations are preserved in the capture record. If any violations are
 * present, an additional observation reports their total count as a
 * contractual label. They are NEVER promoted to thread evaluations,
 * requirements, or proposed actions.
 */
export function materializePrintabilitySnapshot(
  base: ThreadSnapshot,
  runId: string,
  pc: PrintabilityCheckCase,
  captureFingerprint: ContentFingerprint,
  uri: string,
  record: PrintabilityCaptureRecord,
): PrintabilityMaterialization {
  const captureDigest = captureFingerprint.digest;
  const prefix = `drip-tray-printability-${captureDigest}`;
  const capturedAt = record.capturedAt;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const thicknessOp: ThreadOperationRef = {
    serverId: "dfm",
    tool: "dfm_check_min_thickness",
    runId,
  };
  const overhangOp: ThreadOperationRef = {
    serverId: "dfm",
    tool: "dfm_check_overhangs",
    runId,
  };
  const localOp: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "record_printability_observation",
    runId,
  };
  const captureDocId = `${prefix}-capture`;

  const artifacts: ThreadArtifact[] = [
    makeArtifact(
      captureDocId,
      "CM-01 DripTray printability capture",
      "document",
      captureFingerprint,
      uri,
      "application/json",
      localOp,
      [],
      freshness,
    ),
  ];

  // All observations derive from the capture document, which contains the
  // complete verified record (cross-attested SHA-256, measured values, etc.).
  const thicknessObsId = `${prefix}-min-wall-thickness`;
  const overhangAreaObsId = `${prefix}-overhang-area`;
  const totalSurfaceAreaObsId = `${prefix}-total-surface-area`;

  const observations: ThreadObservation[] = [
    {
      id: thicknessObsId,
      name:
        "DripTray minimum wall thickness measured by dfm_check_min_thickness (provisional)",
      metric: "drip_tray_min_wall_thickness_mm",
      quantity: {
        value: record.thickness.measured.minThicknessMm,
        unit: pc.thresholds.minWallThicknessMm.unit,
      },
      source: {
        operation: thicknessOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: overhangAreaObsId,
      name: "DripTray overhang area measured by dfm_check_overhangs (provisional)",
      metric: "drip_tray_overhang_area_mm2",
      quantity: {
        value: record.overhang.measured.overhangAreaMm2,
        unit: "mm2",
      },
      source: {
        operation: overhangOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: totalSurfaceAreaObsId,
      name: "DripTray total surface area measured by dfm_check_overhangs (provisional)",
      metric: "drip_tray_total_surface_area_mm2",
      quantity: {
        value: record.overhang.measured.totalSurfaceAreaMm2,
        unit: "mm2",
      },
      source: {
        operation: overhangOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
  ];

  // Provenance: each observation derived_from the capture document.
  const provenance = [
    makeLink(
      `${thicknessObsId}-from-capture`,
      thicknessObsId,
      captureDocId,
      "derived_from",
      "The min-wall-thickness observation was captured from the DFM thickness check record.",
      "observation",
    ),
    makeLink(
      `${overhangAreaObsId}-from-capture`,
      overhangAreaObsId,
      captureDocId,
      "derived_from",
      "The overhang-area observation was captured from the DFM overhang check record.",
      "observation",
    ),
    makeLink(
      `${totalSurfaceAreaObsId}-from-capture`,
      totalSurfaceAreaObsId,
      captureDocId,
      "derived_from",
      "The total-surface-area observation was captured from the DFM overhang check record.",
      "observation",
    ),
  ];

  // If any DFM violations were reported, surface the total count as a
  // contractual label. The violation strings are preserved in the capture
  // document. These are NEVER thread evaluations, requirements, or actions.
  const allViolations = [
    ...record.thickness.violations,
    ...record.overhang.violations,
  ];
  if (allViolations.length > 0) {
    const violationsObsId = `${prefix}-dfm-violation-count`;
    observations.push({
      id: violationsObsId,
      name: "DripTray DFM violation count (contractual label: provisional)",
      metric: "drip_tray_dfm_violation_count",
      quantity: {
        value: allViolations.length,
        unit: "1",
      },
      source: {
        operation: localOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    });
    provenance.push(
      makeLink(
        `${violationsObsId}-from-capture`,
        violationsObsId,
        captureDocId,
        "derived_from",
        "The DFM violation count is sourced from the capture document; the violation strings are preserved there verbatim.",
        "observation",
      ),
    );
  }

  // If any items were not checked, surface the count as a contractual label.
  // The not_checked strings themselves are preserved in the capture document.
  const allNotChecked = [
    ...record.thickness.notChecked,
    ...record.overhang.notChecked,
  ];
  if (allNotChecked.length > 0) {
    const notCheckedObsId = `${prefix}-not-checked-count`;
    observations.push({
      id: notCheckedObsId,
      name:
        "DripTray printability not-checked item count (contractual label: provisional)",
      metric: "drip_tray_printability_not_checked_count",
      quantity: {
        value: allNotChecked.length,
        // Dimensionless count — convention: "1" (same as BOM componentCount).
        unit: "1",
      },
      source: {
        operation: localOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    });
    provenance.push(
      makeLink(
        `${notCheckedObsId}-from-capture`,
        notCheckedObsId,
        captureDocId,
        "derived_from",
        "The not-checked count observation is sourced from the capture document; the strings are preserved there verbatim.",
        "observation",
      ),
    );
  }

  const extension = {
    id: `${prefix}-extension`,
    name: "Observe CM-01 DripTray FDM printability",
    subjectId: base.subject.id,
    capturedAt,
    artifacts,
    consumptions: [],
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance,
  };

  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capturedAt,
  });
  if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
    throw new Error(
      "CM-01 printability extension was not applied to the basis.",
    );
  }
  const captureDoc = applied.snapshot.artifacts.find(
    (item) => item.id === captureDocId,
  );
  if (!captureDoc) {
    throw new Error(
      "CM-01 printability extension has no capture document artifact.",
    );
  }
  return {
    snapshot: applied.snapshot,
    evidence: {
      snapshotId: applied.snapshot.id,
      snapshotRevision: applied.snapshot.revision,
      kind: "artifact",
      id: captureDoc.id,
    },
  };
}

// ── Provider call helpers ─────────────────────────────────────────────────────

async function callBuild123dStepExport(
  build123d: McpToolClient,
  script: string,
  exportName: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const result = await build123d.callTool({
    name: "build123d_export",
    arguments: {
      script,
      formats: ["step"],
      name: exportName,
      timeout_ms: 120000,
    },
  });
  return parseBuild123dStepExport(result.structuredContent, exportName);
}

/**
 * Parse and validate the structuredContent returned by build123d_export for a
 * printability STEP export. Exported for isolated unit testing.
 */
export function parseBuild123dStepExport(
  value: unknown,
  expectedName: string,
): { path: string; sha256: string; bytes: number } {
  const root = requireObject(value, "build123d_export structuredContent");
  if (
    root.schemaVersion !== "1.0" || root.kind !== "export" ||
    !Array.isArray(root.files) || root.files.length !== 1
  ) {
    throw new Error(
      `build123d_export did not return a single reviewed STEP export for ${expectedName}.`,
    );
  }
  const file = requireObject(root.files[0], "build123d_export files[0]");
  if (
    file.format !== "step" ||
    typeof file.path !== "string" ||
    !file.path.includes(expectedName)
  ) {
    throw new Error(
      `build123d_export did not preserve the expected export name ${expectedName}.`,
    );
  }
  const sha256 = requireSha256Hex(file.sha256, "build123d STEP sha256");
  const bytes = requirePositiveInt(file.bytes, "build123d STEP bytes");
  return { path: file.path, sha256, bytes };
}

/** A structured violation zone as returned by the live DFM contract. */
export interface DfmViolationZone {
  readonly [key: string]: unknown;
}

export interface DfmThicknessResult {
  measured: {
    minThicknessMm: number;
    minPositionMm: [number, number, number];
    sampleCount: number;
    validRayCount: number;
  };
  violations: DfmViolationZone[];
  notChecked: string[];
  inputArtifactSha256: string;
}

async function callDfmThicknessCheck(
  dfm: McpToolClient,
  stepPath: string,
  expectedStepSha256: string,
  minThresholdMm: number,
  meshSizeMm: number,
): Promise<DfmThicknessResult> {
  const result = await dfm.callTool({
    name: "dfm_check_min_thickness",
    arguments: {
      step_path: stepPath,
      expected_step_sha256: expectedStepSha256,
      min_thickness_mm: minThresholdMm,
      mesh_size_mm: meshSizeMm,
    },
  });
  return parseDfmThicknessResult(
    result.structuredContent,
    expectedStepSha256,
    minThresholdMm,
  );
}

/**
 * Parse and validate the structuredContent returned by dfm_check_min_thickness.
 * Exported for isolated unit testing.
 *
 * Real contract: { violations, measured, limits_declared, not_checked,
 * input_artifact }. Each required field is validated fail-closed; extra fields
 * on the outer object are tolerated (provider schema may evolve).
 *
 * Cross-attestation: input_artifact.sha256 must equal expectedSha256 or the
 * call is rejected with an error — the STEP file the provider consumed must
 * be the exact file we exported.
 *
 * The not_checked items are preserved verbatim — they are contractual labels
 * from the DFM provider. A not_checked entry means the check was not performed
 * for some faces; absence of a warning is never a guarantee.
 */
export function parseDfmThicknessResult(
  value: unknown,
  expectedSha256: string,
  expectedMinThicknessMm?: number,
): DfmThicknessResult {
  const root = requireObject(value, "dfm_check_min_thickness structuredContent");
  // violations
  const rawViolations = root.violations;
  if (!Array.isArray(rawViolations)) {
    throw new Error("dfm_check_min_thickness violations must be an array.");
  }
  // Violations are structured zones {area_mm2, centroid_mm, bbox} per the live
  // contract; they are validated minimally and preserved verbatim as measured
  // data — never promoted to a thread verdict.
  const violations = rawViolations.map((item, i) => {
    const zone = requireObject(item, `dfm_check_min_thickness violations[${i}]`);
    requireNonNegative(
      zone.area_mm2,
      `dfm_check_min_thickness violations[${i}].area_mm2`,
    );
    requireFiniteTriple(
      zone.centroid_mm,
      `dfm_check_min_thickness violations[${i}].centroid_mm`,
    );
    return zone;
  });
  // measured
  const measuredRoot = requireObject(
    root.measured,
    "dfm_check_min_thickness measured",
  );
  const minThicknessMm = requireNonNegative(
    measuredRoot.min_thickness_mm,
    "dfm_check_min_thickness measured.min_thickness_mm",
  );
  const rawPos = measuredRoot.min_position_mm;
  if (!Array.isArray(rawPos) || rawPos.length !== 3) {
    throw new TypeError(
      "dfm_check_min_thickness measured.min_position_mm must be a 3-element array.",
    );
  }
  const minPositionMm: [number, number, number] = [
    requireFinite(rawPos[0], "dfm_check_min_thickness measured.min_position_mm[0]"),
    requireFinite(rawPos[1], "dfm_check_min_thickness measured.min_position_mm[1]"),
    requireFinite(rawPos[2], "dfm_check_min_thickness measured.min_position_mm[2]"),
  ];
  const sampleCount = requireNonNegativeInt(
    measuredRoot.sample_count,
    "dfm_check_min_thickness measured.sample_count",
  );
  const validRayCount = requireNonNegativeInt(
    measuredRoot.valid_ray_count,
    "dfm_check_min_thickness measured.valid_ray_count",
  );
  if (validRayCount > sampleCount) {
    throw new Error("capture thickness validRayCount must not exceed sampleCount.");
  }
  // limits_declared — required by contract, not consumed downstream
  if (!root.limits_declared || typeof root.limits_declared !== "object") {
    throw new TypeError(
      "dfm_check_min_thickness limits_declared must be an object.",
    );
  }
  if (
    expectedMinThicknessMm !== undefined &&
    requireFinite(
        requireObject(root.limits_declared, "dfm_check_min_thickness limits_declared")
          .min_thickness_mm,
        "dfm_check_min_thickness limits_declared.min_thickness_mm",
      ) !== expectedMinThicknessMm
  ) throw new Error("dfm_check_min_thickness declared a different threshold.");
  // not_checked
  const rawNotChecked = root.not_checked;
  if (!Array.isArray(rawNotChecked)) {
    throw new Error("dfm_check_min_thickness not_checked must be an array.");
  }
  const notChecked = rawNotChecked.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(
        `dfm_check_min_thickness not_checked[${i}] must be a string.`,
      );
    }
    return item;
  });
  // input_artifact — cross-attestation
  const inputArtRoot = requireObject(
    root.input_artifact,
    "dfm_check_min_thickness input_artifact",
  );
  const inputSha256 = requireSha256Hex(
    inputArtRoot.sha256,
    "dfm_check_min_thickness input_artifact.sha256",
  );
  if (inputSha256 !== expectedSha256) {
    throw new Error(
      `dfm_check_min_thickness input_artifact.sha256 mismatch: ` +
        `expected ${expectedSha256}, got ${inputSha256}.`,
    );
  }
  return {
    measured: { minThicknessMm, minPositionMm, sampleCount, validRayCount },
    violations,
    notChecked,
    inputArtifactSha256: inputSha256,
  };
}

export interface DfmOverhangResult {
  measured: {
    totalSurfaceAreaMm2: number;
    overhangAreaMm2: number;
    overhangTriangleCount: number;
    totalTriangleCount: number;
  };
  violations: DfmViolationZone[];
  notChecked: string[];
  inputArtifactSha256: string;
}

async function callDfmOverhangCheck(
  dfm: McpToolClient,
  stepPath: string,
  expectedStepSha256: string,
  buildDirection: readonly [number, number, number],
  maxAngleDeg: number,
  meshSizeMm: number,
): Promise<DfmOverhangResult> {
  const result = await dfm.callTool({
    name: "dfm_check_overhangs",
    arguments: {
      step_path: stepPath,
      expected_step_sha256: expectedStepSha256,
      build_direction: [...buildDirection],
      max_overhang_deg: maxAngleDeg,
      mesh_size_mm: meshSizeMm,
    },
  });
  return parseDfmOverhangResult(
    result.structuredContent,
    expectedStepSha256,
    maxAngleDeg,
  );
}

/**
 * Parse and validate the structuredContent returned by dfm_check_overhangs.
 * Exported for isolated unit testing.
 *
 * Real contract: { violations, measured, limits_declared, not_checked,
 * input_artifact }. The aire d'encombrement (overhang_area_mm2) and total
 * surface area are OUTPUT measurements — NOT inputs. The caller supplies only
 * build_direction and max_overhang_deg.
 *
 * Cross-attestation: input_artifact.sha256 must equal expectedSha256.
 */
export function parseDfmOverhangResult(
  value: unknown,
  expectedSha256: string,
  expectedMaxOverhangDeg?: number,
): DfmOverhangResult {
  const root = requireObject(value, "dfm_check_overhangs structuredContent");
  // violations
  const rawViolations = root.violations;
  if (!Array.isArray(rawViolations)) {
    throw new Error("dfm_check_overhangs violations must be an array.");
  }
  // Violations are structured zones {area_mm2, centroid_mm, bbox} per the live
  // contract; they are validated minimally and preserved verbatim as measured
  // data — never promoted to a thread verdict.
  const violations = rawViolations.map((item, i) => {
    const zone = requireObject(item, `dfm_check_overhangs violations[${i}]`);
    requireNonNegative(
      zone.area_mm2,
      `dfm_check_overhangs violations[${i}].area_mm2`,
    );
    requireFiniteTriple(
      zone.centroid_mm,
      `dfm_check_overhangs violations[${i}].centroid_mm`,
    );
    return zone;
  });
  // measured
  const measuredRoot = requireObject(
    root.measured,
    "dfm_check_overhangs measured",
  );
  const totalSurfaceAreaMm2 = requireNonNegative(
    measuredRoot.total_surface_area_mm2,
    "dfm_check_overhangs measured.total_surface_area_mm2",
  );
  const overhangAreaMm2 = requireNonNegative(
    measuredRoot.overhang_area_mm2,
    "dfm_check_overhangs measured.overhang_area_mm2",
  );
  const overhangTriangleCount = requireNonNegativeInt(
    measuredRoot.overhang_triangle_count,
    "dfm_check_overhangs measured.overhang_triangle_count",
  );
  const totalTriangleCount = requireNonNegativeInt(
    measuredRoot.total_triangle_count,
    "dfm_check_overhangs measured.total_triangle_count",
  );
  if (overhangAreaMm2 > totalSurfaceAreaMm2) {
    throw new Error("capture overhangAreaMm2 must not exceed totalSurfaceAreaMm2.");
  }
  if (overhangTriangleCount > totalTriangleCount) {
    throw new Error(
      "capture overhangTriangleCount must not exceed totalTriangleCount.",
    );
  }
  // limits_declared — required by contract
  if (!root.limits_declared || typeof root.limits_declared !== "object") {
    throw new TypeError(
      "dfm_check_overhangs limits_declared must be an object.",
    );
  }
  if (
    expectedMaxOverhangDeg !== undefined &&
    requireFinite(
        requireObject(root.limits_declared, "dfm_check_overhangs limits_declared")
          .max_overhang_deg,
        "dfm_check_overhangs limits_declared.max_overhang_deg",
      ) !== expectedMaxOverhangDeg
  ) throw new Error("dfm_check_overhangs declared a different threshold.");
  // not_checked
  const rawNotChecked = root.not_checked;
  if (!Array.isArray(rawNotChecked)) {
    throw new Error("dfm_check_overhangs not_checked must be an array.");
  }
  const notChecked = rawNotChecked.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(`dfm_check_overhangs not_checked[${i}] must be a string.`);
    }
    return item;
  });
  // input_artifact — cross-attestation
  const inputArtRoot = requireObject(
    root.input_artifact,
    "dfm_check_overhangs input_artifact",
  );
  const inputSha256 = requireSha256Hex(
    inputArtRoot.sha256,
    "dfm_check_overhangs input_artifact.sha256",
  );
  if (inputSha256 !== expectedSha256) {
    throw new Error(
      `dfm_check_overhangs input_artifact.sha256 mismatch: ` +
        `expected ${expectedSha256}, got ${inputSha256}.`,
    );
  }
  return {
    measured: {
      totalSurfaceAreaMm2,
      overhangAreaMm2,
      overhangTriangleCount,
      totalTriangleCount,
    },
    violations,
    notChecked,
    inputArtifactSha256: inputSha256,
  };
}

// ── Capture record helpers ────────────────────────────────────────────────────

function buildCaptureRecord(
  sc: PrintabilityCheckCase,
  caseDigest: string,
  capturedAt: string,
  trustedRunId: string,
  dispatchedAt: string,
  stepExport: { path: string; sha256: string; bytes: number },
  thickness: DfmThicknessResult,
  overhang: DfmOverhangResult,
): PrintabilityCaptureRecord {
  return {
    schemaVersion: PRINTABILITY_CAPTURE_SCHEMA,
    caseId: sc.id,
    caseRevision: sc.revision,
    caseDigest,
    trustedRunId,
    dispatchedAt,
    capturedAt,
    step: {
      exportName: STEP_EXPORT_NAME,
      stepPath: stepExport.path,
      stepSha256: stepExport.sha256,
      stepBytes: stepExport.bytes,
    },
    providerCallParams: {
      meshSizeMm: sc.meshSizeMm.value,
      buildDirection: [...sc.buildDirection] as [number, number, number],
      minWallThicknessMm: sc.thresholds.minWallThicknessMm.value,
      maxOverhangAngleDeg: sc.thresholds.maxOverhangAngleDeg.value,
    },
    reviewedCaseThresholds: {
      maxUnsupportedAreaMm2: sc.thresholds.maxUnsupportedAreaMm2.value,
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: { ...thickness.measured },
      violations: [...thickness.violations],
      notChecked: [...thickness.notChecked],
      inputArtifactSha256: thickness.inputArtifactSha256,
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: { ...overhang.measured },
      violations: [...overhang.violations],
      notChecked: [...overhang.notChecked],
      inputArtifactSha256: overhang.inputArtifactSha256,
    },
    limitations: [...sc.limitations],
  };
}

/**
 * Fail-closed re-validation of a persisted capture. The WAL "completed" path
 * replays this record instead of the providers, so every field consumed
 * downstream must be proven here — a cast would let a corrupted or truncated
 * capture silently stand in for three real provider calls.
 */
export function parseCaptureRecord(value: unknown): PrintabilityCaptureRecord {
  const root = requireObject(value, "printability capture record");
  if (
    root.schemaVersion !== PRINTABILITY_CAPTURE_SCHEMA &&
    !LEGACY_PRINTABILITY_CAPTURE_SCHEMAS.includes(
      root.schemaVersion as typeof LEGACY_PRINTABILITY_CAPTURE_SCHEMAS[number],
    )
  ) {
    throw new Error(
      `Printability capture record has unsupported schemaVersion: ${root.schemaVersion}.`,
    );
  }
  if (typeof root.caseId !== "string" || typeof root.capturedAt !== "string") {
    throw new Error("Printability capture record is missing required string fields.");
  }
  const caseRevision = requirePositiveInt(root.caseRevision, "capture caseRevision");
  const caseDigest = requireSha256Hex(root.caseDigest, "capture caseDigest");
  const trustedRunId = root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
    ? requireNonEmpty(root.trustedRunId, "capture trustedRunId")
    : undefined;
  const dispatchedAt = root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
    ? requireCanonicalTimestamp(root.dispatchedAt, "capture dispatchedAt")
    : undefined;
  // step
  const stepRoot = requireObject(root.step, "capture step");
  const step = {
    exportName: requireNonEmpty(stepRoot.exportName, "capture step.exportName"),
    stepPath: requireNonEmpty(stepRoot.stepPath, "capture step.stepPath"),
    stepSha256: requireSha256Hex(stepRoot.stepSha256, "capture step.stepSha256"),
    stepBytes: requirePositiveInt(stepRoot.stepBytes, "capture step.stepBytes"),
  };
  // `callParams` is the legacy 2.0/2.1 name; 2.2 separates dispatched
  // provider arguments from reviewed-but-not-dispatched case context.
  const providerCallParamsRoot = requireObject(
    root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
      ? root.providerCallParams
      : root.callParams,
    "capture providerCallParams",
  );
  const meshSizeMm = requireFinite(
    providerCallParamsRoot.meshSizeMm,
    "capture providerCallParams.meshSizeMm",
  );
  if (meshSizeMm <= 0) {
    throw new Error("capture providerCallParams.meshSizeMm must be positive.");
  }
  const rawDir = providerCallParamsRoot.buildDirection;
  if (!Array.isArray(rawDir) || rawDir.length !== 3) {
    throw new TypeError(
      "capture providerCallParams.buildDirection must be a 3-element array.",
    );
  }
  const buildDirection: [number, number, number] = [
    requireFinite(rawDir[0], "capture providerCallParams.buildDirection[0]"),
    requireFinite(rawDir[1], "capture providerCallParams.buildDirection[1]"),
    requireFinite(rawDir[2], "capture providerCallParams.buildDirection[2]"),
  ];
  const minWallThicknessMm = root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
    ? requireFinite(
      providerCallParamsRoot.minWallThicknessMm,
      "capture providerCallParams.minWallThicknessMm",
    )
    : undefined;
  const maxOverhangAngleDeg = root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
    ? requireFinite(
      providerCallParamsRoot.maxOverhangAngleDeg,
      "capture providerCallParams.maxOverhangAngleDeg",
    )
    : undefined;
  const maxUnsupportedAreaMm2 = root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
    ? requireFinite(
      requireObject(root.reviewedCaseThresholds, "capture reviewedCaseThresholds")
        .maxUnsupportedAreaMm2,
      "capture reviewedCaseThresholds.maxUnsupportedAreaMm2",
    )
    : undefined;
  const providerCallParams = {
    meshSizeMm,
    buildDirection,
    ...(minWallThicknessMm !== undefined ? { minWallThicknessMm } : {}),
    ...(maxOverhangAngleDeg !== undefined ? { maxOverhangAngleDeg } : {}),
  };
  const reviewedCaseThresholds = maxUnsupportedAreaMm2 !== undefined
    ? { maxUnsupportedAreaMm2 }
    : undefined;
  // thickness
  const thicknessRoot = requireObject(root.thickness, "capture thickness");
  if (thicknessRoot.tool !== "dfm_check_min_thickness") {
    throw new Error("Capture thickness.tool must be dfm_check_min_thickness.");
  }
  const thicknessMeasuredRoot = requireObject(
    thicknessRoot.measured,
    "capture thickness.measured",
  );
  const thicknessMeasured = {
    minThicknessMm: requireNonNegative(
      thicknessMeasuredRoot.minThicknessMm,
      "capture thickness.measured.minThicknessMm",
    ),
    minPositionMm: requireFiniteTriple(
      thicknessMeasuredRoot.minPositionMm,
      "capture thickness.measured.minPositionMm",
    ),
    sampleCount: requireNonNegativeInt(
      thicknessMeasuredRoot.sampleCount,
      "capture thickness.measured.sampleCount",
    ),
    validRayCount: requireNonNegativeInt(
      thicknessMeasuredRoot.validRayCount,
      "capture thickness.measured.validRayCount",
    ),
  };
  if (thicknessMeasured.validRayCount > thicknessMeasured.sampleCount) {
    throw new Error("capture thickness validRayCount must not exceed sampleCount.");
  }
  const thickness = {
    tool: "dfm_check_min_thickness" as const,
    measured: thicknessMeasured,
    violations: requireViolationZones(
      thicknessRoot.violations,
      "capture thickness.violations",
    ),
    notChecked: requireStringArray(
      thicknessRoot.notChecked,
      "capture thickness.notChecked",
    ),
    inputArtifactSha256: requireSha256Hex(
      thicknessRoot.inputArtifactSha256,
      "capture thickness.inputArtifactSha256",
    ),
  };
  // overhang
  const overhangRoot = requireObject(root.overhang, "capture overhang");
  if (overhangRoot.tool !== "dfm_check_overhangs") {
    throw new Error("Capture overhang.tool must be dfm_check_overhangs.");
  }
  const overhangMeasuredRoot = requireObject(
    overhangRoot.measured,
    "capture overhang.measured",
  );
  const overhangMeasured = {
    totalSurfaceAreaMm2: requireNonNegative(
      overhangMeasuredRoot.totalSurfaceAreaMm2,
      "capture overhang.measured.totalSurfaceAreaMm2",
    ),
    overhangAreaMm2: requireNonNegative(
      overhangMeasuredRoot.overhangAreaMm2,
      "capture overhang.measured.overhangAreaMm2",
    ),
    overhangTriangleCount: requireNonNegativeInt(
      overhangMeasuredRoot.overhangTriangleCount,
      "capture overhang.measured.overhangTriangleCount",
    ),
    totalTriangleCount: requireNonNegativeInt(
      overhangMeasuredRoot.totalTriangleCount,
      "capture overhang.measured.totalTriangleCount",
    ),
  };
  if (overhangMeasured.overhangAreaMm2 > overhangMeasured.totalSurfaceAreaMm2) {
    throw new Error("capture overhangAreaMm2 must not exceed totalSurfaceAreaMm2.");
  }
  if (overhangMeasured.overhangTriangleCount > overhangMeasured.totalTriangleCount) {
    throw new Error(
      "capture overhangTriangleCount must not exceed totalTriangleCount.",
    );
  }
  const overhang = {
    tool: "dfm_check_overhangs" as const,
    measured: overhangMeasured,
    violations: requireViolationZones(
      overhangRoot.violations,
      "capture overhang.violations",
    ),
    notChecked: requireStringArray(
      overhangRoot.notChecked,
      "capture overhang.notChecked",
    ),
    inputArtifactSha256: requireSha256Hex(
      overhangRoot.inputArtifactSha256,
      "capture overhang.inputArtifactSha256",
    ),
  };
  // limitations
  const limitationsRoot = root.limitations;
  if (!Array.isArray(limitationsRoot)) {
    throw new Error("Printability capture record limitations must be an array.");
  }
  const limitations = limitationsRoot.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(`Capture limitation[${i}] must be a string.`);
    }
    return item;
  });
  const record: PrintabilityCaptureRecord = {
    schemaVersion: root.schemaVersion as PrintabilityCaptureRecord["schemaVersion"],
    caseId: root.caseId,
    caseRevision,
    caseDigest,
    ...(trustedRunId ? { trustedRunId } : {}),
    ...(dispatchedAt ? { dispatchedAt } : {}),
    capturedAt: root.capturedAt,
    step,
    ...(root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA
      ? { providerCallParams, reviewedCaseThresholds: reviewedCaseThresholds! }
      : { providerCallParams }),
    thickness,
    overhang,
    limitations,
  };
  if (
    root.schemaVersion === PRINTABILITY_CAPTURE_SCHEMA &&
    deterministicJson(record) !== deterministicJson(root)
  ) {
    throw new Error("Current printability capture record has unsupported fields.");
  }
  return record;
}

export function assertCurrentCaptureEnvelope(
  record: PrintabilityCaptureRecord,
  sc: PrintabilityCheckCase,
  caseDigest: string,
  runId: string,
  dispatchedAt: string,
): void {
  if (
    record.caseId !== sc.id || record.caseRevision !== sc.revision ||
    record.caseDigest !== caseDigest
  ) {
    throw new Error("Printability capture case identity is not exact.");
  }
  if (record.schemaVersion !== PRINTABILITY_CAPTURE_SCHEMA) {
    throw new Error("Printability capture is legacy and cannot be replay-published.");
  }
  if (record.trustedRunId !== runId || record.dispatchedAt !== dispatchedAt) {
    throw new Error("Printability capture run occurrence is not exact.");
  }
  if (
    record.step.exportName !== STEP_EXPORT_NAME ||
    record.step.stepPath !== `/exports/${STEP_EXPORT_NAME}.step` ||
    record.thickness.inputArtifactSha256 !== record.step.stepSha256 ||
    record.overhang.inputArtifactSha256 !== record.step.stepSha256
  ) throw new Error("Printability capture provider handoff is not exact.");
  if (
    record.providerCallParams?.meshSizeMm !== sc.meshSizeMm.value ||
    record.providerCallParams?.minWallThicknessMm !==
      sc.thresholds.minWallThicknessMm.value ||
    record.providerCallParams?.maxOverhangAngleDeg !==
      sc.thresholds.maxOverhangAngleDeg.value ||
    record.reviewedCaseThresholds?.maxUnsupportedAreaMm2 !==
      sc.thresholds.maxUnsupportedAreaMm2.value ||
    deterministicJson(record.providerCallParams?.buildDirection) !==
      deterministicJson(sc.buildDirection) ||
    deterministicJson(record.limitations) !== deterministicJson(sc.limitations)
  ) throw new Error("Printability capture reviewed DFM envelope is not exact.");
}

async function assertCaptureReadback(
  text: string,
  expected: ContentFingerprint,
  label: string,
): Promise<void> {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(`${label} is not valid JSON after readback.`);
  }
  if (deterministicJson(value) !== text) {
    throw new Error(`${label} is not canonical JSON after readback.`);
  }
  const actual = await sha256Fingerprint(value);
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new Error(`${label} does not match its persisted fingerprint.`);
  }
}

function requireViolationZones(
  value: unknown,
  label: string,
): DfmViolationZone[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value.map((item, i) => {
    const zone = requireObject(item, `${label}[${i}]`);
    requireNonNegative(zone.area_mm2, `${label}[${i}].area_mm2`);
    requireFiniteTriple(zone.centroid_mm, `${label}[${i}].centroid_mm`);
    return zone;
  });
}

// ── Primitive helpers ─────────────────────────────────────────────────────────

const SHA256_HEX = /^[0-9a-f]{64}$/;

function requireObject(
  value: unknown,
  label: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireSha256Hex(value: unknown, label: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(
      `${label} must be a 64-character lowercase hex SHA-256 digest.`,
    );
  }
  return value;
}

function requirePositiveInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
  return value;
}

function requireFinite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
  return value;
}

function requireNonNegative(value: unknown, label: string): number {
  const number = requireFinite(value, label);
  if (number < 0) throw new TypeError(`${label} must be non-negative.`);
  return number;
}

function requireNonNegativeInt(value: unknown, label: string): number {
  const number = requireNonNegative(value, label);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`${label} must be an integer.`);
  }
  return number;
}

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  const timestamp = requireNonEmpty(value, label);
  if (
    Number.isNaN(Date.parse(timestamp)) ||
    new Date(Date.parse(timestamp)).toISOString() !== timestamp
  ) throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  return timestamp;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return value.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(`${label}[${i}] must be a string.`);
    }
    return item;
  });
}

function requireFiniteTriple(
  value: unknown,
  label: string,
): [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must be a 3-element array.`);
  }
  return [
    requireFinite(value[0], `${label}[0]`),
    requireFinite(value[1], `${label}[1]`),
    requireFinite(value[2], `${label}[2]`),
  ];
}

function makeArtifact(
  id: string,
  name: string,
  kind: ThreadArtifact["kind"],
  fingerprint: ContentFingerprint,
  uri: string,
  mediaType: string,
  producer: ThreadOperationRef,
  inputArtifactIds: string[],
  freshness: ThreadFreshness,
): ThreadArtifact {
  return {
    id,
    name,
    kind,
    version: fingerprint.digest,
    fingerprint,
    uri,
    mediaType,
    producer,
    inputArtifactIds,
    freshness,
  };
}

function makeLink(
  id: string,
  fromId: string,
  toId: string,
  relation: "derived_from" | "uses",
  rationale: string,
  fromKind: "artifact" | "consumption" | "observation" = "artifact",
  toKind: "artifact" = "artifact",
) {
  return {
    id,
    relation,
    from: { kind: fromKind, id: fromId },
    to: { kind: toKind, id: toId },
    rationale,
  };
}

// ── Run lifecycle helpers ─────────────────────────────────────────────────────

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (
    project.schemaVersion !== "3.0" ||
    project.project.id !== PROJECT_ID ||
    project.project.subjectId !== SUBJECT_ID ||
    run.basis?.kind !== "thread-snapshot" ||
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION.id ||
    workItem.operation.version !==
      COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 DripTray printability operation.",
    );
  }
  return workItem;
}

function requireClaimed(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
) {
  const item = requireShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the CM-01 printability run it claimed.",
    );
  }
  return item;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3PrintabilityRunExecutorCommand,
): void {
  const run = project.agentRuns.find((item) => item.id === command.runId);
  if (!run || run.status !== "completed") {
    throw new Error(
      `Expected CM-01 printability run ${command.runId} to be completed.`,
    );
  }
}

function step(commandId: string, suffix: string): string {
  return `${commandId}:${suffix}`;
}

function safeNow(now: () => string): string {
  try {
    return now();
  } catch {
    return new Date().toISOString();
  }
}
