/**
 * Code-owned lowering from a sealed SensitivitySolverDeclaration to
 * calculix_solve_static. The declaration's provider/tool literals are
 * verified, then ignored as dispatch selectors.
 */

import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type {
  SensitivitySolveInput,
  SensitivityStaticStructuralSolver,
} from "../../../application/ports/out/sensitivity/live-fea/sensitivity-static-structural-solver.ts";
import type { JsonValue } from "../../../domain/compile/rop/resolved-operation-plan.ts";
import {
  type StaticStructuralLoad,
  StaticStructuralResponseError,
  type StaticStructuralSolveExecution,
  type StaticStructuralSolvePlan,
  type StaticStructuralSupport,
} from "../../../domain/sensitivity/live-fea/static-structural-solver.ts";
import {
  bindStaticStructuralSolveExecution,
  type FeaSolverResponseExpectation,
  parseFeaSolverResponse,
  type StaticStructuralSemanticExpectation,
} from "./fea-solver-capture.ts";

const STATIC_SOLVE_TOOL = "calculix_solve_static";

type CalculixStaticSolveRequest = Readonly<Record<string, JsonValue>> & {
  readonly step_path: string;
  readonly expected_step_sha256: string;
  readonly mesh_size_mm: number;
  readonly material: {
    readonly e_mpa: number;
    readonly nu: number;
  };
  readonly selections: readonly {
    readonly name: string;
    readonly box: {
      readonly min: readonly [number, number, number];
      readonly max: readonly [number, number, number];
    };
  }[];
  readonly fixed: readonly string[];
  readonly loads: readonly {
    readonly selection: string;
    readonly force_n: readonly [number, number, number];
  }[];
};

interface CalculixStaticSolveContext {
  readonly request: CalculixStaticSolveRequest;
  readonly responseExpectation: FeaSolverResponseExpectation;
  readonly semanticExpectation: StaticStructuralSemanticExpectation;
}

export class McpCalculixSensitivitySolver implements SensitivityStaticStructuralSolver {
  readonly #contexts = new WeakMap<
    StaticStructuralSolvePlan,
    CalculixStaticSolveContext
  >();

  constructor(private readonly client: McpToolClient) {}

  resolve(input: SensitivitySolveInput): StaticStructuralSolvePlan {
    const resolved = resolveSensitivitySolve(input);
    this.#contexts.set(resolved.plan, resolved.context);
    return resolved.plan;
  }

  async solve(
    plan: StaticStructuralSolvePlan,
  ): Promise<StaticStructuralSolveExecution> {
    const context = this.#contexts.get(plan);
    if (!context) {
      throw new TypeError(
        "Sensitivity solve plan was not resolved by this adapter instance.",
      );
    }
    const result = await this.client.callTool({
      name: STATIC_SOLVE_TOOL,
      arguments: context.request,
    });
    try {
      const parsed = parseFeaSolverResponse(
        result.structuredContent,
        context.responseExpectation,
      );
      return bindStaticStructuralSolveExecution(
        parsed,
        context.semanticExpectation,
      );
    } catch (error) {
      throw new StaticStructuralResponseError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    }
  }
}

export function resolveSensitivitySolve(input: SensitivitySolveInput): {
  readonly plan: StaticStructuralSolvePlan;
  readonly context: CalculixStaticSolveContext;
} {
  const declaration = input.declaration;
  if (declaration.provider !== "calculix" || declaration.tool !== STATIC_SOLVE_TOOL) {
    throw new TypeError(
      "Sensitivity solver declaration must be calculix / calculix_solve_static.",
    );
  }
  const stepDigest = input.inputArtifact.fingerprint.digest;
  const stepBytes = input.inputArtifact.byteCount;
  if (input.inputArtifact.fingerprint.algorithm !== "sha256") {
    throw new TypeError("Sensitivity STEP fingerprint must use sha256.");
  }
  const stagedPath = requireStagedLocation(
    input.inputArtifact.stagedAsset.location,
    stepDigest,
  );
  const fixedSelections = declaration.supports.map((support) => support.selection.name);
  const loads = declaration.loads.map((load) => ({
    selection: load.selection.name,
    forceN: load.force.value,
  }));
  const request: CalculixStaticSolveRequest = {
    step_path: stagedPath,
    expected_step_sha256: stepDigest,
    mesh_size_mm: declaration.mesh.targetSizeMm,
    material: {
      e_mpa: declaration.material.eMpa,
      nu: declaration.material.nu,
    },
    selections: [
      ...declaration.supports.map((support) => ({
        name: support.selection.name,
        box: { min: support.selection.box.min, max: support.selection.box.max },
      })),
      ...declaration.loads.map((load) => ({
        name: load.selection.name,
        box: { min: load.selection.box.min, max: load.selection.box.max },
      })),
    ],
    fixed: fixedSelections,
    loads: loads.map((load) => ({
      selection: load.selection,
      force_n: load.forceN,
    })),
  };
  const supports: readonly StaticStructuralSupport[] = declaration.supports.map(
    (support) => ({ selectionId: support.selection.name }),
  );
  const semanticLoads: readonly StaticStructuralLoad[] = declaration.loads.map(
    (load) => ({
      selectionId: load.selection.name,
      force: { value: load.force.value, unit: "N" },
    }),
  );
  const plan: StaticStructuralSolvePlan = {
    exactRequest: request,
    executionOperation: {
      serverId: "calculix",
      operationId: STATIC_SOLVE_TOOL,
    },
  };
  return {
    plan,
    context: {
      request,
      responseExpectation: {
        stagedPath,
        stepDigest,
        stepBytes,
        fixedSelections,
        loads,
      },
      semanticExpectation: {
        inputFingerprint: input.inputArtifact.fingerprint,
        inputByteCount: stepBytes,
        supports,
        loads: semanticLoads,
      },
    },
  };
}

function requireStagedLocation(location: string, digest: string): string {
  const expectedFilename = `fea-${digest}.step`;
  const segments = location.split("/");
  if (
    !location.startsWith("/") ||
    segments.length < 3 ||
    segments.at(-1) !== expectedFilename ||
    segments.slice(1).some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      !/^[A-Za-z0-9._-]+$/.test(segment)
    )
  ) {
    throw new TypeError(
      "Sensitivity staged STEP location is not the code-owned fea-<digest>.step path.",
    );
  }
  return location;
}
