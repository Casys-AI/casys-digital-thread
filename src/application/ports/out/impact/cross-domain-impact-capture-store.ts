/** Content-addressed persistence for the closed impact-manifest seal capture. */

import type { CrossDomainImpactManifestSealCapture } from "../../../../domain/impact/cross-domain-impact-manifest-seal-capture.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface CrossDomainImpactManifestSealCaptureReceipt {
  readonly fingerprint: ContentFingerprint;
  readonly uri: string;
}

export interface CrossDomainImpactManifestSealCaptureStore {
  save(
    capture: CrossDomainImpactManifestSealCapture,
  ): Promise<CrossDomainImpactManifestSealCaptureReceipt>;
  read(
    fingerprint: ContentFingerprint,
  ): Promise<CrossDomainImpactManifestSealCapture | undefined>;
}
