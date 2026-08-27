import { assertEquals } from "@std/assert";
import type {
  ThreadGraph,
  ThreadGraphNode,
} from "../../presentation/workbench/thread/graph.ts";
import type { ThreadSourceFileRecord } from "../../presentation/workbench/thread/source-files.ts";
import { projectTechnicalAdmissionSourceFileGraph } from "./technical-admission-source-file-graph.ts";

const ADMISSION = "technical-compilation-admission-" + "a".repeat(64);
const FILE_ID = "source.cad";
const FILE_REV = 1;
const SOURCE_REF = `${FILE_ID}@${FILE_REV}`;

Deno.test(
  "source-file graph projects represents, parameterizes and input_to from exact records",
  () => {
    const graph = projectTechnicalAdmissionSourceFileGraph(baseGraph(), [
      sourceFile({
        bindings: [
          {
            relation: "represents",
            sourceSymbolId: "artifact.result",
            sysmlElementId: "def-hook",
            sysmlElementKind: "PartDefinition",
          },
          {
            relation: "parameterizes",
            sourceSymbolId: "parameter.thickness",
            sysmlElementId: "attr-thickness",
            sysmlElementKind: "AttributeUsage",
          },
        ],
      }),
    ]);
    const node = graph.nodes.find((item) => item.entityKind === "source-file");
    assertEquals(node?.ref, { kind: "source-file", id: SOURCE_REF });
    assertEquals(node?.label, "hook.py");
    assertEquals(
      edge(graph, "represented_by")?.from,
      { kind: "part-definition", id: "def-hook" },
    );
    assertEquals(
      edge(graph, "represented_by")?.to,
      { kind: "source-file", id: SOURCE_REF },
    );
    assertEquals(
      edge(graph, "parameterizes")?.from,
      { kind: "source-file", id: SOURCE_REF },
    );
    assertEquals(
      edge(graph, "parameterizes")?.to,
      { kind: "attribute-usage", id: "attr-thickness" },
    );
    assertEquals(
      edge(graph, "input_to")?.from,
      { kind: "source-file", id: SOURCE_REF },
    );
    assertEquals(
      edge(graph, "input_to")?.to,
      { kind: "artifact", id: ADMISSION },
    );
  },
);

Deno.test(
  "source-file graph does not invent multi-part represents when exact bindings do not prove unique ownership",
  () => {
    const graph = projectTechnicalAdmissionSourceFileGraph(baseGraph(), [
      sourceFile({
        bindings: [
          {
            relation: "represents",
            sourceSymbolId: "artifact.A",
            sysmlElementId: "def-hook",
            sysmlElementKind: "PartDefinition",
          },
          {
            relation: "represents",
            sourceSymbolId: "artifact.B",
            sysmlElementId: "def-other",
            sysmlElementKind: "PartDefinition",
          },
          {
            relation: "parameterizes",
            sourceSymbolId: "parameter.thickness",
            sysmlElementId: "attr-thickness",
            sysmlElementKind: "AttributeUsage",
          },
        ],
      }),
    ]);
    assertEquals(
      graph.edges.filter((item) => item.relation === "represented_by"),
      [],
    );
    assertEquals(edge(graph, "parameterizes")?.to, {
      kind: "attribute-usage",
      id: "attr-thickness",
    });
    assertEquals(edge(graph, "input_to")?.to, {
      kind: "artifact",
      id: ADMISSION,
    });
  },
);

Deno.test(
  "source-file graph omits a represents edge when the PartDefinition node is absent",
  () => {
    const graph = baseGraph();
    graph.nodes = graph.nodes.filter((node) => node.entityKind !== "part-definition");
    const projected = projectTechnicalAdmissionSourceFileGraph(graph, [
      sourceFile({
        bindings: [{
          relation: "represents",
          sourceSymbolId: "artifact.result",
          sysmlElementId: "def-hook",
          sysmlElementKind: "PartDefinition",
        }],
      }),
    ]);
    assertEquals(
      projected.edges.filter((item) => item.relation === "represented_by"),
      [],
    );
    const node = projected.nodes.find((item) => item.entityKind === "source-file");
    assertEquals(node?.ref.id, SOURCE_REF);
  },
);

Deno.test(
  "source-file graph fails closed when two records would share a node id with distinct identity",
  () => {
    const otherAdmission = "technical-compilation-admission-" + "b".repeat(64);
    const graph = baseGraph();
    graph.nodes.push(node("artifact", otherAdmission, "Other admission"));
    const first = sourceFile();
    const second = sourceFile({
      resourceName: "other.py",
      admissionArtifactId: otherAdmission,
    });
    assertEquals(
      projectTechnicalAdmissionSourceFileGraph(graph, [first, second]),
      graph,
    );
  },
);

function sourceFile(
  overrides: Partial<ThreadSourceFileRecord> = {},
): ThreadSourceFileRecord {
  return {
    fileId: FILE_ID,
    fileRevision: FILE_REV,
    workspaceRevision: 2,
    workspaceEventFingerprint: `sha256:${"e".repeat(64)}`,
    fileFingerprint: `sha256:${"f".repeat(64)}`,
    resourceFingerprint: `sha256:${"c".repeat(64)}`,
    resourceUri: `casys://agent-resource-capture/sha256/${"c".repeat(64)}`,
    resourceName: "hook.py",
    mimeType: "text/x-python",
    moduleId: "mod-mech",
    role: "cad-script",
    admissionArtifactId: ADMISSION,
    bindings: [],
    derivedPath: "/mech/hook.py",
    ...overrides,
  };
}

function edge(graph: ThreadGraph, relation: string) {
  return graph.edges.find((item) => item.relation === relation);
}

function baseGraph(): ThreadGraph {
  return {
    nodes: [
      node("artifact", ADMISSION, "Technical compilation admission"),
      node("part-definition", "def-hook", "WallHook"),
      node("part-definition", "def-other", "Other"),
      node("attribute-usage", "attr-thickness", "WallHook · thickness"),
    ],
    edges: [],
  };
}

function node(
  kind: ThreadGraphNode["entityKind"],
  id: string,
  label: string,
): ThreadGraphNode {
  return {
    id: `graph:${kind}:${id}`,
    ref: { kind, id },
    entityKind: kind,
    label,
    system: kind === "artifact" ? "digital-thread" : "syson",
    freshness: "fresh",
    summary: label,
    recordedAt: "2026-08-19T00:00:00.000Z",
    selection: { kind: "artifact", id: ADMISSION },
  };
}
