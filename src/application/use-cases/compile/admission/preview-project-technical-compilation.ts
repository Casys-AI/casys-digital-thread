import type {
  ProjectTechnicalCompilationPreviewCommand,
  ProjectTechnicalCompilationPreviewResult,
  ProjectTechnicalCompilationPreviewUseCase,
} from "../../../ports/in/compile/admission/project-technical-compilation-preview.ts";
import type { TechnicalCompilationBasisResolver } from "../../../ports/out/compile/admission/technical-compilation-basis-resolver.ts";
import {
  TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
  type TechnicalCompilationDraft,
  type TechnicalCompilationDraftReference,
  type TechnicalCompilationDraftStore,
} from "../../../ports/out/compile/admission/technical-compilation-draft-store.ts";
import type { TechnicalCompilationProfileCatalogProvider } from "../../../ports/out/compile/admission/technical-compilation-profile-catalog-provider.ts";
import type {
  ReopenedTechnicalCompilationSource,
  TechnicalCompilationSourceProvenance,
  TechnicalCompilationSourceReader,
} from "../../../ports/out/compile/admission/technical-compilation-source-reader.ts";
import {
  assertTechnicalCompilationSourcesShareExactWorkspace,
  validateTechnicalSourceAnalysisCaptureLocator,
  validateTechnicalSourceAttachmentProvenance,
  validateTechnicalSourceClosureProvenance,
  validateTechnicalSourceEffectiveUnit,
} from "../../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  encodeTechnicalCompilationAdmissionParameters,
  parseTechnicalCompilationAdmissionParameters,
  TECHNICAL_COMPILATION_ADMISSION_LIMITS,
  TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
} from "../../../../domain/compile/admission/technical-compilation-proposal.ts";
import {
  compileTechnicalSources,
  fingerprintTechnicalCompilationBasis,
  TECHNICAL_COMPILATION_INPUT_SCHEMA,
  type TechnicalCompilationBasis,
  type TechnicalCompilationInput,
  type TechnicalCompilationProfileRequest,
  type TechnicalCompilationResult,
  type TechnicalSemanticBinding,
  uniqueCompilationDocumentTarget,
  validateTechnicalCompilationDocument,
  validateTechnicalCompilationProfileCatalog,
} from "../../../../domain/compile/admission/technical-compilation.ts";
import {
  deriveTechnicalCompilationProfileRequests,
  deriveUniqueTechnicalCompilationBindings,
} from "../../../../domain/compile/admission/technical-compilation-join.ts";
import {
  assembleAttachmentAlignmentGaps,
  assembleTechnicalCompilationJoinGaps,
  assembleThermalMethodSheetCompilationGaps,
} from "../../../../domain/compile/admission/technical-compilation-preview-review.ts";
import type { ThermalMethodSheetCompilationJoin } from "../../../ports/out/compile/admission/thermal-method-sheet-compilation-join.ts";
import type { EngineeringProjectRevisionStore } from "../../../ports/out/engineering-project-revision-store.ts";
import {
  parseExactThreadSnapshotBasis,
  selectCurrentThreadTip,
} from "../../../../domain/project/thread-tip.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../../../domain/kernel/deterministic-json.ts";
import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "../../../../domain/kernel/case-validation.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";

export type ProjectTechnicalCompilationPreviewErrorCode =
  | "invalid_request"
  | "basis_not_found"
  | "basis_resolution_failed"
  | "basis_mismatch"
  | "basis_integrity_failed"
  | "source_not_found"
  | "source_resolution_failed"
  | "source_reference_mismatch"
  | "source_integrity_failed"
  | "configuration_failure"
  | "draft_integrity_failed";

export class ProjectTechnicalCompilationPreviewError extends Error {
  readonly code: ProjectTechnicalCompilationPreviewErrorCode;

  constructor(
    code: ProjectTechnicalCompilationPreviewErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "ProjectTechnicalCompilationPreviewError";
    this.code = code;
  }
}

export interface PreviewProjectTechnicalCompilationDependencies {
  readonly basisResolver: TechnicalCompilationBasisResolver;
  readonly sourceReader: TechnicalCompilationSourceReader;
  readonly profileCatalog: TechnicalCompilationProfileCatalogProvider;
  readonly draftStore: TechnicalCompilationDraftStore;
  /** Required to resolve an omitted basis to the unique current Thread tip. */
  readonly projects?: Pick<EngineeringProjectRevisionStore, "get">;
  /**
   * Optional unique join of a sealed thermal method sheet. Consulted only for
   * the unique Modelica compilation source/target. Absence is not a
   * compilation failure. Ambiguity fails closed.
   */
  readonly methodSheets?: ThermalMethodSheetCompilationJoin;
}

/**
 * Provider-free application seam for compiling already captured technical
 * sources against one exact Thread/SysML basis.
 *
 * No caller-supplied analysis, compilation basis, or profile catalogue can
 * reach the pure compiler. Every such fact is reopened behind a server-owned
 * port first. Non-ready results are deliberately not persisted as sealable
 * drafts.
 */
export class PreviewProjectTechnicalCompilation
  implements ProjectTechnicalCompilationPreviewUseCase {
  readonly #basisResolver: TechnicalCompilationBasisResolver;
  readonly #sourceReader: TechnicalCompilationSourceReader;
  readonly #profileCatalog: TechnicalCompilationProfileCatalogProvider;
  readonly #draftStore: TechnicalCompilationDraftStore;
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get"> | undefined;
  readonly #methodSheets: ThermalMethodSheetCompilationJoin | undefined;

  constructor(dependencies: PreviewProjectTechnicalCompilationDependencies) {
    this.#basisResolver = dependencies.basisResolver;
    this.#sourceReader = dependencies.sourceReader;
    this.#profileCatalog = dependencies.profileCatalog;
    this.#draftStore = dependencies.draftStore;
    this.#projects = dependencies.projects;
    this.#methodSheets = dependencies.methodSheets;
  }

  async execute(value: unknown): Promise<ProjectTechnicalCompilationPreviewResult> {
    let command: ProjectTechnicalCompilationPreviewCommand;
    try {
      command = parseCommand(value);
    } catch (cause) {
      throw previewError(
        "invalid_request",
        "The technical-compilation preview request failed exact validation.",
        cause,
      );
    }

    let requestedBasis = command.basis;
    if (requestedBasis === undefined) {
      requestedBasis = await this.#resolveCurrentThreadTip(command.projectId);
    }

    let basis: TechnicalCompilationBasis | undefined;
    try {
      basis = await this.#basisResolver.resolve({
        projectId: command.projectId,
        basis: requestedBasis,
      });
    } catch (cause) {
      throw previewError(
        "basis_resolution_failed",
        "The exact Thread/SysML basis reader failed.",
        cause,
      );
    }
    if (!basis) {
      throw previewError(
        "basis_not_found",
        "The exact declared Thread/SysML basis could not be reopened.",
      );
    }
    if (
      basis.thread.projectId !== command.projectId ||
      basis.thread.snapshotId !== requestedBasis.snapshotId ||
      basis.thread.revision !== requestedBasis.revision ||
      basis.thread.subjectId !== requestedBasis.subjectId
    ) {
      throw previewError(
        "basis_mismatch",
        "The reopened Thread/SysML basis is foreign to the requested project revision.",
      );
    }

    let basisFingerprint: ContentFingerprint;
    try {
      basisFingerprint = await fingerprintTechnicalCompilationBasis(basis);
    } catch (cause) {
      throw previewError(
        "basis_integrity_failed",
        "The reopened Thread/SysML basis failed exact fingerprint validation.",
        cause,
      );
    }

    let sourceReferenceFingerprints: readonly ContentFingerprint[];
    try {
      sourceReferenceFingerprints = await Promise.all(
        command.sourceRefs.map((reference) => sha256Fingerprint(reference)),
      );
      rejectDuplicates(
        sourceReferenceFingerprints.map((fingerprint) => fingerprint.digest),
        "$command.sourceRefs fingerprints",
      );
    } catch (cause) {
      throw previewError(
        "invalid_request",
        "Source capture references must be unique deterministic JSON objects.",
        cause,
      );
    }

    const reopenedSources = await Promise.all(command.sourceRefs.map(
      async (reference, index) => {
        let reopened;
        try {
          reopened = await this.#sourceReader.read({
            projectId: command.projectId,
            basis,
            reference,
            referenceFingerprint: sourceReferenceFingerprints[index],
          });
        } catch (cause) {
          if (cause instanceof ProjectTechnicalCompilationPreviewError) throw cause;
          throw previewError(
            "source_resolution_failed",
            `Source capture reader failed for ${
              sourceReferenceFingerprints[index].digest
            }.`,
            cause,
          );
        }
        if (!reopened) {
          throw previewError(
            "source_not_found",
            `Source capture reference ${
              sourceReferenceFingerprints[index].digest
            } could not be reopened.`,
          );
        }
        return validateReopenedSource(
          reopened,
          sourceReferenceFingerprints[index],
        );
      },
    ));

    try {
      rejectDuplicates(
        reopenedSources.map((item) => item.source.analysis.source.id),
        "$reopenedSources source ids",
      );
      assertTechnicalCompilationSourcesShareExactWorkspace(
        reopenedSources.map((item) => item.provenance),
        command.projectId,
        "$reopenedSources",
      );
    } catch (cause) {
      if (cause instanceof ProjectTechnicalCompilationPreviewError) throw cause;
      throw previewError(
        "source_integrity_failed",
        "Reopened source captures are not a coherent project-source bundle.",
        cause,
      );
    }

    let catalog;
    try {
      catalog = validateTechnicalCompilationProfileCatalog(
        await this.#profileCatalog.get(),
      );
    } catch (cause) {
      throw previewError(
        "configuration_failure",
        "The server-owned technical-compilation profile catalogue is unavailable.",
        cause,
      );
    }

    const joinSources = reopenedSources.map((item) => ({
      sourceText: item.source.sourceText,
      analysis: item.source.analysis,
      attachmentTarget: item.provenance.attachment.target,
      attachmentAlignment: item.provenance.attachmentAlignment,
      effectiveUnit: item.source.effectiveUnit,
    }));
    let profileRequests: ReturnType<typeof deriveTechnicalCompilationProfileRequests>;
    let bindings: ReturnType<typeof deriveUniqueTechnicalCompilationBindings>;
    try {
      profileRequests = deriveTechnicalCompilationProfileRequests(
        joinSources,
        catalog,
      );
      bindings = deriveUniqueTechnicalCompilationBindings(
        joinSources,
        basis.sysmlAnchor.elements,
      );
      assertDerivedReferencesResolve(bindings, profileRequests, basis, reopenedSources);
    } catch (cause) {
      throw previewError(
        "configuration_failure",
        "The server-owned compilation join could not uniquely select profiles or SysML bindings.",
        cause,
      );
    }

    const compilerInput: TechnicalCompilationInput = {
      schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
      basis,
      basisFingerprint,
      sources: reopenedSources.map((item) => item.source),
      bindings,
      profileRequests,
    };

    let compiled;
    try {
      compiled = await compileTechnicalSources(compilerInput, catalog);
    } catch (cause) {
      throw previewError(
        "source_integrity_failed",
        "Reopened compilation facts failed exact validation.",
        cause,
      );
    }

    const uniqueTarget = uniqueCompilationDocumentTarget(compiled.document);
    let methodSheet;
    if (
      uniqueTarget === "modelica-source-qualification" &&
      this.#methodSheets !== undefined
    ) {
      try {
        methodSheet = await this.#methodSheets.read({
          projectId: command.projectId,
          basis: {
            kind: "thread-snapshot",
            snapshotId: basis.thread.snapshotId,
            revision: basis.thread.revision,
            subjectId: basis.thread.subjectId,
          },
        });
      } catch (cause) {
        throw previewError(
          "basis_integrity_failed",
          "The thermal method sheet on this Thread basis is not an exact unique recross.",
          cause,
        );
      }
      if (
        methodSheet !== undefined &&
        (methodSheet.project.id !== command.projectId ||
          methodSheet.subject.id !== basis.thread.subjectId)
      ) {
        throw previewError(
          "basis_mismatch",
          "The reopened thermal method sheet is foreign to the requested project revision.",
        );
      }
    }
    const gaps = [
      ...assembleTechnicalCompilationJoinGaps(
        compiled.document.diagnostics,
        joinSources,
        basis.sysmlAnchor.elements,
      ),
      ...assembleAttachmentAlignmentGaps(joinSources),
      ...assembleThermalMethodSheetCompilationGaps(
        methodSheet,
        joinSources,
        bindings,
        basis.sysmlAnchor.elements,
        uniqueTarget,
      ),
    ];

    if (compiled.document.status !== "ready-for-review" || gaps.length > 0) {
      return deepFreeze({
        status: compiled.document.status === "rejected" ? "rejected" : "unresolved",
        document: compiled.document,
        fingerprint: compiled.fingerprint,
        gaps,
      });
    }

    const draft = deepFreeze<TechnicalCompilationDraft>({
      projectId: command.projectId,
      document: compiled.document,
      fingerprint: compiled.fingerprint,
      sourceCaptures: reopenedSources.map((item, index) => ({
        sourceId: item.source.analysis.source.id,
        reference: command.sourceRefs[index],
        referenceFingerprint: sourceReferenceFingerprints[index],
      })).sort(compareBySourceId),
    });
    const expectedReference = await draftReference(draft);
    const decisionParameters = deriveAdmissionParameters(
      compiled,
      expectedReference,
      reopenedSources,
    );
    // Persist only after the complete server-derived MRTR identity has passed
    // canonical encode/parse verification; otherwise no reviewable draft is
    // exposed as if it could be admitted.
    await this.#saveAndVerifyDraft(expectedReference, draft);
    return deepFreeze({
      status: "ready-for-review",
      document: compiled.document,
      fingerprint: compiled.fingerprint,
      gaps,
      draft: expectedReference,
      decisionParameters,
    });
  }

  async #resolveCurrentThreadTip(
    projectId: string,
  ): Promise<EngineeringThreadSnapshotBasis> {
    if (!this.#projects) {
      throw previewError(
        "configuration_failure",
        "Current Thread tip resolution is unavailable.",
      );
    }
    let project;
    try {
      project = await this.#projects.get(projectId);
    } catch (cause) {
      throw previewError(
        "basis_resolution_failed",
        "The exact Thread/SysML basis reader failed.",
        cause,
      );
    }
    if (!project || project.project.id !== projectId) {
      throw previewError(
        "basis_not_found",
        "The exact declared Thread/SysML basis could not be reopened.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      throw previewError("basis_not_found", tip.diagnostic.message);
    }
    return tip.basis;
  }

  async #saveAndVerifyDraft(
    expectedReference: TechnicalCompilationDraftReference,
    draft: TechnicalCompilationDraft,
  ): Promise<void> {
    let saved: TechnicalCompilationDraftReference;
    let reopened: TechnicalCompilationDraft | undefined;
    try {
      saved = validateDraftReference(
        await this.#draftStore.save(expectedReference, draft),
      );
      assertSameDraftReference(saved, expectedReference);
      reopened = await this.#draftStore.read(expectedReference);
    } catch (cause) {
      throw previewError(
        "draft_integrity_failed",
        "The compilation draft could not be saved and reopened exactly.",
        cause,
      );
    }
    if (!reopened) {
      throw previewError(
        "draft_integrity_failed",
        "The saved compilation draft was absent on exact reread.",
      );
    }

    try {
      const envelope = exactRecord(
        reopened,
        ["projectId", "document", "fingerprint", "sourceCaptures"],
        "$reopenedDraft",
      );
      if (safeId(envelope.projectId, "$reopenedDraft.projectId") !== draft.projectId) {
        throw new TypeError("The reopened draft belongs to another project.");
      }
      const reopenedFingerprint = parseFingerprint(
        envelope.fingerprint,
        "$reopenedDraft.fingerprint",
      );
      const normalizedDocument = await validateTechnicalCompilationDocument(
        envelope.document,
      );
      const normalizedSourceCaptures = await validateDraftSourceCaptures(
        envelope.sourceCaptures,
        normalizedDocument,
      );
      const observedFingerprint = await sha256Fingerprint(normalizedDocument);
      const observedEnvelopeFingerprint = await sha256Fingerprint({
        projectId: envelope.projectId,
        document: normalizedDocument,
        fingerprint: reopenedFingerprint,
        sourceCaptures: normalizedSourceCaptures,
      });
      if (
        !fingerprintsEqual(reopenedFingerprint, draft.fingerprint) ||
        !fingerprintsEqual(observedFingerprint, draft.fingerprint) ||
        !fingerprintsEqual(
          observedEnvelopeFingerprint,
          expectedReference.envelopeFingerprint,
        )
      ) {
        throw new TypeError(
          "The reopened draft fingerprint does not match its content.",
        );
      }
    } catch (cause) {
      throw previewError(
        "draft_integrity_failed",
        "The reopened compilation draft failed external integrity verification.",
        cause,
      );
    }
  }
}

async function validateDraftSourceCaptures(
  value: unknown,
  document: TechnicalCompilationDraft["document"],
): Promise<TechnicalCompilationDraft["sourceCaptures"]> {
  const captures = await Promise.all(
    arrayOf(
      value,
      "$reopenedDraft.sourceCaptures",
    ).map(async (item, index) => {
      const path = `$reopenedDraft.sourceCaptures[${index}]`;
      const capture = exactRecord(
        item,
        ["sourceId", "reference", "referenceFingerprint"],
        path,
      );
      const sourceId = safeId(capture.sourceId, `${path}.sourceId`);
      const reference = validateTechnicalSourceAnalysisCaptureLocator(
        capture.reference,
        `${path}.reference`,
      );
      const referenceFingerprint = parseFingerprint(
        capture.referenceFingerprint,
        `${path}.referenceFingerprint`,
      );
      if (
        !fingerprintsEqual(
          await sha256Fingerprint(reference),
          referenceFingerprint,
        )
      ) {
        throw new TypeError(`${path}.reference fingerprint does not match.`);
      }
      return deepFreeze({ sourceId, reference, referenceFingerprint });
    }),
  );
  captures.sort(compareBySourceId);
  rejectDuplicates(
    captures.map((capture) => capture.sourceId),
    "$reopenedDraft.sourceCaptures source ids",
  );
  rejectDuplicates(
    captures.map((capture) => capture.referenceFingerprint.digest),
    "$reopenedDraft.sourceCaptures reference fingerprints",
  );
  const expectedSourceIds = document.inputManifest.sources
    .map((source) => source.analysis.source.id)
    .sort(compareText);
  if (
    expectedSourceIds.length !== captures.length ||
    expectedSourceIds.some((sourceId, index) => sourceId !== captures[index].sourceId)
  ) {
    throw new TypeError(
      "Reopened draft source captures must exactly cover the input manifest.",
    );
  }
  return deepFreeze(captures);
}

function parseCommand(value: unknown): ProjectTechnicalCompilationPreviewCommand {
  const root = closedRecord(
    value,
    ["projectId", "basis", "sourceRefs"],
    ["projectId", "sourceRefs"],
    "$command",
  );
  const sourceRefs = boundedCardinality(
    nonEmptyArray(root.sourceRefs, "$command.sourceRefs"),
    TECHNICAL_COMPILATION_ADMISSION_LIMITS.maxSources,
    "$command.sourceRefs",
  )
    .map((reference, index) =>
      validateTechnicalSourceAnalysisCaptureLocator(
        reference,
        `$command.sourceRefs[${index}]`,
      )
    );
  return deepFreeze({
    projectId: safeId(root.projectId, "$command.projectId"),
    ...(root.basis === undefined
      ? {}
      : { basis: parseExactThreadSnapshotBasis(root.basis, "$command.basis") }),
    sourceRefs,
  });
}

function boundedCardinality(
  values: unknown[],
  maximum: number,
  path: string,
): unknown[] {
  if (values.length > maximum) {
    throw new TypeError(`${path} must contain at most ${maximum} entries.`);
  }
  return values;
}

function validateReopenedSource(
  value: ReopenedTechnicalCompilationSource,
  expectedReferenceFingerprint: ContentFingerprint,
): ReopenedTechnicalCompilationSource {
  let reopened;
  try {
    reopened = exactRecord(
      value,
      ["referenceFingerprint", "source", "provenance"],
      "$reopenedSource",
    );
    const referenceFingerprint = parseFingerprint(
      reopened.referenceFingerprint,
      "$reopenedSource.referenceFingerprint",
    );
    if (!fingerprintsEqual(referenceFingerprint, expectedReferenceFingerprint)) {
      throw previewError(
        "source_reference_mismatch",
        "The source reader resolved a different capture reference.",
      );
    }
    const source = reopened.source as ReopenedTechnicalCompilationSource["source"];
    const provenance = parseSourceProvenance(
      reopened.provenance,
      "$reopenedSource.provenance",
      source,
    );
    if (
      !fingerprintsEqual(
        provenance.captureFingerprint,
        expectedReferenceFingerprint,
      ) ||
      !fingerprintsEqual(
        provenance.sourceFingerprint,
        source.analysis.source.fingerprint,
      ) ||
      !fingerprintsEqual(
        provenance.analysisFingerprint,
        source.analysisFingerprint,
      ) ||
      provenance.analyzer.id !== source.analysis.analyzer.id ||
      provenance.analyzer.version !== source.analysis.analyzer.version ||
      deterministicJson(provenance.effectiveUnit) !==
        deterministicJson(source.effectiveUnit)
    ) {
      throw previewError(
        "source_integrity_failed",
        "The source reader provenance does not match its exact source and analysis.",
      );
    }
    return deepFreeze({
      referenceFingerprint,
      source,
      provenance,
    });
  } catch (cause) {
    if (cause instanceof ProjectTechnicalCompilationPreviewError) throw cause;
    throw previewError(
      "source_integrity_failed",
      "The reopened source envelope failed exact validation.",
      cause,
    );
  }
}

function parseSourceProvenance(
  value: unknown,
  path: string,
  source: ReopenedTechnicalCompilationSource["source"],
): TechnicalCompilationSourceProvenance {
  const provenance = exactRecord(
    value,
    [
      "profile",
      "analyzer",
      "sourceFingerprint",
      "captureFingerprint",
      "analysisFingerprint",
      "effectiveUnit",
      "attachment",
      "sourceClosure",
      "locator",
      "attachmentAlignment",
    ],
    path,
  );
  const profile = exactRecord(
    provenance.profile,
    ["id", "version", "fingerprint"],
    `${path}.profile`,
  );
  const analyzer = exactRecord(
    provenance.analyzer,
    ["id", "version"],
    `${path}.analyzer`,
  );
  return deepFreeze({
    profile: {
      id: safeId(profile.id, `${path}.profile.id`),
      version: safeVersion(profile.version, `${path}.profile.version`),
      fingerprint: parseFingerprint(
        profile.fingerprint,
        `${path}.profile.fingerprint`,
      ),
    },
    analyzer: {
      id: safeId(analyzer.id, `${path}.analyzer.id`),
      version: safeVersion(analyzer.version, `${path}.analyzer.version`),
    },
    sourceFingerprint: parseFingerprint(
      provenance.sourceFingerprint,
      `${path}.sourceFingerprint`,
    ),
    captureFingerprint: parseFingerprint(
      provenance.captureFingerprint,
      `${path}.captureFingerprint`,
    ),
    analysisFingerprint: parseFingerprint(
      provenance.analysisFingerprint,
      `${path}.analysisFingerprint`,
    ),
    effectiveUnit: validateTechnicalSourceEffectiveUnit(
      provenance.effectiveUnit,
      validateTechnicalSourceClosureProvenance(
        provenance.sourceClosure,
        `${path}.sourceClosure`,
      ),
      source.analysis.source.id,
      source.analysis.source.fingerprint,
      `${path}.effectiveUnit`,
    ),
    attachment: validateTechnicalSourceAttachmentProvenance(
      provenance.attachment,
      `${path}.attachment`,
    ),
    sourceClosure: validateTechnicalSourceClosureProvenance(
      provenance.sourceClosure,
      `${path}.sourceClosure`,
    ),
    locator: validateTechnicalSourceAnalysisCaptureLocator(
      provenance.locator,
      `${path}.locator`,
    ),
    attachmentAlignment: attachmentAlignment(
      provenance.attachmentAlignment,
      `${path}.attachmentAlignment`,
    ),
  });
}

function attachmentAlignment(
  value: unknown,
  path: string,
): TechnicalCompilationSourceProvenance["attachmentAlignment"] {
  if (
    value !== "exact" && value !== "different-basis" && value !== "target-missing"
  ) {
    throw new TypeError(`${path} must be exact, different-basis, or target-missing.`);
  }
  return value;
}

function assertDerivedReferencesResolve(
  bindings: readonly TechnicalSemanticBinding[],
  profileRequests: readonly TechnicalCompilationProfileRequest[],
  basis: TechnicalCompilationBasis,
  reopenedSources: readonly ReopenedTechnicalCompilationSource[],
): void {
  const sourceById = new Map(
    reopenedSources.map((item) => [item.source.analysis.source.id, item.source]),
  );
  const elementById = new Map(
    basis.sysmlAnchor.elements.map((element) => [element.id, element]),
  );
  for (const binding of bindings) {
    const source = sourceById.get(binding.sourceId);
    if (!source) {
      throw new TypeError(
        `Binding ${binding.id} sourceId must name an exact reopened source.`,
      );
    }
    if (
      !source.analysis.symbols.some((symbol) => symbol.id === binding.sourceSymbolId)
    ) {
      throw new TypeError(
        `Binding ${binding.id} sourceSymbolId must name an exact parser symbol.`,
      );
    }
    const element = elementById.get(binding.sysmlElementId);
    if (!element || element.kind !== binding.sysmlElementKind) {
      throw new TypeError(
        `Binding ${binding.id} must name an exact captured SysML id and kind.`,
      );
    }
  }
  for (const request of profileRequests) {
    for (const sourceId of request.sourceIds) {
      if (!sourceById.has(sourceId)) {
        throw new TypeError(
          `Profile request ${request.profileId}@${request.profileVersion} must name exact reopened sources.`,
        );
      }
    }
  }
}

function deriveAdmissionParameters(
  compiled: TechnicalCompilationResult,
  draft: TechnicalCompilationDraftReference,
  reopenedSources: readonly ReopenedTechnicalCompilationSource[],
) {
  try {
    if (compiled.document.status !== "ready-for-review") {
      throw new TypeError("Only a ready compilation can derive MRTR parameters.");
    }
    const sourceById = new Map(
      reopenedSources.map((item) => [item.source.analysis.source.id, item]),
    );
    const projectionByProfileRef = new Map(
      compiled.document.projections.map((projection) => [
        `${projection.profile.id}@${projection.profile.version}`,
        projection,
      ]),
    );
    if (
      sourceById.size !== compiled.document.inputManifest.sources.length ||
      projectionByProfileRef.size !==
        compiled.document.inputManifest.profileRequests.length
    ) {
      throw new TypeError(
        "Compilation admission provenance does not exactly cover sources and profiles.",
      );
    }

    const admission = {
      schemaVersion: TECHNICAL_COMPILATION_ADMISSION_SCHEMA,
      draft: {
        draftId: draft.draftId,
        projectId: draft.projectId,
        documentFingerprint: draft.documentFingerprint,
        envelopeFingerprint: draft.envelopeFingerprint,
      },
      basis: {
        fingerprint: compiled.document.basisFingerprint,
        thread: {
          projectId: compiled.document.basis.thread.projectId,
          subjectId: compiled.document.basis.thread.subjectId,
          snapshotId: compiled.document.basis.thread.snapshotId,
          revision: compiled.document.basis.thread.revision,
          fingerprint: compiled.document.basis.thread.snapshotFingerprint,
        },
        sysml: {
          artifactId: compiled.document.basis.sysmlAnchor.artifactId,
          artifactFingerprint: compiled.document.basis.sysmlAnchor.artifactFingerprint,
          captureId: compiled.document.basis.sysmlAnchor.captureId,
          editingContextId: compiled.document.basis.sysmlAnchor.editingContextId,
          rootElementId: compiled.document.basis.sysmlAnchor.rootElementId,
          rootElementKind: compiled.document.basis.sysmlAnchor.rootElementKind,
          anchorFingerprint: compiled.document.basis.sysmlAnchorFingerprint,
        },
      },
      sources: compiled.document.inputManifest.sources.map((source) => {
        const reopened = sourceById.get(source.analysis.source.id);
        if (!reopened) {
          throw new TypeError(
            `Missing capture provenance for source ${source.analysis.source.id}.`,
          );
        }
        return {
          id: source.analysis.source.id,
          role: source.analysis.source.role,
          language: source.analysis.source.language,
          profileId: reopened.provenance.profile.id,
          profileVersion: reopened.provenance.profile.version,
          profileFingerprint: reopened.provenance.profile.fingerprint,
          analyzer: reopened.provenance.analyzer,
          sourceFingerprint: reopened.provenance.sourceFingerprint,
          captureFingerprint: reopened.provenance.captureFingerprint,
          analysisFingerprint: reopened.provenance.analysisFingerprint,
          effectiveUnit: reopened.provenance.effectiveUnit,
          attachment: reopened.provenance.attachment,
          sourceClosure: reopened.provenance.sourceClosure,
          locator: reopened.provenance.locator,
        };
      }),
      bindings: compiled.document.inputManifest.bindings,
      compilationProfileRequests: compiled.document.inputManifest.profileRequests.map(
        (request) => {
          const ref = `${request.profileId}@${request.profileVersion}`;
          const projection = projectionByProfileRef.get(ref);
          if (
            !projection || projection.status !== "ready-for-review" ||
            projection.profile.id !== request.profileId ||
            projection.profile.version !== request.profileVersion
          ) {
            throw new TypeError(
              `Missing ready server-owned compilation profile ${ref}.`,
            );
          }
          return {
            profileId: request.profileId,
            profileVersion: request.profileVersion,
            target: projection.target,
            sourceIds: request.sourceIds,
            profileFingerprint: projection.profileFingerprint,
          };
        },
      ),
      compilation: {
        fingerprint: compiled.fingerprint,
        status: "ready-for-review" as const,
      },
    };
    const parameters = encodeTechnicalCompilationAdmissionParameters(admission);
    const reparsed = parseTechnicalCompilationAdmissionParameters(parameters);
    const reencoded = encodeTechnicalCompilationAdmissionParameters(reparsed);
    if (deterministicJson(reencoded) !== deterministicJson(parameters)) {
      throw new TypeError(
        "Technical compilation admission parameters failed canonical round-trip.",
      );
    }
    return parameters;
  } catch (cause) {
    if (cause instanceof ProjectTechnicalCompilationPreviewError) throw cause;
    throw previewError(
      "configuration_failure",
      "Server-derived technical compilation admission parameters are invalid.",
      cause,
    );
  }
}

async function draftReference(
  draft: TechnicalCompilationDraft,
): Promise<TechnicalCompilationDraftReference> {
  const envelopeFingerprint = await sha256Fingerprint(draft);
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId: `technical-compilation:${draft.projectId}:${draft.fingerprint.digest}`,
    projectId: draft.projectId,
    documentFingerprint: draft.fingerprint,
    envelopeFingerprint,
  });
}

function validateDraftReference(value: unknown): TechnicalCompilationDraftReference {
  const reference = exactRecord(
    value,
    [
      "schemaVersion",
      "draftId",
      "projectId",
      "documentFingerprint",
      "envelopeFingerprint",
    ],
    "$draftReference",
  );
  literalValue(
    reference.schemaVersion,
    TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    "$draftReference.schemaVersion",
  );
  const projectId = safeId(reference.projectId, "$draftReference.projectId");
  const documentFingerprint = parseFingerprint(
    reference.documentFingerprint,
    "$draftReference.documentFingerprint",
  );
  const draftId = nonEmptyText(reference.draftId, "$draftReference.draftId");
  if (
    draftId !==
      `technical-compilation:${projectId}:${documentFingerprint.digest}`
  ) {
    throw new TypeError(
      "Draft id does not match its project and document fingerprint.",
    );
  }
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_DRAFT_REFERENCE_SCHEMA,
    draftId,
    projectId,
    documentFingerprint,
    envelopeFingerprint: parseFingerprint(
      reference.envelopeFingerprint,
      "$draftReference.envelopeFingerprint",
    ),
  });
}

function assertSameDraftReference(
  observed: TechnicalCompilationDraftReference,
  expected: TechnicalCompilationDraftReference,
): void {
  if (
    observed.draftId !== expected.draftId ||
    observed.projectId !== expected.projectId ||
    !fingerprintsEqual(
      observed.documentFingerprint,
      expected.documentFingerprint,
    ) ||
    !fingerprintsEqual(
      observed.envelopeFingerprint,
      expected.envelopeFingerprint,
    )
  ) {
    throw new TypeError("The draft store returned a non-content-addressed reference.");
  }
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(fingerprint.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be lowercase SHA-256 hex.`);
  }
  return { algorithm: "sha256", digest };
}

function previewError(
  code: ProjectTechnicalCompilationPreviewErrorCode,
  message: string,
  cause?: unknown,
): ProjectTechnicalCompilationPreviewError {
  return new ProjectTechnicalCompilationPreviewError(code, message, cause);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBySourceId<T extends { readonly sourceId: string }>(
  left: T,
  right: T,
): number {
  return compareText(left.sourceId, right.sourceId);
}
