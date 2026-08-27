import type { ThreadGraphNode } from "../../presentation/workbench/thread/graph.ts";
import type { LiveThreadGraphPatch } from "../shared/stores/live-thread-update-store.ts";
import type { RecordingMcpToolEvent } from "../recording-mcp-tool-client.ts";

/**
 * Browser-safe, presentation-only milestones for
 * `architecture.seed-syson-model@2`.
 *
 * The project never exposes provider arguments, raw structuredContent or a
 * provider error in the feed. Canonical r2 evidence carries exact normalized
 * identities after the run has completed; while it is in progress this keeps
 * the person oriented without claiming a model contains architecture yet.
 */
export function createSysonModelSeedLiveProjector(
  runId: string,
): (event: RecordingMcpToolEvent) => LiveThreadGraphPatch {
  const nodes = new Map<string, ThreadGraphNode>();

  return (event) => {
    switch (event.toolName) {
      case "syson_project_create":
        setNode(
          nodes,
          projectNode(
            runId,
            event.phase === "started"
              ? "running"
              : event.phase === "completed"
              ? "fresh"
              : "failed",
          ),
        );
        break;
      case "syson_model_create":
        setNode(nodes, projectNode(runId, "fresh"));
        setNode(
          nodes,
          documentNode(
            runId,
            event.phase === "started"
              ? "running"
              : event.phase === "completed"
              ? "fresh"
              : "failed",
          ),
        );
        break;
      case "syson_element_get":
        setNode(nodes, projectNode(runId, "fresh"));
        setNode(nodes, documentNode(runId, "fresh"));
        setNode(
          nodes,
          rootNode(
            runId,
            event.phase === "started"
              ? "running"
              : event.phase === "completed"
              ? "fresh"
              : "failed",
          ),
        );
        break;
      default:
        return { nodes: [], edges: [] };
    }
    return {
      nodes: [...nodes.values()],
      edges: edges(runId, nodes),
    };
  };
}

function setNode(
  nodes: Map<string, ThreadGraphNode>,
  node: ThreadGraphNode,
): void {
  nodes.set(node.id, node);
}

function projectNode(
  runId: string,
  freshness: ThreadGraphNode["freshness"],
): ThreadGraphNode {
  return {
    id: `${runId}:syson-project`,
    ref: { kind: "artifact", id: `${runId}:syson-project` },
    entityKind: "artifact",
    artifactKind: "other",
    activityRole: "milestone",
    label: "SysON project container",
    system: "SysON",
    freshness,
    summary: freshness === "running"
      ? "Creating the empty project container."
      : freshness === "failed"
      ? "Project creation did not complete. The outcome is kept for review; it is not retried automatically."
      : "Empty project container created. It does not yet contain a system architecture.",
  };
}

function documentNode(
  runId: string,
  freshness: ThreadGraphNode["freshness"],
): ThreadGraphNode {
  return {
    id: `${runId}:sysml-document`,
    ref: { kind: "artifact", id: `${runId}:sysml-document` },
    entityKind: "artifact",
    artifactKind: "sysml-model",
    label: "Editable SysML document",
    system: "SysON",
    freshness,
    summary: freshness === "running"
      ? "Creating the document and its empty root package."
      : freshness === "failed"
      ? "The document creation did not complete. No automatic retry is attempted."
      : "Editable SysML document created. No drone architecture, requirement, or verification claim has been added.",
  };
}

function rootNode(
  runId: string,
  freshness: ThreadGraphNode["freshness"],
): ThreadGraphNode {
  return {
    id: `${runId}:root-package`,
    ref: { kind: "artifact", id: `${runId}:root-package` },
    entityKind: "artifact",
    artifactKind: "sysml-model",
    label: "SysML root package",
    system: "SysON",
    freshness,
    summary: freshness === "running"
      ? "Reading back the root package identity."
      : freshness === "failed"
      ? "The root package could not be read back, so no model seed was published."
      : "Root package identity read back from SysON and ready for a later, reviewed architecture step.",
  };
}

function edges(
  runId: string,
  nodes: ReadonlyMap<string, ThreadGraphNode>,
): LiveThreadGraphPatch["edges"] {
  const project = `${runId}:syson-project`;
  const document = `${runId}:sysml-document`;
  const root = `${runId}:root-package`;
  const edges: LiveThreadGraphPatch["edges"] = [];
  if (nodes.has(project) && nodes.has(document)) {
    edges.push({
      id: `${runId}:project-contains-document`,
      from: { kind: "artifact", id: project },
      to: { kind: "artifact", id: document },
      relation: "source_of",
      rationale: "The SysML document belongs to the created SysON project.",
      origin: "structure",
    });
  }
  if (nodes.has(document) && nodes.has(root)) {
    edges.push({
      id: `${runId}:document-contains-root`,
      from: { kind: "artifact", id: document },
      to: { kind: "artifact", id: root },
      relation: "source_of",
      rationale:
        "The root package is the editable top-level container of the document.",
      origin: "structure",
    });
  }
  return edges;
}
