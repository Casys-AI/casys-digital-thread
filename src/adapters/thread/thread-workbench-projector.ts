import type {
  ProposedThreadAction,
  ProvenanceRelation,
  RequirementEvaluation,
  ThreadArtifact as CanonicalArtifact,
  ThreadArtifactConsumption,
  ThreadEntityRef,
  ThreadFreshnessStatus,
  ThreadObservation as CanonicalObservation,
  ThreadOperationRef,
  ThreadProvenanceLink,
  ThreadSnapshot,
  ThreadViolation as CanonicalViolation,
  TracedRequirement,
} from "../../domain/thread/thread-snapshot.ts";
import { archivedRefKeys } from "../../domain/thread/thread-snapshot.ts";
import { ARCHITECTURE_CAPTURE_URI_PREFIX } from "../shared/cas/file-capture-store.ts";
import { REQUIREMENTS_CAPTURE_URI_PREFIX } from "../../domain/thread/requirements-tip.ts";
import { unavailableEngineeringCaseCatalog } from "../../presentation/workbench/thread/evidence.ts";
import { projectEvidenceFamilyGraph } from "./evidence-family-graph.ts";
import type { AnalysisGraph } from "../../domain/thread/analysis-graph.ts";
import { isStudyBaseEvaluation } from "../../domain/sensitivity/base-evaluation/sensitivity-base-evaluation.ts";
import type {
  AssertionScope,
  SemanticRef,
} from "../../domain/thread/engineering-assertion.ts";
import {
  THREAD_WORKBENCH_SCHEMA,
  type ThreadAction,
  type ThreadArtifact,
  type ThreadObservation,
  type ThreadRequirement,
  type ThreadViolation,
  type ThreadWorkbenchSnapshot,
} from "../../presentation/workbench/thread/snapshot.ts";
import type {
  ThreadAnalysisScope,
  ThreadFreshness,
  ThreadGraph,
  ThreadGraphEdge,
  ThreadGraphEdgeAttestation,
  ThreadGraphNode,
  ThreadGraphRef,
  ThreadRef,
} from "../../presentation/workbench/thread/graph.ts";
import type {
  ThreadEvidenceFamilyGraph,
  ThreadFlowStage,
} from "../../presentation/workbench/thread/evidence.ts";

/**
 * Pure presentation projection of a canonical digital-thread snapshot.
 *
 * This adapter intentionally performs no validation, I/O, recomputation, unit
 * conversion, or engineering inference. Callers should validate untrusted
 * input at the canonical domain boundary before projecting it.
 */
export function projectThreadWorkbenchSnapshot(
  snapshot: ThreadSnapshot,
): ThreadWorkbenchSnapshot {
  // A retirement is current-state truth, not merely feed metadata. The
  // immutable source still retains every entity and change for audit, while
  // this read model exposes only the live lineage as current evidence.
  const current = currentThreadView(snapshot);
  const context = projectionContext(current);
  const artifacts = topologicallySortedArtifacts(current.artifacts).map(
    (artifact) => projectArtifact(artifact, context),
  );
  const observations = current.observations.map((observation) =>
    projectObservation(observation, context)
  );
  const requirements = current.requirements.map((requirement) =>
    projectRequirement(requirement, context)
  );
  const violations = current.violations.map((violation) =>
    projectViolation(violation, context)
  );
  const actions = current.proposedActions.map((action) =>
    projectAction(action, context)
  );
  const graph = projectGraph(current, context);
  const evidenceFamilyGraph = projectEvidenceFamilyGraph(graph, {
    snapshotId: snapshot.id,
    revision: snapshot.revision,
  }, {
    architectureCaptureIds: architectureCaptureIds(snapshot),
    requirementsCaptureIds: requirementsCaptureIds(snapshot),
  });

  return {
    schemaVersion: THREAD_WORKBENCH_SCHEMA,
    id: snapshot.id,
    subject: {
      id: snapshot.subject.id,
      label: snapshot.subject.name,
      // The canonical 1.0 contract has no program/portfolio field.
      program: "Program not recorded in canonical snapshot",
    },
    generatedAt: snapshot.generatedAt,
    ...(snapshot.previous
      ? {
        previous: {
          snapshotId: snapshot.previous.snapshotId,
          revision: snapshot.previous.revision,
        },
      }
      : {}),
    source: "observed",
    sourceLabel: "Canonical thread snapshot",
    change: {
      id: snapshot.changeSet.id,
      title: snapshot.changeSet.name,
      summary: latestRevisionChange(snapshot)?.summary ??
        "No change summary recorded for this revision.",
      // Author and touched files are deliberately not inferred from producers or URIs.
      author: "Not recorded in canonical snapshot",
      revision: snapshot.subject.version,
      changedAt: snapshot.changeSet.appliedAt ?? snapshot.changeSet.createdAt,
      status: changeEvaluationStatus(snapshot, context),
      files: [],
    },
    engineeringCases: unavailableEngineeringCaseCatalog(),
    graph,
    evidenceFamilyGraph,
    // `current` excludes retired entities while retaining the immutable
    // changeSet, so the archive event stays visible without reviving its
    // former evidence in the flow. Historical family members stay in the
    // inspector version list, not as sibling flow stages.
    flow: projectFlow(
      current,
      context,
      historicalFamilyArtifactIds(evidenceFamilyGraph),
      currentArtifactIdByHistoricalId(evidenceFamilyGraph),
    ),
    artifacts,
    observations,
    requirements,
    violations,
    actions,
  };
}

function currentThreadView(snapshot: ThreadSnapshot): ThreadSnapshot {
  const archived = archivedRefKeys(snapshot);
  const active = (kind: ThreadEntityRef["kind"], id: string) =>
    !archived.has(`${kind}:${id}`);
  const artifacts = snapshot.artifacts.filter((item) => active("artifact", item.id));
  const observations = snapshot.observations.filter((item) =>
    active("observation", item.id)
  );
  const requirements = snapshot.requirements.filter((item) =>
    active("requirement", item.id)
  );
  const evaluations = snapshot.evaluations.filter((item) =>
    active("evaluation", item.id)
  );
  const violations = snapshot.violations.filter((item) => active("violation", item.id));
  const artifactIds = new Set(artifacts.map((item) => item.id));
  const violationIds = new Set(violations.map((item) => item.id));
  return {
    ...snapshot,
    artifacts,
    consumptions: snapshot.consumptions.filter((item) =>
      artifactIds.has(item.artifactId)
    ),
    observations,
    requirements,
    evaluations,
    violations,
    proposedActions: snapshot.proposedActions.filter((item) =>
      item.addressesViolationIds.every((id) => violationIds.has(id)) &&
      item.targets.every((target) => active(target.kind, target.id))
    ),
    provenance: snapshot.provenance.filter((link) =>
      (link.from.kind === "change" || active(link.from.kind, link.from.id)) &&
      (link.to.kind === "change" || active(link.to.kind, link.to.id))
    ),
  };
}

interface ProjectionContext {
  snapshot: ThreadSnapshot;
  artifacts: Map<string, CanonicalArtifact>;
  observations: Map<string, CanonicalObservation>;
  evaluations: Map<string, RequirementEvaluation[]>;
  violations: Map<string, CanonicalViolation[]>;
  actions: Map<string, ProposedThreadAction[]>;
  consumptionsByProducerRun: Map<string, ThreadArtifactConsumption[]>;
  provenanceByFrom: Map<string, ThreadProvenanceLink[]>;
}

function projectionContext(snapshot: ThreadSnapshot): ProjectionContext {
  const evaluations = groupedBy(
    snapshot.evaluations,
    (evaluation) => evaluation.requirementId,
  );
  const violations = groupedBy(
    snapshot.violations,
    (violation) => violation.requirementId,
  );
  const actions = new Map<string, ProposedThreadAction[]>();
  for (const action of snapshot.proposedActions) {
    for (const violationId of action.addressesViolationIds) {
      append(actions, violationId, action);
    }
  }
  return {
    snapshot,
    artifacts: new Map(
      snapshot.artifacts.map((artifact) => [artifact.id, artifact]),
    ),
    observations: new Map(
      snapshot.observations.map((observation) => [observation.id, observation]),
    ),
    evaluations,
    violations,
    actions,
    consumptionsByProducerRun: groupedBy(
      snapshot.consumptions,
      (consumption) => operationKey(consumption.consumer),
    ),
    provenanceByFrom: groupedBy(
      snapshot.provenance,
      (link) => entityKey(link.from),
    ),
  };
}

function projectArtifact(
  artifact: CanonicalArtifact,
  context: ProjectionContext,
): ThreadArtifact {
  const attestation = artifactAttestation(artifact, context);
  return {
    id: artifact.id,
    label: artifact.name,
    kind: artifact.kind,
    system: artifact.producer.serverId,
    producer: { ...artifact.producer },
    revision: artifact.version,
    freshness: attestation?.status === "mismatch" ? "stale" : artifact.freshness.status,
    fingerprint: fingerprint(artifact.fingerprint),
    uri: artifact.uri,
    producedBy: artifact.producer.tool,
    producerRunId: artifact.producer.runId,
    dependsOn: [...artifact.inputArtifactIds],
    ...(attestation ? { attestation } : {}),
  };
}

function artifactAttestation(
  artifact: CanonicalArtifact,
  context: ProjectionContext,
): ThreadArtifact["attestation"] | undefined {
  const consumptions = context.consumptionsByProducerRun.get(
    operationKey(artifact.producer),
  )?.filter((consumption) =>
    artifact.inputArtifactIds.includes(consumption.artifactId)
  ) ?? [];

  // Workbench 0.1 can display one attestation. Never hide a mismatch behind a
  // verified secondary input; otherwise preserve canonical array order.
  const consumption = consumptions.find((item) => item.status === "mismatch") ??
    consumptions[0];
  if (!consumption) return undefined;
  const source = context.artifacts.get(consumption.artifactId);
  if (!source) return undefined;

  return {
    status: consumption.status,
    sourceArtifactId: source.id,
    producerFingerprint: fingerprint(source.fingerprint),
    consumedFingerprint: fingerprint(consumption.observedFingerprint),
    checkedAt: consumption.verifiedAt,
  };
}

function projectObservation(
  observation: CanonicalObservation,
  context: ProjectionContext,
): ThreadObservation {
  const sourceArtifactId = observation.source.artifactIds[0] ?? "";
  const freshness = aggregateFreshness([
    observation.freshness.status,
    ...observation.source.artifactIds.flatMap((artifactId) => {
      const artifact = context.artifacts.get(artifactId);
      return artifact ? [effectiveArtifactFreshness(artifact, context)] : [];
    }),
  ]);
  const requirementIds = context.snapshot.evaluations
    .filter((evaluation) => evaluation.observationIds.includes(observation.id))
    .map((evaluation) => evaluation.requirementId)
    .filter(unique);

  return {
    id: observation.id,
    label: observation.name,
    value: observation.quantity.value,
    unit: observation.quantity.unit,
    display: displayQuantity(
      observation.quantity.value,
      observation.quantity.unit,
    ),
    sourceArtifactId,
    requirementIds,
    freshness,
    measuredAt: observation.source.capturedAt,
  };
}

function projectRequirement(
  requirement: TracedRequirement,
  context: ProjectionContext,
): ThreadRequirement {
  const evaluation = latestEvaluation(
    context.evaluations.get(requirement.id) ?? [],
  );
  const violations = context.violations.get(requirement.id) ?? [];
  const authority = context.artifacts.get(requirement.trace.sourceArtifactId);
  return {
    id: requirement.id,
    label: requirement.name,
    source: authority
      ? `${authority.producer.serverId} · ${requirement.trace.elementId}`
      : requirement.trace.elementId,
    sourceElementId: requirement.trace.elementId,
    expression: criterionExpression(requirement),
    status: projectedEvaluationStatus(evaluation, context),
    observationIds: evaluation ? [...evaluation.observationIds] : [],
    // Violations are copied only from the canonical collection.
    violationIds: violations.map((violation) => violation.id),
    rationale: evaluation?.message ?? "No canonical evaluation recorded.",
  };
}

function projectViolation(
  violation: CanonicalViolation,
  context: ProjectionContext,
): ThreadViolation {
  const evaluation = context.snapshot.evaluations.find((item) =>
    item.id === violation.evaluationId
  );
  const observationId = evaluation?.comparison?.observationId ??
    violation.observationIds[0] ?? evaluation?.observationIds[0] ?? "";
  return {
    id: violation.id,
    name: violation.name,
    severity: violation.severity === "error" || violation.severity === "critical"
      ? "blocking"
      : "warning",
    // Workbench 0.1 has no accepted state; accepted remains non-resolved.
    status: violation.status === "resolved" ? "resolved" : "open",
    requirementId: violation.requirementId,
    observationId,
    message: violation.summary,
    margin: evaluation?.comparison?.margin
      ? displayQuantity(
        evaluation.comparison.margin.value,
        evaluation.comparison.margin.unit,
      )
      : "",
    evidence: [...violation.evidenceArtifactIds],
    proposedActionIds: (context.actions.get(violation.id) ?? []).map((action) =>
      action.id
    ),
  };
}

function projectAction(
  action: ProposedThreadAction,
  context: ProjectionContext,
): ThreadAction {
  const target = action.targets[0];
  const blocked = action.readiness === "blocked" && action.blockedReason
    ? ` Blocked: ${action.blockedReason}`
    : "";
  return {
    id: action.id,
    label: action.name,
    description: `${action.rationale}${blocked}`,
    kind: actionKind(action),
    targetId: target?.id ?? "",
    system: target
      ? targetSystem(target, context)
      : action.operation?.id ?? "Unassigned",
    readiness: action.readiness,
    // The canonical action is a proposal, never authorization to execute it.
    requiresConfirmation: action.kind !== "inspect",
  };
}

function projectGraph(
  snapshot: ThreadSnapshot,
  context: ProjectionContext,
): ThreadGraph {
  const analysis = projectAnalysisGraph(
    snapshot.analysisGraph,
    snapshot.freshness.status,
    new Set(snapshot.artifacts.map((artifact) => artifact.id)),
  );
  const nodes: ThreadGraphNode[] = [
    ...snapshot.changeSet.changes.map((change): ThreadGraphNode => ({
      id: graphNodeId({ kind: "change", id: change.id }),
      ref: { kind: "change", id: change.id },
      entityKind: "change",
      label: change.summary,
      system: "digital-thread",
      freshness: snapshot.freshness.status,
      summary: change.kind,
      recordedAt: snapshot.changeSet.appliedAt ?? snapshot.changeSet.createdAt,
      selection: { kind: "change", id: snapshot.changeSet.id },
    })),
    ...topologicallySortedArtifacts(snapshot.artifacts).map(
      (artifact): ThreadGraphNode => ({
        id: graphNodeId({ kind: "artifact", id: artifact.id }),
        ref: { kind: "artifact", id: artifact.id },
        entityKind: "artifact",
        artifactKind: artifact.kind,
        label: artifact.name,
        system: artifact.producer.serverId,
        freshness: effectiveArtifactFreshness(artifact, context),
        summary: `${artifact.kind} · ${artifact.version}`,
        recordedAt: artifact.freshness.changedAt,
        selection: { kind: "artifact", id: artifact.id },
      }),
    ),
    ...snapshot.consumptions.map((consumption): ThreadGraphNode => {
      const source = context.artifacts.get(consumption.artifactId);
      return {
        id: graphNodeId({ kind: "consumption", id: consumption.id }),
        ref: { kind: "consumption", id: consumption.id },
        entityKind: "consumption",
        label: `Input attestation · ${source?.name ?? consumption.artifactId}`,
        system: consumption.consumer.serverId,
        freshness: aggregateFreshness([
          consumption.status === "mismatch" ? "stale" : "fresh",
          ...(source ? [effectiveArtifactFreshness(source, context)] : []),
        ]),
        summary: consumption.status,
        recordedAt: consumption.verifiedAt,
        ...(source ? { selection: { kind: "artifact", id: source.id } as const } : {}),
      };
    }),
    ...snapshot.observations.map((observation): ThreadGraphNode => {
      const projected = projectObservation(observation, context);
      return {
        id: graphNodeId({ kind: "observation", id: observation.id }),
        ref: { kind: "observation", id: observation.id },
        entityKind: "observation",
        label: observation.name,
        system: observation.source.operation.serverId,
        freshness: projected.freshness,
        summary: projected.display,
        recordedAt: observation.source.capturedAt,
        selection: { kind: "observation", id: observation.id },
      };
    }),
    ...snapshot.requirements.map((requirement): ThreadGraphNode => {
      const projected = projectRequirement(requirement, context);
      return {
        id: graphNodeId({ kind: "requirement", id: requirement.id }),
        ref: { kind: "requirement", id: requirement.id },
        entityKind: "requirement",
        label: requirement.name,
        system: context.artifacts.get(requirement.trace.sourceArtifactId)?.producer
          .serverId ?? "Unassigned",
        freshness: requirementGraphFreshness(requirement, context),
        summary: `${projected.expression} · ${projected.status}`,
        recordedAt: requirement.freshness.changedAt,
        selection: { kind: "requirement", id: requirement.id },
      };
    }),
    ...snapshot.evaluations.map((evaluation): ThreadGraphNode => ({
      id: graphNodeId({ kind: "evaluation", id: evaluation.id }),
      ref: { kind: "evaluation", id: evaluation.id },
      entityKind: "evaluation",
      label: evaluation.name,
      system: evaluation.evaluator.serverId,
      freshness: evaluation.freshness.status,
      summary: evaluation.status,
      recordedAt: evaluation.evaluatedAt,
      selection: { kind: "requirement", id: evaluation.requirementId },
      ...(isStudyBaseEvaluation(evaluation)
        ? { evaluationFamily: "study-base" as const }
        : {}),
    })),
    ...snapshot.violations.map((violation): ThreadGraphNode => {
      const evaluation = snapshot.evaluations.find((item) =>
        item.id === violation.evaluationId
      );
      return {
        id: graphNodeId({ kind: "violation", id: violation.id }),
        ref: { kind: "violation", id: violation.id },
        entityKind: "violation",
        label: violation.name,
        system: evaluation?.evaluator.serverId ?? "Unassigned",
        freshness: violation.freshness.status,
        summary: `${violation.severity} · ${violation.status}`,
        recordedAt: violation.detectedAt,
        selection: { kind: "violation", id: violation.id },
      };
    }),
    ...snapshot.proposedActions.map((action): ThreadGraphNode => ({
      id: graphNodeId({ kind: "action", id: action.id }),
      ref: { kind: "action", id: action.id },
      entityKind: "action",
      label: action.name,
      system: action.targets[0]
        ? targetSystem(action.targets[0], context)
        : action.operation?.id ?? "Unassigned",
      freshness: snapshot.freshness.status,
      summary: `${action.kind} · ${action.readiness}`,
      ...(graphActionSelection(action)
        ? { selection: graphActionSelection(action) }
        : {}),
    })),
    ...analysis.nodes,
  ];
  const nodeKeys = new Set(nodes.map((node) => entityKey(node.ref)));

  return {
    nodes,
    edges: [
      ...snapshot.provenance.flatMap((link) => {
        const edge = projectProvenanceGraphEdge(link, context, nodeKeys);
        return edge ? [edge] : [];
      }),
      ...projectStructuralGraphEdges(snapshot, context),
      ...analysis.edges,
    ],
  };
}

/**
 * Project canonical assertions as a distinct semantic subgraph. Provenance and
 * structural relations keep their existing vocabularies and invariants.
 */
function projectAnalysisGraph(
  graph: AnalysisGraph | undefined,
  freshness: ThreadFreshnessStatus,
  currentArtifactIds: ReadonlySet<string>,
): ThreadGraph {
  if (!graph) return { nodes: [], edges: [] };
  const relations = graph.relations.filter((relation) =>
    relation.assertion.evidence.every((evidence) => currentArtifactIds.has(evidence.id))
  );
  const referencedNodeIds = new Set(
    relations.flatMap((relation) => [relation.fromNodeId, relation.toNodeId]),
  );
  return {
    nodes: graph.nodes.filter((node) => referencedNodeIds.has(node.id)).map(
      (node): ThreadGraphNode => ({
        id: graphNodeId({ kind: "analysis-node", id: node.id }),
        ref: { kind: "analysis-node", id: node.id },
        entityKind: "analysis-node",
        label: node.semanticRef.id,
        system: node.semanticRef.domain,
        freshness,
        summary: `${node.kind} · ${node.semanticRef.domain}`,
        analysis: { semanticRef: projectSemanticRef(node.semanticRef) },
      }),
    ),
    edges: relations.map((relation): ThreadGraphEdge => {
      const assertion = relation.assertion;
      return {
        id: assertion.id,
        from: { kind: "analysis-node", id: relation.fromNodeId },
        to: { kind: "analysis-node", id: relation.toNodeId },
        relation: assertion.relation,
        rationale: assertion.rationale,
        origin: "analysis",
        analysis: {
          assertionId: assertion.id,
          epistemicBasis: assertion.epistemicBasis,
          assertedBy: { ...assertion.assertedBy },
          evidence: assertion.evidence.map((item) => ({
            id: item.id,
            fingerprint: item.fingerprint.digest,
          })),
          scope: projectAnalysisScope(assertion.scope),
          ...(assertion.measurement
            ? { measurement: structuredClone(assertion.measurement) }
            : {}),
        },
      };
    }),
  };
}

function projectSemanticRef(reference: SemanticRef) {
  return {
    domain: reference.domain,
    kind: reference.kind,
    id: reference.id,
    ...(reference.basisFingerprint
      ? { basisFingerprint: reference.basisFingerprint.digest }
      : {}),
  };
}

function projectAnalysisScope(scope: AssertionScope): ThreadAnalysisScope {
  switch (scope.kind) {
    case "basis":
      return {
        kind: scope.kind,
        basisFingerprint: scope.basisFingerprint.digest,
      };
    case "source-span":
      return {
        kind: scope.kind,
        source: projectSemanticRef(scope.source),
        basisFingerprint: scope.basisFingerprint.digest,
        start: { ...scope.start },
        end: { ...scope.end },
      };
    case "scenario":
      return {
        kind: scope.kind,
        scenario: projectSemanticRef(scope.scenario),
        basisFingerprint: scope.basisFingerprint.digest,
      };
    case "local-neighborhood":
      return {
        kind: scope.kind,
        parameter: projectSemanticRef(scope.parameter),
        basisFingerprint: scope.basisFingerprint.digest,
        lower: { ...scope.lower },
        upper: { ...scope.upper },
      };
  }
}

function projectProvenanceGraphEdge(
  link: ThreadProvenanceLink,
  context: ProjectionContext,
  nodeKeys: Set<string>,
): ThreadGraphEdge | undefined {
  if (
    !nodeKeys.has(entityKey(link.from)) || !nodeKeys.has(entityKey(link.to))
  ) {
    return undefined;
  }
  const direction = GRAPH_PROVENANCE_DIRECTION[link.relation];
  const from = copyGraphRef(direction === "forward" ? link.from : link.to);
  const to = copyGraphRef(direction === "forward" ? link.to : link.from);
  return {
    id: link.id,
    from,
    to,
    relation: link.relation,
    rationale: link.rationale,
    origin: "provenance",
    ...graphEdgeAttestation(from, to, context),
  };
}

function projectStructuralGraphEdges(
  snapshot: ThreadSnapshot,
  context: ProjectionContext,
): ThreadGraphEdge[] {
  const artifactEdges = topologicallySortedArtifacts(snapshot.artifacts)
    .flatMap(
      (artifact) =>
        artifact.inputArtifactIds.flatMap((inputId) => {
          const input = context.artifacts.get(inputId);
          if (!input) return [];
          const from = { kind: "artifact", id: input.id } as const;
          const to = { kind: "artifact", id: artifact.id } as const;
          return [
            {
              id: `structure:input:${input.id}:${artifact.id}`,
              from,
              to,
              relation: "input_to",
              rationale:
                `${input.name} is an explicit input artifact of ${artifact.name}.`,
              origin: "structure",
              ...graphEdgeAttestation(from, to, context),
            } satisfies ThreadGraphEdge,
          ];
        }),
    );
  const observationEdges = snapshot.observations.flatMap((observation) =>
    observation.source.artifactIds.flatMap((artifactId) => {
      const source = context.artifacts.get(artifactId);
      if (!source) return [];
      return [
        {
          id: `structure:source:${source.id}:${observation.id}`,
          from: { kind: "artifact", id: source.id },
          to: { kind: "observation", id: observation.id },
          relation: "source_of",
          rationale:
            `${source.name} is an explicit source artifact of ${observation.name}.`,
          origin: "structure",
        } satisfies ThreadGraphEdge,
      ];
    })
  );
  const provenanceTracePairs = new Set(
    snapshot.provenance.flatMap((link) => {
      if (link.relation !== "traces_to") return [];
      const direction = GRAPH_PROVENANCE_DIRECTION[link.relation];
      const from = direction === "forward" ? link.from : link.to;
      const to = direction === "forward" ? link.to : link.from;
      return [`${entityKey(from)}->${entityKey(to)}`];
    }),
  );
  const requirementEdges = snapshot.requirements.flatMap((requirement) => {
    const source = context.artifacts.get(requirement.trace.sourceArtifactId);
    if (!source) return [];
    const from = { kind: "artifact", id: source.id } as const;
    const to = { kind: "requirement", id: requirement.id } as const;
    if (provenanceTracePairs.has(`${entityKey(from)}->${entityKey(to)}`)) {
      return [];
    }
    return [
      {
        id: `structure:requirement-source:${source.id}:${requirement.id}`,
        from,
        to,
        relation: "traces_to",
        rationale:
          `${source.name} is the explicit source artifact of ${requirement.name}.`,
        origin: "structure",
      } satisfies ThreadGraphEdge,
    ];
  });
  return [...artifactEdges, ...observationEdges, ...requirementEdges];
}

function graphEdgeAttestation(
  from: ThreadGraphRef,
  to: ThreadGraphRef,
  context: ProjectionContext,
): { attestation?: ThreadGraphEdgeAttestation } {
  if (from.kind !== "artifact" || to.kind !== "artifact") return {};
  const source = context.artifacts.get(from.id);
  const consumerResult = context.artifacts.get(to.id);
  if (!source || !consumerResult?.inputArtifactIds.includes(source.id)) {
    return {};
  }
  const consumption = context.consumptionsByProducerRun.get(
    operationKey(consumerResult.producer),
  )?.find((item) => item.artifactId === source.id);
  if (!consumption) return {};
  return {
    attestation: {
      consumptionId: consumption.id,
      status: consumption.status,
      producerFingerprint: fingerprint(source.fingerprint),
      consumedFingerprint: fingerprint(consumption.observedFingerprint),
      checkedAt: consumption.verifiedAt,
    },
  };
}

function copyGraphRef(reference: ThreadEntityRef): ThreadGraphRef {
  return { kind: reference.kind, id: reference.id };
}

function graphNodeId(reference: ThreadGraphRef): string {
  const kindPrefix = `${reference.kind}:`;
  if (reference.id.startsWith(kindPrefix)) {
    return `graph:${reference.id}`;
  }
  return `graph:${kindPrefix}${reference.id}`;
}

function graphActionSelection(
  action: ProposedThreadAction,
): ThreadRef | undefined {
  const target = action.targets.find(isInspectableGraphRef);
  if (target) return copyInspectableRef(target);
  const violationId = action.addressesViolationIds[0];
  return violationId ? { kind: "violation", id: violationId } : undefined;
}

function isInspectableGraphRef(reference: ThreadEntityRef): boolean {
  return reference.kind === "artifact" || reference.kind === "observation" ||
    reference.kind === "requirement" || reference.kind === "violation";
}

function copyInspectableRef(reference: ThreadEntityRef): ThreadRef | undefined {
  switch (reference.kind) {
    case "artifact":
    case "observation":
    case "requirement":
    case "violation":
      return { kind: reference.kind, id: reference.id };
    case "action":
    case "change":
    case "consumption":
    case "evaluation":
      return undefined;
  }
}

function requirementGraphFreshness(
  requirement: TracedRequirement,
  context: ProjectionContext,
): ThreadFreshness {
  const evaluation = latestEvaluation(
    context.evaluations.get(requirement.id) ?? [],
  );
  return aggregateFreshness([
    requirement.freshness.status,
    ...(evaluation
      ? [
        evaluation.freshness.status,
        ...evaluation.observationIds.flatMap((id) => {
          const observation = context.observations.get(id);
          return observation
            ? [projectObservation(observation, context).freshness]
            : [];
        }),
      ]
      : []),
  ]);
}

const GRAPH_PROVENANCE_DIRECTION: Record<
  ProvenanceRelation,
  "forward" | "reverse"
> = {
  changes: "forward",
  derived_from: "reverse",
  traces_to: "reverse",
  uses: "reverse",
  evaluates: "reverse",
  evidences: "reverse",
  caused_by: "reverse",
  addresses: "reverse",
  supersedes: "reverse",
};

function projectFlow(
  snapshot: ThreadSnapshot,
  context: ProjectionContext,
  historicalArtifactIds: ReadonlySet<string> = new Set(),
  currentIdByHistoricalId: ReadonlyMap<string, string> = new Map(),
): ThreadFlowStage[] {
  const stages: ThreadFlowStage[] = [{
    id: `flow:${snapshot.changeSet.id}`,
    label: "Change",
    system: "digital-thread",
    freshness: snapshot.freshness.status,
    summary: latestRevisionChange(snapshot)?.summary ??
      "No change summary recorded for this revision.",
    selection: { kind: "change", id: snapshot.changeSet.id },
    dependsOn: [],
  }];

  for (const artifact of topologicallySortedArtifacts(snapshot.artifacts)) {
    if (historicalArtifactIds.has(artifact.id)) continue;
    stages.push({
      id: `flow:artifact:${artifact.id}`,
      label: artifact.name,
      system: artifact.producer.serverId,
      freshness: effectiveArtifactFreshness(artifact, context),
      summary: `${artifact.kind} · ${artifact.version}`,
      selection: { kind: "artifact", id: artifact.id },
      dependsOn: artifact.inputArtifactIds
        .map((inputId) => currentIdByHistoricalId.get(inputId) ?? inputId)
        .filter((inputId) =>
          inputId !== artifact.id &&
          context.artifacts.has(inputId) &&
          !historicalArtifactIds.has(inputId)
        )
        .map((inputId) => flowStageId({ kind: "artifact", id: inputId }))
        .filter(isDefined)
        .filter(unique),
    });
  }
  for (const observation of snapshot.observations) {
    const projected = projectObservation(observation, context);
    stages.push({
      id: `flow:observation:${observation.id}`,
      label: observation.name,
      system: observation.source.operation.serverId,
      freshness: projected.freshness,
      summary: projected.display,
      selection: { kind: "observation", id: observation.id },
      dependsOn: observation.source.artifactIds
        .map((artifactId) => currentIdByHistoricalId.get(artifactId) ?? artifactId)
        .filter((artifactId) =>
          context.artifacts.has(artifactId) &&
          !historicalArtifactIds.has(artifactId)
        )
        .map((artifactId) => flowStageId({ kind: "artifact", id: artifactId }))
        .filter(isDefined)
        .filter(unique),
    });
  }
  for (const requirement of snapshot.requirements) {
    const evaluation = latestEvaluation(
      context.evaluations.get(requirement.id) ?? [],
    );
    const projected = projectRequirement(requirement, context);
    stages.push({
      id: `flow:requirement:${requirement.id}`,
      label: requirement.name,
      system: evaluation?.evaluator.serverId ??
        context.artifacts.get(requirement.trace.sourceArtifactId)?.producer
          .serverId ??
        "Unassigned",
      freshness: aggregateFreshness([
        requirement.freshness.status,
        ...(evaluation
          ? [
            evaluation.freshness.status,
            ...evaluation.observationIds.flatMap((id) => {
              const observation = context.observations.get(id);
              return observation
                ? [projectObservation(observation, context).freshness]
                : [];
            }),
          ]
          : []),
      ]),
      summary: projected.status,
      selection: { kind: "requirement", id: requirement.id },
      dependsOn: linkedFlowDependencies(
        { kind: "requirement", id: requirement.id },
        ["traces_to"],
        context,
        currentIdByHistoricalId,
      ),
    });
  }
  for (const evaluation of snapshot.evaluations) {
    stages.push({
      id: `flow:evaluation:${evaluation.id}`,
      label: evaluation.name,
      system: evaluation.evaluator.serverId,
      freshness: evaluation.freshness.status,
      summary: evaluation.status,
      // Workbench 0.1 has no standalone evaluation inspector. Its linked
      // requirement remains the truthful selectable owner of this stage.
      selection: { kind: "requirement", id: evaluation.requirementId },
      dependsOn: linkedFlowDependencies(
        { kind: "evaluation", id: evaluation.id },
        ["evaluates", "uses", "evidences"],
        context,
        currentIdByHistoricalId,
      ),
    });
  }
  for (const violation of snapshot.violations) {
    const evaluation = snapshot.evaluations.find((item) =>
      item.id === violation.evaluationId
    );
    stages.push({
      id: `flow:violation:${violation.id}`,
      label: violation.name,
      system: evaluation?.evaluator.serverId ?? "Unassigned",
      freshness: violation.freshness.status,
      summary: violation.status,
      selection: { kind: "violation", id: violation.id },
      dependsOn: linkedFlowDependencies(
        { kind: "violation", id: violation.id },
        ["caused_by", "evidences"],
        context,
        currentIdByHistoricalId,
      ),
    });
  }
  return stages;
}

function latestRevisionChange(snapshot: ThreadSnapshot) {
  return snapshot.changeSet.changes.at(-1);
}

/**
 * A flow dependency is emitted only when the canonical snapshot has a direct
 * provenance link and both endpoints have an actual Workbench flow stage.
 * This deliberately does not infer a requirement verdict from array joins.
 */
function linkedFlowDependencies(
  from: ThreadEntityRef,
  relations: ThreadProvenanceLink["relation"][],
  context: ProjectionContext,
  currentIdByHistoricalId: ReadonlyMap<string, string> = new Map(),
): string[] {
  return (context.provenanceByFrom.get(entityKey(from)) ?? [])
    .filter((link) => relations.includes(link.relation))
    .map((link) =>
      flowStageId(
        link.to.kind === "artifact"
          ? {
            kind: "artifact",
            id: currentIdByHistoricalId.get(link.to.id) ?? link.to.id,
          }
          : link.to,
      )
    )
    .filter(isDefined)
    .filter(unique);
}

function flowStageId(reference: ThreadEntityRef): string | undefined {
  switch (reference.kind) {
    case "artifact":
    case "observation":
    case "requirement":
    case "evaluation":
    case "violation":
      return `flow:${reference.kind}:${reference.id}`;
    case "action":
    case "change":
    case "consumption":
      return undefined;
  }
}

function entityKey(reference: ThreadGraphRef): string {
  return `${reference.kind}\u0000${reference.id}`;
}

function isDefined<T>(value: T | undefined): value is T {
  return value !== undefined;
}

function projectedEvaluationStatus(
  evaluation: RequirementEvaluation | undefined,
  context: ProjectionContext,
): ThreadRequirement["status"] {
  if (!evaluation || evaluation.freshness.status !== "fresh") {
    return "unresolved";
  }
  const evidenceIsCurrent = evaluation.observationIds.every((id) => {
    const observation = context.observations.get(id);
    return observation &&
      projectObservation(observation, context).freshness === "fresh";
  });
  if (!evidenceIsCurrent) return "unresolved";
  return evaluation.status === "pass" || evaluation.status === "fail"
    ? evaluation.status
    : "unresolved";
}

function changeEvaluationStatus(
  snapshot: ThreadSnapshot,
  context: ProjectionContext,
): ThreadWorkbenchSnapshot["change"]["status"] {
  if (snapshot.evaluations.length === 0) return "pending";
  const evaluatedRequirements = snapshot.requirements.filter((requirement) => {
    const evaluation = latestEvaluation(
      context.evaluations.get(requirement.id) ?? [],
    );
    return projectedEvaluationStatus(evaluation, context) !== "unresolved";
  }).length;
  return evaluatedRequirements === snapshot.requirements.length
    ? "evaluated"
    : "partially_evaluated";
}

function latestEvaluation(
  evaluations: RequirementEvaluation[],
): RequirementEvaluation | undefined {
  return [...evaluations].sort((left, right) =>
    right.evaluatedAt.localeCompare(left.evaluatedAt) ||
    right.id.localeCompare(left.id)
  )[0];
}

function effectiveArtifactFreshness(
  artifact: CanonicalArtifact,
  context: ProjectionContext,
): ThreadFreshness {
  return artifactAttestation(artifact, context)?.status === "mismatch"
    ? "stale"
    : artifact.freshness.status;
}

function targetSystem(
  target: ThreadEntityRef,
  context: ProjectionContext,
): string {
  if (target.kind === "artifact") {
    return context.artifacts.get(target.id)?.producer.serverId ?? "Unassigned";
  }
  if (target.kind === "observation") {
    return context.observations.get(target.id)?.source.operation.serverId ??
      "Unassigned";
  }
  if (target.kind === "requirement") {
    const requirement = context.snapshot.requirements.find((item) =>
      item.id === target.id
    );
    return requirement
      ? context.artifacts.get(requirement.trace.sourceArtifactId)?.producer
        .serverId ??
        "Unassigned"
      : "Unassigned";
  }
  if (target.kind === "violation") {
    const violation = context.snapshot.violations.find((item) => item.id === target.id);
    const evaluation = violation &&
      context.snapshot.evaluations.find((item) => item.id === violation.evaluationId);
    return evaluation?.evaluator.serverId ?? "Unassigned";
  }
  return "digital-thread";
}

function actionKind(action: ProposedThreadAction): ThreadAction["kind"] {
  if (action.kind === "recompute" || action.kind === "inspect") {
    return action.kind;
  }
  // Workbench 0.1 groups corrective, review and synchronization proposals under
  // its non-executing "change" preparation affordance.
  return "change";
}

function criterionExpression(requirement: TracedRequirement): string {
  return `${requirement.criterion.metric} ${requirement.criterion.operator} ${
    displayQuantity(
      requirement.criterion.limit.value,
      requirement.criterion.limit.unit,
    )
  }`;
}

function displayQuantity(value: number, unit: string): string {
  const display = Number(value.toPrecision(7)).toString();
  return unit === "1" ? display : `${display} ${unit}`;
}

function aggregateFreshness(statuses: ThreadFreshness[]): ThreadFreshness {
  if (statuses.includes("failed")) return "failed";
  if (statuses.includes("running")) return "running";
  if (statuses.includes("stale")) return "stale";
  return "fresh";
}

function fingerprint(value: { algorithm: "sha256"; digest: string }): string {
  return `${value.algorithm}:${value.digest}`;
}

function operationKey(operation: ThreadOperationRef): string {
  return `${operation.serverId}\u0000${operation.tool}\u0000${operation.runId}`;
}

function topologicallySortedArtifacts(
  artifacts: readonly CanonicalArtifact[],
): CanonicalArtifact[] {
  const byId = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  const visited = new Set<string>();
  const visiting = new Set<string>();
  const result: CanonicalArtifact[] = [];

  const visit = (artifact: CanonicalArtifact) => {
    if (visited.has(artifact.id)) return;
    // Canonical validation rejects cycles; this guard keeps the pure projector
    // total if it is accidentally called before validation.
    if (visiting.has(artifact.id)) return;
    visiting.add(artifact.id);
    for (const dependencyId of artifact.inputArtifactIds) {
      const dependency = byId.get(dependencyId);
      if (dependency) visit(dependency);
    }
    visiting.delete(artifact.id);
    visited.add(artifact.id);
    result.push(artifact);
  };

  for (const artifact of artifacts) visit(artifact);
  return result;
}

function architectureCaptureIds(snapshot: ThreadSnapshot): ReadonlySet<string> {
  return new Set(
    snapshot.artifacts
      .filter((artifact) => artifact.uri?.startsWith(ARCHITECTURE_CAPTURE_URI_PREFIX))
      .map((artifact) => artifact.id),
  );
}

function requirementsCaptureIds(snapshot: ThreadSnapshot): ReadonlySet<string> {
  return new Set(
    snapshot.artifacts
      .filter((artifact) => artifact.uri?.startsWith(REQUIREMENTS_CAPTURE_URI_PREFIX))
      .map((artifact) => artifact.id),
  );
}

function historicalFamilyArtifactIds(
  familyGraph: ThreadEvidenceFamilyGraph,
): ReadonlySet<string> {
  return new Set(currentArtifactIdByHistoricalId(familyGraph).keys());
}

function currentArtifactIdByHistoricalId(
  familyGraph: ThreadEvidenceFamilyGraph,
): ReadonlyMap<string, string> {
  const currentByHistorical = new Map<string, string>();
  for (const family of familyGraph.families) {
    if (
      family.entityKind !== "artifact" || family.status !== "current" ||
      family.currentRefs.length !== 1 ||
      family.currentRefs[0]?.kind !== "artifact"
    ) continue;
    const currentId = family.currentRefs[0].id;
    for (const reference of family.historicalRefs) {
      if (reference.kind === "artifact") {
        currentByHistorical.set(reference.id, currentId);
      }
    }
  }
  return currentByHistorical;
}

function groupedBy<T>(
  items: readonly T[],
  key: (item: T) => string,
): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) append(result, key(item), item);
  return result;
}

function append<T>(map: Map<string, T[]>, key: string, item: T): void {
  const values = map.get(key);
  if (values) values.push(item);
  else map.set(key, [item]);
}

function unique(value: string, index: number, values: string[]): boolean {
  return values.indexOf(value) === index;
}

// Compile-time check that domain freshness remains representable in Workbench 0.1.
const _freshnessCoverage: Record<ThreadFreshnessStatus, ThreadFreshness> = {
  fresh: "fresh",
  stale: "stale",
  running: "running",
  failed: "failed",
};
void _freshnessCoverage;
