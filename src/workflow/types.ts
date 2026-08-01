export type WorkflowOutputType =
  | "array"
  | "artifact-uri"
  | "boolean"
  | "number"
  | "object"
  | "quantity"
  | "string"
  | "unknown";

export interface WorkflowOutputDefinition {
  /** Dot-separated path in the tool's structuredContent. */
  select: string;
  type: WorkflowOutputType;
  /** Optional lower bound for arrays when an empty result is not evidence. */
  minItems?: number;
  description?: string;
}

export interface WorkflowInputDefinition {
  type: WorkflowOutputType;
  description?: string;
}

export interface WorkflowNodeDefinition {
  description?: string;
  server: string;
  tool: string;
  needs: readonly string[];
  arguments: Readonly<Record<string, unknown>>;
  outputs: Readonly<Record<string, WorkflowOutputDefinition>>;
}

export interface ThreadWorkflowDefinition {
  schemaVersion: "1.0";
  kind: "thread-workflow";
  id: string;
  name: string;
  description?: string;
  inputs: Readonly<Record<string, WorkflowInputDefinition>>;
  nodes: Readonly<Record<string, WorkflowNodeDefinition>>;
}

export interface CompiledBinding {
  kind: "binding";
  expression: string;
  source:
    | {
      kind: "node-output";
      nodeId: string;
      output: string;
      path: readonly string[];
      type: WorkflowOutputType;
    }
    | {
      kind: "workflow-input";
      input: string;
      type: WorkflowOutputType;
    };
}

export type CompiledValue =
  | null
  | boolean
  | number
  | string
  | CompiledBinding
  | readonly CompiledValue[]
  | { readonly [key: string]: CompiledValue };

export interface CompiledWorkflowNode {
  id: string;
  description?: string;
  server: string;
  tool: string;
  arguments: Readonly<Record<string, CompiledValue>>;
  outputs: Readonly<Record<string, WorkflowOutputDefinition>>;
  explicitDependencies: readonly string[];
  inferredDependencies: readonly string[];
  dependencies: readonly string[];
}

export interface CompiledThreadWorkflow {
  schemaVersion: "1.0";
  kind: "thread-workflow-dag";
  id: string;
  name: string;
  description?: string;
  inputs: Readonly<Record<string, WorkflowInputDefinition>>;
  /** Nodes in a deterministic, lexicographically tie-broken topological order. */
  nodes: readonly CompiledWorkflowNode[];
}
