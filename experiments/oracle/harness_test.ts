import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { validateSensitivityStudyCase } from "../../src/domain/sensitivity-study.ts";
import type {
  McpToolCall,
  McpToolResult,
} from "../../src/adapters/http-mcp-tool-client.ts";
import { buildCalculixArgs, judgeDisplacement, solveAtHeight } from "./harness.ts";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const SHA = "a".repeat(64);
const BYTES = 12345;
const EXPORT_NAME = "oracle-drip-tray-arm-b-t01-s0";
const STEP_PATH = `/exports/${EXPORT_NAME}.step`;

/**
 * Minimal validated sensitivity case reusing the real case parameters.
 * Uses the same schema, targets, and selection boxes as the reviewed
 * config/sensitivity-cases/coffee-machine-cm01-v3-drip-tray-size-z.json so
 * the test exercises the actual domain validators.
 */
function testCase() {
  return validateSensitivityStudyCase({
    schemaVersion: "sensitivity-study-case/1.0",
    id: "coffee-machine-cm01-v3-drip-tray-size-z-sensitivity-v1",
    revision: 1,
    scope: "Oracle harness test case.",
    evidenceBoundary: "Test only — not a reviewed proof.",
    project: {
      id: "coffee-machine-cm01-v3",
      subjectId: "project:coffee-machine-cm01-v3",
    },
    target: { componentKey: "drip-tray", semanticKey: "size-z" },
    recipeSource: {
      schemaVersion: "coffee-machine-semantic-recipe/2.0",
      key: "cm01-drip-tray-height-30",
    },
    baseValue: { value: 30, unit: "mm" },
    step: { value: 1, unit: "mm" },
    metrics: [
      { id: "assembly_max_displacement", unit: "mm" },
      { id: "assembly_max_von_mises", unit: "MPa" },
    ],
    solver: {
      provider: "calculix",
      tool: "calculix_solve_static",
      resultSchemaVersion: "2.0",
      mesh: { kind: "tetrahedral-volume", targetSizeMm: 5 },
      material: {
        model: "isotropic-linear-elastic",
        eMpa: 2200,
        nu: 0.35,
        basis: "PPMA nominal — test",
      },
      supports: [{
        id: "drip-tray-rear-wall",
        kind: "fixed",
        selection: {
          name: "FIXED",
          box: { min: [-96, 66.5, -16], max: [96, 68.5, 16], unit: "mm" },
        },
      }],
      loads: [{
        id: "drip-tray-front-face",
        kind: "force",
        selection: {
          name: "LOADED",
          box: { min: [-96, -68.5, -16], max: [96, -66.5, 16], unit: "mm" },
        },
        force: { value: [0, 0, -100], unit: "N" },
      }],
    },
    domain: {
      approximationOrder: "first-order-forward",
      remeshingVariationIncluded: true,
      localValidityNote: "Test.",
      limitations: ["Test limitation."],
    },
  });
}

/**
 * Stub build123d provider.
 *
 * Returns the exact structuredContent shape that parseBuild123dSensitivityExport
 * expects (schemaVersion 1.0, single STEP file). The path includes the export
 * name so the parser's name check passes.
 */
function stubBuild123d(name: string): {
  callTool(call: McpToolCall): Promise<McpToolResult>;
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>>;
} {
  return {
    callTool(_call: McpToolCall): Promise<McpToolResult> {
      return Promise.resolve({
        structuredContent: {
          schemaVersion: "1.0",
          kind: "export",
          files: [{
            format: "step",
            path: `/exports/${name}.step`,
            sha256: SHA,
            bytes: BYTES,
          }],
          metrics: {},
        },
        text: "",
      });
    },
    callToolTextResult(_call: McpToolCall): Promise<Record<string, unknown>> {
      return Promise.reject(new Error("callToolTextResult not used in harness"));
    },
  };
}

/**
 * Stub calculix provider.
 *
 * Returns the exact structuredContent shape that parseCalculixSensitivitySolve
 * expects (schemaVersion 2.0, static-solve). The inputArtifact.sourcePath and
 * inputArtifact.bytes must match what the build123d stub returned so that the
 * attestation check inside parseCalculixSensitivitySolve passes.
 */
function stubCalculix(
  sourcePath: string,
  dispValue: number,
  vmValue: number,
): {
  callTool(call: McpToolCall): Promise<McpToolResult>;
  callToolTextResult(call: McpToolCall): Promise<Record<string, unknown>>;
} {
  return {
    callTool(_call: McpToolCall): Promise<McpToolResult> {
      return Promise.resolve({
        structuredContent: {
          schemaVersion: "2.0",
          kind: "static-solve",
          inputArtifact: {
            path: "/tmp/oracle-input.step",
            sourcePath,
            sha256: SHA,
            bytes: BYTES,
          },
          mesh: { nodes: 10, elements: 5, nodesPerSelection: {} },
          constraints: { fixedSelections: ["FIXED"], loads: [] },
          metrics: {
            maxDisplacement: { value: dispValue, unit: "mm" },
            maxVonMises: { value: vmValue, unit: "MPa" },
          },
        },
        text: "",
      });
    },
    callToolTextResult(_call: McpToolCall): Promise<Record<string, unknown>> {
      return Promise.reject(new Error("callToolTextResult not used in harness"));
    },
  };
}

// ── judgeDisplacement ──────────────────────────────────────────────────────────

Deno.test("judgeDisplacement returns pass when measured value is strictly below threshold", () => {
  assertEquals(
    judgeDisplacement({ value: 0.085, unit: "mm" }, { value: 0.090, unit: "mm" }),
    "pass",
  );
});

Deno.test("judgeDisplacement returns pass when measured value equals threshold exactly", () => {
  assertEquals(
    judgeDisplacement({ value: 0.090, unit: "mm" }, { value: 0.090, unit: "mm" }),
    "pass",
  );
});

Deno.test("judgeDisplacement returns fail when measured value exceeds threshold", () => {
  assertEquals(
    judgeDisplacement({ value: 0.095, unit: "mm" }, { value: 0.090, unit: "mm" }),
    "fail",
  );
});

Deno.test("judgeDisplacement throws TypeError when units differ", () => {
  assertThrows(
    () => judgeDisplacement({ value: 0.090, unit: "m" }, { value: 0.090, unit: "mm" }),
    TypeError,
    "unit mismatch",
  );
});

Deno.test("judgeDisplacement throws TypeError when threshold uses an unexpected unit", () => {
  assertThrows(
    () => judgeDisplacement({ value: 0.090, unit: "mm" }, { value: 90, unit: "µm" }),
    TypeError,
    "unit mismatch",
  );
});

// ── buildCalculixArgs ──────────────────────────────────────────────────────────

Deno.test(
  "buildCalculixArgs includes step_path and expected_step_sha256 from the STEP export",
  () => {
    const sc = testCase();
    const args = buildCalculixArgs(sc, "/exports/test.step", SHA);
    assertEquals(args.step_path, "/exports/test.step");
    assertEquals(args.expected_step_sha256, SHA);
  },
);

Deno.test(
  "buildCalculixArgs uses mesh size, material, and selection boxes from the reviewed case",
  () => {
    const sc = testCase();
    const args = buildCalculixArgs(sc, "/exports/test.step", SHA);
    assertEquals(args.mesh_size_mm, 5);
    assertEquals(args.material, { e_mpa: 2200, nu: 0.35 });
    const sels = args.selections as Array<{
      name: string;
      box: { min: unknown; max: unknown };
    }>;
    assertEquals(sels.length, 2);
    assertEquals(sels[0].name, "FIXED");
    assertEquals(sels[1].name, "LOADED");
  },
);

Deno.test(
  "buildCalculixArgs encodes fixed supports and loads in the server-reviewed format",
  () => {
    const sc = testCase();
    const args = buildCalculixArgs(sc, "/exports/test.step", SHA);
    assertEquals(args.fixed, ["FIXED"]);
    const loads = args.loads as Array<{
      selection: string;
      force_n: unknown;
    }>;
    assertEquals(loads.length, 1);
    assertEquals(loads[0].selection, "LOADED");
    assertEquals(loads[0].force_n, [0, 0, -100]);
  },
);

// ── solveAtHeight ──────────────────────────────────────────────────────────────

Deno.test(
  "solveAtHeight returns displacement and von Mises values from provider responses",
  async () => {
    const sc = testCase();
    const build123d = stubBuild123d(EXPORT_NAME) as never;
    const calculix = stubCalculix(STEP_PATH, 0.0853, 0.478) as never;

    const result = await solveAtHeight(build123d, calculix, sc, 30, EXPORT_NAME);
    assertEquals(result.displacementMm, 0.0853);
    assertEquals(result.vonMisesMpa, 0.478);
    assertEquals(result.stepSha256, SHA);
  },
);

Deno.test(
  "solveAtHeight rejects a non-finite height before calling any provider",
  async () => {
    const sc = testCase();
    const build123d = {
      callTool(): never {
        throw new Error("provider must not be called for a non-finite height");
      },
      callToolTextResult(): never {
        throw new Error("provider must not be called for a non-finite height");
      },
    };
    await assertRejects(
      () => solveAtHeight(build123d as never, {} as never, sc, Infinity, "name"),
      TypeError,
      "finite positive",
    );
  },
);

Deno.test(
  "solveAtHeight rejects a zero height before calling any provider",
  async () => {
    const sc = testCase();
    await assertRejects(
      () => solveAtHeight({} as never, {} as never, sc, 0, "name"),
      TypeError,
      "finite positive",
    );
  },
);
