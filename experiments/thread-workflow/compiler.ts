import type {
  CompiledBinding,
  CompiledThreadWorkflow,
  CompiledValue,
  CompiledWorkflowNode,
  ThreadWorkflowDefinition,
  WorkflowInputDefinition,
  WorkflowNodeDefinition,
  WorkflowOutputDefinition,
  WorkflowOutputType,
} from "./types.ts";

const IDENTIFIER = /^[a-z][a-z0-9_-]*$/;
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const SELECTOR = /^[a-zA-Z_][a-zA-Z0-9_]*(?:\.(?:[a-zA-Z_][a-zA-Z0-9_]*|\d+))*$/;
const BINDING = /^\$\{([a-z][a-z0-9_-]*)\.([a-z][a-z0-9_]*)(?:\.([a-zA-Z0-9_.-]+))?\}$/;
const INPUT_BINDING = /^\$\{inputs\.([a-z][a-z0-9_]*)\}$/;
const OUTPUT_TYPES = [
  "array",
  "artifact-uri",
  "boolean",
  "number",
  "object",
  "quantity",
  "string",
  "unknown",
] as const satisfies readonly WorkflowOutputType[];

export type WorkflowErrorCode =
  | "cycle"
  | "missing-reference"
  | "validation";

export class ThreadWorkflowError extends Error {
  constructor(
    readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ThreadWorkflowError";
  }
}

/** Validate an untrusted YAML/JSON value into the strict v1 authoring model. */
export function validateThreadWorkflow(value: unknown): ThreadWorkflowDefinition {
  const root = object(value, "workflow");
  exactKeys(
    root,
    ["schemaVersion", "kind", "id", "name", "description", "inputs", "nodes"],
    "workflow",
  );
  literal(root.schemaVersion, "1.0", "workflow.schemaVersion");
  literal(root.kind, "thread-workflow", "workflow.kind");
  const id = identifier(root.id, "workflow.id");
  const name = nonEmptyString(root.name, "workflow.name");
  const description = optionalString(root.description, "workflow.description");
  const rawInputs = root.inputs === undefined
    ? {}
    : object(root.inputs, "workflow.inputs");
  const inputs: Record<string, WorkflowInputDefinition> = {};
  for (const inputName of Object.keys(rawInputs).sort()) {
    if (!TOOL_NAME.test(inputName)) {
      validation(`workflow.inputs.${inputName} must be a lower-case input name`);
    }
    inputs[inputName] = validateInput(
      rawInputs[inputName],
      `workflow.inputs.${inputName}`,
    );
  }
  const rawNodes = object(root.nodes, "workflow.nodes");
  const nodeIds = Object.keys(rawNodes).sort();
  if (nodeIds.length === 0) {
    validation("workflow.nodes must contain at least one node");
  }

  const nodes: Record<string, WorkflowNodeDefinition> = {};
  for (const nodeId of nodeIds) {
    identifier(nodeId, `workflow.nodes.${nodeId}`);
    nodes[nodeId] = validateNode(rawNodes[nodeId], `workflow.nodes.${nodeId}`);
  }

  return {
    schemaVersion: "1.0",
    kind: "thread-workflow",
    id,
    name,
    ...(description === undefined ? {} : { description }),
    inputs,
    nodes,
  };
}

/** Compile a validated definition into a deterministic typed DAG. */
export function compileThreadWorkflow(
  definition: ThreadWorkflowDefinition,
): CompiledThreadWorkflow {
  const nodeIds = Object.keys(definition.nodes).sort();
  const compiledById = new Map<string, CompiledWorkflowNode>();

  for (const nodeId of nodeIds) {
    const node = definition.nodes[nodeId];
    const explicitDependencies = [...new Set(node.needs)].sort();
    for (const dependency of explicitDependencies) {
      requireNode(definition, dependency, `workflow.nodes.${nodeId}.needs`);
    }

    const inferred = new Set<string>();
    const compiledArguments = compileValue(
      node.arguments,
      definition,
      inferred,
      `workflow.nodes.${nodeId}.arguments`,
    ) as Readonly<Record<string, CompiledValue>>;
    const inferredDependencies = [...inferred].sort();
    const dependencies = [
      ...new Set([
        ...explicitDependencies,
        ...inferredDependencies,
      ]),
    ].sort();

    compiledById.set(nodeId, {
      id: nodeId,
      ...(node.description === undefined ? {} : { description: node.description }),
      server: node.server,
      tool: node.tool,
      arguments: compiledArguments,
      outputs: sortRecord(node.outputs),
      explicitDependencies,
      inferredDependencies,
      dependencies,
    });
  }

  const orderedIds = topologicalOrder(compiledById);
  return {
    schemaVersion: "1.0",
    kind: "thread-workflow-dag",
    id: definition.id,
    name: definition.name,
    ...(definition.description === undefined
      ? {}
      : { description: definition.description }),
    inputs: sortRecord(definition.inputs),
    nodes: orderedIds.map((id) => compiledById.get(id)!),
  };
}

/** Validate and compile in one deterministic operation. */
export function compileThreadWorkflowValue(value: unknown): CompiledThreadWorkflow {
  return compileThreadWorkflow(validateThreadWorkflow(value));
}

function validateNode(value: unknown, path: string): WorkflowNodeDefinition {
  const node = object(value, path);
  exactKeys(
    node,
    ["description", "server", "tool", "needs", "arguments", "outputs"],
    path,
  );
  const server = identifier(node.server, `${path}.server`);
  const tool = nonEmptyString(node.tool, `${path}.tool`);
  if (!TOOL_NAME.test(tool)) {
    validation(`${path}.tool must be a lower-case MCP tool name`);
  }
  const description = optionalString(node.description, `${path}.description`);
  const needs = node.needs === undefined
    ? []
    : stringArray(node.needs, `${path}.needs`).map((dependency, index) =>
      identifier(dependency, `${path}.needs[${index}]`)
    );
  const argumentsValue = node.arguments === undefined
    ? {}
    : jsonObject(node.arguments, `${path}.arguments`);
  const rawOutputs = object(node.outputs, `${path}.outputs`);
  const outputNames = Object.keys(rawOutputs).sort();
  if (outputNames.length === 0) {
    validation(`${path}.outputs must contain at least one named output`);
  }
  const outputs: Record<string, WorkflowOutputDefinition> = {};
  for (const outputName of outputNames) {
    if (!TOOL_NAME.test(outputName)) {
      validation(`${path}.outputs.${outputName} must be a lower-case output name`);
    }
    outputs[outputName] = validateOutput(
      rawOutputs[outputName],
      `${path}.outputs.${outputName}`,
    );
  }
  return {
    ...(description === undefined ? {} : { description }),
    server,
    tool,
    needs: [...new Set(needs)].sort(),
    arguments: argumentsValue,
    outputs,
  };
}

function validateOutput(value: unknown, path: string): WorkflowOutputDefinition {
  const output = object(value, path);
  exactKeys(output, ["select", "type", "minItems", "description"], path);
  const select = nonEmptyString(output.select, `${path}.select`);
  if (!SELECTOR.test(select)) {
    validation(`${path}.select must be a dot-separated structuredContent path`);
  }
  const type = oneOf(output.type, OUTPUT_TYPES, `${path}.type`);
  const minItems = output.minItems === undefined
    ? undefined
    : positiveInteger(output.minItems, `${path}.minItems`);
  if (minItems !== undefined && type !== "array") {
    validation(`${path}.minItems is supported only for array outputs`);
  }
  const description = optionalString(output.description, `${path}.description`);
  return {
    select,
    type,
    ...(minItems === undefined ? {} : { minItems }),
    ...(description === undefined ? {} : { description }),
  };
}

function validateInput(value: unknown, path: string): WorkflowInputDefinition {
  const input = object(value, path);
  exactKeys(input, ["type", "description"], path);
  const type = oneOf(input.type, OUTPUT_TYPES, `${path}.type`);
  const description = optionalString(input.description, `${path}.description`);
  return {
    type,
    ...(description === undefined ? {} : { description }),
  };
}

function compileValue(
  value: unknown,
  definition: ThreadWorkflowDefinition,
  inferred: Set<string>,
  path: string,
): CompiledValue {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) validation(`${path} must be a finite number`);
    return value;
  }
  if (typeof value === "string") {
    return compileString(value, definition, inferred, path);
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      compileValue(item, definition, inferred, `${path}[${index}]`)
    );
  }
  if (isObject(value)) {
    const result: Record<string, CompiledValue> = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = compileValue(value[key], definition, inferred, `${path}.${key}`);
    }
    return result;
  }
  validation(`${path} must be JSON-compatible`);
}

function compileString(
  value: string,
  definition: ThreadWorkflowDefinition,
  inferred: Set<string>,
  path: string,
): string | CompiledBinding {
  const inputMatch = INPUT_BINDING.exec(value);
  if (inputMatch) {
    const inputName = inputMatch[1];
    const input = definition.inputs[inputName];
    if (!input) {
      throw new ThreadWorkflowError(
        "missing-reference",
        `${path} references missing workflow input ${inputName}`,
      );
    }
    return {
      kind: "binding",
      expression: value,
      source: {
        kind: "workflow-input",
        input: inputName,
        type: input.type,
      },
    };
  }
  const match = BINDING.exec(value);
  if (!match) {
    if (value.includes("${")) {
      validation(
        `${path} contains an invalid binding; bindings must occupy the full string as \${node.output}`,
      );
    }
    return value;
  }
  const [, nodeId, outputName, suffix] = match;
  const sourceNode = requireNode(definition, nodeId, path);
  const output = sourceNode.outputs[outputName];
  if (!output) {
    throw new ThreadWorkflowError(
      "missing-reference",
      `${path} references missing output ${nodeId}.${outputName}`,
    );
  }
  const nestedPath = suffix === undefined ? [] : suffix.split(".");
  inferred.add(nodeId);
  return {
    kind: "binding",
    expression: value,
    source: {
      kind: "node-output",
      nodeId,
      output: outputName,
      path: nestedPath,
      type: output.type,
    },
  };
}

function topologicalOrder(nodes: Map<string, CompiledWorkflowNode>): string[] {
  const dependants = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  for (const id of nodes.keys()) {
    dependants.set(id, []);
    indegree.set(id, 0);
  }
  for (const node of nodes.values()) {
    indegree.set(node.id, node.dependencies.length);
    for (const dependency of node.dependencies) {
      dependants.get(dependency)!.push(node.id);
    }
  }
  for (const values of dependants.values()) values.sort();

  const ready = [...nodes.keys()].filter((id) => indegree.get(id) === 0).sort();
  const ordered: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift()!;
    ordered.push(id);
    for (const dependant of dependants.get(id)!) {
      const remaining = indegree.get(dependant)! - 1;
      indegree.set(dependant, remaining);
      if (remaining === 0) insertSorted(ready, dependant);
    }
  }

  if (ordered.length !== nodes.size) {
    const cyclic = [...nodes.keys()].filter((id) => !ordered.includes(id)).sort();
    throw new ThreadWorkflowError(
      "cycle",
      `Workflow dependency cycle involves: ${cyclic.join(", ")}`,
    );
  }
  return ordered;
}

function requireNode(
  definition: ThreadWorkflowDefinition,
  nodeId: string,
  path: string,
): WorkflowNodeDefinition {
  const node = definition.nodes[nodeId];
  if (!node) {
    throw new ThreadWorkflowError(
      "missing-reference",
      `${path} references missing node ${nodeId}`,
    );
  }
  return node;
}

function insertSorted(values: string[], value: string): void {
  const index = values.findIndex((candidate) => candidate > value);
  if (index === -1) values.push(value);
  else values.splice(index, 0, value);
}

function sortRecord<T>(value: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, value[key]]));
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key)).sort();
  if (unknown.length > 0) {
    validation(`${path} contains unsupported key(s): ${unknown.join(", ")}`);
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!isObject(value)) validation(`${path} must be an object`);
  return value;
}

function jsonObject(value: unknown, path: string): Record<string, unknown> {
  const result = object(value, path);
  assertJsonCompatible(result, path);
  return result;
}

function assertJsonCompatible(value: unknown, path: string): void {
  if (value === null || typeof value === "string" || typeof value === "boolean") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) validation(`${path} must be a finite number`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertJsonCompatible(item, `${path}[${index}]`));
    return;
  }
  if (isObject(value)) {
    for (const [key, item] of Object.entries(value)) {
      assertJsonCompatible(item, `${path}.${key}`);
    }
    return;
  }
  validation(`${path} must be JSON-compatible`);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype;
}

function nonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    validation(`${path} must be a non-empty string`);
  }
  return value;
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined ? undefined : nonEmptyString(value, path);
}

function positiveInteger(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    validation(`${path} must be a positive integer`);
  }
  return value as number;
}

function identifier(value: unknown, path: string): string {
  const text = nonEmptyString(value, path);
  if (!IDENTIFIER.test(text)) {
    validation(`${path} must match ${IDENTIFIER}`);
  }
  return text;
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    validation(`${path} must be an array of strings`);
  }
  return value;
}

function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) validation(`${path} must be ${JSON.stringify(expected)}`);
}

function oneOf<const T extends readonly string[]>(
  value: unknown,
  allowed: T,
  path: string,
): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) {
    validation(`${path} must be one of: ${allowed.join(", ")}`);
  }
  return value;
}

function validation(message: string): never {
  throw new ThreadWorkflowError("validation", message);
}
