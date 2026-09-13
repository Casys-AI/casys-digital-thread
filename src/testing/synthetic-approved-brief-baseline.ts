/**
 * Narrow temp-dir approved-brief baseline for registered writer tests.
 *
 * Reuses the live command services, registry, CAS and baseline executor.
 * Callers own the temporary root and extra operations after r1.
 */

import { ApprovedBriefBaselineRunExecutor } from "../adapters/project/approved-brief-baseline-run-executor.ts";
import { ExactInitialBaselineEvidenceValidator } from "../adapters/project/engineering-project-initial-baseline-evidence-validator.ts";
import {
  APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
  FileCaptureStore,
} from "../adapters/shared/cas/file-capture-store.ts";
import { FileEngineeringProjectRevisionStore } from "../adapters/shared/stores/engineering-project-store.ts";
import { FileEngineeringProjectRunLease } from "../adapters/shared/stores/file-engineering-project-run-lease.ts";
import { FileThreadSnapshotStore } from "../adapters/shared/stores/file-thread-snapshot-store.ts";
import { ExactThreadCompletionEvidenceValidator } from "../adapters/validators/engineering-project-completion-evidence-validator.ts";
import { EngineeringProjectCommandService } from "../application/use-cases/project/engineering-project-command-service.ts";
import { ProjectBriefCommandService } from "../application/use-cases/project/project-brief-command-service.ts";
import type { EngineeringProjectSnapshot } from "../domain/project/engineering-project.ts";
import type { ProjectBriefItem } from "../domain/project/project-brief.ts";
import { REGISTERED_ENGINEERING_OPERATION_REGISTRY } from "../orchestration/operations/registry.ts";
import { approvedBriefSourceAnalysisFixture } from "./approved-brief-source-analysis-fixture.ts";

export const SYNTHETIC_BASELINE_AGENT = {
  kind: "agent" as const,
  actorId: "agent:engineering",
};
export const SYNTHETIC_BASELINE_HUMAN = {
  kind: "human" as const,
  actorId: "human:reviewer",
};

export interface SyntheticApprovedBriefBaseline {
  readonly projects: FileEngineeringProjectRevisionStore;
  readonly commands: EngineeringProjectCommandService;
  readonly snapshots: FileThreadSnapshotStore;
  readonly project: EngineeringProjectSnapshot;
  readonly threadRef: {
    readonly snapshotId: string;
    readonly revision: number;
    readonly subjectId: string;
  };
  readonly commandContext: (
    commandId: string,
    expectedRevision: number,
  ) => {
    readonly commandId: string;
    readonly projectId: string;
    readonly expectedRevision: number;
    readonly issuedAt: string;
  };
}

export async function startSyntheticApprovedBriefBaseline(input: {
  readonly directory: string;
  readonly projectId: string;
  readonly projectName: string;
  readonly intent: string;
  readonly items: readonly ProjectBriefItem[];
}): Promise<SyntheticApprovedBriefBaseline> {
  const projects = new FileEngineeringProjectRevisionStore(
    `${input.directory}/projects`,
  );
  const snapshots = new FileThreadSnapshotStore(`${input.directory}/snapshots`);
  const baselineCaptures = new FileCaptureStore({
    ...APPROVED_BRIEF_CAPTURE_DESCRIPTOR,
    directory: `${input.directory}/baseline-captures`,
  });
  let tick = 0;
  const now = () =>
    new Date(Date.parse("2026-09-13T10:00:00.000Z") + ++tick * 1_000)
      .toISOString();
  const issuedAt = "2026-09-13T10:00:00.000Z";
  const commandContext = (commandId: string, expectedRevision: number) => ({
    commandId,
    projectId: input.projectId,
    expectedRevision,
    issuedAt,
  });

  const briefs = new ProjectBriefCommandService(projects, now);
  let project = await briefs.startProject(SYNTHETIC_BASELINE_AGENT, {
    commandId: "start-synthetic",
    projectId: input.projectId,
    projectName: input.projectName,
    issuedAt,
    intent: input.intent,
    intentSource: { kind: "human", reference: "conversation:synthetic" },
  });
  project = await briefs.proposeBrief(SYNTHETIC_BASELINE_AGENT, {
    ...commandContext("propose-brief", project.revision),
    items: [...input.items],
  });
  project = await briefs.approveBrief(SYNTHETIC_BASELINE_HUMAN, {
    ...commandContext("approve-brief", project.revision),
    briefSnapshotId: project.framing!.proposedBrief!.id,
    briefRevision: project.framing!.proposedBrief!.revision,
    rationale: "Synthetic approved brief for registered writer tests.",
    inputFingerprint: project.framing!.proposalReview!.inputFingerprint,
  });

  const commands = new EngineeringProjectCommandService(
    projects,
    new ExactThreadCompletionEvidenceValidator(snapshots),
    now,
    { operations: REGISTERED_ENGINEERING_OPERATION_REGISTRY },
    new ExactInitialBaselineEvidenceValidator(
      snapshots,
      baselineCaptures,
      approvedBriefSourceAnalysisFixture(input.directory),
    ),
  );
  project = await commands.publishPlan(SYNTHETIC_BASELINE_AGENT, {
    ...commandContext("publish-plan", project.revision),
    startingPoint: "idea-or-spec",
    phases: [{
      id: "baseline",
      name: "Baseline",
      description: "Record the approved brief.",
    }],
    workItems: [{
      id: "record-brief",
      phaseId: "baseline",
      owner: "agent",
      dependsOnWorkItemIds: [],
      decisionIds: [],
      operation: {
        id: "baseline.from-approved-brief",
        version: "1",
        bindings: [{
          name: "approvedBrief",
          source: { kind: "approved-brief" },
        }],
      },
    }],
    requiredDecisions: [],
  });
  project = await commands.queueRun(SYNTHETIC_BASELINE_AGENT, {
    ...commandContext("queue-brief", project.revision),
    runId: "run:brief-baseline",
    workItemId: "record-brief",
    summary: "Record the approved brief.",
    basis: project.plan!.basis,
  });
  const baselined = await new ApprovedBriefBaselineRunExecutor({
    projects,
    commands,
    captures: baselineCaptures,
    ...approvedBriefSourceAnalysisFixture(input.directory),
    snapshots,
    lease: new FileEngineeringProjectRunLease(`${input.directory}/baseline-leases`),
    now: () => "2026-09-13T10:01:00.000Z",
  }).execute(SYNTHETIC_BASELINE_AGENT, {
    commandId: "execute-brief-baseline",
    projectId: input.projectId,
    expectedRevision: project.revision,
    issuedAt: "2026-09-13T10:01:00.000Z",
    runId: "run:brief-baseline",
  });
  const threadRef = baselined.threadSnapshots[0]!;
  return {
    projects,
    commands,
    snapshots,
    project: baselined,
    threadRef,
    commandContext,
  };
}
