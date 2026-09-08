/**
 * Code-owned live-method constraints for the first FEA sensitivity vertical.
 *
 * The case schema allows a wider scientific declaration. The live CalculiX
 * path remeshes each STEP independently and only knows two response observations.
 * Metric `id` is the exact Thread feature; mapping uses the validated unit, not
 * an alias of that id. Seal and run refuse a case that would publish a false
 * method claim.
 */

import type { SensitivityStudyCaseV3 } from "./sensitivity-study-v3.ts";

export const SENSITIVITY_LIVE_RESPONSE_UNITS = Object.freeze(
  {
    mm: "maximumDisplacement",
    MPa: "maximumVonMisesStress",
  } as const,
);

export type SensitivityLiveResponseUnit = keyof typeof SENSITIVITY_LIVE_RESPONSE_UNITS;

export type SensitivityLiveSolverObservation =
  typeof SENSITIVITY_LIVE_RESPONSE_UNITS[SensitivityLiveResponseUnit];

/**
 * Which CalculiX result field fills a declared study metric. The live V3 case
 * carries only id+unit; the unit selects the observation. Historical feature
 * ids remain valid when they already declare one of these units.
 */
export function liveSolverObservationForResponseUnit(
  unit: string,
): SensitivityLiveSolverObservation | undefined {
  if (unit === "mm") return SENSITIVITY_LIVE_RESPONSE_UNITS.mm;
  if (unit === "MPa") return SENSITIVITY_LIVE_RESPONSE_UNITS.MPa;
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
    if (liveSolverObservationForResponseUnit(metric.unit) === undefined) {
      throw new TypeError(
        `$case.metrics ${JSON.stringify(metric.id)} unit ` +
          `${JSON.stringify(metric.unit)} is not a live sensitivity response unit.`,
      );
    }
  }
}
