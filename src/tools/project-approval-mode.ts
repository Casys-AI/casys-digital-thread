/**
 * Startup-owned approval policy for the local project command surfaces.
 *
 * `local-yolo` deliberately remains a human-origin opt-in: it replaces only
 * positive MRTR decision approval and positive brief confirmation. Rejection,
 * cancellation, supersession and human-only execution keep their elicitation
 * boundary.
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

export function localYoloRationale(subject: string, supplied?: string): string {
  const suffix = supplied?.trim() ? ` Caller rationale: ${supplied}` : "";
  return `YOLO local startup opt-in auto-approved ${subject} without MCP elicitation.${suffix}`;
}
