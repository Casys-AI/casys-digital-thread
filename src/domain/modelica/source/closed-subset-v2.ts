/** Pure authority for the one generic executable Modelica closed subset v2. */

import {
  type ModelicaEquationNode,
  type ModelicaParameterNode,
  ModelicaParseError,
  type ModelicaVariableNode,
  parseModelicaSubset,
} from "./parse.ts";
import { ModelicaLexicalError } from "./lexical.ts";

export const MODELICA_CLOSED_SUBSET_V2_PROFILE_ID =
  "modelica-closed-subset-v2" as const;

export interface AuthorizedModelicaClosedSubsetV2Source {
  readonly modelName: string;
  readonly sourceText: string;
  readonly parameters: readonly ModelicaParameterNode[];
  readonly outputs: readonly ModelicaVariableNode[];
  readonly equations: readonly ModelicaEquationNode[];
  readonly scenario: {
    readonly startTimeS: number;
    readonly stopTimeS: number;
    readonly intervalS: number;
    readonly tolerance: number;
    readonly numberOfIntervals: number;
  };
}

/** Authorizes source exactly as parsed; no text or scenario is invented. */
export function authorizeModelicaClosedSubsetV2Source(
  sourceText: string,
): AuthorizedModelicaClosedSubsetV2Source {
  if (
    typeof sourceText !== "string" || sourceText.length === 0 ||
    sourceText.includes("\0")
  ) {
    fail("The Modelica closed-subset v2 source must be non-empty text without NUL.");
  }
  let model: ReturnType<typeof parseModelicaSubset>["model"];
  try {
    model = parseModelicaSubset(sourceText).model;
  } catch (error) {
    if (error instanceof ModelicaParseError || error instanceof ModelicaLexicalError) {
      throw new TypeError(error.message);
    }
    throw error;
  }
  if (model.parameters.length < 1 || model.parameters.length > 32) {
    fail("Modelica v2 requires 1 to 32 Real parameters.");
  }
  if (model.variables.length < 1 || model.variables.length > 16) {
    fail("Modelica v2 requires 1 to 16 Real outputs.");
  }
  exactUniqueNames(model.parameters.map((node) => node.name), "parameters");
  exactUniqueNames(model.variables.map((node) => node.name), "outputs");
  const parameterNames = new Set(model.parameters.map((node) => node.name));
  const outputNames = new Set(model.variables.map((node) => node.name));
  const declaredNames = new Set([...parameterNames, ...outputNames]);
  for (const name of parameterNames) {
    if (outputNames.has(name)) {
      fail("Modelica v2 parameter and output names must not collide.");
    }
  }
  for (const parameter of model.parameters) {
    exactAttributes(parameter.attributes, { unit: "string" }, parameter.name);
  }
  for (const output of model.variables) {
    exactAttributes(output.attributes, {
      unit: "string",
      start: "number-or-reference",
      fixed: "true",
    }, output.name);
  }
  if (model.equations.length !== model.variables.length) {
    fail("Modelica v2 requires exactly one equation per output.");
  }
  for (const output of model.variables) {
    const start = output.attributes.find((attribute) => attribute.name === "start");
    if (
      start?.referencedName !== undefined && !parameterNames.has(start.referencedName)
    ) {
      fail("Modelica output start may reference only a declared parameter.");
    }
  }
  const equationLhs = model.equations.map((node) => node.lhsName);
  exactUniqueNames(equationLhs, "equation left-hand sides");
  if (equationLhs.some((name) => !outputNames.has(name))) {
    fail("Modelica v2 equations may only target declared outputs.");
  }
  if (!model.equations.some((node) => node.discriminator === "der")) {
    fail("Modelica v2 requires at least one derivative equation.");
  }
  for (const equation of model.equations) {
    if (equation.rhsNames.some((name) => !declaredNames.has(name))) {
      fail("Modelica v2 RHS expressions may reference only declared names.");
    }
  }
  const { startTime, stopTime, interval, tolerance } = model.experiment;
  const duration = stopTime - startTime;
  if (!Number.isFinite(duration) || duration <= 0 || duration > 120) {
    fail("Modelica experiment duration must be > 0 and <= 120 seconds.");
  }
  const numberOfIntervals = exactDecimalGridIntervalCount(
    model.experiment.literals,
  );
  if (
    !Number.isFinite(interval) || interval <= 0 ||
    !Number.isFinite(numberOfIntervals) ||
    numberOfIntervals < 10 || numberOfIntervals > 2_000
  ) {
    fail("Modelica experiment Interval must derive 10 to 2000 exact grid intervals.");
  }
  if (!Number.isFinite(tolerance) || tolerance < 1e-12 || tolerance > 0.1) {
    fail("Modelica experiment Tolerance must be between 1e-12 and 0.1.");
  }
  return Object.freeze({
    modelName: model.name,
    sourceText,
    parameters: model.parameters,
    outputs: model.variables,
    equations: model.equations,
    scenario: Object.freeze({
      startTimeS: startTime,
      stopTimeS: stopTime,
      intervalS: interval,
      tolerance,
      numberOfIntervals,
    }),
  });
}

/**
 * Return the exact count only when (stop - start) / interval is an integer.
 * The parser preserves the signed decimal tokens so binary floating-point
 * rounding cannot turn a non-divisible signed scenario into an admitted grid.
 */
function exactDecimalGridIntervalCount(
  literals: Readonly<{
    readonly startTime: string;
    readonly stopTime: string;
    readonly interval: string;
  }>,
): number {
  const start = decimalRational(literals.startTime);
  const stop = decimalRational(literals.stopTime);
  const interval = decimalRational(literals.interval);
  const commonScale = Math.max(start.scale, stop.scale, interval.scale);
  const startNumerator = start.numerator * powerOfTen(commonScale - start.scale);
  const stopNumerator = stop.numerator * powerOfTen(commonScale - stop.scale);
  const intervalNumerator = interval.numerator *
    powerOfTen(commonScale - interval.scale);
  if (intervalNumerator <= 0n) return Number.NaN;
  const durationNumerator = stopNumerator - startNumerator;
  if (durationNumerator <= 0n || durationNumerator % intervalNumerator !== 0n) {
    return Number.NaN;
  }
  return Number(durationNumerator / intervalNumerator);
}

function decimalRational(literal: string): {
  readonly numerator: bigint;
  readonly scale: number;
} {
  const match = /^(-?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:[eE]([+-]?\d+))?$/.exec(
    literal,
  );
  if (match === null) fail("Modelica experiment literal is not decimal.");
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] ?? "";
  const fractional = match[3] ?? match[4] ?? "";
  const exponent = Number(match[5] ?? "0");
  if (!Number.isSafeInteger(exponent)) {
    fail("Modelica experiment decimal exponent is not representable.");
  }
  const digits = `${whole}${fractional}`.replace(/^0+(?=\d)/, "");
  const numerator = sign * BigInt(digits.length === 0 ? "0" : digits);
  return {
    numerator,
    scale: fractional.length - exponent,
  };
}

function powerOfTen(exponent: number): bigint {
  if (!Number.isSafeInteger(exponent) || exponent < 0) {
    fail("Modelica experiment decimal scale is not representable.");
  }
  return 10n ** BigInt(exponent);
}

function exactAttributes(
  attributes: readonly {
    readonly name: string;
    readonly value: unknown;
    readonly referencedName?: string;
  }[],
  expected: Readonly<
    Record<string, "string" | "number" | "number-or-reference" | "true">
  >,
  declarationName: string,
): void {
  if (attributes.length !== Object.keys(expected).length) {
    fail(`Modelica declaration ${declarationName} does not have its exact attributes.`);
  }
  const names = new Set<string>();
  for (const attribute of attributes) {
    if (names.has(attribute.name)) {
      fail(`Modelica declaration ${declarationName} repeats an attribute.`);
    }
    names.add(attribute.name);
    const kind = expected[attribute.name];
    if (
      kind === undefined ||
      (kind === "string" &&
        (attribute.referencedName !== undefined ||
          typeof attribute.value !== "string" || attribute.value.length === 0 ||
          attribute.value.length > 64 ||
          !/^[A-Za-z0-9._/*^()\-]+$/.test(attribute.value))) ||
      (kind === "number" &&
        (typeof attribute.value !== "number" || !Number.isFinite(attribute.value))) ||
      (kind === "number-or-reference" &&
        !(typeof attribute.value === "number" && Number.isFinite(attribute.value)) &&
        typeof attribute.referencedName !== "string") ||
      (kind === "true" && attribute.value !== true)
    ) {
      fail(
        `Modelica declaration ${declarationName} has an invalid ${attribute.name} attribute.`,
      );
    }
  }
}
function exactUniqueNames(names: readonly string[], label: string): void {
  if (new Set(names).size !== names.length) {
    fail(`Modelica v2 ${label} must be unique.`);
  }
}
function fail(message: string): never {
  throw new TypeError(message);
}
