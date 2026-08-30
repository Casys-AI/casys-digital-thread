/**
 * Shared admission for a JIT host session after the executor's last cold
 * recheck and before claim, WAL, or provider contact.
 *
 * It does not interpret WAL journals, SysON outcomes, or project failure
 * codes. Those remain executor-owned.
 */

import type {
  EngineeringAgentRun,
  EngineeringAgentRunStatus,
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../domain/project/engineering-project.ts";
import type { ResolvedCapabilityRuntimeOperation } from "../../domain/capability/runtime/capability-runtime-supervision.ts";
import type { CapabilityRuntimeExecutionEligibility } from "../ports/out/capability/capability-runtime-supervisor.ts";
import {
  type CapabilityRuntimeExecutionSession,
  type CapabilityRuntimeExecutionSessionCoordinator,
  CapabilityRuntimeSessionUnavailableError,
} from "./capability-runtime-execution-session.ts";

export function isDurableTerminalAgentRunStatus(
  status: EngineeringAgentRunStatus,
): boolean {
  return status === "completed" || status === "failed" ||
    status === "cancelled";
}

export async function requireConfiguredOperationalCapability(input: {
  readonly runtime: CapabilityRuntimeExecutionEligibility | undefined;
  readonly session:
    | Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">
    | undefined;
  readonly project: EngineeringProjectSnapshot;
  readonly run: EngineeringAgentRun;
  readonly workItem: EngineeringWorkItem;
  readonly unavailableMessage: string;
  readonly missingBindingMessage: string;
}): Promise<ResolvedCapabilityRuntimeOperation> {
  if (!input.runtime || !input.session) {
    throw new CapabilityRuntimeSessionUnavailableError(
      input.unavailableMessage,
    );
  }
  const operation = input.workItem.operation;
  if (!operation) {
    throw new CapabilityRuntimeSessionUnavailableError(
      input.missingBindingMessage,
    );
  }
  const operational = await input.runtime.requireExecution({
    project: input.project,
    run: input.run,
    workItem: input.workItem,
    operation,
  });
  if (!operational) {
    throw new CapabilityRuntimeSessionUnavailableError(
      input.missingBindingMessage,
    );
  }
  return operational;
}

export function beginConfiguredCapabilityRuntimeSession(input: {
  readonly session: Pick<CapabilityRuntimeExecutionSessionCoordinator, "begin">;
  readonly project: EngineeringProjectSnapshot;
  readonly runId: string;
  readonly operationalCapability: ResolvedCapabilityRuntimeOperation;
  readonly recheck: () => Promise<ResolvedCapabilityRuntimeOperation>;
}): Promise<CapabilityRuntimeExecutionSession> {
  return input.session.begin({
    project: input.project,
    runId: input.runId,
    operationalCapability: input.operationalCapability,
    microsandboxExecutionProfiles: [],
    recheck: input.recheck,
  });
}

export async function settleCapabilityRuntimeSession(input: {
  readonly session: CapabilityRuntimeExecutionSession | undefined;
  readonly policy:
    | { readonly kind: "retain" }
    | { readonly kind: "release" }
    | {
      readonly kind: "release-if-terminal";
      readonly run: EngineeringAgentRun | undefined;
    };
}): Promise<void> {
  if (!input.session) return;
  if (input.policy.kind === "retain") {
    input.session.retainForRecovery();
    return;
  }
  if (input.policy.kind === "release") {
    await input.session.releaseTerminal();
    return;
  }
  if (
    input.policy.run &&
    isDurableTerminalAgentRunStatus(input.policy.run.status)
  ) {
    await input.session.releaseTerminal();
    return;
  }
  input.session.retainForRecovery();
}
