/**
 * Browser-safe projection of the linked engineering thread.
 *
 * This contract deliberately contains no MCP transport types. The backend owns
 * tool calls and projects their persisted, linked evidence into this snapshot.
 */

export type ThreadFreshness = "fresh" | "stale" | "running" | "failed";
export type ThreadTone = "neutral" | "info" | "success" | "warning" | "danger";

export interface ThreadRef {
  kind: "change" | "artifact" | "observation" | "requirement" | "violation";
  id: string;
}

/**
 * Every entity kind which can participate in the native graph.
 *
 * `part-definition` and `part-usage` are browser-safe structural read-model
 * nodes projected from exact reviewed SysON bindings. They are not promoted
 * back into the canonical ThreadSnapshot entity vocabulary.
 */
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
    | "part-usage";
  id: string;
}

/** Canonical provenance relations plus explicit browser-safe structural facts. */
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
  | "represented_by";

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
  /** Canonical artifact kind, present only for artifact nodes. */
  artifactKind?: string;
  /** Exact semantic identity, present only for analysis-node read-model nodes. */
  analysis?: ThreadAnalysisNodeDetail;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  /** Canonical timestamp used to order this fact in the activity feed. */
  recordedAt?: string;
  /**
   * Optional, explicitly declared product-structure identity affected by a
   * correction. It is a catalog id, never a friendly-name inference.
   */
  affectedComponentId?: string;
  /**
   * Explicit browser-safe presentation role for a server-owned live milestone.
   * It does not change the node's engineering/provenance semantics.
   */
  activityRole?: "milestone";
  /**
   * Present only for `verify.evaluate-sensitivity-base@1` evaluations.
   * Distinguishes the experience join from a proof-run oracle verdict.
   */
  evaluationFamily?: "study-base";
  /** Existing inspector target when this entity has a native detail panel. */
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
  /** Complete assertion detail, present exactly when origin is analysis. */
  analysis?: ThreadAnalysisEdgeDetail;
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
}

/**
 * Browser-safe quotient of the canonical graph for revision-aware rendering.
 *
 * The raw `graph` above remains the complete auditable graph. This additional
 * projection only folds explicit, compatible `supersedes` topology; it never
 * changes, removes, or reclassifies canonical evidence.
 */
export interface ThreadEvidenceFamilyGraph {
  schemaVersion: "thread-evidence-family-graph/1.0";
  /** Exact canonical snapshot from which this read model was derived. */
  asOf: {
    snapshotId: string;
    revision: number;
  };
  /** Explicit direct supersession topology, never inferred from names or bytes. */
  families: ThreadEvidenceFamily[];
  /** Non-self-loop edges between folded families only. */
  edges: ThreadEvidenceFamilyGraphEdge[];
  /** Raw edges made internal by a family and therefore omitted from the DAG. */
  omittedSelfLoops: ThreadEvidenceFamilyOmittedSelfLoop[];
  /** Raw edges whose inclusion would introduce a quotient-graph cycle. */
  omittedCycleEdges: ThreadEvidenceFamilyOmittedCycleEdge[];
}

/**
 * A family accepts only canonical artifact or requirement versions. Observed
 * measurements and verdicts intentionally remain separate facts: neither is
 * silently equated with a later observation or evaluation.
 */
export interface ThreadEvidenceFamily {
  /** Opaque deterministic id; callers must not parse it for semantics. */
  id: string;
  entityKind: "artifact" | "requirement";
  /** Present only for artifact families and identical for every member. */
  artifactKind?: string;
  /** Members with an explicit successor in this family. */
  historicalRefs: ThreadGraphRef[];
  /** Terminal members in the explicit supersession topology. */
  currentRefs: ThreadGraphRef[];
  /** Number of direct canonical supersession transitions in the family. */
  revisionCount: number;
  /** A current member is claimed only when the topology has exactly one. */
  status: "current" | "review-required";
  /** Required whenever the topology cannot name one current successor. */
  reviewReason?: "divergent-successors" | "no-current-successor";
  /**
   * Source snapshots currently record only `supersedes`, not the reason or
   * byte/semantic equivalence of that relation. Keep both classifications
   * deliberately unclaimed until the domain carries explicit metadata.
   */
  relationship: {
    relation: "supersedes";
    classification: "not-recorded";
    equivalence: "not-recorded";
  };
  /** Every direct canonical link that formed this family. */
  transitions: ThreadEvidenceFamilyTransition[];
}

export interface ThreadEvidenceFamilyTransition {
  edgeRef: ThreadEvidenceFamilyEdgeRef;
  /** Normalized visual direction: historical member -> direct successor. */
  historical: ThreadGraphRef;
  successor: ThreadGraphRef;
}

/** Reference to a raw browser-safe graph edge, never a reconstructed edge. */
export interface ThreadEvidenceFamilyEdgeRef {
  id: string;
  relation: ThreadGraphRelation;
  origin: ThreadGraphEdge["origin"];
}

export interface ThreadEvidenceFamilyGraphEdge {
  id: string;
  fromFamilyId: string;
  toFamilyId: string;
  relation: ThreadGraphRelation;
  origin: ThreadGraphEdge["origin"];
  /** One or more raw graph edges collapsed into this quotient edge. */
  memberEdgeRefs: ThreadEvidenceFamilyEdgeRef[];
}

export interface ThreadEvidenceFamilyOmittedSelfLoop {
  familyId: string;
  memberEdgeRefs: ThreadEvidenceFamilyEdgeRef[];
}

export interface ThreadEvidenceFamilyOmittedCycleEdge {
  fromFamilyId: string;
  toFamilyId: string;
  memberEdgeRefs: ThreadEvidenceFamilyEdgeRef[];
}

export interface ThreadChange {
  id: string;
  title: string;
  summary: string;
  author: string;
  revision: string;
  changedAt: string;
  status: "evaluated" | "partially_evaluated" | "pending";
  files: string[];
}

export interface ThreadFlowStage {
  id: string;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  selection: ThreadRef;
  /** Stage ids backed by an explicit canonical dependency or provenance link. */
  dependsOn: string[];
}

/**
 * Browser-safe reopen of one `model.seal-architecture-sysml@1` Thread document.
 *
 * Bindings stay symbol ids. Labels, when present, are display-only and never
 * join keys. Source text, spans and unresolved messages are copied from a
 * successful source-analysis reopen and are never invented from a capture
 * id+kind. This is not Product Structure, not a SysON model, and not
 * `compile.seal-admission@1`.
 */
export interface ThreadArchitectureSysmlSealLocation {
  /** One-based line. */
  line: number;
  /** Zero-based column. */
  column: number;
}

/** Copied source range. Absent when source analysis did not reopen. */
export interface ThreadArchitectureSysmlSealSpan {
  start: ThreadArchitectureSysmlSealLocation;
  end: ThreadArchitectureSysmlSealLocation;
}

export interface ThreadArchitectureSysmlSealSymbol {
  id: string;
  kind: string;
  /** Display-only name; never used as a join key. */
  label?: string;
  span?: ThreadArchitectureSysmlSealSpan;
}

export interface ThreadArchitectureSysmlSealUnresolved {
  id: string;
  kind: string;
  /** Copied from the reopened analysis. Never derived from id+kind. */
  message?: string;
  span?: ThreadArchitectureSysmlSealSpan;
}

/**
 * Directed source-local incidence. Ends are symbol ids, never labels.
 * Display labels, if shown, are looked up from `symbols` and stay display-only.
 */
export interface ThreadArchitectureSysmlSealIncidence {
  id: string;
  kind: "structural-incidence";
  fromSymbolId: string;
  toSymbolId: string;
  span?: ThreadArchitectureSysmlSealSpan;
}

export interface ThreadArchitectureSysmlSealPresentation {
  producer: "model.seal-architecture-sysml@1";
  authority: "documentary";
  artifactKind: "document";
  notSyson: true;
  notWriteArchitecture: true;
  notCompilationAdmission: true;
  symbolsStatus: "observed" | "unavailable";
  /** Same fail-closed pair as `symbolsStatus`. */
  sourceStatus: "observed" | "unavailable";
  /** Exact UTF-8. Present only when `sourceStatus` is `observed`. */
  sourceText?: string;
  symbols: ThreadArchitectureSysmlSealSymbol[];
  incidences: ThreadArchitectureSysmlSealIncidence[];
  unresolvedConstructs: ThreadArchitectureSysmlSealUnresolved[];
}

export interface ThreadArtifact {
  id: string;
  label: string;
  kind: string;
  system: string;
  revision: string;
  freshness: ThreadFreshness;
  fingerprint?: string;
  uri?: string;
  producedAt?: string;
  producedBy?: string;
  dependsOn: string[];
  attestation?: {
    status: "verified" | "mismatch";
    sourceArtifactId: string;
    producerFingerprint: string;
    consumedFingerprint: string;
    checkedAt: string;
  };
  /**
   * Present only after the BFF reopens an `architecture-sysml-seal-capture/1.0`
   * document. The pure projector never fills this field.
   */
  architectureSysmlSeal?: ThreadArchitectureSysmlSealPresentation;
}

export interface ThreadObservation {
  id: string;
  label: string;
  value: number;
  unit: string;
  display: string;
  sourceArtifactId: string;
  requirementIds: string[];
  freshness: ThreadFreshness;
  measuredAt?: string;
}

export interface ThreadRequirement {
  id: string;
  label: string;
  source: string;
  /** Exact structured SysML element identity; never inferred from display text. */
  sourceElementId: string;
  expression: string;
  status: "pass" | "fail" | "unresolved";
  observationIds: string[];
  violationIds: string[];
  rationale: string;
}

export interface ThreadViolation {
  id: string;
  name: string;
  severity: "blocking" | "warning";
  status: "open" | "resolved";
  requirementId: string;
  observationId: string;
  message: string;
  margin: string;
  evidence: string[];
  proposedActionIds: string[];
}

export interface ThreadAction {
  id: string;
  label: string;
  description: string;
  kind: "change" | "recompute" | "inspect";
  targetId: string;
  system: string;
  readiness: "ready" | "blocked";
  requiresConfirmation: boolean;
}

/**
 * Recognised provider namespaces for catalog bindings.
 * "digital-thread" names the backend compiler (plan, script artifacts) —
 * kept separate from "build123d" which executes the export.
 */
export type ThreadComponentProvider =
  | "syson"
  | "erpnext"
  | "build123d"
  | "digital-thread";

export interface ThreadComponentBinding {
  provider: ThreadComponentProvider;
  kind:
    | "part-definition"
    | "part-usage"
    | "item"
    | "artifact"
    | "assembly-child";
  id: string;
  label: string;
  evidenceArtifactId: string;
  status: "verified" | "unverified";
  reason?: string;
  /** Existing browser record which carries the provider evidence. */
  selection?: ThreadRef;
}

export interface ThreadComponentPreview {
  provider: "build123d";
  artifactId: string;
  mediaType: "model/stl" | "model/gltf-binary";
  url: string;
  /** Presentation asset fingerprint, distinct from the authoritative CAD hash. */
  sha256: string;
}

export interface ThreadComponent {
  id: string;
  label: string;
  kind: "assembly" | "part";
  quantity: number;
  parentId?: string;
  bindings: ThreadComponentBinding[];
  preview?: ThreadComponentPreview;
}

export interface ThreadComponentCatalog {
  schemaVersion: "thread-components/1.0";
  authority: "workspace-declared";
  subjectId: string;
  rationale: string;
  systemViews: {
    syson?: {
      projectId: string;
      editingContextId: string;
      diagramId: string;
      diagramLabel: string;
    };
    erpnext?: { bomName: string };
  };
  components: ThreadComponent[];
}

/**
 * Exact immutable predecessor of this projected canonical snapshot.
 *
 * This remains an identifier-only reference: the browser can request the
 * matching historical projection, but this contract never embeds a second
 * snapshot or any provider payload.
 */
export interface ThreadWorkbenchPreviousSnapshot {
  snapshotId: string;
  revision: number;
}

export interface ThreadWorkbenchSnapshot {
  /** UI projection produced from the canonical domain ThreadSnapshot. */
  schemaVersion: "thread-workbench/0.1";
  id: string;
  subject: {
    id: string;
    label: string;
    program: string;
  };
  generatedAt: string;
  /** Present only when the canonical snapshot extends an earlier revision. */
  previous?: ThreadWorkbenchPreviousSnapshot;
  source: "observed" | "fixture";
  sourceLabel: string;
  change: ThreadChange;
  components: ThreadComponentCatalog;
  graph: ThreadGraph;
  /** Compact quotient of explicit evidence-version topology; raw graph remains above. */
  evidenceFamilyGraph: ThreadEvidenceFamilyGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}
