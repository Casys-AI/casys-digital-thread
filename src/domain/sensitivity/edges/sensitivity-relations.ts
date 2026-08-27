/**
 * Contract for anchoring sensitivity-study derivatives in the SysML model as
 * typed attribute declarations with validity-domain constraints.
 *
 * WHY THIS BOUNDARY EXISTS — the sensitivity derivatives are pure arithmetic
 * computed in the domain layer (sensitivity-study.ts). This module closes the
 * loop: it takes those validated derivatives and produces a deterministic SysML
 * PartDef that a server-fixed executor can insert into SysON, giving the model
 * explicit machine-readable links between structural parameters and FEA metrics.
 *
 * INVARIANTS
 *   1. Every attribute name is a valid SysML identifier (letters, digits,
 *      underscores; starts with letter or underscore).
 *   2. Every unit that appears in a constraint literal must have a confirmed SysML
 *      attribute type mapping in PARAM_UNIT_TO_SYSML_TYPE.
 *   3. Derivative attribute types use DERIVATIVE_UNIT_TO_SYSML_TYPE, which holds
 *      tentative (pending live-probe confirmation) mappings. Do NOT promote these
 *      to UNIT_TO_SYSML_TYPE in proof-case.ts until a probe run confirms them.
 *   4. Rendering is deterministic: same inputs produce identical bytes every time.
 *      Attributes and bounds are sorted by name before output.
 */

import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  rejectDuplicates,
} from "../../kernel/case-validation.ts";

// ---------------------------------------------------------------------------
// Schema constant
// ---------------------------------------------------------------------------

export const SENSITIVITY_RELATIONS_SCHEMA = "sensitivity-relations/1.0" as const;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/**
 * A parameter attribute that will be declared in the PartDef (e.g., the study
 * base value or step). The attribute has no value assignment in the SysML text;
 * it is a typed placeholder for the FEA parameter.
 */
export interface SensitivityRelationParamAttr {
  /** Must be a valid SysML identifier. */
  readonly attrName: string;
  /** SI unit abbreviation; must be in PARAM_UNIT_TO_SYSML_TYPE. */
  readonly unit: string;
}

/**
 * A derivative attribute that will be declared in the PartDef. The attribute
 * expresses ∂(metric)/∂(param) with a composed unit. No value assignment is
 * written in the SysML text.
 */
export interface SensitivityRelationDerivativeAttr {
  /** Must be a valid SysML identifier. */
  readonly attrName: string;
  /** Composed unit, e.g. "mm/mm" or "MPa/mm". Must be in DERIVATIVE_UNIT_TO_SYSML_TYPE. */
  readonly unit: string;
}

/**
 * A validity bound constraint. Expresses that the linearisation is only locally
 * valid around the study base value — NOT a product requirement.
 */
export interface SensitivityRelationBound {
  /** Must be a valid SysML identifier. */
  readonly constraintName: string;
  /** Must reference one of the param attribute names declared in the same PartDef. */
  readonly paramAttrName: string;
  readonly operator: ">=" | "<=";
  readonly boundValue: number;
  /** Must be in PARAM_UNIT_TO_SYSML_TYPE (same as the param attribute it bounds). */
  readonly boundUnit: string;
}

/**
 * Validated contract for one sensitivity-relations anchoring operation.
 * All string fields are validated fail-closed; no extra key is tolerated.
 */
export interface SensitivityRelationsDeclaration {
  readonly schemaVersion: typeof SENSITIVITY_RELATIONS_SCHEMA;
  readonly paramAttrs: readonly SensitivityRelationParamAttr[];
  readonly derivativeAttrs: readonly SensitivityRelationDerivativeAttr[];
  readonly validityBounds: readonly SensitivityRelationBound[];
  readonly runId: string;
  readonly capturedAt: string;
}

// ---------------------------------------------------------------------------
// Unit-to-SysML-type mappings
// ---------------------------------------------------------------------------

/**
 * Confirmed unit mappings for parameter attributes and constraint bounds.
 * Live-probe evidence (2026-08-04, oracle-requirements run):
 *   mm → LengthValue
 */
const PARAM_UNIT_TO_SYSML_TYPE: ReadonlyMap<string, string> = new Map([
  ["mm", "LengthValue"],
]);

/**
 * Tentative unit mappings for derivative attributes.
 *
 * PENDING LIVE-PROBE CONFIRMATION — these types are best-effort approximations.
 * A probe that inserts a text containing these units and reads back via
 * syson_constraint_extract is the only way to confirm them before the real
 * anchoring operation is executed with operator consent.
 *
 *   mm/mm   → DimensionOneValue: dimensionless ratio (ISO/IEC 80000-1).
 *             SysML v2 SI uses DimensionOneValue for dimensionless scalars.
 *   MPa/mm  → PressureValue: no standard SI v2 composite exists for a stress
 *             gradient. PressureValue is used as a structural approximation; the
 *             actual unit is encoded in the attribute name (e.g.,
 *             dVonMisesDSizeZ_MPa_per_mm) so the declared type is informational.
 *
 * Do NOT move these into UNIT_TO_SYSML_TYPE in proof-case.ts until a live probe
 * confirms the round-trip via syson_constraint_extract.
 */
const DERIVATIVE_UNIT_TO_SYSML_TYPE: ReadonlyMap<string, string> = new Map([
  ["mm/mm", "DimensionOneValue"],
  ["MPa/mm", "PressureValue"],
]);

// ---------------------------------------------------------------------------
// SysML identifier regex
// ---------------------------------------------------------------------------

const SYSML_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Validation — public API
// ---------------------------------------------------------------------------

/**
 * Validate and freeze an untrusted sensitivity-relations declaration.
 * Fail-closed: any unknown key, missing key, empty string, duplicate, or
 * invalid identifier is rejected with a typed error.
 *
 * @throws Error with a path-prefixed message on any validation failure.
 */
export function validateSensitivityRelationsDeclaration(
  value: unknown,
): SensitivityRelationsDeclaration {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "paramAttrs",
      "derivativeAttrs",
      "validityBounds",
      "runId",
      "capturedAt",
    ],
    "$decl",
  );
  literalValue(
    root.schemaVersion,
    SENSITIVITY_RELATIONS_SCHEMA,
    "$decl.schemaVersion",
  );

  const paramAttrs = nonEmptyArray(root.paramAttrs, "$decl.paramAttrs").map(
    (item, i) => parseParamAttr(item, `$decl.paramAttrs[${i}]`),
  );
  rejectDuplicates(paramAttrs.map((a) => a.attrName), "$decl.paramAttrs attrName");

  const derivativeAttrs = nonEmptyArray(
    root.derivativeAttrs,
    "$decl.derivativeAttrs",
  ).map((item, i) => parseDerivativeAttr(item, `$decl.derivativeAttrs[${i}]`));
  rejectDuplicates(
    derivativeAttrs.map((a) => a.attrName),
    "$decl.derivativeAttrs attrName",
  );

  // Attribute names across params and derivatives must not collide (same PartDef scope).
  const allAttrNames = [
    ...paramAttrs.map((a) => a.attrName),
    ...derivativeAttrs.map((a) => a.attrName),
  ];
  rejectDuplicates(allAttrNames, "$decl all attribute names");

  const paramAttrNames = new Set(paramAttrs.map((a) => a.attrName));
  const validityBounds = arrayOf(root.validityBounds, "$decl.validityBounds").map(
    (item, i) => parseBound(item, `$decl.validityBounds[${i}]`, paramAttrNames),
  );
  rejectDuplicates(
    validityBounds.map((b) => b.constraintName),
    "$decl.validityBounds constraintName",
  );

  const runId = nonEmptyText(root.runId, "$decl.runId");
  const capturedAt = nonEmptyText(root.capturedAt, "$decl.capturedAt");
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new Error("$decl.capturedAt must be an ISO timestamp.");
  }

  return deepFreeze({
    schemaVersion: SENSITIVITY_RELATIONS_SCHEMA,
    paramAttrs,
    derivativeAttrs,
    validityBounds,
    runId,
    capturedAt,
  });
}

// ---------------------------------------------------------------------------
// Rendering — public API
// ---------------------------------------------------------------------------

/**
 * Render a sensitivity-relations PartDef as SysML v2 text that SysON can parse,
 * persist, and re-extract.
 *
 * ROUND-TRIP INVARIANT — the constraint names (constraintName) and parameter
 * attribute names (paramAttrName) in the generated SysML match the fields in the
 * declaration, so `syson_constraint_extract` returns `featurePath[0]` values that
 * the extractor can join back to the declaration without relying on SysON UUIDs.
 *
 * DETERMINISM — attributes are sorted by attrName, bounds are sorted by
 * constraintName. Same inputs always produce identical bytes.
 *
 * GUARD — partDefName must be a valid SysML identifier. All attrName and
 * constraintName values are validated. All units must have confirmed or tentative
 * (pending-probe) type mappings. Any unknown unit is rejected fail-closed.
 *
 * The caller is always a server-fixed executor that hard-codes partDefName.
 * Agents never reach this boundary — invariant 6: the server owns the SysML text.
 */
export function renderSensitivityRelationsSysml(
  partDefName: string,
  decl: SensitivityRelationsDeclaration,
): string {
  sysmlIdentifier(partDefName, "partDefName");

  // Validate all attribute types fail-closed before writing a single character.
  const renderedParams = [...decl.paramAttrs]
    .sort((a, b) => a.attrName.localeCompare(b.attrName))
    .map((attr) => ({
      attrName: sysmlIdentifier(attr.attrName, `paramAttr.${attr.attrName}`),
      sysmlType: paramSysmlType(attr.unit, `paramAttr.${attr.attrName}.unit`),
    }));

  const renderedDerivatives = [...decl.derivativeAttrs]
    .sort((a, b) => a.attrName.localeCompare(b.attrName))
    .map((attr) => ({
      attrName: sysmlIdentifier(
        attr.attrName,
        `derivativeAttr.${attr.attrName}`,
      ),
      sysmlType: derivativeSysmlType(
        attr.unit,
        `derivativeAttr.${attr.attrName}.unit`,
      ),
    }));

  const renderedBounds = [...decl.validityBounds]
    .sort((a, b) => a.constraintName.localeCompare(b.constraintName))
    .map((bound) => ({
      constraintName: sysmlIdentifier(
        bound.constraintName,
        `bound.${bound.constraintName}`,
      ),
      paramAttrName: sysmlIdentifier(
        bound.paramAttrName,
        `bound.${bound.constraintName}.paramAttrName`,
      ),
      operator: bound.operator,
      boundValue: finite(bound.boundValue, `bound.${bound.constraintName}.boundValue`),
      // Bound unit: must be a confirmed param unit (only [mm] today).
      boundUnit: paramUnitConfirmed(
        bound.boundUnit,
        `bound.${bound.constraintName}.boundUnit`,
      ),
    }));

  const lines: string[] = [`part def ${partDefName} {`, `  private import SI::*;`];
  for (const { attrName, sysmlType } of renderedParams) {
    lines.push(`  attribute ${attrName} : ${sysmlType};`);
  }
  for (const { attrName, sysmlType } of renderedDerivatives) {
    lines.push(`  attribute ${attrName} : ${sysmlType};`);
  }
  for (
    const { constraintName, paramAttrName, operator, boundValue, boundUnit }
      of renderedBounds
  ) {
    lines.push(
      `  constraint ${constraintName} { ${paramAttrName} ${operator} ${
        String(boundValue)
      } [${boundUnit}] }`,
    );
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Compute a deterministic SHA-256 fingerprint of a validated declaration.
 * Embed this fingerprint in the proof artifact so the evidence is linked to
 * the exact reviewed declaration bytes.
 */
export function fingerprintSensitivityRelations(
  decl: SensitivityRelationsDeclaration,
): Promise<ContentFingerprint> {
  return sha256Fingerprint(decl);
}

// ---------------------------------------------------------------------------
// Parsers — private
// ---------------------------------------------------------------------------

function parseParamAttr(
  value: unknown,
  path: string,
): SensitivityRelationParamAttr {
  const input = exactRecord(value, ["attrName", "unit"], path);
  const attrName = sysmlIdentifier(
    nonEmptyText(input.attrName, `${path}.attrName`),
    `${path}.attrName`,
  );
  const unit = nonEmptyText(input.unit, `${path}.unit`);
  paramSysmlType(unit, `${path}.unit`); // fail-closed: unit must be in map
  return { attrName, unit };
}

function parseDerivativeAttr(
  value: unknown,
  path: string,
): SensitivityRelationDerivativeAttr {
  const input = exactRecord(value, ["attrName", "unit"], path);
  const attrName = sysmlIdentifier(
    nonEmptyText(input.attrName, `${path}.attrName`),
    `${path}.attrName`,
  );
  const unit = nonEmptyText(input.unit, `${path}.unit`);
  derivativeSysmlType(unit, `${path}.unit`); // fail-closed: unit must be in map
  return { attrName, unit };
}

function parseBound(
  value: unknown,
  path: string,
  paramAttrNames: ReadonlySet<string>,
): SensitivityRelationBound {
  const input = exactRecord(
    value,
    ["constraintName", "paramAttrName", "operator", "boundValue", "boundUnit"],
    path,
  );
  const constraintName = sysmlIdentifier(
    nonEmptyText(input.constraintName, `${path}.constraintName`),
    `${path}.constraintName`,
  );
  const paramAttrName = nonEmptyText(input.paramAttrName, `${path}.paramAttrName`);
  sysmlIdentifier(paramAttrName, `${path}.paramAttrName`);
  if (!paramAttrNames.has(paramAttrName)) {
    throw new Error(
      `${path}.paramAttrName "${paramAttrName}" is not declared in paramAttrs.`,
    );
  }
  const operator = parseOperator(input.operator, `${path}.operator`);
  const boundValue = finite(input.boundValue, `${path}.boundValue`);
  const boundUnit = nonEmptyText(input.boundUnit, `${path}.boundUnit`);
  paramUnitConfirmed(boundUnit, `${path}.boundUnit`);
  return { constraintName, paramAttrName, operator, boundValue, boundUnit };
}

// ---------------------------------------------------------------------------
// Helpers — private
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

function paramSysmlType(unit: string, path: string): string {
  const type = PARAM_UNIT_TO_SYSML_TYPE.get(unit);
  if (type === undefined) {
    const supported = [...PARAM_UNIT_TO_SYSML_TYPE.keys()].join(", ");
    throw new Error(
      `${path} unit "${unit}" has no confirmed SysML attribute type mapping. ` +
        `Supported (confirmed by live probe): ${supported}.`,
    );
  }
  return type;
}

function derivativeSysmlType(unit: string, path: string): string {
  const type = DERIVATIVE_UNIT_TO_SYSML_TYPE.get(unit);
  if (type === undefined) {
    const supported = [...DERIVATIVE_UNIT_TO_SYSML_TYPE.keys()].join(", ");
    throw new Error(
      `${path} unit "${unit}" has no tentative SysML attribute type mapping. ` +
        `Supported (pending live-probe confirmation): ${supported}.`,
    );
  }
  return type;
}

function paramUnitConfirmed(unit: string, path: string): string {
  // Must be a confirmed param unit.
  const type = PARAM_UNIT_TO_SYSML_TYPE.get(unit);
  if (type === undefined) {
    const supported = [...PARAM_UNIT_TO_SYSML_TYPE.keys()].join(", ");
    throw new Error(
      `${path} bound unit "${unit}" must be a confirmed param unit. ` +
        `Supported: ${supported}.`,
    );
  }
  return unit;
}

function parseOperator(value: unknown, path: string): ">=" | "<=" {
  if (value !== ">=" && value !== "<=") {
    throw new Error(`${path} must be ">=" or "<=".`);
  }
  return value;
}
