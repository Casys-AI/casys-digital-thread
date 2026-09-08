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

/**
 * Read-side catalog of exact sealed cases plus one current selection per
 * conflict-free `(family, id)`. Case keys stay
 * `verification-case:<family>:<digest>`.
 */
export const ENGINEERING_CASE_CATALOG_SCHEMA = "engineering-cases/1.1" as const;

const SHA256_DIGEST = /^[a-f0-9]{64}$/;

/** Exact digest-addressed case identity. Never a label, date, or series id. */
export function verificationCaseKey(
  family: EngineeringCaseFamily,
  digest: string,
): string {
  if (!SHA256_DIGEST.test(digest)) {
    throw new TypeError("verification case digest must be lowercase SHA-256");
  }
  return `verification-case:${family}:${digest}`;
}

export const ENGINEERING_CASE_SCHEMA_BY_FAMILY = {
  "mechanical-proof": "mechanical-proof-case/1.0",
  "sensitivity-study": "sensitivity-study-case/3.0",
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
      caseSchemaVersion: "sensitivity-study-case/3.0";
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
    | "case-binding-divergent"
    | "case-current-divergent";
}

/**
 * One current selection for a conflict-free `(family, id)` group.
 * `revision` is the greatest declared revision in that group. This is not a
 * Thread `supersedes` edge and does not publish history members.
 */
export interface EngineeringCaseCurrent {
  family: EngineeringCaseFamily;
  id: string;
  currentCaseKey: string;
  revision: number;
}

export interface EngineeringCaseCurrentProjection {
  current: EngineeringCaseCurrent[];
  issues: EngineeringCaseIssue[];
}

/** Read-side catalog of exact cases found in one canonical Thread snapshot. */
export interface EngineeringCaseCatalog {
  schemaVersion: typeof ENGINEERING_CASE_CATALOG_SCHEMA;
  status: "observed" | "unresolved" | "unavailable";
  coverage: EngineeringCaseCoverage[];
  cases: EngineeringCase[];
  /**
   * Closed current selection from `cases` grouped by exact `(family, id)`.
   * Never derived from labels, dates, or digests.
   */
  current: EngineeringCaseCurrent[];
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
    current: [],
    issues: [],
  };
}

/**
 * Group exact sealed cases by `(family, id)` and select the greatest declared
 * revision. A duplicate `(family, id, revision)` or incompatible mechanical
 * targets omit only that group's current selection and report
 * `case-current-divergent`. Exact case records stay with the caller.
 */
export function projectCurrentEngineeringCases(
  cases: readonly EngineeringCase[],
): EngineeringCaseCurrentProjection {
  const groups = new Map<string, EngineeringCase[]>();
  for (const item of cases) {
    const groupKey = `${item.family}\0${item.id}`;
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }

  const current: EngineeringCaseCurrent[] = [];
  const issues: EngineeringCaseIssue[] = [];
  const sortedGroups = [...groups.values()].toSorted((left, right) =>
    compareEngineeringCaseGroupIdentity(left[0]!, right[0]!)
  );
  for (const group of sortedGroups) {
    const ordered = [...group].toSorted(compareEngineeringCases);
    if (currentGroupConflicts(ordered)) {
      issues.push(...currentConflictIssues(ordered));
      continue;
    }
    current.push(closedEngineeringCaseCurrent(ordered));
  }
  return {
    current,
    issues: issues.toSorted(compareEngineeringCaseIssues),
  };
}

function compareEngineeringCaseGroupIdentity(
  left: EngineeringCase,
  right: EngineeringCase,
): number {
  return compareCodeUnitText(left.family, right.family) ||
    compareCodeUnitText(left.id, right.id);
}

function currentGroupConflicts(group: readonly EngineeringCase[]): boolean {
  const revisions = new Set<number>();
  for (const item of group) {
    if (revisions.has(item.revision)) return true;
    revisions.add(item.revision);
  }
  return incompatibleMechanicalCurrentTarget(group);
}

function incompatibleMechanicalCurrentTarget(
  group: readonly EngineeringCase[],
): boolean {
  if (group[0]?.family !== "mechanical-proof") return false;
  const targets = new Set(
    group.map((item) =>
      item.family === "mechanical-proof" ? item.target?.modelElementId ?? "" : ""
    ),
  );
  return targets.size > 1;
}

function closedEngineeringCaseCurrent(
  ordered: readonly EngineeringCase[],
): EngineeringCaseCurrent {
  const selected = ordered[ordered.length - 1]!;
  return {
    family: selected.family,
    id: selected.id,
    currentCaseKey: selected.key,
    revision: selected.revision,
  };
}

function currentConflictIssues(
  group: readonly EngineeringCase[],
): EngineeringCaseIssue[] {
  return group.flatMap((item) =>
    item.authorityArtifactIds.map((authorityArtifactId) => ({
      family: item.family,
      authorityArtifactId,
      status: "error" as const,
      reason: "case-current-divergent" as const,
    }))
  );
}

export function compareEngineeringCases(
  left: EngineeringCase,
  right: EngineeringCase,
): number {
  return compareCodeUnitText(left.family, right.family) ||
    compareCodeUnitText(left.id, right.id) ||
    left.revision - right.revision ||
    compareCodeUnitText(left.caseDigest, right.caseDigest);
}

export function compareEngineeringCaseIssues(
  left: EngineeringCaseIssue,
  right: EngineeringCaseIssue,
): number {
  return compareCodeUnitText(left.family, right.family) ||
    compareCodeUnitText(left.authorityArtifactId, right.authorityArtifactId) ||
    compareCodeUnitText(left.reason, right.reason);
}

/** Locale-independent UTF-16 code-unit order for catalog current and issues. */
function compareCodeUnitText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
