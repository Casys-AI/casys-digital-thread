import type {
  EngineeringCase,
  ThreadArtifact,
  ThreadGraphEdge,
  ThreadGraphNode,
  ThreadObservation,
  ThreadRequirement,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";
import type {
  ThreadAnalysisQuantity,
  ThreadAnalysisSemanticRef,
} from "../../../presentation/workbench/thread/graph.ts";

export interface OverviewSensitivityJourney {
  readonly id: string;
  /** Existing observation -> evaluation cable identity in the Overview hero. */
  readonly routeEdgeKey: string;
  readonly usesEdgeId: string;
  readonly analysisEdgeId: string;
  readonly case: {
    readonly key: string;
    readonly id: string;
    readonly revision: number;
    readonly artifactId: string;
  };
  readonly parameter: {
    readonly id: string;
    readonly label: string;
    readonly lower: ThreadAnalysisQuantity;
    readonly upper: ThreadAnalysisQuantity;
  };
  readonly responseLabel: string;
  readonly measurement: {
    readonly method: "forward-finite-difference";
    readonly basePoint: ThreadAnalysisQuantity;
    readonly perturbationStep: ThreadAnalysisQuantity;
    readonly responseAtBase: ThreadAnalysisQuantity;
    readonly responseAtPerturbed: ThreadAnalysisQuantity;
    readonly derivative: ThreadAnalysisQuantity;
  };
  readonly observation: Pick<
    ThreadObservation,
    "id" | "label" | "display" | "measuredAt"
  >;
  readonly requirement: Pick<
    ThreadRequirement,
    "id" | "label" | "expression"
  >;
  readonly evaluation: {
    readonly id: string;
    readonly label: string;
    readonly verdict: "pass" | "fail" | "unresolved";
    readonly artifactId: string;
  };
  readonly evidence: {
    readonly studyArtifactId: string;
    readonly studyArtifactLabel: string;
    readonly studyFingerprint: string;
    readonly evaluationArtifactId: string;
  };
}

/**
 * Presentation-only attachment of a measured study to one current mechanical
 * FEA verdict. The two evaluations remain distinct records: this join exists
 * only when the exact current cases share the same requirement identity.
 */
export interface OverviewSensitivityVerdictBinding {
  readonly journeyId: string;
  readonly verdictNodeKey: string;
  readonly verdictEvaluationId: string;
  readonly requirementId: string;
  readonly mechanicalCaseKey: string;
}

/**
 * Project complete measured sensitivity journeys from exact recorded facts.
 *
 * This is a read-only join. Any missing or ambiguous case, measurement,
 * observation, requirement, evaluation, or provenance cable omits that
 * journey rather than inventing a "sensitivity" node or a viewer capability.
 */
export function buildOverviewSensitivityJourneys(
  thread: ThreadWorkbenchSnapshot,
): readonly OverviewSensitivityJourney[] {
  const candidates = thread.graph.edges
    .filter((edge) =>
      edge.origin === "analysis" &&
      edge.relation === "measured-local-sensitivity" &&
      edge.analysis?.epistemicBasis === "observed" &&
      edge.analysis.scope.kind === "local-neighborhood" &&
      edge.analysis.measurement?.method === "forward-finite-difference"
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .flatMap((edge) => {
      const journey = projectSensitivityJourney(thread, edge);
      return journey ? [journey] : [];
    });
  const routeCounts = countBy(
    candidates.map((journey) => journey.routeEdgeKey),
  );
  return candidates.filter((journey) =>
    routeCounts.get(journey.routeEdgeKey) === 1
  );
}

/**
 * Find the current mechanical verdict whose exact requirement is also
 * evaluated by each sensitivity journey.
 *
 * This never equates the mechanical evaluation with the study-base
 * evaluation. Missing, stale, or ambiguous joins are omitted. Case `scope`
 * is deliberately not compared across families because mechanical proof and
 * sensitivity contracts use different scope vocabularies.
 */
export function buildOverviewSensitivityVerdictBindings(
  thread: ThreadWorkbenchSnapshot,
  journeys: readonly OverviewSensitivityJourney[] =
    buildOverviewSensitivityJourneys(thread),
): readonly OverviewSensitivityVerdictBinding[] {
  const catalog = thread.engineeringCases;
  if (
    catalog?.schemaVersion !== "engineering-cases/1.1" ||
    catalog.status !== "observed"
  ) return [];
  const casesByKey = new Map(catalog.cases.map((item) => [item.key, item]));
  const mechanicalCases = catalog.current.flatMap((selection) => {
    if (selection.family !== "mechanical-proof") return [];
    const sealed = casesByKey.get(selection.currentCaseKey);
    return sealed && sealed.family === "mechanical-proof" &&
        sealed.id === selection.id && sealed.revision === selection.revision
      ? [sealed]
      : [];
  });

  return journeys.flatMap((journey) => {
    const sensitivityCase = casesByKey.get(journey.case.key);
    if (
      !sensitivityCase || sensitivityCase.family !== "sensitivity-study" ||
      sensitivityCase.id !== journey.case.id ||
      sensitivityCase.revision !== journey.case.revision
    ) return [];
    const requirementNode = unique(
      thread.graph.nodes.filter((node) =>
        sameNodeReference(node, "requirement", journey.requirement.id) &&
        node.entityKind === "requirement" && node.freshness === "fresh" &&
        node.engineeringCaseRefs?.includes(journey.case.key)
      ),
    );
    if (!requirementNode) return [];

    const candidates = mechanicalCases.flatMap((mechanicalCase) => {
      if (!requirementNode.engineeringCaseRefs?.includes(mechanicalCase.key)) {
        return [];
      }
      const evaluation = unique(
        thread.graph.nodes.filter((node) =>
          node.entityKind === "evaluation" && node.freshness === "fresh" &&
          node.evaluationFamily === undefined &&
          node.selection?.kind === "requirement" &&
          node.selection.id === journey.requirement.id &&
          node.engineeringCaseRefs?.includes(mechanicalCase.key)
        ),
      );
      if (!evaluation) return [];
      const evaluates = unique(
        thread.graph.edges.filter((edge) =>
          edge.origin === "provenance" && edge.relation === "evaluates" &&
          edge.from.kind === "requirement" &&
          edge.from.id === journey.requirement.id &&
          edge.to.kind === "evaluation" && edge.to.id === evaluation.ref.id
        ),
      );
      return evaluates ? [{ mechanicalCase, evaluation }] : [];
    });
    const target = unique(candidates);
    return target
      ? [{
        journeyId: journey.id,
        verdictNodeKey: `evaluation:${target.evaluation.ref.id}`,
        verdictEvaluationId: target.evaluation.ref.id,
        requirementId: journey.requirement.id,
        mechanicalCaseKey: target.mechanicalCase.key,
      }]
      : [];
  }).toSorted((left, right) =>
    left.verdictNodeKey.localeCompare(right.verdictNodeKey) ||
    left.journeyId.localeCompare(right.journeyId)
  );
}

function projectSensitivityJourney(
  thread: ThreadWorkbenchSnapshot,
  analysisEdge: ThreadGraphEdge,
): OverviewSensitivityJourney | undefined {
  const analysis = analysisEdge.analysis;
  if (
    analysis === undefined ||
    analysis.assertionId !== analysisEdge.id ||
    analysis.scope.kind !== "local-neighborhood" ||
    analysis.measurement === undefined ||
    analysis.evidence.length !== 1
  ) return undefined;

  const parameterNode = unique(
    thread.graph.nodes.filter((node) =>
      sameNodeReference(node, analysisEdge.from.kind, analysisEdge.from.id) &&
      node.entityKind === "analysis-node"
    ),
  );
  const responseNode = unique(
    thread.graph.nodes.filter((node) =>
      sameNodeReference(node, analysisEdge.to.kind, analysisEdge.to.id) &&
      node.entityKind === "analysis-node"
    ),
  );
  if (
    !parameterNode?.analysis || !responseNode?.analysis ||
    !sameSemanticRef(
      parameterNode.analysis.semanticRef,
      analysis.scope.parameter,
    )
  ) return undefined;

  const studyEvidence = analysis.evidence[0]!;
  const studyArtifact = unique(
    thread.artifacts.filter((artifact) =>
      artifact.id === studyEvidence.id && artifact.freshness === "fresh" &&
      artifact.producer?.tool === "analyze.run-fea-sensitivity@1" &&
      artifactFingerprintMatches(artifact, studyEvidence.fingerprint)
    ),
  );
  if (!studyArtifact) return undefined;

  const sealed = exactCurrentSensitivityCase(
    thread,
    analysis.scope.basisFingerprint,
  );
  if (!sealed) return undefined;
  const caseArtifact = unique(
    thread.artifacts.filter((artifact) =>
      sealed.authorityArtifactIds.includes(artifact.id) &&
      artifact.freshness === "fresh" &&
      artifact.producer?.tool === "analyze.seal-sensitivity-study@1"
    ),
  );
  if (!caseArtifact) return undefined;
  const caseToStudy = unique(
    thread.graph.edges.filter((edge) =>
      edge.origin === "structure" && edge.relation === "input_to" &&
      edge.from.kind === "artifact" && edge.from.id === caseArtifact.id &&
      edge.to.kind === "artifact" && edge.to.id === studyArtifact.id &&
      edge.attestation?.status === "verified"
    ),
  );
  if (!caseToStudy) return undefined;

  const observation = unique(
    thread.observations.filter((candidate) =>
      candidate.sourceArtifactId === studyArtifact.id &&
      candidate.freshness === "fresh" &&
      sameQuantity(candidate, analysis.measurement!.responseAtBase) &&
      candidate.requirementIds.length > 0
    ),
  );
  if (!observation) return undefined;
  const observationNode = unique(
    thread.graph.nodes.filter((node) =>
      sameNodeReference(node, "observation", observation.id) &&
      node.freshness === "fresh"
    ),
  );
  if (!observationNode) return undefined;

  const usesEdge = unique(
    thread.graph.edges.filter((edge) =>
      edge.origin === "provenance" && edge.relation === "uses" &&
      edge.from.kind === "observation" && edge.from.id === observation.id &&
      edge.to.kind === "evaluation"
    ),
  );
  if (!usesEdge) return undefined;
  const evaluationNode = unique(
    thread.graph.nodes.filter((node) =>
      sameNodeReference(node, "evaluation", usesEdge.to.id) &&
      node.entityKind === "evaluation" &&
      node.evaluationFamily === "study-base" &&
      node.freshness === "fresh"
    ),
  );
  if (
    !evaluationNode || evaluationNode.selection?.kind !== "requirement" ||
    !isVerdict(evaluationNode.summary)
  ) return undefined;
  const verdict = evaluationNode.summary;

  const requirement = unique(
    thread.requirements.filter((candidate) =>
      candidate.id === evaluationNode.selection!.id &&
      candidate.status === verdict &&
      candidate.observationIds.includes(observation.id) &&
      observation.requirementIds.includes(candidate.id)
    ),
  );
  if (!requirement) return undefined;
  const evaluatesEdge = unique(
    thread.graph.edges.filter((edge) =>
      edge.origin === "provenance" && edge.relation === "evaluates" &&
      edge.from.kind === "requirement" && edge.from.id === requirement.id &&
      edge.to.kind === "evaluation" && edge.to.id === evaluationNode.ref.id
    ),
  );
  if (!evaluatesEdge) return undefined;

  const evaluationEvidenceEdge = unique(
    thread.graph.edges.filter((edge) =>
      edge.origin === "provenance" && edge.relation === "evidences" &&
      edge.from.kind === "artifact" && edge.to.kind === "evaluation" &&
      edge.to.id === evaluationNode.ref.id
    ),
  );
  if (!evaluationEvidenceEdge) return undefined;
  const evaluationArtifact = unique(
    thread.artifacts.filter((artifact) =>
      artifact.id === evaluationEvidenceEdge.from.id &&
      artifact.freshness === "fresh" &&
      artifact.producer?.tool === "verify.evaluate-sensitivity-base@1"
    ),
  );
  if (!evaluationArtifact) return undefined;

  const observationKey = `observation:${observation.id}`;
  const evaluationKey = `evaluation:${evaluationNode.ref.id}`;
  return {
    id: analysisEdge.id,
    routeEdgeKey: `${observationKey}>${evaluationKey}`,
    usesEdgeId: usesEdge.id,
    analysisEdgeId: analysisEdge.id,
    case: {
      key: sealed.key,
      id: sealed.id,
      revision: sealed.revision,
      artifactId: caseArtifact.id,
    },
    parameter: {
      id: analysis.scope.parameter.id,
      label: sensitivityParameterLabel(analysis.scope.parameter.id),
      lower: analysis.scope.lower,
      upper: analysis.scope.upper,
    },
    responseLabel: humanizeIdentifier(
      responseNode.analysis.semanticRef.id.split(":").at(-1) ??
        responseNode.label,
    ),
    measurement: analysis.measurement,
    observation: {
      id: observation.id,
      label: observation.label,
      display: observation.display,
      ...(observation.measuredAt ? { measuredAt: observation.measuredAt } : {}),
    },
    requirement: {
      id: requirement.id,
      label: requirement.label,
      expression: requirement.expression,
    },
    evaluation: {
      id: evaluationNode.ref.id,
      label: evaluationNode.label,
      verdict,
      artifactId: evaluationArtifact.id,
    },
    evidence: {
      studyArtifactId: studyArtifact.id,
      studyArtifactLabel: studyArtifact.label,
      studyFingerprint: studyEvidence.fingerprint,
      evaluationArtifactId: evaluationArtifact.id,
    },
  };
}

function exactCurrentSensitivityCase(
  thread: ThreadWorkbenchSnapshot,
  caseDigest: string,
): EngineeringCase | undefined {
  const catalog = thread.engineeringCases;
  if (
    catalog?.schemaVersion !== "engineering-cases/1.1" ||
    catalog.status !== "observed"
  ) return undefined;
  const sealed = unique(
    catalog.cases.filter((candidate) =>
      candidate.family === "sensitivity-study" &&
      candidate.caseSchemaVersion === "sensitivity-study-case/3.0" &&
      candidate.caseDigest === caseDigest
    ),
  );
  if (!sealed) return undefined;
  const current = catalog.current.filter((selection) =>
    selection.family === "sensitivity-study" &&
    selection.id === sealed.id && selection.currentCaseKey === sealed.key &&
    selection.revision === sealed.revision
  );
  return current.length === 1 ? sealed : undefined;
}

function sameNodeReference(
  node: ThreadGraphNode,
  kind: string,
  id: string,
): boolean {
  return node.ref.kind === kind && node.ref.id === id;
}

function sameSemanticRef(
  left: ThreadAnalysisSemanticRef,
  right: ThreadAnalysisSemanticRef,
): boolean {
  return left.domain === right.domain && left.kind === right.kind &&
    left.id === right.id && left.basisFingerprint === right.basisFingerprint;
}

function artifactFingerprintMatches(
  artifact: ThreadArtifact,
  digest: string,
): boolean {
  return artifact.fingerprint === digest ||
    artifact.fingerprint === `sha256:${digest}`;
}

function sameQuantity(
  candidate: Pick<ThreadObservation, "value" | "unit">,
  expected: ThreadAnalysisQuantity,
): boolean {
  return Object.is(candidate.value, expected.value) &&
    candidate.unit === expected.unit;
}

function isVerdict(value: string): value is "pass" | "fail" | "unresolved" {
  return value === "pass" || value === "fail" || value === "unresolved";
}

function sensitivityParameterLabel(id: string): string {
  const parts = id.split(":").filter(Boolean);
  const leaf = parts.at(-1) ?? id;
  const parent = parts.at(-2);
  return parent
    ? `${humanizeIdentifier(parent)} · ${humanizeIdentifier(leaf)}`
    : humanizeIdentifier(leaf);
}

function humanizeIdentifier(value: string): string {
  const words = value.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
  return words.length === 0
    ? value
    : `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function unique<T>(values: readonly T[]): T | undefined {
  return values.length === 1 ? values[0] : undefined;
}

function countBy(values: readonly string[]): ReadonlyMap<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}
