import {
  currentProjectAnswer,
  type EngineeringProjectFraming,
  type EngineeringProjectFramingStatus,
  engineeringProjectFramingStatus,
  type ProjectBriefItem,
  type ProjectBriefItemKind,
  projectBriefItems,
  type ProjectBriefRevision,
  type ProjectBriefSourceKind,
} from "../../../domain/project/project-brief.ts";

export type BriefElicitationQuestionState = "answered" | "open";

export type BriefElicitationAuthority =
  | "proposed"
  | "canonical"
  | "empty";

export interface BriefElicitationQuestion {
  readonly id: string;
  readonly prompt: string;
  readonly whyItMatters: string;
  readonly state: BriefElicitationQuestionState;
  readonly recordedValue?: string;
  readonly recordedExplanation?: string;
  readonly recordedOpenCopy?: string;
}

export interface BriefElicitationItem {
  readonly id: string;
  readonly statement: string;
  readonly sourceLabels: readonly string[];
}

export interface BriefElicitationSection {
  readonly id: string;
  readonly title: string;
  readonly items: readonly BriefElicitationItem[];
}

export interface ProjectBriefElicitation {
  readonly intent: string;
  readonly status: Exclude<EngineeringProjectFramingStatus, "approved">;
  readonly statusLabel: string;
  readonly footerStatus: string;
  readonly confirmationLabel: string;
  readonly headline: string;
  readonly revision?: number;
  readonly assemblingAuthority: BriefElicitationAuthority;
  readonly questions: readonly BriefElicitationQuestion[];
  readonly answeredCount: number;
  readonly openCount: number;
  readonly sections: readonly BriefElicitationSection[];
  readonly openCallouts: readonly string[];
}

export const BRIEF_ELICITATION_CONFIRMATION_LABEL =
  "confirm via MRTR in the paired conversation";

/**
 * Pre-confirmation reading projection of framing questions and the
 * assembling brief. A pending or rejected proposal is never treated as
 * the approved living record.
 */
export function buildProjectBriefElicitation(
  framing: EngineeringProjectFraming | undefined,
): ProjectBriefElicitation | undefined {
  if (!framing) return undefined;
  const framingStatus = engineeringProjectFramingStatus(framing);
  if (framingStatus === "approved") return undefined;

  const brief = assemblingBrief(framing);
  const assemblingAuthority = briefAuthority(framing, brief);
  const questions = framing.questions.map((question) =>
    projectQuestion(
      framing,
      question.id,
      question.prompt,
      question.whyItMatters,
    )
  );
  const answeredCount =
    questions.filter((question) => question.state === "answered").length;
  const sections = brief
    ? ELICITATION_SECTIONS.map(({ id, title, kinds }) => ({
      id,
      title,
      items: kinds.flatMap((kind) =>
        projectBriefItems(brief, kind).map(toElicitationItem)
      ),
    })).filter((section) => section.items.length > 0)
    : [];
  const openCallouts = uniqueStatements([
    ...(brief?.items ?? []).flatMap((item) =>
      item.kind === "open-question" ? [item.statement] : []
    ),
    ...questions.flatMap((question) =>
      question.state === "open" ? [question.prompt] : []
    ),
  ]);

  return {
    intent: framing.intent.statement,
    status: framingStatus,
    statusLabel: elicitationStatusLabel(framingStatus),
    footerStatus: elicitationFooterStatus(framingStatus),
    confirmationLabel: BRIEF_ELICITATION_CONFIRMATION_LABEL,
    headline: elicitationHeadline(questions.length, brief?.revision),
    revision: brief?.revision,
    assemblingAuthority,
    questions,
    answeredCount,
    openCount: questions.length - answeredCount,
    sections,
    openCallouts: brief ? openCallouts : [],
  };
}

function assemblingBrief(
  framing: EngineeringProjectFraming,
): ProjectBriefRevision | undefined {
  const review = framing.proposalReview;
  if (review?.status === "pending" || review?.status === "rejected") {
    return framing.proposedBrief;
  }
  return framing.currentBrief;
}

function briefAuthority(
  framing: EngineeringProjectFraming,
  brief: ProjectBriefRevision | undefined,
): BriefElicitationAuthority {
  if (!brief) return "empty";
  const review = framing.proposalReview;
  if (review?.status === "pending" || review?.status === "rejected") {
    return "proposed";
  }
  return "canonical";
}

function projectQuestion(
  framing: EngineeringProjectFraming,
  questionId: string,
  prompt: string,
  whyItMatters: string,
): BriefElicitationQuestion {
  const answer = currentProjectAnswer(framing, questionId);
  if (answer?.kind === "provided") {
    return {
      id: questionId,
      prompt,
      whyItMatters,
      state: "answered",
      recordedValue: answer.value,
      recordedExplanation: answer.explanation,
    };
  }
  return {
    id: questionId,
    prompt,
    whyItMatters,
    state: "open",
    recordedOpenCopy: answer?.explanation ?? answer?.value,
  };
}

function toElicitationItem(
  item: ProjectBriefItem,
): BriefElicitationItem {
  return {
    id: item.id,
    statement: item.statement,
    sourceLabels: uniqueSourceLabels(
      item.sourceRefs.map((source) => source.kind),
    ),
  };
}

function uniqueSourceLabels(
  sourceKinds: readonly ProjectBriefSourceKind[],
): readonly string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  for (const source of sourceKinds) {
    const label = sourceKindLabel(source);
    if (seen.has(label)) continue;
    seen.add(label);
    labels.push(label);
  }
  return labels;
}

function sourceKindLabel(kind: ProjectBriefSourceKind): string {
  if (kind === "intent" || kind === "answer") return "Paired conversation";
  if (kind === "document") return "Document";
  if (kind === "expert") return "Expert";
  return "Recorded checks";
}

function uniqueStatements(values: readonly string[]): readonly string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function elicitationStatusLabel(
  status: Exclude<EngineeringProjectFramingStatus, "approved">,
): string {
  if (status === "revision-requested") return "Revision requested";
  return "Unconfirmed";
}

function elicitationFooterStatus(
  status: Exclude<EngineeringProjectFramingStatus, "approved">,
): string {
  if (status === "awaiting-review") return "Awaiting confirmation";
  if (status === "revision-requested") return "Revision requested";
  return "Framing";
}

function elicitationHeadline(
  questionCount: number,
  revision: number | undefined,
): string {
  const questions = questionCount === 1
    ? "1 framing question"
    : `${questionCount} framing questions`;
  if (revision === undefined) return `${questions} → assembling brief`;
  return `${questions} → brief rev ${revision}`;
}

const ELICITATION_SECTIONS: readonly {
  readonly id: string;
  readonly title: string;
  readonly kinds: readonly ProjectBriefItemKind[];
}[] = [
  {
    id: "intent",
    title: "Aiming for",
    kinds: ["objective", "mission-scenario", "primary-user"],
  },
  {
    id: "success",
    title: "Success",
    kinds: ["success-criterion", "verification-activity"],
  },
  {
    id: "constraints",
    title: "Constraints",
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
    title: "Limits",
    kinds: ["assumption", "exclusion", "proposed-decision"],
  },
];
