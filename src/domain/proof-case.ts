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
// Validation primitives — private to this module
// ---------------------------------------------------------------------------

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function record(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function arrayOf(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${path} must be an array.`);
  return value;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const expectedSet = new Set(expected);
  for (const key of Object.keys(value)) {
    if (!expectedSet.has(key)) {
      throw new Error(`${path} has unsupported field ${key}.`);
    }
  }
  for (const key of expected) {
    if (!Object.hasOwn(value, key)) {
      throw new Error(`${path}.${key} is required.`);
    }
  }
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${path} must be a non-empty string without edge whitespace.`);
  }
  return value;
}

function safeId(value: unknown, path: string): string {
  const result = string(value, path);
  if (!SAFE_ID.test(result)) {
    throw new Error(`${path} must be a stable identifier.`);
  }
  return result;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${path} must be a finite number.`);
  }
  return value;
}

function oracleOperator(value: unknown, path: string): OracleOperator {
  if (value !== "<=" && value !== ">=") {
    throw new Error(`${path} must equal "<=" or ">=".`);
  }
  return value;
}

function oracleLimit(value: unknown, path: string): OracleLimit {
  const input = record(value, path);
  exactKeys(input, ["value", "unit"], path);
  return deepFreeze({
    value: finite(input.value, `${path}.value`),
    unit: string(input.unit, `${path}.unit`),
  });
}

function singleRequirement(value: unknown, path: string): OracleRequirement {
  const input = record(value, path);
  exactKeys(input, ["id", "name", "metric", "operator", "limit"], path);
  return deepFreeze({
    id: safeId(input.id, `${path}.id`),
    name: string(input.name, `${path}.name`),
    metric: safeId(input.metric, `${path}.metric`),
    operator: oracleOperator(input.operator, `${path}.operator`),
    limit: oracleLimit(input.limit, `${path}.limit`),
  });
}

function rejectDuplicates(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new Error(`${path} must not contain duplicates.`);
  }
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
// Internal utilities
// ---------------------------------------------------------------------------

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
