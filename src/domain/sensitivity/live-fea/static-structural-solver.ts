/**
 * Provider-neutral static structural solve capability.
 *
 * The domain names the sealed mechanical case, the exact input identity and
 * the normalized engineering observations. Provider response echoes and mesh
 * bookkeeping remain private to the adapter/capture boundary. The sole runtime
 * location crossing this port is code-owned and returned by the staging
 * adapter; it is never derived from a proof case, an agent proposal, or a
 * provider response.
 */

import type { ContentFingerprint } from "../../kernel/primitives.ts";
import type { JsonValue } from "../../compile/rop/resolved-operation-plan.ts";
import type { MechanicalProofCase } from "../../fea/seal-case/mechanical-proof-case.ts";

export interface StaticStructuralSolveInput {
  readonly proof: MechanicalProofCase;
  readonly inputArtifact: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    /**
     * Opaque, code-owned provider-readable location returned by the staging
     * port. Planning and proof data never select or construct this path.
     */
    readonly stagedAsset: {
      readonly location: string;
    };
  };
}

export interface StaticStructuralSolvePlan {
  /**
   * Exact JSON request evidence used by the trusted lifecycle for plan and
   * verdict attestation. Its provider-specific schema is owned by the adapter.
   */
  readonly exactRequest: Readonly<Record<string, JsonValue>>;
  /** Evidence identity supplied by the adapter, never selected by the executor. */
  readonly executionOperation: {
    readonly serverId: string;
    readonly operationId: string;
  };
}

export interface StaticStructuralSupport {
  readonly selectionId: string;
}

export interface StaticStructuralLoad {
  readonly selectionId: string;
  readonly force: {
    readonly value: readonly [number, number, number];
    readonly unit: "N";
  };
}

/** Provider-neutral observations from one validated static structural solve. */
export interface StaticStructuralSolveResult {
  readonly inputAttestation: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
  };
  readonly boundaryConditions: {
    readonly supports: readonly StaticStructuralSupport[];
    readonly loads: readonly StaticStructuralLoad[];
  };
  readonly mesh: {
    readonly nodeCount: number;
    readonly elementCount: number;
  };
  readonly observations: {
    readonly maximumDisplacement: {
      readonly magnitude: { readonly value: number; readonly unit: "mm" };
      readonly vector: {
        readonly value: readonly [number, number, number];
        readonly unit: "mm";
      };
    };
    readonly maximumVonMisesStress: {
      readonly magnitude: { readonly value: number; readonly unit: "MPa" };
    };
  };
}

declare const staticStructuralCaptureTokenBrand: unique symbol;

/** Opaque in-process handle to the exact validated provider capture. */
export interface StaticStructuralCaptureToken {
  readonly [staticStructuralCaptureTokenBrand]: true;
}

export interface StaticStructuralSolveExecution {
  readonly result: StaticStructuralSolveResult;
  readonly captureToken: StaticStructuralCaptureToken;
}

export interface StaticStructuralSolver {
  resolve(input: StaticStructuralSolveInput): StaticStructuralSolvePlan;
  solve(plan: StaticStructuralSolvePlan): Promise<StaticStructuralSolveExecution>;
}

/** Provider acknowledged the solve, but its response could not be normalized. */
export class StaticStructuralResponseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "StaticStructuralResponseError";
  }
}
