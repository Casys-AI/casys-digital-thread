/**
 * Provider-free preparation of an admitted SPICE execution review.
 *
 * Reopens one sealed compilation admission, joins it to the server-owned
 * SPICE closed-subset execution profile, and derives MRTR parameters plus
 * the registered work-item operation bound to the current review basis.
 * No source bytes, runtime capability, or dispatch authority are returned.
 */

import type {
  ProjectAdmittedSpiceRunReviewCommand,
  ProjectAdmittedSpiceRunReviewResult,
  ProjectAdmittedSpiceRunReviewUseCase,
} from "../../../../ports/in/electrical/spice/admitted-run-review.ts";
import {
  encodeSpiceAdmittedRunAdmissionParameters,
  parseSpiceAdmittedRunAdmissionParameters,
  SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
  SPICE_ADMITTED_COMPILATION_PROFILE_ID,
  SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
  SPICE_ADMITTED_EXECUTION_PROFILE,
  SPICE_ADMITTED_OUTPUT_MANIFEST,
  SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
  type SpiceAdmittedRunAdmission,
} from "../../../../../domain/electrical/spice/admitted/run-proposal.ts";
import {
  isolatedCodeOutputManifestsEqual,
  validateContentFingerprint,
  validateIsolatedCodeOutputManifest,
  validateIsolatedCodePolicyRef,
  validateIsolatedCodeProfileRef,
  validateIsolatedCodeRuntimeAttestation,
} from "../../../../../domain/compile/isolation/isolated-code-execution.ts";
import {
  MICROSANDBOX_LOCAL_ISOLATION_CLASS,
  validateMicrosandboxLocalRuntimeIdentity,
} from "../../../../../domain/compile/isolation/local-isolation-runtime.ts";
import {
  fingerprintTechnicalCompilationBasis,
  fingerprintTechnicalCompilationDocument,
  fingerprintTechnicalSourceText,
  TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
  TECHNICAL_COMPILATION_SCHEMA,
  type TechnicalCompilationDocument,
  type TechnicalCompilationProjection,
  validateTechnicalCompilationDocument,
  validateTechnicalCompilationProfileCatalog,
} from "../../../../../domain/compile/admission/technical-compilation.ts";
import { assembleCompilationAdmissionRunOperation } from "../../../../../domain/compile/admission/compilation-admission-run-operation.ts";
import {
  COMPILE_SEAL_ADMISSION_OPERATION,
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  type TechnicalCompilationAdmission,
} from "../../../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import { parseExactThreadSnapshotBasis } from "../../../../../domain/project/thread-tip.ts";
import {
  ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
  type AdmittedSpiceExecutionProfile,
  type AdmittedSpiceExecutionProfileCatalog,
  type AdmittedSpiceExecutionProfileFingerprintBody,
} from "../../../../ports/out/electrical/spice/admitted-execution-profile-catalog.ts";
import type {
  ReopenedTechnicalCompilationAdmission,
  TechnicalCompilationAdmissionReader,
} from "../../../../ports/out/compile/admission/technical-compilation-admission-reader.ts";
import { TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA } from "../../../../ports/out/compile/admission/technical-compilation-draft-store.ts";

export type ProjectAdmittedSpiceRunReviewErrorCode =
  | "invalid_request"
  | "admission_not_found"
  | "admission_resolution_failed"
  | "admission_integrity_failed"
  | "execution_profile_unavailable"
  | "execution_profile_integrity_failed";

export class ProjectAdmittedSpiceRunReviewError extends Error {
  constructor(
    readonly code: ProjectAdmittedSpiceRunReviewErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ProjectAdmittedSpiceRunReviewError";
  }
}

export interface PrepareProjectAdmittedSpiceRunReviewDependencies {
  readonly admissions: TechnicalCompilationAdmissionReader;
  readonly profiles: AdmittedSpiceExecutionProfileCatalog;
}

export class PrepareProjectAdmittedSpiceRunReview
  implements ProjectAdmittedSpiceRunReviewUseCase {
  readonly #admissions: TechnicalCompilationAdmissionReader;
  readonly #profiles: AdmittedSpiceExecutionProfileCatalog;

  constructor(dependencies: PrepareProjectAdmittedSpiceRunReviewDependencies) {
    this.#admissions = dependencies.admissions;
    this.#profiles = dependencies.profiles;
  }

  async execute(value: unknown): Promise<ProjectAdmittedSpiceRunReviewResult> {
    let command: ProjectAdmittedSpiceRunReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      throw reviewError(
        "invalid_request",
        "The admitted SPICE execution-review request failed exact validation.",
      );
    }

    let reopened: ReopenedTechnicalCompilationAdmission | undefined;
    try {
      reopened = await this.#admissions.read(command);
    } catch {
      throw reviewError(
        "admission_resolution_failed",
        "The exact technical-compilation admission could not be reopened.",
      );
    }
    if (!reopened) {
      throw reviewError(
        "admission_not_found",
        "The exact technical-compilation admission is unavailable.",
      );
    }

    let compilation: ReadySpiceCompilation;
    try {
      compilation = await reopenReadySpiceCompilation(reopened, command);
    } catch {
      throw reviewError(
        "admission_integrity_failed",
        "The reopened technical-compilation admission is not an exact, singular, ready SPICE compilation.",
      );
    }

    let rawProfile: AdmittedSpiceExecutionProfile;
    try {
      rawProfile = await this.#profiles.initial();
    } catch {
      throw reviewError(
        "execution_profile_unavailable",
        "The server-owned admitted SPICE execution profile is unavailable.",
      );
    }

    try {
      const profile = await validateExecutionProfile(rawProfile);
      assertExecutionProfileMatchesCompilation(profile, compilation);
      const admission = deriveExecutionAdmission(command, compilation, profile);
      const decisionParameters = encodeSpiceAdmittedRunAdmissionParameters(
        admission,
      );
      const reparsed = parseSpiceAdmittedRunAdmissionParameters(
        decisionParameters,
      );
      const reencoded = encodeSpiceAdmittedRunAdmissionParameters(reparsed);
      if (deterministicJson(reencoded) !== deterministicJson(decisionParameters)) {
        throw new TypeError("Admitted SPICE MRTR replay is not canonical.");
      }
      return deepFreeze({
        admission: reparsed,
        decisionParameters: reencoded,
        operation: assembleCompilationAdmissionRunOperation({
          operation: SIMULATE_RUN_ADMITTED_SPICE_OPERATION,
          basis: command.basis,
          artifactId: command.artifactId,
        }),
      });
    } catch {
      throw reviewError(
        "execution_profile_integrity_failed",
        "The server-owned SPICE execution profile does not exactly match the sealed compilation.",
      );
    }
  }
}

interface ReadySpiceCompilation {
  readonly admission: TechnicalCompilationAdmission;
  readonly document: TechnicalCompilationDocument;
  readonly documentFingerprint: ContentFingerprint;
  readonly projection: TechnicalCompilationProjection;
  readonly projectionFingerprint: ContentFingerprint;
  readonly source: TechnicalCompilationAdmission["sources"][number];
}

function parseCommand(value: unknown): ProjectAdmittedSpiceRunReviewCommand {
  const command = exactRecord(
    value,
    ["projectId", "basis", "artifactId", "artifactFingerprint"],
    "$admittedSpiceRunReview",
  );
  const projectId = safeId(
    command.projectId,
    "$admittedSpiceRunReview.projectId",
  );
  const basis = parseExactThreadSnapshotBasis(
    command.basis,
    "$admittedSpiceRunReview.basis",
  );
  const artifactFingerprint = validateContentFingerprint(
    command.artifactFingerprint,
    "$admittedSpiceRunReview.artifactFingerprint",
  );
  const artifactId = safeId(
    command.artifactId,
    "$admittedSpiceRunReview.artifactId",
  );
  if (
    artifactId !==
      `technical-compilation-admission-${artifactFingerprint.digest}`
  ) {
    throw new TypeError("The admission artifact id must derive from its hash.");
  }
  return deepFreeze({ projectId, basis, artifactId, artifactFingerprint });
}

async function reopenReadySpiceCompilation(
  value: unknown,
  command: ProjectAdmittedSpiceRunReviewCommand,
): Promise<ReadySpiceCompilation> {
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
    SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
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
    throw new TypeError(
      "The admitted SPICE profile requires one projection, source, and profile request.",
    );
  }
  const projection = document.projections[0]!;
  if (
    projection.target !== "spice-circuit-source" ||
    projection.profile.target !== "spice-circuit-source" ||
    projection.profile.id !== SPICE_ADMITTED_COMPILATION_PROFILE_ID ||
    projection.status !== "ready-for-review" ||
    projection.diagnostics.length !== 0 ||
    projection.sources.length !== 1 ||
    projection.sources[0]!.analysis.unresolvedConstructs.length !== 0
  ) {
    throw new TypeError("The sole projection is not a ready SPICE projection.");
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
    throw new TypeError("The sole SPICE source or profile identity disagrees.");
  }
  const sourceFingerprint = await fingerprintTechnicalSourceText(
    projectedSource.sourceText,
  );
  if (!fingerprintsEqual(sourceFingerprint, admittedSource.sourceFingerprint)) {
    throw new TypeError("The SPICE source bytes disagree with their identity.");
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

async function validateExecutionProfile(
  value: unknown,
): Promise<AdmittedSpiceExecutionProfile> {
  const profile = exactRecord(value, [
    "schemaVersion",
    "executionProfile",
    "compilationTarget",
    "compilationProfile",
    "compilationProfileFingerprint",
    "isolationPolicy",
    "runtimeBackend",
    "runtime",
    "outputManifest",
    "outputValidator",
    "maximumSourceBytes",
    "minimumDestructionAssurance",
    "profileFingerprint",
  ], "$executionProfile");
  literalValue(
    profile.schemaVersion,
    ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    "$executionProfile.schemaVersion",
  );
  const executionProfile = validateIsolatedCodeProfileRef(
    profile.executionProfile,
    "$executionProfile.executionProfile",
  );
  if (
    executionProfile.id !== SPICE_ADMITTED_EXECUTION_PROFILE.id ||
    executionProfile.version !== SPICE_ADMITTED_EXECUTION_PROFILE.version
  ) {
    throw new TypeError(
      "The execution profile is not registered for admitted SPICE operating-point.",
    );
  }
  literalValue(
    profile.compilationTarget,
    "spice-circuit-source",
    "$executionProfile.compilationTarget",
  );
  const compilationProfile = validateTechnicalCompilationProfileCatalog({
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles: [profile.compilationProfile],
  }).profiles[0]!;
  const compilationProfileFingerprint = validateContentFingerprint(
    profile.compilationProfileFingerprint,
    "$executionProfile.compilationProfileFingerprint",
  );
  if (
    !fingerprintsEqual(
      compilationProfileFingerprint,
      await sha256Fingerprint(compilationProfile),
    )
  ) {
    throw new TypeError("The compilation profile fingerprint is stale.");
  }
  const isolationPolicy = validateIsolatedCodePolicyRef(
    profile.isolationPolicy,
    "$executionProfile.isolationPolicy",
  );
  const runtimeBackend = validateMicrosandboxLocalRuntimeIdentity(
    profile.runtimeBackend,
    "$executionProfile.runtimeBackend",
  );
  const runtime = validateIsolatedCodeRuntimeAttestation(
    profile.runtime,
    "$executionProfile.runtime",
  );
  if (runtimeBackend.imageDigest.digest !== runtime.imageDigest.digest) {
    throw new TypeError(
      "The execution runtime backend and attestation name different OCI images.",
    );
  }
  const outputManifest = validateIsolatedCodeOutputManifest(
    profile.outputManifest,
    "$executionProfile.outputManifest",
  );
  if (
    !isolatedCodeOutputManifestsEqual(
      outputManifest,
      SPICE_ADMITTED_OUTPUT_MANIFEST,
    )
  ) {
    throw new TypeError(
      "The admitted SPICE output manifest must be evidence plus result.",
    );
  }
  const outputValidatorRecord = exactRecord(
    profile.outputValidator,
    ["id", "version"],
    "$executionProfile.outputValidator",
  );
  const outputValidator = deepFreeze({
    id: safeId(
      outputValidatorRecord.id,
      "$executionProfile.outputValidator.id",
    ),
    version: safeVersion(
      outputValidatorRecord.version,
      "$executionProfile.outputValidator.version",
    ),
  });
  const maximumSourceBytes = positiveInteger(
    profile.maximumSourceBytes,
    "$executionProfile.maximumSourceBytes",
  );
  if (
    profile.minimumDestructionAssurance !== "acknowledged-unattested" &&
    profile.minimumDestructionAssurance !== "proven"
  ) {
    throw new TypeError("The destruction-assurance threshold is unsupported.");
  }
  const body = deepFreeze<AdmittedSpiceExecutionProfileFingerprintBody>({
    schemaVersion: ADMITTED_SPICE_EXECUTION_PROFILE_SCHEMA,
    executionProfile,
    compilationTarget: "spice-circuit-source",
    compilationProfile,
    compilationProfileFingerprint,
    isolationPolicy,
    runtimeBackend,
    runtime,
    outputManifest,
    outputValidator,
    maximumSourceBytes,
    minimumDestructionAssurance: profile.minimumDestructionAssurance,
  });
  const profileFingerprint = validateContentFingerprint(
    profile.profileFingerprint,
    "$executionProfile.profileFingerprint",
  );
  if (!fingerprintsEqual(profileFingerprint, await sha256Fingerprint(body))) {
    throw new TypeError("The execution profile fingerprint is stale.");
  }
  return deepFreeze({ ...body, profileFingerprint });
}

function assertExecutionProfileMatchesCompilation(
  profile: AdmittedSpiceExecutionProfile,
  compilation: ReadySpiceCompilation,
): void {
  const projection = compilation.projection;
  if (
    profile.compilationTarget !== projection.target ||
    deterministicJson(profile.compilationProfile) !==
      deterministicJson(projection.profile) ||
    !fingerprintsEqual(
      profile.compilationProfileFingerprint,
      projection.profileFingerprint,
    ) ||
    new TextEncoder().encode(projection.sources[0]!.sourceText).byteLength >
      profile.maximumSourceBytes
  ) {
    throw new TypeError("The execution profile does not admit this compilation.");
  }
}

function deriveExecutionAdmission(
  command: ProjectAdmittedSpiceRunReviewCommand,
  compilation: ReadySpiceCompilation,
  profile: AdmittedSpiceExecutionProfile,
): SpiceAdmittedRunAdmission {
  const admission: SpiceAdmittedRunAdmission = {
    schemaVersion: SPICE_ADMITTED_RUN_ADMISSION_SCHEMA,
    admissionArtifact: {
      schemaVersion: SPICE_ADMITTED_COMPILED_ADMISSION_SCHEMA,
      id: command.artifactId,
      fingerprint: command.artifactFingerprint,
    },
    compilation: {
      document: {
        schemaVersion: TECHNICAL_COMPILATION_SCHEMA,
        fingerprint: compilation.documentFingerprint,
        status: "ready-for-review",
      },
      projection: {
        target: "spice-circuit-source",
        fingerprint: compilation.projectionFingerprint,
        status: "ready-for-review",
      },
      source: {
        id: compilation.source.id,
        sourceFingerprint: compilation.source.sourceFingerprint,
        captureFingerprint: compilation.source.captureFingerprint,
        analysisFingerprint: compilation.source.analysisFingerprint,
      },
      profile: {
        id: SPICE_ADMITTED_COMPILATION_PROFILE_ID,
        version: compilation.projection.profile.version,
        fingerprint: compilation.projection.profileFingerprint,
      },
    },
    execution: {
      profile: {
        id: SPICE_ADMITTED_EXECUTION_PROFILE.id,
        version: SPICE_ADMITTED_EXECUTION_PROFILE.version,
        fingerprint: profile.profileFingerprint,
      },
      isolationPolicy: profile.isolationPolicy,
      runtimeBackend: profile.runtimeBackend,
      runtime: {
        imageDigest: profile.runtime.imageDigest,
        isolationClass: MICROSANDBOX_LOCAL_ISOLATION_CLASS,
        limits: profile.runtime.requestedLimits,
        limitAssurance: profile.runtime.limitAssurance,
      },
      outputValidator: profile.outputValidator,
      outputs: SPICE_ADMITTED_OUTPUT_MANIFEST,
      minimumDestructionAssurance: profile.minimumDestructionAssurance,
    },
    status: "ready-for-execution-review",
  };
  const parameters = encodeSpiceAdmittedRunAdmissionParameters(admission);
  return parseSpiceAdmittedRunAdmissionParameters(parameters);
}

function reviewError(
  code: ProjectAdmittedSpiceRunReviewErrorCode,
  message: string,
): ProjectAdmittedSpiceRunReviewError {
  return new ProjectAdmittedSpiceRunReviewError(code, message);
}
