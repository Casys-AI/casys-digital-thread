/**
 * Schema and pure-domain functions for measured DFM checks of a canonical
 * STEP artefact.
 *
 * Why this boundary exists: `industrialize.seal-dfm-case@1` seals a reviewed
 * case; `industrialize.run-dfm-checks@1` reopens that case and publishes
 * measured observations plus fail-closed evaluations. The case is the
 * normative authority. The executor never invents a build volume, a
 * thickness limit, an overhang angle, or a Z-min filter.
 *
 * Deviation from the mission brief's "STL" wording: live mcp-dfm 0.1.0
 * tools take `step_path` + `expected_step_sha256` (probes in the archived
 * qualification JSON). The existing printability observe path already binds
 * `model/step`. This schema therefore attests a STEP artefact. A `model/stl`
 * target is refused.
 *
 * This schema is not `printability-check-case/1.0`. That case remains the
 * documentary estimate path (`industrialize.observe-printability@1`) and is
 * not modified here.
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

export const INDUSTRIALIZE_SEAL_DFM_CASE_OPERATION = {
  id: "industrialize.seal-dfm-case",
  version: "1",
} as const;

export const INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION = {
  id: "industrialize.run-dfm-checks",
  version: "1",
} as const;

export const DFM_CHECK_CASE_SCHEMA = "dfm-check-case/1.0" as const;

export const DFM_TARGET_MEDIA_TYPE = "model/step" as const;

export const DFM_ENVELOPE_TOOL = "dfm_check_envelope" as const;
export const DFM_THICKNESS_TOOL = "dfm_check_min_thickness" as const;
export const DFM_OVERHANG_TOOL = "dfm_check_overhangs" as const;

const THREAD_ARTIFACT_URI = /^thread-artifact:\/\/[A-Za-z0-9_\-/]+$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

export type DfmCheckName = "envelope" | "min-thickness" | "overhangs";

export interface DfmCheckCase {
  readonly schemaVersion: typeof DFM_CHECK_CASE_SCHEMA;
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
    /** Thread artefact URI of the exact canonical STEP. */
    readonly artifactUri: string;
    /** SHA-256 of the exact STEP bytes. Required; the provider re-checks it. */
    readonly sha256: string;
    readonly mediaType: typeof DFM_TARGET_MEDIA_TYPE;
  };
  readonly buildVolumeMm: {
    readonly x: { readonly value: number; readonly unit: "mm" };
    readonly y: { readonly value: number; readonly unit: "mm" };
    readonly z: { readonly value: number; readonly unit: "mm" };
  };
  readonly minThicknessMm: { readonly value: number; readonly unit: "mm" };
  readonly maxOverhangAngleDeg: { readonly value: number; readonly unit: "deg" };
  readonly meshSizeMm: { readonly value: number; readonly unit: "mm" };
  readonly buildDirection: readonly [number, number, number];
  /**
   * Declared bed-contact filter. mcp-dfm always reports the bottommost face
   * as an overhang. The executor applies this signed filter; it must not
   * invent a min-Z heuristic of its own.
   */
  readonly zMinFilter: {
    readonly enabled: boolean;
    readonly planeZMm: { readonly value: number; readonly unit: "mm" };
    readonly toleranceMm: { readonly value: number; readonly unit: "mm" };
  };
  readonly provider: {
    readonly envelopeTool: typeof DFM_ENVELOPE_TOOL;
    readonly thicknessTool: typeof DFM_THICKNESS_TOOL;
    readonly overhangTool: typeof DFM_OVERHANG_TOOL;
  };
  readonly limitations: readonly string[];
  readonly provenance: {
    readonly status: "provisional";
    readonly note: string;
  };
}

export interface DfmOverhangZone {
  readonly area_mm2: number;
  readonly centroid_mm: readonly [number, number, number];
}

export interface DfmZMinFilteredZone {
  readonly zone: DfmOverhangZone;
  readonly reason: "z-min-bed-contact";
  readonly centroidZMm: number;
}

export interface DfmZMinFilterTrace {
  readonly declared: DfmCheckCase["zMinFilter"];
  readonly applied: boolean;
  readonly filtered: readonly DfmZMinFilteredZone[];
  readonly remaining: readonly DfmOverhangZone[];
}

export interface DfmNamedViolation {
  readonly name: string;
  readonly check: DfmCheckName;
  readonly summary: string;
}

export interface DfmCheckVerdict {
  readonly check: DfmCheckName;
  readonly status: "pass" | "fail";
  readonly violations: readonly DfmNamedViolation[];
}

export interface DfmEnvelopeAxisViolation {
  readonly axis: "x" | "y" | "z";
  readonly measured_mm: number;
  readonly limit_mm: number;
}

export interface DfmMeasuredCheckInput {
  readonly dfmCase: DfmCheckCase;
  readonly envelope: {
    readonly measured: {
      readonly x_mm: number;
      readonly y_mm: number;
      readonly z_mm: number;
    };
    readonly providerViolations: readonly DfmEnvelopeAxisViolation[];
  };
  readonly thickness: {
    readonly minThicknessMm: number;
    readonly providerViolationCount: number;
  };
  readonly overhangs: {
    readonly zones: readonly DfmOverhangZone[];
  };
}

export interface DfmMeasuredCheckResult {
  readonly zMinTrace: DfmZMinFilterTrace;
  readonly verdicts: readonly DfmCheckVerdict[];
  readonly status: "pass" | "fail";
}

const ROOT_KEYS = [
  "schemaVersion",
  "id",
  "revision",
  "scope",
  "evidenceBoundary",
  "project",
  "target",
  "buildVolumeMm",
  "minThicknessMm",
  "maxOverhangAngleDeg",
  "meshSizeMm",
  "buildDirection",
  "zMinFilter",
  "provider",
  "limitations",
  "provenance",
] as const;

/** Parse a `thread-artifact://<project-id>/<artifact-id>` target URI. */
export function parseDfmTargetArtifactUri(
  artifactUri: string,
): { readonly projectId: string; readonly artifactId: string } {
  if (!THREAD_ARTIFACT_URI.test(artifactUri)) {
    throw new TypeError(
      "$case.target.artifactUri must be a thread-artifact:// URI.",
    );
  }
  const rest = artifactUri.slice("thread-artifact://".length);
  const slash = rest.indexOf("/");
  if (slash <= 0 || slash === rest.length - 1) {
    throw new TypeError(
      "$case.target.artifactUri must be thread-artifact://<project-id>/<artifact-id>.",
    );
  }
  return {
    projectId: rest.slice(0, slash),
    artifactId: rest.slice(slash + 1),
  };
}

/** Parse and validate an untrusted value as a dfm-check-case/1.0 case. */
export function validateDfmCheckCase(value: unknown): DfmCheckCase {
  const root = exactRecord(value, ROOT_KEYS, "$case");
  literalValue(root.schemaVersion, DFM_CHECK_CASE_SCHEMA, "$case.schemaVersion");
  const id = safeId(root.id, "$case.id");
  const revision = positiveInteger(root.revision, "$case.revision");
  const scope = nonEmptyText(root.scope, "$case.scope");
  const evidenceBoundary = nonEmptyText(
    root.evidenceBoundary,
    "$case.evidenceBoundary",
  );
  const project = parseProject(root.project);
  const target = parseTarget(root.target);
  const buildVolumeMm = parseBuildVolume(root.buildVolumeMm);
  const minThicknessMm = parseQuantityMm(root.minThicknessMm, "$case.minThicknessMm");
  const maxOverhangAngleDeg = parseQuantityDeg(
    root.maxOverhangAngleDeg,
    "$case.maxOverhangAngleDeg",
  );
  const meshSizeMm = parseQuantityMm(root.meshSizeMm, "$case.meshSizeMm");
  const buildDirection = parseBuildDirection(
    root.buildDirection,
    "$case.buildDirection",
  );
  const zMinFilter = parseZMinFilter(root.zMinFilter);
  const provider = parseProvider(root.provider);
  const limitations = nonEmptyArray(root.limitations, "$case.limitations").map(
    (item, i) => nonEmptyText(item, `$case.limitations[${i}]`),
  );
  rejectDuplicates(limitations, "$case.limitations");
  const provenance = parseProvenance(root.provenance);
  return deepFreeze({
    schemaVersion: DFM_CHECK_CASE_SCHEMA,
    id,
    revision,
    scope,
    evidenceBoundary,
    project,
    target,
    buildVolumeMm,
    minThicknessMm,
    maxOverhangAngleDeg,
    meshSizeMm,
    buildDirection,
    zMinFilter,
    provider,
    limitations,
    provenance,
  });
}

/**
 * Fail-closed SHA-256 attestation. Used by the case validator and by the
 * executor when the provider echoes `input_artifact.sha256`.
 */
export function assertSha256Attestation(
  expected: string,
  observed: string,
  path: string,
): void {
  if (!SHA256_HEX.test(expected)) {
    throw new TypeError(
      `${path} expected digest must be a lowercase 64-character hex SHA-256.`,
    );
  }
  if (!SHA256_HEX.test(observed)) {
    throw new TypeError(
      `${path} observed digest must be a lowercase 64-character hex SHA-256.`,
    );
  }
  if (expected !== observed) {
    throw new TypeError(
      `${path} SHA-256 mismatch: expected ${expected}, observed ${observed}.`,
    );
  }
}

/**
 * Apply the signed Z-min filter. When `enabled` is false the zones pass
 * through unchanged and the trace records `applied: false`. The executor
 * must not invent a min-Z from the mesh.
 */
export function applyDeclaredZMinFilter(
  zones: readonly DfmOverhangZone[],
  filter: DfmCheckCase["zMinFilter"],
): DfmZMinFilterTrace {
  if (!filter.enabled) {
    return {
      declared: filter,
      applied: false,
      filtered: [],
      remaining: zones.map(cloneZone),
    };
  }
  const filtered: DfmZMinFilteredZone[] = [];
  const remaining: DfmOverhangZone[] = [];
  for (const zone of zones) {
    const centroidZMm = zone.centroid_mm[2];
    if (Math.abs(centroidZMm - filter.planeZMm.value) <= filter.toleranceMm.value) {
      filtered.push({
        zone: cloneZone(zone),
        reason: "z-min-bed-contact",
        centroidZMm,
      });
    } else {
      remaining.push(cloneZone(zone));
    }
  }
  return {
    declared: filter,
    applied: true,
    filtered,
    remaining,
  };
}

/** Compare measured provider results to the sealed case. A fail is publishable. */
export function evaluateMeasuredDfmChecks(
  input: DfmMeasuredCheckInput,
): DfmMeasuredCheckResult {
  const zMinTrace = applyDeclaredZMinFilter(
    input.overhangs.zones,
    input.dfmCase.zMinFilter,
  );
  const verdicts = [
    evaluateDfmEnvelopeCheck({
      measured: input.envelope.measured,
      buildVolumeMm: {
        x: input.dfmCase.buildVolumeMm.x.value,
        y: input.dfmCase.buildVolumeMm.y.value,
        z: input.dfmCase.buildVolumeMm.z.value,
      },
      providerViolations: input.envelope.providerViolations,
    }),
    evaluateDfmThicknessCheck({
      minThicknessMm: input.thickness.minThicknessMm,
      limitMm: input.dfmCase.minThicknessMm.value,
      providerViolationCount: input.thickness.providerViolationCount,
    }),
    evaluateDfmOverhangsCheck({ remaining: zMinTrace.remaining }),
  ];
  return {
    zMinTrace,
    verdicts,
    status: verdicts.every((verdict) => verdict.status === "pass") ? "pass" : "fail",
  };
}

export function evaluateDfmEnvelopeCheck(input: {
  readonly measured: {
    readonly x_mm: number;
    readonly y_mm: number;
    readonly z_mm: number;
  };
  readonly buildVolumeMm: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly providerViolations: readonly DfmEnvelopeAxisViolation[];
}): DfmCheckVerdict {
  const violations: DfmNamedViolation[] = [];
  const seen = new Set<DfmEnvelopeAxisViolation["axis"]>();
  for (const axis of ["x", "y", "z"] as const) {
    const measured = input.measured[`${axis}_mm`];
    const limit = input.buildVolumeMm[axis];
    if (measured > limit) {
      seen.add(axis);
      violations.push({
        name: `envelope-axis-${axis}-exceeds-build-volume`,
        check: "envelope",
        summary:
          `Measured ${axis} extent ${measured} mm exceeds the declared build volume ` +
          `${limit} mm.`,
      });
    }
  }
  for (const item of input.providerViolations) {
    if (seen.has(item.axis)) continue;
    seen.add(item.axis);
    violations.push({
      name: `envelope-axis-${item.axis}-exceeds-build-volume`,
      check: "envelope",
      summary: `Provider declared ${item.axis} ${item.measured_mm} mm against limit ` +
        `${item.limit_mm} mm.`,
    });
  }
  return {
    check: "envelope",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
  };
}

export function evaluateDfmThicknessCheck(input: {
  readonly minThicknessMm: number;
  readonly limitMm: number;
  readonly providerViolationCount: number;
}): DfmCheckVerdict {
  const violations: DfmNamedViolation[] = [];
  if (input.minThicknessMm < input.limitMm) {
    violations.push({
      name: "min-thickness-below-declared-limit",
      check: "min-thickness",
      summary: `Measured minimum thickness ${input.minThicknessMm} mm is below the ` +
        `declared limit ${input.limitMm} mm.`,
    });
  } else if (input.providerViolationCount > 0) {
    violations.push({
      name: "min-thickness-violation-zones-declared",
      check: "min-thickness",
      summary:
        `Provider reported ${input.providerViolationCount} thickness violation ` +
        `zone(s) against the declared limit ${input.limitMm} mm.`,
    });
  }
  return {
    check: "min-thickness",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
  };
}

export function evaluateDfmOverhangsCheck(input: {
  readonly remaining: readonly DfmOverhangZone[];
}): DfmCheckVerdict {
  const violations = input.remaining.map((zone, index) => ({
    name: `overhang-zone-${index}-requires-support`,
    check: "overhangs" as const,
    summary: `Overhang zone ${index} of ${zone.area_mm2} mm2 at centroid ` +
      `[${zone.centroid_mm.join(", ")}] remains after the declared Z-min filter.`,
  }));
  return {
    check: "overhangs",
    status: violations.length === 0 ? "pass" : "fail",
    violations,
  };
}

function parseProject(value: unknown): DfmCheckCase["project"] {
  const input = exactRecord(value, ["id", "subjectId"], "$case.project");
  return {
    id: safeId(input.id, "$case.project.id"),
    subjectId: safeId(input.subjectId, "$case.project.subjectId"),
  };
}

function parseTarget(value: unknown): DfmCheckCase["target"] {
  const input = exactRecord(
    value,
    ["componentKey", "artifactUri", "sha256", "mediaType"],
    "$case.target",
  );
  const artifactUri = nonEmptyText(input.artifactUri, "$case.target.artifactUri");
  parseDfmTargetArtifactUri(artifactUri);
  const sha256 = nonEmptyText(input.sha256, "$case.target.sha256");
  if (!SHA256_HEX.test(sha256)) {
    throw new TypeError(
      "$case.target.sha256 must be a lowercase 64-character hex SHA-256 digest.",
    );
  }
  literalValue(input.mediaType, DFM_TARGET_MEDIA_TYPE, "$case.target.mediaType");
  return {
    componentKey: safeId(input.componentKey, "$case.target.componentKey"),
    artifactUri,
    sha256,
    mediaType: DFM_TARGET_MEDIA_TYPE,
  };
}

function parseBuildVolume(value: unknown): DfmCheckCase["buildVolumeMm"] {
  const input = exactRecord(value, ["x", "y", "z"], "$case.buildVolumeMm");
  return {
    x: parseQuantityMm(input.x, "$case.buildVolumeMm.x"),
    y: parseQuantityMm(input.y, "$case.buildVolumeMm.y"),
    z: parseQuantityMm(input.z, "$case.buildVolumeMm.z"),
  };
}

function parseZMinFilter(value: unknown): DfmCheckCase["zMinFilter"] {
  const input = exactRecord(
    value,
    ["enabled", "planeZMm", "toleranceMm"],
    "$case.zMinFilter",
  );
  if (typeof input.enabled !== "boolean") {
    throw new TypeError("$case.zMinFilter.enabled must be a boolean.");
  }
  const planeZMm = parseSignedQuantityMm(
    input.planeZMm,
    "$case.zMinFilter.planeZMm",
  );
  const toleranceMm = parseNonNegativeQuantityMm(
    input.toleranceMm,
    "$case.zMinFilter.toleranceMm",
  );
  return {
    enabled: input.enabled,
    planeZMm,
    toleranceMm,
  };
}

function parseProvider(value: unknown): DfmCheckCase["provider"] {
  const input = exactRecord(
    value,
    ["envelopeTool", "thicknessTool", "overhangTool"],
    "$case.provider",
  );
  literalValue(input.envelopeTool, DFM_ENVELOPE_TOOL, "$case.provider.envelopeTool");
  literalValue(
    input.thicknessTool,
    DFM_THICKNESS_TOOL,
    "$case.provider.thicknessTool",
  );
  literalValue(input.overhangTool, DFM_OVERHANG_TOOL, "$case.provider.overhangTool");
  return {
    envelopeTool: DFM_ENVELOPE_TOOL,
    thicknessTool: DFM_THICKNESS_TOOL,
    overhangTool: DFM_OVERHANG_TOOL,
  };
}

function parseProvenance(value: unknown): DfmCheckCase["provenance"] {
  const input = exactRecord(value, ["status", "note"], "$case.provenance");
  literalValue(input.status, "provisional", "$case.provenance.status");
  return {
    status: "provisional",
    note: nonEmptyText(input.note, "$case.provenance.note"),
  };
}

function parseQuantityMm(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  const parsed = finite(input.value, `${path}.value`);
  if (parsed <= 0) throw new TypeError(`${path}.value must be positive.`);
  return { value: parsed, unit: "mm" };
}

function parseSignedQuantityMm(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  return { value: finite(input.value, `${path}.value`), unit: "mm" };
}

function parseNonNegativeQuantityMm(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  const parsed = finite(input.value, `${path}.value`);
  if (parsed < 0) throw new TypeError(`${path}.value must be non-negative.`);
  return { value: parsed, unit: "mm" };
}

function parseQuantityDeg(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "deg" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "deg", `${path}.unit`);
  const parsed = finite(input.value, `${path}.value`);
  if (parsed <= 0 || parsed >= 90) {
    throw new TypeError(`${path}.value must be in the open interval (0, 90) degrees.`);
  }
  return { value: parsed, unit: "deg" };
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

function cloneZone(zone: DfmOverhangZone): DfmOverhangZone {
  return {
    area_mm2: zone.area_mm2,
    centroid_mm: [zone.centroid_mm[0], zone.centroid_mm[1], zone.centroid_mm[2]],
  };
}
