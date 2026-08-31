/**
 * Provider-neutral result of assembling one closed geometry-module bundle.
 *
 * Native provider or isolation evidence stays behind the adapter. This receipt
 * binds the stable assembly capability to exact input and output identities.
 */

import {
  deepFreeze,
  exactRecord,
  literalValue,
  positiveInteger,
  safeId,
  safeVersion,
} from "../../kernel/case-validation.ts";
import { GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY } from "../../capability/engineering-capability.ts";
import { fingerprintsEqual } from "../../kernel/deterministic-json.ts";
import type { ContentFingerprint } from "../../kernel/primitives.ts";

export const GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA =
  "geometry-module-assembly-receipt/1.0" as const;

export const GEOMETRY_MODULE_ASSEMBLY_ASSETS = Object.freeze(
  {
    step: Object.freeze({
      role: "assembly.step",
      basename: "assembly.step",
      mediaType: "model/step",
      format: "step-ap214",
    }),
    glb: Object.freeze({
      role: "assembly.glb",
      basename: "assembly.glb",
      mediaType: "model/gltf-binary",
      format: "glb",
    }),
  } as const,
);

export interface GeometryModuleAssemblyReceiptAsset {
  readonly role: "assembly.step" | "assembly.glb";
  readonly basename: "assembly.step" | "assembly.glb";
  readonly mediaType: "model/step" | "model/gltf-binary";
  readonly format: "step-ap214" | "glb";
  readonly fingerprint: ContentFingerprint;
  readonly byteCount: number;
}

export interface GeometryModuleAssemblyReceipt {
  readonly schemaVersion: typeof GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA;
  readonly capability: typeof GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY;
  readonly runId: string;
  readonly inputBundle: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  readonly assembly: {
    readonly step: GeometryModuleAssemblyReceiptAsset;
    readonly glb: GeometryModuleAssemblyReceiptAsset;
  };
  readonly implementation: {
    readonly id: string;
    readonly version: string;
    readonly evidenceFingerprint: ContentFingerprint;
  };
}

export interface GeometryModuleAssemblyExpectedIdentity {
  readonly inputBundle: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  readonly assemblyStep: {
    readonly fingerprint: ContentFingerprint;
    readonly bytes: number;
  };
  readonly assemblyGlb: {
    readonly fingerprint: ContentFingerprint;
    readonly bytes: number;
  };
}

export function parseGeometryModuleAssemblyReceipt(
  value: unknown,
  path = "$geometryModuleAssemblyReceipt",
): GeometryModuleAssemblyReceipt {
  const root = exactRecord(value, [
    "schemaVersion",
    "capability",
    "runId",
    "inputBundle",
    "assembly",
    "implementation",
  ], path);
  literalValue(
    root.schemaVersion,
    GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
    `${path}.schemaVersion`,
  );
  const capability = exactRecord(
    root.capability,
    ["id", "version"],
    `${path}.capability`,
  );
  literalValue(
    capability.id,
    GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY.id,
    `${path}.capability.id`,
  );
  literalValue(
    capability.version,
    GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY.version,
    `${path}.capability.version`,
  );
  const inputBundle = parseContentIdentity(
    root.inputBundle,
    `${path}.inputBundle`,
  );
  const assembly = exactRecord(
    root.assembly,
    ["step", "glb"],
    `${path}.assembly`,
  );
  const implementation = exactRecord(
    root.implementation,
    ["id", "version", "evidenceFingerprint"],
    `${path}.implementation`,
  );
  return deepFreeze({
    schemaVersion: GEOMETRY_MODULE_ASSEMBLY_RECEIPT_SCHEMA,
    capability: GEOMETRY_MODULE_IMMEDIATE_COMPOUND_CAPABILITY,
    runId: safeId(root.runId, `${path}.runId`),
    inputBundle,
    assembly: {
      step: parseAsset(
        assembly.step,
        GEOMETRY_MODULE_ASSEMBLY_ASSETS.step,
        `${path}.assembly.step`,
      ),
      glb: parseAsset(
        assembly.glb,
        GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
        `${path}.assembly.glb`,
      ),
    },
    implementation: {
      id: safeId(implementation.id, `${path}.implementation.id`),
      version: safeVersion(
        implementation.version,
        `${path}.implementation.version`,
      ),
      evidenceFingerprint: parseFingerprint(
        implementation.evidenceFingerprint,
        `${path}.implementation.evidenceFingerprint`,
      ),
    },
  });
}

export function recrossGeometryModuleAssemblyReceipt(
  value: unknown,
  expected: GeometryModuleAssemblyExpectedIdentity,
  path = "$geometryModuleAssemblyReceipt",
): GeometryModuleAssemblyReceipt {
  const receipt = parseGeometryModuleAssemblyReceipt(value, path);
  if (
    receipt.inputBundle.byteCount !== expected.inputBundle.byteCount ||
    !fingerprintsEqual(
      receipt.inputBundle.fingerprint,
      expected.inputBundle.fingerprint,
    )
  ) {
    throw new TypeError(`${path}.inputBundle differs from the exact input bundle.`);
  }
  assertAssetIdentity(
    receipt.assembly.step,
    expected.assemblyStep,
    `${path}.assembly.step`,
  );
  assertAssetIdentity(
    receipt.assembly.glb,
    expected.assemblyGlb,
    `${path}.assembly.glb`,
  );
  if (
    fingerprintsEqual(
      receipt.assembly.step.fingerprint,
      receipt.assembly.glb.fingerprint,
    )
  ) {
    throw new TypeError(`${path} STEP and GLB fingerprints must be distinct.`);
  }
  return receipt;
}

function parseAsset(
  value: unknown,
  expected:
    | typeof GEOMETRY_MODULE_ASSEMBLY_ASSETS.step
    | typeof GEOMETRY_MODULE_ASSEMBLY_ASSETS.glb,
  path: string,
): GeometryModuleAssemblyReceiptAsset {
  const asset = exactRecord(value, [
    "role",
    "basename",
    "mediaType",
    "format",
    "fingerprint",
    "byteCount",
  ], path);
  literalValue(asset.role, expected.role, `${path}.role`);
  literalValue(asset.basename, expected.basename, `${path}.basename`);
  literalValue(asset.mediaType, expected.mediaType, `${path}.mediaType`);
  literalValue(asset.format, expected.format, `${path}.format`);
  return {
    role: expected.role,
    basename: expected.basename,
    mediaType: expected.mediaType,
    format: expected.format,
    fingerprint: parseFingerprint(asset.fingerprint, `${path}.fingerprint`),
    byteCount: positiveInteger(asset.byteCount, `${path}.byteCount`),
  };
}

function parseContentIdentity(
  value: unknown,
  path: string,
): { readonly fingerprint: ContentFingerprint; readonly byteCount: number } {
  const identity = exactRecord(value, ["fingerprint", "byteCount"], path);
  return {
    fingerprint: parseFingerprint(identity.fingerprint, `${path}.fingerprint`),
    byteCount: positiveInteger(identity.byteCount, `${path}.byteCount`),
  };
}

function parseFingerprint(value: unknown, path: string): ContentFingerprint {
  const fingerprint = exactRecord(value, ["algorithm", "digest"], path);
  literalValue(fingerprint.algorithm, "sha256", `${path}.algorithm`);
  if (
    typeof fingerprint.digest !== "string" ||
    !/^[a-f0-9]{64}$/.test(fingerprint.digest)
  ) {
    throw new TypeError(`${path}.digest must be a lowercase SHA-256 digest.`);
  }
  return { algorithm: "sha256", digest: fingerprint.digest };
}

function assertAssetIdentity(
  actual: GeometryModuleAssemblyReceiptAsset,
  expected: { readonly fingerprint: ContentFingerprint; readonly bytes: number },
  path: string,
): void {
  if (
    actual.byteCount !== expected.bytes ||
    !fingerprintsEqual(actual.fingerprint, expected.fingerprint)
  ) {
    throw new TypeError(`${path} differs from the exact assembly asset.`);
  }
}
