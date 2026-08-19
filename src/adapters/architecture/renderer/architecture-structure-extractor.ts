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
 *     Collect PartUsage children (label only at this stage).
 *
 *   Phase 3b — syson_query_aql (AQL) on each PartUsage
 *     Resolve the target PartDef via FeatureTyping.
 *     AQL: `aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type`
 *     Returns the typed PartDefinition element (id + label) — NOT a FeatureTyping
 *     node. This is the only reliable way to recover the target PartDef: the
 *     syson_element_children response for a PartUsage labels every FeatureTyping
 *     child "FeatureTyping" (the relationship's own display name), not the name of
 *     the referenced PartDefinition. The AQL `.type` projection bypasses that.
 *
 * FAIL-CLOSED — unexpected shapes, ambiguous labels, or SysON failures are
 * hard errors. "Zero packages found" is the only case that returns undefined.
 *
 * Project-agnostic: no product name or constant in this module.
 */

import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type {
  ExistingArchitectureStructure,
  ExistingAttribute,
  ExistingPartDef,
  ExistingPartUsage,
} from "../../../domain/architecture/renderer/architecture-proposal.ts";

// ── AQL expression (pinned contract) ─────────────────────────────────────────

/**
 * AQL expression that resolves the target PartDefinition for a PartUsage.
 *
 * WHY NOT syson_element_children — syson_element_children on a PartUsage
 * returns FeatureTyping nodes with label "FeatureTyping" (the relationship's
 * own display name in the SysON tree), not the name of the typed PartDef.
 * The AQL `.type` projection returns the actual typed element.
 */
export const ARCHITECTURE_FEATURE_TYPING_AQL =
  "aql:self.ownedRelationship->select(r | r.oclIsKindOf(sysml::FeatureTyping)).type" as const;

// ── Error types ──────────────────────────────────────────────────────────────

export type ArchitectureStructureExtractionCode =
  | "extraction_failed"
  | "ambiguous_package"
  | "invalid_children_response"
  | "invalid_aql_response"
  | "missing_feature_typing"
  | "missing_element"
  | "unexpected_element_kind"
  | "invalid_element_get_response";

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
  // usage, resolve its target PartDef via an AQL query (not syson_element_children).
  //
  // WHY AQL — adoption and post-insertion verification must compare the FULL
  // parent→usage→cible triple. syson_element_children on a PartUsage returns
  // FeatureTyping children with label "FeatureTyping" (the relation's display
  // name), not the name of the typed PartDef. The AQL expression
  // ARCHITECTURE_FEATURE_TYPING_AQL projects through .type to return the actual
  // typed PartDefinition element with its real label.
  for (const child of packageChildren) {
    if (!semanticKind(child.kind, "PartDefinition")) continue;
    const owned = await collectOwnedPartFeatures(
      syson,
      editingContextId,
      child.id,
      child.label,
    );
    partDefs.push({
      id: child.id,
      kind: child.kind,
      label: child.label,
      usages: owned.usages,
      attributes: owned.attributes,
    });
  }

  return {
    packageId: architecturePackage.id,
    packageLabel: architecturePackage.label,
    partDefs,
  };
}

/**
 * Re-read only the sealed PartDefinitions (Phase 3 + 3b). Depth is one owned
 * PartUsage generation plus FeatureTyping; it is never a call argument.
 *
 * Each sealed id is first reopened with `syson_element_get` so the returned
 * label is the live SysON name, not the sealed capture name. A rename or
 * retype is then visible to the caller. Output order matches `partDefs`
 * input order. The function never rediscovers the package or walks
 * `usage.children`.
 */
export async function extractPartDefinitionStructures(
  syson: McpToolClient,
  editingContextId: string,
  partDefs: readonly { readonly id: string; readonly label: string }[],
): Promise<readonly ExistingPartDef[]> {
  const extracted: ExistingPartDef[] = [];
  for (const partDef of partDefs) {
    const live = await callElementGet(syson, editingContextId, partDef.id);
    const owned = await collectOwnedPartFeatures(
      syson,
      editingContextId,
      live.id,
      live.label,
    );
    extracted.push({
      id: live.id,
      label: live.label,
      usages: owned.usages,
      attributes: owned.attributes,
    });
  }
  return extracted;
}

// ── Private helpers ──────────────────────────────────────────────────────────

interface SysonChild {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
}

async function collectOwnedPartFeatures(
  syson: McpToolClient,
  editingContextId: string,
  partDefId: string,
  partDefLabel: string,
): Promise<{
  readonly usages: ExistingPartUsage[];
  readonly attributes: ExistingAttribute[];
}> {
  const children = await callChildren(syson, editingContextId, partDefId);
  const usages: ExistingPartUsage[] = [];
  const attributes: ExistingAttribute[] = [];
  for (const child of children) {
    if (semanticKind(child.kind, "AttributeUsage")) {
      attributes.push({
        id: child.id,
        kind: child.kind,
        label: child.label,
      });
      continue;
    }
    if (!semanticKind(child.kind, "PartUsage")) continue;
    const target = await resolveFeatureTypingTarget(
      syson,
      editingContextId,
      child,
      partDefLabel,
    );
    usages.push({
      id: child.id,
      kind: child.kind,
      label: child.label,
      targetId: target.id,
      targetKind: target.kind,
      targetLabel: target.label,
    });
  }
  return { usages, attributes };
}

async function callElementGet(
  syson: McpToolClient,
  editingContextId: string,
  elementId: string,
): Promise<{ readonly id: string; readonly kind: string; readonly label: string }> {
  let content: Record<string, unknown>;
  try {
    const result = await syson.callTool({
      name: "syson_element_get",
      arguments: { editing_context_id: editingContextId, element_id: elementId },
    });
    content = result.structuredContent as Record<string, unknown>;
  } catch (error) {
    throw new ArchitectureStructureExtractionError(
      "extraction_failed",
      `syson_element_get failed for element "${elementId}": ${
        error instanceof Error ? error.message : String(error)
      }`,
      { elementId },
      "Inspect SysON availability and the element id before retrying.",
    );
  }

  if (
    !content || typeof content !== "object" || Array.isArray(content) ||
    typeof content.id !== "string" || !content.id ||
    typeof content.kind !== "string" || !content.kind ||
    typeof content.label !== "string" || !content.label
  ) {
    throw new ArchitectureStructureExtractionError(
      "invalid_element_get_response",
      `syson_element_get response for "${elementId}" has an unexpected shape.`,
      { elementId, field: "structuredContent" },
      "The SysON tool response shape has changed. Stop for review before retrying.",
    );
  }

  if (content.id !== elementId) {
    throw new ArchitectureStructureExtractionError(
      "missing_element",
      `syson_element_get did not return sealed PartDefinition "${elementId}".`,
      { elementId, field: "id" },
      "The sealed PartDefinition is absent from the live SysON model.",
    );
  }

  if (!semanticKind(content.kind, "PartDefinition")) {
    throw new ArchitectureStructureExtractionError(
      "unexpected_element_kind",
      `Sealed id "${elementId}" is live kind "${content.kind}", not a PartDefinition.`,
      { elementId, field: "kind" },
      "The sealed PartDefinition was replaced or retyped in SysON.",
    );
  }

  return { id: content.id, kind: content.kind, label: content.label };
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

/**
 * Resolve the target PartDefinition label for a PartUsage via AQL.
 *
 * Uses ARCHITECTURE_FEATURE_TYPING_AQL to obtain the typed element directly,
 * bypassing the syson_element_children label limitation (always "FeatureTyping").
 * Throws missing_feature_typing if the usage has no FeatureTyping, and
 * invalid_aql_response if the response shape is unexpected or ambiguous.
 */
async function resolveFeatureTypingTarget(
  syson: McpToolClient,
  editingContextId: string,
  usage: SysonChild,
  parentLabel: string,
): Promise<{ readonly id: string; readonly kind: string; readonly label: string }> {
  let content: Record<string, unknown>;
  try {
    const result = await syson.callTool({
      name: "syson_query_aql",
      arguments: {
        editing_context_id: editingContextId,
        object_id: usage.id,
        expression: ARCHITECTURE_FEATURE_TYPING_AQL,
      },
    });
    content = result.structuredContent as Record<string, unknown>;
  } catch (error) {
    throw new ArchitectureStructureExtractionError(
      "extraction_failed",
      `syson_query_aql (FeatureTyping) failed for PartUsage "${usage.label}" ` +
        `(id: "${usage.id}") under "${parentLabel}": ${
          error instanceof Error ? error.message : String(error)
        }`,
      { elementId: usage.id },
      "Inspect SysON availability and the element id before retrying.",
    );
  }

  if (
    !content ||
    typeof content !== "object" ||
    content.objectId !== usage.id ||
    content.expression !== ARCHITECTURE_FEATURE_TYPING_AQL ||
    content.type !== "objects" ||
    !Array.isArray(content.results) ||
    typeof content.count !== "number" ||
    content.count !== content.results.length
  ) {
    throw new ArchitectureStructureExtractionError(
      "invalid_aql_response",
      `syson_query_aql FeatureTyping response for PartUsage "${usage.label}" ` +
        `(id: "${usage.id}") has an unexpected shape.`,
      { elementId: usage.id, field: "structuredContent" },
      "The SysON AQL response shape has changed. Stop for review before retrying.",
    );
  }

  if (content.count === 0) {
    throw new ArchitectureStructureExtractionError(
      "missing_feature_typing",
      `PartUsage "${usage.label}" (id: "${usage.id}") under "${parentLabel}" ` +
        "has no FeatureTyping. The usage has no declared type.",
      { elementId: usage.id, field: "FeatureTyping" },
      "Inspect the SysON model: every PartUsage must have exactly one FeatureTyping.",
    );
  }

  if (content.count > 1) {
    throw new ArchitectureStructureExtractionError(
      "invalid_aql_response",
      `PartUsage "${usage.label}" (id: "${usage.id}") under "${parentLabel}" ` +
        `has ${content.count} FeatureTyping targets; exactly one is required.`,
      { elementId: usage.id, field: "FeatureTyping", count: content.count },
      "Inspect the SysON model: a PartUsage with multiple types is ambiguous.",
    );
  }

  const typed = (content.results as unknown[])[0];
  if (
    !typed || typeof typed !== "object" || Array.isArray(typed) ||
    typeof (typed as Record<string, unknown>).id !== "string" ||
    !(typed as Record<string, unknown>).id ||
    typeof (typed as Record<string, unknown>).kind !== "string" ||
    !semanticKind(
      (typed as Record<string, unknown>).kind as string,
      "PartDefinition",
    ) ||
    typeof (typed as Record<string, unknown>).label !== "string" ||
    !(typed as Record<string, unknown>).label
  ) {
    throw new ArchitectureStructureExtractionError(
      "invalid_aql_response",
      `syson_query_aql FeatureTyping result for PartUsage "${usage.label}" ` +
        `(id: "${usage.id}") is missing a label field.`,
      { elementId: usage.id, field: "results[0].label" },
      "The SysON AQL response shape has changed. Stop for review before retrying.",
    );
  }

  const record = typed as Record<string, unknown>;
  return {
    id: record.id as string,
    kind: record.kind as string,
    label: record.label as string,
  };
}

function semanticKind(value: string, expected: string): boolean {
  return value === `sysml::${expected}` || value.endsWith(`entity=${expected}`);
}
