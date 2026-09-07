export type McpAppFrameStatus =
  | {
    readonly kind: "loading";
    readonly stage:
      | "starting"
      | "fetching-document"
      | "loading-document"
      | "awaiting-session";
  }
  | {
    readonly kind: "unavailable";
    readonly reason:
      | "host-nonce-unavailable"
      | "document-unavailable"
      | "document-invalid";
  }
  | {
    readonly kind: "error";
    readonly reason: "document-replaced" | "frame-error";
  }
  | { readonly kind: "session-accepted" }
  | {
    readonly kind: "resource-delivered";
    readonly status: "available" | "unavailable";
    readonly reason?:
      | "not-registered"
      | "fetch-failed"
      | "identity-mismatch"
      | "too-large";
  };

const STATUS_RANK: Record<McpAppFrameStatus["kind"], number> = {
  loading: 0,
  unavailable: 0,
  error: 0,
  "session-accepted": 2,
  "resource-delivered": 3,
};

const LOADING_STAGE_RANK = {
  starting: 0,
  "fetching-document": 1,
  "loading-document": 2,
  "awaiting-session": 3,
} as const;

/** Restart a generation, keep success monotonic, and freeze after a known failure. */
export function advanceMcpAppFrameStatus(
  current: McpAppFrameStatus,
  incoming: McpAppFrameStatus,
): McpAppFrameStatus {
  if (
    incoming.kind === "loading" && incoming.stage === "starting"
  ) {
    return incoming;
  }
  if (incoming.kind === "unavailable" || incoming.kind === "error") {
    return incoming;
  }
  if (current.kind === "unavailable" || current.kind === "error") {
    return current;
  }
  if (statusRank(incoming) < statusRank(current)) return current;
  return incoming;
}

export function mcpAppFrameStatusCoversFrame(
  status: McpAppFrameStatus,
): boolean {
  return status.kind === "loading" || status.kind === "unavailable" ||
    status.kind === "error";
}

export function mcpAppFrameStatusAllowsRetry(
  status: McpAppFrameStatus,
): boolean {
  return status.kind === "unavailable" || status.kind === "error";
}

export function mcpAppFrameStatusLabel(status: McpAppFrameStatus): string {
  if (status.kind === "loading") return "Loading registered App";
  if (status.kind === "unavailable") return "Registered App unavailable";
  if (status.kind === "error" && status.reason === "document-replaced") {
    return "Registered App document was replaced";
  }
  if (status.kind === "error") return "Registered App failed to load";
  return "Registered App session accepted";
}

export function mcpAppFrameUnavailableFromLoaderError(
  error: unknown,
): Extract<McpAppFrameStatus, { kind: "unavailable" }> {
  const message = error instanceof Error ? error.message : "";
  if (/nonce/i.test(message)) {
    return { kind: "unavailable", reason: "host-nonce-unavailable" };
  }
  if (/unavailable/i.test(message)) {
    return { kind: "unavailable", reason: "document-unavailable" };
  }
  return { kind: "unavailable", reason: "document-invalid" };
}

function statusRank(status: McpAppFrameStatus): number {
  if (status.kind === "loading") {
    return LOADING_STAGE_RANK[status.stage] / 10;
  }
  return STATUS_RANK[status.kind];
}
