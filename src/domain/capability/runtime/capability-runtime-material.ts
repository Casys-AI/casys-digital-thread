/**
 * Leaf vocabulary for exact runtime material identity and platform mode.
 *
 * These values are shared by supervision, launch topology and qualification
 * evidence.  Keeping them here prevents any of those concepts from owning the
 * others' lifecycle contracts.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";

/** Exact catalogue material identity, not an image tag or mutable alias. */
export interface CapabilityRuntimeMaterialIdentity {
  readonly unitId: string;
  readonly materialId: string;
  readonly imageDigest: string;
}

export type CapabilityRuntimePlatform = "linux/amd64" | "linux/arm64";
export type CapabilityRuntimeExecutionMode = "native" | "emulated";

/** Exact runtime mode later sealed beside the ROP binding. */
export interface CapabilityRuntimeMaterialRuntimeMode {
  readonly material: CapabilityRuntimeMaterialIdentity;
  readonly targetPlatform: CapabilityRuntimePlatform;
  readonly mode: CapabilityRuntimeExecutionMode;
  /** Null is reserved for an existing code-owned qualification baseline. */
  readonly qualificationAttestationFingerprint: ContentFingerprint | null;
}
