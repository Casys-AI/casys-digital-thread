/**
 * Schema and pure-domain functions for FDM printability checks of build123d
 * geometry exported as STL.
 *
 * Why this boundary exists: the printability case is a reviewed configuration
 * file; the agent never supplies provider names, thresholds, or geometry. The
 * executor reads thresholds from the case; the CAD script comes from this
 * module. No verdict, no evaluation — only observations with units.
 *
 * Threshold provenance: the values in the reviewed case are declared as
 * PROVISIONAL candidates. They were chosen from typical FDM desktop-printer
 * guidelines, not from a specific printer datasheet. They are reviewed
 * candidates, not supplier specifications.
 */

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
  "provider",
  "limitations",
  "provenance",
] as const;

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

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
    provider,
    limitations,
    provenance,
  });
}

/**
 * Render the server-fixed DripTray isolation script for a printability STL
 * export.
 *
 * Pure and deterministic: the same output every time. The 30 mm height is the
 * reviewed R2 baseline (same geometry as the sensitivity study base point).
 * The agent never supplies this script — the server owns the geometry.
 */
export function renderDripTrayPrintabilityScript(): string {
  return [
    "from build123d import Align, Box",
    "",
    "result = Box(190, 135, 30, align=(Align.CENTER, Align.CENTER, Align.CENTER))",
  ].join("\n");
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

// --- primitive helpers ---------------------------------------------------------

function exactRecord(
  value: unknown,
  keys: readonly string[],
  path: string,
): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  const rec = value as Record<string, unknown>;
  const expectedSet = new Set(keys);
  for (const key of Object.keys(rec)) {
    if (!expectedSet.has(key)) {
      throw new TypeError(`${path} has unsupported field "${key}".`);
    }
  }
  for (const key of keys) {
    if (!Object.hasOwn(rec, key)) {
      throw new TypeError(`${path}.${key} is required.`);
    }
  }
  return rec;
}

function nonEmptyText(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new TypeError(`${path} must be a non-empty string without edge whitespace.`);
  }
  return value;
}

function safeId(value: unknown, path: string): string {
  const s = nonEmptyText(value, path);
  if (!SAFE_ID.test(s)) {
    throw new TypeError(`${path} must be a stable identifier (letters, digits, ._:-).`);
  }
  return s;
}

function finite(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(`${path} must be a finite number.`);
  }
  return value;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}

function literalValue(value: unknown, expected: unknown, path: string): void {
  if (value !== expected) {
    throw new TypeError(`${path} must equal ${JSON.stringify(expected)}.`);
  }
}

function nonEmptyArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  if (value.length === 0) throw new TypeError(`${path} must not be empty.`);
  return value;
}

function rejectDuplicates(values: readonly string[], path: string): void {
  if (new Set(values).size !== values.length) {
    throw new TypeError(`${path} must not contain duplicates.`);
  }
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}
