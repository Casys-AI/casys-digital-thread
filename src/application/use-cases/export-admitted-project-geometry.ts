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
} from "../ports/in/project-admitted-geometry-export.ts";
import type {
  AdmittedGeometryExportDraft,
  AdmittedGeometryExporter,
} from "../ports/out/admitted-geometry-exporter.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../ports/out/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../ports/out/technical-compilation-draft-store.ts";
import {
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalCompilationDocument,
  fingerprintTechnicalSourceText,
  type TechnicalCompilationDocument,
  type TechnicalCompilationProjection,
  validateTechnicalCompilationDocument,
} from "../../domain/analysis/technical-compilation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  type TechnicalCompilationAdmission,
} from "../../domain/analysis/technical-compilation-proposal.ts";
import { BUILD123D_EXECUTION_COMPILED_ADMISSION_SCHEMA } from "../../domain/analysis/build123d-execution-proposal.ts";
import { validateContentFingerprint } from "../../domain/analysis/isolated-code-execution.ts";
import { listGeometryAffectingNamedNumericLevers } from "../../domain/analysis/named-cad-levers.ts";
import {
  GEOMETRY_DRAFT_ADMISSION_SCHEMA,
} from "../../domain/engineering/geometry-draft-admission.ts";
import {
  encodeGeometryDecisionParameters,
  GEOMETRY_MANIFEST_SCHEMA,
  type GeometryManifest,
} from "../../domain/engineering/geometry-proposal.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../domain/project/engineering-project.ts";

export type ProjectAdmittedGeometryExportErrorCode =
  | "invalid_request"
  | "admission_not_found"
  | "admission_resolution_failed"
  | "admission_integrity_failed"
  | "admission_not_parameterized"
  | "export_failed";

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
}

export class ExportAdmittedProjectGeometry
  implements ProjectAdmittedGeometryExportUseCase {
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #exporter: AdmittedGeometryExporter;

  constructor(dependencies: ExportAdmittedProjectGeometryDependencies) {
    this.#admissions = dependencies.admissions;
    this.#exporter = dependencies.exporter;
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
  const basis = parseThreadBasis(command.basis, "$admittedGeometryExport.basis");
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

function parseThreadBasis(
  value: unknown,
  path: string,
): EngineeringThreadSnapshotBasis {
  const basis = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId"],
    path,
  );
  literalValue(basis.kind, "thread-snapshot", `${path}.kind`);
  const snapshotId = safeId(basis.snapshotId, `${path}.snapshotId`);
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(`${path}.snapshotId must name an exact snapshot.`);
  }
  return deepFreeze({
    kind: "thread-snapshot",
    snapshotId,
    revision: positiveInteger(basis.revision, `${path}.revision`),
    subjectId: safeId(basis.subjectId, `${path}.subjectId`),
  });
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
  architectureBasis: GeometryManifest["architectureBasis"],
): ProjectAdmittedGeometryExportResult {
  const manifest: GeometryManifest = {
    schemaVersion: GEOMETRY_MANIFEST_SCHEMA,
    architectureBasis,
    components: [],
    unitSystem: "mm",
    exportFormats: [...draft.exportFormats],
    scriptHash: draft.scriptHash,
    artifactHashes: {
      assemblyFiles: draft.assemblyFiles.map((file) => ({
        format: file.format,
        name: file.name,
        fingerprint: { algorithm: "sha256", digest: file.digest },
      })),
      partMeshes: draft.partMeshes.map((mesh) => ({
        semanticKey: mesh.usageName,
        name: mesh.name,
        fingerprint: { algorithm: "sha256", digest: mesh.digest },
      })),
    },
  };
  const decisionParameters = encodeGeometryDecisionParameters(
    draft.draftDigest,
    manifest,
  );
  return deepFreeze({
    draftDigest: draft.draftDigest,
    assemblyFiles: draft.assemblyFiles,
    partMeshes: draft.partMeshes,
    sourceAnalysis: draft.sourceAnalysis,
    decisionParameters,
  });
}

function exportError(
  code: ProjectAdmittedGeometryExportErrorCode,
  message: string,
): ProjectAdmittedGeometryExportError {
  return new ProjectAdmittedGeometryExportError(code, message);
}
