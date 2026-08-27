/**
 * Measured-check capture for industrialize.run-dfm-checks@1.
 *
 * Records attested envelope, thickness and overhang results from mcp-dfm,
 * the declared Z-min filter trace, and fail-closed named evaluations.
 * A check fail is publishable.
 */

import {
  applyDeclaredZMinFilter,
  assertSha256Attestation,
  DFM_ENVELOPE_TOOL,
  DFM_OVERHANG_TOOL,
  DFM_TARGET_MEDIA_TYPE,
  DFM_THICKNESS_TOOL,
  type DfmCheckCase,
  type DfmCheckVerdict,
  type DfmEnvelopeAxisViolation,
  type DfmNamedViolation,
  type DfmOverhangZone,
  type DfmZMinFilterTrace,
  evaluateDfmEnvelopeCheck,
  evaluateDfmOverhangsCheck,
  evaluateDfmThicknessCheck,
  INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
} from "../../../domain/make/dfm/dfm-case.ts";
import {
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

export const DFM_CHECK_CAPTURE_SCHEMA = "dfm-check-capture/1.0" as const;

export const DFM_CHECK_CAPTURE_URI_PREFIX =
  "casys://dfm-check-capture/sha256/" as const;

export interface DfmEnvelopeResult {
  readonly measured: {
    readonly xMm: number;
    readonly yMm: number;
    readonly zMm: number;
    readonly volumeMm3: number;
  };
  readonly violations: readonly DfmEnvelopeAxisViolation[];
  readonly notChecked: readonly string[];
  readonly inputArtifactSha256: string;
}

export interface DfmThicknessResult {
  readonly measured: {
    readonly minThicknessMm: number;
    readonly minPositionMm: readonly [number, number, number];
    readonly sampleCount: number;
    readonly validRayCount: number;
  };
  readonly violations: readonly DfmOverhangZone[];
  readonly notChecked: readonly string[];
  readonly inputArtifactSha256: string;
}

export interface DfmOverhangResult {
  readonly measured: {
    readonly totalSurfaceAreaMm2: number;
    readonly overhangAreaMm2: number;
    readonly overhangTriangleCount: number;
    readonly totalTriangleCount: number;
  };
  readonly violations: readonly DfmOverhangZone[];
  readonly notChecked: readonly string[];
  readonly inputArtifactSha256: string;
}

export interface DfmPersistedZMinFilter {
  readonly declared: DfmCheckCase["zMinFilter"];
  readonly applied: boolean;
  readonly filtered: readonly {
    readonly area_mm2: number;
    readonly centroid_mm: readonly [number, number, number];
    readonly reason: "z-min-bed-contact";
    readonly centroidZMm: number;
  }[];
  readonly remaining: readonly DfmOverhangZone[];
}

export interface DfmCheckEvaluations {
  readonly status: "pass" | "fail";
  readonly verdicts: readonly DfmCheckVerdict[];
}

export interface DfmCheckCapture {
  readonly schemaVersion: typeof DFM_CHECK_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id;
    readonly version: typeof INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly dispatchedAt: string;
  readonly capturedAt: string;
  readonly caseDigest: string;
  readonly geometry: {
    readonly artifactId: string;
    readonly sha256: string;
    readonly byteCount: number;
    readonly mediaType: typeof DFM_TARGET_MEDIA_TYPE;
    readonly stagedPath: string;
  };
  readonly providerCallParams: {
    readonly expectedStepSha256: string;
    readonly buildVolumeMm: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };
    readonly minThicknessMm: number;
    readonly maxOverhangDeg: number;
    readonly meshSizeMm: number;
    readonly buildDirection: readonly [number, number, number];
  };
  readonly zMinFilter: DfmPersistedZMinFilter;
  readonly envelope: {
    readonly tool: typeof DFM_ENVELOPE_TOOL;
    readonly measured: DfmEnvelopeResult["measured"];
    readonly violations: readonly DfmEnvelopeAxisViolation[];
    readonly notChecked: readonly string[];
    readonly inputArtifactSha256: string;
  };
  readonly thickness: {
    readonly tool: typeof DFM_THICKNESS_TOOL;
    readonly measured: DfmThicknessResult["measured"];
    readonly violations: readonly DfmOverhangZone[];
    readonly notChecked: readonly string[];
    readonly inputArtifactSha256: string;
  };
  readonly overhang: {
    readonly tool: typeof DFM_OVERHANG_TOOL;
    readonly measured: DfmOverhangResult["measured"];
    readonly violations: readonly DfmOverhangZone[];
    readonly notChecked: readonly string[];
    readonly inputArtifactSha256: string;
  };
  readonly evaluations: DfmCheckEvaluations;
  readonly limitations: readonly string[];
}

export function parseDfmEnvelopeResult(
  value: unknown,
  expectedSha256: string,
  expectedBuildVolumeMm: { readonly x: number; readonly y: number; readonly z: number },
): DfmEnvelopeResult {
  const root = requireObject(value, "dfm_check_envelope structuredContent");
  if (!Array.isArray(root.violations)) {
    throw new Error("dfm_check_envelope violations must be an array.");
  }
  const violations = root.violations.map((item, i) =>
    parseEnvelopeAxisViolation(item, `dfm_check_envelope violations[${i}]`)
  );
  const measuredRoot = requireObject(root.measured, "dfm_check_envelope measured");
  const limits = requireObject(
    root.limits_declared,
    "dfm_check_envelope limits_declared",
  );
  const volume = requireObject(
    limits.build_volume_mm,
    "dfm_check_envelope limits_declared.build_volume_mm",
  );
  if (
    finite(volume.x, "dfm_check_envelope limits_declared.build_volume_mm.x") !==
      expectedBuildVolumeMm.x ||
    finite(volume.y, "dfm_check_envelope limits_declared.build_volume_mm.y") !==
      expectedBuildVolumeMm.y ||
    finite(volume.z, "dfm_check_envelope limits_declared.build_volume_mm.z") !==
      expectedBuildVolumeMm.z
  ) {
    throw new Error("dfm_check_envelope declared a different build volume.");
  }
  if (!Array.isArray(root.not_checked)) {
    throw new Error("dfm_check_envelope not_checked must be an array.");
  }
  const inputSha256 = requireSha256Hex(
    requireObject(root.input_artifact, "dfm_check_envelope input_artifact").sha256,
    "dfm_check_envelope input_artifact.sha256",
  );
  assertSha256Attestation(
    expectedSha256,
    inputSha256,
    "dfm_check_envelope.input_artifact.sha256",
  );
  return {
    measured: {
      xMm: requireNonNegative(measuredRoot.x_mm, "dfm_check_envelope measured.x_mm"),
      yMm: requireNonNegative(measuredRoot.y_mm, "dfm_check_envelope measured.y_mm"),
      zMm: requireNonNegative(measuredRoot.z_mm, "dfm_check_envelope measured.z_mm"),
      volumeMm3: requireNonNegative(
        measuredRoot.volume_mm3,
        "dfm_check_envelope measured.volume_mm3",
      ),
    },
    violations,
    notChecked: parseStringArray(root.not_checked, "dfm_check_envelope not_checked"),
    inputArtifactSha256: inputSha256,
  };
}

export function parseDfmThicknessResult(
  value: unknown,
  expectedSha256: string,
  expectedMinThicknessMm: number,
): DfmThicknessResult {
  const root = requireObject(value, "dfm_check_min_thickness structuredContent");
  if (!Array.isArray(root.violations)) {
    throw new Error("dfm_check_min_thickness violations must be an array.");
  }
  const violations = root.violations.map((item, i) =>
    persistZone(item, `dfm_check_min_thickness violations[${i}]`)
  );
  const measuredRoot = requireObject(root.measured, "dfm_check_min_thickness measured");
  const rawPos = measuredRoot.min_position_mm;
  if (!Array.isArray(rawPos) || rawPos.length !== 3) {
    throw new TypeError(
      "dfm_check_min_thickness measured.min_position_mm must be a 3-element array.",
    );
  }
  const sampleCount = requireNonNegativeInt(
    measuredRoot.sample_count,
    "dfm_check_min_thickness measured.sample_count",
  );
  const validRayCount = requireNonNegativeInt(
    measuredRoot.valid_ray_count,
    "dfm_check_min_thickness measured.valid_ray_count",
  );
  if (validRayCount > sampleCount) {
    throw new Error("capture thickness validRayCount must not exceed sampleCount.");
  }
  const limits = requireObject(
    root.limits_declared,
    "dfm_check_min_thickness limits_declared",
  );
  if (
    finite(
      limits.min_thickness_mm,
      "dfm_check_min_thickness limits_declared.min_thickness_mm",
    ) !== expectedMinThicknessMm
  ) {
    throw new Error("dfm_check_min_thickness declared a different threshold.");
  }
  if (!Array.isArray(root.not_checked)) {
    throw new Error("dfm_check_min_thickness not_checked must be an array.");
  }
  const inputSha256 = requireSha256Hex(
    requireObject(root.input_artifact, "dfm_check_min_thickness input_artifact")
      .sha256,
    "dfm_check_min_thickness input_artifact.sha256",
  );
  assertSha256Attestation(
    expectedSha256,
    inputSha256,
    "dfm_check_min_thickness.input_artifact.sha256",
  );
  return {
    measured: {
      minThicknessMm: requireNonNegative(
        measuredRoot.min_thickness_mm,
        "dfm_check_min_thickness measured.min_thickness_mm",
      ),
      minPositionMm: [
        finite(rawPos[0], "dfm_check_min_thickness measured.min_position_mm[0]"),
        finite(rawPos[1], "dfm_check_min_thickness measured.min_position_mm[1]"),
        finite(rawPos[2], "dfm_check_min_thickness measured.min_position_mm[2]"),
      ],
      sampleCount,
      validRayCount,
    },
    violations,
    notChecked: parseStringArray(
      root.not_checked,
      "dfm_check_min_thickness not_checked",
    ),
    inputArtifactSha256: inputSha256,
  };
}

export function parseDfmOverhangResult(
  value: unknown,
  expectedSha256: string,
  expectedMaxOverhangDeg: number,
): DfmOverhangResult {
  const root = requireObject(value, "dfm_check_overhangs structuredContent");
  if (!Array.isArray(root.violations)) {
    throw new Error("dfm_check_overhangs violations must be an array.");
  }
  const violations = root.violations.map((item, i) =>
    persistZone(item, `dfm_check_overhangs violations[${i}]`)
  );
  const measuredRoot = requireObject(root.measured, "dfm_check_overhangs measured");
  const totalSurfaceAreaMm2 = requireNonNegative(
    measuredRoot.total_surface_area_mm2,
    "dfm_check_overhangs measured.total_surface_area_mm2",
  );
  const overhangAreaMm2 = requireNonNegative(
    measuredRoot.overhang_area_mm2,
    "dfm_check_overhangs measured.overhang_area_mm2",
  );
  if (overhangAreaMm2 > totalSurfaceAreaMm2) {
    throw new Error("capture overhangAreaMm2 must not exceed totalSurfaceAreaMm2.");
  }
  const overhangTriangleCount = requireNonNegativeInt(
    measuredRoot.overhang_triangle_count,
    "dfm_check_overhangs measured.overhang_triangle_count",
  );
  const totalTriangleCount = requireNonNegativeInt(
    measuredRoot.total_triangle_count,
    "dfm_check_overhangs measured.total_triangle_count",
  );
  if (overhangTriangleCount > totalTriangleCount) {
    throw new Error(
      "capture overhangTriangleCount must not exceed totalTriangleCount.",
    );
  }
  const limits = requireObject(
    root.limits_declared,
    "dfm_check_overhangs limits_declared",
  );
  if (
    finite(
      limits.max_overhang_deg,
      "dfm_check_overhangs limits_declared.max_overhang_deg",
    ) !== expectedMaxOverhangDeg
  ) {
    throw new Error("dfm_check_overhangs declared a different threshold.");
  }
  if (!Array.isArray(root.not_checked)) {
    throw new Error("dfm_check_overhangs not_checked must be an array.");
  }
  const inputSha256 = requireSha256Hex(
    requireObject(root.input_artifact, "dfm_check_overhangs input_artifact").sha256,
    "dfm_check_overhangs input_artifact.sha256",
  );
  assertSha256Attestation(
    expectedSha256,
    inputSha256,
    "dfm_check_overhangs.input_artifact.sha256",
  );
  return {
    measured: {
      totalSurfaceAreaMm2,
      overhangAreaMm2,
      overhangTriangleCount,
      totalTriangleCount,
    },
    violations,
    notChecked: parseStringArray(root.not_checked, "dfm_check_overhangs not_checked"),
    inputArtifactSha256: inputSha256,
  };
}

export function persistZMinFilterTrace(
  trace: DfmZMinFilterTrace,
): DfmPersistedZMinFilter {
  return {
    declared: trace.declared,
    applied: trace.applied,
    filtered: trace.filtered.map((item) => ({
      area_mm2: item.zone.area_mm2,
      centroid_mm: item.zone.centroid_mm,
      reason: item.reason,
      centroidZMm: item.centroidZMm,
    })),
    remaining: trace.remaining,
  };
}

export function evaluateCapturedDfmChecks(input: {
  readonly zMinFilter: DfmCheckCase["zMinFilter"];
  readonly buildVolumeMm: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
  };
  readonly minThicknessMm: number;
  readonly envelope: DfmEnvelopeResult;
  readonly thickness: DfmThicknessResult;
  readonly overhang: DfmOverhangResult;
}): {
  readonly zMinTrace: DfmZMinFilterTrace;
  readonly evaluations: DfmCheckEvaluations;
} {
  const zMinTrace = applyDeclaredZMinFilter(
    input.overhang.violations,
    input.zMinFilter,
  );
  const verdicts = [
    evaluateDfmEnvelopeCheck({
      measured: {
        x_mm: input.envelope.measured.xMm,
        y_mm: input.envelope.measured.yMm,
        z_mm: input.envelope.measured.zMm,
      },
      buildVolumeMm: input.buildVolumeMm,
      providerViolations: input.envelope.violations,
    }),
    evaluateDfmThicknessCheck({
      minThicknessMm: input.thickness.measured.minThicknessMm,
      limitMm: input.minThicknessMm,
      providerViolationCount: input.thickness.violations.length,
    }),
    evaluateDfmOverhangsCheck({ remaining: zMinTrace.remaining }),
  ];
  return {
    zMinTrace,
    evaluations: {
      status: verdicts.every((item) => item.status === "pass") ? "pass" : "fail",
      verdicts,
    },
  };
}

export function validateDfmCheckCapture(value: unknown): DfmCheckCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "dispatchedAt",
    "capturedAt",
    "caseDigest",
    "geometry",
    "providerCallParams",
    "zMinFilter",
    "envelope",
    "thickness",
    "overhang",
    "evaluations",
    "limitations",
  ], "$dfmCheckCapture");
  literalValue(
    root.schemaVersion,
    DFM_CHECK_CAPTURE_SCHEMA,
    "$dfmCheckCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$dfmCheckCapture.operation",
  );
  literalValue(
    operation.id,
    INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.id,
    "$dfmCheckCapture.operation.id",
  );
  literalValue(
    operation.version,
    INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION.version,
    "$dfmCheckCapture.operation.version",
  );
  const geometry = exactRecord(
    root.geometry,
    ["artifactId", "sha256", "byteCount", "mediaType", "stagedPath"],
    "$dfmCheckCapture.geometry",
  );
  literalValue(geometry.mediaType, DFM_TARGET_MEDIA_TYPE, "$geometry.mediaType");
  const params = exactRecord(
    root.providerCallParams,
    [
      "expectedStepSha256",
      "buildVolumeMm",
      "minThicknessMm",
      "maxOverhangDeg",
      "meshSizeMm",
      "buildDirection",
    ],
    "$dfmCheckCapture.providerCallParams",
  );
  const buildVolumeMm = parsePersistedBuildVolume(
    params.buildVolumeMm,
    "$providerCallParams.buildVolumeMm",
  );
  const zMinFilter = parsePersistedZMinFilter(
    root.zMinFilter,
    "$dfmCheckCapture.zMinFilter",
  );
  const envelope = exactRecord(
    root.envelope,
    ["tool", "measured", "violations", "notChecked", "inputArtifactSha256"],
    "$dfmCheckCapture.envelope",
  );
  literalValue(envelope.tool, DFM_ENVELOPE_TOOL, "$envelope.tool");
  const thickness = exactRecord(
    root.thickness,
    ["tool", "measured", "violations", "notChecked", "inputArtifactSha256"],
    "$dfmCheckCapture.thickness",
  );
  literalValue(thickness.tool, DFM_THICKNESS_TOOL, "$thickness.tool");
  const overhang = exactRecord(
    root.overhang,
    ["tool", "measured", "violations", "notChecked", "inputArtifactSha256"],
    "$dfmCheckCapture.overhang",
  );
  literalValue(overhang.tool, DFM_OVERHANG_TOOL, "$overhang.tool");
  const geometrySha256 = requireSha256Hex(geometry.sha256, "$geometry.sha256");
  const expectedSha256 = requireSha256Hex(
    params.expectedStepSha256,
    "$providerCallParams.expectedStepSha256",
  );
  assertSha256Attestation(
    geometrySha256,
    expectedSha256,
    "$providerCallParams.expectedStepSha256",
  );
  const envelopeSha256 = requireSha256Hex(
    envelope.inputArtifactSha256,
    "$envelope.inputArtifactSha256",
  );
  const thicknessSha256 = requireSha256Hex(
    thickness.inputArtifactSha256,
    "$thickness.inputArtifactSha256",
  );
  const overhangSha256 = requireSha256Hex(
    overhang.inputArtifactSha256,
    "$overhang.inputArtifactSha256",
  );
  assertSha256Attestation(
    geometrySha256,
    envelopeSha256,
    "$envelope.inputArtifactSha256",
  );
  assertSha256Attestation(
    geometrySha256,
    thicknessSha256,
    "$thickness.inputArtifactSha256",
  );
  assertSha256Attestation(
    geometrySha256,
    overhangSha256,
    "$overhang.inputArtifactSha256",
  );
  const envelopeResult: DfmEnvelopeResult = {
    measured: parsePersistedEnvelopeMeasured(envelope.measured, "$envelope.measured"),
    violations: parsePersistedEnvelopeViolations(
      envelope.violations,
      "$envelope.violations",
    ),
    notChecked: parsePersistedNotChecked(envelope.notChecked, "$envelope.notChecked"),
    inputArtifactSha256: envelopeSha256,
  };
  const thicknessResult: DfmThicknessResult = {
    measured: parsePersistedThicknessMeasured(
      thickness.measured,
      "$thickness.measured",
    ),
    violations: parsePersistedZones(thickness.violations, "$thickness.violations"),
    notChecked: parsePersistedNotChecked(thickness.notChecked, "$thickness.notChecked"),
    inputArtifactSha256: thicknessSha256,
  };
  const overhangResult: DfmOverhangResult = {
    measured: parsePersistedOverhangMeasured(overhang.measured, "$overhang.measured"),
    violations: parsePersistedZones(overhang.violations, "$overhang.violations"),
    notChecked: parsePersistedNotChecked(overhang.notChecked, "$overhang.notChecked"),
    inputArtifactSha256: overhangSha256,
  };
  const recomputed = evaluateCapturedDfmChecks({
    zMinFilter: zMinFilter.declared,
    buildVolumeMm,
    minThicknessMm: finite(params.minThicknessMm, "$providerCallParams.minThicknessMm"),
    envelope: envelopeResult,
    thickness: thicknessResult,
    overhang: overhangResult,
  });
  const persistedEvaluations = parsePersistedEvaluations(
    root.evaluations,
    "$dfmCheckCapture.evaluations",
  );
  if (
    deterministicJson(persistedEvaluations) !==
      deterministicJson(recomputed.evaluations)
  ) {
    throw new TypeError(
      "$dfmCheckCapture.evaluations do not match the recomputed measured verdicts.",
    );
  }
  const recomputedFilter = persistZMinFilterTrace(recomputed.zMinTrace);
  if (deterministicJson(zMinFilter) !== deterministicJson(recomputedFilter)) {
    throw new TypeError(
      "$dfmCheckCapture.zMinFilter does not match the declared filter application.",
    );
  }
  const limitations = nonEmptyArray(
    root.limitations,
    "$dfmCheckCapture.limitations",
  ).map((item, i) => nonEmptyText(item, `$dfmCheckCapture.limitations[${i}]`));
  return {
    schemaVersion: DFM_CHECK_CAPTURE_SCHEMA,
    operation: INDUSTRIALIZE_RUN_DFM_CHECKS_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$dfmCheckCapture.trustedRunId"),
    dispatchedAt: nonEmptyText(root.dispatchedAt, "$dfmCheckCapture.dispatchedAt"),
    capturedAt: nonEmptyText(root.capturedAt, "$dfmCheckCapture.capturedAt"),
    caseDigest: requireSha256Hex(root.caseDigest, "$dfmCheckCapture.caseDigest"),
    geometry: {
      artifactId: safeId(geometry.artifactId, "$geometry.artifactId"),
      sha256: geometrySha256,
      byteCount: requirePositiveInt(geometry.byteCount, "$geometry.byteCount"),
      mediaType: DFM_TARGET_MEDIA_TYPE,
      stagedPath: nonEmptyText(geometry.stagedPath, "$geometry.stagedPath"),
    },
    providerCallParams: {
      expectedStepSha256: expectedSha256,
      buildVolumeMm,
      minThicknessMm: finite(
        params.minThicknessMm,
        "$providerCallParams.minThicknessMm",
      ),
      maxOverhangDeg: finite(
        params.maxOverhangDeg,
        "$providerCallParams.maxOverhangDeg",
      ),
      meshSizeMm: finite(params.meshSizeMm, "$providerCallParams.meshSizeMm"),
      buildDirection: requireFiniteTriple(
        params.buildDirection,
        "$providerCallParams.buildDirection",
      ),
    },
    zMinFilter,
    envelope: {
      tool: DFM_ENVELOPE_TOOL,
      measured: envelopeResult.measured,
      violations: envelopeResult.violations,
      notChecked: envelopeResult.notChecked,
      inputArtifactSha256: envelopeSha256,
    },
    thickness: {
      tool: DFM_THICKNESS_TOOL,
      measured: thicknessResult.measured,
      violations: thicknessResult.violations,
      notChecked: thicknessResult.notChecked,
      inputArtifactSha256: thicknessSha256,
    },
    overhang: {
      tool: DFM_OVERHANG_TOOL,
      measured: overhangResult.measured,
      violations: overhangResult.violations,
      notChecked: overhangResult.notChecked,
      inputArtifactSha256: overhangSha256,
    },
    evaluations: persistedEvaluations,
    limitations,
  };
}

export async function fingerprintDfmCheckCapture(
  capture: DfmCheckCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function canonicalDfmCheckCaptureText(capture: DfmCheckCapture): string {
  return deterministicJson(capture);
}

function parseEnvelopeAxisViolation(
  value: unknown,
  path: string,
): DfmEnvelopeAxisViolation {
  const item = requireObject(value, path);
  const axis = item.axis;
  if (axis !== "x" && axis !== "y" && axis !== "z") {
    throw new TypeError(`${path}.axis must be x, y or z.`);
  }
  return {
    axis,
    measured_mm: requireNonNegative(item.measured_mm, `${path}.measured_mm`),
    limit_mm: requireNonNegative(item.limit_mm, `${path}.limit_mm`),
  };
}

function persistZone(value: unknown, path: string): DfmOverhangZone {
  const zone = requireObject(value, path);
  return {
    area_mm2: requireNonNegative(zone.area_mm2, `${path}.area_mm2`),
    centroid_mm: requireFiniteTriple(zone.centroid_mm, `${path}.centroid_mm`),
  };
}

function parsePersistedBuildVolume(
  value: unknown,
  path: string,
): { readonly x: number; readonly y: number; readonly z: number } {
  const input = exactRecord(value, ["x", "y", "z"], path);
  return {
    x: requirePositive(input.x, `${path}.x`),
    y: requirePositive(input.y, `${path}.y`),
    z: requirePositive(input.z, `${path}.z`),
  };
}

function parsePersistedZMinFilter(
  value: unknown,
  path: string,
): DfmPersistedZMinFilter {
  const input = exactRecord(
    value,
    ["declared", "applied", "filtered", "remaining"],
    path,
  );
  const declared = exactRecord(
    input.declared,
    ["enabled", "planeZMm", "toleranceMm"],
    `${path}.declared`,
  );
  if (typeof declared.enabled !== "boolean") {
    throw new TypeError(`${path}.declared.enabled must be a boolean.`);
  }
  if (typeof input.applied !== "boolean") {
    throw new TypeError(`${path}.applied must be a boolean.`);
  }
  return {
    declared: {
      enabled: declared.enabled,
      planeZMm: parsePersistedSignedMm(declared.planeZMm, `${path}.declared.planeZMm`),
      toleranceMm: parsePersistedNonNegativeMm(
        declared.toleranceMm,
        `${path}.declared.toleranceMm`,
      ),
    },
    applied: input.applied,
    filtered: parsePersistedFilteredZones(input.filtered, `${path}.filtered`),
    remaining: parsePersistedZones(input.remaining, `${path}.remaining`),
  };
}

function parsePersistedFilteredZones(
  value: unknown,
  path: string,
): DfmPersistedZMinFilter["filtered"] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, i) => {
    const zone = exactRecord(
      item,
      ["area_mm2", "centroid_mm", "reason", "centroidZMm"],
      `${path}[${i}]`,
    );
    literalValue(zone.reason, "z-min-bed-contact", `${path}[${i}].reason`);
    return {
      area_mm2: requireNonNegative(zone.area_mm2, `${path}[${i}].area_mm2`),
      centroid_mm: requireFiniteTriple(zone.centroid_mm, `${path}[${i}].centroid_mm`),
      reason: "z-min-bed-contact" as const,
      centroidZMm: finite(zone.centroidZMm, `${path}[${i}].centroidZMm`),
    };
  });
}

function parsePersistedEnvelopeMeasured(
  value: unknown,
  path: string,
): DfmEnvelopeResult["measured"] {
  const measured = exactRecord(value, ["xMm", "yMm", "zMm", "volumeMm3"], path);
  return {
    xMm: requireNonNegative(measured.xMm, `${path}.xMm`),
    yMm: requireNonNegative(measured.yMm, `${path}.yMm`),
    zMm: requireNonNegative(measured.zMm, `${path}.zMm`),
    volumeMm3: requireNonNegative(measured.volumeMm3, `${path}.volumeMm3`),
  };
}

function parsePersistedEnvelopeViolations(
  value: unknown,
  path: string,
): readonly DfmEnvelopeAxisViolation[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, i) => {
    const rec = exactRecord(
      item,
      ["axis", "measured_mm", "limit_mm"],
      `${path}[${i}]`,
    );
    const axis = rec.axis;
    if (axis !== "x" && axis !== "y" && axis !== "z") {
      throw new TypeError(`${path}[${i}].axis must be x, y or z.`);
    }
    return {
      axis,
      measured_mm: requireNonNegative(rec.measured_mm, `${path}[${i}].measured_mm`),
      limit_mm: requireNonNegative(rec.limit_mm, `${path}[${i}].limit_mm`),
    };
  });
}

function parsePersistedThicknessMeasured(
  value: unknown,
  path: string,
): DfmThicknessResult["measured"] {
  const measured = exactRecord(value, [
    "minThicknessMm",
    "minPositionMm",
    "sampleCount",
    "validRayCount",
  ], path);
  const sampleCount = requireNonNegativeInt(
    measured.sampleCount,
    `${path}.sampleCount`,
  );
  const validRayCount = requireNonNegativeInt(
    measured.validRayCount,
    `${path}.validRayCount`,
  );
  if (validRayCount > sampleCount) {
    throw new Error("capture thickness validRayCount must not exceed sampleCount.");
  }
  return {
    minThicknessMm: requireNonNegative(
      measured.minThicknessMm,
      `${path}.minThicknessMm`,
    ),
    minPositionMm: requireFiniteTriple(measured.minPositionMm, `${path}.minPositionMm`),
    sampleCount,
    validRayCount,
  };
}

function parsePersistedOverhangMeasured(
  value: unknown,
  path: string,
): DfmOverhangResult["measured"] {
  const measured = exactRecord(value, [
    "totalSurfaceAreaMm2",
    "overhangAreaMm2",
    "overhangTriangleCount",
    "totalTriangleCount",
  ], path);
  const totalSurfaceAreaMm2 = requireNonNegative(
    measured.totalSurfaceAreaMm2,
    `${path}.totalSurfaceAreaMm2`,
  );
  const overhangAreaMm2 = requireNonNegative(
    measured.overhangAreaMm2,
    `${path}.overhangAreaMm2`,
  );
  if (overhangAreaMm2 > totalSurfaceAreaMm2) {
    throw new Error("capture overhangAreaMm2 must not exceed totalSurfaceAreaMm2.");
  }
  const overhangTriangleCount = requireNonNegativeInt(
    measured.overhangTriangleCount,
    `${path}.overhangTriangleCount`,
  );
  const totalTriangleCount = requireNonNegativeInt(
    measured.totalTriangleCount,
    `${path}.totalTriangleCount`,
  );
  if (overhangTriangleCount > totalTriangleCount) {
    throw new Error(
      "capture overhangTriangleCount must not exceed totalTriangleCount.",
    );
  }
  return {
    totalSurfaceAreaMm2,
    overhangAreaMm2,
    overhangTriangleCount,
    totalTriangleCount,
  };
}

function parsePersistedZones(value: unknown, path: string): readonly DfmOverhangZone[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return value.map((item, i) => {
    const zone = exactRecord(item, ["area_mm2", "centroid_mm"], `${path}[${i}]`);
    return {
      area_mm2: requireNonNegative(zone.area_mm2, `${path}[${i}].area_mm2`),
      centroid_mm: requireFiniteTriple(zone.centroid_mm, `${path}[${i}].centroid_mm`),
    };
  });
}

function parsePersistedEvaluations(
  value: unknown,
  path: string,
): DfmCheckEvaluations {
  const input = exactRecord(value, ["status", "verdicts"], path);
  if (input.status !== "pass" && input.status !== "fail") {
    throw new TypeError(`${path}.status must be pass or fail.`);
  }
  if (!Array.isArray(input.verdicts)) {
    throw new TypeError(`${path}.verdicts must be an array.`);
  }
  const verdicts = input.verdicts.map((item, i) =>
    parsePersistedVerdict(item, `${path}.verdicts[${i}]`)
  );
  return { status: input.status, verdicts };
}

function parsePersistedVerdict(value: unknown, path: string): DfmCheckVerdict {
  const input = exactRecord(value, ["check", "status", "violations"], path);
  if (
    input.check !== "envelope" &&
    input.check !== "min-thickness" &&
    input.check !== "overhangs"
  ) {
    throw new TypeError(`${path}.check is not a measured DFM check.`);
  }
  if (input.status !== "pass" && input.status !== "fail") {
    throw new TypeError(`${path}.status must be pass or fail.`);
  }
  if (!Array.isArray(input.violations)) {
    throw new TypeError(`${path}.violations must be an array.`);
  }
  const violations = input.violations.map((item, i) =>
    parsePersistedNamedViolation(item, `${path}.violations[${i}]`)
  );
  return { check: input.check, status: input.status, violations };
}

function parsePersistedNamedViolation(
  value: unknown,
  path: string,
): DfmNamedViolation {
  const input = exactRecord(value, ["name", "check", "summary"], path);
  if (
    input.check !== "envelope" &&
    input.check !== "min-thickness" &&
    input.check !== "overhangs"
  ) {
    throw new TypeError(`${path}.check is not a measured DFM check.`);
  }
  return {
    name: nonEmptyText(input.name, `${path}.name`),
    check: input.check,
    summary: nonEmptyText(input.summary, `${path}.summary`),
  };
}

function parsePersistedNotChecked(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) throw new TypeError(`${path} must be an array.`);
  return parseStringArray(value, path);
}

function parsePersistedSignedMm(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  return { value: finite(input.value, `${path}.value`), unit: "mm" };
}

function parsePersistedNonNegativeMm(
  value: unknown,
  path: string,
): { readonly value: number; readonly unit: "mm" } {
  const input = exactRecord(value, ["value", "unit"], path);
  literalValue(input.unit, "mm", `${path}.unit`);
  return {
    value: requireNonNegative(input.value, `${path}.value`),
    unit: "mm",
  };
}

function parseStringArray(value: unknown[], path: string): readonly string[] {
  return value.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(`${path}[${i}] must be a string.`);
    }
    return item;
  });
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonNegative(value: unknown, path: string): number {
  const n = finite(value, path);
  if (n < 0) throw new TypeError(`${path} must be non-negative.`);
  return n;
}

function requirePositive(value: unknown, path: string): number {
  const n = finite(value, path);
  if (n <= 0) throw new TypeError(`${path} must be positive.`);
  return n;
}

function requireNonNegativeInt(value: unknown, path: string): number {
  const n = requireNonNegative(value, path);
  if (!Number.isSafeInteger(n)) throw new TypeError(`${path} must be an integer.`);
  return n;
}

function requirePositiveInt(value: unknown, path: string): number {
  const n = requireNonNegativeInt(value, path);
  if (n < 1) throw new TypeError(`${path} must be a positive integer.`);
  return n;
}

function requireFiniteTriple(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be a 3-element array.`);
  }
  return [
    finite(value[0], `${path}[0]`),
    finite(value[1], `${path}[1]`),
    finite(value[2], `${path}[2]`),
  ];
}

function requireSha256Hex(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a 64-character lowercase hex SHA-256 digest.`);
  }
  return value;
}
