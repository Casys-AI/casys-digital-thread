import type { ContentFingerprint } from "./primitives.ts";
import { sha256Fingerprint } from "./deterministic-json.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "./case-validation.ts";

/**
 * Generic oracle-requirement contract for any discipline that evaluates scalar
 * limits through syson_constraint_evaluate.
 *
 * INVARIANT — every evaluator consuming an OracleRequirement MUST verify that
 * the unit reported by the oracle matches the normalised unit declared in the
 * requirement before it reads computedValue, threshold, margin or
 * marginPercent. The oracle performs internal unit conversion; the caller is
 * responsible for asserting the normalised basis it requested. Comparing bare
 * numbers without first checking their unit is forbidden: a 0.53 MPa result
 * evaluated against a Pa limit silently wrong-passes when treated as a scalar.
 *
 * This module is intentionally discipline-agnostic: no provider or product
 * identifiers. The same contract is reusable by simulations, ERP
 * checks, or any future oracle that exposes a scalar limit through
 * syson_constraint_evaluate.
 */

/** Operators supported by syson_constraint_evaluate binary expressions. */
export const ORACLE_REQUIREMENT_OPERATORS = ["<=", ">="] as const;
export type OracleOperator = (typeof ORACLE_REQUIREMENT_OPERATORS)[number];

/**
 * A dimensioned limit value.
 * The unit field is mandatory and non-empty: it is a value, not decoration.
 * A limit without a unit is not a limit — it is an ambiguous number.
 */
export interface OracleLimit {
  readonly value: number;
  readonly unit: string;
}

/**
 * A single scalar requirement expressed as a dimensioned limit comparison.
 * Discipline-agnostic: no provider or product identifiers.
 */
export interface OracleRequirement {
  readonly id: string;
  readonly name: string;
  /** Physical metric identifier matched by the oracle featurePath. */
  readonly metric: string;
  readonly operator: OracleOperator;
  readonly limit: OracleLimit;
}

/**
 * AST node consumed by syson_constraint_evaluate.
 * Shape matches the fixed constraint payload accepted by
 * syson_constraint_evaluate.
 */
export interface ConstraintAst {
  readonly id: string;
  readonly name: string;
  readonly expression: {
    readonly kind: "binary";
    readonly op: OracleOperator;
    readonly left: {
      readonly kind: "ref";
      readonly featurePath: readonly [string];
    };
    readonly right: {
      readonly kind: "literal";
      readonly value: number;
      readonly unit: string;
    };
  };
}

// ---------------------------------------------------------------------------
// Validation — private domain helpers (primitives imported from case-validation.ts)
// ---------------------------------------------------------------------------

function oracleOperator(value: unknown, path: string): OracleOperator {
  if (value !== "<=" && value !== ">=") {
    throw new Error(`${path} must equal "<=" or ">=".`);
  }
  return value;
}

function oracleLimit(value: unknown, path: string): OracleLimit {
  const input = exactRecord(value, ["value", "unit"], path);
  return deepFreeze({
    value: finite(input.value, `${path}.value`),
    unit: nonEmptyText(input.unit, `${path}.unit`),
  });
}

function singleRequirement(value: unknown, path: string): OracleRequirement {
  const input = exactRecord(value, ["id", "name", "metric", "operator", "limit"], path);
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    name: nonEmptyText(input.name, `${path}.name`),
    metric: safeId(input.metric, `${path}.metric`),
    operator: oracleOperator(input.operator, `${path}.operator`),
    limit: oracleLimit(input.limit, `${path}.limit`),
  });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Validate untrusted JSON and return an immutable list of oracle requirements.
 * Fail-closed: any extra or missing key, empty unit, empty list, or duplicate
 * id is rejected. Codes: structural errors carry the $-prefixed path; content
 * errors carry a message without provider detail.
 */
export function validateOracleRequirements(
  value: unknown,
): readonly OracleRequirement[] {
  const items = arrayOf(value, "$requirements");
  if (items.length === 0) {
    throw new Error("$requirements must not be empty.");
  }
  const requirements = items.map((item, index) =>
    singleRequirement(item, `$requirements[${index}]`)
  );
  rejectDuplicates(requirements.map((r) => r.id), "$requirements ids");
  return Object.freeze(requirements);
}

/**
 * Build the AST node consumed by syson_constraint_evaluate for one requirement.
 *
 * The shape is the fixed syson_constraint_evaluate payload. Any change to the
 * provider wire contract must be reflected here.
 */
export function buildConstraintAst(requirement: OracleRequirement): ConstraintAst {
  return deepFreeze({
    id: requirement.id,
    name: requirement.name,
    expression: {
      kind: "binary" as const,
      op: requirement.operator,
      left: {
        kind: "ref" as const,
        featurePath: [requirement.metric] as readonly [string],
      },
      right: {
        kind: "literal" as const,
        value: requirement.limit.value,
        unit: requirement.limit.unit,
      },
    },
  });
}

// ---------------------------------------------------------------------------
// SysML rendering — constants
// ---------------------------------------------------------------------------

/**
 * SysML v2 identifier: letters, digits, underscores; must start with a letter
 * or underscore. Hyphens and dots are allowed by SAFE_ID but are not valid in
 * SysML identifiers.
 */
const SYSML_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Map from SI unit abbreviation to the SysML v2 attribute type supplied by
 * `private import SI::*`. Only units confirmed in a live probe are included;
 * all others are rejected fail-closed.
 *
 * Live-probe evidence:
 *
 *   2026-08-04, probe-requirements-2026-08-04, element d6793ccf:
 *     mm → LengthValue   (syson_constraint_extract returned unit: "mm")
 *     Pa → PressureValue (syson_constraint_extract returned unit: "Pa")
 *
 *   2026-08-08, probe-requirement-units (scripts/probes/probe-requirement-units.ts),
 *   sandbox deleted after each run via syson_project_delete:
 *     kg → MassValue    (status: ok, extractedUnit: "kg")
 *     W  → PowerValue   (status: ok, extractedUnit: "W")
 *     V  → VoltageValue (status: ok, extractedUnit: "V")
 *
 *   2026-08-14, probe-requirement-units (scripts/probes/probe-requirement-units.ts),
 *   sandbox deleted after each run via syson_project_delete:
 *     N   → ForceValue            (status: ok, extractedUnit: "N")
 *     J   → EnergyValue           (status: ok, extractedUnit: "J")
 *     s   → TimeValue             (status: ok, extractedUnit: "s")
 *     m   → LengthValue           (status: ok, extractedUnit: "m")
 *     K   → TemperatureValue      (status: ok, extractedUnit: "K")
 *     A   → ElectricCurrentValue  (status: ok, extractedUnit: "A")
 *     Hz  → FrequencyValue        (status: ok, extractedUnit: "Hz")
 *     rad → AngleValue            (status: ok, extractedUnit: "rad")
 *   Refused on the same date:
 *     m2  → AreaValue     (type_mismatch: FeatureReferenceExpression)
 *     N*m → TorqueValue   (extraction_failed — SysML syntax rejected)
 *     N.m → TorqueValue   (type_mismatch: extracted "N", dot truncates name)
 *     kPa → PressureValue (type_mismatch: prefixed variant not in SI library)
 *     deg → AngleValue    (type_mismatch: FeatureReferenceExpression)
 *   2026-08-15, same probe runner:
 *     1   → DimensionOneValue (extraction_failed: syson_constraint_extract
 *           returned no constraints) — dimensionless quantities are therefore
 *           NOT oracle-admissible yet; a buckling load-factor verdict must
 *           stay not_evaluated until a green probe closes this gap.
 *
 * To add a unit, run a probe that confirms insertion → extraction round-trip
 * and document the evidence here before merging.
 */
const UNIT_TO_SYSML_TYPE: ReadonlyMap<string, string> = new Map([
  ["mm", "LengthValue"],
  ["Pa", "PressureValue"],
  // Confirmed 2026-08-08 via scripts/probes/probe-requirement-units.ts against
  // SysON 0.5.1 on 127.0.0.1:3009 — all sandboxes deleted by syson_project_delete.
  ["kg", "MassValue"],
  ["W", "PowerValue"],
  ["V", "VoltageValue"],
  // Confirmed 2026-08-14 via scripts/probes/probe-requirement-units.ts against
  // SysON on 127.0.0.1:3009 — all sandboxes deleted by syson_project_delete.
  ["N", "ForceValue"],
  ["J", "EnergyValue"],
  ["s", "TimeValue"],
  ["m", "LengthValue"],
  ["K", "TemperatureValue"],
  ["A", "ElectricCurrentValue"],
  ["Hz", "FrequencyValue"],
  ["rad", "AngleValue"],
]);

// ---------------------------------------------------------------------------
// SysML rendering — public API
// ---------------------------------------------------------------------------

/**
 * Render oracle requirements as a SysML v2 part def that SysON can parse,
 * persist, and re-extract via syson_constraint_extract.
 *
 * ROUND-TRIP INVARIANT — for each requirement, the attribute name in the
 * generated SysML equals requirement.metric.  syson_constraint_extract
 * therefore returns featurePath = [requirement.metric], which matches the
 * output of buildConstraintAst verbatim.
 *
 * DETERMINISM — same inputs produce identical bytes every time. Requirements
 * are sorted by id before rendering; the caller's input order is irrelevant.
 *
 * GUARD — partDefName, every requirement.id, and every requirement.metric
 * must be valid SysML identifiers (letters, digits, underscores; no hyphens
 * or dots). Each requirement.limit.unit must have a confirmed SysML attribute
 * type mapping — the authoritative list is UNIT_TO_SYSML_TYPE below; never a
 * hand-maintained copy here, which is how this comment went stale once. All
 * constraints are validated fail-closed before the first character is written.
 *
 * The trusted executor derives the declaration name and renders reviewed
 * requirement values. Agents never supply SysML text at this boundary.
 */
export function renderOracleRequirementsSysml(
  partDefName: string,
  requirements: readonly OracleRequirement[],
): string {
  sysmlIdentifier(partDefName, "partDefName");
  const members = renderOracleRequirementMembers(requirements, "constraint");
  return [
    `part def ${partDefName} {`,
    "  private import SI::*;",
    ...members,
    "}",
  ].join("\n");
}

/**
 * Render a native SysML RequirementUsage owned by one target PartDefinition.
 *
 * SysON 0.5.1 materializes this exact form as a RequirementUsage child of the
 * `parent_id` supplied to `syson_element_insert_sysml`.  The explicit subject
 * is typed by the same PartDefinition identity and each oracle predicate is a
 * required constraint, rather than a generic ConstraintUsage in a detached
 * helper PartDefinition.
 */
export function renderTargetedOracleRequirementsSysml(
  requirementName: string,
  targetPartDefName: string,
  requirements: readonly OracleRequirement[],
): string {
  sysmlIdentifier(requirementName, "requirementName");
  sysmlIdentifier(targetPartDefName, "targetPartDefName");
  const members = renderOracleRequirementMembers(requirements, "require constraint");
  return [
    `requirement ${requirementName} {`,
    "  private import SI::*;",
    `  subject target : ${targetPartDefName};`,
    ...members,
    "}",
  ].join("\n");
}

function renderOracleRequirementMembers(
  requirements: readonly OracleRequirement[],
  constraintKeyword: "constraint" | "require constraint",
): string[] {
  if (requirements.length === 0) {
    throw new Error("requirements must not be empty.");
  }
  // Validate all requirements fail-closed before writing any text.
  const validated = requirements.map((req, index) => ({
    req,
    attrName: sysmlIdentifier(req.metric, `requirements[${index}].metric`),
    constraintName: `${sysmlIdentifier(req.id, `requirements[${index}].id`)}_limit`,
    attrType: sysmlAttributeType(req.limit.unit, `requirements[${index}].limit`),
  }));
  // Sort by id for byte-identical output regardless of input order.
  const sorted = [...validated].sort((left, right) =>
    left.req.id.localeCompare(right.req.id)
  );
  // Duplicate attribute names would produce invalid SysML.
  const attrNames = sorted.map((v) => v.attrName);
  if (new Set(attrNames).size !== attrNames.length) {
    throw new Error(
      "requirements produce duplicate SysML attribute names after sorting.",
    );
  }
  const lines: string[] = [];
  for (const { attrName, attrType } of sorted) {
    lines.push(`  attribute ${attrName} : ${attrType};`);
  }
  for (const { req, attrName, constraintName } of sorted) {
    lines.push(
      `  ${constraintKeyword} ${constraintName} { ${attrName} ${req.operator} ${
        String(req.limit.value)
      } [${req.limit.unit}] }`,
    );
  }
  return lines;
}

/**
 * Unit strings that have a confirmed SysML attribute-type mapping and are safe
 * to pass to renderOracleRequirementsSysml.
 *
 * This list mirrors UNIT_TO_SYSML_TYPE exactly and is exported so that the
 * requirements proposal parser can validate units fail-closed at parse time,
 * before the renderer is called.  Every entry is backed by a live probe that
 * confirmed the insert → extract round-trip in SysON.
 *
 * Live-probe evidence:
 *   mm — 2026-08-04, project probe-requirements-2026-08-04, element d6793ccf
 *   Pa — 2026-08-04, project probe-requirements-2026-08-04, element d6793ccf
 *   kg — 2026-08-08, scripts/probes/probe-requirement-units.ts, status ok
 *   W  — 2026-08-08, scripts/probes/probe-requirement-units.ts, status ok
 *   V  — 2026-08-08, scripts/probes/probe-requirement-units.ts, status ok
 *   N, J, s, m, K, A, Hz, rad — 2026-08-14 campaign,
 *     scripts/probes/probe-requirement-units.ts, status ok for all eight;
 *     per-unit dates and the refused candidates (m2, N*m, N.m, kPa, deg)
 *     are recorded inline in UNIT_TO_SYSML_TYPE and in
 *     docs/reference/providers/oracle-units.md.
 */
export const SUPPORTED_ORACLE_UNITS: readonly string[] = [
  ...UNIT_TO_SYSML_TYPE.keys(),
];

/**
 * Compute a deterministic SHA-256 fingerprint of a validated requirements
 * list.  Embed this fingerprint in the proof artifact to link the executed
 * evidence to the reviewed source declaration.
 *
 * Any change to a threshold, unit, or id produces a different fingerprint,
 * making alterations detectable by comparison with the golden reference.
 *
 * requirements must have been validated by validateOracleRequirements before
 * calling; this function does not re-validate.
 */
export function fingerprintOracleRequirements(
  requirements: readonly OracleRequirement[],
): Promise<ContentFingerprint> {
  return sha256Fingerprint(requirements);
}

// ---------------------------------------------------------------------------
// SysML rendering — private helpers
// ---------------------------------------------------------------------------

function sysmlIdentifier(value: string, path: string): string {
  if (!SYSML_ID.test(value)) {
    throw new Error(
      `${path} "${value}" is not a valid SysML identifier ` +
        `(letters, digits, underscores; must start with a letter or underscore).`,
    );
  }
  return value;
}

function sysmlAttributeType(unit: string, path: string): string {
  const type = UNIT_TO_SYSML_TYPE.get(unit);
  if (type === undefined) {
    const supported = [...UNIT_TO_SYSML_TYPE.keys()].join(", ");
    throw new Error(
      `${path}.unit "${unit}" has no confirmed SysML attribute type mapping. ` +
        `Supported: ${supported}.`,
    );
  }
  return type;
}
