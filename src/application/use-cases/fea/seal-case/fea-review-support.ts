/**
 * Shared FEA review parsing and next-hop compilation.
 *
 * The unique current Thread tip lives in `domain/project/thread-tip.ts`.
 * Omitting `basis` is not `latest`.
 */

import { deepFreeze } from "../../../../domain/kernel/case-validation.ts";
import type {
  EngineeringDecisionProposalParameter,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringThreadSnapshotBasis,
  EngineeringThreadSnapshotRef,
} from "../../../../domain/project/engineering-project.ts";
import type { ThreadSnapshot } from "../../../../domain/thread/thread-snapshot.ts";
import type { ThreadSnapshotStore } from "../../../../domain/thread/thread-snapshot-store.ts";
import { validateThreadSnapshot } from "../../../../domain/thread/thread-snapshot-validation.ts";
import {
  isLatestSnapshotId,
  parseThreadSnapshotBasis,
  selectCurrentThreadTip,
} from "../../../../domain/project/thread-tip.ts";

export type FeaReviewBasisDiagnosticCode =
  | "basis-latest"
  | "basis-mismatch"
  | "basis-absent"
  | "basis-ambiguous";

export interface FeaReviewBasisDiagnostic {
  readonly code: FeaReviewBasisDiagnosticCode;
  readonly artifactId: string | null;
  readonly message: string;
}

export interface FeaReviewProjectReader {
  get(projectId: string): Promise<EngineeringProjectSnapshot | undefined>;
}

export interface FeaReviewSnapshotStore extends ThreadSnapshotStore {
  getFresh?(snapshotId: string): Promise<ThreadSnapshot | undefined>;
}

export function parseOptionalThreadBasis(
  value: unknown,
  path: string,
): EngineeringThreadSnapshotBasis | undefined {
  if (value === undefined) return undefined;
  return parseThreadSnapshotBasis(value, path);
}

export { parseThreadSnapshotBasis as parseThreadBasis };

export function sameExactBasis(
  snapshot: ThreadSnapshot,
  basis: EngineeringThreadSnapshotBasis,
): boolean {
  return snapshot.id === basis.snapshotId &&
    snapshot.revision === basis.revision &&
    snapshot.subject.id === basis.subjectId;
}

export async function resolveFeaReviewBasis(input: {
  readonly projectId: string;
  readonly named?: EngineeringThreadSnapshotBasis;
  readonly projects?: FeaReviewProjectReader;
}): Promise<
  | {
    readonly status: "ok";
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly project?: EngineeringProjectSnapshot;
  }
  | { readonly status: "unresolved"; readonly diagnostic: FeaReviewBasisDiagnostic }
  | { readonly status: "project_not_found" }
> {
  const project = input.projects
    ? await input.projects.get(input.projectId)
    : undefined;
  if (input.projects && !project) return { status: "project_not_found" };
  if (input.named) {
    if (isLatestSnapshotId(input.named.snapshotId)) {
      return {
        status: "unresolved",
        diagnostic: {
          code: "basis-latest",
          artifactId: null,
          message:
            "The Thread basis snapshotId must be an exact snapshot. latest is refused.",
        },
      };
    }
    return {
      status: "ok",
      basis: input.named,
      ...(project ? { project } : {}),
    };
  }
  if (!project) {
    return {
      status: "unresolved",
      diagnostic: {
        code: "basis-absent",
        artifactId: null,
        message:
          "No Thread basis was named and the server has no project ledger to resolve the current tip.",
      },
    };
  }
  const selected = selectCurrentThreadTip(project.threadSnapshots);
  if (selected.status !== "ok") return selected;
  return { status: "ok", basis: selected.basis, project };
}

export async function readThreadSnapshot(
  snapshots: FeaReviewSnapshotStore,
  snapshotId: string,
): Promise<ThreadSnapshot | undefined> {
  if (snapshots.getFresh) return await snapshots.getFresh(snapshotId);
  return await snapshots.get(snapshotId);
}

export type ReopenedThreadBasis =
  | { readonly status: "ok"; readonly snapshot: ThreadSnapshot }
  | { readonly status: "unresolved"; readonly diagnostic: FeaReviewBasisDiagnostic }
  | { readonly status: "snapshot_not_found" }
  | { readonly status: "snapshot_resolution_failed" };

export type OpenedFeaReviewSnapshot =
  | {
    readonly status: "ok";
    readonly basis: EngineeringThreadSnapshotBasis;
    readonly snapshot: ThreadSnapshot;
    readonly project?: EngineeringProjectSnapshot;
  }
  | {
    readonly status: "unresolved";
    readonly diagnostic: FeaReviewBasisDiagnostic;
    readonly basis?: EngineeringThreadSnapshotBasis;
  }
  | { readonly status: "project_not_found" }
  | { readonly status: "snapshot_not_found" }
  | { readonly status: "snapshot_resolution_failed" };

/**
 * Resolve the named or current Thread tip and reopen those exact bytes.
 * Storage misses stay distinct from unresolved join diagnostics.
 */
export async function openFeaReviewSnapshot(input: {
  readonly projectId: string;
  readonly named?: EngineeringThreadSnapshotBasis;
  readonly projects?: FeaReviewProjectReader;
  readonly snapshots: FeaReviewSnapshotStore;
}): Promise<OpenedFeaReviewSnapshot> {
  const resolved = await resolveFeaReviewBasis({
    projectId: input.projectId,
    named: input.named,
    projects: input.projects,
  });
  if (resolved.status === "project_not_found") return resolved;
  if (resolved.status !== "ok") {
    return { status: "unresolved", diagnostic: resolved.diagnostic };
  }
  const reopened = await reopenExactThreadBasis(input.snapshots, resolved.basis);
  if (reopened.status === "unresolved") {
    return {
      status: "unresolved",
      diagnostic: reopened.diagnostic,
      basis: resolved.basis,
    };
  }
  if (reopened.status !== "ok") return reopened;
  return {
    status: "ok",
    basis: resolved.basis,
    snapshot: reopened.snapshot,
    ...(resolved.project ? { project: resolved.project } : {}),
  };
}

export function threadSnapshotRefFromBasis(
  basis: EngineeringThreadSnapshotBasis,
): EngineeringThreadSnapshotRef {
  return deepFreeze({
    snapshotId: basis.snapshotId,
    revision: basis.revision,
    subjectId: basis.subjectId,
  });
}

export function feaReviewNext(input: {
  readonly operation: EngineeringOperationRef;
  readonly summary: string;
  readonly parameters: readonly EngineeringDecisionProposalParameter[];
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly expectedRevision: number;
  readonly phaseId: string;
  readonly phaseName: string;
  readonly phaseDescription: string;
  readonly workItemId: string;
  readonly decisionId: string;
  readonly decisionTitle: string;
  readonly decisionQuestion: string;
  readonly dependsOnWorkItemIds?: readonly string[];
  /** Names the failed leaf so the project stamps the same activityId. */
  readonly predecessorRevisionId?: string;
  /** Reuse an already-declared phase; emit `phases: []`. */
  readonly reuseExistingPhase?: boolean;
}): {
  readonly append: {
    readonly tool: "project_change_append";
    readonly arguments: {
      readonly baseSnapshot: EngineeringThreadSnapshotRef;
      readonly expectedRevision: number;
      readonly phases: readonly {
        readonly id: string;
        readonly name: string;
        readonly description: string;
      }[];
      readonly workItems: readonly {
        readonly id: string;
        readonly phaseId: string;
        readonly owner: "agent";
        readonly dependsOnWorkItemIds: readonly string[];
        readonly decisionIds: readonly string[];
        readonly predecessorRevisionId?: string;
        readonly operation: EngineeringOperationRef;
      }[];
      readonly requiredDecisions: readonly {
        readonly id: string;
        readonly phaseId: string;
        readonly title: string;
        readonly question: string;
      }[];
    };
  };
  readonly propose: {
    readonly tool: "project_decision_propose";
    readonly arguments: {
      readonly decisionId: string;
      readonly proposal: {
        readonly summary: string;
        readonly parameters: readonly EngineeringDecisionProposalParameter[];
      };
    };
  };
  readonly queue: {
    readonly tool: "project_agent_run_queue";
    readonly workItemId: string;
  };
} {
  return deepFreeze({
    append: {
      tool: "project_change_append",
      arguments: {
        baseSnapshot: threadSnapshotRefFromBasis(input.basis),
        expectedRevision: input.expectedRevision,
        phases: input.reuseExistingPhase ? [] : [{
          id: input.phaseId,
          name: input.phaseName,
          description: input.phaseDescription,
        }],
        workItems: [{
          id: input.workItemId,
          phaseId: input.phaseId,
          owner: "agent",
          dependsOnWorkItemIds: [...(input.dependsOnWorkItemIds ?? [])],
          decisionIds: [input.decisionId],
          ...(input.predecessorRevisionId
            ? { predecessorRevisionId: input.predecessorRevisionId }
            : {}),
          operation: input.operation,
        }],
        requiredDecisions: [{
          id: input.decisionId,
          phaseId: input.phaseId,
          title: input.decisionTitle,
          question: input.decisionQuestion,
        }],
      },
    },
    propose: {
      tool: "project_decision_propose",
      arguments: {
        decisionId: input.decisionId,
        proposal: {
          summary: input.summary,
          parameters: input.parameters,
        },
      },
    },
    queue: {
      tool: "project_agent_run_queue",
      workItemId: input.workItemId,
    },
  });
}

export type FeaReviewNextDiagnosticCode =
  | "project-state-unavailable"
  | "project-state-mismatch"
  | "basis-not-current"
  | "compiled-identities-conflict";

export interface FeaReviewNextDiagnostic {
  readonly code: FeaReviewNextDiagnosticCode;
  readonly artifactId: null;
  readonly message: string;
}

/** Prove that a compiled append is valid against the observed project head. */
export function validateFeaReviewNextState(input: {
  readonly project?: EngineeringProjectSnapshot;
  readonly projectId: string;
  readonly basis: EngineeringThreadSnapshotBasis;
  readonly phaseId: string;
  readonly workItemId: string;
  readonly decisionId: string;
  /** Existing phase is reused, not declared again. */
  readonly reuseExistingPhase?: boolean;
}):
  | { readonly status: "ready"; readonly expectedRevision: number }
  | {
    readonly status: "unavailable" | "unresolved";
    readonly diagnostic: FeaReviewNextDiagnostic;
  } {
  const project = input.project;
  if (!project) {
    return nextRefusal(
      "unavailable",
      "project-state-unavailable",
      "The review compiled engineering identities, but no project ledger was available to prove a paste-ready append. No next hop is emitted.",
    );
  }
  if (
    project.project.id !== input.projectId ||
    project.project.subjectId !== input.basis.subjectId
  ) {
    return nextRefusal(
      "unresolved",
      "project-state-mismatch",
      "The reopened project identity does not match the requested project and Thread subject. No next hop is emitted.",
    );
  }
  const current = selectCurrentThreadTip(project.threadSnapshots);
  if (
    current.status !== "ok" ||
    current.basis.snapshotId !== input.basis.snapshotId ||
    current.basis.revision !== input.basis.revision ||
    current.basis.subjectId !== input.basis.subjectId
  ) {
    const detail = current.status === "ok"
      ? `Current head is ${current.basis.snapshotId} r${current.basis.revision}; review basis is ${input.basis.snapshotId} r${input.basis.revision}.`
      : current.diagnostic.message;
    return nextRefusal(
      "unavailable",
      "basis-not-current",
      `The review basis is historical or the current project head is not unique. ${detail} No paste-ready append is emitted.`,
    );
  }
  if (input.reuseExistingPhase) {
    if (!project.phases.some((item) => item.id === input.phaseId)) {
      return nextRefusal(
        "unresolved",
        "project-state-mismatch",
        `The successor append reuses phase ${input.phaseId}, but that phase is absent from project state. No next hop is emitted.`,
      );
    }
  }
  const conflicts = [
    ...(input.reuseExistingPhase
      ? []
      : project.phases.some((item) => item.id === input.phaseId)
      ? [`phase ${input.phaseId}`]
      : []),
    ...(project.workItems.some((item) => item.id === input.workItemId)
      ? [`work item ${input.workItemId}`]
      : []),
    ...(project.decisions.some((item) => item.id === input.decisionId)
      ? [`decision ${input.decisionId}`]
      : []),
  ];
  if (conflicts.length > 0) {
    return nextRefusal(
      "unresolved",
      "compiled-identities-conflict",
      `The server-compiled append identities already exist in project state (${
        conflicts.join(", ")
      }). The review will not suggest a duplicate append.`,
    );
  }
  return { status: "ready", expectedRevision: project.revision };
}

function nextRefusal(
  status: "unavailable" | "unresolved",
  code: FeaReviewNextDiagnosticCode,
  message: string,
): {
  readonly status: "unavailable" | "unresolved";
  readonly diagnostic: FeaReviewNextDiagnostic;
} {
  return {
    status,
    diagnostic: { code, artifactId: null, message },
  };
}

/** Reopen one named basis and prove the bytes are that exact snapshot. */
export async function reopenExactThreadBasis(
  snapshots: FeaReviewSnapshotStore,
  basis: EngineeringThreadSnapshotBasis,
): Promise<ReopenedThreadBasis> {
  let snapshot: ThreadSnapshot | undefined;
  try {
    snapshot = await readThreadSnapshot(snapshots, basis.snapshotId);
  } catch {
    return { status: "snapshot_resolution_failed" };
  }
  if (!snapshot) return { status: "snapshot_not_found" };
  const validated = validateThreadSnapshot(snapshot);
  if (!sameExactBasis(validated, basis)) {
    return {
      status: "unresolved",
      diagnostic: {
        code: "basis-mismatch",
        artifactId: validated.id,
        message: `The reopened Thread snapshot is not the exact named basis ` +
          `(${basis.snapshotId} r${basis.revision} ${basis.subjectId}).`,
      },
    };
  }
  return { status: "ok", snapshot: validated };
}
