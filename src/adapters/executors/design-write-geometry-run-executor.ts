/**
 * Trusted executor for the generic `design.write-geometry@1` operation.
 *
 * WHY NO PROVIDER CALL — `design.write-geometry@1` does NOT re-execute
 * build123d.  It seals the exact bytes from the human-signed draft (D1
 * decision).  All effects are idempotent CAS writes to the local filesystem,
 * so no WAL is required: a crash at any point leaves no uncertain provider
 * state, and a retry picks up safely via the CAS idempotence of each store.
 *
 * Sequence:
 *  1. Agent-only origin gate.
 *  2. requireShape: operation id/version check.
 *  3. requireMrtrApproval: find approved decision with decidedByOrigin === "human".
 *  4. parseGeometryDecisionParameters from decision.proposal.parameters.
 *  5. Lease + claim.
 *  6. Load basis snapshot (ThreadSnapshot).
 *  7. D5 — architecture check: basis must carry an architecture artifact whose
 *     fingerprint matches params.manifest.architectureBasis.artifactFingerprint.
 *  8. Cliquet: assertGeometryArtifactNotRemoved.
 *  9. Reload draft JSON by draftDigest; byte-level fingerprint recomputation.
 * 10. Architecture capture load + per-component binding verification (D5 part 2).
 * 11. Build geometry capture record + save to FileCaptureStore<"geometry-capture">.
 * 12. Reload that capture, then verify and promote each binary hash it names.
 * 13. Thread extension → applyThreadSnapshotExtensionIfNew → validateThreadSnapshot.
 * 14. Snapshot save + CAS readback.
 * 15. publishRun + completeRun + assertCompleted.
 */

import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandOrigin,
  type EngineeringProjectCommandService,
  type EngineeringProjectRevisionStore,
} from "../../domain/project/engineering-project-command-service.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import {
  type AnyGeometryManifest,
  DESIGN_WRITE_GEOMETRY_OPERATION,
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryDecisionParameters,
  geometryDecisionParametersToMap,
  type GeometryManifest,
  parseGeometryDecisionParameters,
} from "../../domain/platform/geometry-proposal.ts";
import {
  GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
  GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_DERIVATION_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
  GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE,
  GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE,
  GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE,
} from "../../domain/platform/geometry-bundle.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../domain/thread/thread-snapshot-extension.ts";
import { computeArchiveCascade } from "../../domain/thread/thread-retirement.ts";
import type { ThreadSnapshotStore } from "../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  type FileCaptureStore,
  GEOMETRY_CAPTURE_URI_PREFIX,
} from "../captures/file-capture-store.ts";
import {
  assertGeometryBundleDraftPaths,
  assertGeometryDraftAssemblyPaths,
  GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_DRAFT_ASSETS_DIR,
  GEOMETRY_DRAFT_CAPTURE_SCHEMA,
  type GeometryBundleCanonicalSources,
  type GeometryBundleDraftCapture,
  geometryBundleManifestFromDraft,
  LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA,
  requireGeometryBundleCanonicalSources,
  requireGeometryBundleDraftAssetMetadata,
} from "../captures/geometry-draft-capture.ts";
import { assertThreadSnapshotLineageIntact } from "../stores/thread-snapshot-lineage.ts";
import type { EngineeringProjectRunLease } from "../stores/file-engineering-project-run-lease.ts";
import {
  requireBasis,
  requiredStart,
  requireRun,
  snapshotRef,
  unexpectedStatus,
} from "./executor-run-helpers.ts";
import {
  assertThreadWriteBasisAvailable,
  threadWriteBasisLeaseScope,
} from "./thread-write-basis-guard.ts";
import {
  ARCHITECTURE_CAPTURE_SCHEMA,
  findArchitectureArtifact,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "./model-write-architecture-run-executor.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../stores/live-thread-update-store.ts";

// ── Public constants ──────────────────────────────────────────────────────────

/**
 * Re-exported from domain so callers (tests, server wiring) can import the
 * operation ref from one canonical location without depending on geometry-proposal.ts.
 */
export { DESIGN_WRITE_GEOMETRY_OPERATION };

/** Schema version written into every canonical geometry capture. */
/** v1.1 distinguishes the preview producer from the local sealing operation. */
export const GEOMETRY_CAPTURE_SCHEMA = "geometry-capture/1.1" as const;
export const GEOMETRY_BUNDLE_CAPTURE_SCHEMA = "geometry-capture/2.0" as const;
export const GEOMETRY_CANONICAL_ASSETS_DIR = "state/local/thread-assets" as const;

// ── Cliquet error ─────────────────────────────────────────────────────────────

/**
 * Raised when a successor snapshot omits a geometry artifact that appeared in
 * an ancestor.
 *
 * MONOTONY RATCHET — once a subject's thread carries a geometry artifact, every
 * later revision must also carry it.  Silently dropping it would make the
 * downstream geometry viewer and the enrichment preflight unreliable.
 */
export class GeometryArtifactRemovedError extends Error {
  constructor(subjectId: string) {
    super(
      `geometry_artifact_removed: The thread for "${subjectId}" previously carried ` +
        "a geometry artifact that is absent from the current basis. This is a " +
        "monotony-ratchet violation; the artifact must not be removed once published.",
    );
    this.name = "GeometryArtifactRemovedError";
  }
}

export class GeometryLineageReviewRequiredError extends Error {
  constructor(detail: string) {
    super(`geometry_lineage_review_required: ${detail}`);
    this.name = "GeometryLineageReviewRequiredError";
  }
}

// ── Asset verification error ──────────────────────────────────────────────────

export type GeometryAssetVerificationCode =
  | "asset_not_found"
  | "asset_empty"
  | "byte_count_mismatch"
  | "sha256_mismatch";

/**
 * Thrown when a draft binary asset cannot be verified against its signed hash.
 *
 * Callers MUST treat this as stop-for-review: the operator signed specific
 * bytes and the local draft store does not hold them.  Automatic retry is
 * NOT permitted until the operator diagnoses the cause.
 */
export class GeometryAssetVerificationError extends Error {
  constructor(
    readonly code: GeometryAssetVerificationCode,
    readonly context: Readonly<Record<string, string>>,
    message: string,
  ) {
    super(message);
    this.name = "GeometryAssetVerificationError";
  }
}

// ── I2: MRTR ↔ draft artifact hash cross-check ───────────────────────────────

/**
 * Verify that the artifact hashes the human signed in the MRTR match the
 * hashes stored in the draft record.
 *
 * WHY EXPORTED — this guard is pure (no I/O) and is called inside the execute
 * hot-path.  Exporting it lets the unit tests directly verify the D1/D2 attack
 * scenario (human signs hashes for D2 while the viewer shows D1) without
 * bootstrapping a full project fixture.
 */
type LegacyGeometryDraftManifestShape = {
  readonly subject: GeometryManifest["architectureBasis"];
  readonly scriptHash: ContentFingerprint;
  readonly exportFormats: GeometryManifest["exportFormats"];
  readonly components: GeometryManifest["components"];
  readonly assemblyFiles: NonNullable<
    GeometryManifest["artifactHashes"]
  >["assemblyFiles"];
  readonly partMeshes: ReadonlyArray<{
    readonly usageName: string;
    readonly name: string;
    readonly fingerprint: ContentFingerprint;
  }>;
};

export function assertMrtrManifestMatchesDraft(
  signed: AnyGeometryManifest,
  draft:
    | LegacyGeometryDraftManifestShape
    | Omit<GeometryBundleDraftCapture, "fingerprint">,
): void {
  if (signed.schemaVersion === "geometry-manifest/2.0") {
    const reconstructed = geometryBundleManifestFromDraft(
      draft as Omit<GeometryBundleDraftCapture, "fingerprint">,
    );
    if (deterministicJson(signed) !== deterministicJson(reconstructed)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "geometry_manifest_mismatch: the signed v2 MRTR manifest is not exactly the " +
          "manifest reconstructed from the reviewed geometry bundle draft.",
      );
    }
    return;
  }
  const legacyDraft = draft as LegacyGeometryDraftManifestShape;
  const reconstructed: GeometryManifest = {
    schemaVersion: "geometry-manifest/1.0",
    architectureBasis: legacyDraft.subject,
    components: legacyDraft.components,
    unitSystem: "mm",
    exportFormats: legacyDraft.exportFormats,
    scriptHash: legacyDraft.scriptHash,
    artifactHashes: {
      assemblyFiles: legacyDraft.assemblyFiles.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: file.fingerprint,
      })),
      partMeshes: legacyDraft.partMeshes.map((mesh) => ({
        semanticKey: mesh.usageName,
        name: mesh.name,
        fingerprint: mesh.fingerprint,
      })),
    },
  };
  if (deterministicJson(signed) !== deterministicJson(reconstructed)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_manifest_mismatch: the signed MRTR manifest is not exactly the " +
        "manifest reconstructed from the reviewed draft record.",
    );
  }
}

/**
 * Compatibility-level hash guard retained for focused callers; promotion uses
 * the stronger whole-manifest comparison above.
 */
export function assertMrtrArtifactHashesMatchDraft(
  mrtrAssemblyFiles: ReadonlyArray<{ fingerprint: { digest: string } }>,
  mrtrPartMeshes: ReadonlyArray<{ fingerprint: { digest: string } }>,
  draftAssemblyFiles: ReadonlyArray<{ fingerprint: { digest: string } }>,
  draftPartMeshes: ReadonlyArray<{ fingerprint: { digest: string } }>,
): void {
  const signed = deterministicJson({ mrtrAssemblyFiles, mrtrPartMeshes });
  const captured = deterministicJson({
    mrtrAssemblyFiles: draftAssemblyFiles,
    mrtrPartMeshes: draftPartMeshes,
  });
  if (signed !== captured) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_artifact_hash_mismatch: MRTR hashes differ from the draft.",
    );
  }
}

// ── Command type ──────────────────────────────────────────────────────────────

export interface DesignWriteGeometryRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

// ── Executor ──────────────────────────────────────────────────────────────────

export interface DesignWriteGeometryRunExecutorDependencies {
  readonly projects: EngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: ThreadSnapshotStore;
  /** Architecture captures — used for D5 per-component binding verification. */
  readonly architectureCaptures: FileCaptureStore<"architecture-capture">;
  /** Draft geometry JSON captures produced by the preview tool. */
  readonly geometryDraftCaptures: FileCaptureStore<"geometry-draft">;
  /** Canonical geometry captures sealed by this executor. */
  readonly geometryCaptures: GeometryCaptureStore;
  readonly lease: EngineeringProjectRunLease;
  readonly liveUpdates?: LiveThreadUpdateMilestoneJournal;
  readonly canonicalAssetDirectory?: string;
  readonly draftAssetDirectory?: string;
  readonly now?: () => string;
}

export interface GeometryCaptureStore {
  save(
    fingerprint: ContentFingerprint,
    text: string,
  ): Promise<{ readonly uri: string; readonly path: string }>;
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
  uriFor(fingerprint: ContentFingerprint): string;
}

/**
 * Trusted generic geometry-sealing executor.
 *
 * No provider call is made.  The executor verifies the draft bytes against the
 * human-signed MRTR parameters and promotes them to the canonical thread.
 */
export class DesignWriteGeometryRunExecutor {
  readonly #projects: EngineeringProjectRevisionStore;
  readonly #commands: EngineeringProjectCommandService;
  readonly #snapshots: ThreadSnapshotStore;
  readonly #architectureCaptures: FileCaptureStore<"architecture-capture">;
  readonly #geometryDraftCaptures: FileCaptureStore<"geometry-draft">;
  readonly #geometryCaptures: GeometryCaptureStore;
  readonly #lease: EngineeringProjectRunLease;
  readonly #liveUpdates: LiveThreadUpdateMilestoneJournal | undefined;
  readonly #canonicalAssetDirectory: string;
  readonly #draftAssetDirectory: string;
  readonly #now: () => string;

  constructor(dependencies: DesignWriteGeometryRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#commands = dependencies.commands;
    this.#snapshots = dependencies.snapshots;
    this.#architectureCaptures = dependencies.architectureCaptures;
    this.#geometryDraftCaptures = dependencies.geometryDraftCaptures;
    this.#geometryCaptures = dependencies.geometryCaptures;
    this.#lease = dependencies.lease;
    this.#liveUpdates = dependencies.liveUpdates;
    this.#canonicalAssetDirectory = dependencies.canonicalAssetDirectory ??
      GEOMETRY_CANONICAL_ASSETS_DIR;
    this.#draftAssetDirectory = dependencies.draftAssetDirectory ??
      GEOMETRY_DRAFT_ASSETS_DIR;
    this.#now = dependencies.now ?? (() => new Date().toISOString());
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: DesignWriteGeometryRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    if (origin.kind !== "agent") {
      throw new EngineeringProjectCommandError(
        "permission_denied",
        "Only an authenticated agent can execute a design-write-geometry run.",
      );
    }
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    requireShape(project, run);

    // MRTR gate — parse proposal before leasing so invalid parameters fail fast.
    const { proposal } = await requireMrtrApproval(project, run);
    let params: GeometryDecisionParameters;
    try {
      params = parseGeometryDecisionParameters(
        geometryDecisionParametersToMap(proposal.parameters),
      );
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_input",
        `Geometry decision parameters are invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // A runId-scoped lease does not serialize two independently approved runs
    // that extend the same immutable ThreadSnapshot. Both could materialize a
    // different `base + 1` successor and only discover the collision while
    // attaching it to the project. The exact Thread-basis scope is shared with
    // generic architecture and requirements writers: only one `base + 1`
    // successor can own the next subject revision.
    return await this.#lease.withLease(
      command.projectId,
      threadWriteBasisLeaseScope(run),
      () => this.#executeLeased(origin, command, params),
    );
  }

  async #executeLeased(
    origin: EngineeringProjectCommandOrigin,
    command: DesignWriteGeometryRunExecutorCommand,
    params: GeometryDecisionParameters,
  ): Promise<EngineeringProjectSnapshot> {
    let snapshotPersisted = false;
    let materializedSnapshot: ThreadSnapshot | undefined;

    try {
      // Post-lease shape re-check.
      const preClaim = await this.#requiredProject(command.projectId);
      requireShape(preClaim, requireRun(preClaim, command.runId));

      const alreadyCompleted = await this.#completedFor(command, params);
      if (alreadyCompleted) {
        await this.#reconcileLive(alreadyCompleted.project.subjectId, command.runId);
        return alreadyCompleted;
      }

      // The shared basis lease makes this sibling scan authoritative. Refuse
      // before claim, draft/capture reads, binary promotion, or snapshot writes
      // if another run has already started, failed after possible durable
      // effects, or published from this same immutable basis.
      assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );

      // Reject malformed or stale persisted drafts before the run claim is
      // recorded. In particular, legacy `format: gltf` records must prove the
      // provider's binary `.glb` path contract before any project, capture,
      // asset, or snapshot write occurs.
      await loadReviewedGeometryDraft(
        params,
        this.#geometryDraftCaptures,
        this.#draftAssetDirectory,
      );

      // The reviewed architecture is part of the MRTR input, so validate its
      // exact active tip, capture bytes, seed/predecessor lineage, and component
      // bindings before claiming the run. A stale or tampered architecture must
      // leave the durable project lifecycle unchanged and retryable only after
      // a newly reviewed decision.
      const preClaimRun = requireRun(preClaim, command.runId);
      const preClaimBasis = requireBasis(preClaimRun);
      assertGeometryArchitectureBasisMatchesRun(
        params.manifest.architectureBasis,
        preClaimBasis,
      );
      const preClaimBase = await exactGeometryBasisSnapshot(
        this.#snapshots,
        preClaimBasis,
      );
      const preClaimArchitecture = requireArchitectureArtifact(
        preClaimBase,
        params.manifest.architectureBasis.artifactFingerprint,
      );
      await assertThreadSnapshotLineageIntact(preClaimBase, this.#snapshots);
      await assertGeometryArtifactNotRemoved(preClaimBase, this.#snapshots);
      await assertComponentBindingsMatchArchitecture(
        params,
        preClaimBase,
        preClaimArchitecture,
        this.#architectureCaptures,
      );
      await requireGeometryBundlePredecessor(
        preClaimBase,
        params,
        this.#geometryCaptures,
      );

      await this.#commands.claimRun(origin, {
        ...command,
        commandId: commandStep(command.commandId, "claim"),
        summary: "Started the design-write-geometry run.",
      });

      let project = await this.#requiredProject(command.projectId);
      let run = requireRun(project, command.runId);
      requireClaimedShape(project, run, origin);

      if (run.status === "completed") {
        assertCompleted(project, command);
        await this.#assertCompletedEvidenceExact(project, command, params);
        await this.#reconcileLive(project.project.subjectId, run.id);
        return project;
      }
      if (run.status !== "running" && run.status !== "publishing") {
        throw unexpectedStatus(run, "running");
      }

      const capturedAt = requiredStart(run);
      const basis = requireBasis(run);

      // Step 6: load basis snapshot.
      const base = await exactGeometryBasisSnapshot(this.#snapshots, basis);

      assertGeometryArchitectureBasisMatchesRun(
        params.manifest.architectureBasis,
        basis,
      );

      // Step 7 (D5 part 1): architecture artifact must exist with matching fingerprint.
      const architectureArtifact = requireArchitectureArtifact(
        base,
        params.manifest.architectureBasis.artifactFingerprint,
      );

      // Step 8: cliquet.
      await assertThreadSnapshotLineageIntact(base, this.#snapshots);
      await assertGeometryArtifactNotRemoved(base, this.#snapshots);

      // Step 9: reload after the claim so disappearance or corruption across
      // the claim boundary still fails closed. FileCaptureStore is
      // content-addressed, so a successful second read is the same reviewed
      // object that passed the pre-claim validation above.
      const {
        bundleAssetBytes,
        bundleSources,
        previewProducer,
      } = await loadReviewedGeometryDraft(
        params,
        this.#geometryDraftCaptures,
        this.#draftAssetDirectory,
      );

      // Step 10 (D5 part 2): architecture capture load + per-component binding check.
      await assertComponentBindingsMatchArchitecture(
        params,
        base,
        architectureArtifact,
        this.#architectureCaptures,
      );
      const predecessor = await requireGeometryBundlePredecessor(
        base,
        params,
        this.#geometryCaptures,
      );

      // Step 11: build and durably record the canonical geometry capture before
      // any binary is published. The capture is derived only from the signed
      // decision, the verified draft record, and the verified architecture.
      const { assemblyFiles = [], partMeshes = [] } = params.manifest.artifactHashes ??
        {};
      const captureRecord = {
        schemaVersion: params.manifest.schemaVersion === "geometry-manifest/2.0"
          ? GEOMETRY_BUNDLE_CAPTURE_SCHEMA
          : GEOMETRY_CAPTURE_SCHEMA,
        operation: DESIGN_WRITE_GEOMETRY_OPERATION,
        trustedRunId: run.id,
        draftDigest: params.draftDigest,
        manifest: params.manifest,
        architectureBasis: {
          artifactId: architectureArtifact.id,
          fingerprint: architectureArtifact.fingerprint,
          producerRunId: architectureArtifact.producer.runId,
        },
        previewProducer: previewProducer ?? null,
        ...(bundleSources ? { sourceScripts: bundleSources } : {}),
        sealedAt: capturedAt,
      };
      const captureFp = await sha256Fingerprint(captureRecord);
      const captureText = deterministicJson(captureRecord);

      await this.#geometryCaptures.save(captureFp, captureText);
      const persistedCapture = await this.#geometryCaptures.read(captureFp);
      if (persistedCapture !== captureText) {
        throw new Error(
          "Geometry capture was not durably readable after save.",
        );
      }

      // Step 12: every binary promotion consumes the persisted capture. The
      // helper re-verifies that exact object's fingerprint and checks that it
      // names the binary digest before verifying and copying the bytes.
      for (const file of assemblyFiles) {
        await promoteAssetNamedByCapture({
          captureFp,
          assetFingerprint: file.fingerprint,
          name: `assembly file ${file.name}`,
          identity: { scope: "assembly", format: file.format, name: file.name },
          extension: geometryAssetExtension(file.format),
          geometryCaptures: this.#geometryCaptures,
          draftDirectory: this.#draftAssetDirectory,
          canonicalDirectory: this.#canonicalAssetDirectory,
          expectedBytes: bundleAssetBytes?.get(file.fingerprint.digest),
        });
      }
      for (const mesh of partMeshes) {
        await promoteAssetNamedByCapture({
          captureFp,
          assetFingerprint: mesh.fingerprint,
          name: `part mesh ${mesh.name}`,
          identity: {
            scope: "legacy-part-mesh",
            semanticKey: mesh.semanticKey,
            name: mesh.name,
          },
          extension: "stl",
          geometryCaptures: this.#geometryCaptures,
          draftDirectory: this.#draftAssetDirectory,
          canonicalDirectory: this.#canonicalAssetDirectory,
        });
      }
      if (params.manifest.schemaVersion === "geometry-manifest/2.0") {
        for (const definition of params.manifest.partDefinitions) {
          for (const file of definition.files ?? []) {
            await promoteAssetNamedByCapture({
              captureFp,
              assetFingerprint: file.fingerprint,
              name: `PartDefinition ${definition.elementId} ${file.format}`,
              identity: {
                scope: "part-definition",
                elementId: definition.elementId,
                format: file.format,
                name: file.name,
              },
              extension: geometryAssetExtension(file.format),
              geometryCaptures: this.#geometryCaptures,
              draftDirectory: this.#draftAssetDirectory,
              canonicalDirectory: this.#canonicalAssetDirectory,
              expectedBytes: bundleAssetBytes?.get(file.fingerprint.digest),
            });
          }
        }
      }

      // Step 13: build thread extension + validate.
      const captureUri = this.#geometryCaptures.uriFor(captureFp);
      const extension = buildExtension({
        base,
        architectureArtifact,
        runId: run.id,
        capturedAt,
        captureFp,
        captureUri,
        params,
        previewProducer,
        predecessor,
      });

      const applied = applyThreadSnapshotExtensionIfNew(base, extension, {
        appliedAt: capturedAt,
      });
      if (!applied.applied) {
        throw new Error(
          "Geometry snapshot extension was already present — " +
            "this exact evidence was published in a prior revision.",
        );
      }
      const snapshot = applied.snapshot;
      validateThreadSnapshot(snapshot);
      materializedSnapshot = snapshot;

      // Step 14: save snapshot + CAS readback.
      await this.#snapshots.save(snapshot);
      const savedSnapshot = await this.#snapshots.get(snapshot.id);
      if (
        !savedSnapshot ||
        deterministicJson(savedSnapshot) !== deterministicJson(snapshot)
      ) {
        throw new Error(
          "Geometry snapshot was not durably readable after save.",
        );
      }
      snapshotPersisted = true;

      // Step 15: publish + complete.
      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "running") {
        await this.#commands.publishRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "publish"),
          expectedRevision: project.revision,
          summary: "Publishing the sealed geometry evidence.",
        });
      } else if (run.status !== "publishing" && run.status !== "completed") {
        throw unexpectedStatus(run, "publishing");
      }

      project = await this.#requiredProject(command.projectId);
      run = requireRun(project, command.runId);
      if (run.status === "publishing") {
        await this.#commands.completeRun(origin, {
          ...command,
          commandId: commandStep(command.commandId, "complete"),
          expectedRevision: project.revision,
          summary: "Sealed geometry draft into canonical evidence thread.",
          resultSnapshot: snapshotRef(snapshot),
          evidenceRefs: [geometryArtifactEntityRef(snapshot, run.id)],
        });
      } else if (run.status !== "completed") {
        throw unexpectedStatus(run, "completed");
      }

      const complete = await this.#requiredProject(command.projectId);
      assertCompleted(complete, command);
      await this.#assertCompletedEvidenceExact(complete, command, params);
      await this.#reconcileLive(complete.project.subjectId, command.runId);
      return complete;
    } catch (error) {
      // If the snapshot was persisted but project attachment didn't complete,
      // a retry with the same commandId will find and return the completed run
      // via #completedFor without re-promoting the draft.
      if (snapshotPersisted && materializedSnapshot) {
        const complete = await this.#completedFor(command, params);
        if (complete) return complete;
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Geometry evidence is durable but project attachment did not finish. " +
            "Retry this exact command; it will not re-seal the draft.",
        );
      }
      throw error;
    }
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #requiredProject(projectId: string): Promise<EngineeringProjectSnapshot> {
    const snapshot = await this.#projects.get(projectId);
    if (!snapshot) {
      throw new EngineeringProjectCommandError(
        "entity_not_found",
        `Project ${projectId} not found.`,
      );
    }
    return snapshot;
  }

  async #completedFor(
    command: DesignWriteGeometryRunExecutorCommand,
    params: GeometryDecisionParameters,
  ): Promise<EngineeringProjectSnapshot | undefined> {
    const project = await this.#requiredProject(command.projectId);
    const run = requireRun(project, command.runId);
    if (run.status !== "completed") return undefined;
    assertCompleted(project, command);
    await this.#assertCompletedEvidenceExact(project, command, params);
    return project;
  }

  /**
   * A completed lifecycle flag is not evidence. Re-open the exact result seal
   * and prove its snapshot, capture, architecture input, Thread entities, and
   * canonical binary bytes before treating a replay as idempotent success.
   * This path is deliberately read-only: it never saves a capture, promotes an
   * asset, or calls an external provider.
   */
  async #assertCompletedEvidenceExact(
    project: EngineeringProjectSnapshot,
    command: DesignWriteGeometryRunExecutorCommand,
    params: GeometryDecisionParameters,
  ): Promise<void> {
    const run = requireRun(project, command.runId);
    const result = run.resultSnapshot;
    if (!result) {
      throw completedGeometryIntegrityError(
        "the run has no result snapshot",
      );
    }
    const snapshot = await this.#snapshots.get(result.snapshotId);
    if (
      !snapshot || snapshot.id !== result.snapshotId ||
      snapshot.revision !== result.revision ||
      snapshot.subject.id !== result.subjectId ||
      !project.threadSnapshots.some((reference) =>
        reference.snapshotId === result.snapshotId &&
        reference.revision === result.revision &&
        reference.subjectId === result.subjectId
      )
    ) {
      throw completedGeometryIntegrityError(
        "the exact result snapshot is not durably attached to the project",
      );
    }
    try {
      validateThreadSnapshot(snapshot);
      await assertThreadSnapshotLineageIntact(snapshot, this.#snapshots);
    } catch (error) {
      throw completedGeometryIntegrityError(
        `the result snapshot or its lineage is invalid: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const basis = requireBasis(run);
    if (
      snapshot.previous?.snapshotId !== basis.snapshotId ||
      snapshot.previous.revision !== basis.revision ||
      snapshot.subject.id !== basis.subjectId
    ) {
      throw completedGeometryIntegrityError(
        "the result snapshot does not directly extend the run's exact basis",
      );
    }
    const baseSnapshot = await this.#snapshots.get(basis.snapshotId);
    if (
      !baseSnapshot || baseSnapshot.id !== basis.snapshotId ||
      baseSnapshot.revision !== basis.revision ||
      baseSnapshot.subject.id !== basis.subjectId
    ) {
      throw completedGeometryIntegrityError(
        "the exact basis snapshot is not durably readable",
      );
    }
    if (run.evidenceRefs.length !== 1) {
      throw completedGeometryIntegrityError(
        "the run does not have exactly one primary geometry evidence reference",
      );
    }
    const evidence = run.evidenceRefs[0]!;
    if (
      evidence.kind !== "artifact" || evidence.snapshotId !== snapshot.id ||
      evidence.snapshotRevision !== snapshot.revision
    ) {
      throw completedGeometryIntegrityError(
        "the evidence reference is not exactly bound to the result snapshot",
      );
    }
    const primary = snapshot.artifacts.find((artifact) => artifact.id === evidence.id);
    if (!primary) {
      throw completedGeometryIntegrityError(
        "the primary geometry evidence artifact is absent",
      );
    }
    const digest = primary.fingerprint.digest;
    const expectedCaptureUri = `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${digest}`;
    if (
      primary.kind !== "cad-model" || primary.id !== `geometry-${digest}` ||
      primary.version !== digest || primary.fingerprint.algorithm !== "sha256" ||
      primary.uri !== expectedCaptureUri ||
      primary.uri !== this.#geometryCaptures.uriFor(primary.fingerprint) ||
      primary.mediaType !== "application/json" ||
      primary.producer.serverId !== "digital-thread" ||
      primary.producer.tool !==
        `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}` ||
      primary.producer.runId !== run.id ||
      primary.inputArtifactIds.length !==
        (params.manifest.schemaVersion === "geometry-manifest/2.0" &&
            params.manifest.predecessor
          ? 2
          : 1)
    ) {
      throw completedGeometryIntegrityError(
        "the primary geometry artifact identity, URI, media type, producer, or inputs are not exact",
      );
    }

    let architectureArtifact: ThreadArtifact;
    try {
      architectureArtifact = requireArchitectureArtifact(
        baseSnapshot,
        params.manifest.architectureBasis.artifactFingerprint,
      );
      if (primary.inputArtifactIds[0] !== architectureArtifact.id) {
        throw new Error("primary artifact does not name the reviewed architecture");
      }
      await assertComponentBindingsMatchArchitecture(
        params,
        baseSnapshot,
        architectureArtifact,
        this.#architectureCaptures,
      );
    } catch (error) {
      throw completedGeometryIntegrityError(
        `the architecture input is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    let captureText: string | undefined;
    try {
      captureText = await this.#geometryCaptures.read(primary.fingerprint);
    } catch (error) {
      throw completedGeometryIntegrityError(
        `the primary capture failed content-addressed readback: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    if (!captureText) {
      throw completedGeometryIntegrityError(
        "the primary geometry capture is not durably readable",
      );
    }
    let capture: unknown;
    try {
      capture = JSON.parse(captureText);
    } catch {
      throw completedGeometryIntegrityError(
        "the primary geometry capture is invalid JSON",
      );
    }
    if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
      throw completedGeometryIntegrityError(
        "the primary geometry capture is not an object",
      );
    }

    const { bundleSources, previewProducer } = await loadReviewedGeometryDraft(
      params,
      this.#geometryDraftCaptures,
    );
    const capturedAt = requiredStart(run);
    const expectedCapture = {
      schemaVersion: params.manifest.schemaVersion === "geometry-manifest/2.0"
        ? GEOMETRY_BUNDLE_CAPTURE_SCHEMA
        : GEOMETRY_CAPTURE_SCHEMA,
      operation: DESIGN_WRITE_GEOMETRY_OPERATION,
      trustedRunId: run.id,
      draftDigest: params.draftDigest,
      manifest: params.manifest,
      architectureBasis: {
        artifactId: architectureArtifact.id,
        fingerprint: architectureArtifact.fingerprint,
        producerRunId: architectureArtifact.producer.runId,
      },
      previewProducer: previewProducer ?? null,
      ...(bundleSources ? { sourceScripts: bundleSources } : {}),
      sealedAt: capturedAt,
    };
    const observedCaptureFingerprint = await sha256Fingerprint(capture);
    if (
      !fingerprintsEqual(observedCaptureFingerprint, primary.fingerprint) ||
      deterministicJson(capture) !== deterministicJson(expectedCapture)
    ) {
      throw completedGeometryIntegrityError(
        "the primary capture no longer exactly seals its schema, operation, trusted run, draft, or architecture input",
      );
    }

    let predecessor: GeometryBundlePredecessorContext | undefined;
    try {
      predecessor = await requireGeometryBundlePredecessor(
        baseSnapshot,
        params,
        this.#geometryCaptures,
      );
      if (
        predecessor && primary.inputArtifactIds[1] !== predecessor.artifact.id
      ) {
        throw new Error("primary artifact does not name the reviewed predecessor");
      }
    } catch (error) {
      throw completedGeometryIntegrityError(
        `the geometry predecessor is not exact: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    const expectedExtension = buildExtension({
      base: baseSnapshot,
      architectureArtifact,
      runId: run.id,
      capturedAt,
      captureFp: primary.fingerprint,
      captureUri: expectedCaptureUri,
      params,
      previewProducer,
      predecessor,
    });
    const expectedArtifactIds = new Set(
      expectedExtension.artifacts.map((artifact) => artifact.id),
    );
    const contextArtifacts = snapshot.artifacts.filter((artifact) =>
      artifact.id === primary.id ||
      artifact.id.startsWith(`cad-asset-${digest}-`) ||
      artifact.id.startsWith(`mesh-${digest}-`)
    );
    if (
      contextArtifacts.length !== expectedExtension.artifacts.length ||
      contextArtifacts.some((artifact) => !expectedArtifactIds.has(artifact.id)) ||
      expectedExtension.artifacts.some((expected) => {
        const actual = snapshot.artifacts.find((artifact) =>
          artifact.id === expected.id
        );
        return !actual || deterministicJson(actual) !== deterministicJson(expected);
      }) ||
      expectedExtension.consumptions.some((expected) => {
        const actual = snapshot.consumptions.find((item) => item.id === expected.id);
        return !actual || deterministicJson(actual) !== deterministicJson(expected);
      }) ||
      expectedExtension.provenance.some((expected) => {
        const actual = snapshot.provenance.find((item) => item.id === expected.id);
        return !actual || deterministicJson(actual) !== deterministicJson(expected);
      })
    ) {
      throw completedGeometryIntegrityError(
        "the result snapshot no longer contains the exact primary, binary, consumption, and trace projection of the seal",
      );
    }
    const reapplied = applyThreadSnapshotExtensionIfNew(
      baseSnapshot,
      expectedExtension,
      { appliedAt: capturedAt },
    );
    if (
      !reapplied.applied ||
      deterministicJson(reapplied.snapshot) !== deterministicJson(snapshot)
    ) {
      throw completedGeometryIntegrityError(
        "the result is not the exact sealed extension of its immutable basis",
      );
    }

    for (const file of params.manifest.artifactHashes?.assemblyFiles ?? []) {
      await assertCanonicalGeometryAssetExact(
        file.fingerprint,
        geometryAssetExtension(file.format),
        this.#canonicalAssetDirectory,
      );
    }
    for (const mesh of params.manifest.artifactHashes?.partMeshes ?? []) {
      await assertCanonicalGeometryAssetExact(
        mesh.fingerprint,
        "stl",
        this.#canonicalAssetDirectory,
      );
    }
    if (params.manifest.schemaVersion === "geometry-manifest/2.0") {
      for (const definition of params.manifest.partDefinitions) {
        for (const file of definition.files ?? []) {
          await assertCanonicalGeometryAssetExact(
            file.fingerprint,
            geometryAssetExtension(file.format),
            this.#canonicalAssetDirectory,
          );
        }
      }
    }
  }

  async #reconcileLive(subjectId: string, runId: string): Promise<void> {
    try {
      await this.#liveUpdates?.reconcileRunOnce(subjectId, runId, this.#now());
    } catch { /* Optional presentation journal — ignore failures. */ }
  }
}

// ── Exported: cliquet check + architecture requirement (testable) ─────────────

export {
  assertGeometryArchitectureBasisMatchesRun,
  assertGeometryArtifactNotRemoved,
  requireArchitectureArtifact,
  requireDraftAssemblyPaths,
  requireDraftPreviewProducer,
  requireGeometryBundlePredecessor,
};

// ── D5: architecture artifact requirement ─────────────────────────────────────

/**
 * The reviewed manifest names an exact ThreadSnapshot, not merely an artifact
 * that may still be retained in a later append-only revision.  Enforce that
 * identity before any capture or asset write occurs.
 */
function assertGeometryArchitectureBasisMatchesRun(
  architectureBasis: GeometryManifest["architectureBasis"],
  runBasis: EngineeringThreadSnapshotBasis,
): void {
  if (
    architectureBasis.snapshotId !== runBasis.snapshotId ||
    architectureBasis.revision !== runBasis.revision
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Geometry architecture basis ${architectureBasis.snapshotId}@${architectureBasis.revision} ` +
        `does not match run basis ${runBasis.snapshotId}@${runBasis.revision}. ` +
        "Re-run the preview against the exact queued ThreadSnapshot.",
    );
  }
}

async function exactGeometryBasisSnapshot(
  snapshots: ThreadSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ThreadSnapshot> {
  const snapshot = await snapshots.get(basis.snapshotId);
  if (
    !snapshot || snapshot.id !== basis.snapshotId ||
    snapshot.revision !== basis.revision ||
    snapshot.subject.id !== basis.subjectId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Basis snapshot ${basis.snapshotId} revision ${basis.revision} for subject ` +
        `${basis.subjectId} is not exactly available.`,
    );
  }
  try {
    validateThreadSnapshot(snapshot);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Basis snapshot ${basis.snapshotId} is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return snapshot;
}

/**
 * Find the architecture artifact in the basis snapshot whose fingerprint
 * matches the architecture basis declared in the geometry manifest.
 *
 * WHY NOT JUST ANY ARCHITECTURE ARTIFACT — the geometry manifest commits to a
 * specific architecture revision (fingerprint).  A newer architecture captured
 * in the same snapshot but with different bindings must not silently satisfy
 * the check.
 */
function requireArchitectureArtifact(
  base: ThreadSnapshot,
  expectedFingerprint: ContentFingerprint,
): ThreadArtifact {
  const tip = findArchitectureArtifact(base);
  if (!tip || !fingerprintsEqual(tip.fingerprint, expectedFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `D5 violation: the geometry manifest architecture fingerprint ` +
        `${expectedFingerprint.digest} is not the unique active generic architecture tip. ` +
        "The geometry manifest must reference the current basis architecture tip.",
    );
  }
  return tip;
}

// ── D5: per-component binding verification ────────────────────────────────────

/**
 * Load the architecture capture and verify that every component in the
 * geometry manifest maps to a real PartUsage by (id, label).
 *
 * WHY LOAD THE CAPTURE — the PartUsage element IDs and labels were extracted
 * during the architecture run and stored in the capture JSON.  Re-extracting
 * from SysON at write time would require a live provider call (violating D1's
 * server-fixed sealing principle).  The capture is the authority.
 */
async function assertComponentBindingsMatchArchitecture(
  params: GeometryDecisionParameters,
  base: ThreadSnapshot,
  architectureArtifact: ThreadArtifact,
  architectureCaptures: FileCaptureStore<"architecture-capture">,
): Promise<void> {
  const digest = architectureArtifact.fingerprint.digest;
  if (
    architectureArtifact.id !== `architecture-${digest}` ||
    architectureArtifact.version !== digest ||
    architectureArtifact.uri !==
      `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    architectureArtifact.mediaType !== "application/json" ||
    architectureArtifact.producer.serverId !== "syson" ||
    architectureArtifact.producer.tool !== "syson_element_insert_sysml" ||
    architectureArtifact.producer.runId.trim() === ""
  ) {
    invalidArchitectureCapture(
      "the architecture artifact identity, URI, media type, or producer is not exact",
    );
  }

  let captureText: string | undefined;
  try {
    captureText = await architectureCaptures.read(architectureArtifact.fingerprint);
  } catch (error) {
    invalidArchitectureCapture(
      `the content-addressed capture failed verification: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!captureText) {
    invalidArchitectureCapture(
      `capture ${architectureArtifact.fingerprint.digest} is not durably readable`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(captureText);
  } catch {
    invalidArchitectureCapture("capture is not valid JSON");
  }
  const captureRecord = architectureCaptureObject(parsed, "capture");
  const recomputed = await sha256Fingerprint(captureRecord);
  if (!fingerprintsEqual(recomputed, architectureArtifact.fingerprint)) {
    invalidArchitectureCapture(
      "capture fingerprint does not match the architecture artifact",
    );
  }
  architectureCaptureOnlyKeys(captureRecord, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "packageName",
    "systemName",
    "package",
    "seed",
    "predecessor",
    "partDefinitions",
    "insertedAt",
  ], "capture");
  if (captureRecord.schemaVersion !== ARCHITECTURE_CAPTURE_SCHEMA) {
    invalidArchitectureCapture(
      `unsupported schema ${String(captureRecord.schemaVersion)}`,
    );
  }
  const operation = architectureCaptureObject(
    captureRecord.operation,
    "operation",
  );
  architectureCaptureOnlyKeys(operation, ["id", "version"], "operation");
  if (
    operation.id !== MODEL_WRITE_ARCHITECTURE_OPERATION.id ||
    operation.version !== MODEL_WRITE_ARCHITECTURE_OPERATION.version
  ) {
    invalidArchitectureCapture(
      "operation is not model.write-architecture@1",
    );
  }
  const trustedRunId = architectureCaptureNonEmptyString(
    captureRecord.trustedRunId,
    "trustedRunId",
  );
  if (trustedRunId !== architectureArtifact.producer.runId) {
    invalidArchitectureCapture(
      "trustedRunId does not match the architecture artifact producer",
    );
  }
  const packageName = architectureCaptureNonEmptyString(
    captureRecord.packageName,
    "packageName",
  );
  const systemName = architectureCaptureNonEmptyString(
    captureRecord.systemName,
    "systemName",
  );
  const insertedAt = architectureCaptureNonEmptyString(
    captureRecord.insertedAt,
    "insertedAt",
  );
  if (
    !Number.isFinite(Date.parse(insertedAt)) ||
    new Date(insertedAt).toISOString() !== insertedAt
  ) {
    invalidArchitectureCapture("insertedAt is not a canonical instant");
  }
  const packageRecord = architectureCaptureObject(
    captureRecord.package,
    "package",
  );
  architectureCaptureOnlyKeys(packageRecord, ["id", "label"], "package");
  const packageId = architectureCaptureNonEmptyString(
    packageRecord.id,
    "package.id",
  );
  if (
    architectureCaptureNonEmptyString(packageRecord.label, "package.label") !==
      packageName
  ) {
    invalidArchitectureCapture("package label does not match packageName");
  }
  const seed = assertArchitectureCaptureSource(captureRecord.seed, "seed");
  const predecessor = captureRecord.predecessor === undefined
    ? undefined
    : assertArchitectureCaptureSource(captureRecord.predecessor, "predecessor");
  assertArchitectureCaptureLineageExact(
    base,
    architectureArtifact,
    seed,
    predecessor,
    insertedAt,
  );
  if (
    !Array.isArray(captureRecord.partDefinitions) ||
    captureRecord.partDefinitions.length === 0
  ) {
    invalidArchitectureCapture("partDefinitions must be a non-empty array");
  }

  const definitions = captureRecord.partDefinitions.map((raw, definitionIndex) => {
    const definition = architectureCaptureObject(
      raw,
      `partDefinitions[${definitionIndex}]`,
    );
    architectureCaptureOnlyKeys(
      definition,
      ["id", "kind", "label", "usages"],
      `partDefinitions[${definitionIndex}]`,
    );
    if (definition.kind !== "PartDefinition" || !Array.isArray(definition.usages)) {
      invalidArchitectureCapture(
        `partDefinitions[${definitionIndex}] is not a strict PartDefinition`,
      );
    }
    return {
      id: architectureCaptureNonEmptyString(
        definition.id,
        `partDefinitions[${definitionIndex}].id`,
      ),
      label: architectureCaptureNonEmptyString(
        definition.label,
        `partDefinitions[${definitionIndex}].label`,
      ),
      usages: definition.usages.map((rawUsage, usageIndex) => {
        const context = `partDefinitions[${definitionIndex}].usages[${usageIndex}]`;
        const usage = architectureCaptureObject(rawUsage, context);
        architectureCaptureOnlyKeys(usage, [
          "id",
          "kind",
          "label",
          "targetId",
          "targetKind",
          "targetLabel",
        ], context);
        if (
          usage.kind !== "PartUsage" ||
          usage.targetKind !== "PartDefinition"
        ) {
          invalidArchitectureCapture(`${context} has invalid SysON kinds`);
        }
        return {
          id: architectureCaptureNonEmptyString(usage.id, `${context}.id`),
          label: architectureCaptureNonEmptyString(
            usage.label,
            `${context}.label`,
          ),
          targetId: architectureCaptureNonEmptyString(
            usage.targetId,
            `${context}.targetId`,
          ),
          targetLabel: architectureCaptureNonEmptyString(
            usage.targetLabel,
            `${context}.targetLabel`,
          ),
        };
      }),
    };
  });
  const semanticIds = new Set<string>([packageId]);
  const definitionIds = new Set<string>();
  const definitionLabels = new Set<string>();
  for (const definition of definitions) {
    if (
      semanticIds.has(definition.id) ||
      definitionLabels.has(definition.label)
    ) {
      invalidArchitectureCapture(
        "Package and PartDefinition ids, and PartDefinition labels, must be unique",
      );
    }
    semanticIds.add(definition.id);
    definitionIds.add(definition.id);
    definitionLabels.add(definition.label);
  }
  if (!definitionLabels.has(systemName)) {
    invalidArchitectureCapture("systemName does not name a PartDefinition");
  }
  const definitionsById = new Map(
    definitions.map((definition) => [definition.id, definition]),
  );
  const allUsages = new Map<
    string,
    { readonly label: string; readonly targetId: string }
  >();
  for (const definition of definitions) {
    const labelsUnderParent = new Set<string>();
    for (const usage of definition.usages) {
      if (semanticIds.has(usage.id) || labelsUnderParent.has(usage.label)) {
        invalidArchitectureCapture(
          "PartUsage ids must be globally unique and labels unique within their parent",
        );
      }
      semanticIds.add(usage.id);
      labelsUnderParent.add(usage.label);
      const target = definitionsById.get(usage.targetId);
      if (!target || target.label !== usage.targetLabel) {
        invalidArchitectureCapture(
          `PartUsage ${usage.id} does not target an exact captured PartDefinition`,
        );
      }
      allUsages.set(usage.id, { label: usage.label, targetId: usage.targetId });
    }
  }

  for (const component of params.manifest.components) {
    const usage = allUsages.get(component.elementId);
    if (usage === undefined) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: geometry manifest component elementId "${component.elementId}" ` +
          "is not present in the architecture capture as a PartUsage.",
      );
    }
    if (usage.label !== component.usageName) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: geometry manifest component elementId "${component.elementId}" ` +
          `has usageName "${component.usageName}" but the architecture capture labels ` +
          `it "${usage.label}".`,
      );
    }
  }
  if (params.manifest.schemaVersion === "geometry-manifest/2.0") {
    const manifestUsageIds = new Set(
      params.manifest.components.map((component) => component.elementId),
    );
    if (
      manifestUsageIds.size !== allUsages.size ||
      [...allUsages.keys()].some((id) => !manifestUsageIds.has(id))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "D5 violation: geometry bundle PartUsage identities must exactly cover every " +
          "PartUsage in the captured architecture.",
      );
    }
    const capturedTargetDefinitionIds = new Set(
      [...allUsages.values()].map((usage) => usage.targetId),
    );
    const manifestDefinitionIds = new Set(
      params.manifest.partDefinitions.map((definition) => definition.elementId),
    );
    if (
      manifestDefinitionIds.size !== capturedTargetDefinitionIds.size ||
      [...capturedTargetDefinitionIds].some((id) => !manifestDefinitionIds.has(id))
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "D5 violation: geometry bundle PartDefinition identities must exactly cover " +
          "the definitions targeted by captured PartUsages; the system root is the " +
          "separate assembly.",
      );
    }
    for (const definition of params.manifest.partDefinitions) {
      const captured = definitionsById.get(definition.elementId);
      if (!captured || captured.label !== definition.label) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `D5 violation: geometry PartDefinition "${definition.elementId}" is not ` +
            "the exact captured architecture definition.",
        );
      }
    }
    for (const occurrence of params.manifest.occurrences) {
      const captured = allUsages.get(occurrence.usageElementId);
      if (
        !captured ||
        captured.targetId !== occurrence.partDefinitionElementId
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `D5 violation: geometry occurrence "${occurrence.usageElementId}" does not ` +
            `target captured PartDefinition "${occurrence.partDefinitionElementId}".`,
        );
      }
    }
  }
}

function invalidArchitectureCapture(detail: string): never {
  throw new EngineeringProjectCommandError(
    "invalid_transition",
    `D5 violation: architecture capture is not exact schema-v2 evidence: ${detail}.`,
  );
}

interface GeometryBundlePredecessorContext {
  readonly artifact: ThreadArtifact;
  readonly archiveEntries: ReturnType<typeof computeArchiveCascade>;
}

/**
 * Resolve the one active geometry tip that v2 replaces.
 *
 * This is intentionally identity-only: capture URI, artifact id and digest are
 * server-owned. Labels never participate. The exact predecessor capture is
 * reread before the new run claims or writes anything, which makes the later
 * derived_from edge and verified consumption truthful.
 */
async function requireGeometryBundlePredecessor(
  base: ThreadSnapshot,
  params: GeometryDecisionParameters,
  geometryCaptures: GeometryCaptureStore,
): Promise<GeometryBundlePredecessorContext | undefined> {
  if (params.manifest.schemaVersion !== "geometry-manifest/2.0") return undefined;
  const archived = archivedRefKeys(base);
  const active = base.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (active.length > 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_tip_ambiguous: more than one active canonical geometry capture exists.",
    );
  }
  const declared = params.manifest.predecessor;
  const artifact = active[0];
  if (!artifact) {
    if (declared) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "geometry_predecessor_mismatch: the signed predecessor is not an active geometry tip.",
      );
    }
    return undefined;
  }
  if (
    !declared || declared.artifactId !== artifact.id ||
    !fingerprintsEqual(declared.fingerprint, artifact.fingerprint)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `geometry_predecessor_mismatch: v2 must name active geometry tip ${artifact.id} exactly.`,
    );
  }
  const digest = artifact.fingerprint.digest;
  if (
    artifact.id !== `geometry-${digest}` || artifact.version !== digest ||
    artifact.uri !== `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !==
      `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}` ||
    artifact.producer.runId.trim() === ""
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_predecessor_mismatch: active geometry artifact identity is not canonical.",
    );
  }
  const captureText = await geometryCaptures.read(artifact.fingerprint);
  if (!captureText) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_predecessor_mismatch: active geometry capture is not durably readable.",
    );
  }
  let capture: unknown;
  try {
    capture = JSON.parse(captureText);
  } catch {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_predecessor_mismatch: active geometry capture is invalid JSON.",
    );
  }
  const observed = await sha256Fingerprint(capture);
  if (!fingerprintsEqual(observed, artifact.fingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_predecessor_mismatch: active geometry capture hash is not exact.",
    );
  }
  if (!capture || typeof capture !== "object" || Array.isArray(capture)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_predecessor_mismatch: active geometry capture is not an object.",
    );
  }
  const predecessorCapture = await requireExactGeometryPredecessorCapture(
    base,
    artifact,
    capture as Record<string, unknown>,
  );
  const family = requireExactGeometryPredecessorFamily(
    base,
    artifact,
    predecessorCapture.params,
    predecessorCapture.previewProducer,
    predecessorCapture.sealedAt,
  );
  const archiveEntries = computeArchiveCascade(
    base,
    family.map((candidate) => ({ kind: "artifact" as const, id: candidate.id })),
  );
  return { artifact, archiveEntries };
}

interface ExactGeometryPredecessorCapture {
  readonly params: GeometryDecisionParameters;
  readonly previewProducer: ThreadOperationRef | undefined;
  readonly sealedAt: string;
}

/**
 * Parse the complete canonical predecessor record before it can become a
 * verified consumption or supersedes edge. A self-hashed four-field JSON
 * object is not canonical geometry evidence.
 */
async function requireExactGeometryPredecessorCapture(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  record: Record<string, unknown>,
): Promise<ExactGeometryPredecessorCapture> {
  const schema = record.schemaVersion;
  if (schema !== GEOMETRY_CAPTURE_SCHEMA && schema !== GEOMETRY_BUNDLE_CAPTURE_SCHEMA) {
    invalidGeometryPredecessor("capture schema is unsupported");
  }
  exactGeometryPredecessorKeys(
    record,
    schema === GEOMETRY_BUNDLE_CAPTURE_SCHEMA
      ? [
        "schemaVersion",
        "operation",
        "trustedRunId",
        "draftDigest",
        "manifest",
        "architectureBasis",
        "previewProducer",
        "sourceScripts",
        "sealedAt",
      ]
      : [
        "schemaVersion",
        "operation",
        "trustedRunId",
        "draftDigest",
        "manifest",
        "architectureBasis",
        "previewProducer",
        "sealedAt",
      ],
    "capture",
  );
  const operation = geometryPredecessorObject(record.operation, "operation");
  exactGeometryPredecessorKeys(operation, ["id", "version"], "operation");
  if (
    operation.id !== DESIGN_WRITE_GEOMETRY_OPERATION.id ||
    operation.version !== DESIGN_WRITE_GEOMETRY_OPERATION.version
  ) {
    invalidGeometryPredecessor("operation is not design.write-geometry@1");
  }
  const trustedRunId = geometryPredecessorString(
    record.trustedRunId,
    "trustedRunId",
  );
  if (trustedRunId !== primary.producer.runId) {
    invalidGeometryPredecessor("trusted run does not match the artifact producer");
  }
  const draftDigest = geometryPredecessorDigest(record.draftDigest, "draftDigest");
  let params: GeometryDecisionParameters;
  try {
    const manifest = record.manifest as AnyGeometryManifest;
    const encoded = encodeGeometryDecisionParameters(draftDigest, manifest);
    params = parseGeometryDecisionParameters(
      geometryDecisionParametersToMap(encoded),
    );
    if (deterministicJson(params.manifest) !== deterministicJson(record.manifest)) {
      invalidGeometryPredecessor("manifest is not an exact canonical record");
    }
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    invalidGeometryPredecessor(
      `manifest is incomplete or invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (
    (schema === GEOMETRY_CAPTURE_SCHEMA &&
      params.manifest.schemaVersion !== GEOMETRY_MANIFEST_SCHEMA) ||
    (schema === GEOMETRY_BUNDLE_CAPTURE_SCHEMA &&
      params.manifest.schemaVersion !== "geometry-manifest/2.0")
  ) {
    invalidGeometryPredecessor("capture and manifest schema versions diverge");
  }

  const architectureBasis = geometryPredecessorObject(
    record.architectureBasis,
    "architectureBasis",
  );
  exactGeometryPredecessorKeys(
    architectureBasis,
    ["artifactId", "fingerprint", "producerRunId"],
    "architectureBasis",
  );
  const architectureId = geometryPredecessorString(
    architectureBasis.artifactId,
    "architectureBasis.artifactId",
  );
  const architectureFingerprint = geometryPredecessorFingerprint(
    architectureBasis.fingerprint,
    "architectureBasis.fingerprint",
  );
  const architectureProducerRunId = geometryPredecessorString(
    architectureBasis.producerRunId,
    "architectureBasis.producerRunId",
  );
  const architectureMatches = base.artifacts.filter((candidate) =>
    candidate.id === architectureId &&
    fingerprintsEqual(candidate.fingerprint, architectureFingerprint) &&
    candidate.producer.runId === architectureProducerRunId
  );
  if (
    architectureMatches.length !== 1 ||
    !fingerprintsEqual(
      params.manifest.architectureBasis.artifactFingerprint,
      architectureFingerprint,
    )
  ) {
    invalidGeometryPredecessor("architecture basis is absent or inexact");
  }
  const expectedInputs = [
    architectureId,
    ...(params.manifest.schemaVersion === "geometry-manifest/2.0" &&
        params.manifest.predecessor
      ? [params.manifest.predecessor.artifactId]
      : []),
  ];
  if (
    deterministicJson(primary.inputArtifactIds) !== deterministicJson(expectedInputs)
  ) {
    invalidGeometryPredecessor("artifact inputs do not match the sealed manifest");
  }
  let ownPredecessor: ThreadArtifact | undefined;
  if (
    params.manifest.schemaVersion === "geometry-manifest/2.0" &&
    params.manifest.predecessor
  ) {
    const manifestPredecessor = params.manifest.predecessor;
    const prior = base.artifacts.filter((candidate) =>
      candidate.id === manifestPredecessor.artifactId &&
      fingerprintsEqual(
        candidate.fingerprint,
        manifestPredecessor.fingerprint,
      )
    );
    if (
      prior.length !== 1 ||
      !archivedRefKeys(base).has(
        `artifact:${manifestPredecessor.artifactId}`,
      )
    ) {
      invalidGeometryPredecessor("its own predecessor is absent, active, or inexact");
    }
    ownPredecessor = prior[0]!;
  }

  const previewProducer = geometryPredecessorPreviewProducer(
    record.previewProducer,
    schema,
  );
  const sealedAt = geometryPredecessorInstant(record.sealedAt, "sealedAt");
  requireExactGeometryPredecessorArchitectureAttestation(
    base,
    primary,
    architectureMatches[0]!,
    sealedAt,
  );
  if (ownPredecessor) {
    requireExactGeometryPredecessorLineage(
      base,
      primary,
      ownPredecessor,
      sealedAt,
    );
  }
  if (
    primary.freshness.status !== "fresh" ||
    primary.freshness.changedAt !== sealedAt ||
    primary.freshness.invalidatedByChangeIds.length !== 0
  ) {
    invalidGeometryPredecessor("artifact freshness does not match sealedAt");
  }
  if (schema === GEOMETRY_BUNDLE_CAPTURE_SCHEMA) {
    await requireExactGeometryBundleSources(
      record.sourceScripts,
      params.manifest as Extract<
        AnyGeometryManifest,
        { readonly schemaVersion: "geometry-manifest/2.0" }
      >,
    );
  }
  return { params, previewProducer, sealedAt };
}

function requireExactGeometryPredecessorLineage(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  predecessor: ThreadArtifact,
  sealedAt: string,
): void {
  const predecessorDigest = predecessor.fingerprint.digest;
  if (
    predecessor.id !== `geometry-${predecessorDigest}` ||
    predecessor.kind !== "cad-model" || predecessor.version !== predecessorDigest ||
    predecessor.uri !==
      `${GEOMETRY_CAPTURE_URI_PREFIX}sha256/${predecessorDigest}` ||
    predecessor.mediaType !== "application/json" ||
    predecessor.producer.serverId !== "digital-thread" ||
    predecessor.producer.tool !==
      `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}` ||
    predecessor.producer.runId.trim() === "" ||
    !archivedRefKeys(base).has(`artifact:${predecessor.id}`)
  ) {
    invalidGeometryPredecessor(
      "its own predecessor identity, fingerprint, or archive state is not exact",
    );
  }

  for (const relation of ["derived_from", "supersedes"] as const) {
    const links = base.provenance.filter((link) =>
      link.relation === relation && link.from.kind === "artifact" &&
      link.from.id === primary.id && link.to.kind === "artifact" &&
      link.to.id === predecessor.id
    );
    const expectedId = relation === "derived_from"
      ? `derived-from-geometry-${primary.fingerprint.digest}`
      : `supersedes-geometry-${primary.fingerprint.digest}`;
    const expectedRationale = relation === "derived_from"
      ? GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE
      : GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE;
    if (
      links.length !== 1 || links[0]!.id !== expectedId ||
      links[0]!.rationale !== expectedRationale
    ) {
      invalidGeometryPredecessor(
        `its own predecessor ${relation} lineage is not exact`,
      );
    }
  }

  const expectedConsumptionId = `consume-geometry-${predecessor.id}-by-${primary.id}`;
  const consumptions = base.consumptions.filter((consumption) =>
    consumption.artifactId === predecessor.id &&
    deterministicJson(consumption.consumer) === deterministicJson(primary.producer)
  );
  if (consumptions.length !== 1) {
    invalidGeometryPredecessor(
      "its own predecessor consumption is missing or ambiguous",
    );
  }
  const consumption = consumptions[0]!;
  if (
    consumption.id !== expectedConsumptionId ||
    !fingerprintsEqual(consumption.observedFingerprint, predecessor.fingerprint) ||
    consumption.status !== "verified" || consumption.verifiedAt !== sealedAt
  ) {
    invalidGeometryPredecessor(
      "its own predecessor consumption metadata is not exact",
    );
  }
  const uses = base.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === expectedConsumptionId && link.to.kind === "artifact" &&
    link.to.id === predecessor.id
  );
  if (
    uses.length !== 1 || uses[0]!.id !== `uses-${expectedConsumptionId}` ||
    uses[0]!.rationale !== GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE
  ) {
    invalidGeometryPredecessor(
      "its own predecessor uses attestation is not exact",
    );
  }
}

function requireExactGeometryPredecessorArchitectureAttestation(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  architecture: ThreadArtifact,
  sealedAt: string,
): void {
  const expectedConsumptionId = `consume-arch-${architecture.id}-by-${primary.id}`;
  const architectureConsumptions = base.consumptions.filter((consumption) =>
    consumption.artifactId === architecture.id &&
    deterministicJson(consumption.consumer) === deterministicJson(primary.producer)
  );
  if (architectureConsumptions.length !== 1) {
    invalidGeometryPredecessor(
      "architecture consumption is missing or ambiguous",
    );
  }
  const consumption = architectureConsumptions[0]!;
  if (
    consumption.id !== expectedConsumptionId ||
    !fingerprintsEqual(consumption.observedFingerprint, architecture.fingerprint) ||
    consumption.status !== "verified" || consumption.verifiedAt !== sealedAt
  ) {
    invalidGeometryPredecessor("architecture consumption metadata is not exact");
  }

  const uses = base.provenance.filter((link) =>
    link.relation === "uses" && link.from.kind === "consumption" &&
    link.from.id === expectedConsumptionId && link.to.kind === "artifact" &&
    link.to.id === architecture.id
  );
  if (
    uses.length !== 1 || uses[0]!.id !== `uses-${expectedConsumptionId}` ||
    uses[0]!.rationale !== GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE
  ) {
    invalidGeometryPredecessor("architecture uses attestation is not exact");
  }

  const derived = base.provenance.filter((link) =>
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === architecture.id
  );
  if (
    derived.length !== 1 ||
    derived[0]!.id !==
      `derived-from-architecture-${primary.fingerprint.digest}` ||
    derived[0]!.rationale !== GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE
  ) {
    invalidGeometryPredecessor("architecture derivation is not exact");
  }
}

async function requireExactGeometryBundleSources(
  value: unknown,
  manifest: Extract<
    AnyGeometryManifest,
    { readonly schemaVersion: "geometry-manifest/2.0" }
  >,
): Promise<void> {
  const sources = geometryPredecessorObject(value, "sourceScripts");
  exactGeometryPredecessorKeys(
    sources,
    ["assembly", "partDefinitions", "providerCalls"],
    "sourceScripts",
  );
  const assembly = geometryPredecessorObject(
    sources.assembly,
    "sourceScripts.assembly",
  );
  exactGeometryPredecessorKeys(
    assembly,
    ["script", "scriptHash"],
    "sourceScripts.assembly",
  );
  const assemblyScript = geometryPredecessorString(
    assembly.script,
    "sourceScripts.assembly.script",
  );
  const assemblyHash = geometryPredecessorFingerprint(
    assembly.scriptHash,
    "sourceScripts.assembly.scriptHash",
  );
  if (!manifest.scriptHash || !fingerprintsEqual(assemblyHash, manifest.scriptHash)) {
    invalidGeometryPredecessor("assembly source hash is not signed by the manifest");
  }
  if (
    !fingerprintsEqual(
      await geometryPredecessorTextFingerprint(assemblyScript),
      assemblyHash,
    )
  ) {
    invalidGeometryPredecessor("assembly source bytes do not match their hash");
  }

  if (!Array.isArray(sources.partDefinitions)) {
    invalidGeometryPredecessor("sourceScripts.partDefinitions is not an array");
  }
  if (sources.partDefinitions.length !== manifest.partDefinitions.length) {
    invalidGeometryPredecessor("PartDefinition source coverage is incomplete");
  }
  const definitionSources = sources.partDefinitions.map((raw, index) => {
    const source = geometryPredecessorObject(
      raw,
      `sourceScripts.partDefinitions[${index}]`,
    );
    exactGeometryPredecessorKeys(
      source,
      ["elementId", "script", "scriptHash"],
      `sourceScripts.partDefinitions[${index}]`,
    );
    const definition = manifest.partDefinitions[index]!;
    const elementId = geometryPredecessorString(
      source.elementId,
      `sourceScripts.partDefinitions[${index}].elementId`,
    );
    const script = geometryPredecessorString(
      source.script,
      `sourceScripts.partDefinitions[${index}].script`,
    );
    const scriptHash = geometryPredecessorFingerprint(
      source.scriptHash,
      `sourceScripts.partDefinitions[${index}].scriptHash`,
    );
    if (
      elementId !== definition.elementId || !definition.scriptHash ||
      !fingerprintsEqual(scriptHash, definition.scriptHash)
    ) {
      invalidGeometryPredecessor("PartDefinition source identity or hash is inexact");
    }
    return { elementId, script, scriptHash };
  });
  for (const source of definitionSources) {
    if (
      !fingerprintsEqual(
        await geometryPredecessorTextFingerprint(source.script),
        source.scriptHash,
      )
    ) {
      invalidGeometryPredecessor(
        `PartDefinition ${source.elementId} source bytes do not match their hash`,
      );
    }
  }

  if (!Array.isArray(sources.providerCalls)) {
    invalidGeometryPredecessor("sourceScripts.providerCalls is not an array");
  }
  const expectedCalls = [
    {
      ordinal: 0,
      role: "assembly" as const,
      exportName: manifest.artifactHashes!.assemblyFiles[0]!.name,
      scriptHash: manifest.scriptHash!,
      formats: manifest.exportFormats,
    },
    ...manifest.partDefinitions.map((definition, index) => ({
      ordinal: index + 1,
      role: "part-definition" as const,
      partDefinitionElementId: definition.elementId,
      exportName: definition.files![0]!.name,
      scriptHash: definition.scriptHash!,
      formats: manifest.partExportFormats,
    })),
  ];
  if (
    deterministicJson(sources.providerCalls) !== deterministicJson(expectedCalls)
  ) {
    invalidGeometryPredecessor("providerCalls is not the exact ordered N+1 plan");
  }
}

function requireExactGeometryPredecessorFamily(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  params: GeometryDecisionParameters,
  previewProducer: ThreadOperationRef | undefined,
  sealedAt: string,
): readonly ThreadArtifact[] {
  const digest = primary.fingerprint.digest;
  const expected = new Map<string, {
    readonly name: string;
    readonly kind: ThreadArtifact["kind"];
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
    readonly mediaType: string;
  }>();
  for (
    const [index, file] of (params.manifest.artifactHashes?.assemblyFiles ?? [])
      .entries()
  ) {
    const id = params.manifest.schemaVersion === "geometry-manifest/2.0"
      ? `cad-asset-${digest}-assembly-${index}-${file.fingerprint.digest}`
      : `cad-asset-${digest}-${file.fingerprint.digest}`;
    expected.set(id, {
      name: `${file.format.toUpperCase()}: ${file.name}`,
      kind: file.format === "step" ? "step" : "cad-model",
      fingerprint: file.fingerprint,
      uri: `/api/thread/assets/${file.fingerprint.digest}.${
        geometryAssetExtension(file.format)
      }`,
      mediaType: geometryAssetMediaType(file.format),
    });
  }
  for (const mesh of params.manifest.artifactHashes?.partMeshes ?? []) {
    expected.set(`mesh-${digest}-${mesh.fingerprint.digest}`, {
      name: `Mesh: ${mesh.semanticKey}`,
      kind: "mesh",
      fingerprint: mesh.fingerprint,
      uri: `/api/thread/assets/${mesh.fingerprint.digest}.stl`,
      mediaType: "model/stl",
    });
  }
  if (params.manifest.schemaVersion === "geometry-manifest/2.0") {
    params.manifest.partDefinitions.forEach((definition, definitionIndex) => {
      definition.files!.forEach((file, fileIndex) => {
        expected.set(
          `cad-asset-${digest}-definition-${definitionIndex}-${fileIndex}-${file.fingerprint.digest}`,
          {
            name: `${
              file.format === "step" ? "Authoritative STEP" : file.format.toUpperCase()
            }: ${definition.label}`,
            kind: file.format === "step"
              ? "step"
              : file.format === "stl"
              ? "mesh"
              : "cad-model",
            fingerprint: file.fingerprint,
            uri: `/api/thread/assets/${file.fingerprint.digest}.${
              geometryAssetExtension(file.format)
            }`,
            mediaType: geometryAssetMediaType(file.format),
          },
        );
      });
    });
  }
  const archived = archivedRefKeys(base);
  const exactTraceFamilyIds = new Set(
    base.provenance.filter((link) =>
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.to.kind === "artifact" && link.to.id === primary.id
    ).map((link) => link.from.id),
  );
  const family = base.artifacts.filter((candidate) =>
    !archived.has(`artifact:${candidate.id}`) &&
    (candidate.id === primary.id ||
      candidate.id.startsWith(`cad-asset-${digest}-`) ||
      candidate.id.startsWith(`mesh-${digest}-`) ||
      exactTraceFamilyIds.has(candidate.id))
  );
  if (family.length !== expected.size + 1) {
    invalidGeometryPredecessor("binary family is incomplete or contains extra assets");
  }
  const binaryProducer = previewProducer ?? primary.producer;
  for (const [id, descriptor] of expected) {
    const matches = family.filter((candidate) => candidate.id === id);
    if (matches.length !== 1) {
      invalidGeometryPredecessor(`binary artifact ${id} is missing or ambiguous`);
    }
    const artifact = matches[0]!;
    if (
      artifact.name !== descriptor.name || artifact.kind !== descriptor.kind ||
      artifact.version !== descriptor.fingerprint.digest ||
      !fingerprintsEqual(artifact.fingerprint, descriptor.fingerprint) ||
      artifact.uri !== descriptor.uri || artifact.mediaType !== descriptor.mediaType ||
      deterministicJson(artifact.producer) !== deterministicJson(binaryProducer) ||
      deterministicJson(artifact.inputArtifactIds) !==
        deterministicJson(previewProducer ? [] : [primary.id]) ||
      artifact.freshness.status !== "fresh" ||
      artifact.freshness.changedAt !== sealedAt ||
      artifact.freshness.invalidatedByChangeIds.length !== 0
    ) {
      invalidGeometryPredecessor(`binary artifact ${id} metadata is not exact`);
    }
    const relation = previewProducer ? "traces_to" : "derived_from";
    const captureLinks = base.provenance.filter((link) =>
      link.relation === relation && link.from.kind === "artifact" &&
      link.from.id === id && link.to.kind === "artifact" &&
      link.to.id === primary.id
    );
    const expectedCaptureLinkId = `${
      previewProducer ? "traces" : "derived"
    }-${id}-from-${primary.id}`;
    const expectedCaptureRationale = previewProducer
      ? GEOMETRY_BINARY_TRACE_RATIONALE
      : GEOMETRY_BINARY_DERIVATION_RATIONALE;
    if (
      captureLinks.length !== 1 ||
      captureLinks[0]!.id !== expectedCaptureLinkId ||
      captureLinks[0]!.rationale !== expectedCaptureRationale
    ) {
      invalidGeometryPredecessor(`binary artifact ${id} has no exact capture trace`);
    }
    const consumptionId = `consume-${primary.id}-by-${id}`;
    const uses = base.provenance.filter((link) =>
      link.relation === "uses" && link.from.kind === "consumption" &&
      link.from.id === consumptionId && link.to.kind === "artifact" &&
      link.to.id === primary.id
    );
    if (
      base.consumptions.filter((consumption) =>
          consumption.id === consumptionId && consumption.artifactId === primary.id &&
          consumption.consumer.serverId === primary.producer.serverId &&
          consumption.consumer.tool === primary.producer.tool &&
          consumption.consumer.runId === primary.producer.runId &&
          fingerprintsEqual(consumption.observedFingerprint, primary.fingerprint) &&
          consumption.status === "verified" && consumption.verifiedAt === sealedAt
        ).length !== 1 ||
      uses.length !== 1 ||
      uses[0]!.id !== `uses-${consumptionId}` ||
      uses[0]!.rationale !== GEOMETRY_BINARY_CAPTURE_USE_RATIONALE
    ) {
      invalidGeometryPredecessor(
        `binary artifact ${id} publication consumption is not exact`,
      );
    }
  }
  return family;
}

function geometryPredecessorPreviewProducer(
  value: unknown,
  schema: typeof GEOMETRY_CAPTURE_SCHEMA | typeof GEOMETRY_BUNDLE_CAPTURE_SCHEMA,
): ThreadOperationRef | undefined {
  if (value === null) {
    if (schema === GEOMETRY_BUNDLE_CAPTURE_SCHEMA) {
      invalidGeometryPredecessor("v2 capture has no sandbox preview producer");
    }
    return undefined;
  }
  const producer = geometryPredecessorObject(value, "previewProducer");
  exactGeometryPredecessorKeys(
    producer,
    ["serverId", "tool", "runId"],
    "previewProducer",
  );
  if (
    producer.serverId !== "build123d-sandbox" ||
    producer.tool !== "build123d_export"
  ) {
    invalidGeometryPredecessor("preview producer is not build123d-sandbox");
  }
  return {
    serverId: "build123d-sandbox",
    tool: "build123d_export",
    runId: geometryPredecessorString(producer.runId, "previewProducer.runId"),
  };
}

function geometryPredecessorObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidGeometryPredecessor(`${context} is not an object`);
  }
  return value as Record<string, unknown>;
}

function exactGeometryPredecessorKeys(
  record: Record<string, unknown>,
  expected: readonly string[],
  context: string,
): void {
  if (
    deterministicJson(Object.keys(record).sort()) !==
      deterministicJson([...expected].sort())
  ) {
    invalidGeometryPredecessor(`${context} has missing or unexpected fields`);
  }
}

function geometryPredecessorString(value: unknown, context: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidGeometryPredecessor(`${context} is not a non-empty string`);
  }
  return value;
}

function geometryPredecessorDigest(value: unknown, context: string): string {
  const result = geometryPredecessorString(value, context);
  if (!/^[a-f0-9]{64}$/.test(result)) {
    invalidGeometryPredecessor(`${context} is not a lowercase SHA-256`);
  }
  return result;
}

function geometryPredecessorFingerprint(
  value: unknown,
  context: string,
): ContentFingerprint {
  const record = geometryPredecessorObject(value, context);
  exactGeometryPredecessorKeys(record, ["algorithm", "digest"], context);
  if (record.algorithm !== "sha256") {
    invalidGeometryPredecessor(`${context}.algorithm is not sha256`);
  }
  return {
    algorithm: "sha256",
    digest: geometryPredecessorDigest(record.digest, `${context}.digest`),
  };
}

function geometryPredecessorInstant(value: unknown, context: string): string {
  const result = geometryPredecessorString(value, context);
  if (
    !Number.isFinite(Date.parse(result)) || new Date(result).toISOString() !== result
  ) {
    invalidGeometryPredecessor(`${context} is not a canonical instant`);
  }
  return result;
}

async function geometryPredecessorTextFingerprint(
  text: string,
): Promise<ContentFingerprint> {
  return {
    algorithm: "sha256",
    digest: await sha256Hex(new TextEncoder().encode(text)),
  };
}

function invalidGeometryPredecessor(detail: string): never {
  throw new EngineeringProjectCommandError(
    "invalid_transition",
    `geometry_predecessor_mismatch: ${detail}.`,
  );
}

function architectureCaptureObject(
  value: unknown,
  context: string,
): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalidArchitectureCapture(`${context} must be an object`);
  }
  return value as Record<string, unknown>;
}

function architectureCaptureNonEmptyString(
  value: unknown,
  context: string,
): string {
  if (typeof value !== "string" || value.trim() === "") {
    invalidArchitectureCapture(`${context} must be a non-empty string`);
  }
  return value;
}

function architectureCaptureOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  context: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    invalidArchitectureCapture(`${context} has unsupported field ${unexpected}`);
  }
}

interface ArchitectureCaptureSource {
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
}

function assertArchitectureCaptureSource(
  value: unknown,
  context: string,
): ArchitectureCaptureSource {
  const source = architectureCaptureObject(value, context);
  architectureCaptureOnlyKeys(
    source,
    ["artifactId", "fingerprint", "producerRunId"],
    context,
  );
  const artifactId = architectureCaptureNonEmptyString(
    source.artifactId,
    `${context}.artifactId`,
  );
  const producerRunId = architectureCaptureNonEmptyString(
    source.producerRunId,
    `${context}.producerRunId`,
  );
  const fingerprint = architectureCaptureObject(
    source.fingerprint,
    `${context}.fingerprint`,
  );
  architectureCaptureOnlyKeys(
    fingerprint,
    ["algorithm", "digest"],
    `${context}.fingerprint`,
  );
  if (
    fingerprint.algorithm !== "sha256" ||
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    invalidArchitectureCapture(`${context}.fingerprint is not SHA-256`);
  }
  return {
    artifactId,
    fingerprint: {
      algorithm: "sha256",
      digest: fingerprint.digest as string,
    },
    producerRunId,
  };
}

function assertArchitectureCaptureLineageExact(
  base: ThreadSnapshot,
  architectureArtifact: ThreadArtifact,
  seed: ArchitectureCaptureSource,
  predecessor: ArchitectureCaptureSource | undefined,
  insertedAt: string,
): void {
  const expectedInputIds = [
    seed.artifactId,
    ...(predecessor ? [predecessor.artifactId] : []),
  ];
  if (
    new Set(architectureArtifact.inputArtifactIds).size !==
      architectureArtifact.inputArtifactIds.length ||
    deterministicJson(architectureArtifact.inputArtifactIds) !==
      deterministicJson(expectedInputIds)
  ) {
    invalidArchitectureCapture(
      "architecture artifact inputs are not exactly [seed, optional predecessor]",
    );
  }

  const seedArtifact = base.artifacts.find((artifact) =>
    artifact.id === seed.artifactId
  );
  if (!seedArtifact) {
    invalidArchitectureCapture("seed artifact is absent from the exact basis");
  }
  assertArchitectureSourceArtifactExact(seedArtifact, seed, "seed");

  let predecessorArtifact: ThreadArtifact | undefined;
  if (predecessor) {
    predecessorArtifact = base.artifacts.find((artifact) =>
      artifact.id === predecessor.artifactId
    );
    if (!predecessorArtifact) {
      invalidArchitectureCapture(
        "predecessor architecture artifact is absent from the exact basis",
      );
    }
    assertArchitectureSourceArtifactExact(
      predecessorArtifact,
      predecessor,
      "predecessor",
    );
  }

  const inputs = [
    { source: seed, artifact: seedArtifact, kind: "seed" as const },
    ...(predecessor && predecessorArtifact
      ? [{
        source: predecessor,
        artifact: predecessorArtifact,
        kind: "predecessor" as const,
      }]
      : []),
  ];
  for (const input of inputs) {
    const consumptionId = `consume-${input.artifact.id}-by-${architectureArtifact.id}`;
    const expectedConsumption: ThreadArtifactConsumption = {
      id: consumptionId,
      artifactId: input.artifact.id,
      consumer: architectureArtifact.producer,
      observedFingerprint: input.source.fingerprint,
      verifiedAt: insertedAt,
      status: "verified",
    };
    const consumption = base.consumptions.find((item) => item.id === consumptionId);
    if (
      !consumption ||
      deterministicJson(consumption) !== deterministicJson(expectedConsumption)
    ) {
      invalidArchitectureCapture(
        `${input.kind} consumption is absent or not exact`,
      );
    }

    const usesId = `uses-${consumptionId}`;
    const uses = base.provenance.find((link) => link.id === usesId);
    const expectedUses = {
      id: usesId,
      relation: "uses" as const,
      from: { kind: "consumption" as const, id: consumptionId },
      to: { kind: "artifact" as const, id: input.artifact.id },
      rationale: input.kind === "seed"
        ? "The executor re-read the exact seed capture before inserting the architecture package."
        : "The executor re-read the exact previous generic architecture capture before enriching it.",
    };
    if (
      !uses || deterministicJson(uses) !== deterministicJson(expectedUses)
    ) {
      invalidArchitectureCapture(
        `${input.kind} uses provenance is absent or not exact`,
      );
    }

    const derivedId = input.kind === "seed"
      ? `derived-from-seed-${architectureArtifact.fingerprint.digest}`
      : `derived-from-architecture-${architectureArtifact.fingerprint.digest}`;
    const derived = base.provenance.find((link) => link.id === derivedId);
    const expectedDerived = {
      id: derivedId,
      relation: "derived_from" as const,
      from: { kind: "artifact" as const, id: architectureArtifact.id },
      to: { kind: "artifact" as const, id: input.artifact.id },
      rationale: input.kind === "seed"
        ? "The architecture package was inserted into the SysON model container created by the seed run."
        : "The exact previous generic architecture capture was re-read as the predecessor of this enrichment.",
    };
    if (
      !derived || deterministicJson(derived) !== deterministicJson(expectedDerived)
    ) {
      invalidArchitectureCapture(
        `${input.kind} derivation provenance is absent or not exact`,
      );
    }
  }
}

function assertArchitectureSourceArtifactExact(
  artifact: ThreadArtifact,
  source: ArchitectureCaptureSource,
  kind: "seed" | "predecessor",
): void {
  const digest = source.fingerprint.digest;
  const expectedId = kind === "seed"
    ? `syson-model-seed-${digest}`
    : `architecture-${digest}`;
  const expectedUri = kind === "seed"
    ? `casys://syson-model-seed-capture/sha256/${digest}`
    : `${ARCHITECTURE_CAPTURE_URI_PREFIX}sha256/${digest}`;
  const expectedTool = kind === "seed"
    ? "syson_model_create"
    : "syson_element_insert_sysml";
  if (
    source.artifactId !== expectedId || artifact.id !== expectedId ||
    artifact.kind !== "sysml-model" || artifact.version !== digest ||
    !fingerprintsEqual(artifact.fingerprint, source.fingerprint) ||
    artifact.uri !== expectedUri || artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "syson" ||
    artifact.producer.tool !== expectedTool ||
    artifact.producer.runId !== source.producerRunId
  ) {
    invalidArchitectureCapture(
      `${kind} artifact identity, version, URI, media type, producer, run, or fingerprint is not exact`,
    );
  }
}

/** Load and validate the exact human-reviewed draft without mutating state. */
async function loadReviewedGeometryDraft(
  params: GeometryDecisionParameters,
  draftCaptures: FileCaptureStore<"geometry-draft">,
  draftAssetDirectory?: string,
): Promise<{
  readonly previewProducer: ThreadOperationRef | undefined;
  readonly bundleSources: GeometryBundleCanonicalSources | undefined;
  readonly bundleAssetBytes: ReadonlyMap<string, number> | undefined;
}> {
  const draftFp: ContentFingerprint = {
    algorithm: "sha256",
    digest: params.draftDigest,
  };
  const draftText = await draftCaptures.read(draftFp);
  if (!draftText) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Geometry draft ${params.draftDigest} not found in the draft store. ` +
        "The draft may have been cleared before the human decision was executed.",
    );
  }
  const draftRecord = JSON.parse(draftText);
  const recomputedDraftFp = await sha256Fingerprint(draftRecord);
  if (!fingerprintsEqual(recomputedDraftFp, draftFp)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Draft capture byte-level fingerprint mismatch: the bytes read from the draft " +
        "store do not hash to the signed draft digest. Operator inspection required.",
    );
  }

  // The signed decision is authoritative only if every manifest field is
  // exactly reconstructible from the reviewed draft record.
  assertMrtrManifestMatchesDraft(params.manifest, draftRecord);
  const previewProducer = requireDraftPreviewProducer(draftRecord);
  let bundleAssetBytes: ReadonlyMap<string, number> | undefined;
  if (draftRecord.schemaVersion === GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA) {
    try {
      await assertGeometryBundleDraftPaths(draftRecord);
      const assets = requireGeometryBundleDraftAssetMetadata(draftRecord);
      bundleAssetBytes = new Map(
        assets.map((asset) => [asset.fingerprint.digest, asset.bytes]),
      );
      if (draftAssetDirectory !== undefined) {
        for (const asset of assets) {
          await verifyDraftAsset(
            asset.fingerprint.digest,
            asset.name,
            draftAssetDirectory,
            asset.bytes,
          );
        }
      }
    } catch (error) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Geometry bundle draft binary contract mismatch: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  } else {
    requireDraftAssemblyPaths(draftRecord);
  }
  const bundleSources = draftRecord.schemaVersion ===
      GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA
    ? await requireGeometryBundleCanonicalSources(draftRecord)
    : undefined;
  return { previewProducer, bundleSources, bundleAssetBytes };
}

/**
 * Recover the actual preview invocation from a signed draft capture.
 *
 * v1.0 did not record a run id. Those existing drafts remain readable, but the
 * resulting canonical binary must then be attributed to the local seal instead
 * of inventing a build123d run. v1.1 requires the exact preview run identity.
 */
function requireDraftPreviewProducer(value: unknown): ThreadOperationRef | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Geometry draft capture must be an object.",
    );
  }
  const draft = value as Record<string, unknown>;
  const schemaVersion = draft.schemaVersion;
  if (
    schemaVersion !== GEOMETRY_DRAFT_CAPTURE_SCHEMA &&
    schemaVersion !== LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA &&
    schemaVersion !== GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Unsupported geometry draft capture schema: ${String(schemaVersion)}.`,
    );
  }
  const rawProducer = draft.producer;
  if (!rawProducer || typeof rawProducer !== "object" || Array.isArray(rawProducer)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Geometry draft capture has no valid preview producer.",
    );
  }
  const producer = rawProducer as Record<string, unknown>;
  if (schemaVersion === LEGACY_GEOMETRY_DRAFT_CAPTURE_SCHEMA) {
    if (producer.serverId !== "build123d" || producer.tool !== "build123d_export") {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Legacy geometry draft capture producer is not build123d/build123d_export.",
      );
    }
    return undefined;
  }
  if (
    producer.serverId !== "build123d-sandbox" ||
    producer.tool !== "build123d_export"
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Geometry draft capture producer is not build123d-sandbox/build123d_export.",
    );
  }
  if (typeof producer.runId === "string" && producer.runId.trim() !== "") {
    return {
      serverId: "build123d-sandbox",
      tool: "build123d_export",
      runId: producer.runId,
    };
  }
  throw new EngineeringProjectCommandError(
    "invalid_transition",
    "Geometry draft capture/1.1 requires an exact preview producer runId.",
  );
}

/** Fail closed on legacy and current draft paths before canonical capture writes. */
function requireDraftAssemblyPaths(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Geometry draft capture must be an object.",
    );
  }
  try {
    assertGeometryDraftAssemblyPaths(
      (value as Record<string, unknown>).assemblyFiles,
    );
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Geometry draft export path contract mismatch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

// ── Cliquet (monotony ratchet) ────────────────────────────────────────────────

/**
 * Assert that the current basis has not silently removed a geometry artifact
 * that appeared in an ancestor snapshot.
 *
 * WHY WALK ANCESTORS — `assertGeometryArtifactNotRemoved` cannot rely on the
 * basis revision alone.  A geometry artifact can legitimately be absent from
 * the very first revision.  The ratchet only fires when a *prior* revision
 * carried a geometry artifact and the current basis does not.
 */
async function assertGeometryArtifactNotRemoved(
  basis: ThreadSnapshot,
  snapshots: ThreadSnapshotStore,
): Promise<void> {
  if (hasGeometryArtifact(basis)) return;

  // Walk ancestors up to a hard cap to prevent O(n) unbounded reads.
  const MAX_ANCESTORS = 50;
  let current = basis.previous;
  for (let i = 0; i < MAX_ANCESTORS; i++) {
    if (!current) return; // Reached the root without finding a geometry artifact.
    const ancestor = await snapshots.get(current.snapshotId);
    if (!ancestor) {
      throw new GeometryLineageReviewRequiredError(
        `ancestor ${current.snapshotId}@${current.revision} is not resolvable.`,
      );
    }
    if (
      ancestor.id !== current.snapshotId ||
      ancestor.revision !== current.revision ||
      ancestor.subject.id !== basis.subject.id
    ) {
      throw new GeometryLineageReviewRequiredError(
        `ancestor ${current.snapshotId}@${current.revision} resolved to an incompatible record.`,
      );
    }
    if (hasGeometryArtifact(ancestor)) {
      throw new GeometryArtifactRemovedError(basis.subject.id);
    }
    current = ancestor.previous;
  }
  if (current) {
    throw new GeometryLineageReviewRequiredError(
      `ancestor traversal exceeded the explicit ${MAX_ANCESTORS}-revision review bound.`,
    );
  }
}

function hasGeometryArtifact(snapshot: ThreadSnapshot): boolean {
  return snapshot.artifacts.some(
    (a) => a.kind === "cad-model" && a.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX),
  );
}

// ── Binary asset verification ─────────────────────────────────────────────────

/**
 * Verify that a binary asset exists in the draft-assets directory and that its
 * SHA-256 matches the expected digest.
 *
 * WHY FAIL-CLOSED — the operator signed specific bytes.  If the draft-assets
 * directory does not hold those exact bytes, we cannot seal the geometry: the
 * seal would attest bytes the operator never reviewed.
 */
async function verifyDraftAsset(
  expectedDigest: string,
  name: string,
  draftDirectory: string,
  expectedBytes?: number,
): Promise<void> {
  const path = `${draftDirectory}/${expectedDigest}`;
  let bytes: Uint8Array;
  try {
    bytes = await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      throw new GeometryAssetVerificationError(
        "asset_not_found",
        { name, expectedDigest, path },
        `Geometry draft asset not found: ${name} (${expectedDigest.slice(0, 16)}…). ` +
          "Re-run the geometry preview before retrying the write.",
      );
    }
    throw error;
  }
  if (bytes.length === 0) {
    throw new GeometryAssetVerificationError(
      "asset_empty",
      { name, expectedDigest, path },
      `Geometry draft asset is empty: ${name} (${expectedDigest.slice(0, 16)}…).`,
    );
  }
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new GeometryAssetVerificationError(
      "byte_count_mismatch",
      {
        name,
        expectedDigest,
        expectedBytes: String(expectedBytes),
        actualBytes: String(bytes.length),
        path,
      },
      `Geometry draft asset byte count mismatch for ${name}: expected ${expectedBytes}, got ${bytes.length}.`,
    );
  }
  const actual = await sha256Hex(bytes);
  if (actual !== expectedDigest) {
    throw new GeometryAssetVerificationError(
      "sha256_mismatch",
      { name, expected: expectedDigest, actual },
      `SHA-256 mismatch for geometry draft asset ${name}: ` +
        `expected ${expectedDigest.slice(0, 16)}…, got ${actual.slice(0, 16)}….`,
    );
  }
}

async function promoteAssetNamedByCapture(options: {
  captureFp: ContentFingerprint;
  assetFingerprint: ContentFingerprint;
  name: string;
  identity:
    | {
      readonly scope: "assembly";
      readonly format: "step" | "gltf" | "stl";
      readonly name: string;
    }
    | {
      readonly scope: "legacy-part-mesh";
      readonly semanticKey: string;
      readonly name: string;
    }
    | {
      readonly scope: "part-definition";
      readonly elementId: string;
      readonly format: "step" | "gltf" | "stl";
      readonly name: string;
    };
  extension: string;
  geometryCaptures: GeometryCaptureStore;
  draftDirectory: string;
  canonicalDirectory: string;
  expectedBytes?: number;
}): Promise<void> {
  const captureText = await options.geometryCaptures.read(options.captureFp);
  if (!captureText) {
    throw new GeometryAssetVerificationError(
      "asset_not_found",
      { expectedDigest: options.captureFp.digest },
      "Canonical geometry capture disappeared before binary promotion.",
    );
  }
  const capture = JSON.parse(captureText) as {
    manifest?: AnyGeometryManifest;
  };
  const observedCaptureFp = await sha256Fingerprint(capture);
  if (!fingerprintsEqual(observedCaptureFp, options.captureFp)) {
    throw new GeometryAssetVerificationError(
      "sha256_mismatch",
      {
        expected: options.captureFp.digest,
        actual: observedCaptureFp.digest,
      },
      "Canonical geometry capture changed before binary promotion.",
    );
  }
  const manifest = capture.manifest;
  let exactMatches: ContentFingerprint[] = [];
  if (options.identity.scope === "assembly") {
    const identity = options.identity;
    exactMatches = (manifest?.artifactHashes?.assemblyFiles ?? [])
      .filter((file) => file.format === identity.format && file.name === identity.name)
      .map((file) => file.fingerprint);
  } else if (options.identity.scope === "legacy-part-mesh") {
    const identity = options.identity;
    exactMatches = (manifest?.artifactHashes?.partMeshes ?? [])
      .filter((mesh) =>
        "semanticKey" in mesh &&
        mesh.semanticKey === identity.semanticKey &&
        mesh.name === identity.name
      )
      .map((mesh) => mesh.fingerprint);
  } else if (manifest?.schemaVersion === "geometry-manifest/2.0") {
    const identity = options.identity;
    exactMatches = manifest.partDefinitions
      .filter((definition) => definition.elementId === identity.elementId)
      .flatMap((definition) => definition.files ?? [])
      .filter((file) => file.format === identity.format && file.name === identity.name)
      .map((file) => file.fingerprint);
  }
  if (
    exactMatches.length !== 1 ||
    !fingerprintsEqual(exactMatches[0]!, options.assetFingerprint)
  ) {
    throw new GeometryAssetVerificationError(
      "sha256_mismatch",
      {
        captureDigest: options.captureFp.digest,
        assetDigest: options.assetFingerprint.digest,
      },
      `Canonical geometry capture does not name ${options.name}.`,
    );
  }
  await verifyDraftAsset(
    options.assetFingerprint.digest,
    options.name,
    options.draftDirectory,
    options.expectedBytes,
  );
  await promoteDraftAsset(
    options.assetFingerprint.digest,
    options.extension,
    options.draftDirectory,
    options.canonicalDirectory,
    options.expectedBytes,
  );
}

/**
 * Copy verified draft bytes into the canonical content-addressed store.
 * The destination is written through a temporary file because a crash must
 * never expose a partial object under an authoritative digest-bearing name.
 */
async function promoteDraftAsset(
  expectedDigest: string,
  extension: string,
  draftDirectory: string,
  canonicalDirectory: string,
  expectedBytes?: number,
): Promise<void> {
  const source = `${draftDirectory}/${expectedDigest}`;
  const destination = `${canonicalDirectory}/${expectedDigest}.${extension}`;
  let bytes = await readCanonicalAsset(destination);
  if (
    bytes && bytes.length > 0 &&
    (expectedBytes === undefined || bytes.length === expectedBytes) &&
    await sha256Hex(bytes) === expectedDigest
  ) return;
  await Deno.mkdir(canonicalDirectory, { recursive: true });
  bytes = await Deno.readFile(source);
  if (bytes.length === 0) {
    throw new GeometryAssetVerificationError(
      "asset_empty",
      { expectedDigest, source },
      "Geometry draft bytes became empty before canonical promotion.",
    );
  }
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new GeometryAssetVerificationError(
      "byte_count_mismatch",
      {
        expectedDigest,
        expectedBytes: String(expectedBytes),
        actualBytes: String(bytes.length),
        source,
      },
      "Geometry draft byte count changed before canonical promotion.",
    );
  }
  const actual = await sha256Hex(bytes);
  if (actual !== expectedDigest) {
    throw new GeometryAssetVerificationError(
      "sha256_mismatch",
      { expected: expectedDigest, actual, source },
      "Geometry draft bytes changed before canonical promotion.",
    );
  }
  const temporary = `${canonicalDirectory}/.${crypto.randomUUID()}.tmp`;
  await Deno.writeFile(temporary, bytes, { createNew: true });
  try {
    await Deno.rename(temporary, destination);
  } catch (error) {
    await Deno.remove(temporary).catch(() => undefined);
    if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
  }
  const persisted = await readCanonicalAsset(destination);
  if (
    !persisted || persisted.length === 0 ||
    (expectedBytes !== undefined && persisted.length !== expectedBytes) ||
    await sha256Hex(persisted) !== expectedDigest
  ) {
    throw new GeometryAssetVerificationError(
      "sha256_mismatch",
      { expected: expectedDigest, destination },
      "Canonical geometry asset failed its post-copy SHA-256 verification.",
    );
  }
}

async function readCanonicalAsset(path: string): Promise<Uint8Array | undefined> {
  try {
    return await Deno.readFile(path);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return undefined;
    throw error;
  }
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", Uint8Array.from(bytes));
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function assertCanonicalGeometryAssetExact(
  fingerprint: ContentFingerprint,
  extension: string,
  canonicalDirectory: string,
): Promise<void> {
  const path = `${canonicalDirectory}/${fingerprint.digest}.${extension}`;
  const bytes = await readCanonicalAsset(path);
  if (!bytes) {
    throw completedGeometryIntegrityError(
      `canonical binary ${fingerprint.digest}.${extension} is absent`,
    );
  }
  if (bytes.length === 0) {
    throw completedGeometryIntegrityError(
      `canonical binary ${fingerprint.digest}.${extension} is empty`,
    );
  }
  const observed = await sha256Hex(bytes);
  if (fingerprint.algorithm !== "sha256" || observed !== fingerprint.digest) {
    throw completedGeometryIntegrityError(
      `canonical binary ${fingerprint.digest}.${extension} no longer matches its content digest`,
    );
  }
}

function geometryAssetExtension(
  format: GeometryManifest["exportFormats"][number],
): string {
  // build123d's `gltf` export is the binary GLB container, as evidenced by the
  // provider path contract (`*.glb`). Never advertise those bytes as JSON glTF.
  return format === "gltf" ? "glb" : format;
}

function geometryAssetMediaType(
  format: GeometryManifest["exportFormats"][number],
): "model/step" | "model/gltf-binary" | "model/stl" {
  return format === "step"
    ? "model/step"
    : format === "gltf"
    ? "model/gltf-binary"
    : "model/stl";
}

// ── Thread extension ──────────────────────────────────────────────────────────

function buildExtension(options: {
  base: ThreadSnapshot;
  architectureArtifact: ThreadArtifact;
  runId: string;
  capturedAt: string;
  captureFp: ContentFingerprint;
  captureUri: string;
  params: GeometryDecisionParameters;
  previewProducer: ThreadOperationRef | undefined;
  predecessor: GeometryBundlePredecessorContext | undefined;
}) {
  const {
    base,
    architectureArtifact,
    runId,
    capturedAt,
    captureFp,
    captureUri,
    params,
    previewProducer,
    predecessor,
  } = options;

  const artifactId = `geometry-${captureFp.digest}`;
  const freshness: ThreadFreshness = {
    status: "fresh",
    changedAt: capturedAt,
    invalidatedByChangeIds: [],
  };
  const sealProducer: ThreadOperationRef = {
    serverId: "digital-thread",
    tool:
      `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}`,
    runId,
  };
  // Legacy draft-capture/1.0 records had no preview run identity. In that case
  // the only exact operation we can truthfully attribute is this local seal.
  const binaryProducer = previewProducer ?? sealProducer;

  // Primary geometry artifact: the sealed geometry capture (JSON).
  const primaryArtifact: ThreadArtifact = {
    id: artifactId,
    name: `Geometry: ${
      params.manifest.components.length === 0
        ? "assembly"
        : params.manifest.components.map((c) => c.usageName).join(", ")
    }`,
    kind: "cad-model",
    version: captureFp.digest,
    fingerprint: captureFp,
    uri: captureUri,
    mediaType: "application/json",
    producer: sealProducer,
    inputArtifactIds: [
      architectureArtifact.id,
      ...(predecessor ? [predecessor.artifact.id] : []),
    ],
    freshness,
  };

  // Per-part-mesh artifacts: one "mesh" artifact per sealed part mesh.
  const partMeshArtifacts: ThreadArtifact[] =
    (params.manifest.artifactHashes?.partMeshes ?? []).map((mesh) => ({
      id: `mesh-${captureFp.digest}-${mesh.fingerprint.digest}`,
      name: `Mesh: ${mesh.semanticKey}`,
      kind: "mesh" as const,
      version: mesh.fingerprint.digest,
      fingerprint: mesh.fingerprint,
      uri: `/api/thread/assets/${mesh.fingerprint.digest}.stl`,
      mediaType: "model/stl",
      producer: binaryProducer,
      inputArtifactIds: previewProducer ? [] : [artifactId],
      freshness,
    }));

  // V2 publishes one logical artifact per exact PartDefinition and format.
  // Ordinals are part of the signed manifest order, so equal content hashes
  // remain distinct semantic artifacts without putting opaque provider ids in
  // filesystem paths or joining on labels.
  const partDefinitionArtifacts: ThreadArtifact[] =
    params.manifest.schemaVersion === "geometry-manifest/2.0"
      ? params.manifest.partDefinitions.flatMap((definition, definitionIndex) =>
        (definition.files ?? []).map((file, fileIndex) => ({
          id:
            `cad-asset-${captureFp.digest}-definition-${definitionIndex}-${fileIndex}-${file.fingerprint.digest}`,
          name: `${
            file.format === "step" ? "Authoritative STEP" : file.format.toUpperCase()
          }: ${definition.label}`,
          kind: (file.format === "step"
            ? "step"
            : file.format === "stl"
            ? "mesh"
            : "cad-model") as ThreadArtifact["kind"],
          version: file.fingerprint.digest,
          fingerprint: file.fingerprint,
          uri: `/api/thread/assets/${file.fingerprint.digest}.${
            geometryAssetExtension(file.format)
          }`,
          mediaType: geometryAssetMediaType(file.format),
          producer: binaryProducer,
          inputArtifactIds: previewProducer ? [] : [artifactId],
          freshness,
        }))
      )
      : [];

  // Per-assembly-file artifacts: one artifact per exported format (step, gltf, stl).
  const assemblyFileArtifacts: ThreadArtifact[] =
    (params.manifest.artifactHashes?.assemblyFiles ?? []).map((file, index) => ({
      id: params.manifest.schemaVersion === "geometry-manifest/2.0"
        ? `cad-asset-${captureFp.digest}-assembly-${index}-${file.fingerprint.digest}`
        : `cad-asset-${captureFp.digest}-${file.fingerprint.digest}`,
      name: `${file.format.toUpperCase()}: ${file.name}`,
      kind: (file.format === "step" ? "step" : "cad-model") as ThreadArtifact["kind"],
      version: file.fingerprint.digest,
      fingerprint: file.fingerprint,
      uri: `/api/thread/assets/${file.fingerprint.digest}.${
        geometryAssetExtension(file.format)
      }`,
      mediaType: geometryAssetMediaType(file.format),
      producer: binaryProducer,
      inputArtifactIds: previewProducer ? [] : [artifactId],
      freshness,
    }));

  const consumptionId = `consume-arch-${architectureArtifact.id}-by-${artifactId}`;
  const consumption: ThreadArtifactConsumption = {
    id: consumptionId,
    artifactId: architectureArtifact.id,
    consumer: sealProducer,
    observedFingerprint: architectureArtifact.fingerprint,
    verifiedAt: capturedAt,
    status: "verified",
  };
  const predecessorConsumption: ThreadArtifactConsumption | undefined = predecessor
    ? {
      id: `consume-geometry-${predecessor.artifact.id}-by-${artifactId}`,
      artifactId: predecessor.artifact.id,
      consumer: sealProducer,
      observedFingerprint: predecessor.artifact.fingerprint,
      verifiedAt: capturedAt,
      status: "verified",
    }
    : undefined;
  const binaryArtifacts = [
    ...assemblyFileArtifacts,
    ...partMeshArtifacts,
    ...partDefinitionArtifacts,
  ];
  const binaryConsumptions: ThreadArtifactConsumption[] = binaryArtifacts.map(
    (artifact) => ({
      id: `consume-${artifactId}-by-${artifact.id}`,
      artifactId,
      consumer: sealProducer,
      observedFingerprint: captureFp,
      verifiedAt: capturedAt,
      status: "verified" as const,
    }),
  );

  const extensionId = `design-write-geometry-${captureFp.digest}`;

  return {
    id: extensionId,
    name: `Geometry seal: ${captureFp.digest.slice(0, 16)}`,
    subjectId: base.subject.id,
    capturedAt,
    artifacts: [
      primaryArtifact,
      ...assemblyFileArtifacts,
      ...partMeshArtifacts,
      ...partDefinitionArtifacts,
    ],
    consumptions: [
      consumption,
      ...(predecessorConsumption ? [predecessorConsumption] : []),
      ...binaryConsumptions,
    ],
    observations: [],
    requirements: [],
    evaluations: [],
    violations: [],
    provenance: [
      {
        id: `derived-from-architecture-${captureFp.digest}`,
        relation: "derived_from" as const,
        from: { kind: "artifact" as const, id: artifactId },
        to: { kind: "artifact" as const, id: architectureArtifact.id },
        rationale: GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
      },
      ...(predecessor && predecessorConsumption
        ? [{
          id: `derived-from-geometry-${captureFp.digest}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: predecessor.artifact.id },
          rationale: GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE,
        }, {
          id: `supersedes-geometry-${captureFp.digest}`,
          relation: "supersedes" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: predecessor.artifact.id },
          rationale: GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE,
        }, {
          id: `uses-${predecessorConsumption.id}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: predecessorConsumption.id },
          to: { kind: "artifact" as const, id: predecessor.artifact.id },
          rationale: GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE,
        }]
        : []),
      {
        id: `uses-${consumptionId}`,
        relation: "uses" as const,
        from: { kind: "consumption" as const, id: consumptionId },
        to: { kind: "artifact" as const, id: architectureArtifact.id },
        rationale: GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
      },
      ...binaryArtifacts.flatMap((artifact, index) => {
        const binaryConsumption = binaryConsumptions[index]!;
        return [{
          id: `${
            previewProducer ? "traces" : "derived"
          }-${artifact.id}-from-${artifactId}`,
          relation: previewProducer ? "traces_to" as const : "derived_from" as const,
          from: { kind: "artifact" as const, id: artifact.id },
          to: { kind: "artifact" as const, id: artifactId },
          rationale: previewProducer
            ? GEOMETRY_BINARY_TRACE_RATIONALE
            : GEOMETRY_BINARY_DERIVATION_RATIONALE,
        }, {
          id: `uses-${binaryConsumption.id}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: binaryConsumption.id },
          to: { kind: "artifact" as const, id: artifactId },
          rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
        }];
      }),
    ],
    proposedActions: [],
    ...(predecessor
      ? {
        archived: predecessor.archiveEntries.map((entry) => ({
          target: entry.ref,
          summary: `Retired by geometry bundle ${captureFp.digest.slice(0, 16)}; ` +
            `cascade source ${entry.because}.`,
        })),
      }
      : {}),
  };
}

// ── Private helpers ───────────────────────────────────────────────────────────

function commandStep(commandId: string, step: string): string {
  return `${commandId}:design-write-geometry:${step}`;
}

function assertCompleted(
  project: EngineeringProjectSnapshot,
  command: DesignWriteGeometryRunExecutorCommand,
): void {
  const run = requireRun(project, command.runId);
  if (
    run.status !== "completed" || !run.resultSnapshot ||
    !project.commandReceipts?.some(
      (receipt) => receipt.commandId === commandStep(command.commandId, "complete"),
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Geometry run ${command.runId} did not complete through this exact execution command.`,
    );
  }
}

function completedGeometryIntegrityError(
  detail: string,
): EngineeringProjectCommandError {
  return new EngineeringProjectCommandError(
    "invalid_transition",
    `Completed geometry evidence integrity failure: ${detail}.`,
  );
}

function geometryArtifactEntityRef(
  snapshot: ThreadSnapshot,
  runId: string,
): {
  snapshotId: string;
  snapshotRevision: number;
  kind: ThreadEntityKind;
  id: string;
} {
  const artifact = snapshot.artifacts.find(
    (a) => a.kind === "cad-model" && a.producer.runId === runId,
  );
  if (!artifact) {
    throw new Error(
      `Geometry artifact for run ${runId} not found in snapshot ${snapshot.id}.`,
    );
  }
  return {
    snapshotId: snapshot.id,
    snapshotRevision: snapshot.revision,
    kind: "artifact" as ThreadEntityKind,
    id: artifact.id,
  };
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
      "This executor may run only the exact geometry run it claimed.",
    );
  }
}

function requireShape(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): void {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  const operation = workItem?.operation;
  if (
    project.schemaVersion !== "3.0" || run.basis?.kind !== "thread-snapshot" ||
    !workItem || operation?.id !== DESIGN_WRITE_GEOMETRY_OPERATION.id ||
    operation.version !== DESIGN_WRITE_GEOMETRY_OPERATION.version ||
    operation.bindings.length !== 1 ||
    deterministicJson(operation.bindings[0]) !== deterministicJson({
        name: "approvedBrief",
        source: { kind: "approved-brief" },
      })
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${run.id} is not bound to ${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}.`,
    );
  }
}

/**
 * Require exactly one human-approved MRTR decision bound to the run's basis.
 *
 * Follows the same filter logic as requireMrtrApproval in model-write-architecture:
 * status === "approved", exactly one human approval with matching basis + fingerprints.
 * Returns the decision and its proposal.
 */
async function requireMrtrApproval(
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): Promise<{
  decision: EngineeringDecision;
  proposal: NonNullable<EngineeringDecision["proposal"]>;
}> {
  const workItem = project.workItems.find((item) => item.id === run.workItemId);
  if (!workItem) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Work item for run ${run.id} not found.`,
    );
  }

  const basis = requireBasis(run);
  const candidates: Array<{
    decision: EngineeringDecision;
    proposal: NonNullable<EngineeringDecision["proposal"]>;
  }> = [];

  for (const decisionId of workItem.decisionIds) {
    const decision = project.decisions.find(
      (d) => d.id === decisionId && d.status === "approved",
    );
    if (!decision?.proposal || decision.proposal.parameters.length === 0) continue;

    const exactHumanApprovals = project.approvals.filter(
      (a: EngineeringApproval) =>
        a.decisionId === decision.id &&
        a.status === "approved" &&
        a.decidedByOrigin === "human" &&
        sameSnapshotBasis(a.baseSnapshot, basis) &&
        sameEvidenceRefs(a.inputEvidenceRefs, decision.inputEvidenceRefs) &&
        fingerprintsEqual(a.inputFingerprint, decision.inputFingerprint),
    );
    if (
      exactHumanApprovals.length === 1 &&
      sameSnapshotBasis(decision.baseSnapshot, basis) &&
      decision.inputFingerprint
    ) {
      candidates.push({ decision, proposal: decision.proposal });
    }
  }

  if (candidates.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      candidates.length === 0
        ? "No exact human-approved geometry MRTR decision is bound to this run basis."
        : "Ambiguous geometry MRTR: exactly one human-approved decision must be bound to this run basis.",
    );
  }

  const selected = candidates[0]!;
  const expectedDecisionFingerprint = await sha256Fingerprint({
    baseSnapshot: selected.decision.baseSnapshot,
    inputEvidenceRefs: selected.decision.inputEvidenceRefs,
    proposal: {
      summary: selected.proposal.summary,
      parameters: selected.proposal.parameters,
    },
  });
  if (
    !fingerprintsEqual(
      expectedDecisionFingerprint,
      selected.decision.inputFingerprint,
    )
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Geometry decision input fingerprint no longer seals its exact base snapshot, " +
        "evidence references, summary, and parameters.",
    );
  }

  // Verify run input fingerprint matches queue-time seal.
  const approvedDecisions = workItem.decisionIds.map((id) => {
    const decision = project.decisions.find((candidate) => candidate.id === id);
    if (!decision?.inputFingerprint) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Geometry work-item decision ${id} is not exactly approved.`,
      );
    }
    return { id, inputFingerprint: decision.inputFingerprint };
  });
  const expectedRunFingerprint = await sha256Fingerprint({
    workItemId: workItem.id,
    basis,
    operation: {
      id: workItem.operation!.id,
      version: workItem.operation!.version,
      bindings: workItem.operation!.bindings,
    },
    approvedDecisions,
  });
  if (!fingerprintsEqual(run.inputFingerprint, expectedRunFingerprint)) {
    throw new EngineeringProjectCommandError(
      "invalid_input",
      "Geometry run input fingerprint no longer seals its exact MRTR decision and basis.",
    );
  }
  return selected;
}

function sameSnapshotBasis(
  value:
    | EngineeringDecision["baseSnapshot"]
    | EngineeringApproval["baseSnapshot"]
    | EngineeringAgentRun["basis"],
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  if (!value || !("snapshotId" in value)) return false;
  return (
    value.snapshotId === basis.snapshotId &&
    value.revision === basis.revision &&
    value.subjectId === basis.subjectId
  );
}

function sameEvidenceRefs(
  left: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
  right: readonly {
    snapshotId: string;
    snapshotRevision: number;
    kind: string;
    id: string;
  }[],
): boolean {
  const key = (ref: typeof left[number]) =>
    `${ref.snapshotId}\u0000${ref.snapshotRevision}\u0000${ref.kind}\u0000${ref.id}`;
  return (
    left.length === right.length &&
    left.map(key).sort().every((item, index) => item === right.map(key).sort()[index])
  );
}

/**
 * Convert an `EngineeringDecisionProposal.parameters` array into a `ReadonlyMap`
 * for `parseGeometryDecisionParameters`.
 */
