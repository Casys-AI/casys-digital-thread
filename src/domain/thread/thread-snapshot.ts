import type { ContentFingerprint, IsoDateTime } from "../kernel/types.ts";

export type { ContentFingerprint } from "../kernel/types.ts";

/**
 * Versioned, transport-independent state of one executable digital thread.
 *
 * The contract contains only JSON values and stable identifiers. Tool calls and
 * UI state intentionally live outside this module.
 */

export type ThreadSnapshotSchemaVersion = "1.0";

export type ThreadFreshnessStatus = "fresh" | "stale" | "running" | "failed";

export interface ThreadFreshness {
  status: ThreadFreshnessStatus;
  changedAt: IsoDateTime;
  /** Required for stale and failed states; never a hidden inferred default. */
  reason?: string;
  /** Changes which made this entity stale or caused its recomputation. */
  invalidatedByChangeIds: string[];
}

export interface EngineeringQuantity {
  value: number;
  /** Explicit engineering unit; use "1" for a dimensionless quantity. */
  unit: string;
}

export interface ThreadOperationRef {
  serverId: string;
  tool: string;
  runId: string;
}

export interface ThreadSubject {
  id: string;
  name: string;
  kind: "system" | "assembly" | "part" | "process";
  version: string;
  modelArtifactId: string;
}

export interface PreviousThreadSnapshot {
  snapshotId: string;
  revision: number;
}

export type ThreadArtifactKind =
  | "sysml-model"
  | "script"
  | "cad-model"
  | "step"
  | "mesh"
  | "simulation-model"
  | "solver-input"
  | "solver-result"
  | "evidence"
  | "bom"
  | "document"
  | "other";

export interface ThreadArtifact {
  id: string;
  name: string;
  kind: ThreadArtifactKind;
  version: string;
  fingerprint: ContentFingerprint;
  uri?: string;
  mediaType?: string;
  producer: ThreadOperationRef;
  /** Exact upstream artefacts consumed to produce this version. */
  inputArtifactIds: string[];
  freshness: ThreadFreshness;
}

/**
 * Consumer-side attestation of the exact artefact bytes that were read.
 * A path or artefact id alone is never evidence that the producer output was
 * the input observed by the downstream engineering tool.
 */
export interface ThreadArtifactConsumption {
  id: string;
  artifactId: string;
  consumer: ThreadOperationRef;
  observedFingerprint: ContentFingerprint;
  verifiedAt: IsoDateTime;
  status: "verified" | "mismatch";
}

export interface ThreadObservationSource {
  operation: ThreadOperationRef;
  artifactIds: string[];
  capturedAt: IsoDateTime;
}

export interface ThreadObservation {
  id: string;
  name: string;
  /** Stable metric identity, independent from a display label. */
  metric: string;
  quantity: EngineeringQuantity;
  source: ThreadObservationSource;
  freshness: ThreadFreshness;
}

export type RequirementOperator = "<=" | ">=" | "<" | ">" | "=";

export interface RequirementCriterion {
  metric: string;
  operator: RequirementOperator;
  limit: EngineeringQuantity;
}

export interface RequirementTrace {
  /** Versioned model containing the requirement. */
  sourceArtifactId: string;
  /** Stable SysML or source-system element identifier. */
  elementId: string;
  /** Artefacts whose design or behaviour is constrained by this requirement. */
  targetArtifactIds: string[];
}

export interface TracedRequirement {
  id: string;
  name: string;
  statement: string;
  version: string;
  criterion: RequirementCriterion;
  trace: RequirementTrace;
  freshness: ThreadFreshness;
}

export type RequirementEvaluationStatus = "pass" | "fail" | "unresolved" | "error";

export interface EvaluationComparison {
  observationId: string;
  /** Values after unit normalization by the requirement oracle. */
  actual: EngineeringQuantity;
  operator: RequirementOperator;
  limit: EngineeringQuantity;
  normalizedUnit: string;
  margin?: EngineeringQuantity;
}

export interface RequirementEvaluation {
  id: string;
  name: string;
  requirementId: string;
  observationIds: string[];
  status: RequirementEvaluationStatus;
  evaluatedAt: IsoDateTime;
  evaluator: ThreadOperationRef;
  comparison?: EvaluationComparison;
  evidenceArtifactIds: string[];
  message: string;
  freshness: ThreadFreshness;
}

export interface ThreadViolation {
  id: string;
  /** Human-readable, stable violation name; never only a numeric result. */
  name: string;
  requirementId: string;
  evaluationId: string;
  severity: "info" | "warning" | "error" | "critical";
  status: "open" | "accepted" | "resolved";
  detectedAt: IsoDateTime;
  observationIds: string[];
  evidenceArtifactIds: string[];
  summary: string;
  freshness: ThreadFreshness;
}

export type ThreadEntityKind =
  | "artifact"
  | "consumption"
  | "observation"
  | "requirement"
  | "evaluation"
  | "violation"
  | "change"
  | "action";

export interface ThreadEntityRef {
  kind: ThreadEntityKind;
  id: string;
}

export type ThreadChangeKind = "created" | "modified" | "deleted" | "archived";

export interface ThreadChange {
  id: string;
  kind: ThreadChangeKind;
  target: ThreadEntityRef;
  summary: string;
  beforeFingerprint?: ContentFingerprint;
  afterFingerprint?: ContentFingerprint;
}

export interface ThreadChangeSet {
  id: string;
  name: string;
  status: "proposed" | "applied";
  createdAt: IsoDateTime;
  appliedAt?: IsoDateTime;
  changes: ThreadChange[];
}

export type ProvenanceRelation =
  | "changes"
  | "derived_from"
  | "traces_to"
  | "uses"
  | "evaluates"
  | "evidences"
  | "caused_by"
  | "addresses"
  | "supersedes";

export interface ThreadProvenanceLink {
  id: string;
  relation: ProvenanceRelation;
  from: ThreadEntityRef;
  to: ThreadEntityRef;
  /** Short factual explanation displayed alongside the causal edge. */
  rationale: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProposedThreadAction {
  id: string;
  name: string;
  kind: "recompute" | "correct" | "review" | "synchronize" | "inspect";
  readiness: "ready" | "blocked";
  rationale: string;
  targets: ThreadEntityRef[];
  addressesViolationIds: string[];
  dependsOnActionIds: string[];
  /** Domain operation resolved to a concrete transport by the orchestrator. */
  operation?: {
    id: string;
    inputs: { [key: string]: JsonValue };
  };
  blockedReason?: string;
}

/**
 * Return the set of `kind:id` keys for every entity targeted by an "archived"
 * change in this snapshot's changeSet.
 *
 * Changes accumulate across revisions (the changeSet grows monotonically), so
 * this helper covers the full retirement history without a separate store pass.
 * The archive-lineage executor uses it to detect already-retired entities and
 * skip re-applying an idempotent revision.
 */
export function archivedRefKeys(snapshot: ThreadSnapshot): ReadonlySet<string> {
  const keys = new Set<string>();
  for (const change of snapshot.changeSet.changes) {
    if (change.kind === "archived") {
      keys.add(`${change.target.kind}:${change.target.id}`);
    }
  }
  return keys;
}

export interface ThreadSnapshot {
  schemaVersion: ThreadSnapshotSchemaVersion;
  id: string;
  revision: number;
  previous?: PreviousThreadSnapshot;
  generatedAt: IsoDateTime;
  subject: ThreadSubject;
  freshness: ThreadFreshness;
  changeSet: ThreadChangeSet;
  artifacts: ThreadArtifact[];
  consumptions: ThreadArtifactConsumption[];
  observations: ThreadObservation[];
  requirements: TracedRequirement[];
  evaluations: RequirementEvaluation[];
  violations: ThreadViolation[];
  provenance: ThreadProvenanceLink[];
  proposedActions: ProposedThreadAction[];
}
