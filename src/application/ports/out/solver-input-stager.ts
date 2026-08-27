import type { ContentFingerprint } from "../../../domain/kernel/primitives.ts";

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
