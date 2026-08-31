/**
 * Schema and pure-domain functions for FFF print-time-and-material estimates
 * of build123d geometry exported as STL via prusaslicer_estimate_fff.
 *
 * Why this boundary exists: the print-estimate case is a reviewed configuration
 * file; the agent never supplies provider names, profile parameters, geometry,
 * or density. The executor reads all values from the case; the profile content
 * comes from the committed INI file. No verdict, no evaluation, no pricing —
 * only observations with units. Project-specific CAD script renderers live
 * outside this generic schema.
 *
 * Profile provenance: the committed INI file at case.profile.repoPath is the
 * sole authority on print parameters. The server reads it, verifies its sha256
 * against case.profile.sha256, and embeds the content into the build123d
 * script via base64 so that the INI text is never interpreted as Python.
 *
 * Density provenance: the optional density field is omitted when unavailable.
 * When absent, the
 * executor omits the filament_density_g_cm3 override and filament_mass_g will
 * be absent from the capture record. When present, the executor passes it as
 * an explicit override to prusaslicer_estimate_fff and captures filament_mass_g
 * as a unitised observation.
 *
 * gcode_sha256 provenance: PrusaSlicer embeds a build timestamp in the G-code;
 * identical inputs on different dates produce different G-code hashes. The hash
 * is preserved for audit purposes only — it is not a deterministic attestation.
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

export const PRINT_ESTIMATE_CASE_SCHEMA = "print-estimate-case/1.0" as const;

// Stable public schema field, not a credential. Keep the scanner exception local
// to this exact declaration instead of weakening the repository-wide rules.
const FILAMENT_DENSITY_FIELD = "filamentDensityGCm3" as const; // gitleaks:allow
const FILAMENT_DENSITY_CASE_PATH = `$case.${FILAMENT_DENSITY_FIELD}`;

export interface PrintEstimateCase {
  readonly schemaVersion: typeof PRINT_ESTIMATE_CASE_SCHEMA;
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
  readonly profile: {
    /** Repo-relative path to the committed INI file. */
    readonly repoPath: string;
    /**
     * Base name (without extension) used when writing the profile to the
     * shared /exports volume. Written as /exports/<exportName>.ini.
     */
    readonly exportName: string;
    /** Expected SHA-256 of the committed INI file (hex, lowercase). */
    readonly sha256: string;
    readonly layerHeightMm: { readonly value: number; readonly unit: "mm" };
    readonly nozzleDiameterMm: { readonly value: number; readonly unit: "mm" };
    readonly material: string;
  };
  /**
   * Optional filament density. When present, the executor passes it as the
   * filament_density_g_cm3 override to prusaslicer_estimate_fff, and the
   * capture record will contain filament_mass_g.
   */
  readonly [FILAMENT_DENSITY_FIELD]?: {
    readonly value: number;
    readonly unit: "g/cm3";
  };
  readonly provider: {
    readonly build123dTool: "build123d_export";
    readonly prusaslicerTool: "prusaslicer_estimate_fff";
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
  "profile",
  "provider",
  "limitations",
  "provenance",
] as const;

const ROOT_KEYS_WITH_DENSITY = [
  ...ROOT_KEYS,
  FILAMENT_DENSITY_FIELD,
] as const;

/** Parse and validate an untrusted value as a print-estimate-case/1.0 case. */
export function validatePrintEstimateCase(value: unknown): PrintEstimateCase {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("$case must be an object.");
  }
  const rec = value as Record<string, unknown>;
  // Determine which root key set applies based on presence of optional fields.
  const hasDensity = Object.hasOwn(rec, FILAMENT_DENSITY_FIELD);
  const keys = hasDensity ? ROOT_KEYS_WITH_DENSITY : ROOT_KEYS;
  const root = exactRecord(value, keys, "$case");
  literalValue(
    root.schemaVersion,
    PRINT_ESTIMATE_CASE_SCHEMA,
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
  const profile = parseProfile(root.profile);
  const filamentDensity = hasDensity
    ? parseFilamentDensity(root[FILAMENT_DENSITY_FIELD])
    : undefined;
  const provider = parseProvider(root.provider);
  const rawLimitations = nonEmptyArray(root.limitations, "$case.limitations");
  const limitations = rawLimitations.map((item, i) =>
    nonEmptyText(item, `$case.limitations[${i}]`)
  );
  rejectDuplicates(limitations, "$case.limitations");
  const provenance = parseProvenance(root.provenance);
  const base = {
    schemaVersion: PRINT_ESTIMATE_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target,
    profile,
    provider,
    limitations,
    provenance,
  };
  return deepFreeze(
    filamentDensity !== undefined
      ? { ...base, [FILAMENT_DENSITY_FIELD]: filamentDensity }
      : base,
  );
}

// --- private parsers -----------------------------------------------------------

function parseProject(value: unknown): PrintEstimateCase["project"] {
  const input = exactRecord(value, ["id", "subjectId"], "$case.project");
  return {
    id: safeId(input.id, "$case.project.id"),
    subjectId: safeId(input.subjectId, "$case.project.subjectId"),
  };
}

function parseTarget(value: unknown): PrintEstimateCase["target"] {
  const input = exactRecord(value, ["componentKey"], "$case.target");
  return {
    componentKey: safeId(input.componentKey, "$case.target.componentKey"),
  };
}

function parseProfile(value: unknown): PrintEstimateCase["profile"] {
  const input = exactRecord(
    value,
    [
      "repoPath",
      "exportName",
      "sha256",
      "layerHeightMm",
      "nozzleDiameterMm",
      "material",
    ],
    "$case.profile",
  );
  const repoPath = nonEmptyText(input.repoPath, "$case.profile.repoPath");
  const exportName = nonEmptyText(input.exportName, "$case.profile.exportName");
  if (!/^[A-Za-z0-9._-]+$/.test(exportName)) {
    throw new TypeError(
      "$case.profile.exportName must contain only letters, digits, ._-.",
    );
  }
  const sha256 = requireSha256Hex(input.sha256, "$case.profile.sha256");
  const layerHeightMm = parseQuantityMm(
    input.layerHeightMm,
    "$case.profile.layerHeightMm",
  );
  const nozzleDiameterMm = parseQuantityMm(
    input.nozzleDiameterMm,
    "$case.profile.nozzleDiameterMm",
  );
  const material = nonEmptyText(input.material, "$case.profile.material");
  return { repoPath, exportName, sha256, layerHeightMm, nozzleDiameterMm, material };
}

function parseFilamentDensity(
  value: unknown,
): { readonly value: number; readonly unit: "g/cm3" } {
  const input = exactRecord(value, ["value", "unit"], FILAMENT_DENSITY_CASE_PATH);
  literalValue(input.unit, "g/cm3", `${FILAMENT_DENSITY_CASE_PATH}.unit`);
  const v = finite(input.value, `${FILAMENT_DENSITY_CASE_PATH}.value`);
  if (v <= 0) {
    throw new TypeError(`${FILAMENT_DENSITY_CASE_PATH}.value must be positive.`);
  }
  return { value: v, unit: "g/cm3" };
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

function parseProvider(value: unknown): PrintEstimateCase["provider"] {
  const input = exactRecord(
    value,
    ["build123dTool", "prusaslicerTool"],
    "$case.provider",
  );
  literalValue(input.build123dTool, "build123d_export", "$case.provider.build123dTool");
  literalValue(
    input.prusaslicerTool,
    "prusaslicer_estimate_fff",
    "$case.provider.prusaslicerTool",
  );
  return {
    build123dTool: "build123d_export",
    prusaslicerTool: "prusaslicer_estimate_fff",
  };
}

function parseProvenance(value: unknown): PrintEstimateCase["provenance"] {
  const input = exactRecord(value, ["status", "note"], "$case.provenance");
  literalValue(input.status, "provisional", "$case.provenance.status");
  return {
    status: "provisional",
    note: nonEmptyText(input.note, "$case.provenance.note"),
  };
}

const SHA256_HEX = /^[0-9a-f]{64}$/;

function requireSha256Hex(value: unknown, path: string): string {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    throw new TypeError(
      `${path} must be a 64-character lowercase hex SHA-256 digest.`,
    );
  }
  return value;
}
