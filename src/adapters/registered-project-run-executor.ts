import type {
  EngineeringProjectCommandOrigin,
  EngineeringProjectRevisionStore,
} from "../domain/engineering-project-command-service.ts";
import { EngineeringProjectCommandError } from "../domain/engineering-project-command-service.ts";
import type { EngineeringProjectSnapshot } from "../domain/engineering-project.ts";
import {
  APPROVED_DISCOVERY_BASELINE_OPERATION,
} from "../orchestration/operations/approved-discovery-baseline.ts";
import { SYSON_MODEL_SEED_OPERATION } from "../domain/syson-model-seed.ts";
import type { ApprovedDiscoveryBaselineRunExecutor } from "./approved-discovery-baseline-run-executor.ts";
import type { SysonModelSeedRunExecutor } from "./syson-model-seed-run-executor.ts";

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
  readonly baseline: Pick<ApprovedDiscoveryBaselineRunExecutor, "execute">;
  /** Omit only when SysON is intentionally unavailable on this server. */
  readonly sysonModelSeed?: Pick<SysonModelSeedRunExecutor, "execute">;
}

/**
 * Server-owned dispatch over exact reviewed operation identities.
 *
 * The MCP tool calls this class with a human-queued run id only. It cannot pick
 * a provider, tool, argument, file or arbitrary workflow; each concrete
 * executor still rechecks the exact project/run shape before it performs work.
 */
export class RegisteredProjectRunExecutor {
  readonly #projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly #baseline: Pick<ApprovedDiscoveryBaselineRunExecutor, "execute">;
  readonly #sysonModelSeed: Pick<SysonModelSeedRunExecutor, "execute"> | undefined;

  constructor(dependencies: RegisteredProjectRunExecutorDependencies) {
    this.#projects = dependencies.projects;
    this.#baseline = dependencies.baseline;
    this.#sysonModelSeed = dependencies.sysonModelSeed;
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
    if (sameOperation(operation, APPROVED_DISCOVERY_BASELINE_OPERATION)) {
      return await this.#baseline.execute(origin, command);
    }
    if (sameOperation(operation, SYSON_MODEL_SEED_OPERATION)) {
      if (!this.#sysonModelSeed) {
        throw new EngineeringProjectCommandError(
          "invalid_transition",
          "The server has no trusted SysON model-seed executor configured for this run.",
        );
      }
      return await this.#sysonModelSeed.execute(origin, command);
    }
    throw new EngineeringProjectCommandError(
      "invalid_transition",
      "The requested run is not backed by a trusted registered executor.",
    );
  }
}

function sameOperation(
  value: { readonly id: string; readonly version: string },
  expected: { readonly id: string; readonly version: string },
): boolean {
  return value.id === expected.id && value.version === expected.version;
}
