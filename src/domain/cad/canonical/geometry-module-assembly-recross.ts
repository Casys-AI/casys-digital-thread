/** Recross a normalized module-assembly receipt to canonical draft identities. */

import {
  type GeometryModuleAssemblyReceipt,
  recrossGeometryModuleAssemblyReceipt,
} from "../module-assembly/geometry-module-assembly-receipt.ts";
import type {
  GeometryModuleAssetIdentity,
  GeometryModuleInputBundleIdentity,
} from "./geometry-module-identities.ts";
import { invalid } from "./geometry-module-identities.ts";

export function recrossGeometryModuleAssembly(
  inputBundle: GeometryModuleInputBundleIdentity,
  receiptValue: unknown,
  assemblyStep: GeometryModuleAssetIdentity,
  assemblyGlb: GeometryModuleAssetIdentity,
  path: string,
): GeometryModuleAssemblyReceipt {
  try {
    return recrossGeometryModuleAssemblyReceipt(receiptValue, {
      inputBundle: {
        fingerprint: inputBundle.fingerprint,
        byteCount: inputBundle.byteCount,
      },
      assemblyStep,
      assemblyGlb,
    }, `${path}.receipt`);
  } catch (error) {
    invalid(
      "unresolved",
      error instanceof Error
        ? error.message
        : `${path}.receipt could not be recrossed.`,
    );
  }
}
