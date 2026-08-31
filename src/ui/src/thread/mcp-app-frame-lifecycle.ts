export type McpAppFrameDocumentPhase =
  | "waiting-controller"
  | "waiting-blank-load"
  | "loading-app"
  | "app-loaded"
  | "invalid";

export type McpAppFrameLoadAction =
  | "ignore"
  | "launch"
  | "accept"
  | "invalidate";

/**
 * Advance the iframe document generation without confusing the initial empty
 * document with the registered App. Browsers dispatch a load for both.
 */
export function advanceMcpAppFrameLoad(
  phase: McpAppFrameDocumentPhase,
): readonly [McpAppFrameDocumentPhase, McpAppFrameLoadAction] {
  if (phase === "waiting-blank-load") return ["loading-app", "launch"];
  if (phase === "loading-app") return ["app-loaded", "accept"];
  if (phase === "app-loaded") return ["invalid", "invalidate"];
  return [phase, "ignore"];
}
