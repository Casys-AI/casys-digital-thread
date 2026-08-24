import type {
  EngineeringAgentRun,
  EngineeringApproval,
  EngineeringApprovedBriefBasis,
  EngineeringDecision,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
} from "../engineering-project.ts";
import { sameResolvedOperationPlanRef } from "../../compile/rop/resolved-operation-plan-v2.ts";
import type { ContentFingerprint } from "../../thread/thread-snapshot.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue } from "./engineering-project-validation-issue.ts";
import { uniqueStrings } from "./engineering-project-value-validation.ts";
import { evidenceKey } from "./engineering-project-reference-index.ts";

export function sameApprovedBriefBasis(
  left: EngineeringApprovedBriefBasis,
  right: EngineeringApprovedBriefBasis,
): boolean {
  return left.projectId === right.projectId &&
    left.projectSnapshotId === right.projectSnapshotId &&
    left.projectRevision === right.projectRevision &&
    left.briefId === right.briefId &&
    left.briefSnapshotId === right.briefSnapshotId &&
    left.briefRevision === right.briefRevision &&
    fingerprintKey(left.approvedBriefFingerprint) ===
      fingerprintKey(right.approvedBriefFingerprint);
}

export function sameExecutionBinding(
  left: Pick<EngineeringApproval, "baseSnapshot" | "inputFingerprint">,
  right: Pick<EngineeringDecision, "baseSnapshot" | "inputFingerprint">,
): boolean {
  return JSON.stringify(left.baseSnapshot) === JSON.stringify(right.baseSnapshot) &&
    fingerprintKey(left.inputFingerprint) === fingerprintKey(right.inputFingerprint);
}

function fingerprintKey(value: ContentFingerprint | undefined): string {
  return value ? `${value.algorithm}:${value.digest.toLowerCase()}` : "";
}

export function sameEvidenceSet(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  return sameStringSet(left.map(evidenceKey), right.map(evidenceKey));
}

export function sameSnapshotRef(
  left: EngineeringThreadSnapshotRef,
  right: EngineeringThreadSnapshotRef,
): boolean {
  return left.snapshotId === right.snapshotId &&
    left.revision === right.revision &&
    left.subjectId === right.subjectId;
}

export function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return left.length === right.length &&
    left.every((value) => right.includes(value));
}

export function uniqueEvidence(
  values: readonly EngineeringThreadEntityRef[],
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  uniqueStrings(values.map(evidenceKey), path, issues);
}

export function requireUnique<T>(
  values: readonly T[],
  key: (value: T) => string,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const seen = new Set<string>();
  values.forEach((value, index) => {
    const candidate = key(value);
    if (seen.has(candidate)) {
      issue(issues, "duplicate_id", `${path}[${index}].id`, "must be unique");
    }
    seen.add(candidate);
  });
}

export function chronological(
  before: string | undefined,
  after: string | undefined,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (before && after && Date.parse(after) < Date.parse(before)) {
    issue(
      issues,
      "invalid_chronology",
      path,
      "cannot precede the prior lifecycle timestamp",
    );
  }
}

export function sameOptionalResolvedPlanReference(
  left: EngineeringAgentRun["resolvedOperationPlan"],
  right: EngineeringAgentRun["resolvedOperationPlan"],
): boolean {
  return left === undefined && right === undefined ||
    sameResolvedOperationPlanRef(left, right);
}
