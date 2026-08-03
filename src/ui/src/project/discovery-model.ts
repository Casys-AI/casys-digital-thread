import {
  currentProjectDiscoveryAnswer,
  type ProjectDiscoveryConfidence,
  type ProjectDiscoveryQuestion,
  type ProjectDiscoveryQuestionRisk,
  type ProjectDiscoverySnapshot,
  type ProjectDiscoveryStatus,
} from "../../../domain/project-discovery.ts";

export type DiscoveryTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export interface ProjectDiscoveryProgress {
  readonly clarified: number;
  readonly open: number;
  readonly label: string;
  readonly phaseLabel: string;
}

export interface ProjectDiscoveryViewModel {
  readonly activeQuestion?: ProjectDiscoveryQuestion;
  readonly progress: ProjectDiscoveryProgress;
  readonly statusLabel: string;
  readonly statusMessage: string;
  readonly statusTone: DiscoveryTone;
}

/**
 * Derive the calm, one-question-at-a-time discovery projection.
 *
 * An explicit unknown is still a response: it advances the conversation while
 * remaining visible in the brief as unresolved input.
 */
export function buildProjectDiscoveryView(
  snapshot: ProjectDiscoverySnapshot,
): ProjectDiscoveryViewModel {
  const currentAnswers = snapshot.questions.map((question) =>
    currentProjectDiscoveryAnswer(snapshot, question.id)
  );
  const activeQuestionIndex = currentAnswers.findIndex((answer) => !answer);
  const clarified =
    currentAnswers.filter((answer) => answer?.kind === "provided")
      .length;
  const open = currentAnswers.filter((answer) => answer?.kind === "unknown")
    .length;

  return {
    activeQuestion: activeQuestionIndex >= 0
      ? snapshot.questions[activeQuestionIndex]
      : undefined,
    progress: {
      clarified,
      open,
      label: discoveryProgressLabel(clarified, open),
      phaseLabel: activeQuestionIndex >= 0
        ? "Current question"
        : snapshot.status === "discovering"
        ? "Agent preparing the next question"
        : "Brief ready for review",
    },
    statusLabel: discoveryStatusLabel(snapshot.status),
    statusMessage: discoveryStatusMessage(snapshot.status),
    statusTone: discoveryStatusTone(snapshot.status),
  };
}

export function discoveryStatusLabel(status: ProjectDiscoveryStatus): string {
  if (status === "awaiting-review") return "Brief ready to discuss";
  if (status === "revision-requested") return "Revision requested";
  if (status === "approved") return "Brief confirmed";
  return "Project framing in progress";
}

/**
 * Le badge d'en-tete porte deja l'etat. Le panneau central doit donc dire ce
 * qu'il y a a faire maintenant, sinon les deux repetent le meme mot a un ecran
 * d'intervalle et le panneau devient un cul-de-sac.
 */
export function discoveryNextStepLabel(status: ProjectDiscoveryStatus): string {
  if (status === "awaiting-review") return "Discuss the draft brief";
  if (status === "revision-requested") return "Waiting on the agent";
  if (status === "approved") return "Follow the shared record";
  return "Next question on the way";
}

export function discoveryStatusMessage(status: ProjectDiscoveryStatus): string {
  if (status === "awaiting-review") {
    return "The agent has shaped your answers into a draft brief. Discuss it in your paired conversation; the shared record stays visible here.";
  }
  if (status === "revision-requested") {
    return "The current brief remains visible. Continue in the paired conversation until the agent records a replacement.";
  }
  if (status === "approved") {
    return "The project framing is confirmed. Follow the shared record as the agent plans and records technical work.";
  }
  return "The agent is narrowing the project one meaningful question at a time.";
}

export function discoveryStatusTone(
  status: ProjectDiscoveryStatus,
): DiscoveryTone {
  if (status === "awaiting-review") return "warning";
  if (status === "revision-requested") return "info";
  if (status === "approved") return "success";
  return "neutral";
}

export function discoveryRiskLabel(risk: ProjectDiscoveryQuestionRisk): string {
  if (risk === "safety-critical") return "Safety consequence";
  if (risk === "regulatory") return "May affect compliance";
  if (risk === "material") return "Material choice";
  return "Easy to revise";
}

export function discoveryRiskTone(
  risk: ProjectDiscoveryQuestionRisk,
): DiscoveryTone {
  if (risk === "safety-critical") return "danger";
  if (risk === "regulatory" || risk === "material") return "warning";
  return "neutral";
}

export function discoveryConfidenceLabel(
  confidence: ProjectDiscoveryConfidence,
): string {
  if (confidence === "high") return "High confidence";
  if (confidence === "medium") return "Working recommendation";
  return "Early recommendation";
}

export function discoveryConfidenceTone(
  confidence: ProjectDiscoveryConfidence,
): DiscoveryTone {
  if (confidence === "high") return "success";
  if (confidence === "medium") return "info";
  return "warning";
}

function discoveryProgressLabel(
  clarified: number,
  open: number,
): string {
  const clarifiedLabel = `${clarified} topic${
    clarified === 1 ? "" : "s"
  } clarified`;
  const openLabel = `${open} open`;
  return `${clarifiedLabel} · ${openLabel}`;
}
