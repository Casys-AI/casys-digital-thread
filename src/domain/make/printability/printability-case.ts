/**
 * Schema and pure-domain functions for FDM printability checks of build123d
 * geometry exported as STEP.
 *
 * Why this boundary exists: the printability case is a reviewed configuration
 * file; the agent never supplies provider names, thresholds, or geometry. The
 * executor reads thresholds from the case. No verdict, no evaluation — only
 * observations with units. Project-specific CAD script renderers live outside
 * this generic schema.
 *
 * Threshold provenance: the values in the reviewed case are declared as
 * PROVISIONAL candidates. They were chosen from typical FDM desktop-printer
 * guidelines, not from a specific printer datasheet. They are reviewed
 * candidates, not supplier specifications.
 *
 * meshSizeMm — provisoire : « fine enough to sample the 1.2 mm declared wall
 * limit ». A finer mesh would improve min-thickness sample coverage but
 * significantly increases solve time; 2.0 mm is the reviewed starting point.
 *
 * buildDirection — conventionally [0, 0, 1] when printing flat with +Z up;
 * the executor passes it verbatim to dfm_check_overhangs.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  positiveInteger,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";

export const PRINTABILITY_CHECK_CASE_SCHEMA = "printability-check-case/1.0" as const;

export interface PrintabilityCheckCase {
  readonly schemaVersion: typeof PRINTABILITY_CHECK_CASE_SCHEMA;
  readonly id: string;
  readonly revision: number;
  readonly scope: string;
  readonly evidenceBoundary: string;
  readonly project: {
    readonly id: string;
    readonly subjectId: string;
  };
  readonly target: {
    readonly componentKey: string;
  };
  readonly thresholds: {
    readonly minWallThicknessMm: { readonly value: number; readonly unit: "mm" };
    readonly maxOverhangAngleDeg: { readonly value: number; readonly unit: "deg" };
    readonly maxUnsupportedAreaMm2: { readonly value: number; readonly unit: "mm2" };
  };
  /** Mesh resolution passed to dfm_check_* (required). */
  readonly meshSizeMm: { readonly value: number; readonly unit: "mm" };
  /**
   * Build direction vector [x, y, z] passed to dfm_check_overhangs (required).
   * Conventionally [0, 0, 1] when printing flat with +Z up.
   */
  readonly buildDirection: readonly [number, number, number];
  readonly provider: {
    readonly build123dTool: "build123d_export";
    readonly thicknessTool: "dfm_check_min_thickness";
    readonly overhangTool: "dfm_check_overhangs";
  };
  readonly limitations: readonly string[];
  readonly provenance: {
    readonly status: "provisional";
    readonly note: string;
  };
}

// --- validation ---------------------------------------------------------------

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "thresholds",
  "meshSizeMm",
  "buildDirection",
  "provider",
  "limitations",
  "provenance",
] as const;

/** Parse and validate an untrusted value as a printability-check-case/1.0 case. */
export function validatePrintabilityCheckCase(value: unknown): PrintabilityCheckCase {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(
    root.schemaVersion,
    PRINTABILITY_CHECK_CASE_SCHEMA,
    "$case.schemaVersion",
  );
  const id = safeId(root.id, "$case.id");
  const revision = positiveInteger(root.revision, "$case.revision");
  const scope = nonEmptyText(root.scope, "$case.scope");
  const evidenceBoundary = nonEmptyText(
    root.evidenceBoundary,
    "$case.evidenceBoundary",
  );
  const project = parseProject(root.project);
  const target = parseTarget(root.target);
  const thresholds = parseThresholds(root.thresholds);
  const meshSizeMm = parseQuantityMm(root.meshSizeMm, "$case.meshSizeMm");
  const buildDirection = parseBuildDirection(
    root.buildDirection,
    "$case.buildDirection",
  );
  const provider = parseProvider(root.provider);
  const rawLimitations = nonEmptyArray(root.limitations, "$case.limitations");
  const limitations = rawLimitations.map((item, i) =>
    nonEmptyText(item, `$case.limitations[${i}]`)
  );
  rejectDuplicates(limitations, "$case.limitations");
  const provenance = parseProvenance(root.provenance);
  return deepFreeze({
    schemaVersion: PRINTABILITY_CHECK_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target,
    thresholds,
    meshSizeMm,
    buildDirection,
    provider,
    limitations,
    provenance,
  });
}

// --- private parsers -----------------------------------------------------------

function parseProject(value: unknown): PrintabilityCheckCase["project"] {
  const input = exactRecord(value, ["id", "subjectId"], "$case.project");
  return {
    id: safeId(input.id, "$case.project.id"),
    subjectId: safeId(input.subjectId, "$case.project.subjectId"),
  };
}

function parseTarget(value: unknown): PrintabilityCheckCase["target"] {
  const input = exactRecord(value, ["componentKey"], "$case.target");
  return {
    componentKey: safeId(input.componentKey, "$case.target.componentKey"),
  };
}

function parseThresholds(value: unknown): PrintabilityCheckCase["thresholds"] {
  const input = exactRecord(
    value,
    ["minWallThicknessMm", "maxOverhangAngleDeg", "maxUnsupportedAreaMm2"],
    "$case.thresholds",
  );
  return {
    minWallThicknessMm: parseQuantityMm(
      input.minWallThicknessMm,
      "$case.thresholds.minWallThicknessMm",
    ),
    maxOverhangAngleDeg: parseQuantityDeg(
      input.maxOverhangAngleDeg,
      "$case.thresholds.maxOverhangAngleDeg",
    ),
    maxUnsupportedAreaMm2: parseQuantityMm2(
      input.maxUnsupportedAreaMm2,
      "$case.thresholds.maxUnsupportedAreaMm2",
    ),
  };
}

function parseQuantityMm(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  const v = finite(input.value, `${path}.value`);
  if (v <= 0) throw new TypeError(`${path}.value must be positive.`);
  return { value: v, unit: "mm" };
}

function parseQuantityDeg(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "deg" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "deg", `${path}.unit`);
  const v = finite(input.value, `${path}.value`);
  if (v <= 0 || v >= 90) {
    throw new TypeError(`${path}.value must be in the open interval (0, 90) degrees.`);
  }
  return { value: v, unit: "deg" };
}

function parseQuantityMm2(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm2" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm2", `${path}.unit`);
  const v = finite(input.value, `${path}.value`);
  if (v <= 0) throw new TypeError(`${path}.value must be positive.`);
  return { value: v, unit: "mm2" };
}

function parseBuildDirection(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be an array of exactly 3 finite numbers.`);
  }
  const direction = [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ] as const;
  if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) {
    throw new TypeError(`${path} must not be the zero vector.`);
  }
  return direction;
}

function parseProvider(value: unknown): PrintabilityCheckCase["provider"] {
  const input = exactRecord(
    value,
    ["build123dTool", "thicknessTool", "overhangTool"],
    "$case.provider",
  );
  literalValue(input.build123dTool, "build123d_export", "$case.provider.build123dTool");
  literalValue(
    input.thicknessTool,
    "dfm_check_min_thickness",
    "$case.provider.thicknessTool",
  );
  literalValue(
    input.overhangTool,
    "dfm_check_overhangs",
    "$case.provider.overhangTool",
  );
  return {
    build123dTool: "build123d_export",
    thicknessTool: "dfm_check_min_thickness",
    overhangTool: "dfm_check_overhangs",
  };
}

function parseProvenance(value: unknown): PrintabilityCheckCase["provenance"] {
  const input = exactRecord(value, ["status", "note"], "$case.provenance");
  literalValue(input.status, "provisional", "$case.provenance.status");
  return {
    status: "provisional",
    note: nonEmptyText(input.note, "$case.provenance.note"),
  };
}
