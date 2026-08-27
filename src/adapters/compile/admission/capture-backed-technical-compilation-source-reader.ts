/**
 * Reopens one opaque technical-source locator for the pure compiler.
 *
 * Recrosses the exact historical workspace snapshot, sealed closure and
 * attachment named by the capture. Captures cannot be reused across
 * projects and cannot be inferred from MIME, path or name.
 */

import type {
  ReopenedTechnicalCompilationSource,
  TechnicalCompilationSourceReader,
  TechnicalCompilationSourceReadRequest,
} from "../../../application/ports/out/compile/admission/technical-compilation-source-reader.ts";
import type { TechnicalCompilationProfileCatalogProvider } from "../../../application/ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import type { ProjectSourceWorkspaceEventStore } from "../../../application/ports/out/project-source-workspace/project-source-workspace-event-store.ts";
import type { ProjectSourceClosureStore } from "../../../application/ports/out/project-source-workspace/project-source-closure-store.ts";
import {
  ProjectSourceClosureStoreError,
} from "../../../application/ports/out/project-source-workspace/project-source-closure-store.ts";
import type { TechnicalSourceAnalysisCapture } from "../../../application/ports/out/compile/admission/technical-source-analysis-capture.ts";
import { TechnicalSourceAnalysisCaptureError } from "../../../application/ports/out/compile/admission/technical-source-analysis-capture.ts";
import {
  assertTechnicalSourceAttachmentProvenanceEqual,
  assertTechnicalSourceClosureProvenanceEqual,
  assessAttachmentAgainstCompilationBasis,
  attachmentProvenanceFrom,
  recrossTechnicalSourceAuthority,
  sourceClosureProvenanceFrom,
  TechnicalSourceWorkspaceRecrossError,
  validateTechnicalSourceAnalysisCaptureLocator,
  validateTechnicalSourceEffectiveUnit,
} from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  assertBuild123dWorkspaceClosureLoweringManifestsEqual,
  lowerBuild123dWorkspaceClosure,
} from "../../../domain/cad/source/build123d-workspace-closure-lowering.ts";
import {
  type ProjectSourceClosure,
  ProjectSourceClosureError,
  recrossProjectSourceClosure,
} from "../../../domain/project-source-workspace/closure.ts";
import { fingerprintSourceAnalysisBundle } from "../../../domain/compile/source/source-analysis.ts";
import type { TechnicalCompilationBasis } from "../../../domain/compile/admission/technical-compilation.ts";
import {
  validateTechnicalCompilationProfileCatalog,
} from "../../../domain/compile/admission/technical-compilation.ts";
import {
  deepFreeze,
  exactRecord,
  literalValue,
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
  | "bytes_mismatch"
  | "profile_identity_mismatch"
  | "catalog_alignment_mismatch"
  | "attachment_not_found"
  | "attachment_not_active"
  | "attachment_revision_not_head"
  | "attachment_fingerprint_mismatch"
  | "source_removed"
  | "closure_mismatch";

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
  readonly closures: ProjectSourceClosureStore;
  readonly workspace: ProjectSourceWorkspaceEventStore;
  readonly resources: ReopenAgentResource;
  readonly profiles: TechnicalCompilationProfileCatalogProvider;
}

export class CaptureBackedTechnicalCompilationSourceReader
  implements TechnicalCompilationSourceReader {
  readonly #captures: TechnicalSourceAnalysisCapture;
  readonly #closures: ProjectSourceClosureStore;
  readonly #workspace: ProjectSourceWorkspaceEventStore;
  readonly #resources: ReopenAgentResource;
  readonly #profiles: TechnicalCompilationProfileCatalogProvider;

  constructor(
    dependencies: CaptureBackedTechnicalCompilationSourceReaderDependencies,
  ) {
    this.#captures = dependencies.captures;
    this.#closures = dependencies.closures;
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
        "Technical source capture reference is not an opaque locator/4.0.",
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

    if (reopened.document.sourceClosure.projectId !== request.projectId) {
      throw readError(
        "project_mismatch",
        "Technical source capture is foreign to the requested project.",
      );
    }

    let sealedClosure;
    try {
      sealedClosure = await this.#closures.reopenLocator(
        reopened.document.sourceClosure.locator,
      );
    } catch (cause) {
      if (
        cause instanceof ProjectSourceClosureStoreError &&
        cause.code === "locator_cas_tampered"
      ) {
        throw readError("locator_cas_tampered", cause.message, cause);
      }
      throw readError(
        "capture_document_invalid",
        "The captured project source closure could not be reopened.",
        cause,
      );
    }
    try {
      assertTechnicalSourceClosureProvenanceEqual(
        sourceClosureProvenanceFrom(
          sealedClosure.locator,
          sealedClosure.document,
        ),
        reopened.document.sourceClosure,
        "$technicalCompilationSourceRead.sourceClosure",
      );
      assertTechnicalSourceAttachmentProvenanceEqual(
        attachmentProvenanceFrom(sealedClosure.document.attachment),
        reopened.document.attachment,
        "$technicalCompilationSourceRead.attachment",
      );
    } catch (cause) {
      throw readError(
        "closure_mismatch",
        "Reopened project source closure does not match the capture attachment and closure provenance.",
        cause,
      );
    }

    let state;
    try {
      state = await this.#workspace.loadAtFresh(
        reopened.document.sourceClosure.projectId,
        reopened.document.sourceClosure.workspaceRevision,
      );
    } catch (cause) {
      throw readError(
        "workspace_integrity_failed",
        "The exact captured workspace snapshot failed fresh hash-chained replay.",
        cause,
      );
    }

    try {
      await recrossProjectSourceClosure(state, sealedClosure.document);
      recrossTechnicalSourceAuthority(state, {
        attachment: reopened.document.attachment,
        sourceClosure: reopened.document.sourceClosure,
        profileId: reopened.document.profile.id,
      });
    } catch (cause) {
      throw mapRecrossError(cause);
    }

    for (const file of sealedClosure.document.files) {
      try {
        await this.#resources.reopenExact(file.resourceRef);
      } catch (cause) {
        throw readError(
          "bytes_mismatch",
          `Workspace AgentResource bytes could not be reopened for ${file.fileId}@${file.fileRevision}.`,
          cause,
        );
      }
    }

    const compactEffectiveUnit = reopened.document.effectiveUnit.kind ===
        "build123d-workspace-closure-lowered"
      ? (() => {
        const { loweringManifest: _loweringManifest, ...compact } =
          reopened.document.effectiveUnit;
        return compact;
      })()
      : reopened.document.effectiveUnit;
    const effectiveUnit = validateTechnicalSourceEffectiveUnit(
      compactEffectiveUnit,
      reopened.document.sourceClosure,
      reopened.document.source.id,
      { algorithm: "sha256", digest: reopened.document.source.sha256 },
      "$technicalCompilationSourceRead.effectiveUnit",
    );
    const captureProfile = this.#captures.requireCaptureProfile(
      reopened.document.profile.id,
    );
    if (captureProfile.version !== reopened.document.profile.version) {
      throw readError(
        "profile_identity_mismatch",
        "The captured source no longer names the exact registered source-analysis profile.",
      );
    }
    const rootReopenByteLimit = effectiveUnit.kind ===
        "build123d-workspace-closure-lowered"
      ? captureProfile.workspaceClosureLowering?.maxClosureSourceBytes
      : reopened.document.source.byteCount;
    if (rootReopenByteLimit === undefined) {
      throw readError(
        "closure_mismatch",
        "A lowered technical source must name the exact profile-owned closure-lowering policy.",
      );
    }

    let resourceText: string;
    try {
      resourceText = (await this.#resources.reopenUtf8Text(
        reopened.document.sourceClosure.root.resourceRef,
        {
          acceptedMimeTypes: acceptedMimeTypesForTechnicalLanguage(
            reopened.document.source.language,
          ),
          maxBytes: Math.max(rootReopenByteLimit, 1),
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
    if (
      effectiveUnit.kind === "authored-root" &&
      resourceText !== reopened.sourceText
    ) {
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
    await this.#recrossEffectiveUnit({
      reopened,
      closure: sealedClosure.document,
      effectiveUnit,
      rootText: resourceText,
    });
    return deepFreeze({
      referenceFingerprint: observedReferenceFingerprint,
      source: {
        sourceText: reopened.sourceText,
        analysis: reopened.analysis,
        analysisFingerprint,
        effectiveUnit,
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
        effectiveUnit,
        attachment: reopened.document.attachment,
        sourceClosure: reopened.document.sourceClosure,
        locator: reopened.locator,
        attachmentAlignment: assessAttachmentAgainstCompilationBasis(
          reopened.document.attachment,
          request.basis,
        ),
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

  async #recrossEffectiveUnit(input: {
    readonly reopened: Awaited<
      ReturnType<TechnicalSourceAnalysisCapture["reopenLocator"]>
    >;
    readonly closure: ProjectSourceClosure;
    readonly effectiveUnit: ReturnType<typeof validateTechnicalSourceEffectiveUnit>;
    readonly rootText: string;
  }): Promise<void> {
    const profile = this.#captures.requireCaptureProfile(
      input.reopened.document.profile.id,
    );
    if (profile.version !== input.reopened.document.profile.version) {
      throw readError(
        "profile_identity_mismatch",
        "The captured profile version is no longer the exact registered lowering profile.",
      );
    }
    if (input.effectiveUnit.kind === "authored-root") {
      if (
        (input.effectiveUnit.closureKind === "root-only" &&
          input.closure.files.length !== 1) ||
        (input.effectiveUnit.closureKind === "unlowered-closure" &&
          input.closure.files.length <= 1) ||
        (input.effectiveUnit.closureKind === "unlowered-closure" &&
          profile.workspaceClosureLowering !== undefined)
      ) {
        throw readError(
          "closure_mismatch",
          "The captured closure kind no longer agrees with its registered executable-unit policy.",
        );
      }
      return;
    }
    if (
      input.closure.files.length <= 1 ||
      profile.workspaceClosureLowering === undefined ||
      input.reopened.document.source.role !== "cad-script" ||
      input.reopened.document.source.language !== "python" ||
      input.reopened.document.effectiveUnit.kind !==
        "build123d-workspace-closure-lowered"
    ) {
      throw readError(
        "closure_mismatch",
        "Only the exact Build123d lowering profile may replay a multi-file executable unit.",
      );
    }
    const texts = new Map<string, string>();
    let closureSourceBytes = 0;
    for (const file of input.closure.files) {
      let text: string;
      try {
        text = (await this.#resources.reopenUtf8Text(file.resourceRef, {
          acceptedMimeTypes: acceptedMimeTypesForTechnicalLanguage("python"),
          maxBytes: profile.workspaceClosureLowering.maxClosureSourceBytes,
        })).text;
      } catch (cause) {
        throw readError(
          "bytes_mismatch",
          `Workspace source ${file.fileId}@${file.fileRevision} could not be reopened as exact UTF-8 Build123d input.`,
          cause,
        );
      }
      texts.set(`${file.fileId}@${file.fileRevision}`, text);
      closureSourceBytes += new TextEncoder().encode(text).byteLength;
    }
    if (
      closureSourceBytes > profile.workspaceClosureLowering.maxClosureSourceBytes ||
      input.closure.files.length > profile.workspaceClosureLowering.maxClosureFiles
    ) {
      throw readError(
        "closure_mismatch",
        "The exact closure exceeds the persisted Build123d lowering profile limits.",
      );
    }
    const root = input.closure.files.find((file) =>
      file.fileId === input.closure.root.fileId &&
      file.fileRevision === input.closure.root.fileRevision
    );
    if (!root || texts.get(`${root.fileId}@${root.fileRevision}`) !== input.rootText) {
      throw readError(
        "closure_mismatch",
        "The exact closure root could not be re-opened.",
      );
    }
    let lowered;
    try {
      lowered = await lowerBuild123dWorkspaceClosure({
        closure: input.closure,
        root: {
          fileId: root.fileId,
          fileRevision: root.fileRevision,
          sourceText: input.rootText,
        },
        dependencies: input.closure.files.filter((file) =>
          file.fileId !== root.fileId || file.fileRevision !== root.fileRevision
        ).map((file) => ({
          fileId: file.fileId,
          fileRevision: file.fileRevision,
          sourceText: texts.get(`${file.fileId}@${file.fileRevision}`)!,
        })),
      });
    } catch (cause) {
      throw readError(
        "closure_mismatch",
        "The exact Build123d closure no longer reproduces its sealed lowered unit.",
        cause,
      );
    }
    try {
      assertBuild123dWorkspaceClosureLoweringManifestsEqual(
        input.reopened.document.effectiveUnit.loweringManifest,
        lowered.manifest,
        "$technicalCompilationSourceRead.effectiveUnit.loweringManifest",
      );
    } catch (cause) {
      throw readError(
        "closure_mismatch",
        "The re-lowered Build123d manifest differs from the persisted complete manifest.",
        cause,
      );
    }
    if (
      lowered.script !== input.reopened.sourceText ||
      !fingerprintsEqual(
        lowered.scriptFingerprint,
        input.effectiveUnit.scriptFingerprint,
      )
    ) {
      throw readError(
        "bytes_mismatch",
        "The re-lowered Build123d script differs from the captured executable bytes.",
      );
    }
  }
}

function parseRequest(
  value: TechnicalCompilationSourceReadRequest,
): TechnicalCompilationSourceReadRequest {
  const request = exactRecord(
    value,
    ["projectId", "basis", "reference", "referenceFingerprint"],
    "$technicalCompilationSourceRead",
  );
  const projectId = safeId(
    request.projectId,
    "$technicalCompilationSourceRead.projectId",
  );
  const basis = request.basis as TechnicalCompilationBasis;
  if (
    basis?.thread?.snapshotId === undefined ||
    String(basis.thread.snapshotId).toLowerCase() === "latest"
  ) {
    throw new TypeError(
      "Technical compilation source reads require an exact Thread/SysML compilation basis.",
    );
  }
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
    projectId,
    basis,
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
      attachment_not_found: "attachment_not_found",
      attachment_not_active: "attachment_not_active",
      attachment_revision_not_head: "attachment_revision_not_head",
      attachment_fingerprint_mismatch: "attachment_fingerprint_mismatch",
      source_removed: "source_removed",
      file_not_found: "file_revision_not_active",
      file_revision_not_active: "file_revision_not_active",
      file_fingerprint_mismatch: "file_fingerprint_mismatch",
      resource_ref_mismatch: "resource_ref_mismatch",
      capture_request_missing: "capture_request_profile_mismatch",
      capture_request_profile_mismatch: "capture_request_profile_mismatch",
    };
    return readError(mapped[cause.code], cause.message, cause);
  }
  if (cause instanceof ProjectSourceClosureError) {
    return readError(
      cause.code === "closure_mismatch" || cause.code === "workspace_mismatch"
        ? "closure_mismatch"
        : "workspace_integrity_failed",
      cause.message,
      cause,
    );
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
