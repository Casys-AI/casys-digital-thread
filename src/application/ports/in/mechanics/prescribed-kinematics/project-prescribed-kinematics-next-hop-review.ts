/**
 * Read-only discovery of the existing prescribed-kinematics method, L4 and
 * human L5 next hops. These contracts do not create a plan, decision, run or
 * Thread successor; returned envelopes are merely the existing generic
 * project mutation grammars prepared against one exact current Thread tip.
 */

import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";
import type {
  PrescribedKinematicsEvaluationCloseoutCandidate,
} from "../../../../../domain/mechanism/prescribed-kinematics/prescribed-kinematics-evaluation-closeout.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
  EngineeringThreadSnapshotRef,
} from "../../../../../domain/project/engineering-project.ts";
import type { AgentResourceReference } from "../../../../../domain/resource/agent-resource-capture.ts";

export type PrescribedKinematicsNextHopStage =
  | "method"
  | "evaluation"
  | "closeout";

export interface ProjectPrescribedKinematicsNextHopReviewRequest {
  readonly projectId: string;
  /** Required only for the existing human-reviewed method-seal operation. */
  readonly methodResourceRef?: AgentResourceReference;
}

export interface ProjectPrescribedKinematicsNextHopEvidenceRef {
  readonly id: string;
  readonly fingerprint: ContentFingerprint;
  readonly producerRunId: string;
  readonly freshness: "fresh";
}

export interface ProjectPrescribedKinematicsNextHopAppend {
  readonly tool: "project_change_append";
  readonly arguments: {
    readonly commandId: string;
    readonly projectId: string;
    readonly baseSnapshot: EngineeringThreadSnapshotRef;
    readonly expectedRevision: number;
    readonly phases: readonly {
      readonly id: string;
      readonly name: string;
      readonly description: string;
    }[];
    readonly workItems: readonly {
      readonly id: string;
      readonly phaseId: string;
      readonly owner: "agent" | "human";
      readonly dependsOnWorkItemIds: readonly string[];
      readonly decisionIds: readonly string[];
      readonly operation: EngineeringOperationRef;
      readonly gateClaims: readonly [];
    }[];
    readonly requiredDecisions: readonly {
      readonly id: string;
      readonly phaseId: string;
      readonly title: string;
      readonly question: string;
    }[];
  };
}

export interface ProjectPrescribedKinematicsNextHopProposal {
  readonly tool: "project_decision_propose";
  readonly arguments: {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly decisionId: string;
    readonly proposal: {
      readonly summary: string;
      readonly parameters: readonly EngineeringDecisionProposalParameter[];
    };
  };
}

/**
 * A pasteable route to the existing append/propose commands. It is not an
 * approval, queue command, operation, verdict, or execution request.
 */
export interface ProjectPrescribedKinematicsNextHop {
  readonly append: ProjectPrescribedKinematicsNextHopAppend;
  readonly propose: ProjectPrescribedKinematicsNextHopProposal;
}

export interface ProjectPrescribedKinematicsMethodReviewResolved {
  readonly stage: "method";
  readonly basis: EngineeringThreadSnapshotRef;
  readonly evidence: {
    readonly sealedCase: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly observation: ProjectPrescribedKinematicsNextHopEvidenceRef;
  };
  /** Display-only closed resource identity; sealing still requires human MRTR. */
  readonly methodResourceRef: AgentResourceReference;
  readonly next: ProjectPrescribedKinematicsNextHop;
}

export interface ProjectPrescribedKinematicsEvaluationReviewResolved {
  readonly stage: "evaluation";
  readonly basis: EngineeringThreadSnapshotRef;
  readonly evidence: {
    readonly sealedCase: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly observation: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly method: ProjectPrescribedKinematicsNextHopEvidenceRef;
  };
  readonly next: ProjectPrescribedKinematicsNextHop;
}

export interface ProjectPrescribedKinematicsCloseoutReviewBranch {
  readonly candidate: PrescribedKinematicsEvaluationCloseoutCandidate;
  readonly next: ProjectPrescribedKinematicsNextHop;
}

export interface ProjectPrescribedKinematicsCloseoutReviewResolved {
  readonly stage: "closeout";
  readonly basis: EngineeringThreadSnapshotRef;
  readonly evidence: {
    readonly sealedCase: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly observation: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly method: ProjectPrescribedKinematicsNextHopEvidenceRef;
    readonly evaluation: ProjectPrescribedKinematicsNextHopEvidenceRef;
  };
  /** Present only if the exact existing L4 verdict is literal pass. */
  readonly accept?: ProjectPrescribedKinematicsCloseoutReviewBranch;
  /** Always derived from one exact existing L4 evaluation. */
  readonly reject: ProjectPrescribedKinematicsCloseoutReviewBranch;
}

export type ProjectPrescribedKinematicsNextHopReviewResult =
  | {
    readonly status: "resolved";
    readonly selected:
      | ProjectPrescribedKinematicsMethodReviewResolved
      | ProjectPrescribedKinematicsEvaluationReviewResolved
      | ProjectPrescribedKinematicsCloseoutReviewResolved;
  }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly family: "prescribed-kinematics";
    readonly stage: PrescribedKinematicsNextHopStage;
    readonly diagnostic: { readonly code: string; readonly message: string };
  };

export interface ProjectPrescribedKinematicsNextHopReviewUseCase {
  review(
    stage: PrescribedKinematicsNextHopStage,
    value: unknown,
  ): Promise<ProjectPrescribedKinematicsNextHopReviewResult>;
}
