/**
 * Provider-free preparation of one human cross-domain impact decision.
 *
 * The caller names only a project. The server selects the unique current
 * Thread tip and unique X07/X08 evaluation capture, recrosses Brief V2 gates
 * and existing work-item claims, and returns canonical MRTR parameters.
 */

import type {
  ProjectCrossDomainImpactDecisionReviewCommand,
  ProjectCrossDomainImpactDecisionReviewDiagnostic,
  ProjectCrossDomainImpactDecisionReviewResult,
  ProjectCrossDomainImpactDecisionReviewUseCase,
} from "../../ports/in/impact/project-cross-domain-impact-decision-review.ts";
import type { EngineeringProjectRevisionStore } from "../../ports/out/engineering-project-revision-store.ts";
import type { CrossDomainImpactBriefGateReader } from "../../ports/out/impact/cross-domain-impact-brief-gate-reader.ts";
import type { CrossDomainImpactEvaluationCaptureStore } from "../../ports/out/impact/cross-domain-impact-capture-store.ts";
import {
  encodeCrossDomainImpactDecisionAdmission,
  parseCrossDomainImpactDecisionParameters,
} from "../../../domain/impact/cross-domain-impact-decision-proposal.ts";
import {
  deepFreeze,
  exactRecord,
  safeId,
} from "../../../domain/kernel/case-validation.ts";
import { deterministicJson } from "../../../domain/kernel/deterministic-json.ts";
import { selectCurrentThreadTip } from "../../../domain/project/thread-tip.ts";
import { validateEngineeringProjectSnapshot } from "../../../domain/project/engineering-project-validation.ts";
import type { ThreadSnapshot } from "../../../domain/thread/thread-snapshot.ts";
import { validateThreadSnapshot } from "../../../domain/thread/thread-snapshot-validation.ts";
import type { ThreadSnapshotStore } from "../../../domain/thread/thread-snapshot-store.ts";
import {
  CrossDomainImpactDecisionRecrossError,
  recrossCrossDomainImpactDecision,
} from "./recross-cross-domain-impact-decision.ts";

export interface PrepareCrossDomainImpactDecisionDependencies {
  readonly projects: Pick<EngineeringProjectRevisionStore, "get">;
  readonly snapshots: Pick<ThreadSnapshotStore, "get">;
  readonly briefGates: CrossDomainImpactBriefGateReader;
  readonly captures: CrossDomainImpactEvaluationCaptureStore;
}

type ReviewCode =
  | "invalid_request"
  | "project_unavailable"
  | "basis_unavailable"
  | CrossDomainImpactDecisionRecrossError["code"];

export class PrepareCrossDomainImpactDecision
  implements ProjectCrossDomainImpactDecisionReviewUseCase {
  constructor(
    private readonly dependencies: PrepareCrossDomainImpactDecisionDependencies,
  ) {}

  async execute(value: unknown): Promise<ProjectCrossDomainImpactDecisionReviewResult> {
    let command: ProjectCrossDomainImpactDecisionReviewCommand;
    try {
      command = parseCommand(value);
    } catch {
      return unresolved(
        "invalid_request",
        "The impact-decision review request must name exactly one project.",
      );
    }
    let project;
    try {
      const raw = await this.dependencies.projects.get(command.projectId);
      if (!raw) {
        return unavailable(
          "project_unavailable",
          "The exact engineering project is unavailable.",
        );
      }
      project = validateEngineeringProjectSnapshot(raw);
    } catch {
      return unresolved(
        "project_unavailable",
        "The engineering project failed closed validation.",
      );
    }
    if (project.project.id !== command.projectId) {
      return unresolved(
        "project_unavailable",
        "The project reader did not return the requested project identity.",
      );
    }
    const tip = selectCurrentThreadTip(project.threadSnapshots);
    if (tip.status !== "ok") {
      return unavailable(
        "basis_unavailable",
        "The unique current Thread tip is unavailable.",
      );
    }
    const basis = tip.basis;
    if (basis.subjectId !== project.project.subjectId) {
      return unresolved(
        "basis_unavailable",
        "The unique current Thread tip is foreign to the project subject.",
      );
    }
    let snapshot: ThreadSnapshot | undefined;
    try {
      snapshot = await this.dependencies.snapshots.get(basis.snapshotId);
      if (snapshot) snapshot = validateThreadSnapshot(snapshot);
    } catch {
      return unavailable(
        "basis_unavailable",
        "The exact current Thread tip cannot be reopened.",
      );
    }
    if (
      !snapshot || snapshot.id !== basis.snapshotId ||
      snapshot.revision !== basis.revision || snapshot.subject.id !== basis.subjectId
    ) {
      return unavailable(
        "basis_unavailable",
        "The exact current Thread tip cannot be reopened.",
      );
    }
    try {
      const recrossed = await recrossCrossDomainImpactDecision({
        project,
        basis,
        snapshot,
        briefGates: this.dependencies.briefGates,
        captures: this.dependencies.captures,
        snapshots: this.dependencies.snapshots,
      });
      const decisionParameters = encodeCrossDomainImpactDecisionAdmission(
        recrossed.admission,
      );
      const parsed = parseCrossDomainImpactDecisionParameters(decisionParameters);
      if (deterministicJson(parsed) !== deterministicJson(recrossed.admission)) {
        throw new TypeError("Impact-decision MRTR grammar replay is not canonical.");
      }
      return deepFreeze({
        status: "resolved" as const,
        admission: recrossed.admission,
        decisionParameters,
        diagnostics: [],
      });
    } catch (error) {
      if (error instanceof CrossDomainImpactDecisionRecrossError) {
        return error.code === "evaluation_capture_unavailable" ||
            error.code === "brief_unavailable"
          ? unavailable(error.code, error.message)
          : unresolved(error.code, error.message);
      }
      return unresolved(
        "evaluation_capture_mismatch",
        "The recrossed impact-decision facts cannot form one closed admission.",
      );
    }
  }
}

function parseCommand(value: unknown): ProjectCrossDomainImpactDecisionReviewCommand {
  const root = exactRecord(
    value,
    ["projectId"],
    "$projectCrossDomainImpactDecisionReview",
  );
  return {
    projectId: safeId(
      root.projectId,
      "$projectCrossDomainImpactDecisionReview.projectId",
    ),
  };
}

function unavailable(
  code: ReviewCode,
  message: string,
): ProjectCrossDomainImpactDecisionReviewResult {
  return result("unavailable", code, message);
}

function unresolved(
  code: ReviewCode,
  message: string,
): ProjectCrossDomainImpactDecisionReviewResult {
  return result("unresolved", code, message);
}

function result(
  status: "unavailable" | "unresolved",
  code: ReviewCode,
  message: string,
): ProjectCrossDomainImpactDecisionReviewResult {
  const diagnostics: readonly ProjectCrossDomainImpactDecisionReviewDiagnostic[] = [{
    code,
    message,
  }];
  return { status, diagnostics };
}
