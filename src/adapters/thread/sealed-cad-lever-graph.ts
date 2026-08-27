/**
 * Pure Evidence overlay for uniquely parameterized CAD levers.
 *
 * The overlay is omitted, not emptied, when a lever cannot name an existing
 * AttributeUsage node or when two levers would share a graph identity.
 * It does not reopen CAS and does not invent a SysML attribute.
 */

import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import type {
  SealedAdmissionCadLever,
  SealedAdmissionUnnamedCadLiteral,
} from "../../domain/compile/admission/sealed-cad-levers.ts";

export function projectSealedCadLeverGraph(
  graph: ThreadGraph,
  levers: readonly SealedAdmissionCadLever[],
): ThreadGraph {
  if (levers.length === 0) return graph;

  const attributeIds = new Set(
    graph.nodes
      .filter((node) => node.entityKind === "attribute-usage")
      .map((node) => node.ref.id),
  );
  const admissionById = new Map(
    graph.nodes
      .filter((node) => node.entityKind === "artifact")
      .map((node) => [node.ref.id, node] as const),
  );

  const nodes: ThreadGraphNode[] = [];
  const edges: ThreadGraphEdge[] = [];
  const nodeIds = new Set<string>();
  for (const lever of levers) {
    if (!attributeIds.has(lever.parameterSysmlElementId)) continue;
    const admission = admissionById.get(lever.admissionArtifactId);
    if (!admission) continue;
    const ref = {
      kind: "cad-lever" as const,
      id: `${lever.admissionArtifactId}:${lever.sourceSymbolId}`,
    };
    const id = graphNodeId(ref);
    if (nodeIds.has(id)) return graph;
    nodeIds.add(id);
    nodes.push({
      id,
      ref,
      entityKind: "cad-lever",
      label: `CAD · ${lever.semanticKey} = ${formatLeverValue(lever.value)}`,
      system: "build123d",
      freshness: admission.freshness,
      summary: "named numeric lever · unit undeclared",
      recordedAt: admission.recordedAt,
      selection: { kind: "artifact", id: lever.admissionArtifactId },
    });
    edges.push({
      id: `structure:parameterizes:${ref.id}:${lever.parameterSysmlElementId}`,
      from: ref,
      to: {
        kind: "attribute-usage",
        id: lever.parameterSysmlElementId,
      },
      relation: "parameterizes",
      rationale:
        `Sealed admission ${lever.admissionArtifactId} uniquely parameterizes ` +
        `AttributeUsage ${lever.parameterSysmlElementId} with CAD lever ` +
        `${lever.semanticKey}.`,
      origin: "structure",
    });
  }
  if (nodes.length === 0) return graph;

  return {
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges, ...edges].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

export function projectSealedUnnamedCadLiteralGraph(
  graph: ThreadGraph,
  literals: readonly SealedAdmissionUnnamedCadLiteral[],
): ThreadGraph {
  if (literals.length === 0) return graph;

  const partIds = new Set(
    graph.nodes
      .filter((node) => node.entityKind === "part-definition")
      .map((node) => node.ref.id),
  );
  const admissionById = new Map(
    graph.nodes
      .filter((node) => node.entityKind === "artifact")
      .map((node) => [node.ref.id, node] as const),
  );

  const nodes: ThreadGraphNode[] = [];
  const edges: ThreadGraphEdge[] = [];
  const nodeIds = new Set<string>();
  for (const literal of literals) {
    if (!partIds.has(literal.representedPartDefinitionId)) continue;
    const admission = admissionById.get(literal.admissionArtifactId);
    if (!admission) continue;
    const ref = {
      kind: "cad-unnamed-literal" as const,
      id:
        `${literal.admissionArtifactId}:${literal.sourceId}:${literal.line}:${literal.column}`,
    };
    const id = graphNodeId(ref);
    if (nodeIds.has(id)) return graph;
    nodeIds.add(id);
    const printed = formatLeverValue(literal.value);
    nodes.push({
      id,
      ref,
      entityKind: "cad-unnamed-literal",
      label: `CAD · unnamed ${printed}`,
      system: "build123d",
      freshness: admission.freshness,
      summary: "constructor literal · no name · unit undeclared",
      recordedAt: admission.recordedAt,
      selection: { kind: "artifact", id: literal.admissionArtifactId },
    });
    edges.push({
      id: `structure:unnamed-in:${ref.id}:${literal.representedPartDefinitionId}`,
      from: ref,
      to: {
        kind: "part-definition",
        id: literal.representedPartDefinitionId,
      },
      relation: "unnamed_in",
      rationale:
        `Constructor literal ${printed} at ${literal.line}:${literal.column} ` +
        `has no name. It participates in the CAD source whose result uniquely ` +
        `represents PartDefinition ${literal.representedPartDefinitionId}.`,
      origin: "structure",
    });
  }
  if (nodes.length === 0) return graph;

  return {
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges, ...edges].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function formatLeverValue(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function graphNodeId(reference: { kind: string; id: string }): string {
  const kindPrefix = `${reference.kind}:`;
  if (reference.id.startsWith(kindPrefix)) return `graph:${reference.id}`;
  return `graph:${kindPrefix}${reference.id}`;
}
