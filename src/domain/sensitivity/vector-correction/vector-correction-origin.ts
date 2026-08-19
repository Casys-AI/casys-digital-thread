/**
 * Single origin of (z, u) for a vector-correction proposal.
 *
 * The study-base measurement is the only allowed u_actual. The evaluation
 * must cite the study-base observation `sensitivity-base-<metric>-<digest>`
 * whose quantity Object.is-equals that measurement. The driver is the study
 * baseValue only after that join succeeds — never a default, never a proof
 * geometry.
 */

import type {
  RequirementEvaluation,
  RequirementOperator,
  ThreadObservation,
  TracedRequirement,
} from "../../thread/thread-snapshot.ts";

export const VECTOR_CORRECTION_UNLINKED_LABEL = "UNLINKED" as const;

export type VectorCorrectionOriginReason =
  | "evaluation-not-failed"
  | "evaluation-missing-comparison"
  | "evaluation-not-fresh"
  | "evaluation-unlinked";

export interface VectorCorrectionStudyFacts {
  readonly digest: string;
  readonly baseValue: { readonly value: number; readonly unit: string };
  readonly metrics: readonly { readonly id: string; readonly unit: string }[];
  readonly baseMeasurements: readonly {
    readonly metric: string;
    readonly value: number;
    readonly unit: string;
  }[];
}

export interface ResolvedVectorCorrectionOrigin {
  readonly status: "resolved";
  readonly metricId: string;
  readonly actual: { readonly value: number; readonly unit: string };
  readonly currentDriver: { readonly value: number; readonly unit: string };
  readonly observationId: string;
  readonly operator: RequirementOperator;
  readonly limit: { readonly value: number; readonly unit: string };
  readonly normalizedUnit: string;
}

export interface UnresolvedVectorCorrectionOrigin {
  readonly status: "unresolved";
  readonly reason: VectorCorrectionOriginReason;
  readonly detail: string;
  readonly label?: typeof VECTOR_CORRECTION_UNLINKED_LABEL;
}

export type VectorCorrectionOrigin =
  | ResolvedVectorCorrectionOrigin
  | UnresolvedVectorCorrectionOrigin;

export function sensitivityBaseObservationId(
  metricId: string,
  studyDigest: string,
): string {
  return `sensitivity-base-${metricId}-${studyDigest}`;
}

/**
 * Resolve the unique (z, u) origin from the study-base measurement and the
 * evaluation that cites it. Failure is UNLINKED; nothing is invented.
 */
export function resolveVectorCorrectionOrigin(input: {
  readonly evaluation: RequirementEvaluation;
  readonly requirement: TracedRequirement | undefined;
  readonly observations: readonly ThreadObservation[];
  readonly study: VectorCorrectionStudyFacts;
}): VectorCorrectionOrigin {
  const { evaluation, requirement, observations, study } = input;

  if (evaluation.freshness.status !== "fresh") {
    return {
      status: "unresolved",
      reason: "evaluation-not-fresh",
      detail:
        `Evaluation "${evaluation.id}" freshness is "${evaluation.freshness.status}"; ` +
        `only a fresh evaluation may authorize a correction review.`,
    };
  }

  if (evaluation.status !== "fail") {
    return {
      status: "unresolved",
      reason: "evaluation-not-failed",
      detail: `Evaluation "${evaluation.id}" has status "${evaluation.status}"; ` +
        `correction is only applicable to a "fail" evaluation.`,
    };
  }

  const comparison = evaluation.comparison;
  if (comparison === undefined) {
    return {
      status: "unresolved",
      reason: "evaluation-missing-comparison",
      detail: `Evaluation "${evaluation.id}" has no comparison; ` +
        `the requirement operator and limit are unavailable.`,
    };
  }

  const metricId = requirement?.criterion.metric;
  if (requirement === undefined || metricId === undefined || metricId === "") {
    return unlinked(
      `Evaluation "${evaluation.id}" does not name a requirement metric ` +
        `that can join a study-base observation.`,
    );
  }

  if (!study.metrics.some((metric) => metric.id === metricId)) {
    return unlinked(
      `Metric "${metricId}" is not a declared metric of the bound study capture.`,
    );
  }

  const baseMeasurement = study.baseMeasurements.find((item) =>
    item.metric === metricId
  );
  if (baseMeasurement === undefined) {
    return unlinked(
      `Study capture has no base measurement for metric "${metricId}".`,
    );
  }

  const observationId = sensitivityBaseObservationId(metricId, study.digest);
  if (!evaluation.observationIds.includes(observationId)) {
    return unlinked(
      `Evaluation "${evaluation.id}" does not cite study-base observation ` +
        `"${observationId}".`,
    );
  }
  if (comparison.observationId !== observationId) {
    return unlinked(
      `Evaluation "${evaluation.id}" comparison cites "${comparison.observationId}" ` +
        `rather than study-base observation "${observationId}".`,
    );
  }

  const observation = observations.find((item) => item.id === observationId);
  if (observation === undefined || observation.freshness.status !== "fresh") {
    return unlinked(
      `Study-base observation "${observationId}" is absent or not fresh.`,
    );
  }
  if (observation.metric !== metricId) {
    return unlinked(
      `Observation "${observationId}" metric "${observation.metric}" ` +
        `does not match evaluation metric "${metricId}".`,
    );
  }
  if (
    !Object.is(observation.quantity.value, baseMeasurement.value) ||
    observation.quantity.unit !== baseMeasurement.unit
  ) {
    return unlinked(
      `Observation "${observationId}" quantity is not Object.is-equal ` +
        `to the study-base measurement for "${metricId}".`,
    );
  }

  return {
    status: "resolved",
    metricId,
    actual: {
      value: baseMeasurement.value,
      unit: baseMeasurement.unit,
    },
    currentDriver: {
      value: study.baseValue.value,
      unit: study.baseValue.unit,
    },
    observationId,
    operator: comparison.operator,
    limit: {
      value: comparison.limit.value,
      unit: comparison.limit.unit,
    },
    normalizedUnit: comparison.normalizedUnit,
  };
}

function unlinked(detail: string): UnresolvedVectorCorrectionOrigin {
  return {
    status: "unresolved",
    reason: "evaluation-unlinked",
    detail,
    label: VECTOR_CORRECTION_UNLINKED_LABEL,
  };
}
