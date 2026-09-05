export type ThreadFreshness = "fresh" | "stale" | "running" | "failed";
export type ThreadTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ThreadRef {
  kind: "change" | "artifact" | "observation" | "requirement" | "violation";
  id: string;
}

/** Every entity kind which can participate in the native graph. */
export interface ThreadGraphRef {
  kind:
    | "artifact"
    | "consumption"
    | "observation"
    | "requirement"
    | "evaluation"
    | "violation"
    | "change"
    | "action"
    | "analysis-node"
    | "part-definition"
    | "part-usage"
    | "attribute-usage";
  id: string;
}

export type ProvenanceThreadGraphRelation =
  | "changes"
  | "derived_from"
  | "traces_to"
  | "uses"
  | "evaluates"
  | "evidences"
  | "caused_by"
  | "addresses"
  | "supersedes"
  | "input_to"
  | "source_of"
  | "contains"
  | "typed_by"
  | "represented_by"
  | "verified_by"
  | "constrained_by";

export type ThreadAnalysisRelation =
  | "semantic-binding"
  | "declared-dependency"
  | "static-value-flow"
  | "structural-incidence"
  | "runtime-consumption"
  | "measured-local-sensitivity"
  | "projection-of";

export type ThreadGraphRelation =
  | ProvenanceThreadGraphRelation
  | ThreadAnalysisRelation;

export interface ThreadAnalysisSemanticRef {
  domain: "brief" | "sysml" | "cad" | "modelica" | "calculix" | "thread";
  kind: string;
  id: string;
  basisFingerprint?: string;
}

export interface ThreadAnalysisNodeDetail {
  semanticRef: ThreadAnalysisSemanticRef;
}

export interface ThreadAnalysisQuantity {
  value: number;
  unit: string;
}

export type ThreadAnalysisScope =
  | { kind: "basis"; basisFingerprint: string }
  | {
    kind: "source-span";
    source: ThreadAnalysisSemanticRef;
    basisFingerprint: string;
    start: { line: number; column: number };
    end: { line: number; column: number };
  }
  | {
    kind: "scenario";
    scenario: ThreadAnalysisSemanticRef;
    basisFingerprint: string;
  }
  | {
    kind: "local-neighborhood";
    parameter: ThreadAnalysisSemanticRef;
    basisFingerprint: string;
    lower: ThreadAnalysisQuantity;
    upper: ThreadAnalysisQuantity;
  };

export interface ThreadAnalysisMeasurement {
  method: "forward-finite-difference";
  basePoint: ThreadAnalysisQuantity;
  perturbationStep: ThreadAnalysisQuantity;
  responseAtBase: ThreadAnalysisQuantity;
  responseAtPerturbed: ThreadAnalysisQuantity;
  derivative: ThreadAnalysisQuantity;
}

export interface ThreadAnalysisEdgeDetail {
  assertionId: string;
  epistemicBasis: "declared" | "inferred" | "observed";
  assertedBy: {
    kind: "agent" | "analyzer" | "provider" | "server";
    id: string;
    version?: string;
  };
  evidence: Array<{ id: string; fingerprint: string }>;
  scope: ThreadAnalysisScope;
  measurement?: ThreadAnalysisMeasurement;
}

export interface ThreadGraphNode {
  /** Stable browser key, distinct from the canonical entity id. */
  id: string;
  ref: ThreadGraphRef;
  entityKind: ThreadGraphRef["kind"];
  artifactKind?: string;
  analysis?: ThreadAnalysisNodeDetail;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  recordedAt?: string;
  affectedComponentId?: string;
  activityRole?: "milestone";
  evaluationFamily?: "study-base";
  /** Exact case declarations whose recorded downstream lineage contains this node. */
  engineeringCaseRefs?: string[];
  selection?: ThreadRef;
}

export interface ThreadGraphEdgeAttestation {
  consumptionId: string;
  status: "verified" | "mismatch";
  producerFingerprint: string;
  consumedFingerprint: string;
  checkedAt: string;
}

export interface ThreadGraphEdge {
  id: string;
  /** Visual direction: dependency/source -> result/consumer. */
  from: ThreadGraphRef;
  to: ThreadGraphRef;
  relation: ThreadGraphRelation;
  rationale: string;
  origin: "provenance" | "structure" | "analysis";
  attestation?: ThreadGraphEdgeAttestation;
  analysis?: ThreadAnalysisEdgeDetail;
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
}
