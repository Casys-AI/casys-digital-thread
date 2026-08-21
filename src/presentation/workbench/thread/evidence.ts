import type {
  ThreadGraphEdge,
  ThreadGraphRef,
  ThreadGraphRelation,
  ThreadRef,
} from "./graph.ts";

export type ThreadVerificationCaseFamily =
  | "mechanical-proof"
  | "sensitivity-study"
;

interface ThreadVerificationCaseBase {
  key: string;
  id: string;
  revision: number;
  scope: string;
  caseDigest: string;
  authorityArtifactIds: string[];
}

export type ThreadVerificationCase =
  & ThreadVerificationCaseBase
  & (
    | { family: "mechanical-proof"; caseSchemaVersion: "mechanical-proof-case/1.0" }
    | { family: "sensitivity-study"; caseSchemaVersion: "sensitivity-study-case/2.0" }
  );

export interface ThreadVerificationCaseCoverage {
  family: ThreadVerificationCaseFamily;
  status: "observed" | "unavailable";
}

export interface ThreadVerificationCaseIssue {
  family: ThreadVerificationCaseFamily;
  authorityArtifactId: string;
  status: "unavailable" | "error";
  reason:
    | "capture-reader-unavailable"
    | "artifact-binding-invalid"
    | "capture-unavailable"
    | "capture-invalid"
    | "case-binding-divergent";
}

/** Read-side catalog of exact cases found in one canonical Thread snapshot. */
export interface ThreadVerificationCaseCatalog {
  schemaVersion: "thread-verification-cases/1.0";
  status: "observed" | "unresolved" | "unavailable";
  coverage: ThreadVerificationCaseCoverage[];
  cases: ThreadVerificationCase[];
  issues: ThreadVerificationCaseIssue[];
}

export interface ThreadEvidenceFamilyGraph {
  schemaVersion: "thread-evidence-family-graph/1.0";
  asOf: { snapshotId: string; revision: number };
  families: ThreadEvidenceFamily[];
  edges: ThreadEvidenceFamilyGraphEdge[];
  omittedSelfLoops: ThreadEvidenceFamilyOmittedSelfLoop[];
  omittedCycleEdges: ThreadEvidenceFamilyOmittedCycleEdge[];
}

export interface ThreadEvidenceFamily {
  id: string;
  entityKind: "artifact" | "requirement";
  artifactKind?: string;
  historicalRefs: ThreadGraphRef[];
  currentRefs: ThreadGraphRef[];
  revisionCount: number;
  status: "current" | "review-required";
  reviewReason?: "divergent-successors" | "no-current-successor";
  relationship: {
    relation: "supersedes";
    classification: "not-recorded";
    equivalence: "not-recorded";
  };
  transitions: ThreadEvidenceFamilyTransition[];
}

export interface ThreadEvidenceFamilyTransition {
  edgeRef: ThreadEvidenceFamilyEdgeRef;
  historical: ThreadGraphRef;
  successor: ThreadGraphRef;
}

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
  freshness: import("./graph.ts").ThreadFreshness;
  summary: string;
  selection: ThreadRef;
  dependsOn: string[];
}
