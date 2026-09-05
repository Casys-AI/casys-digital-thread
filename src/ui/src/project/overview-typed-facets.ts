import type {
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
} from "../thread/types.ts";

function refKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

/**
 * A part usage and the definition that types it are one object on the board.
 *
 * SysML records both facets, and the graph carries both as nodes. When a usage
 * is typed by exactly one definition, and that definition types exactly that
 * usage, the two say the same thing twice: the hull shows `arm` beside `Arm`
 * and the reader has to know they are the same part. This collapses the pair to
 * its definition, which is the facet the attributes and containment relations
 * already name.
 *
 * The rule is deliberately narrow. A definition reused by several usages, a
 * usage with more than one type, or a pair split across two hulls all stay as
 * they are: those are real distinctions, and hiding them would misstate the
 * model. Nothing is deleted — the usage's relations are re-routed onto the
 * definition by the existing hidden-node condensation.
 *
 * Returns each redundant usage mapped to the definition that absorbs it, so
 * callers can carry the usage's own relations over rather than losing them.
 */
export function redundantTypedUsageKeys(
  nodes: readonly ThreadGraphNode[],
  edges: readonly ThreadGraphEdge[],
): ReadonlyMap<string, string> {
  const byKey = new Map(nodes.map((node) => [refKey(node.ref), node]));
  const typedBy = edges.filter((edge) => edge.relation === "typed_by");

  const typesOfUsage = new Map<string, string[]>();
  const usagesOfDefinition = new Map<string, string[]>();
  for (const edge of typedBy) {
    const usage = refKey(edge.from);
    const definition = refKey(edge.to);
    typesOfUsage.set(usage, [...(typesOfUsage.get(usage) ?? []), definition]);
    usagesOfDefinition.set(definition, [
      ...(usagesOfDefinition.get(definition) ?? []),
      usage,
    ]);
  }

  const redundant = new Map<string, string>();
  for (const [usage, definitions] of typesOfUsage) {
    if (definitions.length !== 1) continue;
    const definition = definitions[0]!;
    if ((usagesOfDefinition.get(definition) ?? []).length !== 1) continue;
    const usageNode = byKey.get(usage);
    const definitionNode = byKey.get(definition);
    if (!usageNode || !definitionNode) continue;
    if (usageNode.entityKind !== "part-usage") continue;
    if (definitionNode.entityKind !== "part-definition") continue;
    if ((usageNode.system ?? "") !== (definitionNode.system ?? "")) continue;
    redundant.set(usage, definition);
  }
  return redundant;
}
