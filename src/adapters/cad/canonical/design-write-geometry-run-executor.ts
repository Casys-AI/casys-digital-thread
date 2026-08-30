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
  type EngineeringProjectCommandService,
} from "../../../application/use-cases/project/engineering-project-command-service.ts";
import {
  type EngineeringProjectCommandOrigin,
} from "../../../application/ports/in/engineering-project-command-origin.ts";
import {
  type EngineeringProjectRevisionStore,
} from "../../../application/ports/out/engineering-project-revision-store.ts";
import type {
  TechnicalCompilationAdmissionReader,
} from "../../../application/ports/out/compile/admission/technical-compilation-admission-reader.ts";
import type { GeometryDraftAssetStore } from "../../../application/ports/out/cad/canonical/geometry-draft-asset-store.ts";
import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
} from "../../../domain/project/engineering-project.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import { closedRecord, exactRecord } from "../../../domain/kernel/case-validation.ts";
import {
  type GeometryPartDraftAdmission,
  requireCanonicalGeometryDraftAdmission,
  requireCanonicalGeometryPartDraftAdmission,
} from "../../../domain/cad/canonical/geometry-draft-admission.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA,
} from "../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  fingerprintTechnicalSourceText,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  selectUniqueRepresentedPartDefinition,
} from "../../../domain/compile/admission/technical-compilation-join.ts";
import {
  type AnyGeometryManifest,
  DESIGN_WRITE_GEOMETRY_OPERATION,
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryDecisionParameters,
  geometryDecisionParametersToMap,
  type GeometryManifest,
  parseGeometryDecisionParameters,
} from "../../../domain/cad/canonical/geometry-proposal.ts";
import {
  assertGeometryBundleArchitectureCoverage,
  GEOMETRY_ARCHITECTURE_CAPTURE_USE_RATIONALE,
  GEOMETRY_ARCHITECTURE_DERIVATION_RATIONALE,
  GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
  GEOMETRY_BINARY_TRACE_RATIONALE,
  GEOMETRY_PREDECESSOR_CAPTURE_USE_RATIONALE,
  GEOMETRY_PREDECESSOR_DERIVATION_RATIONALE,
  GEOMETRY_PREDECESSOR_SUPERSEDES_RATIONALE,
  GeometryBundleError,
} from "../../../domain/cad/canonical/geometry-bundle.ts";
import {
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_PART_MANIFEST_SCHEMA,
  type GeometryPartManifest,
} from "../../../domain/cad/canonical/geometry-part-manifest.ts";
import {
  type GeometryPartCapture,
  parseCanonicalGeometryCapture,
} from "../../../domain/cad/canonical/geometry-part-capture.ts";
import type {
  ContentFingerprint,
  ThreadArtifact,
  ThreadArtifactConsumption,
  ThreadEntityKind,
  ThreadFreshness,
  ThreadOperationRef,
  ThreadSnapshot,
} from "../../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../../domain/thread/thread-snapshot.ts";
import { applyThreadSnapshotExtensionIfNew } from "../../../domain/thread/thread-snapshot-extension.ts";
import { computeArchiveCascade } from "../../../domain/thread/thread-retirement.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import {
  ARCHITECTURE_CAPTURE_URI_PREFIX,
  type FileCaptureStore,
  GEOMETRY_CAPTURE_URI_PREFIX,
} from "../../shared/cas/file-capture-store.ts";
import {
  assertGeometryBundleDraftPaths,
  assertGeometryDraftAssemblyPaths,
  currentGenericGeometryDraftCaptureSchema,
  GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA,
  GEOMETRY_DRAFT_ASSETS_DIR,
  GEOMETRY_DRAFT_CAPTURE_SCHEMA,
  type GeometryBundleCanonicalSources,
  type GeometryBundleDraftCapture,
  geometryBundleManifestFromDraft,
  requireGeometryBundleCanonicalSources,
  requireGeometryBundleDraftAssetMetadata,
} from "./geometry-draft-capture.ts";
import {
  assertGeometryPartDraftPaths,
  GEOMETRY_PART_DRAFT_CAPTURE_SCHEMA,
  geometryPartDraftAssetMetadata,
  type GeometryPartDraftCapture,
  geometryPartManifestFromDraft,
} from "./geometry-part-draft-capture.ts";
import {
  requireGeometrySourceAnalysis,
} from "../source/geometry-source-analysis-capture.ts";
import type {
  GeometrySourceAnalysisReference,
} from "../../../domain/cad/source/geometry-source-analysis-reference.ts";
import { assertThreadSnapshotLineageIntact } from "../../shared/stores/thread-snapshot-lineage.ts";
import type { EngineeringProjectRunLease } from "../../shared/stores/file-engineering-project-run-lease.ts";
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
import {
  findArchitectureArtifact,
  MODEL_WRITE_ARCHITECTURE_OPERATION,
} from "../../architecture/renderer/model-write-architecture-run-executor.ts";
import {
  type ArchitectureCaptureArtifactReference as ArchitectureCaptureSource,
  parseExactArchitectureCapture,
} from "../../architecture/renderer/architecture-capture.ts";
import {
  requireCurrentArchitectureSourceAnalyses,
  type SysmlSourceAnalysisReader,
} from "../../architecture/renderer/sysml-source-analysis-capture.ts";
import type { LiveThreadUpdateMilestoneJournal } from "../../shared/stores/live-thread-update-store.ts";
import {
  GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE,
  GEOMETRY_MODULE_CHILD_USE_RATIONALE,
  GEOMETRY_MODULE_STRUCTURE_DERIVATION_RATIONALE,
  GEOMETRY_MODULE_STRUCTURE_USE_RATIONALE,
  geometryModuleAssemblyArtifacts,
  geometryModuleAssemblyGlbArtifactId,
  type GeometryModuleAssemblyOutputValidation,
  geometryModuleAssemblyStepArtifactId,
  geometryModuleBinaryProducer,
  geometryModuleCaptureRecord,
  geometryModulePrimaryInputIds,
  geometryModuleStructureAttestation,
  isGeometryModuleManifest,
  loadReviewedGeometryModuleDraft,
  promoteReopenedModuleAsset,
  requireStructureCaptureArtifact,
  type ReviewedGeometryModuleDraft,
  rollbackPromotedCanonicalAssets,
} from "./design-write-geometry-module-seal.ts";
import {
  type GeometryModuleCapture,
  type GeometryModuleManifest,
  geometryModuleManifestFromDraft,
  parseGeometryModuleCapture,
} from "../../../domain/cad/canonical/geometry-module-evidence.ts";

// ── Public constants ──────────────────────────────────────────────────────────

/**
 * Re-exported from domain so callers (tests, server wiring) can import the
 * operation ref from one canonical location without depending on geometry-proposal.ts.
 */
export { DESIGN_WRITE_GEOMETRY_OPERATION };

/** Current assembly capture: seals the exact passive analysis from the draft. */
export const GEOMETRY_CAPTURE_SCHEMA = "geometry-capture/1.2" as const;
/** Current complete-system bundle capture: seals exact N+1 sourceAnalyses. */
export const GEOMETRY_BUNDLE_CAPTURE_SCHEMA = "geometry-capture/2.1" as const;
export const GEOMETRY_CANONICAL_ASSETS_DIR = "state/local/thread-assets" as const;

interface SealedGeometrySourceAnalyses {
  readonly assembly: GeometrySourceAnalysisReference;
  readonly partDefinitions: ReadonlyArray<{
    readonly elementId: string;
    readonly analysis: GeometrySourceAnalysisReference;
  }>;
}

type GeometryCaptureSchema =
  | typeof GEOMETRY_CAPTURE_SCHEMA
  | typeof GEOMETRY_BUNDLE_CAPTURE_SCHEMA;

function isGeometryCaptureSchema(value: unknown): value is GeometryCaptureSchema {
  return value === GEOMETRY_CAPTURE_SCHEMA ||
    value === GEOMETRY_BUNDLE_CAPTURE_SCHEMA;
}

function isGeometryBundleCaptureSchema(
  value: GeometryCaptureSchema,
): boolean {
  return value === GEOMETRY_BUNDLE_CAPTURE_SCHEMA;
}

function geometryCaptureSchema(
  manifest: AnyGeometryManifest,
): GeometryCaptureSchema {
  return manifest.schemaVersion === "geometry-manifest/2.0"
    ? GEOMETRY_BUNDLE_CAPTURE_SCHEMA
    : GEOMETRY_CAPTURE_SCHEMA;
}

function geometryManifestPredecessor(
  manifest: AnyGeometryManifest,
):
  | { readonly artifactId: string; readonly fingerprint: ContentFingerprint }
  | undefined {
  if (isGeometryModuleManifest(manifest)) {
    return manifest.predecessor;
  }
  if (
    manifest.schemaVersion === "geometry-manifest/2.0" ||
    manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA
  ) {
    return (manifest as GeometryPartManifest & {
      readonly predecessor?: {
        readonly artifactId: string;
        readonly fingerprint: ContentFingerprint;
      };
    }).predecessor;
  }
  return undefined;
}

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
type AssemblyGeometryDraftManifestShape = {
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
  signed: AnyGeometryManifest | GeometryPartManifest | GeometryModuleManifest,
  draft:
    | AssemblyGeometryDraftManifestShape
    | Omit<GeometryBundleDraftCapture, "fingerprint">
    | Omit<GeometryPartDraftCapture, "fingerprint">
    | Omit<ReviewedGeometryModuleDraft["draft"], never>,
): void {
  if (isGeometryModuleManifest(signed)) {
    const reconstructed = geometryModuleManifestFromDraft(
      draft as ReviewedGeometryModuleDraft["draft"],
    );
    if (deterministicJson(signed) !== deterministicJson(reconstructed)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "geometry_module_manifest_mismatch: the signed module MRTR manifest " +
          "is not exactly the manifest reconstructed from the reviewed draft.",
      );
    }
    return;
  }
  if (signed.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA) {
    const reconstructed = geometryPartManifestFromDraft(
      draft as Omit<GeometryPartDraftCapture, "fingerprint">,
    );
    if (deterministicJson(signed) !== deterministicJson(reconstructed)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "geometry_manifest_mismatch: the signed targeted PartDefinition MRTR manifest " +
          "is not exactly the manifest reconstructed from the reviewed draft.",
      );
    }
    return;
  }
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
  const assemblyDraft = draft as AssemblyGeometryDraftManifestShape;
  const reconstructed: GeometryManifest = {
    schemaVersion: "geometry-manifest/1.0",
    architectureBasis: assemblyDraft.subject,
    components: assemblyDraft.components,
    unitSystem: "mm",
    exportFormats: assemblyDraft.exportFormats,
    scriptHash: assemblyDraft.scriptHash,
    artifactHashes: {
      assemblyFiles: assemblyDraft.assemblyFiles.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: file.fingerprint,
      })),
      partMeshes: assemblyDraft.partMeshes.map((mesh) => ({
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
  /** Read-only proof port for current SysML source-analysis evidence. */
  readonly sysmlSourceAnalysis: SysmlSourceAnalysisReader;
  /** Draft geometry JSON captures produced by the preview tool. */
  readonly geometryDraftCaptures: FileCaptureStore<"geometry-draft">;
  /** Exact native CAD source envelopes captured before preview. */
  readonly geometrySourceCaptures: FileCaptureStore<"geometry-source">;
  /** Passive source-analysis bundles captured before preview. */
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  /** Canonical geometry captures sealed by this executor. */
  readonly geometryCaptures: GeometryCaptureStore;
  /**
   * P2 target drafts retain only an admission locator. The canonical seal
   * reopens the actual `compile.seal-admission@3` evidence through this port.
   */
  readonly admissions: Pick<TechnicalCompilationAdmissionReader, "read">;
  /** Review-only asset CAS used to reopen exact module STEP/GLB draft bytes. */
  readonly moduleAssemblyDraftAssets?: GeometryDraftAssetStore;
  readonly moduleAssemblyOutputValidator?: GeometryModuleAssemblyOutputValidation;
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
  readonly #sysmlSourceAnalysis: SysmlSourceAnalysisReader;
  readonly #geometryDraftCaptures: FileCaptureStore<"geometry-draft">;
  readonly #geometrySourceCaptures: FileCaptureStore<"geometry-source">;
  readonly #sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
  readonly #geometryCaptures: GeometryCaptureStore;
  readonly #admissions: Pick<TechnicalCompilationAdmissionReader, "read">;
  readonly #moduleAssemblyDraftAssets: GeometryDraftAssetStore | undefined;
  readonly #moduleAssemblyOutputValidator:
    | GeometryModuleAssemblyOutputValidation
    | undefined;
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
    this.#sysmlSourceAnalysis = dependencies.sysmlSourceAnalysis;
    this.#geometryDraftCaptures = dependencies.geometryDraftCaptures;
    this.#geometrySourceCaptures = dependencies.geometrySourceCaptures;
    this.#sourceAnalysisCaptures = dependencies.sourceAnalysisCaptures;
    this.#geometryCaptures = dependencies.geometryCaptures;
    this.#admissions = dependencies.admissions;
    this.#moduleAssemblyDraftAssets = dependencies.moduleAssemblyDraftAssets;
    this.#moduleAssemblyOutputValidator = dependencies.moduleAssemblyOutputValidator;
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
    const stagedCanonicalPaths: string[] = [];

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
      await assertThreadWriteBasisAvailable(
        preClaim,
        requireRun(preClaim, command.runId),
      );

      const preClaimRun = requireRun(preClaim, command.runId);
      const preClaimBasis = requireBasis(preClaimRun);

      // The reviewed architecture is part of the MRTR input, so validate its
      // exact active tip, capture bytes, seed/predecessor lineage, and component
      // bindings before claiming the run. A stale or tampered architecture must
      // leave the durable project lifecycle unchanged and retryable only after
      // a newly reviewed decision.
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
        this.#sysmlSourceAnalysis,
      );
      if (isGeometryModuleManifest(params.manifest)) {
        requireStructureCaptureArtifact(
          preClaimBase,
          params.manifest.structureCapture,
        );
      }
      await requireGeometryPredecessor(
        preClaimBase,
        params,
        this.#geometryCaptures,
        {
          geometrySourceCaptures: this.#geometrySourceCaptures,
          sourceAnalysisCaptures: this.#sourceAnalysisCaptures,
        },
      );

      // Reject malformed or stale persisted drafts before the run claim is
      // recorded. Module drafts also reopen child STEP bytes and isolated
      // assembly outputs here so a mismatch leaves the run queued.
      await loadReviewedGeometryDraft(
        params,
        this.#geometryDraftCaptures,
        this.#geometrySourceCaptures,
        this.#sourceAnalysisCaptures,
        this.#draftAssetDirectory,
        {
          projectId: command.projectId,
          basis: preClaimBasis,
          admissions: this.#admissions,
          baseSnapshot: preClaimBase,
          geometryCaptures: this.#geometryCaptures,
          moduleAssemblyDraftAssets: this.#moduleAssemblyDraftAssets,
          moduleAssemblyOutputValidator: this.#moduleAssemblyOutputValidator,
          canonicalAssetDirectory: this.#canonicalAssetDirectory,
        },
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
        partDraft,
        moduleDraft,
        previewProducer,
        sourceAnalyses,
      } = await loadReviewedGeometryDraft(
        params,
        this.#geometryDraftCaptures,
        this.#geometrySourceCaptures,
        this.#sourceAnalysisCaptures,
        this.#draftAssetDirectory,
        {
          projectId: command.projectId,
          basis,
          admissions: this.#admissions,
          baseSnapshot: base,
          geometryCaptures: this.#geometryCaptures,
          moduleAssemblyDraftAssets: this.#moduleAssemblyDraftAssets,
          moduleAssemblyOutputValidator: this.#moduleAssemblyOutputValidator,
          canonicalAssetDirectory: this.#canonicalAssetDirectory,
        },
      );

      // Step 10 (D5 part 2): architecture capture load + per-component binding check.
      await assertComponentBindingsMatchArchitecture(
        params,
        base,
        architectureArtifact,
        this.#architectureCaptures,
        this.#sysmlSourceAnalysis,
      );
      const predecessor = await requireGeometryPredecessor(
        base,
        params,
        this.#geometryCaptures,
        {
          geometrySourceCaptures: this.#geometrySourceCaptures,
          sourceAnalysisCaptures: this.#sourceAnalysisCaptures,
        },
      );
      const structureArtifact = isGeometryModuleManifest(params.manifest)
        ? requireStructureCaptureArtifact(base, params.manifest.structureCapture)
        : undefined;

      // Step 11: build and durably record the canonical geometry capture before
      // any binary is published. The capture is derived only from the signed
      // decision, the verified draft record, and the verified architecture.
      const { assemblyFiles = [], partMeshes = [] } = params.manifest.artifactHashes ??
        {};
      if (!partDraft && !moduleDraft && !sourceAnalyses) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "Current generic geometry capture requires exact source analyses.",
        );
      }
      const captureRecord = moduleDraft && isGeometryModuleManifest(params.manifest)
        ? geometryModuleCaptureRecord({
          runId: run.id,
          draftDigest: params.draftDigest,
          manifest: params.manifest,
          capturedAt,
          architectureArtifact,
          draft: moduleDraft.draft,
        })
        : partDraft
        ? geometryPartCaptureRecord({
          params,
          runId: run.id,
          capturedAt,
          architectureArtifact,
          previewProducer,
          draft: partDraft,
        })
        : {
          schemaVersion: geometryCaptureSchema(params.manifest),
          operation: DESIGN_WRITE_GEOMETRY_OPERATION,
          trustedRunId: run.id,
          draftDigest: params.draftDigest,
          manifest: params.manifest,
          architectureBasis: {
            artifactId: architectureArtifact.id,
            fingerprint: architectureArtifact.fingerprint,
            producerRunId: architectureArtifact.producer.runId,
          },
          previewProducer,
          ...(bundleSources ? { sourceScripts: bundleSources } : {}),
          sourceAnalyses,
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
      if (moduleDraft) {
        const parsedModule = await parseGeometryModuleCapture(
          JSON.parse(persistedCapture),
        );
        if (deterministicJson(parsedModule) !== captureText) {
          throw new Error(
            "Geometry-module capture failed parseGeometryModuleCapture after save.",
          );
        }
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
      if (params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA) {
        for (const [fileIndex, file] of params.manifest.target.files!.entries()) {
          await promoteAssetNamedByCapture({
            captureFp,
            assetFingerprint: file.fingerprint,
            name: `PartDefinition ${params.manifest.target.partDefinitionElementId} ` +
              `${file.format}`,
            identity: {
              scope: "target-part-definition",
              elementId: params.manifest.target.partDefinitionElementId,
              fileIndex,
              format: file.format,
              name: file.name,
            },
            extension: geometryAssetExtension(file.format),
            geometryCaptures: this.#geometryCaptures,
            draftDirectory: this.#draftAssetDirectory,
            canonicalDirectory: this.#canonicalAssetDirectory,
            expectedBytes: partDraft?.target.files[fileIndex]?.bytes,
          });
        }
      }
      if (moduleDraft && isGeometryModuleManifest(params.manifest)) {
        const stepPath = await promoteReopenedModuleAsset({
          captureFp,
          assetFingerprint: moduleDraft.draft.assemblyStep.fingerprint,
          bytes: moduleDraft.assemblyStepBytes,
          extension: "step",
          geometryCaptures: this.#geometryCaptures,
          canonicalDirectory: this.#canonicalAssetDirectory,
        });
        const glbPath = await promoteReopenedModuleAsset({
          captureFp,
          assetFingerprint: moduleDraft.draft.assemblyGlb.fingerprint,
          bytes: moduleDraft.assemblyGlbBytes,
          extension: "glb",
          geometryCaptures: this.#geometryCaptures,
          canonicalDirectory: this.#canonicalAssetDirectory,
        });
        if (stepPath) stagedCanonicalPaths.push(stepPath);
        if (glbPath) stagedCanonicalPaths.push(glbPath);
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
        structureArtifact,
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
      if (!snapshotPersisted && stagedCanonicalPaths.length > 0) {
        await rollbackPromotedCanonicalAssets(stagedCanonicalPaths);
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
        (isGeometryModuleManifest(params.manifest)
          ? geometryModulePrimaryInputIds({
            architectureId: "architecture",
            structureId: "structure",
            childPrimaryIds: params.manifest.children.map((child) =>
              child.childGeometry.artifactId
            ),
            predecessorId: geometryManifestPredecessor(params.manifest)?.artifactId,
          }).length
          : (geometryManifestPredecessor(params.manifest) ? 2 : 1))
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
        this.#sysmlSourceAnalysis,
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

    const { bundleSources, partDraft, moduleDraft, previewProducer, sourceAnalyses } =
      await loadReviewedGeometryDraft(
        params,
        this.#geometryDraftCaptures,
        this.#geometrySourceCaptures,
        this.#sourceAnalysisCaptures,
        undefined,
        {
          projectId: command.projectId,
          basis,
          admissions: this.#admissions,
          baseSnapshot: baseSnapshot,
          geometryCaptures: this.#geometryCaptures,
          moduleAssemblyDraftAssets: this.#moduleAssemblyDraftAssets,
          moduleAssemblyOutputValidator: this.#moduleAssemblyOutputValidator,
          canonicalAssetDirectory: this.#canonicalAssetDirectory,
        },
      );
    const capturedAt = requiredStart(run);
    if (!partDraft && !moduleDraft && !sourceAnalyses) {
      throw completedGeometryIntegrityError(
        "the primary capture is missing exact source analyses",
      );
    }
    const expectedCapture = moduleDraft && isGeometryModuleManifest(params.manifest)
      ? geometryModuleCaptureRecord({
        runId: run.id,
        draftDigest: params.draftDigest,
        manifest: params.manifest,
        capturedAt,
        architectureArtifact,
        draft: moduleDraft.draft,
      })
      : partDraft
      ? geometryPartCaptureRecord({
        params,
        runId: run.id,
        capturedAt,
        architectureArtifact,
        previewProducer,
        draft: partDraft,
      })
      : {
        schemaVersion: geometryCaptureSchema(params.manifest),
        operation: DESIGN_WRITE_GEOMETRY_OPERATION,
        trustedRunId: run.id,
        draftDigest: params.draftDigest,
        manifest: params.manifest,
        architectureBasis: {
          artifactId: architectureArtifact.id,
          fingerprint: architectureArtifact.fingerprint,
          producerRunId: architectureArtifact.producer.runId,
        },
        previewProducer,
        ...(bundleSources ? { sourceScripts: bundleSources } : {}),
        sourceAnalyses,
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

    let predecessor: GeometryPredecessorContext | undefined;
    let structureArtifact: ThreadArtifact | undefined;
    try {
      if (isGeometryModuleManifest(params.manifest)) {
        structureArtifact = requireStructureCaptureArtifact(
          baseSnapshot,
          params.manifest.structureCapture,
        );
        if (primary.inputArtifactIds[1] !== structureArtifact.id) {
          throw new Error(
            "primary artifact does not name the reviewed structure basis",
          );
        }
      }
      predecessor = await requireGeometryPredecessor(
        baseSnapshot,
        params,
        this.#geometryCaptures,
        {
          geometrySourceCaptures: this.#geometrySourceCaptures,
          sourceAnalysisCaptures: this.#sourceAnalysisCaptures,
        },
      );
      const expectedInputs = isGeometryModuleManifest(params.manifest)
        ? geometryModulePrimaryInputIds({
          architectureId: architectureArtifact.id,
          structureId: structureArtifact!.id,
          childPrimaryIds: params.manifest.children.map((child) =>
            child.childGeometry.artifactId
          ),
          predecessorId: predecessor?.artifact.id,
        })
        : [
          architectureArtifact.id,
          ...(predecessor ? [predecessor.artifact.id] : []),
        ];
      if (
        deterministicJson(primary.inputArtifactIds) !==
          deterministicJson(expectedInputs)
      ) {
        throw new Error(
          "primary artifact does not name its exact reviewed inputs",
        );
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
      structureArtifact,
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
    if (params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA) {
      for (const file of params.manifest.target.files!) {
        await assertCanonicalGeometryAssetExact(
          file.fingerprint,
          geometryAssetExtension(file.format),
          this.#canonicalAssetDirectory,
        );
      }
    }
    if (isGeometryModuleManifest(params.manifest) && params.manifest.assembly) {
      await assertCanonicalGeometryAssetExact(
        params.manifest.assembly.step.fingerprint,
        "step",
        this.#canonicalAssetDirectory,
      );
      await assertCanonicalGeometryAssetExact(
        params.manifest.assembly.glb.fingerprint,
        "glb",
        this.#canonicalAssetDirectory,
      );
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
  requireGeometryPredecessor,
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
  sysmlSourceAnalysis: SysmlSourceAnalysisReader,
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
  const recomputed = await sha256Fingerprint(parsed);
  if (!fingerprintsEqual(recomputed, architectureArtifact.fingerprint)) {
    invalidArchitectureCapture(
      "capture fingerprint does not match the architecture artifact",
    );
  }
  let capture: ReturnType<typeof parseExactArchitectureCapture>;
  try {
    capture = parseExactArchitectureCapture(parsed);
    if (deterministicJson(capture) !== captureText) {
      throw new Error("architecture capture is not canonical JSON");
    }
  } catch (error) {
    invalidArchitectureCapture(
      error instanceof Error ? error.message : String(error),
    );
  }
  if (capture.trustedRunId !== architectureArtifact.producer.runId) {
    invalidArchitectureCapture(
      "trustedRunId does not match the architecture artifact producer",
    );
  }
  try {
    await requireCurrentArchitectureSourceAnalyses(
      capture.sourceAnalyses,
      sysmlSourceAnalysis,
      {
        runId: architectureArtifact.producer.runId,
        operation: MODEL_WRITE_ARCHITECTURE_OPERATION,
        packageName: capture.packageName,
      },
    );
  } catch (error) {
    invalidArchitectureCapture(
      `current source-analysis evidence is not exact: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  assertArchitectureCaptureLineageExact(
    base,
    architectureArtifact,
    capture.seed,
    capture.predecessor,
    capture.insertedAt,
  );
  const definitions = capture.partDefinitions;
  const allUsages = new Map<
    string,
    { readonly label: string; readonly targetId: string }
  >();
  for (const definition of definitions) {
    for (const usage of definition.usages) {
      allUsages.set(usage.id, { label: usage.label, targetId: usage.targetId });
    }
  }

  if (isGeometryModuleManifest(params.manifest)) {
    const moduleManifest: GeometryModuleManifest = params.manifest;
    const matches = definitions.filter((definition) =>
      definition.id === moduleManifest.target.partDefinitionElementId
    );
    if (matches.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: module PartDefinition elementId "${moduleManifest.target.partDefinitionElementId}" is not uniquely present in the architecture capture.`,
      );
    }
    if (matches[0]!.label !== moduleManifest.target.label) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: module PartDefinition elementId "${moduleManifest.target.partDefinitionElementId}" has label "${
          matches[0]!.label
        }" in the architecture capture, not ` +
          `"${moduleManifest.target.label}" from the signed module draft.`,
      );
    }
    const targetUsages = new Map(
      matches[0]!.usages.map((usage) => [usage.id, usage]),
    );
    for (const child of moduleManifest.children) {
      const usage = targetUsages.get(child.usageElementId);
      if (
        usage === undefined ||
        usage.targetId !== child.partDefinitionElementId
      ) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `D5 violation: module child usage "${child.usageElementId}" is not an immediate usage of the signed composite PartDefinition.`,
        );
      }
    }
    if (moduleManifest.children.length !== targetUsages.size) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "D5 violation: signed geometry-module children do not equal the complete set of immediate PartUsage under the target PartDefinition.",
      );
    }
    return;
  }

  if (params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA) {
    const targetManifest = params.manifest as GeometryPartManifest;
    const matches = definitions.filter((definition) =>
      definition.id === targetManifest.target.partDefinitionElementId
    );
    if (matches.length !== 1) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: target PartDefinition elementId "${targetManifest.target.partDefinitionElementId}" is not uniquely present in the architecture capture.`,
      );
    }
    if (matches[0]!.label !== params.manifest.target.label) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `D5 violation: target PartDefinition elementId "${params.manifest.target.partDefinitionElementId}" has label "${
          matches[0]!.label
        }" in the architecture capture, not ` +
          `"${targetManifest.target.label}" from the signed target draft.`,
      );
    }
    return;
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
    try {
      assertGeometryBundleArchitectureCoverage(params.manifest, {
        partDefinitions: definitions.map((definition) => ({
          id: definition.id,
          label: definition.label,
          usages: definition.usages.map((usage) => ({
            id: usage.id,
            label: usage.label,
            targetId: usage.targetId,
          })),
        })),
      });
    } catch (error) {
      if (error instanceof GeometryBundleError) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `D5 violation: ${error.message}`,
        );
      }
      throw error;
    }
  }
}

function invalidArchitectureCapture(detail: string): never {
  throw new EngineeringProjectCommandError(
    "invalid_transition",
    `D5 violation: architecture capture is not exact v2/v3 evidence: ${detail}.`,
  );
}

interface GeometryBundlePredecessorContext {
  readonly artifact: ThreadArtifact;
  readonly archiveEntries: ReturnType<typeof computeArchiveCascade>;
}

/** A target chain has the same thread mechanics but never shares a V2 family. */
interface GeometryPartPredecessorContext {
  readonly artifact: ThreadArtifact;
  readonly archiveEntries: ReturnType<typeof computeArchiveCascade>;
}

type GeometryPredecessorContext =
  | GeometryBundlePredecessorContext
  | GeometryPartPredecessorContext;

interface GeometrySourceAnalysisStores {
  readonly geometrySourceCaptures: FileCaptureStore<"geometry-source">;
  readonly sourceAnalysisCaptures: FileCaptureStore<"source-analysis">;
}

/** Dispatch by signed manifest family; assembly and bundle resolution stay distinct. */
async function requireGeometryPredecessor(
  base: ThreadSnapshot,
  params: GeometryDecisionParameters,
  geometryCaptures: GeometryCaptureStore,
  sourceAnalysisStores?: GeometrySourceAnalysisStores,
): Promise<GeometryPredecessorContext | undefined> {
  if (
    isGeometryModuleManifest(params.manifest) ||
    params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA
  ) {
    return await requireGeometryTargetPredecessor(
      base,
      params.manifest,
      geometryCaptures,
      sourceAnalysisStores,
    );
  }
  return await requireGeometryBundlePredecessor(
    base,
    params,
    geometryCaptures,
    sourceAnalysisStores,
  );
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
  sourceAnalysisStores?: GeometrySourceAnalysisStores,
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
    sourceAnalysisStores,
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

/**
 * Resolve only the active chain for the signed PartDefinition.  Other target
 * captures are intentionally not predecessors and remain active.  A V2
 * capture is a complete assembly family, so an active V2 which already covers
 * the target is a hard conflict rather than something a target seal may
 * partially retire.
 */
async function requireGeometryTargetPredecessor(
  base: ThreadSnapshot,
  manifest: GeometryPartManifest | GeometryModuleManifest,
  geometryCaptures: GeometryCaptureStore,
  sourceAnalysisStores?: GeometrySourceAnalysisStores,
): Promise<GeometryPartPredecessorContext | undefined> {
  const archived = archivedRefKeys(base);
  const active = base.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  const candidates: Array<
    | {
      readonly family: "part";
      readonly artifact: ThreadArtifact;
      readonly capture: ExactGeometryPartPredecessorCapture;
    }
    | {
      readonly family: "module";
      readonly artifact: ThreadArtifact;
      readonly capture: GeometryModuleCapture;
    }
  > = [];

  for (const artifact of active) {
    assertCanonicalGeometryPrimaryIdentity(artifact);
    const record = await readExactGeometryCaptureRecord(artifact, geometryCaptures);
    if (record.schemaVersion === GEOMETRY_PART_CAPTURE_SCHEMA) {
      const capture = await requireExactGeometryPartPredecessorCapture(
        base,
        artifact,
        record,
        sourceAnalysisStores,
      );
      if (
        capture.manifest.target.partDefinitionElementId ===
          manifest.target.partDefinitionElementId
      ) {
        if (capture.manifest.target.label !== manifest.target.label) {
          invalidGeometryPredecessor(
            "an active target capture has the same PartDefinition elementId but a different label",
          );
        }
        candidates.push({ family: "part", artifact, capture });
      }
      continue;
    }
    if (record.schemaVersion === GEOMETRY_MODULE_CAPTURE_SCHEMA) {
      const capture = await requireExactGeometryModulePredecessorCapture(
        base,
        artifact,
        record,
      );
      if (
        capture.manifest.target.partDefinitionElementId ===
          manifest.target.partDefinitionElementId
      ) {
        if (capture.manifest.target.label !== manifest.target.label) {
          invalidGeometryPredecessor(
            "an active module capture has the same PartDefinition elementId but a different label",
          );
        }
        candidates.push({ family: "module", artifact, capture });
      }
      continue;
    }
    if (isGeometryCaptureSchema(record.schemaVersion)) {
      const capture = await requireExactGeometryPredecessorCapture(
        base,
        artifact,
        record,
        sourceAnalysisStores,
      );
      if (capture.params.manifest.schemaVersion === "geometry-manifest/2.0") {
        const covered = capture.params.manifest.partDefinitions.find((definition) =>
          definition.elementId === manifest.target.partDefinitionElementId
        );
        if (covered) {
          if (covered.label !== manifest.target.label) {
            invalidGeometryPredecessor(
              "active V2 geometry covers the target PartDefinition with a different label",
            );
          }
          throw new EngineeringProjectCommandError(
            "invalid_transition",
            "geometry_part_v2_bundle_conflict: an active V2 canonical geometry bundle already covers this exact PartDefinition; it cannot be partially archived.",
          );
        }
      }
      // V1 and a V2 that does not cover this exact target remain historical
      // context, not target-chain predecessors.
      continue;
    }
    invalidGeometryPredecessor(
      "active canonical geometry capture has an unsupported schema",
    );
  }

  if (candidates.length > 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "geometry_target_tip_ambiguous: more than one active canonical leaf/module capture exists for the exact PartDefinition.",
    );
  }
  const candidate = candidates[0];
  const declared = manifest.predecessor;
  if (!candidate) {
    if (declared) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "geometry_target_predecessor_mismatch: the signed same-target predecessor is not active.",
      );
    }
    return undefined;
  }
  const candidateSchema = candidate.family === "part"
    ? GEOMETRY_PART_CAPTURE_SCHEMA
    : GEOMETRY_MODULE_CAPTURE_SCHEMA;
  if (
    !declared || declared.artifactId !== candidate.artifact.id ||
    !fingerprintsEqual(declared.fingerprint, candidate.artifact.fingerprint) ||
    declared.schemaVersion !== candidateSchema ||
    declared.partDefinitionElementId !== manifest.target.partDefinitionElementId
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `geometry_target_predecessor_mismatch: target ${manifest.target.partDefinitionElementId} must name its active canonical leaf/module predecessor exactly.`,
    );
  }
  const family = candidate.family === "part"
    ? requireExactGeometryPartPredecessorFamily(
      base,
      candidate.artifact,
      candidate.capture,
    )
    : requireExactGeometryModulePredecessorFamily(
      base,
      candidate.artifact,
      candidate.capture,
    );
  const archiveEntries = computeArchiveCascade(
    base,
    family.map((artifact) => ({ kind: "artifact" as const, id: artifact.id })),
  );
  return { artifact: candidate.artifact, archiveEntries };
}

function assertCanonicalGeometryPrimaryIdentity(artifact: ThreadArtifact): void {
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
    invalidGeometryPredecessor("active geometry artifact identity is not canonical");
  }
}

async function readExactGeometryCaptureRecord(
  artifact: ThreadArtifact,
  geometryCaptures: GeometryCaptureStore,
): Promise<Record<string, unknown>> {
  const captureText = await geometryCaptures.read(artifact.fingerprint);
  if (!captureText) {
    invalidGeometryPredecessor("active geometry capture is not durably readable");
  }
  let record: unknown;
  try {
    record = JSON.parse(captureText);
  } catch {
    invalidGeometryPredecessor("active geometry capture is invalid JSON");
  }
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    invalidGeometryPredecessor("active geometry capture is not an object");
  }
  const observed = await sha256Fingerprint(record);
  if (!fingerprintsEqual(observed, artifact.fingerprint)) {
    invalidGeometryPredecessor("active geometry capture hash is not exact");
  }
  return record as Record<string, unknown>;
}

interface ExactGeometryPartPredecessorCapture {
  readonly manifest: GeometryPartManifest;
  readonly previewProducer: ThreadOperationRef;
  readonly sealedAt: string;
}

/** Strictly re-prove the target capture before it becomes a same-target input. */
async function requireExactGeometryPartPredecessorCapture(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  record: Record<string, unknown>,
  sourceAnalysisStores?: GeometrySourceAnalysisStores,
): Promise<ExactGeometryPartPredecessorCapture> {
  let capture: GeometryPartCapture;
  try {
    const parsed = await parseCanonicalGeometryCapture(record);
    if (parsed.schemaVersion !== GEOMETRY_PART_CAPTURE_SCHEMA) {
      invalidGeometryPredecessor("target capture schema is unsupported");
    }
    capture = parsed;
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    invalidGeometryPredecessor(
      `target capture is incomplete or invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (capture.trustedRunId !== primary.producer.runId) {
    invalidGeometryPredecessor(
      "target capture trusted run does not match the artifact producer",
    );
  }
  const { manifest } = capture;
  const architectureId = capture.architectureBasis.artifactId;
  const architectureFingerprint = capture.architectureBasis.fingerprint;
  const architectureProducerRunId = capture.architectureBasis.producerRunId;
  const architecture = base.artifacts.filter((artifact) =>
    artifact.id === architectureId &&
    fingerprintsEqual(artifact.fingerprint, architectureFingerprint) &&
    artifact.producer.runId === architectureProducerRunId
  );
  if (
    architecture.length !== 1 ||
    !fingerprintsEqual(
      manifest.architectureBasis.artifactFingerprint,
      architectureFingerprint,
    )
  ) {
    invalidGeometryPredecessor("target architecture basis is absent or inexact");
  }
  const expectedInputs = [
    architectureId,
    ...(manifest.predecessor ? [manifest.predecessor.artifactId] : []),
  ];
  if (
    deterministicJson(primary.inputArtifactIds) !== deterministicJson(expectedInputs)
  ) {
    invalidGeometryPredecessor(
      "target artifact inputs do not match the sealed manifest",
    );
  }
  let ownPredecessor: ThreadArtifact | undefined;
  if (manifest.predecessor) {
    const matches = base.artifacts.filter((artifact) =>
      artifact.id === manifest.predecessor!.artifactId &&
      fingerprintsEqual(artifact.fingerprint, manifest.predecessor!.fingerprint)
    );
    if (
      matches.length !== 1 ||
      !archivedRefKeys(base).has(`artifact:${manifest.predecessor.artifactId}`)
    ) {
      invalidGeometryPredecessor(
        "target capture own predecessor is absent, active, or inexact",
      );
    }
    ownPredecessor = matches[0]!;
  }
  const previewProducer = capture.previewProducer;
  const sealedAt = capture.sealedAt;
  requireExactGeometryPredecessorArchitectureAttestation(
    base,
    primary,
    architecture[0]!,
    sealedAt,
  );
  if (ownPredecessor) {
    requireExactGeometryPredecessorLineage(base, primary, ownPredecessor, sealedAt);
  }
  if (
    primary.freshness.status !== "fresh" ||
    primary.freshness.changedAt !== sealedAt ||
    primary.freshness.invalidatedByChangeIds.length !== 0
  ) {
    invalidGeometryPredecessor("target artifact freshness does not match sealedAt");
  }

  const targetId = capture.sourceScript.partDefinitionElementId;
  const scriptHash = capture.sourceScript.scriptHash;
  if (!sourceAnalysisStores) {
    invalidGeometryPredecessor(
      "source-analysis stores are unavailable for target capture",
    );
  }
  try {
    const verified = await requireGeometrySourceAnalysis(capture.sourceAnalysis, {
      sourceCaptures: sourceAnalysisStores.geometrySourceCaptures,
      analysisCaptures: sourceAnalysisStores.sourceAnalysisCaptures,
    });
    if (
      verified.reference.selector.kind !== "part-definition" ||
      verified.reference.selector.elementId !== targetId ||
      !fingerprintsEqual(verified.reference.sourceFingerprint, scriptHash)
    ) {
      invalidGeometryPredecessor("target source analysis is not exact");
    }
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    invalidGeometryPredecessor(
      `target source analysis is invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { manifest, previewProducer, sealedAt };
}

/** Re-prove a module capture and every Thread basis it claims before succession. */
async function requireExactGeometryModulePredecessorCapture(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  record: Record<string, unknown>,
): Promise<GeometryModuleCapture> {
  let capture: GeometryModuleCapture;
  try {
    const parsed = await parseCanonicalGeometryCapture(record);
    if (parsed.schemaVersion !== GEOMETRY_MODULE_CAPTURE_SCHEMA) {
      invalidGeometryPredecessor("module target capture schema is unsupported");
    }
    capture = parsed;
  } catch (error) {
    if (error instanceof EngineeringProjectCommandError) throw error;
    invalidGeometryPredecessor(
      `module target capture is incomplete or invalid: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (capture.trustedRunId !== primary.producer.runId) {
    invalidGeometryPredecessor(
      "module target trusted run does not match the artifact producer",
    );
  }
  const architecture = base.artifacts.filter((artifact) =>
    artifact.id === capture.architectureBasis.artifactId &&
    fingerprintsEqual(
      artifact.fingerprint,
      capture.architectureBasis.fingerprint,
    ) &&
    artifact.producer.runId === capture.architectureBasis.producerRunId
  );
  if (architecture.length !== 1) {
    invalidGeometryPredecessor(
      "module target architecture basis is absent or inexact",
    );
  }
  const structure = requireStructureCaptureArtifact(
    base,
    capture.structureCapture,
  );
  const childPrimaryIds = [
    ...new Set(
      capture.children.map((child) => child.childGeometry.artifactId),
    ),
  ];
  const archived = archivedRefKeys(base);
  const childArtifacts: ThreadArtifact[] = [];
  for (const childId of childPrimaryIds) {
    const child = capture.children.find((candidate) =>
      candidate.childGeometry.artifactId === childId
    )!;
    const matches = base.artifacts.filter((artifact) =>
      artifact.id === child.childGeometry.artifactId &&
      fingerprintsEqual(artifact.fingerprint, child.childGeometry.fingerprint)
    );
    if (
      matches.length !== 1 ||
      archived.has(`artifact:${child.childGeometry.artifactId}`)
    ) {
      invalidGeometryPredecessor(
        `module target child ${child.childGeometry.artifactId} is absent, archived, or inexact`,
      );
    }
    childArtifacts.push(matches[0]!);
  }
  const expectedInputs = geometryModulePrimaryInputIds({
    architectureId: architecture[0]!.id,
    structureId: structure.id,
    childPrimaryIds,
    predecessorId: capture.predecessor?.artifactId,
  });
  if (
    deterministicJson(primary.inputArtifactIds) !== deterministicJson(expectedInputs)
  ) {
    invalidGeometryPredecessor(
      "module target inputs do not match architecture, structure, children and predecessor",
    );
  }
  let ownPredecessor: ThreadArtifact | undefined;
  if (capture.predecessor) {
    const matches = base.artifacts.filter((artifact) =>
      artifact.id === capture.predecessor!.artifactId &&
      fingerprintsEqual(artifact.fingerprint, capture.predecessor!.fingerprint)
    );
    if (
      matches.length !== 1 ||
      !archived.has(`artifact:${capture.predecessor.artifactId}`)
    ) {
      invalidGeometryPredecessor(
        "module target own predecessor is absent, active, or inexact",
      );
    }
    ownPredecessor = matches[0]!;
  }
  requireExactGeometryPredecessorArchitectureAttestation(
    base,
    primary,
    architecture[0]!,
    capture.sealedAt,
  );
  requireExactGeometryModuleStructureAttestation(
    base,
    primary,
    structure,
    capture.sealedAt,
  );
  for (const child of childArtifacts) {
    const consumptionId = `consume-child-${child.id}-by-${primary.id}`;
    const consumption = base.consumptions.filter((item) =>
      item.id === consumptionId && item.artifactId === child.id &&
      deterministicJson(item.consumer) === deterministicJson(primary.producer) &&
      fingerprintsEqual(item.observedFingerprint, child.fingerprint) &&
      item.status === "verified" && item.verifiedAt === capture.sealedAt
    );
    const derived = base.provenance.filter((link) =>
      link.id ===
        `derived-from-child-${primary.fingerprint.digest}-${child.fingerprint.digest}` &&
      link.relation === "derived_from" && link.from.kind === "artifact" &&
      link.from.id === primary.id && link.to.kind === "artifact" &&
      link.to.id === child.id &&
      link.rationale === GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE
    );
    const uses = base.provenance.filter((link) =>
      link.id === `uses-${consumptionId}` && link.relation === "uses" &&
      link.from.kind === "consumption" && link.from.id === consumptionId &&
      link.to.kind === "artifact" && link.to.id === child.id &&
      link.rationale === GEOMETRY_MODULE_CHILD_USE_RATIONALE
    );
    if (consumption.length !== 1 || derived.length !== 1 || uses.length !== 1) {
      invalidGeometryPredecessor(
        `module target child ${child.id} lineage is not exact`,
      );
    }
  }
  if (ownPredecessor) {
    requireExactGeometryPredecessorLineage(
      base,
      primary,
      ownPredecessor,
      capture.sealedAt,
    );
  }
  if (
    primary.freshness.status !== "fresh" ||
    primary.freshness.changedAt !== capture.sealedAt ||
    primary.freshness.invalidatedByChangeIds.length !== 0
  ) {
    invalidGeometryPredecessor(
      "module target freshness does not match sealedAt",
    );
  }
  return capture;
}

/** The target family is exactly primary plus its indexed target files. */
function requireExactGeometryPartPredecessorFamily(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  capture: ExactGeometryPartPredecessorCapture,
): readonly ThreadArtifact[] {
  const digest = primary.fingerprint.digest;
  const archived = archivedRefKeys(base);
  const expected = capture.manifest.target.files!.map((file, index) => ({
    id: `cad-asset-${digest}-target-${index}-${file.fingerprint.digest}`,
    name: `${
      file.format === "step" ? "Authoritative STEP" : file.format.toUpperCase()
    }: ${capture.manifest.target.label}`,
    kind:
      (file.format === "step"
        ? "step"
        : file.format === "stl"
        ? "mesh"
        : "cad-model") as ThreadArtifact["kind"],
    fingerprint: file.fingerprint,
    uri: `/api/thread/assets/${file.fingerprint.digest}.${
      geometryAssetExtension(file.format)
    }`,
    mediaType: geometryAssetMediaType(file.format),
  }));
  const family = base.artifacts.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`) &&
    (artifact.id === primary.id || artifact.id.startsWith(`cad-asset-${digest}-`) ||
      artifact.id.startsWith(`mesh-${digest}-`))
  );
  if (family.length !== expected.length + 1) {
    invalidGeometryPredecessor(
      "target binary family is incomplete or makes an assembly/extra-asset claim",
    );
  }
  const binaryProducer = capture.previewProducer;
  for (const descriptor of expected) {
    const artifact = family.find((candidate) => candidate.id === descriptor.id);
    if (
      !artifact || artifact.name !== descriptor.name ||
      artifact.kind !== descriptor.kind ||
      artifact.version !== descriptor.fingerprint.digest ||
      !fingerprintsEqual(artifact.fingerprint, descriptor.fingerprint) ||
      artifact.uri !== descriptor.uri || artifact.mediaType !== descriptor.mediaType ||
      deterministicJson(artifact.producer) !== deterministicJson(binaryProducer) ||
      deterministicJson(artifact.inputArtifactIds) !== deterministicJson([]) ||
      artifact.freshness.status !== "fresh" ||
      artifact.freshness.changedAt !== capture.sealedAt ||
      artifact.freshness.invalidatedByChangeIds.length !== 0
    ) {
      invalidGeometryPredecessor(
        `target binary artifact ${descriptor.id} metadata is not exact`,
      );
    }
    const consumptionId = `consume-${primary.id}-by-${artifact.id}`;
    const trace = base.provenance.find((link) =>
      link.id === `traces-${artifact.id}-from-${primary.id}` &&
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.from.id === artifact.id && link.to.kind === "artifact" &&
      link.to.id === primary.id && link.rationale === GEOMETRY_BINARY_TRACE_RATIONALE
    );
    const consumption = base.consumptions.find((item) =>
      item.id === consumptionId && item.artifactId === primary.id &&
      deterministicJson(item.consumer) === deterministicJson(primary.producer) &&
      fingerprintsEqual(item.observedFingerprint, primary.fingerprint) &&
      item.status === "verified" && item.verifiedAt === capture.sealedAt
    );
    const uses = base.provenance.find((link) =>
      link.id === `uses-${consumptionId}` && link.relation === "uses" &&
      link.from.kind === "consumption" && link.from.id === consumptionId &&
      link.to.kind === "artifact" && link.to.id === primary.id &&
      link.rationale === GEOMETRY_BINARY_CAPTURE_USE_RATIONALE
    );
    if (!trace || !consumption || !uses) {
      invalidGeometryPredecessor(
        `target binary artifact ${descriptor.id} trace or consumption is not exact`,
      );
    }
  }
  return family;
}

/** A module family is indivisible: primary plus its exact STEP and GLB. */
function requireExactGeometryModulePredecessorFamily(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  capture: GeometryModuleCapture,
): readonly ThreadArtifact[] {
  const digest = primary.fingerprint.digest;
  const archived = archivedRefKeys(base);
  const producer = geometryModuleBinaryProducer(capture.receipt);
  const descriptors: ReadonlyArray<{
    readonly id: string;
    readonly name: string;
    readonly kind: ThreadArtifact["kind"];
    readonly fingerprint: ContentFingerprint;
    readonly uri: string;
    readonly mediaType: string;
  }> = [{
    id: geometryModuleAssemblyStepArtifactId(
      digest,
      capture.assemblyStep.fingerprint.digest,
    ),
    name: `Authoritative STEP: ${capture.manifest.target.label}`,
    kind: "step",
    fingerprint: capture.assemblyStep.fingerprint,
    uri: `/api/thread/assets/${capture.assemblyStep.fingerprint.digest}.step`,
    mediaType: "model/step",
  }, {
    id: geometryModuleAssemblyGlbArtifactId(
      digest,
      capture.assemblyGlb.fingerprint.digest,
    ),
    name: `GLB: ${capture.manifest.target.label}`,
    kind: "cad-model",
    fingerprint: capture.assemblyGlb.fingerprint,
    uri: `/api/thread/assets/${capture.assemblyGlb.fingerprint.digest}.glb`,
    mediaType: "model/gltf-binary",
  }];
  const family = base.artifacts.filter((artifact) =>
    !archived.has(`artifact:${artifact.id}`) &&
    (artifact.id === primary.id ||
      artifact.id.startsWith(`cad-asset-${digest}-module-`))
  );
  if (family.length !== descriptors.length + 1) {
    invalidGeometryPredecessor(
      "module target binary family is incomplete or contains extra assets",
    );
  }
  for (const descriptor of descriptors) {
    const artifact = family.find((candidate) => candidate.id === descriptor.id);
    if (
      !artifact || artifact.name !== descriptor.name ||
      artifact.kind !== descriptor.kind ||
      artifact.version !== descriptor.fingerprint.digest ||
      !fingerprintsEqual(artifact.fingerprint, descriptor.fingerprint) ||
      artifact.uri !== descriptor.uri ||
      artifact.mediaType !== descriptor.mediaType ||
      deterministicJson(artifact.producer) !== deterministicJson(producer) ||
      deterministicJson(artifact.inputArtifactIds) !==
        deterministicJson([primary.id]) ||
      artifact.freshness.status !== "fresh" ||
      artifact.freshness.changedAt !== capture.sealedAt ||
      artifact.freshness.invalidatedByChangeIds.length !== 0
    ) {
      invalidGeometryPredecessor(
        `module target binary artifact ${descriptor.id} metadata is not exact`,
      );
    }
    const consumptionId = `consume-${primary.id}-by-${artifact.id}`;
    const trace = base.provenance.find((link) =>
      link.id === `traces-${artifact.id}-from-${primary.id}` &&
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.from.id === artifact.id && link.to.kind === "artifact" &&
      link.to.id === primary.id &&
      link.rationale === GEOMETRY_BINARY_TRACE_RATIONALE
    );
    const consumption = base.consumptions.find((item) =>
      item.id === consumptionId && item.artifactId === primary.id &&
      deterministicJson(item.consumer) === deterministicJson(artifact.producer) &&
      fingerprintsEqual(item.observedFingerprint, primary.fingerprint) &&
      item.status === "verified" && item.verifiedAt === capture.sealedAt
    );
    const derived = base.provenance.find((link) =>
      link.id === `derived-from-module-primary-${artifact.id}` &&
      link.relation === "derived_from" && link.from.kind === "artifact" &&
      link.from.id === artifact.id && link.to.kind === "artifact" &&
      link.to.id === primary.id &&
      link.rationale === GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE
    );
    const uses = base.provenance.find((link) =>
      link.id === `uses-${consumptionId}` && link.relation === "uses" &&
      link.from.kind === "consumption" && link.from.id === consumptionId &&
      link.to.kind === "artifact" && link.to.id === primary.id &&
      link.rationale === GEOMETRY_BINARY_CAPTURE_USE_RATIONALE
    );
    if (!trace || !consumption || !derived || !uses) {
      invalidGeometryPredecessor(
        `module target binary artifact ${descriptor.id} trace or consumption is not exact`,
      );
    }
  }
  return family;
}

interface ExactGeometryPredecessorCapture {
  readonly params: GeometryDecisionParameters;
  readonly previewProducer: ThreadOperationRef;
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
  sourceAnalysisStores?: GeometrySourceAnalysisStores,
): Promise<ExactGeometryPredecessorCapture> {
  const schema = record.schemaVersion;
  if (!isGeometryCaptureSchema(schema)) {
    invalidGeometryPredecessor("capture schema is unsupported");
  }
  const bundleSchema = isGeometryBundleCaptureSchema(schema);
  exactGeometryPredecessorKeys(
    record,
    [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "previewProducer",
      ...(bundleSchema ? ["sourceScripts"] : []),
      "sourceAnalyses",
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
    (!bundleSchema &&
      params.manifest.schemaVersion !== GEOMETRY_MANIFEST_SCHEMA) ||
    (bundleSchema &&
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
  if (bundleSchema) {
    await requireExactGeometryBundleSources(
      record.sourceScripts,
      params.manifest as Extract<
        AnyGeometryManifest,
        { readonly schemaVersion: "geometry-manifest/2.0" }
      >,
    );
  }
  if (!sourceAnalysisStores) {
    invalidGeometryPredecessor(
      "source-analysis stores are unavailable for a current capture",
    );
  }
  await requireCanonicalGeometrySourceAnalyses(
    record.sourceAnalyses,
    params,
    sourceAnalysisStores,
  );
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

function requireExactGeometryModuleStructureAttestation(
  base: ThreadSnapshot,
  primary: ThreadArtifact,
  structure: ThreadArtifact,
  sealedAt: string,
): void {
  const consumptionId = `consume-structure-${structure.id}-by-${primary.id}`;
  const consumptions = base.consumptions.filter((consumption) =>
    consumption.id === consumptionId && consumption.artifactId === structure.id &&
    deterministicJson(consumption.consumer) === deterministicJson(primary.producer)
  );
  if (
    consumptions.length !== 1 ||
    !fingerprintsEqual(
      consumptions[0]!.observedFingerprint,
      structure.fingerprint,
    ) ||
    consumptions[0]!.status !== "verified" ||
    consumptions[0]!.verifiedAt !== sealedAt
  ) {
    invalidGeometryPredecessor(
      "module structure consumption metadata is not exact",
    );
  }
  const derived = base.provenance.filter((link) =>
    link.id === `derived-from-structure-${primary.fingerprint.digest}` &&
    link.relation === "derived_from" && link.from.kind === "artifact" &&
    link.from.id === primary.id && link.to.kind === "artifact" &&
    link.to.id === structure.id &&
    link.rationale === GEOMETRY_MODULE_STRUCTURE_DERIVATION_RATIONALE
  );
  const uses = base.provenance.filter((link) =>
    link.id === `uses-${consumptionId}` && link.relation === "uses" &&
    link.from.kind === "consumption" && link.from.id === consumptionId &&
    link.to.kind === "artifact" && link.to.id === structure.id &&
    link.rationale === GEOMETRY_MODULE_STRUCTURE_USE_RATIONALE
  );
  if (derived.length !== 1 || uses.length !== 1) {
    invalidGeometryPredecessor(
      "module structure derivation or use attestation is not exact",
    );
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
  previewProducer: ThreadOperationRef,
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
      deterministicJson(artifact.producer) !== deterministicJson(previewProducer) ||
      deterministicJson(artifact.inputArtifactIds) !== deterministicJson([]) ||
      artifact.freshness.status !== "fresh" ||
      artifact.freshness.changedAt !== sealedAt ||
      artifact.freshness.invalidatedByChangeIds.length !== 0
    ) {
      invalidGeometryPredecessor(`binary artifact ${id} metadata is not exact`);
    }
    const captureLinks = base.provenance.filter((link) =>
      link.relation === "traces_to" && link.from.kind === "artifact" &&
      link.from.id === id && link.to.kind === "artifact" &&
      link.to.id === primary.id
    );
    const expectedCaptureLinkId = `traces-${id}-from-${primary.id}`;
    const expectedCaptureRationale = GEOMETRY_BINARY_TRACE_RATIONALE;
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
): ThreadOperationRef {
  if (value === null) {
    invalidGeometryPredecessor(
      "current capture has no sandbox preview producer",
    );
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

interface TargetPartAdmissionReopenContext {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly admissions: Pick<TechnicalCompilationAdmissionReader, "read">;
  readonly baseSnapshot?: ThreadSnapshot;
  readonly geometryCaptures?: GeometryCaptureStore;
  readonly moduleAssemblyDraftAssets?: GeometryDraftAssetStore;
  readonly moduleAssemblyOutputValidator?: GeometryModuleAssemblyOutputValidation;
  readonly canonicalAssetDirectory?: string;
}

/**
 * A targeted draft's admission stamp is only a transport locator produced by
 * P2a. Reopen the capture-backed `compile.seal-admission@3` artefact and
 * re-cross the actual admitted Build123d source and its P1 `represents`
 * binding before that locator can authorize canonical promotion.
 *
 * The concrete reader already validates the Thread artefact, capture CAS,
 * basis descent, freshness and admission schema. This second, target-specific
 * join deliberately proves that the bytes and represented PartDefinition are
 * the same facts the target draft claims.
 */
async function requireReopenedTargetPartAdmission(
  draft: Omit<GeometryPartDraftCapture, "fingerprint">,
  admission: GeometryPartDraftAdmission,
  context: TargetPartAdmissionReopenContext,
): Promise<void> {
  let reopened: Awaited<ReturnType<TechnicalCompilationAdmissionReader["read"]>>;
  try {
    reopened = await context.admissions.read({
      projectId: context.projectId,
      basis: context.basis,
      artifactId: admission.artifactId,
      artifactFingerprint: admission.fingerprint,
    });
  } catch (error) {
    throw new TypeError(
      `Target compile.seal-admission@3 artefact could not be reopened: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (!reopened) {
    throw new TypeError(
      "Target compile.seal-admission@3 artefact is unavailable for the exact project and Thread basis.",
    );
  }
  if (
    reopened.schemaVersion !== TECHNICAL_COMPILATION_ADMISSION_CAPTURE_SCHEMA ||
    reopened.operation.id !== COMPILE_SEAL_ADMISSION_OPERATION.id ||
    reopened.operation.version !== COMPILE_SEAL_ADMISSION_OPERATION.version ||
    reopened.trustedRunId.trim() === ""
  ) {
    throw new TypeError(
      "Reopened target admission is not an exact compile.seal-admission@3 capture.",
    );
  }

  const technicalAdmission = reopened.admission;
  if (
    technicalAdmission.draft.projectId !== context.projectId ||
    technicalAdmission.basis.thread.projectId !== context.projectId ||
    technicalAdmission.basis.thread.subjectId !== context.basis.subjectId ||
    technicalAdmission.compilation.status !== "ready-for-review"
  ) {
    throw new TypeError(
      "Reopened target admission has a foreign project, subject, or non-ready compilation identity.",
    );
  }

  const document = reopened.document;
  if (
    document.status !== "ready-for-review" ||
    document.inputManifest.sources.length !== 1 ||
    document.projections.length !== 1 ||
    technicalAdmission.sources.length !== 1
  ) {
    throw new TypeError(
      "Reopened target admission is not a singular ready Build123d compilation.",
    );
  }
  const source = document.inputManifest.sources[0]!;
  const projection = document.projections[0]!;
  const projectedSource = projection.sources[0];
  const admissionSource = technicalAdmission.sources[0]!;
  if (
    projection.target !== "build123d-source" ||
    projection.profile.target !== "build123d-source" ||
    projection.status !== "ready-for-review" ||
    projection.diagnostics.length !== 0 ||
    projection.sources.length !== 1 ||
    !projectedSource ||
    source.analysis.source.role !== "cad-script" ||
    source.analysis.source.language !== "python" ||
    source.analysis.source.id !== admissionSource.id ||
    projectedSource.analysis.source.id !== admissionSource.id ||
    source.sourceText !== projectedSource.sourceText ||
    deterministicJson(source.analysis) !==
      deterministicJson(projectedSource.analysis) ||
    !fingerprintsEqual(
      source.analysisFingerprint,
      projectedSource.analysisFingerprint,
    ) ||
    !fingerprintsEqual(
      source.analysis.source.fingerprint,
      admissionSource.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      source.analysisFingerprint,
      admissionSource.analysisFingerprint,
    ) ||
    deterministicJson(document.inputManifest.bindings) !==
      deterministicJson(technicalAdmission.bindings) ||
    deterministicJson(projectedSource.bindings) !==
      deterministicJson(technicalAdmission.bindings)
  ) {
    throw new TypeError(
      "Reopened target admission source, analysis, or bindings are not exact.",
    );
  }

  const sourceFingerprint = await fingerprintTechnicalSourceText(source.sourceText);
  if (
    source.sourceText !== draft.target.script ||
    !fingerprintsEqual(sourceFingerprint, draft.target.scriptHash) ||
    !fingerprintsEqual(sourceFingerprint, admission.sourceFingerprint) ||
    !fingerprintsEqual(sourceFingerprint, admissionSource.sourceFingerprint)
  ) {
    throw new TypeError(
      "Reopened target admission source bytes or fingerprint do not equal the target draft.",
    );
  }

  const represented = selectUniqueRepresentedPartDefinition(
    technicalAdmission.bindings,
  );
  const represents = technicalAdmission.bindings.filter((binding) =>
    binding.relation === "represents" &&
    binding.sysmlElementKind === "PartDefinition"
  );
  if (
    !represented ||
    represented.elementId !== draft.target.partDefinitionElementId ||
    represents.length !== 1 ||
    represents[0]!.sourceId !== admissionSource.id
  ) {
    throw new TypeError(
      "Reopened target admission does not uniquely represent the target PartDefinition.",
    );
  }
}

/** Load and validate the exact human-reviewed draft without mutating state. */
async function loadReviewedGeometryDraft(
  params: GeometryDecisionParameters,
  draftCaptures: FileCaptureStore<"geometry-draft">,
  geometrySourceCaptures: FileCaptureStore<"geometry-source">,
  sourceAnalysisCaptures: FileCaptureStore<"source-analysis">,
  draftAssetDirectory?: string,
  targetAdmissionContext?: TargetPartAdmissionReopenContext,
): Promise<{
  readonly previewProducer: ThreadOperationRef;
  readonly bundleSources: GeometryBundleCanonicalSources | undefined;
  readonly bundleAssetBytes: ReadonlyMap<string, number> | undefined;
  readonly sourceAnalyses: SealedGeometrySourceAnalyses | undefined;
  /** Present only for the deliberately separate one-PartDefinition family. */
  readonly partDraft: Omit<GeometryPartDraftCapture, "fingerprint"> | undefined;
  readonly moduleDraft: ReviewedGeometryModuleDraft | undefined;
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
  if (isGeometryModuleManifest(params.manifest)) {
    if (
      !targetAdmissionContext?.baseSnapshot ||
      !targetAdmissionContext.geometryCaptures ||
      !targetAdmissionContext.moduleAssemblyDraftAssets ||
      !targetAdmissionContext.moduleAssemblyOutputValidator ||
      !targetAdmissionContext.canonicalAssetDirectory
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Geometry-module sealing requires the exact Thread basis, child capture store, draft asset store, and registered output validators.",
      );
    }
    const moduleDraft = await loadReviewedGeometryModuleDraft(
      draftRecord,
      params.manifest,
      {
        base: targetAdmissionContext.baseSnapshot,
        geometryCaptures: targetAdmissionContext.geometryCaptures,
        draftAssets: targetAdmissionContext.moduleAssemblyDraftAssets,
        outputValidator: targetAdmissionContext.moduleAssemblyOutputValidator,
        canonicalDirectory: targetAdmissionContext.canonicalAssetDirectory,
      },
    );
    return {
      previewProducer: moduleDraft.binaryProducer,
      bundleSources: undefined,
      bundleAssetBytes: undefined,
      sourceAnalyses: undefined,
      partDraft: undefined,
      moduleDraft,
    };
  }
  if (params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA) {
    if (!targetAdmissionContext) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "Target PartDefinition sealing requires an exact compile.seal-admission@3 reader.",
      );
    }
    return {
      ...await loadReviewedGeometryPartDraft(
        draftRecord,
        params.manifest,
        geometrySourceCaptures,
        sourceAnalysisCaptures,
        draftAssetDirectory,
        targetAdmissionContext,
      ),
      moduleDraft: undefined,
    };
  }
  try {
    requireCanonicalGeometryDraftAdmission(draftRecord);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `admission_required: design.write-geometry@1 can only seal a draft exported from compile.seal-admission@3 with a named numeric CAD lever. ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }

  // The signed decision is authoritative only if every manifest field is
  // exactly reconstructible from the reviewed draft record.
  assertMrtrManifestMatchesDraft(params.manifest, draftRecord);
  const previewProducer = requireDraftPreviewProducer(draftRecord);
  let bundleAssetBytes: ReadonlyMap<string, number> | undefined;
  if (isGeometryBundleDraftSchema(draftRecord.schemaVersion)) {
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
  const bundleSources = isGeometryBundleDraftSchema(draftRecord.schemaVersion)
    ? await requireGeometryBundleCanonicalSources(draftRecord)
    : undefined;
  const sourceAnalyses = await requireReviewedGeometrySourceAnalyses(
    draftRecord,
    params,
    geometrySourceCaptures,
    sourceAnalysisCaptures,
  );
  return {
    previewProducer,
    bundleSources,
    bundleAssetBytes,
    sourceAnalyses,
    partDraft: undefined,
    moduleDraft: undefined,
  };
}

/**
 * Re-open the P2a review-only target draft without ever calling the provider.
 * The root is deliberately closed here: a part capture is not a small bundle,
 * and no assembly-shaped field may travel into canonical promotion by accident.
 */
async function loadReviewedGeometryPartDraft(
  draftRecord: Record<string, unknown>,
  manifest: GeometryPartManifest,
  geometrySourceCaptures: FileCaptureStore<"geometry-source">,
  sourceAnalysisCaptures: FileCaptureStore<"source-analysis">,
  draftAssetDirectory?: string,
  admissionContext?: TargetPartAdmissionReopenContext,
): Promise<{
  readonly previewProducer: ThreadOperationRef;
  readonly bundleSources: undefined;
  readonly bundleAssetBytes: undefined;
  readonly sourceAnalyses: undefined;
  readonly partDraft: Omit<GeometryPartDraftCapture, "fingerprint">;
}> {
  try {
    const root = closedRecord(
      draftRecord,
      [
        "schemaVersion",
        "kind",
        "capturedAt",
        "architectureBasis",
        "predecessor",
        "producer",
        "exportName",
        "exportFormats",
        "target",
        "sourceAnalysis",
        "admission",
        "providerCall",
      ],
      [
        "schemaVersion",
        "kind",
        "capturedAt",
        "architectureBasis",
        "producer",
        "exportName",
        "exportFormats",
        "target",
        "sourceAnalysis",
        "admission",
        "providerCall",
      ],
      "$geometryPartDraft",
    );
    if (
      root.schemaVersion !== GEOMETRY_PART_DRAFT_CAPTURE_SCHEMA ||
      root.kind !== "geometry-part-draft"
    ) {
      throw new TypeError("target draft schema or kind is not exact");
    }
    geometryPredecessorInstant(root.capturedAt, "$geometryPartDraft.capturedAt");
    exactRecord(
      root.producer,
      ["serverId", "tool", "runId"],
      "$geometryPartDraft.producer",
    );
    const target = exactRecord(
      root.target,
      ["partDefinitionElementId", "label", "script", "scriptHash", "files"],
      "$geometryPartDraft.target",
    );
    if (!Array.isArray(target.files)) {
      throw new TypeError("target files are not an array");
    }
    for (const [index, file] of target.files.entries()) {
      exactRecord(
        file,
        ["format", "name", "bytes", "fingerprint"],
        `$geometryPartDraft.target.files[${index}]`,
      );
    }
    const draft = draftRecord as Omit<GeometryPartDraftCapture, "fingerprint">;
    const admission = requireCanonicalGeometryPartDraftAdmission(draft);
    if (
      !fingerprintsEqual(
        await geometryPredecessorTextFingerprint(draft.target.script),
        draft.target.scriptHash,
      )
    ) {
      throw new TypeError(
        "target source bytes do not match their signed scriptHash",
      );
    }
    const reconstructed = geometryPartManifestFromDraft(draft);
    if (deterministicJson(reconstructed) !== deterministicJson(manifest)) {
      throw new TypeError(
        "the signed target MRTR manifest is not exactly reconstructible from the draft",
      );
    }
    if (
      admission.target.partDefinitionElementId !==
        manifest.target.partDefinitionElementId ||
      admission.target.label !== manifest.target.label
    ) {
      throw new TypeError("target admission does not join the signed PartDefinition");
    }
    if (!admissionContext) {
      throw new TypeError(
        "target draft has no exact compile.seal-admission@3 reopen context",
      );
    }
    await requireReopenedTargetPartAdmission(
      draft,
      admission,
      admissionContext,
    );
    await assertGeometryPartDraftPaths(draft);
    const assets = geometryPartDraftAssetMetadata(draft);
    if (assets.length !== manifest.target.files!.length) {
      throw new TypeError("target binary metadata coverage is incomplete");
    }
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
    const verifiedAnalysis = await requireGeometrySourceAnalysis(
      draft.sourceAnalysis,
      {
        sourceCaptures: geometrySourceCaptures,
        analysisCaptures: sourceAnalysisCaptures,
      },
    );
    if (
      verifiedAnalysis.reference.selector.kind !== "part-definition" ||
      verifiedAnalysis.reference.selector.elementId !==
        manifest.target.partDefinitionElementId ||
      !fingerprintsEqual(
        verifiedAnalysis.reference.sourceFingerprint,
        manifest.target.scriptHash!,
      )
    ) {
      throw new TypeError(
        "target source analysis does not name the exact signed PartDefinition source",
      );
    }
    const previewProducer = requireDraftPreviewProducer(draft);
    return {
      previewProducer,
      bundleSources: undefined,
      bundleAssetBytes: undefined,
      sourceAnalyses: undefined,
      partDraft: Object.freeze({
        ...draft,
        sourceAnalysis: verifiedAnalysis.reference,
      }),
    };
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Target PartDefinition draft admission/source/asset contract mismatch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

/**
 * Canonical target-only capture.  Its closed root intentionally has no
 * `assembly`, `components`, `occurrences`, `placements`, or
 * `partDefinitions` field: the capture proves one exact PartDefinition and
 * nothing about a complete product structure.
 */
function geometryPartCaptureRecord(options: {
  readonly params: GeometryDecisionParameters;
  readonly runId: string;
  readonly capturedAt: string;
  readonly architectureArtifact: ThreadArtifact;
  readonly previewProducer: ThreadOperationRef;
  readonly draft: Omit<GeometryPartDraftCapture, "fingerprint">;
}) {
  const { params, runId, capturedAt, architectureArtifact, previewProducer, draft } =
    options;
  if (params.manifest.schemaVersion !== GEOMETRY_PART_MANIFEST_SCHEMA) {
    throw new TypeError(
      "Target capture requires a geometry-part-manifest/1.0 decision.",
    );
  }
  const target = params.manifest.target;
  const stepIndex = target.files!.findIndex((file) => file.format === "step");
  if (stepIndex < 0) {
    throw new TypeError("Target capture requires one authoritative STEP file.");
  }
  const step = target.files![stepIndex]!;
  const draftStep = draft.target.files[stepIndex];
  if (
    !draftStep || draftStep.format !== "step" ||
    !fingerprintsEqual(draftStep.fingerprint, step.fingerprint) ||
    !Number.isSafeInteger(draftStep.bytes) || draftStep.bytes <= 0
  ) {
    throw new TypeError(
      "Target capture STEP metadata is not exactly re-opened from the draft.",
    );
  }
  return {
    schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
    operation: DESIGN_WRITE_GEOMETRY_OPERATION,
    trustedRunId: runId,
    draftDigest: params.draftDigest,
    manifest: params.manifest,
    architectureBasis: {
      artifactId: architectureArtifact.id,
      fingerprint: architectureArtifact.fingerprint,
      producerRunId: architectureArtifact.producer.runId,
    },
    previewProducer,
    sourceScript: {
      partDefinitionElementId: target.partDefinitionElementId,
      label: target.label,
      script: draft.target.script,
      scriptHash: target.scriptHash,
      admission: draft.admission,
      authoritativeStep: {
        fileIndex: stepIndex,
        fingerprint: step.fingerprint,
        bytes: draftStep.bytes,
      },
    },
    sourceAnalysis: draft.sourceAnalysis,
    sealedAt: capturedAt,
  } as const;
}

async function requireReviewedGeometrySourceAnalyses(
  draft: Record<string, unknown>,
  params: GeometryDecisionParameters,
  geometrySourceCaptures: FileCaptureStore<"geometry-source">,
  sourceAnalysisCaptures: FileCaptureStore<"source-analysis">,
): Promise<SealedGeometrySourceAnalyses> {
  const schema = draft.schemaVersion;
  const stores = {
    sourceCaptures: geometrySourceCaptures,
    analysisCaptures: sourceAnalysisCaptures,
  } as const;
  try {
    if (schema === GEOMETRY_DRAFT_CAPTURE_SCHEMA) {
      if (params.manifest.schemaVersion !== GEOMETRY_MANIFEST_SCHEMA) {
        throw new TypeError("draft and manifest families diverge");
      }
      const verified = await requireGeometrySourceAnalysis(
        draft.sourceAnalysis,
        stores,
      );
      if (
        verified.reference.selector.kind !== "assembly" ||
        !params.manifest.scriptHash ||
        !fingerprintsEqual(
          verified.reference.sourceFingerprint,
          params.manifest.scriptHash,
        )
      ) {
        throw new TypeError(
          "assembly analysis does not name the exact signed script",
        );
      }
      return Object.freeze({
        assembly: verified.reference,
        partDefinitions: Object.freeze([]),
      });
    }

    if (schema === GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA) {
      if (params.manifest.schemaVersion !== "geometry-manifest/2.0") {
        throw new TypeError("draft and manifest families diverge");
      }
      const raw = exactRecord(
        draft.sourceAnalyses,
        ["assembly", "partDefinitions"],
        "$geometryDraft.sourceAnalyses",
      );
      const assembly = await requireGeometrySourceAnalysis(raw.assembly, stores);
      if (
        assembly.reference.selector.kind !== "assembly" ||
        !params.manifest.scriptHash ||
        !fingerprintsEqual(
          assembly.reference.sourceFingerprint,
          params.manifest.scriptHash,
        )
      ) {
        throw new TypeError(
          "bundle assembly analysis does not name the exact signed script",
        );
      }
      if (!Array.isArray(raw.partDefinitions)) {
        throw new TypeError("PartDefinition analyses must be an array");
      }
      if (raw.partDefinitions.length !== params.manifest.partDefinitions.length) {
        throw new TypeError(
          "PartDefinition analysis coverage does not match the signed manifest",
        );
      }
      const partDefinitions = [];
      for (const [index, rawEntry] of raw.partDefinitions.entries()) {
        const entry = exactRecord(
          rawEntry,
          ["elementId", "analysis"],
          `$geometryDraft.sourceAnalyses.partDefinitions[${index}]`,
        );
        const definition = params.manifest.partDefinitions[index]!;
        if (entry.elementId !== definition.elementId || !definition.scriptHash) {
          throw new TypeError(
            `PartDefinition analysis ${index} does not preserve signed identity order`,
          );
        }
        const verified = await requireGeometrySourceAnalysis(
          entry.analysis,
          stores,
        );
        if (
          verified.reference.selector.kind !== "part-definition" ||
          verified.reference.selector.elementId !== definition.elementId ||
          !fingerprintsEqual(
            verified.reference.sourceFingerprint,
            definition.scriptHash,
          )
        ) {
          throw new TypeError(
            `PartDefinition ${definition.elementId} analysis does not name its exact signed source`,
          );
        }
        partDefinitions.push({
          elementId: definition.elementId,
          analysis: verified.reference,
        });
      }
      return Object.freeze({
        assembly: assembly.reference,
        partDefinitions: Object.freeze(partDefinitions),
      });
    }
    throw new TypeError(`unsupported geometry draft schema ${String(schema)}`);
  } catch (error) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Geometry source-analysis provenance mismatch: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

async function requireCanonicalGeometrySourceAnalyses(
  value: unknown,
  params: GeometryDecisionParameters,
  stores: GeometrySourceAnalysisStores,
): Promise<SealedGeometrySourceAnalyses> {
  const raw = exactRecord(
    value,
    ["assembly", "partDefinitions"],
    "$geometryCapture.sourceAnalyses",
  );
  const syntheticDraft = params.manifest.schemaVersion === "geometry-manifest/2.0"
    ? {
      schemaVersion: GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA,
      sourceAnalyses: raw,
    }
    : {
      schemaVersion: GEOMETRY_DRAFT_CAPTURE_SCHEMA,
      sourceAnalysis: raw.assembly,
    };
  if (
    params.manifest.schemaVersion !== "geometry-manifest/2.0" &&
    (!Array.isArray(raw.partDefinitions) || raw.partDefinitions.length !== 0)
  ) {
    throw new TypeError(
      "A v1 canonical source-analysis set must not contain PartDefinitions.",
    );
  }
  return await requireReviewedGeometrySourceAnalyses(
    syntheticDraft,
    params,
    stores.geometrySourceCaptures,
    stores.sourceAnalysisCaptures,
  );
}

/**
 * Recover the exact preview invocation from a current signed draft capture.
 * Generic drafts are 1.2 or 2.1; the target-part family is a separate current
 * schema and stores analysis under `sourceAnalysis`.
 */
function requireDraftPreviewProducer(value: unknown): ThreadOperationRef {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Geometry draft capture must be an object.",
    );
  }
  const draft = value as Record<string, unknown>;
  const schemaVersion = draft.schemaVersion;
  if (schemaVersion !== GEOMETRY_PART_DRAFT_CAPTURE_SCHEMA) {
    try {
      currentGenericGeometryDraftCaptureSchema(schemaVersion);
    } catch {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `Unsupported geometry draft capture schema: ${String(schemaVersion)}.`,
      );
    }
  }
  const rawProducer = draft.producer;
  if (!rawProducer || typeof rawProducer !== "object" || Array.isArray(rawProducer)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Geometry draft capture has no valid preview producer.",
    );
  }
  const producer = rawProducer as Record<string, unknown>;
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
    "Geometry draft capture requires an exact preview producer runId.",
  );
}

function isGeometryBundleDraftSchema(value: unknown): boolean {
  return value === GEOMETRY_BUNDLE_DRAFT_CAPTURE_SCHEMA;
}

/** Fail closed on current server-owned draft export names before canonical writes. */
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
      `Geometry draft export identity contract mismatch: ${
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
    }
    | {
      readonly scope: "target-part-definition";
      readonly elementId: string;
      readonly fileIndex: number;
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
  } else if (
    manifest?.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA &&
    options.identity.scope === "target-part-definition"
  ) {
    const identity = options.identity;
    const targetFiles = manifest.target.files ?? [];
    const file = targetFiles[identity.fileIndex];
    if (
      manifest.target.partDefinitionElementId === identity.elementId &&
      file?.format === identity.format && file.name === identity.name
    ) {
      exactMatches = [file.fingerprint];
    }
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
  previewProducer: ThreadOperationRef;
  predecessor: GeometryPredecessorContext | undefined;
  structureArtifact?: ThreadArtifact;
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
    structureArtifact,
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

  // Primary geometry artifact: the sealed geometry capture (JSON).
  const primaryArtifact: ThreadArtifact = {
    id: artifactId,
    name: isGeometryModuleManifest(params.manifest)
      ? `Canonical module geometry: ${params.manifest.target.label}`
      : params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA
      ? `Canonical PartDefinition geometry: ${params.manifest.target.label}`
      : `Geometry: ${
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
    inputArtifactIds: isGeometryModuleManifest(params.manifest)
      ? geometryModulePrimaryInputIds({
        architectureId: architectureArtifact.id,
        structureId: structureArtifact!.id,
        childPrimaryIds: params.manifest.children.map((child) =>
          child.childGeometry.artifactId
        ),
        predecessorId: predecessor?.artifact.id,
      })
      : [
        architectureArtifact.id,
        ...(predecessor ? [predecessor.artifact.id] : []),
      ],
    freshness,
  };
  const moduleChildArtifacts: ThreadArtifact[] = isGeometryModuleManifest(
      params.manifest,
    )
    ? [
      ...new Set(
        params.manifest.children.map((child) => child.childGeometry.artifactId),
      ),
    ].map((childId) => {
      const child = base.artifacts.find((artifact) => artifact.id === childId);
      if (!child) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          `geometry_module_child_missing: child capture ${childId} disappeared before Thread publication.`,
        );
      }
      return child;
    })
    : [];

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
      producer: previewProducer,
      inputArtifactIds: [],
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
          producer: previewProducer,
          inputArtifactIds: [],
          freshness,
        }))
      )
      : [];

  /** One target-only artifact per signed file; no assembly vocabulary exists. */
  const targetManifest = params.manifest as GeometryPartManifest;
  const targetPartArtifacts: ThreadArtifact[] =
    params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA
      ? targetManifest.target.files!.map((file, fileIndex) => ({
        id:
          `cad-asset-${captureFp.digest}-target-${fileIndex}-${file.fingerprint.digest}`,
        name: `${
          file.format === "step" ? "Authoritative STEP" : file.format.toUpperCase()
        }: ${targetManifest.target.label}`,
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
        producer: previewProducer,
        inputArtifactIds: [],
        freshness,
      }))
      : [];
  const moduleAssemblyArtifacts = isGeometryModuleManifest(params.manifest)
    ? geometryModuleAssemblyArtifacts({
      captureDigest: captureFp.digest,
      primaryId: artifactId,
      manifest: params.manifest,
      producer: previewProducer,
      freshness,
    })
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
      producer: previewProducer,
      inputArtifactIds: [],
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
  const structureAttestation = structureArtifact
    ? geometryModuleStructureAttestation({
      primaryId: artifactId,
      captureDigest: captureFp.digest,
      structure: structureArtifact,
      sealProducer,
      capturedAt,
    })
    : undefined;
  const moduleChildConsumptions: ThreadArtifactConsumption[] = moduleChildArtifacts.map(
    (child) => ({
      id: `consume-child-${child.id}-by-${artifactId}`,
      artifactId: child.id,
      consumer: sealProducer,
      observedFingerprint: child.fingerprint,
      verifiedAt: capturedAt,
      status: "verified" as const,
    }),
  );
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
    ...targetPartArtifacts,
    ...moduleAssemblyArtifacts,
  ];
  const binaryConsumptions: ThreadArtifactConsumption[] = binaryArtifacts.map(
    (artifact) => ({
      id: `consume-${artifactId}-by-${artifact.id}`,
      artifactId,
      consumer: artifact.inputArtifactIds.includes(artifactId)
        ? artifact.producer
        : sealProducer,
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
      ...targetPartArtifacts,
      ...moduleAssemblyArtifacts,
    ],
    consumptions: [
      consumption,
      ...(structureAttestation ? [structureAttestation.consumption] : []),
      ...moduleChildConsumptions,
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
      ...(structureAttestation
        ? structureAttestation.provenance.map((link) => ({
          ...link,
          from: { kind: link.from.kind, id: link.from.id },
          to: { kind: link.to.kind, id: link.to.id },
        }))
        : []),
      ...moduleChildArtifacts.flatMap((child, index) => {
        const consumption = moduleChildConsumptions[index]!;
        return [{
          id: `derived-from-child-${captureFp.digest}-${child.fingerprint.digest}`,
          relation: "derived_from" as const,
          from: { kind: "artifact" as const, id: artifactId },
          to: { kind: "artifact" as const, id: child.id },
          rationale: GEOMETRY_MODULE_CHILD_DERIVATION_RATIONALE,
        }, {
          id: `uses-${consumption.id}`,
          relation: "uses" as const,
          from: { kind: "consumption" as const, id: consumption.id },
          to: { kind: "artifact" as const, id: child.id },
          rationale: GEOMETRY_MODULE_CHILD_USE_RATIONALE,
        }];
      }),
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
        return [
          {
            id: `traces-${artifact.id}-from-${artifactId}`,
            relation: "traces_to" as const,
            from: { kind: "artifact" as const, id: artifact.id },
            to: { kind: "artifact" as const, id: artifactId },
            rationale: GEOMETRY_BINARY_TRACE_RATIONALE,
          },
          ...(artifact.inputArtifactIds.includes(artifactId)
            ? [{
              id: `derived-from-module-primary-${artifact.id}`,
              relation: "derived_from" as const,
              from: { kind: "artifact" as const, id: artifact.id },
              to: { kind: "artifact" as const, id: artifactId },
              rationale: GEOMETRY_MODULE_ASSET_DERIVATION_RATIONALE,
            }]
            : []),
          {
            id: `uses-${binaryConsumption.id}`,
            relation: "uses" as const,
            from: { kind: "consumption" as const, id: binaryConsumption.id },
            to: { kind: "artifact" as const, id: artifactId },
            rationale: GEOMETRY_BINARY_CAPTURE_USE_RATIONALE,
          },
        ];
      }),
    ],
    proposedActions: [],
    ...(predecessor
      ? {
        archived: predecessor.archiveEntries.map((entry) => ({
          target: entry.ref,
          summary: `Retired by ${
            isGeometryModuleManifest(params.manifest)
              ? "canonical module geometry"
              : params.manifest.schemaVersion === GEOMETRY_PART_MANIFEST_SCHEMA
              ? "canonical PartDefinition geometry"
              : "geometry bundle"
          } ${captureFp.digest.slice(0, 16)}; ` +
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
    run.basis?.kind !== "thread-snapshot" ||
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
