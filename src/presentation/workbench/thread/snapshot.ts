import type { ThreadArchitectureSysmlSealPresentation } from "./architecture.ts";
import type { ThreadComponentCatalog } from "./components.ts";
import type { ThreadFreshness, ThreadGraph } from "./graph.ts";
import type {
  ThreadChange,
  ThreadEvidenceFamilyGraph,
  ThreadFlowStage,
  ThreadVerificationCaseCatalog,
} from "./evidence.ts";

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

export interface ThreadWorkbenchSnapshot {
  schemaVersion: "thread-workbench/0.1";
  id: string;
  subject: { id: string; label: string; program: string };
  generatedAt: string;
  previous?: ThreadWorkbenchPreviousSnapshot;
  source: "observed" | "fixture";
  sourceLabel: string;
  change: ThreadChange;
  components: ThreadComponentCatalog;
  /** Absent means unavailable for older 0.1 producers; never an empty catalog. */
  verificationCases?: ThreadVerificationCaseCatalog;
  /** Absent means the BFF has no local closeout-capture reader configured. */
  evaluationCloseouts?: ThreadEvaluationCloseoutIndex;
  graph: ThreadGraph;
  evidenceFamilyGraph: ThreadEvidenceFamilyGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}
