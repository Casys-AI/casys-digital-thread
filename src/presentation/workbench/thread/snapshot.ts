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
  graph: ThreadGraph;
  evidenceFamilyGraph: ThreadEvidenceFamilyGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}
