import type { SensitivitySolverDeclaration } from "../../../../../domain/sensitivity/study/sensitivity-study.ts";
import type {
  StaticStructuralSolveExecution,
  StaticStructuralSolvePlan,
} from "../../../../../domain/sensitivity/live-fea/static-structural-solver.ts";
import type { ContentFingerprint } from "../../../../../domain/kernel/primitives.ts";

/**
 * CalculiX static solve from a sealed sensitivity solver declaration.
 *
 * This is not StaticStructuralSolver: that port requires a MechanicalProofCase.
 * The adapter lowers the declaration; it never treats solver.tool as a
 * dispatch key supplied by the agent.
 */
export interface SensitivitySolveInput {
  readonly declaration: SensitivitySolverDeclaration;
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
