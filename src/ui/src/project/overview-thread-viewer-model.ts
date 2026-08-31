import type {
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "../thread/types.ts";

export interface OverviewThreadViewerCapabilities {
  /** The exact graph record can always be inspected from the loaded snapshot. */
  readonly inspectRecord: true;
  /** Verification navigation preserves the exact graph reference. */
  readonly openVerification: true;
}

/**
 * Resolve only generic Workbench affordances.
 *
 * Domain viewer capabilities are never inferred here. A domain surface enters
 * the whiteboard only through an exact server-projected whole-App binding.
 */
export function resolveOverviewThreadViewerCapabilities(
  _snapshot: ThreadWorkbenchSnapshot,
  _node: ThreadGraphNode,
): OverviewThreadViewerCapabilities {
  return {
    inspectRecord: true,
    openVerification: true,
  };
}

/**
 * Return an App only when the recorded anchor has one exact binding.
 * Zero is unavailable; more than one is terminally ambiguous, never a chooser.
 */
export function uniqueOverviewThreadViewerSession<T>(
  sessions: readonly T[],
): T | undefined {
  return sessions.length === 1 ? sessions[0] : undefined;
}
