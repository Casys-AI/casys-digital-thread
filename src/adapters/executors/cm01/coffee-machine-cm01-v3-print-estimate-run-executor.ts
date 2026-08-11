/**
 * Executor for the CM-01 DripTray FFF print-time-and-material observation.
 *
 * Sequence:
 *   1. Read the committed PrusaSlicer INI profile from the repo; verify sha256.
 *   2. Export the server-fixed DripTray STL via build123d (30 mm R2 geometry),
 *      embedding the profile content into the build123d script so that it is
 *      written to /exports at the same time as the STL.
 *   3. Call prusaslicer_estimate_fff with the STL path, the profile path, and
 *      both sha256 attestation values.
 *   4. Verify cross-attestation (stl_artifact.sha256 + profile_artifact.sha256).
 *   5. Build the capture record and materialise the ThreadSnapshot extension.
 *
 * Why the profile is embedded in the build123d script: the prusaslicer
 * container mounts the /exports volume read-only, so the profile must be
 * written there by the build123d container (which has read-write access) as a
 * side effect of the STL export call. The profile content is base64-encoded
 * before embedding so that INI text characters never break the Python string.
 *
 * Cross-attestation: stl_sha256 from build123d_export is passed as stl_sha256
 * to prusaslicer_estimate_fff; the parser then verifies that
 * stl_artifact.sha256 in the response matches the declared value. Similarly,
 * the profile sha256 is computed locally and verified against
 * profile_artifact.sha256 in the response.
 *
 * No verdict, no evaluation, no requirement, no pricing — only observations
 * with explicit units. The not_checked items from mcp-prusaslicer are preserved
 * verbatim and surfaced as a count observation.
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
import { renderDripTrayPrintEstimateScript } from "../../../domain/cm01/cm01-drip-tray-analysis-scripts.ts";
import {
  type PrintEstimateCase,
  validatePrintEstimateCase,
} from "../../../domain/analysis/print-estimate-case.ts";
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
  type CompletePrintEstimateRunAttempt,
  FileCm01DripTrayPrintEstimateAttemptStore,
  type RecordPrintEstimateCaptureAttempt,
} from "../../wal/file-cm01-drip-tray-print-estimate-attempt-store.ts";
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

export const COFFEE_MACHINE_CM01_V3_PRINT_ESTIMATE_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.printEstimateDripTray;

const PROJECT_ID = "coffee-machine-cm01-v3" as const;
const SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;
const STL_EXPORT_NAME = "cm01-drip-tray-print-estimate";

export const PRINT_ESTIMATE_CAPTURE_SCHEMA = "print-estimate-capture/1.2" as const;
const LEGACY_PRINT_ESTIMATE_CAPTURE_SCHEMAS = [
  "print-estimate-capture/1.0",
  "print-estimate-capture/1.1",
] as const;

export interface PrintEstimateCaptureRecord {
  readonly schemaVersion:
    | typeof PRINT_ESTIMATE_CAPTURE_SCHEMA
    | typeof LEGACY_PRINT_ESTIMATE_CAPTURE_SCHEMAS[number];
  readonly caseId: string;
  readonly caseRevision: number;
  readonly caseDigest: string;
  /** Current capture only: binds evidence to this one claimed run occurrence. */
  readonly trustedRunId?: string;
  readonly dispatchedAt?: string;
  readonly capturedAt: string;
  /** STL export — source geometry for the slicer. */
  readonly stl: {
    readonly exportName: string;
    readonly stlPath: string;
    readonly stlSha256: string;
    readonly stlBytes: number;
  };
  /** Profile artifact — committed INI file written to /exports. */
  readonly profile: {
    readonly exportName: string;
    readonly profilePath: string;
    readonly profileSha256: string;
    readonly profileBytes: number;
  };
  /** Server-fixed slicer override, explicitly captured for replay admission. */
  readonly callParams?: {
    readonly filamentDensityGCm3: number | null;
  };
  /** Slicer output — all unitised measurements from the server. */
  readonly estimate: {
    readonly printTimeS: number;
    readonly printTimeNormalMode: string;
    readonly printTimeSilentMode: string | null;
    readonly filamentLengthMm: number;
    readonly filamentVolumeMm3: number;
    /**
     * Present only when filamentDensityGCm3 was declared in the case and
     * passed as filament_density_g_cm3 override to prusaslicer_estimate_fff.
     */
    readonly filamentMassG?: number;
    /**
     * Non-deterministic audit reference. PrusaSlicer embeds a build timestamp;
     * identical inputs on different dates produce different G-code hashes.
     */
    readonly gcodeSha256: string;
    /** Verbatim contractual labels from mcp-prusaslicer. */
    readonly notChecked: readonly string[];
  };
  readonly limitations: readonly string[];
}

export interface CoffeeMachineCm01V3PrintEstimateRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3PrintEstimateRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly printEstimateCase: PrintEstimateCase;
  readonly build123d: McpToolClient;
  readonly prusaslicer: McpToolClient;
  readonly attempts: FileCm01DripTrayPrintEstimateAttemptStore;
  readonly captures: FileCaptureStore<"cm01-drip-tray-print-estimate">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
  /** Server-fixed profile content loader. Defaults to Deno.readTextFile. */
  readonly readProfileContent?: (path: string) => Promise<string>;
}

interface PrintEstimateMaterialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

interface PersistedCapture {
  readonly record: PrintEstimateCaptureRecord;
  readonly captureFingerprint: ContentFingerprint;
}

class PrintEstimateCaptureRecoveryRequiredError extends Error {
  constructor() {
    super("Print-estimate capture is durable and must be recovered without providers.");
    this.name = "PrintEstimateCaptureRecoveryRequiredError";
  }
}

export class CoffeeMachineCm01V3PrintEstimateRunExecutor {
  readonly #projects;
  readonly #commands;
  readonly #snapshots;
  readonly #printEstimateCase;
  readonly #build123d;
  readonly #prusaslicer;
  readonly #attempts;
  readonly #captures;
  readonly #lease;
  readonly #live;
  readonly #now;
  readonly #readProfileContent;

  constructor(deps: CoffeeMachineCm01V3PrintEstimateRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#printEstimateCase = validatePrintEstimateCase(deps.printEstimateCase);
    this.#build123d = deps.build123d;
    this.#prusaslicer = deps.prusaslicer;
    this.#attempts = deps.attempts;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#live = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
    this.#readProfileContent = deps.readProfileContent ??
      ((path: string) => Deno.readTextFile(path));
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3PrintEstimateRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 DripTray FFF print-estimate observation.",
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
    command: CoffeeMachineCm01V3PrintEstimateRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let materialized: PrintEstimateMaterialization | undefined;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      await this.requiredBasis(project, run);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary:
          "Started the reviewed CM-01 DripTray FFF print-time-and-material observation.",
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
        "DripTray print-estimate observation running",
        "Exporting the reviewed DripTray STL and running FFF print-time estimation.",
      );
      const caseDigest = (await sha256Fingerprint(
        JSON.parse(deterministicJson(this.#printEstimateCase)),
      )).digest;
      const persisted = await this.captureOnce(
        project,
        run,
        startedAt,
        caseDigest,
      );
      capturePersisted = true;
      const uri = this.#captures.uriFor(persisted.captureFingerprint);
      materialized = await materializePrintEstimateSnapshot(
        base,
        run.id,
        this.#printEstimateCase,
        persisted.captureFingerprint,
        uri,
        persisted.record,
      );
      await this.#snapshots.save(materialized.snapshot);
      if ((await this.presence(materialized.snapshot)) !== "exact") {
        throw new Error(
          "CM-01 print-estimate snapshot persistence could not be verified.",
        );
      }
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "fresh",
        persisted.record.capturedAt,
        "DripTray print-estimate evidence captured",
        "STL exported and FFF print-time estimation completed and attested.",
      );
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the attested CM-01 DripTray FFF print-time-and-material evidence.",
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
            "Recorded the CM-01 DripTray FFF print-time-and-material observation.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") throw unexpectedStatus(run, "completed");
      const completed = await this.requiredProject(command.projectId);
      assertCompleted(completed, command);
      await this.reconcileLive(completed.project.subjectId, command.runId);
      return completed;
    } catch (error) {
      if (error instanceof PrintEstimateCaptureRecoveryRequiredError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 print-estimate capture is durable but WAL completion needs an exact CAS-only retry. Providers will not run again.",
        );
      }
      if (materialized && (await this.presence(materialized.snapshot)) === "exact") {
        const completed = await this.completedFor(command);
        if (completed) return completed;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 print-estimate evidence is durable but project attachment did not finish. Retry this exact command; providers will not run again.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 print-estimate capture is durable but its snapshot was not published. Retry this exact command without repeating providers.",
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
          "Completed print-estimate attempt has no readable capture in the CAS.",
        );
      }
      const record = parseCaptureRecord(JSON.parse(text));
      await assertCaptureReadback(
        text,
        attempt.captureFingerprint,
        "Completed print-estimate attempt",
      );
      if (
        attempt.canonicalCaptureText !== undefined &&
        text !== attempt.canonicalCaptureText
      ) {
        throw new Error("Print-estimate WAL capture text differs from CAS readback.");
      }
      assertCurrentCaptureEnvelope(
        record,
        this.#printEstimateCase,
        caseDigest,
        run.id,
        dispatchedAt,
      );
      if (
        attempt.recordedAt !== undefined &&
        record.capturedAt !== attempt.recordedAt
      ) {
        throw new Error("Print-estimate capture occurrence timestamp is not exact.");
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
    const sc = this.#printEstimateCase;

    // 1. Load and verify the committed profile.
    const profileContent = await this.#readProfileContent(sc.profile.repoPath);
    const profileBytes = new TextEncoder().encode(profileContent);
    const profileSha256Actual = await computeSha256Hex(profileBytes);
    if (profileSha256Actual !== sc.profile.sha256) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `CM-01 print-estimate profile sha256 mismatch: expected ${sc.profile.sha256}, got ${profileSha256Actual}.`,
      );
    }

    // 2. Export the DripTray STL and write the profile to /exports via build123d.
    const profileB64 = toBase64(profileBytes);
    const script = renderDripTrayPrintEstimateScript(
      profileB64,
      sc.profile.exportName,
    );
    const stlExport = await callBuild123dStlExport(
      this.#build123d,
      script,
      STL_EXPORT_NAME,
    );

    // 3. Call prusaslicer_estimate_fff.
    const profilePathInExports = `/exports/${sc.profile.exportName}.ini`;
    const estimateResult = await callPrusaslicerEstimate(
      this.#prusaslicer,
      stlExport.path,
      stlExport.sha256,
      profilePathInExports,
      profileSha256Actual,
      sc.filamentDensityGCm3?.value,
    );

    const capturedAt = this.#now();
    const record = buildCaptureRecord(
      sc,
      caseDigest,
      capturedAt,
      run.id,
      dispatchedAt,
      stlExport,
      profilePathInExports,
      profileSha256Actual,
      estimateResult,
    );
    const captureText = deterministicJson(record);
    const captureFingerprint = await sha256Fingerprint(record);
    await this.#captures.save(captureFingerprint, captureText);
    const persistedText = await this.#captures.read(captureFingerprint);
    if (!persistedText) {
      throw new Error("Print-estimate capture disappeared after it was saved.");
    }
    await assertCaptureReadback(
      persistedText,
      captureFingerprint,
      "Saved print-estimate capture",
    );
    const persistedRecord = parseCaptureRecord(JSON.parse(persistedText));
    assertCurrentCaptureEnvelope(
      persistedRecord,
      sc,
      caseDigest,
      run.id,
      dispatchedAt,
    );
    const recordInput: RecordPrintEstimateCaptureAttempt = {
      projectId: project.project.id,
      runId: run.id,
      caseDigest,
      dispatchedAt,
      recordedAt: capturedAt,
      captureFingerprint,
      canonicalCaptureText: persistedText,
    };
    const completeInput: CompletePrintEstimateRunAttempt = {
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
    record: RecordPrintEstimateCaptureAttempt,
    complete: CompletePrintEstimateRunAttempt,
  ): Promise<void> {
    let captureRecorded = false;
    try {
      await this.#attempts.recordCapture(record);
      captureRecorded = true;
      await this.#attempts.complete(complete);
    } catch (error) {
      if (captureRecorded) throw new PrintEstimateCaptureRecoveryRequiredError();
      await this.requireCaptureOnlyRecoveryOrThrow(complete, error);
    }
  }

  private async completeCapturedAttempt(
    input: CompletePrintEstimateRunAttempt,
  ): Promise<void> {
    try {
      await this.#attempts.complete(input);
    } catch {
      // This method is called only after begin() admitted capture-recorded.
      // Its exact capture is already durable, even if confirmation I/O fails.
      throw new PrintEstimateCaptureRecoveryRequiredError();
    }
  }

  private async requireCaptureOnlyRecoveryOrThrow(
    input: Pick<
      CompletePrintEstimateRunAttempt,
      "projectId" | "runId" | "caseDigest" | "dispatchedAt"
    >,
    original: unknown,
  ): Promise<never> {
    try {
      const recovery = await this.#attempts.begin(input);
      if (recovery.action === "capture-recorded" || recovery.action === "completed") {
        throw new PrintEstimateCaptureRecoveryRequiredError();
      }
    } catch (error) {
      if (error instanceof PrintEstimateCaptureRecoveryRequiredError) throw error;
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
        "The CM-01 print-estimate basis belongs to another subject.",
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
        "The exact ThreadSnapshot basis for this CM-01 print-estimate run is unavailable.",
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
    command: CoffeeMachineCm01V3PrintEstimateRunExecutorCommand,
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
          "CM-01 DripTray FFF print-estimate observation stopped before durable evidence was published.",
        code: "cm01-drip-tray-print-estimate-not-published",
        message:
          "The print-estimate observation did not produce durable evidence. No automatic provider retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        requireBasis(run).revision,
        "failed",
        safeNow(this.#now),
        "DripTray print-estimate observation stopped",
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
        operationId: COFFEE_MACHINE_CM01_V3_PRINT_ESTIMATE_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:drip-tray-print-estimate`,
            ref: { kind: "artifact", id: `${runId}:drip-tray-print-estimate` },
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
    command: CoffeeMachineCm01V3PrintEstimateRunExecutorCommand,
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
 * Materialise the ThreadSnapshot extension from the print-estimate capture.
 *
 * No requirements, evaluations, violations, or proposed actions — this is an
 * observational run only. Every observation carries an explicit unit. All
 * observations source their artifactIds on the capture document artifact.
 *
 * Observations:
 *  - print_time_s (unit: "s")
 *  - filament_volume_mm3 (unit: "mm3")
 *  - filament_length_mm (unit: "mm")
 *  - filament_mass_g (unit: "g") — ONLY when record.estimate.filamentMassG is present
 *  - not_checked count (unit: "1") — when any not_checked items were reported
 *
 * The G-code SHA-256 remains a non-deterministic audit field in the persisted
 * capture — not a scalar observation or a separately published artifact.
 */
export function materializePrintEstimateSnapshot(
  base: ThreadSnapshot,
  runId: string,
  pc: PrintEstimateCase,
  captureFingerprint: ContentFingerprint,
  uri: string,
  record: PrintEstimateCaptureRecord,
): PrintEstimateMaterialization {
  const captureDigest = captureFingerprint.digest;
  const prefix = `drip-tray-print-estimate-${captureDigest}`;
  const capturedAt = record.capturedAt;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const slicerOp: ThreadOperationRef = {
    serverId: "prusaslicer",
    tool: "prusaslicer_estimate_fff",
    runId,
  };
  const localOp: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "record_print_estimate_observation",
    runId,
  };

  const captureDocId = `${prefix}-capture`;

  // The capture is the sole published artifact. STL and G-code digests are
  // evidence fields in its exact persisted bytes; no URI fragment is claimed
  // to dereference provider bytes that this executor did not capture.
  const artifacts: ThreadArtifact[] = [
    makeArtifact(
      captureDocId,
      "CM-01 DripTray print-estimate capture",
      "document",
      captureFingerprint,
      uri,
      "application/json",
      localOp,
      [],
      freshness,
    ),
  ];

  const printTimeObsId = `${prefix}-print-time-s`;
  const volumeObsId = `${prefix}-filament-volume-mm3`;
  const lengthObsId = `${prefix}-filament-length-mm`;

  const observations: ThreadObservation[] = [
    {
      id: printTimeObsId,
      name: "DripTray estimated print time from prusaslicer_estimate_fff (provisional)",
      metric: "drip_tray_print_time_s",
      quantity: {
        value: record.estimate.printTimeS,
        unit: "s",
      },
      source: {
        operation: slicerOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: volumeObsId,
      name:
        "DripTray estimated filament volume from prusaslicer_estimate_fff (provisional)",
      metric: "drip_tray_filament_volume_mm3",
      quantity: {
        value: record.estimate.filamentVolumeMm3,
        unit: "mm3",
      },
      source: {
        operation: slicerOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: lengthObsId,
      name:
        "DripTray estimated filament length from prusaslicer_estimate_fff (provisional)",
      metric: "drip_tray_filament_length_mm",
      quantity: {
        value: record.estimate.filamentLengthMm,
        unit: "mm",
      },
      source: {
        operation: slicerOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
  ];

  // Provenance links connect observations → the exact capture document.
  const provenance = [
    makeLink(
      `${printTimeObsId}-from-capture`,
      printTimeObsId,
      captureDocId,
      "derived_from",
      "The print-time observation was captured from the print-estimate slicer record.",
      "observation",
    ),
    makeLink(
      `${volumeObsId}-from-capture`,
      volumeObsId,
      captureDocId,
      "derived_from",
      "The filament-volume observation was captured from the print-estimate slicer record.",
      "observation",
    ),
    makeLink(
      `${lengthObsId}-from-capture`,
      lengthObsId,
      captureDocId,
      "derived_from",
      "The filament-length observation was captured from the print-estimate slicer record.",
      "observation",
    ),
  ];

  // Optional: filament mass — only when density was declared and mass was measured.
  // The record must be consistent with the case: filamentMassG present in the
  // capture implies a density was declared and passed as override to the slicer.
  // Reaching this block without a declared density would mean the capture was
  // produced by code that bypassed the parsePrusaslicerEstimateResult guard,
  // which is a hard integrity violation — not a heuristic to paper over.
  if (record.estimate.filamentMassG !== undefined) {
    if (pc.filamentDensityGCm3 === undefined) {
      throw new Error(
        "CM-01 print-estimate capture record contains filamentMassG but the case declares no filamentDensityGCm3. " +
          "The capture is inconsistent with its case.",
      );
    }
    const massObsId = `${prefix}-filament-mass-g`;
    observations.push({
      id: massObsId,
      name:
        `DripTray estimated filament mass at declared density ${pc.filamentDensityGCm3.value} g/cm³ (provisional)`,
      metric: "drip_tray_filament_mass_g",
      quantity: {
        value: record.estimate.filamentMassG,
        unit: "g",
      },
      source: {
        operation: slicerOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    });
    provenance.push(
      makeLink(
        `${massObsId}-from-capture`,
        massObsId,
        captureDocId,
        "derived_from",
        "The filament-mass observation was captured from the print-estimate slicer record using the declared density.",
        "observation",
      ),
    );
  }

  // not_checked count — contractual label preserved verbatim in the capture.
  if (record.estimate.notChecked.length > 0) {
    const notCheckedObsId = `${prefix}-not-checked-count`;
    observations.push({
      id: notCheckedObsId,
      name:
        "DripTray print-estimate not-checked item count (contractual label: provisional)",
      metric: "drip_tray_print_estimate_not_checked_count",
      quantity: {
        value: record.estimate.notChecked.length,
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
    name: "Observe CM-01 DripTray FFF print estimate",
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
      "CM-01 print-estimate extension was not applied to the basis.",
    );
  }
  const captureDoc = applied.snapshot.artifacts.find(
    (item) => item.id === captureDocId,
  );
  if (!captureDoc) {
    throw new Error(
      "CM-01 print-estimate extension has no capture document artifact.",
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
 * print-estimate STL export. Exported for isolated unit testing.
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

export interface PrusaslicerEstimateResult {
  printTimeS: number;
  printTimeNormalMode: string;
  printTimeSilentMode: string | null;
  filamentLengthMm: number;
  filamentVolumeMm3: number;
  filamentMassG?: number;
  gcodeSha256: string;
  notChecked: string[];
  stlArtifactSha256: string;
  profileArtifactSha256: string;
  profileArtifactBytes: number;
}

async function callPrusaslicerEstimate(
  prusaslicer: McpToolClient,
  stlPath: string,
  stlSha256: string,
  profilePath: string,
  profileSha256: string,
  filamentDensityGCm3: number | undefined,
): Promise<PrusaslicerEstimateResult> {
  const args: Record<string, unknown> = {
    stl_path: stlPath,
    stl_sha256: stlSha256,
    profile_ini_path: profilePath,
    profile_sha256: profileSha256,
    timeout_ms: 120000,
  };
  if (filamentDensityGCm3 !== undefined) {
    args.filament_density_g_cm3 = filamentDensityGCm3;
  }
  const result = await prusaslicer.callTool({
    name: "prusaslicer_estimate_fff",
    arguments: args,
  });
  return parsePrusaslicerEstimateResult(
    result.structuredContent,
    stlSha256,
    profileSha256,
    filamentDensityGCm3 !== undefined,
  );
}

/**
 * Parse and validate the structuredContent returned by prusaslicer_estimate_fff.
 * Exported for isolated unit testing.
 *
 * Real contract (from live probe 2026-08-05):
 * Required fields: print_time_s, print_time_normal_mode, print_time_silent_mode,
 * filament_length_mm, filament_volume_mm3, gcode_sha256, not_checked,
 * stl_artifact, profile_artifact.
 * Optional: filament_mass_g (present ONLY when filament_density_g_cm3 was
 * provided as override — NOT when filament_density is set in the INI profile).
 *
 * Cross-attestation:
 * - stl_artifact.sha256 must equal expectedStlSha256.
 * - profile_artifact.sha256 must equal expectedProfileSha256.
 */
export function parsePrusaslicerEstimateResult(
  value: unknown,
  expectedStlSha256: string,
  expectedProfileSha256: string,
  expectMass: boolean,
): PrusaslicerEstimateResult {
  const root = requireObject(value, "prusaslicer_estimate_fff structuredContent");

  const printTimeS = requireFinite(
    root.print_time_s,
    "prusaslicer_estimate_fff print_time_s",
  );
  if (printTimeS < 0) {
    throw new TypeError("prusaslicer_estimate_fff print_time_s must be non-negative.");
  }
  const printTimeNormalMode = requireNonEmpty(
    root.print_time_normal_mode,
    "prusaslicer_estimate_fff print_time_normal_mode",
  );
  const printTimeSilentMode = root.print_time_silent_mode === null
    ? null
    : requireNonEmpty(
      root.print_time_silent_mode,
      "prusaslicer_estimate_fff print_time_silent_mode",
    );
  const filamentLengthMm = requireFinite(
    root.filament_length_mm,
    "prusaslicer_estimate_fff filament_length_mm",
  );
  if (filamentLengthMm < 0) {
    throw new TypeError(
      "prusaslicer_estimate_fff filament_length_mm must be non-negative.",
    );
  }
  const filamentVolumeMm3 = requireFinite(
    root.filament_volume_mm3,
    "prusaslicer_estimate_fff filament_volume_mm3",
  );
  if (filamentVolumeMm3 < 0) {
    throw new TypeError(
      "prusaslicer_estimate_fff filament_volume_mm3 must be non-negative.",
    );
  }

  // filament_mass_g is ABSENT (not null) when density was not provided.
  // An explicit absent check is required here because the field is missing
  // (not null) when the density override was not passed; requireFinite alone
  // would emit a "must be a finite number" error which is misleading.
  let filamentMassG: number | undefined;
  if (expectMass) {
    if (!Object.hasOwn(root, "filament_mass_g")) {
      throw new TypeError(
        "prusaslicer_estimate_fff filament_mass_g is absent from the response but a filament density was declared in the case.",
      );
    }
    filamentMassG = requireFinite(
      root.filament_mass_g,
      "prusaslicer_estimate_fff filament_mass_g",
    );
    if (filamentMassG < 0) {
      throw new TypeError(
        "prusaslicer_estimate_fff filament_mass_g must be non-negative.",
      );
    }
  }

  const gcodeSha256 = requireSha256Hex(
    root.gcode_sha256,
    "prusaslicer_estimate_fff gcode_sha256",
  );

  // not_checked — verbatim contractual labels
  if (!Array.isArray(root.not_checked)) {
    throw new Error("prusaslicer_estimate_fff not_checked must be an array.");
  }
  const notChecked = (root.not_checked as unknown[]).map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(
        `prusaslicer_estimate_fff not_checked[${i}] must be a string.`,
      );
    }
    return item;
  });

  // stl_artifact — cross-attestation
  const stlArtRoot = requireObject(
    root.stl_artifact,
    "prusaslicer_estimate_fff stl_artifact",
  );
  const stlArtSha256 = requireSha256Hex(
    stlArtRoot.sha256,
    "prusaslicer_estimate_fff stl_artifact.sha256",
  );
  if (stlArtSha256 !== expectedStlSha256) {
    throw new Error(
      `prusaslicer_estimate_fff stl_artifact.sha256 mismatch: ` +
        `expected ${expectedStlSha256}, got ${stlArtSha256}.`,
    );
  }

  // profile_artifact — cross-attestation
  const profileArtRoot = requireObject(
    root.profile_artifact,
    "prusaslicer_estimate_fff profile_artifact",
  );
  const profileArtSha256 = requireSha256Hex(
    profileArtRoot.sha256,
    "prusaslicer_estimate_fff profile_artifact.sha256",
  );
  if (profileArtSha256 !== expectedProfileSha256) {
    throw new Error(
      `prusaslicer_estimate_fff profile_artifact.sha256 mismatch: ` +
        `expected ${expectedProfileSha256}, got ${profileArtSha256}.`,
    );
  }
  const profileArtBytes = requirePositiveInt(
    profileArtRoot.bytes,
    "prusaslicer_estimate_fff profile_artifact.bytes",
  );

  return {
    printTimeS,
    printTimeNormalMode,
    printTimeSilentMode,
    filamentLengthMm,
    filamentVolumeMm3,
    ...(filamentMassG !== undefined ? { filamentMassG } : {}),
    gcodeSha256,
    notChecked,
    stlArtifactSha256: stlArtSha256,
    profileArtifactSha256: profileArtSha256,
    profileArtifactBytes: profileArtBytes,
  };
}

// ── Capture record helpers ────────────────────────────────────────────────────

function buildCaptureRecord(
  sc: PrintEstimateCase,
  caseDigest: string,
  capturedAt: string,
  trustedRunId: string,
  dispatchedAt: string,
  stlExport: { path: string; sha256: string; bytes: number },
  profilePath: string,
  profileSha256: string,
  estimate: PrusaslicerEstimateResult,
): PrintEstimateCaptureRecord {
  const estimateBase = {
    printTimeS: estimate.printTimeS,
    printTimeNormalMode: estimate.printTimeNormalMode,
    printTimeSilentMode: estimate.printTimeSilentMode,
    filamentLengthMm: estimate.filamentLengthMm,
    filamentVolumeMm3: estimate.filamentVolumeMm3,
    gcodeSha256: estimate.gcodeSha256,
    notChecked: [...estimate.notChecked],
  };
  return {
    schemaVersion: PRINT_ESTIMATE_CAPTURE_SCHEMA,
    caseId: sc.id,
    caseRevision: sc.revision,
    caseDigest,
    trustedRunId,
    dispatchedAt,
    capturedAt,
    stl: {
      exportName: STL_EXPORT_NAME,
      stlPath: stlExport.path,
      stlSha256: stlExport.sha256,
      stlBytes: stlExport.bytes,
    },
    profile: {
      exportName: sc.profile.exportName,
      profilePath,
      profileSha256,
      profileBytes: estimate.profileArtifactBytes,
    },
    callParams: {
      filamentDensityGCm3: sc.filamentDensityGCm3?.value ?? null,
    },
    estimate: estimate.filamentMassG !== undefined
      ? { ...estimateBase, filamentMassG: estimate.filamentMassG }
      : estimateBase,
    limitations: [...sc.limitations],
  };
}

/**
 * Fail-closed re-validation of a persisted capture. The WAL "completed" path
 * replays this record instead of the providers.
 */
export function parseCaptureRecord(value: unknown): PrintEstimateCaptureRecord {
  const root = requireObject(value, "print-estimate capture record");
  if (
    root.schemaVersion !== PRINT_ESTIMATE_CAPTURE_SCHEMA &&
    !LEGACY_PRINT_ESTIMATE_CAPTURE_SCHEMAS.includes(
      root.schemaVersion as typeof LEGACY_PRINT_ESTIMATE_CAPTURE_SCHEMAS[number],
    )
  ) {
    throw new Error(
      `Print-estimate capture record has unsupported schemaVersion: ${root.schemaVersion}.`,
    );
  }
  if (typeof root.caseId !== "string" || typeof root.capturedAt !== "string") {
    throw new Error(
      "Print-estimate capture record is missing required string fields.",
    );
  }
  const caseRevision = requirePositiveInt(root.caseRevision, "capture caseRevision");
  const caseDigest = requireSha256Hex(root.caseDigest, "capture caseDigest");
  const trustedRunId = root.schemaVersion === PRINT_ESTIMATE_CAPTURE_SCHEMA
    ? requireNonEmpty(root.trustedRunId, "capture trustedRunId")
    : undefined;
  const dispatchedAt = root.schemaVersion === PRINT_ESTIMATE_CAPTURE_SCHEMA
    ? requireCanonicalTimestamp(root.dispatchedAt, "capture dispatchedAt")
    : undefined;
  // stl
  const stlRoot = requireObject(root.stl, "capture stl");
  const stl = {
    exportName: requireNonEmpty(stlRoot.exportName, "capture stl.exportName"),
    stlPath: requireNonEmpty(stlRoot.stlPath, "capture stl.stlPath"),
    stlSha256: requireSha256Hex(stlRoot.stlSha256, "capture stl.stlSha256"),
    stlBytes: requirePositiveInt(stlRoot.stlBytes, "capture stl.stlBytes"),
  };
  // profile
  const profileRoot = requireObject(root.profile, "capture profile");
  const profile = {
    exportName: requireNonEmpty(profileRoot.exportName, "capture profile.exportName"),
    profilePath: requireNonEmpty(
      profileRoot.profilePath,
      "capture profile.profilePath",
    ),
    profileSha256: requireSha256Hex(
      profileRoot.profileSha256,
      "capture profile.profileSha256",
    ),
    profileBytes: requirePositiveInt(
      profileRoot.profileBytes,
      "capture profile.profileBytes",
    ),
  };
  const callParams = root.schemaVersion === PRINT_ESTIMATE_CAPTURE_SCHEMA
    ? parseCurrentCallParams(root.callParams)
    : undefined;
  // estimate
  const estRoot = requireObject(root.estimate, "capture estimate");
  const printTimeS = requireNonNegative(
    estRoot.printTimeS,
    "capture estimate.printTimeS",
  );
  const printTimeNormalMode = requireNonEmpty(
    estRoot.printTimeNormalMode,
    "capture estimate.printTimeNormalMode",
  );
  const printTimeSilentMode = estRoot.printTimeSilentMode === null
    ? null
    : requireNonEmpty(
      estRoot.printTimeSilentMode,
      "capture estimate.printTimeSilentMode",
    );
  const filamentLengthMm = requireNonNegative(
    estRoot.filamentLengthMm,
    "capture estimate.filamentLengthMm",
  );
  const filamentVolumeMm3 = requireNonNegative(
    estRoot.filamentVolumeMm3,
    "capture estimate.filamentVolumeMm3",
  );
  const gcodeSha256 = requireSha256Hex(
    estRoot.gcodeSha256,
    "capture estimate.gcodeSha256",
  );
  const notChecked = requireStringArray(
    estRoot.notChecked,
    "capture estimate.notChecked",
  );
  const estimateBase = {
    printTimeS,
    printTimeNormalMode,
    printTimeSilentMode,
    filamentLengthMm,
    filamentVolumeMm3,
    gcodeSha256,
    notChecked,
  };
  // filamentMassG is optional — ABSENT (not null) when density was not provided.
  const hasFilamentMassG = Object.hasOwn(
    estRoot as Record<string, unknown>,
    "filamentMassG",
  );
  const estimate = hasFilamentMassG
    ? {
      ...estimateBase,
      filamentMassG: requireNonNegative(
        estRoot.filamentMassG,
        "capture estimate.filamentMassG",
      ),
    }
    : estimateBase;
  // limitations
  if (!Array.isArray(root.limitations)) {
    throw new Error("Print-estimate capture record limitations must be an array.");
  }
  const limitations = (root.limitations as unknown[]).map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(`Capture limitation[${i}] must be a string.`);
    }
    return item;
  });
  const record: PrintEstimateCaptureRecord = {
    schemaVersion: root.schemaVersion as PrintEstimateCaptureRecord["schemaVersion"],
    caseId: root.caseId,
    caseRevision,
    caseDigest,
    ...(trustedRunId ? { trustedRunId } : {}),
    ...(dispatchedAt ? { dispatchedAt } : {}),
    capturedAt: root.capturedAt,
    stl,
    profile,
    ...(callParams ? { callParams } : {}),
    estimate,
    limitations,
  };
  if (
    root.schemaVersion === PRINT_ESTIMATE_CAPTURE_SCHEMA &&
    deterministicJson(record) !== deterministicJson(root)
  ) {
    throw new Error("Current print-estimate capture record has unsupported fields.");
  }
  return record;
}

export function assertCurrentCaptureEnvelope(
  record: PrintEstimateCaptureRecord,
  sc: PrintEstimateCase,
  caseDigest: string,
  runId: string,
  dispatchedAt: string,
): void {
  if (
    record.caseId !== sc.id || record.caseRevision !== sc.revision ||
    record.caseDigest !== caseDigest
  ) {
    throw new Error("Print-estimate capture case identity is not exact.");
  }
  if (record.schemaVersion !== PRINT_ESTIMATE_CAPTURE_SCHEMA) {
    throw new Error("Print-estimate capture is legacy and cannot be replay-published.");
  }
  if (record.trustedRunId !== runId || record.dispatchedAt !== dispatchedAt) {
    throw new Error("Print-estimate capture run occurrence is not exact.");
  }
  if (
    record.stl.exportName !== STL_EXPORT_NAME ||
    record.stl.stlPath !== `/exports/${STL_EXPORT_NAME}.stl` ||
    record.profile.exportName !== sc.profile.exportName ||
    record.profile.profilePath !== `/exports/${sc.profile.exportName}.ini` ||
    record.profile.profileSha256 !== sc.profile.sha256 ||
    record.callParams?.filamentDensityGCm3 !==
      (sc.filamentDensityGCm3?.value ?? null) ||
    deterministicJson(record.limitations) !== deterministicJson(sc.limitations)
  ) throw new Error("Print-estimate capture slicer envelope is not exact.");
  if (
    sc.filamentDensityGCm3 === undefined
      ? record.estimate.filamentMassG !== undefined
      : record.estimate.filamentMassG === undefined
  ) throw new Error("Print-estimate capture density and mass are not exact.");
}

function parseCurrentCallParams(value: unknown): {
  readonly filamentDensityGCm3: number | null;
} {
  const root = requireObject(value, "capture callParams");
  const filamentDensityGCm3 = root.filamentDensityGCm3 === null ? null : requireFinite(
    root.filamentDensityGCm3,
    "capture callParams.filamentDensityGCm3",
  );
  if (filamentDensityGCm3 !== null && filamentDensityGCm3 <= 0) {
    throw new TypeError("capture callParams.filamentDensityGCm3 must be positive.");
  }
  return { filamentDensityGCm3 };
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

// ── Base64 helper (pure, no I/O) ──────────────────────────────────────────────

/**
 * Encode Uint8Array bytes to standard base64 (not URL-safe).
 *
 * Deno ships `btoa` for strings but not for arbitrary bytes. We build the
 * binary string manually to avoid multi-byte UTF-8 issues.
 */
export function toBase64(bytes: Uint8Array): string {
  const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let result = "";
  const len = bytes.length;
  for (let i = 0; i < len; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < len ? bytes[i + 1] : 0;
    const b2 = i + 2 < len ? bytes[i + 2] : 0;
    result += CHARS[b0 >> 2];
    result += CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    result += i + 1 < len ? CHARS[((b1 & 0xf) << 2) | (b2 >> 6)] : "=";
    result += i + 2 < len ? CHARS[b2 & 0x3f] : "=";
  }
  return result;
}

// ── Sha256 helper ─────────────────────────────────────────────────────────────

async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a plain ArrayBuffer before crossing the Web Crypto boundary;
  // the input may be backed by a SharedArrayBuffer, which Web Crypto refuses.
  const buf = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ── Primitive helpers ─────────────────────────────────────────────────────────

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

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
  if (typeof value !== "string" || !SHA256_HEX_RE.test(value)) {
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
  ) {
    throw new TypeError(`${label} must be a canonical ISO timestamp.`);
  }
  return timestamp;
}

function requireStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${label} must be an array.`);
  }
  return (value as unknown[]).map((item, i) => {
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
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_PRINT_ESTIMATE_OPERATION.id ||
    workItem.operation.version !==
      COFFEE_MACHINE_CM01_V3_PRINT_ESTIMATE_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 DripTray print-estimate operation.",
    );
  }
  return workItem;
}

function requireClaimed(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  origin: EngineeringProjectCommandOrigin,
) {
  requireShape(project, run);
  if (
    run.claimedBy?.origin !== origin.kind ||
    run.claimedBy.id !== origin.actorId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the CM-01 print-estimate run it claimed.",
    );
  }
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3PrintEstimateRunExecutorCommand,
): void {
  const run = project.agentRuns.find((item) => item.id === command.runId);
  if (!run || run.status !== "completed") {
    throw new Error(
      `Expected CM-01 print-estimate run ${command.runId} to be completed.`,
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
