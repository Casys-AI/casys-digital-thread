import { LIVE_THREAD_OVERLAY_SCHEMA } from "./schema.ts";
import type { ThreadWorkbenchSnapshot } from "../thread/snapshot.ts";

export type LiveThreadGraphState = "running" | "fresh" | "failed";
export type LiveThreadUpdateState = LiveThreadGraphState | "reconciled";

export interface LiveThreadOverlay {
  readonly schemaVersion: typeof LIVE_THREAD_OVERLAY_SCHEMA;
  readonly version: number;
  readonly active: readonly LiveThreadOverlayActivity[];
}

export interface LiveThreadOverlayActivity {
  readonly runId: string;
  readonly operationId: string;
  readonly state: LiveThreadGraphState;
  readonly recordedAt: string;
  readonly baseRevision: number;
  readonly sequence: number;
}

export type LiveThreadWorkbenchSnapshot = ThreadWorkbenchSnapshot & {
  readonly live: LiveThreadOverlay;
};
