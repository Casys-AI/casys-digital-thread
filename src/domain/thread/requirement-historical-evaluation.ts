/**
 * Read-only historical-unjoined evaluation context for recaptured
 * requirements.
 *
 * Current verdict, observationIds and freshness stay on the live
 * ThreadRequirement. This record never joins, promotes, or replays a
 * solver. Old and new architecture bases are named separately; they are
 * not an applicability claim. Historical sensitivity is a measured
 * relation on its original study-base evaluation, never a new result node.
 */

import type { LocalSensitivityMeasurement } from "./engineering-assertion.ts";
import type { RequirementOperator } from "./thread-snapshot.ts";

export const HISTORICAL_UNJOINED_RELATION = "historical-unjoined" as const;

export interface ThreadRequirementHistoricalRef {
  readonly id: string;
  readonly fingerprint: string;
}

/**
 * Observation id plus every exact source artifact named on the observation.
 * FEA v3 records result JSON and evidence together; a singleton source is
 * not a valid projection of that producer.
 */
export interface ThreadRequirementHistoricalObservationRef {
  readonly id: string;
  readonly sourceArtifacts: readonly ThreadRequirementHistoricalRef[];
}

export interface ThreadRequirementHistoricalCaptureRef
  extends ThreadRequirementHistoricalRef {
  readonly producerRunId: string;
}

export interface ThreadRequirementHistoricalNativeIdentities {
  readonly targetElementId: string;
  readonly requirementUsageId: string;
  readonly constraintUsageId: string;
  readonly criterion: {
    readonly metric: string;
    readonly operator: RequirementOperator;
    readonly limit: { readonly value: number; readonly unit: string };
  };
}

export interface ThreadRequirementHistoricalArchitectureBase {
  readonly artifactId: string;
  readonly fingerprint: string;
  readonly producerRunId: string;
}

export type ThreadRequirementHistoricalEvaluationFamily = "study-base";

export type ThreadRequirementHistoricalChainStatus = "complete" | "partial";

export type ThreadRequirementHistoricalChainReason =
  | "ambiguous-supersedes"
  | "cyclic-supersedes"
  | "missing-predecessor"
  | "missing-cas"
  | "corrupt-cas"
  | "disconnected-architecture"
  | "native-identity-mismatch"
  | "wrong-producer-run"
  | "duplicate-evaluation-id"
  | "conflicting-provenance"
  | "gap";

/**
 * Bounded walk of the exact recapture predecessor chain. `partial` keeps
 * every verified hop and names why a later hop could not be completed.
 */
export interface ThreadRequirementHistoricalChain {
  readonly status: ThreadRequirementHistoricalChainStatus;
  readonly hops: number;
  readonly reason?: ThreadRequirementHistoricalChainReason;
  readonly stoppedAtRequirementId?: string;
}

export interface ThreadRequirementHistoricalQuantity {
  readonly value: number;
  readonly unit: string;
}

/**
 * Measured local sensitivity proven on the original study-base evaluation.
 * Not a current catalog join and not a standalone graph node.
 */
export interface ThreadRequirementHistoricalMeasuredSensitivity {
  readonly status: "measured";
  readonly method: LocalSensitivityMeasurement["method"];
  readonly parameter: {
    readonly id: string;
    readonly lower: ThreadRequirementHistoricalQuantity;
    readonly upper: ThreadRequirementHistoricalQuantity;
  };
  readonly measurement: LocalSensitivityMeasurement;
  readonly study: ThreadRequirementHistoricalRef;
  readonly studyCase: ThreadRequirementHistoricalRef & {
    readonly digest: string;
  };
  readonly baseEvaluation: ThreadRequirementHistoricalRef;
  readonly originalRequirementId: string;
  readonly originalEvaluationId: string;
  readonly predecessorArchitecture: ThreadRequirementHistoricalArchitectureBase;
}

export interface ThreadRequirementHistoricalUnavailableSensitivity {
  readonly status: "unavailable";
  readonly reason: string;
}

export type ThreadRequirementHistoricalSensitivity =
  | ThreadRequirementHistoricalMeasuredSensitivity
  | ThreadRequirementHistoricalUnavailableSensitivity;

export interface ThreadRequirementHistoricalEvaluation {
  readonly relation: typeof HISTORICAL_UNJOINED_RELATION;
  readonly hopIndex: number;
  readonly currentRequirementId: string;
  readonly predecessorRequirementId: string;
  readonly evaluationId: string;
  readonly status: "pass" | "fail" | "unresolved";
  readonly evaluatedAt: string;
  readonly evaluationFamily?: ThreadRequirementHistoricalEvaluationFamily;
  readonly observations: readonly ThreadRequirementHistoricalObservationRef[];
  readonly evidence: readonly ThreadRequirementHistoricalRef[];
  readonly predecessorCapture: ThreadRequirementHistoricalCaptureRef;
  readonly currentArchitecture: ThreadRequirementHistoricalArchitectureBase;
  readonly predecessorArchitecture: ThreadRequirementHistoricalArchitectureBase;
  readonly native: ThreadRequirementHistoricalNativeIdentities;
  readonly sensitivity?: ThreadRequirementHistoricalSensitivity;
}

export function compareHistoricalEvaluations(
  left: ThreadRequirementHistoricalEvaluation,
  right: ThreadRequirementHistoricalEvaluation,
): number {
  return left.hopIndex - right.hopIndex ||
    left.evaluatedAt.localeCompare(right.evaluatedAt) ||
    left.evaluationId.localeCompare(right.evaluationId);
}

export function sortHistoricalEvaluations(
  items: readonly ThreadRequirementHistoricalEvaluation[],
): ThreadRequirementHistoricalEvaluation[] {
  return [...items].sort(compareHistoricalEvaluations);
}
