import type {
  EngineeringAgentRun,
  EngineeringCommandOriginKind,
  EngineeringProjectCommandName,
  EngineeringProjectSnapshot,
} from "../../../../domain/project/engineering-project.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import { EngineeringProjectCommandError } from "./engineering-project-command-error.ts";
import type { EngineeringProjectPlanningDependencies } from "./engineering-project-commands.ts";
import { findWorkItem } from "./engineering-project-transition-values.ts";

/**
 * Static origin grants. Humans do not globally receive run claim / progress /
 * publish / complete / fail. Those lifecycle commands stay agent-origin for
 * ordinary registered work. `runTransition` additionally proves the queued
 * operation against the reviewed registry: a human origin may drive them only
 * when that exact operation is `mustOrigin: "human"`, and an agent origin
 * cannot drive that same human-only lifecycle.
 */
export const ENGINEERING_PROJECT_COMMAND_POLICY = {
  human: [
    "decision.propose",
    "decision.approve",
    "decision.reject",
    "agent-run.queue",
    "agent-run.cancel",
    "agent-run.reconcile-annotation",
    "impact-decision.accept",
    "work-item.abandon",
  ],
  agent: [
    "project.plan-publish",
    "project.change-append",
    "work-item.reconcile-successor",
    "decision.propose",
    "agent-run.queue",
    "agent-run.claim",
    "agent-run.progress",
    "agent-run.publish",
    "agent-run.complete",
    "agent-run.fail",
  ],
} as const;

const HUMAN_ORIGIN_RUN_LIFECYCLE_COMMANDS = [
  "agent-run.claim",
  "agent-run.progress",
  "agent-run.publish",
  "agent-run.complete",
  "agent-run.fail",
] as const satisfies readonly EngineeringProjectCommandName[];

export function assertAllowed(
  origin: EngineeringCommandOriginKind,
  type: EngineeringProjectCommandName,
): void {
  const allowed: readonly string[] = ENGINEERING_PROJECT_COMMAND_POLICY[origin];
  if (allowed.includes(type)) return;
  if (origin === "human" && isHumanOriginRunLifecycleCommand(type)) {
    return;
  }
  throw new EngineeringProjectCommandError(
    "permission_denied",
    `${origin} origin cannot execute ${type}.`,
  );
}

function isHumanOriginRunLifecycleCommand(
  type: EngineeringProjectCommandName,
): boolean {
  return (HUMAN_ORIGIN_RUN_LIFECYCLE_COMMANDS as readonly string[]).includes(
    type,
  );
}

/**
 * Separate the static command table from the queued operation's reviewed
 * origin. Lifecycle actor and operation authority stay the same human origin
 * when the registry marks the exact operation `mustOrigin: "human"`. Ordinary
 * runs stay agent-origin; missing registry proof fails closed for humans.
 */
export function assertRunLifecycleOrigin(
  origin: EngineeringProjectCommandOrigin,
  planning: EngineeringProjectPlanningDependencies | undefined,
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
  type: EngineeringProjectCommandName,
): void {
  if (registeredRunMustOriginHuman(planning, project, run)) {
    if (origin.kind === "human") return;
    throw new EngineeringProjectCommandError(
      "permission_denied",
      `${origin.kind} origin cannot execute ${type} on a mustOrigin:human operation.`,
    );
  }
  if (origin.kind === "agent") return;
  throw new EngineeringProjectCommandError(
    "permission_denied",
    `${origin.kind} origin cannot execute ${type}.`,
  );
}

function registeredRunMustOriginHuman(
  planning: EngineeringProjectPlanningDependencies | undefined,
  project: EngineeringProjectSnapshot,
  run: EngineeringAgentRun,
): boolean {
  if (!planning) return false;
  const operation = findWorkItem(project, run.workItemId)?.operation;
  if (!operation) return false;
  try {
    return planning.operations.validate({ operation, stage: "planning" })
      .operation.mustOrigin === "human";
  } catch {
    return false;
  }
}
