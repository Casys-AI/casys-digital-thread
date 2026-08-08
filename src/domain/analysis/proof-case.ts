import type { ContentFingerprint } from "../thread/thread-snapshot.ts";
import { sha256Fingerprint } from "../kernel/deterministic-json.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../kernel/case-validation.ts";

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
 * This module is intentionally discipline-agnostic: no CalculiX, no CM-01
 * identifiers. The same contract is reusable by Modelica simulations, ERP
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
 * Discipline-agnostic: no CalculiX, no CM-01 identifiers.
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
 * Shape matches ScenarioConstraint in src/adapters/scenario-contract-verifier.ts,
 * which is the sole active caller of that tool today.
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
 * The shape is identical to ScenarioConstraint in
 * src/adapters/scenario-contract-verifier.ts, the sole active caller of
 * syson_constraint_evaluate today. Any change to the wire shape there must be
 * reflected here.
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
 * Live-probe evidence (2026-08-04, project probe-requirements-2026-08-04,
 * element d6793ccf):
 *   mm → LengthValue   (syson_constraint_extract returned unit: "mm")
 *   Pa → PressureValue (syson_constraint_extract returned unit: "Pa")
 *
 * To add a unit, run a probe that confirms insertion → extraction round-trip
 * and document the evidence here before merging.
 */
const UNIT_TO_SYSML_TYPE: ReadonlyMap<string, string> = new Map([
  ["mm", "LengthValue"],
  ["Pa", "PressureValue"],
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
 * type mapping (currently: mm → LengthValue, Pa → PressureValue). All
 * constraints are validated fail-closed before the first character is written.
 *
 * The caller is always a server-fixed executor that hard-codes partDefName.
 * Agents never reach this boundary — invariant 6: the server owns the SysML
 * text, not the agent.
 */
export function renderOracleRequirementsSysml(
  partDefName: string,
  requirements: readonly OracleRequirement[],
): string {
  sysmlIdentifier(partDefName, "partDefName");
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
  const lines: string[] = [`part def ${partDefName} {`, `  private import SI::*;`];
  for (const { attrName, attrType } of sorted) {
    lines.push(`  attribute ${attrName} : ${attrType};`);
  }
  for (const { req, attrName, constraintName } of sorted) {
    lines.push(
      `  constraint ${constraintName} { ${attrName} ${req.operator} ${
        String(req.limit.value)
      } [${req.limit.unit}] }`,
    );
  }
  lines.push("}");
  return lines.join("\n");
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
