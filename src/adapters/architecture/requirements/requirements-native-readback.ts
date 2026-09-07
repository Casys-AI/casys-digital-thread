/**
 * Shared native RequirementUsage/ConstraintUsage readback.
 *
 * Used by the insert writer and the read-only recapture. It never inserts,
 * deletes or renders SysML.
 */

import { EngineeringProjectCommandError } from "../../../application/use-cases/project/engineering-project-command-service.ts";
import type { McpToolClient } from "../../../application/ports/out/mcp-tool-client.ts";
import type { RequirementsTarget } from "../../../domain/architecture/requirements/requirements-proposal.ts";
import { ARCHITECTURE_FEATURE_TYPING_AQL } from "../renderer/architecture-structure-extractor.ts";
import type { VerifiedConstraintUsageIdentity } from "../../extractors/syson-requirements-extractor.ts";
import type { RequirementsCaptureConstraintUsage } from "./requirements-capture.ts";

/**
 * Prove the provider-native target binding after insertion/readback.
 *
 * The declaration must be a RequirementUsage owned by the resolved target
 * PartDefinition, carry one `subject target` ReferenceUsage typed by that
 * exact PartDefinition, and contain at least one required ConstraintUsage.
 * The subsequent constraint extractor verifies the predicates themselves.
 */
export async function verifyTargetedRequirementUsage(
  syson: McpToolClient,
  editingContextId: string,
  requirementsElementId: string,
  requirementName: string,
  target: RequirementsTarget,
): Promise<{
  readonly subjectId: string;
  readonly constraintUsageIds: readonly string[];
}> {
  const element = await syson.callTool({
    name: "syson_element_get",
    arguments: {
      editing_context_id: editingContextId,
      element_id: requirementsElementId,
    },
  });
  const elementKind = element.structuredContent.kind;
  if (
    element.structuredContent.id !== requirementsElementId ||
    element.structuredContent.label !== requirementName ||
    !isSysmlEntityKind(elementKind, "RequirementUsage")
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements target binding failed: SysON readback is not the exact " +
        `RequirementUsage "${requirementName}" (${requirementsElementId}).`,
    );
  }

  const childrenResult = await syson.callTool({
    name: "syson_element_children",
    arguments: {
      editing_context_id: editingContextId,
      element_id: requirementsElementId,
    },
  });
  const children = parseProviderChildren(
    childrenResult.structuredContent,
    requirementsElementId,
  );
  const subjects = children.filter((child) =>
    isProviderChild(child, "target", "ReferenceUsage")
  );
  const constraints = children.filter((child) =>
    isProviderChild(child, undefined, "ConstraintUsage")
  );
  if (subjects.length !== 1 || constraints.length === 0) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements target binding failed: the native RequirementUsage must " +
        "contain exactly one subject named target and at least one required constraint.",
    );
  }
  const subjectId = (subjects[0] as Record<string, unknown>).id;
  if (typeof subjectId !== "string" || !subjectId.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements target binding failed: the subject has no provider identity.",
    );
  }
  const constraintUsageIds = constraints.map((constraint) =>
    (constraint as Record<string, unknown>).id as string
  );
  assertPairwiseDisjointNativeIdentities({
    targetElementId: target.elementId,
    requirementsElementId,
    subjectId,
    constraintUsageIds,
  });

  const typing = await syson.callTool({
    name: "syson_query_aql",
    arguments: {
      editing_context_id: editingContextId,
      object_id: subjectId,
      expression: ARCHITECTURE_FEATURE_TYPING_AQL,
    },
  });
  const response = typing.structuredContent;
  const results = response.results;
  if (
    response.objectId !== subjectId ||
    response.expression !== ARCHITECTURE_FEATURE_TYPING_AQL ||
    response.type !== "objects" || response.count !== 1 ||
    !Array.isArray(results) || results.length !== 1 ||
    !isExactProviderTarget(results[0], target)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements target binding failed: subject target is not typed by the " +
        `exact PartDefinition "${target.label}" (${target.elementId}).`,
    );
  }
  return Object.freeze({
    subjectId,
    constraintUsageIds: Object.freeze(constraintUsageIds),
  });
}

/**
 * Prove the named RequirementUsage is still owned by the exact target
 * PartDefinition. Recapture never rediscovers by label alone.
 */
export async function findOwnedRequirementUsage(
  syson: McpToolClient,
  editingContextId: string,
  target: RequirementsTarget,
  requirementsElementId: string,
  requirementName: string,
): Promise<string> {
  const children = parseProviderChildren(
    (await syson.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: target.elementId,
      },
    })).structuredContent,
    target.elementId,
  );
  if (requirementsElementId === target.elementId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements ownership failed: RequirementUsage identity is not disjoint " +
        "from the target PartDefinition.",
    );
  }
  const matches = children.filter((child) =>
    child.id === requirementsElementId &&
    child.label === requirementName &&
    isSysmlEntityKind(child.kind, "RequirementUsage")
  );
  if (matches.length !== 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements ownership failed: the captured RequirementUsage is not the " +
        `unique child of PartDefinition "${target.label}" (${target.elementId}).`,
    );
  }
  const id = matches[0]!.id;
  if (typeof id !== "string" || id !== requirementsElementId) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements ownership failed: native child identity diverged.",
    );
  }
  return id;
}

export async function findElementByLabelOrUndefined(
  syson: McpToolClient,
  editingContextId: string,
  parentId: string,
  partDefName: string,
): Promise<string | undefined> {
  const children = parseProviderChildren(
    (await syson.callTool({
      name: "syson_element_children",
      arguments: {
        editing_context_id: editingContextId,
        element_id: parentId,
      },
    })).structuredContent,
    parentId,
  );
  const matches = children.filter((child) => child.label === partDefName);
  if (matches.length === 0) return undefined;
  if (matches.length > 1) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `D5 ambiguity before enrichment: ${matches.length} elements with label "${partDefName}" ` +
        `under target "${parentId}". Manual inspection required before enrichment.`,
    );
  }
  const match = matches[0]!;
  if (typeof match.id !== "string" || !match.id.trim()) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "D5 identification returned a child without a provider identity.",
    );
  }
  return match.id;
}

export async function identifyByLabelOrFail(
  syson: McpToolClient,
  editingContextId: string,
  parentId: string,
  partDefName: string,
): Promise<string> {
  const found = await findElementByLabelOrUndefined(
    syson,
    editingContextId,
    parentId,
    partDefName,
  );
  if (found === undefined) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `D5 identification failed: element with label "${partDefName}" not found ` +
        `in children of target "${parentId}" after insertion.`,
    );
  }
  return found;
}

/**
 * Bind the structural child readback to the specialized constraint extractor.
 * Neither response may authorize an identity absent from the other one.
 */
export function assertConstraintUsageChildBijection(
  childIds: readonly string[],
  extracted: readonly VerifiedConstraintUsageIdentity[],
  context: string,
): void {
  const childIdSet = new Set(childIds);
  const extractedIdSet = new Set(extracted.map((item) => item.id));
  const extractedSourceIdSet = new Set(extracted.map((item) => item.sourceId));
  if (
    childIds.length !== extracted.length ||
    childIdSet.size !== childIds.length ||
    extractedIdSet.size !== extracted.length ||
    extractedSourceIdSet.size !== extracted.length ||
    childIds.some((id) => !extractedIdSet.has(id) || !extractedSourceIdSet.has(id)) ||
    extracted.some((item) => item.id !== item.sourceId)
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Requirements identity readback failed: ${context} child ConstraintUsage ` +
        "identities and syson_constraint_extract id/sourceId identities are not bijective.",
    );
  }
}

/** A captured predecessor authorizes only the exact native identities it sealed. */
export function assertCapturedConstraintUsageBijection(
  captured: readonly RequirementsCaptureConstraintUsage[],
  live: readonly VerifiedConstraintUsageIdentity[],
): void {
  const liveByRequirementId = new Map(
    live.map((item) => [item.requirementId, item] as const),
  );
  if (
    captured.length !== live.length ||
    liveByRequirementId.size !== live.length ||
    captured.some((expected) => {
      const observed = liveByRequirementId.get(expected.requirementId);
      return observed === undefined || observed.id !== expected.id ||
        observed.kind !== expected.kind ||
        observed.sourceId !== expected.sourceId;
    })
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Prior ConstraintUsage identity mismatch: the verified live predecessor " +
        "does not bijectively match its captured native identities.",
    );
  }
}

export function assertPairwiseDisjointNativeIdentities(input: {
  readonly targetElementId: string;
  readonly requirementsElementId: string;
  readonly subjectId: string;
  readonly constraintUsageIds: readonly string[];
}): void {
  const identities = [
    input.targetElementId,
    input.requirementsElementId,
    input.subjectId,
    ...input.constraintUsageIds,
  ];
  if (
    identities.some((id) => typeof id !== "string" || !id.trim()) ||
    new Set(identities).size !== identities.length
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "Requirements target binding failed: target PartDefinition, RequirementUsage, " +
        "subject and ConstraintUsage identities must be pairwise disjoint.",
    );
  }
}

export function parseProviderChildren(
  value: unknown,
  expectedParentId: string,
): ReadonlyArray<Record<string, unknown>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "syson_element_children returned a non-object response.",
    );
  }
  const record = value as Record<string, unknown>;
  if (
    record.parentId !== expectedParentId || !Array.isArray(record.children) ||
    !Number.isSafeInteger(record.count) ||
    record.count !== record.children.length
  ) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `syson_element_children response does not exactly echo parent ` +
        `"${expectedParentId}" and its child count.`,
    );
  }
  return record.children.map((child, index) => {
    if (!child || typeof child !== "object" || Array.isArray(child)) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `syson_element_children child[${index}] is not an object.`,
      );
    }
    const entry = child as Record<string, unknown>;
    if (
      typeof entry.id !== "string" || !entry.id.trim() ||
      typeof entry.kind !== "string" || !entry.kind.trim() ||
      typeof entry.label !== "string"
    ) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        `syson_element_children child[${index}] is malformed.`,
      );
    }
    return entry;
  });
}

export function isSysmlEntityKind(value: unknown, entity: string): boolean {
  return typeof value === "string" &&
    (value === entity || value.endsWith(`entity=${entity}`));
}

function isProviderChild(
  value: unknown,
  label: string | undefined,
  entity: string,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const child = value as Record<string, unknown>;
  return (label === undefined || child.label === label) &&
    isSysmlEntityKind(child.kind, entity);
}

function isExactProviderTarget(
  value: unknown,
  target: RequirementsTarget,
): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return candidate.id === target.elementId &&
    candidate.label === target.label &&
    isSysmlEntityKind(candidate.kind, "PartDefinition");
}
