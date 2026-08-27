import type {
  McpToolClient,
  McpToolResult,
} from "../../src/application/ports/out/mcp-tool-client.ts";
import type {
  CompiledBinding,
  CompiledThreadWorkflow,
  CompiledValue,
  CompiledWorkflowNode,
  WorkflowOutputType,
} from "./types.ts";

export type WorkflowNodeExecutionStatus = "succeeded" | "failed" | "blocked";

export interface WorkflowNodeExecution {
  nodeId: string;
  server: string;
  tool: string;
  status: WorkflowNodeExecutionStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  arguments?: Readonly<Record<string, unknown>>;
  outputs?: Readonly<Record<string, unknown>>;
  structuredContent?: Readonly<Record<string, unknown>>;
  summary?: string;
  error?: string;
  blockedBy?: readonly string[];
}

export interface WorkflowExecution {
  workflowId: string;
  status: "succeeded" | "failed";
  startedAt: string;
  completedAt: string;
  nodes: readonly WorkflowNodeExecution[];
}

export interface WorkflowExecutorOptions {
  resolveClient: (serverId: string) => McpToolClient;
  now?: () => Date;
  monotonicNow?: () => number;
}

/**
 * Executes a previously reviewed and compiled workflow when explicitly called.
 *
 * This object is intentionally not connected to page load or snapshot reads.
 * Independent nodes may still run after another branch fails, while descendants
 * of a failed node are recorded as blocked and never called.
 */
export class WorkflowExecutor {
  readonly #resolveClient: (serverId: string) => McpToolClient;
  readonly #now: () => Date;
  readonly #monotonicNow: () => number;

  constructor(options: WorkflowExecutorOptions) {
    this.#resolveClient = options.resolveClient;
    this.#now = options.now ?? (() => new Date());
    this.#monotonicNow = options.monotonicNow ?? (() => performance.now());
  }

  async execute(
    workflow: CompiledThreadWorkflow,
    inputs: Readonly<Record<string, unknown>> = {},
  ): Promise<WorkflowExecution> {
    validateWorkflowInputs(workflow, inputs);
    const startedAt = this.#now().toISOString();
    const executions = new Map<string, WorkflowNodeExecution>();
    const selectedOutputs = new Map<string, Readonly<Record<string, unknown>>>();

    for (const node of workflow.nodes) {
      const blockedBy = node.dependencies.filter((dependency) =>
        executions.get(dependency)?.status !== "succeeded"
      );
      if (blockedBy.length > 0) {
        executions.set(node.id, {
          nodeId: node.id,
          server: node.server,
          tool: node.tool,
          status: "blocked",
          error: `Blocked by unsuccessful dependencies: ${blockedBy.join(", ")}`,
          blockedBy,
        });
        continue;
      }
      executions.set(
        node.id,
        await this.#executeNode(node, selectedOutputs, inputs),
      );
      const execution = executions.get(node.id)!;
      if (execution.status === "succeeded" && execution.outputs) {
        selectedOutputs.set(node.id, execution.outputs);
      }
    }

    const nodes = workflow.nodes.map((node) => executions.get(node.id)!);
    return {
      workflowId: workflow.id,
      status: nodes.every((node) => node.status === "succeeded")
        ? "succeeded"
        : "failed",
      startedAt,
      completedAt: this.#now().toISOString(),
      nodes,
    };
  }

  async #executeNode(
    node: CompiledWorkflowNode,
    selectedOutputs: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
    inputs: Readonly<Record<string, unknown>>,
  ): Promise<WorkflowNodeExecution> {
    const startedAt = this.#now().toISOString();
    const startedTick = this.#monotonicNow();
    let args: Readonly<Record<string, unknown>> | undefined;
    try {
      args = resolveArguments(node.arguments, selectedOutputs, inputs);
      const client = this.#resolveClient(node.server);
      const result = await client.callTool({ name: node.tool, arguments: args });
      const outputs = selectOutputs(node, result);
      return {
        nodeId: node.id,
        server: node.server,
        tool: node.tool,
        status: "succeeded",
        startedAt,
        completedAt: this.#now().toISOString(),
        durationMs: elapsed(this.#monotonicNow(), startedTick),
        arguments: args,
        outputs,
        structuredContent: structuredClone(result.structuredContent),
        ...(result.text === "" ? {} : { summary: result.text }),
      };
    } catch (error) {
      return {
        nodeId: node.id,
        server: node.server,
        tool: node.tool,
        status: "failed",
        startedAt,
        completedAt: this.#now().toISOString(),
        durationMs: elapsed(this.#monotonicNow(), startedTick),
        ...(args === undefined ? {} : { arguments: args }),
        error: errorMessage(error),
      };
    }
  }
}

function resolveArguments(
  argumentsValue: Readonly<Record<string, CompiledValue>>,
  outputs: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  inputs: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return resolveValue(argumentsValue, outputs, inputs) as Readonly<
    Record<string, unknown>
  >;
}

function resolveValue(
  value: CompiledValue,
  outputs: ReadonlyMap<string, Readonly<Record<string, unknown>>>,
  inputs: Readonly<Record<string, unknown>>,
): unknown {
  if (isBinding(value)) {
    if (value.source.kind === "workflow-input") {
      return structuredClone(inputs[value.source.input]);
    }
    const nodeOutputs = outputs.get(value.source.nodeId);
    if (!nodeOutputs) {
      throw new Error(
        `${value.expression}: source node ${value.source.nodeId} has no successful outputs`,
      );
    }
    const selected = nodeOutputs[value.source.output];
    return structuredClone(readPath(selected, value.source.path, value.expression));
  }
  if (Array.isArray(value)) {
    return value.map((item) => resolveValue(item, outputs, inputs));
  }
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        resolveValue(item, outputs, inputs),
      ]),
    );
  }
  return value;
}

function validateWorkflowInputs(
  workflow: CompiledThreadWorkflow,
  inputs: Readonly<Record<string, unknown>>,
): void {
  const unknown = Object.keys(inputs).filter((name) => !workflow.inputs[name]).sort();
  if (unknown.length > 0) {
    throw new TypeError(`Unknown workflow input(s): ${unknown.join(", ")}`);
  }
  for (const [name, definition] of Object.entries(workflow.inputs)) {
    if (!(name in inputs)) throw new TypeError(`Missing workflow input: ${name}`);
    assertOutputType(inputs[name], definition.type, `inputs.${name}`);
  }
}

function selectOutputs(
  node: CompiledWorkflowNode,
  result: McpToolResult,
): Readonly<Record<string, unknown>> {
  const selected: Record<string, unknown> = {};
  for (const [name, definition] of Object.entries(node.outputs)) {
    const value = readPath(
      result.structuredContent,
      definition.select.split("."),
      `${node.id}.${name}`,
    );
    assertOutputType(value, definition.type, `${node.id}.${name}`);
    if (
      definition.minItems !== undefined && Array.isArray(value) &&
      value.length < definition.minItems
    ) {
      throw new Error(
        `${node.id}.${name}: expected at least ${definition.minItems} item(s)`,
      );
    }
    selected[name] = structuredClone(value);
  }
  return selected;
}

function readPath(value: unknown, path: readonly string[], label: string): unknown {
  let current = value;
  for (const segment of path) {
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else if (isRecord(current)) {
      current = current[segment];
    } else {
      current = undefined;
    }
    if (current === undefined) {
      throw new Error(`${label}: missing result path ${path.join(".")}`);
    }
  }
  return current;
}

function assertOutputType(
  value: unknown,
  type: WorkflowOutputType,
  label: string,
): void {
  if (type === "unknown") return;
  const valid = type === "array"
    ? Array.isArray(value)
    : type === "object"
    ? isRecord(value)
    : type === "boolean"
    ? typeof value === "boolean"
    : type === "number"
    ? typeof value === "number" && Number.isFinite(value)
    : type === "string" || type === "artifact-uri"
    ? typeof value === "string" && value.trim() !== ""
    : type === "quantity"
    ? isQuantity(value)
    : false;
  if (!valid) throw new Error(`${label}: result does not match output type ${type}`);
}

function isQuantity(value: unknown): boolean {
  return isRecord(value) && typeof value.value === "number" &&
    Number.isFinite(value.value) && typeof value.unit === "string" &&
    value.unit.trim() !== "";
}

function isBinding(value: CompiledValue): value is CompiledBinding {
  return isRecord(value) && value.kind === "binding" &&
    typeof value.expression === "string" && isRecord(value.source);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function elapsed(now: number, startedAt: number): number {
  return Math.max(0, Math.round(now - startedAt));
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
