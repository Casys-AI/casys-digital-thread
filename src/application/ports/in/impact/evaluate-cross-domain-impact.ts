/**
 * Internal server command for one X07 impact recross.
 *
 * It is intentionally not an agent-facing JSON command.  The registered
 * executor supplies its sealed run basis and start time; no caller selects a
 * branch, edge, artifact, outcome, provider, or approval.
 */

import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { CrossDomainImpactEvaluationCapture } from "../../../../domain/impact/cross-domain-impact-evaluation-capture.ts";
import type { CrossDomainImpactReference } from "../../../../domain/impact/cross-domain-impact-manifest.ts";

export interface EvaluateCrossDomainImpactCommand {
  readonly projectId: string;
  readonly trustedRunId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly evaluatedAt: string;
}

export interface EvaluateCrossDomainImpactDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type EvaluateCrossDomainImpactResult =
  | {
    readonly status: "resolved";
    /** Exact closed capture candidate; persistence remains in the adapter. */
    readonly capture: CrossDomainImpactEvaluationCapture;
    /**
     * Exact artifact identities reread by the server and still present on the
     * queued Thread basis.  This is server-derived; it is never a caller
     * supplied selection.
     */
    readonly artifactInputs: readonly CrossDomainImpactReference[];
    /** The exact X06 document named by the current work's required dependsOn leaf. */
    readonly manifestSealArtifactId: string;
    readonly diagnostics: readonly EvaluateCrossDomainImpactDiagnostic[];
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostics: readonly EvaluateCrossDomainImpactDiagnostic[];
  };

export interface EvaluateCrossDomainImpactUseCase {
  execute(
    command: EvaluateCrossDomainImpactCommand,
  ): Promise<EvaluateCrossDomainImpactResult>;
}
