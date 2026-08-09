/**
 * Typed execution policy for the generic FEA static-solve operation.
 *
 * WHY THIS MODULE EXISTS — the executor verify.run-fea-static-proof@1 needs a
 * typed, versioned guard that caps inputs before any provider call is made.  An
 * inline numeric check embedded in the executor cannot be independently injected,
 * tested, or versioned: any change silently alters the planDigest that travels
 * into the WAL and the verdict artifact.  A dedicated domain module gives the
 * policy a stable identity (policyVersion) that is recorded in both, making
 * policy changes traceable through evidence without touching the executor.
 *
 * This module is pure domain: no I/O, no CalculiX names, no provider details.
 */

import {
  deepFreeze,
  exactRecord,
  finite,
  literalValue,
  positiveInteger,
} from "../kernel/case-validation.ts";
import type { MechanicalProofCase } from "./mechanical-proof-case.ts";

// ---------------------------------------------------------------------------
// Policy version
// ---------------------------------------------------------------------------

export const FEA_EXECUTION_POLICY_VERSION = "fea-execution-policy/1" as const;

// ---------------------------------------------------------------------------
// Typed violation
// ---------------------------------------------------------------------------

export type FeaPolicyViolationCode =
  | "mesh_below_minimum"
  | "force_exceeds_maximum"
  | "too_many_selections"
  | "step_bytes_exceeds_maximum";

/**
 * Typed policy violation: machine-readable code + numeric context, no provider
 * prose.  Callers match on .code; .context carries the measured value and the
 * relevant limit so structured reporters never need to parse the message string.
 *
 * AX principle Machine-Readable Errors: code + context, never prose-only.
 */
export class FeaPolicyViolationError extends Error {
  readonly code: FeaPolicyViolationCode;
  readonly context: Readonly<Record<string, number>>;

  constructor(
    code: FeaPolicyViolationCode,
    context: Record<string, number>,
  ) {
    super(`fea-execution-policy violation: ${code}`);
    this.name = "FeaPolicyViolationError";
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

// ---------------------------------------------------------------------------
// Policy interface
// ---------------------------------------------------------------------------

/**
 * Versioned execution policy injected from server.ts into the FEA executor.
 *
 * BOUNDARY CONTRACT (tested, must not drift):
 *   meshTargetSizeMinMm  — proof mesh target size >= limit → accepted;
 *                          strictly below → mesh_below_minimum.
 *   forceMagnitudeMaxN   — Euclidean norm of each load's force vector <= limit →
 *                          accepted; strictly above → force_exceeds_maximum.
 *                          Each load is checked independently; the resultant of
 *                          all loads is not evaluated.
 *   stepBytesMax         — bytes <= limit → accepted; strictly above →
 *                          step_bytes_exceeds_maximum.  Checked via
 *                          assertStepBytesWithinPolicy once the STEP artifact
 *                          byte count is resolved at run time.
 *   selectionsMax        — supports.length + loads.length <= limit → accepted;
 *                          strictly above → too_many_selections.
 *
 * In every case "at the limit" is accepted; only "exceeded" is rejected.
 */
export interface FeaExecutionPolicy {
  readonly policyVersion: typeof FEA_EXECUTION_POLICY_VERSION;
  /** Minimum mesh target size in mm (inclusive lower bound). */
  readonly meshTargetSizeMinMm: number;
  /**
   * Maximum Euclidean force magnitude in N, evaluated per load independently.
   * ‖F‖₂ = sqrt(Fx² + Fy² + Fz²) must be ≤ this limit for every load.
   */
  readonly forceMagnitudeMaxN: number;
  /**
   * Maximum STEP file byte count (inclusive upper bound).  Verified via
   * assertStepBytesWithinPolicy after the artifact is resolved.
   */
  readonly stepBytesMax: number;
  /** Maximum total selection count (supports + loads, inclusive upper bound). */
  readonly selectionsMax: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const POLICY_KEYS = [
  "policyVersion",
  "meshTargetSizeMinMm",
  "forceMagnitudeMaxN",
  "stepBytesMax",
  "selectionsMax",
] as const;

/**
 * Validate an untrusted value and return an immutable FeaExecutionPolicy.
 *
 * Fail-closed: extra or missing keys, non-finite values, zero, and
 * negative values are all rejected with TypeError.  stepBytesMax and
 * selectionsMax must be safe positive integers.
 */
export function validateFeaExecutionPolicy(value: unknown): FeaExecutionPolicy {
  const rec = exactRecord(value, POLICY_KEYS, "$policy");
  literalValue(
    rec.policyVersion,
    FEA_EXECUTION_POLICY_VERSION,
    "$policy.policyVersion",
  );

  const meshTargetSizeMinMm = finite(
    rec.meshTargetSizeMinMm,
    "$policy.meshTargetSizeMinMm",
  );
  if (meshTargetSizeMinMm <= 0) {
    throw new TypeError(
      "$policy.meshTargetSizeMinMm must be a positive finite number.",
    );
  }

  const forceMagnitudeMaxN = finite(
    rec.forceMagnitudeMaxN,
    "$policy.forceMagnitudeMaxN",
  );
  if (forceMagnitudeMaxN <= 0) {
    throw new TypeError(
      "$policy.forceMagnitudeMaxN must be a positive finite number.",
    );
  }

  const stepBytesMax = positiveInteger(rec.stepBytesMax, "$policy.stepBytesMax");
  const selectionsMax = positiveInteger(
    rec.selectionsMax,
    "$policy.selectionsMax",
  );

  return deepFreeze({
    policyVersion: FEA_EXECUTION_POLICY_VERSION,
    meshTargetSizeMinMm,
    forceMagnitudeMaxN,
    stepBytesMax,
    selectionsMax,
  });
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

/**
 * Assert that a validated mechanical proof case satisfies the execution policy.
 *
 * Checks in order (first violation terminates):
 *   1. Mesh target size >= policy.meshTargetSizeMinMm
 *   2. Each load's Euclidean norm <= policy.forceMagnitudeMaxN
 *   3. supports.length + loads.length <= policy.selectionsMax
 *
 * assertStepBytesWithinPolicy is kept separate because the actual byte count
 * is only available after the STEP artifact is resolved from the thread.
 *
 * Throws FeaPolicyViolationError with a typed code and numeric context.
 */
export function assertProofWithinPolicy(
  proof: MechanicalProofCase,
  policy: FeaExecutionPolicy,
): void {
  const meshSize = proof.analysis.mesh.targetSize.value;
  if (meshSize < policy.meshTargetSizeMinMm) {
    throw new FeaPolicyViolationError("mesh_below_minimum", {
      meshTargetSizeMm: meshSize,
      meshTargetSizeMinMm: policy.meshTargetSizeMinMm,
    });
  }

  for (const load of proof.analysis.loads) {
    const [fx, fy, fz] = load.force.value;
    const norm = Math.sqrt(fx * fx + fy * fy + fz * fz);
    if (norm > policy.forceMagnitudeMaxN) {
      throw new FeaPolicyViolationError("force_exceeds_maximum", {
        loadNormN: norm,
        forceMagnitudeMaxN: policy.forceMagnitudeMaxN,
      });
    }
  }

  const selectionCount = proof.analysis.supports.length + proof.analysis.loads.length;
  if (selectionCount > policy.selectionsMax) {
    throw new FeaPolicyViolationError("too_many_selections", {
      selectionCount,
      selectionsMax: policy.selectionsMax,
    });
  }
}

/**
 * Assert that a resolved STEP file byte count satisfies the execution policy.
 *
 * Called once the byte count is known — after resolving the artifact from the
 * thread but before staging it for the solver.  Kept separate from
 * assertProofWithinPolicy because the proof declaration carries the expected
 * digest, not the resolved byte count.
 *
 * Throws FeaPolicyViolationError with code step_bytes_exceeds_maximum when
 * bytes > policy.stepBytesMax.  At the limit (bytes === stepBytesMax) the call
 * is a no-op.
 */
export function assertStepBytesWithinPolicy(
  bytes: number,
  policy: FeaExecutionPolicy,
): void {
  if (bytes > policy.stepBytesMax) {
    throw new FeaPolicyViolationError("step_bytes_exceeds_maximum", {
      bytes,
      stepBytesMax: policy.stepBytesMax,
    });
  }
}
