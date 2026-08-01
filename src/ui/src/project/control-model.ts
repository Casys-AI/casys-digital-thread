import type {
  EngineeringApproval,
  EngineeringDecision,
  EngineeringProjectSnapshot,
  EngineeringThreadEntityRef,
  EngineeringWorkItem,
} from "../../../domain/engineering-project.ts";
import type {
  DecisionProposal,
  DecisionProposalParameter,
  ProjectCommandIntent,
} from "./command-contract.ts";

export type ProposalValueType = "text" | "number" | "boolean";

export interface DecisionParameterDraft {
  readonly id: string;
  readonly key: string;
  readonly label: string;
  readonly valueType: ProposalValueType;
  readonly value: string;
  readonly unit: string;
}

export interface ProposalDraftResult {
  readonly proposal?: DecisionProposal;
  readonly error?: string;
}

export function emptyDecisionParameterDraft(
  id: string,
): DecisionParameterDraft {
  return {
    id,
    key: "",
    label: "",
    valueType: "text",
    value: "",
    unit: "",
  };
}

export function proposalFromDraft(
  summary: string,
  parameters: readonly DecisionParameterDraft[],
): ProposalDraftResult {
  const normalizedSummary = summary.trim();
  if (!normalizedSummary) {
    return { error: "Describe the proposed engineering input." };
  }
  if (!parameters.length) {
    return { error: "Add at least one explicit proposal parameter." };
  }
  const result: DecisionProposalParameter[] = [];
  for (const parameter of parameters) {
    const key = parameter.key.trim();
    const label = parameter.label.trim();
    const rawValue = parameter.value.trim();
    if (!key || !label || !rawValue) {
      return { error: "Every parameter needs a key, label and value." };
    }
    let value: string | number | boolean = rawValue;
    if (parameter.valueType === "number") {
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        return { error: `${label} must be a finite number.` };
      }
      value = parsed;
    } else if (parameter.valueType === "boolean") {
      if (rawValue !== "true" && rawValue !== "false") {
        return { error: `${label} must explicitly be true or false.` };
      }
      value = rawValue === "true";
    }
    const unit = parameter.unit.trim();
    if (unit && parameter.valueType !== "number") {
      return {
        error: `${label} can only have a unit when its value is numeric.`,
      };
    }
    result.push({ key, label, value, ...(unit ? { unit } : {}) });
  }
  return { proposal: { summary: normalizedSummary, parameters: result } };
}

export function decisionProposal(
  decision: EngineeringDecision,
): DecisionProposal | undefined {
  const proposal = (decision as EngineeringDecision & { proposal?: unknown })
    .proposal;
  if (!proposal || typeof proposal !== "object") return undefined;
  const candidate = proposal as Partial<DecisionProposal>;
  if (
    typeof candidate.summary !== "string" ||
    !Array.isArray(candidate.parameters)
  ) return undefined;
  const parameters = candidate.parameters.filter(isProposalParameter);
  return parameters.length === candidate.parameters.length
    ? { summary: candidate.summary, parameters }
    : undefined;
}

function isProposalParameter(
  value: unknown,
): value is DecisionProposalParameter {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<DecisionProposalParameter>;
  return typeof candidate.key === "string" &&
    typeof candidate.label === "string" &&
    (typeof candidate.value === "string" ||
      typeof candidate.value === "number" ||
      typeof candidate.value === "boolean") &&
    (candidate.unit === undefined || typeof candidate.unit === "string");
}

export function decisionApprovals(
  project: EngineeringProjectSnapshot,
  decision: EngineeringDecision,
): readonly EngineeringApproval[] {
  const ids = new Set(decision.approvalIds);
  return project.approvals.filter((approval) =>
    ids.has(approval.id) && approval.decisionId === decision.id
  );
}

export function approvalMatchesDecisionScope(
  decision: EngineeringDecision,
  approval: EngineeringApproval,
): boolean {
  return sameSnapshotRef(decision.baseSnapshot, approval.baseSnapshot) &&
    sameFingerprint(decision.inputFingerprint, approval.inputFingerprint) &&
    sameEvidenceRefs(decision.inputEvidenceRefs, approval.inputEvidenceRefs);
}

export function canQueueWorkItem(
  project: EngineeringProjectSnapshot,
  item: EngineeringWorkItem,
): boolean {
  if (item.status !== "ready") return false;
  if (
    item.decisionIds.some((id) =>
      project.decisions.find((decision) => decision.id === id)?.status !==
        "approved"
    )
  ) return false;
  if (
    item.blockerIds.some((id) =>
      project.blockers.find((blocker) => blocker.id === id)?.status === "open"
    )
  ) return false;
  return !project.agentRuns.some((run) =>
    run.workItemId === item.id &&
    ["queued", "running", "waiting-for-decision", "publishing"].includes(
      run.status,
    )
  );
}

export function unavailableCommandReason(options: {
  enabled: boolean;
  intent: ProjectCommandIntent;
  allowedIntents: readonly ProjectCommandIntent[];
  actorId: string;
  busy: boolean;
}): string | undefined {
  if (!options.enabled) return "This snapshot is read-only.";
  if (!options.allowedIntents.includes(options.intent)) {
    return "The server does not grant this operator command.";
  }
  if (!options.actorId.trim()) {
    return "Declare the local operator identity first.";
  }
  if (options.busy) return "Another operator command is being applied.";
  return undefined;
}

function sameSnapshotRef(
  left: EngineeringDecision["baseSnapshot"],
  right: EngineeringApproval["baseSnapshot"],
): boolean {
  if (!left || !right) return left === right;
  return left.snapshotId === right.snapshotId &&
    left.revision === right.revision && left.subjectId === right.subjectId;
}

function sameFingerprint(
  left: EngineeringDecision["inputFingerprint"],
  right: EngineeringApproval["inputFingerprint"],
): boolean {
  if (!left || !right) return left === right;
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function sameEvidenceRefs(
  left: readonly EngineeringThreadEntityRef[],
  right: readonly EngineeringThreadEntityRef[],
): boolean {
  if (left.length !== right.length) return false;
  return left.every((reference, index) => {
    const candidate = right[index];
    return !!candidate && reference.snapshotId === candidate.snapshotId &&
      reference.snapshotRevision === candidate.snapshotRevision &&
      reference.kind === candidate.kind && reference.id === candidate.id;
  });
}
