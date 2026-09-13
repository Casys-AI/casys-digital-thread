/**
 * Stage exact reviewed geometry bytes onto a provider-readable location.
 *
 * Callers supply bytes, the attested digest, and a caller-owned filename.
 * The returned sha256 is computed from the staged bytes and must match.
 * Host paths and Docker handles stay behind the adapter.
 *
 * Documentary printability and print-estimate observe paths use a host export
 * volume. Measured DFM uses a lease-bound owned-container factory instead.
 * This is not `SolverInputStager` (CalculiX private volume) and not a CAD-only
 * exporter.
 */

import type {
  CapabilityRuntimeLease,
} from "../../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../../../domain/capability/runtime/capability-runtime-launch-group.ts";

export interface GeometryExportStager {
  stage(input: {
    readonly bytes: Uint8Array;
    readonly digest: string;
    readonly fileName: string;
  }): Promise<{
    readonly path: string;
    readonly sha256: string;
    readonly byteCount: number;
  }>;
}

/**
 * Builds a geometry stager only after an exact capability JIT lease is active.
 * The factory owns container discovery and must reject foreign or stale
 * launch-group membership; neither an agent nor a project supplies a Docker
 * container, Compose project, volume, endpoint or provider path.
 */
export interface CapabilitySessionGeometryExportStagerFactory {
  forActiveCapabilitySession(input: {
    readonly lease: CapabilityRuntimeLease;
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
    readonly material: CapabilityRuntimeMaterialIdentity;
  }): Promise<GeometryExportStager>;
}
