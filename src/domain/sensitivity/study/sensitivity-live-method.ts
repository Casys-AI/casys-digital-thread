/**
 * Code-owned live-method constraints for the first FEA sensitivity vertical.
 *
 * The case schema allows a wider scientific declaration. The live CalculiX
 * path remeshes each STEP independently and only knows two response metrics.
 * Seal and run refuse a case that would publish a false method claim.
 */

import type { SensitivityStudyCaseV3 } from "./sensitivity-study-v3.ts";

export const SENSITIVITY_LIVE_METRIC_UNITS: ReadonlyMap<string, string> = new Map([
  ["assembly_max_displacement", "mm"],
  ["assembly_max_von_mises", "MPa"],
  ["maxDisplacement", "mm"],
  ["maxVonMises", "MPa"],
]);

export type SensitivityLiveSolverObservation =
  | "maximumDisplacement"
  | "maximumVonMisesStress";

/**
 * Which CalculiX result field fills a declared study metric. The study case
 * names the metric; this is not a join-time alias of Thread requirements.
 */
export function liveSolverObservationForMetric(
  metricId: string,
): SensitivityLiveSolverObservation | undefined {
  if (
    metricId === "assembly_max_displacement" || metricId === "maxDisplacement"
  ) {
    return "maximumDisplacement";
  }
  if (metricId === "assembly_max_von_mises" || metricId === "maxVonMises") {
    return "maximumVonMisesStress";
  }
  return undefined;
}

export function assertSensitivityLiveMethod(
  studyCase: SensitivityStudyCaseV3,
): void {
  if (studyCase.baseValue.unit !== studyCase.step.unit) {
    throw new TypeError(
      "$case.baseValue.unit must equal $case.step.unit for the live finite-difference method.",
    );
  }
  if (!studyCase.domain.remeshingVariationIncluded) {
    throw new TypeError(
      "$case.domain.remeshingVariationIncluded must be true: the live CalculiX path remeshes each STEP independently.",
    );
  }
  for (const metric of studyCase.metrics) {
    const expectedUnit = SENSITIVITY_LIVE_METRIC_UNITS.get(metric.id);
    if (expectedUnit === undefined) {
      throw new TypeError(
        `$case.metrics ${JSON.stringify(metric.id)} is not in the live metric map.`,
      );
    }
    if (metric.unit !== expectedUnit) {
      throw new TypeError(
        `$case.metrics ${JSON.stringify(metric.id)} must declare unit ` +
          `${JSON.stringify(expectedUnit)} (got ${JSON.stringify(metric.unit)}).`,
      );
    }
  }
}
