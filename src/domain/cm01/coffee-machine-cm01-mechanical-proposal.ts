/**
 * Domain logic for the CM-01 mechanical proof-case proposal.
 *
 * WHY THIS MODULE EXISTS — extractApprovedProofCase parses an approved
 * EngineeringDecision into a typed CoffeeMachineMechanicalProofCase. The
 * function is pure (no Deno.*, no fetch) and must be accessible to
 * src/adapters/executors/ without creating an inverted scripts/ → src/
 * dependency. The MechanicalCaptureStore port interface lives here too so
 * executors can reference the contract without importing a Deno I/O adapter.
 *
 * Source: extracted from scripts/runners/run-coffee-machine-mechanical.ts
 * (vague organisation v2). The runner now imports from here; FileMechanicalCaptureStore
 * (I/O implementation) lives in src/adapters/captures/.
 */

import { deterministicJson } from "../kernel/deterministic-json.ts";
import type {
  EngineeringDecision,
  EngineeringDecisionProposalParameter,
} from "../project/engineering-project.ts";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Typed parameters for the CM-01 drip-tray FEA run, parsed from the approved
 * MRTR Decision proposal. All numeric values are in the units implied by their
 * field name (MPa, mm, N, unitless ratios).
 */
export interface CoffeeMachineMechanicalProofCase {
  readonly analysisScope: string;
  readonly dimensionsMm: readonly [number, number, number];
  readonly materialBasis: string;
  readonly youngModulusMpa: number;
  readonly poissonRatio: number;
  readonly fixedRegion: "rear-vertical-face";
  readonly loadCase: string;
  readonly loadForceN: readonly [number, number, number];
  readonly meshSizeMm: number;
  readonly maxVonMisesMpa: number;
  readonly maxDisplacementMm: number;
  readonly evidenceBoundary: string;
}

/**
 * Port interface for the write-ahead mechanical capture store.
 *
 * WHY HERE AND NOT IN ADAPTERS — this is a port (boundary contract), not an
 * implementation. Executors in src/adapters/executors/ depend on this interface
 * and must not depend on the Deno I/O implementation. The implementation
 * (FileMechanicalCaptureStore) lives in src/adapters/captures/.
 */
export interface MechanicalCaptureStore {
  prepare(path: string): Promise<void>;
  persist(path: string, deterministicContents: string): Promise<void>;
  /** Release a production claim after success or failure. Test stores may omit it. */
  release?(path: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Server-fixed parameter contract
// ---------------------------------------------------------------------------

const EXPECTED_PARAMETER_KEYS = [
  "analysis_scope",
  "evidence_boundary",
  "fixed_region",
  "load_case",
  "material_basis",
  "max_displacement_mm",
  "max_von_mises_mpa",
  "mesh_size_mm",
  "poisson_ratio",
  "young_modulus_mpa",
] as const;

// ---------------------------------------------------------------------------
// Public extraction function
// ---------------------------------------------------------------------------

/**
 * Parse an approved EngineeringDecision proposal into a typed
 * CoffeeMachineMechanicalProofCase.
 *
 * Fails closed: any deviation from the exact reviewed parameter set, any
 * unsupported geometry format or boundary condition raises a TypeError rather
 * than silently defaulting to a wrong value.
 */
export function extractApprovedProofCase(
  decision: EngineeringDecision,
): CoffeeMachineMechanicalProofCase {
  if (decision.status !== "approved" || !decision.proposal) {
    throw new Error("Cannot extract an unapproved mechanical proposal.");
  }
  const parameters = parameterMap(decision.proposal.parameters);
  const analysisScope = textParameter(parameters, "analysis_scope");
  const dimensionsMatch = analysisScope.match(
    /^CM-01 drip tray; isolated current CAD component, ([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) x ([0-9]+(?:\.[0-9]+)?) mm$/,
  );
  if (!dimensionsMatch) {
    throw new TypeError(
      "analysis_scope does not identify one typed CM-01 drip-tray box.",
    );
  }
  const dimensionsMm = dimensionsMatch.slice(1).map(Number) as [number, number, number];
  dimensionsMm.forEach((value) => positiveFinite(value, "analysis_scope dimension"));
  const fixed = textParameter(parameters, "fixed_region");
  if (fixed !== "Rear vertical face fully fixed") {
    throw new TypeError(
      "fixed_region is not the supported reviewed rear-face condition.",
    );
  }
  const loadCase = textParameter(parameters, "load_case");
  const loadMatch = loadCase.match(
    /^([0-9]+(?:\.[0-9]+)?) N total downward force on the front vertical face(?: \(about [^)]+\))?$/,
  );
  if (!loadMatch) {
    throw new TypeError("load_case is not one typed front-face downward force.");
  }
  const loadN = positiveFinite(Number(loadMatch[1]), "load_case force");
  const poissonRatio = numberParameter(parameters, "poisson_ratio", "1");
  if (poissonRatio <= 0 || poissonRatio >= 0.5) {
    throw new TypeError("poisson_ratio must be greater than zero and below 0.5.");
  }
  return {
    analysisScope,
    dimensionsMm,
    materialBasis: textParameter(parameters, "material_basis"),
    youngModulusMpa: positiveFinite(
      numberParameter(parameters, "young_modulus_mpa", "MPa"),
      "young_modulus_mpa",
    ),
    poissonRatio,
    fixedRegion: "rear-vertical-face",
    loadCase,
    loadForceN: [0, 0, -loadN],
    meshSizeMm: positiveFinite(
      numberParameter(parameters, "mesh_size_mm", "mm"),
      "mesh_size_mm",
    ),
    maxVonMisesMpa: positiveFinite(
      numberParameter(parameters, "max_von_mises_mpa", "MPa"),
      "max_von_mises_mpa",
    ),
    maxDisplacementMm: positiveFinite(
      numberParameter(parameters, "max_displacement_mm", "mm"),
      "max_displacement_mm",
    ),
    evidenceBoundary: textParameter(parameters, "evidence_boundary"),
  };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function parameterMap(
  parameters: readonly EngineeringDecisionProposalParameter[],
): ReadonlyMap<string, EngineeringDecisionProposalParameter> {
  const result = new Map<string, EngineeringDecisionProposalParameter>();
  for (const parameter of parameters) {
    if (result.has(parameter.key)) {
      throw new TypeError(`Duplicate proposal parameter: ${parameter.key}.`);
    }
    result.set(parameter.key, parameter);
  }
  const actual = [...result.keys()].sort();
  if (deterministicJson(actual) !== deterministicJson(EXPECTED_PARAMETER_KEYS)) {
    throw new TypeError(
      "Mechanical proposal parameters do not match the exact runner contract.",
    );
  }
  return result;
}

function textParameter(
  parameters: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
): string {
  const value = parameters.get(key)?.value;
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${key} must be a non-empty reviewed string.`);
  }
  return value;
}

function numberParameter(
  parameters: ReadonlyMap<string, EngineeringDecisionProposalParameter>,
  key: string,
  unit: string,
): number {
  const parameter = parameters.get(key);
  if (
    typeof parameter?.value !== "number" || !Number.isFinite(parameter.value) ||
    parameter.unit !== unit
  ) {
    throw new TypeError(`${key} must be a finite reviewed number in ${unit}.`);
  }
  return parameter.value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${label} must be a positive finite number.`);
  }
  return value;
}
