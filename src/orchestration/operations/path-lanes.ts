import type { EngineeringOperationRef } from "../../domain/project/engineering-project.ts";
import type { EngineeringPathLaneId } from "../../domain/project/engineering-path-lane.ts";
import type {
  EngineeringOperationPathLaneDeclaration,
  EngineeringOperationPathLaneResolver,
} from "../../application/ports/out/project/engineering-operation-path-lane-resolver.ts";
import { getRegisteredEngineeringOperation } from "./registry.ts";

const fixed = (
  lane: EngineeringPathLaneId,
): EngineeringOperationPathLaneDeclaration => ({ kind: "fixed", lane });

const contextual = (
  allowedNext: readonly EngineeringPathLaneId[],
  fallback: EngineeringPathLaneId,
): EngineeringOperationPathLaneDeclaration => ({
  kind: "contextual",
  allowedNext,
  fallback,
});

/**
 * Exact operation-to-column taxonomy for the shared project/thread path.
 * The totality test makes every new registered operation choose a column.
 */
const PATH_LANE_BY_OPERATION: Readonly<
  Record<string, EngineeringOperationPathLaneDeclaration>
> = {
  "baseline.from-approved-brief@1": fixed("requirements"),
  "architecture.seed-syson-model@2": fixed("system-model"),
  "model.write-architecture@1": fixed("system-model"),
  "model.capture-part-definitions@1": fixed("system-model"),
  "model.seal-architecture-sysml@1": fixed("system-model"),
  "model.write-requirements@1": fixed("requirements"),
  "compile.seal-admission@3": contextual(
    ["geometry", "physics"],
    "system-model",
  ),
  "design.execute-build123d@1": fixed("geometry"),
  "design.seal-isolated-geometry@1": fixed("geometry"),
  "design.write-geometry@1": fixed("geometry"),
  "design.apply-vector-correction@1": fixed("geometry"),
  "verify.observe-assembly-integrity@1": fixed("physics"),
  "verify.evaluate-assembly-integrity@1": fixed("verdicts"),
  "simulate.run-qualified-modelica-kit@1": fixed("physics"),
  "simulate.run-admitted-modelica@1": fixed("physics"),
  "verify.seal-modelica-thermal-method-sheet@1": fixed("physics"),
  "verify.evaluate-admitted-modelica-observations@1": fixed("verdicts"),
  "decide.accept-admitted-modelica-evaluation@1": fixed("verdicts"),
  "decide.reject-admitted-modelica-evaluation@1": fixed("verdicts"),
  "decide.accept-assembly-integrity-evaluation@1": fixed("verdicts"),
  "decide.reject-assembly-integrity-evaluation@1": fixed("verdicts"),
  "simulate.run-admitted-spice@1": fixed("physics"),
  "verify.seal-electrical-observation-method-sheet@1": fixed("physics"),
  "verify.evaluate-admitted-spice-observations@1": fixed("verdicts"),
  "decide.accept-admitted-spice-evaluation@1": fixed("verdicts"),
  "decide.reject-admitted-spice-evaluation@1": fixed("verdicts"),
  "verify.seal-proof-case@1": fixed("physics"),
  "verify.run-fea-static-proof@3": fixed("physics"),
  "decide.accept-evaluation-closeout@1": fixed("verdicts"),
  "decide.reject-evaluation-closeout@1": fixed("verdicts"),
  "analyze.seal-sensitivity-study@1": fixed("physics"),
  "analyze.run-fea-sensitivity@1": fixed("physics"),
  "model.write-sensitivity-edges@1": fixed("system-model"),
  "verify.evaluate-sensitivity-base@1": fixed("verdicts"),
  "verify.seal-cross-domain-impact-manifest@2": fixed("verdicts"),
  "analyze.evaluate-cross-domain-impact@2": fixed("verdicts"),
  "decide.accept-cross-domain-impact@2": fixed("verdicts"),
  "analyze.evaluate-mechanical-preservation@2": fixed("verdicts"),
  "industrialize.seal-printability-case@1": fixed("physics"),
  "industrialize.observe-printability@1": fixed("physics"),
  "industrialize.seal-print-estimate-case@1": fixed("physics"),
  "industrialize.observe-print-estimate@1": fixed("physics"),
  "industrialize.seal-dfm-case@1": fixed("physics"),
  "industrialize.run-dfm-checks@1": fixed("physics"),
  "record.reconcile-uncertain-writer@1": fixed("system-model"),
  "record.archive-lineage@1": fixed("system-model"),
};

export const REGISTERED_ENGINEERING_OPERATION_PATH_LANE_RESOLVER:
  EngineeringOperationPathLaneResolver = {
    resolve(reference) {
      if (!getRegisteredEngineeringOperation(reference)) return undefined;
      return PATH_LANE_BY_OPERATION[operationKey(reference)];
    },
  };

export function listRegisteredEngineeringOperationPathLaneKeys(): readonly string[] {
  return Object.keys(PATH_LANE_BY_OPERATION);
}

function operationKey(
  operation: Pick<EngineeringOperationRef, "id" | "version">,
): string {
  return `${operation.id}@${operation.version}`;
}
