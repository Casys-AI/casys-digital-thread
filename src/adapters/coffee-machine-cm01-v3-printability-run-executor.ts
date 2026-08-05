/**
 * Executor for the CM-01 DripTray FDM printability observation.
 *
 * Sequence: export the server-fixed DripTray STL via build123d, then run both
 * dfm_check_min_thickness and dfm_check_overhangs with caller-supplied thresholds
 * from the reviewed case. Produces observations with units; no verdict, no
 * evaluation, no requirement.
 *
 * Why this boundary exists: the printability case is a reviewed configuration
 * file; the agent never supplies provider names, thresholds, geometry, or STL
 * paths. The executor owns the three-provider sequence and the snapshot shape.
 * The not_checked labels from mcp-dfm are preserved verbatim in the capture
 * record and reported as an additional observation if any items were omitted.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../domain/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../domain/engineering-project.ts";
import { deterministicJson, sha256Fingerprint } from "../domain/deterministic-json.ts";
import {
  type PrintabilityCheckCase,
  renderDripTrayPrintabilityScript,
  validatePrintabilityCheckCase,
} from "../domain/printability-case.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadFreshness,
  ThreadObservation,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../domain/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../domain/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { FileCaptureStore } from "./file-capture-store.ts";
import {
  type CompletePrintabilityRunAttempt,
  FileCm01DripTrayPrintabilityAttemptStore,
} from "./file-cm01-drip-tray-printability-attempt-store.ts";
import type { EngineeringProjectRunLease } from "./file-engineering-project-run-lease.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "./live-thread-update-store.ts";

export const COFFEE_MACHINE_CM01_V3_PRINTABILITY_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.printabilityDripTray;

const PROJECT_ID = "coffee-machine-cm01-v3" as const;
const SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;
const STL_EXPORT_NAME = "coffee-machine-cm01-v3-drip-tray-printability";

export const PRINTABILITY_CAPTURE_SCHEMA = "printability-check-capture/1.0" as const;

export interface PrintabilityCaptureRecord {
  readonly schemaVersion: typeof PRINTABILITY_CAPTURE_SCHEMA;
  readonly caseId: string;
  readonly caseRevision: number;
  readonly caseDigest: string;
  readonly capturedAt: string;
  readonly stl: {
    readonly exportName: string;
    readonly stlPath: string;
    readonly stlSha256: string;
    readonly stlBytes: number;
  };
  readonly thickness: {
    readonly tool: "dfm_check_min_thickness";
    readonly minThicknessMm: number;
    readonly thresholdMm: number;
    readonly notChecked: readonly string[];
  };
  readonly overhang: {
    readonly tool: "dfm_check_overhangs";
    readonly maxOverhangAngleDeg: number;
    readonly maxUnsupportedAreaMm2: number;
    readonly thresholdAngleDeg: number;
    readonly thresholdAreaMm2: number;
    readonly notChecked: readonly string[];
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
      if (run.status !== "running") throw unexpected(run, "running");
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
        throw unexpected(run, "publishing");
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
      } else if (run.status !== "completed") throw unexpected(run, "completed");
      const completed = await this.requiredProject(command.projectId);
      assertCompleted(completed, command);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
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
    if (attempt.action === "completed") {
      const text = await this.#captures.read(attempt.captureFingerprint);
      if (!text) {
        throw new Error(
          "Completed printability attempt has no readable capture in the CAS.",
        );
      }
      const record = parseCaptureRecord(JSON.parse(text));
      return { record, captureFingerprint: attempt.captureFingerprint };
    }
    // Run providers.
    const sc = this.#printabilityCase;
    const stlExport = await callBuild123dStlExport(
      this.#build123d,
      renderDripTrayPrintabilityScript(),
      STL_EXPORT_NAME,
    );
    const thicknessResult = await callDfmThicknessCheck(
      this.#dfm,
      stlExport.path,
      sc.thresholds.minWallThicknessMm.value,
    );
    const overhangResult = await callDfmOverhangCheck(
      this.#dfm,
      stlExport.path,
      sc.thresholds.maxOverhangAngleDeg.value,
      sc.thresholds.maxUnsupportedAreaMm2.value,
    );
    const capturedAt = this.#now();
    const record = buildCaptureRecord(
      sc,
      caseDigest,
      capturedAt,
      stlExport,
      thicknessResult,
      overhangResult,
    );
    const captureText = deterministicJson(record);
    const captureFingerprint = await sha256Fingerprint(record);
    await this.#captures.save(captureFingerprint, captureText);
    const completeInput: CompletePrintabilityRunAttempt = {
      projectId: project.project.id,
      runId: run.id,
      caseDigest,
      dispatchedAt,
      completedAt: capturedAt,
      captureFingerprint,
    };
    await this.#attempts.complete(completeInput);
    return { record, captureFingerprint };
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
 * reviewed case. The not_checked labels from mcp-dfm are preserved in the
 * capture record (JSON artifact); if any items were not checked, an additional
 * observation reports the count so the contractual label is visible in the
 * thread.
 *
 * DFM does not report the SHA-256 of the STL it consumed, so the STL mesh
 * artifact cannot declare inputArtifactIds for any DFM result. All observations
 * source their artifactIds on the capture document artifact, which contains the
 * complete check record including not_checked items.
 */
export async function materializePrintabilitySnapshot(
  base: ThreadSnapshot,
  runId: string,
  pc: PrintabilityCheckCase,
  captureFingerprint: ContentFingerprint,
  uri: string,
  record: PrintabilityCaptureRecord,
): Promise<PrintabilityMaterialization> {
  const captureDigest = captureFingerprint.digest;
  const prefix = `drip-tray-printability-${captureDigest}`;
  const capturedAt = record.capturedAt;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const cadOp: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };
  const localOp: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "record_printability_observation",
    runId,
  };
  const stlArtifactId = `${prefix}-stl`;
  const captureDocId = `${prefix}-capture`;

  const stlFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: record.stl.stlSha256,
  };

  const artifacts: ThreadArtifact[] = [
    makeArtifact(
      stlArtifactId,
      "CM-01 DripTray printability STL",
      // "mesh" is the closest ThreadArtifactKind for a triangulated STL mesh.
      "mesh",
      stlFingerprint,
      `${uri}#stl`,
      "model/stl",
      cadOp,
      [],
      freshness,
    ),
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

  // All observations derive from the capture document (not from the STL
  // directly, since DFM does not report the SHA-256 of the file it consumed).
  const thicknessObsId = `${prefix}-min-wall-thickness`;
  const overhangObsId = `${prefix}-max-overhang-angle`;
  const unsupportedAreaObsId = `${prefix}-max-unsupported-area`;

  const observations: ThreadObservation[] = [
    {
      id: thicknessObsId,
      name: "DripTray minimum wall thickness (provisional FDM check)",
      metric: "drip_tray_min_wall_thickness_mm",
      quantity: {
        value: record.thickness.minThicknessMm,
        unit: pc.thresholds.minWallThicknessMm.unit,
      },
      source: {
        operation: cadOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: overhangObsId,
      name: "DripTray maximum overhang angle (provisional FDM check)",
      metric: "drip_tray_max_overhang_angle_deg",
      quantity: {
        value: record.overhang.maxOverhangAngleDeg,
        unit: pc.thresholds.maxOverhangAngleDeg.unit,
      },
      source: {
        operation: cadOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: unsupportedAreaObsId,
      name: "DripTray maximum unsupported area (provisional FDM check)",
      metric: "drip_tray_max_unsupported_area_mm2",
      quantity: {
        value: record.overhang.maxUnsupportedAreaMm2,
        unit: pc.thresholds.maxUnsupportedAreaMm2.unit,
      },
      source: {
        operation: cadOp,
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
      "The min-wall-thickness observation was captured from the DFM check record.",
      "observation",
    ),
    makeLink(
      `${overhangObsId}-from-capture`,
      overhangObsId,
      captureDocId,
      "derived_from",
      "The max-overhang-angle observation was captured from the DFM check record.",
      "observation",
    ),
    makeLink(
      `${unsupportedAreaObsId}-from-capture`,
      unsupportedAreaObsId,
      captureDocId,
      "derived_from",
      "The max-unsupported-area observation was captured from the DFM check record.",
      "observation",
    ),
  ];

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

async function callBuild123dStlExport(
  build123d: McpToolClient,
  script: string,
  exportName: string,
): Promise<{ path: string; sha256: string; bytes: number }> {
  const result = await build123d.callTool({
    name: "build123d_export",
    arguments: {
      script,
      formats: ["stl"],
      name: exportName,
      timeout_ms: 120000,
    },
  });
  return parseBuild123dStlExport(result.structuredContent, exportName);
}

/**
 * Parse and validate the structuredContent returned by build123d_export for a
 * printability STL export. Exported for isolated unit testing.
 */
export function parseBuild123dStlExport(
  value: unknown,
  expectedName: string,
): { path: string; sha256: string; bytes: number } {
  const root = requireObject(value, "build123d_export structuredContent");
  if (
    root.schemaVersion !== "1.0" || root.kind !== "export" ||
    !Array.isArray(root.files) || root.files.length !== 1
  ) {
    throw new Error(
      `build123d_export did not return a single reviewed STL export for ${expectedName}.`,
    );
  }
  const file = requireObject(root.files[0], "build123d_export files[0]");
  if (
    file.format !== "stl" ||
    typeof file.path !== "string" ||
    !file.path.includes(expectedName)
  ) {
    throw new Error(
      `build123d_export did not preserve the expected export name ${expectedName}.`,
    );
  }
  const sha256 = requireSha256Hex(file.sha256, "build123d STL sha256");
  const bytes = requirePositiveInt(file.bytes, "build123d STL bytes");
  return { path: file.path, sha256, bytes };
}

export interface DfmThicknessResult {
  minThicknessMm: number;
  notChecked: string[];
}

async function callDfmThicknessCheck(
  dfm: McpToolClient,
  stlPath: string,
  minThresholdMm: number,
): Promise<DfmThicknessResult> {
  const result = await dfm.callTool({
    name: "dfm_check_min_thickness",
    arguments: {
      stl_path: stlPath,
      min_thickness_mm: minThresholdMm,
    },
  });
  return parseDfmThicknessResult(result.structuredContent);
}

/**
 * Parse and validate the structuredContent returned by dfm_check_min_thickness.
 * Exported for isolated unit testing.
 *
 * The not_checked items are preserved verbatim — they are contractual labels
 * from the DFM provider. A not_checked entry means the check was not performed
 * for some faces; absence of a warning is never a guarantee.
 */
export function parseDfmThicknessResult(value: unknown): DfmThicknessResult {
  const root = requireObject(value, "dfm_check_min_thickness structuredContent");
  if (root.schemaVersion !== "1.0" || root.kind !== "dfm-min-thickness") {
    throw new Error(
      "dfm_check_min_thickness returned an unsupported contract schema.",
    );
  }
  const minThicknessMm = requireFinite(
    root.minThicknessMm,
    "dfm_check_min_thickness minThicknessMm",
  );
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
  return { minThicknessMm, notChecked };
}

export interface DfmOverhangResult {
  maxOverhangAngleDeg: number;
  maxUnsupportedAreaMm2: number;
  notChecked: string[];
}

async function callDfmOverhangCheck(
  dfm: McpToolClient,
  stlPath: string,
  maxAngleDeg: number,
  maxAreaMm2: number,
): Promise<DfmOverhangResult> {
  const result = await dfm.callTool({
    name: "dfm_check_overhangs",
    arguments: {
      stl_path: stlPath,
      max_overhang_angle_deg: maxAngleDeg,
      max_unsupported_area_mm2: maxAreaMm2,
    },
  });
  return parseDfmOverhangResult(result.structuredContent);
}

/**
 * Parse and validate the structuredContent returned by dfm_check_overhangs.
 * Exported for isolated unit testing.
 */
export function parseDfmOverhangResult(value: unknown): DfmOverhangResult {
  const root = requireObject(value, "dfm_check_overhangs structuredContent");
  if (root.schemaVersion !== "1.0" || root.kind !== "dfm-overhangs") {
    throw new Error(
      "dfm_check_overhangs returned an unsupported contract schema.",
    );
  }
  const maxOverhangAngleDeg = requireFinite(
    root.maxOverhangAngleDeg,
    "dfm_check_overhangs maxOverhangAngleDeg",
  );
  const maxUnsupportedAreaMm2 = requireFinite(
    root.maxUnsupportedAreaMm2,
    "dfm_check_overhangs maxUnsupportedAreaMm2",
  );
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
  return { maxOverhangAngleDeg, maxUnsupportedAreaMm2, notChecked };
}

// ── Capture record helpers ────────────────────────────────────────────────────

function buildCaptureRecord(
  sc: PrintabilityCheckCase,
  caseDigest: string,
  capturedAt: string,
  stlExport: { path: string; sha256: string; bytes: number },
  thickness: DfmThicknessResult,
  overhang: DfmOverhangResult,
): PrintabilityCaptureRecord {
  return {
    schemaVersion: PRINTABILITY_CAPTURE_SCHEMA,
    caseId: sc.id,
    caseRevision: sc.revision,
    caseDigest,
    capturedAt,
    stl: {
      exportName: STL_EXPORT_NAME,
      stlPath: stlExport.path,
      stlSha256: stlExport.sha256,
      stlBytes: stlExport.bytes,
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      minThicknessMm: thickness.minThicknessMm,
      thresholdMm: sc.thresholds.minWallThicknessMm.value,
      notChecked: [...thickness.notChecked],
    },
    overhang: {
      tool: "dfm_check_overhangs",
      maxOverhangAngleDeg: overhang.maxOverhangAngleDeg,
      maxUnsupportedAreaMm2: overhang.maxUnsupportedAreaMm2,
      thresholdAngleDeg: sc.thresholds.maxOverhangAngleDeg.value,
      thresholdAreaMm2: sc.thresholds.maxUnsupportedAreaMm2.value,
      notChecked: [...overhang.notChecked],
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
function parseCaptureRecord(value: unknown): PrintabilityCaptureRecord {
  const root = requireObject(value, "printability capture record");
  if (root.schemaVersion !== PRINTABILITY_CAPTURE_SCHEMA) {
    throw new Error(
      `Printability capture record has unsupported schemaVersion: ${root.schemaVersion}.`,
    );
  }
  if (typeof root.caseId !== "string" || typeof root.capturedAt !== "string") {
    throw new Error("Printability capture record is missing required string fields.");
  }
  const caseRevision = requirePositiveInt(root.caseRevision, "capture caseRevision");
  const caseDigest = requireSha256Hex(root.caseDigest, "capture caseDigest");
  const stlRoot = requireObject(root.stl, "capture stl");
  const stl = {
    exportName: requireNonEmpty(stlRoot.exportName, "capture stl.exportName"),
    stlPath: requireNonEmpty(stlRoot.stlPath, "capture stl.stlPath"),
    stlSha256: requireSha256Hex(stlRoot.stlSha256, "capture stl.stlSha256"),
    stlBytes: requirePositiveInt(stlRoot.stlBytes, "capture stl.stlBytes"),
  };
  const thicknessRoot = requireObject(root.thickness, "capture thickness");
  if (thicknessRoot.tool !== "dfm_check_min_thickness") {
    throw new Error("Capture thickness.tool must be dfm_check_min_thickness.");
  }
  const thickness = {
    tool: "dfm_check_min_thickness" as const,
    minThicknessMm: requireFinite(
      thicknessRoot.minThicknessMm,
      "capture thickness.minThicknessMm",
    ),
    thresholdMm: requireFinite(
      thicknessRoot.thresholdMm,
      "capture thickness.thresholdMm",
    ),
    notChecked: requireStringArray(
      thicknessRoot.notChecked,
      "capture thickness.notChecked",
    ),
  };
  const overhangRoot = requireObject(root.overhang, "capture overhang");
  if (overhangRoot.tool !== "dfm_check_overhangs") {
    throw new Error("Capture overhang.tool must be dfm_check_overhangs.");
  }
  const overhang = {
    tool: "dfm_check_overhangs" as const,
    maxOverhangAngleDeg: requireFinite(
      overhangRoot.maxOverhangAngleDeg,
      "capture overhang.maxOverhangAngleDeg",
    ),
    maxUnsupportedAreaMm2: requireFinite(
      overhangRoot.maxUnsupportedAreaMm2,
      "capture overhang.maxUnsupportedAreaMm2",
    ),
    thresholdAngleDeg: requireFinite(
      overhangRoot.thresholdAngleDeg,
      "capture overhang.thresholdAngleDeg",
    ),
    thresholdAreaMm2: requireFinite(
      overhangRoot.thresholdAreaMm2,
      "capture overhang.thresholdAreaMm2",
    ),
    notChecked: requireStringArray(
      overhangRoot.notChecked,
      "capture overhang.notChecked",
    ),
  };
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
  return {
    schemaVersion: PRINTABILITY_CAPTURE_SCHEMA,
    caseId: root.caseId,
    caseRevision,
    caseDigest,
    capturedAt: root.capturedAt,
    stl,
    thickness,
    overhang,
    limitations,
  };
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

function requireNonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
  return value;
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

function requireRun(
  project: EngineeringProjectSnapshot,
  runId: string,
): EngineeringAgentRun {
  const run = project.agentRuns.find((item) => item.id === runId);
  if (!run) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Agent run ${runId} does not exist in project ${project.project.id}.`,
    );
  }
  return run;
}

function requireBasis(run: EngineeringAgentRun): EngineeringThreadSnapshotBasis {
  if (run.basis?.kind !== "thread-snapshot") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 printability run ${run.id} must have an exact ThreadSnapshot basis.`,
    );
  }
  return run.basis;
}

function requiredStart(run: EngineeringAgentRun): string {
  if (!run.startedAt || Number.isNaN(Date.parse(run.startedAt))) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `CM-01 printability run ${run.id} has no durable start timestamp.`,
    );
  }
  return run.startedAt;
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

function snapshotRef(snapshot: ThreadSnapshot): EngineeringThreadSnapshotRef {
  return {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
    subjectId: snapshot.subject.id,
  };
}

function step(commandId: string, suffix: string): string {
  return `${commandId}:${suffix}`;
}

function unexpected(run: EngineeringAgentRun, expected: string): Error {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Expected run ${run.id} to be in state ${expected}, got ${run.status}.`,
  );
}

function safeNow(now: () => string): string {
  try {
    return now();
  } catch {
    return new Date().toISOString();
  }
}
