/**
 * Operator recovery for a leftover ready work item after a real successor
 * completed. Not an MCP tool and not on the canonical project path.
 *
 * Default is inspect (no write). --apply persists through the command service.
 *
 * Usage:
 *   deno task recover:work-item-successor --project-id=<id>
 *   deno task recover:work-item-successor --project-id=<id> \
 *     --failed-work-item-id=<id> --failed-run-id=<id> \
 *     --successor-run-id=<id> --rationale='...' --apply
 */
import { parseArgs } from "../lib/cli.ts";
import { createEngineeringProjectCommandRuntime } from "../../src/adapters/project/engineering-project-command-runtime.ts";
import { FileThreadSnapshotStore } from "../../src/adapters/shared/stores/file-thread-snapshot-store.ts";
import {
  FileExactThreadSnapshotDirectory,
  OrderedExactThreadSnapshotReader,
} from "../../src/adapters/shared/stores/engineering-thread-snapshot-resolver.ts";
import type {
  EngineeringAgentRun,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringThreadSnapshotRef,
  EngineeringWorkItem,
} from "../../src/domain/project/engineering-project.ts";
import {
  EngineeringProjectCommandError,
  type EngineeringProjectCommandService,
} from "../../src/application/use-cases/project/engineering-project-command-service.ts";
import type { EngineeringProjectCommandOrigin } from "../../src/application/ports/in/engineering-project-command-origin.ts";

export const DEFAULT_PROJECTS_DIR = "state/local/engineering-projects";
export const DEFAULT_SNAPSHOTS_DIR = "state/local/thread-snapshots";
export const DEFAULT_BASELINES_DIR = "config/projects/baselines";
export const RECOVER_SUCCESSOR_ACTOR: EngineeringProjectCommandOrigin = {
  kind: "agent",
  actorId: "script:recover-work-item-successor",
};

export interface RecoverSuccessorRequest {
  readonly projectId: string;
  readonly apply: boolean;
  readonly failedWorkItemId?: string;
  readonly failedRunId?: string;
  readonly successorRunId?: string;
  readonly rationale?: string;
  readonly commandId?: string;
  readonly projectsDir: string;
  readonly snapshotsDir: string;
  readonly baselinesDir: string;
}

export interface RecoverSuccessorInspect {
  readonly code: "inspect";
  readonly apply: false;
  readonly projectId: string;
  readonly revision: number;
  readonly orphans: readonly RecoverSuccessorOrphan[];
}

export interface RecoverSuccessorPreview {
  readonly code: "preview";
  readonly apply: false;
  readonly projectId: string;
  readonly revision: number;
  readonly command: RecoverSuccessorCommandView;
}

export interface RecoverSuccessorApplied {
  readonly code: "applied";
  readonly apply: true;
  readonly projectId: string;
  readonly revision: number;
  readonly command: RecoverSuccessorCommandView;
}

export type RecoverSuccessorErrorCode =
  | "invalid_input"
  | "project_not_found"
  | "entity_not_found"
  | "invalid_transition"
  | "stale_revision"
  | "permission_denied"
  | "command_id_conflict"
  | "approval_scope_mismatch";

export interface RecoverSuccessorFailure {
  readonly code: RecoverSuccessorErrorCode;
  readonly message: string;
  readonly recovery: string;
}

export type RecoverSuccessorResult =
  | RecoverSuccessorInspect
  | RecoverSuccessorPreview
  | RecoverSuccessorApplied;

export interface RecoverSuccessorOutcome {
  readonly result: RecoverSuccessorResult | RecoverSuccessorFailure;
  readonly exitCode: 0 | 1;
}

export interface RecoverSuccessorOrphan {
  readonly workItemId: string;
  readonly operation?: string;
  readonly failedRuns: readonly { readonly id: string; readonly status: string }[];
  readonly suggestedSuccessors: readonly {
    readonly workItemId: string;
    readonly runId: string;
    readonly operation?: string;
  }[];
}

export interface RecoverSuccessorCommandView {
  readonly commandId: string;
  readonly failedWorkItemId: string;
  readonly failedRunId: string;
  readonly successorRunId: string;
  readonly successorRunSnapshot: EngineeringThreadSnapshotRef;
  readonly successorEvidenceRefs: readonly EngineeringThreadEntityRef[];
  readonly rationale: string;
}

export interface RecoverSuccessorDeps {
  readonly loadProject: (
    projectId: string,
  ) => Promise<EngineeringProjectSnapshot | undefined>;
  readonly commands: Pick<
    EngineeringProjectCommandService,
    "reconcileWorkItemWithSuccessor"
  >;
  readonly now?: () => string;
}

export function parseRecoverSuccessorCli(argv: string[]): RecoverSuccessorRequest {
  const flags = parseArgs(argv);
  const projectId = flags["project-id"]?.trim();
  if (!projectId) {
    throw new TypeError("recover:work-item-successor requires --project-id.");
  }
  const apply = flags.apply === "true";
  const failedWorkItemId = emptyToUndefined(flags["failed-work-item-id"]);
  const failedRunId = emptyToUndefined(flags["failed-run-id"]);
  const successorRunId = emptyToUndefined(flags["successor-run-id"]);
  const rationale = emptyToUndefined(flags.rationale);
  const provided = [
    failedWorkItemId,
    failedRunId,
    successorRunId,
    rationale,
  ].filter((value) => value !== undefined).length;
  if ((apply || provided > 0) && provided !== 4) {
    throw new TypeError(
      "recover:work-item-successor closeout requires --failed-work-item-id, " +
        "--failed-run-id, --successor-run-id, and --rationale.",
    );
  }
  return {
    projectId,
    apply,
    failedWorkItemId,
    failedRunId,
    successorRunId,
    rationale,
    commandId: emptyToUndefined(flags["command-id"]),
    projectsDir: flags["projects-dir"] ?? DEFAULT_PROJECTS_DIR,
    snapshotsDir: flags["snapshots-dir"] ?? DEFAULT_SNAPSHOTS_DIR,
    baselinesDir: flags["baselines-dir"] ?? DEFAULT_BASELINES_DIR,
  };
}

export async function runRecoverWorkItemSuccessor(
  request: RecoverSuccessorRequest,
  deps: RecoverSuccessorDeps,
): Promise<RecoverSuccessorOutcome> {
  const project = await deps.loadProject(request.projectId);
  if (!project) {
    return failure(
      "project_not_found",
      `Project ${request.projectId} was not found.`,
      "Pass the durable project id from state/local/engineering-projects/.",
    );
  }
  if (
    request.failedWorkItemId &&
    request.failedRunId &&
    request.successorRunId &&
    request.rationale
  ) {
    try {
      const command = buildCommand(request, project);
      if (!request.apply) {
        return {
          result: {
            code: "preview",
            apply: false,
            projectId: project.project.id,
            revision: project.revision,
            command,
          },
          exitCode: 0,
        };
      }
      const next = await deps.commands.reconcileWorkItemWithSuccessor(
        RECOVER_SUCCESSOR_ACTOR,
        {
          commandId: command.commandId,
          projectId: project.project.id,
          expectedRevision: project.revision,
          issuedAt: deps.now?.() ?? new Date().toISOString(),
          failedWorkItemId: command.failedWorkItemId,
          failedRunId: command.failedRunId,
          successorRunId: command.successorRunId,
          successorRunSnapshot: command.successorRunSnapshot,
          successorEvidenceRefs: command.successorEvidenceRefs,
          rationale: command.rationale,
        },
      );
      return {
        result: {
          code: "applied",
          apply: true,
          projectId: next.project.id,
          revision: next.revision,
          command,
        },
        exitCode: 0,
      };
    } catch (error) {
      return commandFailure(error);
    }
  }
  return {
    result: {
      code: "inspect",
      apply: false,
      projectId: project.project.id,
      revision: project.revision,
      orphans: inspectOrphans(project),
    },
    exitCode: 0,
  };
}

export function inspectOrphans(
  project: EngineeringProjectSnapshot,
): readonly RecoverSuccessorOrphan[] {
  const order = workItemOrder(project);
  return project.workItems.flatMap((item) => {
    if (item.status !== "ready" || item.evidenceRefs.length !== 0) return [];
    const failedRuns = project.agentRuns.filter((run) =>
      run.workItemId === item.id && isRecoverableAnchor(run)
    );
    if (failedRuns.length === 0) return [];
    return [{
      workItemId: item.id,
      operation: operationKey(item),
      failedRuns: failedRuns.map((run) => ({ id: run.id, status: run.status })),
      suggestedSuccessors: suggestedSuccessors(project, item, order),
    }];
  });
}

function buildCommand(
  request: RecoverSuccessorRequest,
  project: EngineeringProjectSnapshot,
): RecoverSuccessorCommandView {
  const failedWorkItemId = request.failedWorkItemId!;
  const failedRunId = request.failedRunId!;
  const successorRunId = request.successorRunId!;
  const successor = project.agentRuns.find((run) => run.id === successorRunId);
  if (!successor) {
    throw new EngineeringProjectCommandError(
      "entity_not_found",
      `Successor run ${successorRunId} was not found.`,
    );
  }
  if (!successor.resultSnapshot || successor.evidenceRefs.length === 0) {
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      `Run ${successorRunId} is not a completed successor with evidence.`,
    );
  }
  return {
    commandId: request.commandId ??
      `recover:reconcile-successor:${failedWorkItemId}:${failedRunId}:${successorRunId}`,
    failedWorkItemId,
    failedRunId,
    successorRunId,
    successorRunSnapshot: structuredClone(successor.resultSnapshot),
    successorEvidenceRefs: structuredClone([...successor.evidenceRefs]),
    rationale: request.rationale!,
  };
}

function suggestedSuccessors(
  project: EngineeringProjectSnapshot,
  orphan: EngineeringWorkItem,
  order: ReadonlyMap<string, number>,
): RecoverSuccessorOrphan["suggestedSuccessors"] {
  const key = operationKey(orphan);
  const orphanOrder = order.get(orphan.id) ?? Number.POSITIVE_INFINITY;
  return project.workItems.flatMap((item) => {
    if (
      item.id === orphan.id ||
      item.status !== "completed" ||
      item.evidenceRefs.length === 0
    ) return [];
    if (key && operationKey(item) !== key) return [];
    const itemOrder = order.get(item.id) ?? Number.POSITIVE_INFINITY;
    if (itemOrder <= orphanOrder) return [];
    const run = project.agentRuns.find((candidate) =>
      candidate.workItemId === item.id &&
      candidate.status === "completed" &&
      candidate.evidenceRefs.length > 0 &&
      candidate.resultSnapshot !== undefined
    );
    if (!run) return [];
    return [{
      workItemId: item.id,
      runId: run.id,
      operation: operationKey(item),
    }];
  });
}

function workItemOrder(
  project: EngineeringProjectSnapshot,
): ReadonlyMap<string, number> {
  const order = new Map<string, number>();
  let index = 0;
  for (
    const phase of project.phases.toSorted((left, right) =>
      left.order - right.order || left.id.localeCompare(right.id)
    )
  ) {
    for (const id of phase.workItemIds) {
      if (!order.has(id)) order.set(id, index++);
    }
  }
  return order;
}

function operationKey(item: EngineeringWorkItem): string | undefined {
  return item.operation ? `${item.operation.id}@${item.operation.version}` : undefined;
}

function isRecoverableAnchor(run: EngineeringAgentRun): boolean {
  const evidenceFreeFailure = run.status === "failed" &&
    run.failure !== undefined &&
    run.evidenceRefs.length === 0;
  const preClaimCancellation = run.status === "cancelled" &&
    run.claimedAt === undefined &&
    run.startedAt === undefined &&
    run.evidenceRefs.length === 0;
  return evidenceFreeFailure || preClaimCancellation;
}

function commandFailure(error: unknown): RecoverSuccessorOutcome {
  if (error instanceof EngineeringProjectCommandError) {
    return failure(
      error.code,
      error.message,
      "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
    );
  }
  return failure(
    "invalid_input",
    error instanceof Error ? error.message : String(error),
    "Inspect first, then pass the unique failed work item, failed run, and completed successor run.",
  );
}

function failure(
  code: RecoverSuccessorErrorCode,
  message: string,
  recovery: string,
): RecoverSuccessorOutcome {
  return { result: { code, message, recovery }, exitCode: 1 };
}

function emptyToUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function main(argv: string[]): Promise<number> {
  let request: RecoverSuccessorRequest;
  try {
    request = parseRecoverSuccessorCli(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(JSON.stringify({
      code: "invalid_input",
      message,
      recovery:
        "Inspect with --project-id. Close with the four closeout flags and --apply.",
    }));
    return 1;
  }
  const snapshots = new OrderedExactThreadSnapshotReader([
    new FileThreadSnapshotStore(request.snapshotsDir),
    new FileExactThreadSnapshotDirectory(request.baselinesDir),
  ]);
  const runtime = await createEngineeringProjectCommandRuntime({
    activeDirectory: request.projectsDir,
    evidenceSnapshots: snapshots,
  });
  const outcome = await runRecoverWorkItemSuccessor(request, {
    loadProject: (projectId) => runtime.projects.get(projectId),
    commands: runtime.commands,
  });
  const sink = outcome.exitCode === 0 ? console.log : console.error;
  sink(JSON.stringify(outcome.result, null, 2));
  return outcome.exitCode;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
