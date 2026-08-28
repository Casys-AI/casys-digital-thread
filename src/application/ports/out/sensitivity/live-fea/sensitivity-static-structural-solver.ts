import type { SensitivityStaticStructuralMethod } from "../../../../../domain/sensitivity/study/sensitivity-study.ts";
import type {
  StaticStructuralSolveExecution,
  StaticStructuralSolvePlan,
} from "../../../../../domain/sensitivity/live-fea/static-structural-solver.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

/**
 * Server-owned static solve from a sealed sensitivity physical method.
 *
 * This is not StaticStructuralSolver: that port requires a MechanicalProofCase.
 * The adapter lowers the physical method; its concrete provider tool stays a
 * server-owned binding detail and cannot be supplied by an agent.
 */
export interface SensitivitySolveInput {
  readonly method: SensitivityStaticStructuralMethod;
  readonly inputArtifact: {
    readonly fingerprint: ContentFingerprint;
    readonly byteCount: number;
    readonly stagedAsset: { readonly location: string };
  };
}

export interface SensitivityStaticStructuralSolver {
  resolve(input: SensitivitySolveInput): StaticStructuralSolvePlan;
  solve(
    plan: StaticStructuralSolvePlan,
  ): Promise<StaticStructuralSolveExecution>;
}
