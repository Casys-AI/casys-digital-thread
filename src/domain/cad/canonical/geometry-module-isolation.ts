/**
 * Isolation recross for a geometry-module draft or capture.
 *
 * The caller supplies no program. The isolated profile lives on the existing
 * receipt. This module only recrosses that record to the input-bundle digest
 * and the produced assembly STEP plus binary GLB. It does not restate receipt
 * fields.
 */

import type { IsolatedCodeExecutionReceiptRecord } from "../../compile/isolation/isolated-code-execution.ts";
import {
  type IsolatedCodeOutputDeclaration,
  type IsolatedCodeProfileRef,
  isolatedCodeRefsEqual,
  isolatedCodeTerminationIsRejected,
  validateIsolatedCodeExecutionReceiptRecord,
} from "../../compile/isolation/isolated-code-execution.ts";
import type {
  GeometryModuleAssetIdentity,
  GeometryModuleInputBundleIdentity,
} from "./geometry-module-identities.ts";
import { invalid } from "./geometry-module-identities.ts";

export const GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE = Object.freeze(
  {
    id: "geometry-module-assembly-isolated-v1",
    version: "1.0.0",
  } satisfies IsolatedCodeProfileRef,
);

export const GEOMETRY_MODULE_ASSEMBLY_STEP_OUTPUT = Object.freeze(
  {
    role: "assembly-step",
    basename: "assembly.step",
    mediaType: "model/step",
    format: "step",
  } satisfies IsolatedCodeOutputDeclaration,
);

export const GEOMETRY_MODULE_ASSEMBLY_GLB_OUTPUT = Object.freeze(
  {
    role: "assembly-glb",
    basename: "assembly.glb",
    mediaType: "model/gltf-binary",
    format: "glb",
  } satisfies IsolatedCodeOutputDeclaration,
);

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
      GEOMETRY_MODULE_ASSEMBLY_ISOLATED_PROFILE,
    )
  ) {
    invalid(
      "unresolved",
      `${path}.receipt.profile must be the code-owned geometry-module assembly isolated profile.`,
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
  if (receipt.outputs.length !== 2) {
    invalid(
      "unresolved",
      `${path}.receipt.outputs must be exactly assembly STEP and binary GLB.`,
    );
  }
  recrossOutput(
    receipt,
    GEOMETRY_MODULE_ASSEMBLY_STEP_OUTPUT,
    assemblyStep,
    `${path}.assemblyStep`,
  );
  recrossOutput(
    receipt,
    GEOMETRY_MODULE_ASSEMBLY_GLB_OUTPUT,
    assemblyGlb,
    `${path}.assemblyGlb`,
  );
  return receipt;
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
