/**
 * Content-addressed draft persistence for a closed impact manifest.
 *
 * Application code saves a server-constructed canonical document and
 * reopens it by opaque fingerprint. Paths, URIs, and the file adapter
 * stay behind this port.
 */

import type { CrossDomainImpactManifest } from "../../../../domain/impact/cross-domain-impact-manifest.ts";
import type {
  CrossDomainImpactManifestReader,
  CrossDomainImpactManifestReference,
} from "./cross-domain-impact-manifest-reader.ts";

export interface CrossDomainImpactManifestStoreReceipt {
  readonly reference: CrossDomainImpactManifestReference;
}

export interface CrossDomainImpactManifestStore
  extends CrossDomainImpactManifestReader {
  save(
    value: CrossDomainImpactManifest,
  ): Promise<CrossDomainImpactManifestStoreReceipt>;
}
