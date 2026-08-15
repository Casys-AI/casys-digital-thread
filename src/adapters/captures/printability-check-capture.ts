/**
 * Observation capture for industrialize.observe-printability@1.
 *
 * Records attested DFM thickness and overhang measurements. Violations stay
 * inside this capture and are never promoted to Thread evaluations.
 */

import { INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION } from "../../domain/analysis/printability-proposal.ts";
import {
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  safeId,
} from "../../domain/kernel/case-validation.ts";
import {
  deterministicJson,
  sha256Fingerprint,
} from "../../domain/kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../domain/kernel/primitives.ts";

export const PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA =
  "printability-observation-capture/1.0" as const;

export const PRINTABILITY_OBSERVATION_CAPTURE_URI_PREFIX =
  "casys://printability-observation-capture/sha256/" as const;

export interface DfmViolationZone {
  readonly [key: string]: unknown;
}

export interface DfmThicknessResult {
  readonly measured: {
    readonly minThicknessMm: number;
    readonly minPositionMm: readonly [number, number, number];
    readonly sampleCount: number;
    readonly validRayCount: number;
  };
  readonly violations: readonly DfmViolationZone[];
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
  readonly violations: readonly DfmViolationZone[];
  readonly notChecked: readonly string[];
  readonly inputArtifactSha256: string;
}

export interface PrintabilityObservationCapture {
  readonly schemaVersion: typeof PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.id;
    readonly version: typeof INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly dispatchedAt: string;
  readonly capturedAt: string;
  readonly caseDigest: string;
  readonly geometry: {
    readonly artifactId: string;
    readonly sha256: string;
    readonly byteCount: number;
    readonly mediaType: "model/step" | "model/stl";
    readonly stagedPath: string;
  };
  readonly providerCallParams: {
    readonly meshSizeMm: number;
    readonly buildDirection: readonly [number, number, number];
    readonly minWallThicknessMm: number;
    readonly maxOverhangAngleDeg: number;
  };
  readonly reviewedCaseThresholds: {
    readonly maxUnsupportedAreaMm2: number;
  };
  readonly thickness: {
    readonly tool: "dfm_check_min_thickness";
    readonly measured: DfmThicknessResult["measured"];
    readonly violations: readonly DfmViolationZone[];
    readonly notChecked: readonly string[];
    readonly inputArtifactSha256: string;
  };
  readonly overhang: {
    readonly tool: "dfm_check_overhangs";
    readonly measured: DfmOverhangResult["measured"];
    readonly violations: readonly DfmViolationZone[];
    readonly notChecked: readonly string[];
    readonly inputArtifactSha256: string;
  };
  readonly limitations: readonly string[];
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
  const violations = root.violations.map((item, i) => {
    const zone = requireObject(item, `dfm_check_min_thickness violations[${i}]`);
    requireNonNegative(
      zone.area_mm2,
      `dfm_check_min_thickness violations[${i}].area_mm2`,
    );
    requireFiniteTriple(
      zone.centroid_mm,
      `dfm_check_min_thickness violations[${i}].centroid_mm`,
    );
    return zone;
  });
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
    ) !==
      expectedMinThicknessMm
  ) {
    throw new Error("dfm_check_min_thickness declared a different threshold.");
  }
  if (!Array.isArray(root.not_checked)) {
    throw new Error("dfm_check_min_thickness not_checked must be an array.");
  }
  const notChecked = root.not_checked.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(
        `dfm_check_min_thickness not_checked[${i}] must be a string.`,
      );
    }
    return item;
  });
  const inputSha256 = requireSha256Hex(
    requireObject(root.input_artifact, "dfm_check_min_thickness input_artifact").sha256,
    "dfm_check_min_thickness input_artifact.sha256",
  );
  if (inputSha256 !== expectedSha256) {
    throw new Error(
      `dfm_check_min_thickness input_artifact.sha256 mismatch: expected ${expectedSha256}, got ${inputSha256}.`,
    );
  }
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
    notChecked,
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
  const violations = root.violations.map((item, i) => {
    const zone = requireObject(item, `dfm_check_overhangs violations[${i}]`);
    requireNonNegative(zone.area_mm2, `dfm_check_overhangs violations[${i}].area_mm2`);
    requireFiniteTriple(
      zone.centroid_mm,
      `dfm_check_overhangs violations[${i}].centroid_mm`,
    );
    return zone;
  });
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
    ) !==
      expectedMaxOverhangDeg
  ) {
    throw new Error("dfm_check_overhangs declared a different threshold.");
  }
  if (!Array.isArray(root.not_checked)) {
    throw new Error("dfm_check_overhangs not_checked must be an array.");
  }
  const notChecked = root.not_checked.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(`dfm_check_overhangs not_checked[${i}] must be a string.`);
    }
    return item;
  });
  const inputSha256 = requireSha256Hex(
    requireObject(root.input_artifact, "dfm_check_overhangs input_artifact").sha256,
    "dfm_check_overhangs input_artifact.sha256",
  );
  if (inputSha256 !== expectedSha256) {
    throw new Error(
      `dfm_check_overhangs input_artifact.sha256 mismatch: expected ${expectedSha256}, got ${inputSha256}.`,
    );
  }
  return {
    measured: {
      totalSurfaceAreaMm2,
      overhangAreaMm2,
      overhangTriangleCount,
      totalTriangleCount,
    },
    violations,
    notChecked,
    inputArtifactSha256: inputSha256,
  };
}

export function validatePrintabilityObservationCapture(
  value: unknown,
): PrintabilityObservationCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "dispatchedAt",
    "capturedAt",
    "caseDigest",
    "geometry",
    "providerCallParams",
    "reviewedCaseThresholds",
    "thickness",
    "overhang",
    "limitations",
  ], "$printabilityObservationCapture");
  literalValue(
    root.schemaVersion,
    PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA,
    "$printabilityObservationCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$printabilityObservationCapture.operation",
  );
  literalValue(
    operation.id,
    INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.id,
    "$printabilityObservationCapture.operation.id",
  );
  literalValue(
    operation.version,
    INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION.version,
    "$printabilityObservationCapture.operation.version",
  );
  const geometry = exactRecord(
    root.geometry,
    ["artifactId", "sha256", "byteCount", "mediaType", "stagedPath"],
    "$printabilityObservationCapture.geometry",
  );
  if (geometry.mediaType !== "model/step" && geometry.mediaType !== "model/stl") {
    throw new TypeError(
      "$printabilityObservationCapture.geometry.mediaType must be model/step or model/stl.",
    );
  }
  const params = exactRecord(
    root.providerCallParams,
    ["meshSizeMm", "buildDirection", "minWallThicknessMm", "maxOverhangAngleDeg"],
    "$printabilityObservationCapture.providerCallParams",
  );
  const reviewed = exactRecord(
    root.reviewedCaseThresholds,
    ["maxUnsupportedAreaMm2"],
    "$printabilityObservationCapture.reviewedCaseThresholds",
  );
  const thickness = exactRecord(
    root.thickness,
    ["tool", "measured", "violations", "notChecked", "inputArtifactSha256"],
    "$printabilityObservationCapture.thickness",
  );
  literalValue(thickness.tool, "dfm_check_min_thickness", "$thickness.tool");
  const overhang = exactRecord(
    root.overhang,
    ["tool", "measured", "violations", "notChecked", "inputArtifactSha256"],
    "$printabilityObservationCapture.overhang",
  );
  literalValue(overhang.tool, "dfm_check_overhangs", "$overhang.tool");
  const limitations = nonEmptyArray(
    root.limitations,
    "$printabilityObservationCapture.limitations",
  ).map((item, i) =>
    nonEmptyText(item, `$printabilityObservationCapture.limitations[${i}]`)
  );
  return {
    schemaVersion: PRINTABILITY_OBSERVATION_CAPTURE_SCHEMA,
    operation: INDUSTRIALIZE_OBSERVE_PRINTABILITY_OPERATION,
    trustedRunId: safeId(
      root.trustedRunId,
      "$printabilityObservationCapture.trustedRunId",
    ),
    dispatchedAt: nonEmptyText(
      root.dispatchedAt,
      "$printabilityObservationCapture.dispatchedAt",
    ),
    capturedAt: nonEmptyText(
      root.capturedAt,
      "$printabilityObservationCapture.capturedAt",
    ),
    caseDigest: requireSha256Hex(
      root.caseDigest,
      "$printabilityObservationCapture.caseDigest",
    ),
    geometry: {
      artifactId: safeId(geometry.artifactId, "$geometry.artifactId"),
      sha256: requireSha256Hex(geometry.sha256, "$geometry.sha256"),
      byteCount: requirePositiveInt(geometry.byteCount, "$geometry.byteCount"),
      mediaType: geometry.mediaType,
      stagedPath: nonEmptyText(geometry.stagedPath, "$geometry.stagedPath"),
    },
    providerCallParams: {
      meshSizeMm: finite(params.meshSizeMm, "$providerCallParams.meshSizeMm"),
      buildDirection: requireFiniteTriple(
        params.buildDirection,
        "$providerCallParams.buildDirection",
      ),
      minWallThicknessMm: finite(
        params.minWallThicknessMm,
        "$providerCallParams.minWallThicknessMm",
      ),
      maxOverhangAngleDeg: finite(
        params.maxOverhangAngleDeg,
        "$providerCallParams.maxOverhangAngleDeg",
      ),
    },
    reviewedCaseThresholds: {
      maxUnsupportedAreaMm2: finite(
        reviewed.maxUnsupportedAreaMm2,
        "$reviewedCaseThresholds.maxUnsupportedAreaMm2",
      ),
    },
    thickness: {
      tool: "dfm_check_min_thickness",
      measured: thickness.measured as DfmThicknessResult["measured"],
      violations: thickness.violations as readonly DfmViolationZone[],
      notChecked: thickness.notChecked as readonly string[],
      inputArtifactSha256: requireSha256Hex(
        thickness.inputArtifactSha256,
        "$thickness.inputArtifactSha256",
      ),
    },
    overhang: {
      tool: "dfm_check_overhangs",
      measured: overhang.measured as DfmOverhangResult["measured"],
      violations: overhang.violations as readonly DfmViolationZone[],
      notChecked: overhang.notChecked as readonly string[],
      inputArtifactSha256: requireSha256Hex(
        overhang.inputArtifactSha256,
        "$overhang.inputArtifactSha256",
      ),
    },
    limitations,
  };
}

export async function fingerprintPrintabilityObservationCapture(
  capture: PrintabilityObservationCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function canonicalPrintabilityObservationText(
  capture: PrintabilityObservationCapture,
): string {
  return deterministicJson(capture);
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
