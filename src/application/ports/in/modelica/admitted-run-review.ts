/**
 * Inward port for preparing the human review of one admitted Modelica run.
 *
 * The public caller names only the project. A server-owned resolver selects
 * the unique current Thread tip and its unique fresh sealed compilation
 * admission whose compilation target/source is Modelica before delegating to
 * the exact command below. Runtime, isolation, output, profile and source
 * facts stay behind server-owned outward ports.
 */

import type { CompilationAdmissionRunOperation } from "../../../../domain/compile/admission/compilation-admission-run-operation.ts";
import type { ModelicaAdmittedRunAdmission } from "../../../../domain/modelica/admitted/run-proposal.ts";
import type { ContentFingerprint } from "../../../../domain/kernel/primitives.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringThreadSnapshotBasis,
} from "../../../../domain/project/engineering-project.ts";

/** Closed public request: no Thread or admission identity is caller-selected. */
export interface ProjectAdmittedModelicaRunReviewRequest {
  readonly projectId: string;
}

/**
 * Exact server-internal join passed to the sealed-admission validator.
 *
 * The run executor also uses this shape to revalidate a signed MRTR against
 * its immutable basis. It is intentionally not the MCP tool input schema.
 */
export interface ProjectAdmittedModelicaRunReviewCommand {
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly artifactId: string;
  readonly artifactFingerprint: ContentFingerprint;
}

export interface ProjectAdmittedModelicaRunReviewResult {
  readonly admission: ModelicaAdmittedRunAdmission;
  readonly decisionParameters: readonly EngineeringDecisionProposalParameter[];
  /**
   * Registered `simulate.run-admitted-modelica@1` work-item operation. Reuse
   * verbatim: `compilationAdmission` names the selected admission artifact on
   * the current review Thread basis, never a historical creation snapshot.
   */
  readonly operation: CompilationAdmissionRunOperation;
}

export interface ProjectAdmittedModelicaRunReviewUseCase {
  execute(value: unknown): Promise<ProjectAdmittedModelicaRunReviewResult>;
}
