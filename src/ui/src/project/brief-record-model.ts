import {
  currentProjectAnswer,
  type EngineeringProjectFraming,
  engineeringProjectFramingStatus,
  projectBriefIndependentQuestionBranches,
  type ProjectBriefItem,
  type ProjectBriefItemKind,
  projectBriefItems,
  type ProjectBriefQuestionBranch,
} from "../../../domain/project/project-brief.ts";

export interface ProjectBriefRecordSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly ProjectBriefItem[];
}

export interface ProjectBriefRecord {
  readonly intent: string;
  readonly revision: number;
  readonly confirmedAt?: string;
  readonly status: "confirmed" | "discussion" | "revision-requested";
  readonly statusLabel: string;
  readonly statusDetail: string;
  readonly sections: readonly ProjectBriefRecordSection[];
  readonly questionBranches: readonly ProjectBriefQuestionBranch[];
  readonly openQuestions: readonly string[];
  readonly sourceLabels: readonly string[];
}

/**
 * A quiet, browser-safe reading projection of the canonical approved brief.
 * It deliberately exposes no commands: the paired conversation remains the
 * place where a person and agent make or correct decisions.
 */
export function buildProjectBriefRecord(
  framing: EngineeringProjectFraming | undefined,
): ProjectBriefRecord | undefined {
  const brief = framing?.currentBrief;
  if (!framing || !brief) return undefined;

  const framingStatus = engineeringProjectFramingStatus(framing);
  const status = framingStatus === "awaiting-review"
    ? "discussion"
    : framingStatus === "revision-requested"
    ? "revision-requested"
    : "confirmed";
  const sections = BRIEF_SECTIONS.map(({ id, title, kinds }) => ({
    id,
    title,
    items: kinds.flatMap((kind) => projectBriefItems(brief, kind)),
  })).filter((section) => section.items.length > 0);
  const openQuestions = framing.questions.flatMap((question) => {
    const answer = currentProjectAnswer(framing, question.id);
    if (!answer) return [question.prompt];
    return answer.kind === "unknown" ? [question.prompt] : [];
  });
  const sourceLabels = uniqueSourceLabels(
    [
      ...brief.items.flatMap((item) =>
        item.sourceRefs.map((source) => source.kind)
      ),
      framing.intent.source.kind === "document" ? "document" : "intent",
    ],
  );

  return {
    intent: framing.intent.statement,
    revision: brief.revision,
    confirmedAt: framing.currentBriefApproval?.decidedAt,
    status,
    statusLabel: briefStatusLabel(status),
    statusDetail: briefStatusDetail(status),
    sections,
    questionBranches: projectBriefIndependentQuestionBranches(brief),
    openQuestions,
    sourceLabels,
  };
}

const BRIEF_SECTIONS: readonly {
  readonly id: string;
  readonly title: string;
  readonly kinds: readonly ProjectBriefItemKind[];
}[] = [
  {
    id: "intent",
    title: "What we are aiming for",
    kinds: ["objective", "mission-scenario", "primary-user"],
  },
  // Success-criteria and verification-activities are projected as sibling
  // questionBranches, never as one combined success list.
  {
    id: "constraints",
    title: "Constraints and commitments",
    kinds: [
      "constraint",
      "operating-environment",
      "intended-market",
      "manufacturing-jurisdiction",
      "operating-jurisdiction",
      "compliance-target",
    ],
  },
  {
    id: "limits",
    title: "Assumptions and limits",
    kinds: ["assumption", "exclusion", "proposed-decision"],
  },
];

function uniqueSourceLabels(
  sourceKinds:
    readonly ("intent" | "answer" | "tool" | "document" | "expert")[],
): readonly string[] {
  const labels = new Set<string>();
  for (const source of sourceKinds) {
    if (source === "intent" || source === "answer") {
      labels.add("Paired conversation");
    } else if (source === "document") {
      labels.add("Reviewed documents");
    } else if (source === "expert") {
      labels.add("Specialist input");
    } else {
      labels.add("Recorded engineering checks");
    }
  }
  return [...labels];
}

function briefStatusLabel(status: ProjectBriefRecord["status"]): string {
  if (status === "discussion") return "Newer draft in discussion";
  if (status === "revision-requested") return "Revision requested";
  return "Confirmed in conversation";
}

function briefStatusDetail(status: ProjectBriefRecord["status"]): string {
  if (status === "discussion") {
    return "The confirmed brief stays in force while you discuss a newer draft with the agent.";
  }
  if (status === "revision-requested") {
    return "The confirmed brief stays in force. A correction was requested; no active agent work is implied.";
  }
  return "This is the shared brief the agent uses to plan the recorded work.";
}
