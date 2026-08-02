import { activityFeedNodes } from "./feed-model.ts";
import type {
  EngineeringWorkbenchSnapshot,
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

/**
 * Keep the operator's context stable for in-place running -> fresh updates.
 * Follow-live moves only when the projection introduces a genuinely new node.
 */
export function nextLiveFocusNode(
  previous: ThreadWorkbenchSnapshot | undefined,
  incoming: ThreadWorkbenchSnapshot,
): ThreadGraphNode | undefined {
  const feed = activityFeedNodes(incoming.graph.nodes);
  if (!previous) return feed[0];
  const previousKeys = new Set(previous.graph.nodes.map((node) => node.id));
  return feed.find((node) => !previousKeys.has(node.id));
}

/**
 * Do not let a delayed SSE event overwrite the immediate response to a human
 * project command. Equal project revisions still advance on canonical thread
 * or live-overlay sequence.
 */
export function shouldAcceptWorkbenchUpdate(
  current: EngineeringWorkbenchSnapshot,
  incoming: EngineeringWorkbenchSnapshot,
): boolean {
  if (incoming.project.revision !== current.project.revision) {
    return incoming.project.revision > current.project.revision;
  }
  if (incoming.surface !== current.surface) {
    // A project revision normally changes when it gains its first declared
    // baseline. At equal revision, a surface replacement is still safer than
    // retaining a stale technical view for an intent-only project.
    return true;
  }
  if (incoming.surface === "planning" || current.surface === "planning") {
    return false;
  }
  if (
    incoming.alignment.currentThreadRevision !==
      current.alignment.currentThreadRevision
  ) {
    return incoming.alignment.currentThreadRevision >
      current.alignment.currentThreadRevision;
  }
  return liveOverlayVersion(incoming.thread) >
    liveOverlayVersion(current.thread);
}

function liveOverlayVersion(snapshot: ThreadWorkbenchSnapshot): number {
  const live = (snapshot as ThreadWorkbenchSnapshot & {
    live?: { version?: unknown };
  }).live;
  return typeof live?.version === "number" ? live.version : 0;
}
