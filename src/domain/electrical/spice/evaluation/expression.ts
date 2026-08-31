/**
 * Closed expression AST for admitted SPICE observation evaluation.
 *
 * Allowed nodes: native observation, numeric constant with unit, negate,
 * multiply. Units are V, A, W, and dimensionless 1. Multiplication is
 * V*A -> W and scalar sign handling only. No arbitrary code.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
} from "../../../kernel/case-validation.ts";
import {
  parseNativeName,
  type SpiceOperatingPointUnit,
} from "../admitted/isolated-output.ts";

export const ELECTRICAL_OBSERVATION_UNITS = ["V", "A", "W", "1"] as const;

export const ELECTRICAL_OBSERVATION_EXPRESSION_MAX_DEPTH = 8 as const;
export const ELECTRICAL_OBSERVATION_EXPRESSION_MAX_NODES = 24 as const;

export type ElectricalObservationUnit = (typeof ELECTRICAL_OBSERVATION_UNITS)[number];

export type ElectricalObservationNativeUnit = SpiceOperatingPointUnit;

export type ElectricalObservationExpression =
  | {
    readonly kind: "native-observation";
    readonly name: string;
  }
  | {
    readonly kind: "constant";
    readonly value: number;
    readonly unit: ElectricalObservationUnit;
  }
  | {
    readonly kind: "negate";
    readonly operand: ElectricalObservationExpression;
  }
  | {
    readonly kind: "multiply";
    readonly left: ElectricalObservationExpression;
    readonly right: ElectricalObservationExpression;
  };

export interface ElectricalObservationNativeBinding {
  readonly name: string;
  readonly value: number;
  readonly unit: ElectricalObservationNativeUnit;
}

export interface ElectricalObservationQuantity {
  readonly value: number;
  readonly unit: ElectricalObservationUnit;
}

export type ElectricalObservationExpressionStatus =
  | { readonly status: "ok"; readonly quantity: ElectricalObservationQuantity }
  | {
    readonly status: "unresolved";
    readonly reason:
      | "native-missing"
      | "native-not-unique"
      | "unit-identity-mismatch";
    readonly message: string;
  }
  | {
    readonly status: "error";
    readonly reason: "non-finite" | "unit-product-unsupported";
    readonly message: string;
  };

export function nativeObservationUnit(
  nativeName: string,
): ElectricalObservationNativeUnit {
  const name = parseNativeName(nativeName, "$expression.native-observation");
  return name.startsWith("v(") ? "V" : "A";
}

export function collectNativeObservationNames(
  expression: ElectricalObservationExpression,
): readonly string[] {
  const names: string[] = [];
  walk(expression, names);
  return deepFreeze([...new Set(names)].sort());
}

export function validateElectricalObservationExpression(
  value: unknown,
  path = "$expression",
): ElectricalObservationExpression {
  const expression = parseExpression(value, path);
  deriveExpressionUnit(expression, path);
  return expression;
}

export function deriveExpressionUnit(
  expression: ElectricalObservationExpression,
  path = "$expression",
): ElectricalObservationUnit {
  switch (expression.kind) {
    case "native-observation":
      return nativeObservationUnit(expression.name);
    case "constant":
      return expression.unit;
    case "negate":
      return deriveExpressionUnit(expression.operand, `${path}.operand`);
    case "multiply": {
      const left = deriveExpressionUnit(expression.left, `${path}.left`);
      const right = deriveExpressionUnit(expression.right, `${path}.right`);
      const product = multiplyUnits(left, right);
      if (product === undefined) {
        throw new TypeError(
          `${path} cannot multiply ${left} by ${right}; only V*A -> W and scalar 1 are admitted.`,
        );
      }
      return product;
    }
  }
}

export function evaluateElectricalObservationExpression(
  expression: ElectricalObservationExpression,
  natives: readonly ElectricalObservationNativeBinding[],
  path = "$expression",
): ElectricalObservationExpressionStatus {
  switch (expression.kind) {
    case "native-observation":
      return evaluateNative(expression.name, natives, path);
    case "constant":
      return finiteQuantity(expression.value, expression.unit, path);
    case "negate": {
      const operand = evaluateElectricalObservationExpression(
        expression.operand,
        natives,
        `${path}.operand`,
      );
      if (operand.status !== "ok") return operand;
      return finiteQuantity(
        -operand.quantity.value,
        operand.quantity.unit,
        path,
      );
    }
    case "multiply": {
      const left = evaluateElectricalObservationExpression(
        expression.left,
        natives,
        `${path}.left`,
      );
      if (left.status !== "ok") return left;
      const right = evaluateElectricalObservationExpression(
        expression.right,
        natives,
        `${path}.right`,
      );
      if (right.status !== "ok") return right;
      const unit = multiplyUnits(left.quantity.unit, right.quantity.unit);
      if (unit === undefined) {
        return {
          status: "error",
          reason: "unit-product-unsupported",
          message:
            `${path} cannot multiply ${left.quantity.unit} by ${right.quantity.unit}.`,
        };
      }
      return finiteQuantity(
        left.quantity.value * right.quantity.value,
        unit,
        path,
      );
    }
  }
}

function parseExpression(
  value: unknown,
  path: string,
  depth = 1,
  nodes = { count: 0 },
): ElectricalObservationExpression {
  if (depth > ELECTRICAL_OBSERVATION_EXPRESSION_MAX_DEPTH) {
    throw new TypeError(
      `${path} exceeds the closed expression depth of ${ELECTRICAL_OBSERVATION_EXPRESSION_MAX_DEPTH}.`,
    );
  }
  nodes.count += 1;
  if (nodes.count > ELECTRICAL_OBSERVATION_EXPRESSION_MAX_NODES) {
    throw new TypeError(
      `${path} exceeds the closed expression node count of ${ELECTRICAL_OBSERVATION_EXPRESSION_MAX_NODES}.`,
    );
  }
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const kind = nonEmptyText(rec.kind, `${path}.kind`);
  if (kind === "native-observation") {
    const input = exactRecord(value, ["kind", "name"], path);
    literalValue(input.kind, "native-observation", `${path}.kind`);
    const name = parseNativeName(input.name, `${path}.name`);
    return { kind: "native-observation", name };
  }
  if (kind === "constant") {
    const input = exactRecord(value, ["kind", "value", "unit"], path);
    literalValue(input.kind, "constant", `${path}.kind`);
    return {
      kind: "constant",
      value: finite(input.value, `${path}.value`),
      unit: parseUnit(input.unit, `${path}.unit`),
    };
  }
  if (kind === "negate") {
    const input = exactRecord(value, ["kind", "operand"], path);
    literalValue(input.kind, "negate", `${path}.kind`);
    return {
      kind: "negate",
      operand: parseExpression(
        input.operand,
        `${path}.operand`,
        depth + 1,
        nodes,
      ),
    };
  }
  if (kind === "multiply") {
    const input = exactRecord(value, ["kind", "left", "right"], path);
    literalValue(input.kind, "multiply", `${path}.kind`);
    return {
      kind: "multiply",
      left: parseExpression(input.left, `${path}.left`, depth + 1, nodes),
      right: parseExpression(input.right, `${path}.right`, depth + 1, nodes),
    };
  }
  throw new TypeError(
    `${path}.kind must be native-observation, constant, negate or multiply.`,
  );
}

function evaluateNative(
  name: string,
  natives: readonly ElectricalObservationNativeBinding[],
  path: string,
): ElectricalObservationExpressionStatus {
  const declaredUnit = nativeObservationUnit(name);
  const matches = natives.filter((item) => item.name === name);
  if (matches.length === 0) {
    return {
      status: "unresolved",
      reason: "native-missing",
      message: `${path} native observation "${name}" is absent from L3 evidence.`,
    };
  }
  if (matches.length !== 1) {
    return {
      status: "unresolved",
      reason: "native-not-unique",
      message:
        `${path} native observation "${name}" is not unique on the exact L3 evidence.`,
    };
  }
  const observed = matches[0]!;
  if (observed.unit !== declaredUnit) {
    return {
      status: "unresolved",
      reason: "unit-identity-mismatch",
      message:
        `${path} native observation "${name}" unit ${observed.unit} does not match ${declaredUnit}.`,
    };
  }
  return finiteQuantity(observed.value, observed.unit, path);
}

function finiteQuantity(
  value: number,
  unit: ElectricalObservationUnit,
  path: string,
): ElectricalObservationExpressionStatus {
  if (!Number.isFinite(value)) {
    return {
      status: "error",
      reason: "non-finite",
      message: `${path} evaluated to a non-finite quantity.`,
    };
  }
  return { status: "ok", quantity: { value, unit } };
}

function multiplyUnits(
  left: ElectricalObservationUnit,
  right: ElectricalObservationUnit,
): ElectricalObservationUnit | undefined {
  if (left === "1") return right;
  if (right === "1") return left;
  if (left === "V" && right === "A") return "W";
  if (left === "A" && right === "V") return "W";
  return undefined;
}

function parseUnit(value: unknown, path: string): ElectricalObservationUnit {
  if (
    value !== "V" && value !== "A" && value !== "W" && value !== "1"
  ) {
    throw new TypeError(`${path} must be V, A, W or 1.`);
  }
  return value;
}

function walk(
  expression: ElectricalObservationExpression,
  names: string[],
): void {
  switch (expression.kind) {
    case "native-observation":
      names.push(expression.name);
      return;
    case "constant":
      return;
    case "negate":
      walk(expression.operand, names);
      return;
    case "multiply":
      walk(expression.left, names);
      walk(expression.right, names);
  }
}
