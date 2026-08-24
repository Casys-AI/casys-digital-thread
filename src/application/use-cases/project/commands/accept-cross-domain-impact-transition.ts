import type {
  EngineeringProjectSnapshot,
  EngineeringWorkItem,
} from "../../../../domain/project/engineering-project.ts";
import { deterministicJson } from "../../../../domain/kernel/deterministic-json.ts";
import { DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION } from "../../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  applyCrossDomainImpactWorkItemClaims,
  canonicalizeCrossDomainImpactWorkItemClaims,
  recrossCrossDomainImpactWorkItemClaims,
} from "../../../../domain/impact/cross-domain-impact-decision.ts";
import type { EngineeringProjectCommandOrigin } from "../../../ports/in/engineering-project-command-origin.ts";
import type {
  AcceptCrossDomainImpactDecisionCommand,
  EngineeringProjectCompletionEvidenceValidator,
} from "./engineering-project-commands.ts";
import {
  actor,
  addThreadSnapshot,
  assertExactResultEvidence,
  assertResultAdvancesBase,
  findDecision,
  findRun,
  findWorkItem,
  invalidInput,
  invalidTransition,
  mergeEvidence,
  type Mutable,
  nonEmpty,
  notFound,
  recomputeWorkReadiness,
  threadSnapshotReference,
  transition,
} from "./engineering-project-transition-values.ts";

export async function applyAcceptCrossDomainImpactDecision(
  draft: Mutable<EngineeringProjectSnapshot>,
  appliedAt: string,
  origin: EngineeringProjectCommandOrigin,
  command: AcceptCrossDomainImpactDecisionCommand,
  evidenceValidator: EngineeringProjectCompletionEvidenceValidator | undefined,
): Promise<void> {
  nonEmpty(command.runId, "runId");
  nonEmpty(command.summary, "summary");
  nonEmpty(command.decisionId, "decisionId");
  if (
    command.limits.providerCalls !== "none" ||
    command.limits.solverCalls !== "none" ||
    command.limits.reruns !== "none" ||
    command.limits.newWorkItems !== "none"
  ) {
    invalidInput(
      "An impact decision cannot grant a provider, solver, rerun, or new work item.",
    );
  }
  const run = findRun(draft, command.runId);
  if (!run) notFound("agent run", command.runId);
  const decisionWork = findWorkItem(draft, run.workItemId);
  if (!decisionWork) notFound("work item", run.workItemId);
  const operation = decisionWork.operation;
  if (
    run.basis?.kind !== "thread-snapshot" ||
    operation?.id !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.id ||
    operation.version !== DECIDE_ACCEPT_CROSS_DOMAIN_IMPACT_OPERATION.version
  ) {
    invalidTransition(
      "This command may complete only decide.accept-cross-domain-impact@2.",
    );
  }
  if (run.status !== "queued") {
    invalidTransition(
      `Impact-decision run ${run.id} can complete only from queued; it is ${run.status}.`,
    );
  }
  const decision = findDecision(draft, command.decisionId);
  if (
    !decision ||
    decision.status !== "approved" ||
    !decisionWork.decisionIds.includes(command.decisionId)
  ) {
    invalidTransition(
      "The impact decision is not the exact approved MRTR bound to this run.",
    );
  }
  const workItemIds = draft.workItems.map((item) => item.id);
  const runIds = draft.agentRuns.map((item) => item.id);
  const appliedGateClaims = canonicalizeCrossDomainImpactWorkItemClaims(
    command.appliedGateClaims,
  );
  const recrossed = recrossCrossDomainImpactWorkItemClaims(
    draft.workItems,
    appliedGateClaims.map((item) => ({
      gateItemId: item.gateItemId,
      role: item.role,
      status: item.status,
    })),
    { excludeWorkItemId: decisionWork.id },
  );
  if (deterministicJson(recrossed) !== deterministicJson(appliedGateClaims)) {
    invalidTransition(
      "Current work-item gate claims do not equal the signed impact-decision recross.",
    );
  }
  if (
    command.evaluationCapture.id !==
      `cross-domain-impact-evaluation-${command.evaluationCapture.fingerprint.digest}`
  ) {
    invalidInput(
      "The impact-decision evaluation capture id must derive from its digest.",
    );
  }
  assertExactResultEvidence(
    draft,
    command.resultSnapshot,
    command.evidenceRefs,
  );
  const basis = run.basis;
  if (basis?.kind !== "thread-snapshot") {
    invalidTransition(
      "This command may complete only decide.accept-cross-domain-impact@2.",
    );
  }
  const baseSnapshot = threadSnapshotReference(basis);
  assertResultAdvancesBase(baseSnapshot, command.resultSnapshot);
  if (!evidenceValidator) {
    invalidInput(
      "Completion evidence validation is unavailable; refusing to publish unverified refs.",
    );
  }
  await evidenceValidator.validate(
    baseSnapshot,
    command.resultSnapshot,
    command.evidenceRefs,
  );
  draft.workItems = structuredClone(
    applyCrossDomainImpactWorkItemClaims(
      draft.workItems,
      appliedGateClaims,
      { excludeWorkItemId: decisionWork.id },
    ),
  ) as Mutable<EngineeringWorkItem>[];
  addThreadSnapshot(draft, command.resultSnapshot);
  run.status = "completed";
  run.summary = command.summary;
  run.claimedAt = appliedAt;
  run.claimedBy = actor(origin);
  run.startedAt = appliedAt;
  run.completedAt = appliedAt;
  run.resultSnapshot = structuredClone(command.resultSnapshot);
  run.evidenceRefs = [...structuredClone(command.evidenceRefs)];
  run.statusHistory ??= [];
  run.statusHistory.push(transition(
    { commandId: command.commandId, summary: command.summary },
    origin,
    "completed",
    appliedAt,
  ));
  const completedWork = findWorkItem(draft, run.workItemId)!;
  completedWork.status = "completed";
  completedWork.evidenceRefs = [...structuredClone(command.evidenceRefs)];
  const phase = draft.phases.find((item) => item.id === completedWork.phaseId)!;
  phase.evidenceRefs = mergeEvidence(phase.evidenceRefs, command.evidenceRefs);
  if (
    deterministicJson(draft.workItems.map((item) => item.id)) !==
      deterministicJson(workItemIds) ||
    deterministicJson(draft.agentRuns.map((item) => item.id)) !==
      deterministicJson(runIds) ||
    draft.agentRuns.some((item) =>
      item.id !== run.id && item.status === "queued" &&
      !runIds.includes(item.id)
    )
  ) {
    invalidTransition(
      "An impact decision cannot add a work item or enqueue a rerun.",
    );
  }
  recomputeWorkReadiness(draft);
}
