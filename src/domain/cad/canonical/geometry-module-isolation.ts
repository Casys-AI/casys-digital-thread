/**
 * Isolation recross for a geometry-module draft or capture.
 *
 * The caller supplies no program. The isolated profile is the code-owned
 * module-assembler receipt. This module only recrosses that record to the
 * input-bundle digest and the produced assembly STEP plus binary GLB. It
 * does not restate receipt fields.
 */

import type { IsolatedCodeExecutionReceiptRecord } from "../../compile/isolation/isolated-code-execution.ts";
import {
  type IsolatedCodeOutputDeclaration,
  isolatedCodeRefsEqual,
  isolatedCodeTerminationIsRejected,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";
import {
  GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
  GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST,
} from "../module-assembly/geometry-module-assembly-execution.ts";
import type {
  GeometryModuleAssetIdentity,
  GeometryModuleInputBundleIdentity,
} from "./geometry-module-identities.ts";
import { invalid } from "./geometry-module-identities.ts";

export async function recrossGeometryModuleIsolation(
  inputBundle: GeometryModuleInputBundleIdentity,
  receiptValue: unknown,
  assemblyStep: GeometryModuleAssetIdentity,
  assemblyGlb: GeometryModuleAssetIdentity,
  path: string,
): Promise<IsolatedCodeExecutionReceiptRecord> {
  let receipt: IsolatedCodeExecutionReceiptRecord;
  try {
    receipt = await validateIsolatedCodeExecutionReceiptRecord(receiptValue);
  } catch (error) {
    invalid(
      "invalid_schema",
      error instanceof Error ? error.message : `${path}.receipt is invalid.`,
    );
  }
  if (
    !isolatedCodeRefsEqual(
      receipt.profile,
      GEOMETRY_MODULE_ASSEMBLY_EXECUTION_PROFILE,
    )
  ) {
    invalid(
      "unresolved",
      `${path}.receipt.profile must be the code-owned geometry-module assembly profile.`,
    );
  }
  if (receipt.destruction.status !== "proven") {
    invalid(
      "unresolved",
      `${path}.receipt.destruction must be proven.`,
    );
  }
  if (isolatedCodeTerminationIsRejected(receipt.termination)) {
    invalid(
      "unresolved",
      `${path}.receipt.termination must be an accepted zero exit.`,
    );
  }
  if (receipt.sourceSha256 !== inputBundle.fingerprint.digest) {
    invalid(
      "unresolved",
      `${path}.receipt.sourceSha256 must equal the input-bundle digest.`,
    );
  }
  if (receipt.outputs.length !== GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST.length) {
    invalid(
      "unresolved",
      `${path}.receipt.outputs must be exactly assembly STEP and binary GLB.`,
    );
  }
  for (const expected of GEOMETRY_MODULE_ASSEMBLY_OUTPUT_MANIFEST) {
    recrossOutput(
      receipt,
      expected,
      assetForRole(expected.role, assemblyStep, assemblyGlb, path),
      expected.role === "assembly.step"
        ? `${path}.assemblyStep`
        : `${path}.assemblyGlb`,
    );
  }
  return receipt;
}

function assetForRole(
  role: string,
  assemblyStep: GeometryModuleAssetIdentity,
  assemblyGlb: GeometryModuleAssetIdentity,
  path: string,
): GeometryModuleAssetIdentity {
  if (role === "assembly.step") return assemblyStep;
  if (role === "assembly.glb") return assemblyGlb;
  invalid(
    "unresolved",
    `${path}.receipt.outputs has an unexpected role ${role}.`,
  );
}

function recrossOutput(
  receipt: IsolatedCodeExecutionReceiptRecord,
  expected: IsolatedCodeOutputDeclaration,
  asset: GeometryModuleAssetIdentity,
  path: string,
): void {
  const output = receipt.outputs.find((candidate) => candidate.role === expected.role);
  if (output === undefined) {
    invalid("unresolved", `${path} must match receipt role ${expected.role}.`);
  }
  if (
    output.basename !== expected.basename ||
    output.mediaType !== expected.mediaType ||
    output.format !== expected.format
  ) {
    invalid(
      "unresolved",
      `${path} must use the exact expected ${expected.role} role and format.`,
    );
  }
  if (
    output.sha256 !== asset.fingerprint.digest ||
    output.byteCount !== asset.bytes
  ) {
    invalid(
      "unresolved",
      `${path} must equal the exact receipt output fingerprint and byte count.`,
    );
  }
}
