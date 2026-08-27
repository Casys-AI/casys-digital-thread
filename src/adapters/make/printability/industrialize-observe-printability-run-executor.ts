/**
 * Trusted executor for `industrialize.observe-printability@1`.
 *
 * Stages exact canonical geometry bytes, journals the DFM dispatch, then
 * publishes unit-carrying observations. Never a verdict or evaluation.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { GeometryExportStager } from "../../../application/ports/out/make/geometry-export-stager.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { COMPILE_SEAL_ADMISSION_PRODUCER_TOOL } from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import { INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION } from "../../../domain/make/printability/printability-proposal.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import type {
  ThreadArtifact,
  ThreadEntityKind,
  ThreadObservation,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import { validatePrintabilityCaseCapture } from "./printability-case-capture.ts";
import {
  canonicalPrintabilityObservationText,
  parseDfmOverhangResult,
  parseDfmThicknessResult,
  PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA,
  PRINTABILITY_OBSERVATION_CAPTURE_URI_PREFIX,
  type PrintabilityObservationCapture,
  validatePrintabilityObservationCapture,
} from "./printability-check-capture.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  FilePrintabilityAttemptStore,
  PrintabilityRunOutcomeUnknownError,
} from "./file-printability-attempt-store.ts";
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

export { INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION };
export { PRINTABILITY_OBSERVATION_CAPTURE_URI_PREFIX };

const FORBIDDEN_GEOMETRY_TOOLS = [
  "design.seal-isolated-geometry@1",
  "design.execute-build123d@1",
  COMPILE_SEAL_ADMISSION_PRODUCER_TOOL,
] as const;

export interface PrintabilityObserveThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface IndustrializeObservePrintabilityRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: PrintabilityObserveThreadSnapshotStore;
  readonly caseCaptures: Pick<FileCaptureStore<"printability-case">, "read">;
  readonly observationCaptures: Pick<
    FileCaptureStore<"printability-observation">,
    "save" | "read" | "uriFor"
  >;
  readonly geometryAssets: CanonicalAssetReader;
  readonly stager: GeometryExportStager;
  readonly dfm: McpToolClient;
  readonly attempts: FilePrintabilityAttemptStore;
  readonly lease: EngineeringProjectRunLease;
}

export class IndustrializeObservePrintabilityRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands:
    IndustrializeObservePrintabilityRunExecutorDependencies["commands"];
  readonly #snapshots: PrintabilityObserveThreadSnapshotStore;
  readonly #caseCaptures: IndustrializeObservePrintabilityRunExecutorDependencies[
    "caseCaptures"
  ];
  readonly #observationCaptures:
    IndustrializeObservePrintabilityRunExecutorDependencies["observationCaptures"];
  readonly #geometryAssets: CanonicalAssetReader;
  readonly #stager: GeometryExportStager;
  readonly #dfm: McpToolClient;
  readonly #attempts: FilePrintabilityAttemptStore;
  readonly #lease: EngineeringProjectRunLease;

  constructor(deps: IndustrializeObservePrintabilityRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#caseCaptures = deps.caseCaptures;
    this.#observationCaptures = deps.observationCaptures;
    this.#geometryAssets = deps.geometryAssets;
    this.#stager = deps.stager;
    this.#dfm = deps.dfm;
    this.#attempts = deps.attempts;
    this.#lease = deps.lease;
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
        "Only an authenticated agent can execute the industrialize-observe-printability run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    await requireMrtrApproval(project, run);
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command),
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
  ): Promise<EngineeringProjectSnapshot> {
    let claimed = false;
    let snapshotSaveMayHaveBeenDispatched = false;
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
          summary: "Started the observational FDM printability run.",
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
      if (run.status === "completed") {
        assertCompleted(project, command);
        return project;
      }
      const basis = requireBasis(run);
      const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
      await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
      const caseArtifact = requireBoundArtifact(
        project,
        run,
        basisSnapshot,
        "printabilityCase",
      );
      const geometryArtifact = requireBoundGeometry(project, run, basisSnapshot);
      const caseText = await this.#caseCaptures.read(caseArtifact.fingerprint);
      if (!caseText) {
        throw invalidTransition("The sealed printability case could not be reopened.");
      }
      const caseCapture = await validatePrintabilityCaseCapture(JSON.parse(caseText));
      const printabilityCase = caseCapture.printabilityCase;
      const geometryBytes = await this.#geometryAssets.read(
        geometryArtifact.fingerprint.digest,
      );
      const geometryDigest = await fingerprintResourceBytes(geometryBytes);
      if (geometryDigest !== geometryArtifact.fingerprint.digest) {
        throw invalidTransition(
          "Canonical geometry bytes do not match the bound artifact fingerprint.",
        );
      }
      const planDigest = (await sha256Fingerprint({
        caseDigest: caseCapture.caseDigest,
        geometryDigest,
      })).digest;
      const dispatchedAt = requiredStart(run);
      const wal = await this.#attempts.begin({
        projectId: command.projectId,
        runId: run.id,
        planDigest,
        dispatchedAt,
      });
      let observationCapture: PrintabilityObservationCapture;
      if (wal.action === "dispatch") {
        const staged = await this.#stager.stage({
          bytes: geometryBytes,
          digest: geometryDigest,
          fileName: `${geometryDigest}.step`,
        });
        if (staged.sha256 !== geometryDigest) {
          throw invalidTransition("Staged geometry sha256 diverges from the artifact.");
        }
        const thickness = parseDfmThicknessResult(
          (await this.#dfm.callTool({
            name: "dfm_check_min_thickness",
            arguments: {
              step_path: staged.path,
              expected_step_sha256: geometryDigest,
              min_thickness_mm: printabilityCase.thresholds.minWallThicknessMm.value,
              mesh_size_mm: printabilityCase.meshSizeMm.value,
            },
          })).structuredContent,
          geometryDigest,
          printabilityCase.thresholds.minWallThicknessMm.value,
        );
        const overhang = parseDfmOverhangResult(
          (await this.#dfm.callTool({
            name: "dfm_check_overhangs",
            arguments: {
              step_path: staged.path,
              expected_step_sha256: geometryDigest,
              build_direction: [...printabilityCase.buildDirection],
              max_overhang_deg: printabilityCase.thresholds.maxOverhangAngleDeg.value,
              mesh_size_mm: printabilityCase.meshSizeMm.value,
            },
          })).structuredContent,
          geometryDigest,
          printabilityCase.thresholds.maxOverhangAngleDeg.value,
        );
        observationCapture = await validatePrintabilityObservationCapture({
          schemaVersion: PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA,
          operation: INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
          trustedRunId: run.id,
          dispatchedAt,
          capturedAt: dispatchedAt,
          caseDigest: caseCapture.caseDigest,
          geometry: {
            artifactId: geometryArtifact.id,
            sha256: geometryDigest,
            byteCount: staged.byteCount,
            mediaType: "model/step",
            stagedPath: staged.path,
          },
          providerCallParams: {
            meshSizeMm: printabilityCase.meshSizeMm.value,
            buildDirection: [...printabilityCase.buildDirection],
            minWallThicknessMm: printabilityCase.thresholds.minWallThicknessMm.value,
            maxOverhangAngleDeg: printabilityCase.thresholds.maxOverhangAngleDeg.value,
          },
          reviewedCaseThresholds: {
            maxUnsupportedAreaMm2:
              printabilityCase.thresholds.maxUnsupportedAreaMm2.value,
          },
          thickness: {
            tool: "dfm_check_min_thickness",
            measured: thickness.measured,
            violations: thickness.violations,
            notChecked: thickness.notChecked,
            inputArtifactSha256: thickness.inputArtifactSha256,
          },
          overhang: {
            tool: "dfm_check_overhangs",
            measured: overhang.measured,
            violations: overhang.violations,
            notChecked: overhang.notChecked,
            inputArtifactSha256: overhang.inputArtifactSha256,
          },
          limitations: printabilityCase.limitations,
        });
        const captureText = canonicalPrintabilityObservationText(observationCapture);
        const captureFingerprint = await sha256Fingerprint(observationCapture);
        await this.#observationCaptures.save(captureFingerprint, captureText);
        const readBack = await this.#observationCaptures.read(captureFingerprint);
        if (readBack !== captureText) {
          throw new Error("Printability observation capture was not durably readable.");
        }
        await this.#attempts.recordCapture({
          projectId: command.projectId,
          runId: run.id,
          planDigest,
          recordedAt: dispatchedAt,
          captureFingerprint,
          canonicalCaptureText: captureText,
        });
      } else {
        const readBack = await this.#observationCaptures.read(wal.captureFingerprint);
        if (readBack !== wal.canonicalCaptureText) {
          throw new PrintabilityRunOutcomeUnknownError();
        }
        observationCapture = await validatePrintabilityObservationCapture(
          JSON.parse(readBack),
        );
      }
      const captureFingerprint = await sha256Fingerprint(observationCapture);
      const successor = buildObservationSuccessor({
        basisSnapshot,
        basis,
        run,
        caseArtifact,
        geometryArtifact,
        capture: observationCapture,
        captureFingerprint,
        captureUri: this.#observationCaptures.uriFor(captureFingerprint),
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(successor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error("Printability observation snapshot was not durably readable.");
      }
      await this.#attempts.complete({
        projectId: command.projectId,
        runId: run.id,
        planDigest,
        completedAt: dispatchedAt,
        captureFingerprint,
      });
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the printability observations.",
        });
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Published FDM printability observations.",
          resultSnapshot: snapshotRef(successor.snapshot),
          evidenceRefs: [{
            snapshotId: successor.snapshot.id,
            snapshotRevision: successor.snapshot.revision,
            kind: "artifact" as ThreadEntityKind,
            id: successor.artifact.id,
          }],
        });
      }
      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      return complete;
    } catch (error) {
      if (error instanceof PrintabilityRunOutcomeUnknownError) throw error;
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) return completed;
      }
      if (claimed) {
        try {
          await this.#commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary: "Printability observation failed before a durable Thread write.",
            code: "industrialize-observe-printability-failed",
            message: errorMessage(error),
          });
        } catch {
          // Surface the original error.
        }
      }
      throw error;
    }
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

function buildObservationSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly caseArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
  readonly capture: PrintabilityObservationCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): { readonly snapshot: ThreadSnapshot; readonly artifact: ThreadArtifact } {
  const capturedAt = requiredStart(input.run);
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.id}@${INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: `printability-observation-${input.captureFingerprint.digest}`,
    name: "FDM printability observations",
    kind: "evidence",
    version: input.captureFingerprint.digest,
    fingerprint: input.captureFingerprint,
    uri: input.captureUri,
    mediaType: "application/json",
    producer: operationRef,
    inputArtifactIds: [input.caseArtifact.id, input.geometryArtifact.id],
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
  const prefix = artifact.id;
  const observations: ThreadObservation[] = [
    observation(
      `${prefix}-min-thickness`,
      "Minimum wall thickness measured by dfm_check_min_thickness",
      "min_wall_thickness_mm",
      input.capture.thickness.measured.minThicknessMm,
      "mm",
      operationRef,
      artifact.id,
      capturedAt,
    ),
    observation(
      `${prefix}-overhang-area`,
      "Overhang area measured by dfm_check_overhangs",
      "overhang_area_mm2",
      input.capture.overhang.measured.overhangAreaMm2,
      "mm2",
      operationRef,
      artifact.id,
      capturedAt,
    ),
    observation(
      `${prefix}-total-surface-area`,
      "Total surface area measured by dfm_check_overhangs",
      "total_surface_area_mm2",
      input.capture.overhang.measured.totalSurfaceAreaMm2,
      "mm2",
      operationRef,
      artifact.id,
      capturedAt,
    ),
  ];
  const violationCount = input.capture.thickness.violations.length +
    input.capture.overhang.violations.length;
  if (violationCount > 0) {
    observations.push(observation(
      `${prefix}-dfm-violation-count`,
      "Count of DFM violation zones preserved in the capture",
      "dfm_violation_zone_count",
      violationCount,
      "1",
      operationRef,
      artifact.id,
      capturedAt,
    ));
  }
  const notCheckedCount = input.capture.thickness.notChecked.length +
    input.capture.overhang.notChecked.length;
  if (notCheckedCount > 0) {
    observations.push(observation(
      `${prefix}-not-checked-count`,
      "Count of DFM not_checked labels preserved in the capture",
      "dfm_not_checked_count",
      notCheckedCount,
      "1",
      operationRef,
      artifact.id,
      capturedAt,
    ));
  }
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    {
      id: `industrialize-observe-printability-${input.run.id}`,
      name: "Observe FDM printability",
      subjectId: input.basis.subjectId,
      capturedAt,
      artifacts: [artifact],
      consumptions: [{
        id: `consume-${input.caseArtifact.id}-by-${artifact.id}`,
        artifactId: input.caseArtifact.id,
        consumer: operationRef,
        observedFingerprint: input.caseArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      }, {
        id: `consume-${input.geometryArtifact.id}-by-${artifact.id}`,
        artifactId: input.geometryArtifact.id,
        consumer: operationRef,
        observedFingerprint: input.geometryArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      }],
      observations,
      requirements: [],
      evaluations: [],
      violations: [],
      provenance: [
        {
          id: `derived-from-case-${artifact.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: artifact.id },
          to: { kind: "artifact", id: input.caseArtifact.id },
          rationale: "The printability observation reopens the sealed case.",
        },
        {
          id: `derived-from-geometry-${artifact.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: artifact.id },
          to: { kind: "artifact", id: input.geometryArtifact.id },
          rationale:
            "The printability observation stages the exact canonical geometry.",
        },
        {
          id: `uses-${input.caseArtifact.id}-by-${artifact.id}`,
          relation: "uses",
          from: {
            kind: "consumption",
            id: `consume-${input.caseArtifact.id}-by-${artifact.id}`,
          },
          to: { kind: "artifact", id: input.caseArtifact.id },
          rationale: "The executor re-read the sealed printability case capture.",
        },
        {
          id: `uses-${input.geometryArtifact.id}-by-${artifact.id}`,
          relation: "uses",
          from: {
            kind: "consumption",
            id: `consume-${input.geometryArtifact.id}-by-${artifact.id}`,
          },
          to: { kind: "artifact", id: input.geometryArtifact.id },
          rationale: "The executor staged the exact canonical geometry bytes.",
        },
        ...observations.map((item) => ({
          id: `derived-from-${artifact.id}-by-${item.id}`,
          relation: "derived_from" as const,
          from: { kind: "observation" as const, id: item.id },
          to: { kind: "artifact" as const, id: artifact.id },
          rationale: "The observation is derived from the printability capture.",
        })),
      ],
      proposedActions: [],
    } satisfies ThreadSnapshotExtension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition("This exact printability observation is already present.");
  }
  validateThreadSnapshot(applied.snapshot);
  return { snapshot: applied.snapshot, artifact };
}

function observation(
  id: string,
  name: string,
  metric: string,
  value: number,
  unit: string,
  operation: ThreadObservation["source"]["operation"],
  artifactId: string,
  capturedAt: string,
): ThreadObservation {
  return {
    id,
    name,
    metric,
    quantity: { value, unit },
    source: { operation, artifactIds: [artifactId], capturedAt },
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
}

function requireBoundArtifact(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
  name: string,
): ThreadArtifact {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const binding = workItem?.operation?.bindings.find((item) => item.name === name);
  if (binding?.source.kind !== "thread-entity") {
    throw invalidTransition(`Run is not bound to a Thread ${name} artifact.`);
  }
  const reference = binding.source.reference as EngineeringThreadEntityRef;
  const artifact = snapshot.artifacts.find((item) => item.id === reference.id);
  if (!artifact) {
    throw invalidTransition(
      `Bound ${name} artifact is absent from the execution basis.`,
    );
  }
  return artifact;
}

function requireBoundGeometry(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  snapshot: ThreadSnapshot,
): ThreadArtifact {
  const artifact = requireBoundArtifact(project, run, snapshot, "geometry");
  if (
    (FORBIDDEN_GEOMETRY_TOOLS as readonly string[]).includes(artifact.producer.tool)
  ) {
    throw invalidTransition(
      `Geometry binding refuses ${artifact.producer.tool}; only design.write-geometry@1 is admitted.`,
    );
  }
  if (artifact.producer.tool !== "design.write-geometry@1") {
    throw invalidTransition(
      "Geometry binding must be a design.write-geometry@1 canonical artifact.",
    );
  }
  if (artifact.mediaType !== "model/step") {
    throw invalidTransition(
      "Geometry binding must be a model/step write-geometry artifact.",
    );
  }
  return artifact;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const caseBinding = operation?.bindings.find((item) =>
    item.name === "printabilityCase"
  );
  const geometryBinding = operation?.bindings.find((item) => item.name === "geometry");
  if (
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.id ||
    operation.version !== INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.version ||
    caseBinding?.source.kind !== "thread-entity" ||
    geometryBinding?.source.kind !== "thread-entity" ||
    operation.bindings.length !== 2
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to industrialize.observe-printability@1.`,
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
      "Work item not found.",
    );
  }
  const basis = requireBasis(run);
  const candidates = [];
  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find((item) =>
      item.id === decisionId && item.status === "approved"
    );
    if (!decision?.proposal) continue;
    const approvals = project.approvals.filter((approval: EngineeringApproval) =>
      approval.decisionId === decision.id &&
      approval.status === "approved" &&
      approval.decidedByOrigin === "human"
    );
    if (
      approvals.length === 1 &&
      decision.baseSnapshot?.snapshotId === basis.snapshotId &&
      decision.baseSnapshot.revision === basis.revision
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }
  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "No exact human-approved printability-observe MRTR decision is bound to this run basis.",
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
    throw invalidTransition(
      "The queued Thread basis snapshot is not the exact declared snapshot.",
    );
  }
  return snapshot;
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
