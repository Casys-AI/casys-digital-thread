import type { ThreadFreshness, ThreadGraph } from "./graph.ts";
import type {
  EngineeringCaseCatalog,
  ThreadChange,
  ThreadEvidenceFamilyGraph,
  ThreadFlowStage,
} from "./evidence.ts";

export interface ThreadArtifact {
  id: string;
  label: string;
  kind: string;
  system: string;
  /**
   * Exact canonical producer identity. `system` remains the display-system
   * facet; joins and recrosses must use this recorded operation identity.
   */
  producer?: {
    serverId: string;
    tool: string;
    runId: string;
  };
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
  /** Absent means unavailable for older producers; never an empty catalog. */
  engineeringCases?: EngineeringCaseCatalog;
  graph: ThreadGraph;
  evidenceFamilyGraph: ThreadEvidenceFamilyGraph;
  flow: ThreadFlowStage[];
  artifacts: ThreadArtifact[];
  observations: ThreadObservation[];
  requirements: ThreadRequirement[];
  violations: ThreadViolation[];
  actions: ThreadAction[];
}
