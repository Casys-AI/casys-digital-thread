/**
 * Pure Evidence overlay for recrossed project source files.
 *
 * The overlay is omitted, not emptied, when two records would share a graph
 * identity with distinct content. Missing PartDefinition or AttributeUsage
 * nodes drop only that edge. Multi-part represents is not invented.
 */

import type {
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import {
  sourceFileGraphRefId,
  type ThreadSourceFileRecord,
} from "../../presentation/workbench/thread/source-files.ts";

export function projectTechnicalAdmissionSourceFileGraph(
  graph: ThreadGraph,
  files: readonly ThreadSourceFileRecord[],
): ThreadGraph {
  if (files.length === 0) return graph;

  const partIds = new Set(
    graph.nodes
      .filter((node) => node.entityKind === "part-definition")
      .map((node) => node.ref.id),
  );
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
  const nodeById = new Map<string, ThreadSourceFileRecord>();
  for (const file of files) {
    const admission = admissionById.get(file.admissionArtifactId);
    if (!admission) continue;
    const ref = {
      kind: "source-file" as const,
      id: sourceFileGraphRefId(file.fileId, file.fileRevision),
    };
    const id = graphNodeId(ref);
    const existing = nodeById.get(id);
    if (existing) {
      if (!sameSourceFileRecord(existing, file)) return graph;
      continue;
    }
    nodeById.set(id, file);
    nodes.push({
      id,
      ref,
      entityKind: "source-file",
      label: file.resourceName,
      system: "project-source-workspace",
      freshness: admission.freshness,
      summary: `${file.role} · ${ref.id}`,
      recordedAt: admission.recordedAt,
      selection: { kind: "artifact", id: file.admissionArtifactId },
    });
    edges.push({
      id: `structure:input-to:${ref.id}:${file.admissionArtifactId}`,
      from: ref,
      to: { kind: "artifact", id: file.admissionArtifactId },
      relation: "input_to",
      rationale: `Project source file ${file.fileId} revision ${file.fileRevision} ` +
        `is an exact input to sealed admission ${file.admissionArtifactId}.`,
      origin: "structure",
    });
    const represented = uniqueRepresentedPartDefinition(file);
    if (represented && partIds.has(represented)) {
      edges.push({
        id: `structure:represented-by:${represented}:source-file:${ref.id}`,
        from: { kind: "part-definition", id: represented },
        to: ref,
        relation: "represented_by",
        rationale: `PartDefinition ${represented} is uniquely represented by project ` +
          `source file ${file.fileId} revision ${file.fileRevision}.`,
        origin: "structure",
      });
    }
    for (const binding of file.bindings) {
      if (
        binding.relation !== "parameterizes" ||
        !attributeIds.has(binding.sysmlElementId)
      ) continue;
      edges.push({
        id: `structure:parameterizes:${ref.id}:${binding.sysmlElementId}`,
        from: ref,
        to: { kind: "attribute-usage", id: binding.sysmlElementId },
        relation: "parameterizes",
        rationale: `Project source file ${file.fileId} revision ${file.fileRevision} ` +
          `uniquely parameterizes AttributeUsage ${binding.sysmlElementId}.`,
        origin: "structure",
      });
    }
  }
  if (nodes.length === 0) return graph;

  return {
    nodes: [...graph.nodes, ...nodes],
    edges: [...graph.edges, ...edges].sort((left, right) =>
      left.id.localeCompare(right.id)
    ),
  };
}

function uniqueRepresentedPartDefinition(
  file: ThreadSourceFileRecord,
): string | undefined {
  const represented = [
    ...new Set(
      file.bindings
        .filter((binding) =>
          binding.relation === "represents" &&
          binding.sysmlElementKind === "PartDefinition"
        )
        .map((binding) => binding.sysmlElementId),
    ),
  ];
  return represented.length === 1 ? represented[0] : undefined;
}

function sameSourceFileRecord(
  left: ThreadSourceFileRecord,
  right: ThreadSourceFileRecord,
): boolean {
  return left.fileId === right.fileId &&
    left.fileRevision === right.fileRevision &&
    left.workspaceRevision === right.workspaceRevision &&
    left.workspaceEventFingerprint === right.workspaceEventFingerprint &&
    left.fileFingerprint === right.fileFingerprint &&
    left.resourceFingerprint === right.resourceFingerprint &&
    left.resourceUri === right.resourceUri &&
    left.resourceName === right.resourceName &&
    left.mimeType === right.mimeType &&
    left.moduleId === right.moduleId &&
    left.role === right.role &&
    left.admissionArtifactId === right.admissionArtifactId &&
    left.derivedPath === right.derivedPath &&
    sameBindings(left.bindings, right.bindings);
}

function sameBindings(
  left: ThreadSourceFileRecord["bindings"],
  right: ThreadSourceFileRecord["bindings"],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((binding, index) =>
    binding.relation === right[index]!.relation &&
    binding.sourceSymbolId === right[index]!.sourceSymbolId &&
    binding.sysmlElementId === right[index]!.sysmlElementId &&
    binding.sysmlElementKind === right[index]!.sysmlElementKind
  );
}

function graphNodeId(reference: { kind: string; id: string }): string {
  const kindPrefix = `${reference.kind}:`;
  if (reference.id.startsWith(kindPrefix)) return `graph:${reference.id}`;
  return `graph:${kindPrefix}${reference.id}`;
}
