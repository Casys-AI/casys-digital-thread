import { assertEquals } from "@std/assert";
import type { McpToolClient } from "../../mcp/http-mcp-tool-client.ts";
import {
  validateMechanicalProofCase,
} from "../../../domain/analysis/mechanical-proof-case.ts";
import {
  lowerCalculixStaticStructuralSolve,
  McpCalculixStaticStructuralSolver,
} from "./mcp-calculix-static-structural-solver.ts";
import { exactFeaSolverResultForCapture } from "../../captures/fea-solver-capture.ts";

Deno.test("CalculiX adapter lowers a sealed proof to the exact static-solve request", async () => {
  const proof = validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
    ),
  ));
  const stagedPath = `/exports/fea-${proof.expectedCadArtifact.sha256}.step`;
  const plan = lowerCalculixStaticStructuralSolve({
    proof,
    inputArtifact: {
      fingerprint: {
        algorithm: "sha256",
        digest: proof.expectedCadArtifact.sha256,
      },
      byteCount: proof.expectedCadArtifact.bytes,
    },
  });

  assertEquals(plan.exactRequest, {
    step_path: stagedPath,
    expected_step_sha256: proof.expectedCadArtifact.sha256,
    mesh_size_mm: 5,
    material: { e_mpa: 2200, nu: 0.35 },
    selections: [
      {
        name: "FIXED",
        box: { min: [-96, 66.5, -15], max: [96, 68.5, 15] },
      },
      {
        name: "LOADED",
        box: { min: [-96, -68.5, -15], max: [96, -66.5, 15] },
      },
    ],
    fixed: ["FIXED"],
    loads: [{ selection: "LOADED", force_n: [0, 0, -100] }],
  });
  assertEquals(plan.executionOperation, {
    serverId: "calculix",
    operationId: "calculix_solve_static",
  });
});

Deno.test("CalculiX adapter owns the exact static-solve tool dispatch", async () => {
  const proof = validateMechanicalProofCase(JSON.parse(
    await Deno.readTextFile(
      "config/mechanical-proof-cases/coffee-machine-cm01-drip-tray-v1.json",
    ),
  ));
  const stagedPath = `/exports/fea-${proof.expectedCadArtifact.sha256}.step`;
  const calls: unknown[] = [];
  const providerResponse = {
    schemaVersion: "2.0",
    kind: "static-solve",
    inputArtifact: {
      path: "/tmp/provider/input.step",
      sourcePath: stagedPath,
      sha256: proof.expectedCadArtifact.sha256,
      bytes: proof.expectedCadArtifact.bytes,
    },
    constraints: {
      fixedSelections: ["FIXED"],
      loads: [{ selection: "LOADED", forceN: [0, 0, -100] }],
    },
    mesh: {
      nodes: 8,
      elements: 4,
      nodesPerSelection: { FIXED: 4, LOADED: 4 },
    },
    metrics: {
      maxDisplacement: {
        value: 0.1,
        unit: "mm",
        nodeId: 8,
        vectorMm: [0, 0, -0.1],
      },
      maxVonMises: { value: 2, unit: "MPa", elementId: 4 },
    },
  };
  const client: McpToolClient = {
    callTool(call) {
      calls.push(call);
      return Promise.resolve({
        structuredContent: providerResponse,
        text: "",
      });
    },
    callToolTextResult() {
      return Promise.reject(new Error("unused"));
    },
  };
  const solver = new McpCalculixStaticStructuralSolver(client);
  const plan = solver.resolve({
    proof,
    inputArtifact: {
      fingerprint: {
        algorithm: "sha256",
        digest: proof.expectedCadArtifact.sha256,
      },
      byteCount: proof.expectedCadArtifact.bytes,
    },
  });

  const execution = await solver.solve(plan);
  assertEquals(calls, [{
    name: "calculix_solve_static",
    arguments: plan.exactRequest,
  }]);
  assertEquals(execution.result, {
    inputAttestation: {
      fingerprint: {
        algorithm: "sha256",
        digest: proof.expectedCadArtifact.sha256,
      },
      byteCount: proof.expectedCadArtifact.bytes,
    },
    boundaryConditions: {
      supports: [{ selectionId: "FIXED" }],
      loads: [{
        selectionId: "LOADED",
        force: { value: [0, 0, -100], unit: "N" },
      }],
    },
    mesh: { nodeCount: 8, elementCount: 4 },
    observations: {
      maximumDisplacement: {
        magnitude: { value: 0.1, unit: "mm" },
        vector: { value: [0, 0, -0.1], unit: "mm" },
      },
      maximumVonMisesStress: {
        magnitude: { value: 2, unit: "MPa" },
      },
    },
  });
  const exactCapture = exactFeaSolverResultForCapture(execution.captureToken);
  assertEquals(exactCapture.inputArtifact.path, "/tmp/provider/input.step");
  assertEquals(exactCapture.mesh.nodesPerSelection, { FIXED: 4, LOADED: 4 });
  assertEquals(exactCapture.metrics.maxDisplacement.nodeId, 8);
  assertEquals(exactCapture.metrics.maxVonMises.elementId, 4);
});
