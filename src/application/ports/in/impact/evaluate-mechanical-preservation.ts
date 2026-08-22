/**
 * Internal server command for one X11 mechanical preservation recross.
 *
 * It is intentionally not an agent-facing JSON command. The registered
 * executor supplies its sealed run basis and start time; no caller selects a
 * branch, assertion, FEA artifact, closeout, verdict, provider, or approval.
 */

import type { EngineeringThreadSnapshotBasis } from "../../../../domain/project/engineering-project.ts";
import type { MechanicalPreservationCapture } from "../../../../domain/impact/cross-domain-impact-mechanical-preservation-capture.ts";
import type { CrossDomainImpactReference } from "../../../../domain/impact/cross-domain-impact-manifest.ts";

export interface EvaluateMechanicalPreservationCommand {
  readonly projectId: string;
  readonly trustedRunId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly evaluatedAt: string;
}

export interface EvaluateMechanicalPreservationDiagnostic {
  readonly code: string;
  readonly message: string;
}

export type EvaluateMechanicalPreservationResult =
  | {
    readonly status: "resolved";
    readonly capture: MechanicalPreservationCapture;
    readonly artifactInputs: readonly CrossDomainImpactReference[];
    readonly decisionArtifactId: string;
    readonly diagnostics: readonly EvaluateMechanicalPreservationDiagnostic[];
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostics: readonly EvaluateMechanicalPreservationDiagnostic[];
  };

export interface EvaluateMechanicalPreservationUseCase {
  execute(
    command: EvaluateMechanicalPreservationCommand,
  ): Promise<EvaluateMechanicalPreservationResult>;
}
