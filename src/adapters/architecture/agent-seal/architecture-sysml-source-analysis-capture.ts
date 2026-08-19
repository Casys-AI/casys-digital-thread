/**
 * Provider-free capture of agent-authored architecture SysML.
 *
 * This is not `sysml-source-capture/1.0`. That envelope is the renderer
 * authority for `model.write-architecture@1`. Agent-authored UTF-8 is captured
 * here, tokenized, parsed, and analysed under a server-owned closed-subset
 * profile. Callers cannot choose the language, parser, or provider.
 */

import {
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
  validateSourceAnalysisBundle,
} from "../../../domain/compile/source/source-analysis.ts";
import {
  FileByteStore,
  type VerifiedStoredBytes,
} from "../../shared/cas/file-byte-store.ts";

export const ARCHITECTURE_SYSML_SOURCE_ANALYSIS_CAPTURE_SCHEMA =
  "architecture-sysml-source-analysis-capture/1.0" as const;
export const MAX_ARCHITECTURE_SYSML_PROFILE_BYTES = 1024 * 1024;

export interface ArchitectureSysmlAnalysisProfile {
  readonly id: string;
  readonly version: string;
  readonly role: "sysml-model";
  readonly language: "sysml-v2";
  readonly analyzer: SourceAnalysisAnalyzer;
  readonly maxSourceBytes: number;
}

export interface ArchitectureSysmlAnalysisProfileRegistration {
  readonly profile: ArchitectureSysmlAnalysisProfile;
  readonly frontend: SourceAnalysisFrontend;
}

export interface ArchitectureSysmlAnalysisProfileRegistry {
  requireForCapture(profileId: string): ArchitectureSysmlAnalysisProfileRegistration;
  requireExact(input: {
    readonly id: string;
    readonly version: string;
  }): ArchitectureSysmlAnalysisProfileRegistration;
}

export class ArchitectureSysmlAnalysisProfileNotRegisteredError extends Error {
  constructor(
    readonly profileId: string,
    readonly profileVersion?: string,
  ) {
    super(
      profileVersion === undefined
        ? `No architecture SysML analysis profile is registered for ${profileId}.`
        : `No architecture SysML analysis profile is registered for ${profileId}@${profileVersion}.`,
    );
    this.name = "ArchitectureSysmlAnalysisProfileNotRegisteredError";
  }
}

export class FixedArchitectureSysmlAnalysisProfileRegistry
  implements ArchitectureSysmlAnalysisProfileRegistry {
  readonly #registrations: ReadonlyMap<
    string,
    ArchitectureSysmlAnalysisProfileRegistration
  >;

  constructor(
    registrations: readonly ArchitectureSysmlAnalysisProfileRegistration[],
  ) {
    const byId = new Map<string, ArchitectureSysmlAnalysisProfileRegistration>();
    for (const rawRegistration of registrations) {
      const registrationInput = exactRecord(
        rawRegistration,
        ["profile", "frontend"],
        "$registration",
      );
      const profile = validateArchitectureSysmlAnalysisProfile(
        registrationInput.profile,
        "$registration.profile",
      );
      const frontend = requireFrontend(
        registrationInput.frontend,
        "$registration.frontend",
      );
      if (byId.has(profile.id)) {
        throw new TypeError(
          `Duplicate architecture SysML analysis profile registration for ${profile.id}.`,
        );
      }
      byId.set(profile.id, Object.freeze({ profile, frontend }));
    }
    this.#registrations = byId;
  }

  requireForCapture(
    profileIdValue: string,
  ): ArchitectureSysmlAnalysisProfileRegistration {
    const profileId = safeId(profileIdValue, "$profileId");
    const registration = this.#registrations.get(profileId);
    if (registration === undefined) {
      throw new ArchitectureSysmlAnalysisProfileNotRegisteredError(profileId);
    }
    return registration;
  }

  requireExact(input: {
    readonly id: string;
    readonly version: string;
  }): ArchitectureSysmlAnalysisProfileRegistration {
    const identity = exactRecord(input, ["id", "version"], "$profile");
    const id = safeId(identity.id, "$profile.id");
    const version = safeVersion(identity.version, "$profile.version");
    const registration = this.#registrations.get(id);
    if (registration === undefined || registration.profile.version !== version) {
      throw new ArchitectureSysmlAnalysisProfileNotRegisteredError(id, version);
    }
    return registration;
  }
}

export interface ArchitectureSysmlSourceAnalysisCaptureDocument {
  readonly schemaVersion: typeof ARCHITECTURE_SYSML_SOURCE_ANALYSIS_CAPTURE_SCHEMA;
  readonly kind: "architecture-sysml-source-analysis";
  readonly profile: {
    readonly id: string;
    readonly version: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly source: {
    readonly id: string;
    readonly role: "sysml-model";
    readonly language: "sysml-v2";
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

export type ArchitectureSysmlSourceAnalysisReference =
  ArchitectureSysmlSourceAnalysisCaptureDocument;

export interface ArchitectureSysmlSourceAnalysisCaptureDependencies {
  readonly sourceCaptures: FileByteStore<"architecture-sysml-source">;
  readonly analysisCaptures: FileByteStore<"architecture-sysml-source-analysis">;
  readonly profiles: ArchitectureSysmlAnalysisProfileRegistry;
}

export interface VerifiedArchitectureSysmlSourceAnalysis {
  readonly reference: ArchitectureSysmlSourceAnalysisReference;
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
}

export type ArchitectureSysmlSourceAnalysisCaptureErrorCode =
  | "source_size_limit_exceeded"
  | "source_capture_readback_failed"
  | "analysis_identity_mismatch"
  | "analysis_capture_readback_failed"
  | "source_capture_invalid"
  | "analysis_capture_invalid"
  | "analysis_rejected";

export class ArchitectureSysmlSourceAnalysisCaptureError extends Error {
  constructor(
    readonly code: ArchitectureSysmlSourceAnalysisCaptureErrorCode,
    message: string,
    readonly reference?: ArchitectureSysmlSourceAnalysisReference,
  ) {
    super(message);
    this.name = "ArchitectureSysmlSourceAnalysisCaptureError";
  }
}

/** Persist exact UTF-8 SysML bytes, analyse them locally, and prove both CAS entries. */
export class ArchitectureSysmlSourceAnalysisCaptureService {
  readonly #sourceCaptures: FileByteStore<"architecture-sysml-source">;
  readonly #analysisCaptures: FileByteStore<"architecture-sysml-source-analysis">;
  readonly #profiles: ArchitectureSysmlAnalysisProfileRegistry;

  constructor(dependencies: ArchitectureSysmlSourceAnalysisCaptureDependencies) {
    this.#sourceCaptures = dependencies.sourceCaptures;
    this.#analysisCaptures = dependencies.analysisCaptures;
    this.#profiles = dependencies.profiles;
  }

  async capture(inputValue: {
    readonly profileId: string;
    readonly sourceId: string;
    readonly sourceText: string;
  }): Promise<ArchitectureSysmlSourceAnalysisReference> {
    const input = exactRecord(
      inputValue,
      ["profileId", "sourceId", "sourceText"],
      "$architectureSysmlCaptureInput",
    );
    const registration = this.#profiles.requireForCapture(
      safeId(input.profileId, "$architectureSysmlCaptureInput.profileId"),
    );
    const profile = validateArchitectureSysmlAnalysisProfile(
      registration.profile,
      "$registeredProfile",
    );
    const sourceId = safeId(input.sourceId, "$architectureSysmlCaptureInput.sourceId");
    const sourceText = requireSourceText(
      input.sourceText,
      "$architectureSysmlCaptureInput.sourceText",
    );
    const sourceBytes = new TextEncoder().encode(sourceText);
    if (sourceBytes.byteLength > profile.maxSourceBytes) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "source_size_limit_exceeded",
        `Architecture SysML source is ${sourceBytes.byteLength} UTF-8 bytes; registered profile ${profile.id}@${profile.version} permits at most ${profile.maxSourceBytes}.`,
      );
    }
    const sourceFingerprint = await fingerprintBytes(sourceBytes);

    let sourceStored: VerifiedStoredBytes<"architecture-sysml-source">;
    try {
      sourceStored = await this.#sourceCaptures.save(sourceFingerprint, sourceBytes);
      await requireExactStoredBytes(
        this.#sourceCaptures,
        sourceStored,
        sourceBytes,
        "Architecture SysML source",
      );
    } catch (error) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "source_capture_readback_failed",
        `Architecture SysML source was not durably readable before analysis: ${
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
    let analysisStored: VerifiedStoredBytes<"architecture-sysml-source-analysis">;
    try {
      analysisStored = await this.#analysisCaptures.save(
        analysisFingerprint,
        analysisBytes,
      );
      await requireExactStoredBytes(
        this.#analysisCaptures,
        analysisStored,
        analysisBytes,
        "Architecture SysML analysis",
      );
    } catch (error) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        `Architecture SysML analysis was not durably readable after capture: ${
          errorMessage(error)
        }`,
      );
    }

    const profileFingerprint = await fingerprintArchitectureSysmlAnalysisProfile(
      profile,
    );
    const reference = validateArchitectureSysmlSourceAnalysisCaptureDocument({
      schemaVersion: ARCHITECTURE_SYSML_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
      kind: "architecture-sysml-source-analysis",
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

    await this.#reopen(reference, true).catch((error) => {
      if (error instanceof ArchitectureSysmlSourceAnalysisCaptureError) throw error;
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_capture_readback_failed",
        `Architecture SysML analysis failed exact replay after capture: ${
          errorMessage(error)
        }`,
        reference,
      );
    });

    if (bundle.policy.status === "rejected") {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_rejected",
        `Architecture SysML analysis rejected ${sourceId}; persisted analysis sha256 ${analysisFingerprint.digest}.`,
        reference,
      );
    }
    return reference;
  }

  reopen(value: unknown): Promise<VerifiedArchitectureSysmlSourceAnalysis> {
    return this.#reopen(value, false);
  }

  async #reopen(
    value: unknown,
    allowRejected: boolean,
  ): Promise<VerifiedArchitectureSysmlSourceAnalysis> {
    const reference = validateArchitectureSysmlSourceAnalysisCaptureDocument(value);
    const registration = this.#profiles.requireExact({
      id: reference.profile.id,
      version: reference.profile.version,
    });
    const profile = validateArchitectureSysmlAnalysisProfile(
      registration.profile,
      "$registeredProfile",
    );
    const registeredFingerprint = await fingerprintArchitectureSysmlAnalysisProfile(
      profile,
    );
    if (
      !sameFingerprint(registeredFingerprint, reference.profile.fingerprint) ||
      profile.role !== reference.source.role ||
      profile.language !== reference.source.language ||
      !sameAnalyzer(profile.analyzer, reference.analysis.analyzer)
    ) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_identity_mismatch",
        "Architecture SysML reference does not name the exact registered profile.",
        reference,
      );
    }

    const sourceFingerprint = fingerprintFromDigest(reference.source.sha256);
    if (this.#sourceCaptures.uriFor(sourceFingerprint) !== reference.source.casUri) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "source_capture_invalid",
        "Architecture SysML source reference names a foreign CAS URI.",
        reference,
      );
    }
    let sourceBytes: ImmutableBytes | undefined;
    try {
      sourceBytes = await this.#sourceCaptures.read(sourceFingerprint);
    } catch (error) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "source_capture_invalid",
        `Architecture SysML source failed content-addressed readback: ${
          errorMessage(error)
        }`,
        reference,
      );
    }
    if (
      sourceBytes === undefined ||
      sourceBytes.byteLength !== reference.source.byteCount ||
      sourceBytes.byteLength > profile.maxSourceBytes
    ) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "source_capture_invalid",
        "Architecture SysML source byte count does not match its capture reference or registered profile cap.",
        reference,
      );
    }
    const sourceText = decodeExactUtf8(sourceBytes.copy(), "architecture SysML source");

    const analysisFingerprint = fingerprintFromDigest(reference.analysis.sha256);
    if (
      this.#analysisCaptures.uriFor(analysisFingerprint) !== reference.analysis.casUri
    ) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        "Architecture SysML analysis reference names a foreign CAS URI.",
        reference,
      );
    }
    let analysisBytes: ImmutableBytes | undefined;
    try {
      analysisBytes = await this.#analysisCaptures.read(analysisFingerprint);
    } catch (error) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        `Architecture SysML analysis failed content-addressed readback: ${
          errorMessage(error)
        }`,
        reference,
      );
    }
    if (
      analysisBytes === undefined ||
      analysisBytes.byteLength !== reference.analysis.byteCount
    ) {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        "Architecture SysML analysis byte count does not match its capture reference.",
        reference,
      );
    }

    let analysis: SourceAnalysisBundle;
    let analysisText: string;
    try {
      analysisText = decodeExactUtf8(
        analysisBytes.copy(),
        "architecture SysML analysis",
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
        error instanceof ArchitectureSysmlSourceAnalysisCaptureError &&
        error.code === "analysis_identity_mismatch"
      ) {
        throw error;
      }
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_capture_invalid",
        `Architecture SysML analysis is invalid: ${errorMessage(error)}`,
        reference,
      );
    }

    if (!allowRejected && analysis.policy.status === "rejected") {
      throw new ArchitectureSysmlSourceAnalysisCaptureError(
        "analysis_rejected",
        `Architecture SysML analysis rejected ${reference.source.id}; persisted analysis sha256 ${reference.analysis.sha256}.`,
        reference,
      );
    }
    return Object.freeze({ reference, sourceText, analysis });
  }
}

export function validateArchitectureSysmlSourceAnalysisCaptureDocument(
  value: unknown,
  path = "$architectureSysmlSourceAnalysisCapture",
): ArchitectureSysmlSourceAnalysisCaptureDocument {
  const root = exactRecord(
    value,
    ["schemaVersion", "kind", "profile", "source", "analysis"],
    path,
  );
  literalValue(
    root.schemaVersion,
    ARCHITECTURE_SYSML_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(root.kind, "architecture-sysml-source-analysis", `${path}.kind`);
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
  literalValue(sourceInput.role, "sysml-model", `${path}.source.role`);
  literalValue(sourceInput.language, "sysml-v2", `${path}.source.language`);
  const policyStatus = requirePolicyStatus(
    policyInput.status,
    `${path}.analysis.policy.status`,
  );
  const sourceSha256 = canonicalSha256(sourceInput.sha256, `${path}.source.sha256`);
  const analysisSha256 = canonicalSha256(
    analysisInput.sha256,
    `${path}.analysis.sha256`,
  );
  const policyProfile = safeId(policyInput.profile, `${path}.analysis.policy.profile`);
  const profileId = safeId(profileInput.id, `${path}.profile.id`);
  if (policyProfile !== profileId) {
    throw new TypeError(
      `${path}.analysis.policy.profile must equal the registered profile id.`,
    );
  }
  return deepFreeze({
    schemaVersion: ARCHITECTURE_SYSML_SOURCE_ANALYSIS_CAPTURE_SCHEMA,
    kind: "architecture-sysml-source-analysis",
    profile: {
      id: profileId,
      version: safeVersion(profileInput.version, `${path}.profile.version`),
      fingerprint: parseFingerprint(
        profileInput.fingerprint,
        `${path}.profile.fingerprint`,
      ),
    },
    source: {
      id: safeId(sourceInput.id, `${path}.source.id`),
      role: "sysml-model",
      language: "sysml-v2",
      sha256: sourceSha256,
      byteCount: nonNegativeInteger(sourceInput.byteCount, `${path}.source.byteCount`),
      casUri: canonicalCasUri(
        sourceInput.casUri,
        sourceSha256,
        `${path}.source.casUri`,
      ),
    },
    analysis: {
      analyzer: {
        id: safeId(analyzerInput.id, `${path}.analysis.analyzer.id`),
        version: safeVersion(
          analyzerInput.version,
          `${path}.analysis.analyzer.version`,
        ),
      },
      policy: { profile: policyProfile, status: policyStatus },
      sha256: analysisSha256,
      byteCount: nonNegativeInteger(
        analysisInput.byteCount,
        `${path}.analysis.byteCount`,
      ),
      casUri: canonicalCasUri(
        analysisInput.casUri,
        analysisSha256,
        `${path}.analysis.casUri`,
      ),
    },
  });
}

export function validateArchitectureSysmlAnalysisProfile(
  value: unknown,
  path = "$architectureSysmlAnalysisProfile",
): ArchitectureSysmlAnalysisProfile {
  const input = exactRecord(
    value,
    ["id", "version", "role", "language", "analyzer", "maxSourceBytes"],
    path,
  );
  const analyzer = exactRecord(input.analyzer, ["id", "version"], `${path}.analyzer`);
  literalValue(input.role, "sysml-model", `${path}.role`);
  literalValue(input.language, "sysml-v2", `${path}.language`);
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    version: safeVersion(input.version, `${path}.version`),
    role: "sysml-model",
    language: "sysml-v2",
    analyzer: {
      id: safeId(analyzer.id, `${path}.analyzer.id`),
      version: safeVersion(analyzer.version, `${path}.analyzer.version`),
    },
    maxSourceBytes: boundedSourceBytes(input.maxSourceBytes, `${path}.maxSourceBytes`),
  });
}

export function fingerprintArchitectureSysmlAnalysisProfile(
  value: unknown,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(validateArchitectureSysmlAnalysisProfile(value));
}

function boundedSourceBytes(value: unknown, path: string): number {
  const bytes = positiveInteger(value, path);
  if (bytes > MAX_ARCHITECTURE_SYSML_PROFILE_BYTES) {
    throw new TypeError(
      `${path} must not exceed ${MAX_ARCHITECTURE_SYSML_PROFILE_BYTES} bytes.`,
    );
  }
  return bytes;
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
  profile: ArchitectureSysmlAnalysisProfile,
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
    throw new ArchitectureSysmlSourceAnalysisCaptureError(
      "analysis_identity_mismatch",
      "Architecture SysML analysis does not name the exact captured source, registered analyzer, and policy profile.",
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

async function fingerprintBytes(bytes: Uint8Array): Promise<ContentFingerprint> {
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

function nonNegativeInteger(value: unknown, path: string): number {
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
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
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
