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

/** Every canonical entity kind which can participate in the native graph. */
export interface ThreadGraphRef {
  kind:
    | "artifact"
    | "consumption"
    | "observation"
    | "requirement"
    | "evaluation"
    | "violation"
    | "change"
    | "action";
  id: string;
}

/** Canonical provenance relations plus two explicit structural facts. */
export type ThreadGraphRelation =
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
  | "source_of";

export interface ThreadGraphNode {
  /** Stable browser key, distinct from the canonical entity id. */
  id: string;
  ref: ThreadGraphRef;
  entityKind: ThreadGraphRef["kind"];
  /** Canonical artifact kind, present only for artifact nodes. */
  artifactKind?: string;
  label: string;
  system: string;
  freshness: ThreadFreshness;
  summary: string;
  /** Canonical timestamp used to order this fact in the activity feed. */
  recordedAt?: string;
  /**
   * Explicit browser-safe presentation role for a server-owned live milestone.
   * It does not change the node's engineering/provenance semantics.
   */
  activityRole?: "milestone";
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
  origin: "provenance" | "structure";
  attestation?: ThreadGraphEdgeAttestation;
}

export interface ThreadGraph {
  nodes: ThreadGraphNode[];
  edges: ThreadGraphEdge[];
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

export type ThreadComponentProvider = "syson" | "erpnext" | "build123d";

export interface ThreadComponentBinding {
  provider: ThreadComponentProvider;
  kind: "part-usage" | "item" | "artifact" | "assembly-child";
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
  mediaType: "model/stl";
  url: string;
  /** Presentation mesh fingerprint, distinct from the authoritative CAD hash. */
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
  source: "observed" | "fixture";
  sourceLabel: string;
  change: ThreadChange;
  components: ThreadComponentCatalog;
  graph: ThreadGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}
