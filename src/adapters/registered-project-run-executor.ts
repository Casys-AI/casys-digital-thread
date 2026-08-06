import type {
  EngineeringProjectCommandOrigin,
  EngineeringProjectRevisionStore,
} from "../domain/engineering-project-command-service.ts";
import { EngineeringProjectCommandError } from "../domain/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import { APPROVED_BRIEF_BASELINE_OPERATION } from "../orchestration/operations/approved-brief-baseline.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../domain/platform/syson-model-seed.ts";
import type { ApprovedBriefBaselineRunExecutor } from "./executors/approved-brief-baseline-run-executor.ts";
import type { SysonModelSeedRunExecutor } from "./executors/syson-model-seed-run-executor.ts";

/** Stable command shared by the one agent-visible execution tool. */
export interface RegisteredProjectRunExecutorCommand {
  readonly commandId: string;
  readonly projectId: string;
  readonly expectedRevision: number;
  readonly issuedAt: string;
  readonly runId: string;
}

export interface RegisteredProjectRunExecutorDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly baseline: Pick<ApprovedBriefBaselineRunExecutor, "execute">;
  /** Omit only when SysON is intentionally unavailable on this server. */
  readonly sysonModelSeed?: Pick<SysonModelSeedRunExecutor, "execute">;
  /** Additional code-owned operations, such as a reviewed product kit. */
  readonly additional?: readonly RegisteredProjectRunExecutorRegistration[];
}

type ExactOperationRef = Readonly<{
  id: string;
  version: string;
}>;

type ExactOperationKey = `${string}@${string}`;

interface RegisteredOperationExecutor {
  execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot>;
}

/**
 * Server-owned registration for one exact reviewed operation revision.
 *
 * The agent still supplies only a queued run identity. The composition root
 * chooses which reviewed operations have an available trusted executor.
 */
export interface RegisteredProjectRunExecutorRegistration {
  readonly operation: ExactOperationRef;
  readonly executor?: RegisteredOperationExecutor;
  /** Safe reason exposed when a reviewed capability is intentionally absent. */
  readonly unavailableMessage?: string;
}

interface ExecutorDispatchEntry {
  readonly executor: RegisteredOperationExecutor | undefined;
  /** Preserves the reviewed fail-closed reason when a local capability is absent. */
  readonly unavailableMessage?: string;
}

type ExecutorDispatch = ReadonlyMap<ExactOperationKey, ExecutorDispatchEntry>;

/**
 * Server-owned dispatch over exact reviewed operation identities.
 *
 * The MCP tool calls this class with an agent-queued run id only. It cannot pick
 * a provider, tool, argument, file or arbitrary workflow; each concrete
 * executor still rechecks the exact project/run shape before it performs work.
 */
export class RegisteredProjectRunExecutor {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #dispatch: ExecutorDispatch;

  constructor(dependencies: RegisteredProjectRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    const registrations: readonly RegisteredProjectRunExecutorRegistration[] = [
      {
        operation: APPROVED_BRIEF_BASELINE_OPERATION,
        executor: dependencies.baseline,
      },
      {
        operation: SYSON_MODEL_SEED_OPERATION,
        executor: dependencies.sysonModelSeed,
        unavailableMessage:
          "The server has no trusted SysON model-seed executor configured for this run.",
      },
      ...(dependencies.additional ?? []),
    ];
    const dispatch = new Map<ExactOperationKey, ExecutorDispatchEntry>();
    for (const registration of registrations) {
      const key = operationKey(registration.operation);
      if (dispatch.has(key)) {
        throw new Error(`Duplicate trusted executor registration for ${key}.`);
      }
      dispatch.set(key, {
        executor: registration.executor,
        ...(registration.unavailableMessage
          ? { unavailableMessage: registration.unavailableMessage }
          : {}),
      });
    }
    this.#dispatch = dispatch;
  }

  async execute(
    origin: EngineeringProjectCommandOrigin,
    command: RegisteredProjectRunExecutorCommand,
  ): Promise<EngineeringProjectSnapshot> {
    const project = await this.#projects.get(command.projectId);
    if (!project) {
      throw new EngineeringProjectCommandError(
        "project_not_found",
        `Engineering project ${command.projectId} does not exist.`,
      );
    }
    const run = project.agentRuns.find((candidate) => candidate.id === command.runId);
    const workItem = run
      ? project.workItems.find((candidate) => candidate.id === run.workItemId)
      : undefined;
    const operation = workItem?.operation;
    if (!run || !operation) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The requested run does not identify a registered executable operation.",
      );
    }
    const entry = this.#dispatch.get(operationKey(operation));
    if (!entry) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        "The requested run is not backed by a trusted registered executor.",
      );
    }
    if (!entry.executor) {
      throw new EngineeringProjectCommandError(
        "invalid_transition",
        entry.unavailableMessage ??
          "The requested run is not backed by a trusted registered executor.",
      );
    }
    return await entry.executor.execute(origin, command);
  }
}

function operationKey<Operation extends ExactOperationRef>(
  operation: Operation,
): `${Operation["id"]}@${Operation["version"]}` {
  return `${operation.id}@${operation.version}` as `${Operation["id"]}@${Operation[
    "version"
  ]}`;
}
