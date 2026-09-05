/**
 * Catalogue-derived backend for one non-persistent material. Callers never
 * supply docker/microsandbox, an OCI reference, or a runtime kind.
 */

import type { AtomicCapabilityRuntimeMaterial } from "../../domain/capability/runtime/capability-runtime-catalog.ts";
import type { CapabilityRuntimeNonpersistentRemovalBackend } from "../../domain/capability/runtime/capability-runtime-nonpersistent-material-removal.ts";

export function capabilityRuntimeNonpersistentRemovalBackend(
  material: AtomicCapabilityRuntimeMaterial,
): CapabilityRuntimeNonpersistentRemovalBackend {
  if (material.launchGroup !== null) {
    throw new Error(
      "Non-persistent material removal requires launchGroup null.",
    );
  }
  if (material.kind === "oci-image" && material.lifecycle === "cache") {
    return "docker-cache";
  }
  if (material.kind === "microvm-image" && material.lifecycle === "ephemeral") {
    return "microsandbox-cache";
  }
  throw new Error(
    "Non-persistent material removal is unavailable for this catalogue material.",
  );
}
