/**
 * Reopens one opaque technical-source locator for the pure compiler.
 *
 * Recrosses the exact project-source workspace snapshot. Captures cannot
 * be reused across projects and cannot be inferred from MIME, path or name.
 */

import type {
  ReopenedTechnicalCompilationSource,
  TechnicalCompilationSourceReader,
  TechnicalCompilationSourceReadRequest,
} from "../../../application/ports/out/compile/admission/technical-compilation-source-reader.ts";
import type { TechnicalCompilationProfileCatalogProvider } from "../../../application/ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { TechnicalSourceAnalysisCapture } from "../../../application/ports/out/compile/admission/technical-source-analysis-capture.ts";
import { TechnicalSourceAnalysisCaptureError } from "../../../application/ports/out/compile/admission/technical-source-analysis-capture.ts";
import {
  recrossTechnicalSourceWorkspace,
  TechnicalSourceWorkspaceRecrossError,
  validateTechnicalSourceAnalysisCaptureLocator,
} from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import { fingerprintSourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import {
  validateTechnicalCompilationProfileCatalog,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import { acceptedMimeTypesForTechnicalLanguage } from "../../../domain/resource/agent-resource-reference.ts";
import {
  AgentResourceReopenError,
  type ReopenAgentResource,
} from "../../../application/use-cases/resource/reopen-agent-resource.ts";

export type TechnicalCompilationSourceReadErrorCode =
  | "locator_invalid"
  | "locator_cas_tampered"
  | "capture_document_invalid"
  | "project_mismatch"
  | "workspace_integrity_failed"
  | "file_revision_not_active"
  | "workspace_event_fingerprint_mismatch"
  | "file_fingerprint_mismatch"
  | "resource_ref_mismatch"
  | "capture_request_profile_mismatch"
  | "role_mismatch"
  | "bytes_mismatch"
  | "profile_identity_mismatch"
  | "catalog_alignment_mismatch";

export class TechnicalCompilationSourceReadError extends Error {
  constructor(
    readonly code: TechnicalCompilationSourceReadErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "TechnicalCompilationSourceReadError";
  }
}

export interface CaptureBackedTechnicalCompilationSourceReaderDependencies {
  readonly captures: TechnicalSourceAnalysisCapture;
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly profiles: TechnicalCompilationProfileCatalogProvider;
}

export class CaptureBackedTechnicalCompilationSourceReader
  implements TechnicalCompilationSourceReader {
  readonly #captures: TechnicalSourceAnalysisCapture;
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: ReopenAgentResource;
  readonly #profiles: TechnicalCompilationProfileCatalogProvider;

  constructor(
    dependencies: CaptureBackedTechnicalCompilationSourceReaderDependencies,
  ) {
    this.#captures = dependencies.captures;
    this.#workspace = dependencies.workspace;
    this.#resources = dependencies.resources;
    this.#profiles = dependencies.profiles;
  }

  async read(
    value: TechnicalCompilationSourceReadRequest,
  ): Promise<ReopenedTechnicalCompilationSource> {
    const request = parseRequest(value);
    let locator;
    try {
      locator = validateTechnicalSourceAnalysisCaptureLocator(
        request.reference,
        "$technicalCompilationSourceRead.reference",
      );
    } catch (cause) {
      throw readError(
        "locator_invalid",
        "Technical source capture reference is not an opaque locator/2.0.",
        cause,
      );
    }
    const observedReferenceFingerprint = await sha256Fingerprint(locator);
    if (
      !fingerprintsEqual(
        observedReferenceFingerprint,
        request.referenceFingerprint,
      )
    ) {
      throw readError(
        "locator_invalid",
        "Technical source locator fingerprint does not match the exact capture handle.",
      );
    }

    let reopened;
    try {
      reopened = await this.#captures.reopenLocator(locator);
    } catch (cause) {
      throw mapLocatorReopenError(cause);
    }

    if (reopened.document.projectSource.projectId !== request.projectId) {
      throw readError(
        "project_mismatch",
        "Technical source capture is foreign to the requested project.",
      );
    }

    let state;
    try {
      state = await this.#workspace.loadAtFresh(
        reopened.document.projectSource.projectId,
        reopened.document.projectSource.workspaceRevision,
      );
    } catch (cause) {
      throw readError(
        "workspace_integrity_failed",
        "The exact captured workspace snapshot failed fresh hash-chained replay.",
        cause,
      );
    }

    try {
      recrossTechnicalSourceWorkspace(state, {
        ...reopened.document.projectSource,
        profileId: reopened.document.profile.id,
        role: reopened.document.source.role,
      });
    } catch (cause) {
      throw mapRecrossError(cause);
    }

    let resourceText: string;
    try {
      resourceText = (await this.#resources.reopenUtf8Text(
        reopened.document.projectSource.resourceRef,
        {
          acceptedMimeTypes: acceptedMimeTypesForTechnicalLanguage(
            reopened.document.source.language,
          ),
          maxBytes: Math.max(reopened.document.source.byteCount, 1),
        },
      )).text;
    } catch (cause) {
      if (cause instanceof AgentResourceReopenError) {
        throw readError(
          "bytes_mismatch",
          "Workspace AgentResource bytes could not be reopened for the captured revision.",
          cause,
        );
      }
      throw cause;
    }
    if (resourceText !== reopened.sourceText) {
      throw readError(
        "bytes_mismatch",
        "Workspace AgentResource bytes do not match the captured technical source CAS.",
      );
    }

    try {
      await this.#assertCatalogAlignment(reopened);
    } catch (cause) {
      if (cause instanceof TechnicalCompilationSourceReadError) throw cause;
      throw readError(
        "catalog_alignment_mismatch",
        "Captured technical source does not align with the exact compilation catalogue.",
        cause,
      );
    }

    const analysisFingerprint = await fingerprintSourceAnalysisBundle(
      reopened.analysis,
    );
    const sourceFingerprint: ContentFingerprint = {
      algorithm: "sha256",
      digest: reopened.document.source.sha256,
    };
    if (
      !fingerprintsEqual(
        sourceFingerprint,
        reopened.analysis.source.fingerprint,
      ) ||
      analysisFingerprint.digest !== reopened.document.analysis.sha256
    ) {
      throw readError(
        "profile_identity_mismatch",
        "Reopened technical source provenance does not match its captured analysis.",
      );
    }
    return deepFreeze({
      referenceFingerprint: observedReferenceFingerprint,
      source: {
        sourceText: reopened.sourceText,
        analysis: reopened.analysis,
        analysisFingerprint,
      },
      provenance: {
        profile: {
          id: reopened.document.profile.id,
          version: reopened.document.profile.version,
          fingerprint: reopened.document.profile.fingerprint,
        },
        analyzer: reopened.document.analysis.analyzer,
        sourceFingerprint,
        captureFingerprint: observedReferenceFingerprint,
        analysisFingerprint,
        projectSource: reopened.document.projectSource,
        locator: reopened.locator,
      },
    });
  }

  async #assertCatalogAlignment(
    reopened: Awaited<
      ReturnType<TechnicalSourceAnalysisCapture["reopenLocator"]>
    >,
  ): Promise<void> {
    const catalog = validateTechnicalCompilationProfileCatalog(
      await this.#profiles.get(),
    );
    const matches = catalog.profiles.filter((profile) =>
      profile.sourceRole === reopened.document.source.role &&
      profile.language === reopened.document.source.language
    );
    if (matches.length !== 1) {
      throw readError(
        "catalog_alignment_mismatch",
        "Captured technical source has no unique compilation catalogue profile.",
      );
    }
    const profile = matches[0]!;
    if (
      profile.id !== reopened.document.profile.id ||
      profile.version !== reopened.document.profile.version ||
      profile.analyzer.id !== reopened.document.analysis.analyzer.id ||
      profile.analyzer.version !== reopened.document.analysis.analyzer.version ||
      profile.analysisPolicyProfile !== reopened.document.analysis.policy.profile
    ) {
      throw readError(
        "catalog_alignment_mismatch",
        "Captured technical source does not match the exact compilation catalogue identity.",
      );
    }
  }
}

function parseRequest(
  value: unknown,
): TechnicalCompilationSourceReadRequest {
  const request = exactRecord(
    value,
    ["projectId", "basis", "reference", "referenceFingerprint"],
    "$technicalCompilationSourceRead",
  );
  safeId(request.projectId, "$technicalCompilationSourceRead.projectId");
  const basis = exactRecord(
    request.basis,
    ["kind", "snapshotId", "revision", "subjectId"],
    "$technicalCompilationSourceRead.basis",
  );
  literalValue(
    basis.kind,
    "thread-snapshot",
    "$technicalCompilationSourceRead.basis.kind",
  );
  const snapshotId = safeId(
    basis.snapshotId,
    "$technicalCompilationSourceRead.basis.snapshotId",
  );
  if (snapshotId.toLowerCase() === "latest") {
    throw new TypeError(
      "Technical compilation source reads require an exact snapshot id.",
    );
  }
  positiveInteger(
    basis.revision,
    "$technicalCompilationSourceRead.basis.revision",
  );
  safeId(
    basis.subjectId,
    "$technicalCompilationSourceRead.basis.subjectId",
  );
  if (
    request.reference === null || typeof request.reference !== "object" ||
    Array.isArray(request.reference) || Object.keys(request.reference).length === 0
  ) {
    throw new TypeError(
      "Technical source capture reference must be a non-empty object.",
    );
  }
  const referenceFingerprint = parseFingerprint(
    request.referenceFingerprint,
    "$technicalCompilationSourceRead.referenceFingerprint",
  );
  return {
    projectId: request.projectId as string,
    basis: request.basis as TechnicalCompilationSourceReadRequest["basis"],
    reference: request.reference as TechnicalCompilationSourceReadRequest["reference"],
    referenceFingerprint,
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  const digest = safeId(fingerprint.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function mapLocatorReopenError(cause: unknown): TechnicalCompilationSourceReadError {
  if (cause instanceof TechnicalSourceAnalysisCaptureError) {
    if (cause.code === "locator_cas_tampered") {
      return readError("locator_cas_tampered", cause.message, cause);
    }
    if (cause.code === "capture_document_invalid") {
      return readError("capture_document_invalid", cause.message, cause);
    }
    if (cause.code === "analysis_identity_mismatch") {
      return readError("profile_identity_mismatch", cause.message, cause);
    }
  }
  return readError(
    "capture_document_invalid",
    "Technical source locator could not reopen its exact capture document.",
    cause,
  );
}

function mapRecrossError(cause: unknown): TechnicalCompilationSourceReadError {
  if (cause instanceof TechnicalSourceWorkspaceRecrossError) {
    const mapped: Record<
      TechnicalSourceWorkspaceRecrossError["code"],
      TechnicalCompilationSourceReadErrorCode
    > = {
      project_mismatch: "project_mismatch",
      workspace_revision_mismatch: "workspace_integrity_failed",
      workspace_event_fingerprint_mismatch: "workspace_event_fingerprint_mismatch",
      file_not_found: "file_revision_not_active",
      file_revision_not_active: "file_revision_not_active",
      file_fingerprint_mismatch: "file_fingerprint_mismatch",
      resource_ref_mismatch: "resource_ref_mismatch",
      capture_request_missing: "capture_request_profile_mismatch",
      capture_request_profile_mismatch: "capture_request_profile_mismatch",
      role_mismatch: "role_mismatch",
    };
    return readError(mapped[cause.code], cause.message, cause);
  }
  return readError(
    "workspace_integrity_failed",
    "Technical source workspace recross failed.",
    cause,
  );
}

function readError(
  code: TechnicalCompilationSourceReadErrorCode,
  message: string,
  cause?: unknown,
): TechnicalCompilationSourceReadError {
  return new TechnicalCompilationSourceReadError(code, message, cause);
}
