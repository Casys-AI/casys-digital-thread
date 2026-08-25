/**
 * Provider-free L4 assembly-integrity evaluation.
 *
 * This module applies one closed, code-owned method to normalized L3 facts.
 * It has no provider client, physical tolerance-based acceptance rule, SysML requirement
 * evaluation, project mutation, or human closeout authority.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
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
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import type { EngineeringThreadSnapshotBasis } from "../../project/engineering-project.ts";
import {
  ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
} from "./assembly-integrity-input-bundle.ts";
import {
  ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE,
  type AssemblyIntegrityObservation,
} from "./assembly-integrity-observation.ts";
import {
  ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA,
} from "./assembly-integrity-observation-capture.ts";
import {
  VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
} from "./assembly-integrity-evaluation-proposal.ts";

export const ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA =
  "assembly-integrity-evaluation-method/1.0" as const;
export const ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA =
  "assembly-integrity-evaluation-capture/1.0" as const;
export const ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX =
  "casys://assembly-integrity-evaluation-capture/sha256/" as const;

export const ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID =
  "assembly-integrity-evaluation" as const;
export const ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION = "1.0" as const;

export const ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA = [
  "assembly-import",
  "occurrence-coverage",
  "placement-recross",
  "brep-validity",
  "pairwise-intersection",
] as const;

export type AssemblyIntegrityEvaluationCriterionId =
  (typeof ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA)[number];

export const ASSEMBLY_INTEGRITY_EVALUATION_VERDICTS = [
  "pass",
  "fail",
  "unresolved",
] as const;

export type AssemblyIntegrityEvaluationVerdict =
  (typeof ASSEMBLY_INTEGRITY_EVALUATION_VERDICTS)[number];

export interface AssemblyIntegrityEvaluationMethodBody {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA;
  readonly id: typeof ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID;
  readonly version: typeof ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION;
  readonly criteria: readonly {
    readonly id: AssemblyIntegrityEvaluationCriterionId;
    readonly rule: string;
  }[];
  readonly aggregatePrecedence: readonly ["fail", "unresolved", "pass"];
  /** Fixed numeric-equivalence rule for canonical rigid-matrix encodings only. */
  readonly matrixRepresentationEquivalence: {
    readonly kind: "fixed-rigid-matrix-epsilon";
    readonly epsilon: number;
  };
  /** Tool-reported measurement tolerance is retained solely as a diagnostic. */
  readonly measurementTolerance: "diagnostic-only";
  readonly limitations: AssemblyIntegrityEvaluationLimits;
}

export interface AssemblyIntegrityEvaluationMethod
  extends AssemblyIntegrityEvaluationMethodBody {
  /** SHA-256 over the code-owned body, excluding this self field. */
  readonly fingerprint: ContentFingerprint;
}

/** Literal limits are pinned by the code-owned method rather than implied by pass. */
export interface AssemblyIntegrityEvaluationLimits {
  readonly providerCalls: "none";
  readonly genericSysmlRequirementEvaluation: "none";
  readonly safety: "not-evaluated";
  readonly physicalJoints: "not-evaluated";
  readonly clearance: "not-evaluated";
  readonly motion: "not-evaluated";
  readonly load: "not-evaluated";
  readonly fabricability: "not-evaluated";
}

/**
 * Literal L4 boundary copied into every later human closeout.  A closeout
 * cannot silently broaden this method into a safety, clearance, motion,
 * load, or fabrication conclusion.
 */
export const ASSEMBLY_INTEGRITY_EVALUATION_LIMITS = deepFreeze<
  AssemblyIntegrityEvaluationLimits
>({
  providerCalls: "none",
  genericSysmlRequirementEvaluation: "none",
  safety: "not-evaluated",
  physicalJoints: "not-evaluated",
  clearance: "not-evaluated",
  motion: "not-evaluated",
  load: "not-evaluated",
  fabricability: "not-evaluated",
});

const EVALUATION_METHOD_BODY = deepFreeze<AssemblyIntegrityEvaluationMethodBody>({
  schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_METHOD_SCHEMA,
  id: ASSEMBLY_INTEGRITY_EVALUATION_METHOD_ID,
  version: ASSEMBLY_INTEGRITY_EVALUATION_METHOD_VERSION,
  criteria: [
    {
      id: "assembly-import",
      rule:
        "Pass only when import is observed as imported and observed solidCount is at least one; fail at exactly zero; otherwise unresolved.",
    },
    {
      id: "occurrence-coverage",
      rule:
        "Pass only when every exact expected immediate occurrence target is observed; missing or unavailable observations stay unresolved.",
    },
    {
      id: "placement-recross",
      rule:
        "Pass only when every observed canonical rigid matrix is equivalent to its bundle-derived matrix under the fixed structural representation epsilon; observed divergence fails and missing observations stay unresolved.",
    },
    {
      id: "brep-validity",
      rule:
        "Observed valid BRep passes, observed invalid BRep fails, and unavailable or unresolved validity stays unresolved.",
    },
    {
      id: "pairwise-intersection",
      rule:
        "Pass only when every observed intersection volume is exactly zero; any strictly positive observed volume fails; unknown values stay unresolved.",
    },
  ],
  aggregatePrecedence: ["fail", "unresolved", "pass"],
  matrixRepresentationEquivalence: {
    kind: "fixed-rigid-matrix-epsilon",
    epsilon: ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE,
  },
  measurementTolerance: "diagnostic-only",
  limitations: ASSEMBLY_INTEGRITY_EVALUATION_LIMITS,
});

export interface AssemblyIntegrityEvaluationCriterion {
  readonly id: AssemblyIntegrityEvaluationCriterionId;
  readonly verdict: AssemblyIntegrityEvaluationVerdict;
}

export interface AssemblyIntegrityToleranceDiagnostic {
  readonly firstUsageElementId: string;
  readonly secondUsageElementId: string;
  readonly linearToleranceMm: number;
}

export interface AssemblyIntegrityEvaluation {
  readonly method: AssemblyIntegrityEvaluationMethod;
  readonly criteria: readonly AssemblyIntegrityEvaluationCriterion[];
  readonly verdict: AssemblyIntegrityEvaluationVerdict;
  /** Retained for diagnosis only; no rule reads these values for acceptance. */
  readonly measurementDiagnostics: {
    readonly pairwiseLinearToleranceMm: readonly AssemblyIntegrityToleranceDiagnostic[];
  };
}

/** Exact bundle-derived cardinality; it is never an agent-supplied selection. */
export interface AssemblyIntegrityEvaluationInput {
  /** Exact L3-normalized observation after full bundle recross. */
  readonly observation: AssemblyIntegrityObservation;
  readonly expectedOccurrenceCount: number;
}

/**
 * Return the single code-owned method identity. It is reconstructed and
 * fingerprinted rather than read from a caller, file, profile, or provider.
 */
export async function assemblyIntegrityEvaluationMethod(): Promise<
  AssemblyIntegrityEvaluationMethod
> {
  return deepFreeze({
    ...EVALUATION_METHOD_BODY,
    fingerprint: await sha256Fingerprint(EVALUATION_METHOD_BODY),
  });
}

export async function validateAssemblyIntegrityEvaluationMethod(
  value: unknown,
): Promise<AssemblyIntegrityEvaluationMethod> {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "id",
      "version",
      "criteria",
      "aggregatePrecedence",
      "matrixRepresentationEquivalence",
      "measurementTolerance",
      "limitations",
      "fingerprint",
    ],
    "$assemblyIntegrityEvaluationMethod",
  );
  const expected = await assemblyIntegrityEvaluationMethod();
  if (deterministicJson(root) !== deterministicJson(expected)) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationMethod must equal the exact code-owned method and fingerprint.",
    );
  }
  return expected;
}

/** Apply the fixed L4 rules to already-normalized factual L3 observations. */
export async function evaluateAssemblyIntegrity(
  input: AssemblyIntegrityEvaluationInput,
): Promise<AssemblyIntegrityEvaluation> {
  const { observation } = input;
  const criteria = deepFreeze<AssemblyIntegrityEvaluationCriterion[]>([
    { id: "assembly-import", verdict: assemblyImportVerdict(observation) },
    {
      id: "occurrence-coverage",
      verdict: occurrenceCoverageVerdict(observation, input.expectedOccurrenceCount),
    },
    {
      id: "placement-recross",
      verdict: placementRecrossVerdict(observation, input.expectedOccurrenceCount),
    },
    { id: "brep-validity", verdict: brepValidityVerdict(observation) },
    {
      id: "pairwise-intersection",
      verdict: pairwiseIntersectionVerdict(
        observation,
        input.expectedOccurrenceCount,
      ),
    },
  ]);
  const method = await assemblyIntegrityEvaluationMethod();
  const measurementDiagnostics = deepFreeze({
    pairwiseLinearToleranceMm: observation.pairs.map((pair) =>
      deepFreeze({
        firstUsageElementId: pair.firstUsageElementId,
        secondUsageElementId: pair.secondUsageElementId,
        linearToleranceMm: pair.linearToleranceMm,
      })
    ),
  });
  return deepFreeze({
    method,
    criteria,
    verdict: aggregateVerdict(criteria.map((criterion) => criterion.verdict)),
    measurementDiagnostics,
  });
}

function assemblyImportVerdict(
  observation: AssemblyIntegrityObservation,
): AssemblyIntegrityEvaluationVerdict {
  const solidCount = observation.importFacts.solidCount;
  if (solidCount.status === "observed" && solidCount.value === 0) {
    return "fail";
  }
  if (
    observation.importability.status === "observed" &&
    observation.importability.value === "failed"
  ) {
    return "fail";
  }
  if (
    observation.importability.status !== "observed" ||
    observation.importability.value !== "imported" ||
    solidCount.status !== "observed"
  ) {
    return "unresolved";
  }
  return solidCount.value >= 1 ? "pass" : "unresolved";
}

function occurrenceCoverageVerdict(
  observation: AssemblyIntegrityObservation,
  expectedOccurrenceCount: number,
): AssemblyIntegrityEvaluationVerdict {
  if (!hasExactOccurrenceCardinality(observation, expectedOccurrenceCount)) {
    return "unresolved";
  }
  return observation.occurrences.every((occurrence) =>
      occurrence.target.status === "observed"
    )
    ? "pass"
    : "unresolved";
}

function placementRecrossVerdict(
  observation: AssemblyIntegrityObservation,
  expectedOccurrenceCount: number,
): AssemblyIntegrityEvaluationVerdict {
  if (!hasExactOccurrenceCardinality(observation, expectedOccurrenceCount)) {
    return "unresolved";
  }
  let incomplete = false;
  for (const occurrence of observation.occurrences) {
    if (occurrence.transform.status !== "observed") {
      incomplete = true;
      continue;
    }
    if (
      !sameExactMatrix(
        occurrence.transform.value.expectedMatrix,
        occurrence.transform.value.observedMatrix,
      )
    ) {
      return "fail";
    }
  }
  return incomplete ? "unresolved" : "pass";
}

function brepValidityVerdict(
  observation: AssemblyIntegrityObservation,
): AssemblyIntegrityEvaluationVerdict {
  const brepValidity = observation.topology.brepValidity;
  if (brepValidity.status !== "observed") return "unresolved";
  return brepValidity.value === "valid" ? "pass" : "fail";
}

function pairwiseIntersectionVerdict(
  observation: AssemblyIntegrityObservation,
  expectedOccurrenceCount: number,
): AssemblyIntegrityEvaluationVerdict {
  if (!hasExactOccurrenceCardinality(observation, expectedOccurrenceCount)) {
    return "unresolved";
  }
  const expectedPairCount = expectedOccurrenceCount * (expectedOccurrenceCount - 1) / 2;
  if (observation.pairs.length !== expectedPairCount) return "unresolved";
  let incomplete = false;
  for (const pair of observation.pairs) {
    const volume = pair.intersectionVolumeMm3;
    if (volume.status !== "observed") {
      incomplete = true;
      continue;
    }
    if (volume.value > 0) return "fail";
    if (volume.value !== 0) incomplete = true;
  }
  return incomplete ? "unresolved" : "pass";
}

function hasExactOccurrenceCardinality(
  observation: AssemblyIntegrityObservation,
  expectedOccurrenceCount: number,
): boolean {
  return Number.isSafeInteger(expectedOccurrenceCount) &&
    expectedOccurrenceCount >= 1 &&
    observation.occurrences.length === expectedOccurrenceCount;
}

function sameExactMatrix(
  expected: readonly number[],
  observed: readonly number[],
): boolean {
  return expected.length === observed.length &&
    expected.every((value, index) =>
      Math.abs(value - (observed[index] ?? Number.NaN)) <=
        ASSEMBLY_INTEGRITY_RIGID_MATRIX_TOLERANCE
    );
}

function aggregateVerdict(
  criteria: readonly AssemblyIntegrityEvaluationVerdict[],
): AssemblyIntegrityEvaluationVerdict {
  if (criteria.includes("fail")) return "fail";
  if (criteria.includes("unresolved")) return "unresolved";
  return "pass";
}

export interface AssemblyIntegrityEvaluationCapture {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA;
  readonly kind: "assembly-integrity-evaluation";
  readonly operation: typeof VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION;
  readonly trustedRunId: string;
  readonly evaluatedAt: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly geometryModule: {
    readonly schemaVersion: "geometry-module-capture/1.0";
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly assemblyStep: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  /** The one server-selected, persisted L3 factual evidence artifact. */
  readonly observation: {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA;
    /** Hash of the persisted L3 capture artifact. */
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
    /** Hash of its normalized factual observation body. */
    readonly observationFingerprint: ContentFingerprint;
  };
  readonly inputBundle: {
    readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  readonly method: AssemblyIntegrityEvaluationMethod;
  readonly evaluation: AssemblyIntegrityEvaluation;
}

const CAPTURE_KEYS = [
  "schemaVersion",
  "kind",
  "operation",
  "trustedRunId",
  "evaluatedAt",
  "basis",
  "geometryModule",
  "assemblyStep",
  "observation",
  "inputBundle",
  "method",
  "evaluation",
] as const;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export function assemblyIntegrityEvaluationCaptureUri(digest: string): string {
  return `${ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_URI_PREFIX}${digest}`;
}

/** Build one closed L4 record from server-recossed identities and facts. */
export async function createAssemblyIntegrityEvaluationCapture(
  value: AssemblyIntegrityEvaluationCapture,
): Promise<AssemblyIntegrityEvaluationCapture> {
  return await validateAssemblyIntegrityEvaluationCapture(value);
}

/** Exact content identity used by the custom L4 CAS and Thread artifact. */
export async function fingerprintAssemblyIntegrityEvaluationCapture(
  value: unknown,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(
    await validateAssemblyIntegrityEvaluationCapture(value),
  );
}

/** Canonical persisted bytes for the custom L4 capture. */
export async function canonicalAssemblyIntegrityEvaluationCaptureText(
  value: unknown,
): Promise<string> {
  return deterministicJson(await validateAssemblyIntegrityEvaluationCapture(value));
}

/** Validate an L4 capture before content-addressed persistence or reread. */
export async function validateAssemblyIntegrityEvaluationCapture(
  value: unknown,
): Promise<AssemblyIntegrityEvaluationCapture> {
  const root = exactRecord(value, CAPTURE_KEYS, "$assemblyIntegrityEvaluationCapture");
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    "$assemblyIntegrityEvaluationCapture.schemaVersion",
  );
  literalValue(
    root.kind,
    "assembly-integrity-evaluation",
    "$assemblyIntegrityEvaluationCapture.kind",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$assemblyIntegrityEvaluationCapture.operation",
  );
  literalValue(
    operation.id,
    VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.id,
    "$assemblyIntegrityEvaluationCapture.operation.id",
  );
  literalValue(
    operation.version,
    VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION.version,
    "$assemblyIntegrityEvaluationCapture.operation.version",
  );
  const trustedRunId = safeId(
    root.trustedRunId,
    "$assemblyIntegrityEvaluationCapture.trustedRunId",
  );
  const evaluatedAt = parseIsoDateTime(
    root.evaluatedAt,
    "$assemblyIntegrityEvaluationCapture.evaluatedAt",
  );
  const basis = parseBasis(root.basis, "$assemblyIntegrityEvaluationCapture.basis");
  const geometryModule = parseGeometryModule(
    root.geometryModule,
    "$assemblyIntegrityEvaluationCapture.geometryModule",
  );
  const assemblyStep = parseAssemblyStep(
    root.assemblyStep,
    "$assemblyIntegrityEvaluationCapture.assemblyStep",
    geometryModule,
  );
  const observation = parseObservationReference(
    root.observation,
    "$assemblyIntegrityEvaluationCapture.observation",
  );
  const inputBundle = parseInputBundle(
    root.inputBundle,
    "$assemblyIntegrityEvaluationCapture.inputBundle",
  );
  const method = await validateAssemblyIntegrityEvaluationMethod(root.method);
  const evaluation = await parseEvaluation(
    root.evaluation,
    "$assemblyIntegrityEvaluationCapture.evaluation",
  );
  if (deterministicJson(method) !== deterministicJson(evaluation.method)) {
    throw new TypeError(
      "$assemblyIntegrityEvaluationCapture.evaluation.method must equal capture.method.",
    );
  }
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_EVALUATION_CAPTURE_SCHEMA,
    kind: "assembly-integrity-evaluation",
    operation: VERIFY_EVALUATE_ASSEMBLY_INTEGRITY_OPERATION,
    trustedRunId,
    evaluatedAt,
    basis,
    geometryModule,
    assemblyStep,
    observation,
    inputBundle,
    method,
    evaluation,
  });
}

function parseBasis(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationCapture["basis"] {
  const root = exactRecord(
    value,
    ["kind", "snapshotId", "revision", "subjectId"],
    path,
  );
  literalValue(root.kind, "thread-snapshot", `${path}.kind`);
  return deepFreeze({
    kind: "thread-snapshot" as const,
    snapshotId: safeId(root.snapshotId, `${path}.snapshotId`),
    revision: positiveInteger(root.revision, `${path}.revision`),
    subjectId: safeId(root.subjectId, `${path}.subjectId`),
  });
}

function parseGeometryModule(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationCapture["geometryModule"] {
  const root = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint"],
    path,
  );
  literalValue(
    root.schemaVersion,
    "geometry-module-capture/1.0",
    `${path}.schemaVersion`,
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const artifactId = safeId(root.artifactId, `${path}.artifactId`);
  if (artifactId !== `geometry-${fingerprint.digest}`) {
    throw new TypeError(`${path}.artifactId must equal geometry-<capture digest>.`);
  }
  return deepFreeze({
    schemaVersion: "geometry-module-capture/1.0" as const,
    artifactId,
    fingerprint,
  });
}

function parseAssemblyStep(
  value: unknown,
  path: string,
  geometryModule: AssemblyIntegrityEvaluationCapture["geometryModule"],
): AssemblyIntegrityEvaluationCapture["assemblyStep"] {
  const root = exactRecord(value, ["artifactId", "fingerprint"], path);
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const artifactId = safeId(root.artifactId, `${path}.artifactId`);
  if (
    artifactId !==
      `cad-asset-${geometryModule.fingerprint.digest}-module-step-${fingerprint.digest}`
  ) {
    throw new TypeError(
      `${path}.artifactId must bind the exact module and STEP fingerprints.`,
    );
  }
  return deepFreeze({
    artifactId,
    fingerprint,
  });
}

function parseObservationReference(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationCapture["observation"] {
  const root = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint", "observationFingerprint"],
    path,
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const fingerprint = validateContentFingerprint(
    root.fingerprint,
    `${path}.fingerprint`,
  );
  const artifactId = safeId(root.artifactId, `${path}.artifactId`);
  if (artifactId !== `assembly-integrity-observation-${fingerprint.digest}`) {
    throw new TypeError(`${path}.artifactId must bind the L3 capture fingerprint.`);
  }
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_OBSERVATION_CAPTURE_SCHEMA,
    artifactId,
    fingerprint,
    observationFingerprint: validateContentFingerprint(
      root.observationFingerprint,
      `${path}.observationFingerprint`,
    ),
  });
}

function parseInputBundle(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationCapture["inputBundle"] {
  const root = exactRecord(value, ["schemaVersion", "fingerprint", "byteCount"], path);
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  return deepFreeze({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    fingerprint: validateContentFingerprint(root.fingerprint, `${path}.fingerprint`),
    byteCount: positiveInteger(root.byteCount, `${path}.byteCount`),
  });
}

async function parseEvaluation(
  value: unknown,
  path: string,
): Promise<AssemblyIntegrityEvaluation> {
  const root = exactRecord(
    value,
    ["method", "criteria", "verdict", "measurementDiagnostics"],
    path,
  );
  const method = await validateAssemblyIntegrityEvaluationMethod(root.method);
  const criteria = parseCriteria(root.criteria, `${path}.criteria`);
  const verdict = parseVerdict(root.verdict, `${path}.verdict`);
  if (verdict !== aggregateVerdict(criteria.map((criterion) => criterion.verdict))) {
    throw new TypeError(`${path}.verdict does not obey fail > unresolved > pass.`);
  }
  const measurementDiagnostics = parseMeasurementDiagnostics(
    root.measurementDiagnostics,
    `${path}.measurementDiagnostics`,
  );
  return deepFreeze({
    method,
    criteria,
    verdict,
    measurementDiagnostics,
  });
}

function parseCriteria(
  value: unknown,
  path: string,
): readonly AssemblyIntegrityEvaluationCriterion[] {
  if (
    !Array.isArray(value) ||
    value.length !== ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA.length
  ) {
    throw new TypeError(`${path} must contain the complete fixed criterion set.`);
  }
  return deepFreeze(value.map((item, index) => {
    const root = exactRecord(item, ["id", "verdict"], `${path}[${index}]`);
    const id = ASSEMBLY_INTEGRITY_EVALUATION_CRITERIA[index]!;
    literalValue(root.id, id, `${path}[${index}].id`);
    return deepFreeze({
      id,
      verdict: parseVerdict(root.verdict, `${path}[${index}].verdict`),
    });
  }));
}

function parseVerdict(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluationVerdict {
  if (
    !ASSEMBLY_INTEGRITY_EVALUATION_VERDICTS.includes(
      value as AssemblyIntegrityEvaluationVerdict,
    )
  ) {
    throw new TypeError(`${path} must be pass, fail, or unresolved.`);
  }
  return value as AssemblyIntegrityEvaluationVerdict;
}

function parseMeasurementDiagnostics(
  value: unknown,
  path: string,
): AssemblyIntegrityEvaluation["measurementDiagnostics"] {
  const root = exactRecord(value, ["pairwiseLinearToleranceMm"], path);
  if (!Array.isArray(root.pairwiseLinearToleranceMm)) {
    throw new TypeError(`${path}.pairwiseLinearToleranceMm must be an array.`);
  }
  const diagnostics = root.pairwiseLinearToleranceMm.map((item, index) => {
    const entryPath = `${path}.pairwiseLinearToleranceMm[${index}]`;
    const entry = exactRecord(
      item,
      ["firstUsageElementId", "secondUsageElementId", "linearToleranceMm"],
      entryPath,
    );
    const linearToleranceMm = finite(
      entry.linearToleranceMm,
      `${entryPath}.linearToleranceMm`,
    );
    if (linearToleranceMm < 0) {
      throw new TypeError(`${entryPath}.linearToleranceMm must not be negative.`);
    }
    return deepFreeze({
      firstUsageElementId: safeId(
        entry.firstUsageElementId,
        `${entryPath}.firstUsageElementId`,
      ),
      secondUsageElementId: safeId(
        entry.secondUsageElementId,
        `${entryPath}.secondUsageElementId`,
      ),
      linearToleranceMm,
    });
  });
  rejectDuplicates(
    diagnostics.map((item) =>
      `${item.firstUsageElementId}:${item.secondUsageElementId}`
    ),
    `${path}.pairwiseLinearToleranceMm`,
  );
  return deepFreeze({ pairwiseLinearToleranceMm: diagnostics });
}

function parseIsoDateTime(value: unknown, path: string): string {
  if (
    typeof value !== "string" || !ISO_DATE_TIME.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new TypeError(`${path} must be an ISO-8601 UTC timestamp with milliseconds.`);
  }
  return value;
}

/** Strict identity helper shared by application recross tests and adapters. */
export function sameAssemblyIntegrityEvaluationFingerprint(
  left: ContentFingerprint,
  right: ContentFingerprint,
): boolean {
  return fingerprintsEqual(left, right);
}
