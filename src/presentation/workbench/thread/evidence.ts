import type {
  ThreadGraphEdge,
  ThreadGraphRef,
  ThreadGraphRelation,
  ThreadRef,
} from "./graph.ts";

/**
 * Typed Engineering Case families that publish exact id + revision + case
 * digest + authority artifacts with producer run IDs.
 *
 * CAD admissions, isolated CAD execution, admitted Modelica and admitted
 * SPICE are not Engineering Cases: they do not seal that id+revision case
 * identity. Do not add them here to make the catalog look complete.
 */
export const ENGINEERING_CASE_FAMILIES = [
  "mechanical-proof",
  "sensitivity-study",
  "printability-check",
  "print-estimate",
  "dfm-check",
] as const;

export type EngineeringCaseFamily = typeof ENGINEERING_CASE_FAMILIES[number];

export const ENGINEERING_CASE_CATALOG_SCHEMA = "engineering-cases/1.0" as const;

export const ENGINEERING_CASE_SCHEMA_BY_FAMILY = {
  "mechanical-proof": "mechanical-proof-case/1.0",
  "sensitivity-study": "sensitivity-study-case/2.0",
  "printability-check": "printability-check-case/1.0",
  "print-estimate": "print-estimate-case/1.0",
  "dfm-check": "dfm-check-case/1.0",
} as const;

export type EngineeringCaseSchemaVersion =
  typeof ENGINEERING_CASE_SCHEMA_BY_FAMILY[EngineeringCaseFamily];

interface EngineeringCaseBase {
  key: string;
  id: string;
  revision: number;
  scope: string;
  caseDigest: string;
  authorityArtifactIds: string[];
}

export type EngineeringCase =
  & EngineeringCaseBase
  & (
    | {
      family: "mechanical-proof";
      caseSchemaVersion: "mechanical-proof-case/1.0";
      /** Exact proofCase.target.modelElementId; omitted when the seal did not retain it. */
      target?: { modelElementId: string };
    }
    | {
      family: "sensitivity-study";
      caseSchemaVersion: "sensitivity-study-case/2.0";
    }
    | {
      family: "printability-check";
      caseSchemaVersion: "printability-check-case/1.0";
    }
    | {
      family: "print-estimate";
      caseSchemaVersion: "print-estimate-case/1.0";
    }
    | { family: "dfm-check"; caseSchemaVersion: "dfm-check-case/1.0" }
  );

export interface EngineeringCaseCoverage {
  family: EngineeringCaseFamily;
  status: "observed" | "unavailable";
}

export interface EngineeringCaseIssue {
  family: EngineeringCaseFamily;
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
export interface EngineeringCaseCatalog {
  schemaVersion: typeof ENGINEERING_CASE_CATALOG_SCHEMA;
  status: "observed" | "unresolved" | "unavailable";
  coverage: EngineeringCaseCoverage[];
  cases: EngineeringCase[];
  issues: EngineeringCaseIssue[];
}

export function unavailableEngineeringCaseCatalog(): EngineeringCaseCatalog {
  return {
    schemaVersion: ENGINEERING_CASE_CATALOG_SCHEMA,
    status: "unavailable",
    coverage: ENGINEERING_CASE_FAMILIES.map((family) => ({
      family,
      status: "unavailable" as const,
    })),
    cases: [],
    issues: [],
  };
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
