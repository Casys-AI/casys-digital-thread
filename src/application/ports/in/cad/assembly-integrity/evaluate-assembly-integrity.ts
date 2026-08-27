/**
 * Internal server command for the trusted, provider-free L4 evaluation.
 *
 * It is never a public tool payload.  The registered run supplies its exact
 * basis and timestamps; module, STEP, L3 capture, observation and method are
 * reselected and reread by the server.
 */

import type {
  AssemblyIntegrityEvaluationCapture,
} from "../../../../../domain/cad/assembly-integrity/assembly-integrity-evaluation.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type { EngineeringThreadSnapshotBasis } from "../../../../../domain/project/engineering-project.ts";

export interface EvaluateAssemblyIntegrityCommand {
  readonly projectId: string;
  readonly trustedRunId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly evaluatedAt: string;
}

export interface EvaluateAssemblyIntegrityDiagnostic {
  readonly code: string;
  readonly message: string;
}

export interface AssemblyIntegrityEvaluationArtifactInput {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
}

export type EvaluateAssemblyIntegrityResult =
  | {
    readonly status: "resolved";
    readonly capture: AssemblyIntegrityEvaluationCapture;
    /** Server-reread exact module, STEP and L3 observation artifacts, in order. */
    readonly artifactInputs: readonly AssemblyIntegrityEvaluationArtifactInput[];
    readonly diagnostics: readonly EvaluateAssemblyIntegrityDiagnostic[];
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostics: readonly EvaluateAssemblyIntegrityDiagnostic[];
  };

export interface EvaluateAssemblyIntegrityUseCase {
  execute(
    command: EvaluateAssemblyIntegrityCommand,
  ): Promise<EvaluateAssemblyIntegrityResult>;
}
