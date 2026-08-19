import type {
  ContentFingerprint as KernelContentFingerprint,
  IsoDateTime,
} from "../kernel/primitives.ts";
import type { AnalysisGraph } from "./analysis-graph.ts";

export type ContentFingerprint = Readonly<KernelContentFingerprint>;

/**
 * Versioned, transport-independent state of one executable digital thread.
 *
 * The contract contains only JSON values and stable identifiers. Tool calls and
 * UI state intentionally live outside this module.
 */

/**
 * 1.0 contains lifecycle and provenance evidence only.
 * 1.1 additionally contains a non-empty, separately typed semantic analysis
 * graph.  The runtime validator enforces the version-specific presence rule.
 */
export type ThreadSnapshotSchemaVersion = "1.0" | "1.1";

export type ThreadFreshnessStatus = "fresh" | "stale" | "running" | "failed";

export interface ThreadFreshness {
  readonly status: ThreadFreshnessStatus;
  readonly changedAt: IsoDateTime;
  /** Required for stale and failed states; never a hidden inferred default. */
  readonly reason?: string;
  /** Changes which made this entity stale or caused its recomputation. */
  readonly invalidatedByChangeIds: readonly string[];
}

export interface EngineeringQuantity {
  readonly value: number;
  /** Explicit engineering unit; use "1" for a dimensionless quantity. */
  readonly unit: string;
}

export interface ThreadOperationRef {
  readonly serverId: string;
  readonly tool: string;
  readonly runId: string;
}

export interface ThreadSubject {
  readonly id: string;
  readonly name: string;
  readonly kind: "system" | "assembly" | "part" | "process";
  readonly version: string;
  readonly modelArtifactId: string;
}

export interface PreviousThreadSnapshot {
  readonly snapshotId: string;
  readonly revision: number;
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
  readonly id: string;
  readonly name: string;
  readonly kind: ThreadArtifactKind;
  readonly version: string;
  readonly fingerprint: ContentFingerprint;
  readonly uri?: string;
  readonly mediaType?: string;
  readonly producer: ThreadOperationRef;
  /** Exact upstream artefacts consumed to produce this version. */
  readonly inputArtifactIds: readonly string[];
  readonly freshness: ThreadFreshness;
}

/**
 * Consumer-side attestation of the exact artefact bytes that were read.
 * A path or artefact id alone is never evidence that the producer output was
 * the input observed by the downstream engineering tool.
 */
export interface ThreadArtifactConsumption {
  readonly id: string;
  readonly artifactId: string;
  readonly consumer: ThreadOperationRef;
  readonly observedFingerprint: ContentFingerprint;
  readonly verifiedAt: IsoDateTime;
  readonly status: "verified" | "mismatch";
}

export interface ThreadObservationSource {
  readonly operation: ThreadOperationRef;
  readonly artifactIds: readonly string[];
  readonly capturedAt: IsoDateTime;
}

export interface ThreadObservation {
  readonly id: string;
  readonly name: string;
  /** Stable metric identity, independent from a display label. */
  readonly metric: string;
  readonly quantity: EngineeringQuantity;
  readonly source: ThreadObservationSource;
  readonly freshness: ThreadFreshness;
}

export type RequirementOperator = "<=" | ">=" | "<" | ">" | "=";

export interface RequirementCriterion {
  readonly metric: string;
  readonly operator: RequirementOperator;
  readonly limit: EngineeringQuantity;
}

export interface RequirementTrace {
  /** Versioned model containing the requirement. */
  readonly sourceArtifactId: string;
  /** Stable SysML or source-system element identifier. */
  readonly elementId: string;
  /** Artefacts whose design or behaviour is constrained by this requirement. */
  readonly targetArtifactIds: readonly string[];
}

export interface TracedRequirement {
  readonly id: string;
  readonly name: string;
  readonly statement: string;
  readonly version: string;
  readonly criterion: RequirementCriterion;
  readonly trace: RequirementTrace;
  readonly freshness: ThreadFreshness;
}

export type RequirementEvaluationStatus = "pass" | "fail" | "unresolved" | "error";

export interface EvaluationComparison {
  readonly observationId: string;
  /** Values after unit normalization by the requirement oracle. */
  readonly actual: EngineeringQuantity;
  readonly operator: RequirementOperator;
  readonly limit: EngineeringQuantity;
  readonly normalizedUnit: string;
  readonly margin?: EngineeringQuantity;
}

export interface RequirementEvaluation {
  readonly id: string;
  readonly name: string;
  readonly requirementId: string;
  readonly observationIds: readonly string[];
  readonly status: RequirementEvaluationStatus;
  readonly evaluatedAt: IsoDateTime;
  readonly evaluator: ThreadOperationRef;
  readonly comparison?: EvaluationComparison;
  readonly evidenceArtifactIds: readonly string[];
  readonly message: string;
  readonly freshness: ThreadFreshness;
}

export interface ThreadViolation {
  readonly id: string;
  /** Human-readable, stable violation name; never only a numeric result. */
  readonly name: string;
  readonly requirementId: string;
  readonly evaluationId: string;
  readonly severity: "info" | "warning" | "error" | "critical";
  readonly status: "open" | "accepted" | "resolved";
  readonly detectedAt: IsoDateTime;
  readonly observationIds: readonly string[];
  readonly evidenceArtifactIds: readonly string[];
  readonly summary: string;
  readonly freshness: ThreadFreshness;
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
  readonly kind: ThreadEntityKind;
  readonly id: string;
}

export type ThreadChangeKind = "created" | "modified" | "deleted" | "archived";

export interface ThreadChange {
  readonly id: string;
  readonly kind: ThreadChangeKind;
  readonly target: ThreadEntityRef;
  readonly summary: string;
  readonly beforeFingerprint?: ContentFingerprint;
  readonly afterFingerprint?: ContentFingerprint;
}

export interface ThreadChangeSet {
  readonly id: string;
  readonly name: string;
  readonly status: "proposed" | "applied";
  readonly createdAt: IsoDateTime;
  readonly appliedAt?: IsoDateTime;
  readonly changes: readonly ThreadChange[];
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
  readonly id: string;
  readonly relation: ProvenanceRelation;
  readonly from: ThreadEntityRef;
  readonly to: ThreadEntityRef;
  /** Short factual explanation displayed alongside the causal edge. */
  readonly rationale: string;
}

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | {
  readonly [key: string]: JsonValue;
};

export interface ProposedThreadAction {
  readonly id: string;
  readonly name: string;
  readonly kind: "recompute" | "correct" | "review" | "synchronize" | "inspect";
  readonly readiness: "ready" | "blocked";
  readonly rationale: string;
  readonly targets: readonly ThreadEntityRef[];
  readonly addressesViolationIds: readonly string[];
  readonly dependsOnActionIds: readonly string[];
  /** Domain operation resolved to a concrete transport by the orchestrator. */
  readonly operation?: {
    readonly id: string;
    readonly inputs: { readonly [key: string]: JsonValue };
  };
  readonly blockedReason?: string;
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
  readonly schemaVersion: ThreadSnapshotSchemaVersion;
  readonly id: string;
  readonly revision: number;
  readonly previous?: PreviousThreadSnapshot;
  readonly generatedAt: IsoDateTime;
  readonly subject: ThreadSubject;
  readonly freshness: ThreadFreshness;
  readonly changeSet: ThreadChangeSet;
  readonly artifacts: readonly ThreadArtifact[];
  readonly consumptions: readonly ThreadArtifactConsumption[];
  readonly observations: readonly ThreadObservation[];
  readonly requirements: readonly TracedRequirement[];
  readonly evaluations: readonly RequirementEvaluation[];
  readonly violations: readonly ThreadViolation[];
  readonly provenance: readonly ThreadProvenanceLink[];
  readonly proposedActions: readonly ProposedThreadAction[];
  /**
   * Provider-neutral semantic facts. This is intentionally not provenance:
   * `derived_from` and `caused_by` retain their execution/violation semantics.
   * Present exactly for schema 1.1; see validateThreadSnapshot.
   */
  readonly analysisGraph?: AnalysisGraph;
}
