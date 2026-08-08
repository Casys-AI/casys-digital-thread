/**
 * Extractor for the generic architecture structure from a SysON model.
 *
 * Three-phase extraction:
 *
 *   Phase 1 — syson_element_children on rootPackage
 *     Locate the architecture package by exact label. Absent → undefined
 *     (initial mode). More than one → ambiguous → hard error.
 *
 *   Phase 2 — syson_element_children on the architecture package
 *     Collect all PartDefinition children.
 *
 *   Phase 3 — syson_element_children on each PartDef
 *     Collect usage labels (PartUsage children).
 *
 * FAIL-CLOSED — unexpected shapes, ambiguous labels, or SysON failures are
 * hard errors. "Zero packages found" is the only case that returns undefined.
 *
 * Project-agnostic: no product name or constant in this module.
 */

import type { McpToolClient } from "../mcp/http-mcp-tool-client.ts";
import type {
  ExistingArchitectureStructure,
  ExistingPartDef,
  ExistingPartUsage,
} from "../../domain/platform/architecture-proposal.ts";

// ── Error types ──────────────────────────────────────────────────────────────

export type ArchitectureStructureExtractionCode =
  | "extraction_failed"
  | "ambiguous_package"
  | "invalid_children_response"
  | "missing_feature_typing";

export interface ArchitectureStructureExtractionContext {
  readonly field?: string;
  readonly elementId?: string;
  readonly packageName?: string;
  readonly count?: number;
}

/** Structured error raised when SysON fails or the response has an unexpected shape. */
export class ArchitectureStructureExtractionError extends Error {
  readonly code: ArchitectureStructureExtractionCode;
  readonly context: ArchitectureStructureExtractionContext;
  readonly recovery: string;

  constructor(
    code: ArchitectureStructureExtractionCode,
    message: string,
    context: ArchitectureStructureExtractionContext,
    recovery: string,
  ) {
    super(message);
    this.name = "ArchitectureStructureExtractionError";
    this.code = code;
    this.context = context;
    this.recovery = recovery;
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Extract the architecture structure from a SysON model.
 *
 * Returns undefined when the architecture package is absent (initial-mode
 * signal). Throws ArchitectureStructureExtractionError on SysON failures or
 * ambiguous model shapes.
 */
export async function extractArchitectureStructure(
  syson: McpToolClient,
  editingContextId: string,
  rootPackageId: string,
  packageName: string,
): Promise<ExistingArchitectureStructure | undefined> {
  // Phase 1: find the architecture package by exact label.
  const rootChildren = await callChildren(syson, editingContextId, rootPackageId);
  const packageCandidates = rootChildren.filter(
    (child) => child.label === packageName && semanticKind(child.kind, "Package"),
  );

  if (packageCandidates.length === 0) {
    return undefined;
  }
  if (packageCandidates.length > 1) {
    throw new ArchitectureStructureExtractionError(
      "ambiguous_package",
      `Found ${packageCandidates.length} packages named "${packageName}" under rootPackage "${rootPackageId}".`,
      { packageName, count: packageCandidates.length },
      "Inspect the SysON model: only one architecture package per name is allowed.",
    );
  }

  const architecturePackage = packageCandidates[0]!;

  // Phase 2: get all PartDef children of the architecture package.
  const packageChildren = await callChildren(
    syson,
    editingContextId,
    architecturePackage.id,
  );
  const partDefs: ExistingPartDef[] = [];

  // Phase 3 + 3b: for each PartDef, get its PartUsage children; then for each
  // usage, resolve its target PartDef via the FeatureTyping child.
  //
  // WHY PHASE 3b — adoption and post-insertion verification must compare the
  // FULL parent→usage→cible triple, not just the usage label. `part wing : Motor`
  // and `part wing : Wing` share the same label but are structurally different.
  // Calling syson_element_children on the PartUsage element returns the
  // FeatureTyping child whose label names the typed PartDef.
  for (const child of packageChildren) {
    if (!semanticKind(child.kind, "PartDefinition")) continue;
    const partDefChildren = await callChildren(syson, editingContextId, child.id);
    const usages: ExistingPartUsage[] = [];
    for (const usage of partDefChildren) {
      if (!semanticKind(usage.kind, "PartUsage")) continue;
      const usageChildren = await callChildren(syson, editingContextId, usage.id);
      const typings = usageChildren.filter((c) =>
        semanticKind(c.kind, "FeatureTyping")
      );
      if (typings.length === 0) {
        throw new ArchitectureStructureExtractionError(
          "missing_feature_typing",
          `PartUsage "${usage.label}" (id: "${usage.id}") under "${child.label}" ` +
            "has no FeatureTyping child. The usage has no declared type.",
          { elementId: usage.id, field: "FeatureTyping" },
          "Inspect the SysON model: every PartUsage must have exactly one FeatureTyping.",
        );
      }
      if (typings.length > 1) {
        throw new ArchitectureStructureExtractionError(
          "invalid_children_response",
          `PartUsage "${usage.label}" (id: "${usage.id}") under "${child.label}" ` +
            `has ${typings.length} FeatureTyping children; exactly one is required.`,
          { elementId: usage.id, field: "FeatureTyping", count: typings.length },
          "Inspect the SysON model: a PartUsage with multiple types is ambiguous.",
        );
      }
      usages.push({ label: usage.label, targetLabel: typings[0]!.label });
    }
    partDefs.push({ id: child.id, label: child.label, usages });
  }

  return {
    packageId: architecturePackage.id,
    packageLabel: architecturePackage.label,
    partDefs,
  };
}

// ── Private helpers ──────────────────────────────────────────────────────────

interface SysonChild {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

async function callChildren(
  syson: McpToolClient,
  editingContextId: string,
  elementId: string,
): Promise<readonly SysonChild[]> {
  let content: Record<string, unknown>;
  try {
    const result = await syson.callTool({
      name: "syson_element_children",
      arguments: { editing_context_id: editingContextId, element_id: elementId },
    });
    content = result.structuredContent as Record<string, unknown>;
  } catch (error) {
    throw new ArchitectureStructureExtractionError(
      "extraction_failed",
      `syson_element_children failed for element "${elementId}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { elementId },
      "Inspect SysON availability and the element id before retrying.",
    );
  }

  if (
    !content || typeof content !== "object" ||
    content.parentId !== elementId ||
    !Array.isArray(content.children) ||
    typeof content.count !== "number" ||
    content.count !== content.children.length
  ) {
    throw new ArchitectureStructureExtractionError(
      "invalid_children_response",
      `syson_element_children response for "${elementId}" has an unexpected shape.`,
      { elementId, field: "structuredContent" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  return (content.children as unknown[]).map((raw, index) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new ArchitectureStructureExtractionError(
        "invalid_children_response",
        `syson_element_children child[${index}] for "${elementId}" is not an object.`,
        { elementId, field: `children[${index}]` },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
    const record = raw as Record<string, unknown>;
    if (
      typeof record.id !== "string" || !record.id ||
      typeof record.kind !== "string" || !record.kind ||
      typeof record.label !== "string"
    ) {
      throw new ArchitectureStructureExtractionError(
        "invalid_children_response",
        `syson_element_children child[${index}] for "${elementId}" is missing id, kind, or label.`,
        { elementId, field: `children[${index}]` },
        "The SysON tool response shape has changed. Stop for review before retrying.",
      );
    }
    return { id: record.id, kind: record.kind, label: record.label };
  });
}

function semanticKind(value: string, expected: string): boolean {
  return value === `sysml::${expected}` || value.endsWith(`entity=${expected}`);
}
