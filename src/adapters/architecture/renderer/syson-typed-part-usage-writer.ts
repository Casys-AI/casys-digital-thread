/**
 * Provider-owned lowering for one reviewed SysML `part usage : PartDef`.
 *
 * SysON's textual insertion endpoint can acknowledge a nested PartUsage while
 * retaining only the surrounding PartDefinitions. The Digital Thread keeps
 * the reviewed SysML statement as immutable source evidence, but lowers that
 * statement through native SysON model operations and then proves the exact
 * FeatureTyping target by readback.
 *
 * Agent input never selects these tools, child creation descriptions or AQL
 * expressions. They are pinned implementation details of this adapter.
 */

import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import { ARCHITECTURE_FEATURE_TYPING_AQL } from "./architecture-structure-extractor.ts";

const PART_USAGE_CHILD_TYPE = "SysMLv2EditService-PartUsage";
const FEATURE_TYPING_CHILD_TYPE = "SysMLv2EditService-FeatureTyping";
const SEMANTIC_ELEMENT_ID_AQL = "aql:self.elementId";

export interface SysonTypedPartUsageWrite {
  readonly usageId: string;
  readonly featureTypingId: string;
}

export async function writeSysonTypedPartUsage(input: {
  readonly syson: McpToolClient;
  readonly editingContextId: string;
  readonly parentPartDefinitionId: string;
  readonly targetPartDefinitionId: string;
  readonly targetPartDefinitionLabel: string;
  readonly usageName: string;
  readonly onAcknowledged: () => void;
}): Promise<SysonTypedPartUsageWrite> {
  const semanticTargetId = await readSemanticElementId(
    input.syson,
    input.editingContextId,
    input.targetPartDefinitionId,
  );

  const usageResult = await input.syson.callTool({
    name: "syson_element_create",
    arguments: {
      editing_context_id: input.editingContextId,
      parent_id: input.parentPartDefinitionId,
      child_type: PART_USAGE_CHILD_TYPE,
      name: input.usageName,
    },
  });
  const usageId = exactCreatedElement(
    usageResult.structuredContent,
    "PartUsage",
    input.usageName,
  );
  input.onAcknowledged();

  const typingResult = await input.syson.callTool({
    name: "syson_element_create",
    arguments: {
      editing_context_id: input.editingContextId,
      parent_id: usageId,
      child_type: FEATURE_TYPING_CHILD_TYPE,
      name: input.targetPartDefinitionLabel,
    },
  });
  const featureTypingId = exactCreatedElement(
    typingResult.structuredContent,
    "FeatureTyping",
    input.targetPartDefinitionLabel,
  );
  input.onAcknowledged();

  const linkExpression = featureTypingLinkExpression(semanticTargetId);
  const linkResult = await input.syson.callTool({
    name: "syson_query_aql",
    arguments: {
      editing_context_id: input.editingContextId,
      object_id: featureTypingId,
      expression: linkExpression,
    },
  });
  verifyVoidMutation(
    linkResult.structuredContent,
    featureTypingId,
    linkExpression,
  );
  input.onAcknowledged();

  const readback = await input.syson.callTool({
    name: "syson_query_aql",
    arguments: {
      editing_context_id: input.editingContextId,
      object_id: usageId,
      expression: ARCHITECTURE_FEATURE_TYPING_AQL,
    },
  });
  verifyExactTypingReadback(
    readback.structuredContent,
    usageId,
    input.targetPartDefinitionId,
    input.targetPartDefinitionLabel,
  );

  return Object.freeze({ usageId, featureTypingId });
}

async function readSemanticElementId(
  syson: McpToolClient,
  editingContextId: string,
  targetPartDefinitionId: string,
): Promise<string> {
  const result = await syson.callTool({
    name: "syson_query_aql",
    arguments: {
      editing_context_id: editingContextId,
      object_id: targetPartDefinitionId,
      expression: SEMANTIC_ELEMENT_ID_AQL,
    },
  });
  const content = exactRecord(result.structuredContent, "semantic-id query");
  const semanticId = content.result;
  if (
    content.objectId !== targetPartDefinitionId ||
    content.expression !== SEMANTIC_ELEMENT_ID_AQL ||
    content.type !== "string" ||
    typeof semanticId !== "string" ||
    !isSafeAqlIdentifier(semanticId)
  ) {
    throw new Error(
      "SysON did not return an exact safe semantic elementId for the target PartDefinition.",
    );
  }
  return semanticId;
}

function exactCreatedElement(
  value: unknown,
  expectedKind: "PartUsage" | "FeatureTyping",
  expectedLabel: string,
): string {
  const content = exactRecord(value, `${expectedKind} creation`);
  if (
    typeof content.id !== "string" ||
    content.id.trim().length === 0 ||
    typeof content.kind !== "string" ||
    !isSemanticKind(content.kind, expectedKind) ||
    content.label !== expectedLabel
  ) {
    throw new Error(
      `SysON did not acknowledge the exact created ${expectedKind} "${expectedLabel}".`,
    );
  }
  return content.id;
}

function featureTypingLinkExpression(semanticTargetId: string): string {
  if (!isSafeAqlIdentifier(semanticTargetId)) {
    throw new Error("Unsafe SysON semantic elementId cannot enter an AQL literal.");
  }
  return "aql:let target = self.eResource().getContents()->first().eAllContents()" +
    `->select(e | e.elementId = '${semanticTargetId}')->first() ` +
    "in self.eSet('type', target)";
}

function verifyVoidMutation(
  value: unknown,
  featureTypingId: string,
  expression: string,
): void {
  const content = exactRecord(value, "FeatureTyping mutation");
  if (
    content.objectId !== featureTypingId ||
    content.expression !== expression ||
    content.type !== "void" ||
    content.result !== null
  ) {
    throw new Error(
      "SysON returned an invalid FeatureTyping mutation acknowledgement.",
    );
  }
}

function verifyExactTypingReadback(
  value: unknown,
  usageId: string,
  targetId: string,
  targetLabel: string,
): void {
  const content = exactRecord(value, "FeatureTyping readback");
  const results = content.results;
  if (
    content.objectId !== usageId ||
    content.expression !== ARCHITECTURE_FEATURE_TYPING_AQL ||
    content.type !== "objects" ||
    content.count !== 1 ||
    !Array.isArray(results) ||
    results.length !== 1
  ) {
    throw new Error("SysON did not read back exactly one FeatureTyping target.");
  }
  const target = exactRecord(results[0], "FeatureTyping target");
  if (
    target.id !== targetId ||
    target.label !== targetLabel ||
    typeof target.kind !== "string" ||
    !isSemanticKind(target.kind, "PartDefinition")
  ) {
    throw new Error(
      `SysON FeatureTyping readback did not resolve exact PartDefinition "${targetLabel}" (${targetId}).`,
    );
  }
}

function exactRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`SysON ${label} response must be a non-null object.`);
  }
  return value as Record<string, unknown>;
}

function isSemanticKind(kind: string, expected: string): boolean {
  return kind === expected || kind === `sysml::${expected}` ||
    kind.endsWith(`entity=${expected}`);
}

function isSafeAqlIdentifier(value: string): boolean {
  return value.length > 0 && value.length <= 128 && /^[A-Za-z0-9-]+$/.test(value);
}
