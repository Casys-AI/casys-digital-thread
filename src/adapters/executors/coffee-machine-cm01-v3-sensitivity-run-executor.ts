/**
 * Executor for the first-order forward finite-difference DripTray size-z
 * sensitivity study. No verdict, no threshold, no evaluation — only
 * derivatives with composed units.
 *
 * Why this boundary exists: the sensitivity case is a reviewed configuration
 * file; the agent never supplies provider names, arguments, or geometry. The
 * executor owns the two-provider sequence (base + stepped build123d/CalculiX
 * pair) and the derivative arithmetic (domain layer).
 */

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
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/deterministic-json.ts";
import {
  assertBaseValueMatchesDripTrayRecipeR2,
  computeSensitivities,
  renderDripTraySensitivityScriptForHeight,
  type SensitivityDerivatives,
  type SensitivityMetricMeasurement,
  type SensitivityStudyCase,
  validateSensitivityStudyCase,
} from "../../domain/sensitivity-study.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../domain/thread-snapshot-store.ts";
import { COFFEE_MACHINE_CM01_V3_OPERATION_REFS } from "../../orchestration/operations/coffee-machine-cm01-v3-engineering-kits.ts";
import { FileCaptureStore } from "../captures/file-capture-store.ts";
import {
  type CompleteSensitivityRunAttempt,
  FileSensitivityRunAttemptStore,
} from "../wal/file-sensitivity-run-attempt-store.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import type { McpToolClient } from "../http-mcp-tool-client.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";

export const COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION =
  COFFEE_MACHINE_CM01_V3_OPERATION_REFS.sensitivityDripTrayBaseZ;

const PROJECT_ID = "coffee-machine-cm01-v3" as const;
const SUBJECT_ID = "project:coffee-machine-cm01-v3" as const;

const BASE_EXPORT_NAME = "coffee-machine-cm01-v3-drip-tray-sensitivity-base";
const STEPPED_EXPORT_NAME = "coffee-machine-cm01-v3-drip-tray-sensitivity-stepped";

export const SENSITIVITY_CAPTURE_SCHEMA = "sensitivity-study-capture/1.0" as const;

export interface SensitivityCaptureRecord {
  readonly schemaVersion: typeof SENSITIVITY_CAPTURE_SCHEMA;
  readonly caseId: string;
  readonly caseRevision: number;
  readonly caseDigest: string;
  readonly capturedAt: string;
  readonly base: {
    readonly heightMm: number;
    readonly exportName: string;
    readonly stepSha256: string;
    readonly metrics: Readonly<Record<string, { value: number; unit: string }>>;
  };
  readonly stepped: {
    readonly heightMm: number;
    readonly exportName: string;
    readonly stepSha256: string;
    readonly metrics: Readonly<Record<string, { value: number; unit: string }>>;
  };
  readonly derivatives: readonly {
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }[];
  readonly domain: {
    readonly approximationOrder: string;
    readonly base: number;
    readonly step: number;
    readonly parameterUnit: string;
    readonly localValidityNote: string;
    readonly limitations: readonly string[];
  };
}

export interface CoffeeMachineCm01V3SensitivityRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface CoffeeMachineCm01V3SensitivityRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  readonly sensitivityCase: SensitivityStudyCase;
  readonly build123d: McpToolClient;
  readonly calculix: McpToolClient;
  readonly attempts: FileSensitivityRunAttemptStore;
  readonly captures: FileCaptureStore<"sensitivity-study">;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly now?: () => string;
}

interface SensitivityMaterialization {
  readonly snapshot: ThreadSnapshot;
  readonly evidence: EngineeringThreadEntityRef;
}

interface PersistedCapture {
  readonly record: SensitivityCaptureRecord;
  readonly captureFingerprint: ContentFingerprint;
}

export class CoffeeMachineCm01V3SensitivityRunExecutor {
  readonly #projects;
  readonly #commands;
  readonly #snapshots;
  readonly #sensitivityCase;
  readonly #build123d;
  readonly #calculix;
  readonly #attempts;
  readonly #captures;
  readonly #lease;
  readonly #live;
  readonly #now;

  constructor(deps: CoffeeMachineCm01V3SensitivityRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#sensitivityCase = validateSensitivityStudyCase(deps.sensitivityCase);
    this.#build123d = deps.build123d;
    this.#calculix = deps.calculix;
    this.#attempts = deps.attempts;
    this.#captures = deps.captures;
    this.#lease = deps.lease;
    this.#live = deps.liveUpdates;
    this.#now = deps.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3SensitivityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute the CM-01 DripTray sensitivity study.",
      );
    }
    const project = await this.requiredProject(command.projectId);
    requireShape(project, requireRun(project, command.runId));
    assertBaseValueMatchesDripTrayRecipeR2(this.#sensitivityCase);
    return await this.#lease.withLease(
      command.projectId,
      command.runId,
      () => this.executeLeased(origin, command),
    );
  }

  private async executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: CoffeeMachineCm01V3SensitivityRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let capturePersisted = false;
    let materialized: SensitivityMaterialization | undefined;
    try {
      let project = await this.requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireShape(project, run);
      assertBaseValueMatchesDripTrayRecipeR2(this.#sensitivityCase);
      await this.requiredBasis(project, run);
      await this.#commands.claimRun(origin, {
        ...command,
        commandId: step(command.commandId, "claim"),
        summary: "Started the reviewed CM-01 DripTray size-z sensitivity study.",
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
        "DripTray sensitivity study running",
        "Running the reviewed base and stepped DripTray FEA pair and computing local derivatives.",
      );
      const caseDigest = (await sha256Fingerprint(
        JSON.parse(deterministicJson(this.#sensitivityCase)),
      )).digest;
      const persisted = await this.captureOnce(
        project,
        run,
        startedAt,
        caseDigest,
      );
      capturePersisted = true;
      const uri = this.#captures.uriFor(persisted.captureFingerprint);
      materialized = await materializeSensitivitySnapshot(
        base,
        run.id,
        this.#sensitivityCase,
        persisted.captureFingerprint,
        uri,
        persisted.record.base.stepSha256,
        persisted.record.stepped.stepSha256,
        metricsToMap(persisted.record.base.metrics),
        metricsToMap(persisted.record.stepped.metrics),
        persisted.record.capturedAt,
      );
      await this.#snapshots.save(materialized.snapshot);
      if ((await this.presence(materialized.snapshot)) !== "exact") {
        throw new Error(
          "CM-01 sensitivity snapshot persistence could not be verified.",
        );
      }
      await this.recordLive(
        project.project.subjectId,
        run.id,
        base.revision,
        "fresh",
        persisted.record.capturedAt,
        "DripTray sensitivity evidence captured",
        "Base and stepped solve pairs attested; finite-difference derivatives recorded.",
      );
      project = await this.requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: step(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary:
            "Publishing the attested CM-01 DripTray size-z sensitivity evidence.",
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
          summary: "Recorded the bounded CM-01 DripTray size-z sensitivity study.",
          resultSnapshot: snapshotRef(materialized.snapshot),
          evidenceRefs: [materialized.evidence],
        });
      } else if (run.status !== "completed") throw unexpectedStatus(run, "completed");
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
          "CM-01 sensitivity evidence is durable but project attachment did not finish. Retry this exact command; providers will not run again.",
        );
      }
      if (capturePersisted) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "CM-01 sensitivity capture is durable but its snapshot was not published. Retry this exact command without repeating providers.",
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
          "Completed sensitivity attempt has no readable capture in the CAS.",
        );
      }
      const record = parseCaptureRecord(JSON.parse(text));
      return { record, captureFingerprint: attempt.captureFingerprint };
    }
    // Run base providers.
    const sc = this.#sensitivityCase;
    const baseHeightMm = sc.baseValue.value;
    const steppedHeightMm = baseHeightMm + sc.step.value;
    const baseExport = await callBuild123dExport(
      this.#build123d,
      renderDripTraySensitivityScriptForHeight(baseHeightMm),
      BASE_EXPORT_NAME,
    );
    const baseSolve = await callCalculixSolve(
      this.#calculix,
      sc,
      baseExport.path,
      baseExport.sha256,
      baseExport.bytes,
    );
    if (baseSolve.handoffSha256 !== baseExport.sha256) {
      throw new Error(
        "CalculiX base solve input sha256 differs from the build123d base export.",
      );
    }
    // Run stepped providers.
    const steppedExport = await callBuild123dExport(
      this.#build123d,
      renderDripTraySensitivityScriptForHeight(steppedHeightMm),
      STEPPED_EXPORT_NAME,
    );
    const steppedSolve = await callCalculixSolve(
      this.#calculix,
      sc,
      steppedExport.path,
      steppedExport.sha256,
      steppedExport.bytes,
    );
    if (steppedSolve.handoffSha256 !== steppedExport.sha256) {
      throw new Error(
        "CalculiX stepped solve input sha256 differs from the build123d stepped export.",
      );
    }
    const baseMetrics = extractMetrics(baseSolve.metrics, sc);
    const steppedMetrics = extractMetrics(steppedSolve.metrics, sc);
    const derivatives = computeSensitivities(sc, baseMetrics, steppedMetrics);
    const capturedAt = this.#now();
    const record = buildCaptureRecord(
      sc,
      caseDigest,
      capturedAt,
      baseHeightMm,
      steppedHeightMm,
      baseExport.sha256,
      steppedExport.sha256,
      baseMetrics,
      steppedMetrics,
      derivatives,
    );
    const captureText = deterministicJson(record);
    const captureFingerprint = await sha256Fingerprint(record);
    await this.#captures.save(captureFingerprint, captureText);
    const completeInput: CompleteSensitivityRunAttempt = {
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
        "The CM-01 sensitivity basis belongs to another subject.",
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
        "The exact ThreadSnapshot basis for this CM-01 sensitivity run is unavailable.",
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
    command: CoffeeMachineCm01V3SensitivityRunExecutorCommand,
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
          "CM-01 DripTray sensitivity study stopped before durable evidence was published.",
        code: "cm01-drip-tray-sensitivity-not-published",
        message:
          "The sensitivity study did not produce durable evidence. No automatic provider retry was attempted.",
      });
      await this.recordLive(
        project.project.subjectId,
        run.id,
        requireBasis(run).revision,
        "failed",
        safeNow(this.#now),
        "DripTray sensitivity study stopped",
        "The study stopped before durable evidence was published.",
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
        operationId: COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION.id,
        baseRevision,
        state,
        recordedAt,
        graph: {
          nodes: [{
            id: `${runId}:drip-tray-sensitivity`,
            ref: { kind: "artifact", id: `${runId}:drip-tray-sensitivity` },
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
    command: CoffeeMachineCm01V3SensitivityRunExecutorCommand,
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
 * Materialize the ThreadSnapshot extension from the sensitivity capture.
 *
 * No requirements, evaluations, violations, or proposed actions — the
 * sensitivity study is observational only. Provenance links satisfy all
 * checkArtifact / checkConsumption / checkObservation invariants.
 */
export async function materializeSensitivitySnapshot(
  base: ThreadSnapshot,
  runId: string,
  sensitivityCase: SensitivityStudyCase,
  captureFingerprint: ContentFingerprint,
  uri: string,
  baseSha256: string,
  steppedSha256: string,
  baseMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  steppedMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  capturedAt: string,
): Promise<SensitivityMaterialization> {
  const derivatives = computeSensitivities(
    sensitivityCase,
    baseMetrics,
    steppedMetrics,
  );
  const captureDigest = captureFingerprint.digest;
  const prefix = `drip-tray-sensitivity-${captureDigest}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const cad: ThreadOperationRef = {
    serverId: "build123d",
    tool: "build123d_export",
    runId,
  };
  const solver: ThreadOperationRef = {
    serverId: "calculix",
    tool: "calculix_solve_static",
    runId,
  };
  const localOp: ThreadOperationRef = {
    serverId: "digital-thread",
    tool: "compute_sensitivity_finite_difference",
    runId,
  };
  const captureDocId = `${prefix}-capture`;
  const baseStepId = `${prefix}-base-step`;
  const steppedStepId = `${prefix}-stepped-step`;
  const baseSolveId = `${prefix}-base-solve`;
  const steppedSolveId = `${prefix}-stepped-solve`;
  const baseStepFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: baseSha256,
  };
  const steppedStepFingerprint: ContentFingerprint = {
    algorithm: "sha256",
    digest: steppedSha256,
  };
  const baseSolveFingerprint = await sha256Fingerprint({
    role: "sensitivity-base-solve",
    runId,
    stepSha256: baseSha256,
    metrics: Object.fromEntries(baseMetrics.entries()),
  });
  const steppedSolveFingerprint = await sha256Fingerprint({
    role: "sensitivity-stepped-solve",
    runId,
    stepSha256: steppedSha256,
    metrics: Object.fromEntries(steppedMetrics.entries()),
  });
  const artifacts: ThreadArtifact[] = [
    makeArtifact(
      captureDocId,
      "CM-01 sensitivity study capture",
      "document",
      captureFingerprint,
      uri,
      "application/json",
      localOp,
      [],
      freshness,
    ),
    makeArtifact(
      baseStepId,
      "CM-01 DripTray sensitivity base STEP",
      "step",
      baseStepFingerprint,
      `${uri}#base-step`,
      "model/step",
      cad,
      [],
      freshness,
    ),
    makeArtifact(
      steppedStepId,
      "CM-01 DripTray sensitivity stepped STEP",
      "step",
      steppedStepFingerprint,
      `${uri}#stepped-step`,
      "model/step",
      cad,
      [],
      freshness,
    ),
    makeArtifact(
      baseSolveId,
      "CM-01 DripTray sensitivity base static result",
      "solver-result",
      baseSolveFingerprint,
      `${uri}#base-solve`,
      "application/json",
      solver,
      [baseStepId],
      freshness,
    ),
    makeArtifact(
      steppedSolveId,
      "CM-01 DripTray sensitivity stepped static result",
      "solver-result",
      steppedSolveFingerprint,
      `${uri}#stepped-solve`,
      "application/json",
      solver,
      [steppedStepId],
      freshness,
    ),
  ];
  const consumptions: ThreadArtifactConsumption[] = [
    {
      id: `${prefix}-calc-consumes-base-step`,
      artifactId: baseStepId,
      consumer: solver,
      observedFingerprint: baseStepFingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    },
    {
      id: `${prefix}-calc-consumes-stepped-step`,
      artifactId: steppedStepId,
      consumer: solver,
      observedFingerprint: steppedStepFingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    },
  ];
  // Raw metric observations (source = solve artifact).
  const baseDispId = `${prefix}-base-displacement`;
  const baseVmId = `${prefix}-base-von-mises`;
  const steppedDispId = `${prefix}-stepped-displacement`;
  const steppedVmId = `${prefix}-stepped-von-mises`;
  const derivDispId = `${prefix}-derivative-displacement`;
  const derivVmId = `${prefix}-derivative-von-mises`;
  const baseDisp = baseMetrics.get("assembly_max_displacement");
  const baseVm = baseMetrics.get("assembly_max_von_mises");
  const steppedDisp = steppedMetrics.get("assembly_max_displacement");
  const steppedVm = steppedMetrics.get("assembly_max_von_mises");
  if (!baseDisp || !baseVm || !steppedDisp || !steppedVm) {
    throw new Error("Sensitivity metrics map is missing declared measurements.");
  }
  const derivDisp = derivatives.derivatives.find(
    (d) => d.metric === "assembly_max_displacement",
  );
  const derivVm = derivatives.derivatives.find(
    (d) => d.metric === "assembly_max_von_mises",
  );
  if (!derivDisp || !derivVm) {
    throw new Error("Sensitivity derivatives are missing declared metrics.");
  }
  const observations = [
    {
      id: baseDispId,
      name: "DripTray base maximum displacement",
      metric: "sensitivity_base_assembly_max_displacement",
      quantity: { value: baseDisp.value, unit: baseDisp.unit },
      source: {
        operation: solver,
        artifactIds: [baseSolveId],
        capturedAt,
      },
      freshness,
    },
    {
      id: baseVmId,
      name: "DripTray base maximum von Mises stress",
      metric: "sensitivity_base_assembly_max_von_mises",
      quantity: { value: baseVm.value, unit: baseVm.unit },
      source: {
        operation: solver,
        artifactIds: [baseSolveId],
        capturedAt,
      },
      freshness,
    },
    {
      id: steppedDispId,
      name: "DripTray stepped maximum displacement",
      metric: "sensitivity_stepped_assembly_max_displacement",
      quantity: { value: steppedDisp.value, unit: steppedDisp.unit },
      source: {
        operation: solver,
        artifactIds: [steppedSolveId],
        capturedAt,
      },
      freshness,
    },
    {
      id: steppedVmId,
      name: "DripTray stepped maximum von Mises stress",
      metric: "sensitivity_stepped_assembly_max_von_mises",
      quantity: { value: steppedVm.value, unit: steppedVm.unit },
      source: {
        operation: solver,
        artifactIds: [steppedSolveId],
        capturedAt,
      },
      freshness,
    },
    {
      id: derivDispId,
      name: "DripTray displacement sensitivity (size-z)",
      metric: "sensitivity_derivative_assembly_max_displacement",
      quantity: { value: derivDisp.value, unit: derivDisp.unit },
      source: {
        operation: localOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
    {
      id: derivVmId,
      name: "DripTray von Mises sensitivity (size-z)",
      metric: "sensitivity_derivative_assembly_max_von_mises",
      quantity: { value: derivVm.value, unit: derivVm.unit },
      source: {
        operation: localOp,
        artifactIds: [captureDocId],
        capturedAt,
      },
      freshness,
    },
  ];
  const extension = {
    id: `${prefix}-extension`,
    name: "Capture the CM-01 DripTray size-z sensitivity study",
    subjectId: base.subject.id,
    capturedAt,
    artifacts,
    consumptions,
    observations,
    requirements: [],
    evaluations: [],
    violations: [],
    proposedActions: [],
    provenance: [
      // Consumption → artifact uses links (required by checkConsumption/verified).
      makeLink(
        `${prefix}-calc-consumes-base-step-uses`,
        consumptions[0]!.id,
        baseStepId,
        "uses",
        "CalculiX reported the SHA-256 of the base STEP it consumed.",
        "consumption",
      ),
      makeLink(
        `${prefix}-calc-consumes-stepped-step-uses`,
        consumptions[1]!.id,
        steppedStepId,
        "uses",
        "CalculiX reported the SHA-256 of the stepped STEP it consumed.",
        "consumption",
      ),
      // Artifact → input derived_from links (required by checkArtifact/inputArtifactIds).
      makeLink(
        `${prefix}-base-solve-from-base-step`,
        baseSolveId,
        baseStepId,
        "derived_from",
        "CalculiX solved the base DripTray STEP after attesting its SHA-256.",
      ),
      makeLink(
        `${prefix}-stepped-solve-from-stepped-step`,
        steppedSolveId,
        steppedStepId,
        "derived_from",
        "CalculiX solved the stepped DripTray STEP after attesting its SHA-256.",
      ),
      // Raw observation → solve artifact links (required by checkObservation).
      makeLink(
        `${baseDispId}-from-base-solve`,
        baseDispId,
        baseSolveId,
        "derived_from",
        "The base displacement observation came from the base static solve.",
        "observation",
      ),
      makeLink(
        `${baseVmId}-from-base-solve`,
        baseVmId,
        baseSolveId,
        "derived_from",
        "The base von Mises observation came from the base static solve.",
        "observation",
      ),
      makeLink(
        `${steppedDispId}-from-stepped-solve`,
        steppedDispId,
        steppedSolveId,
        "derived_from",
        "The stepped displacement observation came from the stepped static solve.",
        "observation",
      ),
      makeLink(
        `${steppedVmId}-from-stepped-solve`,
        steppedVmId,
        steppedSolveId,
        "derived_from",
        "The stepped von Mises observation came from the stepped static solve.",
        "observation",
      ),
      // Derivative observation → capture document links (required by checkObservation).
      makeLink(
        `${derivDispId}-from-capture`,
        derivDispId,
        captureDocId,
        "derived_from",
        "The displacement derivative was computed from the capture record.",
        "observation",
      ),
      makeLink(
        `${derivVmId}-from-capture`,
        derivVmId,
        captureDocId,
        "derived_from",
        "The von Mises derivative was computed from the capture record.",
        "observation",
      ),
    ],
  };
  const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
    appliedAt: capturedAt,
  });
  if (!applied.applied || applied.snapshot.revision !== base.revision + 1) {
    throw new Error("CM-01 sensitivity extension was not applied to the basis.");
  }
  const captureDoc = applied.snapshot.artifacts.find(
    (item) => item.id === captureDocId,
  );
  if (!captureDoc) {
    throw new Error("CM-01 sensitivity extension has no capture document artifact.");
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

async function callBuild123dExport(
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
  return parseBuild123dSensitivityExport(result.structuredContent, exportName);
}

/**
 * Parse and validate the structuredContent returned by build123d_export for a
 * sensitivity run. Exported for isolated unit testing.
 */
export function parseBuild123dSensitivityExport(
  value: unknown,
  expectedName: string,
): { path: string; sha256: string; bytes: number } {
  const root = requireObject(
    value,
    "build123d_export structuredContent",
  );
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

async function callCalculixSolve(
  calculix: McpToolClient,
  sc: SensitivityStudyCase,
  stepPath: string,
  stepSha256: string,
  stepBytes: number,
): Promise<{
  handoffSha256: string;
  metrics: {
    maxDisplacement: { value: number; unit: string };
    maxVonMises: { value: number; unit: string };
  };
}> {
  const request = buildCalculixRequest(sc, stepPath, stepSha256);
  const result = await calculix.callTool({
    name: "calculix_solve_static",
    arguments: request,
  });
  return parseCalculixSensitivitySolve(
    result.structuredContent,
    sc,
    stepPath,
    stepBytes,
  );
}

function buildCalculixRequest(
  sc: SensitivityStudyCase,
  stepPath: string,
  stepSha256: string,
): Record<string, unknown> {
  return {
    step_path: stepPath,
    expected_step_sha256: stepSha256,
    mesh_size_mm: sc.solver.mesh.targetSizeMm,
    material: { e_mpa: sc.solver.material.eMpa, nu: sc.solver.material.nu },
    selections: [
      ...sc.solver.supports.map((s) => ({
        name: s.selection.name,
        box: { min: s.selection.box.min, max: s.selection.box.max },
      })),
      ...sc.solver.loads.map((l) => ({
        name: l.selection.name,
        box: { min: l.selection.box.min, max: l.selection.box.max },
      })),
    ],
    fixed: sc.solver.supports.map((s) => s.selection.name),
    loads: sc.solver.loads.map((l) => ({
      selection: l.selection.name,
      force_n: l.force.value,
    })),
  };
}

/**
 * Parse and validate the structuredContent returned by calculix_solve_static
 * for a sensitivity run. Rejects if the declared metric units deviate from the
 * reviewed case. Exported for isolated unit testing.
 */
export function parseCalculixSensitivitySolve(
  value: unknown,
  sc: SensitivityStudyCase,
  expectedSourcePath: string,
  expectedBytes: number,
): {
  handoffSha256: string;
  metrics: {
    maxDisplacement: { value: number; unit: string };
    maxVonMises: { value: number; unit: string };
  };
} {
  const root = requireObject(value, "calculix_solve_static structuredContent");
  if (root.schemaVersion !== "2.0" || root.kind !== "static-solve") {
    throw new Error("calculix_solve_static returned an unsupported contract.");
  }
  const input = requireObject(root.inputArtifact, "CalculiX inputArtifact");
  if (input.sourcePath !== expectedSourcePath || input.bytes !== expectedBytes) {
    throw new Error(
      "CalculiX did not attest the exact exported STEP source for the sensitivity run.",
    );
  }
  const handoffSha256 = requireSha256Hex(input.sha256, "CalculiX input sha256");
  const metricsRoot = requireObject(root.metrics, "CalculiX metrics");
  const dispRoot = requireObject(
    metricsRoot.maxDisplacement,
    "CalculiX maxDisplacement",
  );
  const vmRoot = requireObject(metricsRoot.maxVonMises, "CalculiX maxVonMises");
  // Reject units that diverge from the reviewed case declarations. A metric
  // missing from the case is a rejection too: inventing the expected unit here
  // would be a hidden default standing in for reviewed data.
  const expectedDispUnit = sc.metrics.find(
    (m) => m.id === "assembly_max_displacement",
  )?.unit;
  const expectedVmUnit = sc.metrics.find(
    (m) => m.id === "assembly_max_von_mises",
  )?.unit;
  if (expectedDispUnit === undefined || expectedVmUnit === undefined) {
    throw new TypeError(
      "The sensitivity case does not declare both solved metrics " +
        "(assembly_max_displacement, assembly_max_von_mises); refusing to " +
        "assume their units.",
    );
  }
  if (dispRoot.unit !== expectedDispUnit) {
    throw new TypeError(
      `CalculiX displacement unit must be ${JSON.stringify(expectedDispUnit)}, ` +
        `got ${JSON.stringify(dispRoot.unit)}.`,
    );
  }
  if (vmRoot.unit !== expectedVmUnit) {
    throw new TypeError(
      `CalculiX von Mises unit must be ${JSON.stringify(expectedVmUnit)}, ` +
        `got ${JSON.stringify(vmRoot.unit)}.`,
    );
  }
  return {
    handoffSha256,
    metrics: {
      maxDisplacement: {
        value: requireFinite(dispRoot.value, "CalculiX displacement value"),
        unit: dispRoot.unit,
      },
      maxVonMises: {
        value: requireFinite(vmRoot.value, "CalculiX von Mises value"),
        unit: vmRoot.unit,
      },
    },
  };
}

/** Map from solver output to the Map expected by computeSensitivities. */
function extractMetrics(
  raw: {
    maxDisplacement: { value: number; unit: string };
    maxVonMises: { value: number; unit: string };
  },
  sc: SensitivityStudyCase,
): ReadonlyMap<string, SensitivityMetricMeasurement> {
  const result = new Map<string, SensitivityMetricMeasurement>();
  for (const declaration of sc.metrics) {
    if (declaration.id === "assembly_max_displacement") {
      result.set(declaration.id, {
        value: raw.maxDisplacement.value,
        unit: raw.maxDisplacement.unit,
      });
    } else if (declaration.id === "assembly_max_von_mises") {
      result.set(declaration.id, {
        value: raw.maxVonMises.value,
        unit: raw.maxVonMises.unit,
      });
    } else {
      throw new TypeError(
        `Sensitivity case declares unsupported metric id: ${declaration.id}.`,
      );
    }
  }
  return result;
}

// ── Capture record helpers ────────────────────────────────────────────────────

function buildCaptureRecord(
  sc: SensitivityStudyCase,
  caseDigest: string,
  capturedAt: string,
  baseHeightMm: number,
  steppedHeightMm: number,
  baseSha256: string,
  steppedSha256: string,
  baseMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  steppedMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  derivatives: SensitivityDerivatives,
): SensitivityCaptureRecord {
  return {
    schemaVersion: SENSITIVITY_CAPTURE_SCHEMA,
    caseId: sc.id,
    caseRevision: sc.revision,
    caseDigest,
    capturedAt,
    base: {
      heightMm: baseHeightMm,
      exportName: BASE_EXPORT_NAME,
      stepSha256: baseSha256,
      metrics: Object.fromEntries(baseMetrics.entries()),
    },
    stepped: {
      heightMm: steppedHeightMm,
      exportName: STEPPED_EXPORT_NAME,
      stepSha256: steppedSha256,
      metrics: Object.fromEntries(steppedMetrics.entries()),
    },
    derivatives: derivatives.derivatives.map((d) => ({
      metric: d.metric,
      value: d.value,
      unit: d.unit,
    })),
    domain: {
      approximationOrder: sc.domain.approximationOrder,
      base: derivatives.domain.base,
      step: derivatives.domain.step,
      parameterUnit: derivatives.domain.parameterUnit,
      localValidityNote: sc.domain.localValidityNote,
      limitations: [...sc.domain.limitations],
    },
  };
}

/**
 * Fail-closed re-validation of a persisted capture. The WAL "completed" path
 * replays this record instead of the providers, so every field consumed
 * downstream must be proven here — a cast would let a corrupted or truncated
 * capture silently stand in for two real solver runs.
 */
function parseCaptureRecord(value: unknown): SensitivityCaptureRecord {
  const root = requireObject(value, "sensitivity capture record");
  if (root.schemaVersion !== SENSITIVITY_CAPTURE_SCHEMA) {
    throw new Error(
      `Sensitivity capture record has unsupported schemaVersion: ${root.schemaVersion}.`,
    );
  }
  if (typeof root.caseId !== "string" || typeof root.capturedAt !== "string") {
    throw new Error("Sensitivity capture record is missing required string fields.");
  }
  const caseRevision = requirePositiveInt(root.caseRevision, "capture caseRevision");
  const caseDigest = requireSha256Hex(root.caseDigest, "capture caseDigest");
  const parseRun = (value: unknown, label: string) => {
    const run = requireObject(value, label);
    const metricsRoot = requireObject(run.metrics, `${label} metrics`);
    const metrics: Record<string, { value: number; unit: string }> = {};
    for (const [key, entry] of Object.entries(metricsRoot)) {
      const measurement = requireObject(entry, `${label} metric ${key}`);
      if (typeof measurement.unit !== "string" || measurement.unit.length === 0) {
        throw new Error(`${label} metric ${key} is missing its unit.`);
      }
      metrics[key] = {
        value: requireFinite(measurement.value, `${label} metric ${key} value`),
        unit: measurement.unit,
      };
    }
    if (typeof run.exportName !== "string" || run.exportName.length === 0) {
      throw new Error(`${label} is missing its exportName.`);
    }
    return {
      heightMm: requireFinite(run.heightMm, `${label} heightMm`),
      exportName: run.exportName,
      stepSha256: requireSha256Hex(run.stepSha256, `${label} stepSha256`),
      metrics,
    };
  };
  const derivativesRoot = root.derivatives;
  if (!Array.isArray(derivativesRoot) || derivativesRoot.length === 0) {
    throw new Error("Sensitivity capture record has no derivatives.");
  }
  const derivatives = derivativesRoot.map((entry, index) => {
    const derivative = requireObject(entry, `capture derivative ${index}`);
    if (
      typeof derivative.metric !== "string" || derivative.metric.length === 0 ||
      typeof derivative.unit !== "string" || derivative.unit.length === 0
    ) {
      throw new Error(`Capture derivative ${index} is missing metric or unit.`);
    }
    return {
      metric: derivative.metric,
      value: requireFinite(derivative.value, `capture derivative ${index} value`),
      unit: derivative.unit,
    };
  });
  const domainRoot = requireObject(root.domain, "capture domain");
  if (
    typeof domainRoot.approximationOrder !== "string" ||
    typeof domainRoot.parameterUnit !== "string" ||
    typeof domainRoot.localValidityNote !== "string" ||
    !Array.isArray(domainRoot.limitations) ||
    domainRoot.limitations.some((entry) => typeof entry !== "string")
  ) {
    throw new Error("Sensitivity capture record has a malformed domain block.");
  }
  return {
    schemaVersion: SENSITIVITY_CAPTURE_SCHEMA,
    caseId: root.caseId,
    caseRevision,
    caseDigest,
    capturedAt: root.capturedAt,
    base: parseRun(root.base, "capture base run"),
    stepped: parseRun(root.stepped, "capture stepped run"),
    derivatives,
    domain: {
      approximationOrder: domainRoot.approximationOrder,
      base: requireFinite(domainRoot.base, "capture domain base"),
      step: requireFinite(domainRoot.step, "capture domain step"),
      parameterUnit: domainRoot.parameterUnit,
      localValidityNote: domainRoot.localValidityNote,
      limitations: domainRoot.limitations as string[],
    },
  };
}

function metricsToMap(
  metrics: Readonly<Record<string, { value: number; unit: string }>>,
): ReadonlyMap<string, SensitivityMetricMeasurement> {
  return new Map(Object.entries(metrics));
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
    workItem?.operation?.id !== COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION.id ||
    workItem.operation.version !==
      COFFEE_MACHINE_CM01_V3_SENSITIVITY_OPERATION.version
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "This executor may run only the exact queued CM-01 V3 DripTray sensitivity operation.",
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
      "This executor may run only the CM-01 sensitivity run it claimed.",
    );
  }
  return item;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: CoffeeMachineCm01V3SensitivityRunExecutorCommand,
): void {
  const run = project.agentRuns.find((item) => item.id === command.runId);
  if (!run || run.status !== "completed") {
    throw new Error(
      `Expected CM-01 sensitivity run ${command.runId} to be completed.`,
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
