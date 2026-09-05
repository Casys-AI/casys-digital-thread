/**
 * Schema and pure-domain functions for first-order forward finite-difference
 * sensitivity studies of FEA metrics with respect to a single geometric parameter.
 *
 * Why this boundary exists: a sensitivity derivative is pure arithmetic — no
 * verdict, no threshold, no provider detail can enter here. The reviewed case
 * file declares the step, mesh, and base value; the executor only reads them.
 * Project-case schemas and parsers live in their versioned modules, currently
 * `sensitivity-study-v3.ts`.
 */

import { deepFreeze } from "../../kernel/case-validation.ts";

export interface SensitivityMetricDeclaration {
  readonly id: string;
  readonly unit: string;
}

/**
 * Provider-neutral physical method for a static-structural sensitivity study.
 *
 * The sealed project case records the mesh, material, supports and loads that
 * make the observation scientifically interpretable. It deliberately does not
 * record a provider, tool, response schema or invocation argument. Those are
 * selected by the server-side capability binding at execution time.
 */
export interface SensitivityStaticStructuralMethod {
  readonly mesh: {
    readonly kind: "tetrahedral-volume";
    readonly targetSizeMm: number;
  };
  readonly material: {
    readonly model: "isotropic-linear-elastic";
    readonly eMpa: number;
    readonly nu: number;
    readonly basis: string;
  };
  readonly supports: readonly SensitivitySupport[];
  readonly loads: readonly SensitivityLoad[];
}

export interface SensitivitySupport {
  readonly id: string;
  readonly kind: "fixed";
  readonly selection: SensitivitySelection;
}

export interface SensitivityLoad {
  readonly id: string;
  readonly kind: "force";
  readonly selection: SensitivitySelection;
  readonly force: {
    readonly value: readonly [number, number, number];
    readonly unit: "N";
  };
}

export interface SensitivitySelection {
  readonly name: string;
  readonly box: {
    readonly min: readonly [number, number, number];
    readonly max: readonly [number, number, number];
    readonly unit: "mm";
  };
}

export interface SensitivityDomain {
  readonly approximationOrder: "first-order-forward";
  readonly remeshingVariationIncluded: boolean;
  readonly localValidityNote: string;
  /** Non-empty; explains choices that were considered and rejected. */
  readonly limitations: readonly string[];
}

/** Observed scalar value from a single FEA run, matched by metric id. */
export interface SensitivityMetricMeasurement {
  readonly value: number;
  readonly unit: string;
}

export interface SensitivityDerivative {
  readonly metric: string;
  readonly value: number;
  /** Composed unit: "<metricUnit>/<stepUnit>" — e.g. "mm/mm" or "MPa/mm". */
  readonly unit: string;
}

export interface SensitivityDerivatives {
  readonly derivatives: readonly SensitivityDerivative[];
  /**
   * Neighbourhood provenance so the caller cannot mistake a local slope for a
   * global one. base and step are copied from the reviewed case, not recomputed.
   */
  readonly domain: {
    readonly base: number;
    readonly step: number;
    readonly parameterUnit: string;
  };
}

/**
 * Compute first-order forward finite differences for all declared metrics.
 *
 * Pure arithmetic: (stepped[m] − base[m]) / step.value, with the composed unit
 * "<metricUnit>/<stepUnit>". No rounding, no verdict, no threshold. Rejects any
 * measurement whose declared unit diverges from the case declaration so unit
 * confusion cannot silently propagate into the derivative.
 */
/**
 * Shared finite-difference input. The arithmetic depends only on reviewed
 * metric declarations and quantities, never on source storage or runtime
 * binding.
 */
export interface SensitivityFiniteDifferenceCase {
  readonly metrics: readonly SensitivityMetricDeclaration[];
  readonly baseValue: { readonly value: number; readonly unit: string };
  readonly step: { readonly value: number; readonly unit: string };
}

export function computeSensitivities(
  sensitivityCase: SensitivityFiniteDifferenceCase,
  baseMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
  steppedMetrics: ReadonlyMap<string, SensitivityMetricMeasurement>,
): SensitivityDerivatives {
  const stepValue = sensitivityCase.step.value;
  const stepUnit = sensitivityCase.step.unit;

  const derivatives: SensitivityDerivative[] = [];

  for (const declaration of sensitivityCase.metrics) {
    const baseMeasurement = baseMetrics.get(declaration.id);
    if (baseMeasurement === undefined) {
      throw new TypeError(
        `$metrics.${declaration.id}: base measurement not found.`,
      );
    }
    if (baseMeasurement.unit !== declaration.unit) {
      throw new TypeError(
        `$metrics.${declaration.id}: base unit mismatch ` +
          `(expected ${JSON.stringify(declaration.unit)}, ` +
          `got ${JSON.stringify(baseMeasurement.unit)}).`,
      );
    }

    const steppedMeasurement = steppedMetrics.get(declaration.id);
    if (steppedMeasurement === undefined) {
      throw new TypeError(
        `$metrics.${declaration.id}: stepped measurement not found.`,
      );
    }
    if (steppedMeasurement.unit !== declaration.unit) {
      throw new TypeError(
        `$metrics.${declaration.id}: stepped unit mismatch ` +
          `(expected ${JSON.stringify(declaration.unit)}, ` +
          `got ${JSON.stringify(steppedMeasurement.unit)}).`,
      );
    }

    derivatives.push({
      metric: declaration.id,
      value: (steppedMeasurement.value - baseMeasurement.value) / stepValue,
      unit: `${declaration.unit}/${stepUnit}`,
    });
  }

  return deepFreeze({
    derivatives,
    domain: {
      base: sensitivityCase.baseValue.value,
      step: stepValue,
      parameterUnit: sensitivityCase.baseValue.unit,
    },
  });
}
