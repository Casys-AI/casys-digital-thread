/**
 * Server-side Thread reread needed to recross one impact manifest.
 *
 * This port deliberately returns facts already selected by the manifest.  It
 * has no branch selector, provider reference, solver request, or UI state.
 */

import type {
  CrossDomainImpactManifest,
  CrossDomainImpactProjectIdentity,
  CrossDomainImpactReference,
  CrossDomainImpactSourceAnchor,
  CrossDomainImpactSubjectIdentity,
  CrossDomainImpactThreadBasis,
} from "../../../../domain/impact/cross-domain-impact-manifest.ts";
import type { ThreadFreshnessStatus } from "../../../../domain/thread/thread-snapshot.ts";

/**
 * A server reread can distinguish an absent durable record from a present but
 * inexact lineage. The application maps this directly to the literal review
 * states; adapters never invent a favorable replacement fact.
 */
export class CrossDomainImpactThreadLineageReadError extends Error {
  constructor(
    readonly status: "unavailable" | "unresolved",
    message: string,
  ) {
    super(message);
    this.name = "CrossDomainImpactThreadLineageReadError";
  }
}

export interface CrossDomainImpactMechanicalEvidenceRecross {
  readonly assertionId: string;
  readonly evidence: CrossDomainImpactReference;
  readonly evidenceFreshness: ThreadFreshnessStatus;
  /**
   * Exhaustive current consumption star of the evidence producer, recrossed
   * against the assertion. This is not an X07 evaluation input.
   */
  readonly consumptions: readonly CrossDomainImpactEvidenceRecrossConsumption[];
}

export interface CrossDomainImpactEvidenceRecrossConsumption {
  readonly id: string;
  readonly consumerEvidence: CrossDomainImpactReference;
  readonly input: CrossDomainImpactReference;
}

export interface CrossDomainImpactThreadLineage {
  readonly project: CrossDomainImpactProjectIdentity;
  readonly subject: CrossDomainImpactSubjectIdentity;
  readonly basis: CrossDomainImpactThreadBasis;
  /** Every returned anchor exactly matches the named manifest anchor. */
  readonly sourceAnchors: readonly CrossDomainImpactSourceAnchor[];
  /** One exact reread for every declared mechanical independence assertion. */
  readonly mechanicalEvidence: readonly CrossDomainImpactMechanicalEvidenceRecross[];
}

export interface CrossDomainImpactThreadLineageReader {
  read(
    input: {
      readonly projectId: string;
      readonly manifest: CrossDomainImpactManifest;
    },
  ): Promise<CrossDomainImpactThreadLineage | undefined>;
}
