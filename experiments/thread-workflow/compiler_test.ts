import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  compileThreadWorkflowValue,
  ThreadWorkflowError,
  validateThreadWorkflow,
} from "./compiler.ts";
import { loadAndCompileThreadWorkflow, loadThreadWorkflow } from "./loader.ts";
import type { CompiledBinding } from "./types.ts";

const GENERIC_WORKFLOW =
  "experiments/thread-workflow/generic-static-mechanical-v1.yaml";

Deno.test("generic workflow compiles the canonical STEP to FEA to normalization to SysON data chain", async () => {
  const workflow = await loadAndCompileThreadWorkflow(GENERIC_WORKFLOW);

  assertEquals(workflow.kind, "thread-workflow-dag");
  assertEquals(workflow.nodes.map((node) => node.id), [
    "requirements",
    "mechanical",
    "observations",
    "evaluation",
  ]);

  const mechanical = workflow.nodes.find((node) => node.id === "mechanical")!;
  assertEquals(mechanical.explicitDependencies, ["requirements"]);
  assertEquals(mechanical.inferredDependencies, []);
  assertEquals(mechanical.dependencies, ["requirements"]);
  assertEquals(mechanical.arguments.step_path, {
    kind: "binding",
    expression: "${inputs.cad_step_path}",
    source: {
      kind: "workflow-input",
      input: "cad_step_path",
      type: "artifact-uri",
    },
  });
  assertEquals(mechanical.arguments.expected_step_sha256, {
    kind: "binding",
    expression: "${inputs.cad_step_sha256}",
    source: {
      kind: "workflow-input",
      input: "cad_step_sha256",
      type: "string",
    },
  });
  assertEquals(
    (mechanical.arguments.material as Record<string, unknown>).e_mpa,
    {
      kind: "binding",
      expression: "${inputs.reviewed_material_e_mpa}",
      source: {
        kind: "workflow-input",
        input: "reviewed_material_e_mpa",
        type: "number",
      },
    },
  );

  const observations = workflow.nodes.find((node) => node.id === "observations")!;
  assertEquals(observations.dependencies, ["mechanical"]);

  const evaluation = workflow.nodes.find((node) => node.id === "evaluation")!;
  assertEquals(evaluation.dependencies, ["observations", "requirements"]);
  assertEquals(
    evaluation.arguments.constraints,
    binding({
      expression: "${requirements.constraints}",
      nodeId: "requirements",
      output: "constraints",
      type: "array",
    }),
  );

  const requirements = workflow.nodes.find((node) => node.id === "requirements")!;
  assertEquals(requirements.arguments.editing_context_id, {
    kind: "binding",
    expression: "${inputs.syson_editing_context_id}",
    source: {
      kind: "workflow-input",
      input: "syson_editing_context_id",
      type: "string",
    },
  });
  assertEquals(
    evaluation.arguments.values,
    binding({
      expression: "${observations.values}",
      nodeId: "observations",
      output: "values",
      type: "object",
    }),
  );
});

Deno.test("compiler output is deterministic across source key order", () => {
  const first = compileThreadWorkflowValue(fixture({ reverse: false }));
  const second = compileThreadWorkflowValue(fixture({ reverse: true }));
  assertEquals(second, first);
  assertEquals(first.nodes.map((node) => node.id), ["extract", "evaluate"]);
  assertEquals(first.nodes[1].explicitDependencies, ["extract"]);
  assertEquals(first.nodes[1].inferredDependencies, ["extract"]);
  assertEquals(first.nodes[1].dependencies, ["extract"]);
  assertEquals(Object.keys(first.nodes[1].arguments), ["constraints", "values"]);
});

Deno.test("compiler reports missing node and output references", () => {
  const missingNode = fixture();
  missingNode.nodes.evaluate.arguments.constraints = "${absent.constraints}";
  const nodeError = assertThrows(
    () => compileThreadWorkflowValue(missingNode),
    ThreadWorkflowError,
    "references missing node absent",
  );
  assertEquals(nodeError.code, "missing-reference");

  const missingOutput = fixture();
  missingOutput.nodes.evaluate.arguments.constraints = "${extract.absent}";
  const outputError = assertThrows(
    () => compileThreadWorkflowValue(missingOutput),
    ThreadWorkflowError,
    "references missing output extract.absent",
  );
  assertEquals(outputError.code, "missing-reference");
});

Deno.test("compiler rejects dependency cycles deterministically", () => {
  const cyclic = fixture();
  (cyclic.nodes.extract as { arguments: Record<string, unknown> }).arguments = {
    feedback: "${evaluate.results}",
  };
  const error = assertThrows(
    () => compileThreadWorkflowValue(cyclic),
    ThreadWorkflowError,
    "Workflow dependency cycle involves: evaluate, extract",
  );
  assertEquals(error.code, "cycle");
});

Deno.test("v1 grammar rejects UI layout and ambiguous partial interpolation", () => {
  const withLayout = { ...fixture(), layout: { columns: 2 } };
  const layoutError = assertThrows(
    () => validateThreadWorkflow(withLayout),
    ThreadWorkflowError,
    "unsupported key(s): layout",
  );
  assertEquals(layoutError.code, "validation");

  const partial = fixture();
  partial.nodes.evaluate.arguments.constraints = "prefix-${extract.constraints}";
  const bindingError = assertThrows(
    () => compileThreadWorkflowValue(partial),
    ThreadWorkflowError,
    "bindings must occupy the full string",
  );
  assertEquals(bindingError.code, "validation");
});

Deno.test("loader distinguishes malformed YAML and performs no execution", async () => {
  let reads = 0;
  const definition = await loadThreadWorkflow("memory.yaml", {
    readTextFile: () => {
      reads++;
      return Promise.resolve(`
schemaVersion: "1.0"
kind: thread-workflow
id: one-node
name: One node
nodes:
  read:
    server: example
    tool: example_read
    outputs:
      result: { select: result, type: unknown }
`);
    },
  });
  assertEquals(reads, 1);
  assertEquals(Object.keys(definition.nodes), ["read"]);

  const error = await assertRejects(
    () =>
      loadThreadWorkflow("broken.yaml", {
        readTextFile: () => Promise.resolve("nodes: ["),
      }),
    ThreadWorkflowError,
    "Invalid YAML in thread workflow broken.yaml",
  );
  assertEquals(error.code, "validation");
});

function binding(input: {
  expression: string;
  nodeId: string;
  output: string;
  type: CompiledBinding["source"]["type"];
}): CompiledBinding {
  return {
    kind: "binding",
    expression: input.expression,
    source: {
      kind: "node-output",
      nodeId: input.nodeId,
      output: input.output,
      path: [],
      type: input.type,
    },
  };
}

function fixture(options: { reverse?: boolean } = {}) {
  const extract = {
    server: "syson",
    tool: "syson_constraint_extract",
    arguments: { element_id: "requirements", editing_context_id: "context" },
    outputs: {
      constraints: { select: "constraints", type: "array" },
    },
  };
  const evaluate = {
    server: "syson",
    tool: "syson_constraint_evaluate",
    needs: ["extract"],
    arguments: options.reverse
      ? {
        values: { stress: { unit: "MPa", value: 42 } },
        constraints: "${extract.constraints}",
      }
      : {
        constraints: "${extract.constraints}",
        values: { stress: { value: 42, unit: "MPa" } },
      },
    outputs: {
      results: { select: "results", type: "array" },
    },
  };
  return {
    schemaVersion: "1.0",
    kind: "thread-workflow",
    id: "fixture",
    name: "Fixture",
    nodes: options.reverse ? { evaluate, extract } : { extract, evaluate },
  };
}
