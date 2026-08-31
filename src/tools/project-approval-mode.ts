/**
 * Startup-owned approval policy for the local project command surfaces.
 *
 * `local-yolo` is a loopback human-origin opt-in. It auto-confirms the
 * positive gates in `YOLO_AUTO_GATES` through the same command services or
 * registered run executor, using the persisted local-yolo human origin. It
 * never auto-rejects, never uses an agent origin, never fabricates MCP
 * elicitation responses, and cannot select providers or weaken executor
 * gates. Interactive mode still elicits every gate, including
 * `human-only-execute` and `work-item-abandon`.
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
  "capability-amend",
  "decision-approve",
  "decision-reject",
  "queued-run-cancel",
  "work-item-abandon",
  "human-only-execute",
] as const;

export type HumanConfirmationGate = typeof HUMAN_CONFIRMATION_GATES[number];

/**
 * Positive local-yolo gates only. `human-only-execute` is included because
 * the operator already opted in to autonomous positive choices: a reviewed,
 * queued run whose required decisions are already approved may execute under
 * the persisted human origin through the normal executor. `work-item-abandon`
 * is the same positive human-only editorial confirmation interactive mode
 * would elicit. `decision-reject` stays interactive.
 */
const YOLO_AUTO_GATES: readonly HumanConfirmationGate[] = [
  "brief-confirm",
  "capability-amend",
  "decision-approve",
  "queued-run-cancel",
  "work-item-abandon",
  "human-only-execute",
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
