import { activityFeedNodes } from "./feed-model.ts";
import type {
  EngineeringWorkbenchSnapshot,
  ThreadGraphNode,
  ThreadWorkbenchSnapshot,
} from "./types.ts";

/**
 * Detect a newly appended activity record without prescribing a UI focus.
 * The Workbench follows the feed chronologically; it does not auto-expand a
 * new lineage or overwrite an explicit reviewer selection.
 */
export function nextLiveActivityNode(
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
  if (incoming.project.project.id !== current.project.project.id) return true;
  if (incoming.project.revision !== current.project.revision) {
    return incoming.project.revision > current.project.revision;
  }
  if (incoming.surface !== current.surface) {
    // A project revision normally changes when it gains its first declared
    // baseline. At equal revision, a surface replacement is still safer than
    // retaining a stale technical view for an intent-only project.
    return true;
  }
  if (incoming.surface === "documentary" && current.surface === "documentary") {
    return documentaryActivityVersion(incoming) >
      documentaryActivityVersion(current);
  }
  if (incoming.surface !== "evidence" || current.surface !== "evidence") {
    // Planning accepts its own narrow activity comparator at the caller.
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

function documentaryActivityVersion(
  snapshot: Extract<EngineeringWorkbenchSnapshot, { surface: "documentary" }>,
): number {
  return snapshot.documentary.technicalStart?.activity.version ?? 0;
}

function liveOverlayVersion(snapshot: ThreadWorkbenchSnapshot): number {
  const live = (snapshot as ThreadWorkbenchSnapshot & {
    live?: { version?: unknown };
  }).live;
  return typeof live?.version === "number" ? live.version : 0;
}
