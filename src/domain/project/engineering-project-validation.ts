import type { EngineeringProjectSnapshot } from "./engineering-project.ts";
import type { ThreadSnapshot } from "../thread/thread-snapshot.ts";
import {
  EngineeringProjectValidationError,
  type EngineeringProjectValidationIssue,
  issue,
} from "./validation/engineering-project-validation-issue.ts";
import { deepFreeze } from "./validation/engineering-project-value-validation.ts";
import { collectEngineeringProjectStructureIssues } from "./validation/engineering-project-structure-validation.ts";
import { validateEngineeringProjectInvariants } from "./validation/engineering-project-invariants.ts";
import {
  allEvidenceRefs,
  snapshotKey,
  threadEntityExists,
} from "./validation/engineering-project-reference-index.ts";

export { EngineeringProjectValidationError, type EngineeringProjectValidationIssue };

/**
 * Validate untrusted project JSON, clone it and recursively freeze the result.
 * No missing project intent, decision or engineering input is inferred.
 */
export function validateEngineeringProjectSnapshot(
  value: unknown,
): EngineeringProjectSnapshot {
  const issues = collectEngineeringProjectIssues(value);
  if (issues.length > 0) throw new EngineeringProjectValidationError(issues);
  return deepFreeze(structuredClone(value)) as EngineeringProjectSnapshot;
}

export const createEngineeringProjectSnapshot = validateEngineeringProjectSnapshot;

/** Return every structural and project-graph issue without mutating input. */
export function collectEngineeringProjectIssues(
  value: unknown,
): EngineeringProjectValidationIssue[] {
  const issues = collectEngineeringProjectStructureIssues(value);
  if (issues.length === 0) {
    validateEngineeringProjectInvariants(value as EngineeringProjectSnapshot, issues);
  }
  return issues;
}

/**
 * Validate every project evidence link against the supplied exact snapshots.
 * This intentionally has no "latest snapshot" semantics.
 */
export function validateEngineeringProjectThreadReferences(
  project: EngineeringProjectSnapshot,
  snapshots: readonly ThreadSnapshot[],
): EngineeringProjectSnapshot {
  const validated = validateEngineeringProjectSnapshot(project);
  const issues = collectEngineeringProjectThreadReferenceIssues(validated, snapshots);
  if (issues.length > 0) throw new EngineeringProjectValidationError(issues);
  return validated;
}

export function collectEngineeringProjectThreadReferenceIssues(
  project: EngineeringProjectSnapshot,
  snapshots: readonly ThreadSnapshot[],
): EngineeringProjectValidationIssue[] {
  const structuralIssues = collectEngineeringProjectIssues(project);
  if (structuralIssues.length > 0) return structuralIssues;

  const issues: EngineeringProjectValidationIssue[] = [];
  const snapshotsByKey = new Map(
    snapshots.map((
      snapshot,
    ) => [snapshotKey(snapshot.id, snapshot.revision), snapshot]),
  );

  project.threadSnapshots.forEach((reference, index) => {
    const path = `$.threadSnapshots[${index}]`;
    const snapshot = snapshotsByKey.get(
      snapshotKey(reference.snapshotId, reference.revision),
    );
    if (!snapshot) {
      issue(
        issues,
        "missing_thread_snapshot",
        path,
        "does not resolve to a supplied exact ThreadSnapshot revision",
      );
      return;
    }
    if (snapshot.subject.id !== reference.subjectId) {
      issue(
        issues,
        "thread_subject_mismatch",
        `${path}.subjectId`,
        `does not match ThreadSnapshot subject ${snapshot.subject.id}`,
      );
    }
  });

  allEvidenceRefs(project).forEach(({ reference, path }) => {
    const snapshot = snapshotsByKey.get(
      snapshotKey(reference.snapshotId, reference.snapshotRevision),
    );
    if (!snapshot) return;
    if (!threadEntityExists(snapshot, reference)) {
      issue(
        issues,
        "missing_thread_entity",
        path,
        `does not resolve to a ${reference.kind} in the exact ThreadSnapshot revision`,
      );
    }
  });
  return issues;
}
