/**
 * Exact current approved Brief V2 gate/dependency view for impact review.
 *
 * It is deliberately narrower than the project command model: only the
 * approved brief identity and immutable gate dependency facts cross this port.
 */

import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";

export interface CrossDomainImpactBriefGate {
  readonly id: string;
  readonly kind: "success-criterion" | "verification-activity";
  readonly fingerprint: ContentFingerprint;
  /**
   * Present explicitly, including an intentionally independent empty list,
   * only in Brief V2. Its absence is retained so a caller cannot turn a V1
   * historical omission into a declared independence claim.
   */
  readonly dependsOnItemIds?: readonly string[];
}

export interface CrossDomainImpactApprovedBriefGates {
  readonly projectId: string;
  readonly contractVersion: "1.0" | "2.0";
  readonly brief: {
    readonly id: string;
    readonly revision: number;
    readonly fingerprint: ContentFingerprint;
  };
  readonly gates: readonly CrossDomainImpactBriefGate[];
}

export interface CrossDomainImpactBriefGateReader {
  read(projectId: string): Promise<CrossDomainImpactApprovedBriefGates | undefined>;
}
