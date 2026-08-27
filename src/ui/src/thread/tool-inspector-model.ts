import { isArchitectureSysmlSealArtifactId } from "./feed-model.ts";
import type {
  ThreadAction,
  ThreadArchitectureSysmlSealIncidence,
  ThreadArchitectureSysmlSealPresentation,
  ThreadArchitectureSysmlSealSymbol,
  ThreadArchitectureSysmlSealUnresolved,
  ThreadArtifact,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadObservation,
  ThreadRef,
  ThreadRequirement,
  ThreadViolation,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

export const ARCHITECTURE_SYSML_SEAL_PRODUCER =
  "model.seal-architecture-sysml@1" as const;
export const ADMITTED_MODELICA_PRODUCER =
  "simulate.run-admitted-modelica@1" as const;
export const ADMITTED_SPICE_PRODUCER = "simulate.run-admitted-spice@1" as const;
export const FEA_STATIC_PROOF_PRODUCER =
  "verify.run-fea-static-proof@3" as const;

export type WorkbenchToolId =
  | "syson"
  | "build123d"
  | "calculix"
  | "modelica"
  | "spice"
  | "erpnext"
  | "digital-thread"
  | "other";

const ENGINEERING_FACET_BY_PRODUCER: Readonly<
  Record<string, WorkbenchToolId>
> = {
  [ADMITTED_MODELICA_PRODUCER]: "modelica",
  [ADMITTED_SPICE_PRODUCER]: "spice",
  [FEA_STATIC_PROOF_PRODUCER]: "calculix",
};

export interface WorkbenchToolIdentity {
  id: WorkbenchToolId;
  label: string;
  role: string;
  fullViewLabel?: string;
}

export interface ToolInspectorTarget {
  /** Exact graph entity selected in the primary Workbench surface. */
  node?: ThreadGraphNode;
  /** Optional richer browser record for the same entity. */
  record?: ThreadRef;
}

export type ToolInspectorGraphSelection =
  | { kind: "node"; ref: ThreadGraphRef }
  | {
    kind: "edge";
    id: string;
    occurrence?: { readonly key: string; readonly edge: ThreadGraphEdge };
  };

export interface InspectorContext {
  owner: WorkbenchToolIdentity;
  target?: ThreadGraphRef | ThreadRef;
  /** Exact read-model entities which exist only in the graph projection. */
  graphOnlyNodes: ThreadGraphNode[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
  connection: "thread" | "connected" | "independent";
}

export interface ToolFacetInventory {
  /** Canonical records exposed by the flow, deduplicated by exact reference. */
  records: ThreadRef[];
  /** Structural read-model entities which have no canonical ThreadRef. */
  graphOnlyNodes: ThreadGraphNode[];
  itemCount: number;
}

export const TOOL_FACETS: readonly WorkbenchToolIdentity[] = [
  {
    id: "syson",
    label: "SysON",
    role: "System model, requirements and model-owned verdicts",
    fullViewLabel: "Open system model",
  },
  {
    id: "build123d",
    label: "build123d",
    role: "Parametric geometry, measurements and CAD exports",
    fullViewLabel: "Open geometry view",
  },
  {
    id: "calculix",
    label: "CalculiX",
    role: "Structural solve, mesh evidence and field results",
    fullViewLabel: "Open structural view",
  },
  {
    id: "modelica",
    label: "Modelica",
    role: "Dynamic multiphysics scenarios and time-series evidence",
    fullViewLabel: "Open simulation view",
  },
  {
    id: "spice",
    label: "SPICE",
    role: "Circuit simulation and operating-point evidence",
  },
  {
    id: "erpnext",
    label: "ERPNext",
    role: "Item, BOM and inventory context",
    fullViewLabel: "Open enterprise view",
  },
] as const;

export const THREAD_OWNER: WorkbenchToolIdentity = {
  id: "digital-thread",
  label: "Digital thread",
  role: "Change propagation and linked evidence across the engineering subject",
};

/**
 * Builds the drawer inventory for one provider facet.
 *
 * Canonical records come from the flow because it already owns the reviewed
 * provider attribution. PartDefinition and PartUsage are added from the graph
 * because they deliberately have no canonical ThreadRef. Their optional
 * `selection` aliases are not counted as extra artifacts: the flow record and
 * the graph-only entity remain two distinct engineering items, while a shared
 * artifact is counted only once. Facet membership uses the semantic resolver,
 * so admitted Modelica, SPICE, and static FEA producers are not inferred from
 * `system`.
 */
export function resolveToolFacetInventory(
  snapshot: ThreadWorkbenchSnapshot,
  provider: WorkbenchToolId,
): ToolFacetInventory {
  const recordsByRef = new Map<string, ThreadRef>();
  for (const stage of snapshot.flow) {
    if (
      resolveToolFacet(snapshot, stage.selection, stage.system) !== provider
    ) continue;
    const key = graphRefKey(stage.selection);
    if (!recordsByRef.has(key)) recordsByRef.set(key, stage.selection);
  }

  const graphOnlyByRef = new Map<string, ThreadGraphNode>();
  for (const node of snapshot.graph.nodes) {
    if (
      resolveToolFacet(snapshot, node.ref, node.system) !== provider ||
      (node.ref.kind !== "part-definition" &&
        node.ref.kind !== "part-usage" &&
        node.ref.kind !== "attribute-usage" &&
        node.ref.kind !== "cad-lever" &&
        node.ref.kind !== "cad-unnamed-literal")
    ) continue;
    const key = graphRefKey(node.ref);
    if (!graphOnlyByRef.has(key)) graphOnlyByRef.set(key, node);
  }
  const graphOnlyNodes = [...graphOnlyByRef.values()].sort(
    compareGraphOnlyNodes,
  );
  const records = [...recordsByRef.values()];

  return {
    records,
    graphOnlyNodes,
    itemCount: records.length + graphOnlyNodes.length,
  };
}

/** Prevents a graph-only selection from inheriting an unrelated old record. */
export function resolveToolInspectorTarget(
  snapshot: ThreadWorkbenchSnapshot,
  graphSelection: ToolInspectorGraphSelection | undefined,
  fallbackRecord: ThreadRef | undefined,
): ToolInspectorTarget {
  if (graphSelection?.kind === "node") {
    const node = snapshot.graph.nodes.find((candidate) =>
      sameGraphRef(candidate.ref, graphSelection.ref)
    );
    return { node, record: node?.selection };
  }
  if (graphSelection?.kind === "edge") return {};
  return { record: fallbackRecord };
}

/**
 * Resolves the exact selected relation for the drawer. Renderers that support
 * parallel edges carry the occurrence itself; legacy callers fall back to the
 * historic id lookup for compatibility.
 */
export function resolveSelectedGraphEdge(
  graph: ThreadGraph,
  selection: ToolInspectorGraphSelection | undefined,
): ThreadGraphEdge | undefined {
  if (selection?.kind !== "edge") return undefined;
  if (selection.occurrence?.edge) return selection.occurrence.edge;
  const matches = graph.edges.filter((edge) => edge.id === selection.id);
  // An id-only legacy selection is safe only when it names exactly one
  // recorded relation. Guessing the first duplicate opens the wrong handoff.
  return matches.length === 1 ? matches[0] : undefined;
}

/**
 * Resolves one graph selection to its owning tool and already-loaded evidence.
 *
 * Graph-only entities such as consumptions, evaluations and actions are kept as
 * first-class targets. Their direct recorded neighbours provide context; no
 * browser-side tool call or inferred causal link is introduced.
 */
export function resolveToolInspectorContext(
  snapshot: ThreadWorkbenchSnapshot,
  target: ToolInspectorTarget,
): InspectorContext {
  const owner = ownerForTarget(snapshot, target);
  const artifactIds = new Set<string>();
  const observationIds = new Set<string>();
  const requirementIds = new Set<string>();
  const violationIds = new Set<string>();
  const actionIds = new Set<string>();
  const targetRef = target.node?.ref ?? target.record;

  if (targetRef) addRef(targetRef);
  // Graph-only SysML entities retain a richer canonical artifact selection.
  // Add it through the same sets as every other record so a shared model
  // artifact is exposed once even when many parts point to it.
  if (target.node?.selection) addRef(target.node.selection);
  if (target.node) {
    for (const edge of snapshot.graph.edges) {
      if (sameGraphRef(edge.from, target.node.ref)) addRef(edge.to);
      if (sameGraphRef(edge.to, target.node.ref)) addRef(edge.from);
    }
  }

  if (targetRef?.kind === "change") {
    snapshot.artifacts.forEach((item) => artifactIds.add(item.id));
    snapshot.observations.forEach((item) => observationIds.add(item.id));
    snapshot.requirements.forEach((item) => requirementIds.add(item.id));
    snapshot.violations.forEach((item) => violationIds.add(item.id));
  }

  for (const action of snapshot.actions) {
    if (!actionIds.has(action.id)) continue;
    addRecordId(snapshot, action.targetId);
  }
  for (const violation of snapshot.violations) {
    if (!violationIds.has(violation.id)) continue;
    requirementIds.add(violation.requirementId);
    if (violation.observationId) observationIds.add(violation.observationId);
    violation.evidence.forEach((id) => artifactIds.add(id));
    violation.proposedActionIds.forEach((id) => actionIds.add(id));
  }
  for (const requirement of snapshot.requirements) {
    if (!requirementIds.has(requirement.id)) continue;
    requirement.observationIds.forEach((id) => observationIds.add(id));
    requirement.violationIds.forEach((id) => violationIds.add(id));
  }
  for (const observation of snapshot.observations) {
    if (!observationIds.has(observation.id)) continue;
    if (observation.sourceArtifactId) {
      artifactIds.add(observation.sourceArtifactId);
    }
    observation.requirementIds.forEach((id) => requirementIds.add(id));
  }

  const selectedArtifactId = targetRef?.kind === "artifact"
    ? targetRef.id
    : undefined;
  const selectedArtifact = snapshot.artifacts.find((item) =>
    item.id === selectedArtifactId
  );
  if (selectedArtifact) {
    selectedArtifact.dependsOn.forEach((id) => artifactIds.add(id));
    snapshot.artifacts
      .filter((item) => item.dependsOn.includes(selectedArtifact.id))
      .forEach((item) => artifactIds.add(item.id));
  }

  for (const observation of snapshot.observations) {
    if (artifactIds.has(observation.sourceArtifactId)) {
      observationIds.add(observation.id);
    }
  }
  for (const requirement of snapshot.requirements) {
    if (requirement.observationIds.some((id) => observationIds.has(id))) {
      requirementIds.add(requirement.id);
    }
  }
  for (const violation of snapshot.violations) {
    if (
      requirementIds.has(violation.requirementId) ||
      observationIds.has(violation.observationId)
    ) {
      violationIds.add(violation.id);
      violation.proposedActionIds.forEach((id) => actionIds.add(id));
    }
  }

  const artifacts = snapshot.artifacts.filter((item) =>
    artifactIds.has(item.id)
  );
  const observations = snapshot.observations.filter((item) =>
    observationIds.has(item.id)
  );
  const requirements = snapshot.requirements.filter((item) =>
    requirementIds.has(item.id)
  );
  const violations = snapshot.violations.filter((item) =>
    violationIds.has(item.id)
  );
  const relatedIds = new Set([
    ...(targetRef ? [targetRef.id] : []),
    ...artifacts.map((item) => item.id),
    ...observations.map((item) => item.id),
    ...requirements.map((item) => item.id),
    ...violations.map((item) => item.id),
  ]);
  const proposedActionIds = new Set([
    ...actionIds,
    ...violations.flatMap((violation) => violation.proposedActionIds),
  ]);
  const actions = snapshot.actions.filter((action) =>
    proposedActionIds.has(action.id) || relatedIds.has(action.targetId)
  );

  return {
    owner,
    target: targetRef,
    graphOnlyNodes:
      resolveToolFacetInventory(snapshot, owner.id).graphOnlyNodes,
    artifacts,
    observations,
    requirements,
    violations,
    actions,
    connection: owner.id === "digital-thread"
      ? "thread"
      : providerIsCrossLinked(snapshot, owner.id)
      ? "connected"
      : "independent",
  };

  function addRef(ref: ThreadGraphRef | ThreadRef): void {
    switch (ref.kind) {
      case "artifact":
        artifactIds.add(ref.id);
        break;
      case "observation":
        observationIds.add(ref.id);
        break;
      case "requirement":
        requirementIds.add(ref.id);
        break;
      case "violation":
        violationIds.add(ref.id);
        break;
      case "action":
        actionIds.add(ref.id);
        break;
      case "change":
      case "consumption":
      case "evaluation":
      case "part-definition":
      case "part-usage":
      case "attribute-usage":
      case "cad-lever":
      case "cad-unnamed-literal":
        break;
    }
  }

  function addRecordId(
    current: ThreadWorkbenchSnapshot,
    id: string,
  ): void {
    if (current.artifacts.some((item) => item.id === id)) artifactIds.add(id);
    if (current.observations.some((item) => item.id === id)) {
      observationIds.add(id);
    }
    if (current.requirements.some((item) => item.id === id)) {
      requirementIds.add(id);
    }
    if (current.violations.some((item) => item.id === id)) {
      violationIds.add(id);
    }
  }
}

/**
 * Returns the last graph node whose recorded selection matches the given
 * ThreadRef, or undefined when no node in the current graph represents it.
 *
 * This is the resolution path for inspector list clicks: records listed
 * in the inspector panels (artifacts, observations, requirements, violations)
 * may not have a corresponding node in the current graph projection — they
 * can be historical, folded, or from a different surface. When the ref is
 * absent the caller is expected to treat the result as a no-op on the graph
 * focus, leaving only the record selection updated.
 */
export function graphNodeForSelection(
  snapshot: ThreadWorkbenchSnapshot,
  selection: ThreadRef,
): ThreadGraphNode | undefined {
  const exact = snapshot.graph.nodes.find((node) =>
    node.ref.kind === selection.kind && node.ref.id === selection.id
  );
  if (exact) return exact;
  return snapshot.graph.nodes.findLast(
    (node) => node.selection && sameRef(node.selection, selection),
  );
}

export interface ArchitectureSysmlSealInspectorView {
  readonly producer: typeof ARCHITECTURE_SYSML_SEAL_PRODUCER;
  readonly fingerprint?: string;
  readonly uri?: string;
  readonly artifactKind: "document";
  readonly authority: "documentary";
  readonly notSyson: true;
  readonly notWriteArchitecture: true;
  readonly notCompilationAdmission: true;
  readonly symbolsStatus:
    ThreadArchitectureSysmlSealPresentation["symbolsStatus"];
  readonly sourceStatus:
    ThreadArchitectureSysmlSealPresentation["sourceStatus"];
  readonly sourceText?: string;
  readonly symbols: readonly ThreadArchitectureSysmlSealSymbol[];
  readonly incidences: readonly ThreadArchitectureSysmlSealIncidence[];
  readonly unresolvedConstructs:
    readonly ThreadArchitectureSysmlSealUnresolved[];
}

/**
 * Digital-thread inspector for one sealed architecture SysML Thread document.
 *
 * Symbol rows bind on `id`. Labels stay display-only. This never promotes the
 * artifact to `sysml-model` or invents SysON part nodes.
 */
export function architectureSysmlSealInspectorView(
  snapshot: ThreadWorkbenchSnapshot,
  target: ToolInspectorTarget,
): ArchitectureSysmlSealInspectorView | undefined {
  const artifactId = target.node?.ref.kind === "artifact"
    ? target.node.ref.id
    : target.record?.kind === "artifact"
    ? target.record.id
    : undefined;
  if (!artifactId || !isArchitectureSysmlSealArtifactId(artifactId)) {
    return undefined;
  }
  const artifact = snapshot.artifacts.find((item) => item.id === artifactId);
  if (
    !artifact || artifact.kind !== "document" ||
    artifact.producedBy !== ARCHITECTURE_SYSML_SEAL_PRODUCER
  ) {
    return undefined;
  }
  const payload = artifact.architectureSysmlSeal;
  const sourceStatus = payload?.sourceStatus ?? "unavailable";
  const sourceObserved = sourceStatus === "observed";
  return {
    producer: ARCHITECTURE_SYSML_SEAL_PRODUCER,
    fingerprint: artifact.fingerprint,
    uri: artifact.uri,
    artifactKind: "document",
    authority: "documentary",
    notSyson: true,
    notWriteArchitecture: true,
    notCompilationAdmission: true,
    symbolsStatus: payload?.symbolsStatus ?? "unavailable",
    sourceStatus,
    sourceText: sourceObserved && typeof payload?.sourceText === "string"
      ? payload.sourceText
      : undefined,
    symbols: (payload?.symbols ?? []).map((symbol) =>
      documentarySymbol(symbol, sourceObserved)
    ),
    incidences: payload?.symbolsStatus === "unavailable"
      ? []
      : (payload?.incidences ?? []).map((incidence) =>
        documentaryIncidence(incidence, sourceObserved)
      ),
    unresolvedConstructs: (payload?.unresolvedConstructs ?? []).map((
      construct,
    ) => documentaryUnresolved(construct, sourceObserved)),
  };
}

/** Line/col label for a copied documentary span. Absent when reopen failed. */
export function architectureSysmlSealSpanLabel(
  span: ThreadArchitectureSysmlSealSymbol["span"],
): string | undefined {
  if (span === undefined) return undefined;
  return `${span.start.line}:${span.start.column}–${span.end.line}:${span.end.column}`;
}

function documentarySymbol(
  symbol: ThreadArchitectureSysmlSealSymbol,
  sourceObserved: boolean,
): ThreadArchitectureSysmlSealSymbol {
  return {
    id: symbol.id,
    kind: symbol.kind,
    ...(symbol.label === undefined ? {} : { label: symbol.label }),
    ...(sourceObserved && symbol.span ? { span: symbol.span } : {}),
  };
}

function documentaryIncidence(
  incidence: ThreadArchitectureSysmlSealIncidence,
  sourceObserved: boolean,
): ThreadArchitectureSysmlSealIncidence {
  return {
    id: incidence.id,
    kind: "structural-incidence",
    fromSymbolId: incidence.fromSymbolId,
    toSymbolId: incidence.toSymbolId,
    ...(sourceObserved && incidence.span ? { span: incidence.span } : {}),
  };
}

function documentaryUnresolved(
  construct: ThreadArchitectureSysmlSealUnresolved,
  sourceObserved: boolean,
): ThreadArchitectureSysmlSealUnresolved {
  return {
    id: construct.id,
    kind: construct.kind,
    ...(sourceObserved && construct.message
      ? { message: construct.message }
      : {}),
    ...(sourceObserved && construct.span ? { span: construct.span } : {}),
  };
}

export function toolIdentity(system: string): WorkbenchToolIdentity {
  const id = toolId(system);
  if (id === "digital-thread") return THREAD_OWNER;
  const known = TOOL_FACETS.find((tool) => tool.id === id);
  return known ?? {
    id: "other",
    label: system,
    role: "Additional evidence provider",
  };
}

export function toolId(system: string): WorkbenchToolId {
  const normalized = system.toLowerCase();
  if (normalized.includes("syson")) return "syson";
  if (normalized.includes("build123d")) return "build123d";
  if (normalized.includes("calculix")) return "calculix";
  if (normalized.includes("modelica")) return "modelica";
  if (normalized.includes("erpnext")) return "erpnext";
  if (normalized.includes("digital-thread")) return "digital-thread";
  return "other";
}

/**
 * Presentation-only facet for one graph or flow ref.
 *
 * Artifact refs read `producedBy`. Observation refs follow `sourceArtifactId`
 * to that artifact. Only exact registered engineering producers become
 * semantic facets; any other version or label falls back to `toolId`.
 * The recorded `system` field is never rewritten.
 */
function resolveToolFacet(
  snapshot: ThreadWorkbenchSnapshot,
  ref: ThreadGraphRef | ThreadRef | undefined,
  fallbackSystem: string,
): WorkbenchToolId {
  const producedBy = producedByForRef(snapshot, ref);
  if (producedBy) {
    const facet = ENGINEERING_FACET_BY_PRODUCER[producedBy];
    if (facet) return facet;
  }
  return toolId(fallbackSystem);
}

function producedByForRef(
  snapshot: ThreadWorkbenchSnapshot,
  ref: ThreadGraphRef | ThreadRef | undefined,
): string | undefined {
  if (ref?.kind === "artifact") {
    return snapshot.artifacts.find((item) => item.id === ref.id)?.producedBy;
  }
  if (ref?.kind === "observation") {
    const observation = snapshot.observations.find((item) =>
      item.id === ref.id
    );
    return snapshot.artifacts.find((item) =>
      item.id === observation?.sourceArtifactId
    )
      ?.producedBy;
  }
  return undefined;
}

function ownerFromResolvedFacet(
  snapshot: ThreadWorkbenchSnapshot,
  ref: ThreadGraphRef | ThreadRef | undefined,
  fallbackSystem: string,
): WorkbenchToolIdentity {
  const facet = resolveToolFacet(snapshot, ref, fallbackSystem);
  const known = TOOL_FACETS.find((tool) => tool.id === facet);
  return known ?? toolIdentity(fallbackSystem);
}

function ownerForTarget(
  snapshot: ThreadWorkbenchSnapshot,
  target: ToolInspectorTarget,
): WorkbenchToolIdentity {
  if (target.node) {
    return ownerFromResolvedFacet(
      snapshot,
      target.node.ref,
      target.node.system,
    );
  }
  const selection = target.record;
  if (!selection || selection.kind === "change") return THREAD_OWNER;
  const graphNode = snapshot.graph.nodes.find((node) =>
    node.selection && sameRef(node.selection, selection)
  );
  if (graphNode) {
    return ownerFromResolvedFacet(snapshot, selection, graphNode.system);
  }
  const stage = snapshot.flow.find((item) =>
    sameRef(item.selection, selection)
  );
  if (stage) {
    return ownerFromResolvedFacet(snapshot, selection, stage.system);
  }
  if (selection.kind === "artifact") {
    const artifact = snapshot.artifacts.find((item) =>
      item.id === selection.id
    );
    if (artifact) {
      return ownerFromResolvedFacet(snapshot, selection, artifact.system);
    }
  }
  if (selection.kind === "observation") {
    const observation = snapshot.observations.find((item) =>
      item.id === selection.id
    );
    const artifact = snapshot.artifacts.find((item) =>
      item.id === observation?.sourceArtifactId
    );
    if (artifact) {
      return ownerFromResolvedFacet(snapshot, selection, artifact.system);
    }
  }
  return toolIdentity("other");
}

function providerIsCrossLinked(
  snapshot: ThreadWorkbenchSnapshot,
  provider: WorkbenchToolId,
): boolean {
  const nodes = new Map(
    snapshot.graph.nodes.map((node) => [graphRefKey(node.ref), node] as const),
  );
  return snapshot.graph.edges.some((edge) => {
    const source = nodes.get(graphRefKey(edge.from));
    const target = nodes.get(graphRefKey(edge.to));
    if (!source || !target) return false;
    const sourceProvider = resolveToolFacet(
      snapshot,
      source.ref,
      source.system,
    );
    const targetProvider = resolveToolFacet(
      snapshot,
      target.ref,
      target.system,
    );
    return sourceProvider !== targetProvider &&
      (sourceProvider === provider || targetProvider === provider);
  });
}

function sameRef(left: ThreadRef, right: ThreadRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function sameGraphRef(left: ThreadGraphRef, right: ThreadGraphRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function graphRefKey(ref: ThreadGraphRef): string {
  return `${ref.kind}:${ref.id}`;
}

function compareGraphOnlyNodes(
  left: ThreadGraphNode,
  right: ThreadGraphNode,
): number {
  const kindOrder = left.ref.kind.localeCompare(right.ref.kind);
  if (kindOrder !== 0) return kindOrder;
  const labelOrder = left.label.localeCompare(right.label);
  return labelOrder !== 0
    ? labelOrder
    : left.ref.id.localeCompare(right.ref.id);
}
