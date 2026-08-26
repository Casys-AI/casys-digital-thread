/**
 * Closed binary input for a factual assembly-integrity observation.
 *
 * The bundle packs canonical JSON for one reopened module capture and its
 * exact canonical STEP. The manifest adds the external Thread identity, the
 * immediate occurrence recross, and one server-selected method identity. It
 * contains no CAD source, provider, runtime, or product criterion.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  positiveInteger,
  rejectDuplicates,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import {
  deterministicJson,
  fingerprintsEqual,
  sha256Fingerprint,
} from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";
import {
  fingerprintResourceBytes,
  type ImmutableBytes,
  immutableBytes,
} from "../../compile/source/provider-resource-reader.ts";
import { validateContentFingerprint } from "../../compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_CAPTURE_SCHEMA,
  GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS,
  GEOMETRY_MODULE_PLACEMENT_CONVENTION,
  GEOMETRY_MODULE_UNIT_SYSTEM,
  type GeometryModuleChildCaptureSchema,
} from "../geometry-module-contract.ts";
import {
  type GeometryModuleReference,
  validateGeometryModuleReference as validateCanonicalGeometryModuleReference,
} from "../canonical/geometry-module-reference.ts";
import { validatePart21 } from "../module-assembly/geometry-module-input-bundle.ts";
import type { GeometryModuleCapture } from "../canonical/geometry-module-capture.ts";
import { parseCanonicalGeometryCapture } from "../canonical/geometry-part-capture.ts";

export const ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA =
  "assembly-integrity-input-bundle/1.0" as const;
export const ASSEMBLY_INTEGRITY_INPUT_BUNDLE_MAGIC = new TextEncoder().encode(
  "CASYS-ASSEMBLY-INTEGRITY-BUNDLE/1.0\n",
);
export const ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES = 32;
export const ASSEMBLY_INTEGRITY_MAXIMUM_PAIRS = 496;
export const ASSEMBLY_INTEGRITY_MAXIMUM_CAPTURE_BYTES = 2 * 1_048_576;
export const ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES = 128 * 1_048_576;
export const ASSEMBLY_INTEGRITY_MAXIMUM_BUNDLE_BYTES =
  ASSEMBLY_INTEGRITY_MAXIMUM_CAPTURE_BYTES +
  ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES + 1_048_576;
export const ASSEMBLY_INTEGRITY_MAXIMUM_MANIFEST_BYTES = 128 * 1_024;

export interface AssemblyIntegrityMethodIdentity {
  readonly id: string;
  readonly version: string;
  /** Method-owned tolerance; it is never a clearance or acceptance rule. */
  readonly linearToleranceMm: number;
}

/**
 * Backward-compatible vertical name for the generic canonical geometry-module
 * identity. The static-basis port owns the provider-free reopening contract.
 */
export type AssemblyIntegrityGeometryModuleReference = GeometryModuleReference;

export interface AssemblyIntegrityExpectedPlacement {
  readonly translationMm: readonly [number, number, number];
  readonly rotationDeg: readonly [number, number, number];
}

export interface AssemblyIntegrityOccurrenceIdentity {
  readonly usageElementId: string;
  readonly partDefinitionElementId: string;
  readonly expectedPlacement: AssemblyIntegrityExpectedPlacement;
  readonly childCapture: {
    readonly schemaVersion: GeometryModuleChildCaptureSchema;
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
}

export interface AssemblyIntegrityInputBundleManifest {
  readonly schemaVersion: typeof ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA;
  readonly geometryModule: AssemblyIntegrityGeometryModuleReference & {
    readonly byteCount: number;
  };
  /** Offset is within the STEP payload after the packed capture JSON. */
  readonly assemblyStep: {
    readonly mediaType: "model/step";
    readonly byteOffset: 0;
    readonly byteCount: number;
    readonly sha256: string;
  };
  readonly unitSystem: typeof GEOMETRY_MODULE_UNIT_SYSTEM;
  readonly placementConvention: typeof GEOMETRY_MODULE_PLACEMENT_CONVENTION;
  readonly occurrences: readonly AssemblyIntegrityOccurrenceIdentity[];
  readonly method: AssemblyIntegrityMethodIdentity;
}

export interface AssemblyIntegrityInputBundle {
  readonly manifest: AssemblyIntegrityInputBundleManifest;
  readonly bytes: ImmutableBytes;
  readonly fingerprint: ContentFingerprint;
  readonly geometryModuleCapture: GeometryModuleCapture;
  readonly assemblyStep: ImmutableBytes;
}

export interface AssemblyIntegrityInputBundleSource {
  /** Reopened external identity; the parser proves it against packed capture bytes. */
  readonly geometryModule: AssemblyIntegrityGeometryModuleReference;
  readonly geometryModuleCapture: unknown;
  readonly assemblyStepBytes: Uint8Array;
  readonly method: AssemblyIntegrityMethodIdentity;
}

/**
 * Create a deterministic bundle from already-reopened evidence. Expected
 * occurrences and transforms are derived from the capture, never supplied as
 * independent caller data.
 */
export async function createAssemblyIntegrityInputBundle(
  value: AssemblyIntegrityInputBundleSource,
): Promise<AssemblyIntegrityInputBundle> {
  const root = exactRecord(
    value,
    ["geometryModule", "geometryModuleCapture", "assemblyStepBytes", "method"],
    "$assemblyIntegrityInput",
  );
  const geometryModuleCapture = await parseGeometryModuleCapture(
    root.geometryModuleCapture,
    "$assemblyIntegrityInput.geometryModuleCapture",
  );
  const captureBytes = new TextEncoder().encode(
    deterministicJson(geometryModuleCapture),
  );
  if (captureBytes.byteLength > ASSEMBLY_INTEGRITY_MAXIMUM_CAPTURE_BYTES) {
    throw new TypeError("The assembly-integrity module capture exceeds its ceiling.");
  }
  const geometryModule = validateGeometryModuleReference(
    root.geometryModule,
    "$assemblyIntegrityInput.geometryModule",
  );
  const observedCaptureFingerprint = await sha256Fingerprint(geometryModuleCapture);
  if (!fingerprintsEqual(geometryModule.fingerprint, observedCaptureFingerprint)) {
    throw new TypeError(
      "$assemblyIntegrityInput.geometryModule must identify the exact reopened module capture.",
    );
  }
  assertGeometryModuleArtifactId(
    geometryModule,
    "$assemblyIntegrityInput.geometryModule",
  );

  const assemblyStep = copyBytes(
    root.assemblyStepBytes,
    "$assemblyIntegrityInput.assemblyStepBytes",
  );
  assertStepBytes(assemblyStep, "$assemblyIntegrityInput.assemblyStepBytes");
  const stepSha256 = await fingerprintResourceBytes(assemblyStep);
  assertCaptureStepIdentity(
    geometryModuleCapture,
    stepSha256,
    assemblyStep.byteLength,
    "$assemblyIntegrityInput",
  );

  const manifest = deepFreeze<AssemblyIntegrityInputBundleManifest>({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    geometryModule: { ...geometryModule, byteCount: captureBytes.byteLength },
    assemblyStep: {
      mediaType: "model/step",
      byteOffset: 0,
      byteCount: assemblyStep.byteLength,
      sha256: stepSha256,
    },
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    occurrences: geometryModuleCapture.children.map((child) => ({
      usageElementId: child.usageElementId,
      partDefinitionElementId: child.partDefinitionElementId,
      expectedPlacement: {
        translationMm: child.placement.translationMm,
        rotationDeg: child.placement.rotationDeg,
      },
      childCapture: child.childGeometry,
    })),
    method: validateAssemblyIntegrityMethodIdentity(
      root.method,
      "$assemblyIntegrityInput.method",
    ),
  });
  assertOccurrenceBound(manifest.occurrences.length, "$assemblyIntegrityInput");
  return await assembleBundle(manifest, captureBytes, assemblyStep);
}

/**
 * Reopen and recross every packed byte. The canonical geometry capture parser
 * remains the only parser for geometry-module-capture/1.0.
 */
export async function parseAssemblyIntegrityInputBundle(
  value: Uint8Array,
): Promise<AssemblyIntegrityInputBundle> {
  const bytes = copyBytes(value, "$assemblyIntegrityBundle.bytes");
  if (bytes.byteLength > ASSEMBLY_INTEGRITY_MAXIMUM_BUNDLE_BYTES) {
    throw new TypeError("The assembly-integrity input bundle exceeds its ceiling.");
  }
  if (!startsWith(bytes, ASSEMBLY_INTEGRITY_INPUT_BUNDLE_MAGIC)) {
    throw new TypeError("The assembly-integrity input bundle has an invalid magic.");
  }
  const lengthStart = ASSEMBLY_INTEGRITY_INPUT_BUNDLE_MAGIC.byteLength;
  const lengthEnd = bytes.indexOf(10, lengthStart);
  if (lengthEnd < 0 || lengthEnd - lengthStart > 10) {
    throw new TypeError("The assembly-integrity bundle length header is invalid.");
  }
  const manifestLengthText = decodeUtf8(
    bytes.subarray(lengthStart, lengthEnd),
    "$assemblyIntegrityBundle.manifestLength",
  );
  if (!/^[1-9][0-9]*$/.test(manifestLengthText)) {
    throw new TypeError(
      "The assembly-integrity bundle manifest length is not canonical.",
    );
  }
  const manifestLength = Number(manifestLengthText);
  if (
    !Number.isSafeInteger(manifestLength) ||
    manifestLength > ASSEMBLY_INTEGRITY_MAXIMUM_MANIFEST_BYTES
  ) {
    throw new TypeError("The assembly-integrity bundle manifest length is invalid.");
  }
  const manifestStart = lengthEnd + 1;
  const manifestEnd = manifestStart + manifestLength;
  if (manifestEnd > bytes.byteLength) {
    throw new TypeError("The assembly-integrity bundle manifest is truncated.");
  }
  const manifestText = decodeUtf8(
    bytes.subarray(manifestStart, manifestEnd),
    "$assemblyIntegrityBundle.manifest",
  );
  let manifestValue: unknown;
  try {
    manifestValue = JSON.parse(manifestText);
  } catch {
    throw new TypeError("The assembly-integrity bundle manifest is not JSON.");
  }
  const manifest = validateAssemblyIntegrityInputBundleManifest(manifestValue);
  if (deterministicJson(manifest) !== manifestText) {
    throw new TypeError("The assembly-integrity bundle manifest is not canonical.");
  }

  const payload = bytes.subarray(manifestEnd);
  const expectedPayloadBytes = manifest.geometryModule.byteCount +
    manifest.assemblyStep.byteCount;
  if (payload.byteLength !== expectedPayloadBytes) {
    throw new TypeError("The assembly-integrity bundle payload length is not exact.");
  }
  const captureBytes = payload.subarray(0, manifest.geometryModule.byteCount);
  const stepPayload = payload.subarray(manifest.geometryModule.byteCount);
  const assemblyStep = stepPayload.subarray(
    manifest.assemblyStep.byteOffset,
    manifest.assemblyStep.byteOffset + manifest.assemblyStep.byteCount,
  );
  if (assemblyStep.byteLength !== manifest.assemblyStep.byteCount) {
    throw new TypeError("The assembly-integrity canonical STEP is truncated.");
  }
  if (
    await fingerprintResourceBytes(captureBytes) !==
      manifest.geometryModule.fingerprint.digest
  ) {
    throw new TypeError("The assembly-integrity module capture failed exact rehash.");
  }
  if (await fingerprintResourceBytes(assemblyStep) !== manifest.assemblyStep.sha256) {
    throw new TypeError("The assembly-integrity canonical STEP failed exact rehash.");
  }
  assertStepBytes(assemblyStep, "$assemblyIntegrityBundle.assemblyStep");

  let captureValue: unknown;
  const captureText = decodeUtf8(
    captureBytes,
    "$assemblyIntegrityBundle.geometryModule",
  );
  try {
    captureValue = JSON.parse(captureText);
  } catch {
    throw new TypeError("The assembly-integrity module capture is not JSON.");
  }
  const geometryModuleCapture = await parseGeometryModuleCapture(
    captureValue,
    "$assemblyIntegrityBundle.geometryModule",
  );
  if (deterministicJson(geometryModuleCapture) !== captureText) {
    throw new TypeError("The assembly-integrity module capture is not canonical.");
  }
  const captureFingerprint = await sha256Fingerprint(geometryModuleCapture);
  if (!fingerprintsEqual(captureFingerprint, manifest.geometryModule.fingerprint)) {
    throw new TypeError(
      "The assembly-integrity bundle names a different module capture.",
    );
  }
  assertGeometryModuleArtifactId(
    manifest.geometryModule,
    "$assemblyIntegrityBundle.geometryModule",
  );
  assertCaptureStepIdentity(
    geometryModuleCapture,
    manifest.assemblyStep.sha256,
    assemblyStep.byteLength,
    "$assemblyIntegrityBundle",
  );
  if (
    geometryModuleCapture.manifest.unitSystem !== manifest.unitSystem ||
    geometryModuleCapture.manifest.placementConvention !==
      manifest.placementConvention
  ) {
    throw new TypeError(
      "The assembly-integrity bundle unit system or placement convention diverges from the module capture.",
    );
  }
  assertOccurrencesMatchCapture(
    manifest.occurrences,
    geometryModuleCapture,
    "$assemblyIntegrityBundle.occurrences",
  );

  return deepFreeze({
    manifest,
    bytes: immutableBytes(bytes),
    fingerprint: {
      algorithm: "sha256",
      digest: await fingerprintResourceBytes(bytes),
    },
    geometryModuleCapture,
    assemblyStep: immutableBytes(assemblyStep),
  });
}

export function validateAssemblyIntegrityInputBundleManifest(
  value: unknown,
  path = "$assemblyIntegrityBundle.manifest",
): AssemblyIntegrityInputBundleManifest {
  const root = exactRecord(
    value,
    [
      "schemaVersion",
      "geometryModule",
      "assemblyStep",
      "unitSystem",
      "placementConvention",
      "occurrences",
      "method",
    ],
    path,
  );
  literalValue(
    root.schemaVersion,
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    `${path}.schemaVersion`,
  );
  const geometryModule = exactRecord(
    root.geometryModule,
    ["schemaVersion", "artifactId", "fingerprint", "byteCount"],
    `${path}.geometryModule`,
  );
  literalValue(
    geometryModule.schemaVersion,
    GEOMETRY_MODULE_CAPTURE_SCHEMA,
    `${path}.geometryModule.schemaVersion`,
  );
  const assemblyStep = exactRecord(
    root.assemblyStep,
    ["mediaType", "byteOffset", "byteCount", "sha256"],
    `${path}.assemblyStep`,
  );
  literalValue(assemblyStep.mediaType, "model/step", `${path}.assemblyStep.mediaType`);
  literalValue(assemblyStep.byteOffset, 0, `${path}.assemblyStep.byteOffset`);
  literalValue(root.unitSystem, GEOMETRY_MODULE_UNIT_SYSTEM, `${path}.unitSystem`);
  literalValue(
    root.placementConvention,
    GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    `${path}.placementConvention`,
  );
  if (!Array.isArray(root.occurrences)) {
    throw new TypeError(`${path}.occurrences must be an array.`);
  }
  assertOccurrenceBound(root.occurrences.length, path);
  const occurrences = root.occurrences.map((entry, index) =>
    validateAssemblyIntegrityOccurrenceIdentity(entry, `${path}.occurrences[${index}]`)
  );
  rejectDuplicates(
    occurrences.map((entry) => entry.usageElementId),
    `${path}.occurrences usageElementId`,
  );
  assertUsageOrder(occurrences, path);
  const captureByteCount = positiveInteger(
    geometryModule.byteCount,
    `${path}.geometryModule.byteCount`,
  );
  if (captureByteCount > ASSEMBLY_INTEGRITY_MAXIMUM_CAPTURE_BYTES) {
    throw new TypeError(`${path}.geometryModule.byteCount exceeds its ceiling.`);
  }
  const stepByteCount = positiveInteger(
    assemblyStep.byteCount,
    `${path}.assemblyStep.byteCount`,
  );
  if (stepByteCount > ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES) {
    throw new TypeError(`${path}.assemblyStep.byteCount exceeds its ceiling.`);
  }
  const result = deepFreeze<AssemblyIntegrityInputBundleManifest>({
    schemaVersion: ASSEMBLY_INTEGRITY_INPUT_BUNDLE_SCHEMA,
    geometryModule: {
      schemaVersion: GEOMETRY_MODULE_CAPTURE_SCHEMA,
      artifactId: safeId(
        geometryModule.artifactId,
        `${path}.geometryModule.artifactId`,
      ),
      fingerprint: validateContentFingerprint(
        geometryModule.fingerprint,
        `${path}.geometryModule.fingerprint`,
      ),
      byteCount: captureByteCount,
    },
    assemblyStep: {
      mediaType: "model/step",
      byteOffset: 0,
      byteCount: stepByteCount,
      sha256: sha256Hex(assemblyStep.sha256, `${path}.assemblyStep.sha256`),
    },
    unitSystem: GEOMETRY_MODULE_UNIT_SYSTEM,
    placementConvention: GEOMETRY_MODULE_PLACEMENT_CONVENTION,
    occurrences,
    method: validateAssemblyIntegrityMethodIdentity(root.method, `${path}.method`),
  });
  assertGeometryModuleArtifactId(result.geometryModule, `${path}.geometryModule`);
  return result;
}

export function validateAssemblyIntegrityMethodIdentity(
  value: unknown,
  path = "$assemblyIntegrityMethod",
): AssemblyIntegrityMethodIdentity {
  const root = exactRecord(value, ["id", "version", "linearToleranceMm"], path);
  const id = safeId(root.id, `${path}.id`);
  const version = safeVersion(root.version, `${path}.version`);
  if (id === "latest" || version === "latest") {
    throw new TypeError(`${path} cannot use a latest alias.`);
  }
  const linearToleranceMm = finite(root.linearToleranceMm, `${path}.linearToleranceMm`);
  if (linearToleranceMm < 0) {
    throw new TypeError(`${path}.linearToleranceMm must be non-negative.`);
  }
  return deepFreeze({ id, version, linearToleranceMm });
}

function validateGeometryModuleReference(
  value: unknown,
  path: string,
): AssemblyIntegrityGeometryModuleReference {
  return validateCanonicalGeometryModuleReference(value, path);
}

function validateAssemblyIntegrityOccurrenceIdentity(
  value: unknown,
  path: string,
): AssemblyIntegrityOccurrenceIdentity {
  const root = exactRecord(
    value,
    ["usageElementId", "partDefinitionElementId", "expectedPlacement", "childCapture"],
    path,
  );
  const childCapture = exactRecord(
    root.childCapture,
    ["schemaVersion", "artifactId", "fingerprint"],
    `${path}.childCapture`,
  );
  const schemaVersion = childCapture.schemaVersion;
  if (
    !GEOMETRY_MODULE_CHILD_CAPTURE_SCHEMAS.includes(
      schemaVersion as GeometryModuleChildCaptureSchema,
    )
  ) {
    throw new TypeError(
      `${path}.childCapture.schemaVersion must be a canonical child capture schema.`,
    );
  }
  return deepFreeze({
    usageElementId: safeId(root.usageElementId, `${path}.usageElementId`),
    partDefinitionElementId: safeId(
      root.partDefinitionElementId,
      `${path}.partDefinitionElementId`,
    ),
    expectedPlacement: validateExpectedPlacement(
      root.expectedPlacement,
      `${path}.expectedPlacement`,
    ),
    childCapture: {
      schemaVersion: schemaVersion as GeometryModuleChildCaptureSchema,
      artifactId: safeId(childCapture.artifactId, `${path}.childCapture.artifactId`),
      fingerprint: validateContentFingerprint(
        childCapture.fingerprint,
        `${path}.childCapture.fingerprint`,
      ),
    },
  });
}

function validateExpectedPlacement(
  value: unknown,
  path: string,
): AssemblyIntegrityExpectedPlacement {
  const root = exactRecord(value, ["translationMm", "rotationDeg"], path);
  return deepFreeze({
    translationMm: vector3(root.translationMm, `${path}.translationMm`),
    rotationDeg: vector3(root.rotationDeg, `${path}.rotationDeg`),
  });
}

async function assembleBundle(
  manifest: AssemblyIntegrityInputBundleManifest,
  captureBytes: Uint8Array,
  assemblyStep: Uint8Array,
): Promise<AssemblyIntegrityInputBundle> {
  const manifestBytes = new TextEncoder().encode(deterministicJson(manifest));
  if (manifestBytes.byteLength > ASSEMBLY_INTEGRITY_MAXIMUM_MANIFEST_BYTES) {
    throw new TypeError("The assembly-integrity bundle manifest exceeds its ceiling.");
  }
  const lengthBytes = new TextEncoder().encode(`${manifestBytes.byteLength}\n`);
  const bytes = concatenate(
    ASSEMBLY_INTEGRITY_INPUT_BUNDLE_MAGIC,
    lengthBytes,
    manifestBytes,
    captureBytes,
    assemblyStep,
  );
  if (bytes.byteLength > ASSEMBLY_INTEGRITY_MAXIMUM_BUNDLE_BYTES) {
    throw new TypeError("The assembly-integrity input bundle exceeds its ceiling.");
  }
  return await parseAssemblyIntegrityInputBundle(bytes);
}

async function parseGeometryModuleCapture(
  value: unknown,
  path: string,
): Promise<GeometryModuleCapture> {
  const capture = await parseCanonicalGeometryCapture(value);
  if (capture.schemaVersion !== GEOMETRY_MODULE_CAPTURE_SCHEMA) {
    throw new TypeError(`${path} must be geometry-module-capture/1.0.`);
  }
  return capture;
}

function assertGeometryModuleArtifactId(
  reference: AssemblyIntegrityGeometryModuleReference,
  path: string,
): void {
  if (reference.artifactId !== `geometry-${reference.fingerprint.digest}`) {
    throw new TypeError(`${path}.artifactId must be geometry-<digest>.`);
  }
}

function assertCaptureStepIdentity(
  capture: GeometryModuleCapture,
  stepSha256: string,
  stepByteCount: number,
  path: string,
): void {
  if (
    capture.assemblyStep.fingerprint.digest !== stepSha256 ||
    capture.assemblyStep.bytes !== stepByteCount
  ) {
    throw new TypeError(
      `${path} canonical STEP must equal the exact assembly STEP attested by the module capture.`,
    );
  }
}

function assertOccurrencesMatchCapture(
  occurrences: readonly AssemblyIntegrityOccurrenceIdentity[],
  capture: GeometryModuleCapture,
  path: string,
): void {
  assertOccurrenceBound(capture.children.length, path);
  if (occurrences.length !== capture.children.length) {
    throw new TypeError(`${path} must cover every immediate module occurrence.`);
  }
  for (const [index, occurrence] of occurrences.entries()) {
    const child = capture.children[index]!;
    if (
      occurrence.usageElementId !== child.usageElementId ||
      occurrence.partDefinitionElementId !== child.partDefinitionElementId ||
      !samePlacement(occurrence.expectedPlacement, child.placement) ||
      occurrence.childCapture.schemaVersion !== child.childGeometry.schemaVersion ||
      occurrence.childCapture.artifactId !== child.childGeometry.artifactId ||
      !fingerprintsEqual(
        occurrence.childCapture.fingerprint,
        child.childGeometry.fingerprint,
      )
    ) {
      throw new TypeError(`${path}[${index}] diverges from the exact module capture.`);
    }
  }
}

function assertOccurrenceBound(value: number, path: string): void {
  if (value < 1 || value > ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES) {
    throw new TypeError(
      `${path}.occurrences exceeds the ${ASSEMBLY_INTEGRITY_MAXIMUM_OCCURRENCES} occurrence ceiling.`,
    );
  }
}

function assertUsageOrder(
  occurrences: readonly AssemblyIntegrityOccurrenceIdentity[],
  path: string,
): void {
  for (let index = 1; index < occurrences.length; index += 1) {
    if (occurrences[index - 1]!.usageElementId >= occurrences[index]!.usageElementId) {
      throw new TypeError(
        `${path}.occurrences must be ordered by exact usage identity.`,
      );
    }
  }
}

function assertStepBytes(value: Uint8Array, path: string): void {
  if (value.byteLength > ASSEMBLY_INTEGRITY_MAXIMUM_STEP_BYTES) {
    throw new TypeError(`${path} exceeds the canonical STEP ceiling.`);
  }
  validatePart21(value, path);
}

function vector3(value: unknown, path: string): readonly [number, number, number] {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${path} must be an array of exactly three finite numbers.`);
  }
  return deepFreeze(
    [
      finite(value[0], `${path}[0]`),
      finite(value[1], `${path}[1]`),
      finite(value[2], `${path}[2]`),
    ] as const,
  );
}

function samePlacement(
  left: AssemblyIntegrityExpectedPlacement,
  right: {
    readonly translationMm: readonly [number, number, number];
    readonly rotationDeg: readonly [number, number, number];
  },
): boolean {
  return left.translationMm.every((value, index) =>
    value === right.translationMm[index]
  ) && left.rotationDeg.every((value, index) => value === right.rotationDeg[index]);
}

function copyBytes(value: unknown, path: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError(`${path} must be bytes.`);
  return Uint8Array.from(value);
}

function concatenate(...parts: readonly Uint8Array[]): Uint8Array {
  const result = new Uint8Array(
    parts.reduce((total, part) => total + part.byteLength, 0),
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

function sha256Hex(value: unknown, path: string): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) {
    throw new TypeError(`${path} must be a lowercase SHA-256 digest.`);
  }
  return value;
}
