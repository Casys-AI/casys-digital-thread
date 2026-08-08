/**
 * Extractor for CoffeeMachine and DripTray PartDef elements from SysON.
 *
 * Two-phase extraction:
 *
 *   Phase 1 — syson_element_children
 *     Lists direct children of the architecture package to locate exactly one
 *     CoffeeMachine and exactly one DripTray PartDef element. The join key is
 *     the server-fixed label; ambiguity (0 or >1 match) is a hard rejection.
 *
 *   Phase 2 — syson_part_structure
 *     Reads the full part tree for each located element. Validates strict shape
 *     (exact keys on root and each tree node), root label, declared partCount
 *     coherence, and DripTray usage presence in the CoffeeMachine tree.
 *
 * FAIL-CLOSED — any structural divergence is a hard rejection. There is no
 * fallback to assumed values; the model is the witness, not the authority.
 */

import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

export const COFFEE_MACHINE_PART_LABEL = "CoffeeMachine" as const;
export const DRIP_TRAY_PART_LABEL = "DripTray" as const;

/**
 * Server-fixed label of the DripTray part USAGE inside the CoffeeMachine
 * tree. SysML names usages in lower camelCase (`part dripTray : DripTray`);
 * the definition label above names the PartDefinition element itself.
 * Probe-confirmed on the live model (2026-08-08).
 */
export const DRIP_TRAY_USAGE_LABEL = "dripTray" as const;

// ---------------------------------------------------------------------------
// Error types
// ---------------------------------------------------------------------------

export type PartStructureExtractionCode =
  | "part_structure_extraction_failed"
  | "part_definition_not_found"
  | "part_definition_ambiguous"
  | "part_structure_root_mismatch"
  | "part_count_mismatch"
  | "part_structure_truncated"
  | "drip_tray_usage_absent";

export interface PartStructureExtractionContext {
  readonly label?: string;
  readonly field?: string;
  readonly expected?: unknown;
  readonly actual?: unknown;
  readonly count?: number;
}

/**
 * Structured error raised when SysON fails or the extracted model diverges.
 *
 * AX #4 — code is stable and machine-parseable. Context is structured.
 * Message is a human-readable diagnostic, never parse it.
 */
export class PartStructureExtractionError extends Error {
  readonly code: PartStructureExtractionCode;
  readonly context: PartStructureExtractionContext;
  readonly recovery: string;

  constructor(
    code: PartStructureExtractionCode,
    message: string,
    context: PartStructureExtractionContext,
    recovery: string,
  ) {
    super(message);
    this.name = "PartStructureExtractionError";
    this.code = code;
    this.context = context;
    this.recovery = recovery;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface PartTreeNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  readonly quantity: number | string;
  readonly quantitySource: string;
  readonly children: readonly PartTreeNode[];
}

export interface CoffeeMachinePartStructure {
  readonly root: {
    readonly id: string;
    readonly label: string;
    readonly kind: string;
  };
  readonly tree: readonly PartTreeNode[];
  readonly partCount: number;
  readonly maxDepthReached: boolean;
}

export interface PartDefinitionRecord {
  readonly elementId: string;
  readonly label: string;
  readonly structure?: CoffeeMachinePartStructure;
}

// ---------------------------------------------------------------------------
// Public: main extraction function
// ---------------------------------------------------------------------------

/**
 * Extract the CoffeeMachine and DripTray PartDef records from SysON.
 *
 * Phase 1: locate each element by exact label among the package children.
 * Phase 2: read full part structure for each, validate shape and invariants.
 *
 * THROWS PartStructureExtractionError on any divergence.
 */
export async function extractPartDefinitions(
  syson: McpToolClient,
  editingContextId: string,
  architecturePackageId: string,
): Promise<{
  readonly coffeeMachine: PartDefinitionRecord;
  readonly dripTray: PartDefinitionRecord;
}> {
  // ── Phase 1: locate elements by label ─────────────────────────────────────
  let childrenContent: Record<string, unknown>;
  try {
    const result = await syson.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: architecturePackageId,
      },
    });
    childrenContent = result.structuredContent as Record<string, unknown>;
  } catch (error) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_element_children failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
      {},
      "Inspect SysON availability and the architecture package id before retrying.",
    );
  }

  if (!Array.isArray(childrenContent.children)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      "syson_element_children: structuredContent.children must be an array.",
      { field: "children", actual: typeof childrenContent.children },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  const children = childrenContent.children as unknown[];
  const cmMatches: string[] = [];
  const dtMatches: string[] = [];

  for (const child of children) {
    if (!child || typeof child !== "object" || Array.isArray(child)) continue;
    const c = child as Record<string, unknown>;
    if (typeof c.id !== "string" || !c.id.trim()) continue;
    if (typeof c.label !== "string") continue;
    if (c.label === COFFEE_MACHINE_PART_LABEL) cmMatches.push(c.id);
    if (c.label === DRIP_TRAY_PART_LABEL) dtMatches.push(c.id);
  }

  if (cmMatches.length === 0) {
    throw new PartStructureExtractionError(
      "part_definition_not_found",
      `syson_element_children: no element with label "${COFFEE_MACHINE_PART_LABEL}" found in the architecture package.`,
      { label: COFFEE_MACHINE_PART_LABEL, count: 0 },
      `Insert the ${COFFEE_MACHINE_PART_LABEL} PartDef into the architecture package before retrying.`,
    );
  }
  if (cmMatches.length > 1) {
    throw new PartStructureExtractionError(
      "part_definition_ambiguous",
      `syson_element_children: ${cmMatches.length} elements with label "${COFFEE_MACHINE_PART_LABEL}" found; exactly one is required.`,
      { label: COFFEE_MACHINE_PART_LABEL, count: cmMatches.length },
      `Resolve the duplicate ${COFFEE_MACHINE_PART_LABEL} elements before retrying.`,
    );
  }
  if (dtMatches.length === 0) {
    throw new PartStructureExtractionError(
      "part_definition_not_found",
      `syson_element_children: no element with label "${DRIP_TRAY_PART_LABEL}" found in the architecture package.`,
      { label: DRIP_TRAY_PART_LABEL, count: 0 },
      `Insert the ${DRIP_TRAY_PART_LABEL} PartDef into the architecture package before retrying.`,
    );
  }
  if (dtMatches.length > 1) {
    throw new PartStructureExtractionError(
      "part_definition_ambiguous",
      `syson_element_children: ${dtMatches.length} elements with label "${DRIP_TRAY_PART_LABEL}" found; exactly one is required.`,
      { label: DRIP_TRAY_PART_LABEL, count: dtMatches.length },
      `Resolve the duplicate ${DRIP_TRAY_PART_LABEL} elements before retrying.`,
    );
  }

  const cmId = cmMatches[0]!;
  const dtId = dtMatches[0]!;

  // ── Phase 2: read full part structure for each element ────────────────────
  const cmStructure = await readPartStructure(
    syson,
    editingContextId,
    cmId,
    COFFEE_MACHINE_PART_LABEL,
  );
  const dtStructure = await readPartStructure(
    syson,
    editingContextId,
    dtId,
    DRIP_TRAY_PART_LABEL,
  );

  // Verify that the DripTray usage appears in the CoffeeMachine tree. Usage
  // labels are lower camelCase in SysML, distinct from the definition label.
  const hasDripTrayUsage = treeContainsLabel(cmStructure.tree, DRIP_TRAY_USAGE_LABEL);
  if (!hasDripTrayUsage) {
    throw new PartStructureExtractionError(
      "drip_tray_usage_absent",
      `syson_part_structure: the ${COFFEE_MACHINE_PART_LABEL} part tree does not contain a usage "${DRIP_TRAY_USAGE_LABEL}".`,
      { label: DRIP_TRAY_USAGE_LABEL },
      `Verify the SysML model declares a ${DRIP_TRAY_USAGE_LABEL} part usage inside ${COFFEE_MACHINE_PART_LABEL}.`,
    );
  }

  return {
    coffeeMachine: {
      elementId: cmId,
      label: COFFEE_MACHINE_PART_LABEL,
      structure: cmStructure,
    },
    dripTray: { elementId: dtId, label: DRIP_TRAY_PART_LABEL, structure: dtStructure },
  };
}

// ---------------------------------------------------------------------------
// Private: read and validate a single part structure
// ---------------------------------------------------------------------------

async function readPartStructure(
  syson: McpToolClient,
  editingContextId: string,
  elementId: string,
  expectedLabel: string,
): Promise<CoffeeMachinePartStructure> {
  let raw: unknown;
  try {
    const parsed = await syson.callToolTextResult({
      name: "syson_part_structure",
      arguments: {
        editing_context_id: editingContextId,
        root_element_id: elementId,
        max_depth: 4,
        include_attributes: false,
      },
    });
    raw = parsed;
  } catch (error) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure failed for element "${expectedLabel}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { label: expectedLabel },
      "Inspect SysON availability and the element id before retrying.",
    );
  }

  return validatePartStructure(raw, elementId, expectedLabel);
}

// ---------------------------------------------------------------------------
// Private: shape validation
// ---------------------------------------------------------------------------

const ROOT_KEYS = new Set(["id", "label", "kind"]);
const TREE_NODE_KEYS = new Set([
  "id",
  "label",
  "kind",
  "quantity",
  "quantitySource",
  "children",
]);
const PART_STRUCTURE_KEYS = new Set(["root", "tree", "partCount", "maxDepthReached"]);

function validatePartStructure(
  raw: unknown,
  elementId: string,
  expectedLabel: string,
): CoffeeMachinePartStructure {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: response for "${expectedLabel}" must be an object.`,
      { label: expectedLabel, field: "$root", actual: typeof raw },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  const rec = raw as Record<string, unknown>;

  // Exact key check on the top-level structure.
  checkExactKeys(rec, PART_STRUCTURE_KEYS, `$partStructure[${expectedLabel}]`);

  // Validate root.
  const rootRaw = rec.root;
  if (!rootRaw || typeof rootRaw !== "object" || Array.isArray(rootRaw)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: root for "${expectedLabel}" must be an object.`,
      { label: expectedLabel, field: "root" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  const rootRec = rootRaw as Record<string, unknown>;
  checkExactKeys(rootRec, ROOT_KEYS, `$partStructure[${expectedLabel}].root`);

  if (
    typeof rootRec.id !== "string" || !rootRec.id.trim() ||
    typeof rootRec.label !== "string" ||
    typeof rootRec.kind !== "string" || !rootRec.kind.trim()
  ) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: root for "${expectedLabel}" has an invalid shape.`,
      { label: expectedLabel, field: "root" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  if (rootRec.label !== expectedLabel) {
    throw new PartStructureExtractionError(
      "part_structure_root_mismatch",
      `syson_part_structure: root.label is "${
        String(rootRec.label)
      }", expected "${expectedLabel}".`,
      {
        label: expectedLabel,
        field: "root.label",
        expected: expectedLabel,
        actual: rootRec.label,
      },
      `The element id "${elementId}" does not correspond to a ${expectedLabel} PartDef. Stop for review.`,
    );
  }
  if (rootRec.id !== elementId) {
    throw new PartStructureExtractionError(
      "part_structure_root_mismatch",
      `syson_part_structure: root.id does not match the requested ${expectedLabel} element.`,
      {
        label: expectedLabel,
        field: "root.id",
        expected: elementId,
        actual: rootRec.id,
      },
      "The provider returned a structure for another element. Stop for review.",
    );
  }

  // Validate partCount.
  if (typeof rec.partCount !== "number" || !Number.isFinite(rec.partCount)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: partCount for "${expectedLabel}" must be a finite number.`,
      { label: expectedLabel, field: "partCount" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  // Validate maxDepthReached.
  if (typeof rec.maxDepthReached !== "boolean") {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: maxDepthReached for "${expectedLabel}" must be a boolean.`,
      { label: expectedLabel, field: "maxDepthReached" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  // Validate tree.
  if (!Array.isArray(rec.tree)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: tree for "${expectedLabel}" must be an array.`,
      { label: expectedLabel, field: "tree" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  const tree = (rec.tree as unknown[]).map((node, index) =>
    validateTreeNode(node, `$partStructure[${expectedLabel}].tree[${index}]`)
  );

  // SysON counts every recursively visited PartUsage, not merely roots.
  const recursivePartCount = countTreeNodes(tree);
  if (rec.partCount !== recursivePartCount) {
    throw new PartStructureExtractionError(
      "part_count_mismatch",
      `syson_part_structure: partCount is ${rec.partCount} but tree has ${recursivePartCount} recursive node(s) for "${expectedLabel}".`,
      {
        label: expectedLabel,
        field: "partCount",
        expected: recursivePartCount,
        actual: rec.partCount,
      },
      "The part structure is inconsistent. Stop for review before retrying.",
    );
  }
  if (rec.maxDepthReached) {
    throw new PartStructureExtractionError(
      "part_structure_truncated",
      `syson_part_structure: traversal for "${expectedLabel}" reached max_depth and is incomplete.`,
      { label: expectedLabel, field: "maxDepthReached", actual: true },
      "Increase the server-fixed depth only after reviewing the expected product structure.",
    );
  }

  return {
    root: {
      id: rootRec.id as string,
      label: rootRec.label as string,
      kind: rootRec.kind as string,
    },
    tree,
    partCount: rec.partCount as number,
    maxDepthReached: rec.maxDepthReached as boolean,
  };
}

function validateTreeNode(raw: unknown, path: string): PartTreeNode {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: ${path} must be an object.`,
      { field: path },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }
  const rec = raw as Record<string, unknown>;
  checkExactKeys(rec, TREE_NODE_KEYS, path);

  if (
    typeof rec.id !== "string" || !rec.id.trim() ||
    typeof rec.label !== "string" ||
    typeof rec.kind !== "string" || !rec.kind.trim() ||
    typeof rec.quantitySource !== "string"
  ) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: ${path} has an invalid shape.`,
      { field: path },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  if (
    typeof rec.quantity !== "number" && typeof rec.quantity !== "string"
  ) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: ${path}.quantity must be a number or string.`,
      { field: `${path}.quantity` },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  if (!Array.isArray(rec.children)) {
    throw new PartStructureExtractionError(
      "part_structure_extraction_failed",
      `syson_part_structure: ${path}.children must be an array.`,
      { field: `${path}.children` },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  const children = (rec.children as unknown[]).map((child, index) =>
    validateTreeNode(child, `${path}.children[${index}]`)
  );

  return {
    id: rec.id as string,
    label: rec.label as string,
    kind: rec.kind as string,
    quantity: rec.quantity as number | string,
    quantitySource: rec.quantitySource as string,
    children,
  };
}

function checkExactKeys(
  rec: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>,
  path: string,
): void {
  const actual = new Set(Object.keys(rec));
  for (const key of actual) {
    if (!expectedKeys.has(key)) {
      throw new PartStructureExtractionError(
        "part_structure_extraction_failed",
        `syson_part_structure: ${path} has unexpected key "${key}".`,
        { field: `${path}.${key}` },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
  }
  for (const key of expectedKeys) {
    if (!actual.has(key)) {
      throw new PartStructureExtractionError(
        "part_structure_extraction_failed",
        `syson_part_structure: ${path} is missing key "${key}".`,
        { field: `${path}.${key}` },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
  }
}

function treeContainsLabel(
  nodes: readonly PartTreeNode[],
  label: string,
): boolean {
  for (const node of nodes) {
    if (node.label === label) return true;
    if (treeContainsLabel(node.children, label)) return true;
  }
  return false;
}

function countTreeNodes(nodes: readonly PartTreeNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countTreeNodes(node.children), 0);
}
