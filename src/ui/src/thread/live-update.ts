import { activityFeedNodes } from "./feed-model.ts";
import type { ThreadGraphNode, ThreadWorkbenchSnapshot } from "./types.ts";

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
