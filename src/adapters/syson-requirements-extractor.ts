import type { OracleRequirement } from "../domain/proof-case.ts";
import type { McpToolClient } from "./http-mcp-tool-client.ts";

/**
 * Machine-readable error codes for extraction and fidelity failures (AX #4).
 *
 * Agents parse codes + context, not prose. Message strings are diagnostic
 * aids for humans and must not be parsed by agents.
 *
 *   requirement_extraction_failed — the MCP call failed or the response shape
 *     is unrecognised; the run must stop for manual inspection.
 *   requirement_count_mismatch — the model contains a different number of
 *     constraints than the reviewed declaration; the model may have been altered.
 *   requirement_missing — a canonical requirement id is absent from the model;
 *     the model may have been altered.
 *   requirement_tampered — a constraint's operator, metric, value, or unit
 *     differs from the reviewed declaration; the model may have been altered.
 */
export type RequirementExtractionCode =
  | "requirement_extraction_failed"
  | "requirement_count_mismatch"
  | "requirement_missing"
  | "requirement_tampered";

/**
 * Structured diagnostic context for RequirementExtractionError.
 *
 * Fields are present when they are meaningful for the specific code:
 *   requirementId  — id of the affected canonical requirement (missing/tampered).
 *   field          — dotted path of the field that differed or was absent.
 *   expected       — value from the reviewed declaration.
 *   actual         — value found in the model (or the type if the field was missing).
 *   expectedCount  — number of constraints expected (count_mismatch).
 *   actualCount    — number of constraints found (count_mismatch).
 */
export interface RequirementExtractionContext {
  readonly requirementId?: string;
  readonly field?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly expectedCount?: number;
  readonly actualCount?: number;
}

/**
 * Typed error raised when syson_constraint_extract fails or when the
 * extracted constraints diverge from the reviewed canonical declaration.
 *
 * Contract (AX #4 — Machine-Readable Errors):
 *   code     — stable, parseable by agents across versions.
 *   context  — structured key/value data; never parse `message`.
 *   recovery — one-sentence next-action hint for the operator.
 *
 * There is no fallback path: any code other than a successful extraction
 * that exactly matches the canonical declaration stops the run. Silently
 * using the canonical value when the model diverges would hide a tampered
 * threshold.
 */
export class RequirementExtractionError extends Error {
  readonly code: RequirementExtractionCode;
  readonly context: RequirementExtractionContext;
  readonly recovery: string;

  constructor(
    code: RequirementExtractionCode,
    message: string,
    context: RequirementExtractionContext,
    recovery: string,
  ) {
    super(message);
    this.name = "RequirementExtractionError";
    this.code = code;
    this.context = context;
    this.recovery = recovery;
  }
}

/**
 * Extract constraints from SysON via syson_constraint_extract and verify
 * their fidelity against the canonical reviewed requirements.
 *
 * FAIL-CLOSED — every divergence is a hard rejection; there is no fallback
 * to the canonical value. The purpose of extraction is to detect tampering,
 * not to read the threshold from the model.
 *
 *   • extraction failure or unrecognised shape → requirement_extraction_failed
 *   • count mismatch                           → requirement_count_mismatch
 *   • missing requirement id in the model      → requirement_missing
 *   • divergent operator, metric, value, unit  → requirement_tampered
 *
 * When all checks pass, returns the canonical requirements unchanged — the
 * reviewed committed JSON remains the source of truth for the threshold.
 * The model is the witness, not the authority.
 *
 * @param syson                 SysON MCP client (backend-only).
 * @param editingContextId      Exact editing context id from the seed capture.
 * @param requirementsElementId Exact element id from the requirements seed capture.
 * @param canonical             Reviewed OracleRequirement list from proof.limits.
 */
export async function extractAndVerifyOracleRequirements(
  syson: McpToolClient,
  editingContextId: string,
  requirementsElementId: string,
  canonical: readonly OracleRequirement[],
): Promise<readonly OracleRequirement[]> {
  // --- 1. Call syson_constraint_extract ----------------------------------------
  let content: Readonly<Record<string, unknown>>;
  try {
    const result = await syson.callTool({
      name: "syson_constraint_extract",
      arguments: {
        editing_context_id: editingContextId,
        element_id: requirementsElementId,
      },
    });
    content = result.structuredContent;
  } catch (error) {
    throw new RequirementExtractionError(
      "requirement_extraction_failed",
      `syson_constraint_extract failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {},
      "Inspect SysON availability and the requirements element id in the seed " +
        "capture before retrying.",
    );
  }

  // --- 2. Parse the constraints array ------------------------------------------
  if (!Array.isArray(content.constraints)) {
    throw new RequirementExtractionError(
      "requirement_extraction_failed",
      "syson_constraint_extract: structuredContent.constraints must be an array.",
      { field: "constraints", actual: typeof content.constraints },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  const extracted = content.constraints as unknown[];

  // --- 3. Count check ----------------------------------------------------------
  if (extracted.length !== canonical.length) {
    throw new RequirementExtractionError(
      "requirement_count_mismatch",
      `syson_constraint_extract: expected ${canonical.length} constraint(s), ` +
        `got ${extracted.length}.`,
      { expectedCount: canonical.length, actualCount: extracted.length },
      "The requirements element in SysON has a different number of constraints " +
        "than the reviewed declaration. Inspect the model before retrying.",
    );
  }

  // --- 4. Index extracted rows by id -------------------------------------------
  const byId = new Map<string, unknown>();
  for (const row of extracted) {
    const id = extractedId(row);
    if (id === undefined) {
      throw new RequirementExtractionError(
        "requirement_extraction_failed",
        "syson_constraint_extract: a constraint item has no string id field.",
        {
          field: "id",
          actual: typeof (row as Record<string, unknown>)?.id,
        },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
    byId.set(id, row);
  }

  // --- 5. Verify each canonical requirement against the extracted row ----------
  for (const req of canonical) {
    const row = byId.get(req.id);
    if (row === undefined) {
      throw new RequirementExtractionError(
        "requirement_missing",
        `syson_constraint_extract: no constraint with id "${req.id}" in the model.`,
        { requirementId: req.id },
        `The requirement "${req.id}" is absent from the model. The model may have ` +
          "been altered. Stop for review; do not retry automatically.",
      );
    }
    verifyExtractedConstraint(row, req);
  }

  // --- 6. Return canonical (verified) ------------------------------------------
  return canonical;
}

/**
 * Verify that a single extracted constraint row exactly matches the canonical
 * requirement. Throws RequirementExtractionError on the first divergence.
 *
 * Exported for unit-testing without a network call; callers outside this
 * module should use extractAndVerifyOracleRequirements instead.
 */
export function verifyExtractedConstraint(row: unknown, req: OracleRequirement): void {
  const item = asRecord(row, "$constraint");
  const expr = asRecord(item.expression, "$constraint.expression");

  // Operator
  const op = expr.op;
  if (op !== req.operator) {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": operator in model is "${String(op)}", ` +
        `expected "${req.operator}".`,
      {
        requirementId: req.id,
        field: "operator",
        expected: req.operator,
        actual: op,
      },
      `The operator for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  // Metric (featurePath[0])
  const left = asRecord(expr.left, "$constraint.expression.left");
  const featurePath = left.featurePath;
  const actualMetric = Array.isArray(featurePath) && featurePath.length > 0 &&
      typeof featurePath[0] === "string"
    ? featurePath[0]
    : undefined;
  if (actualMetric !== req.metric) {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": metric in model is "${String(actualMetric)}", ` +
        `expected "${req.metric}".`,
      {
        requirementId: req.id,
        field: "metric",
        expected: req.metric,
        actual: actualMetric,
      },
      `The metric for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  // Threshold value and unit
  const right = asRecord(expr.right, "$constraint.expression.right");

  const actualValue = right.value;
  if (actualValue !== req.limit.value) {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": threshold in model is ${String(actualValue)}, ` +
        `expected ${req.limit.value}.`,
      {
        requirementId: req.id,
        field: "limit.value",
        expected: req.limit.value,
        actual: actualValue,
      },
      `The threshold for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  const actualUnit = right.unit;
  if (actualUnit !== req.limit.unit) {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": unit in model is "${String(actualUnit)}", ` +
        `expected "${req.limit.unit}".`,
      {
        requirementId: req.id,
        field: "limit.unit",
        expected: req.limit.unit,
        actual: actualUnit,
      },
      `The unit for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function extractedId(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const item = row as Record<string, unknown>;
  return typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new RequirementExtractionError(
      "requirement_extraction_failed",
      `syson_constraint_extract: ${path} must be an object.`,
      { field: path },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  return value as Record<string, unknown>;
}
