import { parseArgs } from "./cli.ts";
import {
  HttpMcpToolClient,
  type McpToolClient,
} from "../src/adapters/http-mcp-tool-client.ts";

/**
 * Diagnostic probe for syson_constraint_solve.
 *
 * This script is EXPLORATION-ONLY. It reads constraints from a SysON model
 * element via syson_constraint_extract, then calls the z3-backed
 * syson_constraint_solve. Its only output is a deterministic JSON record on
 * stdout. It does not write to state/, publish anything, or create a run.
 *
 * Why a dedicated probe instead of a unit test:
 *   syson_constraint_solve returns JSON in content[0].text (not in
 *   structuredContent), which makes it unreachable via the normal callTool()
 *   path. callToolTextResult() fixes that — but this capability must be
 *   exercised against a live provider before it enters a production execution
 *   path. This probe is that live exercise.
 *
 * Default context: the CM-01 DripTray mechanical requirements element.
 * Override with --editing-context-id=<uuid> and --element-id=<uuid>.
 */

const DEFAULT_ENDPOINT = "http://127.0.0.1:3009/mcp";
const DEFAULT_EDITING_CONTEXT_ID = "01942665-3ded-4d3a-9902-08691eae190e";
const DEFAULT_ELEMENT_ID = "09e35cdc-5bca-4234-a765-5640b313e93f";

export interface ProbeConstraintSolverOptions {
  readonly endpoint?: string;
  readonly editingContextId?: string;
  readonly elementId?: string;
  /** Test seam — omit in production; defaults to HttpMcpToolClient. */
  readonly client?: McpToolClient;
}

export interface ProbeConstraintSolverResult {
  readonly probe: "constraint-solver";
  readonly endpoint: string;
  readonly editingContextId: string;
  readonly elementId: string;
  readonly extractedConstraints: readonly unknown[];
  readonly extractErrors: readonly unknown[];
  readonly z3: Z3Result;
}

export type Z3Result =
  | { readonly status: "sat"; readonly model: Record<string, unknown> }
  | { readonly status: "unsat"; readonly conflict: readonly string[] }
  | { readonly status: "error"; readonly message: string };

/**
 * Run the probe and return a machine-readable result.
 *
 * The function never writes state and throws only on unrecoverable transport
 * failures (bad endpoint, provider down). All z3 outcomes — including
 * unsat and internal z3 errors — are mapped to a structured Z3Result instead
 * of raising an exception, so callers can log the output without wrapping
 * every call in a try/catch.
 */
export async function probeConstraintSolver(
  options: ProbeConstraintSolverOptions = {},
): Promise<ProbeConstraintSolverResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const editingContextId = options.editingContextId ?? DEFAULT_EDITING_CONTEXT_ID;
  const elementId = options.elementId ?? DEFAULT_ELEMENT_ID;
  const client = options.client ?? new HttpMcpToolClient({
    mcpUrl: endpoint,
    timeoutMs: 60_000,
  });

  const coordinates = { editing_context_id: editingContextId, element_id: elementId };

  // Step 1 — read the constraint AST from the live SysON model.
  const extractResult = await client.callTool({
    name: "syson_constraint_extract",
    arguments: coordinates,
  });
  const extract = extractResult.structuredContent;
  const extractedConstraints = Array.isArray(extract.constraints)
    ? (extract.constraints as readonly unknown[])
    : [];
  const extractErrors = Array.isArray(extract.errors)
    ? (extract.errors as readonly unknown[])
    : [];

  // Step 2 — run z3 on the same model element.
  // syson_constraint_solve serialises its verdict as JSON in content[0].text;
  // callToolTextResult() reads that text channel instead of structuredContent.
  let z3: Z3Result;
  try {
    const raw = await client.callToolTextResult({
      name: "syson_constraint_solve",
      arguments: coordinates,
    });
    z3 = parseZ3Result(raw);
  } catch (error) {
    z3 = {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }

  return {
    probe: "constraint-solver",
    endpoint,
    editingContextId,
    elementId,
    extractedConstraints,
    extractErrors,
    z3,
  };
}

/**
 * Map the raw JSON object from syson_constraint_solve to a typed Z3Result.
 *
 * z3 surfaces exactly two non-error states: sat (with a variable model) and
 * unsat (with a conflict set). Any deviation from those shapes is a provider
 * contract violation and surfaces as an error state rather than silently
 * returning incomplete data.
 */
function parseZ3Result(raw: Record<string, unknown>): Z3Result {
  const status = raw.status;
  if (status === "sat") {
    const model = raw.model;
    if (!isRecord(model)) {
      return { status: "error", message: "sat response missing model object" };
    }
    return { status: "sat", model };
  }
  if (status === "unsat") {
    const conflict = raw.conflict;
    if (!Array.isArray(conflict)) {
      return { status: "error", message: "unsat response missing conflict array" };
    }
    const ids = conflict.filter((item): item is string => typeof item === "string");
    if (ids.length !== conflict.length) {
      return {
        status: "error",
        message: "unsat conflict contains non-string entries",
      };
    }
    return { status: "unsat", conflict: ids };
  }
  return {
    status: "error",
    message: `unexpected z3 status: ${JSON.stringify(status)}`,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const result = await probeConstraintSolver({
    endpoint: args["endpoint"],
    editingContextId: args["editing-context-id"],
    elementId: args["element-id"],
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.z3.status === "error") Deno.exitCode = 1;
}
