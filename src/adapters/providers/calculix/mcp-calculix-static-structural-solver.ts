/** Private MCP adapter for the reviewed CalculiX static-structural capability. */

import type {
  StaticStructuralLoad,
  StaticStructuralSolveExecution,
  StaticStructuralSolveInput,
  StaticStructuralSolvePlan,
  StaticStructuralSolver,
  StaticStructuralSupport,
} from "../../../domain/analysis/static-structural-solver.ts";
import { StaticStructuralResponseError } from "../../../domain/analysis/static-structural-solver.ts";
import type { JsonValue } from "../../../domain/analysis/resolved-operation-plan.ts";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import {
  bindStaticStructuralSolveExecution,
  type FeaSolverResponseExpectation,
  parseFeaSolverResponse,
  type StaticStructuralSemanticExpectation,
} from "../../captures/fea-solver-capture.ts";

const STATIC_SOLVE_TOOL = "calculix_solve_static";

/** Strict private DTO for the CalculiX MCP request. */
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

export class McpCalculixStaticStructuralSolver implements StaticStructuralSolver {
  readonly #contexts = new WeakMap<
    StaticStructuralSolvePlan,
    CalculixStaticSolveContext
  >();

  constructor(private readonly client: McpToolClient) {}

  resolve(input: StaticStructuralSolveInput): StaticStructuralSolvePlan {
    const resolved = resolveCalculixStaticStructuralSolve(input);
    this.#contexts.set(resolved.plan, resolved.context);
    return resolved.plan;
  }

  async solve(
    plan: StaticStructuralSolvePlan,
  ): Promise<StaticStructuralSolveExecution> {
    const context = this.#contexts.get(plan);
    if (!context) {
      throw new TypeError(
        "Static structural solve plan was not resolved by this adapter instance.",
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

/** Exact provider lowering, kept outside the trusted executor. */
export function lowerCalculixStaticStructuralSolve(
  input: StaticStructuralSolveInput,
): StaticStructuralSolvePlan {
  return resolveCalculixStaticStructuralSolve(input).plan;
}

function resolveCalculixStaticStructuralSolve(
  input: StaticStructuralSolveInput,
): {
  readonly plan: StaticStructuralSolvePlan;
  readonly context: CalculixStaticSolveContext;
} {
  const proof = input.proof;
  const stepDigest = input.inputArtifact.fingerprint.digest;
  const stepBytes = input.inputArtifact.byteCount;
  if (input.inputArtifact.fingerprint.algorithm !== "sha256") {
    throw new TypeError("Static structural input fingerprint must use sha256.");
  }
  if (
    stepDigest !== proof.expectedCadArtifact.sha256 ||
    stepBytes !== proof.expectedCadArtifact.bytes
  ) {
    throw new TypeError(
      "Static structural input identity must match the sealed proof CAD artifact.",
    );
  }
  const stagedPath = requireCodeOwnedStagedAssetLocation(
    input.inputArtifact.stagedAsset.location,
    stepDigest,
  );
  const fixedSelections = proof.analysis.supports.map((support) =>
    support.selection.name
  );
  const loads = proof.analysis.loads.map((load) => ({
    selection: load.selection.name,
    forceN: load.force.value,
  }));
  const request: CalculixStaticSolveRequest = {
    step_path: stagedPath,
    expected_step_sha256: stepDigest,
    mesh_size_mm: proof.analysis.mesh.targetSize.value,
    material: {
      e_mpa: proof.analysis.material.youngModulus.value,
      nu: proof.analysis.material.poissonRatio.value,
    },
    selections: [
      ...proof.analysis.supports.map((support) => ({
        name: support.selection.name,
        box: {
          min: support.selection.box.min,
          max: support.selection.box.max,
        },
      })),
      ...proof.analysis.loads.map((load) => ({
        name: load.selection.name,
        box: {
          min: load.selection.box.min,
          max: load.selection.box.max,
        },
      })),
    ],
    fixed: fixedSelections,
    loads: loads.map((load) => ({
      selection: load.selection,
      force_n: load.forceN,
    })),
  };
  const supports: readonly StaticStructuralSupport[] = proof.analysis.supports.map(
    (support) => ({ selectionId: support.selection.name }),
  );
  const semanticLoads: readonly StaticStructuralLoad[] = proof.analysis.loads.map(
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

function requireCodeOwnedStagedAssetLocation(
  location: string,
  digest: string,
): string {
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
      "Static structural staged asset location must be an absolute safe path ending " +
        `with ${expectedFilename}.`,
    );
  }
  return location;
}
