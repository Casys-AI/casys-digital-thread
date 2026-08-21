/**
 * Exact opaque manifest reread for the cross-domain impact seal.
 *
 * The caller owns only a content-addressed locator.  Paths, CAS namespaces,
 * and bytes stay behind the adapter; a returned manifest has already passed
 * its closed domain validation.
 */

import type { CrossDomainImpactManifest } from "../../../../domain/impact/cross-domain-impact-manifest.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface CrossDomainImpactManifestReference {
  readonly fingerprint: ContentFingerprint;
}

export interface ReopenedCrossDomainImpactManifest {
  /** Content address of the complete canonical manifest document. */
  readonly reference: CrossDomainImpactManifestReference;
  /** Server-issued immutable URI; never accepted as caller input. */
  readonly uri: string;
  readonly manifest: CrossDomainImpactManifest;
}

export interface CrossDomainImpactManifestReader {
  read(
    reference: CrossDomainImpactManifestReference,
  ): Promise<ReopenedCrossDomainImpactManifest | undefined>;
}
