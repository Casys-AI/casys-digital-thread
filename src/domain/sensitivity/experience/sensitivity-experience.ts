/**
 * Installation-private, exact sensitivity memoization contracts.
 *
 * The scientific record is deliberately project-neutral. Source project and
 * Thread identities live only in the separately persisted server-private
 * origin binding. A record is data, never a proof, verdict, correction grant,
 * or copied human decision.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { TechnicalCompilationDocument } from "../../compile/admission/technical-compilation.ts";
import type { EngineeringThreadSnapshotBasis } from "../../project/engineering-project.ts";
import type { ThreadArtifact } from "../../thread/thread-snapshot.ts";
import {
  type SensitivityStudyMeasurement,
  validateSensitivityStudyCapture,
} from "../study/sensitivity-study-capture.ts";
import {
  computeSensitivities,
  type SensitivityDerivatives,
} from "../study/sensitivity-study.ts";
import {
  type SensitivityStudyCaseV2,
  validateSensitivityStudyCaseV2,
} from "../study/sensitivity-study-v2.ts";

export const SENSITIVITY_EXPERIENCE_RECORD_SCHEMA =
  "sensitivity-experience-record/1.0" as const;
export const SENSITIVITY_EXPERIENCE_ORIGIN_BINDING_SCHEMA =
  "sensitivity-experience-origin-binding/1.0" as const;
export const SENSITIVITY_EXPERIENCE_INVALIDATION_SCHEMA =
  "sensitivity-experience-invalidation/1.0" as const;
export const SENSITIVITY_EXPERIENCE_ADMISSION_SCHEMA =
  "sensitivity-experience-admission/1.0" as const;
export const SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA =
  "sensitivity-experience-reuse-review/1.0" as const;
export const SENSITIVITY_EXPERIENCE_REUSE_RECEIPT_SCHEMA =
  "sensitivity-experience-reuse-receipt/1.0" as const;
export const SENSITIVITY_EXPERIENCE_AUDIENCE = "installation-private" as const;
export const SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE = "server-private" as const;
export const SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE = Object.freeze(
  {
    id: "sensitivity-experience-exact-v1",
    version: "1.0.0",
  } as const,
);
export const SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION = "1.0.0" as const;

export const SENSITIVITY_EXPERIENCE_WORK_AVOIDED = Object.freeze(
  [
    "isolated-build123d.base",
    "isolated-build123d.stepped",
    "calculix_solve_static.base",
    "calculix_solve_static.stepped",
  ] as const,
);

export interface SensitivityExperienceSolverRuntimeIdentity {
  readonly imageReference: string;
  readonly imageDigest: ContentFingerprint;
}

export interface SensitivityExperienceNormalizedSymbol {
  readonly kind: string;
  readonly name: string;
}

export interface SensitivityExperienceNormalizedDependency {
  readonly kind: string;
  readonly from: SensitivityExperienceNormalizedSymbol;
  readonly to: SensitivityExperienceNormalizedSymbol;
}

export interface SensitivityExperienceNormalizedBinding {
  readonly relation: string;
  readonly sourceSymbol: SensitivityExperienceNormalizedSymbol;
  readonly targetKind: string;
  readonly role: "target-parameter" | "compiled-binding";
}

export interface SensitivityExperienceScientificStudy {
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly target: {
    readonly componentRole: string;
    readonly parameterRole: string;
  };
  readonly baseValue: { readonly value: number; readonly unit: string };
  readonly step: { readonly value: number; readonly unit: string };
  readonly metrics: readonly { readonly id: string; readonly unit: string }[];
  readonly solver: SensitivityStudyCaseV2["solver"];
  readonly domain: SensitivityStudyCaseV2["domain"];
}

export interface SensitivityExperienceMethodIdentity {
  readonly operation: {
    readonly id: "analyze.run-fea-sensitivity";
    readonly version: "1";
  };
  readonly finiteDifference: "first-order-forward";
  readonly numerics: {
    readonly arithmetic: "ieee-754-binary64";
    readonly comparison: "object-is";
    readonly tolerance: "none";
  };
  readonly cad: {
    readonly executionProfile: { readonly id: string; readonly version: string };
    readonly profileFingerprint: ContentFingerprint;
    readonly compilationProfile: {
      readonly id: string;
      readonly version: string;
      readonly fingerprint: ContentFingerprint;
    };
    readonly runtimeBackend: {
      readonly id: string;
      readonly version: string;
      readonly isolationClass: string;
      readonly imageDigest: ContentFingerprint;
    };
    readonly outputValidator: { readonly id: string; readonly version: string };
    readonly outputManifestFingerprint: ContentFingerprint;
  };
  readonly solver: {
    readonly serverId: "calculix";
    readonly operationId: "calculix_solve_static";
    readonly providerContractVersion: "2.0";
    readonly requestLowerer: { readonly id: string; readonly version: string };
    readonly responseParser: { readonly id: string; readonly version: string };
    readonly outputValidator: { readonly id: string; readonly version: string };
    readonly runtime: SensitivityExperienceSolverRuntimeIdentity;
  };
}

export interface SensitivityExperienceScientificIdentity {
  readonly schemaVersion: "sensitivity-experience-scientific-identity/1.0";
  readonly derivationProfile: typeof SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE;
  readonly compatibilityVersion: typeof SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION;
  readonly source: {
    readonly sha256: string;
    readonly frontend: { readonly id: string; readonly version: string };
    readonly analysisPolicyProfile: string;
    readonly normalizedStructure: {
      readonly symbols: readonly SensitivityExperienceNormalizedSymbol[];
      readonly dependencies: readonly SensitivityExperienceNormalizedDependency[];
    };
    readonly semanticBindings: readonly SensitivityExperienceNormalizedBinding[];
  };
  readonly study: SensitivityExperienceScientificStudy;
  readonly method: SensitivityExperienceMethodIdentity;
}

export interface SensitivityExperienceTarget {
  readonly scientificKey: ContentFingerprint;
  readonly identity: SensitivityExperienceScientificIdentity;
}

export interface SensitivityExperienceRecord {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_RECORD_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_AUDIENCE;
  readonly scientificKey: ContentFingerprint;
  readonly identity: SensitivityExperienceScientificIdentity;
  readonly result: {
    readonly measurements: {
      readonly base: readonly SensitivityStudyMeasurement[];
      readonly stepped: readonly SensitivityStudyMeasurement[];
    };
    readonly derivatives: SensitivityDerivatives;
  };
}

export interface SensitivityExperienceOriginBinding {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_ORIGIN_BINDING_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE;
  readonly recordFingerprint: ContentFingerprint;
  readonly derivationProfile: typeof SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE;
  readonly source: {
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly trustedRunId: string;
    readonly executionPlanDigest: string;
    readonly studyArtifact: StoredArtifactIdentity;
    readonly caseArtifact: StoredArtifactIdentity;
    readonly admissionArtifact: StoredArtifactIdentity;
  };
  readonly admittedAt: string;
}

export interface StoredArtifactIdentity {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export type SensitivityExperienceInvalidationReason =
  | "source-archived"
  | "source-missing"
  | "source-corrupt"
  | "profile-retired"
  | "runtime-retired"
  | "owner-withdrawn";

export interface SensitivityExperienceInvalidation {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_INVALIDATION_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE;
  readonly recordFingerprint: ContentFingerprint;
  readonly originBindingFingerprint: ContentFingerprint;
  readonly reason: SensitivityExperienceInvalidationReason;
  readonly invalidatedAt: string;
}

export interface SensitivityExperienceAdmission {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_ADMISSION_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE;
  readonly scientificKey: ContentFingerprint;
  readonly recordFingerprint: ContentFingerprint;
  readonly originBindingFingerprint: ContentFingerprint;
}

export type SensitivityExperienceReuseOutcome =
  | "exact"
  | "incompatible"
  | "unresolved"
  | "unavailable";

export type SensitivityExperienceReuseReason =
  | "exact-match"
  | "scientific-key-miss"
  | "divergent-results"
  | "source-unhealthy"
  | "source-invalidated"
  | "profile-incompatible"
  | "target-basis-stale"
  | "index-unavailable";

export interface SensitivityExperienceReuseReview {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_AUDIENCE;
  readonly target: {
    readonly projectId: string;
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly basisFingerprint: ContentFingerprint;
  };
  readonly scientificKey: ContentFingerprint;
  readonly derivationProfile: typeof SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE;
  readonly compatibilityVersion: typeof SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION;
  readonly outcome: SensitivityExperienceReuseOutcome;
  readonly reasons: readonly SensitivityExperienceReuseReason[];
  readonly selection?: {
    readonly recordFingerprint: ContentFingerprint;
    readonly originBindingFingerprint: ContentFingerprint;
  };
  readonly freshExecutionRequired: boolean;
  readonly reviewedAt: string;
}

export interface SensitivityExperienceReuseReceipt {
  readonly schemaVersion: typeof SENSITIVITY_EXPERIENCE_REUSE_RECEIPT_SCHEMA;
  readonly audience: typeof SENSITIVITY_EXPERIENCE_AUDIENCE;
  readonly status: "reused-exact";
  readonly target: SensitivityExperienceReuseReview["target"];
  readonly scientificKey: ContentFingerprint;
  readonly reviewFingerprint: ContentFingerprint;
  readonly recordFingerprint: ContentFingerprint;
  readonly originBindingFingerprint: ContentFingerprint;
  readonly derivationProfile: typeof SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE;
  readonly compatibilityVersion: typeof SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION;
  readonly sourceHealth: "valid";
  readonly workAvoided: typeof SENSITIVITY_EXPERIENCE_WORK_AVOIDED;
  readonly freshExecutionRequired: false;
  readonly issuedAt: string;
}

export interface CompileSensitivityExperienceTargetInput {
  readonly studyCase: SensitivityStudyCaseV2;
  readonly admission: { readonly document: TechnicalCompilationDocument };
  readonly build123dProfile: SensitivityExperienceBuild123dProfileInput;
  readonly solverRuntime: SensitivityExperienceSolverRuntimeIdentity;
}

/** Minimal inward-facing facts from the server-owned Build123d profile. */
export interface SensitivityExperienceBuild123dProfileInput {
  readonly executionProfile: { readonly id: string; readonly version: string };
  readonly profileFingerprint: ContentFingerprint;
  readonly compilationProfileFingerprint: ContentFingerprint;
  readonly runtimeBackend: {
    readonly id: string;
    readonly version: string;
  };
  readonly runtime: {
    readonly isolationClass: string;
    readonly imageDigest: ContentFingerprint;
  };
  readonly outputValidator: { readonly id: string; readonly version: string };
  readonly outputManifest: readonly unknown[];
}

/** Derive a project-neutral exact identity from server-reopened evidence only. */
export async function compileSensitivityExperienceTarget(
  input: CompileSensitivityExperienceTargetInput,
): Promise<SensitivityExperienceTarget> {
  const studyCase = validateSensitivityStudyCaseV2(input.studyCase);
  const profile = requireSingleBuild123dProjection(input.admission);
  if (
    profile.profileFingerprint.digest !==
      input.build123dProfile.compilationProfileFingerprint.digest
  ) {
    throw new TypeError(
      "Admitted compilation profile differs from the runtime profile.",
    );
  }
  const outputManifestFingerprint = await sha256Fingerprint(
    input.build123dProfile.outputManifest,
  );
  return await compileSensitivityExperienceTargetWithMethod({
    studyCase,
    admission: input.admission,
    method: {
      operation: { id: "analyze.run-fea-sensitivity", version: "1" },
      finiteDifference: "first-order-forward",
      numerics: {
        arithmetic: "ieee-754-binary64",
        comparison: "object-is",
        tolerance: "none",
      },
      cad: {
        executionProfile: input.build123dProfile.executionProfile,
        profileFingerprint: input.build123dProfile.profileFingerprint,
        compilationProfile: {
          id: profile.profile.id,
          version: profile.profile.version,
          fingerprint: profile.profileFingerprint,
        },
        runtimeBackend: {
          id: input.build123dProfile.runtimeBackend.id,
          version: input.build123dProfile.runtimeBackend.version,
          isolationClass: input.build123dProfile.runtime.isolationClass,
          imageDigest: input.build123dProfile.runtime.imageDigest,
        },
        outputValidator: input.build123dProfile.outputValidator,
        outputManifestFingerprint,
      },
      solver: {
        serverId: "calculix",
        operationId: "calculix_solve_static",
        providerContractVersion: "2.0",
        requestLowerer: {
          id: "sensitivity-calculix-static-request-lowerer",
          version: "1.0.0",
        },
        responseParser: {
          id: "fea-solver-result-capture-parser",
          version: "1.0.0",
        },
        outputValidator: {
          id: "sensitivity-static-observation-validator",
          version: "1.0.0",
        },
        runtime: validateSolverRuntimeIdentity(input.solverRuntime),
      },
    },
  });
}

/** Recompile old evidence with the exact method identity sealed before dispatch. */
export async function compileSensitivityExperienceTargetWithMethod(input: {
  readonly studyCase: SensitivityStudyCaseV2;
  readonly admission: CompileSensitivityExperienceTargetInput["admission"];
  readonly method: SensitivityExperienceMethodIdentity;
}): Promise<SensitivityExperienceTarget> {
  const studyCase = validateSensitivityStudyCaseV2(input.studyCase);
  const source = requireSingleAdmittedSource(input.admission);
  const sourceFingerprint = await sha256Fingerprint(source.sourceText);
  if (!fingerprintsEqual(sourceFingerprint, source.analysis.source.fingerprint)) {
    throw new TypeError(
      "Admitted source bytes diverge from the closed frontend digest.",
    );
  }
  if (source.analysis.policy.status !== "passed") {
    throw new TypeError("Admitted source analysis is not passed.");
  }
  const symbolsById = new Map(
    source.analysis.symbols.map((symbol) => [symbol.id, symbol] as const),
  );
  const normalizedSymbolsById = new Map(
    await Promise.all(source.analysis.symbols.map(async (symbol) =>
      [
        symbol.id,
        {
          kind: symbol.kind,
          name: await opaqueDigest(symbol.name),
        } satisfies SensitivityExperienceNormalizedSymbol,
      ] as const
    )),
  );
  const normalizedSymbols = [...normalizedSymbolsById.values()].sort(
    compareNormalizedSymbol,
  );
  const normalizedDependencies = source.analysis.dependencies.map((dependency) => {
    const from = symbolsById.get(dependency.fromSymbolId);
    const to = symbolsById.get(dependency.toSymbolId);
    if (!from || !to) {
      throw new TypeError("Source analysis dependency is not closed over its symbols.");
    }
    const normalizedFrom = normalizedSymbolsById.get(dependency.fromSymbolId);
    const normalizedTo = normalizedSymbolsById.get(dependency.toSymbolId);
    if (!normalizedFrom || !normalizedTo) {
      throw new TypeError("Normalized source structure is incomplete.");
    }
    return {
      kind: dependency.kind,
      from: normalizedFrom,
      to: normalizedTo,
    };
  }).sort(compareCanonical);
  const semanticBindings = input.admission.document.inputManifest.bindings.map(
    (binding) => {
      const symbol = symbolsById.get(binding.sourceSymbolId);
      if (!symbol) {
        throw new TypeError("Compilation binding does not name an admitted symbol.");
      }
      const normalizedSymbol = normalizedSymbolsById.get(binding.sourceSymbolId);
      if (!normalizedSymbol) {
        throw new TypeError("Compilation binding has no normalized symbol.");
      }
      return {
        relation: binding.relation,
        sourceSymbol: normalizedSymbol,
        targetKind: binding.sysmlElementKind,
        role: symbol.kind === "parameter" &&
            symbol.name === studyCase.target.semanticKey
          ? "target-parameter" as const
          : "compiled-binding" as const,
      };
    },
  ).sort(compareCanonical);
  if (
    semanticBindings.filter((binding) => binding.role === "target-parameter").length !==
      1
  ) {
    throw new TypeError(
      "Experience identity requires one exact target-parameter binding.",
    );
  }
  const identity: SensitivityExperienceScientificIdentity = deepFreeze({
    schemaVersion: "sensitivity-experience-scientific-identity/1.0",
    derivationProfile: SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE,
    compatibilityVersion: SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION,
    source: {
      sha256: sourceFingerprint.digest,
      frontend: source.analysis.analyzer,
      analysisPolicyProfile: source.analysis.policy.profile,
      normalizedStructure: {
        symbols: normalizedSymbols,
        dependencies: normalizedDependencies,
      },
      semanticBindings,
    },
    study: await normalizeScientificStudy(studyCase),
    method: parseMethodIdentity(input.method),
  });
  const validated = await validateSensitivityExperienceScientificIdentity(identity);
  return deepFreeze({
    identity: validated,
    scientificKey: await sha256Fingerprint(validated),
  });
}

export async function deriveSensitivityExperienceRecord(
  target: SensitivityExperienceTarget,
  value: unknown,
): Promise<SensitivityExperienceRecord> {
  const capture = await validateSensitivityStudyCapture(value);
  const normalizedStudy = await normalizeScientificStudy(capture.studyCase);
  if (deterministicJson(normalizedStudy) !== deterministicJson(target.identity.study)) {
    throw new TypeError(
      "Sensitivity capture differs from the compiled target identity.",
    );
  }
  const record: SensitivityExperienceRecord = {
    schemaVersion: SENSITIVITY_EXPERIENCE_RECORD_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
    scientificKey: target.scientificKey,
    identity: target.identity,
    result: {
      measurements: {
        base: [...capture.measurements.base].sort(compareMeasurement),
        stepped: [...capture.measurements.stepped].sort(compareMeasurement),
      },
      derivatives: capture.derivatives,
    },
  };
  return await validateSensitivityExperienceRecord(record);
}

/** Exact pre-dispatch plan seal written into the existing sensitivity WAL. */
export async function sensitivityExperienceExecutionPlanDigest(input: {
  readonly caseDigest: string;
  readonly cadSource: SensitivityStudyCaseV2["cadSource"];
  readonly step: SensitivityStudyCaseV2["step"];
  readonly scientificKey: ContentFingerprint;
}): Promise<string> {
  return (await sha256Fingerprint({
    schemaVersion: "sensitivity-experience-execution-plan/1.0",
    caseDigest: sha256Hex(input.caseDigest, "$executionPlan.caseDigest"),
    cadSource: input.cadSource,
    step: input.step,
    scientificKey: parseFingerprint(
      input.scientificKey,
      "$executionPlan.scientificKey",
    ),
  })).digest;
}

export async function validateSensitivityExperienceRecord(
  value: unknown,
): Promise<SensitivityExperienceRecord> {
  const root = exactRecord(value, [
    "schemaVersion",
    "audience",
    "scientificKey",
    "identity",
    "result",
  ], "$sensitivityExperienceRecord");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_RECORD_SCHEMA,
    "$sensitivityExperienceRecord.schemaVersion",
  );
  literalValue(
    root.audience,
    SENSITIVITY_EXPERIENCE_AUDIENCE,
    "$sensitivityExperienceRecord.audience",
  );
  const identity = await validateSensitivityExperienceScientificIdentity(root.identity);
  const scientificKey = parseFingerprint(
    root.scientificKey,
    "$sensitivityExperienceRecord.scientificKey",
  );
  const observedKey = await sha256Fingerprint(identity);
  if (!fingerprintsEqual(scientificKey, observedKey)) {
    throw new TypeError("$sensitivityExperienceRecord.scientificKey is divergent.");
  }
  const result = exactRecord(
    root.result,
    ["measurements", "derivatives"],
    "$sensitivityExperienceRecord.result",
  );
  const measurements = exactRecord(
    result.measurements,
    ["base", "stepped"],
    "$sensitivityExperienceRecord.result.measurements",
  );
  const base = parseMeasurements(
    measurements.base,
    identity.study.metrics,
    "$sensitivityExperienceRecord.result.measurements.base",
  );
  const stepped = parseMeasurements(
    measurements.stepped,
    identity.study.metrics,
    "$sensitivityExperienceRecord.result.measurements.stepped",
  );
  if (
    deterministicJson(base) !== deterministicJson([...base].sort(compareMeasurement)) ||
    deterministicJson(stepped) !==
      deterministicJson([...stepped].sort(compareMeasurement))
  ) {
    throw new TypeError(
      "$sensitivityExperienceRecord.result.measurements are not in canonical order.",
    );
  }
  const computed = computeSensitivities(
    identity.study,
    new Map(base.map((item) => [item.metric, item])),
    new Map(stepped.map((item) => [item.metric, item])),
  );
  if (deterministicJson(result.derivatives) !== deterministicJson(computed)) {
    throw new TypeError(
      "$sensitivityExperienceRecord.result.derivatives is divergent.",
    );
  }
  return deepFreeze({
    schemaVersion: SENSITIVITY_EXPERIENCE_RECORD_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
    scientificKey,
    identity,
    result: { measurements: { base, stepped }, derivatives: computed },
  });
}

export function createSensitivityExperienceOriginBinding(input: {
  readonly recordFingerprint: ContentFingerprint;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly studyArtifact: ThreadArtifact;
  readonly caseArtifact: ThreadArtifact;
  readonly admissionArtifact: ThreadArtifact;
  readonly trustedRunId: string;
  readonly executionPlanDigest: string;
  readonly admittedAt: string;
}): SensitivityExperienceOriginBinding {
  return validateSensitivityExperienceOriginBinding({
    schemaVersion: SENSITIVITY_EXPERIENCE_ORIGIN_BINDING_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    recordFingerprint: input.recordFingerprint,
    derivationProfile: SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE,
    source: {
      projectId: input.projectId,
      basis: input.basis,
      trustedRunId: input.trustedRunId,
      executionPlanDigest: input.executionPlanDigest,
      studyArtifact: artifactIdentity(input.studyArtifact),
      caseArtifact: artifactIdentity(input.caseArtifact),
      admissionArtifact: artifactIdentity(input.admissionArtifact),
    },
    admittedAt: input.admittedAt,
  });
}

export function validateSensitivityExperienceOriginBinding(
  value: unknown,
): SensitivityExperienceOriginBinding {
  const root = exactRecord(value, [
    "schemaVersion",
    "audience",
    "recordFingerprint",
    "derivationProfile",
    "source",
    "admittedAt",
  ], "$sensitivityExperienceOriginBinding");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_ORIGIN_BINDING_SCHEMA,
    "$sensitivityExperienceOriginBinding.schemaVersion",
  );
  literalValue(
    root.audience,
    SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    "$sensitivityExperienceOriginBinding.audience",
  );
  const source = exactRecord(root.source, [
    "projectId",
    "basis",
    "trustedRunId",
    "executionPlanDigest",
    "studyArtifact",
    "caseArtifact",
    "admissionArtifact",
  ], "$sensitivityExperienceOriginBinding.source");
  return deepFreeze({
    schemaVersion: SENSITIVITY_EXPERIENCE_ORIGIN_BINDING_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    recordFingerprint: parseFingerprint(
      root.recordFingerprint,
      "$sensitivityExperienceOriginBinding.recordFingerprint",
    ),
    derivationProfile: parseDerivationProfile(
      root.derivationProfile,
      "$sensitivityExperienceOriginBinding.derivationProfile",
    ),
    source: {
      projectId: safeId(
        source.projectId,
        "$sensitivityExperienceOriginBinding.source.projectId",
      ),
      basis: parseBasis(
        source.basis,
        "$sensitivityExperienceOriginBinding.source.basis",
      ),
      trustedRunId: safeId(
        source.trustedRunId,
        "$sensitivityExperienceOriginBinding.source.trustedRunId",
      ),
      executionPlanDigest: sha256Hex(
        source.executionPlanDigest,
        "$sensitivityExperienceOriginBinding.source.executionPlanDigest",
      ),
      studyArtifact: parseArtifactIdentity(
        source.studyArtifact,
        "$sensitivityExperienceOriginBinding.source.studyArtifact",
      ),
      caseArtifact: parseArtifactIdentity(
        source.caseArtifact,
        "$sensitivityExperienceOriginBinding.source.caseArtifact",
      ),
      admissionArtifact: parseArtifactIdentity(
        source.admissionArtifact,
        "$sensitivityExperienceOriginBinding.source.admissionArtifact",
      ),
    },
    admittedAt: isoDate(
      root.admittedAt,
      "$sensitivityExperienceOriginBinding.admittedAt",
    ),
  });
}

export function validateSensitivityExperienceInvalidation(
  value: unknown,
): SensitivityExperienceInvalidation {
  const root = exactRecord(value, [
    "schemaVersion",
    "audience",
    "recordFingerprint",
    "originBindingFingerprint",
    "reason",
    "invalidatedAt",
  ], "$sensitivityExperienceInvalidation");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_INVALIDATION_SCHEMA,
    "$sensitivityExperienceInvalidation.schemaVersion",
  );
  literalValue(
    root.audience,
    SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    "$sensitivityExperienceInvalidation.audience",
  );
  return deepFreeze({
    schemaVersion: SENSITIVITY_EXPERIENCE_INVALIDATION_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    recordFingerprint: parseFingerprint(
      root.recordFingerprint,
      "$sensitivityExperienceInvalidation.recordFingerprint",
    ),
    originBindingFingerprint: parseFingerprint(
      root.originBindingFingerprint,
      "$sensitivityExperienceInvalidation.originBindingFingerprint",
    ),
    reason: oneOf(
      root.reason,
      [
        "source-archived",
        "source-missing",
        "source-corrupt",
        "profile-retired",
        "runtime-retired",
        "owner-withdrawn",
      ] as const,
      "$sensitivityExperienceInvalidation.reason",
    ),
    invalidatedAt: isoDate(
      root.invalidatedAt,
      "$sensitivityExperienceInvalidation.invalidatedAt",
    ),
  });
}

export function validateSensitivityExperienceAdmission(
  value: unknown,
): SensitivityExperienceAdmission {
  const root = exactRecord(value, [
    "schemaVersion",
    "audience",
    "scientificKey",
    "recordFingerprint",
    "originBindingFingerprint",
  ], "$sensitivityExperienceAdmission");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_ADMISSION_SCHEMA,
    "$sensitivityExperienceAdmission.schemaVersion",
  );
  literalValue(
    root.audience,
    SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    "$sensitivityExperienceAdmission.audience",
  );
  return deepFreeze({
    schemaVersion: SENSITIVITY_EXPERIENCE_ADMISSION_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_ORIGIN_AUDIENCE,
    scientificKey: parseFingerprint(
      root.scientificKey,
      "$sensitivityExperienceAdmission.scientificKey",
    ),
    recordFingerprint: parseFingerprint(
      root.recordFingerprint,
      "$sensitivityExperienceAdmission.recordFingerprint",
    ),
    originBindingFingerprint: parseFingerprint(
      root.originBindingFingerprint,
      "$sensitivityExperienceAdmission.originBindingFingerprint",
    ),
  });
}

export function validateSensitivityExperienceReuseReview(
  value: unknown,
): SensitivityExperienceReuseReview {
  const root = exactRecord(value, [
    "schemaVersion",
    "audience",
    "target",
    "scientificKey",
    "derivationProfile",
    "compatibilityVersion",
    "outcome",
    "reasons",
    ...(value && typeof value === "object" && "selection" in value
      ? ["selection"] as const
      : []),
    "freshExecutionRequired",
    "reviewedAt",
  ], "$sensitivityExperienceReuseReview");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA,
    "$sensitivityExperienceReuseReview.schemaVersion",
  );
  literalValue(
    root.audience,
    SENSITIVITY_EXPERIENCE_AUDIENCE,
    "$sensitivityExperienceReuseReview.audience",
  );
  const target = parseReviewTarget(root.target);
  const outcome = oneOf(
    root.outcome,
    ["exact", "incompatible", "unresolved", "unavailable"] as const,
    "$sensitivityExperienceReuseReview.outcome",
  );
  const reasons = arrayOf(root.reasons, "$sensitivityExperienceReuseReview.reasons")
    .map((reason, index) =>
      oneOf(
        reason,
        [
          "exact-match",
          "scientific-key-miss",
          "divergent-results",
          "source-unhealthy",
          "source-invalidated",
          "profile-incompatible",
          "target-basis-stale",
          "index-unavailable",
        ] as const,
        `$sensitivityExperienceReuseReview.reasons[${index}]`,
      )
    );
  if (reasons.length === 0) {
    throw new TypeError("$sensitivityExperienceReuseReview.reasons must not be empty.");
  }
  rejectDuplicates(reasons, "$sensitivityExperienceReuseReview.reasons");
  const freshExecutionRequired = booleanValue(
    root.freshExecutionRequired,
    "$sensitivityExperienceReuseReview.freshExecutionRequired",
  );
  const selection = root.selection === undefined
    ? undefined
    : parseSelection(root.selection);
  if (
    (outcome === "exact") !== (selection !== undefined) ||
    (outcome === "exact") === freshExecutionRequired ||
    (outcome === "exact") !== reasons.includes("exact-match")
  ) {
    throw new TypeError("$sensitivityExperienceReuseReview outcome is inconsistent.");
  }
  return deepFreeze({
    schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_REVIEW_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
    target,
    scientificKey: parseFingerprint(
      root.scientificKey,
      "$sensitivityExperienceReuseReview.scientificKey",
    ),
    derivationProfile: parseDerivationProfile(
      root.derivationProfile,
      "$sensitivityExperienceReuseReview.derivationProfile",
    ),
    compatibilityVersion: parseCompatibilityVersion(
      root.compatibilityVersion,
      "$sensitivityExperienceReuseReview.compatibilityVersion",
    ),
    outcome,
    reasons,
    ...(selection === undefined ? {} : { selection }),
    freshExecutionRequired,
    reviewedAt: isoDate(
      root.reviewedAt,
      "$sensitivityExperienceReuseReview.reviewedAt",
    ),
  });
}

export function validateSensitivityExperienceReuseReceipt(
  value: unknown,
): SensitivityExperienceReuseReceipt {
  const root = exactRecord(value, [
    "schemaVersion",
    "audience",
    "status",
    "target",
    "scientificKey",
    "reviewFingerprint",
    "recordFingerprint",
    "originBindingFingerprint",
    "derivationProfile",
    "compatibilityVersion",
    "sourceHealth",
    "workAvoided",
    "freshExecutionRequired",
    "issuedAt",
  ], "$sensitivityExperienceReuseReceipt");
  literalValue(
    root.schemaVersion,
    SENSITIVITY_EXPERIENCE_REUSE_RECEIPT_SCHEMA,
    "$sensitivityExperienceReuseReceipt.schemaVersion",
  );
  literalValue(
    root.audience,
    SENSITIVITY_EXPERIENCE_AUDIENCE,
    "$sensitivityExperienceReuseReceipt.audience",
  );
  literalValue(
    root.status,
    "reused-exact",
    "$sensitivityExperienceReuseReceipt.status",
  );
  literalValue(
    root.sourceHealth,
    "valid",
    "$sensitivityExperienceReuseReceipt.sourceHealth",
  );
  literalValue(
    root.freshExecutionRequired,
    false,
    "$sensitivityExperienceReuseReceipt.freshExecutionRequired",
  );
  if (
    deterministicJson(root.workAvoided) !==
      deterministicJson(SENSITIVITY_EXPERIENCE_WORK_AVOIDED)
  ) {
    throw new TypeError("$sensitivityExperienceReuseReceipt.workAvoided is divergent.");
  }
  return deepFreeze({
    schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_RECEIPT_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
    status: "reused-exact",
    target: parseReviewTarget(root.target),
    scientificKey: parseFingerprint(
      root.scientificKey,
      "$sensitivityExperienceReuseReceipt.scientificKey",
    ),
    reviewFingerprint: parseFingerprint(
      root.reviewFingerprint,
      "$sensitivityExperienceReuseReceipt.reviewFingerprint",
    ),
    recordFingerprint: parseFingerprint(
      root.recordFingerprint,
      "$sensitivityExperienceReuseReceipt.recordFingerprint",
    ),
    originBindingFingerprint: parseFingerprint(
      root.originBindingFingerprint,
      "$sensitivityExperienceReuseReceipt.originBindingFingerprint",
    ),
    derivationProfile: parseDerivationProfile(
      root.derivationProfile,
      "$sensitivityExperienceReuseReceipt.derivationProfile",
    ),
    compatibilityVersion: parseCompatibilityVersion(
      root.compatibilityVersion,
      "$sensitivityExperienceReuseReceipt.compatibilityVersion",
    ),
    sourceHealth: "valid",
    workAvoided: SENSITIVITY_EXPERIENCE_WORK_AVOIDED,
    freshExecutionRequired: false,
    issuedAt: isoDate(root.issuedAt, "$sensitivityExperienceReuseReceipt.issuedAt"),
  });
}

export async function makeSensitivityExperienceReuseReceipt(input: {
  readonly review: SensitivityExperienceReuseReview;
  readonly reviewFingerprint: ContentFingerprint;
  readonly issuedAt: string;
}): Promise<SensitivityExperienceReuseReceipt> {
  const review = validateSensitivityExperienceReuseReview(input.review);
  if (review.outcome !== "exact" || !review.selection) {
    throw new TypeError("A reuse receipt requires an exact selected review.");
  }
  const observed = await sha256Fingerprint(review);
  if (!fingerprintsEqual(observed, input.reviewFingerprint)) {
    throw new TypeError("Reuse review fingerprint is divergent.");
  }
  return validateSensitivityExperienceReuseReceipt({
    schemaVersion: SENSITIVITY_EXPERIENCE_REUSE_RECEIPT_SCHEMA,
    audience: SENSITIVITY_EXPERIENCE_AUDIENCE,
    status: "reused-exact",
    target: review.target,
    scientificKey: review.scientificKey,
    reviewFingerprint: input.reviewFingerprint,
    recordFingerprint: review.selection.recordFingerprint,
    originBindingFingerprint: review.selection.originBindingFingerprint,
    derivationProfile: review.derivationProfile,
    compatibilityVersion: review.compatibilityVersion,
    sourceHealth: "valid",
    workAvoided: SENSITIVITY_EXPERIENCE_WORK_AVOIDED,
    freshExecutionRequired: false,
    issuedAt: input.issuedAt,
  });
}

function validateSensitivityExperienceScientificIdentity(
  value: unknown,
): SensitivityExperienceScientificIdentity {
  const root = exactRecord(value, [
    "schemaVersion",
    "derivationProfile",
    "compatibilityVersion",
    "source",
    "study",
    "method",
  ], "$sensitivityExperienceScientificIdentity");
  literalValue(
    root.schemaVersion,
    "sensitivity-experience-scientific-identity/1.0",
    "$sensitivityExperienceScientificIdentity.schemaVersion",
  );
  const source = exactRecord(root.source, [
    "sha256",
    "frontend",
    "analysisPolicyProfile",
    "normalizedStructure",
    "semanticBindings",
  ], "$sensitivityExperienceScientificIdentity.source");
  const structure = exactRecord(
    source.normalizedStructure,
    ["symbols", "dependencies"],
    "$sensitivityExperienceScientificIdentity.source.normalizedStructure",
  );
  const symbols = arrayOf(
    structure.symbols,
    "$sensitivityExperienceScientificIdentity.source.normalizedStructure.symbols",
  ).map((item, index) => parseNormalizedSymbol(item, `$.symbols[${index}]`));
  const dependencies = arrayOf(
    structure.dependencies,
    "$sensitivityExperienceScientificIdentity.source.normalizedStructure.dependencies",
  ).map((item, index) => {
    const row = exactRecord(item, ["kind", "from", "to"], `$.dependencies[${index}]`);
    return {
      kind: safeId(row.kind, `$.dependencies[${index}].kind`),
      from: parseNormalizedSymbol(row.from, `$.dependencies[${index}].from`),
      to: parseNormalizedSymbol(row.to, `$.dependencies[${index}].to`),
    };
  });
  const semanticBindings = arrayOf(
    source.semanticBindings,
    "$sensitivityExperienceScientificIdentity.source.semanticBindings",
  ).map((item, index) => {
    const row = exactRecord(
      item,
      ["relation", "sourceSymbol", "targetKind", "role"],
      `$.semanticBindings[${index}]`,
    );
    return {
      relation: safeId(row.relation, `$.semanticBindings[${index}].relation`),
      sourceSymbol: parseNormalizedSymbol(
        row.sourceSymbol,
        `$.semanticBindings[${index}].sourceSymbol`,
      ),
      targetKind: nonEmptyText(
        row.targetKind,
        `$.semanticBindings[${index}].targetKind`,
      ),
      role: oneOf(
        row.role,
        ["target-parameter", "compiled-binding"] as const,
        `$.semanticBindings[${index}].role`,
      ),
    };
  });
  if (
    semanticBindings.filter((item) => item.role === "target-parameter").length !== 1
  ) {
    throw new TypeError("Scientific identity requires one target-parameter binding.");
  }
  symbols.forEach((symbol, index) =>
    requireOpaqueDigest(symbol.name, `$.symbols[${index}].name`)
  );
  const symbolKeys = new Set(symbols.map((symbol) => deterministicJson(symbol)));
  dependencies.forEach((dependency, index) => {
    requireOpaqueDigest(dependency.from.name, `$.dependencies[${index}].from.name`);
    requireOpaqueDigest(dependency.to.name, `$.dependencies[${index}].to.name`);
    if (
      !symbolKeys.has(deterministicJson(dependency.from)) ||
      !symbolKeys.has(deterministicJson(dependency.to))
    ) throw new TypeError("Scientific identity dependency is not symbol-closed.");
  });
  semanticBindings.forEach((binding, index) => {
    requireOpaqueDigest(
      binding.sourceSymbol.name,
      `$.semanticBindings[${index}].sourceSymbol.name`,
    );
    if (!symbolKeys.has(deterministicJson(binding.sourceSymbol))) {
      throw new TypeError("Scientific identity binding is not symbol-closed.");
    }
  });
  if (
    deterministicJson(symbols) !==
      deterministicJson([...symbols].sort(compareNormalizedSymbol)) ||
    deterministicJson(dependencies) !==
      deterministicJson([...dependencies].sort(compareCanonical)) ||
    deterministicJson(semanticBindings) !==
      deterministicJson([...semanticBindings].sort(compareCanonical))
  ) {
    throw new TypeError("Scientific identity normalized arrays are not canonical.");
  }
  return deepFreeze({
    schemaVersion: "sensitivity-experience-scientific-identity/1.0",
    derivationProfile: parseDerivationProfile(
      root.derivationProfile,
      "$sensitivityExperienceScientificIdentity.derivationProfile",
    ),
    compatibilityVersion: parseCompatibilityVersion(
      root.compatibilityVersion,
      "$sensitivityExperienceScientificIdentity.compatibilityVersion",
    ),
    source: {
      sha256: sha256Hex(
        source.sha256,
        "$sensitivityExperienceScientificIdentity.source.sha256",
      ),
      frontend: parseRef(
        source.frontend,
        "$sensitivityExperienceScientificIdentity.source.frontend",
      ),
      analysisPolicyProfile: nonEmptyText(
        source.analysisPolicyProfile,
        "$sensitivityExperienceScientificIdentity.source.analysisPolicyProfile",
      ),
      normalizedStructure: { symbols, dependencies },
      semanticBindings,
    },
    study: parseScientificStudy(root.study),
    method: parseMethodIdentity(root.method),
  });
}

async function normalizeScientificStudy(
  studyCase: SensitivityStudyCaseV2,
): Promise<SensitivityExperienceScientificStudy> {
  const supports = await Promise.all(studyCase.solver.supports.map(async (item) => ({
    ...item,
    id: await opaqueDigest(item.id),
    selection: {
      ...item.selection,
      name: await opaqueDigest(item.selection.name),
    },
  })));
  const loads = await Promise.all(studyCase.solver.loads.map(async (item) => ({
    ...item,
    id: await opaqueDigest(item.id),
    selection: {
      ...item.selection,
      name: await opaqueDigest(item.selection.name),
    },
  })));
  return deepFreeze({
    scope: studyCase.scope,
    evidenceBoundary: studyCase.evidenceBoundary,
    target: {
      componentRole: await opaqueDigest(studyCase.target.componentKey),
      parameterRole: studyCase.target.semanticKey,
    },
    baseValue: studyCase.baseValue,
    step: studyCase.step,
    metrics: [...studyCase.metrics].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
    solver: {
      ...studyCase.solver,
      material: {
        ...studyCase.solver.material,
        basis: await opaqueDigest(studyCase.solver.material.basis),
      },
      supports: supports.sort(compareCanonical),
      loads: loads.sort(compareCanonical),
    },
    domain: {
      ...studyCase.domain,
      localValidityNote: await opaqueDigest(studyCase.domain.localValidityNote),
      limitations: (await Promise.all(
        studyCase.domain.limitations.map(opaqueDigest),
      )).sort(),
    },
  });
}

function parseScientificStudy(value: unknown): SensitivityExperienceScientificStudy {
  const root = exactRecord(value, [
    "scope",
    "evidenceBoundary",
    "target",
    "baseValue",
    "step",
    "metrics",
    "solver",
    "domain",
  ], "$scientificStudy");
  const target = exactRecord(
    root.target,
    ["componentRole", "parameterRole"],
    "$scientificStudy.target",
  );
  const parsed = validateSensitivityStudyCaseV2({
    schemaVersion: "sensitivity-study-case/2.0",
    id: "experience-validation",
    revision: 1,
    scope: root.scope,
    evidenceBoundary: root.evidenceBoundary,
    project: { id: "experience-validation", subjectId: "experience-validation" },
    target: {
      componentKey: target.componentRole,
      semanticKey: target.parameterRole,
    },
    cadSource: {
      artifactUri: "thread-artifact://experience-validation/admission",
      sha256: "0".repeat(64),
    },
    baseValue: root.baseValue,
    step: root.step,
    metrics: root.metrics,
    solver: root.solver,
    domain: root.domain,
  });
  const normalized = deepFreeze({
    scope: parsed.scope,
    evidenceBoundary: parsed.evidenceBoundary,
    target: {
      componentRole: target.componentRole as string,
      parameterRole: target.parameterRole as string,
    },
    baseValue: parsed.baseValue,
    step: parsed.step,
    metrics: [...parsed.metrics].sort((left, right) => left.id.localeCompare(right.id)),
    solver: {
      ...parsed.solver,
      supports: [...parsed.solver.supports].sort(compareCanonical),
      loads: [...parsed.solver.loads].sort(compareCanonical),
    },
    domain: {
      ...parsed.domain,
      limitations: [...parsed.domain.limitations].sort(),
    },
  });
  requireOpaqueDigest(
    normalized.target.componentRole,
    "$scientificStudy.target.componentRole",
  );
  requireOpaqueDigest(
    normalized.solver.material.basis,
    "$scientificStudy.solver.material.basis",
  );
  normalized.solver.supports.forEach((item, index) => {
    requireOpaqueDigest(item.id, `$scientificStudy.solver.supports[${index}].id`);
    requireOpaqueDigest(
      item.selection.name,
      `$scientificStudy.solver.supports[${index}].selection.name`,
    );
  });
  normalized.solver.loads.forEach((item, index) => {
    requireOpaqueDigest(item.id, `$scientificStudy.solver.loads[${index}].id`);
    requireOpaqueDigest(
      item.selection.name,
      `$scientificStudy.solver.loads[${index}].selection.name`,
    );
  });
  requireOpaqueDigest(
    normalized.domain.localValidityNote,
    "$scientificStudy.domain.localValidityNote",
  );
  normalized.domain.limitations.forEach((item, index) =>
    requireOpaqueDigest(item, `$scientificStudy.domain.limitations[${index}]`)
  );
  if (deterministicJson(normalized) !== deterministicJson(value)) {
    throw new TypeError("$scientificStudy is not in canonical order.");
  }
  return normalized;
}

function parseMethodIdentity(value: unknown): SensitivityExperienceMethodIdentity {
  const root = exactRecord(
    value,
    ["operation", "finiteDifference", "numerics", "cad", "solver"],
    "$method",
  );
  const operation = exactRecord(root.operation, ["id", "version"], "$method.operation");
  literalValue(operation.id, "analyze.run-fea-sensitivity", "$method.operation.id");
  literalValue(operation.version, "1", "$method.operation.version");
  literalValue(
    root.finiteDifference,
    "first-order-forward",
    "$method.finiteDifference",
  );
  const numerics = exactRecord(
    root.numerics,
    ["arithmetic", "comparison", "tolerance"],
    "$method.numerics",
  );
  literalValue(
    numerics.arithmetic,
    "ieee-754-binary64",
    "$method.numerics.arithmetic",
  );
  literalValue(
    numerics.comparison,
    "object-is",
    "$method.numerics.comparison",
  );
  literalValue(
    numerics.tolerance,
    "none",
    "$method.numerics.tolerance",
  );
  const cad = exactRecord(root.cad, [
    "executionProfile",
    "profileFingerprint",
    "compilationProfile",
    "runtimeBackend",
    "outputValidator",
    "outputManifestFingerprint",
  ], "$method.cad");
  const compilationProfile = exactRecord(
    cad.compilationProfile,
    ["id", "version", "fingerprint"],
    "$method.cad.compilationProfile",
  );
  const runtimeBackend = exactRecord(
    cad.runtimeBackend,
    ["id", "version", "isolationClass", "imageDigest"],
    "$method.cad.runtimeBackend",
  );
  const solver = exactRecord(root.solver, [
    "serverId",
    "operationId",
    "providerContractVersion",
    "requestLowerer",
    "responseParser",
    "outputValidator",
    "runtime",
  ], "$method.solver");
  literalValue(solver.serverId, "calculix", "$method.solver.serverId");
  literalValue(
    solver.operationId,
    "calculix_solve_static",
    "$method.solver.operationId",
  );
  literalValue(
    solver.providerContractVersion,
    "2.0",
    "$method.solver.providerContractVersion",
  );
  return deepFreeze({
    operation: { id: "analyze.run-fea-sensitivity", version: "1" },
    finiteDifference: "first-order-forward",
    numerics: {
      arithmetic: "ieee-754-binary64",
      comparison: "object-is",
      tolerance: "none",
    },
    cad: {
      executionProfile: parseRef(cad.executionProfile, "$method.cad.executionProfile"),
      profileFingerprint: parseFingerprint(
        cad.profileFingerprint,
        "$method.cad.profileFingerprint",
      ),
      compilationProfile: {
        id: safeId(compilationProfile.id, "$method.cad.compilationProfile.id"),
        version: nonEmptyText(
          compilationProfile.version,
          "$method.cad.compilationProfile.version",
        ),
        fingerprint: parseFingerprint(
          compilationProfile.fingerprint,
          "$method.cad.compilationProfile.fingerprint",
        ),
      },
      runtimeBackend: {
        id: safeId(runtimeBackend.id, "$method.cad.runtimeBackend.id"),
        version: nonEmptyText(
          runtimeBackend.version,
          "$method.cad.runtimeBackend.version",
        ),
        isolationClass: safeId(
          runtimeBackend.isolationClass,
          "$method.cad.runtimeBackend.isolationClass",
        ),
        imageDigest: parseFingerprint(
          runtimeBackend.imageDigest,
          "$method.cad.runtimeBackend.imageDigest",
        ),
      },
      outputValidator: parseRef(cad.outputValidator, "$method.cad.outputValidator"),
      outputManifestFingerprint: parseFingerprint(
        cad.outputManifestFingerprint,
        "$method.cad.outputManifestFingerprint",
      ),
    },
    solver: {
      serverId: "calculix",
      operationId: "calculix_solve_static",
      providerContractVersion: "2.0",
      requestLowerer: parseRef(solver.requestLowerer, "$method.solver.requestLowerer"),
      responseParser: parseRef(solver.responseParser, "$method.solver.responseParser"),
      outputValidator: parseRef(
        solver.outputValidator,
        "$method.solver.outputValidator",
      ),
      runtime: validateSolverRuntimeIdentity(solver.runtime),
    },
  });
}

function requireSingleAdmittedSource(
  admission: CompileSensitivityExperienceTargetInput["admission"],
) {
  if (
    admission.document.status !== "ready-for-review" ||
    admission.document.inputManifest.sources.length !== 1
  ) {
    throw new TypeError("Experience compiler requires one ready admitted source.");
  }
  return admission.document.inputManifest.sources[0]!;
}

function requireSingleBuild123dProjection(
  admission: CompileSensitivityExperienceTargetInput["admission"],
) {
  const candidates = admission.document.projections.filter((projection) =>
    projection.target === "build123d-source" &&
    projection.status === "ready-for-review" && projection.sources.length === 1
  );
  if (candidates.length !== 1) {
    throw new TypeError("Experience compiler requires one ready Build123d projection.");
  }
  return candidates[0]!;
}

function parseMeasurements(
  value: unknown,
  metrics: readonly { readonly id: string; readonly unit: string }[],
  path: string,
): readonly SensitivityStudyMeasurement[] {
  const rows = arrayOf(value, path).map((item, index) => {
    const row = exactRecord(item, ["metric", "value", "unit"], `${path}[${index}]`);
    return {
      metric: safeId(row.metric, `${path}[${index}].metric`),
      value: finite(row.value, `${path}[${index}].value`),
      unit: nonEmptyText(row.unit, `${path}[${index}].unit`),
    };
  });
  if (rows.length !== metrics.length) {
    throw new TypeError(`${path} must contain every scientific metric exactly once.`);
  }
  rejectDuplicates(rows.map((row) => row.metric), `${path} metrics`);
  for (const metric of metrics) {
    const row = rows.find((candidate) => candidate.metric === metric.id);
    if (!row || row.unit !== metric.unit) {
      throw new TypeError(`${path} does not match scientific metric ${metric.id}.`);
    }
  }
  return rows;
}

function validateSolverRuntimeIdentity(
  value: unknown,
): SensitivityExperienceSolverRuntimeIdentity {
  const root = exactRecord(value, ["imageReference", "imageDigest"], "$solverRuntime");
  const imageReference = nonEmptyText(
    root.imageReference,
    "$solverRuntime.imageReference",
  );
  const marker = "@sha256:";
  const markerIndex = imageReference.lastIndexOf(marker);
  if (markerIndex <= 0 || markerIndex + marker.length + 64 !== imageReference.length) {
    throw new TypeError("$solverRuntime.imageReference must be digest-pinned.");
  }
  const imageDigest = parseFingerprint(root.imageDigest, "$solverRuntime.imageDigest");
  if (imageReference.slice(markerIndex + marker.length) !== imageDigest.digest) {
    throw new TypeError("$solverRuntime.imageDigest differs from imageReference.");
  }
  return deepFreeze({ imageReference, imageDigest });
}

export function solverRuntimeIdentityFromImageReference(
  imageReference: string,
): SensitivityExperienceSolverRuntimeIdentity {
  const marker = "@sha256:";
  const markerIndex = imageReference.lastIndexOf(marker);
  const digest = markerIndex < 0
    ? ""
    : imageReference.slice(markerIndex + marker.length);
  return validateSolverRuntimeIdentity({
    imageReference,
    imageDigest: { algorithm: "sha256", digest },
  });
}

function parseReviewTarget(value: unknown): SensitivityExperienceReuseReview["target"] {
  const root = exactRecord(
    value,
    ["projectId", "basis", "basisFingerprint"],
    "$reviewTarget",
  );
  return {
    projectId: safeId(root.projectId, "$reviewTarget.projectId"),
    basis: parseBasis(root.basis, "$reviewTarget.basis"),
    basisFingerprint: parseFingerprint(
      root.basisFingerprint,
      "$reviewTarget.basisFingerprint",
    ),
  };
}

function parseSelection(
  value: unknown,
): NonNullable<SensitivityExperienceReuseReview["selection"]> {
  const root = exactRecord(
    value,
    ["recordFingerprint", "originBindingFingerprint"],
    "$review.selection",
  );
  return {
    recordFingerprint: parseFingerprint(
      root.recordFingerprint,
      "$review.selection.recordFingerprint",
    ),
    originBindingFingerprint: parseFingerprint(
      root.originBindingFingerprint,
      "$review.selection.originBindingFingerprint",
    ),
  };
}

function parseBasis(value: unknown, path: string): EngineeringThreadSnapshotBasis {
  const root = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId"],
    path,
  );
  literalValue(root.kind, "thread-snapshot", `${path}.kind`);
  return {
    kind: "thread-snapshot",
    snapshotId: safeId(root.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  };
}

function parseArtifactIdentity(value: unknown, path: string): StoredArtifactIdentity {
  const root = exactRecord(value, ["id", "fingerprint"], path);
  return {
    id: safeId(root.id, `${path}.id`),
    fingerprint: parseFingerprint(root.fingerprint, `${path}.fingerprint`),
  };
}

function artifactIdentity(artifact: ThreadArtifact): StoredArtifactIdentity {
  return { id: artifact.id, fingerprint: artifact.fingerprint };
}

function parseNormalizedSymbol(
  value: unknown,
  path: string,
): SensitivityExperienceNormalizedSymbol {
  const root = exactRecord(value, ["kind", "name"], path);
  return {
    kind: safeId(root.kind, `${path}.kind`),
    name: nonEmptyText(root.name, `${path}.name`),
  };
}

function parseRef(
  value: unknown,
  path: string,
): { readonly id: string; readonly version: string } {
  const root = exactRecord(value, ["id", "version"], path);
  return {
    id: safeId(root.id, `${path}.id`),
    version: nonEmptyText(root.version, `${path}.version`),
  };
}

function parseDerivationProfile(
  value: unknown,
  path: string,
): typeof SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE {
  const ref = parseRef(value, path);
  literalValue(ref.id, SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE.id, `${path}.id`);
  literalValue(
    ref.version,
    SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE.version,
    `${path}.version`,
  );
  return SENSITIVITY_EXPERIENCE_DERIVATION_PROFILE;
}

function parseCompatibilityVersion(
  value: unknown,
  path: string,
): typeof SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION {
  literalValue(value, SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION, path);
  return SENSITIVITY_EXPERIENCE_COMPATIBILITY_VERSION;
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const root = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(root.algorithm, "sha256", `${path}.algorithm`);
  return { algorithm: "sha256", digest: sha256Hex(root.digest, `${path}.digest`) };
}

function sha256Hex(value: unknown, path: string): string {
  const digest = nonEmptyText(value, path);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return digest;
}

function isoDate(value: unknown, path: string): string {
  const text = nonEmptyText(value, path);
  if (Number.isNaN(Date.parse(text))) throw new TypeError(`${path} must be ISO-8601.`);
  return text;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") throw new TypeError(`${path} must be boolean.`);
  return value;
}

function oneOf<const Values extends readonly string[]>(
  value: unknown,
  allowed: Values,
  path: string,
): Values[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new TypeError(`${path} is not a registered literal.`);
  }
  return value as Values[number];
}

function compareNormalizedSymbol(
  left: SensitivityExperienceNormalizedSymbol,
  right: SensitivityExperienceNormalizedSymbol,
): number {
  return compareCanonical(left, right);
}

function compareCanonical(left: unknown, right: unknown): number {
  const a = deterministicJson(left);
  const b = deterministicJson(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareMeasurement(
  left: SensitivityStudyMeasurement,
  right: SensitivityStudyMeasurement,
): number {
  return left.metric.localeCompare(right.metric);
}

async function opaqueDigest(value: string): Promise<string> {
  return `h${(await sha256Fingerprint(value)).digest.slice(0, 63)}`;
}

function requireOpaqueDigest(value: string, path: string): void {
  if (!/^h[a-f0-9]{63}$/.test(value)) {
    throw new TypeError(`${path} must be an opaque SHA-256 digest.`);
  }
}
