import type { OracleRequirement } from "../../domain/kernel/proof-case.ts";
import type { McpToolClient } from "../../application/ports/out/mcp-tool-client.ts";

export interface VerifiedConstraintUsageIdentity {
  readonly requirementId: string;
  readonly id: string;
  readonly kind: "ConstraintUsage";
  readonly sourceId: string;
}

export interface VerifiedOracleRequirementsReadback {
  readonly requirements: readonly OracleRequirement[];
  readonly constraintUsages: readonly VerifiedConstraintUsageIdentity[];
}

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
  readonly metric?: string;
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
): Promise<VerifiedOracleRequirementsReadback> {
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
  if (
    Object.keys(content).length !== 1 ||
    !Object.hasOwn(content, "constraints") ||
    !Array.isArray(content.constraints)
  ) {
    throw new RequirementExtractionError(
      "requirement_extraction_failed",
      "syson_constraint_extract: structuredContent must be the exact successful constraints response.",
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

  // --- 4. Index extracted rows by metric (featurePath[0]) -----------------------
  // SysON assigns its own element UUIDs to inserted constraints, so the id field
  // can never match the reviewed requirement id — the live server proved this on
  // 2026-08-04 while the mocks, which echoed the reviewed id back, hid it. The
  // stable join is the semantic one: the feature path names the metric the
  // constraint bounds, and verifyExtractedConstraint still checks operator,
  // value and unit behind it.
  const byMetric = new Map<
    string,
    { readonly row: unknown; readonly id: string; readonly sourceId: string }
  >();
  const nativeIds = new Set<string>();
  const sourceIds = new Set<string>();
  for (const [index, row] of extracted.entries()) {
    const item = asRecord(row, `$constraint[${index}]`);
    assertExactKeys(
      item,
      ["id", "name", "sourceId", "expression"],
      `$constraint[${index}]`,
    );
    const id = exactProviderId(item.id, `$constraint[${index}].id`);
    exactProviderId(item.name, `$constraint[${index}].name`);
    const sourceId = exactProviderId(
      item.sourceId,
      `$constraint[${index}].sourceId`,
    );
    if (id !== sourceId) {
      throw new RequirementExtractionError(
        "requirement_extraction_failed",
        "syson_constraint_extract: ConstraintUsage id and sourceId diverge.",
        { field: "sourceId", expected: id, actual: sourceId },
        "The provider identity contract changed. Stop for review before retrying.",
      );
    }
    if (nativeIds.has(id) || sourceIds.has(sourceId)) {
      throw new RequirementExtractionError(
        "requirement_extraction_failed",
        "syson_constraint_extract: duplicate native ConstraintUsage identity.",
        { field: "id", actual: id },
        "Duplicate provider identities make the readback ambiguous. Stop for review.",
      );
    }
    nativeIds.add(id);
    sourceIds.add(sourceId);
    const metric = extractedMetric(row);
    if (metric === undefined) {
      throw new RequirementExtractionError(
        "requirement_extraction_failed",
        "syson_constraint_extract: a constraint item has no feature path.",
        { field: "expression.left.featurePath" },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
    if (byMetric.has(metric)) {
      throw new RequirementExtractionError(
        "requirement_extraction_failed",
        `syson_constraint_extract: two constraints bound the metric "${metric}".`,
        { metric },
        "Duplicate constraints for one metric make the model ambiguous. " +
          "Inspect the model before retrying.",
      );
    }
    byMetric.set(metric, { row, id, sourceId });
  }

  // --- 5. Verify each canonical requirement against the extracted row ----------
  const constraintUsages: VerifiedConstraintUsageIdentity[] = [];
  for (const req of canonical) {
    const extractedConstraint = byMetric.get(req.metric);
    if (extractedConstraint === undefined) {
      throw new RequirementExtractionError(
        "requirement_missing",
        `syson_constraint_extract: no constraint bounds the metric "${req.metric}".`,
        { requirementId: req.id, metric: req.metric },
        `The requirement "${req.id}" is absent from the model. The model may have ` +
          "been altered. Stop for review; do not retry automatically.",
      );
    }
    verifyExtractedConstraint(extractedConstraint.row, req);
    constraintUsages.push({
      requirementId: req.id,
      id: extractedConstraint.id,
      kind: "ConstraintUsage",
      sourceId: extractedConstraint.sourceId,
    });
  }

  // --- 6. Return canonical values plus exact native identities ----------------
  return Object.freeze({
    requirements: canonical,
    constraintUsages: Object.freeze(constraintUsages),
  });
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

  if (expr.kind !== "binary") {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": expression kind in model is "${String(expr.kind)}", ` +
        `expected "binary".`,
      {
        requirementId: req.id,
        field: "expression.kind",
        expected: "binary",
        actual: expr.kind,
      },
      `The expression shape for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

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

  // Metric reference: exactly one reviewed feature in the path.
  const left = asRecord(expr.left, "$constraint.expression.left");
  if (left.kind !== "ref") {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": left operand kind in model is "${
        String(left.kind)
      }", ` +
        `expected "ref".`,
      {
        requirementId: req.id,
        field: "expression.left.kind",
        expected: "ref",
        actual: left.kind,
      },
      `The metric reference for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  const featurePath = left.featurePath;
  if (
    !Array.isArray(featurePath) || featurePath.length !== 1 ||
    typeof featurePath[0] !== "string"
  ) {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": feature path in model does not exactly match the reviewed path.`,
      {
        requirementId: req.id,
        field: "expression.left.featurePath",
        expected: [req.metric],
        actual: featurePath,
      },
      `The metric reference for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  const actualMetric = featurePath[0];
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

  if (right.kind !== "literal") {
    throw new RequirementExtractionError(
      "requirement_tampered",
      `Requirement "${req.id}": right operand kind in model is "${
        String(right.kind)
      }", ` +
        `expected "literal".`,
      {
        requirementId: req.id,
        field: "expression.right.kind",
        expected: "literal",
        actual: right.kind,
      },
      `The threshold expression for requirement "${req.id}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

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

/** The metric a constraint bounds: expression.left.featurePath[0]. */
function extractedMetric(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const expression = (row as Record<string, unknown>).expression;
  if (!expression || typeof expression !== "object") return undefined;
  const left = (expression as Record<string, unknown>).left;
  if (!left || typeof left !== "object") return undefined;
  const path = (left as Record<string, unknown>).featurePath;
  return Array.isArray(path) && typeof path[0] === "string" && path[0].length > 0
    ? path[0]
    : undefined;
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

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const required = [...expected].sort();
  if (
    actual.length !== required.length ||
    actual.some((key, index) => key !== required[index])
  ) {
    throw new RequirementExtractionError(
      "requirement_extraction_failed",
      `syson_constraint_extract: ${path} has non-exact fields.`,
      { field: path, expected: required, actual },
      "The SysON tool response shape changed. Stop for review before retrying.",
    );
  }
}

function exactProviderId(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value) {
    throw new RequirementExtractionError(
      "requirement_extraction_failed",
      `syson_constraint_extract: ${path} must be an exact non-empty string.`,
      { field: path, actual: value },
      "The SysON identity response changed. Stop for review before retrying.",
    );
  }
  return value;
}
