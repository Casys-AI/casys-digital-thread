/** Server-owned, read-only compilation of a retrospective documentary MRTR. */
import type {
  ProjectRequirementsBriefTraceReviewCommand,
  ProjectRequirementsBriefTraceReviewResult,
  ProjectRequirementsBriefTraceReviewUseCase,
} from "../../application/ports/in/architecture/requirements/project-requirements-brief-trace-review.ts";
import { PrepareProjectBriefRequirementsReview } from "../../application/use-cases/architecture/requirements/prepare-project-brief-requirements-review.ts";
import { parseTracedRequirementsProposalParameters } from "../../domain/architecture/requirements/requirements-traced-proposal.ts";
import { exactRecord, safeId } from "../../domain/kernel/case-validation.ts";
import { selectCurrentThreadTip } from "../../domain/project/thread-tip.ts";
import {
  RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
  requirementsBriefTraceClaimId,
  requirementsBriefTraceParameters,
} from "../../domain/record/requirements-brief-trace.ts";
import {
  reopenRequirementsTraceTarget,
  type RequirementsBriefTraceInputDependencies,
  resolveRequirementsBriefTraceInputs,
} from "./requirements-brief-trace-inputs.ts";
import {
  readRequirementsBriefTraceHistory,
  selectRequirementsBriefClaimHead,
} from "./requirements-brief-trace-history.ts";

export class PrepareProjectRequirementsBriefTraceReview
  implements ProjectRequirementsBriefTraceReviewUseCase {
  constructor(private readonly d: RequirementsBriefTraceInputDependencies) {}

  async execute(value: unknown): Promise<ProjectRequirementsBriefTraceReviewResult> {
    const command = parseCommand(value);
    try {
      const project = await this.d.projects.get(command.projectId);
      if (!project) throw new TypeError("The engineering project is unavailable.");
      const tip = selectCurrentThreadTip(project.threadSnapshots);
      if (tip.status !== "ok") throw new TypeError(tip.diagnostic.message);
      const base = await this.d.snapshots.get(tip.basis.snapshotId);
      if (
        !base || base.id !== tip.basis.snapshotId ||
        base.revision !== tip.basis.revision || base.subject.id !== tip.basis.subjectId
      ) {
        throw new TypeError(
          "The unique current Thread snapshot cannot be reopened exactly.",
        );
      }
      const target = await reopenRequirementsTraceTarget({
        project,
        base,
        containerComponent: command.containerComponent,
        dependencies: this.d,
      });
      const member = target.capture.requirements.find((item) =>
        item.metric === command.requirementId
      );
      if (!member) {
        throw new TypeError(
          "The named canonical requirement is absent from this exact captured family.",
        );
      }
      const claimId = await requirementsBriefTraceClaimId(
        project.project.id,
        target.capture.target.elementId,
        member.metric,
      );
      const history = await readRequirementsBriefTraceHistory({
        project,
        thread: base,
        dependencies: this.d,
      });
      const previous = selectRequirementsBriefClaimHead(history, base, claimId);
      const briefReview = await new PrepareProjectBriefRequirementsReview({
        projects: this.d.projects,
      }).execute({
        projectId: command.projectId,
        containerComponent: target.capture.containerComponent,
        containerSourceItemId: command.containerSourceItemId,
        requirements: [member].map((item, index) => ({
          slug: `criterion-${index + 1}`,
          name: item.name,
          metric: item.metric,
          operator: item.operator,
          threshold: item.limit.value,
          unit: item.limit.unit,
          sourceItemId: command.sourceItemId,
        })),
      });
      if (briefReview.status !== "resolved" || !briefReview.decisionParameters) {
        throw new TypeError(
          briefReview.diagnostics.map((item) => item.message).join(" "),
        );
      }
      const proposal = {
        requirementsCapture: target.reference,
        requirements: parseTracedRequirementsProposalParameters(
          briefReview.decisionParameters,
        ),
        ...(previous ? { predecessor: previous.reference } : {}),
      };
      await resolveRequirementsBriefTraceInputs({
        project,
        base,
        proposal,
        dependencies: this.d,
        mode: "current",
      });
      const requirementsCaptureEvidenceRef = {
        snapshotId: base.id,
        snapshotRevision: base.revision,
        kind: "artifact" as const,
        id: target.artifact.id,
      };
      return {
        status: "resolved",
        operation: RECORD_REQUIREMENTS_BRIEF_TRACE_OPERATION,
        briefBasis: briefReview.briefBasis,
        baseSnapshot: tip.basis,
        requirementsCaptureEvidenceRef,
        inputEvidenceRefs: [
          requirementsCaptureEvidenceRef,
          ...(previous
            ? [{
              snapshotId: base.id,
              snapshotRevision: base.revision,
              kind: "artifact" as const,
              id: previous.artifact.id,
            }]
            : []),
        ],
        decisionParameters: requirementsBriefTraceParameters(proposal),
        diagnostics: [],
      };
    } catch (error) {
      return {
        status: "unresolved",
        diagnostics: [{
          code: "source-unresolved",
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }
}

function parseCommand(value: unknown): ProjectRequirementsBriefTraceReviewCommand {
  const root = exactRecord(value, [
    "projectId",
    "containerComponent",
    "containerSourceItemId",
    "requirementId",
    "sourceItemId",
  ], "$traceReview");
  return {
    projectId: safeId(root.projectId, "$traceReview.projectId"),
    containerComponent: safeId(
      root.containerComponent,
      "$traceReview.containerComponent",
    ),
    containerSourceItemId: safeId(
      root.containerSourceItemId,
      "$traceReview.containerSourceItemId",
    ),
    requirementId: safeId(root.requirementId, "$traceReview.requirementId"),
    sourceItemId: safeId(root.sourceItemId, "$traceReview.sourceItemId"),
  };
}
