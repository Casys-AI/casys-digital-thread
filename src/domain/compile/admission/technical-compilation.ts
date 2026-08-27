/**
 * Pure admission compiler for agent-authored technical sources.
 *
 * This module deliberately stops before execution. It accepts only exact,
 * content-addressed Thread/SysML/source facts and emits reviewable,
 * target-local projections. Provider names, tool names, arguments, paths,
 * endpoints, credentials, and free-form brief text are not part of the schema.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import {
  arrayOf,
  closedRecord,
  deepFreeze,
  exactRecord,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import { listAnalysisReachableNamedNumericLevers } from "../source/named-cad-levers.ts";
import {
  type TechnicalSourceEffectiveUnit,
  validateTechnicalSourceEffectiveUnit,
} from "./technical-source-analysis-capture-locator.ts";
import type {
  TechnicalCompilationBasis,
  TechnicalSysmlAnchor,
  TechnicalSysmlElementProvenance,
  TechnicalSysmlElementRef,
  TechnicalThreadBasis,
} from "./technical-compilation-basis.ts";
import {
  fingerprintSourceAnalysisBundle,
  type SourceAnalysisBundle,
  type SourceAnalysisSymbolKind,
  validateSourceAnalysisBundle,
} from "../source/source-analysis.ts";

export type {
  TechnicalCompilationBasis,
  TechnicalSysmlAnchor,
  TechnicalSysmlElementProvenance,
  TechnicalSysmlElementRef,
  TechnicalThreadBasis,
} from "./technical-compilation-basis.ts";

export const TECHNICAL_COMPILATION_INPUT_SCHEMA =
  "technical-compilation-input/2.0" as const;
export const TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA =
  "technical-compilation-profile-catalog/1.0" as const;
export const TECHNICAL_COMPILATION_SCHEMA = "technical-compilation/2.0" as const;
/**
 * Profile semantics 3.0 add the exact Build123d workspace-closure lowering
 * boundary alongside the causal named-lever admission gate.
 */
export const PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION = "3.0.0" as const;

export type TechnicalCompilationTarget =
  | "build123d-source"
  | "calculix-source-candidate"
  | "modelica-source-qualification"
  | "spice-circuit-source";

export type TechnicalCompilationStatus =
  | "ready-for-review"
  | "unresolved"
  | "rejected";

export type TechnicalBindingRelation =
  | "represents"
  | "parameterizes"
  | "satisfies"
  | "constrains";

export type TechnicalCompilationDiagnosticCode =
  | "binding.missing"
  | "profile.not-found"
  | "source.analyzer-mismatch"
  | "source.analysis-policy-mismatch"
  | "source.no-named-numeric-lever"
  | "source.profile-incompatible"
  | "source.policy-rejected"
  | "source.unresolved-construct"
  | "source.dependency-lowering-unavailable";

export interface TechnicalCompilationSource {
  /**
   * Exact UTF-8 source payload reopened by the application boundary.
   * It is intentionally retained in the draft so human review can inspect the
   * same bytes that were parsed. A later sealed IR may replace this with the
   * content-addressed source reference once that capture seam is composed.
   */
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly analysisFingerprint: ContentFingerprint;
  /** Closed source-proof / executable-unit relationship; never a file count. */
  readonly effectiveUnit: TechnicalSourceEffectiveUnit;
}

export interface TechnicalSemanticBinding {
  readonly id: string;
  readonly sourceId: string;
  readonly sourceSymbolId: string;
  readonly sysmlElementId: string;
  readonly sysmlElementKind: string;
  readonly relation: TechnicalBindingRelation;
}

export interface TechnicalCompilationProfileRequest {
  readonly profileId: string;
  readonly profileVersion: string;
  readonly sourceIds: readonly string[];
}

export interface TechnicalCompilationInput {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_INPUT_SCHEMA;
  readonly basis: TechnicalCompilationBasis;
  /** Fingerprint of the normalized `basis`, including its SysML fingerprint. */
  readonly basisFingerprint: ContentFingerprint;
  readonly sources: readonly TechnicalCompilationSource[];
  readonly bindings: readonly TechnicalSemanticBinding[];
  readonly profileRequests: readonly TechnicalCompilationProfileRequest[];
}

/**
 * A server-owned qualification profile. The request only references its exact
 * id/version; it cannot supply or override these rules.
 */
export interface TechnicalCompilationProfile {
  readonly id: string;
  readonly version: string;
  readonly target: TechnicalCompilationTarget;
  readonly sourceRole: "cad-script" | "modelica-model" | "spice-circuit";
  readonly language: "python" | "modelica" | "spice";
  /** Exact parser implementation qualified by this server-owned profile. */
  readonly analyzer: TechnicalCompilationAnalyzerRef;
  readonly analysisPolicyProfile: string;
  readonly requiredBindingSymbolKinds: readonly SourceAnalysisSymbolKind[];
}

export interface TechnicalCompilationAnalyzerRef {
  readonly id: string;
  readonly version: string;
}

export interface TechnicalCompilationProfileCatalog {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA;
  readonly profiles: readonly TechnicalCompilationProfile[];
}

export interface TechnicalCompilationDiagnostic {
  readonly code: TechnicalCompilationDiagnosticCode;
  /** Stable `profileId@version` reference. */
  readonly profileRef: string;
  /** Exact profile, source, symbol, or construct id relevant to the code. */
  readonly subjectRef: string;
}

export interface TechnicalProjectionSource {
  readonly sourceText: string;
  readonly analysis: SourceAnalysisBundle;
  readonly analysisFingerprint: ContentFingerprint;
  readonly effectiveUnit: TechnicalSourceEffectiveUnit;
  readonly bindings: readonly TechnicalSemanticBinding[];
}

export interface TechnicalCompilationProjection {
  readonly target: TechnicalCompilationTarget;
  readonly profile: TechnicalCompilationProfile;
  readonly profileFingerprint: ContentFingerprint;
  readonly status: TechnicalCompilationStatus;
  readonly diagnostics: readonly TechnicalCompilationDiagnostic[];
  /** Sources and bindings are local to this one target projection. */
  readonly sources: readonly TechnicalProjectionSource[];
}

/**
 * Normalized input facts retained once so every admitted semantic difference
 * is visible in the document, including requests for an unknown profile.
 */
export interface TechnicalCompilationInputManifest {
  /** Canonical technical bytes and analysis make the CAS document reopenable. */
  readonly sources: readonly TechnicalCompilationSource[];
  readonly bindings: readonly TechnicalSemanticBinding[];
  readonly profileRequests: readonly TechnicalCompilationProfileRequest[];
}

export interface TechnicalCompilationDocument {
  readonly schemaVersion: typeof TECHNICAL_COMPILATION_SCHEMA;
  readonly basis: TechnicalCompilationBasis;
  readonly basisFingerprint: ContentFingerprint;
  readonly inputManifest: TechnicalCompilationInputManifest;
  readonly status: TechnicalCompilationStatus;
  readonly diagnostics: readonly TechnicalCompilationDiagnostic[];
  readonly projections: readonly TechnicalCompilationProjection[];
}

/** The document fingerprint remains outside the document, avoiding self-hash. */
export interface TechnicalCompilationResult {
  readonly document: TechnicalCompilationDocument;
  readonly fingerprint: ContentFingerprint;
}

const INPUT_KEYS = [
  "schemaVersion",
  "basis",
  "basisFingerprint",
  "sources",
  "bindings",
  "profileRequests",
] as const;

const TARGETS = new Set<TechnicalCompilationTarget>([
  "build123d-source",
  "calculix-source-candidate",
  "modelica-source-qualification",
  "spice-circuit-source",
]);

const SYMBOL_KINDS = new Set<SourceAnalysisSymbolKind>([
  "artifact",
  "brief-item",
  "component",
  "equation",
  "function",
  "metric",
  "parameter",
  "requirement",
  "variable",
]);

const BINDING_RELATIONS = new Set<TechnicalBindingRelation>([
  "represents",
  "parameterizes",
  "satisfies",
  "constrains",
]);

const TARGET_SOURCE_CONTRACT: Readonly<
  Record<
    TechnicalCompilationTarget,
    {
      readonly role: TechnicalCompilationProfile["sourceRole"];
      readonly language: TechnicalCompilationProfile["language"];
    }
  >
> = {
  "build123d-source": { role: "cad-script", language: "python" },
  "calculix-source-candidate": { role: "cad-script", language: "python" },
  "modelica-source-qualification": {
    role: "modelica-model",
    language: "modelica",
  },
  "spice-circuit-source": { role: "spice-circuit", language: "spice" },
};

const SHA256_HEX = /^[a-f0-9]{64}$/;

/**
 * Sealed-admission facts that carry compilation target and source contract.
 *
 * Profile ids, artifact names, prefixes and labels are deliberately absent:
 * unique language selection is a target/source join only.
 */
export interface CompilationAdmissionTargetFacts {
  readonly admission: {
    readonly sources: readonly {
      readonly language: string;
      readonly role: string;
    }[];
    readonly compilationProfileRequests: readonly {
      readonly target: string;
    }[];
  };
  readonly document: {
    readonly projections: readonly {
      readonly target: string;
      readonly profile: {
        readonly target: string;
        readonly language: string;
        readonly sourceRole: string;
      };
    }[];
    readonly inputManifest: {
      readonly sources: readonly {
        readonly analysis: {
          readonly source: {
            readonly language: string;
            readonly role: string;
          };
        };
      }[];
    };
  };
}

/**
 * Return the unique registered compilation target when every projection and
 * source in a compilation document agrees with the target/source contract.
 * Mixed, empty, or unregistered facts stay undefined. Profile ids, labels
 * and artifact names never participate.
 */
export function uniqueCompilationDocumentTarget(
  document: CompilationAdmissionTargetFacts["document"],
): TechnicalCompilationTarget | undefined {
  const { projections, inputManifest } = document;
  if (projections.length === 0 || inputManifest.sources.length === 0) {
    return undefined;
  }
  const declaredTargets = new Set<string>();
  for (const projection of projections) {
    declaredTargets.add(projection.target);
    declaredTargets.add(projection.profile.target);
  }
  return uniqueTargetMatchingSourceContract(
    declaredTargets,
    inputManifest.sources.map((source) => source.analysis.source),
    projections.map((projection) => projection.profile),
  );
}

/**
 * Return the unique registered compilation target when every sealed request,
 * projection and source agrees with the target/source contract. Mixed,
 * empty, or unregistered facts stay undefined.
 */
export function uniqueCompilationAdmissionTarget(
  facts: CompilationAdmissionTargetFacts,
): TechnicalCompilationTarget | undefined {
  const documentTarget = uniqueCompilationDocumentTarget(facts.document);
  if (documentTarget === undefined) return undefined;
  const { sources, compilationProfileRequests } = facts.admission;
  if (sources.length === 0 || compilationProfileRequests.length === 0) {
    return undefined;
  }
  const declaredTargets = new Set<string>([documentTarget]);
  for (const request of compilationProfileRequests) {
    declaredTargets.add(request.target);
  }
  return uniqueTargetMatchingSourceContract(
    declaredTargets,
    sources,
    facts.document.projections.map((projection) => projection.profile),
  );
}

function uniqueTargetMatchingSourceContract(
  declaredTargets: ReadonlySet<string>,
  sources: readonly { readonly language: string; readonly role: string }[],
  profiles: readonly {
    readonly language: string;
    readonly sourceRole: string;
  }[],
): TechnicalCompilationTarget | undefined {
  if (
    declaredTargets.size !== 1 ||
    sources.length === 0 ||
    profiles.length === 0
  ) {
    return undefined;
  }
  const [declared] = declaredTargets;
  if (!TARGETS.has(declared as TechnicalCompilationTarget)) return undefined;
  const target = declared as TechnicalCompilationTarget;
  const expected = TARGET_SOURCE_CONTRACT[target];
  for (const source of sources) {
    if (source.language !== expected.language || source.role !== expected.role) {
      return undefined;
    }
  }
  for (const profile of profiles) {
    if (
      profile.language !== expected.language ||
      profile.sourceRole !== expected.role
    ) {
      return undefined;
    }
  }
  return target;
}

/** Compute SHA-256 over the exact UTF-8 bytes of a technical source. */
export async function fingerprintTechnicalSourceText(
  sourceText: unknown,
): Promise<ContentFingerprint> {
  const text = utf8SourceText(sourceText, "$sourceText");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return {
    algorithm: "sha256",
    digest: [...new Uint8Array(digest)].map((byte) =>
      byte.toString(16).padStart(2, "0")
    ).join(""),
  };
}

/** Normalize and fingerprint the exact SysML anchor (not display labels). */
export function fingerprintTechnicalSysmlAnchor(
  value: unknown,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(parseSysmlAnchor(value, "$sysmlAnchor"));
}

/** Normalize and fingerprint the complete Thread/SysML compilation basis. */
export async function fingerprintTechnicalCompilationBasis(
  value: unknown,
): Promise<ContentFingerprint> {
  const basis = parseBasis(value, "$basis");
  const observedAnchorFingerprint = await sha256Fingerprint(basis.sysmlAnchor);
  assertFingerprintMatch(
    basis.sysmlAnchorFingerprint,
    observedAnchorFingerprint,
    "$basis.sysmlAnchorFingerprint",
  );
  return await sha256Fingerprint(basis);
}

/** Validate and normalize a server-owned profile catalogue. */
export function validateTechnicalCompilationProfileCatalog(
  value: unknown,
): TechnicalCompilationProfileCatalog {
  const root = exactRecord(value, ["schemaVersion", "profiles"], "$catalog");
  literalValue(
    root.schemaVersion,
    TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    "$catalog.schemaVersion",
  );
  const profiles = nonEmptyArray(root.profiles, "$catalog.profiles")
    .map((item, index) => parseProfile(item, `$catalog.profiles[${index}]`))
    .sort(compareProfiles);
  rejectDuplicates(
    profiles.map(profileRef),
    "$catalog profile id/version pairs",
  );
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_PROFILE_CATALOG_SCHEMA,
    profiles,
  });
}

/**
 * Validate hashes and references, then emit deterministic review projections.
 *
 * Structural defects, content drift, and foreign references throw TypeError.
 * Valid-but-incomplete semantic work emits `unresolved`; policy or profile
 * incompatibility emits `rejected`. No provider is invoked here.
 */
export async function compileTechnicalSources(
  value: unknown,
  catalogValue: unknown,
): Promise<TechnicalCompilationResult> {
  const catalog = validateTechnicalCompilationProfileCatalog(catalogValue);
  const input = await validateInput(value);
  const profileByRef = new Map(catalog.profiles.map((profile) => [
    profileRef(profile),
    profile,
  ]));
  const sourceById = new Map(
    input.sources.map((source) => [source.analysis.source.id, source]),
  );

  const projections: TechnicalCompilationProjection[] = [];
  const orphanDiagnostics: TechnicalCompilationDiagnostic[] = [];

  for (const request of input.profileRequests) {
    const requestedProfileRef = `${request.profileId}@${request.profileVersion}`;
    const profile = profileByRef.get(requestedProfileRef);
    if (!profile) {
      orphanDiagnostics.push({
        code: "profile.not-found",
        profileRef: requestedProfileRef,
        subjectRef: requestedProfileRef,
      });
      continue;
    }

    const projectionDiagnostics: TechnicalCompilationDiagnostic[] = [];
    const projectionSources = request.sourceIds.map((sourceId) => {
      const source = sourceById.get(sourceId);
      // validateInput already proved every requested source id is local.
      if (!source) {
        throw new TypeError("Invariant failure: requested source disappeared.");
      }
      const localBindings = input.bindings.filter((binding) =>
        binding.sourceId === sourceId
      );
      diagnoseSource(
        profile,
        requestedProfileRef,
        source,
        localBindings,
        projectionDiagnostics,
      );
      return {
        sourceText: source.sourceText,
        analysis: source.analysis,
        analysisFingerprint: source.analysisFingerprint,
        effectiveUnit: source.effectiveUnit,
        bindings: [...localBindings].sort(compareById),
      };
    }).sort((left, right) =>
      compareText(left.analysis.source.id, right.analysis.source.id)
    );

    projectionDiagnostics.sort(compareDiagnostics);
    const status = statusFromDiagnostics(projectionDiagnostics);
    projections.push({
      target: profile.target,
      profile,
      profileFingerprint: await sha256Fingerprint(profile),
      status,
      diagnostics: projectionDiagnostics,
      sources: projectionSources,
    });
  }

  projections.sort(compareProjections);
  const diagnostics = [
    ...orphanDiagnostics,
    ...projections.flatMap((projection) => projection.diagnostics),
  ].sort(compareDiagnostics);
  const status = statusFromDiagnostics(diagnostics);
  const document = deepFreeze<TechnicalCompilationDocument>({
    schemaVersion: TECHNICAL_COMPILATION_SCHEMA,
    basis: input.basis,
    basisFingerprint: input.basisFingerprint,
    inputManifest: {
      sources: input.sources,
      bindings: input.bindings,
      profileRequests: input.profileRequests,
    },
    status,
    diagnostics,
    projections,
  });
  const fingerprint = await sha256Fingerprint(document);
  return deepFreeze({ document, fingerprint });
}

/**
 * Reopen an untrusted CAS document without recompiling an upstream request.
 * Every nested record is closed, every embedded hash is recomputed, and every
 * projection is re-derived from the self-contained input manifest.
 */
export async function validateTechnicalCompilationDocument(
  value: unknown,
): Promise<TechnicalCompilationDocument> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "basis",
      "basisFingerprint",
      "inputManifest",
      "status",
      "diagnostics",
      "projections",
    ],
    "$document",
  );
  literalValue(
    root.schemaVersion,
    TECHNICAL_COMPILATION_SCHEMA,
    "$document.schemaVersion",
  );
  const manifest = exactRecord(
    root.inputManifest,
    ["sources", "bindings", "profileRequests"],
    "$document.inputManifest",
  );
  // Reuse the one strict input validator so CAS re-opening and first compile
  // cannot drift in their source, basis, binding, or orphan semantics.
  const input = await validateInput({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis: root.basis,
    basisFingerprint: root.basisFingerprint,
    sources: manifest.sources,
    bindings: manifest.bindings,
    profileRequests: manifest.profileRequests,
  });
  const sourceById = new Map(
    input.sources.map((source) => [source.analysis.source.id, source]),
  );
  const requestByProfileRef = new Map(
    input.profileRequests.map((request) => [
      `${request.profileId}@${request.profileVersion}`,
      request,
    ]),
  );

  const projections = await Promise.all(
    arrayOf(root.projections, "$document.projections").map((projection, index) =>
      parseCompilationProjection(
        projection,
        `$document.projections[${index}]`,
        input,
        sourceById,
        requestByProfileRef,
      )
    ),
  );
  projections.sort(compareProjections);
  rejectDuplicates(
    projections.map((projection) => profileRef(projection.profile)),
    "$document projection profile references",
  );

  const projectedProfileRefs = new Set(
    projections.map((projection) => profileRef(projection.profile)),
  );
  const expectedMissingProfileDiagnostics = input.profileRequests
    .filter((request) =>
      !projectedProfileRefs.has(`${request.profileId}@${request.profileVersion}`)
    )
    .map((request): TechnicalCompilationDiagnostic => {
      const missingRef = `${request.profileId}@${request.profileVersion}`;
      return {
        code: "profile.not-found",
        profileRef: missingRef,
        subjectRef: missingRef,
      };
    });
  const expectedDiagnostics = [
    ...expectedMissingProfileDiagnostics,
    ...projections.flatMap((projection) => projection.diagnostics),
  ].sort(compareDiagnostics);
  const diagnostics = parseDiagnostics(
    root.diagnostics,
    "$document.diagnostics",
    true,
  );
  assertCanonicalEqual(
    diagnostics,
    expectedDiagnostics,
    "$document.diagnostics",
  );
  const status = compilationStatus(root.status, "$document.status");
  const expectedStatus = statusFromDiagnostics(expectedDiagnostics);
  if (status !== expectedStatus) {
    throw new TypeError(
      `$document.status must equal ${expectedStatus} for its diagnostics.`,
    );
  }

  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_SCHEMA,
    basis: input.basis,
    basisFingerprint: input.basisFingerprint,
    inputManifest: {
      sources: input.sources,
      bindings: input.bindings,
      profileRequests: input.profileRequests,
    },
    status,
    diagnostics,
    projections,
  });
}

/** Fingerprint a fully reopened and normalized CAS document. */
export async function fingerprintTechnicalCompilationDocument(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(await validateTechnicalCompilationDocument(value));
}

async function parseCompilationProjection(
  value: unknown,
  path: string,
  input: TechnicalCompilationInput,
  sourceById: ReadonlyMap<string, TechnicalCompilationSource>,
  requestByProfileRef: ReadonlyMap<string, TechnicalCompilationProfileRequest>,
): Promise<TechnicalCompilationProjection> {
  const projection = exactRecord(
    value,
    [
      "target",
      "profile",
      "profileFingerprint",
      "status",
      "diagnostics",
      "sources",
    ],
    path,
  );
  const profile = parseProfile(projection.profile, `${path}.profile`);
  const resolvedProfileRef = profileRef(profile);
  const request = requestByProfileRef.get(resolvedProfileRef);
  if (!request) {
    throw new TypeError(
      `${path}.profile must name an exact profile request in the input manifest.`,
    );
  }
  const target = compilationTarget(projection.target, `${path}.target`);
  if (target !== profile.target) {
    throw new TypeError(`${path}.target must equal its profile target.`);
  }
  const profileFingerprint = parseFingerprint(
    projection.profileFingerprint,
    `${path}.profileFingerprint`,
  );
  assertFingerprintMatch(
    profileFingerprint,
    await sha256Fingerprint(profile),
    `${path}.profileFingerprint`,
  );

  const sources = await Promise.all(
    nonEmptyArray(projection.sources, `${path}.sources`).map((source, index) =>
      parseProjectionSource(source, `${path}.sources[${index}]`)
    ),
  );
  sources.sort((left, right) =>
    compareText(left.analysis.source.id, right.analysis.source.id)
  );
  rejectDuplicates(
    sources.map((source) => source.analysis.source.id),
    `${path}.sources ids`,
  );
  assertCanonicalEqual(
    sources.map((source) => source.analysis.source.id),
    request.sourceIds,
    `${path}.sources ids`,
  );

  const expectedDiagnostics: TechnicalCompilationDiagnostic[] = [];
  for (const source of sources) {
    const sourceId = source.analysis.source.id;
    const canonicalSource = sourceById.get(sourceId);
    if (!canonicalSource) {
      throw new TypeError(
        `${path}.sources.${sourceId} must name a source in the input manifest.`,
      );
    }
    assertCanonicalEqual(
      source.sourceText,
      canonicalSource.sourceText,
      `${path}.sources.${sourceId}.sourceText`,
    );
    assertCanonicalEqual(
      source.analysis,
      canonicalSource.analysis,
      `${path}.sources.${sourceId}.analysis`,
    );
    assertCanonicalEqual(
      source.analysisFingerprint,
      canonicalSource.analysisFingerprint,
      `${path}.sources.${sourceId}.analysisFingerprint`,
    );
    assertCanonicalEqual(
      source.effectiveUnit,
      canonicalSource.effectiveUnit,
      `${path}.sources.${sourceId}.effectiveUnit`,
    );
    const expectedBindings = input.bindings.filter((binding) =>
      binding.sourceId === sourceId
    );
    assertCanonicalEqual(
      source.bindings,
      expectedBindings,
      `${path}.sources.${sourceId}.bindings`,
    );
    diagnoseSource(
      profile,
      resolvedProfileRef,
      canonicalSource,
      expectedBindings,
      expectedDiagnostics,
    );
  }
  expectedDiagnostics.sort(compareDiagnostics);
  const diagnostics = parseDiagnostics(
    projection.diagnostics,
    `${path}.diagnostics`,
    false,
  );
  assertCanonicalEqual(
    diagnostics,
    expectedDiagnostics,
    `${path}.diagnostics`,
  );
  const status = compilationStatus(projection.status, `${path}.status`);
  const expectedStatus = statusFromDiagnostics(expectedDiagnostics);
  if (status !== expectedStatus) {
    throw new TypeError(`${path}.status must equal ${expectedStatus}.`);
  }
  return {
    target,
    profile,
    profileFingerprint,
    status,
    diagnostics,
    sources,
  };
}

async function parseProjectionSource(
  value: unknown,
  path: string,
): Promise<TechnicalProjectionSource> {
  const source = exactRecord(
    value,
    ["sourceText", "analysis", "analysisFingerprint", "effectiveUnit", "bindings"],
    path,
  );
  const parsed = await parseSource({
    sourceText: source.sourceText,
    analysis: source.analysis,
    analysisFingerprint: source.analysisFingerprint,
    effectiveUnit: source.effectiveUnit,
  }, path);
  const bindings = arrayOf(source.bindings, `${path}.bindings`)
    .map((binding, index) => parseBinding(binding, `${path}.bindings[${index}]`))
    .sort(compareById);
  rejectDuplicates(bindings.map((binding) => binding.id), `${path}.bindings ids`);
  for (const binding of bindings) {
    if (binding.sourceId !== parsed.analysis.source.id) {
      throw new TypeError(
        `${path}.bindings.${binding.id}.sourceId must equal the projection source id.`,
      );
    }
  }
  return {
    sourceText: parsed.sourceText,
    analysis: parsed.analysis,
    analysisFingerprint: parsed.analysisFingerprint,
    effectiveUnit: parsed.effectiveUnit,
    bindings,
  };
}

function parseDiagnostics(
  value: unknown,
  path: string,
  allowProfileNotFound: boolean,
): TechnicalCompilationDiagnostic[] {
  const diagnostics = arrayOf(value, path)
    .map((diagnostic, index) =>
      parseDiagnostic(diagnostic, `${path}[${index}]`, allowProfileNotFound)
    )
    .sort(compareDiagnostics);
  rejectDuplicates(
    diagnostics.map((diagnostic) =>
      `${diagnostic.code}\u0000${diagnostic.profileRef}\u0000${diagnostic.subjectRef}`
    ),
    path,
  );
  return diagnostics;
}

function parseDiagnostic(
  value: unknown,
  path: string,
  allowProfileNotFound: boolean,
): TechnicalCompilationDiagnostic {
  const diagnostic = exactRecord(
    value,
    ["code", "profileRef", "subjectRef"],
    path,
  );
  const code = diagnosticCode(diagnostic.code, `${path}.code`);
  if (code === "profile.not-found" && !allowProfileNotFound) {
    throw new TypeError(`${path}.code cannot be profile.not-found in a projection.`);
  }
  return {
    code,
    profileRef: nonEmptyText(diagnostic.profileRef, `${path}.profileRef`),
    subjectRef: nonEmptyText(diagnostic.subjectRef, `${path}.subjectRef`),
  };
}

function assertCanonicalEqual(actual: unknown, expected: unknown, path: string): void {
  if (deterministicJson(actual) !== deterministicJson(expected)) {
    throw new TypeError(`${path} does not match the canonical input facts.`);
  }
}

async function validateInput(value: unknown): Promise<TechnicalCompilationInput> {
  const root = exactRecord(value, INPUT_KEYS, "$input");
  literalValue(
    root.schemaVersion,
    TECHNICAL_COMPILATION_INPUT_SCHEMA,
    "$input.schemaVersion",
  );
  const basis = parseBasis(root.basis, "$input.basis");
  const basisFingerprint = parseFingerprint(
    root.basisFingerprint,
    "$input.basisFingerprint",
  );
  const observedAnchorFingerprint = await sha256Fingerprint(basis.sysmlAnchor);
  assertFingerprintMatch(
    basis.sysmlAnchorFingerprint,
    observedAnchorFingerprint,
    "$input.basis.sysmlAnchorFingerprint",
  );
  const observedBasisFingerprint = await sha256Fingerprint(basis);
  assertFingerprintMatch(
    basisFingerprint,
    observedBasisFingerprint,
    "$input.basisFingerprint",
  );

  const sources = await Promise.all(
    nonEmptyArray(root.sources, "$input.sources")
      .map((item, index) => parseSource(item, `$input.sources[${index}]`)),
  );
  sources.sort(compareSources);
  rejectDuplicates(
    sources.map((source) => source.analysis.source.id),
    "$input source ids",
  );

  const bindings = arrayOf(root.bindings, "$input.bindings")
    .map((item, index) => parseBinding(item, `$input.bindings[${index}]`))
    .sort(compareById);
  rejectDuplicates(bindings.map((binding) => binding.id), "$input.bindings ids");
  rejectDuplicates(
    bindings.map((binding) =>
      deterministicJson([binding.sourceId, binding.sourceSymbolId])
    ),
    "$input binding source/symbol pairs",
  );

  const profileRequests = nonEmptyArray(
    root.profileRequests,
    "$input.profileRequests",
  )
    .map((item, index) => parseProfileRequest(item, `$input.profileRequests[${index}]`))
    .sort(compareProfileRequests);
  rejectDuplicates(
    profileRequests.map((request) => `${request.profileId}@${request.profileVersion}`),
    "$input profile requests",
  );

  validateReferences(basis, sources, bindings, profileRequests);
  return deepFreeze({
    schemaVersion: TECHNICAL_COMPILATION_INPUT_SCHEMA,
    basis,
    basisFingerprint,
    sources,
    bindings,
    profileRequests,
  });
}

function parseBasis(value: unknown, path: string): TechnicalCompilationBasis {
  const basis = exactRecord(
    value,
    ["thread", "sysmlAnchor", "sysmlAnchorFingerprint"],
    path,
  );
  return {
    thread: parseThreadBasis(basis.thread, `${path}.thread`),
    sysmlAnchor: parseSysmlAnchor(basis.sysmlAnchor, `${path}.sysmlAnchor`),
    sysmlAnchorFingerprint: parseFingerprint(
      basis.sysmlAnchorFingerprint,
      `${path}.sysmlAnchorFingerprint`,
    ),
  };
}

function parseThreadBasis(value: unknown, path: string): TechnicalThreadBasis {
  const thread = exactRecord(
    value,
    ["projectId", "subjectId", "snapshotId", "revision", "snapshotFingerprint"],
    path,
  );
  return {
    projectId: safeId(thread.projectId, `${path}.projectId`),
    subjectId: safeId(thread.subjectId, `${path}.subjectId`),
    snapshotId: safeId(thread.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(thread.revision, `${path}.revision`),
    snapshotFingerprint: parseFingerprint(
      thread.snapshotFingerprint,
      `${path}.snapshotFingerprint`,
    ),
  };
}

function parseSysmlAnchor(value: unknown, path: string): TechnicalSysmlAnchor {
  const anchor = exactRecord(
    value,
    [
      "artifactId",
      "artifactFingerprint",
      "captureId",
      "editingContextId",
      "rootElementId",
      "rootElementKind",
      "elements",
    ],
    path,
  );
  const elements = nonEmptyArray(anchor.elements, `${path}.elements`)
    .map((item, index) => parseSysmlElement(item, `${path}.elements[${index}]`))
    .sort(compareById);
  rejectDuplicates(elements.map((element) => element.id), `${path}.elements ids`);
  assertExactAttributeParents(elements, path);
  const rootElementId = safeId(anchor.rootElementId, `${path}.rootElementId`);
  literalValue(anchor.rootElementKind, "Package", `${path}.rootElementKind`);
  const rootElements = elements.filter((element) =>
    element.id === rootElementId && element.kind === "Package"
  );
  if (rootElements.length !== 1) {
    throw new TypeError(
      `${path}.rootElementId must name exactly one Package in ${path}.elements.`,
    );
  }
  const artifactId = safeId(anchor.artifactId, `${path}.artifactId`);
  const artifactFingerprint = parseFingerprint(
    anchor.artifactFingerprint,
    `${path}.artifactFingerprint`,
  );
  const captureId = safeId(anchor.captureId, `${path}.captureId`);
  const rootProvenance = rootElements[0]!.provenance;
  if (
    rootProvenance.artifactId !== artifactId ||
    !fingerprintsEqual(rootProvenance.artifactFingerprint, artifactFingerprint) ||
    rootProvenance.captureId !== captureId
  ) {
    throw new TypeError(
      `${path} root Package provenance must equal the anchor capture identity.`,
    );
  }
  return {
    artifactId,
    artifactFingerprint,
    captureId,
    editingContextId: safeId(
      anchor.editingContextId,
      `${path}.editingContextId`,
    ),
    rootElementId,
    rootElementKind: "Package",
    elements,
  };
}

function parseSysmlElement(
  value: unknown,
  path: string,
): TechnicalSysmlElementRef {
  const element = closedRecord(
    value,
    ["id", "kind", "provenance", "name", "parentElementId"],
    ["id", "kind", "provenance"],
    path,
  );
  const parentElementId = Object.hasOwn(element, "parentElementId")
    ? safeId(element.parentElementId, `${path}.parentElementId`)
    : undefined;
  const parsed: TechnicalSysmlElementRef = {
    id: safeId(element.id, `${path}.id`),
    kind: safeId(element.kind, `${path}.kind`),
    provenance: parseSysmlElementProvenance(
      element.provenance,
      `${path}.provenance`,
    ),
    ...(parentElementId === undefined ? {} : { parentElementId }),
  };
  if (!Object.hasOwn(element, "name")) return parsed;
  return {
    ...parsed,
    name: nonEmptyText(element.name, `${path}.name`),
  };
}

/**
 * Attribute ownership is an exact captured identity relation. It cannot be
 * supplied for another metaclass, pointed at an arbitrary node, or spliced
 * between captures with different provenance. Omitting it remains valid for
 * immutable historical compilation documents.
 */
function assertExactAttributeParents(
  elements: readonly TechnicalSysmlElementRef[],
  path: string,
): void {
  const elementsById = new Map(elements.map((element) => [element.id, element]));
  for (const element of elements) {
    if (element.parentElementId === undefined) continue;
    if (element.kind !== "AttributeUsage") {
      throw new TypeError(
        `${path}.elements.${element.id}.parentElementId is only valid for AttributeUsage.`,
      );
    }
    const parent = elementsById.get(element.parentElementId);
    if (parent?.kind !== "PartDefinition") {
      throw new TypeError(
        `${path}.elements.${element.id}.parentElementId must name an exact PartDefinition.`,
      );
    }
    if (
      element.provenance.artifactId !== parent.provenance.artifactId ||
      element.provenance.captureId !== parent.provenance.captureId ||
      !fingerprintsEqual(
        element.provenance.artifactFingerprint,
        parent.provenance.artifactFingerprint,
      )
    ) {
      throw new TypeError(
        `${path}.elements.${element.id}.parentElementId provenance must equal its PartDefinition owner.`,
      );
    }
  }
}

function parseSysmlElementProvenance(
  value: unknown,
  path: string,
): TechnicalSysmlElementProvenance {
  const provenance = exactRecord(
    value,
    ["artifactId", "artifactFingerprint", "captureId"],
    path,
  );
  return {
    artifactId: safeId(provenance.artifactId, `${path}.artifactId`),
    artifactFingerprint: parseFingerprint(
      provenance.artifactFingerprint,
      `${path}.artifactFingerprint`,
    ),
    captureId: safeId(provenance.captureId, `${path}.captureId`),
  };
}

async function parseSource(
  value: unknown,
  path: string,
): Promise<TechnicalCompilationSource> {
  const source = exactRecord(
    value,
    ["sourceText", "analysis", "analysisFingerprint", "effectiveUnit"],
    path,
  );
  const sourceText = utf8SourceText(source.sourceText, `${path}.sourceText`);
  const analysis = validateSourceAnalysisBundle(source.analysis);
  assertTechnicalSourceKind(analysis, `${path}.analysis.source`);
  const analysisFingerprint = parseFingerprint(
    source.analysisFingerprint,
    `${path}.analysisFingerprint`,
  );
  const observedSourceFingerprint = await fingerprintTechnicalSourceText(sourceText);
  assertFingerprintMatch(
    analysis.source.fingerprint,
    observedSourceFingerprint,
    `${path}.analysis.source.fingerprint`,
  );
  const observedAnalysisFingerprint = await fingerprintSourceAnalysisBundle(analysis);
  assertFingerprintMatch(
    analysisFingerprint,
    observedAnalysisFingerprint,
    `${path}.analysisFingerprint`,
  );
  const effectiveUnit = validateTechnicalSourceEffectiveUnit(
    source.effectiveUnit,
    // The compiler has only the compact effective-unit receipt. The source
    // reader recrosses the complete closure before this pure boundary.
    undefined,
    analysis.source.id,
    observedSourceFingerprint,
    `${path}.effectiveUnit`,
  );
  return {
    sourceText,
    analysis,
    analysisFingerprint,
    effectiveUnit,
  };
}

function assertTechnicalSourceKind(
  analysis: SourceAnalysisBundle,
  path: string,
): void {
  const supported =
    (analysis.source.role === "cad-script" && analysis.source.language === "python") ||
    (analysis.source.role === "modelica-model" &&
      analysis.source.language === "modelica") ||
    (analysis.source.role === "spice-circuit" &&
      analysis.source.language === "spice");
  if (!supported) {
    throw new TypeError(
      `${path} must be cad-script/python, modelica-model/modelica, or spice-circuit/spice; brief, plain-text, and solver input are not compilable sources.`,
    );
  }
}

function parseBinding(value: unknown, path: string): TechnicalSemanticBinding {
  const binding = exactRecord(
    value,
    [
      "id",
      "sourceId",
      "sourceSymbolId",
      "sysmlElementId",
      "sysmlElementKind",
      "relation",
    ],
    path,
  );
  return {
    id: safeId(binding.id, `${path}.id`),
    sourceId: safeId(binding.sourceId, `${path}.sourceId`),
    sourceSymbolId: safeId(binding.sourceSymbolId, `${path}.sourceSymbolId`),
    sysmlElementId: safeId(binding.sysmlElementId, `${path}.sysmlElementId`),
    sysmlElementKind: safeId(
      binding.sysmlElementKind,
      `${path}.sysmlElementKind`,
    ),
    relation: bindingRelation(binding.relation, `${path}.relation`),
  };
}

function parseProfileRequest(
  value: unknown,
  path: string,
): TechnicalCompilationProfileRequest {
  const request = exactRecord(
    value,
    ["profileId", "profileVersion", "sourceIds"],
    path,
  );
  const sourceIds = nonEmptyArray(request.sourceIds, `${path}.sourceIds`)
    .map((sourceId, index) => safeId(sourceId, `${path}.sourceIds[${index}]`))
    .sort(compareText);
  rejectDuplicates(sourceIds, `${path}.sourceIds`);
  return {
    profileId: safeId(request.profileId, `${path}.profileId`),
    profileVersion: safeVersion(
      request.profileVersion,
      `${path}.profileVersion`,
    ),
    sourceIds,
  };
}

function parseProfile(value: unknown, path: string): TechnicalCompilationProfile {
  const profile = exactRecord(
    value,
    [
      "id",
      "version",
      "target",
      "sourceRole",
      "language",
      "analyzer",
      "analysisPolicyProfile",
      "requiredBindingSymbolKinds",
    ],
    path,
  );
  const target = compilationTarget(profile.target, `${path}.target`);
  const sourceRole = profileSourceRole(profile.sourceRole, `${path}.sourceRole`);
  const language = profileLanguage(profile.language, `${path}.language`);
  const expected = TARGET_SOURCE_CONTRACT[target];
  if (sourceRole !== expected.role || language !== expected.language) {
    throw new TypeError(
      `${path} source contract does not match the fixed ${target} admission contract.`,
    );
  }
  const requiredBindingSymbolKinds = arrayOf(
    profile.requiredBindingSymbolKinds,
    `${path}.requiredBindingSymbolKinds`,
  )
    .map((kind, index) =>
      sourceSymbolKind(kind, `${path}.requiredBindingSymbolKinds[${index}]`)
    )
    .sort(compareText);
  rejectDuplicates(
    requiredBindingSymbolKinds,
    `${path}.requiredBindingSymbolKinds`,
  );
  return {
    id: safeId(profile.id, `${path}.id`),
    version: safeVersion(profile.version, `${path}.version`),
    target,
    sourceRole,
    language,
    analyzer: parseAnalyzerRef(profile.analyzer, `${path}.analyzer`),
    analysisPolicyProfile: safeId(
      profile.analysisPolicyProfile,
      `${path}.analysisPolicyProfile`,
    ),
    requiredBindingSymbolKinds,
  };
}

function parseAnalyzerRef(
  value: unknown,
  path: string,
): TechnicalCompilationAnalyzerRef {
  const analyzer = exactRecord(value, ["id", "version"], path);
  return {
    id: safeId(analyzer.id, `${path}.id`),
    version: safeVersion(analyzer.version, `${path}.version`),
  };
}

function validateReferences(
  basis: TechnicalCompilationBasis,
  sources: readonly TechnicalCompilationSource[],
  bindings: readonly TechnicalSemanticBinding[],
  requests: readonly TechnicalCompilationProfileRequest[],
): void {
  const sourceById = new Map(
    sources.map((source) => [source.analysis.source.id, source]),
  );
  const elementById = new Map(
    basis.sysmlAnchor.elements.map((element) => [element.id, element]),
  );
  for (const binding of bindings) {
    const source = sourceById.get(binding.sourceId);
    if (!source) {
      throw new TypeError(
        `$input.bindings.${binding.id}.sourceId must name a source in $input.sources.`,
      );
    }
    if (
      !source.analysis.symbols.some((symbol) => symbol.id === binding.sourceSymbolId)
    ) {
      throw new TypeError(
        `$input.bindings.${binding.id}.sourceSymbolId must name an exact symbol id in source ${binding.sourceId}.`,
      );
    }
    const element = elementById.get(binding.sysmlElementId);
    if (!element) {
      throw new TypeError(
        `$input.bindings.${binding.id}.sysmlElementId must name an exact element id in the SysML anchor.`,
      );
    }
    if (element.kind !== binding.sysmlElementKind) {
      throw new TypeError(
        `$input.bindings.${binding.id}.sysmlElementKind must equal the captured kind for element ${element.id}.`,
      );
    }
  }
  for (const request of requests) {
    for (const sourceId of request.sourceIds) {
      if (!sourceById.has(sourceId)) {
        throw new TypeError(
          `$input.profileRequests.${request.profileId}@${request.profileVersion} sourceIds must name local sources.`,
        );
      }
    }
  }
  const requestedSourceIds = new Set(
    requests.flatMap((request) => request.sourceIds),
  );
  for (const binding of bindings) {
    if (!requestedSourceIds.has(binding.sourceId)) {
      throw new TypeError(
        `$input.bindings.${binding.id} must concern a source requested by at least one profile request.`,
      );
    }
  }
  for (const source of sources) {
    const sourceId = source.analysis.source.id;
    if (!requestedSourceIds.has(sourceId)) {
      throw new TypeError(
        `$input.sources.${sourceId} must be referenced by at least one profile request.`,
      );
    }
  }
}

function diagnoseSource(
  profile: TechnicalCompilationProfile,
  requestedProfileRef: string,
  source: TechnicalCompilationSource,
  bindings: readonly TechnicalSemanticBinding[],
  diagnostics: TechnicalCompilationDiagnostic[],
): void {
  const sourceFacts = source.analysis.source;
  if (
    sourceFacts.role !== profile.sourceRole ||
    sourceFacts.language !== profile.language
  ) {
    diagnostics.push({
      code: "source.profile-incompatible",
      profileRef: requestedProfileRef,
      subjectRef: sourceFacts.id,
    });
    return;
  }
  if (
    source.analysis.analyzer.id !== profile.analyzer.id ||
    source.analysis.analyzer.version !== profile.analyzer.version
  ) {
    diagnostics.push({
      code: "source.analyzer-mismatch",
      profileRef: requestedProfileRef,
      subjectRef: sourceFacts.id,
    });
  }
  if (source.analysis.policy.profile !== profile.analysisPolicyProfile) {
    diagnostics.push({
      code: "source.analysis-policy-mismatch",
      profileRef: requestedProfileRef,
      subjectRef: sourceFacts.id,
    });
  }
  if (source.analysis.policy.status === "rejected") {
    diagnostics.push({
      code: "source.policy-rejected",
      profileRef: requestedProfileRef,
      subjectRef: sourceFacts.id,
    });
  }
  for (const construct of source.analysis.unresolvedConstructs) {
    diagnostics.push({
      code: "source.unresolved-construct",
      profileRef: requestedProfileRef,
      subjectRef: `${sourceFacts.id}:${construct.id}`,
    });
  }
  const boundSymbolIds = new Set(bindings.map((binding) => binding.sourceSymbolId));
  for (const symbol of source.analysis.symbols) {
    if (
      profile.requiredBindingSymbolKinds.includes(symbol.kind) &&
      !boundSymbolIds.has(symbol.id)
    ) {
      diagnostics.push({
        code: "binding.missing",
        profileRef: requestedProfileRef,
        subjectRef: `${sourceFacts.id}:${symbol.id}`,
      });
    }
  }
  // Capture-time handle: a named literal must reach result. SysML binding is
  // a separate `binding.missing` fact. Historical 1.x documents replay as-is.
  if (
    profile.target === "build123d-source" &&
    profile.version === PARAMETERIZED_BUILD123D_COMPILATION_PROFILE_VERSION &&
    listAnalysisReachableNamedNumericLevers(
        source.sourceText,
        source.analysis,
      ).length === 0
  ) {
    diagnostics.push({
      code: "source.no-named-numeric-lever",
      profileRef: requestedProfileRef,
      subjectRef: sourceFacts.id,
    });
  }
  if (source.effectiveUnit.closureKind === "unlowered-closure") {
    diagnostics.push({
      code: "source.dependency-lowering-unavailable",
      profileRef: requestedProfileRef,
      subjectRef: sourceFacts.id,
    });
  }
}

function statusFromDiagnostics(
  diagnostics: readonly TechnicalCompilationDiagnostic[],
): TechnicalCompilationStatus {
  if (
    diagnostics.some((diagnostic) =>
      diagnostic.code === "profile.not-found" ||
      diagnostic.code === "source.analyzer-mismatch" ||
      diagnostic.code === "source.analysis-policy-mismatch" ||
      diagnostic.code === "source.profile-incompatible" ||
      diagnostic.code === "source.policy-rejected"
    )
  ) return "rejected";
  if (diagnostics.length > 0) return "unresolved";
  return "ready-for-review";
}

function compilationStatus(
  value: unknown,
  path: string,
): TechnicalCompilationStatus {
  if (
    value !== "ready-for-review" && value !== "unresolved" &&
    value !== "rejected"
  ) {
    throw new TypeError(
      `${path} must be ready-for-review, unresolved, or rejected.`,
    );
  }
  return value;
}

const DIAGNOSTIC_CODES = new Set<TechnicalCompilationDiagnosticCode>([
  "binding.missing",
  "profile.not-found",
  "source.analyzer-mismatch",
  "source.analysis-policy-mismatch",
  "source.no-named-numeric-lever",
  "source.profile-incompatible",
  "source.policy-rejected",
  "source.unresolved-construct",
  "source.dependency-lowering-unavailable",
]);

function diagnosticCode(
  value: unknown,
  path: string,
): TechnicalCompilationDiagnosticCode {
  if (
    typeof value !== "string" ||
    !DIAGNOSTIC_CODES.has(value as TechnicalCompilationDiagnosticCode)
  ) {
    throw new TypeError(`${path} must be a supported compilation diagnostic code.`);
  }
  return value as TechnicalCompilationDiagnosticCode;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (typeof fingerprint.digest !== "string" || !SHA256_HEX.test(fingerprint.digest)) {
    throw new TypeError(
      `${path}.digest must be a lowercase 64-character SHA-256 hex digest.`,
    );
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function assertFingerprintMatch(
  declared: ContentFingerprint,
  observed: ContentFingerprint,
  path: string,
): void {
  if (!fingerprintsEqual(declared, observed)) {
    throw new TypeError(`${path} does not match the normalized content.`);
  }
}

function utf8SourceText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a non-empty UTF-8 source string.`);
  }
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint >= 0xd800 && codePoint <= 0xdfff) {
      throw new TypeError(`${path} must not contain an unpaired UTF-16 surrogate.`);
    }
  }
  return value;
}

function compilationTarget(value: unknown, path: string): TechnicalCompilationTarget {
  if (typeof value !== "string" || !TARGETS.has(value as TechnicalCompilationTarget)) {
    throw new TypeError(`${path} must be a supported compilation target.`);
  }
  return value as TechnicalCompilationTarget;
}

function profileSourceRole(
  value: unknown,
  path: string,
): TechnicalCompilationProfile["sourceRole"] {
  if (
    value !== "cad-script" && value !== "modelica-model" &&
    value !== "spice-circuit"
  ) {
    throw new TypeError(
      `${path} must be cad-script, modelica-model, or spice-circuit.`,
    );
  }
  return value;
}

function profileLanguage(
  value: unknown,
  path: string,
): TechnicalCompilationProfile["language"] {
  if (value !== "python" && value !== "modelica" && value !== "spice") {
    throw new TypeError(`${path} must be python, modelica, or spice.`);
  }
  return value;
}

function sourceSymbolKind(value: unknown, path: string): SourceAnalysisSymbolKind {
  if (
    typeof value !== "string" || !SYMBOL_KINDS.has(value as SourceAnalysisSymbolKind)
  ) {
    throw new TypeError(`${path} must be a supported source symbol kind.`);
  }
  return value as SourceAnalysisSymbolKind;
}

function bindingRelation(value: unknown, path: string): TechnicalBindingRelation {
  if (
    typeof value !== "string" ||
    !BINDING_RELATIONS.has(value as TechnicalBindingRelation)
  ) {
    throw new TypeError(`${path} must be a supported semantic binding relation.`);
  }
  return value as TechnicalBindingRelation;
}

function profileRef(profile: TechnicalCompilationProfile): string {
  return `${profile.id}@${profile.version}`;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareById(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return compareText(left.id, right.id);
}

function compareSources(
  left: TechnicalCompilationSource,
  right: TechnicalCompilationSource,
): number {
  return compareText(left.analysis.source.id, right.analysis.source.id);
}

function compareProfiles(
  left: TechnicalCompilationProfile,
  right: TechnicalCompilationProfile,
): number {
  return compareText(profileRef(left), profileRef(right));
}

function compareProfileRequests(
  left: TechnicalCompilationProfileRequest,
  right: TechnicalCompilationProfileRequest,
): number {
  return compareText(
    `${left.profileId}@${left.profileVersion}`,
    `${right.profileId}@${right.profileVersion}`,
  );
}

function compareDiagnostics(
  left: TechnicalCompilationDiagnostic,
  right: TechnicalCompilationDiagnostic,
): number {
  return compareText(
    `${left.code}\u0000${left.profileRef}\u0000${left.subjectRef}`,
    `${right.code}\u0000${right.profileRef}\u0000${right.subjectRef}`,
  );
}

function compareProjections(
  left: TechnicalCompilationProjection,
  right: TechnicalCompilationProjection,
): number {
  return compareText(
    `${left.target}\u0000${profileRef(left.profile)}`,
    `${right.target}\u0000${profileRef(right.profile)}`,
  );
}
