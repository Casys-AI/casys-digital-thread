import { parseArgs } from "../lib/cli.ts";
import { HttpMcpToolClient } from "../../src/adapters/shared/mcp/http-mcp-tool-client.ts";
import type { McpToolClient } from "../../src/application/ports/out/mcp-tool-client.ts";
import {
  parseZ3Result,
  type Z3Result,
} from "../../src/adapters/shared/mcp/z3-result.ts";

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
 * The caller must name the exact SysON editing context and element. There is
 * deliberately no product-specific default: a diagnostic probe must never
 * select a model on the operator's behalf.
 */

const DEFAULT_ENDPOINT = "http://127.0.0.1:3009/mcp";
export interface ProbeConstraintSolverOptions {
  readonly endpoint?: string;
  readonly editingContextId: string;
  readonly elementId: string;
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
  options: ProbeConstraintSolverOptions,
): Promise<ProbeConstraintSolverResult> {
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const editingContextId = options.editingContextId.trim();
  const elementId = options.elementId.trim();
  if (editingContextId.length === 0 || elementId.length === 0) {
    throw new Error(
      "probe-constraint-solver requires non-empty editingContextId and elementId",
    );
  }
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

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const editingContextId = args["editing-context-id"];
  const elementId = args["element-id"];
  if (!editingContextId || !elementId) {
    throw new Error(
      "Usage: deno task probe:constraint-solver -- --editing-context-id=<uuid> --element-id=<uuid>",
    );
  }
  const result = await probeConstraintSolver({
    endpoint: args["endpoint"],
    editingContextId,
    elementId,
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.z3.status === "error") Deno.exitCode = 1;
}
