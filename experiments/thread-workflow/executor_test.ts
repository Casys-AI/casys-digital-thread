import { assertEquals, assertRejects } from "@std/assert";
import type {
  McpToolCall,
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import { compileThreadWorkflowValue } from "./compiler.ts";
import { WorkflowExecutor } from "./executor.ts";
import { InternalThreadToolClient } from "./internal-thread-tools.ts";
import { loadAndCompileThreadWorkflow } from "./loader.ts";

Deno.test("WorkflowExecutor pipes the exact CAD artifact into CalculiX", async () => {
  const calls: Array<{ server: string; call: McpToolCall }> = [];
  const clients = new Map<string, McpToolClient>([
    [
      "build123d",
      client("build123d", calls, {
        text: "STEP exported",
        structuredContent: {
          files: [{
            format: "step",
            path: "/exports/bracket-abc.step",
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
          }],
        },
      }),
    ],
    [
      "calculix",
      client("calculix", calls, {
        text: "Solve completed",
        structuredContent: {
          inputArtifact: {
            path: "/runs/solve-1/input.step",
            sha256: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            bytes: 1234,
          },
          metrics: { maxVonMises: { value: 26.6, unit: "MPa" } },
        },
      }),
    ],
  ]);
  const workflow = compileThreadWorkflowValue({
    schemaVersion: "1.0",
    kind: "thread-workflow",
    id: "mechanical",
    name: "Mechanical proof",
    nodes: {
      cad: {
        server: "build123d",
        tool: "build123d_export",
        outputs: {
          step_path: { select: "files.0.path", type: "artifact-uri" },
          step_sha256: { select: "files.0.sha256", type: "string" },
        },
      },
      fea: {
        server: "calculix",
        tool: "calculix_solve_static",
        arguments: {
          step_path: "${cad.step_path}",
          expected_step_sha256: "${cad.step_sha256}",
        },
        outputs: {
          input_step_sha256: {
            select: "inputArtifact.sha256",
            type: "string",
          },
          stress: { select: "metrics.maxVonMises", type: "quantity" },
        },
      },
    },
  });
  const execution = await executor(clients).execute(workflow);

  assertEquals(execution.status, "succeeded");
  assertEquals(calls.map((entry) => entry.server), ["build123d", "calculix"]);
  assertEquals(calls[1].call.arguments, {
    step_path: "/exports/bracket-abc.step",
    expected_step_sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  });
  assertEquals(execution.nodes[1].outputs, {
    input_step_sha256:
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    stress: { value: 26.6, unit: "MPa" },
  });
});

Deno.test("WorkflowExecutor blocks descendants of failed tools but runs independent branches", async () => {
  const calls: Array<{ server: string; call: McpToolCall }> = [];
  const failing: McpToolClient = {
    callTool: () => Promise.reject(new Error("CAD kernel failed")),
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
  const clients = new Map<string, McpToolClient>([
    ["build123d", failing],
    [
      "calculix",
      client("calculix", calls, {
        text: "not called",
        structuredContent: { result: true },
      }),
    ],
    [
      "erpnext",
      client("erpnext", calls, {
        text: "BOM read",
        structuredContent: { item: "CASYS-CM01" },
      }),
    ],
  ]);
  const workflow = compileThreadWorkflowValue({
    schemaVersion: "1.0",
    kind: "thread-workflow",
    id: "branches",
    name: "Branches",
    nodes: {
      cad: {
        server: "build123d",
        tool: "build123d_export",
        outputs: { step: { select: "files.0.path", type: "artifact-uri" } },
      },
      fea: {
        server: "calculix",
        tool: "calculix_solve_static",
        arguments: { step_path: "${cad.step}" },
        outputs: { result: { select: "result", type: "boolean" } },
      },
      bom: {
        server: "erpnext",
        tool: "erpnext_bom_surface",
        outputs: { item: { select: "item", type: "string" } },
      },
    },
  });
  const execution = await executor(clients).execute(workflow);

  assertEquals(execution.status, "failed");
  assertEquals(execution.nodes.map((node) => [node.nodeId, node.status]), [
    ["bom", "succeeded"],
    ["cad", "failed"],
    ["fea", "blocked"],
  ]);
  assertEquals(calls.map((entry) => entry.server), ["erpnext"]);
  assertEquals(execution.nodes[2].blockedBy, ["cad"]);
});

Deno.test("WorkflowExecutor records a missing declared output as a node failure", async () => {
  const clients = new Map<string, McpToolClient>([[
    "build123d",
    {
      callTool: () => Promise.resolve({ text: "done", structuredContent: {} }),
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    },
  ]]);
  const workflow = compileThreadWorkflowValue({
    schemaVersion: "1.0",
    kind: "thread-workflow",
    id: "missing-output",
    name: "Missing output",
    nodes: {
      cad: {
        server: "build123d",
        tool: "build123d_export",
        outputs: { step: { select: "files.0.path", type: "artifact-uri" } },
      },
    },
  });
  const execution = await executor(clients).execute(workflow);

  assertEquals(execution.status, "failed");
  assertEquals(execution.nodes[0].status, "failed");
  assertEquals(execution.nodes[0].error, "cad.step: missing result path files.0.path");
});

Deno.test("WorkflowExecutor validates declared runtime inputs before calling tools", async () => {
  let calls = 0;
  const workflow = compileThreadWorkflowValue({
    schemaVersion: "1.0",
    kind: "thread-workflow",
    id: "runtime-input",
    name: "Runtime input",
    inputs: { context_id: { type: "string" } },
    nodes: {
      read: {
        server: "syson",
        tool: "syson_constraint_extract",
        arguments: { editing_context_id: "${inputs.context_id}" },
        outputs: { constraints: { select: "constraints", type: "array" } },
      },
    },
  });
  const runner = new WorkflowExecutor({
    resolveClient: () => ({
      callTool: () => {
        calls++;
        return Promise.resolve({ text: "", structuredContent: { constraints: [] } });
      },
      callToolTextResult(call: McpToolCall) {
        return Promise.reject(
          new Error(
            `callToolTextResult is not implemented by this stub (${call.name})`,
          ),
        );
      },
    }),
  });

  await assertRejects(
    () => runner.execute(workflow),
    TypeError,
    "Missing workflow input",
  );
  await assertRejects(
    () => runner.execute(workflow, { context_id: 42 }),
    Error,
    "does not match output type string",
  );
  await assertRejects(
    () => runner.execute(workflow, { context_id: "ctx", extra: true }),
    TypeError,
    "Unknown workflow input",
  );
  assertEquals(calls, 0);
});

Deno.test("generic workflow blocks SysON evaluation when CalculiX attests different STEP bytes", async () => {
  const producerHash = "a".repeat(64);
  const consumedHash = "b".repeat(64);
  const calls: Array<{ server: string; call: McpToolCall }> = [];
  const clients = new Map<string, McpToolClient>([
    [
      "calculix",
      client("calculix", calls, {
        text: "Solve completed",
        structuredContent: {
          inputArtifact: {
            path: "/runs/solve-1/input.step",
            bytes: 1234,
            sha256: consumedHash,
          },
          metrics: {
            maxDisplacement: { value: 0.043, unit: "mm" },
            maxVonMises: { value: 26.6, unit: "MPa" },
          },
        },
      }),
    ],
    ["digital-thread", new InternalThreadToolClient()],
    [
      "syson",
      client("syson", calls, {
        text: "Constraints extracted",
        structuredContent: { constraints: [{}, {}] },
      }),
    ],
  ]);
  const workflow = await loadAndCompileThreadWorkflow(
    "experiments/thread-workflow/generic-static-mechanical-v1.yaml",
  );

  const execution = await executor(clients).execute(workflow, {
    syson_editing_context_id: "generic-context",
    syson_mechanical_requirements_element_id: "mechanical-requirements",
    cad_step_path: "/exports/generic-product-current.step",
    cad_step_sha256: producerHash,
    reviewed_mesh_size_mm: 4,
    reviewed_material_e_mpa: 70_000,
    reviewed_material_nu: 0.33,
    reviewed_fixed_box_min: [-131, -161, -191],
    reviewed_fixed_box_max: [131, 161, -189],
    reviewed_loaded_box_min: [-40, -40, 150],
    reviewed_loaded_box_max: [40, 40, 191],
    reviewed_load_force_x_n: 0,
    reviewed_load_force_y_n: 0,
    reviewed_load_force_z_n: -500,
  });

  assertEquals(execution.status, "failed");
  assertEquals(
    execution.nodes.map((node) => [node.nodeId, node.status]),
    [
      ["requirements", "succeeded"],
      ["mechanical", "succeeded"],
      ["observations", "failed"],
      ["evaluation", "blocked"],
    ],
  );
  assertEquals(
    execution.nodes[2].error?.includes("does not match consumed"),
    true,
  );
  assertEquals(
    calls.some((entry) => entry.call.name === "syson_constraint_evaluate"),
    false,
  );
});

function executor(clients: ReadonlyMap<string, McpToolClient>): WorkflowExecutor {
  const timestamps = [
    "2026-08-01T00:00:00.000Z",
    "2026-08-01T00:00:01.000Z",
    "2026-08-01T00:00:02.000Z",
    "2026-08-01T00:00:03.000Z",
    "2026-08-01T00:00:04.000Z",
    "2026-08-01T00:00:05.000Z",
    "2026-08-01T00:00:06.000Z",
    "2026-08-01T00:00:07.000Z",
  ];
  let index = 0;
  return new WorkflowExecutor({
    resolveClient: (server) => {
      const resolved = clients.get(server);
      if (!resolved) throw new Error(`Unknown server: ${server}`);
      return resolved;
    },
    now: () => new Date(timestamps[index++] ?? timestamps.at(-1)),
    monotonicNow: increasingClock(),
  });
}

function client(
  server: string,
  calls: Array<{ server: string; call: McpToolCall }>,
  result: McpToolResult,
): McpToolClient {
  return {
    callTool(call) {
      calls.push({ server, call });
      return Promise.resolve(result);
    },
    callToolTextResult(call: McpToolCall) {
      return Promise.reject(
        new Error(
          `callToolTextResult is not implemented by this stub (${call.name})`,
        ),
      );
    },
  };
}

function increasingClock(): () => number {
  let value = 0;
  return () => value++;
}
