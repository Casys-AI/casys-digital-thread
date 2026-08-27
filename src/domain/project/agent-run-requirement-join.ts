/**
 * Read-time projection of Thread evaluations and observations onto agent runs.
 *
 * The Thread snapshot is the authority. This module copies fresh records
 * produced by one completed run into optional `join` / `observations` fields
 * on the MCP project snapshot. They are not stored on `EngineeringAgentRun`
 * and confer no new verdict authority.
 */

import { deepFreeze } from "../kernel/case-validation.ts";
import type {
  RequirementEvaluation,
  RequirementEvaluationStatus,
  ThreadObservation,
} from "../thread/thread-snapshot.ts";
import type {
  EngineeringAgentRun,
  EngineeringOperationRef,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "./engineering-project.ts";

export const REQUIREMENT_JOIN_OPERATIONS = [
  { id: "verify.run-fea-static-proof", version: "1" },
  { id: "verify.run-fea-static-proof", version: "2" },
  { id: "verify.run-fea-static-proof", version: "3" },
  { id: "verify.evaluate-sensitivity-base", version: "1" },
  { id: "industrialize.run-dfm-checks", version: "1" },
] as const;

export const THREAD_OBSERVATION_OPERATIONS = [
  { id: "verify.run-fea-static-proof", version: "1" },
  { id: "verify.run-fea-static-proof", version: "2" },
  { id: "verify.run-fea-static-proof", version: "3" },
  { id: "analyze.run-fea-sensitivity", version: "1" },
  { id: "industrialize.run-dfm-checks", version: "1" },
  { id: "industrialize.observe-printability", version: "1" },
  { id: "industrialize.observe-print-estimate", version: "1" },
] as const;

export type AgentRunRequirementJoinStatus =
  | RequirementEvaluationStatus
  | "unavailable";

export interface AgentRunRequirementJoin {
  readonly status: AgentRunRequirementJoinStatus;
  readonly evaluations: readonly RequirementEvaluation[];
}

export type AgentRunObservations =
  | { readonly status: "unavailable"; readonly items: readonly [] }
  | { readonly items: readonly ThreadObservation[] };

export type EngineeringAgentRunView = EngineeringAgentRun & {
  readonly join?: AgentRunRequirementJoin;
  readonly observations?: AgentRunObservations;
};

export type EngineeringProjectSnapshotView =
  & Omit<EngineeringProjectSnapshot, "agentRuns">
  & {
    readonly agentRuns: readonly EngineeringAgentRunView[];
  };

export interface AgentRunJoinThreadSnapshot {
  readonly id: string;
  readonly revision: number;
  readonly subject: { readonly id: string };
  readonly evaluations: readonly RequirementEvaluation[];
  readonly observations: readonly ThreadObservation[];
}

export function isRequirementJoinOperation(
  operation: EngineeringOperationRef | undefined,
): boolean {
  return matchesOperation(operation, REQUIREMENT_JOIN_OPERATIONS);
}

export function isThreadObservationOperation(
  operation: EngineeringOperationRef | undefined,
): boolean {
  return matchesOperation(operation, THREAD_OBSERVATION_OPERATIONS);
}

export function runNeedsThreadProjection(
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem | undefined,
): boolean {
  return isCompletedJoinRun(run, workItem) ||
    isCompletedObservationRun(run, workItem);
}

/**
 * Attach `join` and/or `observations` on completed runs that publish those
 * Thread records. Other runs are unchanged. Missing Thread facts stay
 * `unavailable`. Returns the input snapshot when nothing needs a projection.
 */
export function assembleAgentRunRequirementJoins(
  project: EngineeringProjectSnapshot,
  threads: ReadonlyMap<string, AgentRunJoinThreadSnapshot>,
): EngineeringProjectSnapshotView {
  const workById = new Map(
    project.workItems.map((item) => [item.id, item] as const),
  );
  if (
    !project.agentRuns.some((run) =>
      runNeedsThreadProjection(run, workById.get(run.workItemId))
    )
  ) {
    return project;
  }
  return deepFreeze({
    ...project,
    agentRuns: project.agentRuns.map((run) =>
      projectThreadFactsOnRun(run, workById.get(run.workItemId), threads)
    ),
  });
}

function projectThreadFactsOnRun(
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem | undefined,
  threads: ReadonlyMap<string, AgentRunJoinThreadSnapshot>,
): EngineeringAgentRunView {
  const joinCapable = isCompletedJoinRun(run, workItem);
  const observationCapable = isCompletedObservationRun(run, workItem);
  if (!joinCapable && !observationCapable) return run;
  const opened = openRunThread(run, threads);
  const evidenceIds = artifactEvidenceIds(run);
  const evaluations = opened
    ? opened.evaluations.filter((evaluation) =>
      evaluation.freshness.status === "fresh" &&
      evaluation.evidenceArtifactIds.some((id) => evidenceIds.has(id))
    )
    : [];
  const items = opened
    ? opened.observations.filter((observation) =>
      observation.freshness.status === "fresh" &&
      observation.source.artifactIds.some((id) => evidenceIds.has(id))
    )
    : [];
  return deepFreeze({
    ...run,
    ...(joinCapable
      ? {
        join: evaluations.length === 0
          ? { status: "unavailable" as const, evaluations: [] }
          : { status: rollupJoinStatus(evaluations), evaluations },
      }
      : {}),
    ...(observationCapable
      ? {
        observations: items.length === 0
          ? { status: "unavailable" as const, items: [] }
          : { items },
      }
      : {}),
  });
}

function openRunThread(
  run: EngineeringAgentRun,
  threads: ReadonlyMap<string, AgentRunJoinThreadSnapshot>,
): AgentRunJoinThreadSnapshot | undefined {
  const result = run.resultSnapshot;
  if (!result) return undefined;
  const thread = threads.get(result.snapshotId);
  if (
    !thread ||
    thread.id !== result.snapshotId ||
    thread.revision !== result.revision ||
    thread.subject.id !== result.subjectId
  ) {
    return undefined;
  }
  return thread;
}

function artifactEvidenceIds(run: EngineeringAgentRun): ReadonlySet<string> {
  return new Set(
    run.evidenceRefs
      .filter((ref) => ref.kind === "artifact")
      .map((ref) => ref.id),
  );
}

function isCompletedJoinRun(
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem | undefined,
): boolean {
  return run.status === "completed" &&
    isRequirementJoinOperation(workItem?.operation);
}

function isCompletedObservationRun(
  run: EngineeringAgentRun,
  workItem: EngineeringWorkItem | undefined,
): boolean {
  return run.status === "completed" &&
    isThreadObservationOperation(workItem?.operation);
}

function matchesOperation(
  operation: EngineeringOperationRef | undefined,
  catalog: readonly { readonly id: string; readonly version: string }[],
): boolean {
  if (!operation) return false;
  return catalog.some((candidate) =>
    candidate.id === operation.id && candidate.version === operation.version
  );
}

function rollupJoinStatus(
  evaluations: readonly RequirementEvaluation[],
): AgentRunRequirementJoinStatus {
  if (evaluations.some((item) => item.status === "fail")) return "fail";
  if (evaluations.some((item) => item.status === "error")) return "error";
  if (evaluations.some((item) => item.status === "unresolved")) {
    return "unresolved";
  }
  if (evaluations.every((item) => item.status === "pass")) return "pass";
  return "unavailable";
}
