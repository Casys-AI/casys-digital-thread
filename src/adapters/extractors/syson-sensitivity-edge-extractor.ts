/**
 * Extractor and fidelity verifier for sensitivity-edge PartDef elements in SysON.
 *
 * Generalises syson-sensitivity-relations-extractor.ts: instead of a
 * SensitivityRelationsDeclaration (CM-01 specific, METRIC_TO_ATTR_NAME coupled),
 * this module takes a SensitivityEdge[] — the generic domain contract from
 * src/domain/sensitivity-edge.ts.
 *
 * Two-phase extraction:
 *
 *   Phase 1 — syson_constraint_extract
 *     Reads the validity-bound constraints and verifies operator, bound value,
 *     bound unit, AND driver.sysmlAttrName (featurePath[0]) against the reviewed
 *     edges. The join key is the reviewed constraint name (the `name` field
 *     preserved by SysON). Constraint names are globally unique within the set
 *     (enforced by validateSensitivityEdgeSet).
 *
 *   Phase 2 — syson_element_children
 *     Verifies that all expected driver.sysmlAttrName and response.sysmlAttrName
 *     values are present as child elements (AttributeUsage) of the PartDef.
 *
 * FAIL-CLOSED — any divergence (missing attribute, wrong operator, wrong bound,
 * wrong featurePath, extra constraint) is a hard rejection. The model is the
 * witness; the reviewed edges are the authority.
 *
 * PROBE EVIDENCE — live-probe 2026-08-05 (project probe-sensitivity-edge-2026-08-05)
 * confirmed that syson_constraint_extract preserves featurePath[0] = driver.sysmlAttrName
 * for flat PartDef elements. Specialization was tested and rejected (featurePath degrades
 * to "FeatureReferenceExpression").
 */

import type { SensitivityEdge } from "../../domain/analysis/sensitivity-edge.ts";
import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type SensitivityEdgeExtractionCode =
  | "edge_extraction_failed"
  | "edge_constraint_count_mismatch"
  | "edge_constraint_missing"
  | "edge_constraint_tampered"
  | "edge_attribute_missing";

export interface SensitivityEdgeExtractionContext {
  readonly constraintName?: string;
  readonly attrName?: string;
  readonly field?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly expectedCount?: number;
  readonly actualCount?: number;
}

/**
 * Structured error raised when SysON fails or the extracted model diverges from
 * the reviewed edges.
 *
 * AX #4 — code is stable and machine-parseable. Context is structured.
 * Message is human-readable diagnostic; never parse it.
 */
export class SensitivityEdgeExtractionError extends Error {
  readonly code: SensitivityEdgeExtractionCode;
  readonly context: SensitivityEdgeExtractionContext;
  readonly recovery: string;

  constructor(
    code: SensitivityEdgeExtractionCode,
    message: string,
    context: SensitivityEdgeExtractionContext,
    recovery: string,
  ) {
    super(message);
    this.name = "SensitivityEdgeExtractionError";
    this.code = code;
    this.context = context;
    this.recovery = recovery;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract and verify the sensitivity-edge PartDef element from SysON.
 *
 * Phase 1: verify that syson_constraint_extract reports 2*N constraints (lower
 *   and upper per edge), each matching the reviewed edge's validity neighborhood.
 *   Join key is the constraint name from edge.driver.validityNeighborhood.*ConstraintName.
 *
 * Phase 2: verify that syson_element_children lists all expected attribute names
 *   (driver.sysmlAttrName and response.sysmlAttrName per edge).
 *
 * RETURNS the edges unchanged on success (the reviewed edges are the source of
 *   truth; the model is the witness).
 *
 * THROWS SensitivityEdgeExtractionError on any divergence.
 */
export async function extractAndVerifySensitivityEdges(
  syson: McpToolClient,
  editingContextId: string,
  elementId: string,
  edges: readonly SensitivityEdge[],
): Promise<readonly SensitivityEdge[]> {
  // ── Phase 1: constraint extraction ────────────────────────────────────────
  let constraintContent: Record<string, unknown>;
  try {
    const result = await syson.callTool({
      name: "syson_constraint_extract",
      arguments: {
        editing_context_id: editingContextId,
        element_id: elementId,
      },
    });
    constraintContent = result.structuredContent as Record<string, unknown>;
  } catch (error) {
    throw new SensitivityEdgeExtractionError(
      "edge_extraction_failed",
      `syson_constraint_extract failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {},
      "Inspect SysON availability and the element id in the capture before retrying.",
    );
  }

  if (!Array.isArray(constraintContent.constraints)) {
    throw new SensitivityEdgeExtractionError(
      "edge_extraction_failed",
      "syson_constraint_extract: structuredContent.constraints must be an array.",
      { field: "constraints", actual: typeof constraintContent.constraints },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  const extracted = constraintContent.constraints as unknown[];
  // Expected: 2 constraints per edge (lower + upper).
  const expectedConstraintCount = edges.length * 2;

  if (extracted.length !== expectedConstraintCount) {
    throw new SensitivityEdgeExtractionError(
      "edge_constraint_count_mismatch",
      `syson_constraint_extract: expected ${expectedConstraintCount} constraint(s) (2 per edge × ${edges.length} edges), got ${extracted.length}.`,
      { expectedCount: expectedConstraintCount, actualCount: extracted.length },
      "The sensitivity-edge element has a different number of constraints than declared. " +
        "Inspect the model before retrying.",
    );
  }

  // Index extracted constraints by name — the join key is the reviewed constraint name.
  const byConstraintName = new Map<string, unknown>();
  for (const row of extracted) {
    const constraintName = extractedConstraintName(row);
    if (constraintName === undefined) {
      throw new SensitivityEdgeExtractionError(
        "edge_extraction_failed",
        "syson_constraint_extract: a constraint has no name field.",
        { field: "name" },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
    if (byConstraintName.has(constraintName)) {
      throw new SensitivityEdgeExtractionError(
        "edge_extraction_failed",
        `syson_constraint_extract: two constraints share name "${constraintName}".`,
        { field: "name", actual: constraintName },
        "Duplicate constraint names make the model ambiguous. " +
          "Inspect the model before retrying.",
      );
    }
    byConstraintName.set(constraintName, row);
  }

  // Verify each edge's validity bounds.
  for (const edge of edges) {
    const vn = edge.driver.validityNeighborhood;

    verifyBound(
      byConstraintName,
      vn.lowerConstraintName,
      ">=",
      edge.driver.sysmlAttrName,
      vn.lower.value,
      vn.lower.unit,
    );

    verifyBound(
      byConstraintName,
      vn.upperConstraintName,
      "<=",
      edge.driver.sysmlAttrName,
      vn.upper.value,
      vn.upper.unit,
    );
  }

  // ── Phase 2: attribute names via element children ─────────────────────────
  let childrenContent: Record<string, unknown>;
  try {
    const result = await syson.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: elementId,
      },
    });
    childrenContent = result.structuredContent as Record<string, unknown>;
  } catch (error) {
    throw new SensitivityEdgeExtractionError(
      "edge_extraction_failed",
      `syson_element_children failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {},
      "Inspect SysON availability and the element id in the capture before retrying.",
    );
  }

  if (!Array.isArray(childrenContent.children)) {
    throw new SensitivityEdgeExtractionError(
      "edge_extraction_failed",
      "syson_element_children: structuredContent.children must be an array.",
      { field: "children", actual: typeof childrenContent.children },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  const childLabels = new Set<string>(
    (childrenContent.children as unknown[])
      .map((child) => {
        if (!child || typeof child !== "object" || Array.isArray(child)) return "";
        return (child as Record<string, unknown>).label as string ?? "";
      })
      .filter((label) => typeof label === "string" && label.length > 0),
  );

  // Verify all expected attribute names are present.
  for (const edge of edges) {
    requireChildLabel(childLabels, edge.driver.sysmlAttrName);
    requireChildLabel(childLabels, edge.response.sysmlAttrName);
  }

  return edges;
}

/**
 * Verify a single bound row from syson_constraint_extract.
 * Exported for unit testing without a network call.
 */
export function verifyExtractedEdgeBound(
  row: unknown,
  constraintName: string,
  expectedOp: ">=" | "<=",
  expectedDriverAttrName: string,
  expectedBoundValue: number,
  expectedBoundUnit: string,
): void {
  verifyBoundRow(
    row,
    constraintName,
    expectedOp,
    expectedDriverAttrName,
    expectedBoundValue,
    expectedBoundUnit,
  );
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function verifyBound(
  byName: ReadonlyMap<string, unknown>,
  constraintName: string,
  expectedOp: ">=" | "<=",
  expectedDriverAttrName: string,
  expectedBoundValue: number,
  expectedBoundUnit: string,
): void {
  const row = byName.get(constraintName);
  if (row === undefined) {
    throw new SensitivityEdgeExtractionError(
      "edge_constraint_missing",
      `syson_constraint_extract: no constraint named "${constraintName}" was found.`,
      { constraintName, field: "name" },
      `The bound "${constraintName}" is absent from the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }
  verifyBoundRow(
    row,
    constraintName,
    expectedOp,
    expectedDriverAttrName,
    expectedBoundValue,
    expectedBoundUnit,
  );
}

function verifyBoundRow(
  row: unknown,
  constraintName: string,
  expectedOp: ">=" | "<=",
  expectedDriverAttrName: string,
  expectedBoundValue: number,
  expectedBoundUnit: string,
): void {
  const item = asRecord(row, `$constraint`);
  const expr = asRecord(item.expression, `$constraint.expression`);

  const actualOp = expr.op;
  if (actualOp !== expectedOp) {
    throw new SensitivityEdgeExtractionError(
      "edge_constraint_tampered",
      `Bound "${constraintName}": operator in model is "${
        String(actualOp)
      }", expected "${expectedOp}".`,
      {
        constraintName,
        field: "operator",
        expected: expectedOp,
        actual: actualOp,
      },
      `The operator for bound "${constraintName}" was altered in the model. Stop for review.`,
    );
  }

  // Verify the constraint references the expected driver attribute.
  // featurePath[0] must be the driver's sysmlAttrName.
  // PROBE CONFIRMED: for flat PartDef, featurePath[0] == driver.sysmlAttrName.
  // For specializations, featurePath[0] would be "FeatureReferenceExpression" — rejected.
  const left = asRecord(expr.left, `$constraint.expression.left`);
  const featurePath = left.featurePath;
  const actualDriverAttr = Array.isArray(featurePath) && featurePath.length > 0
    ? featurePath[0]
    : undefined;
  if (actualDriverAttr !== expectedDriverAttrName) {
    throw new SensitivityEdgeExtractionError(
      "edge_constraint_tampered",
      `Bound "${constraintName}": driver attribute in model is "${
        String(actualDriverAttr)
      }", expected "${expectedDriverAttrName}".`,
      {
        constraintName,
        field: "driverAttrName",
        expected: expectedDriverAttrName,
        actual: actualDriverAttr,
      },
      `The driver attribute for bound "${constraintName}" was altered in the model. Stop for review.`,
    );
  }

  const right = asRecord(expr.right, `$constraint.expression.right`);
  const actualValue = right.value;
  if (actualValue !== expectedBoundValue) {
    throw new SensitivityEdgeExtractionError(
      "edge_constraint_tampered",
      `Bound "${constraintName}": value in model is ${
        String(actualValue)
      }, expected ${expectedBoundValue}.`,
      {
        constraintName,
        field: "boundValue",
        expected: expectedBoundValue,
        actual: actualValue,
      },
      `The bound value for "${constraintName}" was altered in the model. Stop for review.`,
    );
  }

  const actualUnit = right.unit;
  if (actualUnit !== expectedBoundUnit) {
    throw new SensitivityEdgeExtractionError(
      "edge_constraint_tampered",
      `Bound "${constraintName}": unit in model is "${
        String(actualUnit)
      }", expected "${expectedBoundUnit}".`,
      {
        constraintName,
        field: "boundUnit",
        expected: expectedBoundUnit,
        actual: actualUnit,
      },
      `The unit for bound "${constraintName}" was altered in the model. Stop for review.`,
    );
  }
}

function requireChildLabel(childLabels: ReadonlySet<string>, attrName: string): void {
  if (!childLabels.has(attrName)) {
    throw new SensitivityEdgeExtractionError(
      "edge_attribute_missing",
      `syson_element_children: expected attribute "${attrName}" is not present.`,
      { attrName },
      `The attribute "${attrName}" is absent from the model. Stop for review; do not retry automatically.`,
    );
  }
}

function extractedConstraintName(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const name = (row as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SensitivityEdgeExtractionError(
      "edge_extraction_failed",
      `syson: ${path} must be an object.`,
      { field: path },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  return value as Record<string, unknown>;
}
