/**
 * Reopen one sealed Build123d compilation and export its exact admitted bytes.
 *
 * Callers cannot supply Python, provider, tool, path, image or formats. The
 * use case reopens `compile.seal-admission@3`, extracts the singular admitted
 * source, and hands those exact bytes to the server-owned exporter. The
 * product is a geometry DRAFT; `design.write-geometry@1` remains the sealer.
 */

import type {
  ProjectAdmittedGeometryExportCommand,
  ProjectAdmittedGeometryExportResult,
  ProjectAdmittedGeometryExportUseCase,
} from "../../../ports/in/cad/canonical/project-admitted-geometry-export.ts";
import type {
  AdmittedGeometryExportDraft,
  AdmittedGeometryExporter,
  AdmittedGeometryTargetedPartExportDraft,
} from "../../../ports/out/cad/canonical/admitted-geometry-exporter.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import {
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalCompilationDocument,
  fingerprintTechnicalSourceText,
  type TechnicalCompilationDocument,
  type TechnicalCompilationProjection,
  validateTechnicalCompilationDocument,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  type TechnicalCompilationAdmission,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import { BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA } from "../../../../domain/cad/isolated/build123d-execution-proposal.ts";
import { validateContentFingerprint } from "../../../../domain/compile/isolation/isolated-code-execution.ts";
import { selectUniqueRepresentedPartDefinition } from "../../../../domain/compile/admission/technical-compilation-join.ts";
import { listGeometryAffectingNamedNumericLevers } from "../../../../domain/compile/source/named-cad-levers.ts";
import {
  GEOMETRY_DRAFT_ADMISSION_SCHEMA,
  GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
} from "../../../../domain/cad/canonical/geometry-draft-admission.ts";
import {
  encodeGeometryBundleDecisionParameters,
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  type GeometryBundleManifest,
} from "../../../../domain/cad/canonical/geometry-bundle.ts";
import {
  assertGeometryBundleManifest,
} from "../../../../domain/cad/canonical/geometry-bundle.ts";
import {
  encodeGeometryPartDecisionParameters,
  GEOMETRY_PART_CAPTURE_SCHEMA,
  GEOMETRY_PART_MANIFEST_SCHEMA,
  type GeometryPartManifest,
  parseGeometryPartManifest,
} from "../../../../domain/cad/canonical/geometry-part-manifest.ts";
import { DESIGN_WRITE_GEOMETRY_OPERATION } from "../../../../domain/cad/canonical/geometry-proposal.ts";
import {
  archivedRefKeys,
  type ThreadArtifact,
  type ThreadSnapshot,
} from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  safeId,
} from "../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import { parseExactThreadSnapshotBasis } from "../../../../domain/project/thread-tip.ts";

export type ProjectAdmittedGeometryExportErrorCode =
  | "invalid_request"
  | "admission_not_found"
  | "admission_resolution_failed"
  | "admission_integrity_failed"
  | "admission_not_parameterized"
  | "admission_not_represented"
  | "architecture_unavailable"
  | "architecture_not_system_only"
  | "snapshot_not_found"
  | "geometry_tip_ambiguous"
  | "geometry_part_predecessor_unavailable"
  | "geometry_part_tip_ambiguous"
  | "geometry_part_v2_bundle_conflict"
  | "geometry_part_target_conflict"
  | "export_failed";

/** Captured PartDefinition graph needed to author a system-only v2 draft. */
export interface ArchitecturePartGraph {
  readonly partDefinitions: readonly {
    readonly id: string;
    readonly label: string;
    readonly usages: readonly {
      readonly id: string;
      readonly label: string;
      readonly targetId: string;
    }[];
  }[];
}

export interface ArchitecturePartGraphReader {
  read(fingerprint: ContentFingerprint): Promise<ArchitecturePartGraph | undefined>;
}

/**
 * Read-only seam over canonical geometry captures. Targeted P2a uses it only
 * to choose an exact same-target predecessor or reject a V2 bundle conflict;
 * it writes no capture and does not implement any sealing behavior.
 */
export interface CanonicalGeometryCaptureReader {
  read(fingerprint: ContentFingerprint): Promise<string | undefined>;
}

/** Stable application error. Provider details, storage paths and causes stay internal. */
export class ProjectAdmittedGeometryExportError extends Error {
  constructor(
    readonly code: ProjectAdmittedGeometryExportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAdmittedGeometryExportError";
  }
}

export interface ExportAdmittedProjectGeometryDependencies {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly exporter: AdmittedGeometryExporter;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly architecture: ArchitecturePartGraphReader;
  readonly geometryCaptures?: CanonicalGeometryCaptureReader;
}

export class ExportAdmittedProjectGeometry
  implements ProjectAdmittedGeometryExportUseCase {
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #exporter: AdmittedGeometryExporter;
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #architecture: ArchitecturePartGraphReader;
  readonly #geometryCaptures: CanonicalGeometryCaptureReader | undefined;

  constructor(dependencies: ExportAdmittedProjectGeometryDependencies) {
    this.#admissions = dependencies.admissions;
    this.#exporter = dependencies.exporter;
    this.#snapshots = dependencies.snapshots;
    this.#architecture = dependencies.architecture;
    this.#geometryCaptures = dependencies.geometryCaptures;
  }

  async execute(value: unknown): Promise<ProjectAdmittedGeometryExportResult> {
    let command: ProjectAdmittedGeometryExportCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw exportError(
        "invalid_request",
        "The admitted-geometry export request failed exact validation.",
      );
    }

    let reopened: ReopenedTechnicalCompilationAdmission | undefined;
    try {
      reopened = await this.#admissions.read(command);
    } catch {
      throw exportError(
        "admission_resolution_failed",
        "The exact technical-compilation admission could not be reopened.",
      );
    }
    if (!reopened) {
      throw exportError(
        "admission_not_found",
        "The exact technical-compilation admission is unavailable.",
      );
    }

    let compilation: ReadyBuild123dCompilation;
    try {
      compilation = await reopenReadyBuild123dCompilation(reopened, command);
    } catch {
      throw exportError(
        "admission_integrity_failed",
        "The reopened technical-compilation admission is not an exact, singular, ready Build123d compilation.",
      );
    }

    const architectureBasis = deepFreeze({
      snapshotId: command.basis.snapshotId,
      revision: command.basis.revision,
      artifactFingerprint: compilation.admission.basis.sysml.artifactFingerprint,
    });
    const script = compilation.projection.sources[0]!.sourceText;
    const admittedSource = compilation.projection.sources[0]!;
    if (
      listGeometryAffectingNamedNumericLevers(
        admittedSource.sourceText,
        admittedSource.analysis,
        admittedSource.bindings,
      ).length === 0
    ) {
      throw exportError(
        "admission_not_parameterized",
        "The sealed admission has no causal named numeric CAD lever.",
      );
    }
    const represented = selectUniqueRepresentedPartDefinition(
      compilation.admission.bindings,
    );
    if (!represented) {
      throw exportError(
        "admission_not_represented",
        "The sealed admission has no unique represents PartDefinition.",
      );
    }

    let architectureGraph: ArchitecturePartGraph | undefined;
    try {
      architectureGraph = await this.#architecture.read(
        compilation.admission.basis.sysml.artifactFingerprint,
      );
    } catch {
      throw exportError(
        "architecture_unavailable",
        "The architecture capture for the sealed admission could not be reopened.",
      );
    }
    if (!architectureGraph) {
      throw exportError(
        "architecture_unavailable",
        "The architecture capture for the sealed admission is unavailable.",
      );
    }
    const representedPart = selectExactRepresentedPart(
      architectureGraph,
      represented.elementId,
    );
    if (!representedPart) {
      throw exportError(
        "admission_not_represented",
        "The unique represented PartDefinition is not an exact definition in the reopened architecture.",
      );
    }

    let snapshot: ThreadSnapshot | undefined;
    try {
      snapshot = await this.#snapshots.get(command.basis.snapshotId);
    } catch {
      throw exportError(
        "snapshot_not_found",
        "The named Thread basis snapshot could not be reopened.",
      );
    }
    if (!snapshot) {
      throw exportError(
        "snapshot_not_found",
        "The named Thread basis snapshot is unavailable.",
      );
    }
    if (
      snapshot.id !== command.basis.snapshotId ||
      snapshot.revision !== command.basis.revision ||
      snapshot.subject.id !== command.basis.subjectId
    ) {
      throw exportError(
        "admission_integrity_failed",
        "The named Thread basis snapshot does not match the requested identity.",
      );
    }
    const systemOnly = selectSystemOnlyRepresentedPart(
      architectureGraph,
      represented.elementId,
    );
    if (systemOnly) {
      const predecessor = selectActiveGeometryPredecessor(snapshot);
      if (predecessor.status === "ambiguous") {
        throw exportError(
          "geometry_tip_ambiguous",
          "More than one active canonical geometry capture exists.",
        );
      }

      let draft: AdmittedGeometryExportDraft;
      try {
        draft = await this.#exporter.export({
          script,
          architectureBasis,
          admission: {
            schemaVersion: GEOMETRY_DRAFT_ADMISSION_SCHEMA,
            artifactId: command.artifactId,
            fingerprint: command.artifactFingerprint,
            sourceFingerprint: compilation.source.sourceFingerprint,
          },
          representedPart: systemOnly,
          ...(predecessor.status === "ok"
            ? {
              predecessor: {
                artifactId: predecessor.artifactId,
                fingerprint: predecessor.fingerprint,
              },
            }
            : {}),
        });
      } catch {
        throw exportError(
          "export_failed",
          "The admitted Build123d source could not be exported as a geometry draft.",
        );
      }

      try {
        return assembleResult(draft, architectureBasis);
      } catch {
        throw exportError(
          "export_failed",
          "The admitted geometry draft did not produce an exact write-geometry review identity.",
        );
      }
    }

    if (!this.#geometryCaptures) {
      throw exportError(
        "geometry_part_predecessor_unavailable",
        "Targeted geometry export requires the canonical geometry capture reader seam.",
      );
    }
    let predecessor: TargetedPartPredecessor;
    try {
      predecessor = await selectTargetedPartPredecessor(
        snapshot,
        representedPart,
        this.#geometryCaptures,
      );
    } catch (error) {
      if (error instanceof TargetedPartPredecessorError) {
        throw exportError(error.code, error.message);
      }
      throw exportError(
        "geometry_part_predecessor_unavailable",
        "The active canonical geometry captures could not be reread for the target PartDefinition.",
      );
    }

    let draft: AdmittedGeometryTargetedPartExportDraft;
    try {
      draft = await this.#exporter.exportTargetedPart({
        script,
        architectureBasis,
        admission: {
          schemaVersion: GEOMETRY_PART_DRAFT_ADMISSION_SCHEMA,
          artifactId: command.artifactId,
          fingerprint: command.artifactFingerprint,
          sourceFingerprint: compilation.source.sourceFingerprint,
          target: {
            partDefinitionElementId: representedPart.elementId,
            label: representedPart.label,
          },
        },
        target: {
          partDefinitionElementId: representedPart.elementId,
          label: representedPart.label,
        },
        ...(predecessor.status === "ok"
          ? {
            predecessor: {
              schemaVersion: predecessor.schemaVersion,
              artifactId: predecessor.artifactId,
              fingerprint: predecessor.fingerprint,
              partDefinitionElementId: predecessor.partDefinitionElementId,
            },
          }
          : {}),
      });
    } catch {
      throw exportError(
        "export_failed",
        "The admitted Build123d source could not be exported as a target geometry draft.",
      );
    }
    try {
      return assembleTargetedPartResult(draft, architectureBasis);
    } catch {
      throw exportError(
        "export_failed",
        "The targeted geometry draft did not produce an exact future-seal review identity.",
      );
    }
  }
}

interface ReadyBuild123dCompilation {
  readonly admission: TechnicalCompilationAdmission;
  readonly document: TechnicalCompilationDocument;
  readonly documentFingerprint: ContentFingerprint;
  readonly projection: TechnicalCompilationProjection;
  readonly projectionFingerprint: ContentFingerprint;
  readonly source: TechnicalCompilationAdmission["sources"][number];
}

function parseCommand(value: unknown): ProjectAdmittedGeometryExportCommand {
  const command = exactRecord(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    "$admittedGeometryExport",
  );
  const projectId = safeId(
    command.projectId,
    "$admittedGeometryExport.projectId",
  );
  const basis = parseExactThreadSnapshotBasis(
    command.basis,
    "$admittedGeometryExport.basis",
  );
  const artifactFingerprint = validateContentFingerprint(
    command.artifactFingerprint,
    "$admittedGeometryExport.artifactFingerprint",
  );
  const artifactId = safeId(
    command.artifactId,
    "$admittedGeometryExport.artifactId",
  );
  if (
    artifactId !==
      `technical-compilation-admission-${artifactFingerprint.digest}`
  ) {
    throw new TypeError("The admission artifact id must derive from its hash.");
  }
  return deepFreeze({ projectId, basis, artifactId, artifactFingerprint });
}

async function reopenReadyBuild123dCompilation(
  value: unknown,
  command: ProjectAdmittedGeometryExportCommand,
): Promise<ReadyBuild123dCompilation> {
  const capture = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "decisionId",
    "sealedAt",
    "draftReference",
    "admission",
    "document",
  ], "$reopenedAdmission");
  literalValue(
    capture.schemaVersion,
    BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA,
    "$reopenedAdmission.schemaVersion",
  );
  const operation = exactRecord(
    capture.operation,
    ["id", "version"],
    "$reopenedAdmission.operation",
  );
  literalValue(
    operation.id,
    COMPILE_SEAL_ADMISSION_OPERATION.id,
    "$reopenedAdmission.operation.id",
  );
  literalValue(
    operation.version,
    COMPILE_SEAL_ADMISSION_OPERATION.version,
    "$reopenedAdmission.operation.version",
  );
  safeId(capture.trustedRunId, "$reopenedAdmission.trustedRunId");
  safeId(capture.decisionId, "$reopenedAdmission.decisionId");
  const sealedAt = nonEmptyText(capture.sealedAt, "$reopenedAdmission.sealedAt");
  if (Number.isNaN(Date.parse(sealedAt))) {
    throw new TypeError("The admission sealing time must be ISO-8601.");
  }

  const admission = parseTechnicalCompilationAdmissionParameters(
    encodeTechnicalCompilationAdmissionParameters(capture.admission),
  );
  const document = await validateTechnicalCompilationDocument(capture.document);
  const documentFingerprint = await fingerprintTechnicalCompilationDocument(
    document,
  );
  const basisFingerprint = await fingerprintTechnicalCompilationBasis(
    document.basis,
  );
  const draftReference = exactRecord(capture.draftReference, [
    "schemaVersion",
    "draftId",
    "projectId",
    "documentFingerprint",
    "envelopeFingerprint",
  ], "$reopenedAdmission.draftReference");
  literalValue(
    draftReference.schemaVersion,
    TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    "$reopenedAdmission.draftReference.schemaVersion",
  );

  const expectedDraftReference = {
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId: admission.draft.draftId,
    projectId: admission.draft.projectId,
    documentFingerprint: admission.draft.documentFingerprint,
    envelopeFingerprint: admission.draft.envelopeFingerprint,
  };
  const artifactBindingIsExact = command.artifactId ===
      `technical-compilation-admission-${command.artifactFingerprint.digest}` &&
    command.basis.snapshotId !== admission.basis.thread.snapshotId &&
    command.basis.revision > admission.basis.thread.revision;
  if (
    deterministicJson(draftReference) !==
      deterministicJson(expectedDraftReference) ||
    !artifactBindingIsExact ||
    command.projectId !== admission.draft.projectId ||
    command.projectId !== admission.basis.thread.projectId ||
    command.basis.subjectId !== admission.basis.thread.subjectId ||
    document.status !== "ready-for-review" ||
    !fingerprintsEqual(documentFingerprint, admission.draft.documentFingerprint) ||
    !fingerprintsEqual(documentFingerprint, admission.compilation.fingerprint) ||
    !fingerprintsEqual(basisFingerprint, admission.basis.fingerprint) ||
    !fingerprintsEqual(document.basisFingerprint, admission.basis.fingerprint) ||
    !fingerprintsEqual(
      document.basis.thread.snapshotFingerprint,
      admission.basis.thread.fingerprint,
    ) ||
    document.basis.thread.projectId !== admission.basis.thread.projectId ||
    document.basis.thread.subjectId !== admission.basis.thread.subjectId ||
    document.basis.thread.snapshotId !== admission.basis.thread.snapshotId ||
    document.basis.thread.revision !== admission.basis.thread.revision ||
    document.basis.sysmlAnchor.artifactId !== admission.basis.sysml.artifactId ||
    !fingerprintsEqual(
      document.basis.sysmlAnchor.artifactFingerprint,
      admission.basis.sysml.artifactFingerprint,
    ) ||
    document.basis.sysmlAnchor.captureId !== admission.basis.sysml.captureId ||
    document.basis.sysmlAnchor.editingContextId !==
      admission.basis.sysml.editingContextId ||
    document.basis.sysmlAnchor.rootElementId !==
      admission.basis.sysml.rootElementId ||
    document.basis.sysmlAnchor.rootElementKind !==
      admission.basis.sysml.rootElementKind ||
    !fingerprintsEqual(
      document.basis.sysmlAnchorFingerprint,
      admission.basis.sysml.anchorFingerprint,
    ) ||
    deterministicJson(document.inputManifest.bindings) !==
      deterministicJson(admission.bindings) ||
    deterministicJson(document.inputManifest.profileRequests) !==
      deterministicJson(admission.compilationProfileRequests.map((request) => ({
        profileId: request.profileId,
        profileVersion: request.profileVersion,
        sourceIds: request.sourceIds,
      })))
  ) {
    throw new TypeError("The sealed compilation facts disagree.");
  }

  if (
    document.projections.length !== 1 ||
    document.inputManifest.sources.length !== 1 ||
    admission.sources.length !== 1 ||
    admission.compilationProfileRequests.length !== 1
  ) {
    throw new TypeError("V1 requires one projection, source, and profile request.");
  }
  const projection = document.projections[0]!;
  if (
    projection.target !== "build123d-source" ||
    projection.profile.target !== "build123d-source" ||
    projection.status !== "ready-for-review" ||
    projection.diagnostics.length !== 0 ||
    projection.sources.length !== 1
  ) {
    throw new TypeError("The sole projection is not a ready Build123d projection.");
  }
  const projectedSource = projection.sources[0]!;
  const manifestSource = document.inputManifest.sources[0]!;
  const admittedSource = admission.sources[0]!;
  const profileRequest = admission.compilationProfileRequests[0]!;
  if (
    deterministicJson(projectedSource.sourceText) !==
      deterministicJson(manifestSource.sourceText) ||
    deterministicJson(projectedSource.analysis) !==
      deterministicJson(manifestSource.analysis) ||
    !fingerprintsEqual(
      projectedSource.analysisFingerprint,
      manifestSource.analysisFingerprint,
    ) ||
    projectedSource.analysis.source.id !== admittedSource.id ||
    manifestSource.analysis.source.id !== admittedSource.id ||
    !fingerprintsEqual(
      manifestSource.analysis.source.fingerprint,
      admittedSource.sourceFingerprint,
    ) ||
    !fingerprintsEqual(
      manifestSource.analysisFingerprint,
      admittedSource.analysisFingerprint,
    ) ||
    admittedSource.role !== projection.profile.sourceRole ||
    admittedSource.language !== projection.profile.language ||
    admittedSource.profileId !== projection.profile.id ||
    admittedSource.profileVersion !== projection.profile.version ||
    admittedSource.analyzer.id !== projection.profile.analyzer.id ||
    admittedSource.analyzer.version !== projection.profile.analyzer.version ||
    profileRequest.profileId !== projection.profile.id ||
    profileRequest.profileVersion !== projection.profile.version ||
    profileRequest.target !== projection.target ||
    profileRequest.sourceIds.length !== 1 ||
    profileRequest.sourceIds[0] !== admittedSource.id ||
    !fingerprintsEqual(
      profileRequest.profileFingerprint,
      projection.profileFingerprint,
    )
  ) {
    throw new TypeError("The sole Build123d source or profile identity disagrees.");
  }
  const sourceFingerprint = await fingerprintTechnicalSourceText(
    projectedSource.sourceText,
  );
  if (!fingerprintsEqual(sourceFingerprint, admittedSource.sourceFingerprint)) {
    throw new TypeError("The Build123d source bytes disagree with their identity.");
  }

  return deepFreeze({
    admission,
    document,
    documentFingerprint,
    projection,
    projectionFingerprint: await sha256Fingerprint(projection),
    source: admittedSource,
  });
}

function assembleResult(
  draft: AdmittedGeometryExportDraft,
  architectureBasis: GeometryBundleManifest["architectureBasis"],
): ProjectAdmittedGeometryExportResult {
  if (draft.partMeshes.length !== 0) {
    throw new TypeError(
      "A system-only admitted draft cannot carry assembly part meshes.",
    );
  }
  const manifest: GeometryBundleManifest = {
    schemaVersion: GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
    architectureBasis,
    ...(draft.predecessor ? { predecessor: draft.predecessor } : {}),
    components: [],
    unitSystem: "mm",
    placementConvention: GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
    exportFormats: [...draft.exportFormats],
    partExportFormats: [...draft.partExportFormats],
    partDefinitions: draft.partDefinitions.map((definition) => ({
      elementId: definition.elementId,
      label: definition.label,
      scriptHash: definition.scriptHash,
      files: definition.files.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: { algorithm: "sha256", digest: file.digest },
      })),
    })),
    occurrences: [],
    scriptHash: draft.scriptHash,
    artifactHashes: {
      assemblyFiles: draft.assemblyFiles.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: { algorithm: "sha256", digest: file.digest },
      })),
      partMeshes: [],
    },
  };
  const decisionParameters = encodeGeometryBundleDecisionParameters(
    draft.draftDigest,
    manifest,
  );
  return deepFreeze({
    draftDigest: draft.draftDigest,
    assemblyFiles: draft.assemblyFiles,
    partMeshes: [],
    partDefinitions: draft.partDefinitions.map((definition) => ({
      elementId: definition.elementId,
      label: definition.label,
      files: definition.files,
    })),
    sourceAnalysis: draft.sourceAnalysis,
    decisionParameters,
  });
}

function assembleTargetedPartResult(
  draft: AdmittedGeometryTargetedPartExportDraft,
  architectureBasis: GeometryPartManifest["architectureBasis"],
): ProjectAdmittedGeometryExportResult {
  const manifest: GeometryPartManifest = {
    schemaVersion: GEOMETRY_PART_MANIFEST_SCHEMA,
    architectureBasis,
    ...(draft.predecessor ? { predecessor: draft.predecessor } : {}),
    target: {
      partDefinitionElementId: draft.target.partDefinitionElementId,
      label: draft.target.label,
      scriptHash: draft.target.scriptHash,
      files: draft.target.files.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: { algorithm: "sha256", digest: file.digest },
      })),
    },
    unitSystem: "mm",
    exportFormats: ["step", "gltf"],
  };
  const decisionParameters = encodeGeometryPartDecisionParameters(
    draft.draftDigest,
    manifest,
  );
  return deepFreeze({
    draftDigest: draft.draftDigest,
    target: {
      partDefinitionElementId: draft.target.partDefinitionElementId,
      label: draft.target.label,
      files: draft.target.files,
    },
    // Transport compatibility only. The target manifest itself deliberately has
    // no assembly or partDefinitions array.
    assemblyFiles: [],
    partMeshes: [],
    partDefinitions: [{
      elementId: draft.target.partDefinitionElementId,
      label: draft.target.label,
      files: draft.target.files,
    }],
    sourceAnalysis: draft.sourceAnalysis,
    decisionParameters,
  });
}

function selectExactRepresentedPart(
  architecture: ArchitecturePartGraph,
  elementId: string,
): { readonly elementId: string; readonly label: string } | undefined {
  const matches = architecture.partDefinitions.filter((definition) =>
    definition.id === elementId && definition.label.trim() !== ""
  );
  if (matches.length !== 1) return undefined;
  return { elementId: matches[0]!.id, label: matches[0]!.label };
}

function selectSystemOnlyRepresentedPart(
  architecture: ArchitecturePartGraph,
  elementId: string,
): { readonly elementId: string; readonly label: string } | undefined {
  if (architecture.partDefinitions.length !== 1) return undefined;
  const only = architecture.partDefinitions[0]!;
  if (
    only.id !== elementId ||
    only.label.trim() === "" ||
    only.usages.length !== 0 ||
    architecture.partDefinitions.some((definition) => definition.usages.length > 0)
  ) {
    return undefined;
  }
  return { elementId: only.id, label: only.label };
}

type TargetedPartPredecessor =
  | { readonly status: "absent" }
  | {
    readonly status: "ok";
    readonly schemaVersion: typeof GEOMETRY_PART_CAPTURE_SCHEMA;
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly partDefinitionElementId: string;
  };

class TargetedPartPredecessorError extends Error {
  constructor(
    readonly code: Extract<
      ProjectAdmittedGeometryExportErrorCode,
      | "geometry_part_predecessor_unavailable"
      | "geometry_part_tip_ambiguous"
      | "geometry_part_v2_bundle_conflict"
      | "geometry_part_target_conflict"
    >,
    message: string,
  ) {
    super(message);
    this.name = "TargetedPartPredecessorError";
  }
}

const GEOMETRY_CAPTURE_URI_PREFIX = "casys://geometry-capture/sha256/";
const ANALYZED_GEOMETRY_BUNDLE_CAPTURE_SCHEMA = "geometry-capture/2.1" as const;

type TargetedCanonicalManifest = GeometryBundleManifest | GeometryPartManifest;

interface AttestedCanonicalGeometryCapture {
  readonly manifest: TargetedCanonicalManifest;
}

/**
 * Targeted preview may coexist with captures for other parts, but it never
 * infers a predecessor from an assembly bundle or a different PartDefinition.
 *
 * The capture reader is deliberately not a source of authority by itself:
 * every active primary is re-hashed and re-attested before even its manifest
 * is inspected. This is the P2a read seam only; it does not write a future
 * targeted canonical capture or promote a draft.
 */
async function selectTargetedPartPredecessor(
  snapshot: ThreadSnapshot,
  target: { readonly elementId: string; readonly label: string },
  captures: CanonicalGeometryCaptureReader,
): Promise<TargetedPartPredecessor> {
  const archived = archivedRefKeys(snapshot);
  const active = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith(GEOMETRY_CAPTURE_URI_PREFIX) &&
    !archived.has(`artifact:${artifact.id}`)
  );
  const matching: Array<{
    readonly schemaVersion: typeof GEOMETRY_PART_CAPTURE_SCHEMA;
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    readonly partDefinitionElementId: string;
  }> = [];

  for (const artifact of active) {
    const capture = await readAttestedCanonicalGeometryCapture(
      snapshot,
      artifact,
      captures,
    );
    const manifest = capture.manifest;
    if (manifest.schemaVersion === GEOMETRY_BUNDLE_MANIFEST_SCHEMA) {
      const bundledTarget = manifest.partDefinitions.find((definition) =>
        definition.elementId === target.elementId
      );
      if (bundledTarget) {
        if (bundledTarget.label !== target.label) {
          throw new TargetedPartPredecessorError(
            "geometry_part_target_conflict",
            "An active V2 geometry bundle names the represented PartDefinition with a different label.",
          );
        }
        throw new TargetedPartPredecessorError(
          "geometry_part_v2_bundle_conflict",
          "An active V2 geometry bundle already covers the represented PartDefinition.",
        );
      }
      continue;
    }
    if (manifest.target.partDefinitionElementId !== target.elementId) continue;
    if (manifest.target.label !== target.label) {
      throw new TargetedPartPredecessorError(
        "geometry_part_target_conflict",
        "An active targeted geometry capture names the represented PartDefinition with a different label.",
      );
    }
    matching.push({
      schemaVersion: GEOMETRY_PART_CAPTURE_SCHEMA,
      artifactId: artifact.id,
      fingerprint: artifact.fingerprint,
      partDefinitionElementId: target.elementId,
    });
  }
  if (matching.length === 0) return { status: "absent" };
  if (matching.length > 1) {
    throw new TargetedPartPredecessorError(
      "geometry_part_tip_ambiguous",
      "More than one active canonical geometry capture exists for the represented PartDefinition.",
    );
  }
  return { status: "ok", ...matching[0]! };
}

async function readAttestedCanonicalGeometryCapture(
  snapshot: ThreadSnapshot,
  artifact: ThreadArtifact,
  captures: CanonicalGeometryCaptureReader,
): Promise<AttestedCanonicalGeometryCapture> {
  const digest = artifact.fingerprint.digest;
  if (
    artifact.fingerprint.algorithm !== "sha256" ||
    !isCanonicalDigest(digest) ||
    artifact.id !== `geometry-${digest}` ||
    artifact.version !== digest ||
    artifact.uri !== `${GEOMETRY_CAPTURE_URI_PREFIX}${digest}` ||
    artifact.mediaType !== "application/json" ||
    artifact.producer.serverId !== "digital-thread" ||
    artifact.producer.tool !==
      `${DESIGN_WRITE_GEOMETRY_OPERATION.id}@${DESIGN_WRITE_GEOMETRY_OPERATION.version}` ||
    !isNonEmptyText(artifact.producer.runId) ||
    artifact.freshness.status !== "fresh" ||
    !Array.isArray(artifact.freshness.invalidatedByChangeIds) ||
    artifact.freshness.invalidatedByChangeIds.length !== 0
  ) {
    throw targetedPredecessorUnavailable();
  }

  let text: string | undefined;
  try {
    text = await captures.read(artifact.fingerprint);
  } catch {
    throw targetedPredecessorUnavailable();
  }
  if (!text) throw targetedPredecessorUnavailable();

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
    if (deterministicJson(parsed) !== text) throw new TypeError("non-canonical JSON");
  } catch {
    throw targetedPredecessorUnavailable();
  }
  let observed: ContentFingerprint;
  try {
    observed = await sha256Fingerprint(parsed);
  } catch {
    throw targetedPredecessorUnavailable();
  }
  if (!fingerprintsEqual(observed, artifact.fingerprint)) {
    throw targetedPredecessorUnavailable();
  }

  let record: Record<string, unknown>;
  try {
    record = exactRecord(
      parsed,
      canonicalCaptureKeys(parsed),
      "$canonicalGeometryCapture",
    );
    const operation = exactRecord(
      record.operation,
      ["id", "version"],
      "$canonicalGeometryCapture.operation",
    );
    if (
      operation.id !== DESIGN_WRITE_GEOMETRY_OPERATION.id ||
      operation.version !== DESIGN_WRITE_GEOMETRY_OPERATION.version ||
      record.trustedRunId !== artifact.producer.runId ||
      !isNonEmptyText(record.trustedRunId) ||
      !isCanonicalInstant(record.sealedAt) ||
      artifact.freshness.changedAt !== record.sealedAt
    ) {
      throw new TypeError("producer or freshness identity diverges");
    }
    const architectureBasis = exactRecord(
      record.architectureBasis,
      ["artifactId", "fingerprint", "producerRunId"],
      "$canonicalGeometryCapture.architectureBasis",
    );
    const architectureFingerprint = parseCanonicalFingerprint(
      architectureBasis.fingerprint,
      "$canonicalGeometryCapture.architectureBasis.fingerprint",
    );
    if (
      !isNonEmptyText(architectureBasis.artifactId) ||
      !isNonEmptyText(architectureBasis.producerRunId) ||
      snapshot.artifacts.filter((candidate) =>
          candidate.id === architectureBasis.artifactId &&
          fingerprintsEqual(candidate.fingerprint, architectureFingerprint) &&
          candidate.producer.runId === architectureBasis.producerRunId
        ).length !== 1 ||
      !Array.isArray(artifact.inputArtifactIds) ||
      artifact.inputArtifactIds[0] !== architectureBasis.artifactId
    ) {
      throw new TypeError("architecture lineage diverges");
    }
    if (!isCanonicalDigest(record.draftDigest)) {
      throw new TypeError("draft digest is invalid");
    }
    assertCanonicalPreviewProducer(record.previewProducer);
  } catch {
    throw targetedPredecessorUnavailable();
  }

  const schema = record.schemaVersion;
  const manifestValue = record.manifest;
  try {
    if (schema === ANALYZED_GEOMETRY_BUNDLE_CAPTURE_SCHEMA) {
      const manifest = manifestValue as GeometryBundleManifest;
      assertGeometryBundleManifest(manifest, { requireCompleted: true });
      if (
        !fingerprintsEqual(
          manifest.architectureBasis.artifactFingerprint,
          parseCanonicalFingerprint(
            (record.architectureBasis as Record<string, unknown>).fingerprint,
            "$canonicalGeometryCapture.architectureBasis.fingerprint",
          ),
        ) ||
        deterministicJson(artifact.inputArtifactIds) !==
          deterministicJson([
            (record.architectureBasis as Record<string, unknown>).artifactId,
            ...(manifest.predecessor ? [manifest.predecessor.artifactId] : []),
          ])
      ) {
        throw new TypeError("bundle capture lineage diverges");
      }
      return { manifest };
    }
    if (schema === GEOMETRY_PART_CAPTURE_SCHEMA) {
      const manifest = parseGeometryPartManifest(manifestValue, {
        requireCompleted: true,
      });
      if (
        !fingerprintsEqual(
          manifest.architectureBasis.artifactFingerprint,
          parseCanonicalFingerprint(
            (record.architectureBasis as Record<string, unknown>).fingerprint,
            "$canonicalGeometryCapture.architectureBasis.fingerprint",
          ),
        ) ||
        deterministicJson(artifact.inputArtifactIds) !==
          deterministicJson([
            (record.architectureBasis as Record<string, unknown>).artifactId,
            ...(manifest.predecessor ? [manifest.predecessor.artifactId] : []),
          ])
      ) {
        throw new TypeError("targeted capture lineage diverges");
      }
      return { manifest };
    }
  } catch {
    throw targetedPredecessorUnavailable();
  }
  throw targetedPredecessorUnavailable();
}

function canonicalCaptureKeys(value: unknown): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("capture must be an object");
  }
  const schema = (value as Record<string, unknown>).schemaVersion;
  if (schema === ANALYZED_GEOMETRY_BUNDLE_CAPTURE_SCHEMA) {
    return [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "previewProducer",
      "sourceScripts",
      "sourceAnalyses",
      "sealedAt",
    ];
  }
  if (schema === GEOMETRY_PART_CAPTURE_SCHEMA) {
    return [
      "schemaVersion",
      "operation",
      "trustedRunId",
      "draftDigest",
      "manifest",
      "architectureBasis",
      "previewProducer",
      "sourceScript",
      "sourceAnalysis",
      "sealedAt",
    ];
  }
  throw new TypeError("unsupported canonical capture schema");
}

function parseCanonicalFingerprint(
  value: unknown,
  path: string,
): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  if (fingerprint.algorithm !== "sha256" || !isCanonicalDigest(fingerprint.digest)) {
    throw new TypeError(`${path} is not a SHA-256 fingerprint`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function assertCanonicalPreviewProducer(value: unknown): void {
  const producer = exactRecord(
    value,
    ["serverId", "tool", "runId"],
    "$canonicalGeometryCapture.previewProducer",
  );
  if (
    producer.serverId !== "build123d-sandbox" ||
    producer.tool !== "build123d_export" ||
    !isNonEmptyText(producer.runId)
  ) {
    throw new TypeError("preview producer is not the trusted sandbox export");
  }
}

function isCanonicalDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

function isCanonicalInstant(value: unknown): value is string {
  return typeof value === "string" &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function targetedPredecessorUnavailable(): TargetedPartPredecessorError {
  return new TargetedPartPredecessorError(
    "geometry_part_predecessor_unavailable",
    "An active canonical geometry capture could not be proven as an exact same-target predecessor.",
  );
}

function selectActiveGeometryPredecessor(snapshot: ThreadSnapshot):
  | { readonly status: "absent" }
  | {
    readonly status: "ok";
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  }
  | { readonly status: "ambiguous" } {
  const archived = archivedRefKeys(snapshot);
  const active = snapshot.artifacts.filter((artifact) =>
    artifact.kind === "cad-model" &&
    artifact.uri?.startsWith("casys://geometry-capture/") &&
    !archived.has(`artifact:${artifact.id}`)
  );
  if (active.length === 0) return { status: "absent" };
  if (active.length > 1) return { status: "ambiguous" };
  const artifact = active[0]!;
  return {
    status: "ok",
    artifactId: artifact.id,
    fingerprint: artifact.fingerprint,
  };
}

function exportError(
  code: ProjectAdmittedGeometryExportErrorCode,
  message: string,
): ProjectAdmittedGeometryExportError {
  return new ProjectAdmittedGeometryExportError(code, message);
}
