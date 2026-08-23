/**
 * Join of study-base observations to Thread requirements.
 *
 * `analyze.run-fea-sensitivity@1` publishes observations
 * `sensitivity-base-<metric>-<digest>` and forbids evaluations.
 * `design.apply-vector-correction@1` only accepts a fail evaluation that
 * cites those exact ids. This module is the missing join: it never invents
 * a metric mapping and never emits a partial set.
 */

import { sensitivityBaseObservationId } from "../vector-correction/vector-correction-origin.ts";
import type { SensitivityStudyResult } from "../study/sensitivity-study-result.ts";
import type {
  RequirementOperator,
  ThreadObservation,
  TracedRequirement,
} from "../../thread/thread-snapshot.ts";

export const VERIFY_EVALUATE_SENSITIVITY_BASE_OPERATION = {
  id: "verify.evaluate-sensitivity-base",
  version: "1",
} as const;

/** Server-fixed observation id prefix published by `analyze.run-fea-sensitivity@1`. */
export const SENSITIVITY_BASE_OBSERVATION_ID_PREFIX = "sensitivity-base-";

/** Server-fixed capture id prefix of `verify.evaluate-sensitivity-base@1`. */
export const SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX =
  "sensitivity-base-evaluation-";

/**
 * True when the evaluation cites a study-base observation or join capture.
 * Structural ids only — never the evaluation name.
 */
export function isStudyBaseEvaluation(evaluation: {
  readonly observationIds: readonly string[];
  readonly evidenceArtifactIds: readonly string[];
}): boolean {
  return evaluation.observationIds.some((id) =>
    id.startsWith(SENSITIVITY_BASE_OBSERVATION_ID_PREFIX)
  ) ||
    evaluation.evidenceArtifactIds.some((id) =>
      id.startsWith(SENSITIVITY_BASE_EVALUATION_ARTIFACT_ID_PREFIX)
    );
}

const ORACLE_OPERATORS = new Set<RequirementOperator>(["<=", ">="]);

export type SensitivityBaseJoinReason =
  | "study-metric-unlinked"
  | "requirement-not-unique"
  | "requirement-not-fresh"
  | "observation-unlinked"
  | "observation-not-fresh"
  | "quantity-mismatch"
  | "operator-not-oracle";

export interface SensitivityBaseJoinPair {
  readonly metricId: string;
  readonly requirement: TracedRequirement;
  readonly observation: ThreadObservation;
}

export interface ResolvedSensitivityBaseJoin {
  readonly status: "resolved";
  readonly pairs: readonly SensitivityBaseJoinPair[];
}

export interface UnresolvedSensitivityBaseJoin {
  readonly status: "unresolved";
  readonly reason: SensitivityBaseJoinReason;
  readonly detail: string;
}

export type SensitivityBaseJoin =
  | ResolvedSensitivityBaseJoin
  | UnresolvedSensitivityBaseJoin;

/**
 * Resolve one pair per declared study metric. Any gap is UNLINKED for the
 * whole join — a partial evaluation set would look complete.
 */
export function resolveSensitivityBaseJoin(input: {
  readonly capture: SensitivityStudyResult;
  readonly digest: string;
  readonly observations: readonly ThreadObservation[];
  readonly requirements: readonly TracedRequirement[];
}): SensitivityBaseJoin {
  const pairs: SensitivityBaseJoinPair[] = [];
  for (const metric of input.capture.studyCase.metrics) {
    const measurement = input.capture.measurements.base.find((item) =>
      item.metric === metric.id
    );
    if (measurement === undefined) {
      return unresolved(
        "study-metric-unlinked",
        `Study capture has no base measurement for metric "${metric.id}".`,
      );
    }
    const matches = input.requirements.filter((requirement) =>
      requirement.criterion.metric === metric.id
    );
    if (matches.length === 0) {
      return unresolved(
        "study-metric-unlinked",
        `No Thread requirement names metric "${metric.id}".`,
      );
    }
    if (matches.length !== 1) {
      return unresolved(
        "requirement-not-unique",
        `Metric "${metric.id}" matches ${matches.length} Thread requirements.`,
      );
    }
    const requirement = matches[0]!;
    if (requirement.freshness.status !== "fresh") {
      return unresolved(
        "requirement-not-fresh",
        `Requirement "${requirement.id}" freshness is "${requirement.freshness.status}".`,
      );
    }
    if (!ORACLE_OPERATORS.has(requirement.criterion.operator)) {
      return unresolved(
        "operator-not-oracle",
        `Requirement "${requirement.id}" operator "${requirement.criterion.operator}" ` +
          `is not a SysON oracle operator (<= or >=).`,
      );
    }
    const observationId = sensitivityBaseObservationId(metric.id, input.digest);
    const observation = input.observations.find((item) => item.id === observationId);
    if (observation === undefined) {
      return unresolved(
        "observation-unlinked",
        `Study-base observation "${observationId}" is absent.`,
      );
    }
    if (observation.freshness.status !== "fresh") {
      return unresolved(
        "observation-not-fresh",
        `Study-base observation "${observationId}" is not fresh.`,
      );
    }
    if (observation.metric !== metric.id) {
      return unresolved(
        "observation-unlinked",
        `Observation "${observationId}" metric "${observation.metric}" ` +
          `does not match study metric "${metric.id}".`,
      );
    }
    if (
      !Object.is(observation.quantity.value, measurement.value) ||
      observation.quantity.unit !== measurement.unit
    ) {
      return unresolved(
        "quantity-mismatch",
        `Observation "${observationId}" quantity is not Object.is-equal ` +
          `to the study-base measurement for "${metric.id}".`,
      );
    }
    pairs.push({ metricId: metric.id, requirement, observation });
  }
  if (pairs.length === 0) {
    return unresolved(
      "study-metric-unlinked",
      "Study capture declares no metrics to evaluate.",
    );
  }
  return { status: "resolved", pairs };
}

function unresolved(
  reason: SensitivityBaseJoinReason,
  detail: string,
): UnresolvedSensitivityBaseJoin {
  return { status: "unresolved", reason, detail };
}
