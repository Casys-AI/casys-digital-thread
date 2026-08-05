/**
 * Extractor and fidelity verifier for sensitivity-relations PartDef elements
 * in SysON.
 *
 * Two-phase extraction:
 *
 *   Phase 1 — syson_constraint_extract
 *     Reads the validity-bound constraints (sizeZ_validity_lower,
 *     sizeZ_validity_upper) and verifies operator, bound value, bound unit, AND
 *     paramAttrName (expression.left.featurePath[0]) against the reviewed
 *     declaration. The join key is the reviewed constraintName (the `name` field
 *     preserved by SysON), not the SysON-assigned UUID (the `id` field) and not
 *     featurePath[0] (multiple bounds can reference the same paramAttr, so the
 *     constraint name is the only unambiguous join key).
 *
 *   Phase 2 — syson_element_children
 *     Verifies that the expected attribute names (paramAttrs + derivativeAttrs)
 *     are present as child elements of the PartDef. No value read is performed:
 *     the SysML text declares typed attribute placeholders, not value assignments.
 *
 * FAIL-CLOSED — any divergence (missing attribute, wrong operator, wrong bound,
 * wrong paramAttrName, extra constraint) is a hard rejection. There is no
 * fallback to the declaration values; the model is the witness, not the
 * authority.
 */

import type { SensitivityRelationsDeclaration } from "../../domain/sensitivity-relations.ts";
import type { McpToolClient } from "../http-mcp-tool-client.ts";

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type SensitivityRelationsExtractionCode =
  | "sensitivity_extraction_failed"
  | "sensitivity_constraint_count_mismatch"
  | "sensitivity_constraint_missing"
  | "sensitivity_constraint_tampered"
  | "sensitivity_attribute_missing";

export interface SensitivityRelationsExtractionContext {
  readonly constraintName?: string;
  readonly attrName?: string;
  readonly field?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly expectedCount?: number;
  readonly actualCount?: number;
}

/**
 * Structured error raised when syson fails or the extracted model diverges from
 * the reviewed declaration.
 *
 * AX #4 — code is stable and machine-parseable. Context is structured.
 * Message is a human-readable diagnostic, never parse it.
 */
export class SensitivityRelationsExtractionError extends Error {
  readonly code: SensitivityRelationsExtractionCode;
  readonly context: SensitivityRelationsExtractionContext;
  readonly recovery: string;

  constructor(
    code: SensitivityRelationsExtractionCode,
    message: string,
    context: SensitivityRelationsExtractionContext,
    recovery: string,
  ) {
    super(message);
    this.name = "SensitivityRelationsExtractionError";
    this.code = code;
    this.context = context;
    this.recovery = recovery;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Extract and verify the sensitivity-relations element from SysON.
 *
 * Phase 1: verify that syson_constraint_extract reports the expected validity
 *   bounds (constraintName, paramAttrName, operator, boundValue, boundUnit).
 * Phase 2: verify that syson_element_children lists the expected attribute names
 *   (paramAttrs + derivativeAttrs).
 *
 * RETURNS the declaration unchanged on success (the reviewed declaration is the
 * source of truth; the model is the witness).
 *
 * THROWS SensitivityRelationsExtractionError on any divergence.
 */
export async function extractAndVerifySensitivityRelations(
  syson: McpToolClient,
  editingContextId: string,
  elementId: string,
  decl: SensitivityRelationsDeclaration,
): Promise<SensitivityRelationsDeclaration> {
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
    throw new SensitivityRelationsExtractionError(
      "sensitivity_extraction_failed",
      `syson_constraint_extract failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {},
      "Inspect SysON availability and the element id in the capture before retrying.",
    );
  }

  if (!Array.isArray(constraintContent.constraints)) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_extraction_failed",
      "syson_constraint_extract: structuredContent.constraints must be an array.",
      { field: "constraints", actual: typeof constraintContent.constraints },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  // Log but do not fail on structural errors reported by SysON for empty
  // constraint usages. The validity bounds have expressions; the SysON error
  // field only appears for ConstraintUsage elements without expressions.
  const extracted = constraintContent.constraints as unknown[];
  const expected = decl.validityBounds;

  if (extracted.length !== expected.length) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_constraint_count_mismatch",
      `syson_constraint_extract: expected ${expected.length} constraint(s), got ${extracted.length}.`,
      { expectedCount: expected.length, actualCount: extracted.length },
      "The sensitivity-relations element has a different number of constraints than the declaration. " +
        "Inspect the model before retrying.",
    );
  }

  // Index extracted rows by constraint name — the join key is the reviewed
  // constraintName, not the SysON-assigned UUID (in the `id` field) and not
  // featurePath[0] (multiple bounds can reference the same paramAttr).
  // SysON preserves the human-readable `name` field from the inserted SysML text.
  const byConstraintName = new Map<string, unknown>();
  for (const row of extracted) {
    const constraintName = extractedConstraintName(row);
    if (constraintName === undefined) {
      throw new SensitivityRelationsExtractionError(
        "sensitivity_extraction_failed",
        "syson_constraint_extract: a constraint has no name field.",
        { field: "name" },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
    if (byConstraintName.has(constraintName)) {
      throw new SensitivityRelationsExtractionError(
        "sensitivity_extraction_failed",
        `syson_constraint_extract: two constraints share name "${constraintName}".`,
        { field: "name", actual: constraintName },
        "Duplicate constraint names make the model ambiguous. " +
          "Inspect the model before retrying.",
      );
    }
    byConstraintName.set(constraintName, row);
  }

  for (const bound of expected) {
    const row = byConstraintName.get(bound.constraintName);
    if (row === undefined) {
      throw new SensitivityRelationsExtractionError(
        "sensitivity_constraint_missing",
        `syson_constraint_extract: no constraint named "${bound.constraintName}" was found.`,
        { constraintName: bound.constraintName, field: "name" },
        `The bound "${bound.constraintName}" is absent from the model. ` +
          "Stop for review; do not retry automatically.",
      );
    }
    verifyExtractedBound(row, bound);
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
    throw new SensitivityRelationsExtractionError(
      "sensitivity_extraction_failed",
      `syson_element_children failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {},
      "Inspect SysON availability and the element id in the capture before retrying.",
    );
  }

  if (!Array.isArray(childrenContent.children)) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_extraction_failed",
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

  const expectedAttrNames = [
    ...decl.paramAttrs.map((a) => a.attrName),
    ...decl.derivativeAttrs.map((a) => a.attrName),
  ];
  for (const attrName of expectedAttrNames) {
    if (!childLabels.has(attrName)) {
      throw new SensitivityRelationsExtractionError(
        "sensitivity_attribute_missing",
        `syson_element_children: expected attribute "${attrName}" is not present.`,
        { attrName },
        `The attribute "${attrName}" is absent from the model. Stop for review; do not retry automatically.`,
      );
    }
  }

  return decl;
}

/**
 * Verify that a single extracted constraint row exactly matches a reviewed bound.
 * Exported for unit testing without a network call.
 */
export function verifyExtractedBound(
  row: unknown,
  bound: SensitivityRelationsDeclaration["validityBounds"][number],
): void {
  const item = asRecord(row, "$constraint");
  const expr = asRecord(item.expression, "$constraint.expression");

  const op = expr.op;
  if (op !== bound.operator) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_constraint_tampered",
      `Bound "${bound.constraintName}": operator in model is "${String(op)}", ` +
        `expected "${bound.operator}".`,
      {
        constraintName: bound.constraintName,
        field: "operator",
        expected: bound.operator,
        actual: op,
      },
      `The operator for bound "${bound.constraintName}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  // Verify that the constraint references the expected parameter attribute.
  // expression.left.featurePath[0] is the attribute name used in the constraint body
  // (e.g. "sizeZ_base_mm"). A divergence here means the constraint was re-wired
  // to a different attribute in the model — structural drift, not just value drift.
  const left = asRecord(expr.left, "$constraint.expression.left");
  const featurePath = left.featurePath;
  const actualParamAttr = Array.isArray(featurePath) && featurePath.length > 0
    ? featurePath[0]
    : undefined;
  if (actualParamAttr !== bound.paramAttrName) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_constraint_tampered",
      `Bound "${bound.constraintName}": paramAttrName in model is "${
        String(actualParamAttr)
      }", ` +
        `expected "${bound.paramAttrName}".`,
      {
        constraintName: bound.constraintName,
        field: "paramAttrName",
        expected: bound.paramAttrName,
        actual: actualParamAttr,
      },
      `The parameter attribute for bound "${bound.constraintName}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  const right = asRecord(expr.right, "$constraint.expression.right");
  const actualValue = right.value;
  if (actualValue !== bound.boundValue) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_constraint_tampered",
      `Bound "${bound.constraintName}": value in model is ${String(actualValue)}, ` +
        `expected ${bound.boundValue}.`,
      {
        constraintName: bound.constraintName,
        field: "boundValue",
        expected: bound.boundValue,
        actual: actualValue,
      },
      `The bound value for "${bound.constraintName}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }

  const actualUnit = right.unit;
  if (actualUnit !== bound.boundUnit) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_constraint_tampered",
      `Bound "${bound.constraintName}": unit in model is "${String(actualUnit)}", ` +
        `expected "${bound.boundUnit}".`,
      {
        constraintName: bound.constraintName,
        field: "boundUnit",
        expected: bound.boundUnit,
        actual: actualUnit,
      },
      `The unit for bound "${bound.constraintName}" was altered in the model. ` +
        "Stop for review; do not retry automatically.",
    );
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function extractedConstraintName(row: unknown): string | undefined {
  if (!row || typeof row !== "object" || Array.isArray(row)) return undefined;
  const name = (row as Record<string, unknown>).name;
  return typeof name === "string" && name.length > 0 ? name : undefined;
}

function asRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new SensitivityRelationsExtractionError(
      "sensitivity_extraction_failed",
      `syson: ${path} must be an object.`,
      { field: path },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  return value as Record<string, unknown>;
}
