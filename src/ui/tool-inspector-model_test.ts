import { assertEquals } from "@std/assert";
import { GENERIC_THREAD_FIXTURE } from "../testing/workbench/generic-thread-workbench-fixture.ts";
import {
  architectureSysmlSealInspectorView,
  architectureSysmlSealSpanLabel,
  graphNodeForSelection,
  resolveSelectedGraphEdge,
  resolveToolFacetInventory,
  resolveToolInspectorContext,
  resolveToolInspectorTarget,
} from "./src/thread/tool-inspector-model.ts";
import type { ThreadGraphNode, ThreadWorkbenchSnapshot } from "./src/thread/types.ts";

Deno.test("graph action keeps its own provider while exposing its richer record", () => {
  const node = graphNode("action", "ACT-INSPECT");

  const context = resolveToolInspectorContext(GENERIC_THREAD_FIXTURE, {
    node,
    record: node.selection,
  });

  assertEquals(context.target, { kind: "action", id: "ACT-INSPECT" });
  assertEquals(context.owner.id, "calculix");
  assertEquals(
    context.actions.some((action) => action.id === "ACT-INSPECT"),
    true,
  );
  assertEquals(
    context.observations.some((item) => item.id === "OBS-STRESS-MAX"),
    true,
  );
});

Deno.test("graph-only consumption derives context from recorded neighbours", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const node: ThreadGraphNode = {
    id: "graph:consumption:consume-step",
    ref: { kind: "consumption", id: "consume-step" },
    entityKind: "consumption",
    label: "CalculiX consumed STEP",
    system: "CalculiX",
    freshness: "fresh",
    summary: "producer and consumer fingerprints match",
  };
  snapshot.graph.nodes.push(node);
  snapshot.graph.edges.push(
    {
      id: "step-to-consumption",
      from: { kind: "artifact", id: "ART-STEP-018" },
      to: node.ref,
      relation: "uses",
      rationale: "The solve consumed this exact STEP artifact.",
      origin: "provenance",
    },
    {
      id: "consumption-to-fea",
      from: node.ref,
      to: { kind: "artifact", id: "ART-FEA-018" },
      relation: "evidences",
      rationale: "The consumption attests the solve result input.",
      origin: "provenance",
    },
  );

  const context = resolveToolInspectorContext(snapshot, { node });
  const routed = resolveToolInspectorTarget(
    snapshot,
    { kind: "node", ref: node.ref },
    { kind: "artifact", id: "ART-CAD-018" },
  );

  assertEquals(context.owner.id, "calculix");
  assertEquals(context.target, node.ref);
  assertEquals(context.artifacts.map((artifact) => artifact.id).sort(), [
    "ART-FEA-018",
    "ART-STEP-018",
  ]);
  assertEquals(routed.node?.ref, node.ref);
  assertEquals(routed.record, undefined);
});

Deno.test("graph node system owns model records without relying on flow aliases", () => {
  const node = graphNode("requirement", "REQ-MECH-014");

  const context = resolveToolInspectorContext(GENERIC_THREAD_FIXTURE, {
    node,
    record: node.selection,
  });

  assertEquals(context.owner.id, "syson");
  assertEquals(context.requirements.map((item) => item.id), ["REQ-MECH-014"]);
});

Deno.test("SysON facet inventory adds graph-only parts without counting artifact aliases twice", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const duplicateModelStage = snapshot.flow.find((stage) =>
    stage.selection.kind === "artifact" &&
    stage.selection.id === "ART-SYSML-018"
  )!;
  snapshot.flow.push({
    ...duplicateModelStage,
    id: "flow-system-duplicate",
    label: "Same system model, second presentation stage",
  });
  snapshot.graph.nodes.push(
    {
      id: "graph:part-definition:def-generic-product",
      ref: { kind: "part-definition", id: "def-generic-product" },
      entityKind: "part-definition",
      label: "GenericAssembly",
      system: "syson",
      freshness: "fresh",
      summary: "PartDefinition · def-generic-product",
      selection: { kind: "artifact", id: "ART-SYSML-018" },
    },
    {
      id: "graph:part-usage:usage-drip-tray",
      ref: { kind: "part-usage", id: "usage-drip-tray" },
      entityKind: "part-usage",
      label: "dripTray",
      system: "syson",
      freshness: "fresh",
      summary: "PartUsage · typed by DripTray",
      selection: { kind: "artifact", id: "ART-SYSML-018" },
    },
    {
      id: "graph:part-usage:usage-drip-tray-alias",
      ref: { kind: "part-usage", id: "usage-drip-tray" },
      entityKind: "part-usage",
      label: "dripTray",
      system: "syson",
      freshness: "fresh",
      summary: "PartUsage · typed by DripTray",
      selection: { kind: "artifact", id: "ART-SYSML-018" },
    },
  );

  const inventory = resolveToolFacetInventory(snapshot, "syson");

  assertEquals(inventory.records, [
    { kind: "artifact", id: "ART-SYSML-018" },
    { kind: "violation", id: "VIO-MECH-014" },
  ]);
  assertEquals(
    inventory.graphOnlyNodes.map((node) => node.ref),
    [
      { kind: "part-definition", id: "def-generic-product" },
      { kind: "part-usage", id: "usage-drip-tray" },
    ],
  );
  assertEquals(inventory.itemCount, 4);
});

Deno.test("a graph-only SysML selection lists the structure and exposes its model artifact once", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const definition: ThreadGraphNode = {
    id: "graph:part-definition:def-generic-product",
    ref: { kind: "part-definition", id: "def-generic-product" },
    entityKind: "part-definition",
    label: "GenericAssembly",
    system: "syson",
    freshness: "fresh",
    summary: "PartDefinition · def-generic-product",
    selection: { kind: "artifact", id: "ART-SYSML-018" },
  };
  const usage: ThreadGraphNode = {
    id: "graph:part-usage:usage-drip-tray",
    ref: { kind: "part-usage", id: "usage-drip-tray" },
    entityKind: "part-usage",
    label: "dripTray",
    system: "syson",
    freshness: "fresh",
    summary: "PartUsage · typed by DripTray",
    selection: { kind: "artifact", id: "ART-SYSML-018" },
  };
  snapshot.graph.nodes.push(definition, usage);
  snapshot.graph.edges.push(
    {
      id: "model-to-definition",
      from: { kind: "artifact", id: "ART-SYSML-018" },
      to: definition.ref,
      relation: "source_of",
      rationale: "The exact model artifact records this definition.",
      origin: "structure",
    },
    {
      id: "definition-to-step",
      from: definition.ref,
      to: { kind: "artifact", id: "ART-STEP-018" },
      relation: "represented_by",
      rationale: "The reviewed catalog maps the definition to this STEP.",
      origin: "structure",
    },
  );

  const context = resolveToolInspectorContext(snapshot, {
    node: definition,
    record: definition.selection,
  });

  assertEquals(context.owner.id, "syson");
  assertEquals(
    context.graphOnlyNodes.map((node) => node.ref),
    [
      { kind: "part-definition", id: "def-generic-product" },
      { kind: "part-usage", id: "usage-drip-tray" },
    ],
  );
  assertEquals(
    context.artifacts.map((artifact) => artifact.id),
    ["ART-SYSML-018", "ART-STEP-018"],
  );
  assertEquals(
    context.artifacts.filter((artifact) => artifact.id === "ART-SYSML-018")
      .length,
    1,
  );
});

Deno.test("edge routing does not leak the previous record into its handoff panel", () => {
  const target = resolveToolInspectorTarget(
    GENERIC_THREAD_FIXTURE,
    { kind: "edge", id: "fixture:input:step:fea" },
    { kind: "artifact", id: "ART-CAD-018" },
  );

  assertEquals(target, {});
});

Deno.test("edge occurrence selection opens the second relation with a duplicate domain id", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const first = {
    id: "duplicate-handoff",
    from: { kind: "artifact" as const, id: "ART-CAD-018" },
    to: { kind: "artifact" as const, id: "ART-STEP-018" },
    relation: "derived_from" as const,
    rationale: "first recorded handoff",
    origin: "provenance" as const,
  };
  const second = {
    ...first,
    to: { kind: "artifact" as const, id: "ART-FEA-018" },
    rationale: "second recorded handoff",
  };
  snapshot.graph.edges.push(first, second);

  const selected = resolveSelectedGraphEdge(snapshot.graph, {
    kind: "edge",
    id: "duplicate-handoff",
    occurrence: { key: "second-rendered-occurrence", edge: second },
  });

  assertEquals(selected, second);
  assertEquals(selected?.rationale, "second recorded handoff");
});

Deno.test("id-only edge selection refuses an ambiguous duplicate relation", () => {
  const snapshot: ThreadWorkbenchSnapshot = structuredClone(
    GENERIC_THREAD_FIXTURE,
  );
  const first = {
    id: "duplicate-handoff",
    from: { kind: "artifact" as const, id: "ART-CAD-018" },
    to: { kind: "artifact" as const, id: "ART-STEP-018" },
    relation: "derived_from" as const,
    rationale: "first recorded handoff",
    origin: "provenance" as const,
  };
  snapshot.graph.edges.push(first, {
    ...first,
    to: { kind: "artifact" as const, id: "ART-FEA-018" },
  });

  assertEquals(
    resolveSelectedGraphEdge(snapshot.graph, {
      kind: "edge",
      id: "duplicate-handoff",
    }),
    undefined,
  );
});

Deno.test(
  "graphNodeForSelection returns undefined without throwing when the ref is absent from the graph",
  () => {
    // Regression: inspector list rows were silently passing `undefined` as the
    // ThreadRef (the 'ref' JSX prop is reserved by React and swallowed before
    // reaching the component). The downstream sameRef() call crashed on
    // undefined.kind. After the fix, a valid ref simply absent from the current
    // graph projection must return undefined without throwing.
    const result = graphNodeForSelection(GENERIC_THREAD_FIXTURE, {
      kind: "artifact",
      id: "ART-NOT-IN-GRAPH",
    });

    assertEquals(result, undefined);
  },
);

Deno.test(
  "graphNodeForSelection returns a node whose selection matches the given ref when it is present",
  () => {
    // REQ-MECH-014 has exactly one graph node whose selection is this ref.
    const ref = { kind: "requirement" as const, id: "REQ-MECH-014" };
    const result = graphNodeForSelection(GENERIC_THREAD_FIXTURE, ref);

    assertEquals(result?.selection, ref);
  },
);

Deno.test(
  "graphNodeForSelection prefers the exact evidence node over SysML aliases sharing its selection",
  () => {
    const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
    const artifactRef = { kind: "artifact" as const, id: "ART-CAD-018" };
    snapshot.graph.nodes.push({
      id: "graph:part-definition:def-bracket",
      ref: { kind: "part-definition", id: "def-bracket" },
      entityKind: "part-definition",
      label: "SupportBracket",
      system: "syson",
      freshness: "fresh",
      summary: "PartDefinition · def-bracket",
      selection: artifactRef,
    }, {
      id: "graph:part-usage:usage-bracket",
      ref: { kind: "part-usage", id: "usage-bracket" },
      entityKind: "part-usage",
      label: "bracket",
      system: "syson",
      freshness: "fresh",
      summary: "PartUsage · typed by SupportBracket",
      selection: artifactRef,
    });

    const result = graphNodeForSelection(snapshot, artifactRef);

    assertEquals(result?.ref, artifactRef);
  },
);

Deno.test(
  "digital-thread inspector shows a sealed architecture SysML document by symbol id",
  () => {
    const digest = "b".repeat(64);
    const artifactId = `architecture-sysml-seal-${digest}`;
    const snapshot: ThreadWorkbenchSnapshot = structuredClone(
      GENERIC_THREAD_FIXTURE,
    );
    const node: ThreadGraphNode = {
      id: `graph:artifact:${artifactId}`,
      ref: { kind: "artifact", id: artifactId },
      entityKind: "artifact",
      artifactKind: "document",
      label: "Agent-authored architecture SysML analysis",
      system: "digital-thread",
      freshness: "fresh",
      summary: `document · ${digest}`,
      selection: { kind: "artifact", id: artifactId },
    };
    snapshot.graph.nodes.push(node);
    snapshot.artifacts.push({
      id: artifactId,
      label: "Agent-authored architecture SysML analysis",
      kind: "document",
      system: "digital-thread",
      revision: digest,
      freshness: "fresh",
      fingerprint: `sha256:${digest}`,
      uri: `casys://architecture-sysml-seal-capture/sha256/${digest}`,
      producedBy: "model.seal-architecture-sysml@1",
      dependsOn: [],
      architectureSysmlSeal: {
        producer: "model.seal-architecture-sysml@1",
        authority: "documentary",
        artifactKind: "document",
        notSyson: true,
        notWriteArchitecture: true,
        notCompilationAdmission: true,
        symbolsStatus: "observed",
        sourceStatus: "observed",
        sourceText: "package DroneV4 {\n  part def Wing {}\n}\n",
        symbols: [
          {
            id: "symbol:package",
            kind: "artifact",
            label: "DroneV4",
            span: {
              start: { line: 1, column: 8 },
              end: { line: 1, column: 15 },
            },
          },
          { id: "symbol:wing-usage", kind: "component", label: "wing" },
          { id: "symbol:wing", kind: "component", label: "Wing" },
        ],
        incidences: [{
          id: "dependency:wing-typed-by",
          kind: "structural-incidence",
          fromSymbolId: "symbol:wing-usage",
          toSymbolId: "symbol:wing",
          span: { start: { line: 2, column: 2 }, end: { line: 2, column: 18 } },
        }],
        unresolvedConstructs: [{
          id: "unresolved:comment",
          kind: "comment",
          message: "A comment is outside the architecture closed subset.",
          span: { start: { line: 4, column: 0 }, end: { line: 4, column: 12 } },
        }],
      },
    });

    const view = architectureSysmlSealInspectorView(snapshot, {
      node,
      record: node.selection,
    });
    const context = resolveToolInspectorContext(snapshot, {
      node,
      record: node.selection,
    });

    assertEquals(context.owner.id, "digital-thread");
    assertEquals(view?.producer, "model.seal-architecture-sysml@1");
    assertEquals(view?.authority, "documentary");
    assertEquals(view?.artifactKind, "document");
    assertEquals(view?.fingerprint, `sha256:${digest}`);
    assertEquals(
      view?.uri,
      `casys://architecture-sysml-seal-capture/sha256/${digest}`,
    );
    assertEquals(view?.notSyson, true);
    assertEquals(view?.notWriteArchitecture, true);
    assertEquals(view?.notCompilationAdmission, true);
    assertEquals(view?.sourceStatus, "observed");
    assertEquals(
      view?.sourceText,
      "package DroneV4 {\n  part def Wing {}\n}\n",
    );
    assertEquals(view?.symbols.map((symbol) => symbol.id), [
      "symbol:package",
      "symbol:wing-usage",
      "symbol:wing",
    ]);
    assertEquals(
      architectureSysmlSealSpanLabel(view?.symbols[0]?.span),
      "1:8–1:15",
    );
    assertEquals(view?.incidences, [{
      id: "dependency:wing-typed-by",
      kind: "structural-incidence",
      fromSymbolId: "symbol:wing-usage",
      toSymbolId: "symbol:wing",
      span: { start: { line: 2, column: 2 }, end: { line: 2, column: 18 } },
    }]);
    assertEquals(
      architectureSysmlSealSpanLabel(view?.incidences[0]?.span),
      "2:2–2:18",
    );
    assertEquals(view?.unresolvedConstructs, [{
      id: "unresolved:comment",
      kind: "comment",
      message: "A comment is outside the architecture closed subset.",
      span: { start: { line: 4, column: 0 }, end: { line: 4, column: 12 } },
    }]);
    assertEquals(
      architectureSysmlSealSpanLabel(view?.unresolvedConstructs[0]?.span),
      "4:0–4:12",
    );
  },
);

Deno.test(
  "architecture SysML inspector drops incidences when symbols are unavailable",
  () => {
    const digest = "c".repeat(64);
    const artifactId = `architecture-sysml-seal-${digest}`;
    const snapshot: ThreadWorkbenchSnapshot = structuredClone(
      GENERIC_THREAD_FIXTURE,
    );
    snapshot.artifacts.push({
      id: artifactId,
      label: "Agent-authored architecture SysML analysis",
      kind: "document",
      system: "digital-thread",
      revision: digest,
      freshness: "fresh",
      fingerprint: `sha256:${digest}`,
      uri: `casys://architecture-sysml-seal-capture/sha256/${digest}`,
      producedBy: "model.seal-architecture-sysml@1",
      dependsOn: [],
      architectureSysmlSeal: {
        producer: "model.seal-architecture-sysml@1",
        authority: "documentary",
        artifactKind: "document",
        notSyson: true,
        notWriteArchitecture: true,
        notCompilationAdmission: true,
        symbolsStatus: "unavailable",
        sourceStatus: "unavailable",
        sourceText: "must-not-surface",
        symbols: [],
        incidences: [{
          id: "dependency:must-not-surface",
          kind: "structural-incidence",
          fromSymbolId: "symbol:from",
          toSymbolId: "symbol:to",
          span: { start: { line: 1, column: 0 }, end: { line: 1, column: 4 } },
        }],
        unresolvedConstructs: [{
          id: "unresolved:comment",
          kind: "comment",
          message: "must-not-invent-from-kind",
          span: { start: { line: 1, column: 0 }, end: { line: 1, column: 8 } },
        }],
      },
    });

    const view = architectureSysmlSealInspectorView(snapshot, {
      record: { kind: "artifact", id: artifactId },
    });
    assertEquals(view?.symbolsStatus, "unavailable");
    assertEquals(view?.sourceStatus, "unavailable");
    assertEquals(view?.sourceText, undefined);
    assertEquals(view?.symbols, []);
    assertEquals(view?.incidences, []);
    assertEquals(view?.unresolvedConstructs, [{
      id: "unresolved:comment",
      kind: "comment",
    }]);
    assertEquals(
      architectureSysmlSealSpanLabel(view?.unresolvedConstructs[0]?.span),
      undefined,
    );
  },
);

Deno.test(
  "admitted Modelica and SPICE plus static CalculiX producers classify artifacts and observations",
  () => {
    const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
    const modelica = appendAdmittedRun(
      snapshot,
      "modelica",
      "simulate.run-admitted-modelica@1",
    );
    const spice = appendAdmittedRun(
      snapshot,
      "spice",
      "simulate.run-admitted-spice@1",
    );
    const calculix = appendAdmittedRun(
      snapshot,
      "calculix",
      "verify.run-fea-static-proof@3",
    );
    snapshot.graph.edges.push(
      {
        id: "fixture:modelica-facet-cross-link",
        from: { kind: "artifact", id: "ART-SYSML-018" },
        to: modelica.artifactRef,
        relation: "derived_from",
        rationale: "The admitted model consumed the reviewed system model.",
        origin: "provenance",
      },
      {
        id: "fixture:spice-facet-cross-link",
        from: { kind: "artifact", id: "ART-SYSML-018" },
        to: spice.artifactRef,
        relation: "derived_from",
        rationale: "The admitted circuit consumed the reviewed system model.",
        origin: "provenance",
      },
      {
        id: "fixture:calculix-facet-cross-link",
        from: { kind: "artifact", id: "ART-SYSML-018" },
        to: calculix.artifactRef,
        relation: "derived_from",
        rationale: "The static proof consumed the reviewed system model.",
        origin: "provenance",
      },
    );
    const modelicaArtifact = resolveToolInspectorContext(snapshot, {
      node: modelica.artifactNode,
      record: modelica.artifactRef,
    });
    const spiceArtifact = resolveToolInspectorContext(snapshot, {
      node: spice.artifactNode,
      record: spice.artifactRef,
    });
    const calculixArtifact = resolveToolInspectorContext(snapshot, {
      node: calculix.artifactNode,
      record: calculix.artifactRef,
    });

    assertEquals(
      resolveToolFacetInventory(snapshot, "modelica").records.filter((record) =>
        record.id === modelica.artifactRef.id ||
        record.id === modelica.observationRef.id
      ),
      [modelica.artifactRef, modelica.observationRef],
    );
    assertEquals(resolveToolFacetInventory(snapshot, "spice").records, [
      spice.artifactRef,
      spice.observationRef,
    ]);
    assertEquals(
      resolveToolFacetInventory(snapshot, "calculix").records.filter((record) =>
        record.id === calculix.artifactRef.id ||
        record.id === calculix.observationRef.id
      ),
      [calculix.artifactRef, calculix.observationRef],
    );
    assertEquals(modelicaArtifact.owner.id, "modelica");
    assertEquals(spiceArtifact.owner.id, "spice");
    assertEquals(calculixArtifact.owner.id, "calculix");
    assertEquals(
      resolveToolInspectorContext(snapshot, {
        node: modelica.observationNode,
        record: modelica.observationRef,
      }).owner.id,
      "modelica",
    );
    assertEquals(
      resolveToolInspectorContext(snapshot, {
        node: spice.observationNode,
        record: spice.observationRef,
      }).owner.id,
      "spice",
    );
    assertEquals(
      resolveToolInspectorContext(snapshot, {
        node: calculix.observationNode,
        record: calculix.observationRef,
      }).owner.id,
      "calculix",
    );
    assertEquals(modelicaArtifact.connection, "connected");
    assertEquals(spiceArtifact.connection, "connected");
    assertEquals(calculixArtifact.connection, "connected");
    assertEquals(modelica.artifact.system, "digital-thread");
    assertEquals(spice.artifactNode.system, "digital-thread");
    assertEquals(calculix.artifact.system, "digital-thread");
    assertEquals(calculix.observationNode.system, "digital-thread");
  },
);

Deno.test(
  "unknown producers stay fail-closed and exact facet refs stay deduplicated",
  () => {
    const snapshot = structuredClone(GENERIC_THREAD_FIXTURE);
    const current = appendAdmittedRun(
      snapshot,
      "spice-current",
      "simulate.run-admitted-spice@1",
    );
    const future = appendAdmittedRun(
      snapshot,
      "spice-future",
      "simulate.run-admitted-spice@2",
    );
    const futureCalculix = appendAdmittedRun(
      snapshot,
      "calculix-future",
      "verify.run-fea-static-proof@4",
    );
    const labelOnly = appendAdmittedRun(
      snapshot,
      "spice-label",
      "spice",
      "SPICE",
    );
    const currentStage = snapshot.flow.find((stage) =>
      stage.selection.kind === "artifact" &&
      stage.selection.id === current.artifactRef.id
    )!;
    snapshot.flow.push({ ...currentStage, id: "flow:spice-current:duplicate" });

    assertEquals(
      resolveToolFacetInventory(snapshot, "spice").records,
      [current.artifactRef, current.observationRef],
    );
    assertEquals(
      resolveToolInspectorContext(snapshot, {
        node: future.artifactNode,
        record: future.artifactRef,
      }).owner.id,
      "digital-thread",
    );
    assertEquals(
      resolveToolFacetInventory(snapshot, "calculix").records.some((record) =>
        record.id === futureCalculix.artifactRef.id ||
        record.id === futureCalculix.observationRef.id
      ),
      false,
    );
    assertEquals(
      resolveToolInspectorContext(snapshot, {
        node: futureCalculix.artifactNode,
        record: futureCalculix.artifactRef,
      }).owner.id,
      "digital-thread",
    );
    assertEquals(
      resolveToolInspectorContext(snapshot, {
        node: labelOnly.artifactNode,
        record: labelOnly.artifactRef,
      }).owner.id,
      "other",
    );
  },
);

Deno.test(
  "architecture SysML inspector stays absent for an ordinary document",
  () => {
    const snapshot: ThreadWorkbenchSnapshot = structuredClone(
      GENERIC_THREAD_FIXTURE,
    );
    const node: ThreadGraphNode = {
      id: "graph:artifact:artifact.brief",
      ref: { kind: "artifact", id: "artifact.brief" },
      entityKind: "artifact",
      artifactKind: "document",
      label: "Brief",
      system: "digital-thread",
      freshness: "fresh",
      summary: "document · brief",
      selection: { kind: "artifact", id: "artifact.brief" },
    };
    snapshot.graph.nodes.push(node);
    snapshot.artifacts.push({
      id: "artifact.brief",
      label: "Brief",
      kind: "document",
      system: "digital-thread",
      revision: "1",
      freshness: "fresh",
      producedBy: "baseline.from-approved-brief@1",
      dependsOn: [],
    });

    assertEquals(
      architectureSysmlSealInspectorView(snapshot, {
        node,
        record: node.selection,
      }),
      undefined,
    );
  },
);

function graphNode(
  kind: ThreadGraphNode["ref"]["kind"],
  id: string,
): ThreadGraphNode {
  const node = GENERIC_THREAD_FIXTURE.graph.nodes.find((candidate) =>
    candidate.ref.kind === kind && candidate.ref.id === id
  );
  if (!node) throw new Error(`fixture graph node ${kind}:${id} not found`);
  return node;
}

function appendAdmittedRun(
  snapshot: ThreadWorkbenchSnapshot,
  slug: string,
  producedBy: string,
  system = "digital-thread",
) {
  const artifactRef = { kind: "artifact" as const, id: `ART-${slug}` };
  const observationRef = { kind: "observation" as const, id: `OBS-${slug}` };
  const artifact = {
    id: artifactRef.id,
    label: artifactRef.id,
    kind: "evidence",
    system,
    revision: "1",
    freshness: "fresh" as const,
    producedBy,
    dependsOn: [],
  };
  const artifactNode: ThreadGraphNode = {
    id: `graph:artifact:${artifactRef.id}`,
    ref: artifactRef,
    entityKind: "artifact",
    label: artifactRef.id,
    system,
    freshness: "fresh",
    summary: artifactRef.id,
    selection: artifactRef,
  };
  const observationNode: ThreadGraphNode = {
    id: `graph:observation:${observationRef.id}`,
    ref: observationRef,
    entityKind: "observation",
    label: observationRef.id,
    system,
    freshness: "fresh",
    summary: observationRef.id,
    selection: observationRef,
  };
  snapshot.artifacts.push(artifact);
  snapshot.observations.push({
    id: observationRef.id,
    label: observationRef.id,
    value: 0,
    unit: "1",
    display: "0 1",
    sourceArtifactId: artifactRef.id,
    requirementIds: [],
    freshness: "fresh",
  });
  snapshot.flow.push(
    {
      id: `flow:artifact:${artifactRef.id}`,
      label: artifactRef.id,
      system,
      freshness: "fresh",
      summary: artifactRef.id,
      selection: artifactRef,
      dependsOn: [],
    },
    {
      id: `flow:observation:${observationRef.id}`,
      label: observationRef.id,
      system,
      freshness: "fresh",
      summary: observationRef.id,
      selection: observationRef,
      dependsOn: [],
    },
  );
  snapshot.graph.nodes.push(artifactNode, observationNode);
  return {
    artifact,
    artifactRef,
    observationRef,
    artifactNode,
    observationNode,
  };
}
