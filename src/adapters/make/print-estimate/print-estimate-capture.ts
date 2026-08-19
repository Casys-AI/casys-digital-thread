/**
 * Observation capture for industrialize.observe-print-estimate@1.
 *
 * Records attested print-time and material measurements. gcode_sha256 is
 * audit-only and never treated as a deterministic attestation. No price.
 */

import { INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION } from "../../../domain/make/print-estimate/print-estimate-proposal.ts";
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

export const PRINT_ESTIMATE_OBSERVATION_CAPTURE_SCHEMA =
  "print-estimate-observation-capture/1.0" as const;

export const PRINT_ESTIMATE_OBSERVATION_CAPTURE_URI_PREFIX =
  "casys://print-estimate-observation-capture/sha256/" as const;

export interface PrusaslicerEstimateResult {
  readonly printTimeS: number;
  readonly printTimeNormalMode: string;
  readonly printTimeSilentMode: string | null;
  readonly filamentLengthMm: number;
  readonly filamentVolumeMm3: number;
  readonly filamentMassG?: number;
  readonly gcodeSha256: string;
  readonly notChecked: readonly string[];
  readonly stlArtifactSha256: string;
  readonly profileArtifactSha256: string;
  readonly profileArtifactBytes: number;
}

export interface PrintEstimateObservationCapture {
  readonly schemaVersion: typeof PRINT_ESTIMATE_OBSERVATION_CAPTURE_SCHEMA;
  readonly operation: {
    readonly id: typeof INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION.id;
    readonly version: typeof INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION.version;
  };
  readonly trustedRunId: string;
  readonly dispatchedAt: string;
  readonly capturedAt: string;
  readonly caseDigest: string;
  readonly geometry: {
    readonly artifactId: string;
    readonly sha256: string;
    readonly byteCount: number;
    readonly mediaType: "model/stl";
    readonly stagedPath: string;
  };
  readonly profile: {
    readonly repoPath: string;
    readonly exportName: string;
    readonly sha256: string;
    readonly stagedPath: string;
  };
  readonly estimate: PrusaslicerEstimateResult;
  readonly limitations: readonly string[];
}

export function parsePrusaslicerEstimateResult(
  value: unknown,
  expectedStlSha256: string,
  expectedProfileSha256: string,
  expectMass: boolean,
): PrusaslicerEstimateResult {
  const root = requireObject(value, "prusaslicer_estimate_fff structuredContent");
  const printTimeS = finite(root.print_time_s, "prusaslicer_estimate_fff print_time_s");
  if (printTimeS < 0) {
    throw new TypeError("prusaslicer_estimate_fff print_time_s must be non-negative.");
  }
  const filamentLengthMm = finite(
    root.filament_length_mm,
    "prusaslicer_estimate_fff filament_length_mm",
  );
  if (filamentLengthMm < 0) {
    throw new TypeError(
      "prusaslicer_estimate_fff filament_length_mm must be non-negative.",
    );
  }
  const filamentVolumeMm3 = finite(
    root.filament_volume_mm3,
    "prusaslicer_estimate_fff filament_volume_mm3",
  );
  if (filamentVolumeMm3 < 0) {
    throw new TypeError(
      "prusaslicer_estimate_fff filament_volume_mm3 must be non-negative.",
    );
  }
  let filamentMassG: number | undefined;
  if (expectMass) {
    if (!Object.hasOwn(root, "filament_mass_g")) {
      throw new TypeError(
        "prusaslicer_estimate_fff filament_mass_g is absent from the response but a filament density was declared in the case.",
      );
    }
    filamentMassG = finite(
      root.filament_mass_g,
      "prusaslicer_estimate_fff filament_mass_g",
    );
    if (filamentMassG < 0) {
      throw new TypeError(
        "prusaslicer_estimate_fff filament_mass_g must be non-negative.",
      );
    }
  }
  if (!Array.isArray(root.not_checked)) {
    throw new Error("prusaslicer_estimate_fff not_checked must be an array.");
  }
  const notChecked = root.not_checked.map((item, i) => {
    if (typeof item !== "string") {
      throw new TypeError(
        `prusaslicer_estimate_fff not_checked[${i}] must be a string.`,
      );
    }
    return item;
  });
  const stlArtSha256 = requireSha256Hex(
    requireObject(root.stl_artifact, "prusaslicer_estimate_fff stl_artifact").sha256,
    "prusaslicer_estimate_fff stl_artifact.sha256",
  );
  if (stlArtSha256 !== expectedStlSha256) {
    throw new Error(
      `prusaslicer_estimate_fff stl_artifact.sha256 mismatch: expected ${expectedStlSha256}, got ${stlArtSha256}.`,
    );
  }
  const profileArt = requireObject(
    root.profile_artifact,
    "prusaslicer_estimate_fff profile_artifact",
  );
  const profileArtSha256 = requireSha256Hex(
    profileArt.sha256,
    "prusaslicer_estimate_fff profile_artifact.sha256",
  );
  if (profileArtSha256 !== expectedProfileSha256) {
    throw new Error(
      `prusaslicer_estimate_fff profile_artifact.sha256 mismatch: expected ${expectedProfileSha256}, got ${profileArtSha256}.`,
    );
  }
  return {
    printTimeS,
    printTimeNormalMode: nonEmptyText(
      root.print_time_normal_mode,
      "prusaslicer_estimate_fff print_time_normal_mode",
    ),
    printTimeSilentMode: root.print_time_silent_mode === null ? null : nonEmptyText(
      root.print_time_silent_mode,
      "prusaslicer_estimate_fff print_time_silent_mode",
    ),
    filamentLengthMm,
    filamentVolumeMm3,
    ...(filamentMassG !== undefined ? { filamentMassG } : {}),
    gcodeSha256: requireSha256Hex(
      root.gcode_sha256,
      "prusaslicer_estimate_fff gcode_sha256",
    ),
    notChecked,
    stlArtifactSha256: stlArtSha256,
    profileArtifactSha256: profileArtSha256,
    profileArtifactBytes: requirePositiveInt(
      profileArt.bytes,
      "prusaslicer_estimate_fff profile_artifact.bytes",
    ),
  };
}

export function validatePrintEstimateObservationCapture(
  value: unknown,
): PrintEstimateObservationCapture {
  const root = exactRecord(value, [
    "schemaVersion",
    "operation",
    "trustedRunId",
    "dispatchedAt",
    "capturedAt",
    "caseDigest",
    "geometry",
    "profile",
    "estimate",
    "limitations",
  ], "$printEstimateObservationCapture");
  literalValue(
    root.schemaVersion,
    PRINT_ESTIMATE_OBSERVATION_CAPTURE_SCHEMA,
    "$printEstimateObservationCapture.schemaVersion",
  );
  const operation = exactRecord(
    root.operation,
    ["id", "version"],
    "$printEstimateObservationCapture.operation",
  );
  literalValue(
    operation.id,
    INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION.id,
    "$printEstimateObservationCapture.operation.id",
  );
  literalValue(
    operation.version,
    INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION.version,
    "$printEstimateObservationCapture.operation.version",
  );
  const geometry = exactRecord(
    root.geometry,
    ["artifactId", "sha256", "byteCount", "mediaType", "stagedPath"],
    "$printEstimateObservationCapture.geometry",
  );
  literalValue(
    geometry.mediaType,
    "model/stl",
    "$printEstimateObservationCapture.geometry.mediaType",
  );
  const profile = exactRecord(
    root.profile,
    ["repoPath", "exportName", "sha256", "stagedPath"],
    "$printEstimateObservationCapture.profile",
  );
  const estimateRoot = requireObject(root.estimate, "$estimate");
  const estimateKeys = Object.hasOwn(estimateRoot, "filamentMassG")
    ? PRINT_ESTIMATE_KEYS_WITH_MASS
    : PRINT_ESTIMATE_KEYS_WITHOUT_MASS;
  const estimateRecord = exactRecord(estimateRoot, estimateKeys, "$estimate");
  const printTimeS = requireNonNegative(
    estimateRecord.printTimeS,
    "$estimate.printTimeS",
  );
  const filamentLengthMm = requireNonNegative(
    estimateRecord.filamentLengthMm,
    "$estimate.filamentLengthMm",
  );
  const filamentVolumeMm3 = requireNonNegative(
    estimateRecord.filamentVolumeMm3,
    "$estimate.filamentVolumeMm3",
  );
  const estimate: PrusaslicerEstimateResult = {
    printTimeS,
    printTimeNormalMode: nonEmptyText(
      estimateRecord.printTimeNormalMode,
      "$estimate.printTimeNormalMode",
    ),
    printTimeSilentMode: estimateRecord.printTimeSilentMode === null
      ? null
      : nonEmptyText(
        estimateRecord.printTimeSilentMode,
        "$estimate.printTimeSilentMode",
      ),
    filamentLengthMm,
    filamentVolumeMm3,
    ...(Object.hasOwn(estimateRecord, "filamentMassG")
      ? {
        filamentMassG: requireNonNegative(
          estimateRecord.filamentMassG,
          "$estimate.filamentMassG",
        ),
      }
      : {}),
    gcodeSha256: requireSha256Hex(estimateRecord.gcodeSha256, "$estimate.gcodeSha256"),
    notChecked: parsePersistedNotChecked(
      estimateRecord.notChecked,
      "$estimate.notChecked",
    ),
    stlArtifactSha256: requireSha256Hex(
      estimateRecord.stlArtifactSha256,
      "$estimate.stlArtifactSha256",
    ),
    profileArtifactSha256: requireSha256Hex(
      estimateRecord.profileArtifactSha256,
      "$estimate.profileArtifactSha256",
    ),
    profileArtifactBytes: requirePositiveInt(
      estimateRecord.profileArtifactBytes,
      "$estimate.profileArtifactBytes",
    ),
  };
  if (
    estimate.stlArtifactSha256 !== requireSha256Hex(geometry.sha256, "$geometry.sha256")
  ) {
    throw new TypeError("$estimate.stlArtifactSha256 must match geometry.sha256.");
  }
  if (
    estimate.profileArtifactSha256 !==
      requireSha256Hex(profile.sha256, "$profile.sha256")
  ) {
    throw new TypeError("$estimate.profileArtifactSha256 must match profile.sha256.");
  }
  return {
    schemaVersion: PRINT_ESTIMATE_OBSERVATION_CAPTURE_SCHEMA,
    operation: INDUSTRIALIZE_OBSERVE_PRINT_ESTIMATE_OPERATION,
    trustedRunId: safeId(root.trustedRunId, "$trustedRunId"),
    dispatchedAt: nonEmptyText(root.dispatchedAt, "$dispatchedAt"),
    capturedAt: nonEmptyText(root.capturedAt, "$capturedAt"),
    caseDigest: requireSha256Hex(root.caseDigest, "$caseDigest"),
    geometry: {
      artifactId: safeId(geometry.artifactId, "$geometry.artifactId"),
      sha256: requireSha256Hex(geometry.sha256, "$geometry.sha256"),
      byteCount: requirePositiveInt(geometry.byteCount, "$geometry.byteCount"),
      mediaType: "model/stl",
      stagedPath: nonEmptyText(geometry.stagedPath, "$geometry.stagedPath"),
    },
    profile: {
      repoPath: nonEmptyText(profile.repoPath, "$profile.repoPath"),
      exportName: nonEmptyText(profile.exportName, "$profile.exportName"),
      sha256: requireSha256Hex(profile.sha256, "$profile.sha256"),
      stagedPath: nonEmptyText(profile.stagedPath, "$profile.stagedPath"),
    },
    estimate,
    limitations: nonEmptyArray(root.limitations, "$limitations").map((item, i) =>
      nonEmptyText(item, `$limitations[${i}]`)
    ),
  };
}

export async function fingerprintPrintEstimateObservationCapture(
  capture: PrintEstimateObservationCapture,
): Promise<ContentFingerprint> {
  return await sha256Fingerprint(capture);
}

export function canonicalPrintEstimateObservationText(
  capture: PrintEstimateObservationCapture,
): string {
  return deterministicJson(capture);
}

const PRINT_ESTIMATE_KEYS_WITHOUT_MASS = [
  "printTimeS",
  "printTimeNormalMode",
  "printTimeSilentMode",
  "filamentLengthMm",
  "filamentVolumeMm3",
  "gcodeSha256",
  "notChecked",
  "stlArtifactSha256",
  "profileArtifactSha256",
  "profileArtifactBytes",
] as const;

const PRINT_ESTIMATE_KEYS_WITH_MASS = [
  ...PRINT_ESTIMATE_KEYS_WITHOUT_MASS,
  "filamentMassG",
] as const;

function parsePersistedNotChecked(value: unknown, path: string): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${path} must be an array.`);
  }
  return value.map((item, i) => nonEmptyText(item, `${path}[${i}]`));
}

function requireNonNegative(value: unknown, path: string): number {
  const n = finite(value, path);
  if (n < 0) throw new TypeError(`${path} must be non-negative.`);
  return n;
}

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function requirePositiveInt(value: unknown, path: string): number {
  const n = finite(value, path);
  if (!Number.isSafeInteger(n) || n < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return n;
}

function requireSha256Hex(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a 64-character lowercase hex SHA-256 digest.`);
  }
  return value;
}
