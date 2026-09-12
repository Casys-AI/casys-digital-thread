/**
 * Trusted executor for `industrialize.run-dfm-checks@1`.
 *
 * After the final MRTR/basis/case/STEP/capability recheck it opens a lease-bound
 * JIT session, stages the canonical STEP into the owned mcp-dfm container, then
 * claims and dispatches the three live tools. Session, locator or staging
 * failure leaves a queued run untouched. A fail is publishable.
 */

import type { EngineeringProjectCommandOrigin } from "../../../application/ports/in/engineering-project-command-origin.ts";
import type { CanonicalAssetReader } from "../../../application/ports/out/canonical-asset-reader.ts";
import type { EngineeringProjectRevisionStore } from "../../../application/ports/out/engineering-project-revision-store.ts";
import type { CapabilitySessionGeometryExportStagerFactory } from "../../../application/ports/out/make/geometry-export-stager.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../../../application/ports/out/capability/capability-runtime-supervisor.ts";
import {
  beginConfiguredCapabilityRuntimeSession,
  requireConfiguredOperationalCapability,
  settleCapabilityRuntimeSession,
} from "../../../application/control-plane/capability-runtime-execution-admission.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "../../../application/control-plane/capability-runtime-execution-session.ts";
import {
  type CapabilityRuntimeBoundMcpClient,
  CapabilityRuntimeConnectionError,
} from "../../../application/ports/out/capability/capability-runtime-connection.ts";
import { openLeaseBoundCapabilityRuntimeMcpClient } from "../../../application/control-plane/capability-runtime-bound-mcp-client.ts";
import { requiredQualifiedPersistentComposePublication } from "../../../application/control-plane/capability-runtime-persistent-compose-publication.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../../domain/capability/runtime/capability-runtime-material.ts";
import { MCP_DFM_010_IMAGE_REFERENCE } from "../../control-plane/first-party-capability-runtime-identities.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import { fingerprintResourceBytes } from "../../../domain/compile/source/provider-resource-reader.ts";
import {
  DFM_ENVELOPE_TOOL,
  DFM_OVERHANG_TOOL,
  DFM_TARGET_MEDIA_TYPE,
  DFM_THICKNESS_TOOL,
  type DfmCheckCase,
} from "../../../domain/make/dfm/dfm-case.ts";
import { attestCanonicalWriteGeometryStep } from "../../../domain/make/dfm/dfm-canonical-step.ts";
import {
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
  parseDfmRunDecisionParameters,
  verifyDfmRunParametersMatchCase,
} from "../../../domain/make/dfm/dfm-proposal.ts";
import { recrossDfmRunAuthority } from "../../../domain/make/dfm/dfm-run-authority.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  EngineeringAgentRun,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotBasis,
  EngineeringWorkItem,
} from "../../../domain/project/engineering-project.ts";
import type {
  RequirementEvaluation,
  ThreadArtifact,
  ThreadEntityKind,
  ThreadObservation,
  ThreadSnapshot,
  ThreadViolation,
  TracedRequirement,
} from "../../../domain/thread/thread-snapshot.ts";
import {
  applyThreadSnapshotExtensionIfNew,
  type ThreadSnapshotExtension,
} from "../../../domain/thread/thread-snapshot-extension.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { FileCaptureStore } from "../../shared/cas/file-capture-store.ts";
import {
  assertDfmCaseArtifactCapture,
  type DfmCaseCapture,
  validateDfmCaseCapture,
} from "./dfm-case-capture.ts";
import {
  canonicalDfmCheckCaptureText,
  DFM_CHECK_CAPTURE_SCHEMA,
  DFM_CHECK_CAPTURE_URI_PREFIX,
  type DfmCheckCapture,
  evaluateCapturedDfmChecks,
  parseDfmEnvelopeResult,
  parseDfmOverhangResult,
  parseDfmThicknessResult,
  persistZMinFilterTrace,
  validateDfmCheckCapture,
} from "./dfm-check-capture.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import {
  DfmCheckRunOutcomeUnknownError,
  FileDfmCheckAttemptStore,
} from "./file-dfm-check-attempt-store.ts";
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

export { INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION };
export { DFM_CHECK_CAPTURE_URI_PREFIX };

interface DfmDocumentaryBasis {
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly basisSnapshot: ThreadSnapshot;
  readonly caseArtifact: ThreadArtifact;
  readonly caseCapture: DfmCaseCapture;
  readonly dfmCase: DfmCheckCase;
  readonly geometryArtifact: ThreadArtifact;
  readonly geometryBytes: Uint8Array;
  readonly geometryDigest: string;
  readonly planDigest: string;
}

export interface DfmRunThreadSnapshotStore extends ThreadSnapshotStore {
  getFresh(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export interface IndustrializeRunDfmChecksRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "claimRun" | "publishRun" | "completeRun" | "failRun"
  >;
  readonly snapshots: DfmRunThreadSnapshotStore;
  readonly caseCaptures: Pick<FileCaptureStore<"dfm-case">, "read">;
  readonly checkCaptures: Pick<
    FileCaptureStore<"dfm-check">,
    "save" | "read" | "uriFor"
  >;
  readonly geometryAssets: CanonicalAssetReader;
  readonly stagerFactory: CapabilitySessionGeometryExportStagerFactory;
  /**
   * Lease-bound mcp-dfm publication. The executor never names a URL, host,
   * port, bearer, provider or tool envelope; composition owns the mapping.
   */
  readonly capabilityRuntimeConnection: CapabilityRuntimeBoundMcpClient;
  readonly attempts: FileDfmCheckAttemptStore;
  readonly lease: EngineeringProjectRunLease;
  readonly capabilityRuntime?: CapabilityRuntimeExecutionEligibility;
  /** JIT host session. Entered only after the final cold recheck and before
   * claim, WAL, or mcp-dfm. */
  readonly capabilityRuntimeSession?: Pick<
    CapabilityRuntimeExecutionSessionCoordinator,
    "begin"
  >;
}

export class IndustrializeRunDfmChecksRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: IndustrializeRunDfmChecksRunExecutorDependencies["commands"];
  readonly #snapshots: DfmRunThreadSnapshotStore;
  readonly #caseCaptures:
    IndustrializeRunDfmChecksRunExecutorDependencies["caseCaptures"];
  readonly #checkCaptures: IndustrializeRunDfmChecksRunExecutorDependencies[
    "checkCaptures"
  ];
  readonly #geometryAssets: CanonicalAssetReader;
  readonly #stagerFactory: CapabilitySessionGeometryExportStagerFactory;
  readonly #capabilityRuntimeConnection: CapabilityRuntimeBoundMcpClient;
  readonly #attempts: FileDfmCheckAttemptStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #capabilityRuntime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly #capabilityRuntimeSession:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;

  constructor(deps: IndustrializeRunDfmChecksRunExecutorDependencies) {
    this.#projects = deps.projects;
    this.#commands = deps.commands;
    this.#snapshots = deps.snapshots;
    this.#caseCaptures = deps.caseCaptures;
    this.#checkCaptures = deps.checkCaptures;
    this.#geometryAssets = deps.geometryAssets;
    this.#stagerFactory = deps.stagerFactory;
    this.#capabilityRuntimeConnection = deps.capabilityRuntimeConnection;
    this.#attempts = deps.attempts;
    this.#lease = deps.lease;
    this.#capabilityRuntime = deps.capabilityRuntime;
    this.#capabilityRuntimeSession = deps.capabilityRuntimeSession;
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
        "Only an authenticated agent can execute the industrialize-run-dfm-checks run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);
    const { proposal } = await requireMrtrApproval(project, run);
    try {
      parseDfmRunDecisionParameters(proposal.parameters);
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `DFM run decision parameters are invalid: ${errorMessage(error)}`,
      );
    }
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
    let providerOrWalDispatched = false;
    let capabilitySession: CapabilityRuntimeExecutionSession | undefined;
    try {
      const preClaim = await this.#requiredProject(command.projectId);
      const preClaimRun = requireRun(preClaim, command.runId);
      requireShape(preClaim, preClaimRun);
      const alreadyCompleted = await this.#completedFor(command);
      if (alreadyCompleted) return alreadyCompleted;
      await assertThreadWriteBasisAvailable(preClaim, preClaimRun);
      const documentary = await this.#reopenDocumentaryBasis(preClaim, preClaimRun);
      const walPeek = await this.#peekWriteAhead(
        command.projectId,
        preClaimRun.id,
        documentary.planDigest,
      );
      let stagedPath: string | undefined;
      let stagedByteCount: number | undefined;
      let dfm: McpToolClient | undefined;
      if (walPeek.kind === "absent") {
        const operationalCapability = await this.#requireOperationalCapability(
          preClaim,
          preClaimRun,
        );
        capabilitySession = await beginConfiguredCapabilityRuntimeSession({
          session: this.#capabilityRuntimeSession!,
          project: preClaim,
          runId: command.runId,
          operationalCapability,
          recheck: async () => {
            const fresh = await this.#requiredProject(command.projectId);
            const run = requireRun(fresh, command.runId);
            requireShape(fresh, run);
            await this.#reopenDocumentaryBasis(fresh, run);
            return await this.#requireOperationalCapability(fresh, run);
          },
        });
        try {
          dfm = await this.#openBoundDfmClient(
            capabilitySession,
            operationalCapability,
          );
          const publication = requiredQualifiedPersistentComposePublication(
            operationalCapability,
          );
          const stager = await this.#stagerFactory.forActiveCapabilitySession({
            lease: capabilitySession.lease,
            launchGroup: publication.launchGroup,
            material: exactDfmMaterial(operationalCapability),
          });
          const staged = await stager.stage({
            bytes: documentary.geometryBytes,
            digest: documentary.geometryDigest,
            fileName: `dfm-${documentary.geometryDigest}.step`,
          });
          if (staged.sha256 !== documentary.geometryDigest) {
            throw invalidTransition(
              "Staged geometry sha256 diverges from the artifact.",
            );
          }
          stagedPath = staged.path;
          stagedByteCount = staged.byteCount;
        } catch (error) {
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "release" },
          });
          capabilitySession = undefined;
          if (error instanceof CapabilityRuntimeConnectionError) {
            throw new EngineeringProjectCommandError(
              "invalid_transition",
              error.message,
            );
          }
          throw error;
        }
      }
      if (
        preClaimRun.status !== "queued" &&
        preClaimRun.status !== "running" &&
        preClaimRun.status !== "publishing"
      ) {
        throw unexpectedStatus(
          preClaimRun,
          "queued or this agent's running/publishing",
        );
      }
      if (preClaimRun.status === "queued") {
        await this.#commands.claimRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "claim"),
          summary: "Started the measured DFM check run.",
        });
        claimed = true;
      }
      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      if (run.status === "completed") {
        assertCompleted(project, command);
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "release" },
        });
        return project;
      }
      const dispatchedAt = requiredStart(run);
      const wal = await this.#attempts.begin({
        projectId: command.projectId,
        runId: run.id,
        planDigest: documentary.planDigest,
        dispatchedAt,
      });
      let checkCapture: DfmCheckCapture;
      if (wal.action === "dispatch") {
        if (
          stagedPath === undefined || stagedByteCount === undefined ||
          dfm === undefined
        ) {
          throw invalidTransition(
            "Measured DFM checks cannot dispatch without a lease-bound staged STEP.",
          );
        }
        providerOrWalDispatched = true;
        checkCapture = await this.#dispatchMeasuredChecks({
          dfm,
          run,
          dispatchedAt,
          documentary,
          stagedPath,
          stagedByteCount,
        });
        const captureText = canonicalDfmCheckCaptureText(checkCapture);
        const captureFingerprint = await sha256Fingerprint(checkCapture);
        await this.#checkCaptures.save(captureFingerprint, captureText);
        const readBack = await this.#checkCaptures.read(captureFingerprint);
        if (readBack !== captureText) {
          throw new Error("DFM check capture was not durably readable.");
        }
        await this.#attempts.recordCapture({
          projectId: command.projectId,
          runId: run.id,
          planDigest: documentary.planDigest,
          recordedAt: dispatchedAt,
          captureFingerprint,
          canonicalCaptureText: captureText,
        });
      } else {
        const readBack = await this.#checkCaptures.read(wal.captureFingerprint);
        if (readBack !== wal.canonicalCaptureText) {
          throw new DfmCheckRunOutcomeUnknownError();
        }
        checkCapture = validateDfmCheckCapture(JSON.parse(readBack));
      }
      const captureFingerprint = await sha256Fingerprint(checkCapture);
      const successor = buildCheckSuccessor({
        basisSnapshot: documentary.basisSnapshot,
        basis: documentary.basis,
        run,
        caseArtifact: documentary.caseArtifact,
        geometryArtifact: documentary.geometryArtifact,
        dfmCase: documentary.dfmCase,
        capture: checkCapture,
        captureFingerprint,
        captureUri: this.#checkCaptures.uriFor(captureFingerprint),
      });
      snapshotSaveMayHaveBeenDispatched = true;
      await this.#snapshots.save(successor.snapshot);
      const snapshotReadback = await this.#snapshots.getFresh(successor.snapshot.id);
      if (
        !snapshotReadback ||
        deterministicJson(snapshotReadback) !== deterministicJson(successor.snapshot)
      ) {
        throw new Error("DFM check snapshot was not durably readable.");
      }
      await this.#attempts.complete({
        projectId: command.projectId,
        runId: run.id,
        planDigest: documentary.planDigest,
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
          summary: "Publishing the measured DFM checks.",
        });
      }
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: successor.failed
            ? "Published measured DFM checks with named violations."
            : "Published measured DFM checks.",
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
      await settleCapabilityRuntimeSession({
        session: capabilitySession,
        policy: { kind: "release" },
      });
      return complete;
    } catch (error) {
      if (error instanceof DfmCheckRunOutcomeUnknownError) {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw error;
      }
      if (snapshotSaveMayHaveBeenDispatched) {
        const completed = await this.#completedFor(command);
        if (completed) {
          await settleCapabilityRuntimeSession({
            session: capabilitySession,
            policy: { kind: "release" },
          });
          return completed;
        }
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
        throw error;
      }
      if (providerOrWalDispatched) {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: { kind: "retain" },
        });
      }
      if (claimed) {
        try {
          await this.#commands.failRun(origin, {
            ...command,
            commandId: commandStep(command.commandId, "fail"),
            expectedRevision: (await this.#requiredProject(command.projectId)).revision,
            summary: "Measured DFM checks failed before a durable Thread write.",
            code: "industrialize-run-dfm-checks-failed",
            message: errorMessage(error),
          });
        } catch {
          // Surface the original error.
        }
      }
      if (!providerOrWalDispatched) {
        await settleCapabilityRuntimeSession({
          session: capabilitySession,
          policy: {
            kind: "release-if-terminal",
            run: await this.#currentRun(command.projectId, command.runId),
          },
        });
      }
      throw error;
    }
  }

  async #reopenDocumentaryBasis(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<DfmDocumentaryBasis> {
    requireShape(project, run);
    const { proposal } = await requireMrtrApproval(project, run);
    const runParams = parseDfmRunDecisionParameters(proposal.parameters);
    const basis = requireBasis(run);
    const basisSnapshot = await exactBasisSnapshot(this.#snapshots, basis);
    await assertThreadSnapshotLineageIntact(basisSnapshot, this.#snapshots);
    const caseArtifact = requireBoundArtifact(project, run, basisSnapshot, "dfmCase");
    const geometryArtifact = requireBoundGeometry(project, run, basisSnapshot);
    const caseText = await this.#caseCaptures.read(caseArtifact.fingerprint);
    if (!caseText) {
      throw invalidTransition("The sealed DFM case could not be reopened.");
    }
    const caseCapture = await validateDfmCaseCapture(JSON.parse(caseText));
    await assertDfmCaseArtifactCapture(caseArtifact, caseCapture, caseText);
    const dfmCase = caseCapture.dfmCase;
    verifyDfmRunParametersMatchCase(runParams, dfmCase, caseCapture.caseDigest);
    const geometryBytes = await this.#geometryAssets.read(
      geometryArtifact.fingerprint.digest,
    );
    const geometryDigest = await fingerprintResourceBytes(geometryBytes);
    if (geometryDigest !== geometryArtifact.fingerprint.digest) {
      throw invalidTransition(
        "Canonical geometry bytes do not match the bound artifact fingerprint.",
      );
    }
    if (geometryDigest !== dfmCase.target.sha256) {
      throw invalidTransition(
        `Bound geometry SHA-256 mismatch: expected ${dfmCase.target.sha256}, ` +
          `observed ${geometryDigest}.`,
      );
    }
    const planDigest = (await sha256Fingerprint({
      caseDigest: caseCapture.caseDigest,
      geometryDigest,
    })).digest;
    return {
      basis,
      basisSnapshot,
      caseArtifact,
      caseCapture,
      dfmCase,
      geometryArtifact,
      geometryBytes,
      geometryDigest,
      planDigest,
    };
  }

  async #peekWriteAhead(
    projectId: string,
    runId: string,
    planDigest: string,
  ): Promise<{ readonly kind: "absent" } | { readonly kind: "capture" }> {
    let current;
    try {
      current = await this.#attempts.read(projectId, runId);
    } catch {
      throw new DfmCheckRunOutcomeUnknownError();
    }
    if (!current) return { kind: "absent" };
    if (current.planDigest !== planDigest || current.status === "dispatched") {
      throw new DfmCheckRunOutcomeUnknownError();
    }
    return { kind: "capture" };
  }

  async #requireOperationalCapability(
    project: EngineeringProjectSnapshot,
    run: EngineeringAgentRun,
  ): Promise<ResolvedCapabilityRuntimeOperation> {
    try {
      return await requireConfiguredOperationalCapability({
        runtime: this.#capabilityRuntime,
        session: this.#capabilityRuntimeSession,
        project,
        run,
        workItem: requireShape(project, run),
        unavailableMessage:
          "Measured DFM checks require the configured JIT capability runtime session before a run can be claimed.",
        missingBindingMessage:
          "Measured DFM checks require the sealed mcp-dfm-measured-checks operational capability before a run can be claimed.",
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      throw error;
    }
  }

  async #openBoundDfmClient(
    session: CapabilityRuntimeExecutionSession,
    operationalCapability: ResolvedCapabilityRuntimeOperation,
  ): Promise<McpToolClient> {
    try {
      return await openLeaseBoundCapabilityRuntimeMcpClient({
        connection: this.#capabilityRuntimeConnection,
        session,
        operationalCapability,
      });
    } catch (error) {
      if (error instanceof CapabilityRuntimeSessionUnavailableError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          error.message,
        );
      }
      throw error;
    }
  }

  async #dispatchMeasuredChecks(input: {
    readonly dfm: McpToolClient;
    readonly run: EngineeringAgentRun;
    readonly dispatchedAt: string;
    readonly documentary: DfmDocumentaryBasis;
    readonly stagedPath: string;
    readonly stagedByteCount: number;
  }): Promise<DfmCheckCapture> {
    const { dfmCase, geometryDigest, geometryArtifact, caseCapture } =
      input.documentary;
    const buildVolumeMm = {
      x: dfmCase.buildVolumeMm.x.value,
      y: dfmCase.buildVolumeMm.y.value,
      z: dfmCase.buildVolumeMm.z.value,
    };
    const envelope = parseDfmEnvelopeResult(
      (await input.dfm.callTool({
        name: DFM_ENVELOPE_TOOL,
        arguments: {
          step_path: input.stagedPath,
          expected_step_sha256: geometryDigest,
          build_volume_mm: buildVolumeMm,
          mesh_size_mm: dfmCase.meshSizeMm.value,
        },
      })).structuredContent,
      geometryDigest,
      buildVolumeMm,
    );
    const thickness = parseDfmThicknessResult(
      (await input.dfm.callTool({
        name: DFM_THICKNESS_TOOL,
        arguments: {
          step_path: input.stagedPath,
          expected_step_sha256: geometryDigest,
          min_thickness_mm: dfmCase.minThicknessMm.value,
          mesh_size_mm: dfmCase.meshSizeMm.value,
        },
      })).structuredContent,
      geometryDigest,
      dfmCase.minThicknessMm.value,
    );
    const overhang = parseDfmOverhangResult(
      (await input.dfm.callTool({
        name: DFM_OVERHANG_TOOL,
        arguments: {
          step_path: input.stagedPath,
          expected_step_sha256: geometryDigest,
          build_direction: [...dfmCase.buildDirection],
          max_overhang_deg: dfmCase.maxOverhangAngleDeg.value,
          mesh_size_mm: dfmCase.meshSizeMm.value,
        },
      })).structuredContent,
      geometryDigest,
      dfmCase.maxOverhangAngleDeg.value,
    );
    const recomputed = evaluateCapturedDfmChecks({
      zMinFilter: dfmCase.zMinFilter,
      buildVolumeMm,
      minThicknessMm: dfmCase.minThicknessMm.value,
      envelope,
      thickness,
      overhang,
    });
    return validateDfmCheckCapture({
      schemaVersion: DFM_CHECK_CAPTURE_SCHEMA,
      operation: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
      trustedRunId: input.run.id,
      dispatchedAt: input.dispatchedAt,
      capturedAt: input.dispatchedAt,
      caseDigest: caseCapture.caseDigest,
      geometry: {
        artifactId: geometryArtifact.id,
        sha256: geometryDigest,
        byteCount: input.stagedByteCount,
        mediaType: DFM_TARGET_MEDIA_TYPE,
        stagedPath: input.stagedPath,
      },
      providerCallParams: {
        expectedStepSha256: geometryDigest,
        buildVolumeMm,
        minThicknessMm: dfmCase.minThicknessMm.value,
        maxOverhangDeg: dfmCase.maxOverhangAngleDeg.value,
        meshSizeMm: dfmCase.meshSizeMm.value,
        buildDirection: [...dfmCase.buildDirection],
      },
      zMinFilter: persistZMinFilterTrace(recomputed.zMinTrace),
      envelope: {
        tool: DFM_ENVELOPE_TOOL,
        measured: envelope.measured,
        violations: envelope.violations,
        notChecked: envelope.notChecked,
        inputArtifactSha256: envelope.inputArtifactSha256,
      },
      thickness: {
        tool: DFM_THICKNESS_TOOL,
        measured: thickness.measured,
        violations: thickness.violations,
        notChecked: thickness.notChecked,
        inputArtifactSha256: thickness.inputArtifactSha256,
      },
      overhang: {
        tool: DFM_OVERHANG_TOOL,
        measured: overhang.measured,
        violations: overhang.violations,
        notChecked: overhang.notChecked,
        inputArtifactSha256: overhang.inputArtifactSha256,
      },
      evaluations: recomputed.evaluations,
      limitations: dfmCase.limitations,
    });
  }

  async #currentRun(
    projectId: string,
    runId: string,
  ): Promise<EngineeringAgentRun | undefined> {
    try {
      return requireRun(await this.#requiredProject(projectId), runId);
    } catch {
      return undefined;
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

function buildCheckSuccessor(input: {
  readonly basisSnapshot: ThreadSnapshot;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly run: EngineeringAgentRun;
  readonly caseArtifact: ThreadArtifact;
  readonly geometryArtifact: ThreadArtifact;
  readonly dfmCase: DfmCheckCase;
  readonly capture: DfmCheckCapture;
  readonly captureFingerprint: ContentFingerprint;
  readonly captureUri: string;
}): {
  readonly snapshot: ThreadSnapshot;
  readonly artifact: ThreadArtifact;
  readonly failed: boolean;
} {
  const capturedAt = requiredStart(input.run);
  const operationRef = {
    serverId: "digital-thread",
    tool:
      `${INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id}@${INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version}`,
    runId: input.run.id,
  };
  const artifact: ThreadArtifact = {
    id: `dfm-check-${input.captureFingerprint.digest}`,
    name: "Measured DFM checks",
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
  const freshness = {
    status: "fresh" as const,
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const envelopeCount =
    input.capture.evaluations.verdicts.find((item) => item.check === "envelope")
      ?.violations.length ?? 0;
  const remainingCount = input.capture.zMinFilter.remaining.length;
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
      `${prefix}-envelope-x`,
      "Measured X extent from dfm_check_envelope",
      "envelope_x_mm",
      input.capture.envelope.measured.xMm,
      "mm",
      operationRef,
      artifact.id,
      capturedAt,
    ),
    observation(
      `${prefix}-envelope-violation-count`,
      "Named envelope violations after the sealed build volume comparison",
      "dfm_envelope_violation_count",
      envelopeCount,
      "1",
      operationRef,
      artifact.id,
      capturedAt,
    ),
    observation(
      `${prefix}-overhang-remaining-count`,
      "Overhang zones remaining after the declared Z-min filter",
      "dfm_overhang_zone_count_after_zmin",
      remainingCount,
      "1",
      operationRef,
      artifact.id,
      capturedAt,
    ),
    observation(
      `${prefix}-zmin-filtered-count`,
      "Overhang zones filtered by the declared Z-min plane",
      "dfm_zmin_filtered_zone_count",
      input.capture.zMinFilter.filtered.length,
      "1",
      operationRef,
      artifact.id,
      capturedAt,
    ),
  ];
  const reqEnvelope = requirement(
    `${prefix}-req-envelope`,
    "Envelope must fit the declared build volume",
    "dfm_envelope_violation_count",
    "<=",
    0,
    "1",
    input.caseArtifact.id,
    `${input.dfmCase.id}:envelope`,
    input.geometryArtifact.id,
    capturedAt,
  );
  const reqThickness = requirement(
    `${prefix}-req-thickness`,
    "Minimum thickness must meet the sealed limit",
    "min_wall_thickness_mm",
    ">=",
    input.dfmCase.minThicknessMm.value,
    "mm",
    input.caseArtifact.id,
    `${input.dfmCase.id}:min-thickness`,
    input.geometryArtifact.id,
    capturedAt,
  );
  const reqOverhang = requirement(
    `${prefix}-req-overhangs`,
    "No overhang zones remain after the declared Z-min filter",
    "dfm_overhang_zone_count_after_zmin",
    "<=",
    0,
    "1",
    input.caseArtifact.id,
    `${input.dfmCase.id}:overhangs`,
    input.geometryArtifact.id,
    capturedAt,
  );
  const requirements = [reqEnvelope, reqThickness, reqOverhang];
  const evaluations: RequirementEvaluation[] = [
    evaluationFrom(
      `${prefix}-eval-envelope`,
      reqEnvelope,
      observations[2]!,
      envelopeCount,
      "1",
      "<=",
      0,
      artifact.id,
      operationRef,
      capturedAt,
      input.capture.evaluations.verdicts.find((item) => item.check === "envelope")!,
    ),
    evaluationFrom(
      `${prefix}-eval-thickness`,
      reqThickness,
      observations[0]!,
      input.capture.thickness.measured.minThicknessMm,
      "mm",
      ">=",
      input.dfmCase.minThicknessMm.value,
      artifact.id,
      operationRef,
      capturedAt,
      input.capture.evaluations.verdicts.find((item) =>
        item.check === "min-thickness"
      )!,
    ),
    evaluationFrom(
      `${prefix}-eval-overhangs`,
      reqOverhang,
      observations[3]!,
      remainingCount,
      "1",
      "<=",
      0,
      artifact.id,
      operationRef,
      capturedAt,
      input.capture.evaluations.verdicts.find((item) => item.check === "overhangs")!,
    ),
  ];
  const violations: ThreadViolation[] = evaluations.flatMap((ev) => {
    if (ev.status !== "fail") return [];
    const verdict = input.capture.evaluations.verdicts.find((item) =>
      ev.id.endsWith(item.check === "min-thickness" ? "thickness" : item.check)
    );
    const named = verdict?.violations[0];
    return [{
      id: `${ev.id}-violation`,
      name: named?.name ?? `${ev.name} failed`,
      requirementId: ev.requirementId,
      evaluationId: ev.id,
      severity: "error" as const,
      status: "open" as const,
      detectedAt: capturedAt,
      observationIds: ev.observationIds,
      evidenceArtifactIds: [artifact.id],
      summary: named?.summary ?? ev.message,
      freshness,
    }];
  });
  const proposedActions = violations.map((item) => ({
    id: `${item.id}-action`,
    name: `Review the measured DFM violation: ${item.name}`,
    kind: "review" as const,
    readiness: "ready" as const,
    rationale:
      "A measured DFM check failed against the sealed case; operator review is required.",
    targets: [{ kind: "artifact" as const, id: artifact.id }],
    addressesViolationIds: [item.id],
    dependsOnActionIds: [],
  }));
  const consumeCase = `consume-${input.caseArtifact.id}-by-${artifact.id}`;
  const consumeGeom = `consume-${input.geometryArtifact.id}-by-${artifact.id}`;
  const applied = applyThreadSnapshotExtensionIfNew(
    input.basisSnapshot,
    {
      id: `industrialize-run-dfm-checks-${input.run.id}`,
      name: "Run measured DFM checks",
      subjectId: input.basis.subjectId,
      capturedAt,
      artifacts: [artifact],
      consumptions: [{
        id: consumeCase,
        artifactId: input.caseArtifact.id,
        consumer: operationRef,
        observedFingerprint: input.caseArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      }, {
        id: consumeGeom,
        artifactId: input.geometryArtifact.id,
        consumer: operationRef,
        observedFingerprint: input.geometryArtifact.fingerprint,
        verifiedAt: capturedAt,
        status: "verified",
      }],
      observations,
      requirements,
      evaluations,
      violations,
      provenance: [
        {
          id: `derived-from-case-${artifact.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: artifact.id },
          to: { kind: "artifact", id: input.caseArtifact.id },
          rationale: "The measured DFM run reopens the sealed case.",
        },
        {
          id: `derived-from-geometry-${artifact.id}`,
          relation: "derived_from",
          from: { kind: "artifact", id: artifact.id },
          to: { kind: "artifact", id: input.geometryArtifact.id },
          rationale: "The measured DFM run stages the exact canonical STEP.",
        },
        {
          id: `uses-${consumeCase}`,
          relation: "uses",
          from: { kind: "consumption", id: consumeCase },
          to: { kind: "artifact", id: input.caseArtifact.id },
          rationale: "The executor re-read the sealed DFM case capture.",
        },
        {
          id: `uses-${consumeGeom}`,
          relation: "uses",
          from: { kind: "consumption", id: consumeGeom },
          to: { kind: "artifact", id: input.geometryArtifact.id },
          rationale: "The executor staged the exact canonical STEP bytes.",
        },
        ...observations.map((item) => ({
          id: `derived-from-${artifact.id}-by-${item.id}`,
          relation: "derived_from" as const,
          from: { kind: "observation" as const, id: item.id },
          to: { kind: "artifact" as const, id: artifact.id },
          rationale: "The observation is derived from the measured DFM capture.",
        })),
        ...requirements.map((item) => ({
          id: `traces-${item.id}`,
          relation: "traces_to" as const,
          from: { kind: "requirement" as const, id: item.id },
          to: { kind: "artifact" as const, id: input.geometryArtifact.id },
          rationale: "The sealed DFM case constrains the attested STEP.",
        })),
        ...evaluations.flatMap((item) => [
          {
            id: `evaluates-${item.id}`,
            relation: "evaluates" as const,
            from: { kind: "evaluation" as const, id: item.id },
            to: { kind: "requirement" as const, id: item.requirementId },
            rationale: "The measured check evaluates the sealed DFM requirement.",
          },
          {
            id: `uses-obs-${item.id}`,
            relation: "uses" as const,
            from: { kind: "evaluation" as const, id: item.id },
            to: { kind: "observation" as const, id: item.observationIds[0]! },
            rationale: "The evaluation uses the measured observation.",
          },
          {
            id: `evidences-${item.id}`,
            relation: "evidences" as const,
            from: { kind: "evaluation" as const, id: item.id },
            to: { kind: "artifact" as const, id: artifact.id },
            rationale: "The evaluation is evidenced by the measured DFM capture.",
          },
        ]),
        ...violations.flatMap((item) => [
          {
            id: `caused-by-${item.id}`,
            relation: "caused_by" as const,
            from: { kind: "violation" as const, id: item.id },
            to: { kind: "evaluation" as const, id: item.evaluationId },
            rationale: "The named violation is caused by a failed measured check.",
          },
          {
            id: `evidences-${item.id}`,
            relation: "evidences" as const,
            from: { kind: "violation" as const, id: item.id },
            to: { kind: "artifact" as const, id: artifact.id },
            rationale: "The named violation is evidenced by the measured DFM capture.",
          },
        ]),
        ...proposedActions.map((item) => ({
          id: `addresses-${item.id}`,
          relation: "addresses" as const,
          from: { kind: "action" as const, id: item.id },
          to: { kind: "violation" as const, id: item.addressesViolationIds[0]! },
          rationale: "The proposed review addresses the named DFM violation.",
        })),
      ],
      proposedActions,
    } satisfies ThreadSnapshotExtension,
    { appliedAt: capturedAt },
  );
  if (!applied.applied) {
    throw invalidTransition("This exact measured DFM check is already present.");
  }
  validateThreadSnapshot(applied.snapshot);
  return {
    snapshot: applied.snapshot,
    artifact,
    failed: input.capture.evaluations.status === "fail",
  };
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

function requirement(
  id: string,
  name: string,
  metric: string,
  operator: "<=" | ">=",
  limitValue: number,
  unit: string,
  sourceArtifactId: string,
  elementId: string,
  targetArtifactId: string,
  capturedAt: string,
): TracedRequirement {
  return {
    id,
    name,
    statement: name,
    version: "1",
    criterion: { metric, operator, limit: { value: limitValue, unit } },
    trace: {
      sourceArtifactId,
      elementId,
      targetArtifactIds: [targetArtifactId],
    },
    freshness: { status: "fresh", changedAt: capturedAt, invalidatedByChangeIds: [] },
  };
}

function evaluationFrom(
  id: string,
  req: TracedRequirement,
  obs: ThreadObservation,
  actualValue: number,
  unit: string,
  operator: "<=" | ">=",
  limitValue: number,
  evidenceId: string,
  evaluator: RequirementEvaluation["evaluator"],
  evaluatedAt: string,
  verdict: {
    readonly status: "pass" | "fail";
    readonly violations: readonly { readonly summary: string }[];
  },
): RequirementEvaluation {
  return {
    id,
    name: req.name,
    requirementId: req.id,
    observationIds: [obs.id],
    status: verdict.status,
    evaluatedAt,
    evaluator,
    comparison: {
      observationId: obs.id,
      actual: { value: actualValue, unit },
      operator,
      limit: { value: limitValue, unit },
      normalizedUnit: unit,
    },
    evidenceArtifactIds: [evidenceId],
    message: verdict.status === "fail"
      ? (verdict.violations[0]?.summary ?? `${req.name} failed.`)
      : `${req.name} passed.`,
    freshness: { status: "fresh", changedAt: evaluatedAt, invalidatedByChangeIds: [] },
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
  const attested = attestCanonicalWriteGeometryStep(snapshot, artifact);
  if (attested.status !== "attested") {
    throw invalidTransition(
      attested.code === "media-type"
        ? "Geometry binding must be a model/step write-geometry artifact."
        : attested.code === "not-canonical" || attested.code === "parent-not-canonical"
        ? "Geometry binding must be a design.write-geometry@1 canonical artifact."
        : attested.message,
    );
  }
  return attested.step;
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): EngineeringWorkItem {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  const caseBinding = operation?.bindings.find((item) => item.name === "dfmCase");
  const geometryBinding = operation?.bindings.find((item) => item.name === "geometry");
  if (
    !workItem ||
    project.schemaVersion !== "4.0" ||
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id ||
    operation.version !== INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version ||
    caseBinding?.source.kind !== "thread-entity" ||
    geometryBinding?.source.kind !== "thread-entity" ||
    operation.bindings.length !== 2
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to industrialize.run-dfm-checks@1.`,
    );
  }
  return workItem;
}

function exactDfmMaterial(
  operationalCapability: ResolvedCapabilityRuntimeOperation,
): CapabilityRuntimeMaterialIdentity {
  const publication = requiredQualifiedPersistentComposePublication(
    operationalCapability,
  );
  if (publication.binding.id !== "mcp-dfm-measured-checks") {
    throw invalidTransition(
      "Measured DFM checks require the sealed mcp-dfm-measured-checks binding.",
    );
  }
  const binding = operationalCapability.bindings[0];
  if (!binding || binding.materials.length !== 1) {
    throw invalidTransition(
      "Measured DFM checks require exactly one sealed mcp-dfm material.",
    );
  }
  const material = binding.materials[0]!;
  const expectedDigest = MCP_DFM_010_IMAGE_REFERENCE.slice(
    MCP_DFM_010_IMAGE_REFERENCE.lastIndexOf("@sha256:") + "@sha256:".length,
  );
  if (
    material.unitId !== "casys.mcp-dfm" ||
    material.materialId !== "mcp-dfm-image" ||
    material.imageDigest !== expectedDigest
  ) {
    throw invalidTransition(
      "Measured DFM checks require the exact casys.mcp-dfm@mcp-dfm-image material.",
    );
  }
  return material;
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
  const authority = recrossDfmRunAuthority(project, workItem, basis);
  if (authority.status !== "available") {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      authority.reason,
    );
  }
  return { decision: authority.decision, proposal: authority.proposal };
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
    throw new EngineeringProjectCommandError(
      "invalid_transition",
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
  if (run.status !== "completed") {
    throw unexpectedStatus(run, "completed");
  }
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
