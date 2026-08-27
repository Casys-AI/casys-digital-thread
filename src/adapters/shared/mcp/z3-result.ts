/**
 * Typed result of a syson_constraint_solve call and parser for the raw JSON
 * response the tool returns in its text channel.
 *
 * WHY IN ADAPTERS/MCP — z3 surfaces its verdict as JSON in the MCP tool's text
 * channel (not structuredContent). Parsing that response is an adapter concern:
 * it translates a provider wire format into a typed value that the domain can
 * consume. The type itself is simple enough to live here as well; it has no
 * domain invariants beyond the union discriminant.
 *
 * Source: extracted from scripts/probes/probe-constraint-solver.ts
 * (vague organisation v2). The probe now imports Z3Result and parseZ3Result
 * from here.
 */

/**
 * Typed verdict from the z3 constraint solver.
 *
 * `sat`   — constraints are satisfiable; `model` contains variable assignments.
 * `unsat` — constraints are unsatisfiable; `conflict` lists conflicting IDs.
 * `error` — provider contract violation or transport failure.
 */
export type Z3Result =
  | { readonly status: "sat"; readonly model: Record<string, unknown> }
  | { readonly status: "unsat"; readonly conflict: readonly string[] }
  | { readonly status: "error"; readonly message: string };

/**
 * Map the raw JSON object from syson_constraint_solve to a typed Z3Result.
 *
 * z3 surfaces exactly two non-error states: sat (with a variable model) and
 * unsat (with a conflict set). Any deviation from those shapes is a provider
 * contract violation and surfaces as an error state rather than silently
 * returning incomplete data.
 */
export function parseZ3Result(raw: Record<string, unknown>): Z3Result {
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

// ── Private helpers ──────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
