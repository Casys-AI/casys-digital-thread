/**
 * Closed `geometry-module-input-bundle/1.0` input for one-level module assembly.
 *
 * The server orders immediate occurrences by exact usage identity, then packs a
 * canonical manifest and the exact child STEP bytes. The selected assembler
 * adapter decodes and rehashes this blob; it never receives agent CAD source.
 */

import type { GeometryBundlePlacement } from "../canonical/geometry-bundle.ts";
import {
  validateContentFingerprint,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  compareAsciiCodeUnits,
  fingerprintResourceBytes,
  type ImmutableBytes,
  immutableBytes,
  sha256Hex,
} from "../../compile/source/provider-resource-reader.ts";
import {
  GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS,
  GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
  GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleChildCaptureSchema,
} from "../geometry-module-contract.ts";
import {
  arrayOf,
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  nonEmptyArray,
  nonEmptyText,
  rejectDuplicates,
  safeId,
} from "../../kernel/case-validation.ts";
import { deterministicJson } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC = new TextEncoder().encode(
  "CASYS-GEOMETRY-MODULE-BUNDLE/1.0\n",
);
export const GEOMETRY_MODULE_MAXIMUM_MANIFEST_BYTES = 1_048_576;
export const GEOMETRY_MODULE_MAXIMUM_OCCURRENCES = 32;
export const GEOMETRY_MODULE_MAXIMUM_CHILD_STEP_BYTES = 32 * 1_048_576;
export const GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES = 256 * 1_048_576;

export interface GeometryModuleChildCaptureIdentity {
  readonly schemaVersion: GeometryModuleChildCaptureSchema;
  readonly artifactId: string;
  readonly fingerprint: ContentFingerprint;
}

export interface GeometryModuleChildStepIdentity {
  readonly mediaType: typeof GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE;
  readonly byteOffset: number;
  readonly byteCount: number;
  readonly sha256: string;
}

export interface GeometryModuleInputOccurrence {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly placement: GeometryBundlePlacement;
  readonly childCapture: GeometryModuleChildCaptureIdentity;
  readonly step: GeometryModuleChildStepIdentity;
}

export interface GeometryModuleInputBundleManifest {
  readonly schemaVersion: typeof GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA;
  readonly unitSystem: typeof GEOMETRY_MODULE_UNIT_SYSTEM;
  readonly placementConvention: typeof GEOMETRY_MODULE_PLACEMENT_CONVENTION;
  readonly occurrences: readonly GeometryModuleInputOccurrence[];
}

export interface GeometryModuleInputOccurrenceInput {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly placement: GeometryBundlePlacement;
  readonly childCapture: GeometryModuleChildCaptureIdentity;
  readonly stepBytes: Uint8Array;
}

export interface GeometryModuleInputBundle {
  readonly manifest: GeometryModuleInputBundleManifest;
  readonly bytes: ImmutableBytes;
  readonly fingerprint: ContentFingerprint;
  readonly stepBytes: readonly ImmutableBytes[];
}

export async function createGeometryModuleInputBundle(
  occurrencesValue: readonly GeometryModuleInputOccurrenceInput[],
): Promise<GeometryModuleInputBundle> {
  if (!Array.isArray(occurrencesValue) || arguments.length !== 1) {
    throw new TypeError("$bundle.occurrences must be the only encode input.");
  }
  const prepared = await prepareOccurrences(occurrencesValue);
  const manifest = deepFreeze<GeometryModuleInputBundleManifest>({
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    occurrences: prepared.occurrences,
  });
  return assembleBundle(manifest, prepared.stepBytes);
}

export async function parseGeometryModuleInputBundle(
  value: Uint8Array,
): Promise<GeometryModuleInputBundle> {
  const bytes = copyBytes(value, "$bundle.bytes");
  if (bytes.byteLength > GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES) {
    throw new TypeError("The geometry-module input bundle exceeds its ceiling.");
  }
  if (!startsWith(bytes, GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC)) {
    throw new TypeError("The geometry-module input bundle has an invalid magic.");
  }
  const lengthStart = GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC.byteLength;
  const lengthEnd = bytes.indexOf(10, lengthStart);
  if (lengthEnd < 0 || lengthEnd - lengthStart > 10) {
    throw new TypeError("The geometry-module bundle length header is invalid.");
  }
  const lengthText = decodeUtf8(
    bytes.subarray(lengthStart, lengthEnd),
    "$bundle.length",
  );
  if (!/^[1-9][0-9]*$/.test(lengthText)) {
    throw new TypeError("The geometry-module bundle length is not canonical.");
  }
  const manifestLength = Number(lengthText);
  if (
    !Number.isSafeInteger(manifestLength) ||
    manifestLength > GEOMETRY_MODULE_MAXIMUM_MANIFEST_BYTES
  ) {
    throw new TypeError("The geometry-module bundle manifest length is invalid.");
  }
  const manifestStart = lengthEnd + 1;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestEnd > bytes.byteLength) {
    throw new TypeError("The geometry-module bundle manifest is truncated.");
  }
  const manifestText = decodeUtf8(
    bytes.subarray(manifestStart, manifestEnd),
    "$bundle.manifest",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifestText);
  } catch {
    throw new TypeError("The geometry-module bundle manifest is not JSON.");
  }
  const manifest = validateGeometryModuleInputBundleManifest(parsed);
  if (deterministicJson(manifest) !== manifestText) {
    throw new TypeError("The geometry-module bundle manifest is not canonical.");
  }
  const payload = bytes.subarray(manifestEnd);
  const stepBytes = slicePackedSteps(manifest.occurrences, payload);
  const bundle = deepFreeze({
    manifest,
    bytes: immutableBytes(bytes),
    fingerprint: {
      algorithm: "sha256" as const,
      digest: await fingerprintResourceBytes(bytes),
    },
    stepBytes,
  });
  await rehashGeometryModuleInputBundleSteps(bundle);
  return bundle;
}

export function validateGeometryModuleInputBundleManifest(
  value: unknown,
  path = "$bundle.manifest",
): GeometryModuleInputBundleManifest {
  const root = exactRecord(value, [
    "schemaVersion",
    "unitSystem",
    "placementConvention",
    "occurrences",
  ], path);
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  literalValue(
    root.unitSystem,
    GEOMETRY_MODULE_UNIT_SYSTEM,
    `${path}.unitSystem`,
  );
  literalValue(
    root.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    `${path}.placementConvention`,
  );
  const occurrences = nonEmptyArray(
    root.occurrences,
    `${path}.occurrences`,
  ).map((occurrence, index) =>
    validateOccurrence(occurrence, `${path}.occurrences[${index}]`)
  );
  if (occurrences.length > GEOMETRY_MODULE_MAXIMUM_OCCURRENCES) {
    throw new TypeError(
      `${path}.occurrences exceeds the one-level occurrence ceiling.`,
    );
  }
  rejectDuplicates(
    occurrences.map((occurrence) => occurrence.usageElementId),
    `${path}.occurrences usageElementId`,
  );
  assertUsageIdentityOrder(occurrences, path);
  assertPackedStepOffsets(occurrences, path);
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_INPUT_BUNDLE_SCHEMA,
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    occurrences,
  });
}

async function prepareOccurrences(
  value: readonly GeometryModuleInputOccurrenceInput[],
): Promise<{
  readonly occurrences: readonly GeometryModuleInputOccurrence[];
  readonly stepBytes: readonly Uint8Array[];
}> {
  const inputs = nonEmptyArray(
    value,
    "$bundle.occurrences",
  ) as GeometryModuleInputOccurrenceInput[];
  if (inputs.length > GEOMETRY_MODULE_MAXIMUM_OCCURRENCES) {
    throw new TypeError(
      "$bundle.occurrences exceeds the one-level occurrence ceiling.",
    );
  }
  const normalized = await Promise.all(inputs.map(async (input, index) => {
    const path = `$bundle.occurrences[${index}]`;
    const record = exactRecord(input, [
      "usageElementId",
      "partDefinitionElementId",
      "placement",
      "childCapture",
      "stepBytes",
    ], path);
    const stepBytes = copyBytes(record.stepBytes, `${path}.stepBytes`);
    validatePart21(stepBytes, `${path}.stepBytes`);
    if (stepBytes.byteLength > GEOMETRY_MODULE_MAXIMUM_CHILD_STEP_BYTES) {
      throw new TypeError(`${path}.stepBytes exceeds the child STEP ceiling.`);
    }
    return {
      usageElementId: safeId(record.usageElementId, `${path}.usageElementId`),
      partDefinitionElementId: nonEmptyText(
        record.partDefinitionElementId,
        `${path}.partDefinitionElementId`,
      ),
      placement: validatePlacement(record.placement, `${path}.placement`),
      childCapture: validateChildCapture(
        record.childCapture,
        `${path}.childCapture`,
      ),
      stepBytes,
      sha256: await fingerprintResourceBytes(stepBytes),
    };
  }));
  normalized.sort((left, right) =>
    compareAsciiCodeUnits(left.usageElementId, right.usageElementId)
  );
  rejectDuplicates(
    normalized.map((item) => item.usageElementId),
    "$bundle.occurrences usageElementId",
  );
  let offset = 0;
  const occurrences = normalized.map((item) => {
    const occurrence = deepFreeze<GeometryModuleInputOccurrence>({
      usageElementId: item.usageElementId,
      partDefinitionElementId: item.partDefinitionElementId,
      placement: item.placement,
      childCapture: item.childCapture,
      step: {
        mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
        byteOffset: offset,
        byteCount: item.stepBytes.byteLength,
        sha256: item.sha256,
      },
    });
    offset += item.stepBytes.byteLength;
    return occurrence;
  });
  return {
    occurrences,
    stepBytes: normalized.map((item) => item.stepBytes),
  };
}

async function assembleBundle(
  manifest: GeometryModuleInputBundleManifest,
  stepBytes: readonly Uint8Array[],
): Promise<GeometryModuleInputBundle> {
  const manifestBytes = new TextEncoder().encode(deterministicJson(manifest));
  if (manifestBytes.byteLength > GEOMETRY_MODULE_MAXIMUM_MANIFEST_BYTES) {
    throw new TypeError("The geometry-module bundle manifest is too large.");
  }
  const lengthBytes = new TextEncoder().encode(`${manifestBytes.byteLength}\n`);
  const payload = concatBytes(...stepBytes);
  const bytes = concatBytes(
    GEOMETRY_MODULE_INPUT_BUNDLE_MAGIC,
    lengthBytes,
    manifestBytes,
    payload,
  );
  if (bytes.byteLength > GEOMETRY_MODULE_MAXIMUM_BUNDLE_BYTES) {
    throw new TypeError("The geometry-module input bundle exceeds its ceiling.");
  }
  return deepFreeze({
    manifest,
    bytes: immutableBytes(bytes),
    fingerprint: {
      algorithm: "sha256",
      digest: await fingerprintResourceBytes(bytes),
    },
    stepBytes: stepBytes.map((item) => immutableBytes(item)),
  });
}

function validateOccurrence(
  value: unknown,
  path: string,
): GeometryModuleInputOccurrence {
  const root = exactRecord(value, [
    "usageElementId",
    "partDefinitionElementId",
    "placement",
    "childCapture",
    "step",
  ], path);
  return deepFreeze({
    usageElementId: safeId(root.usageElementId, `${path}.usageElementId`),
    partDefinitionElementId: nonEmptyText(
      root.partDefinitionElementId,
      `${path}.partDefinitionElementId`,
    ),
    placement: validatePlacement(root.placement, `${path}.placement`),
    childCapture: validateChildCapture(root.childCapture, `${path}.childCapture`),
    step: validateStepIdentity(root.step, `${path}.step`),
  });
}

function validatePlacement(
  value: unknown,
  path: string,
): GeometryBundlePlacement {
  const root = exactRecord(value, ["translationMm", "rotationDeg"], path);
  return deepFreeze({
    translationMm: triple(root.translationMm, `${path}.translationMm`),
    rotationDeg: triple(root.rotationDeg, `${path}.rotationDeg`),
  });
}

function validateChildCapture(
  value: unknown,
  path: string,
): GeometryModuleChildCaptureIdentity {
  const root = exactRecord(
    value,
    ["schemaVersion", "artifactId", "fingerprint"],
    path,
  );
  const schemaVersion = nonEmptyTextAsSchema(
    root.schemaVersion,
    `${path}.schemaVersion`,
  );
  if (
    !GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS.includes(schemaVersion)
  ) {
    throw new TypeError(
      `${path}.schemaVersion must be a child geometry capture family.`,
    );
  }
  return deepFreeze({
    schemaVersion,
    artifactId: safeId(root.artifactId, `${path}.artifactId`),
    fingerprint: validateContentFingerprint(
      root.fingerprint,
      `${path}.fingerprint`,
    ),
  });
}

function validateStepIdentity(
  value: unknown,
  path: string,
): GeometryModuleChildStepIdentity {
  const root = exactRecord(
    value,
    ["mediaType", "byteOffset", "byteCount", "sha256"],
    path,
  );
  literalValue(
    root.mediaType,
    GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
    `${path}.mediaType`,
  );
  const byteCount = positiveInteger(root.byteCount, `${path}.byteCount`);
  if (byteCount > GEOMETRY_MODULE_MAXIMUM_CHILD_STEP_BYTES) {
    throw new TypeError(`${path}.byteCount exceeds the child STEP ceiling.`);
  }
  return deepFreeze({
    mediaType: GEOMETRY_MODULE_CHILD_STEP_MEDIA_TYPE,
    byteOffset: nonNegativeInteger(root.byteOffset, `${path}.byteOffset`),
    byteCount,
    sha256: sha256Hex(root.sha256, `${path}.sha256`),
  });
}

function assertUsageIdentityOrder(
  occurrences: readonly GeometryModuleInputOccurrence[],
  path: string,
): void {
  for (let index = 1; index < occurrences.length; index += 1) {
    if (
      compareAsciiCodeUnits(
        occurrences[index - 1]!.usageElementId,
        occurrences[index]!.usageElementId,
      ) >= 0
    ) {
      throw new TypeError(
        `${path}.occurrences must be ordered by exact usage identity.`,
      );
    }
  }
}

function assertPackedStepOffsets(
  occurrences: readonly GeometryModuleInputOccurrence[],
  path: string,
): void {
  let expectedOffset = 0;
  for (const [index, occurrence] of occurrences.entries()) {
    if (occurrence.step.byteOffset !== expectedOffset) {
      throw new TypeError(
        `${path}.occurrences[${index}].step.byteOffset is not densely packed.`,
      );
    }
    expectedOffset += occurrence.step.byteCount;
  }
}

function slicePackedSteps(
  occurrences: readonly GeometryModuleInputOccurrence[],
  payload: Uint8Array,
): readonly ImmutableBytes[] {
  const expected = occurrences.reduce(
    (sum, occurrence) => sum + occurrence.step.byteCount,
    0,
  );
  if (payload.byteLength !== expected) {
    throw new TypeError(
      "The geometry-module bundle STEP payload length is not exact.",
    );
  }
  return occurrences.map((occurrence, index) => {
    const start = occurrence.step.byteOffset;
    const end = start + occurrence.step.byteCount;
    const step = payload.subarray(start, end);
    if (step.byteLength !== occurrence.step.byteCount) {
      throw new TypeError(
        `$bundle.manifest.occurrences[${index}].step is truncated.`,
      );
    }
    validatePart21(step, `$bundle.manifest.occurrences[${index}].step`);
    return immutableBytes(step);
  });
}

export async function rehashGeometryModuleInputBundleSteps(
  bundle: GeometryModuleInputBundle,
): Promise<void> {
  if (bundle.stepBytes.length !== bundle.manifest.occurrences.length) {
    throw new TypeError("The geometry-module bundle STEP table is incomplete.");
  }
  for (const [index, occurrence] of bundle.manifest.occurrences.entries()) {
    const step = bundle.stepBytes[index]!.copy();
    if (
      step.byteLength !== occurrence.step.byteCount ||
      await fingerprintResourceBytes(step) !== occurrence.step.sha256
    ) {
      throw new TypeError(
        `The geometry-module child STEP ${index} failed exact rehash.`,
      );
    }
  }
}

function triple(
  value: unknown,
  path: string,
): readonly [number, number, number] {
  const values = arrayOf(value, path);
  if (values.length !== 3) {
    throw new TypeError(`${path} must contain three finite numbers.`);
  }
  return deepFreeze(
    [
      finite(values[0], `${path}[0]`),
      finite(values[1], `${path}[1]`),
      finite(values[2], `${path}[2]`),
    ] as const,
  );
}

function nonEmptyTextAsSchema(
  value: unknown,
  path: string,
): GeometryModuleChildCaptureSchema {
  if (typeof value !== "string" || value.length === 0) {
    throw new TypeError(`${path} must be a capture schema version.`);
  }
  return value as GeometryModuleChildCaptureSchema;
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1) {
    throw new TypeError(`${path} must be a positive integer.`);
  }
  return Number(value);
}

function nonNegativeInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new TypeError(`${path} must be a non-negative integer.`);
  }
  return Number(value);
}

function copyBytes(value: unknown, path: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${path} must be bytes.`);
  return Uint8Array.from(value);
}

function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((sum, part) => sum + part.byteLength, 0),
  );
  let offset = 0;
  for (const part of parts) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function startsWith(value: Uint8Array, prefix: Uint8Array): boolean {
  return value.byteLength >= prefix.byteLength &&
    prefix.every((byte, index) => value[index] === byte);
}

function decodeUtf8(value: Uint8Array, path: string): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(value);
  } catch {
    throw new TypeError(`${path} is not exact UTF-8.`);
  }
}

export function validatePart21(bytes: Uint8Array, path: string): void {
  const text = decodeUtf8(bytes, path);
  if (
    !text.startsWith("ISO-10303-21;") ||
    !text.trimEnd().endsWith("END-ISO-10303-21;") ||
    text.includes("\0")
  ) {
    throw new TypeError(`${path} is not one complete STEP Part 21 exchange file.`);
  }
}
