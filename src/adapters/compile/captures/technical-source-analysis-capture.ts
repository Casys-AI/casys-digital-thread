/**
 * Provider-neutral capture boundary for executable technical source text.
 *
 * The source and its parser-backed analysis are persisted before either may be
 * promoted into an admission proposal. Profiles are supplied by the server
 * composition root; a caller can select a registered profile id, but cannot
 * choose the language, parser, policy, provider, tool, or execution arguments.
 */

import {
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyText,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import {
  fingerprintResourceBytes,
  type ImmutableBytes,
} from "../../../domain/compile/source/provider-resource-reader.ts";
import type { SourceAnalysisFrontend } from "../../../domain/compile/source/source-analysis-frontend.ts";
import {
  type SourceAnalysisAnalyzer,
  type SourceAnalysisBundle,
  type SourceAnalysisLanguage,
  type SourceAnalysisSourceRole,
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../shared/cas/file-byte-store.ts";
import type {
  TechnicalSourceAnalysisCapture,
  TechnicalSourceCapturedEffectiveUnit,
} from "../../../application/ports/out/compile/admission/technical-source-analysis-capture.ts";
import {
  TechnicalSourceAnalysisCaptureError,
  type TechnicalSourceAnalysisCaptureErrorCode,
  TechnicalSourceCaptureProfileNotRegisteredError,
} from "../../../application/ports/out/compile/admission/technical-source-analysis-capture.ts";
import {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX,
  type TechnicalSourceAnalysisCaptureLocator,
  type TechnicalSourceAttachmentProvenance,
  type TechnicalSourceClosureProvenance,
  validateTechnicalSourceAnalysisCaptureLocator,
  validateTechnicalSourceAttachmentProvenance,
  validateTechnicalSourceClosureProvenance,
  validateTechnicalSourceEffectiveUnit,
} from "../../../domain/compile/admission/technical-source-analysis-capture-locator.ts";
import {
  BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND,
  BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
  validateBuild123dWorkspaceClosureLoweringManifest,
} from "../../../domain/cad/source/build123d-workspace-closure-lowering.ts";

export {
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
  TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
};

/** Hard ceiling for every code-owned technical-source capture profile. */
export const MAX_TECHNICAL_SOURCE_PROFILE_BYTES = 1024 * 1024;

export type TechnicalSourceRole = Extract<
  SourceAnalysisSourceRole,
  "cad-script" | "modelica-model" | "spice-circuit"
>;

export type TechnicalSourceLanguage = Extract<
  SourceAnalysisLanguage,
  "python" | "modelica" | "spice"
>;

/** Code-owned method selection. It is never accepted from the capture caller. */
export interface TechnicalSourceAnalysisProfile {
  readonly id: string;
  readonly version: string;
  readonly role: TechnicalSourceRole;
  readonly language: TechnicalSourceLanguage;
  readonly analyzer: SourceAnalysisAnalyzer;
  /** UTF-8 byte ceiling applied before any source hashing, CAS write, or analysis. */
  readonly maxSourceBytes: number;
  /** Server-owned policy for the only admitted multi-file executable unit. */
  readonly workspaceClosureLowering?: {
    readonly schemaVersion: typeof BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA;
    readonly kind: typeof BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND;
    readonly maxClosureFiles: number;
    readonly maxClosureSourceBytes: number;
    readonly maxEffectiveScriptBytes: number;
  };
}

export interface TechnicalSourceAnalysisProfileRegistration {
  readonly profile: TechnicalSourceAnalysisProfile;
  readonly frontend: SourceAnalysisFrontend;
}

export interface TechnicalSourceAnalysisProfileRegistry {
  /** Resolve the one profile currently addressable by an opaque caller selector. */
  requireForCapture(profileId: string): TechnicalSourceAnalysisProfileRegistration;
  /** Resolve the exact persisted profile version during replay. */
  requireExact(input: {
    readonly id: string;
    readonly version: string;
  }): TechnicalSourceAnalysisProfileRegistration;
}

export { TechnicalSourceCaptureProfileNotRegisteredError as TechnicalSourceAnalysisProfileNotRegisteredError };

/**
 * Small sealed registry suitable for composition-root registrations.
 *
 * Profile ids are unique, so capture never has an implicit "latest" fallback.
 * Replacing a version is an explicit deployment change; replay additionally
 * checks the exact version and profile fingerprint persisted in the reference.
 */
export class FixedTechnicalSourceAnalysisProfileRegistry
  implements TechnicalSourceAnalysisProfileRegistry {
  readonly #registrations: ReadonlyMap<
    string,
    TechnicalSourceAnalysisProfileRegistration
  >;

  constructor(
    registrations: readonly TechnicalSourceAnalysisProfileRegistration[],
  ) {
    const byId = new Map<string, TechnicalSourceAnalysisProfileRegistration>();
    for (const rawRegistration of registrations) {
      const registrationInput = exactRecord(
        rawRegistration,
        ["profile", "frontend"],
        "$registration",
      );
      const profile = validateTechnicalSourceAnalysisProfile(
        registrationInput.profile,
        "$registration.profile",
      );
      const frontend = requireFrontend(
        registrationInput.frontend,
        "$registration.frontend",
      );
      if (byId.has(profile.id)) {
        throw new TypeError(
          `Duplicate technical source-analysis profile registration for ${profile.id}.`,
        );
      }
      byId.set(profile.id, Object.freeze({ profile, frontend }));
    }
    this.#registrations = byId;
  }

  requireForCapture(
    profileIdValue: string,
  ): TechnicalSourceAnalysisProfileRegistration {
    const profileId = safeId(profileIdValue, "$profileId");
    const registration = this.#registrations.get(profileId);
    if (registration === undefined) {
      throw new TechnicalSourceCaptureProfileNotRegisteredError(profileId);
    }
    return registration;
  }

  requireExact(input: {
    readonly id: string;
    readonly version: string;
  }): TechnicalSourceAnalysisProfileRegistration {
    const identity = exactRecord(input, ["id", "version"], "$profile");
    const id = safeId(identity.id, "$profile.id");
    const version = safeVersion(identity.version, "$profile.version");
    const registration = this.#registrations.get(id);
    if (
      registration === undefined || registration.profile.version !== version
    ) {
      throw new TechnicalSourceCaptureProfileNotRegisteredError(id, version);
    }
    return registration;
  }
}

export interface TechnicalSourceAnalysisCaptureDocument {
  readonly schemaVersion: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA;
  readonly kind: typeof TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND;
  readonly attachment: TechnicalSourceAttachmentProvenance;
  readonly sourceClosure: TechnicalSourceClosureProvenance;
  readonly effectiveUnit: TechnicalSourceCapturedEffectiveUnit;
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly source: {
    readonly id: string;
    readonly role: TechnicalSourceRole;
    readonly language: TechnicalSourceLanguage;
    readonly sha256: string;
    readonly byteCount: number;
    readonly casUri: string;
  };
  readonly analysis: {
    readonly analyzer: SourceAnalysisAnalyzer;
    readonly policy: {
      readonly profile: string;
      readonly status: "passed" | "rejected";
    };
    readonly sha256: string;
    readonly byteCount: number;
    readonly casUri: string;
  };
}

export type TechnicalSourceAnalysisReference = TechnicalSourceAnalysisCaptureLocator;

export interface TechnicalSourceAnalysisCaptureDependencies {
  readonly sourceCaptures: FileByteStore<"technical-source">;
  readonly analysisCaptures: FileByteStore<"technical-source-analysis">;
  readonly captureDocuments: FileByteStore<"technical-source-analysis-capture">;
  readonly profiles: TechnicalSourceAnalysisProfileRegistry;
}

export interface VerifiedTechnicalSourceAnalysis {
  readonly locator: TechnicalSourceAnalysisCaptureLocator;
  readonly document: TechnicalSourceAnalysisCaptureDocument;
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
}

export {
  TechnicalSourceAnalysisCaptureError,
  type TechnicalSourceAnalysisCaptureErrorCode,
};

/**
 * Persist exact UTF-8 source bytes, analyze those bytes locally, persist the
 * canonical bundle, and prove both CAS entries through a deterministic replay.
 */
export class TechnicalSourceAnalysisCaptureService
  implements TechnicalSourceAnalysisCapture {
  readonly #sourceCaptures: FileByteStore<"technical-source">;
  readonly #analysisCaptures: FileByteStore<"technical-source-analysis">;
  readonly #captureDocuments: FileByteStore<"technical-source-analysis-capture">;
  readonly #profiles: TechnicalSourceAnalysisProfileRegistry;

  constructor(dependencies: TechnicalSourceAnalysisCaptureDependencies) {
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#analysisCaptures = dependencies.analysisCaptures;
    this.#captureDocuments = dependencies.captureDocuments;
    this.#profiles = dependencies.profiles;
  }

  requireCaptureProfile(profileId: string): TechnicalSourceAnalysisProfile {
    return this.#profiles.requireForCapture(profileId).profile;
  }

  async persist(inputValue: {
    readonly profileId: string;
    readonly sourceId: string;
    readonly sourceText: string;
    readonly effectiveUnit: TechnicalSourceCapturedEffectiveUnit;
    readonly attachment: TechnicalSourceAttachmentProvenance;
    readonly sourceClosure: TechnicalSourceClosureProvenance;
  }): Promise<{
    readonly locator: TechnicalSourceAnalysisCaptureLocator;
    readonly sourceText: string;
    readonly analysis: SourceAnalysisBundle;
    readonly document: TechnicalSourceAnalysisCaptureDocument;
  }> {
    const locator = await this.capture(inputValue);
    const reopened = await this.reopenLocator(locator);
    return {
      locator,
      sourceText: reopened.sourceText,
      analysis: reopened.analysis,
      document: reopened.document,
    };
  }

  async capture(inputValue: {
    readonly profileId: string;
    /** Assigned by the server before this boundary; never derived from a label. */
    readonly sourceId: string;
    readonly sourceText: string;
    readonly effectiveUnit: TechnicalSourceCapturedEffectiveUnit;
    readonly attachment: TechnicalSourceAttachmentProvenance;
    readonly sourceClosure: TechnicalSourceClosureProvenance;
  }): Promise<TechnicalSourceAnalysisCaptureLocator> {
    const input = exactRecord(
      inputValue,
      [
        "profileId",
        "sourceId",
        "sourceText",
        "effectiveUnit",
        "attachment",
        "sourceClosure",
      ],
      "$technicalSourceCaptureInput",
    );
    const registration = this.#profiles.requireForCapture(
      safeId(input.profileId, "$technicalSourceCaptureInput.profileId"),
    );
    const profile = validateTechnicalSourceAnalysisProfile(
      registration.profile,
      "$registeredProfile",
    );
    const sourceId = safeId(
      input.sourceId,
      "$technicalSourceCaptureInput.sourceId",
    );
    const attachment = validateTechnicalSourceAttachmentProvenance(
      input.attachment,
      "$technicalSourceCaptureInput.attachment",
    );
    const sourceClosure = validateTechnicalSourceClosureProvenance(
      input.sourceClosure,
      "$technicalSourceCaptureInput.sourceClosure",
    );
    if (attachment.fileId !== sourceClosure.root.fileId) {
      throw new TypeError(
        "$technicalSourceCaptureInput.attachment.fileId must equal the authored sourceClosure root fileId.",
      );
    }
    const sourceText = requireSourceText(
      input.sourceText,
      "$technicalSourceCaptureInput.sourceText",
    );
    const sourceBytes = new TextEncoder().encode(sourceText);
    const maximumEffectiveScriptBytes = effectiveScriptByteLimit(
      profile,
      input.effectiveUnit,
    );
    if (sourceBytes.byteLength > maximumEffectiveScriptBytes) {
      throw new TechnicalSourceAnalysisCaptureError(
        "source_size_limit_exceeded",
        `Technical source is ${sourceBytes.byteLength} UTF-8 bytes; registered profile ${profile.id}@${profile.version} permits at most ${maximumEffectiveScriptBytes} effective-script bytes.`,
      );
    }
    const sourceFingerprint = await fingerprintBytes(sourceBytes);
    const effectiveUnit = await validateCapturedEffectiveUnit(
      input.effectiveUnit,
      sourceClosure,
      sourceId,
      sourceFingerprint,
      profile,
      "$technicalSourceCaptureInput.effectiveUnit",
    );

    let sourceStored: VerifiedStoredBytes<"technical-source">;
    try {
      sourceStored = await this.#sourceCaptures.save(
        sourceFingerprint,
        sourceBytes,
      );
      await requireExactStoredBytes(
        this.#sourceCaptures,
        sourceStored,
        sourceBytes,
        "Technical source",
      );
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        `Technical source was not durably readable before analysis: ${
          errorMessage(error)
        }`,
      );
    }

    const rawBundle = await registration.frontend.analyze({
      sourceId,
      role: profile.role,
      language: profile.language,
      sourceText,
    });
    const bundle = validateSourceAnalysisBundle(rawBundle);
    assertExactBundleIdentity(bundle, profile, sourceId, sourceFingerprint);

    const analysisText = deterministicJson(bundle);
    const analysisBytes = new TextEncoder().encode(analysisText);
    const analysisFingerprint = await fingerprintBytes(analysisBytes);
    let analysisStored: VerifiedStoredBytes<"technical-source-analysis">;
    try {
      analysisStored = await this.#analysisCaptures.save(
        analysisFingerprint,
        analysisBytes,
      );
      await requireExactStoredBytes(
        this.#analysisCaptures,
        analysisStored,
        analysisBytes,
        "Technical source analysis",
      );
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        `Technical source analysis was not durably readable after capture: ${
          errorMessage(error)
        }`,
      );
    }

    const profileFingerprint = await fingerprintTechnicalSourceAnalysisProfile(
      profile,
    );
    const document = await validateTechnicalSourceAnalysisCaptureDocument({
      schemaVersion: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
      kind: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND,
      attachment,
      sourceClosure,
      effectiveUnit,
      profile: {
        id: profile.id,
        version: profile.version,
        fingerprint: profileFingerprint,
      },
      source: {
        id: sourceId,
        role: profile.role,
        language: profile.language,
        sha256: sourceStored.fingerprint.digest,
        byteCount: sourceStored.byteCount,
        casUri: sourceStored.uri,
      },
      analysis: {
        analyzer: profile.analyzer,
        policy: {
          profile: bundle.policy.profile,
          status: bundle.policy.status,
        },
        sha256: analysisStored.fingerprint.digest,
        byteCount: analysisStored.byteCount,
        casUri: analysisStored.uri,
      },
    });
    const locator = await this.#persistDocumentLocator(document);

    await this.reopenLocator(locator, true).catch((error) => {
      if (error instanceof TechnicalSourceAnalysisCaptureError) throw error;
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        `Technical source analysis failed exact replay after capture: ${
          errorMessage(error)
        }`,
        locator,
      );
    });

    if (bundle.policy.status === "rejected") {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_rejected",
        `Technical source analysis rejected ${sourceId}; persisted analysis sha256 ${analysisFingerprint.digest}.`,
        locator,
      );
    }
    return locator;
  }

  async reopenLocator(
    value: unknown,
    allowRejected = false,
  ): Promise<VerifiedTechnicalSourceAnalysis> {
    const locator = validateTechnicalSourceAnalysisCaptureLocator(
      value,
      "$technicalSourceAnalysisCaptureLocator",
    );
    if (
      this.#captureDocuments.uriFor(locator.fingerprint) !== locator.casUri ||
      !locator.casUri.startsWith(TECHNICAL_SOURCE_ANALYSIS_CAPTURE_URI_PREFIX)
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "locator_cas_tampered",
        "Technical source locator names a foreign CAS URI.",
        locator,
      );
    }
    let documentBytes: ImmutableBytes | undefined;
    try {
      documentBytes = await this.#captureDocuments.read(locator.fingerprint);
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "locator_cas_tampered",
        `Technical source capture document failed content-addressed readback: ${
          errorMessage(error)
        }`,
        locator,
      );
    }
    if (
      documentBytes === undefined ||
      documentBytes.byteLength !== locator.byteCount
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "locator_cas_tampered",
        "Technical source capture document byte count does not match its locator.",
        locator,
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(
        decodeExactUtf8(documentBytes.copy(), "technical source capture"),
      );
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "capture_document_invalid",
        `Technical source capture document is not exact JSON: ${errorMessage(error)}`,
        locator,
      );
    }
    const verified = await this.#reopenDocument(parsed, allowRejected);
    const canonical = deterministicJson(verified.document);
    if (
      canonical !== decodeExactUtf8(documentBytes.copy(), "technical source capture") ||
      (await fingerprintBytes(documentBytes.copy())).digest !==
        locator.fingerprint.digest
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "locator_cas_tampered",
        "Technical source capture document does not match its locator fingerprint.",
        locator,
      );
    }
    return Object.freeze({
      locator,
      document: verified.document,
      sourceText: verified.sourceText,
      analysis: verified.analysis,
    });
  }

  async #persistDocumentLocator(
    document: TechnicalSourceAnalysisCaptureDocument,
  ): Promise<TechnicalSourceAnalysisCaptureLocator> {
    const documentText = deterministicJson(document);
    const documentBytes = new TextEncoder().encode(documentText);
    const documentFingerprint = await fingerprintBytes(documentBytes);
    try {
      const stored = await this.#captureDocuments.save(
        documentFingerprint,
        documentBytes,
      );
      await requireExactStoredBytes(
        this.#captureDocuments,
        stored,
        documentBytes,
        "Technical source capture document",
      );
      return validateTechnicalSourceAnalysisCaptureLocator({
        schemaVersion: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_SCHEMA,
        kind: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_LOCATOR_KIND,
        fingerprint: stored.fingerprint,
        byteCount: stored.byteCount,
        casUri: stored.uri,
      });
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        `Technical source capture document was not durably readable after capture: ${
          errorMessage(error)
        }`,
      );
    }
  }

  async #reopenDocument(
    value: unknown,
    allowRejected: boolean,
  ): Promise<{
    readonly document: TechnicalSourceAnalysisCaptureDocument;
    readonly sourceText: string;
    readonly analysis: SourceAnalysisBundle;
  }> {
    const reference = await validateTechnicalSourceAnalysisCaptureDocument(value);
    const registration = this.#profiles.requireExact({
      id: reference.profile.id,
      version: reference.profile.version,
    });
    const profile = validateTechnicalSourceAnalysisProfile(
      registration.profile,
      "$registeredProfile",
    );
    const registeredFingerprint = await fingerprintTechnicalSourceAnalysisProfile(
      profile,
    );
    if (
      !sameFingerprint(registeredFingerprint, reference.profile.fingerprint) ||
      profile.role !== reference.source.role ||
      profile.language !== reference.source.language ||
      !sameAnalyzer(profile.analyzer, reference.analysis.analyzer)
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_identity_mismatch",
        "Technical source reference does not name the exact registered profile.",
        reference,
      );
    }
    await validateCapturedEffectiveUnit(
      reference.effectiveUnit,
      reference.sourceClosure,
      reference.source.id,
      fingerprintFromDigest(reference.source.sha256),
      profile,
      "$technicalSourceAnalysisCapture.effectiveUnit",
    );

    const sourceFingerprint = fingerprintFromDigest(reference.source.sha256);
    if (this.#sourceCaptures.uriFor(sourceFingerprint) !== reference.source.casUri) {
      throw new TechnicalSourceAnalysisCaptureError(
        "source_capture_invalid",
        "Technical source reference names a foreign CAS URI.",
        reference,
      );
    }
    let sourceBytes: ImmutableBytes | undefined;
    try {
      sourceBytes = await this.#sourceCaptures.read(sourceFingerprint);
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "source_capture_invalid",
        `Technical source failed content-addressed readback: ${errorMessage(error)}`,
        reference,
      );
    }
    if (
      sourceBytes === undefined ||
      sourceBytes.byteLength !== reference.source.byteCount ||
      sourceBytes.byteLength > effectiveScriptByteLimit(
          profile,
          reference.effectiveUnit,
        )
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "source_capture_invalid",
        "Technical source byte count does not match its capture reference or registered profile cap.",
        reference,
      );
    }
    const sourceText = decodeExactUtf8(sourceBytes.copy(), "technical source");

    const analysisFingerprint = fingerprintFromDigest(reference.analysis.sha256);
    if (
      this.#analysisCaptures.uriFor(analysisFingerprint) !==
        reference.analysis.casUri
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        "Technical source analysis reference names a foreign CAS URI.",
        reference,
      );
    }
    let analysisBytes: ImmutableBytes | undefined;
    try {
      analysisBytes = await this.#analysisCaptures.read(analysisFingerprint);
    } catch (error) {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        `Technical source analysis failed content-addressed readback: ${
          errorMessage(error)
        }`,
        reference,
      );
    }
    if (
      analysisBytes === undefined ||
      analysisBytes.byteLength !== reference.analysis.byteCount
    ) {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        "Technical source analysis byte count does not match its capture reference.",
        reference,
      );
    }

    let analysis: SourceAnalysisBundle;
    let analysisText: string;
    try {
      analysisText = decodeExactUtf8(
        analysisBytes.copy(),
        "technical source analysis",
      );
      analysis = validateSourceAnalysisBundle(JSON.parse(analysisText));
      if (deterministicJson(analysis) !== analysisText) {
        throw new TypeError("analysis is not canonical JSON");
      }
      assertExactBundleIdentity(
        analysis,
        profile,
        reference.source.id,
        sourceFingerprint,
      );
      if (
        analysis.policy.profile !== reference.analysis.policy.profile ||
        analysis.policy.status !== reference.analysis.policy.status
      ) {
        throw new TypeError("analysis policy does not match its capture reference");
      }
      const recomputed = validateSourceAnalysisBundle(
        await registration.frontend.analyze({
          sourceId: reference.source.id,
          role: profile.role,
          language: profile.language,
          sourceText,
        }),
      );
      if (deterministicJson(recomputed) !== analysisText) {
        throw new TypeError(
          "registered frontend did not reproduce the captured analysis",
        );
      }
    } catch (error) {
      if (
        error instanceof TechnicalSourceAnalysisCaptureError &&
        error.code === "analysis_identity_mismatch"
      ) {
        throw error;
      }
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        `Technical source analysis is invalid: ${errorMessage(error)}`,
        reference,
      );
    }

    if (!allowRejected && analysis.policy.status === "rejected") {
      throw new TechnicalSourceAnalysisCaptureError(
        "analysis_rejected",
        `Technical source analysis rejected ${reference.source.id}; persisted analysis sha256 ${reference.analysis.sha256}.`,
        reference,
      );
    }
    return Object.freeze({ document: reference, sourceText, analysis });
  }
}

/** Strictly validate the closed replay reference, including its profile hash. */
export async function validateTechnicalSourceAnalysisCaptureDocument(
  value: unknown,
  path = "$technicalSourceAnalysisCapture",
): Promise<TechnicalSourceAnalysisCaptureDocument> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "attachment",
      "sourceClosure",
      "effectiveUnit",
      "profile",
      "source",
      "analysis",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.kind,
    TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND,
    `${path}.kind`,
  );
  const attachment = validateTechnicalSourceAttachmentProvenance(
    root.attachment,
    `${path}.attachment`,
  );
  const sourceClosure = validateTechnicalSourceClosureProvenance(
    root.sourceClosure,
    `${path}.sourceClosure`,
  );
  if (attachment.fileId !== sourceClosure.root.fileId) {
    throw new TypeError(
      `${path}.attachment.fileId must equal the authored sourceClosure root fileId.`,
    );
  }

  const profileInput = exactRecord(
    root.profile,
    ["id", "version", "fingerprint"],
    `${path}.profile`,
  );
  const sourceInput = exactRecord(
    root.source,
    ["id", "role", "language", "sha256", "byteCount", "casUri"],
    `${path}.source`,
  );
  const analysisInput = exactRecord(
    root.analysis,
    ["analyzer", "policy", "sha256", "byteCount", "casUri"],
    `${path}.analysis`,
  );
  const analyzerInput = exactRecord(
    analysisInput.analyzer,
    ["id", "version"],
    `${path}.analysis.analyzer`,
  );
  const policyInput = exactRecord(
    analysisInput.policy,
    ["profile", "status"],
    `${path}.analysis.policy`,
  );

  const profile = validatePersistedProfileDescriptor({
    id: profileInput.id,
    version: profileInput.version,
    role: sourceInput.role,
    language: sourceInput.language,
    analyzer: {
      id: analyzerInput.id,
      version: analyzerInput.version,
    },
  }, `${path}.profileDescriptor`);
  const persistedProfileFingerprint = parseFingerprint(
    profileInput.fingerprint,
    `${path}.profile.fingerprint`,
  );

  const sourceSha256 = canonicalSha256(
    sourceInput.sha256,
    `${path}.source.sha256`,
  );
  const sourceByteCount = nonNegativeSafeInteger(
    sourceInput.byteCount,
    `${path}.source.byteCount`,
  );
  const analysisSha256 = canonicalSha256(
    analysisInput.sha256,
    `${path}.analysis.sha256`,
  );
  const analysisByteCount = nonNegativeSafeInteger(
    analysisInput.byteCount,
    `${path}.analysis.byteCount`,
  );
  const policyProfile = safeId(
    policyInput.profile,
    `${path}.analysis.policy.profile`,
  );
  if (policyProfile !== profile.id) {
    throw new TypeError(
      `${path}.analysis.policy.profile must equal the registered profile id.`,
    );
  }
  const policyStatus = requirePolicyStatus(
    policyInput.status,
    `${path}.analysis.policy.status`,
  );
  const sourceId = safeId(sourceInput.id, `${path}.source.id`);
  const effectiveUnit = await validateCapturedEffectiveUnit(
    root.effectiveUnit,
    sourceClosure,
    sourceId,
    { algorithm: "sha256", digest: sourceSha256 },
    undefined,
    `${path}.effectiveUnit`,
  );

  return deepFreeze({
    schemaVersion: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
    kind: TECHNICAL_SOURCE_ANALYSIS_CAPTURE_KIND,
    attachment,
    sourceClosure,
    effectiveUnit,
    profile: {
      id: profile.id,
      version: profile.version,
      fingerprint: persistedProfileFingerprint,
    },
    source: {
      id: sourceId,
      role: profile.role,
      language: profile.language,
      sha256: sourceSha256,
      byteCount: sourceByteCount,
      casUri: canonicalCasUri(
        sourceInput.casUri,
        sourceSha256,
        `${path}.source.casUri`,
      ),
    },
    analysis: {
      analyzer: profile.analyzer,
      policy: { profile: policyProfile, status: policyStatus },
      sha256: analysisSha256,
      byteCount: analysisByteCount,
      casUri: canonicalCasUri(
        analysisInput.casUri,
        analysisSha256,
        `${path}.analysis.casUri`,
      ),
    },
  });
}

export function validateTechnicalSourceAnalysisProfile(
  value: unknown,
  path = "$technicalSourceAnalysisProfile",
): TechnicalSourceAnalysisProfile {
  const input = closedRecord(
    value,
    [
      "id",
      "version",
      "role",
      "language",
      "analyzer",
      "maxSourceBytes",
      "workspaceClosureLowering",
    ],
    ["id", "version", "role", "language", "analyzer", "maxSourceBytes"],
    path,
  );
  const analyzer = exactRecord(
    input.analyzer,
    ["id", "version"],
    `${path}.analyzer`,
  );
  const role = input.role;
  const language = input.language;
  if (
    !(
      (role === "cad-script" && language === "python") ||
      (role === "modelica-model" && language === "modelica") ||
      (role === "spice-circuit" && language === "spice")
    )
  ) {
    throw new TypeError(
      `${path} must select cad-script/python, modelica-model/modelica, or spice-circuit/spice; brief, plain-text, SysML, TypeScript, and CalculiX input are not executable technical-source profiles.`,
    );
  }
  const workspaceClosureLowering = Object.hasOwn(
      input,
      "workspaceClosureLowering",
    )
    ? validateWorkspaceClosureLoweringPolicy(
      input.workspaceClosureLowering,
      `${path}.workspaceClosureLowering`,
    )
    : undefined;
  if (
    workspaceClosureLowering !== undefined &&
    !(role === "cad-script" && language === "python")
  ) {
    throw new TypeError(
      `${path}.workspaceClosureLowering is Build123d/cad-script only.`,
    );
  }
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    version: safeVersion(input.version, `${path}.version`),
    role,
    language,
    analyzer: {
      id: safeId(analyzer.id, `${path}.analyzer.id`),
      version: safeVersion(analyzer.version, `${path}.analyzer.version`),
    },
    maxSourceBytes: boundedSourceBytes(
      input.maxSourceBytes,
      `${path}.maxSourceBytes`,
    ),
    ...(workspaceClosureLowering === undefined ? {} : { workspaceClosureLowering }),
  });
}

function validateWorkspaceClosureLoweringPolicy(
  value: unknown,
  path: string,
): NonNullable<TechnicalSourceAnalysisProfile["workspaceClosureLowering"]> {
  const policy = exactRecord(
    value,
    [
      "schemaVersion",
      "kind",
      "maxClosureFiles",
      "maxClosureSourceBytes",
      "maxEffectiveScriptBytes",
    ],
    path,
  );
  literalValue(
    policy.schemaVersion,
    BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    policy.kind,
    BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND,
    `${path}.kind`,
  );
  return deepFreeze({
    schemaVersion: BUILD123D_WORKSPACE_CLOSURE_LOWERING_SCHEMA,
    kind: BUILD123D_WORKSPACE_CLOSURE_LOWERING_KIND,
    maxClosureFiles: positiveInteger(policy.maxClosureFiles, `${path}.maxClosureFiles`),
    maxClosureSourceBytes: boundedSourceBytes(
      policy.maxClosureSourceBytes,
      `${path}.maxClosureSourceBytes`,
    ),
    maxEffectiveScriptBytes: boundedSourceBytes(
      policy.maxEffectiveScriptBytes,
      `${path}.maxEffectiveScriptBytes`,
    ),
  });
}

function effectiveScriptByteLimit(
  profile: TechnicalSourceAnalysisProfile,
  effectiveUnit: unknown,
): number {
  return (
      effectiveUnit !== null && typeof effectiveUnit === "object" &&
      (effectiveUnit as { kind?: unknown }).kind ===
        "build123d-workspace-closure-lowered"
    )
    ? profile.workspaceClosureLowering?.maxEffectiveScriptBytes ??
      profile.maxSourceBytes
    : profile.maxSourceBytes;
}

async function validateCapturedEffectiveUnit(
  value: unknown,
  sourceClosure: TechnicalSourceClosureProvenance,
  sourceId: string,
  sourceFingerprint: ContentFingerprint,
  profile: TechnicalSourceAnalysisProfile | undefined,
  path: string,
): Promise<TechnicalSourceCapturedEffectiveUnit> {
  const root = closedRecord(
    value,
    [
      "kind",
      "closureKind",
      "unitId",
      "closureFingerprint",
      "scriptFingerprint",
      "lowerer",
      "loweringManifest",
    ],
    ["kind", "closureKind", "unitId", "closureFingerprint", "scriptFingerprint"],
    path,
  );
  const { loweringManifest: _loweringManifest, ...compactValue } = root;
  const compact = validateTechnicalSourceEffectiveUnit(
    compactValue,
    sourceClosure,
    sourceId,
    sourceFingerprint,
    path,
  );
  if (compact.kind !== "build123d-workspace-closure-lowered") {
    if (Object.hasOwn(root, "loweringManifest")) {
      throw new TypeError(`${path}.loweringManifest is only valid for a lowered unit.`);
    }
    return compact;
  }
  if (!Object.hasOwn(root, "loweringManifest")) {
    throw new TypeError(`${path}.loweringManifest is required for a lowered unit.`);
  }
  if (profile !== undefined && profile.workspaceClosureLowering === undefined) {
    throw new TypeError(
      `${path} requests Build123d workspace lowering without the exact profile-owned policy.`,
    );
  }
  const loweringManifest = await validateBuild123dWorkspaceClosureLoweringManifest(
    root.loweringManifest,
    `${path}.loweringManifest`,
  );
  if (
    !sameFingerprint(
      loweringManifest.fingerprint,
      compact.lowerer.manifestFingerprint,
    ) ||
    !sameFingerprint(loweringManifest.closure.fingerprint, sourceClosure.fingerprint) ||
    loweringManifest.closure.root.fileId !== sourceClosure.root.fileId ||
    loweringManifest.closure.root.fileRevision !== sourceClosure.root.fileRevision ||
    !sameFingerprint(loweringManifest.script.fingerprint, sourceFingerprint)
  ) {
    throw new TypeError(`${path}.loweringManifest disagrees with the effective unit.`);
  }
  if (
    profile !== undefined &&
    loweringManifest.sources.length > profile.workspaceClosureLowering!.maxClosureFiles
  ) {
    throw new TypeError(
      `${path}.loweringManifest exceeds the profile closure-file limit.`,
    );
  }
  return deepFreeze({ ...compact, loweringManifest });
}

type PersistedTechnicalSourceProfileDescriptor = Omit<
  TechnicalSourceAnalysisProfile,
  "maxSourceBytes"
>;

/**
 * The public reference intentionally keeps the profile selector opaque and
 * tool-compatible. Its fingerprint covers the full registered profile,
 * including `maxSourceBytes`, and is therefore verified only by `reopen`,
 * where the code-owned registry is available.
 */
function validatePersistedProfileDescriptor(
  value: unknown,
  path: string,
): PersistedTechnicalSourceProfileDescriptor {
  const input = exactRecord(
    value,
    ["id", "version", "role", "language", "analyzer"],
    path,
  );
  const analyzer = exactRecord(
    input.analyzer,
    ["id", "version"],
    `${path}.analyzer`,
  );
  const role = input.role;
  const language = input.language;
  if (
    !(
      (role === "cad-script" && language === "python") ||
      (role === "modelica-model" && language === "modelica") ||
      (role === "spice-circuit" && language === "spice")
    )
  ) {
    throw new TypeError(
      `${path} must select cad-script/python, modelica-model/modelica, or spice-circuit/spice.`,
    );
  }
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    version: safeVersion(input.version, `${path}.version`),
    role,
    language,
    analyzer: {
      id: safeId(analyzer.id, `${path}.analyzer.id`),
      version: safeVersion(analyzer.version, `${path}.analyzer.version`),
    },
  });
}

function boundedSourceBytes(value: unknown, path: string): number {
  const bytes = positiveInteger(value, path);
  if (bytes > MAX_TECHNICAL_SOURCE_PROFILE_BYTES) {
    throw new TypeError(
      `${path} must not exceed ${MAX_TECHNICAL_SOURCE_PROFILE_BYTES} bytes.`,
    );
  }
  return bytes;
}

export function fingerprintTechnicalSourceAnalysisProfile(
  value: unknown,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateTechnicalSourceAnalysisProfile(value));
}

function requireFrontend(value: unknown, path: string): SourceAnalysisFrontend {
  if (
    value === null || typeof value !== "object" ||
    typeof (value as { analyze?: unknown }).analyze !== "function"
  ) {
    throw new TypeError(`${path} must implement analyze.`);
  }
  return value as SourceAnalysisFrontend;
}

function requireSourceText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty string.`);
  }
  return value;
}

function assertExactBundleIdentity(
  bundle: SourceAnalysisBundle,
  profile: TechnicalSourceAnalysisProfile,
  sourceId: string,
  sourceFingerprint: ContentFingerprint,
): void {
  if (
    bundle.source.id !== sourceId || bundle.source.role !== profile.role ||
    bundle.source.language !== profile.language ||
    !sameFingerprint(bundle.source.fingerprint, sourceFingerprint) ||
    !sameAnalyzer(bundle.analyzer, profile.analyzer) ||
    bundle.policy.profile !== profile.id
  ) {
    throw new TechnicalSourceAnalysisCaptureError(
      "analysis_identity_mismatch",
      "Technical source analysis does not name the exact captured source, registered analyzer, and policy profile.",
    );
  }
}

async function requireExactStoredBytes<Kind extends string>(
  store: FileByteStore<Kind>,
  receipt: VerifiedStoredBytes<Kind>,
  expected: Uint8Array,
  label: string,
): Promise<void> {
  const reopened = await store.read(receipt.fingerprint);
  if (
    reopened === undefined || reopened.byteLength !== expected.byteLength ||
    receipt.byteCount !== expected.byteLength ||
    !bytesEqual(reopened.copy(), expected)
  ) {
    throw new TypeError(`${label} bytes changed during durable readback.`);
  }
}

async function fingerprintBytes(
  bytes: Uint8Array,
): Promise<ContentFingerprint> {
  return Object.freeze({
    algorithm: "sha256",
    digest: await fingerprintResourceBytes(bytes),
  });
}

function fingerprintFromDigest(digest: string): ContentFingerprint {
  return Object.freeze({
    algorithm: "sha256",
    digest: canonicalSha256(digest, "$fingerprint.digest"),
  });
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  return Object.freeze({
    algorithm: "sha256",
    digest: canonicalSha256(input.digest, `${path}.digest`),
  });
}

function canonicalSha256(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be canonical lowercase SHA-256 hex.`);
  }
  return value;
}

function canonicalCasUri(value: unknown, digest: string, path: string): string {
  const uri = nonEmptyText(value, path);
  if (
    !/^casys:\/\/[a-z0-9][a-z0-9.-]{0,62}\/sha256\/[a-f0-9]{64}$/.test(uri) ||
    !uri.endsWith(`/sha256/${digest}`)
  ) {
    throw new TypeError(`${path} must be a canonical CAS URI for its sha256.`);
  }
  return uri;
}

function nonNegativeSafeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative safe integer.`);
  }
  return Number(value);
}

function requirePolicyStatus(
  value: unknown,
  path: string,
): "passed" | "rejected" {
  if (value !== "passed" && value !== "rejected") {
    throw new TypeError(`${path} must be passed or rejected.`);
  }
  return value;
}

function decodeExactUtf8(bytes: Uint8Array, label: string): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch (error) {
    throw new TypeError(`${label} is not exact UTF-8: ${errorMessage(error)}`);
  }
  if (!bytesEqual(new TextEncoder().encode(text), bytes)) {
    throw new TypeError(`${label} did not round-trip as exact UTF-8 bytes.`);
  }
  return text;
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let different = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    different |= left[index]! ^ right[index]!;
  }
  return different === 0;
}

function sameFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function sameAnalyzer(
  left: SourceAnalysisAnalyzer,
  right: SourceAnalysisAnalyzer,
): boolean {
  return left.id === right.id && left.version === right.version;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
