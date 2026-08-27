import type { ThreadArchitectureSysmlSealPresentation } from "./architecture.ts";
import type { ThreadComponentCatalog } from "./components.ts";
import type { ThreadFreshness, ThreadGraph } from "./graph.ts";
import type {
  EngineeringCaseCatalog,
  ThreadChange,
  ThreadEvidenceFamilyGraph,
  ThreadFlowStage,
} from "./evidence.ts";
import type { ThreadSourceFileCatalog } from "./source-files.ts";
import type { ProductNavigationProjection } from "./product-navigation.ts";

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
  /** Exact canonical producer run occurrence; never inferred from a label. */
  producerRunId?: string;
  dependsOn: string[];
  attestation?: {
    status: "verified" | "mismatch";
    sourceArtifactId: string;
    producerFingerprint: string;
    consumedFingerprint: string;
    checkedAt: string;
  };
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
  /** Native RequirementUsage identity from the Thread trace. Not the target part. */
  sourceElementId: string;
  /**
   * Exact requirements-capture/3.0 target.elementId (PartDefinition).
   * Absent until the requirements-target enricher recrosses the capture.
   */
  targetElementId?: string;
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

export interface ThreadWorkbenchPreviousSnapshot {
  snapshotId: string;
  revision: number;
}

/** Read-only L5 static-mechanical closeout projection; no command surface. */
export interface ThreadEvaluationCloseoutCriterion {
  proofCriterionId: string;
  evaluationId: string;
  status: "pass" | "fail" | "unresolved" | "error";
  evidenceArtifactId: string;
}

export interface ThreadEvaluationCloseoutEvidenceRef {
  id: string;
  fingerprint: string;
  producerRunId: string;
  freshness: "fresh" | "stale" | "unavailable";
}

export interface ThreadEvaluationCloseoutProofLimitations {
  proofScope: string;
  evidenceBoundary: string;
  cadEngineeringBoundary: {
    designIntent: "preserved" | "partial" | "lost";
    editableCad: "native" | "reconstructed" | "absent";
    manufacturability: "not-established";
    limitations: string[];
  };
}

/** Exact Thread tip reviewed by the human closeout; never a latest alias. */
export interface ThreadEvaluationCloseoutBasis {
  snapshotId: string;
  revision: number;
  fingerprint: string;
}

export interface ThreadEvaluationCloseoutCard {
  artifactId: string;
  captureFingerprint: string;
  basis: ThreadEvaluationCloseoutBasis;
  humanDisposition: "accept" | "reject";
  rejectionDisposition: "none" | "mechanical-review-required";
  acceptanceEligibility: boolean;
  status: "current" | "historical" | "unresolved";
  criteria: ThreadEvaluationCloseoutCriterion[];
  proofLimitations: ThreadEvaluationCloseoutProofLimitations;
  evidence: {
    canonicalStep: ThreadEvaluationCloseoutEvidenceRef;
    sealedProof: ThreadEvaluationCloseoutEvidenceRef;
    executionEvidence: ThreadEvaluationCloseoutEvidenceRef;
    evaluationCapture: ThreadEvaluationCloseoutEvidenceRef;
  };
}

export interface ThreadEvaluationCloseoutIndex {
  schemaVersion: "thread-evaluation-closeouts/1.0";
  family: "static-mechanical";
  status: "not-recorded" | "current" | "historical" | "unresolved" | "unavailable";
  cards: ThreadEvaluationCloseoutCard[];
}

/**
 * Browser-safe identity of one exact Thread artifact used by the assembly
 * integrity projection. It deliberately carries only persisted Thread facts:
 * no provider, runtime, profile, request, or command data crosses the BFF.
 */
export interface ThreadAssemblyIntegrityArtifactRef {
  id: string;
  uri: string;
  fingerprint: string;
  producerRunId: string;
  /** Canonical producer-declared order; never sorted or inferred for display. */
  dependsOn: string[];
  freshness: "fresh" | "stale" | "unavailable";
}

export interface ThreadAssemblyIntegrityBasis {
  snapshotId: string;
  revision: number;
  subjectId: string;
}

export type ThreadAssemblyIntegrityFact<T> =
  | { status: "observed"; value: T }
  | {
    status: "unresolved";
    reason: "identity-missing" | "observability-missing";
  }
  | { status: "unavailable"; reason: "unsupported" };

export interface ThreadAssemblyIntegrityObservationFacts {
  importability: ThreadAssemblyIntegrityFact<"imported" | "failed">;
  importFacts: {
    unitSystem: ThreadAssemblyIntegrityFact<"mm">;
    solidCount: ThreadAssemblyIntegrityFact<number>;
  };
  topology: {
    brepValidity: ThreadAssemblyIntegrityFact<"valid" | "invalid">;
    degenerateEdgeCount: ThreadAssemblyIntegrityFact<number>;
    freeEdgeCount: ThreadAssemblyIntegrityFact<number>;
    shellCount: ThreadAssemblyIntegrityFact<number>;
  };
  occurrences: Array<{
    usageElementId: string;
    target: ThreadAssemblyIntegrityFact<{ partDefinitionElementId: string }>;
    /** L3 records whether a placement was observed; it does not judge it. */
    transformStatus: "observed" | "unresolved" | "unavailable";
  }>;
  pairs: Array<{
    firstUsageElementId: string;
    secondUsageElementId: string;
    linearToleranceMm: number;
    minimumDistanceMm: ThreadAssemblyIntegrityFact<number>;
    intersectionVolumeMm3: ThreadAssemblyIntegrityFact<number>;
    contact: ThreadAssemblyIntegrityFact<"contact" | "no-contact">;
  }>;
}

/** Facts-only L3 card. It intentionally has no verdict field. */
export interface ThreadAssemblyIntegrityObservationCard {
  record: ThreadAssemblyIntegrityArtifactRef;
  basis: ThreadAssemblyIntegrityBasis;
  inputBundle: { fingerprint: string; byteCount: number };
  evidence: {
    geometryModule: ThreadAssemblyIntegrityArtifactRef;
    assemblyStep: ThreadAssemblyIntegrityArtifactRef;
  };
  facts: ThreadAssemblyIntegrityObservationFacts;
  limitations: {
    verdict: "none";
    fitness: "none";
    safety: "none";
    motion: "none";
    strength: "none";
  };
}

export interface ThreadAssemblyIntegrityEvaluationCriterion {
  id:
    | "assembly-import"
    | "occurrence-coverage"
    | "placement-recross"
    | "brep-validity"
    | "pairwise-intersection";
  verdict: "pass" | "fail" | "unresolved";
}

/** L4 card. `aggregateVerdict` is an already-recorded L4 result, not UI logic. */
export interface ThreadAssemblyIntegrityEvaluationCard {
  record: ThreadAssemblyIntegrityArtifactRef;
  basis: ThreadAssemblyIntegrityBasis;
  evidence: {
    geometryModule: ThreadAssemblyIntegrityArtifactRef;
    assemblyStep: ThreadAssemblyIntegrityArtifactRef;
    observation: ThreadAssemblyIntegrityArtifactRef;
  };
  method: { id: "assembly-integrity-evaluation"; version: "1.0"; fingerprint: string };
  criteria: ThreadAssemblyIntegrityEvaluationCriterion[];
  aggregateVerdict: "pass" | "fail" | "unresolved";
  limitations: {
    providerCalls: "none";
    genericSysmlRequirementEvaluation: "none";
    safety: "not-evaluated";
    physicalJoints: "not-evaluated";
    clearance: "not-evaluated";
    motion: "not-evaluated";
    load: "not-evaluated";
    fabricability: "not-evaluated";
  };
}

export interface ThreadAssemblyIntegrityCloseoutCard {
  record: ThreadAssemblyIntegrityArtifactRef;
  basis: {
    snapshotId: string;
    revision: number;
    fingerprint: string;
  };
  humanDisposition: "accept" | "reject";
  rejectionDisposition: "none" | "assembly-integrity-review-required";
  approvedBriefBasis: {
    projectId: string;
    projectSnapshotId: string;
    projectRevision: number;
    briefId: string;
    briefSnapshotId: string;
    briefRevision: number;
    fingerprint: string;
  };
  verificationAuthority: { id: "assembly-integrity"; version: "1.0" };
  /** Signed L5 claims, distinct from the Workbench activity-stage band. */
  gateClaims: Array<{
    gateItemId: string;
    role: "contributes-to" | "satisfies";
    status: "current" | "impact-unresolved" | "invalidated" | "carried-forward";
  }>;
  evidence: {
    evaluation: ThreadAssemblyIntegrityArtifactRef;
    geometryModule: ThreadAssemblyIntegrityArtifactRef;
    assemblyStep: ThreadAssemblyIntegrityArtifactRef;
    observation: ThreadAssemblyIntegrityArtifactRef;
  };
  l4Limitations: ThreadAssemblyIntegrityEvaluationCard["limitations"];
  limitations: {
    providerCalls: "none";
    genericSysmlRequirementEvaluation: "none";
    certification: "not-issued";
    l4PassIsNotL5: true;
  };
}

/** One exact L3 → L4 → L5 lineage, retained even after it becomes historical. */
export interface ThreadAssemblyIntegrityChain {
  id: string;
  status: "current" | "historical" | "unresolved";
  observation: ThreadAssemblyIntegrityObservationCard;
  evaluation?: ThreadAssemblyIntegrityEvaluationCard;
  closeout?: ThreadAssemblyIntegrityCloseoutCard;
}

/** Dedicated assembly-integrity family; it never contributes to RequirementMatrix. */
export interface ThreadAssemblyIntegrityIndex {
  schemaVersion: "thread-assembly-integrity/1.0";
  family: "assembly-integrity";
  status: "not-recorded" | "current" | "historical" | "unresolved" | "unavailable";
  chains: ThreadAssemblyIntegrityChain[];
}

export const THREAD_WORKBENCH_SCHEMA = "thread-workbench/0.2" as const;

export interface ThreadWorkbenchSnapshot {
  schemaVersion: typeof THREAD_WORKBENCH_SCHEMA;
  id: string;
  subject: { id: string; label: string; program: string };
  generatedAt: string;
  previous?: ThreadWorkbenchPreviousSnapshot;
  source: "observed" | "fixture";
  sourceLabel: string;
  change: ThreadChange;
  components: ThreadComponentCatalog;
  /** Absent means unavailable for older producers; never an empty catalog. */
  engineeringCases?: EngineeringCaseCatalog;
  /** Absent means the BFF has no local closeout-capture reader configured. */
  evaluationCloseouts?: ThreadEvaluationCloseoutIndex;
  /**
   * Versioned L3/L4/L5 assembly-integrity projection. This is intentionally
   * separate from SysML requirements and from static-mechanical closeouts.
   */
  assemblyIntegrity?: ThreadAssemblyIntegrityIndex;
  /**
   * Exact project source files recrossed from sealed technical admissions.
   * Absent means the BFF has no workspace recross configured.
   */
  sourceFiles?: ThreadSourceFileCatalog;
  /**
   * SysML-first navigation slice from the same application port as MCP tools.
   * Absent when the BFF has no architecture-capture reader.
   */
  productNavigation?: ProductNavigationProjection;
  graph: ThreadGraph;
  evidenceFamilyGraph: ThreadEvidenceFamilyGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}
