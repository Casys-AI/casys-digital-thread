import type { EngineeringProjectSnapshot } from "../engineering-project.ts";
import {
  currentProjectAnswer,
  type EngineeringProjectFraming,
  isProjectBriefGateKind,
  projectBriefContractVersion,
  projectBriefObjective,
  type ProjectBriefRevision,
} from "../project-brief.ts";
import type { EngineeringProjectValidationIssue } from "./engineering-project-validation-issue.ts";
import { issue, issueWithRecovery } from "./engineering-project-validation-issue.ts";
import { uniqueStrings } from "./engineering-project-value-validation.ts";
import {
  chronological,
  requireUnique,
} from "./engineering-project-invariant-values.ts";

export function validateProjectFramingInvariants(
  project: EngineeringProjectSnapshot,
  framing: EngineeringProjectFraming,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (Date.parse(framing.intent.capturedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      "$.framing.intent.capturedAt",
      "cannot be later than the current project revision",
    );
  }
  requireUnique(framing.questions, (item) => item.id, "$.framing.questions", issues);
  requireUnique(framing.answers, (item) => item.id, "$.framing.answers", issues);
  const questionById = new Map(framing.questions.map((item) => [item.id, item]));
  const answerById = new Map(framing.answers.map((item) => [item.id, item]));
  const superseded = new Set<string>();
  framing.questions.forEach((question, index) => {
    uniqueStrings(
      question.options.map((option) => option.value),
      `$.framing.questions[${index}].options`,
      issues,
    );
    if (question.options.length === 0) {
      issue(
        issues,
        "missing_question_option",
        `$.framing.questions[${index}].options`,
        "must contain at least one bounded option",
      );
    }
    if (
      !question.options.some((option) => option.value === question.recommendation.value)
    ) {
      issue(
        issues,
        "unselectable_recommendation",
        `$.framing.questions[${index}].recommendation.value`,
        "must match one bounded option value",
      );
    }
  });
  framing.answers.forEach((answer, index) => {
    const question = questionById.get(answer.questionId);
    if (!question) {
      issue(
        issues,
        "unknown_question",
        `$.framing.answers[${index}].questionId`,
        "does not resolve to a project question",
      );
    } else if (answer.kind === "unknown" && !question.allowUnknown) {
      issue(
        issues,
        "unknown_not_allowed",
        `$.framing.answers[${index}].kind`,
        "the question does not permit an unknown answer",
      );
    } else if (
      answer.kind === "provided" &&
      !question.options.some((option) => option.value === answer.value)
    ) {
      issue(
        issues,
        "unselectable_answer",
        `$.framing.answers[${index}].value`,
        "must match one bounded question option value",
      );
    }
    if (answer.recordedBy.origin === "human" && answer.source.kind !== "human") {
      issue(
        issues,
        "false_human_source",
        `$.framing.answers[${index}].source.kind`,
        "a directly recorded human answer must declare a human source",
      );
    }
    if (!answer.supersedesAnswerId) return;
    const previous = answerById.get(answer.supersedesAnswerId);
    if (
      !previous || previous.questionId !== answer.questionId ||
      framing.answers.indexOf(previous) >= index
    ) {
      issue(
        issues,
        "invalid_supersession",
        `$.framing.answers[${index}].supersedesAnswerId`,
        "must resolve to an earlier answer for the same question",
      );
    }
    if (superseded.has(answer.supersedesAnswerId)) {
      issue(
        issues,
        "answer_superseded_twice",
        `$.framing.answers[${index}].supersedesAnswerId`,
        "an answer may be superseded only once",
      );
    }
    superseded.add(answer.supersedesAnswerId);
  });
  for (const question of framing.questions) {
    const active = framing.answers.filter((answer) =>
      answer.questionId === question.id && !superseded.has(answer.id)
    );
    if (active.length > 1) {
      issue(
        issues,
        "ambiguous_current_answer",
        "$.framing.answers",
        `question ${question.id} has more than one current answer`,
      );
    }
  }

  if (framing.currentBrief) {
    validateProjectBriefInvariants(
      project,
      framing,
      framing.currentBrief,
      "$.framing.currentBrief",
      issues,
    );
  }
  if (framing.proposedBrief) {
    validateProjectBriefInvariants(
      project,
      framing,
      framing.proposedBrief,
      "$.framing.proposedBrief",
      issues,
    );
  }
  if (
    framing.currentBrief && framing.proposedBrief &&
    framing.proposedBrief.revision <= framing.currentBrief.revision
  ) {
    issue(
      issues,
      "non_contiguous_revision",
      "$.framing.proposedBrief.revision",
      "must be newer than the current approved brief",
    );
  }

  if (Boolean(framing.currentBrief) !== Boolean(framing.currentBriefApproval)) {
    issue(
      issues,
      "missing_review_scope",
      "$.framing",
      "currentBrief and currentBriefApproval must be present together",
    );
  }
  if (Boolean(framing.proposedBrief) !== Boolean(framing.proposalReview)) {
    issue(
      issues,
      "missing_review_scope",
      "$.framing",
      "proposedBrief and proposalReview must be present together",
    );
  }
  if (framing.currentBrief && framing.currentBriefApproval) {
    validateBriefReviewBinding(
      framing.currentBrief,
      framing.currentBriefApproval,
      "$.framing.currentBriefApproval",
      true,
      issues,
    );
    const objective = projectBriefObjective(framing.currentBrief);
    if (
      project.project.objective.title !== objective ||
      project.project.objective.statement !== objective
    ) {
      issue(
        issues,
        "brief_objective_mismatch",
        "$.project.objective",
        "must mirror the current canonical brief objective",
      );
    }
  }
  if (framing.proposedBrief && framing.proposalReview) {
    validateBriefReviewBinding(
      framing.proposedBrief,
      framing.proposalReview,
      "$.framing.proposalReview",
      false,
      issues,
    );
  }
}

function validateBriefReviewBinding(
  brief: ProjectBriefRevision,
  review:
    | EngineeringProjectFraming["currentBriefApproval"]
    | EngineeringProjectFraming["proposalReview"],
  path: string,
  approved: boolean,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (!review) return;
  if (
    review.briefSnapshotId !== brief.id ||
    review.briefRevision !== brief.revision
  ) {
    issue(
      issues,
      "review_brief_mismatch",
      path,
      "must reference the exact reviewed brief revision",
    );
  }
  if (approved && review.status !== "approved") {
    issue(issues, "review_status_mismatch", `${path}.status`, "must be approved");
  }
  if (!approved && review.status === "approved") {
    issue(
      issues,
      "review_status_mismatch",
      `${path}.status`,
      "a proposal review cannot already be approved",
    );
  }
  const decided = review.status !== "pending";
  if (
    !decided &&
    (review.decidedAt || review.decidedBy || review.rationale)
  ) {
    issue(
      issues,
      "pending_review_has_decision",
      path,
      "a pending brief review cannot contain decision fields",
    );
  }
  if (
    decided &&
    (!review.decidedAt || !review.decidedBy || !review.rationale)
  ) {
    issue(
      issues,
      "incomplete_review_decision",
      path,
      "a decided brief review requires time, human actor and rationale",
    );
  }
  if (review.decidedBy?.origin === "agent") {
    issue(
      issues,
      "agent_review_forbidden",
      `${path}.decidedBy.origin`,
      "an agent cannot approve or reject the project brief",
    );
  }
  chronological(
    review.requestedAt,
    review.decidedAt,
    `${path}.decidedAt`,
    issues,
  );
}

function validateProjectBriefInvariants(
  project: EngineeringProjectSnapshot,
  framing: EngineeringProjectFraming,
  brief: ProjectBriefRevision,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  const expectedBriefId = `${project.project.id}:brief`;
  if (brief.briefId !== expectedBriefId) {
    issue(
      issues,
      "brief_identity_mismatch",
      `${path}.briefId`,
      `must equal ${expectedBriefId}`,
    );
  }
  if (brief.revision === 1 && brief.previous) {
    issue(
      issues,
      "unexpected_previous",
      `${path}.previous`,
      "must be absent at brief revision 1",
    );
  } else if (
    brief.revision > 1 &&
    (!brief.previous || brief.previous.revision !== brief.revision - 1)
  ) {
    issue(
      issues,
      "non_contiguous_revision",
      `${path}.previous`,
      "must reference the immediately preceding brief revision",
    );
  }
  if (Date.parse(brief.proposedAt) > Date.parse(project.generatedAt)) {
    issue(
      issues,
      "invalid_chronology",
      `${path}.proposedAt`,
      "cannot be later than the current project revision",
    );
  }
  requireUnique(brief.items, (item) => item.id, `${path}.items`, issues);
  validateV2BriefGateDependencies(brief, path, issues);
  const objective = brief.items.filter((item) => item.kind === "objective");
  if (objective.length !== 1) {
    issue(
      issues,
      "invalid_brief_objective",
      `${path}.items`,
      "must contain exactly one objective",
    );
  }
  if (!brief.items.some((item) => item.kind === "mission-scenario")) {
    issue(
      issues,
      "missing_brief_section",
      `${path}.items`,
      "must contain at least one mission scenario",
    );
  }
  if (!brief.items.some((item) => item.kind === "success-criterion")) {
    issue(
      issues,
      "missing_brief_section",
      `${path}.items`,
      "must contain at least one success criterion",
    );
  }
  brief.items.forEach((item, index) => {
    const itemPath = `${path}.items[${index}]`;
    if (item.sourceRefs.length === 0) {
      issue(
        issues,
        "missing_source",
        `${itemPath}.sourceRefs`,
        "every brief item must retain at least one source",
      );
    }
    for (const [sourceIndex, source] of item.sourceRefs.entries()) {
      if (
        source.kind === "answer" &&
        !framing.answers.some((answer) =>
          answer.id === source.reference &&
          currentProjectAnswer(framing, answer.questionId)?.id === answer.id
        )
      ) {
        issue(
          issues,
          "stale_brief_source",
          `${itemPath}.sourceRefs[${sourceIndex}]`,
          "must reference one current project answer",
        );
      }
    }
    if (item.kind === "assumption" && (!item.owner || !item.reviewTrigger)) {
      issue(
        issues,
        "incomplete_assumption",
        itemPath,
        "an assumption requires both owner and reviewTrigger",
      );
    }
    if (
      item.kind === "observed-fact" &&
      !item.sourceRefs.some((source) =>
        source.kind === "tool" || source.kind === "document" ||
        source.kind === "expert"
      )
    ) {
      issue(
        issues,
        "unobserved_fact",
        `${itemPath}.sourceRefs`,
        "an observed fact requires a tool, document or expert source",
      );
    }
  });
}

/**
 * V2 makes every gate's impact contract explicit. The gate's own fingerprint
 * remains implicit, so self references would only disguise an incomplete
 * declaration rather than add dependency information.
 */
function validateV2BriefGateDependencies(
  brief: ProjectBriefRevision,
  path: string,
  issues: EngineeringProjectValidationIssue[],
): void {
  if (projectBriefContractVersion(brief) !== "2.0") return;
  const itemsById = new Map(brief.items.map((item) => [item.id, item]));
  brief.items.forEach((item, itemIndex) => {
    if (!isProjectBriefGateKind(item.kind)) return;
    const itemPath = `${path}.items[${itemIndex}]`;
    const dependencyIds = item.dependsOnItemIds;
    // Structural validation reports a missing or malformed declaration first.
    if (!dependencyIds) return;
    const seen = new Set<string>();
    dependencyIds.forEach((dependencyId, dependencyIndex) => {
      const dependencyPath = `${itemPath}.dependsOnItemIds[${dependencyIndex}]`;
      if (seen.has(dependencyId)) {
        issueWithRecovery(
          issues,
          "duplicate_gate_dependency",
          dependencyPath,
          "must name each dependent brief item only once",
          { gateItemId: item.id, dependencyItemId: dependencyId },
          "Keep one explicit dependency per brief item.",
        );
      }
      seen.add(dependencyId);
      if (dependencyId === item.id) {
        issueWithRecovery(
          issues,
          "invalid_gate_self_dependency",
          dependencyPath,
          "must not name the gate itself; its own fingerprint is implicit",
          { gateItemId: item.id },
          "Remove the self reference; use [] when the gate has no other brief-item dependencies.",
        );
      } else if (!itemsById.has(dependencyId)) {
        issueWithRecovery(
          issues,
          "unknown_gate_dependency",
          dependencyPath,
          "must reference an existing brief item",
          { gateItemId: item.id, dependencyItemId: dependencyId },
          "Reference an existing different brief item or use [] for declared independence.",
        );
      }
    });
  });
}
