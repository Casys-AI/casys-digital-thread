/**
 * Single reconstruction used by the review tool and the executor.
 *
 * Join the study-base observation, invert one edge, and build the closed
 * MRTR document. The caller supplies already-reopened facts; this module
 * performs no I/O.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type {
  RequirementEvaluation,
  ThreadObservation,
  TracedRequirement,
} from "../../thread/thread-snapshot.ts";
import {
  proposeVectorCorrection,
  type UnresolvedCorrection,
} from "./propose-vector-correction.ts";
import type { SensitivityEdge } from "../edges/sensitivity-edge.ts";
import {
  resolveVectorCorrectionOrigin,
  type UnresolvedVectorCorrectionOrigin,
  type VectorCorrectionStudyFacts,
} from "./vector-correction-origin.ts";
import {
  vectorCorrectionDecisionFromComputed,
  type VectorCorrectionDecisionParameters,
} from "./vector-correction-proposal.ts";

export type AssembledVectorCorrection =
  | {
    readonly status: "proposed";
    readonly decision: VectorCorrectionDecisionParameters;
  }
  | UnresolvedCorrection
  | UnresolvedVectorCorrectionOrigin;

export function assembleVectorCorrectionDecision(input: {
  readonly evaluation: RequirementEvaluation;
  readonly requirement: TracedRequirement | undefined;
  readonly observations: readonly ThreadObservation[];
  readonly study: VectorCorrectionStudyFacts;
  readonly studyCapture: {
    readonly artifactId: string;
    readonly fingerprint: ContentFingerprint;
  };
  readonly edges: readonly SensitivityEdge[];
  readonly caseDigest: string;
}): AssembledVectorCorrection {
  const origin = resolveVectorCorrectionOrigin({
    evaluation: input.evaluation,
    requirement: input.requirement,
    observations: input.observations,
    study: input.study,
  });
  if (origin.status === "unresolved") return origin;

  const proposed = proposeVectorCorrection({
    evaluation: input.evaluation,
    edges: input.edges,
    currentDriverValue: origin.currentDriver,
    metricId: origin.metricId,
    actualResponse: origin.actual,
  });
  if (proposed.status === "unresolved") return proposed;

  return {
    status: "proposed",
    decision: vectorCorrectionDecisionFromComputed({
      proposal: proposed,
      studyCapture: input.studyCapture,
      evaluationId: input.evaluation.id,
      caseDigest: input.caseDigest,
      limit: origin.limit,
    }),
  };
}
