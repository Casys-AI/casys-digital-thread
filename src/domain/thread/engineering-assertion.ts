/**
 * Canonical, provider-neutral engineering assertions.
 *
 * An assertion records what was declared, inferred, or observed. It does not
 * grant execution authority: AuthorityAdmission is deliberately a distinct
 * contract so epistemology cannot be mistaken for permission.
 */

import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";
import { sha256Fingerprint } from "../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../kernel/primitives.ts";

export const ENGINEERING_ASSERTION_SCHEMA = "engineering-assertion/1.0" as const;
export const AUTHORITY_ADMISSION_SCHEMA = "authority-admission/1.0" as const;

const ASSERTION_RELATIONS = [
  "semantic-binding",
  "declared-dependency",
  "static-value-flow",
  "structural-incidence",
  "runtime-consumption",
  "measured-local-sensitivity",
  "projection-of",
] as const;

const SEMANTIC_DOMAINS = [
  "brief",
  "sysml",
  "cad",
  "modelica",
  "calculix",
  "thread",
] as const;

const EPISTEMIC_BASES = ["declared", "inferred", "observed"] as const;
const ASSERTED_BY_KINDS = ["agent", "analyzer", "provider", "server"] as const;

export type EngineeringAssertionRelation = (typeof ASSERTION_RELATIONS)[number];
export type SemanticDomain = (typeof SEMANTIC_DOMAINS)[number];
export type EpistemicBasis = (typeof EPISTEMIC_BASES)[number];
export type AssertedByKind = (typeof ASSERTED_BY_KINDS)[number];

/** A stable reference to a concept in one engineering representation. */
export interface SemanticRef {
  readonly domain: SemanticDomain;
  readonly kind: string;
  readonly id: string;
  /** Optional basis on which this particular reference is meaningful. */
  readonly basisFingerprint?: ContentFingerprint;
}

/** Exact evidence bytes that support an assertion. */
export interface EngineeringEvidence {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export interface AssertionActor {
  readonly kind: AssertedByKind;
  readonly id: string;
  readonly version?: string;
}

export interface DimensionedValue {
  readonly value: number;
  readonly unit: string;
}

export interface BasisScope {
  readonly kind: "basis";
  readonly basisFingerprint: ContentFingerprint;
}

export interface SourcePosition {
  /** One-indexed source line. */
  readonly line: number;
  /** Zero-indexed source column. */
  readonly column: number;
}

export interface SourceSpanScope {
  readonly kind: "source-span";
  readonly source: SemanticRef;
  readonly basisFingerprint: ContentFingerprint;
  readonly start: SourcePosition;
  readonly end: SourcePosition;
}

export interface ScenarioScope {
  readonly kind: "scenario";
  readonly scenario: SemanticRef;
  readonly basisFingerprint: ContentFingerprint;
}

/** A measured/inferred relation valid only in a declared parameter interval. */
export interface LocalNeighborhoodScope {
  readonly kind: "local-neighborhood";
  readonly parameter: SemanticRef;
  readonly basisFingerprint: ContentFingerprint;
  readonly lower: DimensionedValue;
  readonly upper: DimensionedValue;
}

/** Exact finite-difference values retained by a measured sensitivity relation. */
export interface LocalSensitivityMeasurement {
  readonly method: "forward-finite-difference";
  readonly basePoint: DimensionedValue;
  readonly perturbationStep: DimensionedValue;
  readonly responseAtBase: DimensionedValue;
  readonly responseAtPerturbed: DimensionedValue;
  readonly derivative: DimensionedValue;
}

export type AssertionScope =
  | BasisScope
  | SourceSpanScope
  | ScenarioScope
  | LocalNeighborhoodScope;

export interface EngineeringAssertion {
  readonly schemaVersion: typeof ENGINEERING_ASSERTION_SCHEMA;
  readonly id: string;
  readonly relation: EngineeringAssertionRelation;
  readonly from: SemanticRef;
  readonly to: SemanticRef;
  readonly epistemicBasis: EpistemicBasis;
  readonly assertedBy: AssertionActor;
  /** Non-empty, exact-byte evidence. Sorted by stable evidence id. */
  readonly evidence: readonly EngineeringEvidence[];
  readonly scope: AssertionScope;
  /** Present exactly for measured-local-sensitivity assertions. */
  readonly measurement?: LocalSensitivityMeasurement;
  readonly rationale: string;
}

/**
 * Admission is an authority fact, never a claim about the truth of an
 * engineering assertion. It binds an already-recorded assertion to a reviewed
 * operation, basis, and decision input.
 */
export interface AuthorityAdmission {
  readonly schemaVersion: typeof AUTHORITY_ADMISSION_SCHEMA;
  readonly assertion: {
    readonly id: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly operation: {
    readonly id: string;
    readonly version: string;
  };
  readonly basisFingerprint: ContentFingerprint;
  readonly decision: {
    readonly id: string;
    readonly inputFingerprint: ContentFingerprint;
  };
  /** Canonical UTC instant with millisecond precision. */
  readonly admittedAt: string;
}

/**
 * Validate and deeply freeze one provider-neutral engineering assertion.
 * Unknown keys, missing keys, empty evidence, duplicate evidence IDs, and
 * self-relations are rejected fail-closed.
 */
export function validateEngineeringAssertion(value: unknown): EngineeringAssertion {
  const candidate = value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
  const measured = candidate?.relation === "measured-local-sensitivity";
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "id",
      "relation",
      "from",
      "to",
      "epistemicBasis",
      "assertedBy",
      "evidence",
      "scope",
      ...(measured ? ["measurement"] : []),
      "rationale",
    ],
    "$assertion",
  );
  literalValue(
    root.schemaVersion,
    ENGINEERING_ASSERTION_SCHEMA,
    "$assertion.schemaVersion",
  );

  const from = semanticRef(root.from, "$assertion.from");
  const to = semanticRef(root.to, "$assertion.to");
  if (sameSemanticRef(from, to)) {
    throw new TypeError("$assertion.from and $assertion.to must be distinct.");
  }

  const evidence = arrayOf(root.evidence, "$assertion.evidence").map((item, index) =>
    engineeringEvidence(item, `$assertion.evidence[${index}]`)
  );
  if (evidence.length === 0) {
    throw new TypeError("$assertion.evidence must not be empty.");
  }
  rejectDuplicates(evidence.map((item) => item.id), "$assertion.evidence ids");

  const relation = enumeration(
    root.relation,
    ASSERTION_RELATIONS,
    "$assertion.relation",
  );
  const epistemicBasis = enumeration(
    root.epistemicBasis,
    EPISTEMIC_BASES,
    "$assertion.epistemicBasis",
  );
  const scope = assertionScope(root.scope, "$assertion.scope");
  assertRelationSemantics(relation, epistemicBasis, scope);
  if (
    relation === "measured-local-sensitivity" &&
    (from.kind !== "parameter" || to.kind !== "metric")
  ) {
    throw new TypeError(
      "$assertion.measured-local-sensitivity must relate a parameter to a metric.",
    );
  }
  if (
    relation === "measured-local-sensitivity" &&
    scope.kind === "local-neighborhood" &&
    (!sameSemanticIdentity(scope.parameter, from) ||
      (from.basisFingerprint !== undefined &&
        !sameFingerprint(from.basisFingerprint, scope.basisFingerprint)) ||
      (scope.parameter.basisFingerprint !== undefined &&
        !sameFingerprint(
          scope.parameter.basisFingerprint,
          scope.basisFingerprint,
        )))
  ) {
    throw new TypeError(
      "$assertion.scope.parameter must equal $assertion.from for a measured-local-sensitivity.",
    );
  }
  let measurement: LocalSensitivityMeasurement | undefined;
  if (relation === "measured-local-sensitivity") {
    if (scope.kind !== "local-neighborhood") {
      throw new TypeError(
        "$assertion.measured-local-sensitivity requires a local-neighborhood scope.",
      );
    }
    measurement = localSensitivityMeasurement(
      root.measurement,
      "$assertion.measurement",
      scope,
    );
  }

  return deepFreeze({
    schemaVersion: ENGINEERING_ASSERTION_SCHEMA,
    id: safeId(root.id, "$assertion.id"),
    relation,
    from,
    to,
    epistemicBasis,
    assertedBy: assertionActor(root.assertedBy, "$assertion.assertedBy"),
    evidence: [...evidence].sort(compareById),
    scope,
    ...(measurement === undefined ? {} : { measurement }),
    rationale: nonEmptyText(root.rationale, "$assertion.rationale"),
  });
}

/** Validate and deeply freeze an authority admission without accepting assertion facts. */
export function validateAuthorityAdmission(value: unknown): AuthorityAdmission {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "assertion",
      "operation",
      "basisFingerprint",
      "decision",
      "admittedAt",
    ],
    "$admission",
  );
  literalValue(
    root.schemaVersion,
    AUTHORITY_ADMISSION_SCHEMA,
    "$admission.schemaVersion",
  );

  const assertion = exactRecord(
    root.assertion,
    ["id", "fingerprint"],
    "$admission.assertion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$admission.operation",
  );
  const decision = exactRecord(
    root.decision,
    ["id", "inputFingerprint"],
    "$admission.decision",
  );

  return deepFreeze({
    schemaVersion: AUTHORITY_ADMISSION_SCHEMA,
    assertion: {
      id: safeId(assertion.id, "$admission.assertion.id"),
      fingerprint: fingerprint(
        assertion.fingerprint,
        "$admission.assertion.fingerprint",
      ),
    },
    operation: {
      id: safeId(operation.id, "$admission.operation.id"),
      version: safeId(operation.version, "$admission.operation.version"),
    },
    basisFingerprint: fingerprint(
      root.basisFingerprint,
      "$admission.basisFingerprint",
    ),
    decision: {
      id: safeId(decision.id, "$admission.decision.id"),
      inputFingerprint: fingerprint(
        decision.inputFingerprint,
        "$admission.decision.inputFingerprint",
      ),
    },
    admittedAt: canonicalUtcInstant(root.admittedAt, "$admission.admittedAt"),
  });
}

/** Hash the canonical, validated form so evidence order cannot change the digest. */
export async function fingerprintEngineeringAssertion(
  value: EngineeringAssertion,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateEngineeringAssertion(value));
}

/** Hash the canonical, validated authority admission independently of assertions. */
export async function fingerprintAuthorityAdmission(
  value: AuthorityAdmission,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(validateAuthorityAdmission(value));
}

function semanticRef(value: unknown, path: string): SemanticRef {
  const input = optionalExactRecord(
    value,
    ["domain", "kind", "id"],
    "basisFingerprint",
    path,
  );
  const hasBasisFingerprint = Object.hasOwn(input, "basisFingerprint");
  const result = {
    domain: enumeration(input.domain, SEMANTIC_DOMAINS, `${path}.domain`),
    kind: safeId(input.kind, `${path}.kind`),
    id: safeId(input.id, `${path}.id`),
    ...(hasBasisFingerprint
      ? {
        basisFingerprint: fingerprint(
          input.basisFingerprint,
          `${path}.basisFingerprint`,
        ),
      }
      : {}),
  };
  return deepFreeze(result);
}

function engineeringEvidence(value: unknown, path: string): EngineeringEvidence {
  const input = exactRecord(value, ["id", "fingerprint"], path);
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    fingerprint: fingerprint(input.fingerprint, `${path}.fingerprint`),
  });
}

function assertionActor(value: unknown, path: string): AssertionActor {
  const input = optionalExactRecord(value, ["kind", "id"], "version", path);
  const hasVersion = Object.hasOwn(input, "version");
  return deepFreeze({
    kind: enumeration(input.kind, ASSERTED_BY_KINDS, `${path}.kind`),
    id: safeId(input.id, `${path}.id`),
    ...(hasVersion ? { version: safeId(input.version, `${path}.version`) } : {}),
  });
}

function assertionScope(value: unknown, path: string): AssertionScope {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const kind = (value as Record<string, unknown>).kind;
  switch (kind) {
    case "basis": {
      const input = exactRecord(value, ["kind", "basisFingerprint"], path);
      return deepFreeze({
        kind: "basis",
        basisFingerprint: fingerprint(
          input.basisFingerprint,
          `${path}.basisFingerprint`,
        ),
      });
    }
    case "source-span": {
      const input = exactRecord(
        value,
        ["kind", "source", "basisFingerprint", "start", "end"],
        path,
      );
      const start = sourcePosition(input.start, `${path}.start`);
      const end = sourcePosition(input.end, `${path}.end`);
      if (compareSourcePositions(start, end) > 0) {
        throw new TypeError(`${path}.end must not be before ${path}.start.`);
      }
      return deepFreeze({
        kind: "source-span",
        source: semanticRef(input.source, `${path}.source`),
        basisFingerprint: fingerprint(
          input.basisFingerprint,
          `${path}.basisFingerprint`,
        ),
        start,
        end,
      });
    }
    case "scenario": {
      const input = exactRecord(value, ["kind", "scenario", "basisFingerprint"], path);
      return deepFreeze({
        kind: "scenario",
        scenario: semanticRef(input.scenario, `${path}.scenario`),
        basisFingerprint: fingerprint(
          input.basisFingerprint,
          `${path}.basisFingerprint`,
        ),
      });
    }
    case "local-neighborhood": {
      const input = exactRecord(
        value,
        ["kind", "parameter", "basisFingerprint", "lower", "upper"],
        path,
      );
      const lower = dimensionedValue(input.lower, `${path}.lower`);
      const upper = dimensionedValue(input.upper, `${path}.upper`);
      if (lower.unit !== upper.unit) {
        throw new TypeError(`${path}.lower.unit must equal ${path}.upper.unit.`);
      }
      if (lower.value > upper.value) {
        throw new TypeError(
          `${path}.lower.value must be less than or equal to ${path}.upper.value.`,
        );
      }
      return deepFreeze({
        kind: "local-neighborhood",
        parameter: semanticRef(input.parameter, `${path}.parameter`),
        basisFingerprint: fingerprint(
          input.basisFingerprint,
          `${path}.basisFingerprint`,
        ),
        lower,
        upper,
      });
    }
    default:
      throw new TypeError(`${path}.kind must be a supported scope kind.`);
  }
}

function sourcePosition(value: unknown, path: string): SourcePosition {
  const input = exactRecord(value, ["line", "column"], path);
  const line = finite(input.line, `${path}.line`);
  const column = finite(input.column, `${path}.column`);
  if (!Number.isSafeInteger(line) || line < 1) {
    throw new TypeError(`${path}.line must be a one-indexed positive integer.`);
  }
  if (!Number.isSafeInteger(column) || column < 0) {
    throw new TypeError(`${path}.column must be a zero-indexed non-negative integer.`);
  }
  return deepFreeze({ line, column });
}

function dimensionedValue(value: unknown, path: string): DimensionedValue {
  const input = exactRecord(value, ["value", "unit"], path);
  return deepFreeze({
    value: finite(input.value, `${path}.value`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  });
}

function localSensitivityMeasurement(
  value: unknown,
  path: string,
  scope: LocalNeighborhoodScope,
): LocalSensitivityMeasurement {
  const input = exactRecord(
    value,
    [
      "method",
      "basePoint",
      "perturbationStep",
      "responseAtBase",
      "responseAtPerturbed",
      "derivative",
    ],
    path,
  );
  literalValue(
    input.method,
    "forward-finite-difference",
    `${path}.method`,
  );
  const basePoint = dimensionedValue(input.basePoint, `${path}.basePoint`);
  const perturbationStep = dimensionedValue(
    input.perturbationStep,
    `${path}.perturbationStep`,
  );
  if (basePoint.unit !== perturbationStep.unit) {
    throw new TypeError(
      `${path}.perturbationStep.unit must equal ${path}.basePoint.unit.`,
    );
  }
  if (perturbationStep.value === 0) {
    throw new TypeError(`${path}.perturbationStep.value must not be zero.`);
  }
  const responseAtBase = dimensionedValue(
    input.responseAtBase,
    `${path}.responseAtBase`,
  );
  const responseAtPerturbed = dimensionedValue(
    input.responseAtPerturbed,
    `${path}.responseAtPerturbed`,
  );
  if (responseAtBase.unit !== responseAtPerturbed.unit) {
    throw new TypeError(
      `${path}.responseAtPerturbed.unit must equal ${path}.responseAtBase.unit.`,
    );
  }
  const derivative = dimensionedValue(input.derivative, `${path}.derivative`);
  if (basePoint.unit !== scope.lower.unit) {
    throw new TypeError(
      `${path}.basePoint.unit must equal $assertion.scope.lower.unit.`,
    );
  }
  if (basePoint.value < scope.lower.value || basePoint.value > scope.upper.value) {
    throw new TypeError(
      `${path}.basePoint.value must lie within $assertion.scope bounds.`,
    );
  }
  const perturbedParameterValue = basePoint.value + perturbationStep.value;
  if (
    perturbedParameterValue < scope.lower.value ||
    perturbedParameterValue > scope.upper.value
  ) {
    throw new TypeError(
      `${path}.basePoint plus perturbationStep must lie within $assertion.scope bounds.`,
    );
  }
  const expectedDerivativeUnit = `${responseAtBase.unit}/${basePoint.unit}`;
  if (derivative.unit !== expectedDerivativeUnit) {
    throw new TypeError(
      `${path}.derivative.unit must equal ${expectedDerivativeUnit}.`,
    );
  }
  const expectedDerivative = (responseAtPerturbed.value - responseAtBase.value) /
    perturbationStep.value;
  if (!approximatelyEqual(derivative.value, expectedDerivative)) {
    throw new TypeError(
      `${path}.derivative.value must equal the declared finite-difference quotient.`,
    );
  }
  return deepFreeze({
    method: "forward-finite-difference",
    basePoint,
    perturbationStep,
    responseAtBase,
    responseAtPerturbed,
    derivative,
  });
}

function assertRelationSemantics(
  relation: EngineeringAssertionRelation,
  epistemicBasis: EpistemicBasis,
  scope: AssertionScope,
): void {
  if (relation === "declared-dependency" && epistemicBasis !== "declared") {
    throw new TypeError(
      "$assertion.declared-dependency must have a declared epistemic basis.",
    );
  }
  if (relation === "static-value-flow") {
    if (epistemicBasis !== "inferred" || scope.kind !== "source-span") {
      throw new TypeError(
        "$assertion.static-value-flow must be inferred within a source-span scope.",
      );
    }
  }
  if (relation === "runtime-consumption" && epistemicBasis !== "observed") {
    throw new TypeError("$assertion.runtime-consumption must have an observed basis.");
  }
  if (relation === "measured-local-sensitivity") {
    if (epistemicBasis !== "observed" || scope.kind !== "local-neighborhood") {
      throw new TypeError(
        "$assertion.measured-local-sensitivity must be observed within a local-neighborhood scope.",
      );
    }
  }
}

function fingerprint(value: unknown, path: string): ContentFingerprint {
  const input = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(input.algorithm, "sha256", `${path}.algorithm`);
  const digest = nonEmptyText(input.digest, `${path}.digest`);
  if (!/^[a-f0-9]{64}$/.test(digest)) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 hex digest.`);
  }
  return deepFreeze({ algorithm: "sha256", digest });
}

function optionalExactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKey: string,
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const record = value as Record<string, unknown>;
  const keys = Object.hasOwn(record, optionalKey)
    ? [...requiredKeys, optionalKey]
    : requiredKeys;
  return exactRecord(record, keys, path);
}

function enumeration<T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new TypeError(`${path} must be one of ${allowed.join(", ")}.`);
  }
  return value as T;
}

function sameSemanticRef(left: SemanticRef, right: SemanticRef): boolean {
  return sameSemanticIdentity(left, right) &&
    sameFingerprint(left.basisFingerprint, right.basisFingerprint);
}

function sameSemanticIdentity(left: SemanticRef, right: SemanticRef): boolean {
  return left.domain === right.domain && left.kind === right.kind &&
    left.id === right.id;
}

function sameFingerprint(
  left: ContentFingerprint | undefined,
  right: ContentFingerprint | undefined,
): boolean {
  return left?.algorithm === right?.algorithm && left?.digest === right?.digest;
}

function compareSourcePositions(left: SourcePosition, right: SourcePosition): number {
  return left.line === right.line ? left.column - right.column : left.line - right.line;
}

function compareById(
  left: { readonly id: string },
  right: { readonly id: string },
): number {
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

function approximatelyEqual(left: number, right: number): boolean {
  return Math.abs(left - right) <=
    Number.EPSILON * 64 * Math.max(1, Math.abs(left), Math.abs(right));
}

function canonicalUtcInstant(value: unknown, path: string): string {
  const instant = nonEmptyText(value, path);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(instant)) {
    throw new TypeError(`${path} must be a canonical UTC ISO-8601 instant.`);
  }
  const milliseconds = Date.parse(instant);
  if (
    !Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== instant
  ) {
    throw new TypeError(`${path} must be a valid canonical UTC ISO-8601 instant.`);
  }
  return instant;
}
