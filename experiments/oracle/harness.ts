/**
 * Primitive solve and judge functions for the oracle B-vs-C experiment.
 *
 * Why this boundary exists: solveAtHeight wraps the two-provider sequence
 * (build123d → CalculiX) and exposes a uniform {displacementMm, vonMisesMpa}
 * interface. judgeDisplacement applies the frozen threshold with an explicit
 * unit check so a displacement in metres can never silently pass a threshold
 * declared in mm.
 *
 * Neither function writes to state/, publishes a snapshot, or touches any
 * project revision store. This module is a measurement harness, not the
 * product-path proof chain.
 */

import { renderDripTraySensitivityScriptForHeight } from "../../src/domain/cm01/cm01-drip-tray-analysis-scripts.ts";
import type { SensitivityStudyCase } from "../../src/domain/analysis/sensitivity-study.ts";
import {
  parseBuild123dSensitivityExport,
  parseCalculixSensitivitySolve,
} from "../../src/adapters/executors/cm01/coffee-machine-cm01-v3-sensitivity-run-executor.ts";
import type { McpToolClient } from "../../src/adapters/mcp/http-mcp-tool-client.ts";

export interface SolveResult {
  readonly displacementMm: number;
  readonly vonMisesMpa: number;
  /** SHA-256 of the CalculiX input artifact (attests provenance of the solve). */
  readonly stepSha256: string;
}

/**
 * Build the CalculiX request arguments from the reviewed sensitivity case and
 * the STEP export path returned by build123d.
 *
 * This function mirrors the private buildCalculixRequest in the sensitivity
 * executor without importing or modifying that private symbol. The sensitivity
 * case is the sole authority on mesh size, material constants, and
 * selection-box geometry — no free agent input can reach the solver.
 *
 * Exported for isolated unit testing.
 */
export function buildCalculixArgs(
  sc: SensitivityStudyCase,
  stepPath: string,
  stepSha256: string,
): Record<string, unknown> {
  return {
    step_path: stepPath,
    expected_step_sha256: stepSha256,
    mesh_size_mm: sc.solver.mesh.targetSizeMm,
    material: { e_mpa: sc.solver.material.eMpa, nu: sc.solver.material.nu },
    selections: [
      ...sc.solver.supports.map((s) => ({
        name: s.selection.name,
        box: { min: s.selection.box.min, max: s.selection.box.max },
      })),
      ...sc.solver.loads.map((l) => ({
        name: l.selection.name,
        box: { min: l.selection.box.min, max: l.selection.box.max },
      })),
    ],
    fixed: sc.solver.supports.map((s) => s.selection.name),
    loads: sc.solver.loads.map((l) => ({
      selection: l.selection.name,
      force_n: l.force.value,
    })),
  };
}

/**
 * Compare a measured displacement to the frozen threshold with an explicit
 * unit check.
 *
 * A unit mismatch is always a hard error: silently comparing mm against m is
 * exactly the class of dimensionality bug that the CASYS protocol is designed
 * to eliminate. The threshold value must come from tasks.json via the runner —
 * never from the policy or the provider response.
 */
export function judgeDisplacement(
  measured: { readonly value: number; readonly unit: string },
  threshold: { readonly value: number; readonly unit: string },
): "pass" | "fail" {
  if (measured.unit !== threshold.unit) {
    throw new TypeError(
      `Displacement unit mismatch: measured unit "${measured.unit}" ` +
        `vs threshold unit "${threshold.unit}". ` +
        `Comparing values across units is an error, not a comparison.`,
    );
  }
  return measured.value <= threshold.value ? "pass" : "fail";
}

/**
 * Execute a single FEA solve at the given height by calling build123d_export
 * then calculix_solve_static.
 *
 * The exportName must be globally unique for the duration of the experiment
 * session: the /exports Docker volume accumulates STEP files by name, and a
 * collision causes silent result corruption (build123d overwrites, CalculiX
 * reads the wrong geometry). Convention used by the runner:
 *   oracle-drip-tray-<armId>-<taskId>-s<solveIndex>
 *
 * This function does not write to state/ and does not publish any ThreadSnapshot.
 */
export async function solveAtHeight(
  build123d: McpToolClient,
  calculix: McpToolClient,
  sc: SensitivityStudyCase,
  heightMm: number,
  exportName: string,
): Promise<SolveResult> {
  if (!Number.isFinite(heightMm) || heightMm <= 0) {
    throw new TypeError(
      `solveAtHeight: heightMm must be a finite positive number, got ${heightMm}`,
    );
  }

  // Step 1: render the DripTray geometry at the given height and export STEP.
  const script = renderDripTraySensitivityScriptForHeight(heightMm);
  const buildResult = await build123d.callTool({
    name: "build123d_export",
    arguments: {
      script,
      formats: ["step"],
      name: exportName,
      timeout_ms: 120000,
    },
  });
  const { path: stepPath, sha256: stepSha256, bytes: stepBytes } =
    parseBuild123dSensitivityExport(buildResult.structuredContent, exportName);

  // Step 2: run the linear static FEA on the exported STEP.
  const calcArgs = buildCalculixArgs(sc, stepPath, stepSha256);
  const calcResult = await calculix.callTool({
    name: "calculix_solve_static",
    arguments: calcArgs,
  });
  const { handoffSha256, metrics } = parseCalculixSensitivitySolve(
    calcResult.structuredContent,
    sc,
    stepPath,
    stepBytes,
  );

  return {
    displacementMm: metrics.maxDisplacement.value,
    vonMisesMpa: metrics.maxVonMises.value,
    stepSha256: handoffSha256,
  };
}
