/**
 * Startup-owned approval policy for the local project command surfaces.
 *
 * `local-yolo` is a loopback human-origin opt-in. It auto-confirms the
 * positive recovery and approval gates listed below. It never auto-rejects,
 * never satisfies a human-only execution, and cannot select providers or
 * weaken execution contracts.
 */
export type ProjectApprovalMode =
  | { readonly kind: "interactive" }
  | {
    readonly kind: "local-yolo";
    readonly origin: {
      readonly kind: "human";
      readonly actorId: "local-yolo:startup-opt-in";
    };
  };

/** One human confirmation the MCP host would otherwise elicit. */
export const HUMAN_CONFIRMATION_GATES = [
  "brief-confirm",
  "decision-approve",
  "decision-reject",
  "queued-run-cancel",
  "unstarted-supersede",
  "human-only-execute",
] as const;

export type HumanConfirmationGate = typeof HUMAN_CONFIRMATION_GATES[number];

const YOLO_AUTO_GATES: readonly HumanConfirmationGate[] = [
  "brief-confirm",
  "decision-approve",
  "queued-run-cancel",
  "unstarted-supersede",
];

export const INTERACTIVE_PROJECT_APPROVAL_MODE: ProjectApprovalMode = {
  kind: "interactive",
};

export const LOCAL_YOLO_PROJECT_APPROVAL_MODE: ProjectApprovalMode = {
  kind: "local-yolo",
  origin: {
    kind: "human",
    actorId: "local-yolo:startup-opt-in",
  },
};

export function autoConfirms(
  mode: ProjectApprovalMode,
  gate: HumanConfirmationGate,
): mode is Extract<ProjectApprovalMode, { kind: "local-yolo" }> {
  return mode.kind === "local-yolo" && YOLO_AUTO_GATES.includes(gate);
}

export function localYoloRationale(subject: string, supplied?: string): string {
  const suffix = supplied?.trim() ? ` Caller rationale: ${supplied}` : "";
  return `YOLO local startup opt-in auto-approved ${subject} without MCP elicitation.${suffix}`;
}
