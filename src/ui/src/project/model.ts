import {
  deriveEngineeringPhaseStatus,
  deriveEngineeringProjectStatus,
  type EngineeringAgentRun,
  type EngineeringBlocker,
  type EngineeringDecision,
  type EngineeringPhaseStatus,
  type EngineeringProjectPhase,
  type EngineeringProjectSnapshot,
  type EngineeringProjectStatus,
  type EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";

export interface ProjectPhaseView {
  readonly phase: EngineeringProjectPhase;
  readonly status: EngineeringPhaseStatus;
  readonly completedWorkItems: number;
  readonly totalWorkItems: number;
  readonly approvedDecisions: number;
  readonly requiredDecisions: number;
  readonly evidenceCount: number;
}

export interface ProjectBrief {
  readonly status: EngineeringProjectStatus;
  readonly phases: readonly ProjectPhaseView[];
  readonly completedPhases: number;
  readonly currentWork: readonly EngineeringWorkItem[];
  readonly nextWork: readonly EngineeringWorkItem[];
  readonly activeRuns: readonly EngineeringAgentRun[];
  readonly pendingDecisions: readonly EngineeringDecision[];
  readonly openBlockers: readonly EngineeringBlocker[];
}

export function buildProjectBrief(
  snapshot: EngineeringProjectSnapshot,
): ProjectBrief {
  const phases = [...snapshot.phases]
    .sort((left, right) => left.order - right.order)
    .map((phase): ProjectPhaseView => {
      const workItems = phase.workItemIds.flatMap((id) => {
        const item = snapshot.workItems.find((candidate) =>
          candidate.id === id
        );
        return item ? [item] : [];
      });
      const decisions = phase.requiredDecisionIds.flatMap((id) => {
        const decision = snapshot.decisions.find((candidate) =>
          candidate.id === id
        );
        return decision ? [decision] : [];
      });
      return {
        phase,
        status: deriveEngineeringPhaseStatus(snapshot, phase.id),
        completedWorkItems: workItems.filter((item) =>
          item.status === "completed"
        ).length,
        totalWorkItems: workItems.length,
        approvedDecisions:
          decisions.filter((decision) => decision.status === "approved").length,
        requiredDecisions: decisions.length,
        evidenceCount: phase.evidenceRefs.length,
      };
    });

  return {
    status: deriveEngineeringProjectStatus(snapshot),
    phases,
    completedPhases: phases.filter((phase) => phase.status === "completed")
      .length,
    currentWork: snapshot.workItems.filter((item) =>
      item.status === "in-progress" ||
      item.status === "waiting-for-decision"
    ),
    nextWork: snapshot.workItems.filter((item) => item.status === "ready"),
    activeRuns: snapshot.agentRuns.filter((run) =>
      run.status === "queued" || run.status === "running" ||
      run.status === "waiting-for-decision" || run.status === "publishing"
    ),
    pendingDecisions: snapshot.decisions.filter((decision) =>
      decision.status === "required" || decision.status === "proposed"
    ),
    openBlockers: snapshot.blockers.filter((blocker) =>
      blocker.status === "open"
    ),
  };
}

export function projectStatusLabel(status: EngineeringProjectStatus): string {
  if (status === "attention-required") return "Decision required";
  if (status === "active") return "Active";
  if (status === "blocked") return "Blocked";
  if (status === "completed") return "Completed";
  return "Planned";
}

export function projectStatusTone(
  status: EngineeringProjectStatus,
): "neutral" | "active" | "attention" | "blocked" | "complete" {
  if (status === "attention-required") return "attention";
  if (status === "active") return "active";
  if (status === "blocked") return "blocked";
  if (status === "completed") return "complete";
  return "neutral";
}

export function workOwnerLabel(owner: EngineeringWorkItem["owner"]): string {
  if (owner === "shared") return "Human + agent";
  return owner === "human" ? "Human" : "Agent";
}

export function workStatusLabel(status: EngineeringWorkItem["status"]): string {
  return status.replaceAll("-", " ");
}
