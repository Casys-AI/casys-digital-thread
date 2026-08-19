/**
 * Domain contract for one sensitivity edge in a linearization study.
 *
 * INDIFFERENCE A LA SOURCE — the oracle that produced the measurement is not
 * named here. Mechanical analysis today, thermal simulation tomorrow — same
 * contract. No provider or product identifiers live in this module.
 *
 * An EDGE is a measured local derivative of one response metric with respect to
 * one driver parameter, valid in a declared neighborhood.
 *
 * INVARIANTS
 *   1. Every SysML attribute name must be a valid SysML identifier (letters,
 *      digits, underscores; starts with a letter or underscore).
 *   2. Every unit that appears in a constraint literal must have a confirmed SysML
 *      attribute type mapping in DRIVER_UNIT_TO_SYSML_TYPE.
 *   3. Response attribute types use RESPONSE_UNIT_TO_SYSML_TYPE, which holds
 *      only units confirmed by live-probe round-trips. Do NOT add a unit without
 *      a probe that confirms insertion → extraction.
 *   4. Rendering is deterministic: same inputs produce identical bytes. Edges
 *      are sorted by driver.sysmlAttrName before output.
 *   5. Driver sysmlAttrNames and response sysmlAttrNames across all edges in a
 *      set must be globally unique (they land in the same PartDef scope).
 *   6. Constraint names (lower + upper per edge) must also be globally unique.
 *
 * WHY NOT SPECIALIZATION — live probe (project probe-sensitivity-edge-2026-08-05,
 * confirmed 2026-08-05) showed that `specializes` makes the constraint's
 * featurePath degrade to "FeatureReferenceExpression" rather than the declared
 * attribute name. The retained SysML form is a flat `part def` container with N
 * driver attributes + N response attributes + 2N validity constraints. This is
 * the only form for which syson_constraint_extract returns the correct featurePath.
 */

import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import { sha256Fingerprint } from "../../kernel/deterministic-json.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyText,
  rejectDuplicates,
} from "../../kernel/case-validation.ts";

// ---------------------------------------------------------------------------
// Schema constant
// ---------------------------------------------------------------------------

export const SENSITIVITY_EDGE_SCHEMA = "sensitivity-edge/1.0" as const;

// ---------------------------------------------------------------------------
// Domain types
// ---------------------------------------------------------------------------

/** A dimensioned scalar. unit is mandatory and non-empty. */
export interface SensitivityEdgeDimensioned {
  readonly value: number;
  readonly unit: string;
}

/**
 * The validity neighborhood declares that the linearization is only locally
 * reliable for driver values in [lower, upper] around the base point.
 * It is NOT a product requirement.
 */
export interface SensitivityEdgeValidityNeighborhood {
  readonly lower: SensitivityEdgeDimensioned;
  readonly upper: SensitivityEdgeDimensioned;
  /** SysML constraint name for the lower bound. Must be a valid SysML identifier. */
  readonly lowerConstraintName: string;
  /** SysML constraint name for the upper bound. Must be a valid SysML identifier. */
  readonly upperConstraintName: string;
}

/**
 * The driver (input parameter being perturbed).
 * sysmlAttrName is server-fixed: agents never supply it.
 */
export interface SensitivityEdgeDriver {
  /** SysML attribute name declared in the model. Unique per edge in its set. */
  readonly sysmlAttrName: string;
  readonly unit: string;
  /** The value at which the derivative was measured (linearization point). */
  readonly basePoint: SensitivityEdgeDimensioned;
  readonly validityNeighborhood: SensitivityEdgeValidityNeighborhood;
}

/**
 * The response (output metric being tracked).
 * sysmlAttrName is server-fixed: agents never supply it.
 */
export interface SensitivityEdgeResponse {
  /** Oracle metric identifier, e.g. "assembly_max_displacement". */
  readonly metric: string;
  /** SysML attribute name for the derivative. Unique per edge in its set. */
  readonly sysmlAttrName: string;
  readonly unit: string;
}

/** The measured local derivative ∂(response) / ∂(driver). */
export interface SensitivityEdgeDerivative {
  readonly value: number;
  readonly unit: string;
}

/** Provenance: which run produced this measurement. */
export interface SensitivityEdgeProvenance {
  readonly runId: string;
  readonly capturedAt: string;
}

/**
 * One sensitivity edge: driver + response + derivative + validity + provenance.
 * Validated fail-closed by validateSensitivityEdge; no extra key tolerated.
 */
export interface SensitivityEdge {
  readonly schemaVersion: typeof SENSITIVITY_EDGE_SCHEMA;
  readonly driver: SensitivityEdgeDriver;
  readonly response: SensitivityEdgeResponse;
  readonly derivative: SensitivityEdgeDerivative;
  readonly provenance: SensitivityEdgeProvenance;
}

// ---------------------------------------------------------------------------
// Unit-to-SysML-type mappings
// ---------------------------------------------------------------------------

/**
 * Confirmed unit mappings for driver attributes and constraint bounds.
 *
 * Live-probe evidence (2026-08-05, project probe-sensitivity-edge-2026-08-05):
 *   mm → LengthValue (driver attr sizeZ_base_assembly_max_displacement, re-extracted
 *         via syson_element_children with label preserved)
 *
 * This is the only confirmed mapping; add others only after a probe confirms the
 * insertion → syson_element_children round-trip.
 */
const DRIVER_UNIT_TO_SYSML_TYPE: ReadonlyMap<string, string> = new Map([
  ["mm", "LengthValue"],
]);

/**
 * Confirmed unit mappings for response (derivative) attributes.
 *
 * Live-probe evidence (2026-08-05, project probe-sensitivity-edge-2026-08-05):
 *   mm/mm  → DimensionOneValue (d_assembly_max_displacement_mm_per_mm, re-extracted)
 *   MPa/mm → PressureValue     (d_assembly_max_von_mises_MPa_per_mm, re-extracted)
 *
 * Do NOT add a unit until a probe that inserts and re-extracts via
 * syson_element_children confirms it.
 */
const RESPONSE_UNIT_TO_SYSML_TYPE: ReadonlyMap<string, string> = new Map([
  ["mm/mm", "DimensionOneValue"],
  ["MPa/mm", "PressureValue"],
]);

// ---------------------------------------------------------------------------
// SysML identifier regex
// ---------------------------------------------------------------------------

const SYSML_ID = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ---------------------------------------------------------------------------
// Public validation API
// ---------------------------------------------------------------------------

/**
 * Validate and freeze an untrusted sensitivity edge.
 * Fail-closed: any unknown key, missing key, empty string, non-finite number,
 * invalid SysML identifier, or unknown unit is rejected.
 *
 * @throws Error with a path-prefixed message on any validation failure.
 */
export function validateSensitivityEdge(value: unknown): SensitivityEdge {
  const root = exactRecord(
    value,
    ["schemaVersion", "driver", "response", "derivative", "provenance"],
    "$edge",
  );
  literalValue(root.schemaVersion, SENSITIVITY_EDGE_SCHEMA, "$edge.schemaVersion");

  const driver = parseDriver(root.driver, "$edge.driver");
  const response = parseResponse(root.response, "$edge.response");
  const derivative = parseDimensioned(root.derivative, "$edge.derivative");
  const provenance = parseProvenance(root.provenance, "$edge.provenance");

  // derivative unit must match response unit (they describe the same ratio).
  if (derivative.unit !== response.unit) {
    throw new Error(
      `$edge.derivative.unit "${derivative.unit}" must equal $edge.response.unit "${response.unit}".`,
    );
  }

  return deepFreeze({
    schemaVersion: SENSITIVITY_EDGE_SCHEMA,
    driver,
    response,
    derivative,
    provenance,
  });
}

/**
 * Validate and freeze a non-empty array of sensitivity edges.
 * Additionally checks that all driver.sysmlAttrName, response.sysmlAttrName,
 * and constraint names are globally unique within the set.
 *
 * @throws Error on any structural or uniqueness violation.
 */
export function validateSensitivityEdgeSet(
  value: unknown,
): readonly SensitivityEdge[] {
  const items = arrayOf(value, "$edges");
  if (items.length === 0) throw new Error("$edges must not be empty.");

  const edges = items.map((item) => validateSensitivityEdge(item));

  // Global uniqueness within the set.
  rejectDuplicates(
    edges.map((e) => e.driver.sysmlAttrName),
    "$edges driver.sysmlAttrName",
  );
  rejectDuplicates(
    edges.map((e) => e.response.sysmlAttrName),
    "$edges response.sysmlAttrName",
  );
  rejectDuplicates(
    edges.flatMap((e) => [
      e.driver.validityNeighborhood.lowerConstraintName,
      e.driver.validityNeighborhood.upperConstraintName,
    ]),
    "$edges constraint names",
  );

  // All driver+response sysmlAttrNames must be distinct from each other.
  const allAttrNames = [
    ...edges.map((e) => e.driver.sysmlAttrName),
    ...edges.map((e) => e.response.sysmlAttrName),
  ];
  rejectDuplicates(allAttrNames, "$edges all sysml attribute names");

  return Object.freeze(edges);
}

// ---------------------------------------------------------------------------
// Public rendering API
// ---------------------------------------------------------------------------

/**
 * Render a set of sensitivity edges as a SysML v2 PartDef that SysON can parse,
 * persist, and re-extract.
 *
 * FORM — flat `part def` with N driver attrs + N response attrs + 2N validity
 * constraints. Specialization is deliberately NOT used: live probe confirmed that
 * `specializes` degrades constraint featurePaths to "FeatureReferenceExpression"
 * (2026-08-05, project probe-sensitivity-edge-2026-08-05).
 *
 * ROUND-TRIP INVARIANT — every driver.sysmlAttrName appears as featurePath[0] in
 * the corresponding validity constraint rows returned by syson_constraint_extract.
 *
 * DETERMINISM — edges are sorted by driver.sysmlAttrName before rendering. Same
 * inputs always produce identical bytes regardless of input order.
 *
 * GUARD — partDefName and all sysmlAttrName / constraintName values must be valid
 * SysML identifiers. All driver.unit values must be in DRIVER_UNIT_TO_SYSML_TYPE.
 * All response.unit values must be in RESPONSE_UNIT_TO_SYSML_TYPE. Validation is
 * fail-closed before the first character is written.
 *
 * The caller is always a server-fixed executor. Agents never reach this boundary.
 */
export function renderSensitivityEdgeSetSysml(
  partDefName: string,
  edges: readonly SensitivityEdge[],
): string {
  sysmlIdentifier(partDefName, "partDefName");
  if (edges.length === 0) throw new Error("edges must not be empty.");

  // Fail-closed guard: validate all names and types before writing any text.
  const sorted = [...edges].sort((a, b) =>
    a.driver.sysmlAttrName.localeCompare(b.driver.sysmlAttrName)
  );

  const renderedEdges = sorted.map((edge) => ({
    driverAttrName: sysmlIdentifier(
      edge.driver.sysmlAttrName,
      `driver.sysmlAttrName`,
    ),
    driverType: driverSysmlType(edge.driver.unit, `driver.unit`),
    responseAttrName: sysmlIdentifier(
      edge.response.sysmlAttrName,
      `response.sysmlAttrName`,
    ),
    responseType: responseSysmlType(edge.response.unit, `response.unit`),
    lowerConstraintName: sysmlIdentifier(
      edge.driver.validityNeighborhood.lowerConstraintName,
      `driver.validityNeighborhood.lowerConstraintName`,
    ),
    upperConstraintName: sysmlIdentifier(
      edge.driver.validityNeighborhood.upperConstraintName,
      `driver.validityNeighborhood.upperConstraintName`,
    ),
    lowerValue: finite(
      edge.driver.validityNeighborhood.lower.value,
      `driver.validityNeighborhood.lower.value`,
    ),
    lowerUnit: edge.driver.validityNeighborhood.lower.unit,
    upperValue: finite(
      edge.driver.validityNeighborhood.upper.value,
      `driver.validityNeighborhood.upper.value`,
    ),
    upperUnit: edge.driver.validityNeighborhood.upper.unit,
  }));

  // Duplicate attribute names in the same PartDef scope would produce invalid SysML.
  const allAttrNames = [
    ...renderedEdges.map((e) => e.driverAttrName),
    ...renderedEdges.map((e) => e.responseAttrName),
  ];
  if (new Set(allAttrNames).size !== allAttrNames.length) {
    throw new Error(
      "edges produce duplicate SysML attribute names — each driver and response sysmlAttrName must be unique.",
    );
  }
  const allConstraintNames = renderedEdges.flatMap((e) => [
    e.lowerConstraintName,
    e.upperConstraintName,
  ]);
  if (new Set(allConstraintNames).size !== allConstraintNames.length) {
    throw new Error(
      "edges produce duplicate SysML constraint names — each constraint name must be unique.",
    );
  }

  const lines: string[] = [`part def ${partDefName} {`, `  private import SI::*;`];

  // Driver attributes block.
  for (const { driverAttrName, driverType } of renderedEdges) {
    lines.push(`  attribute ${driverAttrName} : ${driverType};`);
  }

  // Response attributes block.
  for (const { responseAttrName, responseType } of renderedEdges) {
    lines.push(`  attribute ${responseAttrName} : ${responseType};`);
  }

  // Validity constraint block (lower + upper per edge, interleaved by edge).
  for (
    const {
      lowerConstraintName,
      upperConstraintName,
      driverAttrName,
      lowerValue,
      lowerUnit,
      upperValue,
      upperUnit,
    } of renderedEdges
  ) {
    lines.push(
      `  constraint ${lowerConstraintName} { ${driverAttrName} >= ${
        String(lowerValue)
      } [${lowerUnit}] }`,
    );
    lines.push(
      `  constraint ${upperConstraintName} { ${driverAttrName} <= ${
        String(upperValue)
      } [${upperUnit}] }`,
    );
  }

  lines.push("}");
  return lines.join("\n");
}

/**
 * Compute a deterministic SHA-256 fingerprint of a validated edge set.
 * Embed this fingerprint in the proof artifact to link evidence to the exact
 * reviewed edge declarations.
 */
export function fingerprintSensitivityEdgeSet(
  edges: readonly SensitivityEdge[],
): Promise<ContentFingerprint> {
  return sha256Fingerprint(edges);
}

// ---------------------------------------------------------------------------
// Parsers — private
// ---------------------------------------------------------------------------

function parseDriver(value: unknown, path: string): SensitivityEdgeDriver {
  const rec = exactRecord(
    value,
    ["sysmlAttrName", "unit", "basePoint", "validityNeighborhood"],
    path,
  );
  const attrName = sysmlIdentifier(
    nonEmptyText(rec.sysmlAttrName, `${path}.sysmlAttrName`),
    `${path}.sysmlAttrName`,
  );
  const unit = nonEmptyText(rec.unit, `${path}.unit`);
  driverSysmlType(unit, `${path}.unit`); // fail-closed: must be in map
  const basePoint = parseDimensioned(rec.basePoint, `${path}.basePoint`);
  const vn = parseValidityNeighborhood(
    rec.validityNeighborhood,
    `${path}.validityNeighborhood`,
  );
  return { sysmlAttrName: attrName, unit, basePoint, validityNeighborhood: vn };
}

function parseValidityNeighborhood(
  value: unknown,
  path: string,
): SensitivityEdgeValidityNeighborhood {
  const rec = exactRecord(
    value,
    ["lower", "upper", "lowerConstraintName", "upperConstraintName"],
    path,
  );
  const lower = parseDimensioned(rec.lower, `${path}.lower`);
  const upper = parseDimensioned(rec.upper, `${path}.upper`);
  if (lower.value >= upper.value) {
    throw new Error(
      `${path}.lower.value (${lower.value}) must be strictly less than ${path}.upper.value (${upper.value}).`,
    );
  }
  const lowerConstraintName = sysmlIdentifier(
    nonEmptyText(rec.lowerConstraintName, `${path}.lowerConstraintName`),
    `${path}.lowerConstraintName`,
  );
  const upperConstraintName = sysmlIdentifier(
    nonEmptyText(rec.upperConstraintName, `${path}.upperConstraintName`),
    `${path}.upperConstraintName`,
  );
  if (lowerConstraintName === upperConstraintName) {
    throw new Error(
      `${path}.lowerConstraintName and upperConstraintName must be distinct.`,
    );
  }
  return { lower, upper, lowerConstraintName, upperConstraintName };
}

function parseResponse(value: unknown, path: string): SensitivityEdgeResponse {
  const rec = exactRecord(value, ["metric", "sysmlAttrName", "unit"], path);
  const metric = nonEmptyText(rec.metric, `${path}.metric`);
  const attrName = sysmlIdentifier(
    nonEmptyText(rec.sysmlAttrName, `${path}.sysmlAttrName`),
    `${path}.sysmlAttrName`,
  );
  const unit = nonEmptyText(rec.unit, `${path}.unit`);
  responseSysmlType(unit, `${path}.unit`); // fail-closed: must be in map
  return { metric, sysmlAttrName: attrName, unit };
}

function parseDimensioned(value: unknown, path: string): SensitivityEdgeDimensioned {
  const rec = exactRecord(value, ["value", "unit"], path);
  const v = finite(rec.value, `${path}.value`);
  const unit = nonEmptyText(rec.unit, `${path}.unit`);
  return { value: v, unit };
}

function parseProvenance(value: unknown, path: string): SensitivityEdgeProvenance {
  const rec = exactRecord(value, ["runId", "capturedAt"], path);
  const runId = nonEmptyText(rec.runId, `${path}.runId`);
  const capturedAt = nonEmptyText(rec.capturedAt, `${path}.capturedAt`);
  if (Number.isNaN(Date.parse(capturedAt))) {
    throw new Error(`${path}.capturedAt must be an ISO timestamp.`);
  }
  return { runId, capturedAt };
}

// ---------------------------------------------------------------------------
// Unit helpers — private
// ---------------------------------------------------------------------------

function driverSysmlType(unit: string, path: string): string {
  const type = DRIVER_UNIT_TO_SYSML_TYPE.get(unit);
  if (type === undefined) {
    const supported = [...DRIVER_UNIT_TO_SYSML_TYPE.keys()].join(", ");
    throw new Error(
      `${path} unit "${unit}" has no confirmed SysML driver attribute type mapping. ` +
        `Supported (confirmed by live probe): ${supported}.`,
    );
  }
  return type;
}

function responseSysmlType(unit: string, path: string): string {
  const type = RESPONSE_UNIT_TO_SYSML_TYPE.get(unit);
  if (type === undefined) {
    const supported = [...RESPONSE_UNIT_TO_SYSML_TYPE.keys()].join(", ");
    throw new Error(
      `${path} unit "${unit}" has no confirmed SysML response attribute type mapping. ` +
        `Supported (confirmed by live probe): ${supported}.`,
    );
  }
  return type;
}

// ---------------------------------------------------------------------------
// SysML identifier validator — private (domain-specific, not in case-validation)
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
