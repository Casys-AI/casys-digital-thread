/**
 * Reopen one sealed Build123d compilation and export its exact admitted bytes.
 *
 * Callers cannot supply Python, provider, tool, path, image or formats. The
 * use case reopens `compile.seal-admission@1`, extracts the singular admitted
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
} from "../../../../domain/cad/canonical/geometry-draft-admission.ts";
import {
  encodeGeometryBundleDecisionParameters,
  GEOMETRY_BUNDLE_MANIFEST_SCHEMA,
  GEOMETRY_BUNDLE_PLACEMENT_CONVENTION,
  type GeometryBundleManifest,
} from "../../../../domain/cad/canonical/geometry-bundle.ts";
import {
  archivedRefKeys,
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
}

export class ExportAdmittedProjectGeometry
  implements ProjectAdmittedGeometryExportUseCase {
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #exporter: AdmittedGeometryExporter;
  readonly #snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly #architecture: ArchitecturePartGraphReader;

  constructor(dependencies: ExportAdmittedProjectGeometryDependencies) {
    this.#admissions = dependencies.admissions;
    this.#exporter = dependencies.exporter;
    this.#snapshots = dependencies.snapshots;
    this.#architecture = dependencies.architecture;
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
    const representedPart = selectSystemOnlyRepresentedPart(
      architectureGraph,
      represented.elementId,
    );
    if (!representedPart) {
      throw exportError(
        "architecture_not_system_only",
        "Admitted geometry export requires a system-only architecture whose unique PartDefinition is the represents target.",
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
        representedPart,
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

    let result: ProjectAdmittedGeometryExportResult;
    try {
      result = assembleResult(draft, architectureBasis);
    } catch {
      throw exportError(
        "export_failed",
        "The admitted geometry draft did not produce an exact write-geometry review identity.",
      );
    }
    return result;
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
      "A system-only admitted draft cannot carry legacy part meshes.",
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
