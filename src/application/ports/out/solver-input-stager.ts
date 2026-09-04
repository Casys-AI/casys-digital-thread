import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";
import type {
  CapabilityRuntimeLease,
} from "../../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeMaterialIdentity } from "../../../domain/capability/runtime/capability-runtime-material.ts";
import type { CapabilityRuntimeLaunchGroupReference } from "../../../domain/capability/runtime/capability-runtime-launch-group.ts";

/**
 * Stage exact STEP bytes into the private CalculiX input volume.
 *
 * Callers supply bytes and their attested digest. The returned location is
 * an opaque code-owned provider path. Host paths, Docker handles and
 * thread-assets URIs never cross this port.
 */
export interface SolverInputStager {
  stage(input: {
    readonly bytes: Uint8Array;
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }): Promise<{
    readonly stagedAsset: { readonly location: string };
  }>;

  /**
   * Re-read previously staged isolated STEP bytes by attested digest.
   * `undefined` means the private cache has no matching object — never invent
   * a new CAD run to fill the hole.
   */
  read(input: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  }): Promise<Uint8Array | undefined>;
}

/**
 * Builds a private input stager only after an exact capability JIT lease is
 * active. The factory owns container discovery and must reject foreign or
 * stale launch-group membership; neither an agent nor a project supplies a
 * Docker container, Compose project, volume, endpoint or provider path.
 */
export interface CapabilitySessionSolverInputStagerFactory {
  forActiveCapabilitySession(input: {
    readonly lease: CapabilityRuntimeLease;
    readonly launchGroup: CapabilityRuntimeLaunchGroupReference;
    readonly material: CapabilityRuntimeMaterialIdentity;
  }): Promise<SolverInputStager>;
}
