/**
 * Code-owned live-method constraints for the first FEA sensitivity vertical.
 *
 * The case schema allows a wider scientific declaration. The live CalculiX
 * path remeshes each STEP independently and only knows two response metrics.
 * Seal and run refuse a case that would publish a false method claim.
 */

import type { SensitivityStudyCaseV2 } from "./sensitivity-study-v2.ts";

export const SENSITIVITY_LIVE_METRIC_UNITS: ReadonlyMap<string, string> = new Map([
  ["assembly_max_displacement", "mm"],
  ["assembly_max_von_mises", "MPa"],
]);

export function assertSensitivityLiveMethod(
  studyCase: SensitivityStudyCaseV2,
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
